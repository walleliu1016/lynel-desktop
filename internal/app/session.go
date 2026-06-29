package app

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/akke/ease-ui/internal/jsonl"
	"github.com/akke/ease-ui/internal/process"
	"github.com/akke/ease-ui/internal/protocol"
	"github.com/akke/ease-ui/internal/session"
)

// switchSettleDelay 是 SwitchOwner 杀掉外部 claude 后等待 hook server
// 收到 SessionEnd、或者给进程预留退出的保守时间。太短可能切回后立刻
// 看到 "session 已被另一个 claude 持有" 之类的错误；太长则用户感知的
// 切换延迟变大。500ms 是经验值。
const switchSettleDelay = 500 * time.Millisecond

func (a *App) SetClaudeBinary(p string) {
	a.mu().Lock()
	defer a.mu().Unlock()
	a.claudeBin = p
}

func (a *App) ListSessions() ([]jsonl.SessionMeta, error) {
	if a.opts.ClaudeDir != "" {
		jsonl.SetRoot(filepath.Join(a.opts.ClaudeDir, "projects"))
	}
	return jsonl.ScanAll()
}

// GetSessionStates 返回持久化的会话状态（用于启动时恢复）。
//
// 顺序：
//  1. instance.Store 有持久化状态（如上次关闭前是 running/done/awaiting_permission）
//     → 优先用它。Ease UI 控制过的 session 最权威。
//  2. instance.Store 没记录（jsonl 里存在但 Ease UI 从未 adopt 过的历史 session）→
//     扫 jsonl 末尾的 /exit / /quit 标记，是则返回 "ended"，UI 立即显示该
//     session 已结束、禁用 send。
func (a *App) GetSessionStates() map[string]string {
	out := map[string]string{}
	list, _ := a.ListSessions()
	for _, m := range list {
		if s := a.inst.Get(m.ID); s.State != "" {
			out[m.ID] = s.State
			continue
		}
		// jsonl-only sessions: 通过尾部 /exit 标记检测 ended
		if ended, err := jsonlSessionEnded(m.ID, m.WorkDir); err == nil && ended {
			out[m.ID] = "ended"
		}
	}
	return out
}

// CreateSession 新建会话。Claude 自己生成 UUID，阻塞等待 SessionStart hook
// 返回真实 session ID（超时 15s）。前端在此期间显示加载动画。
// 非真实 claude（如 /bin/echo 测试用）直接用 PID 作为 ID，不等待 hook。
func (a *App) CreateSession(workDir, prompt string) (string, error) {
	bin := getBin(a)
	proc, err := process.Start(workDir, "", bin, process.ModeAuto)
	if err != nil {
		return "", err
	}

	// 非真实 claude（测试二进制等）：用 PID 作为 ID，不等待 hook
	if bin != "claude" && !strings.HasSuffix(bin, "/claude") {
		id := fmt.Sprintf("test-%d", proc.PidForTest())
		s := session.New(id, workDir)
		s.SetProcessForTest(proc)
		a.registerSession(s)
		a.inst.Put(id, "running")
		go a.pumpEvents(s, proc)
		if prompt != "" {
			_ = s.Send(prompt)
		}
		return id, nil
	}

	// 真实 claude：等待 SessionStart hook 返回真实 UUID
	ch := make(chan string, 1)
	a.registerPending(ch)
	defer a.unregisterPending(ch)

	fmt.Fprintf(os.Stderr, "[DBG] CreateSession: waiting for SessionStart hook (15s timeout)...\n")
	select {
	case realID := <-ch:
		fmt.Fprintf(os.Stderr, "[DBG] CreateSession: GOT real id=%s\n", realID)
		s := session.New(realID, workDir)
		s.SetProcessForTest(proc)
		a.registerSession(s)
		a.inst.Put(realID, "running")
		go a.pumpEvents(s, proc)
		if prompt != "" {
			_ = s.Send(prompt)
		}
		return realID, nil
	case <-time.After(15 * time.Second):
		fmt.Fprintf(os.Stderr, "[DBG] CreateSession: TIMEOUT after 15s\n")
		proc.Close()
		return "", fmt.Errorf("session start timeout (15s)")
	}
}

func getBin(a *App) string {
	a.mu().RLock()
	defer a.mu().RUnlock()
	bin := a.claudeBin
	if bin == "" {
		bin = a.settings.ClaudePath
	}
	if bin == "" {
		bin = "claude"
	}
	return bin
}

// AdoptSession 把 Ease UI 启动前已经存在的历史 session（jsonl 里有但
// a.sessions map 没注册）拉进 App 控制。
//
// 用途：前端 ListSessions 拿全量 jsonl，用户切到一条历史 session + 第一次
// 发消息时 → 先 AdoptSession 起 stream-json 进程接管 + 注册到 a.sessions，
// 再 SendMessage 写 prompt。已在 a.sessions 里的 sid 走幂等 noop。
//
// 跟 CreateSession 的差别：sid 是调用方给的（不是新生成）；不写 prompt。
//
// Resume 模式：如果 jsonl 末尾有 /exit 或 /quit 标记，说明用户之前已经
// 主动结束了该 session。这种情况下用 `--resume <sid>` 启动 stream-json
// （claude 会从 jsonl 读历史 + 接受新 envelope），而不是 `--session-id`
// （已 ended 的 session 用 --session-id 启动会立即退出）。
// AdoptSession 把 Ease UI 启动前已经存在的历史 session（jsonl 里有但
// a.sessions map 没注册）拉进 App 控制。
//
// 用途：前端 ListSessions 拿全量 jsonl，用户切到一条历史 session + 第一次
// 发消息时 → 先 AdoptSession 起 stream-json 进程接管 + 注册到 a.sessions，
// 再 SendMessage 写 prompt。已在 a.sessions 里的 sid 走幂等 noop。
//
// 跟 CreateSession 的差别：sid 是调用方给的（不是新生成）；不写 prompt。
//
// 模式：因为 sid 必然对应一个**已存在**的 jsonl 文件（不论 ended 还是
// live），一律走 `--resume` 启动。`--session-id` 用在已存在的 sid 上
// 会让 claude 立即 DEAD —— 这就是历史 session 发送被静默吞掉的根因。
// `CreateSession` 走 newID() 生成全新 sid + 对应 jsonl 不存在，
// `--session-id` 才正确。
func (a *App) AdoptSession(sessionID, workDir string) error {
	if s, ok := a.lookupSession(sessionID); ok {
		// 已经在 App 控制中，但要校验 proc 还活着。
		// 之前用 "幂等 noop" 在 proc 死了之后会让 SendMessage 永远报
		// "no process"。重新拉进程 + 注册到 a.sessions。
		if proc := s.GetProcessForTest(); proc != nil {
			return nil
		}
		fmt.Fprintf(os.Stderr, "[DBG] AdoptSession: sid=%s found but proc=nil, re-spawning\n", sessionID)
	}
	if sessionID == "" || workDir == "" {
		return &appError{code: "E_BAD_ARG", msg: "AdoptSession: sessionID and workDir required"}
	}
	// 懒策略：只创建 session + 注册到 a.sessions，不启动进程。
	// 进程在 SendMessage 时延迟启动，确保 claude 一起来就能收到 envelope，
	// 避免 claude -p 模式 3 秒无 stdin 超时退出。
	s := session.New(sessionID, workDir)
	a.registerSession(s)
	a.inst.Put(sessionID, "idle")
	fmt.Fprintf(os.Stderr, "[DBG] AdoptSession: sid=%s lazy-registered (no proc)\n", sessionID)
	return nil
}

// jsonlSessionEnded wraps the jsonl path resolution + IsSessionEnded call.
// Returns (false, nil) when the jsonl file does not exist (fresh session).
func jsonlSessionEnded(sessionID, workDir string) (bool, error) {
	root := jsonl.Root()
	path := filepath.Join(root, encodeProjectDirName(workDir), sessionID+".jsonl")
	return jsonl.IsSessionEnded(path)
}

// startStreamSession 启 stream-json 进程 + 注册 a.sessions + pumpEvents。
// CreateSession 用 ModeAuto（Claude 自己生成 UUID）；
// AdoptSession 用 ModeResume（续写已有 jsonl）。
func (a *App) startStreamSession(sessionID, workDir string) error {
	return a.startStreamSessionWithMode(sessionID, workDir, process.ModeAuto)
}

// startStreamSessionWithMode is the mode-aware variant. AdoptSession uses
// ModeResume when the jsonl tail indicates a user-driven /exit / /quit,
// so claude picks up the existing history instead of starting from scratch.
func (a *App) startStreamSessionWithMode(sessionID, workDir string, mode process.Mode) error {
	a.mu().RLock()
	bin := a.claudeBin
	if bin == "" {
		bin = a.settings.ClaudePath
	}
	a.mu().RUnlock()
	if bin == "" {
		bin = "claude"
	}
	fmt.Fprintf(os.Stderr, "[DBG] startStream: sid=%s workdir=%s bin=%s mode=%v\n", sessionID, workDir, bin, mode)

	proc, err := process.Start(workDir, sessionID, bin, mode)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[DBG] startStream: process.Start failed: %v\n", err)
		return err
	}
	fmt.Fprintf(os.Stderr, "[DBG] startStream: pid=%d OK\n", proc.PidForTest())

	s := session.New(sessionID, workDir)
	s.SetProcessForTest(proc)
	a.registerSession(s)
	a.inst.Put(sessionID, "idle")
	go a.pumpEvents(s, proc)
	return nil
}

func (a *App) SendMessage(sessionID, prompt string) error {
	s, ok := a.lookupSession(sessionID)
	if !ok {
		fmt.Fprintf(os.Stderr, "[DBG] SendMessage: sid=%s NOT in a.sessions\n", sessionID)
		return errSessionNotFound
	}
	fmt.Fprintf(os.Stderr, "[DBG] SendMessage: sid=%s prompt=%q\n", sessionID, prompt)

	// 懒启动 stream-json 进程：AdoptSession 已经注册了 session 但没有
	// 起进程（避免 claude -p 模式 3s 无 stdin 超时退出）。SendMessage
	// 收到第一个 prompt 时立即起进程 + 写 envelope，保证 stdin 在起动
	// 瞬间就有数据。
	if proc := s.GetProcessForTest(); proc == nil {
		a.mu().RLock()
		bin := a.claudeBin
		if bin == "" {
			bin = a.settings.ClaudePath
		}
		a.mu().RUnlock()
		if bin == "" {
			bin = "claude"
		}
		newProc, err := process.Start(s.WorkDir, sessionID, bin, process.ModeResume)
		if err != nil {
			return err
		}
		s.SetProcessForTest(newProc)
		go a.pumpEvents(s, newProc)
	}

	return s.Send(prompt)
}

func (a *App) RespondPermission(sessionID, reqID string, allow bool) error {
	s, ok := a.lookupSession(sessionID)
	if !ok {
		return errSessionNotFound
	}
	return s.RespondPermission(reqID, allow)
}

// GetSessionMessages reads the jsonl history for a session and returns
// all messages. Used when switching to a session that has no active process.
func (a *App) GetSessionMessages(sessionID, workDir string, offset, limit int) ([]jsonl.Message, error) {
	root := jsonl.Root()
	encodedDir := encodeProjectDirName(workDir)
	path := filepath.Join(root, encodedDir, sessionID+".jsonl")
	return jsonl.ParseFileRange(path, offset, limit)
}

// encodeProjectDirName converts a workdir into the directory name used by
// Claude CLI under ~/.claude/projects. Claude replaces path separators ("/",
// "\"), the drive colon (":") and leading dots/underscores with "-" without
// collapsing runs. We mirror that so Ease UI resolves the same directory.
func encodeProjectDirName(dir string) string {
	return strings.NewReplacer(
		`\`, "-",
		"/", "-",
		":", "-",
		".", "-",
		"_", "-",
	).Replace(dir)
}

func (a *App) CloseSession(sessionID string) error {
	s, ok := a.lookupSession(sessionID)
	if !ok {
		return errSessionNotFound
	}
	err := s.Close()
	if err == nil {
		a.inst.Put(sessionID, "done")
	}
	return err
}

// newID 生成标准 UUID v4 格式的 session ID（Claude CLI 要求 UUID 格式）。
var errSessionNotFound = &appError{code: "E_SESSION_NOT_FOUND", msg: "session not found"}

type appError struct {
	code, msg string
}

func (e *appError) Error() string { return e.msg }

// --- internals ---

func (a *App) mu() *sync.RWMutex { return &a.appMu }

func (a *App) registerSession(s *session.Session) {
	a.appMu.Lock()
	defer a.appMu.Unlock()
	if a.sessions == nil {
		a.sessions = map[string]*session.Session{}
	}
	a.sessions[s.ID] = s
}

func (a *App) lookupSession(id string) (*session.Session, bool) {
	a.appMu.RLock()
	defer a.appMu.RUnlock()
	s, ok := a.sessions[id]
	return s, ok
}

// pending 通道：CreateSession 等待 SessionStart hook 返回真实 session ID
var pendingMu sync.Mutex
var pendingChans []chan string

func (a *App) registerPending(ch chan string) {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	pendingChans = append(pendingChans, ch)
}

func (a *App) unregisterPending(ch chan string) {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	for i, c := range pendingChans {
		if c == ch {
			pendingChans = append(pendingChans[:i], pendingChans[i+1:]...)
			return
		}
	}
}

// deliverSessionID 由 hook 回调调用，将真实 session ID 发给等待中的 CreateSession。
func deliverSessionID(realID string) {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	for _, ch := range pendingChans {
		select {
		case ch <- realID:
		default:
		}
	}
}

func (a *App) pumpEvents(s *session.Session, p *process.Process) {
	topic := "session:" + s.ID
	fmt.Fprintf(os.Stderr, "[DBG] pumpEvents start: sid=%s pid=%d\n", s.ID, p.PidForTest())
	n := 0
	for line := range p.Events() {
		n++
		if n <= 3 || n%10 == 0 {
			fmt.Fprintf(os.Stderr, "[DBG] pumpEvents: sid=%s n=%d line=%q\n", s.ID, n, string(line))
		}

		// 广播原始行给前端，同时也发布到内部 bus
		a.bus.Publish(topic, line)
		if a.ctx != nil {
			wailsruntime.EventsEmit(a.ctx, topic, string(line))
		}

		// 解析事件并更新 session 状态
		evt, err := protocol.Parse(line)
		if err != nil {
			continue
		}
		switch evt.Type {
		case protocol.EvtPermissionReq:
			var req protocol.PermissionRequest
			if json.Unmarshal(evt.Data, &req) == nil {
				s.RegisterPermission(req.RequestID)
			}
		case protocol.EvtResult:
			s.SetIdle()
		}
	}
	// 子进程退出：清理状态
	fmt.Fprintf(os.Stderr, "[DBG] pumpEvents done: sid=%s n=%d\n", s.ID, n)
	s.SetIdle()
	if a.ctx != nil {
		wailsruntime.EventsEmit(a.ctx, topic, `{"type":"done"}`)
	}
}

// SwitchOwner 切换 session 的写权限归属。
//
//   - target="app":    从外部终端切回 Ease UI 控制。会 kill 外部 claude
//     进程 (优先按 Session.ExtPIDFile 记录的 pidfile，其次按 pkill
//     -f 兜底)，等 hook server 收到 SessionEnd，再起新的 stream-json
//     进程接管。如果 prompt != ""，会作为新一轮 prompt 写入新进程。
//   - target="terminal": 从 App 控制切到外部终端。关 stream-json 进程，
//     调 OpenInTerminal 起外部 claude -r，Session 标记 Terminal-owned。
//
// 整个流程在 Session.switchMu 持锁下完成，避免与 Send/RespondPermission
// 抢同一把锁。
func (a *App) SwitchOwner(sessionID, target, prompt string) error {
	s, ok := a.lookupSession(sessionID)
	if !ok {
		return errSessionNotFound
	}
	s.SwitchLock().Lock()
	defer s.SwitchLock().Unlock()

	switch target {
	case "app":
		return a.switchToApp(s, prompt)
	case "terminal":
		return a.switchToTerminal(s)
	default:
		return &appError{code: "E_BAD_TARGET", msg: "SwitchOwner: target must be 'app' or 'terminal'"}
	}
}

func (a *App) switchToApp(s *session.Session, prompt string) error {
	if s.Owner() == session.OwnerApp {
		// 已经是 App-owned；prompt 不空则直写（envelope 化由调用方决定）
		if prompt != "" {
			return s.Send(prompt)
		}
		return nil
	}

	// 1) kill 外部 claude 进程
	_, pidfile := s.ExtPID()
	if pidfile != "" {
		if err := killByPIDFile(pidfile); err != nil {
			// pidfile 路径已失效（用户关了 iTerm 后 pid 已死）→ 兜底 pkill
			_ = pkillByPattern(s.ID)
		}
	} else {
		// Windows 或 Launch 未写 pidfile → 直接走 pkill
		_ = pkillByPattern(s.ID)
	}

	// 2) 等 hook server 收到 SessionEnd 给前端同步状态
	time.Sleep(switchSettleDelay)

	// 3) 关掉 session 旧 proc 引用 + 起新 stream-json 进程
	_ = s.Close()
	a.appMu.RLock()
	bin := a.claudeBin
	if bin == "" {
		bin = a.settings.ClaudePath
	}
	workdir := s.WorkDir
	a.appMu.RUnlock()

	proc, err := process.Start(workdir, s.ID, bin, process.ModeResume)
	if err != nil {
		return &appError{code: "E_START_STREAM", msg: "start stream-json: " + err.Error()}
	}
	s.SetProcessForTest(proc)
	s.SetOwner(session.OwnerApp)
	s.SetMode(session.ModeStream)
	s.SetExtPID(0, "")

	// 4) 重新订阅事件流
	go a.pumpEvents(s, proc)

	// 5) 写入新一轮 prompt（stream-json envelope）
	if prompt != "" {
		if err := proc.Write(envelopeUserMessage(prompt)); err != nil {
			return &appError{code: "E_WRITE_PROMPT", msg: "write prompt: " + err.Error()}
		}
	}
	return nil
}

func (a *App) switchToTerminal(s *session.Session) error {
	if s.Owner() == session.OwnerTerminal {
		return nil
	}
	// OpenInTerminal 内部会 s.Close() 再 Launch + 标记 session
	return a.OpenInTerminal(s.WorkDir, s.ID, "")
}

// envelopeUserMessage 构造 stream-json user message envelope。
// 跟 session.Session.Send 现在的裸文本行为不同——SwitchOwner 起的是
// 全新 stream-json 进程，写 envelope 跟 Claude CLI 严格规范对齐；
// Send 走 v1 的裸文本兼容性路径（Claude 对裸 user 文本宽容接受）。
func envelopeUserMessage(prompt string) string {
	body, _ := json.Marshal(map[string]any{
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": prompt,
		},
	})
	return string(body) + "\n"
}

// killByPIDFile 读 pidfile 拿 pid，kill 对应进程。pid 已死（用户关
// iTerm）时不报错。Linux/macOS 用 SIGTERM 让 claude 优雅退出。
func killByPIDFile(pidfile string) error {
	data, err := os.ReadFile(pidfile)
	if err != nil {
		return err
	}
	pidStr := strings.TrimSpace(string(data))
	pid, err := strconv.Atoi(pidStr)
	if err != nil || pid <= 0 {
		return &appError{code: "E_BAD_PID", msg: "invalid pid in " + pidfile}
	}
	// Unix 上 os.FindProcess 永远返回 success，但 Kill 会失败如果进程
	// 已退出；Windows 上 FindProcess 会校验存在。统一用 error 表达。
	switch runtime.GOOS {
	case "windows":
		_ = exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/T", "/F").Run()
	default:
		if err := exec.Command("kill", "-TERM", strconv.Itoa(pid)).Run(); err != nil {
			// SIGTERM 失败则 SIGKILL 兜底
			_ = exec.Command("kill", "-KILL", strconv.Itoa(pid)).Run()
		}
	}
	_ = os.Remove(pidfile)
	return nil
}

// pkillByPattern 用 pkill/taskkill 按命令行匹配杀 claude -r 进程。
// macOS/Linux: pkill -f "claude.*-r.*<sid>"
// Windows:     powershell 按 CommandLine 匹配 sid 后 taskkill /F /PID
func pkillByPattern(sid string) error {
	switch runtime.GOOS {
	case "windows":
		// 用 WMI 查找命令行包含 "--resume <sid>" 的 claude.exe 进程并杀掉。
		ps := fmt.Sprintf(
			"Get-CimInstance Win32_Process -Filter \"CommandLine LIKE '%%%%--resume %s%%%%'\" | Select-Object -ExpandProperty ProcessId",
			sid)
		out, err := exec.Command("powershell", "-NoProfile", "-Command", ps).Output()
		if err == nil && len(out) > 0 {
			for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
				pid := strings.TrimSpace(line)
				if pid != "" {
					_ = exec.Command("taskkill", "/F", "/PID", pid).Run()
				}
			}
		}
		// 兜底：按窗口标题再杀一次
		_ = exec.Command("taskkill", "/F", "/FI", "WINDOWTITLE eq Claude").Run()
		return nil
	default:
		return exec.Command("pkill", "-f", "claude.*-r.*"+sid).Run()
	}
}
