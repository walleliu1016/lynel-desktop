package hooks

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHandler_AutoAllowBash_Allows(t *testing.T) {
	h := NewHandler(true)
	d := h.Handle(PermissionRequest{Tool: "Bash"})
	assert.True(t, d.Allow)
	assert.True(t, d.Auto)
}

func TestHandler_AutoAllowBash_OffDeniesByDefault(t *testing.T) {
	h := NewHandler(false)
	d := h.Handle(PermissionRequest{Tool: "Bash"})
	assert.False(t, d.Allow)
	assert.False(t, d.Auto)
}

func TestHandler_NonBashNeverAutoAllowed(t *testing.T) {
	h := NewHandler(true)
	d := h.Handle(PermissionRequest{Tool: "Read"})
	assert.False(t, d.Allow)
}

func TestHandler_SetAutoAllowBash(t *testing.T) {
	h := NewHandler(false)
	h.SetAutoAllowBash(true)
	d := h.Handle(PermissionRequest{Tool: "Bash"})
	assert.True(t, d.Allow)
}
