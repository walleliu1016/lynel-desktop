package process

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStart_FailsOnMissingBinary(t *testing.T) {
	p, err := Start(t.TempDir(), "sid-1", "/nonexistent/binary", ModeNew)
	assert.Error(t, err)
	assert.Nil(t, p)
}

func TestStart_EchoBinaryStreamsEvents(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix shell echo only")
	}
	// Use /bin/cat: it reads stdin and echoes to stdout, so we can
	// verify the write->events round-trip end-to-end.
	p, err := Start(t.TempDir(), "sid", "/bin/cat", ModeNew)
	require.NoError(t, err)
	defer p.Close()

	require.NoError(t, p.Write("hello\n"))

	select {
	case ev, ok := <-p.Events():
		require.True(t, ok)
		assert.Contains(t, string(ev), "hello")
	case <-time.After(2 * time.Second):
		t.Fatal("timeout")
	}
}

func TestProcess_CloseTerminates(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix shell only")
	}
	p, err := Start(t.TempDir(), "sid", "/bin/cat", ModeNew)
	require.NoError(t, err)

	require.NoError(t, p.Close())
	_ = p.Close()
}

// TestStart_StderrLogInTempDir 验证 process.Start 没有把 stderr 日志写到
// Unix-only 的 /tmp，而是使用 os.TempDir()。该测试在 Windows 上尤为关键。
func TestStart_StderrLogInTempDir(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows only")
	}

	// 清理旧的 ease stderr 日志，避免干扰最新文件查找。
	matches, _ := filepath.Glob(filepath.Join(os.TempDir(), "claude-stderr-ease-*.log"))
	for _, m := range matches {
		_ = os.Remove(m)
	}

	// 用 cmd 作为显式二进制（非 claude），args 为空，启动后立刻关闭。
	p, err := Start(t.TempDir(), "sid", "cmd", ModeNew)
	require.NoError(t, err)
	defer p.Close()

	// 等待 stderr 文件创建（os.Create 是同步的，但留一点缓冲）。
	time.Sleep(50 * time.Millisecond)

	matches, _ = filepath.Glob(filepath.Join(os.TempDir(), "claude-stderr-ease-*.log"))
	require.NotEmpty(t, matches, "stderr log should be created under os.TempDir()")

	latest := matches[0]
	for _, m := range matches[1:] {
		if strings.Compare(m, latest) > 0 {
			latest = m
		}
	}
	assert.True(t, strings.HasPrefix(latest, os.TempDir()),
		"stderr log %q should be under TempDir %q", latest, os.TempDir())
	assert.False(t, strings.Contains(latest, "/tmp/"),
		"stderr log must not contain hard-coded /tmp/ path")
}
