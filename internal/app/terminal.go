package app

import "github.com/akke/ease-ui/internal/terminal"

func (a *App) OpenInTerminal(workDir, sessionID, _binPath string) error {
	a.appMu.RLock()
	bin := a.claudeBin
	if bin == "" {
		bin = a.settings.ClaudePath
	}
	a.appMu.RUnlock()
	return terminal.New().Launch(workDir, sessionID, bin)
}
