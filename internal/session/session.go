// Package session is the core domain object tying a jsonl file to a process.
package session

import (
	"errors"
	"sync"
)

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

	mu      sync.Mutex
	state   State
	proc    ProcessIface
	pending map[string]struct{}
}

func New(id, workDir string) *Session {
	return &Session{
		ID:      id,
		WorkDir: workDir,
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
}

func (s *Session) setProcess(p ProcessIface) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.proc = p
}

// Send delivers a prompt to the underlying process. Valid only in Idle or Running.
// Idle -> Running. In AwaitingPermission, returns ErrAwaitingPermission.
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
	prev := s.state
	s.state = StateRunning
	proc := s.proc
	s.mu.Unlock()

	if err := proc.Write(prompt + "\n"); err != nil {
		// revert
		s.setState(prev)
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
}

// RespondPermission answers a pending request and returns session to Running.
func (s *Session) RespondPermission(reqID string, allow bool) error {
	s.mu.Lock()
	if _, ok := s.pending[reqID]; !ok {
		s.mu.Unlock()
		return ErrUnknownRequest
	}
	delete(s.pending, reqID)
	proc := s.proc
	s.state = StateRunning
	s.mu.Unlock()

	if proc == nil {
		return ErrClosed
	}
	// In real impl this writes the response back to claude's stdin;
	// exact format depends on Claude CLI protocol.
	var response string
	if allow {
		response = "ALLOW\n"
	} else {
		response = "DENY\n"
	}
	return proc.Write(response)
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
	s.mu.Unlock()
	if proc == nil {
		return nil
	}
	return proc.Close()
}

// UnlockIfLocked / Locked helpers used by tests; keep tiny
func (s *Session) UnlockIfLocked() {}
