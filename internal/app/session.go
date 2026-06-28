package app

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/akke/ease-ui/internal/jsonl"
	"github.com/akke/ease-ui/internal/process"
	"github.com/akke/ease-ui/internal/protocol"
	"github.com/akke/ease-ui/internal/session"
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

// CreateSession launches a new claude subprocess for the given workdir + prompt.
// The session ID is generated client-side (a hex string); callers should write
// the same ID into the jsonl so the App can re-attach.
func (a *App) CreateSession(workDir, _prompt string) (string, error) {
	id, err := newID()
	if err != nil {
		return "", err
	}
	a.mu().RLock()
	bin := a.claudeBin
	if bin == "" {
		bin = a.settings.ClaudePath
	}
	a.mu().RUnlock()
	if bin == "" {
		bin = "claude"
	}

	proc, err := process.Start(workDir, id, bin)
	if err != nil {
		return "", err
	}

	s := session.New(id, workDir)
	s.SetProcessForTest(proc) // see session package: exposes a setter
	a.registerSession(s)
	go a.pumpEvents(s, proc)
	return id, nil
}

func (a *App) SendMessage(sessionID, prompt string) error {
	s, ok := a.lookupSession(sessionID)
	if !ok {
		return errSessionNotFound
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
func (a *App) GetSessionMessages(sessionID, workDir string) ([]jsonl.Message, error) {
	root := jsonl.Root()
	encodedDir := encodeProjectDirName(workDir)
	path := filepath.Join(root, encodedDir, sessionID+".jsonl")
	return jsonl.ParseFile(path)
}

// encodeProjectDirName converts "/Users/akke/foo" to "-Users-akke-foo"
func encodeProjectDirName(dir string) string {
	// "/Users/akke" → "-Users-akke"（ReplaceAll 会把首个 / 也替换成 -）
	return strings.ReplaceAll(dir, "/", "-")
}

func (a *App) CloseSession(sessionID string) error {
	s, ok := a.lookupSession(sessionID)
	if !ok {
		return errSessionNotFound
	}
	return s.Close()
}

func newID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

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

func (a *App) pumpEvents(s *session.Session, p *process.Process) {
	topic := "session:" + s.ID
	for line := range p.Events() {
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
	s.SetIdle()
	if a.ctx != nil {
		wailsruntime.EventsEmit(a.ctx, topic, `{"type":"done"}`)
	}
}
