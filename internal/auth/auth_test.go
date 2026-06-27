package auth

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSetAndVerify(t *testing.T) {
	dir := t.TempDir()
	SetPath(filepath.Join(dir, "auth.json"))

	a, err := New()
	require.NoError(t, err)
	require.NoError(t, a.SetPassword("hunter2"))

	assert.NoError(t, a.Verify("hunter2"))
	assert.Error(t, a.Verify("wrong"))
}

func TestLockoutAfter3Failures(t *testing.T) {
	dir := t.TempDir()
	SetPath(filepath.Join(dir, "auth.json"))

	a, err := New()
	require.NoError(t, err)
	require.NoError(t, a.SetPassword("hunter2"))

	for i := 0; i < 3; i++ {
		_ = a.Verify("wrong")
	}

	err = a.Verify("hunter2")
	assert.ErrorIs(t, err, ErrLocked)

	attempts, until := a.LockoutState()
	assert.Equal(t, 3, attempts)
	assert.True(t, until.After(time.Now()))
}

func TestResetAttempts_OnSuccess(t *testing.T) {
	dir := t.TempDir()
	SetPath(filepath.Join(dir, "auth.json"))

	a, err := New()
	require.NoError(t, err)
	require.NoError(t, a.SetPassword("hunter2"))

	_ = a.Verify("wrong")
	_ = a.Verify("wrong")
	require.NoError(t, a.Verify("hunter2"))

	attempts, _ := a.LockoutState()
	assert.Equal(t, 0, attempts)
}

func TestExists_TrueAfterSet(t *testing.T) {
	dir := t.TempDir()
	SetPath(filepath.Join(dir, "auth.json"))

	assert.False(t, Exists())

	a, err := New()
	require.NoError(t, err)
	require.NoError(t, a.SetPassword("hunter2"))

	assert.True(t, Exists())
}
