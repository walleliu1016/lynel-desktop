package session

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeProcess struct {
	written   []string
	mu        sync.Mutex
	writeErr  error
	closed    bool
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
	assert.Error(t, err)
}

func TestSession_SendWhileAwaitingDenied(t *testing.T) {
	s := &Session{ID: "s1", state: StateAwaitingPermission, pending: map[string]struct{}{"r1": {}}}
	fp := &fakeProcess{}
	s.setProcess(fp)

	err := s.Send("hi")
	assert.Error(t, err)
}

func TestSession_CloseStopsProcess(t *testing.T) {
	s := &Session{ID: "s1", state: StateRunning, pending: map[string]struct{}{}}
	fp := &fakeProcess{}
	s.setProcess(fp)

	require.NoError(t, s.Close())
	assert.True(t, fp.closed)
}
