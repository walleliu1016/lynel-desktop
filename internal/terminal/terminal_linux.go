package terminal

import (
	"fmt"
	"os/exec"
)

func (l *Launcher) buildArgs(workDir, cmd, pidfile string) []string {
	// 在 shell 前缀注入 `echo $$ > <pidfile>`：exec 把 shell 替换为
	// claude 进程，pid 不变。SwitchOwner 用 pidfile 找 pid kill 该进程。
	prefix := fmt.Sprintf("echo $$ > %s && exec", pidfile)

	// 依次尝试主流终端
	terms := []struct {
		bin  string
		args func() []string
	}{
		{"gnome-terminal", func() []string {
			return []string{"gnome-terminal", "--working-directory=" + workDir, "--", "bash", "-c", prefix + " " + cmd + "; exec bash"}
		}},
		{"konsole", func() []string {
			return []string{"konsole", "--workdir", workDir, "-e", "bash", "-c", prefix + " " + cmd + "; exec bash"}
		}},
		{"xterm", func() []string {
			return []string{"xterm", "-e", fmt.Sprintf("cd %s && %s %s; bash", workDir, prefix, cmd)}
		}},
	}

	for _, t := range terms {
		if _, err := exec.LookPath(t.bin); err == nil {
			return t.args()
		}
	}
	// 兜底：x-terminal-emulator
	return []string{"x-terminal-emulator", "-e", fmt.Sprintf("cd %s && %s %s; bash", workDir, prefix, cmd)}
}
