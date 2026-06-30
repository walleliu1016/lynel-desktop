// Package notify 提供跨平台的用户注意力提示：系统通知 + 平台特定的任务栏/ Dock 提醒。
package notify

import (
	"context"
	"fmt"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Alert 发送一条通知并尝试以非侵入方式提醒用户（任务栏闪烁 / Dock 弹跳）。
// 它不会自动显示主窗口，避免打断用户当前工作。
func Alert(ctx context.Context, title, body string) error {
	// 平台特定的视觉提醒（Windows 任务栏闪烁等）。
	_ = flashAttention(ctx)

	return wailsruntime.SendNotification(ctx, wailsruntime.NotificationOptions{
		ID:    fmt.Sprintf("lynel-alert-%d", time.Now().UnixNano()),
		Title: title,
		Body:  body,
	})
}
