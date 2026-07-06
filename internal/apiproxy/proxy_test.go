package apiproxy

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProxy_ForwardAndCapture(t *testing.T) {
	// upstream simulates Anthropic's streaming Messages API.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v1/messages", r.URL.Path)

		body, _ := io.ReadAll(r.Body)
		var req AnthropicRequestBody
		require.NoError(t, json.Unmarshal(body, &req))
		require.Equal(t, "claude-sonnet-4-6", req.Model)

		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		lines := []string{
			`data: {"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":10}}}`,
			`data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
			`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}`,
			`data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}`,
		}
		for _, line := range lines {
			_, _ = w.Write([]byte(line + "\n"))
			flusher.Flush()
		}
	}))
	defer upstream.Close()

	dir := t.TempDir()
	store := NewStore(dir)
	provider := Provider{Name: "claude", EnvVar: "ANTHROPIC_BASE_URL", Upstream: upstream.URL, Format: "anthropic"}
	proxy := NewProxy(provider, store, "sid-1", "/work/proj")
	port, err := proxy.Start()
	require.NoError(t, err)
	defer proxy.Stop()

	reqBody := `{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"hi"}],"tools":[{"name":"Read","input_schema":{}}],"stream":true}`
	resp, err := http.Post("http://127.0.0.1:"+strconv.Itoa(port)+"/v1/messages", "application/json", strings.NewReader(reqBody))
	require.NoError(t, err)
	defer resp.Body.Close()

	// Consume the full SSE stream so the proxy can finish capturing.
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.NotEmpty(t, body)

	// Wait briefly for the response goroutine to persist phases.
	time.Sleep(200 * time.Millisecond)

	phases, err := store.ListPhases("sid-1", "/work/proj")
	require.NoError(t, err)
	require.Len(t, phases, 2)

	assert.Equal(t, KindPrompt, phases[0].Kind)
	assert.Equal(t, "hi", phases[0].Prompt)
	assert.Equal(t, []string{"Read"}, phases[0].Tools)

	assert.Equal(t, KindText, phases[1].Kind)
	assert.Equal(t, "hello", phases[1].Text)
	assert.Equal(t, "end_turn", phases[1].StopReason)
	require.NotNil(t, phases[1].Usage)
	assert.Equal(t, 10, phases[1].Usage.InputTokens)
	assert.Equal(t, 5, phases[1].Usage.OutputTokens)
}

func TestProxy_ToolUseAndResult(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		lines := []string{
			`data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu-1","name":"Read","input":{}}}`,
			`data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"file_path\": \"/tmp/foo\"}"}}`,
		}
		for _, line := range lines {
			_, _ = w.Write([]byte(line + "\n"))
			flusher.Flush()
		}
	}))
	defer upstream.Close()

	dir := t.TempDir()
	store := NewStore(dir)
	provider := Provider{Name: "claude", EnvVar: "ANTHROPIC_BASE_URL", Upstream: upstream.URL, Format: "anthropic"}
	proxy := NewProxy(provider, store, "sid-1", "/work/proj")
	port, err := proxy.Start()
	require.NoError(t, err)
	defer proxy.Stop()

	// First request: prompt that triggers tool_use.
	req1 := `{"model":"m","messages":[{"role":"user","content":"read"}],"stream":true}`
	resp1, err := http.Post("http://127.0.0.1:"+strconv.Itoa(port)+"/v1/messages", "application/json", strings.NewReader(req1))
	require.NoError(t, err)
	io.Copy(io.Discard, resp1.Body)
	resp1.Body.Close()
	time.Sleep(100 * time.Millisecond)

	// Second request: carries tool_result.
	req2 := `{"model":"m","messages":[{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu-1","content":"file data"}]}],"stream":true}`
	resp2, err := http.Post("http://127.0.0.1:"+strconv.Itoa(port)+"/v1/messages", "application/json", strings.NewReader(req2))
	require.NoError(t, err)
	io.Copy(io.Discard, resp2.Body)
	resp2.Body.Close()
	time.Sleep(100 * time.Millisecond)

	phases, err := store.ListPhases("sid-1", "/work/proj")
	require.NoError(t, err)
	require.Len(t, phases, 4)

	assert.Equal(t, KindPrompt, phases[0].Kind)
	assert.Equal(t, KindToolUse, phases[1].Kind)
	assert.Equal(t, "tu-1", phases[1].ToolUseID)
	assert.Equal(t, 1, phases[1].Turn)

	assert.Equal(t, KindToolResult, phases[2].Kind)
	assert.Equal(t, "tu-1", phases[2].ToolUseID)
	assert.Equal(t, 1, phases[2].Turn)
	assert.Equal(t, "file data", phases[2].Output)

	assert.Equal(t, KindToolUse, phases[3].Kind)
	assert.Equal(t, "tu-1", phases[3].ToolUseID)
	assert.Equal(t, 1, phases[3].Turn)
}
