package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/akke/ease-ui/internal/hookserver"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// EnsureHookServer 启动本地 hook HTTP server 并配置 settings.json。
func (a *App) EnsureHookServer() {
	a.hookMu.Lock()
	if a.hookSrv != nil {
		a.hookMu.Unlock()
		return
	}
	a.hookSrv = hookserver.New()
	a.hookSrv.SetStore(a.apiStore)
	port, err := a.hookSrv.Start()
	if err != nil {
		fmt.Fprintf(os.Stderr, "ease-ui: hook server failed to start: %v\n", err)
		a.hookMu.Unlock()
		return
	}
	a.hookPort = port

	// POST /api/send → 写入对应 session 的 claude stdin
	a.hookSrv.OnSend(a.SendMessageFromHTTP)

	// 收到 hook 事件 → 通知前端 + 持久化到 instance.json
	a.hookSrv.OnEvent(func(evt hookserver.HookEvent) {
		tp := evt.EventType()
		fmt.Fprintf(os.Stderr, "[DBG] hookserver event: type=%s sid=%s hook=%s tool=%s\n",
			tp, evt.SessionID, evt.HookName, evt.Tool)
		if a.ctx != nil && evt.SessionID != "" {
			// SessionStart：Claude 返回真实 UUID，通知等待中的 CreateSession
			if tp == "SessionStart" {
				fmt.Fprintf(os.Stderr, "[DBG] hookserver: delivering SessionStart id=%s\n", evt.SessionID)
				deliverSessionID(evt.SessionID)
			}
			payload, _ := json.Marshal(evt)
			wailsruntime.EventsEmit(a.ctx, "hook:"+evt.SessionID, string(payload))
			if tp == "SessionEnd" {
				a.inst.Put(evt.SessionID, "done")
			} else {
				a.inst.Put(evt.SessionID, "running")
			}
		}
	})

	// PermissionRequest 阻塞型 hook：推给前端弹窗，等待用户决策。
	a.hookSrv.OnPermissionRequest(a.handlePermissionRequest)

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
# Ease UI SessionStart hook
# Forwards session start event to Ease UI HTTP server
INPUT=$(cat)
curl -s -X POST %s \
  -H "Content-Type: application/json" \
  -d "$INPUT" \
  > /dev/null 2>&1
`, hookURL)
}

// sessionStartScriptWin 生成 Windows SessionStart PowerShell 脚本。
func sessionStartScriptWin(hookURL string) string {
	return fmt.Sprintf(`<#
.SYNOPSIS
    Ease UI SessionStart hook
.DESCRIPTION
    Forwards session start event to Ease UI HTTP server with user account header
#>

$headers = @{
    "Content-Type" = "application/json"
    "X-UM-ACCOUNT" = "$env:USERNAME"
}

# Read stdin JSON, construct fallback if unavailable.
# Claude CLI forwards the hook payload via stdin. Do not gate on
# [Console]::IsInputRedirected: it returns false when PowerShell is invoked
# via -Command, causing the real session_id to be lost and CreateSession to
# timeout on Windows.
$jsonInput = $null
try {
    $jsonInput = [System.Console]::In.ReadToEnd()
} catch {
    # stdin not available
}
if (-not $jsonInput) {
    $jsonInput = '{"hook_event_name":"SessionStart"}'
}

try {
    Invoke-RestMethod -Uri "%s" -Method POST -Headers $headers -Body $jsonInput -ErrorAction SilentlyContinue | Out-Null
} catch {
    # Ignore errors silently
}
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
		// Windows: 用 powershell 执行脚本（PowerShell 支持正斜杠路径，避免反斜杠转义问题）
		return "powershell -NoProfile -ExecutionPolicy Bypass -Command . $HOME/.ease-app/session-start.ps1", nil
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
		fmt.Fprintf(os.Stderr, "ease-ui: read settings.json failed: %v\n", err)
		return false, false, err
	}
	if len(raw) == 0 {
		fmt.Fprintf(os.Stderr, "ease-ui: settings.json empty/missing, will create\n")
	}

	var data map[string]json.RawMessage
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &data); err != nil {
			fmt.Fprintf(os.Stderr, "ease-ui: parse settings.json failed: %v\n", err)
			return false, false, fmt.Errorf("parse settings.json: %w", err)
		}
	}
	if data == nil {
		data = map[string]json.RawMessage{}
	}

	var hooksObj map[string]json.RawMessage
	if rawHooks, ok := data["hooks"]; ok {
		fmt.Fprintf(os.Stderr, "ease-ui: existing hooks raw=%s\n", string(rawHooks))
		if err := json.Unmarshal(rawHooks, &hooksObj); err != nil {
			fmt.Fprintf(os.Stderr, "ease-ui: hooks unmarshal failed (%v), resetting\n", err)
			hooksObj = map[string]json.RawMessage{}
		}
	} else {
		fmt.Fprintf(os.Stderr, "ease-ui: settings.json has no hooks key\n")
	}
	if hooksObj == nil {
		fmt.Fprintf(os.Stderr, "ease-ui: hooks is null, will initialize\n")
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
		"Notification":       120,
		"PermissionRequest":  300,
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

	urlJSON, _ := json.Marshal(hookURL)
	cmdJSON, _ := json.Marshal(scriptPath)

	changed := false
	for name, timeout := range hookTypes {
		// HTTP hooks 使用最简格式：只保留 timeout/type/url。
		expected := json.RawMessage(fmt.Sprintf(
			`[{"hooks":[{"type":"http","url":%s,"timeout":%d}]}]`,
			string(urlJSON), timeout,
		))
		hooksObj[name] = expected
		changed = true
	}

	// SessionStart 用 command 类型 + 脚本（平台自适应），保持原有格式不变。
	if scriptPath != "" {
		hooksObj["SessionStart"] = json.RawMessage(fmt.Sprintf(
			`[{"matcher":"","hooks":[{"type":"command","command":%s,"timeout":5}]}]`,
			string(cmdJSON),
		))
		changed = true
	}

	if changed {
		newHooks, err := json.Marshal(hooksObj)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ease-ui: marshal hooks failed: %v\n", err)
			return true, false, err
		}
		data["hooks"] = newHooks
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			fmt.Fprintf(os.Stderr, "ease-ui: mkdir settings.json parent failed: %v\n", err)
			return true, false, err
		}
		// 备份旧文件
		if _, err := os.Stat(p); err == nil {
			if err := os.Rename(p, p+".ease-ui.bak"); err != nil {
				fmt.Fprintf(os.Stderr, "ease-ui: backup settings.json failed: %v\n", err)
			}
		}
		out, _ := json.MarshalIndent(data, "", "  ")
		fmt.Fprintf(os.Stderr, "ease-ui: writing settings.json hooks=%s\n", string(newHooks))
		if err := os.WriteFile(p, out, 0o644); err != nil {
			fmt.Fprintf(os.Stderr, "ease-ui: write settings.json failed: %v\n", err)
			return true, false, err
		}
		fmt.Fprintf(os.Stderr, "ease-ui: settings.json updated\n")
		return true, true, nil
	}
	fmt.Fprintf(os.Stderr, "ease-ui: settings.json hooks already OK\n")
	return false, false, nil
}

func userHome() string {
	h, _ := os.UserHomeDir()
	return h
}

// handlePermissionRequest 处理阻塞型 PermissionRequest hook。
// 它向前端发送 permission:request 事件并阻塞等待用户决策，超时后默认拒绝。
func (a *App) handlePermissionRequest(evt hookserver.HookEvent) (any, error) {
	a.permMu.Lock()
	a.permCounter++
	reqID := fmt.Sprintf("perm-%d-%d", time.Now().UnixNano(), a.permCounter)
	ch := make(chan map[string]any, 1)
	a.permPending[reqID] = &permWaiter{ch: ch, sessionID: evt.SessionID}
	a.permMu.Unlock()

	toolName := evt.EffectiveToolName()
	toolInput := evt.EffectiveToolInput()
	payload, _ := json.Marshal(map[string]any{
		"requestId": reqID,
		"sessionId": evt.SessionID,
		"toolName":  toolName,
		"toolInput": toolInput,
	})
	if a.ctx != nil {
		wailsruntime.EventsEmit(a.ctx, "permission:request", string(payload))
		// 不自动弹出主窗口，仅通过通知 + 任务栏闪烁提醒用户。
		_ = a.AlertPermission(
			"Lynel Desktop · 权限请求",
			"Claude 请求使用 "+toolName+"，点击处理",
		)
	}

	select {
	case decision := <-ch:
		return map[string]any{
			"hookSpecificOutput": map[string]any{
				"hookEventName": "PermissionRequest",
				"decision":      decision,
			},
		}, nil
	case <-time.After(5 * time.Minute):
		a.permMu.Lock()
		delete(a.permPending, reqID)
		a.permMu.Unlock()
		return map[string]any{
			"hookSpecificOutput": map[string]any{
				"hookEventName": "PermissionRequest",
				"decision": map[string]any{
					"behavior": "deny",
					"message":  "timeout",
				},
			},
		}, nil
	}
}
