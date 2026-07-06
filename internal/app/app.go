// Package app is the Wails binding layer. It is the only package exposed
// to the frontend via JSON-RPC bindings.
package app

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/akke/ease-ui/internal/apiproxy"
	"github.com/akke/ease-ui/internal/auth"
	"github.com/akke/ease-ui/internal/hooks"
	"github.com/akke/ease-ui/internal/hookserver"
	"github.com/akke/ease-ui/internal/instance"
	"github.com/akke/ease-ui/internal/jsonl"
	"github.com/akke/ease-ui/internal/notify"
	"github.com/akke/ease-ui/internal/session"
	"github.com/akke/ease-ui/internal/settings"
	"github.com/akke/ease-ui/internal/tray"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type Options struct {
	AuthPath  string
	ConfigDir string
	ClaudeDir string
}

type App struct {
	opts       Options
	auth       *auth.Auth
	settings   *settings.Config
	handler    *hooks.Handler
	appMu      sync.RWMutex
	sessions   map[string]*session.Session
	claudeBin  string
	ctx        context.Context
	hookSrv    *hookserver.Server
	hookMu     sync.RWMutex
	hookPort   int
	inst       *instance.Store
	watcher    *fsWatcher
	debounceMu sync.Mutex
	debounceT  *time.Timer
	// apiStore 保存 API 网关代理捕获的阶段数据。
	apiStore *apiproxy.Store
	// proxies 保存每个 session 对应的 API 代理（按真实 session ID 索引）。
	proxies map[string]*apiproxy.Proxy
	// pendingProxies 保存等待 SessionStart hook 返回真实 ID 的代理（按临时 token 索引）。
	pendingProxies map[string]*apiproxy.Proxy
	// hookPermission 存储阻塞中的 PermissionRequest 决策通道。
	permMu      sync.Mutex
	permPending map[string]*permWaiter
	permCounter uint64

	// tray 是系统托盘管理器，窗口关闭后仍保持应用在任务栏/菜单栏可见。
	tray *tray.Manager
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
	apiRoot := opts.ClaudeDir
	if apiRoot == "" && opts.ConfigDir != "" {
		apiRoot = opts.ConfigDir
	}
	if apiRoot == "" {
		home, _ := os.UserHomeDir()
		apiRoot = filepath.Join(home, ".ease-app")
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
		opts:           opts,
		auth:           a,
		settings:       cfg,
		handler:        hooks.NewHandler(cfg.AutoAllowBash),
		sessions:       map[string]*session.Session{},
		inst:           inst,
		apiStore:       apiproxy.NewStore(filepath.Join(apiRoot, "projects")),
		proxies:        map[string]*apiproxy.Proxy{},
		pendingProxies: map[string]*apiproxy.Proxy{},
		permPending:    map[string]*permWaiter{},
		tray:           tray.New(),
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

// StartTray 在 Wails 上下文可用后启动系统托盘图标。
func (a *App) StartTray(icon []byte) {
	if a.tray == nil {
		return
	}
	a.tray.Start(a.ctx, icon)
}

// Shutdown stops background goroutines and releases file watchers.
func (a *App) Shutdown() {
	a.closeAllSessions()
	if a.watcher != nil && a.watcher.close != nil {
		_ = a.watcher.close()
	}
	a.debounceMu.Lock()
	if a.debounceT != nil {
		a.debounceT.Stop()
	}
	a.debounceMu.Unlock()
	if a.tray != nil && a.ctx != nil {
		a.tray.Quit()
	}
}

// AlertPermission 通过系统通知 + 任务栏闪烁提醒用户处理权限请求，
// 但不会自动弹出主窗口，避免打断用户当前工作。
func (a *App) AlertPermission(title, body string) error {
	return notify.Alert(a.ctx, title, body)
}
