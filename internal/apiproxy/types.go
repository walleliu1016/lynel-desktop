// Package apiproxy provides a local transparent HTTP proxy that intercepts
// LLM API calls from agents like Claude Code, extracts display-relevant
// phases, and persists them as newline-delimited JSON.
package apiproxy

import "encoding/json"

// PhaseKind identifies the type of a persisted phase line.
type PhaseKind string

const (
	KindPrompt     PhaseKind = "prompt"
	KindText       PhaseKind = "text"
	KindThinking   PhaseKind = "thinking"
	KindToolUse    PhaseKind = "tool_use"
	KindToolResult PhaseKind = "tool_result"
	KindError      PhaseKind = "error"
)

// Phase is a single line in the calls jsonl file. It represents one
// display-relevant stage of an agent turn.
type Phase struct {
	Seq        int64           `json:"seq"`
	Kind       PhaseKind       `json:"kind"`
	Turn       int             `json:"turn"`
	SessionID  string          `json:"session_id"`
	CallID     string          `json:"call_id"`
	Provider   string          `json:"provider"`
	Ts         int64           `json:"ts"`
	ToolUseID  string          `json:"tool_use_id,omitempty"`
	Model      string          `json:"model,omitempty"`
	Prompt     string          `json:"prompt,omitempty"`
	Tools      []string        `json:"tools,omitempty"`
	Text       string          `json:"text,omitempty"`
	Name       string          `json:"name,omitempty"`
	Input      json.RawMessage `json:"input,omitempty"`
	Output     string          `json:"output,omitempty"`
	Usage      *Usage          `json:"usage,omitempty"`
	StopReason string          `json:"stop_reason,omitempty"`
	Error      string          `json:"error,omitempty"`
}

// Usage holds token consumption for a model response.
type Usage struct {
	InputTokens           int `json:"input_tokens,omitempty"`
	OutputTokens          int `json:"output_tokens,omitempty"`
	CacheReadInputTokens  int `json:"cache_read_input_tokens,omitempty"`
	CacheWriteInputTokens int `json:"cache_write_input_tokens,omitempty"`
}

// RequestSummary is the minimal request information we keep for display.
type RequestSummary struct {
	Model  string   `json:"model"`
	Prompt string   `json:"prompt"`
	Tools  []string `json:"tools,omitempty"`
}

// ResponseSummary is the minimal response information we keep for display.
type ResponseSummary struct {
	Model      string          `json:"model"`
	StopReason string          `json:"stop_reason,omitempty"`
	Usage      *Usage          `json:"usage,omitempty"`
	Content    []ContentBlock  `json:"content,omitempty"`
	Error      string          `json:"error,omitempty"`
}

// ContentBlock is a normalized content item from a model response.
type ContentBlock struct {
	Type      string          `json:"type"`
	Text      string          `json:"text,omitempty"`
	Thinking  string          `json:"thinking,omitempty"`
	ToolUseID string          `json:"tool_use_id,omitempty"`
	Name      string          `json:"name,omitempty"`
	Input     json.RawMessage `json:"input,omitempty"`
}
