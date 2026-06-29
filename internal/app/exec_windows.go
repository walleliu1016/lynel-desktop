//go:build windows

package app

import (
	"os/exec"
	"syscall"
)

// hideCmdWindow 给 exec.Cmd 加上 HideWindow，防止从 GUI 进程调用
// taskkill、powershell 等 console 程序时弹出黑色 cmd 窗口。
func hideCmdWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
}
