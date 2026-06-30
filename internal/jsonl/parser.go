package jsonl

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
)

type Message struct {
	Role      string          `json:"role"`
	Content   json.RawMessage `json:"content"`
	Type      string          `json:"type"`
	Timestamp int64           `json:"timestamp"`
}

// ToolExecution 表示一次工具调用或 LLM 推理的时间线记录。
type ToolExecution struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`   // "tool" | "llm"
	Name       string `json:"name"`   // 工具名或 "LLM"
	StartedAt  int64  `json:"startedAt"`
	EndedAt    int64  `json:"endedAt"`
	DurationMs int64  `json:"durationMs"`
	Status     string `json:"status"` // "running" | "success" | "error"
	Input      string `json:"input"`  // 工具关键参数 / LLM 输入摘要
	Output     string `json:"output"` // stdout/stderr / LLM 输出摘要
	ExitCode   int    `json:"exitCode"`
}

// contentBlock 覆盖 Claude API 已知的所有 content 类型。
// 未知字段（text/thinking/input/content/is_error）保留以便排错。
type contentBlock struct {
	Type     string          `json:"type"`
	ID       string          `json:"id"`
	Text     string          `json:"text"`
	Thinking string          `json:"thinking"`
	Name     string          `json:"name"`
	Input    json.RawMessage `json:"input"`
	// tool_result
	ToolUseID string          `json:"tool_use_id"`
	Result    json.RawMessage `json:"content"`
	IsError   bool            `json:"is_error"`
}

// ContentText extracts readable text from content, which may be a plain
// string or a Claude content-block array.
func (m Message) ContentText() string {
	// Try plain string
	var s string
	if json.Unmarshal(m.Content, &s) == nil {
		return s
	}
	// Try content-block array
	var blocks []contentBlock
	if json.Unmarshal(m.Content, &blocks) != nil {
		return string(m.Content) // fallback: raw JSON
	}
	parts := make([]string, 0, len(blocks))
	for _, b := range blocks {
		if line := formatBlock(b); line != "" {
			parts = append(parts, line)
		}
	}
	return strings.Join(parts, "\n\n")
}

// formatBlock 把单个 content block 渲染成 markdown 友好的一行（或一块）。
func formatBlock(b contentBlock) string {
	switch b.Type {
	case "text":
		return b.Text
	case "thinking":
		if b.Thinking == "" {
			return ""
		}
		return "> 💭 " + b.Thinking
	case "tool_use":
		return formatToolUse(b.Name, b.Input)
	case "tool_result":
		return formatToolResult(b.Result, b.IsError)
	}
	return ""
}

// formatToolUse 渲染工具调用：🔧 **Name** + 关键参数。
// 已知工具挑关键字段展示；未知工具把 input 整个 JSON 摊开。
func formatToolUse(name string, input json.RawMessage) string {
	if name == "" {
		return ""
	}
	// 解析 input 为通用 map
	var args map[string]any
	if len(input) > 0 {
		_ = json.Unmarshal(input, &args)
	}
	var keyArg string
	switch name {
	case "Bash":
		if cmd, ok := args["command"].(string); ok {
			keyArg = "`" + truncate(cmd, 200) + "`"
		}
	case "Read", "Write", "Edit", "MultiEdit":
		if fp, ok := args["file_path"].(string); ok {
			keyArg = "`" + fp + "`"
		}
	case "Glob":
		if pat, ok := args["pattern"].(string); ok {
			keyArg = "`" + truncate(pat, 200) + "`"
		}
	case "Grep":
		if pat, ok := args["pattern"].(string); ok {
			path, _ := args["path"].(string)
			if path != "" {
				keyArg = "`" + truncate(pat, 100) + "` in `" + path + "`"
			} else {
				keyArg = "`" + truncate(pat, 200) + "`"
			}
		}
	case "Skill":
		if sk, ok := args["skill"].(string); ok {
			keyArg = "`" + sk + "`"
		}
	case "WebFetch":
		if u, ok := args["url"].(string); ok {
			keyArg = truncate(u, 200)
		}
	case "WebSearch":
		if q, ok := args["query"].(string); ok {
			keyArg = truncate(q, 200)
		}
	case "TodoWrite":
		// 不展开，只显示名字
	default:
		// 未知工具：把 input 整个 JSON 当作 keyArg
		if len(input) > 0 && string(input) != "null" && string(input) != "{}" {
			keyArg = "`" + truncate(string(input), 200) + "`"
		}
	}
	if keyArg == "" {
		return "🔧 **" + name + "**"
	}
	return "🔧 **" + name + "** " + keyArg
}

// formatToolResult 渲染工具结果：直接显示 content（truncate）。
// content 可能是字符串、也可能是 [{type:text,text:...}, ...] 数组。
func formatToolResult(raw json.RawMessage, isError bool) string {
	if len(raw) == 0 {
		return ""
	}
	// 字符串
	var s string
	if json.Unmarshal(raw, &s) == nil {
		body := strings.TrimRight(s, "\n")
		body = truncate(body, 1500)
		if isError {
			return "⚠️ " + body
		}
		return "📤 " + body
	}
	// 数组（text blocks）
	var blocks []contentBlock
	if json.Unmarshal(raw, &blocks) == nil {
		var parts []string
		for _, b := range blocks {
			if b.Type == "text" && b.Text != "" {
				parts = append(parts, b.Text)
			}
		}
		body := strings.TrimRight(strings.Join(parts, "\n"), "\n")
		body = truncate(body, 1500)
		if isError {
			return "⚠️ " + body
		}
		return "📤 " + body
	}
	// fallback：原样
	body := truncate(string(raw), 1500)
	if isError {
		return "⚠️ " + body
	}
	return "📤 " + body
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + fmt.Sprintf("…(+%d)", len(s)-max)
}

// IsSessionEnded reports whether the given jsonl file represents a session
// that has already been terminated by the user (via /exit, /quit, or a normal
// shutdown). Returns (false, nil) for empty/missing files. The detection
// looks at the last few lines for explicit end markers Claude CLI writes
// after a user-driven exit:
//
//	{"type":"user","message":{"role":"user","content":"<local-command-caveat>..."}}
//	{"type":"user","message":{"role":"user","content":"<command-name>/exit</command-name>..."}}
//	{"type":"user","message":{"role":"user","content":"<local-command-stdout>Bye!</local-command-stdout>"}}
//
// Why: when Ease UI tries to AdoptSession on an ended session, claude
// stream-json process immediately exits (DEAD within seconds) and the user
// message is silently dropped. Detect this before spawning the process and
// surface a clear error to the frontend instead of a silent failure.
//
// Caveats:
//   - "ended" only covers user-driven /exit or /quit. A process crash or
//     SIGKILL is detected differently (subprocess exits, hook fires
//     SessionEnd, frontend sees state=done) and is NOT this function's job.
//   - We don't try to handle every possible farewell string; checking for
//     the `/exit` / `/quit` <command-name> tag is the canonical signal
//     Claude CLI itself writes.
func IsSessionEnded(path string) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil // fresh session without a jsonl yet
		}
		return false, err
	}
	defer f.Close()

	// Buffer the last 4KB — enough to cover a few end-marker lines without
	// loading multi-MB session logs into memory.
	const tail = 4096
	st, err := f.Stat()
	if err != nil {
		return false, err
	}
	size := st.Size()
	start := int64(0)
	if size > tail {
		start = size - tail
	}
	if _, err := f.Seek(start, 0); err != nil {
		return false, err
	}
	buf := make([]byte, size-start)
	if _, err := f.Read(buf); err != nil {
		return false, err
	}
	content := string(buf)
	// End markers: <command-name>/exit</command-name> or
	// <command-name>/quit</command-name>. Scan for either occurrence.
	// We intentionally don't match <local-command-stdout>Bye!</...> alone
	// because the <command-name> tag is the canonical trigger Claude CLI
	// writes, and it's also the marker other tools (happy-cli) match on.
	return strings.Contains(content, "<command-name>/exit</command-name>") ||
		strings.Contains(content, "<command-name>/quit</command-name>"), nil
}

func ParseFile(path string) ([]Message, error) {
	return ParseFileRange(path, 0, 0)
}

// ParseFileRange reads lines [start, start+limit) from a jsonl file.
// If start==0 && limit==0, reads all.
func ParseFileRange(path string, start, limit int) ([]Message, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	type rawLine struct {
		Type    string          `json:"type"`
		Message json.RawMessage `json:"message"`
	}

	var out []Message
	var lineNum int
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 50*1024*1024)

	type lineWithTs struct {
		Type      string          `json:"type"`
		Message   json.RawMessage `json:"message"`
		Timestamp string          `json:"timestamp"`
	}

	for scanner.Scan() {
		lineNum++
		// Skip lines before start
		if start > 0 && lineNum <= start {
			continue
		}
		// Stop when we have enough
		if limit > 0 && len(out) >= limit {
			break
		}
		var rl lineWithTs
		if err := json.Unmarshal(scanner.Bytes(), &rl); err != nil {
			continue
		}
		var m Message
		if err := json.Unmarshal(rl.Message, &m); err != nil {
			continue
		}
		m.Type = rl.Type
		if rl.Timestamp != "" {
			if t, err := time.Parse(time.RFC3339Nano, rl.Timestamp); err == nil {
				m.Timestamp = t.UnixMilli()
			}
		}
		out = append(out, m)
	}
	return out, scanner.Err()
}

// ParseToolExecutions scans a jsonl file and returns a timeline of tool
// executions and LLM calls, sorted by start time ascending.
func ParseToolExecutions(path string) ([]ToolExecution, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	type attachment struct {
		Type      string `json:"type"`
		HookName  string `json:"hookName"`
		HookEvent string `json:"hookEvent"`
		ToolUseID string `json:"toolUseID"`
		Stdout    string `json:"stdout"`
		Stderr    string `json:"stderr"`
		ExitCode  int    `json:"exitCode"`
	}
	type rawLine struct {
		Type       string          `json:"type"`
		Message    json.RawMessage `json:"message"`
		Timestamp  string          `json:"timestamp"`
		Attachment attachment      `json:"attachment"`
	}

	execs := map[string]*ToolExecution{}
	var msgs []Message

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 50*1024*1024)

	for scanner.Scan() {
		var rl rawLine
		if err := json.Unmarshal(scanner.Bytes(), &rl); err != nil {
			continue
		}
		var ts int64
		if rl.Timestamp != "" {
			if t, err := time.Parse(time.RFC3339Nano, rl.Timestamp); err == nil {
				ts = t.UnixMilli()
			}
		}

		switch rl.Type {
		case "user", "assistant":
			var m Message
			if err := json.Unmarshal(rl.Message, &m); err != nil {
				continue
			}
			m.Type = rl.Type
			m.Timestamp = ts
			msgs = append(msgs, m)

			// 从 assistant 消息里的 tool_use block 提取输入
			if m.Role == "assistant" {
				var blocks []contentBlock
				if json.Unmarshal(m.Content, &blocks) == nil {
					for _, b := range blocks {
						if b.Type != "tool_use" || b.Name == "" {
							continue
						}
						id := b.ID
						if id == "" {
							id = b.Name
						}
						if execs[id] == nil {
							execs[id] = &ToolExecution{ID: id, Kind: "tool", Name: b.Name}
						}
						execs[id].Input = toolInputSummary(b.Name, b.Input)
					}
				}
			}

		case "attachment":
			att := rl.Attachment
			if att.HookEvent != "PreToolUse" && att.HookEvent != "PostToolUse" && att.HookEvent != "PostToolUseFailure" {
				continue
			}
			id := att.ToolUseID
			if id == "" {
				continue
			}
			if execs[id] == nil {
				execs[id] = &ToolExecution{ID: id, Kind: "tool"}
			}
			e := execs[id]
			if att.HookName != "" {
				// hookName 形如 "PreToolUse:Read"，提取工具名
				parts := strings.SplitN(att.HookName, ":", 2)
				if len(parts) == 2 {
					e.Name = parts[1]
				} else {
					e.Name = att.HookName
				}
			}
			switch att.HookEvent {
			case "PreToolUse":
				e.StartedAt = ts
				e.Status = "running"
			case "PostToolUse":
				e.EndedAt = ts
				e.DurationMs = e.EndedAt - e.StartedAt
				e.Status = "success"
				e.Output = att.Stdout
				e.ExitCode = att.ExitCode
			case "PostToolUseFailure":
				e.EndedAt = ts
				e.DurationMs = e.EndedAt - e.StartedAt
				e.Status = "error"
				e.Output = att.Stderr
				e.ExitCode = att.ExitCode
			}
		}
	}

	// 从 user 消息的 tool_result 补 output（如果 PostToolUse 没返回 stdout）
	for _, m := range msgs {
		if m.Role != "user" {
			continue
		}
		var blocks []contentBlock
		if json.Unmarshal(m.Content, &blocks) != nil {
			continue
		}
		for _, b := range blocks {
			if b.Type != "tool_result" || b.ToolUseID == "" {
				continue
			}
			e := execs[b.ToolUseID]
			if e == nil || e.Output != "" {
				continue
			}
			if s, err := toolResultSummary(b.Result); err == nil {
				e.Output = s
			}
		}
	}

	// 生成 LLM 调用记录：每条带 text/thinking 的 assistant 消息视为一次 LLM 调用
	var llmExecs []ToolExecution
	for i, m := range msgs {
		if m.Role != "assistant" {
			continue
		}
		var blocks []contentBlock
		if json.Unmarshal(m.Content, &blocks) != nil {
			continue
		}
		hasText := false
		for _, b := range blocks {
			if b.Type == "text" || b.Type == "thinking" {
				hasText = true
				break
			}
		}
		if !hasText {
			continue
		}
		end := m.Timestamp
		if i+1 < len(msgs) {
			end = msgs[i+1].Timestamp
		}
		llmExecs = append(llmExecs, ToolExecution{
			ID:         fmt.Sprintf("llm-%d", i),
			Kind:       "llm",
			Name:       "LLM",
			StartedAt:  m.Timestamp,
			EndedAt:    end,
			DurationMs: end - m.Timestamp,
			Status:     "success",
			Output:     llmOutputSummary(blocks),
		})
	}

	// 收集结果并排序
	out := make([]ToolExecution, 0, len(execs)+len(llmExecs))
	for _, e := range execs {
		if e.StartedAt == 0 {
			e.StartedAt = e.EndedAt
		}
		if e.EndedAt == 0 {
			e.Status = "running"
		}
		if e.DurationMs == 0 && e.EndedAt > e.StartedAt {
			e.DurationMs = e.EndedAt - e.StartedAt
		}
		out = append(out, *e)
	}
	out = append(out, llmExecs...)
	sort.Slice(out, func(i, j int) bool {
		if out[i].StartedAt != out[j].StartedAt {
			return out[i].StartedAt < out[j].StartedAt
		}
		return out[i].ID < out[j].ID
	})
	return out, scanner.Err()
}

// llmOutputSummary extracts a short summary from assistant text/thinking blocks.
func llmOutputSummary(blocks []contentBlock) string {
	var parts []string
	for _, b := range blocks {
		switch b.Type {
		case "text":
			if b.Text != "" {
				parts = append(parts, b.Text)
			}
		case "thinking":
			if b.Thinking != "" {
				parts = append(parts, b.Thinking)
			}
		}
	}
	return truncate(strings.Join(parts, " "), 200)
}

// toolInputSummary extracts a short summary from a tool_use input block.
func toolInputSummary(name string, input json.RawMessage) string {
	if len(input) == 0 {
		return ""
	}
	var args map[string]any
	if json.Unmarshal(input, &args) != nil {
		return truncate(string(input), 120)
	}
	switch name {
	case "Bash":
		if v, ok := args["command"].(string); ok {
			return truncate(v, 120)
		}
	case "Read", "Write", "Edit", "MultiEdit":
		if v, ok := args["file_path"].(string); ok {
			return v
		}
	case "Glob":
		if v, ok := args["pattern"].(string); ok {
			return truncate(v, 120)
		}
	case "Grep":
		pat, _ := args["pattern"].(string)
		path, _ := args["path"].(string)
		if pat != "" {
			if path != "" {
				return fmt.Sprintf("%s in %s", truncate(pat, 60), path)
			}
			return truncate(pat, 120)
		}
	case "WebFetch":
		if v, ok := args["url"].(string); ok {
			return truncate(v, 120)
		}
	case "WebSearch":
		if v, ok := args["query"].(string); ok {
			return truncate(v, 120)
		}
	}
	// fallback: 取第一个字符串值
	for _, v := range args {
		if s, ok := v.(string); ok && s != "" {
			return truncate(s, 120)
		}
	}
	return truncate(string(input), 120)
}

// toolResultSummary extracts a short text summary from a tool_result content.
func toolResultSummary(raw json.RawMessage) (string, error) {
	if len(raw) == 0 {
		return "", nil
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return strings.TrimRight(s, "\n"), nil
	}
	var blocks []contentBlock
	if json.Unmarshal(raw, &blocks) == nil {
		var parts []string
		for _, b := range blocks {
			if b.Type == "text" && b.Text != "" {
				parts = append(parts, b.Text)
			}
		}
		return strings.TrimRight(strings.Join(parts, "\n"), "\n"), nil
	}
	return strings.TrimRight(string(raw), "\n"), nil
}
