package apiproxy

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStore_WritePrompt(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)

	p := s.WritePrompt("sid-1", "/work/proj", "call-1", "claude", "claude-sonnet-4-6", "hello", []string{"Read"})
	assert.Equal(t, KindPrompt, p.Kind)
	assert.Equal(t, int64(1), p.Seq)
	assert.Equal(t, 1, p.Turn)
	assert.Equal(t, "hello", p.Prompt)

	phases, err := s.ListPhases("sid-1", "/work/proj")
	require.NoError(t, err)
	require.Len(t, phases, 1)
	assert.Equal(t, "hello", phases[0].Prompt)

	// Second prompt in same session increments turn.
	p2 := s.WritePrompt("sid-1", "/work/proj", "call-2", "claude", "claude-sonnet-4-6", "again", nil)
	assert.Equal(t, int64(2), p2.Seq)
	assert.Equal(t, 2, p2.Turn)
}

func TestStore_SeqSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	s1 := NewStore(dir)
	s1.WritePrompt("sid-1", "/work/proj", "call-1", "claude", "model", "hi", nil)

	s2 := NewStore(dir)
	p := s2.WritePrompt("sid-1", "/work/proj", "call-2", "claude", "model", "ho", nil)
	assert.Equal(t, int64(2), p.Seq)
}

func TestStore_WriteResponse(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	s.WritePrompt("sid-1", "/work/proj", "call-1", "claude", "model", "hi", nil)

	resp := ResponseSummary{
		Model:      "model",
		StopReason: "tool_use",
		Content: []ContentBlock{
			{Type: "text", Text: "ok"},
			{Type: "tool_use", ToolUseID: "tu-1", Name: "Read", Input: json.RawMessage(`{"file_path":"/tmp/foo"}`)},
		},
	}
	phases := s.WriteResponse("sid-1", "/work/proj", "call-1", "claude", "model", resp)
	require.Len(t, phases, 2)
	assert.Equal(t, KindText, phases[0].Kind)
	assert.Equal(t, "ok", phases[0].Text)
	assert.Equal(t, KindToolUse, phases[1].Kind)
	assert.Equal(t, "tu-1", phases[1].ToolUseID)
	assert.Equal(t, 1, phases[1].Turn)
}

func TestStore_ToolResultInheritsTurn(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)

	// Turn 1: prompt -> text -> tool_use.
	s.WritePrompt("sid-1", "/work/proj", "call-1", "claude", "model", "read it", nil)
	s.WriteResponse("sid-1", "/work/proj", "call-1", "claude", "model", ResponseSummary{
		Content: []ContentBlock{
			{Type: "tool_use", ToolUseID: "tu-1", Name: "Read", Input: json.RawMessage(`{"file_path":"/tmp/foo"}`)},
		},
	})

	// Next request carries tool_result. Turn should remain 1.
	results := []ToolResultPhase{{ToolUseID: "tu-1", Output: "file content"}}
	trs := s.WriteToolResults("sid-1", "/work/proj", "call-2", "claude", results)
	require.Len(t, trs, 1)
	assert.Equal(t, KindToolResult, trs[0].Kind)
	assert.Equal(t, 1, trs[0].Turn)
	assert.Equal(t, "file content", trs[0].Output)

	// After tool_result, a new text prompt starts turn 2.
	p := s.WritePrompt("sid-1", "/work/proj", "call-3", "claude", "model", "next", nil)
	assert.Equal(t, 2, p.Turn)
}

func TestStore_Subscribe(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)

	ch, cancel := s.Subscribe("sid-1")
	defer cancel()

	done := make(chan struct{})
	var received Phase
	go func() {
		received = <-ch
		close(done)
	}()

	s.WritePrompt("sid-1", "/work/proj", "call-1", "claude", "model", "hi", nil)

	select {
	case <-done:
		assert.Equal(t, KindPrompt, received.Kind)
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for SSE phase")
	}
}

func TestStore_GetPhase(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	p := s.WritePrompt("sid-1", "/work/proj", "call-1", "claude", "model", "hi", nil)

	got, err := s.GetPhase(p.Seq)
	require.NoError(t, err)
	assert.Equal(t, p.Prompt, got.Prompt)

	_, err = s.GetPhase(999)
	assert.Error(t, err)
}

func TestStore_ListPhasesMissingFile(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	phases, err := s.ListPhases("sid-x", "/work/proj")
	require.NoError(t, err)
	assert.Nil(t, phases)
}

func TestEncodeProjectDirName(t *testing.T) {
	assert.Equal(t, "C--work-proj", encodeProjectDirName(`C:\work\proj`))
	assert.Equal(t, "-work-proj", encodeProjectDirName("/work/proj"))
}

func TestStore_AppendCreatesDirectories(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	s.WritePrompt("sid-1", "/work/proj", "call-1", "claude", "model", "hi", nil)

	path := filepath.Join(dir, encodeProjectDirName("/work/proj"), "sid-1-calls.jsonl")
	_, err := os.Stat(path)
	require.NoError(t, err)
}
