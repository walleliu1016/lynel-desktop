package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
)

func Parse(line []byte) (Event, error) {
	line = bytes.TrimSpace(line)
	if len(line) == 0 {
		return Event{}, errors.New("protocol: empty line")
	}
	var ev Event
	if err := json.Unmarshal(line, &ev); err != nil {
		return Event{}, err
	}
	return ev, nil
}
