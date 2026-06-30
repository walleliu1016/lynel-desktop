//go:build !windows

package notify

import "context"

// flashAttention 在非 Windows 平台暂时仅返回 nil；macOS/Linux 依赖系统通知中心提醒用户。
func flashAttention(_ context.Context) error {
	return nil
}
