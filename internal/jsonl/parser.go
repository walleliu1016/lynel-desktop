package jsonl

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type Message struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
	Type    string          `json:"type"`
}

// contentBlock 覆盖 Claude API 已知的所有 content 类型。
// 未知字段（text/thinking/input/content/is_error）保留以便排错。
type contentBlock struct {
	Type     string          `json:"type"`
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

type rawLine struct {
	Type    string          `json:"type"`
	Message json.RawMessage `json:"message"`
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
		var rl rawLine
		if err := json.Unmarshal(scanner.Bytes(), &rl); err != nil {
			continue
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
