package log

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNew_CreatesLogsDir(t *testing.T) {
	dir := t.TempDir()
	_, err := New(filepath.Join(dir, "logs"), "test")
	require.NoError(t, err)

	_, err = os.Stat(filepath.Join(dir, "logs"))
	assert.NoError(t, err)
}

func TestLogger_InfoWritesToFile(t *testing.T) {
	dir := t.TempDir()
	lg, err := New(dir, "test")
	require.NoError(t, err)
	defer lg.Close()

	lg.Info("hello")

	data, err := os.ReadFile(filepath.Join(dir, "info.log"))
	require.NoError(t, err)
	assert.Contains(t, string(data), "hello")
}

func TestLogger_LevelFilter(t *testing.T) {
	dir := t.TempDir()
	lg, err := New(dir, "test")
	require.NoError(t, err)
	defer lg.Close()

	lg.Debug("debug-msg")
	lg.Info("info-msg")
	lg.Warn("warn-msg")
	lg.Error("err-msg")

	infoData, _ := os.ReadFile(filepath.Join(dir, "info.log"))
	warnData, _ := os.ReadFile(filepath.Join(dir, "warn.log"))
	errData, _ := os.ReadFile(filepath.Join(dir, "error.log"))

	assert.NotContains(t, string(infoData), "debug-msg")
	assert.Contains(t, string(infoData), "info-msg")
	assert.Contains(t, string(warnData), "warn-msg")
	assert.Contains(t, string(errData), "err-msg")
}
