// Package app is the Wails binding layer. It is the only package exposed
// to the frontend via JSON-RPC bindings.
package app

import (
	"context"
	"sync"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/akke/ease-ui/internal/auth"
	"github.com/akke/ease-ui/internal/events"
	"github.com/akke/ease-ui/internal/hooks"
	"github.com/akke/ease-ui/internal/hookserver"
	"github.com/akke/ease-ui/internal/instance"
	"github.com/akke/ease-ui/internal/jsonl"
	"github.com/akke/ease-ui/internal/session"
	"github.com/akke/ease-ui/internal/settings"
	"github.com/akke/ease-ui/internal/terminal"
)

type Options struct {
	AuthPath  string
	ConfigDir string
	ClaudeDir string
}

type App struct {
	opts      Options
	auth      *auth.Auth
	settings  *settings.Config
	handler   *hooks.Handler
	appMu     sync.RWMutex
	sessions  map[string]*session.Session
	bus       *events.Bus
	claudeBin string
	ctx       context.Context
	hookSrv   *hookserver.Server
	hookMu    sync.RWMutex
	hookPort  int
	inst         *instance.Store
	watcher      *fsWatcher
	debounceMu   sync.Mutex
	debounceT    *time.Timer
	// termLauncher 跨 OpenInTerminal/SwitchOwner 调用持久化，保留最近
	// 一次 Launch 的 pidfile 路径供切回时使用。
	termLauncher *terminal.Launcher
	// hookPermission 存储阻塞中的 PermissionRequest 决策通道。
	permMu      sync.Mutex
	permPending map[string]*permWaiter
	permCounter uint64
}

type permWaiter struct {
	ch        chan map[string]any
	sessionID string
}

// fsWatcher wraps the jsonl fsnotify watcher; debouncing is handled
// by debounceSessionsChanged.
type fsWatcher struct {
	close func() error
}

// SetContext stores the Wails runtime context for later use
// (e.g. EventsEmit). Called from OnStartup.
func (a *App) SetContext(ctx context.Context) {
	a.ctx = ctx
}

func New(opts Options) (*App, error) {
	if opts.AuthPath != "" {
		auth.SetPath(opts.AuthPath)
	}
	if opts.ConfigDir != "" {
		settings.SetPath(opts.ConfigDir + "/config.json")
		hooks.SetPath(opts.ConfigDir + "/.claude/settings.json")
	}
	if opts.ClaudeDir != "" {
		jsonl.SetRoot(opts.ClaudeDir + "/projects")
	}
	a, err := auth.New()
	if err != nil {
		return nil, err
	}
	cfg, err := settings.Load()
	if err != nil {
		return nil, err
	}
	// 确保 settings.json 存在（首次运行时自动创建默认配置）
	_ = settings.Save(cfg)
	inst, _ := instance.Load()

	app := &App{
		opts:     opts,
		auth:     a,
		settings: cfg,
		handler:  hooks.NewHandler(cfg.AutoAllowBash),
		bus:      events.NewBus(),
		sessions: map[string]*session.Session{},
		inst:     inst,
		termLauncher: terminal.New(),
		permPending: map[string]*permWaiter{},
	}

	// 启动 jsonl 监听，事件去抖后通过 Wails 推给前端
	app.startWatcher()

	return app, nil
}

// startWatcher 启动 fsnotify 监听 ~/.claude/projects，文件变化（去抖 500ms）
// 后通过 "sessions:list:changed" 事件推给前端，触发列表刷新。
func (a *App) startWatcher() {
	w, err := jsonl.WatchProjects(a.scheduleSessionsEmit)
	if err != nil {
		return
	}
	a.watcher = &fsWatcher{close: w.Close}
}

var sessionsDebounceInterval = 500 * time.Millisecond

// scheduleSessionsEmit 实现真正的去抖：每个事件都 reset 同一个 timer，
// 直到 500ms 内没有新事件才真正触发 emit。
func (a *App) scheduleSessionsEmit() {
	a.debounceMu.Lock()
	if a.debounceT != nil {
		a.debounceT.Stop()
	}
	a.debounceT = time.AfterFunc(sessionsDebounceInterval, a.emitSessionsChanged)
	a.debounceMu.Unlock()
}

func (a *App) emitSessionsChanged() {
	a.appMu.RLock()
	ctx := a.ctx
	a.appMu.RUnlock()
	if ctx == nil {
		return
	}
	wailsruntime.EventsEmit(ctx, "sessions:list:changed")
}

// Shutdown stops background goroutines and releases file watchers.
func (a *App) Shutdown() {
	if a.watcher != nil && a.watcher.close != nil {
		_ = a.watcher.close()
	}
	a.debounceMu.Lock()
	if a.debounceT != nil {
		a.debounceT.Stop()
	}
	a.debounceMu.Unlock()
}
