package hookserver

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHandleHook_PermissionRequest_BlocksAndReturnsDecision(t *testing.T) {
	srv := New()
	port, err := srv.Start()
	require.NoError(t, err)
	defer srv.listener.Close()

	called := make(chan HookEvent, 1)
	srv.OnPermissionRequest(func(evt HookEvent) (any, error) {
		called <- evt
		return map[string]any{
			"hookSpecificOutput": map[string]any{
				"hookEventName": "PermissionRequest",
				"decision": map[string]any{
					"behavior": "allow",
				},
			},
		}, nil
	})

	body, _ := json.Marshal(map[string]any{
		"hook_event_name": "PermissionRequest",
		"session_id":      "550e8400-e29b-41d4-a716-446655440000",
		"tool_name":       "Bash",
		"tool_input":      map[string]any{"command": "echo hi"},
	})

	resp, err := http.Post("http://127.0.0.1:"+strconv.Itoa(port)+"/hook", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer resp.Body.Close()

	select {
	case evt := <-called:
		assert.Equal(t, "PermissionRequest", evt.EventType())
		assert.Equal(t, "Bash", evt.ToolName)
	case <-time.After(2 * time.Second):
		t.Fatal("permission handler not called")
	}

	require.Equal(t, http.StatusOK, resp.StatusCode)
	respBody, _ := io.ReadAll(resp.Body)
	var out map[string]any
	require.NoError(t, json.Unmarshal(respBody, &out))
	hso := out["hookSpecificOutput"].(map[string]any)
	assert.Equal(t, "PermissionRequest", hso["hookEventName"])
	decision := hso["decision"].(map[string]any)
	assert.Equal(t, "allow", decision["behavior"])
}

func TestHandleHook_PermissionRequest_DeniesWhenNoHandler(t *testing.T) {
	srv := New()
	port, err := srv.Start()
	require.NoError(t, err)
	defer srv.listener.Close()

	body, _ := json.Marshal(map[string]any{
		"hook_event_name": "PermissionRequest",
		"session_id":      "550e8400-e29b-41d4-a716-446655440000",
	})

	resp, err := http.Post("http://127.0.0.1:"+strconv.Itoa(port)+"/hook", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode)
	respBody, _ := io.ReadAll(resp.Body)
	var out map[string]any
	require.NoError(t, json.Unmarshal(respBody, &out))
	hso := out["hookSpecificOutput"].(map[string]any)
	decision := hso["decision"].(map[string]any)
	assert.Equal(t, "deny", decision["behavior"])
}

func TestEffectiveToolName(t *testing.T) {
	cases := []struct {
		name     string
		evt      HookEvent
		expected string
	}{
		{"tool_name", HookEvent{ToolName: "AskUserQuestion"}, "AskUserQuestion"},
		{"toolName", HookEvent{ToolNameCamel: "AskUserQuestion"}, "AskUserQuestion"},
		{"tool", HookEvent{Tool: "AskUserQuestion"}, "AskUserQuestion"},
		{"hook_name", HookEvent{HookName: "PermissionRequest:AskUserQuestion"}, "AskUserQuestion"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.expected, tc.evt.EffectiveToolName())
		})
	}
}

func TestHandleHook_NonPermission_ReturnsContinue(t *testing.T) {
	srv := New()
	port, err := srv.Start()
	require.NoError(t, err)
	defer srv.listener.Close()

	body, _ := json.Marshal(map[string]any{
		"hook_event_name": "PreToolUse",
		"session_id":      "550e8400-e29b-41d4-a716-446655440000",
	})

	resp, err := http.Post("http://127.0.0.1:"+strconv.Itoa(port)+"/hook", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode)
	respBody, _ := io.ReadAll(resp.Body)
	var out map[string]any
	require.NoError(t, json.Unmarshal(respBody, &out))
	assert.Equal(t, true, out["continue"])
}
