// Package terminal launches the system terminal with a claude -r command.
package terminal

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func ResumeCommand(sessionID, binPath string) string {
	if binPath == "" {
		binPath = "claude"
	}
	return fmt.Sprintf("%s -r %s", binPath, sessionID)
}

// PidfilePath 生成 Ease UI 用于记录外部 claude 进程 pid 的临时文件路径。
// 各平台 launch 完成后会用 `echo $$ > <pidfile>` 把 shell 自身的 pid 写入
// 该文件（`exec claude -r` 之后 shell 被替换为 claude 进程，pid 保持不变）。
// 调用方拿到路径后用于切回 App 时定位并 kill 该进程。
func PidfilePath(sessionID string) string {
	return filepath.Join(os.TempDir(), fmt.Sprintf("ease-ui-%s.pid", sessionID))
}

type Launcher struct {
	// lastPIDFile 记录最近一次 Launch 写入的 pidfile 路径。
	// Windows 平台 launch 不写 pidfile（依赖 taskkill by pattern 兜底），
	// 该字段保持空串。app 层在切回 App 时读这个字段以决定走 pidfile
	// kill 还是 pkill/taskkill 兜底。
	lastPIDFile string
}

func New() *Launcher { return &Launcher{} }

// LastPIDFile 返回最近一次 Launch 写入的 pidfile 路径，没写过则空串。
func (l *Launcher) LastPIDFile() string { return l.lastPIDFile }

// Launch spawns the system terminal running claude -r in the given workdir.
// macOS/Linux 会在外部 shell 里注入 `echo $$ > <pidfile>`，便于后续切回
// App 时精准 kill 该进程；Windows 平台依赖 buildArgs 内部忽略 pidfile
// 参数，调用方需走 taskkill by pattern 的兜底路径。
func (l *Launcher) Launch(workDir, sessionID, binPath string) error {
	pidfile := PidfilePath(sessionID)
	l.lastPIDFile = pidfile
	cmdStr := ResumeCommand(sessionID, binPath)
	args := l.buildArgs(workDir, cmdStr, pidfile)
	cmd := exec.Command(args[0], args[1:]...)
	return cmd.Start()
}
