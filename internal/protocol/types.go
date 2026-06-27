// Package protocol defines Claude CLI stream-json event types.
package protocol

import "encoding/json"

type EventType string

const (
	EvtMessage       EventType = "message"
	EvtToolUse       EventType = "tool_use"
	EvtToolResult    EventType = "tool_result"
	EvtPermissionReq EventType = "permission_request"
	EvtResult        EventType = "result"
	EvtError         EventType = "error"
)

type Event struct {
	Type    EventType       `json:"type"`
	Session string          `json:"session_id"`
	Data    json.RawMessage `json:"data"`
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ToolUse struct {
	ID   string          `json:"id"`
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
}

type ToolResult struct {
	ID      string `json:"id"`
	Content string `json:"content"`
	IsError bool   `json:"is_error"`
}

type PermissionRequest struct {
	RequestID string          `json:"request_id"`
	Tool      string          `json:"tool"`
	Args      json.RawMessage `json:"args"`
}

type Result struct {
	StopReason string `json:"stop_reason"`
}

type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
