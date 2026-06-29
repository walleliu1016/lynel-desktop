package terminal

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
)

func (l *Launcher) buildArgs(workDir, cmd, _pidfile string) []string {
	// Windows batch 没有 $$ 语法拿当前 pid，依赖 app 层 SwitchOwner 走
	// taskkill by pattern 的兜底路径，所以这里忽略 pidfile 参数。
	//
	// 关键：workDir 如果以反斜杠结尾，加引号后会变成 "C:\dir\"，cmd
	// 会把尾部的 \" 解析为转义引号，导致引号不匹配、命令解析错误。
	// 因此传入 start /D 或 wt --startingDirectory 前必须去掉末尾反斜杠
	//（根目录 C:\ 除外）。
	workDir = sanitizeDirForStart(workDir)

	// 把裸 "claude" 解析成 PATH 中的绝对路径，避免 Wails GUI 进程
	// 的 PATH 与 shell PATH 不一致导致找不到二进制。
	cmd = resolveClaudeInCmd(cmd)

	parts := strings.SplitN(cmd, " --resume ", 2)
	if len(parts) != 2 {
		// fallback：直接启动命令
		return []string{"cmd", "/c", "start", `"Claude"`, "/D", workDir, cmd}
	}
	binPath := strings.Trim(parts[0], `"`)
	sessionID := parts[1]

	// 优先用 Windows Terminal (wt)，体验最好。
	if _, err := exec.LookPath("wt"); err == nil {
		return []string{
			"wt", "-w", "0", "nt",
			"--title", "Claude",
			"--startingDirectory", workDir,
			binPath, "--resume", sessionID,
		}
	}

	// 兜底：用 start 命令直接启动 claude，不经过多余的 cmd /k，
	// 避免终端里先弹出一个 cmd 提示符。
	// title 必须带引号，否则 start 会把 "Claude" 当成要运行的程序名，
	// 导致 /D 等参数被直接传给 claude 成为输入。
	return []string{"cmd", "/c", "start", `"Claude"`, "/D", workDir, binPath, "--resume", sessionID}
}

// setNewConsole 在 macOS/Linux 上需要平台实现；Windows 的 start/wt
// 已经负责创建新控制台窗口，这里为空实现。
func setNewConsole(cmd *exec.Cmd) {}

// newExecCmd 在 Windows 上组装 exec.Cmd。
// 对 cmd /c start 兜底路径，我们绕过 Go 的 CommandLineToArgv 转义，
// 直接构造原始命令行，确保 start 看到的 title、/D 和 program 引号
// 都是 cmd 原生命令解析器能识别的形式，避免 Go 的 \" 转义被 cmd 误读。
func newExecCmd(args []string, workDir string) *exec.Cmd {
	if len(args) >= 6 && args[0] == "cmd" && args[1] == "/c" && args[2] == "start" && args[4] == "/D" {
		title := args[3]
		startDir := args[5]
		rest := args[6:]
		restQuoted := make([]string, len(rest))
		for i, a := range rest {
			restQuoted[i] = quoteCmdArg(a)
		}
		cmdLine := fmt.Sprintf("cmd /c start %s /D %s %s", title, quoteCmdArg(startDir), strings.Join(restQuoted, " "))
		cmdPath := os.Getenv("COMSPEC")
		if cmdPath == "" {
			cmdPath = `C:\Windows\System32\cmd.exe`
		}
		return &exec.Cmd{
			Path: cmdPath,
			Args: []string{"cmd", "/c", "start"},
			Dir:  workDir,
			SysProcAttr: &syscall.SysProcAttr{
				CmdLine: cmdLine,
			},
		}
	}

	cmd := exec.Command(args[0], args[1:]...)
	cmd.Dir = workDir
	return cmd
}

// quoteCmdArg 为 cmd 命令行参数包裹双引号（仅当需要时），并把内部的双引号转义成两个。
// start 对带空格的 /D 路径或 program 路径需要引号；普通参数如 --resume、sid 不加引号，
// 避免 start 把整段带引号的内容当成一个命令名。
func quoteCmdArg(s string) string {
	if !strings.ContainsAny(s, " \"") {
		return s
	}
	s = strings.ReplaceAll(s, "\"", "\"\"")
	return fmt.Sprintf("\"%s\"", s)
}

// sanitizeDirForStart 去掉目录末尾的反斜杠，避免 cmd 引号转义问题。
// 根目录（如 C:\）保持不变。
func sanitizeDirForStart(dir string) string {
	dir = strings.TrimSuffix(dir, "\\")
	if len(dir) == 2 && dir[1] == ':' {
		return dir + "\\"
	}
	return dir
}

// resolveClaudeInCmd 把 cmd 字符串中的裸 "claude" 解析为绝对路径。
func resolveClaudeInCmd(cmd string) string {
	parts := strings.SplitN(cmd, " --resume ", 2)
	if len(parts) != 2 {
		return cmd
	}
	binPath := strings.Trim(parts[0], `"`)
	if binPath == "" || binPath == "claude" {
		if p, err := exec.LookPath("claude"); err == nil {
			binPath = p
		}
	}
	return fmt.Sprintf(`"%s" --resume %s`, binPath, parts[1])
}
