// Package events provides a typed pub/sub bus for in-process event flow.
package events

import (
	"sync"
)

type Bus struct {
	mu   sync.RWMutex
	subs map[string][]chan any
}

func NewBus() *Bus {
	return &Bus{subs: make(map[string][]chan any)}
}

func (b *Bus) Subscribe(topic string, buffer int) <-chan any {
	ch := make(chan any, buffer)
	b.mu.Lock()
	defer b.mu.Unlock()
	b.subs[topic] = append(b.subs[topic], ch)
	return ch
}

func (b *Bus) Publish(topic string, payload any) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, ch := range b.subs[topic] {
		select {
		case ch <- payload:
		default:
			// buffer full, drop
		}
	}
}

func (b *Bus) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, chs := range b.subs {
		for _, ch := range chs {
			close(ch)
		}
	}
	b.subs = make(map[string][]chan any)
}
