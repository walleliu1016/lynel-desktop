//go:build windows

package process

import (
	"os/exec"
	"syscall"
)

// hideWindow 在 Windows GUI 进程下隐藏子进程的控制台窗口，
// 避免 taskkill、powershell 或 claude stream-json 启动时闪出黑色 cmd 窗体。
func hideWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
}
