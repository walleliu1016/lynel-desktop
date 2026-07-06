//go:build windows

package pty

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"

	gopty "github.com/aymanbagabas/go-pty"
)

func startTTY(cmd *exec.Cmd, size Size, env []string) (TTY, error) {
	tty, err := gopty.New()
	if err != nil {
		return nil, fmt.Errorf("windows conpty: %w", err)
	}

	// 设置初始终端大小
	if err := tty.Resize(size.Cols, size.Rows); err != nil {
		tty.Close()
		return nil, fmt.Errorf("resize: %w", err)
	}

	// 将命令附加到 PTY
	c := tty.Command(cmd.Path)
	c.Args = cmd.Args
	c.Dir = cmd.Dir
	c.Env = append(os.Environ(), "TERM=xterm-256color")
	c.Env = append(c.Env, env...)

	// 隐藏 Windows 控制台窗口
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	if err := c.Start(); err != nil {
		tty.Close()
		return nil, fmt.Errorf("start claude: %w", err)
	}

	// 将 gopty.Cmd 的 Process 引用复制到 exec.Cmd（用于 Kill/Wait/Pid）
	cmd.Process = c.Process

	return tty, nil
}
