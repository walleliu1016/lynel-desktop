package terminal

import (
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResumeCommand_ContainsSessionID(t *testing.T) {
	cmd := ResumeCommand("sess-abc", "claude")
	assert.Contains(t, cmd, "sess-abc")
	assert.Contains(t, cmd, "claude")
}

func TestLauncher_BuildsPlatformCommand(t *testing.T) {
	l := &Launcher{}
	args := l.buildArgs("/tmp", "echo hello")
	require.NotEmpty(t, args)
	switch runtime.GOOS {
	case "darwin":
		assert.Equal(t, "osascript", args[0])
	case "linux":
		assert.True(t, args[0] == "gnome-terminal" || args[0] == "xterm" || args[0] == "x-terminal-emulator")
	case "windows":
		assert.Equal(t, "cmd", args[0])
	}
}

func TestLauncher_RunsWithoutError(t *testing.T) {
	if testing.Short() {
		t.Skip("skip in short mode")
	}
	// This is a smoke test that just builds the command but doesn't actually launch
	l := &Launcher{}
	args := l.buildArgs(t.TempDir(), "true")
	assert.NotEmpty(t, args)
}
