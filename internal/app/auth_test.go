package app

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAuthApp_VerifyAndLockout(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{
		AuthPath:  filepath.Join(dir, "auth.json"),
		ConfigDir: dir,
	})
	require.NoError(t, err)

	require.NoError(t, a.SetPassword("hunter2"))

	assert.True(t, a.IsInitialized())
	assert.NoError(t, a.Verify("hunter2"))
	assert.Error(t, a.Verify("wrong"))
}

func TestAuthApp_NotInitializedReturnsFalse(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)
	assert.False(t, a.IsInitialized())
}

func TestAuthApp_LockoutState(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)
	require.NoError(t, a.SetPassword("hunter2"))

	_ = a.Verify("wrong")
	_ = a.Verify("wrong")

	attempts, _ := a.LockoutState()
	assert.Equal(t, 2, attempts)
}
