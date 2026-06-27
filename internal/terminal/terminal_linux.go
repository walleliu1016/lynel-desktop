package terminal

import (
	"fmt"
	"os/exec"
)

func (l *Launcher) buildArgs(workDir, cmd string) []string {
	// Try several terminals in order, fall back to xterm if none found.
	// Caller runs Start so the rest of the args is irrelevant for unit
	// tests; the function returns one set.
	for _, term := range []string{"gnome-terminal", "xterm", "x-terminal-emulator"} {
		if _, err := exec.LookPath(term); err == nil {
			switch term {
			case "gnome-terminal":
				return []string{"gnome-terminal", "--working-directory=" + workDir, "--", "bash", "-c", cmd + "; exec bash"}
			case "xterm":
				return []string{"xterm", "-e", fmt.Sprintf("cd %s && %s; bash", workDir, cmd)}
			default:
				return []string{"x-terminal-emulator", "-e", fmt.Sprintf("cd %s && %s; bash", workDir, cmd)}
			}
		}
	}
	return []string{"xterm", "-e", fmt.Sprintf("cd %s && %s; bash", workDir, cmd)}
}
