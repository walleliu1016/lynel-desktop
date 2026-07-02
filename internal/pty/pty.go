// Package pty wraps a cross-platform pseudo-terminal for running Claude CLI
// in interactive mode (without -p flag), capturing raw ANSI output.
package pty

import (
	"fmt"
	"os/exec"
)

// Mode mirrors process.Mode for backward compatibility.
type Mode int

const (
	ModeAuto   Mode = iota // no session flag, Claude generates UUID
	ModeNew                // --session-id <sid>
	ModeResume             // --resume <sid>
)

// Proc wraps a PTY-attached command.
type Proc struct {
	cmd *exec.Cmd
	tty TTY
}

// TTY is the platform-specific PTY interface.
type TTY interface {
	Read(p []byte) (int, error)
	Write(p []byte) (int, error)
	Resize(cols, rows int) error
	Close() error
}

// Start launches claude in a PTY with the given workdir and session mode.
// binPath should be "claude" or an absolute path to the claude binary.
func Start(workDir, sessionID, binPath string, mode Mode) (*Proc, error) {
	if binPath == "" || binPath == "claude" {
		binPath = lookupClaudeBin()
	}

	args := buildArgs(sessionID, mode)

	cmd := exec.Command(binPath, args...)
	cmd.Dir = workDir

	tty, err := startTTY(cmd)
	if err != nil {
		return nil, fmt.Errorf("pty start: %w", err)
	}

	return &Proc{cmd: cmd, tty: tty}, nil
}

func (p *Proc) Read(b []byte) (int, error) { return p.tty.Read(b) }

// Write 实现 session.ProcessIface（string → []byte 转换）。
func (p *Proc) Write(s string) error {
	_, err := p.tty.Write([]byte(s))
	return err
}

func (p *Proc) Resize(cols, rows int) error { return p.tty.Resize(cols, rows) }
func (p *Proc) Close() error {
	err := p.tty.Close()
	if p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
		_, _ = p.cmd.Process.Wait()
	}
	return err
}

// Pid returns the OS process ID.
func (p *Proc) Pid() int {
	if p.cmd.Process != nil {
		return p.cmd.Process.Pid
	}
	return 0
}

func buildArgs(sessionID string, mode Mode) []string {
	switch mode {
	case ModeResume:
		return []string{"--resume", sessionID}
	case ModeNew:
		return []string{"--session-id", sessionID}
	default: // ModeAuto: no session flag
		return nil
	}
}

func lookupClaudeBin() string {
	p, err := exec.LookPath("claude")
	if err != nil {
		return "claude"
	}
	return p
}
