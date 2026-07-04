package settings

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConfig_Defaults(t *testing.T) {
	cfg := Default()
	assert.Equal(t, "oled-dark", cfg.Theme)
	assert.Equal(t, false, cfg.AutoAllowBash)
	assert.Equal(t, 5, cfg.AutoLockMinutes)
	assert.Equal(t, false, cfg.CloudServiceEnabled)
}

func TestSaveAndLoad_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	SetPath(filepath.Join(dir, "config.json"))

	cfg := Default()
	cfg.AutoAllowBash = true
	cfg.ClaudePath = "/usr/local/bin/claude"
	require.NoError(t, Save(cfg))

	got, err := Load()
	require.NoError(t, err)
	assert.Equal(t, true, got.AutoAllowBash)
	assert.Equal(t, "/usr/local/bin/claude", got.ClaudePath)
}

func TestLoad_MissingFileReturnsDefaults(t *testing.T) {
	dir := t.TempDir()
	SetPath(filepath.Join(dir, "missing.json"))

	cfg, err := Load()
	require.NoError(t, err)
	assert.Equal(t, "oled-dark", cfg.Theme)
}

func TestLoad_CorruptFileReturnsError(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	require.NoError(t, os.WriteFile(path, []byte("{not valid json"), 0o600))

	SetPath(path)
	_, err := Load()
	assert.Error(t, err)
}
