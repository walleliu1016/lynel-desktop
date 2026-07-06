//go:build !windows

package pty

import (
	"fmt"
	"os"
	"os/exec"

	gopty "github.com/aymanbagabas/go-pty"
)

func startTTY(cmd *exec.Cmd, size Size, env []string) (TTY, error) {
	tty, err := gopty.New()
	if err != nil {
		return nil, fmt.Errorf("unix pty: %w", err)
	}

	if err := tty.Resize(size.Cols, size.Rows); err != nil {
		tty.Close()
		return nil, fmt.Errorf("resize: %w", err)
	}

	c := tty.Command(cmd.Path)
	c.Args = cmd.Args
	c.Dir = cmd.Dir
	c.Env = append(os.Environ(), "TERM=xterm-256color")
	c.Env = append(c.Env, env...)

	if err := c.Start(); err != nil {
		tty.Close()
		return nil, fmt.Errorf("start claude: %w", err)
	}

	// 将 gopty.Cmd 的 Process 引用复制到 exec.Cmd（用于 Kill/Wait/Pid）
	cmd.Process = c.Process

	return tty, nil
}
