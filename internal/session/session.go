// Package session is the core domain object tying a jsonl file to a process.
package session

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
)

// Owner 表示当前 session 由哪一侧持有写权限。
type Owner int

const (
	// OwnerApp 表示 Ease UI 持有 stdin，写权限在 app 端 (stream-json 模式)。
	OwnerApp Owner = iota
	// OwnerTerminal 表示写权限在外部终端 (claude -r 在 iTerm/Terminal 里跑)。
	OwnerTerminal
)

func (o Owner) String() string {
	switch o {
	case OwnerApp:
		return "app"
	case OwnerTerminal:
		return "terminal"
	}
	return "unknown"
}

// Mode 表示当前 claude 进程的启动模式。
type Mode int

const (
	// ModeStream 对应 `claude --input-format stream-json --output-format stream-json`。
	ModeStream Mode = iota
	// ModeResume 对应 `claude -r <sid>`，运行在外部终端。
	ModeResume
)

func (m Mode) String() string {
	switch m {
	case ModeStream:
		return "stream"
	case ModeResume:
		return "resume"
	}
	return "unknown"
}

type ProcessIface interface {
	Write(s string) error
	Close() error
}

var (
	ErrAwaitingPermission = errors.New("session: awaiting permission")
	ErrUnknownRequest     = errors.New("session: unknown permission request id")
	ErrClosed             = errors.New("session: closed")
)

type Session struct {
	ID      string
	WorkDir string

	owner      Owner
	mode       Mode
	extPID     int
	extPIDFile string

	mu      sync.Mutex
	state   State
	proc    ProcessIface
	pending map[string]struct{}
	// version increments on every mutation of state/proc/pending. It is used
	// by Send and RespondPermission to detect whether a concurrent goroutine
	// (e.g. one calling RegisterPermission or Close) has touched the session
	// while a Write was in flight, so a failed Write can roll back only when
	// it would not clobber a legitimate concurrent change.
	version uint64
	// switchMu 串行化 owner 切换流程 (kill 外部 claude → 起 stream-json)，
	// 与 mu 分离避免与高频状态读写 (Send/RegisterPermission) 互锁。
	switchMu sync.Mutex
}

func New(id, workDir string) *Session {
	return &Session{
		ID:      id,
		WorkDir: workDir,
		owner:   OwnerApp,
		mode:    ModeStream,
		state:   StateIdle,
		pending: map[string]struct{}{},
	}
}

func (s *Session) State() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

func (s *Session) setState(st State) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = st
	s.version++
}

func (s *Session) setProcess(p ProcessIface) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.proc = p
	s.version++
}

// Owner 返回当前 session 的写权限归属。
func (s *Session) Owner() Owner {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.owner
}

// SetOwner 更新 session 的写权限归属。调用方应保证状态一致性
// （如先关掉旧 owner 对应的进程，再 SetOwner）。
func (s *Session) SetOwner(o Owner) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.owner = o
	s.version++
}

// Mode 返回当前 claude 进程的启动模式。
func (s *Session) Mode() Mode {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.mode
}

// SetMode 更新 claude 进程的启动模式。
func (s *Session) SetMode(m Mode) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mode = m
	s.version++
}

// SetExtPID 记录 owner=Terminal 时的外部 claude 进程 pid 和 pidfile 路径，
// 供切回 App 时定位并 kill 该进程。pid <= 0 表示清空。
func (s *Session) SetExtPID(pid int, pidFile string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.extPID = pid
	s.extPIDFile = pidFile
	s.version++
}

// ExtPID 返回 owner=Terminal 时记录的外部 claude 进程 (pid, pidfile)。
func (s *Session) ExtPID() (int, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.extPID, s.extPIDFile
}

// SwitchLock 返回切换 owner 时使用的互斥锁。app 层的 SwitchOwner 在
// kill 外部 / 起新进程的整段流程内持锁，避免与 Send/RespondPermission
// 抢同一把锁造成长时间阻塞。
func (s *Session) SwitchLock() *sync.Mutex { return &s.switchMu }

// Send delivers a prompt to the underlying process. Valid only in Idle or Running.
// Idle -> Running. In AwaitingPermission, returns ErrAwaitingPermission.
//
// Bug 2 fix: on Write failure, state is reverted to its pre-Send value ONLY if
// no concurrent mutation occurred (detected via the version field). If another
// goroutine has changed state/proc/pending during the in-flight Write, the
// revert is skipped so it does not overwrite a legitimate concurrent change
// such as RegisterPermission moving the session to AwaitingPermission or
// Close moving it to Idle.
func (s *Session) Send(prompt string) error {
	s.mu.Lock()
	if s.state == StateAwaitingPermission {
		s.mu.Unlock()
		return ErrAwaitingPermission
	}
	if s.proc == nil {
		s.mu.Unlock()
		return errors.New("session: no process")
	}
	proc := s.proc
	prevState := s.state
	prevVersion := s.version
	s.state = StateRunning
	s.version++
	s.mu.Unlock()

	if err := proc.Write(envelopeUserMessage(prompt)); err != nil {
		s.mu.Lock()
		if s.version == prevVersion+1 {
			// No concurrent mutation observed; safe to roll back.
			s.state = prevState
			s.version++
		}
		s.mu.Unlock()
		// Process write failed (likely dead/killed) — clear stale proc so the
		// next SendMessage triggers a fresh AdoptSession instead of reusing
		// the broken reference. Frontend uses session.Send errors to alert
		// the user, but the next attempt needs a clean slate.
		if errors.Is(err, os.ErrClosed) || strings.Contains(err.Error(), "file already closed") || strings.Contains(err.Error(), "broken pipe") {
			s.Close()
		}
		return err
	}
	return nil
}

// RegisterPermission moves session to AwaitingPermission and records the request.
func (s *Session) RegisterPermission(reqID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pending[reqID] = struct{}{}
	s.state = StateAwaitingPermission
	s.version++
}

// RespondPermission answers a pending request and returns session to Running.
//
// Bug 1 fix: the proc == nil check now happens under the lock, BEFORE pending
// is deleted or state is changed. Returning ErrClosed from a closed session
// must leave pending and state untouched so the permission request is not
// silently dropped.
//
// Bug 3 fix: on Write failure, pending and state are restored only if no
// concurrent mutation occurred (detected via the version field). If another
// goroutine has touched the session during the in-flight Write, the rollback
// is skipped to avoid clobbering a legitimate concurrent change.
func (s *Session) RespondPermission(reqID string, allow bool) error {
	s.mu.Lock()
	if _, ok := s.pending[reqID]; !ok {
		s.mu.Unlock()
		return ErrUnknownRequest
	}
	// Bug 1 fix: check proc under the lock, before mutating state.
	if s.proc == nil {
		s.mu.Unlock()
		return ErrClosed
	}
	proc := s.proc
	prevState := s.state
	prevVersion := s.version
	delete(s.pending, reqID)
	s.state = StateRunning
	s.version++
	s.mu.Unlock()

	var response string
	if allow {
		response = "ALLOW\n"
	} else {
		response = "DENY\n"
	}
	if err := proc.Write(response); err != nil {
		// Bug 3 fix: rollback pending + state only if no concurrent mutation.
		s.mu.Lock()
		if s.version == prevVersion+1 {
			s.pending[reqID] = struct{}{}
			s.state = prevState
			s.version++
		}
		s.mu.Unlock()
		return err
	}
	return nil
}

// SetIdle moves to Idle (called on result event).
func (s *Session) SetIdle() {
	s.UnlockIfLocked()
	s.setState(StateIdle)
}

func (s *Session) Close() error {
	s.mu.Lock()
	proc := s.proc
	s.proc = nil
	s.state = StateIdle
	s.version++
	s.mu.Unlock()
	if proc == nil {
		return nil
	}
	return proc.Close()
}

// SetProcessForTest attaches a process implementation. Used by the app layer
// when wrapping a real *process.Process. Marked public to keep package boundaries
// clean; do not use from other domain packages.
func (s *Session) SetProcessForTest(p ProcessIface) {
	s.setProcess(p)
}

// GetProcessForTest returns the attached process. For app-layer tests that
// need to assert idempotency ("did we leak a second process?").
func (s *Session) GetProcessForTest() ProcessIface {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.proc
}

// UnlockIfLocked / Locked helpers used by tests; keep tiny
func (s *Session) UnlockIfLocked() {}

// envelopeUserMessage 把 prompt 包成 stream-json user message envelope。
// 跟 Claude CLI stream-json 协议严格对齐：每行一个 JSON 对象 + \n 终止。
// claude 进程只接受这种格式；裸文本会被 stream-json 解析器直接丢弃，
// 这就是 v1 "Send 写完但没反应" 的根因。
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
