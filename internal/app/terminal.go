package app

import (
	"github.com/akke/ease-ui/internal/session"
	"github.com/akke/ease-ui/internal/terminal"
)

func (a *App) OpenInTerminal(workDir, sessionID, _binPath string) error {
	// 先关闭当前进程（如果有），释放 stream-json 模式的 stdin
	// 所有权，让外部 claude -r 接管 jsonl 追加。
	if s, ok := a.lookupSession(sessionID); ok {
		_ = s.Close()
	}
	a.appMu.RLock()
	bin := a.claudeBin
	if bin == "" {
		bin = a.settings.ClaudePath
	}
	a.appMu.RUnlock()
	if err := a.termLauncher.Launch(workDir, sessionID, bin); err != nil {
		return err
	}
	// 标记 session 进入 Terminal-owned + resume 模式，并把 pidfile 路径
	// 写到 Session，供后续 SwitchOwner 切回 App 时定位外部 claude 进程。
	// pid 暂留 0（外部 shell 还没启动完），SwitchOwner 时会读 pidfile 拿
	// 真实 pid。
	if s, ok := a.lookupSession(sessionID); ok {
		s.SetOwner(session.OwnerTerminal)
		s.SetMode(session.ModeResume)
		s.SetExtPID(0, terminal.PidfilePath(sessionID))
	}
	return nil
}
