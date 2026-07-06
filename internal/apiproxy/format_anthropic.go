package apiproxy

import (
	"encoding/json"
	"fmt"
	"strings"
)

// AnthropicRequestBody is the subset of the Anthropic Messages API request
// that we need for display purposes.
type AnthropicRequestBody struct {
	Model    string                `json:"model"`
	Messages []AnthropicMessage    `json:"messages"`
	Tools    []AnthropicTool       `json:"tools"`
	System   []AnthropicSystemBlock `json:"system"`
}

type AnthropicMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

type AnthropicTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

type AnthropicSystemBlock struct {
	Text string `json:"text"`
}

// ExtractPrompt returns the text of the last user message in the request.
// Content may be a plain string or a content-block array; only text blocks
// are included in the summary.
func ExtractPrompt(body AnthropicRequestBody) string {
	for i := len(body.Messages) - 1; i >= 0; i-- {
		m := body.Messages[i]
		if m.Role != "user" {
			continue
		}
		var s string
		if json.Unmarshal(m.Content, &s) == nil {
			return strings.TrimSpace(s)
		}
		var blocks []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if json.Unmarshal(m.Content, &blocks) != nil {
			continue
		}
		var parts []string
		for _, b := range blocks {
			if b.Type == "" || b.Type == "text" {
				parts = append(parts, b.Text)
			}
		}
		return strings.TrimSpace(strings.Join(parts, "\n"))
	}
	return ""
}

// ExtractTools returns the names of tools declared in the request.
func ExtractTools(body AnthropicRequestBody) []string {
	if len(body.Tools) == 0 {
		return nil
	}
	names := make([]string, 0, len(body.Tools))
	for _, t := range body.Tools {
		if t.Name != "" {
			names = append(names, t.Name)
		}
	}
	return names
}

// AnthropicSSEEvent represents a single SSE event from Anthropic's streaming
// Messages API.
type AnthropicSSEEvent struct {
	Type               string                   `json:"type"`
	Index              int                      `json:"index"`
	Message            *AnthropicMessageStart   `json:"message,omitempty"`
	ContentBlock       *AnthropicContentBlock   `json:"content_block,omitempty"`
	Delta              *AnthropicDelta          `json:"delta,omitempty"`
	Usage              *AnthropicUsage          `json:"usage,omitempty"`
	Error              *AnthropicError          `json:"error,omitempty"`
}

type AnthropicMessageStart struct {
	Model string          `json:"model"`
	Usage AnthropicUsage  `json:"usage"`
}

type AnthropicContentBlock struct {
	Type      string          `json:"type"`
	Text      string          `json:"text"`
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Input     json.RawMessage `json:"input"`
	Thinking  string          `json:"thinking"`
}

type AnthropicDelta struct {
	Type        string `json:"type"`
	Text        string `json:"text"`
	Thinking    string `json:"thinking"`
	PartialJSON string `json:"partial_json"`
	StopReason  string `json:"stop_reason"`
}

type AnthropicUsage struct {
	InputTokens              int `json:"input_tokens"`
	OutputTokens             int `json:"output_tokens"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
}

type AnthropicError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

// ReassembleAnthropicResponse turns a raw Anthropic SSE stream (or a plain
// JSON response) into a normalized ResponseSummary.
func ReassembleAnthropicResponse(raw string) ResponseSummary {
	trimmed := strings.TrimSpace(raw)
	if strings.HasPrefix(trimmed, "{") {
		var msg struct {
			Model      string          `json:"model"`
			StopReason string          `json:"stop_reason"`
			Usage      AnthropicUsage  `json:"usage"`
			Content    []AnthropicContentBlock `json:"content"`
			Type       string          `json:"type"`
			Error      AnthropicError  `json:"error"`
		}
		if err := json.Unmarshal([]byte(trimmed), &msg); err == nil {
			if msg.Type == "error" {
				return ResponseSummary{Error: msg.Error.Message}
			}
			return ResponseSummary{
				Model:      msg.Model,
				StopReason: msg.StopReason,
				Usage:      normalizeAnthropicUsage(msg.Usage),
				Content:    finalizeAnthropicBlockSlice(msg.Content),
			}
		}
	}

	state := &anthropicStreamState{}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var ev AnthropicSSEEvent
		if err := json.Unmarshal([]byte(payload), &ev); err != nil {
			continue
		}
		applyAnthropicEvent(state, ev)
	}

	return ResponseSummary{
		Model:      state.model,
		StopReason: state.stopReason,
		Usage:      normalizeAnthropicUsage(state.usage),
		Content:    finalizeAnthropicBlocks(state.blocks),
	}
}

type anthropicStreamState struct {
	model      string
	stopReason string
	usage      AnthropicUsage
	blocks     []*AnthropicContentBlock
}

func applyAnthropicEvent(state *anthropicStreamState, ev AnthropicSSEEvent) {
	switch ev.Type {
	case "message_start":
		if ev.Message != nil {
			state.model = ev.Message.Model
			state.usage = mergeAnthropicUsage(state.usage, ev.Message.Usage)
		}
	case "content_block_start":
		if ev.ContentBlock != nil {
			blk := *ev.ContentBlock
			if blk.Type == "tool_use" {
				blk.Input = nil
			}
			state.blocks = append(state.blocks, &blk)
		}
	case "content_block_delta":
		if ev.Index < 0 || ev.Index >= len(state.blocks) || ev.Delta == nil {
			return
		}
		b := state.blocks[ev.Index]
		switch ev.Delta.Type {
		case "text_delta":
			b.Text += ev.Delta.Text
		case "thinking_delta":
			b.Thinking += ev.Delta.Thinking
		case "input_json_delta":
			if b.Type == "tool_use" {
				partial := string(b.Input) + ev.Delta.PartialJSON
				b.Input = json.RawMessage(partial)
			}
		}
	case "message_delta":
		if ev.Delta != nil && ev.Delta.StopReason != "" {
			state.stopReason = ev.Delta.StopReason
		}
		if ev.Usage != nil {
			state.usage = mergeAnthropicUsage(state.usage, *ev.Usage)
		}
	case "error":
		if ev.Error != nil {
			// Error events are not persisted as the response error here;
			// the proxy layer handles HTTP errors separately.
		}
	}
}

func finalizeAnthropicBlocks(blocks []*AnthropicContentBlock) []ContentBlock {
	out := make([]ContentBlock, 0, len(blocks))
	for _, b := range blocks {
		if b == nil {
			continue
		}
		out = append(out, finalizeAnthropicBlock(*b))
	}
	return out
}

func finalizeAnthropicBlock(b AnthropicContentBlock) ContentBlock {
	cb := ContentBlock{Type: b.Type}
	switch b.Type {
	case "text":
		cb.Text = b.Text
	case "thinking":
		cb.Thinking = b.Thinking
	case "tool_use":
		cb.ToolUseID = b.ID
		cb.Name = b.Name
		if len(b.Input) > 0 {
			var input any
			if err := json.Unmarshal(b.Input, &input); err == nil {
				cb.Input = b.Input
			} else {
				cb.Input = json.RawMessage("{}")
			}
		} else {
			cb.Input = json.RawMessage("{}")
		}
	}
	return cb
}

func finalizeAnthropicBlockSlice(blocks []AnthropicContentBlock) []ContentBlock {
	out := make([]ContentBlock, 0, len(blocks))
	for _, b := range blocks {
		out = append(out, finalizeAnthropicBlock(b))
	}
	return out
}

func normalizeAnthropicUsage(u AnthropicUsage) *Usage {
	return &Usage{
		InputTokens:           u.InputTokens,
		OutputTokens:          u.OutputTokens,
		CacheReadInputTokens:  u.CacheReadInputTokens,
		CacheWriteInputTokens: u.CacheCreationInputTokens,
	}
}

func mergeAnthropicUsage(a, b AnthropicUsage) AnthropicUsage {
	return AnthropicUsage{
		InputTokens:              maxInt(a.InputTokens, b.InputTokens),
		OutputTokens:             maxInt(a.OutputTokens, b.OutputTokens),
		CacheReadInputTokens:     maxInt(a.CacheReadInputTokens, b.CacheReadInputTokens),
		CacheCreationInputTokens: maxInt(a.CacheCreationInputTokens, b.CacheCreationInputTokens),
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// ExtractToolResults scans the last user message of a request for tool_result
// content blocks and returns them normalized.
func ExtractToolResults(body AnthropicRequestBody) []ToolResultPhase {
	if len(body.Messages) == 0 {
		return nil
	}
	last := body.Messages[len(body.Messages)-1]
	if last.Role != "user" {
		return nil
	}
	var s string
	if json.Unmarshal(last.Content, &s) == nil {
		return nil
	}
	var blocks []struct {
		Type      string          `json:"type"`
		ToolUseID string          `json:"tool_use_id"`
		Content   json.RawMessage `json:"content"`
	}
	if json.Unmarshal(last.Content, &blocks) != nil {
		return nil
	}

	var out []ToolResultPhase
	for _, b := range blocks {
		if b.Type != "tool_result" || b.ToolUseID == "" {
			continue
		}
		out = append(out, ToolResultPhase{
			ToolUseID: b.ToolUseID,
			Output:    toolResultText(b.Content),
		})
	}
	return out
}

// ToolResultPhase is a normalized tool_result extracted from a request.
type ToolResultPhase struct {
	ToolUseID string
	Output    string
}

func toolResultText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return strings.TrimSpace(s)
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &blocks) == nil {
		var parts []string
		for _, b := range blocks {
			if b.Type == "text" {
				parts = append(parts, b.Text)
			}
		}
		return strings.TrimSpace(strings.Join(parts, "\n"))
	}
	return strings.TrimSpace(string(raw))
}

// IsToolResultOnly reports whether the last user message consists solely of
// tool_result blocks (no plain text prompt).
func IsToolResultOnly(body AnthropicRequestBody) bool {
	if len(body.Messages) == 0 {
		return false
	}
	last := body.Messages[len(body.Messages)-1]
	if last.Role != "user" {
		return false
	}
	var s string
	if json.Unmarshal(last.Content, &s) == nil {
		return false
	}
	var blocks []struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(last.Content, &blocks) != nil {
		return false
	}
	if len(blocks) == 0 {
		return false
	}
	for _, b := range blocks {
		if b.Type != "tool_result" {
			return false
		}
	}
	return true
}

// FormatInput returns a compact JSON representation of a tool input map.
func FormatInput(input map[string]any) json.RawMessage {
	if input == nil {
		return json.RawMessage("{}")
	}
	b, _ := json.Marshal(input)
	return b
}

// ParseAnthropicRequestBody parses a raw JSON request body.
func ParseAnthropicRequestBody(raw []byte) (AnthropicRequestBody, error) {
	var body AnthropicRequestBody
	if err := json.Unmarshal(raw, &body); err != nil {
		return body, fmt.Errorf("parse anthropic request: %w", err)
	}
	return body, nil
}
