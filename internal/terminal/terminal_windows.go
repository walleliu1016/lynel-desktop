package terminal

import (
	"fmt"
	"os/exec"
)

func (l *Launcher) buildArgs(workDir, cmd, _pidfile string) []string {
	// Windows batch 没有 $$ 语法拿当前 pid，依赖 app 层 SwitchOwner 走
	// taskkill by pattern 的兜底路径，所以这里忽略 pidfile 参数。
	// 优先用 Windows Terminal (wt)，其次用 cmd
	if _, err := exec.LookPath("wt"); err == nil {
		return []string{
			"wt", "-w", "0", "nt",
			"--title", "Claude",
			"--startingDirectory", workDir,
			"cmd", "/k", cmd,
		}
	}
	return []string{"cmd", "/c", "start", "Claude", "cmd", "/k",
		fmt.Sprintf("cd /d %s && %s", workDir, cmd)}
}
