package apiproxy

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExtractPrompt(t *testing.T) {
	body := AnthropicRequestBody{
		Messages: []AnthropicMessage{
			{Role: "user", Content: json.RawMessage(`"hello"`)},
			{Role: "assistant", Content: json.RawMessage(`"hi"`)},
			{Role: "user", Content: json.RawMessage(`[{"type":"text","text":"last prompt"}]`)},
		},
	}
	assert.Equal(t, "last prompt", ExtractPrompt(body))
}

func TestExtractPromptString(t *testing.T) {
	body := AnthropicRequestBody{
		Messages: []AnthropicMessage{
			{Role: "user", Content: json.RawMessage(`"first"`)},
			{Role: "user", Content: json.RawMessage(`"second"`)},
		},
	}
	assert.Equal(t, "second", ExtractPrompt(body))
}

func TestExtractTools(t *testing.T) {
	body := AnthropicRequestBody{
		Tools: []AnthropicTool{
			{Name: "Read"},
			{Name: "Bash"},
		},
	}
	assert.Equal(t, []string{"Read", "Bash"}, ExtractTools(body))
}

func TestReassembleAnthropicResponse_NonStreaming(t *testing.T) {
	raw := `{
		"model": "claude-sonnet-4-6",
		"stop_reason": "end_turn",
		"usage": {"input_tokens": 10, "output_tokens": 5},
		"content": [
			{"type": "text", "text": "hello"},
			{"type": "tool_use", "id": "tu-1", "name": "Read", "input": {"file_path": "/tmp/foo"}}
		]
	}`
	sum := ReassembleAnthropicResponse(raw)
	assert.Equal(t, "claude-sonnet-4-6", sum.Model)
	assert.Equal(t, "end_turn", sum.StopReason)
	require.NotNil(t, sum.Usage)
	assert.Equal(t, 10, sum.Usage.InputTokens)
	assert.Equal(t, 5, sum.Usage.OutputTokens)
	require.Len(t, sum.Content, 2)
	assert.Equal(t, "text", sum.Content[0].Type)
	assert.Equal(t, "hello", sum.Content[0].Text)
	assert.Equal(t, "tool_use", sum.Content[1].Type)
	assert.Equal(t, "tu-1", sum.Content[1].ToolUseID)
	assert.Equal(t, "Read", sum.Content[1].Name)
	assert.JSONEq(t, `{"file_path":"/tmp/foo"}`, string(sum.Content[1].Input))
}

func TestReassembleAnthropicResponse_Streaming(t *testing.T) {
	raw := `data: {"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":10}}}

data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu-1","name":"Read","input":{}}}
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"file_path\": \"/tmp/foo\"}"}}
data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}
`
	sum := ReassembleAnthropicResponse(raw)
	assert.Equal(t, "claude-sonnet-4-6", sum.Model)
	assert.Equal(t, "tool_use", sum.StopReason)
	require.NotNil(t, sum.Usage)
	assert.Equal(t, 10, sum.Usage.InputTokens)
	assert.Equal(t, 5, sum.Usage.OutputTokens)
	require.Len(t, sum.Content, 2)
	assert.Equal(t, "text", sum.Content[0].Type)
	assert.Equal(t, "hi", sum.Content[0].Text)
	assert.Equal(t, "tool_use", sum.Content[1].Type)
	assert.Equal(t, "Read", sum.Content[1].Name)
	assert.JSONEq(t, `{"file_path":"/tmp/foo"}`, string(sum.Content[1].Input))
}

func TestExtractToolResults(t *testing.T) {
	body := AnthropicRequestBody{
		Messages: []AnthropicMessage{
			{Role: "user", Content: json.RawMessage(`[
				{"type":"tool_result","tool_use_id":"tu-1","content":"result one"},
				{"type":"tool_result","tool_use_id":"tu-2","content":[{"type":"text","text":"result two"}]}
			]`)},
		},
	}
	trs := ExtractToolResults(body)
	require.Len(t, trs, 2)
	assert.Equal(t, "tu-1", trs[0].ToolUseID)
	assert.Equal(t, "result one", trs[0].Output)
	assert.Equal(t, "tu-2", trs[1].ToolUseID)
	assert.Equal(t, "result two", trs[1].Output)
}

func TestIsToolResultOnly(t *testing.T) {
	body := AnthropicRequestBody{
		Messages: []AnthropicMessage{
			{Role: "user", Content: json.RawMessage(`[{"type":"tool_result","tool_use_id":"tu-1","content":"ok"}]`)},
		},
	}
	assert.True(t, IsToolResultOnly(body))

	body.Messages[0].Content = json.RawMessage(`"prompt"`)
	assert.False(t, IsToolResultOnly(body))
}
