package protocol

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParse_MessageEvent(t *testing.T) {
	line := []byte(`{"type":"message","session_id":"abc","data":{"role":"assistant","content":"hi"}}`)

	ev, err := Parse(line)
	require.NoError(t, err)
	assert.Equal(t, EvtMessage, ev.Type)
	assert.Equal(t, "abc", ev.Session)
}

func TestParse_ToolUseEvent(t *testing.T) {
	line := []byte(`{"type":"tool_use","session_id":"abc","data":{"id":"t1","name":"Bash","args":{"command":"ls"}}}`)

	ev, err := Parse(line)
	require.NoError(t, err)
	assert.Equal(t, EvtToolUse, ev.Type)
}

func TestParse_PermissionRequest(t *testing.T) {
	line := []byte(`{"type":"permission_request","session_id":"abc","data":{"request_id":"r1","tool":"Bash","args":{}}}`)

	ev, err := Parse(line)
	require.NoError(t, err)
	assert.Equal(t, EvtPermissionReq, ev.Type)
}

func TestParse_InvalidJSONReturnsError(t *testing.T) {
	_, err := Parse([]byte("not json"))
	assert.Error(t, err)
}

func TestParse_UnknownTypeStillReturnsEvent(t *testing.T) {
	line := []byte(`{"type":"unknown","session_id":"x","data":{}}`)
	ev, err := Parse(line)
	require.NoError(t, err)
	assert.Equal(t, EventType("unknown"), ev.Type)
}

func TestParse_EmptyLineReturnsError(t *testing.T) {
	_, err := Parse([]byte(""))
	assert.Error(t, err)
}
