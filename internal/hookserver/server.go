// Package hookserver provides a local HTTP server that receives Claude
// hook events. It notifies the app layer on every event and tracks the
// last-seen time per session, so the app can determine active/idle state.
package hookserver

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// HookEvent is the payload POSTed by Claude hooks to /hook.
// Claude CLI 通过 command hook 的 stdin 传入 JSON。
// 字段名是 hook_event_name（不是 type），与 HTTP hook 的 payload 格式不同。
type HookEvent struct {
	SessionID     string          `json:"session_id"`
	HookEventName string          `json:"hook_event_name"` // SessionStart, SessionEnd, PreToolUse, …
	HookName      string          `json:"hook_name"`
	Tool          string          `json:"tool"`
	ToolName      string          `json:"tool_name"`
	ToolNameCamel string          `json:"toolName"`
	ToolInput     json.RawMessage `json:"tool_input"`
	ToolInputCamel json.RawMessage `json:"toolInput"`
	ToolUseID     string          `json:"toolUseID"`
	Stdout        string          `json:"stdout"`
	Stderr        string          `json:"stderr"`
	ExitCode      int             `json:"exitCode"`
	// 兼容 HTTP hook 格式
	Type string `json:"type,omitempty"`
}

// EffectiveToolName 返回工具名，兼容 snake_case / camelCase / hook_name 多种来源。
func (e HookEvent) EffectiveToolName() string {
	if e.ToolName != "" {
		return e.ToolName
	}
	if e.ToolNameCamel != "" {
		return e.ToolNameCamel
	}
	if e.Tool != "" {
		return e.Tool
	}
	// hook_name 形如 "PermissionRequest:AskUserQuestion"
	if parts := strings.Split(e.HookName, ":"); len(parts) > 1 {
		return parts[len(parts)-1]
	}
	return ""
}

// EffectiveToolInput 返回 tool_input，兼容 snake_case / camelCase。
func (e HookEvent) EffectiveToolInput() json.RawMessage {
	if len(e.ToolInput) > 0 {
		return e.ToolInput
	}
	return e.ToolInputCamel
}

// EventType 返回 hook 事件类型，兼容 command 和 HTTP 两种格式。
func (e HookEvent) EventType() string {
	if e.HookEventName != "" {
		return e.HookEventName
	}
	return e.Type
}

// SendRequest is the payload for POST /api/send.
type SendRequest struct {
	SessionID string `json:"session_id"`
	Prompt    string `json:"prompt"`
}

// SendResult is returned by POST /api/send.
type SendResult struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// Server is the local hook receiver.
type Server struct {
	port                int
	mu                  sync.RWMutex
	lastSeen            map[string]time.Time
	listener            net.Listener
	onEvent             func(HookEvent)
	onSend              func(SendRequest) error
	onPermissionRequest func(HookEvent) (any, error)
}

// New creates a new hook server.
func New() *Server {
	return &Server{lastSeen: map[string]time.Time{}}
}

// Start listens on 127.0.0.1:0 and returns the assigned port.
func (s *Server) Start() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	s.listener = l
	s.port = l.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	mux.HandleFunc("/hook", s.handleHook)
	mux.HandleFunc("/api/send", s.handleSend)
	go http.Serve(l, mux)
	return s.port, nil
}

// Port returns the port the server is listening on (0 before Start).
func (s *Server) Port() int { return s.port }

// OnEvent registers a callback invoked on every hook event.
func (s *Server) OnEvent(fn func(HookEvent)) { s.onEvent = fn }

// OnSend registers a callback for POST /api/send. Returns error if write fails.
func (s *Server) OnSend(fn func(SendRequest) error) { s.onSend = fn }

// OnPermissionRequest registers a callback invoked for blocking PermissionRequest hooks.
// The callback must return the JSON body to send back to Claude.
func (s *Server) OnPermissionRequest(fn func(HookEvent) (any, error)) { s.onPermissionRequest = fn }

// LastSeen returns the most recent hook time for a session, or zero.
func (s *Server) LastSeen(sessionID string) time.Time {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastSeen[sessionID]
}

func (s *Server) handleHook(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(os.Stderr, "[DBG] hookserver: HTTP %s %s\n", r.Method, r.URL.Path)
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var evt HookEvent
	if err := json.NewDecoder(r.Body).Decode(&evt); err != nil {
		fmt.Fprintf(os.Stderr, "[DBG] hookserver: parse error: %v\n", err)
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	fmt.Fprintf(os.Stderr, "[DBG] hookserver: parsed type=%s sid=%s tool=%s hook=%s\n",
		evt.EventType(), evt.SessionID, evt.EffectiveToolName(), evt.HookName)

	now := time.Now()
	s.mu.Lock()
	if evt.SessionID != "" {
		s.lastSeen[evt.SessionID] = now
	}
	s.mu.Unlock()

	if s.onEvent != nil {
		s.onEvent(evt)
	}

	// PermissionRequest 是阻塞型 hook，需要等待用户决策并返回 decision。
	if evt.EventType() == "PermissionRequest" {
		if s.onPermissionRequest != nil {
			output, err := s.onPermissionRequest(evt)
			if err != nil {
				fmt.Fprintf(os.Stderr, "[DBG] hookserver: permission request handler error: %v\n", err)
				writeJSON(w, http.StatusOK, denyPermissionResponse("handler error"))
				return
			}
			writeJSON(w, http.StatusOK, output)
			return
		}
		writeJSON(w, http.StatusOK, denyPermissionResponse("no handler registered"))
		return
	}

	// Claude CLI HTTP hook 要求返回 {"continue":true} 才继续执行。
	// SessionStart hook 加 suppressOutput 避免 Claude 输出恢复提示。
	type hookResponse struct {
		Continue       bool `json:"continue"`
		SuppressOutput bool `json:"suppressOutput,omitempty"`
	}
	resp := hookResponse{Continue: true}
	if evt.EventType() == "SessionStart" {
		resp.SuppressOutput = true
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func denyPermissionResponse(message string) any {
	return map[string]any{
		"hookSpecificOutput": map[string]any{
			"hookEventName": "PermissionRequest",
			"decision": map[string]any{
				"behavior": "deny",
				"message":  message,
			},
		},
	}
}

// handleSend 接收外部 HTTP 写入 prompt，转发到对应 session 的 claude stdin。
// POST /api/send  body: {"session_id":"...","prompt":"..."}
func (s *Server) handleSend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.onSend == nil {
		writeJSON(w, http.StatusServiceUnavailable, SendResult{OK: false, Error: "send handler not registered"})
		return
	}
	var req SendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, SendResult{OK: false, Error: "bad request: " + err.Error()})
		return
	}
	if req.SessionID == "" || req.Prompt == "" {
		writeJSON(w, http.StatusBadRequest, SendResult{OK: false, Error: "session_id and prompt required"})
		return
	}
	if err := s.onSend(req); err != nil {
		writeJSON(w, http.StatusInternalServerError, SendResult{OK: false, Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, SendResult{OK: true})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
