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
