// Package tray 为 Lynel Desktop 提供系统托盘图标与右键菜单。
// 它基于 fyne-io/systray，在 Wails 主窗口隐藏后仍保持应用在任务栏/菜单栏可见。
package tray

import (
	"context"

	"fyne.io/systray"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Manager 管理托盘生命周期与菜单事件。
type Manager struct {
	ctx  context.Context
	icon []byte
}

// New 创建一个未初始化的托盘管理器。
func New() *Manager {
	return &Manager{}
}

// Start 在独立 goroutine 中启动托盘图标。
// icon 应为 PNG 格式，建议 16×16 或 32×32。
func (m *Manager) Start(ctx context.Context, icon []byte) {
	m.ctx = ctx
	m.icon = icon
	go systray.Run(m.onReady, m.onExit)
}

// Quit 停止托盘图标。
func (m *Manager) Quit() {
	systray.Quit()
}

func (m *Manager) onReady() {
	systray.SetIcon(m.icon)
	systray.SetTooltip("Lynel Desktop")

	showItem := systray.AddMenuItem("显示 Lynel Desktop", "显示主窗口")
	settingsItem := systray.AddMenuItem("设置", "打开设置")
	systray.AddSeparator()
	quitItem := systray.AddMenuItem("退出", "退出应用")

	// 左键单击托盘图标也显示窗口
	systray.SetOnTapped(m.showWindow)

	go func() {
		for {
			select {
			case <-showItem.ClickedCh:
				m.showWindow()
			case <-settingsItem.ClickedCh:
				m.openSettings()
			case <-quitItem.ClickedCh:
				wailsruntime.Quit(m.ctx)
			}
		}
	}()
}

func (m *Manager) onExit() {}

func (m *Manager) showWindow() {
	wailsruntime.WindowShow(m.ctx)
	wailsruntime.WindowUnminimise(m.ctx)
}

func (m *Manager) openSettings() {
	wailsruntime.EventsEmit(m.ctx, "tray:open-settings")
	m.showWindow()
}
