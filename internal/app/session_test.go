package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestListSessions_EmptyWhenNoFiles(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{
		ConfigDir: dir,
		ClaudeDir: filepath.Join(dir, ".claude"),
	})
	require.NoError(t, err)

	sessions, err := a.ListSessions()
	require.NoError(t, err)
	assert.Empty(t, sessions)
}

func TestCreateSession_StartsProcess(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)
	a.SetClaudeBinary("/bin/echo")

	id, err := a.CreateSession("/tmp", "hi")
	if err != nil {
		// On CI / Windows, /bin/echo may not exist; skip
		t.Skipf("cannot start process: %v", err)
	}
	assert.NotEmpty(t, id)
}

func TestRespondPermission_UnknownIDReturnsError(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)

	err = a.RespondPermission("nope", "x", true)
	assert.Error(t, err)
}

func TestAdoptSession_RegistersAndStarts(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)

	// AdoptSession 只注册 session 到 a.sessions，不启动进程。
	// 进程在 SendMessage 时懒启动。
	sid := "abcd1234abcd1234"
	if err := a.AdoptSession(sid, "/tmp"); err != nil {
		t.Fatalf("AdoptSession failed: %v", err)
	}

	s, ok := a.lookupSession(sid)
	require.True(t, ok, "AdoptSession should register the session in a.sessions")
	assert.Equal(t, sid, s.ID)
	assert.Equal(t, "/tmp", s.WorkDir)
}

func TestAdoptSession_IdempotentNoop(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)

	sid := "abcd1234abcd1234"
	require.NoError(t, a.AdoptSession(sid, "/tmp"))
	s1, _ := a.lookupSession(sid)
	require.NotNil(t, s1, "AdoptSession must register the session")

	// 第二次调用：session 已注册，幂等 noop（不报错）
	require.NoError(t, a.AdoptSession(sid, "/tmp"))
	s2, _ := a.lookupSession(sid)
	require.NotNil(t, s2, "session must still be registered after second AdoptSession")
}

func TestAdoptSession_RejectsEmptyArgs(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)

	err = a.AdoptSession("", "/tmp")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "required")

	err = a.AdoptSession("sid", "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "required")
}

func TestEncodeProjectDirName_WindowsPaths(t *testing.T) {
	assert.Equal(t, "C--Users-bruceliu", encodeProjectDirName(`C:\Users\bruceliu`))
	assert.Equal(t, "G--work-ease-ui", encodeProjectDirName(`G:\work\ease-ui`))
	assert.Equal(t, "C--Users-bruceliu-paperclip-instances-default", encodeProjectDirName(`C:\Users\bruceliu\paperclip\instances\default`))
	assert.Equal(t, "C--Users-bruceliu--paperclip-instances-default-projects-518ec6f4-9886-4264-b7bf-d3b4da2ba88b-cd57ec54-4a70-4e95-b555-31d0d50d29ff--default",
		encodeProjectDirName(`C:\Users\bruceliu\.paperclip\instances\default\projects\518ec6f4-9886-4264-b7bf-d3b4da2ba88b\cd57ec54-4a70-4e95-b555-31d0d50d29ff\_default`))
	// Unix paths keep working
	assert.Equal(t, "-Users-akke-foo", encodeProjectDirName("/Users/akke/foo"))
}

func TestAdoptSession_ResumesEndedSession(t *testing.T) {
	// 历史 session 的 jsonl 末尾有 /exit 标记时，AdoptSession 不应拒绝。
	// PTY 模式下走懒注册，进程在 SendMessage 时启动。
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	a, err := New(Options{
		ConfigDir: dir,
		ClaudeDir: claudeDir,
	})
	require.NoError(t, err)

	sid := "11111111-2222-3333-4444-555555555555"
	projectDir := filepath.Join(claudeDir, "projects", "-tmp")
	require.NoError(t, os.MkdirAll(projectDir, 0o755))
	endedJSONL := `{"type":"user","message":{"role":"user","content":"hi"}}
{"type":"assistant","message":{"role":"assistant","content":"hello"}}
{"type":"user","message":{"role":"user","content":"<command-name>/exit</command-name>"}}
{"type":"user","message":{"role":"user","content":"<local-command-stdout>Bye!</local-command-stdout>"}}
`
	require.NoError(t, os.WriteFile(
		filepath.Join(projectDir, sid+".jsonl"),
		[]byte(endedJSONL), 0o644))

	if err := a.AdoptSession(sid, "/tmp"); err != nil {
		t.Fatalf("AdoptSession failed: %v", err)
	}
	// ended session 应当被 adopt 进 a.sessions（懒注册，进程在 SendMessage 时启动）
	_, ok := a.lookupSession(sid)
	require.True(t, ok, "AdoptSession must register ended session for resume")
}

func TestWriteTerminalInput_LazyStart(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)
	a.SetClaudeBinary("/bin/echo")

	sid := "abcd1234abcd1234"
	require.NoError(t, a.AdoptSession(sid, "/tmp"))

	// WriteTerminalInput 应该懒启动 PTY 进程并写入数据
	err = a.WriteTerminalInput(sid, "hello\n")
	if err != nil {
		t.Skipf("cannot start process: %v", err)
	}
	// 进程已启动
	s, ok := a.lookupSession(sid)
	require.True(t, ok)
	assert.NotNil(t, s.GetProcessForTest())
}

func TestResizeTerminal_NoProcIsNoop(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)

	sid := "abcd1234abcd1234"
	require.NoError(t, a.AdoptSession(sid, "/tmp"))

	// 没有进程时 ResizeTerminal 应不报错
	err = a.ResizeTerminal(sid, 80, 24)
	assert.NoError(t, err)
}

func TestAdoptSession_EmptyID(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)
	err = a.AdoptSession("", "/tmp")
	require.Error(t, err)
}

func TestAdoptSession_EmptyWorkDir(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)
	err = a.AdoptSession("sid", "")
	require.Error(t, err)
}

// keep strings import used by TestEncodeProjectDirName_WindowsPaths
var _ = strings.TrimSpace
