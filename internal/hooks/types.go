// Package hooks provides PermissionRequest handling and settings.json editing.
package hooks

import "encoding/json"

type HookType string

const (
	HookTypeShell  HookType = "shell"
	HookTypePython HookType = "python"
)

type Hook struct {
	Matcher string   `json:"matcher,omitempty"`
	Command string   `json:"command"`
	Type    HookType `json:"type"`
}

type EventHooks struct {
	PreToolUse        []Hook `json:"PreToolUse,omitempty"`
	PermissionRequest []Hook `json:"PermissionRequest,omitempty"`
	PostToolUse       []Hook `json:"PostToolUse,omitempty"`
	Notification      []Hook `json:"Notification,omitempty"`
	Stop              []Hook `json:"Stop,omitempty"`
}

type Config struct {
	EventHooks
}

type Decision struct {
	Allow  bool
	Auto   bool
	Reason string
}

type PermissionRequest struct {
	RequestID string          `json:"request_id"`
	Tool      string          `json:"tool"`
	Args      json.RawMessage `json:"args"`
}
