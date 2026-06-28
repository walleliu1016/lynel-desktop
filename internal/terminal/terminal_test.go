package terminal

import (
	"runtime"
	"strings"
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
	args := l.buildArgs("/tmp", "echo hello", "/tmp/ease-ui-test.pid")
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
	args := l.buildArgs(t.TempDir(), "true", "/tmp/ease-ui-test.pid")
	assert.NotEmpty(t, args)
}

func TestPidfilePath_StableForSessionID(t *testing.T) {
	p1 := PidfilePath("sess-abc")
	p2 := PidfilePath("sess-abc")
	p3 := PidfilePath("sess-xyz")
	assert.Equal(t, p1, p2, "same session id should produce same path")
	assert.NotEqual(t, p1, p3, "different session id should produce different path")
	assert.True(t, strings.HasSuffix(p1, "ease-ui-sess-abc.pid"),
		"pidfile should embed session id, got %s", p1)
}

func TestLauncher_LastPIDFileAfterBuildArgs(t *testing.T) {
	// buildArgs 内部可能因没找到终端而走 fallback，验证 PidfilePath
	// 生成逻辑独立于 buildArgs 的实现。
	l := &Launcher{}
	pidfile := PidfilePath("sid-1")
	l.buildArgs("/tmp", "true", pidfile)
	// buildArgs 不修改 lastPIDFile（那是 Launch 的职责），保持空。
	assert.Empty(t, l.LastPIDFile(), "buildArgs alone should not record pidfile")
}
