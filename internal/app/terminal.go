package app

import (
	"fmt"
	"os"

	"github.com/akke/ease-ui/internal/session"
	"github.com/akke/ease-ui/internal/terminal"
)

func (a *App) OpenInTerminal(workDir, sessionID, _binPath string) error {
	fmt.Fprintf(os.Stderr, "[DBG] OpenInTerminal: workDir=%s sessionID=%s\n", workDir, sessionID)
	// 历史 session 可能还没 adopt 进 a.sessions，先确保注册，否则后续
	// SwitchOwner 切回 App 时会报 session not found。
	if _, ok := a.lookupSession(sessionID); !ok {
		fmt.Fprintf(os.Stderr, "[DBG] OpenInTerminal: adopting sid=%s before launch\n", sessionID)
		if err := a.AdoptSession(sessionID, workDir); err != nil {
			return err
		}
	}
	// 先关闭当前进程（如果有），释放 stream-json 模式的 stdin
	// 所有权，让外部 claude --resume 接管 jsonl 追加。
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
		fmt.Fprintf(os.Stderr, "[DBG] OpenInTerminal: Launch failed: %v\n", err)
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
