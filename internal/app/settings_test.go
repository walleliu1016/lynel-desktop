package app

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetSettings_Default(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)

	cfg, err := a.GetSettings()
	require.NoError(t, err)
	assert.Equal(t, "dark-pro", cfg.Theme)
}

func TestUpdateSettings_Persists(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)

	cfg, err := a.GetSettings()
	require.NoError(t, err)
	cfg.AutoAllowBash = true
	require.NoError(t, a.UpdateSettings(cfg))

	cfg2, _ := a.GetSettings()
	assert.True(t, cfg2.AutoAllowBash)
}

func TestHooksApp_AddAndSave(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)

	cfg, err := a.GetHooksConfig()
	require.NoError(t, err)
	cfg.PreToolUse = []HookEntry{
		{Matcher: "Bash", Command: "echo hi", Type: "shell"},
	}
	require.NoError(t, a.SaveHooksConfig(cfg))

	loaded, _ := a.GetHooksConfig()
	require.Len(t, loaded.PreToolUse, 1)
	assert.Equal(t, "echo hi", loaded.PreToolUse[0].Command)
	assert.Equal(t, "shell", loaded.PreToolUse[0].Type)
	assert.Equal(t, "Bash", loaded.PreToolUse[0].Matcher)
}
