package hooks

import "sync"

type Handler struct {
	mu            sync.RWMutex
	autoAllowBash bool
}

func NewHandler(autoAllowBash bool) *Handler {
	return &Handler{autoAllowBash: autoAllowBash}
}

func (h *Handler) SetAutoAllowBash(v bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.autoAllowBash = v
}

func (h *Handler) Handle(req PermissionRequest) Decision {
	h.mu.RLock()
	auto := h.autoAllowBash
	h.mu.RUnlock()

	if auto && req.Tool == "Bash" {
		return Decision{Allow: true, Auto: true, Reason: "auto-allow bash"}
	}
	return Decision{Allow: false, Reason: "user input required"}
}
