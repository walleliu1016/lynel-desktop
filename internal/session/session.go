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
	// version increments on every mutation of state/proc/pending. It is used
	// by Send and RespondPermission to detect whether a concurrent goroutine
	// (e.g. one calling RegisterPermission or Close) has touched the session
	// while a Write was in flight, so a failed Write can roll back only when
	// it would not clobber a legitimate concurrent change.
	version uint64
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
	s.version++
}

func (s *Session) setProcess(p ProcessIface) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.proc = p
	s.version++
}

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

	if err := proc.Write(prompt + "\n"); err != nil {
		s.mu.Lock()
		if s.version == prevVersion+1 {
			// No concurrent mutation observed; safe to roll back.
			s.state = prevState
			s.version++
		}
		s.mu.Unlock()
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

// UnlockIfLocked / Locked helpers used by tests; keep tiny
func (s *Session) UnlockIfLocked() {}
