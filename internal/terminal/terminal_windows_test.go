//go:build windows

package terminal

import (
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildArgs_WindowsUsesWTOrStart(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows only")
	}
	l := &Launcher{}
	args := l.buildArgs(`G:\work\ease-ui`, `"C:\Users\akke\AppData\Roaming\npm\claude.cmd" --resume sid-123`, "")

	require.NotEmpty(t, args)
	switch args[0] {
	case "wt":
		assert.Equal(t, "-w", args[1])
		assert.Equal(t, "0", args[2])
		assert.Equal(t, "nt", args[3])
		assert.Equal(t, "--title", args[4])
		assert.Equal(t, "Claude", args[5])
		assert.Equal(t, "--startingDirectory", args[6])
		assert.Equal(t, `G:\work\ease-ui`, args[7])
		assert.Equal(t, `C:\Users\akke\AppData\Roaming\npm\claude.cmd`, args[8])
		assert.Equal(t, "--resume", args[9])
		assert.Equal(t, "sid-123", args[10])
	case "cmd":
		assert.Equal(t, "/c", args[1])
		assert.Equal(t, "start", args[2])
		assert.Equal(t, `"Claude"`, args[3])
		assert.Equal(t, "/D", args[4])
		assert.Equal(t, `G:\work\ease-ui`, args[5])
		assert.Equal(t, `C:\Users\akke\AppData\Roaming\npm\claude.cmd`, args[6])
		assert.Equal(t, "--resume", args[7])
		assert.Equal(t, "sid-123", args[8])
	default:
		t.Fatalf("unexpected launcher %q", args[0])
	}
}

func TestBuildArgs_TrailingBackslashRemoved(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows only")
	}
	l := &Launcher{}
	args := l.buildArgs(`C:\work\ease-ui\`, `"C:\claude\claude.cmd" --resume sid`, "")

	var workDir string
	if args[0] == "cmd" {
		workDir = args[5]
	} else {
		workDir = args[7]
	}
	assert.Equal(t, `C:\work\ease-ui`, workDir)
}

func TestBuildArgs_RootDirKept(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows only")
	}
	l := &Launcher{}
	args := l.buildArgs(`C:\`, `"C:\claude\claude.cmd" --resume sid`, "")

	var workDir string
	if args[0] == "cmd" {
		workDir = args[5]
	} else {
		workDir = args[7]
	}
	assert.Equal(t, `C:\`, workDir)
}

func TestNewExecCmd_StartUsesRawCmdLine(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows only")
	}
	args := []string{"cmd", "/c", "start", `"Claude"`, "/D", `G:\work dir`, `C:\Program Files\claude.cmd`, "--resume", "sid-123"}
	cmd := newExecCmd(args, `G:\work`)

	require.NotNil(t, cmd.SysProcAttr)
	assert.True(t, cmd.SysProcAttr.HideWindow, "intermediate cmd window should be hidden")
	cmdLine := cmd.SysProcAttr.CmdLine
	require.NotEmpty(t, cmdLine)
	// title 必须原生带引号，不应被 Go 转义成 \"Claude\"
	assert.Contains(t, cmdLine, `start "Claude"`)
	// 带空格的路径需要加引号
	assert.Contains(t, cmdLine, `/D "G:\work dir"`)
	assert.Contains(t, cmdLine, `"C:\Program Files\claude.cmd"`)
	// flag 和 sid 不加引号，避免 start 把整段当命令名
	assert.Contains(t, cmdLine, `--resume sid-123`)
	assert.NotContains(t, cmdLine, `\"Claude\"`)
}

func TestBuildArgs_ResolvesBareClaude(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows only")
	}
	l := &Launcher{}
	args := l.buildArgs(`C:\wd`, `"claude" --resume sid`, "")

	var binPath string
	if args[0] == "cmd" {
		binPath = args[6]
	} else {
		binPath = args[8]
	}
	assert.NotEqual(t, "claude", binPath)
	assert.True(t, strings.HasSuffix(strings.ToLower(binPath), "claude.cmd") || strings.HasSuffix(strings.ToLower(binPath), "claude.exe"),
		"resolved path should point to claude binary, got %s", binPath)
}
