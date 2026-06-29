package main

import (
	"fmt"
	"os"
	"path/filepath"
)

var version = "dev"

func main() {
	redirectStderrToFile()
	if err := runApp(); err != nil {
		fmt.Fprintln(os.Stderr, "ease-ui:", err)
		os.Exit(1)
	}
}

// redirectStderrToFile 将 os.Stderr 重定向到 ~/.ease-app/logs/ease-ui.log，
// 方便 Windows 生产包排查启动阶段问题（GUI 子系统没有 console）。
func redirectStderrToFile() {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	logDir := filepath.Join(home, ".ease-app", "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return
	}
	logPath := filepath.Join(logDir, "ease-ui.log")
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	os.Stderr = f
}
