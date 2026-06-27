package jsonl

import (
	"bufio"
	"encoding/json"
	"os"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Type    string `json:"type"`
}

type rawLine struct {
	Type    string          `json:"type"`
	Message json.RawMessage `json:"message"`
}

func ParseFile(path string) ([]Message, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var out []Message
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 50*1024*1024) // up to 50MB lines

	for scanner.Scan() {
		var rl rawLine
		if err := json.Unmarshal(scanner.Bytes(), &rl); err != nil {
			continue // skip bad lines
		}
		var m Message
		if err := json.Unmarshal(rl.Message, &m); err != nil {
			continue
		}
		m.Type = rl.Type
		out = append(out, m)
	}
	return out, scanner.Err()
}
