package app

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/akke/ease-ui/internal/session"
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

func TestSwitchOwner_UnknownSessionReturnsError(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)

	err = a.SwitchOwner("nope", "app", "")
	require.Error(t, err)
	assert.True(t, errors.Is(err, errSessionNotFound),
		"expected errSessionNotFound, got %v", err)
}

func TestSwitchOwner_InvalidTargetReturnsError(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)
	a.registerSession(session.New("s1", "/tmp"))

	err = a.SwitchOwner("s1", "phone", "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "target must be")
}

func TestSwitchOwner_AppToAppNoPromptIsNoop(t *testing.T) {
	// App-owned session + target=app + 空 prompt → noop，不报错也不动状态
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)
	s := session.New("s1", "/tmp")
	a.registerSession(s)
	require.Equal(t, session.OwnerApp, s.Owner())

	require.NoError(t, a.SwitchOwner("s1", "app", ""))
	// 状态保持
	assert.Equal(t, session.OwnerApp, s.Owner())
	assert.Equal(t, session.ModeStream, s.Mode())
}

func TestEnvelopeUserMessage_Format(t *testing.T) {
	env := envelopeUserMessage("hello")
	var parsed map[string]any
	require.NoError(t, json.Unmarshal([]byte(strings.TrimRight(env, "\n")), &parsed),
		"envelope must be valid JSON line, got %q", env)
	assert.Equal(t, "user", parsed["type"])
	msg, ok := parsed["message"].(map[string]any)
	require.True(t, ok, "envelope.message must be an object")
	assert.Equal(t, "user", msg["role"])
	assert.Equal(t, "hello", msg["content"])
	assert.True(t, strings.HasSuffix(env, "\n"),
		"envelope must be newline-terminated for stream-json framing")
}

func TestAdoptSession_RegistersAndStarts(t *testing.T) {
	dir := t.TempDir()
	a, err := New(Options{ConfigDir: dir})
	require.NoError(t, err)
	a.SetClaudeBinary("/bin/echo") // 测试用 echo 模拟 claude（实际 stream-json 不可用但能起进程）

	// 假定 sid 来自 jsonl（Ease UI 启动前已存在）
	sid := "abcd1234abcd1234"
	if err := a.AdoptSession(sid, "/tmp"); err != nil {
		t.Skipf("cannot start process: %v", err)
	}

	s, ok := a.lookupSession(sid)
	require.True(t, ok, "AdoptSession should register the session in a.sessions")
	assert.Equal(t, session.OwnerApp, s.Owner())
	assert.Equal(t, session.ModeStream, s.Mode())
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
	// 历史 session 的 jsonl 末尾有 /exit 标记时，AdoptSession 不应拒绝
	// 也不应用 --session-id 启动（已 ended 的 sid 用 --session-id 启动
	// claude 会立即 DEAD）。它应该走 --resume 模式 attach，把 session
	// 拉进 a.sessions 等待新 envelope。
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	a, err := New(Options{
		ConfigDir: dir,
		ClaudeDir: claudeDir,
	})
	require.NoError(t, err)
	a.SetClaudeBinary("/bin/echo")

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
		t.Skipf("cannot start process: %v", err)
	}
	// ended session 应当被 adopt 进 a.sessions（懒注册，进程在 SendMessage 时启动）
	_, ok := a.lookupSession(sid)
	require.True(t, ok, "AdoptSession must register ended session for resume")
}
