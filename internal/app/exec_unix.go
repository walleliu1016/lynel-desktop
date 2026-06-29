//go:build !windows

package app

import "os/exec"

func hideCmdWindow(cmd *exec.Cmd) {}
