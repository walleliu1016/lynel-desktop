//go:build windows

package notify

import (
	"context"
	"syscall"
	"unsafe"
)

var (
	user32           = syscall.NewLazyDLL("user32.dll")
	procFindWindowW  = user32.NewProc("FindWindowW")
	procFlashWindowEx = user32.NewProc("FlashWindowEx")
)

const (
	FLASHW_ALL     = 0x00000003
	FLASHW_TIMERNOFG = 0x0000000C
)

type flashWinfo struct {
	cbSize    uint32
	hwnd      uintptr
	dwFlags   uint32
	uCount    uint32
	dwTimeout uint32
}

// flashAttention 通过 FlashWindowEx 让任务栏图标闪烁，提示用户有未处理的权限请求。
func flashAttention(_ context.Context) error {
	hwnd := findWindow("Lynel Desktop")
	if hwnd == 0 {
		return nil
	}
	fi := flashWinfo{
		cbSize:    uint32(unsafe.Sizeof(flashWinfo{})),
		hwnd:      hwnd,
		dwFlags:   FLASHW_ALL | FLASHW_TIMERNOFG,
		uCount:    5,
		dwTimeout: 0,
	}
	procFlashWindowEx.Call(uintptr(unsafe.Pointer(&fi)))
	return nil
}

func findWindow(title string) uintptr {
	p, _ := syscall.UTF16PtrFromString(title)
	hwnd, _, _ := procFindWindowW.Call(0, uintptr(unsafe.Pointer(p)))
	return hwnd
}
