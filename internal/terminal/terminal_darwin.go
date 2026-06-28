package terminal

import (
	"fmt"
	"os/exec"
)

func (l *Launcher) buildArgs(workDir, cmd, pidfile string) []string {
	// 优先用 iTerm2，其次 Terminal.app，最后用 open 命令
	termApp := "Terminal"
	if _, err := exec.LookPath("iTerm"); err == nil {
		termApp = "iTerm"
	}
	// 在 shell 前缀注入 `echo $$ > <pidfile>`：exec 把 shell 替换为
	// claude 进程，pid 不变。SwitchOwner 用 pidfile 找 pid kill 该进程。
	prefix := fmt.Sprintf("echo $$ > %s && exec", pidfile)
	script := fmt.Sprintf(`
		tell application "%s"
			activate
			do script "%s"
		end tell
	`, termApp, fmt.Sprintf("cd %s && %s %s", workDir, prefix, cmd))
	return []string{"osascript", "-e", script}
}
