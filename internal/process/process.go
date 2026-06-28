// Package process wraps the Claude CLI as a managed subprocess.
package process

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/akke/ease-ui/internal/protocol"
)

// Mode 决定 claude 进程的启动模式：开新 session 还是 resume 已存在的 session。
//
//   - ModeNew:    用 `--session-id <sid>`。Ease UI 自己生成的全新 sid，
//     或历史 session 的 jsonl 不存在（首次 adopt）。stream-json envelope
//     从第一条 user message 开始。
//   - ModeResume: 用 `--resume <sid>`。该 sid 的 jsonl 已经存在（包括
//     用户 /exit 退出的"已结束"session）。claude 会读 jsonl 历史，
//     接受新 user message 继续。-p + stream-json 同样支持 resume。
type Mode int

const (
	ModeNew Mode = iota
	ModeResume
)

type Process struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	events chan []byte
	done   chan struct{}
	mu     sync.Mutex
	closed bool
}

// Start launches the claude binary with the given workdir, session ID, and
// mode. Output is captured line-by-line into the Events channel as raw bytes
// (caller is responsible for protocol.Parse).
//
// If binPath is empty, "claude" is used and the standard Claude CLI flags
// (-p --input-format stream-json --output-format stream-json --verbose)
// are appended, plus either `--session-id <sid>` (ModeNew) or
// `--resume <sid>` (ModeResume). workDir is set via cmd.Dir (Claude CLI
// 没有 --cwd flag，--cwd 是无效 option 会导致进程立即报错退出）。
// -p/--print 是 stream-json 的前提：Input format (only works with --print)。
// If binPath is an explicit path (e.g. /bin/cat in tests), no flags are added
// so the helper binary is invoked as-is.
func Start(workDir, sessionID, binPath string, mode Mode) (*Process, error) {
	var args []string
	if binPath == "" || binPath == "claude" {
		if binPath == "" {
			binPath = "claude"
		}
		base := []string{
			"-p",
			"--input-format", "stream-json",
			"--output-format", "stream-json",
			"--verbose",
		}
		if mode == ModeResume {
			base = append(base, "--resume", sessionID)
		} else {
			base = append(base, "--session-id", sessionID)
		}
		args = base
	}

	// 直接用 exec.Command 启动 claude。binPath 为 "claude" 时通过
	// exec.LookPath 解析绝对路径，避免 Wails app 环境 PATH 不可见问题。
	var cmd *exec.Cmd
	if binPath == "claude" {
		binPath = lookupClaudeBin()
	}
	cmd = exec.Command(binPath, args...)
	cmd.Dir = workDir

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}

	// 捕获 claude 子进程 stderr 到一个日志文件，方便诊断"Ease UI 里
	// 起 claude 产 0 事件但 terminal 裸跑正常"的差异。
	stderrLog, _ := os.Create(fmt.Sprintf("/tmp/claude-stderr-ease-%d.log", time.Now().UnixNano()))
	if stderrLog != nil {
		cmd.Stderr = stderrLog
	}

	p := &Process{
		cmd:    cmd,
		stdin:  stdin,
		events: make(chan []byte, 256),
		done:   make(chan struct{}),
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start %s: %w", binPath, err)
	}

	go p.readLoop(stdout)
	go p.waitLoop()

	return p, nil
}

func (p *Process) Events() <-chan []byte { return p.events }

// PidForTest returns the OS process id. Used by app-level debug logging
// to trace pumpEvents lifecycle (e.g. confirm a claude --resume process
// was actually spawned before the first envelope write).
func (p *Process) PidForTest() int {
	if p.cmd == nil || p.cmd.Process == nil {
		return 0
	}
	return p.cmd.Process.Pid
}

func (p *Process) Write(s string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return fmt.Errorf("process: closed")
	}
	n, err := io.WriteString(p.stdin, s)
	fmt.Fprintf(os.Stderr, "[DBG] proc.Write: n=%d err=%v line=%q\n", n, err, s)
	return err
}

func (p *Process) Close() error {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil
	}
	p.closed = true
	p.mu.Unlock()

	_ = p.stdin.Close()
	if p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
	}
	<-p.done
	return nil
}

func (p *Process) readLoop(r io.Reader) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 64*1024), 10*1024*1024)
	for scanner.Scan() {
		line := make([]byte, len(scanner.Bytes()))
		copy(line, scanner.Bytes())
		select {
		case p.events <- line:
		case <-p.done:
			return
		}
	}
	fmt.Fprintf(os.Stderr, "[DBG] readLoop: scanner done, err=%v\n", scanner.Err())
	close(p.events)
}

func (p *Process) waitLoop() {
	_ = p.cmd.Wait()
	close(p.done)
}

// SendParsed is a convenience that writes a line for Claude's user-message input.
func (p *Process) SendUserPrompt(prompt string) error {
	return p.Write(prompt + "\n")
}

// lookupClaudeBin finds the claude binary. Uses exec.LookPath which searches PATH
// and returns the absolute path, avoiding "command not found" issues in Wails app env.
func lookupClaudeBin() string {
	p, err := exec.LookPath("claude")
	if err != nil {
		return "claude" // fallback
	}
	return p
}

var _ = protocol.EvtMessage
