package session

import (
	"errors"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeProcess struct {
	written  []string
	mu       sync.Mutex
	writeErr error
	closed   bool
}

func (f *fakeProcess) Write(s string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.writeErr != nil {
		return f.writeErr
	}
	f.written = append(f.written, s)
	return nil
}

func (f *fakeProcess) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
	return nil
}

func TestSession_SendRequiresRunningOrIdle(t *testing.T) {
	s := &Session{ID: "s1", state: StateIdle, pending: map[string]struct{}{}}
	fp := &fakeProcess{}
	s.setProcess(fp)

	require.NoError(t, s.Send("hi"))
	assert.Equal(t, StateRunning, s.State())
	// PTY 模式：直接写裸文本 + 回车，不需要 stream-json envelope。
	assert.Equal(t, []string{"hi\r"}, fp.written)
}

func TestSession_SendKeepsExistingTrailingNewline(t *testing.T) {
	s := New("s1", "/tmp")
	fp := &fakeProcess{}
	s.setProcess(fp)

	require.NoError(t, s.Send("hi\n"))
	assert.Equal(t, []string{"hi\n"}, fp.written)
}

func TestSession_RespondPermission(t *testing.T) {
	s := &Session{ID: "s1", state: StateAwaitingPermission, pending: map[string]struct{}{"r1": {}}}
	fp := &fakeProcess{}
	s.setProcess(fp)

	require.NoError(t, s.RespondPermission("r1", true))
	assert.Equal(t, StateRunning, s.State())
}

func TestSession_RespondPermission_UnknownReqReturnsError(t *testing.T) {
	s := &Session{ID: "s1", state: StateAwaitingPermission, pending: map[string]struct{}{}}
	err := s.RespondPermission("unknown", true)
	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrUnknownRequest), "expected ErrUnknownRequest, got %v", err)
	// state must remain AwaitingPermission — no mutation should have happened.
	assert.Equal(t, StateAwaitingPermission, s.State())
	// pending must still be empty.
	assert.Empty(t, s.pending)
}

func TestSession_SendWhileAwaitingDenied(t *testing.T) {
	s := &Session{ID: "s1", state: StateAwaitingPermission, pending: map[string]struct{}{"r1": {}}}
	fp := &fakeProcess{}
	s.setProcess(fp)

	err := s.Send("hi")
	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrAwaitingPermission), "expected ErrAwaitingPermission, got %v", err)
	// state must remain AwaitingPermission — no mutation should have happened.
	assert.Equal(t, StateAwaitingPermission, s.State())
	// no data should have been written to the process.
	assert.Empty(t, fp.written)
}

func TestSession_CloseStopsProcess(t *testing.T) {
	s := &Session{ID: "s1", state: StateRunning, pending: map[string]struct{}{}}
	fp := &fakeProcess{}
	s.setProcess(fp)

	require.NoError(t, s.Close())
	assert.True(t, fp.closed)
}

func TestSession_SendWriteFailureDoesNotPersist(t *testing.T) {
	s := New("s1", "/tmp")
	fp := &fakeProcess{writeErr: errors.New("pipe broken")}
	s.setProcess(fp)

	err := s.Send("hi")
	require.Error(t, err)
	assert.EqualError(t, err, "pipe broken")
	// state must remain what it was (Idle) — no successful state transition.
	assert.Equal(t, StateIdle, s.State())
	// no data should have been appended to the write buffer.
	assert.Empty(t, fp.written)
}

func TestSession_NewInitializesState(t *testing.T) {
	s := New("s1", "/tmp")
	assert.Equal(t, StateIdle, s.State())
	require.NotNil(t, s.pending, "New must initialize pending map")
	// delete on a non-nil map must not panic.
	assert.NotPanics(t, func() {
		delete(s.pending, "anything")
	})
}
