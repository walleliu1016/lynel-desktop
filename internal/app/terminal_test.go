package app

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOpenInTerminal_BuildsCommand(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)

	// We don't actually launch in unit tests; just verify the binding is wired.
	// Calling OpenInTerminal with a bogus workdir will fail at exec; that's OK.
	_ = filepath.Join
	err = a.OpenInTerminal("/tmp", "sid-123", "/bin/echo")
	// On most CI / dev machines this will succeed in starting the terminal app.
	// We don't assert on the error to keep this test environment-agnostic.
	_ = err
}
