package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/akke/ease-ui/internal/hookserver"
)

// EnsureHookServer 启动本地 hook HTTP server 并配置 settings.json。
func (a *App) EnsureHookServer() {
	a.hookMu.Lock()
	if a.hookSrv != nil {
		a.hookMu.Unlock()
		return
	}
	a.hookSrv = hookserver.New()
	port, err := a.hookSrv.Start()
	if err != nil {
		fmt.Fprintf(os.Stderr, "ease-ui: hook server failed to start: %v\n", err)
		a.hookMu.Unlock()
		return
	}
	a.hookPort = port

	// POST /api/send → 写入对应 session 的 claude stdin
	a.hookSrv.OnSend(func(req hookserver.SendRequest) error {
		return a.SendMessage(req.SessionID, req.Prompt)
	})

	// 收到 hook 事件 → 通知前端 + 持久化到 instance.json
	a.hookSrv.OnEvent(func(evt hookserver.HookEvent) {
		if a.ctx != nil && evt.SessionID != "" {
			payload, _ := json.Marshal(evt)
			wailsruntime.EventsEmit(a.ctx, "hook:"+evt.SessionID, string(payload))
			if evt.Type == "SessionEnd" {
				a.inst.Put(evt.SessionID, "done")
			} else {
				a.inst.Put(evt.SessionID, "running")
			}
		}
	})

	// 空闲检测：每分钟检查，超 5 分钟无事件 → idle + 持久化
	go func() {
		tick := time.NewTicker(1 * time.Minute)
		defer tick.Stop()
		for range tick.C {
			a.hookMu.RLock()
			srv := a.hookSrv
			a.hookMu.RUnlock()
			if srv == nil || a.ctx == nil {
				continue
			}
			now := time.Now()
			a.appMu.RLock()
			for id := range a.sessions {
				t := srv.LastSeen(id)
				if !t.IsZero() && now.Sub(t) > 5*time.Minute {
					wailsruntime.EventsEmit(a.ctx, "hook:"+id, `{"type":"idle_timeout"}`)
					a.inst.Put(id, "idle")
				}
			}
			a.appMu.RUnlock()
		}
	}()

	// 释放 hookMu 再调 CheckAndFixHooks —— 它内部要 RLock 这把锁
	// 取 port，未释放就 RLock 会自死锁。
	a.hookMu.Unlock()

	// 自动修复 settings.json 的 hooks 配置
	needsFix, fixed, fixErr := a.CheckAndFixHooks()
	if needsFix && fixed {
		fmt.Fprintf(os.Stderr, "ease-ui: hooks configured for http://localhost:%d/hook\n", port)
	} else if fixErr != nil {
		fmt.Fprintf(os.Stderr, "ease-ui: hooks fix failed: %v (url=:%d)\n", fixErr, port)
	}
}

// GetHookServerPort 返回 hook server 端口（0 表示未启动）。
func (a *App) GetHookServerPort() int {
	a.hookMu.RLock()
	defer a.hookMu.RUnlock()
	return a.hookPort
}

// HookServerURL 返回 hook server 的完整 URL。
func (a *App) HookServerURL() string {
	return fmt.Sprintf("http://localhost:%d/hook", a.GetHookServerPort())
}

// sessionStartScriptUnix 生成 Unix (macOS/Linux) SessionStart 脚本。
func sessionStartScriptUnix(hookURL string) string {
	return fmt.Sprintf(`#!/bin/bash
# Ease UI SessionStart hook — 转发到 hook server
INPUT=$(cat)
curl -s -X POST %s -H "Content-Type: application/json" -d "$INPUT" > /dev/null 2>&1
`, hookURL)
}

// sessionStartScriptWin 生成 Windows SessionStart PowerShell 脚本。
func sessionStartScriptWin(hookURL string) string {
	return fmt.Sprintf(`<#
.SYNOPSIS Ease UI SessionStart hook — 转发到 hook server
#>
$headers = @{ "Content-Type" = "application/json" }
try {
	if ([Console]::IsInputRedirected) {
		$jsonInput = [Console]::In.ReadToEnd()
	} else {
		$jsonInput = '{"hook_event_name":"SessionStart"}'
	}
	Invoke-RestMethod -Uri "%s" -Method POST -Headers $headers -Body $jsonInput -ErrorAction SilentlyContinue | Out-Null
} catch { }
`, hookURL)
}

// ensureSessionStartScript 创建平台对应的 SessionStart 脚本并设为可执行。
// 返回 hook command 字符串（settings.json 中使用的值）。
func ensureSessionStartScript(hookURL string) (command string, err error) {
	easeDir := filepath.Join(userHome(), ".ease-app")
	if err := os.MkdirAll(easeDir, 0o755); err != nil {
		return "", err
	}
	if runtime.GOOS == "windows" {
		scriptPath := filepath.Join(easeDir, "session-start.ps1")
		if err := os.WriteFile(scriptPath, []byte(sessionStartScriptWin(hookURL)), 0o644); err != nil {
			return "", err
		}
		// Windows: 用 powershell 执行脚本
		return "powershell -NoProfile -ExecutionPolicy Bypass -Command . $HOME\\.ease-app\\session-start.ps1", nil
	}
	// Unix (macOS/Linux)
	scriptPath := filepath.Join(easeDir, "session-start.sh")
	if err := os.WriteFile(scriptPath, []byte(sessionStartScriptUnix(hookURL)), 0o755); err != nil {
		return "", err
	}
	return "~/.ease-app/session-start.sh", nil
}

// CheckAndFixHooks 检查并修复 settings.json 的 hooks 配置。
func (a *App) CheckAndFixHooks() (needsFix bool, fixed bool, err error) {
	port := a.GetHookServerPort()
	if port == 0 {
		return false, false, fmt.Errorf("hook server not running")
	}

	p := filepath.Join(userHome(), ".claude", "settings.json")
	raw, err := os.ReadFile(p)
	if err != nil && !os.IsNotExist(err) {
		return false, false, err
	}

	var data map[string]json.RawMessage
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &data); err != nil {
			return false, false, fmt.Errorf("parse settings.json: %w", err)
		}
	}
	if data == nil {
		data = map[string]json.RawMessage{}
	}

	var hooksObj map[string]json.RawMessage
	if rawHooks, ok := data["hooks"]; ok {
		if err := json.Unmarshal(rawHooks, &hooksObj); err != nil {
			hooksObj = map[string]json.RawMessage{}
		}
	}
	if hooksObj == nil {
		hooksObj = map[string]json.RawMessage{}
	}

	hookURL := a.HookServerURL()

	// SessionStart 专用脚本（Claude 不支持 HTTP 类型的 SessionStart hook）
	scriptPath, err := ensureSessionStartScript(hookURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ease-ui: session start script failed: %v\n", err)
	}

	// HTTP 类型的 hook（除 SessionStart 外）
	hookTypes := map[string]int{
		"Notification":      120,
		"PermissionRequest": 300,
		"PreToolUse":         5,
		"PostToolUse":        5,
		"PostToolUseFailure": 5,
		"PostCompact":        5,
		"PreCompact":         5,
		"SessionEnd":         5,
		"Stop":               5,
		"SubagentStart":      5,
		"SubagentStop":       5,
		"UserPromptSubmit":   5,
	}

	changed := false
	for name, timeout := range hookTypes {
		expected := json.RawMessage(fmt.Sprintf(
			`[{"hooks":[{"type":"http","url":"%s","timeout":%d}]}]`,
			hookURL, timeout,
		))
		hooksObj[name] = expected
		changed = true
	}

	// SessionStart 用 command 类型 + 脚本（平台自适应）
	if scriptPath != "" {
		hooksObj["SessionStart"] = json.RawMessage(fmt.Sprintf(
			`[{"hooks":[{"type":"command","command":"%s","timeout":5}]}]`,
			scriptPath,
		))
		changed = true
	}

	if changed {
		newHooks, _ := json.Marshal(hooksObj)
		data["hooks"] = newHooks
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return true, false, err
		}
		// 备份旧文件
		if _, err := os.Stat(p); err == nil {
			os.Rename(p, p+".ease-ui.bak")
		}
		out, _ := json.MarshalIndent(data, "", "  ")
		if err := os.WriteFile(p, out, 0o644); err != nil {
			return true, false, err
		}
		return true, true, nil
	}
	return false, false, nil
}

func userHome() string {
	h, _ := os.UserHomeDir()
	return h
}
