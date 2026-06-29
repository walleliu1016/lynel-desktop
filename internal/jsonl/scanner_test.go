package jsonl

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScanAll_FindsJsonlFiles(t *testing.T) {
	root := t.TempDir()
	projDir := filepath.Join(root, "projects", "proj1")
	require.NoError(t, os.MkdirAll(projDir, 0o755))

	mustWrite(t, filepath.Join(projDir, "abc.jsonl"), `{"type":"user","message":{"role":"user","content":"hi"}}`)
	mustWrite(t, filepath.Join(projDir, "def.jsonl"), `{"type":"user","message":{"role":"user","content":"yo"}}`)

	SetRoot(filepath.Join(root, "projects"))
	metas, err := ScanAll()
	require.NoError(t, err)
	assert.Len(t, metas, 2)
}

func TestDecodeProjectDirName_WindowsAndUnix(t *testing.T) {
	// Unix paths decode cleanly.
	assert.Equal(t, `/Users/akke/foo`, decodeProjectDirName("-Users-akke-foo"))
	// Windows paths are best-effort: the encoder collapses dots/underscores
	// and dashes, so directory names like "ease-ui" cannot be perfectly
	// distinguished from separators. ScanAll uses the cwd field from jsonl
	// when available.
	assert.Equal(t, `C:\Users\bruceliu`, decodeProjectDirName("C--Users-bruceliu"))
	assert.Equal(t, `G:\work\ease\ui`, decodeProjectDirName("G--work-ease-ui"))
}

func TestScanAll_UsesCwdFromJsonl(t *testing.T) {
	root := t.TempDir()
	projDir := filepath.Join(root, "projects", "G--work-ease-ui")
	require.NoError(t, os.MkdirAll(projDir, 0o755))

	jsonl := `{"type":"attachment","cwd":"G:\\work\\ease-ui","sessionId":"s1"}
{"type":"user","message":{"role":"user","content":"hello"}}
`
	require.NoError(t, os.WriteFile(filepath.Join(projDir, "s1.jsonl"), []byte(jsonl), 0o644))

	SetRoot(filepath.Join(root, "projects"))
	metas, err := ScanAll()
	require.NoError(t, err)
	require.Len(t, metas, 1)
	assert.Equal(t, `G:\work\ease-ui`, metas[0].WorkDir)
	assert.Equal(t, "hello", metas[0].FirstPrompt)
}

func TestScanAll_EmptyDirReturnsEmpty(t *testing.T) {
	root := t.TempDir()
	SetRoot(filepath.Join(root, "projects"))

	metas, err := ScanAll()
	require.NoError(t, err)
	assert.Empty(t, metas)
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
	require.NoError(t, os.WriteFile(path, []byte(content), 0o644))
}
