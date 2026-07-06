package apiproxy

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// Store persists display-relevant API-call phases per session and provides
// real-time subscription for SSE consumers.
type Store struct {
	mu       sync.RWMutex
	root     string
	seq      atomic.Uint64
	sessions map[string]*sessionState
	subs     map[string][]chan Phase
}

type sessionState struct {
	turn           int
	pendingToolUse map[string]toolUseInfo
}

type toolUseInfo struct {
	turn int
	seq  int64
}

// NewStore creates a store rooted at the given directory. The directory is
// created on demand. The global seq counter is initialized from existing
// phase files so restarts do not reuse sequence numbers.
func NewStore(root string) *Store {
	s := &Store{
		root:     root,
		sessions: map[string]*sessionState{},
		subs:     map[string][]chan Phase{},
	}
	s.seq.Store(s.loadMaxSeq())
	return s
}

// Root returns the persisted root directory.
func (s *Store) Root() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.root
}

// SetRoot changes the root directory and reloads the seq counter.
func (s *Store) SetRoot(root string) {
	s.mu.Lock()
	s.root = root
	s.mu.Unlock()
	s.seq.Store(s.loadMaxSeq())
}

// nextSeq returns the next global sequence number.
func (s *Store) nextSeq() int64 {
	return int64(s.seq.Add(1))
}

// loadMaxSeq scans all existing calls files and returns the maximum seq seen.
func (s *Store) loadMaxSeq() uint64 {
	s.mu.RLock()
	root := s.root
	s.mu.RUnlock()

	entries, err := os.ReadDir(root)
	if err != nil {
		return 0
	}

	var maxSeq uint64
	for _, proj := range entries {
		if !proj.IsDir() {
			continue
		}
		projDir := filepath.Join(root, proj.Name())
		files, err := os.ReadDir(projDir)
		if err != nil {
			continue
		}
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(f.Name(), "-calls.jsonl") {
				continue
			}
			if n, _ := scanMaxSeq(filepath.Join(projDir, f.Name())); n > maxSeq {
				maxSeq = n
			}
		}
	}
	return maxSeq
}

func scanMaxSeq(path string) (uint64, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	var maxSeq uint64
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 50*1024*1024)
	for scanner.Scan() {
		var p struct {
			Seq uint64 `json:"seq"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &p); err != nil {
			continue
		}
		if p.Seq > maxSeq {
			maxSeq = p.Seq
		}
	}
	return maxSeq, scanner.Err()
}

// sessionState returns the mutable state for a session, creating it if needed.
func (s *Store) sessionState(sessionID string) *sessionState {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, ok := s.sessions[sessionID]
	if !ok {
		st = &sessionState{pendingToolUse: map[string]toolUseInfo{}}
		s.sessions[sessionID] = st
	}
	return st
}

// WritePrompt records the user prompt phase from a request and returns it.
func (s *Store) WritePrompt(sessionID, workDir, callID, provider, model, prompt string, tools []string) Phase {
	st := s.sessionState(sessionID)
	st.turn++

	p := Phase{
		Seq:       s.nextSeq(),
		Kind:      KindPrompt,
		Turn:      st.turn,
		SessionID: sessionID,
		CallID:    callID,
		Provider:  provider,
		Ts:        time.Now().UnixMilli(),
		Model:     model,
		Prompt:    prompt,
		Tools:     tools,
	}
	s.appendAndPublish(sessionID, workDir, p)
	return p
}

// WriteToolResults records tool_result phases that arrive in a subsequent
// request. Each result inherits the turn of its matching tool_use.
func (s *Store) WriteToolResults(sessionID, workDir, callID, provider string, results []ToolResultPhase) []Phase {
	if len(results) == 0 {
		return nil
	}
	st := s.sessionState(sessionID)

	out := make([]Phase, 0, len(results))
	for _, r := range results {
		turn := st.turn
		if info, ok := st.pendingToolUse[r.ToolUseID]; ok {
			turn = info.turn
			delete(st.pendingToolUse, r.ToolUseID)
		}
		p := Phase{
			Seq:       s.nextSeq(),
			Kind:      KindToolResult,
			Turn:      turn,
			SessionID: sessionID,
			CallID:    callID,
			Provider:  provider,
			Ts:        time.Now().UnixMilli(),
			ToolUseID: r.ToolUseID,
			Output:    r.Output,
		}
		out = append(out, p)
		s.appendAndPublish(sessionID, workDir, p)
	}
	return out
}

// WriteResponse records text/thinking/tool_use phases from a model response.
func (s *Store) WriteResponse(sessionID, workDir, callID, provider, model string, resp ResponseSummary) []Phase {
	st := s.sessionState(sessionID)

	out := make([]Phase, 0, len(resp.Content)+1)

	// Record response-level usage and stop_reason as a lightweight phase only
	// when there is no content (e.g. an error response).
	if len(resp.Content) == 0 && resp.Error != "" {
		p := Phase{
			Seq:       s.nextSeq(),
			Kind:      KindError,
			Turn:      st.turn,
			SessionID: sessionID,
			CallID:    callID,
			Provider:  provider,
			Ts:        time.Now().UnixMilli(),
			Model:     model,
			Error:     resp.Error,
		}
		if resp.Usage != nil {
			u := *resp.Usage
			p.Usage = &u
		}
		out = append(out, p)
		s.appendAndPublish(sessionID, workDir, p)
		return out
	}

	for _, c := range resp.Content {
		p := Phase{
			Seq:       s.nextSeq(),
			Turn:      st.turn,
			SessionID: sessionID,
			CallID:    callID,
			Provider:  provider,
			Ts:        time.Now().UnixMilli(),
			Model:     resp.Model,
			StopReason: resp.StopReason,
		}
		if resp.Usage != nil {
			u := *resp.Usage
			p.Usage = &u
		}

		switch c.Type {
		case "text":
			p.Kind = KindText
			p.Text = c.Text
		case "thinking":
			p.Kind = KindThinking
			p.Text = c.Thinking
		case "tool_use":
			p.Kind = KindToolUse
			p.ToolUseID = c.ToolUseID
			p.Name = c.Name
			p.Input = c.Input
			st.pendingToolUse[c.ToolUseID] = toolUseInfo{turn: st.turn, seq: p.Seq}
		default:
			continue
		}
		out = append(out, p)
		s.appendAndPublish(sessionID, workDir, p)
	}
	return out
}

// WriteError records a transport or parsing error as a phase.
func (s *Store) WriteError(sessionID, workDir, callID, provider, err string) Phase {
	st := s.sessionState(sessionID)
	p := Phase{
		Seq:       s.nextSeq(),
		Kind:      KindError,
		Turn:      st.turn,
		SessionID: sessionID,
		CallID:    callID,
		Provider:  provider,
		Ts:        time.Now().UnixMilli(),
		Error:     err,
	}
	s.appendAndPublish(sessionID, workDir, p)
	return p
}

// appendAndPublish writes a phase to disk and notifies subscribers.
func (s *Store) appendAndPublish(sessionID, workDir string, p Phase) {
	_ = s.append(sessionID, workDir, p)
	s.publish(sessionID, p)
}

func (s *Store) append(sessionID, workDir string, p Phase) error {
	path := s.phasePath(sessionID, workDir)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()

	b, err := json.Marshal(p)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(f, string(b))
	return err
}

func (s *Store) phasePath(sessionID, workDir string) string {
	s.mu.RLock()
	root := s.root
	s.mu.RUnlock()
	return filepath.Join(root, encodeProjectDirName(workDir), sessionID+"-calls.jsonl")
}

// publish delivers a phase to all subscribers for the session.
func (s *Store) publish(sessionID string, p Phase) {
	s.mu.RLock()
	chs := make([]chan Phase, len(s.subs[sessionID]))
	copy(chs, s.subs[sessionID])
	s.mu.RUnlock()

	for _, ch := range chs {
		select {
		case ch <- p:
		default:
		}
	}
}

// Subscribe returns a channel that receives new phases for the session.
// The returned cancel function should be called when the consumer is done;
// it closes the channel and removes it from the subscription list.
func (s *Store) Subscribe(sessionID string) (<-chan Phase, func()) {
	ch := make(chan Phase, 64)
	s.mu.Lock()
	s.subs[sessionID] = append(s.subs[sessionID], ch)
	s.mu.Unlock()

	cancel := func() {
		close(ch)
		s.mu.Lock()
		arr := s.subs[sessionID]
		for i, c := range arr {
			if c == ch {
				s.subs[sessionID] = append(arr[:i], arr[i+1:]...)
				break
			}
		}
		s.mu.Unlock()
	}

	return ch, cancel
}

// ListPhases returns all persisted phases for a session in seq order.
func (s *Store) ListPhases(sessionID, workDir string) ([]Phase, error) {
	path := s.phasePath(sessionID, workDir)
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()

	var out []Phase
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 50*1024*1024)
	for scanner.Scan() {
		var p Phase
		if err := json.Unmarshal(scanner.Bytes(), &p); err != nil {
			continue
		}
		out = append(out, p)
	}
	return out, scanner.Err()
}

// GetPhase reads a single phase by its global seq. It scans all calls files
// under the store root. For frequent access, callers should prefer caching
// or ListPhases.
func (s *Store) GetPhase(seq int64) (Phase, error) {
	var zero Phase
	s.mu.RLock()
	root := s.root
	s.mu.RUnlock()

	entries, err := os.ReadDir(root)
	if err != nil {
		return zero, err
	}

	for _, proj := range entries {
		if !proj.IsDir() {
			continue
		}
		files, err := os.ReadDir(filepath.Join(root, proj.Name()))
		if err != nil {
			continue
		}
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(f.Name(), "-calls.jsonl") {
				continue
			}
			if p, ok, _ := findPhase(filepath.Join(root, proj.Name(), f.Name()), seq); ok {
				return p, nil
			}
		}
	}
	return zero, fmt.Errorf("phase seq %d not found", seq)
}

func findPhase(path string, seq int64) (Phase, bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return Phase{}, false, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 50*1024*1024)
	for scanner.Scan() {
		var p Phase
		if err := json.Unmarshal(scanner.Bytes(), &p); err != nil {
			continue
		}
		if p.Seq == seq {
			return p, true, nil
		}
	}
	return Phase{}, false, scanner.Err()
}

// encodeProjectDirName mirrors the encoding used by Claude CLI and Ease UI's
// internal/app package so project directories line up.
func encodeProjectDirName(dir string) string {
	return strings.NewReplacer(
		`\`, "-",
		"/", "-",
		":", "-",
		".", "-",
		"_", "-",
	).Replace(dir)
}

// NewCallID generates a unique call identifier.
func NewCallID() string {
	return uuid.New().String()
}
