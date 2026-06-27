package app

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestListSessions_EmptyWhenNoFiles(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{
		ConfigDir: dir,
		ClaudeDir: filepath.Join(dir, ".claude"),
	})
	require.NoError(t, err)

	sessions, err := a.ListSessions()
	require.NoError(t, err)
	assert.Empty(t, sessions)
}

func TestCreateSession_StartsProcess(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)
	a.SetClaudeBinary("/bin/echo")

	id, err := a.CreateSession("/tmp", "hi")
	if err != nil {
		// On CI / Windows, /bin/echo may not exist; skip
		t.Skipf("cannot start process: %v", err)
	}
	assert.NotEmpty(t, id)
}

func TestRespondPermission_UnknownIDReturnsError(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)

	err = a.RespondPermission("nope", "x", true)
	assert.Error(t, err)
}
