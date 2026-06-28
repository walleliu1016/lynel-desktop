package process

import (
	"runtime"
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
