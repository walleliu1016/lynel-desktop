package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/akke/ease-ui/internal/app"
	"github.com/akke/ease-ui/internal/single"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/windows/trayicon.ico
var trayIcon []byte

func runApp() error {
	// 单例锁：阻止同一用户同时跑多个 Ease UI 实例。
	// 锁由内核在进程退出时自动释放，强杀也不会留下陈旧锁。
	release, err := single.Acquire()
	if err != nil {
		if errors.Is(err, single.ErrAlreadyRunning) {
			return fmt.Errorf("ease-ui 已在运行（另一个实例持有单例锁，请先关闭）")
		}
		return fmt.Errorf("acquire singleton lock: %w", err)
	}
	defer func() { _ = release() }()

	a, err := app.New(app.Options{})
	if err != nil {
		return err
	}

	err = wails.Run(&options.App{
		Title:             "Lynel Desktop",
		Width:             1280,
		Height:            800,
		MinWidth:          1024,
		MinHeight:         680,
		Frameless:         true,
		HideWindowOnClose:            true,
		EnableDefaultContextMenu:     true,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 0x0A, G: 0x0A, B: 0x0A, A: 1},
		OnStartup: func(ctx context.Context) {
			a.SetContext(ctx)
			a.EnsureHookServer()
			a.StartTray(trayIcon)
			wailsruntime.LogInfo(ctx, "lynel-desktop starting, version "+version)
		},
		OnShutdown: func(ctx context.Context) {
			a.Shutdown()
		},
		Bind: []interface{}{ a },
	})
	return err
}
