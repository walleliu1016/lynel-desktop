package events

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

type testEvt struct {
	ID int
}

func TestBus_PublishReceive(t *testing.T) {
	bus := NewBus()
	defer bus.Close()

	ch := bus.Subscribe("test", 10)

	bus.Publish("test", testEvt{ID: 42})

	select {
	case got := <-ch:
		assert.Equal(t, 42, got.(testEvt).ID)
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for event")
	}
}

func TestBus_MultipleSubscribers(t *testing.T) {
	bus := NewBus()
	defer bus.Close()

	ch1 := bus.Subscribe("test", 10)
	ch2 := bus.Subscribe("test", 10)

	bus.Publish("test", testEvt{ID: 1})

	select {
	case <-ch1:
	case <-time.After(time.Second):
		t.Fatal("ch1 timeout")
	}
	select {
	case <-ch2:
	case <-time.After(time.Second):
		t.Fatal("ch2 timeout")
	}
}

func TestBus_DropOnFullBuffer(t *testing.T) {
	bus := NewBus()
	defer bus.Close()

	ch := bus.Subscribe("test", 1)
	bus.Publish("test", testEvt{ID: 1})
	bus.Publish("test", testEvt{ID: 2}) // buffer full, drop or non-blocking

	select {
	case <-ch:
		// OK
	case <-time.After(time.Second):
		t.Fatal("timeout")
	}
}
