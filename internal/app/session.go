package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/akke/ease-ui/internal/apiproxy"
	"github.com/akke/ease-ui/internal/hookserver"
	"github.com/akke/ease-ui/internal/jsonl"
	"github.com/akke/ease-ui/internal/pty"
	"github.com/akke/ease-ui/internal/session"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

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
// 规则：
//  1. jsonl 本身已 /exit /quit 结束 → "ended"，最权威。
//  2. instance.Store 里是 done/ended/idle → 直接用。
//  3. instance.Store 里是 running（或本进程曾写入的 awaiting_permission）：
//     只有当前 App 确实还控制着该 session（进程存活 或 最近 5min 内有 hook 事件）
//     才保留 running；否则说明是上次关闭后残留的脏状态，降级为 idle。
//  4. 没有任何记录 → 不返回，UI 默认按 idle 处理。
func (a *App) GetSessionStates() map[string]string {
	out := map[string]string{}
	list, _ := a.ListSessions()
	for _, m := range list {
		// 1) jsonl 自身结束标记优先
		if ended, err := jsonlSessionEnded(m.ID, m.WorkDir); err == nil && ended {
			out[m.ID] = "ended"
			continue
		}

		// 2) instance store 状态
		inst := a.inst.Get(m.ID)
		if inst.State == "" {
			continue
		}

		switch inst.State {
		case "done", "ended", "idle":
			out[m.ID] = inst.State
		case "running":
			if a.sessionIsActive(m.ID) {
				out[m.ID] = "running"
			} else {
				out[m.ID] = "idle"
			}
		default:
			// 未知状态按 idle 处理，避免 UI 显示异常
			out[m.ID] = "idle"
		}
	}
	return out
}

// sessionIsActive 判断 session 是否仍由当前 App 持有活跃进程或近期有 hook 事件。
func (a *App) sessionIsActive(id string) bool {
	s, ok := a.lookupSession(id)
	if ok && s.GetProcessForTest() != nil {
		return true
	}

	a.hookMu.RLock()
	srv := a.hookSrv
	a.hookMu.RUnlock()
	if srv == nil {
		return false
	}
	last := srv.LastSeen(id)
	if last.IsZero() {
		return false
	}
	return time.Since(last) <= 5*time.Minute
}

// CreateSession 新建会话。Claude 自己生成 UUID，阻塞等待 SessionStart hook
// 返回真实 session ID（超时 15s）。前端在此期间显示加载动画。
// 非真实 claude（如 /bin/echo 测试用）直接用 PID 作为 ID，不等待 hook。
func (a *App) CreateSession(workDir, prompt string) (string, error) {
	bin := getBin(a)

	// 先启动 API 网关代理（临时 token），等待真实 session ID 后再迁移。
	token := apiproxy.NewCallID()
	proxy, proxyErr := a.startPendingAPIProxy(token, workDir)
	env := []string(nil)
	if proxyErr == nil {
		env = append(env, proxyEnvPair(proxy))
	} else {
		fmt.Fprintf(os.Stderr, "ease-ui: apiproxy disabled for new session: %v\n", proxyErr)
	}

	proc, err := pty.Start(workDir, "", bin, pty.ModeAuto, env)
	if err != nil {
		if proxy != nil {
			a.stopAPIProxy(token)
		}
		return "", err
	}

	// 非真实 claude（测试二进制等）：用 PID 作为 ID，不等待 hook
	if bin != "claude" && !strings.HasSuffix(bin, "/claude") {
		id := fmt.Sprintf("test-%d", proc.Pid())
		a.resolvePendingAPIProxy(token, id)
		s := session.New(id, workDir)
		s.SetProcessForTest(proc)
		a.registerSession(s)
		a.inst.Put(id, "running")
		go a.pumpPtyEvents(s, proc)
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
		a.resolvePendingAPIProxy(token, realID)
		s := session.New(realID, workDir)
		s.SetProcessForTest(proc)
		a.registerSession(s)
		a.inst.Put(realID, "running")
		go a.pumpPtyEvents(s, proc)
		if prompt != "" {
			_ = s.Send(prompt)
		}
		return realID, nil
	case <-time.After(15 * time.Second):
		fmt.Fprintf(os.Stderr, "[DBG] CreateSession: TIMEOUT after 15s\n")
		proc.Close()
		a.stopAPIProxy(token)
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
// 用途：前端 ListSessions 拿全量 jsonl，用户切到一条历史 session 时，先
// AdoptSession 注册到 a.sessions；真正进入终端由 OpenSessionTerminal 启动 PTY。
// 已在 a.sessions 里的 sid 走幂等 noop。
//
// 跟 CreateSession 的差别：sid 是调用方给的（不是新生成）；不写 prompt。
func (a *App) AdoptSession(sessionID, workDir string) error {
	if s, ok := a.lookupSession(sessionID); ok {
		if proc := s.GetProcessForTest(); proc != nil {
			return nil
		}
	}
	if sessionID == "" || workDir == "" {
		return &appError{msg: "AdoptSession: sessionID and workDir required"}
	}
	s := session.New(sessionID, workDir)
	a.registerSession(s)
	a.inst.Put(sessionID, "idle")
	fmt.Fprintf(os.Stderr, "[DBG] AdoptSession: sid=%s registered (no proc)\n", sessionID)
	return nil
}

// OpenSessionTerminal 确保已有 session 的交互式 Claude PTY 已启动。
// 已有进程时不重复启动；未启动时使用 claude --resume <sessionID> 进入历史会话。
func (a *App) OpenSessionTerminal(sessionID, workDir string) error {
	return a.openSessionTerminal(sessionID, workDir, pty.Size{})
}

// OpenSessionTerminalSized 在启动 PTY 前应用前端当前 xterm cols/rows，避免首屏按默认窄宽度渲染。
func (a *App) OpenSessionTerminalSized(sessionID, workDir string, cols, rows int) error {
	return a.openSessionTerminal(sessionID, workDir, pty.Size{Cols: cols, Rows: rows})
}

func (a *App) openSessionTerminal(sessionID, workDir string, size pty.Size) error {
	if err := a.AdoptSession(sessionID, workDir); err != nil {
		return err
	}
	s, ok := a.lookupSession(sessionID)
	if !ok {
		return errSessionNotFound
	}
	if proc := s.GetProcessForTest(); proc != nil {
		return nil
	}
	bin := getBin(a)
	env := a.apiProxyEnvOrLog(sessionID, s.WorkDir)
	newProc, err := pty.StartWithSize(s.WorkDir, sessionID, bin, pty.ModeResume, size, env)
	if err != nil {
		return err
	}
	s.SetProcessForTest(newProc)
	a.inst.Put(sessionID, "running")
	go a.pumpPtyEvents(s, newProc)
	return nil
}

// jsonlSessionEnded wraps the jsonl path resolution + IsSessionEnded call.
// Returns (false, nil) when the jsonl file does not exist (fresh session).
func jsonlSessionEnded(sessionID, workDir string) (bool, error) {
	root := jsonl.Root()
	path := filepath.Join(root, encodeProjectDirName(workDir), sessionID+".jsonl")
	return jsonl.IsSessionEnded(path)
}

func (a *App) SendMessage(sessionID, prompt string) error {
	s, ok := a.lookupSession(sessionID)
	if !ok {
		fmt.Fprintf(os.Stderr, "[DBG] SendMessage: sid=%s NOT in a.sessions\n", sessionID)
		return errSessionNotFound
	}
	fmt.Fprintf(os.Stderr, "[DBG] SendMessage: sid=%s prompt=%q\n", sessionID, prompt)

	// 懒启动 PTY 进程：AdoptSession 已经注册了 session 但没有起进程。
	// SendMessage 收到第一个 prompt 时立即起进程 + 写输入。
	if proc := s.GetProcessForTest(); proc == nil {
		bin := getBin(a)
		env := a.apiProxyEnvOrLog(sessionID, s.WorkDir)
		newProc, err := pty.StartWithSize(s.WorkDir, sessionID, bin, pty.ModeResume, pty.Size{}, env)
		if err != nil {
			return err
		}
		s.SetProcessForTest(newProc)
		go a.pumpPtyEvents(s, newProc)
	}

	return s.Send(prompt)
}

func (a *App) SendMessageFromHTTP(req hookserver.SendRequest) error {
	if _, ok := a.lookupSession(req.SessionID); !ok {
		list, err := a.ListSessions()
		if err != nil {
			return err
		}
		found := false
		for _, m := range list {
			if m.ID == req.SessionID {
				found = true
				if err := a.OpenSessionTerminal(req.SessionID, m.WorkDir); err != nil {
					return err
				}
				break
			}
		}
		if !found {
			return errSessionNotFound
		}
	}
	return a.SendMessage(req.SessionID, req.Prompt)
}

func (a *App) RespondPermission(sessionID, reqID string, allow bool) error {
	s, ok := a.lookupSession(sessionID)
	if !ok {
		return errSessionNotFound
	}
	return s.RespondPermission(reqID, allow)
}

// RespondHookPermission 响应阻塞型 PermissionRequest hook。
// decision 为 decision 对象（behavior + 可选 updatedInput/message），
// 由前端弹窗根据工具类型或 AskUserQuestion 答案组装。
func (a *App) RespondHookPermission(reqID string, decision map[string]any) error {
	a.permMu.Lock()
	w, ok := a.permPending[reqID]
	if !ok {
		a.permMu.Unlock()
		return fmt.Errorf("permission request %s not found or timed out", reqID)
	}
	delete(a.permPending, reqID)
	a.permMu.Unlock()

	select {
	case w.ch <- decision:
		close(w.ch)
	default:
		// 已经超时或被其他 goroutine 处理
	}
	return nil
}

// GetSessionMessages reads the jsonl history for a session and returns
// all messages. Used when switching to a session that has no active process.
func (a *App) GetSessionMessages(sessionID, workDir string, offset, limit int) ([]jsonl.Message, error) {
	root := jsonl.Root()
	encodedDir := encodeProjectDirName(workDir)
	path := filepath.Join(root, encodedDir, sessionID+".jsonl")
	return jsonl.ParseFileRange(path, offset, limit)
}

// GetToolExecutions scans the jsonl history for tool executions and LLM calls,
// returning a timeline sorted by start time.
func (a *App) GetToolExecutions(sessionID, workDir string) ([]jsonl.ToolExecution, error) {
	root := jsonl.Root()
	encodedDir := encodeProjectDirName(workDir)
	path := filepath.Join(root, encodedDir, sessionID+".jsonl")
	return jsonl.ParseToolExecutions(path)
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
	a.stopAPIProxy(sessionID)
	return err
}

// --- WriteTerminalInput / ResizeTerminal (PTY 直通) ---

// WriteTerminalInput 将 xterm.js 的逐键输入直接写入 PTY stdin。
// 与 SendMessage 的区别：不经过 session.Send 的状态切换。
func (a *App) WriteTerminalInput(sessionID, data string) error {
	s, ok := a.lookupSession(sessionID)
	if !ok {
		return errSessionNotFound
	}

	proc := s.GetProcessForTest()
	if proc == nil {
		bin := getBin(a)
		env := a.apiProxyEnvOrLog(sessionID, s.WorkDir)
		newProc, err := pty.StartWithSize(s.WorkDir, sessionID, bin, pty.ModeResume, pty.Size{}, env)
		if err != nil {
			return err
		}
		s.SetProcessForTest(newProc)
		go a.pumpPtyEvents(s, newProc)
		proc = newProc
	}

	return proc.Write(data)
}

// ResizeTerminal 调整 PTY 窗口大小，由前端 xterm.js 触发。
func (a *App) ResizeTerminal(sessionID string, cols, rows int) error {
	s, ok := a.lookupSession(sessionID)
	if !ok {
		return errSessionNotFound
	}
	proc := s.GetProcessForTest()
	if proc == nil {
		return nil
	}
	if p, ok := proc.(*pty.Proc); ok {
		return p.Resize(cols, rows)
	}
	return nil
}

var errSessionNotFound = &appError{msg: "session not found"}

type appError struct {
	msg string
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

func (a *App) closeAllSessions() {
	a.appMu.RLock()
	sessions := make([]*session.Session, 0, len(a.sessions))
	for _, s := range a.sessions {
		sessions = append(sessions, s)
	}
	a.appMu.RUnlock()

	for _, s := range sessions {
		_ = s.Close()
		a.inst.Put(s.ID, "done")
	}
	a.stopAllAPIProxies()
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

// pumpPtyEvents 从 PTY 读取原始字节并通过 Wails Events 推送到前端。
func (a *App) pumpPtyEvents(s *session.Session, p *pty.Proc) {
	topic := "session:" + s.ID
	fmt.Fprintf(os.Stderr, "[DBG] pumpPtyEvents start: sid=%s pid=%d\n", s.ID, p.Pid())
	buf := make([]byte, 4096)
	for {
		n, err := p.Read(buf)
		if err != nil {
			break
		}
		if n > 0 && a.ctx != nil {
			data := make([]byte, n)
			copy(data, buf[:n])
			wailsruntime.EventsEmit(a.ctx, topic, string(data))
		}
	}
	// PTY 进程退出
	fmt.Fprintf(os.Stderr, "[DBG] pumpPtyEvents done: sid=%s\n", s.ID)
	s.SetIdle()
	a.inst.Put(s.ID, "done")
	a.stopAPIProxy(s.ID)
	if a.ctx != nil {
		wailsruntime.EventsEmit(a.ctx, topic, `{"type":"done"}`)
	}
}
