# xterm.js + PTY 终端渲染 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将中间对话区域从 jsonl + 自定义 Vue 组件渲染改为 xterm.js 嵌入终端，通过 Go PTY 运行 claude 获得原生 ANSI 渲染体验。

**Architecture:** Go 端用 `go-pty` 创建跨平台 PTY 运行 `claude`（去掉 -p flag），stdout 原始字节通过 Wails Events 推送前端 xterm.js 渲染；用户输入通过 xterm.js.onData → Wails binding → PTY stdin。去掉外部终端切换、SwitchOwner、Composer、MessageCard 体系，权限改为 Toast 提醒。

**Tech Stack:** Wails v2 + Vue 3 + TypeScript + @xterm/xterm + @xterm/addon-fit + @xterm/addon-webLinks + Go 1.26 + github.com/aymanbagabas/go-pty

---

## 文件变更地图

| 操作 | 文件 | 职责 |
|------|------|------|
| **新增** | `internal/pty/pty.go` | 跨平台 PTY 进程管理 |
| **新增** | `internal/pty/pty_windows.go` | Windows ConPTY 实现 |
| **新增** | `internal/pty/pty_unix.go` | Unix PTY 实现 |
| **新增** | `frontend/src/components/XtermTerminal.vue` | xterm.js 终端组件 |
| **新增** | `frontend/src/components/PermissionToast.vue` | 权限提醒轻量 Toast |
| **修改** | `internal/app/session.go` | PTY 替代 stream-json 进程 |
| **修改** | `internal/app/app.go` | 移除 terminal/perm 相关字段 |
| **修改** | `frontend/src/views/HomeView.vue` | 布局改为 XtermTerminal |
| **修改** | `frontend/src/components/ToolBar.vue` | 去掉终端切换按钮 |
| **修改** | `frontend/src/stores/sessions.ts` | 移除 terminal/owner/stream 状态 |
| **修改** | `frontend/src/composables/useWails.ts` | 移除 SwitchOwner/OpenInTerminal |
| **修改** | `frontend/src/composables/useEventStream.ts` | 简化事件监听 |
| **修改** | `frontend/package.json` | 添加 xterm 依赖 |
| **删除** | `frontend/src/components/Composer.vue` | 不再需要 |
| **删除** | `frontend/src/components/MessageCard.vue` | 不再需要 |
| **删除** | `frontend/src/components/blocks/*.vue` | 不再需要 |
| **删除** | `frontend/src/components/PermissionRequestModal.vue` | 改为 Toast |
| **修改** | `go.mod` | 添加 go-pty 依赖 |

---

### Task 1: 添加 Go PTY 依赖

**Files:**
- Modify: `go.mod`

- [ ] **Step 1: 添加 go-pty 依赖**

```bash
cd G:/work/lynel-desktop && go get github.com/aymanbagabas/go-pty@latest
```

- [ ] **Step 2: 验证依赖下载成功**

```bash
go mod tidy
```

---

### Task 2: 实现 internal/pty 包（跨平台 PTY）

**Files:**
- Create: `internal/pty/pty.go`
- Create: `internal/pty/pty_windows.go`
- Create: `internal/pty/pty_unix.go`

- [ ] **Step 1: 创建 PTY 接口和通用类型** — `internal/pty/pty.go`

```go
// Package pty wraps a cross-platform pseudo-terminal for running Claude CLI
// in interactive mode (without -p flag), capturing raw ANSI output.
package pty

import (
	"fmt"
	"os/exec"
)

// Mode mirrors process.Mode for backward compatibility.
type Mode int

const (
	ModeAuto   Mode = iota // no session flag, Claude generates UUID
	ModeNew                // --session-id <sid>
	ModeResume             // --resume <sid>
)

// Proc wraps a PTY-attached command.
type Proc struct {
	cmd *exec.Cmd
	tty TTY
}

// TTY is the platform-specific PTY interface.
type TTY interface {
	Read(p []byte) (int, error)
	Write(p []byte) (int, error)
	Resize(cols, rows int) error
	Close() error
}

// Start launches claude in a PTY with the given workdir and session mode.
// binPath should be "claude" or an absolute path to the claude binary.
func Start(workDir, sessionID, binPath string, mode Mode) (*Proc, error) {
	if binPath == "" || binPath == "claude" {
		binPath = lookupClaudeBin()
	}

	args := buildArgs(sessionID, mode)

	cmd := exec.Command(binPath, args...)
	cmd.Dir = workDir

	tty, err := startTTY(cmd)
	if err != nil {
		return nil, fmt.Errorf("pty start: %w", err)
	}

	return &Proc{cmd: cmd, tty: tty}, nil
}

func (p *Proc) Read(b []byte) (int, error)  { return p.tty.Read(b) }

// Write 实现 session.ProcessIface（string → []byte 转换）。
func (p *Proc) Write(s string) error {
	_, err := p.tty.Write([]byte(s))
	return err
}

func (p *Proc) Resize(cols, rows int) error  { return p.tty.Resize(cols, rows) }
func (p *Proc) Close() error {
	err := p.tty.Close()
	if p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
	}
	_ = p.cmd.Wait()
	return err
}

// Pid returns the OS process ID.
func (p *Proc) Pid() int {
	if p.cmd.Process != nil {
		return p.cmd.Process.Pid
	}
	return 0
}

func buildArgs(sessionID string, mode Mode) []string {
	switch mode {
	case ModeResume:
		return []string{"--resume", sessionID}
	case ModeNew:
		return []string{"--session-id", sessionID}
	default: // ModeAuto: no session flag
		return nil
	}
}

func lookupClaudeBin() string {
	p, err := exec.LookPath("claude")
	if err != nil {
		return "claude"
	}
	return p
}
```

- [ ] **Step 2: 创建 Windows ConPTY 实现** — `internal/pty/pty_windows.go`

```go
//go:build windows

package pty

import (
	"fmt"
	"os/exec"
	"syscall"

	gopty "github.com/aymanbagabas/go-pty"
)

func startTTY(cmd *exec.Cmd) (TTY, error) {
	tty, err := gopty.New()
	if err != nil {
		return nil, fmt.Errorf("windows conpty: %w", err)
	}

	// 设置初始终端大小
	if err := tty.Resize(120, 40); err != nil {
		tty.Close()
		return nil, fmt.Errorf("resize: %w", err)
	}

	// 将命令附加到 PTY
	c := tty.Command(cmd.Path)
	c.Args = append([]string{cmd.Path}, cmd.Args...)
	c.Dir = cmd.Dir
	c.Env = append(cmd.Env, "TERM=xterm-256color")

	// 隐藏 Windows 控制台窗口
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	if err := c.Start(); err != nil {
		tty.Close()
		return nil, fmt.Errorf("start claude: %w", err)
	}

	// 更新 Proc.cmd 为新启动的进程（用于 Kill/Wait）
	*cmd = *c

	return tty, nil
}
```

- [ ] **Step 3: 创建 Unix PTY 实现** — `internal/pty/pty_unix.go`

```go
//go:build !windows

package pty

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"

	gopty "github.com/aymanbagabas/go-pty"
)

func startTTY(cmd *exec.Cmd) (TTY, error) {
	tty, err := gopty.New()
	if err != nil {
		return nil, fmt.Errorf("unix pty: %w", err)
	}

	if err := tty.Resize(120, 40); err != nil {
		tty.Close()
		return nil, fmt.Errorf("resize: %w", err)
	}

	c := tty.Command(cmd.Path)
	c.Args = cmd.Args
	c.Dir = cmd.Dir
	c.Env = append(os.Environ(), "TERM=xterm-256color")

	if err := c.Start(); err != nil {
		tty.Close()
		return nil, fmt.Errorf("start claude: %w", err)
	}

	*cmd = *c
	return tty, nil
}

func init() {
	// 确保子进程获得自己的进程组，便于 cleanup
	syscall.Setpgid(0, 0)
}
```

- [ ] **Step 4: 验证编译**

```bash
cd G:/work/lynel-desktop && go build ./internal/pty/...
```

---

### Task 3: 更新 session.Session 适配 PTY

**Files:**
- Modify: `internal/session/session.go`

- [ ] **Step 1: 简化 Session 结构，移除 Owner/Mode/SwitchLock**

`internal/session/session.go` 中：

移除 `Owner` 类型、`Mode` 类型、`OwnerTerminal`/`ModeResume` 常量、`owner`/`mode`/`extPID`/`extPIDFile`/`switchMu` 字段及所有相关方法（`Owner()`、`SetOwner()`、`Mode()`、`SetMode()`、`ExtPID()`、`SetExtPID()`、`SwitchLock()`）。

简化后 `Session` 结构：

```go
type Session struct {
	ID      string
	WorkDir string

	mu      sync.Mutex
	state   State
	proc    ProcessIface
	pending map[string]struct{}
	version uint64
}

func New(id, workDir string) *Session {
	return &Session{
		ID:      id,
		WorkDir: workDir,
		state:   StateIdle,
		pending: map[string]struct{}{},
	}
}
```

保留 `ProcessIface` 接口（pty.Proc 和 process.Process 都实现 Write/Close，天然兼容）。

- [ ] **Step 2: 简化 Send 方法（去掉 envelope）**

```go
func (s *Session) Send(prompt string) error {
	s.mu.Lock()
	if s.state == StateAwaitingPermission {
		s.mu.Unlock()
		return ErrAwaitingPermission
	}
	if s.proc == nil {
		s.mu.Unlock()
		return errors.New("session: no process")
	}
	proc := s.proc
	prevState := s.state
	prevVersion := s.version
	s.state = StateRunning
	s.version++
	s.mu.Unlock()

	// PTY 模式：直接写裸文本 + 换行，不需要 stream-json envelope
	if err := proc.Write(prompt + "\n"); err != nil {
		s.mu.Lock()
		if s.version == prevVersion+1 {
			s.state = prevState
			s.version++
		}
		s.mu.Unlock()
		if errors.Is(err, os.ErrClosed) || strings.Contains(err.Error(), "file already closed") || strings.Contains(err.Error(), "broken pipe") {
			s.Close()
		}
		return err
	}
	return nil
}
```

- [ ] **Step 3: 验证编译**

```bash
cd G:/work/lynel-desktop && go build ./internal/session/...
```

---

### Task 4: 重构 app/session.go — PTY 替代 stream-json 进程

**Files:**
- Modify: `internal/app/session.go`

这是最大的变更文件。核心改动：

- [ ] **Step 1: 添加 pty import，修改 CreateSession**

```go
import (
	// ... 保留现有 imports
	"github.com/akke/lynel-desktop/internal/pty"
)

func (a *App) CreateSession(workDir, prompt string) (string, error) {
	bin := getBin(a)
	proc, err := pty.Start(workDir, "", bin, pty.ModeAuto)
	if err != nil {
		return "", err
	}

	// 非真实 claude：用 PID 作为 ID，不等待 hook
	if bin != "claude" && !strings.HasSuffix(bin, "/claude") {
		id := fmt.Sprintf("test-%d", proc.Pid())
		s := session.New(id, workDir)
		s.SetProcessForTest(proc)
		a.registerSession(s)
		a.inst.Put(id, "running")
		go a.pumpPtyEvents(s, proc)
		if prompt != "" {
			_ = s.Send(prompt)
		}
		return id, nil
	}

	// 真实 claude：等待 SessionStart hook
	ch := make(chan string, 1)
	a.registerPending(ch)
	defer a.unregisterPending(ch)

	select {
	case realID := <-ch:
		s := session.New(realID, workDir)
		s.SetProcessForTest(proc)
		a.registerSession(s)
		a.inst.Put(realID, "running")
		go a.pumpPtyEvents(s, proc)
		if prompt != "" {
			_ = s.Send(prompt)
		}
		return realID, nil
	case <-time.After(15 * time.Second):
		proc.Close()
		return "", fmt.Errorf("session start timeout (15s)")
	}
}
```

- [ ] **Step 2: 新增 pumpPtyEvents（替代 pumpEvents）**

```go
// pumpPtyEvents 从 PTY 读取原始字节并通过 Wails Events 推送到前端。
// 与 pumpEvents 不同：不再逐行解析 stream-json，直接转发原始输出。
func (a *App) pumpPtyEvents(s *session.Session, p *pty.Proc) {
	topic := "session:" + s.ID
	buf := make([]byte, 4096)
	for {
		n, err := p.Read(buf)
		if err != nil {
			break
		}
		if n > 0 && a.ctx != nil {
			data := make([]byte, n)
			copy(data, buf[:n])
			wailsruntime.EventsEmit(a.ctx, topic, string(data))
		}
	}
	// PTY 进程退出
	s.SetIdle()
	a.inst.Put(s.ID, "done")
	if a.ctx != nil {
		wailsruntime.EventsEmit(a.ctx, topic, `{"type":"done"}`)
	}
}
```

- [ ] **Step 3: 修改 AdoptSession — 用 PTY 延迟启动**

```go
func (a *App) AdoptSession(sessionID, workDir string) error {
	if s, ok := a.lookupSession(sessionID); ok {
		if proc := s.GetProcessForTest(); proc != nil {
			return nil
		}
	}
	if sessionID == "" || workDir == "" {
		return &appError{code: "E_BAD_ARG", msg: "AdoptSession: sessionID and workDir required"}
	}
	s := session.New(sessionID, workDir)
	a.registerSession(s)
	a.inst.Put(sessionID, "idle")
	return nil
}
```

- [ ] **Step 4: 修改 SendMessage — 仅用于完整消息发送（外部 API 等）**

```go
func (a *App) SendMessage(sessionID, prompt string) error {
	s, ok := a.lookupSession(sessionID)
	if !ok {
		return errSessionNotFound
	}

	// 懒启动 PTY 进程
	if proc := s.GetProcessForTest(); proc == nil {
		bin := getBin(a)
		newProc, err := pty.Start(s.WorkDir, sessionID, bin, pty.ModeResume)
		if err != nil {
			return err
		}
		s.SetProcessForTest(newProc)
		go a.pumpPtyEvents(s, newProc)
	}

	return s.Send(prompt)
}
```

- [ ] **Step 5: 新增 WriteTerminalInput — xterm.js 逐键输入专用（轻量，无状态切换）**

xterm.js `onData` 每键触发，需要一条轻量路径直接写 PTY，不经过 Send 的状态机。

```go
// WriteTerminalInput 将 xterm.js 的逐键输入直接写入 PTY stdin。
// 与 SendMessage 的区别：不经过 session.Send 的状态切换（idle→running），
// 因为终端交互中每个按键不应改变 session 状态。
func (a *App) WriteTerminalInput(sessionID, data string) error {
	s, ok := a.lookupSession(sessionID)
	if !ok {
		return errSessionNotFound
	}

	proc := s.GetProcessForTest()
	if proc == nil {
		// 懒启动
		bin := getBin(a)
		newProc, err := pty.Start(s.WorkDir, sessionID, bin, pty.ModeResume)
		if err != nil {
			return err
		}
		s.SetProcessForTest(newProc)
		go a.pumpPtyEvents(s, newProc)
		proc = newProc
	}

	return proc.Write(data)
}
```

- [ ] **Step 6: 新增 PTY Resize binding 方法**

```go
// ResizeTerminal 调整 PTY 窗口大小，由前端 xterm.js 触发。
func (a *App) ResizeTerminal(sessionID string, cols, rows int) error {
	s, ok := a.lookupSession(sessionID)
	if !ok {
		return errSessionNotFound
	}
	proc := s.GetProcessForTest()
	if proc == nil {
		return nil
	}
	if p, ok := proc.(*pty.Proc); ok {
		return p.Resize(cols, rows)
	}
	return nil
}
```

- [ ] **Step 6: 移除 SwitchOwner、OpenInTerminal、pkill 等全部逻辑**

删除以下函数和代码块：
- `SwitchOwner` 方法
- `switchToApp` 方法
- `switchToTerminal` 方法
- `OpenInTerminal` 方法（如果在这个文件里）
- `killByPIDFile` 函数
- `pkillByPattern` 函数
- `envelopeUserMessage` 函数
- `switchSettleDelay` 常量
- `terminal` import

- [ ] **Step 7: 保留 CloseSession 不变，验证编译**

```bash
cd G:/work/lynel-desktop && go build ./internal/app/...
```

---

### Task 5: 清理 app.go — 移除 terminal 相关字段

**Files:**
- Modify: `internal/app/app.go`

- [ ] **Step 1: 移除 termLauncher 和 permPending 字段**

从 `App` 结构体中移除：
- `termLauncher *terminal.Launcher`
- `permMu sync.Mutex`
- `permPending map[string]*permWaiter`
- `permCounter uint64`

移除 `permWaiter` 类型定义。

移除 `terminal` import。

- [ ] **Step 2: 更新 New() 函数**

```go
app := &App{
	opts:     opts,
	auth:     a,
	settings: cfg,
	handler:  hooks.NewHandler(cfg.AutoAllowBash),
	bus:      events.NewBus(),
	sessions: map[string]*session.Session{},
	inst:     inst,
	tray:     tray.New(),
}
```

- [ ] **Step 3: 验证编译**

```bash
cd G:/work/lynel-desktop && go build ./...
```

---

### Task 6: 注册新 binding 到 Wails

**Files:**
- Modify: `app.go` (Wails 入口，通常在根目录或 internal/app 的 OnStartup)

- [ ] **Step 1: 在 Wails Bind 中确认 ResizeTerminal 已暴露**

检查 `app.go` 中 `Bind` 调用是否包含 `ResizeTerminal`。`internal/app` 的所有公开方法会自动暴露为 binding，`ResizeTerminal` 是 `*App` 的方法所以自动可用。

- [ ] **Step 2: 运行 wails generate 更新前端 bindings**

```bash
cd G:/work/lynel-desktop && wails generate
```

---

### Task 7: 前端添加 xterm.js 依赖

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: 安装 xterm.js**

```bash
cd G:/work/lynel-desktop/frontend && npm install @xterm/xterm @xterm/addon-fit @xterm/addon-webLinks
```

- [ ] **Step 2: 验证安装**

```bash
ls node_modules/@xterm/xterm/lib/xterm.js
```

---

### Task 8: 创建 XtermTerminal.vue 组件

**Files:**
- Create: `frontend/src/components/XtermTerminal.vue`

- [ ] **Step 1: 实现 XtermTerminal.vue**

```vue
<template>
  <div ref="terminalEl" class="xterm-container" @click="focusTerminal" />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-webLinks'
import '@xterm/xterm/css/xterm.css'
import { EventsOn, ResizeTerminal } from '../composables/useWails'

const props = defineProps<{
  sessionId: string
}>()

const emit = defineEmits<{
  (e: 'data', data: string): void
}>()

const terminalEl = ref<HTMLElement | null>(null)

let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let cleanupEvents: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null

function focusTerminal() {
  term?.focus()
}

// 粗略估算：字符宽度约 8.4px，行高约 17px（14px 字号）
function calcCols(width: number): number {
  return Math.max(40, Math.floor((width - 16) / 8.4))
}
function calcRows(height: number): number {
  return Math.max(10, Math.floor((height - 8) / 17))
}

onMounted(() => {
  if (!terminalEl.value) return

  term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Consolas, "Courier New", monospace',
    theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
    allowProposedApi: true,
  })

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(new WebLinksAddon())

  term.open(terminalEl.value)

  // 初始 fit
  nextTick(() => {
    fitAddon?.fit()
    emitResize()
  })

  // 监听容器大小变化
  resizeObserver = new ResizeObserver(() => {
    fitAddon?.fit()
    emitResize()
  })
  resizeObserver.observe(terminalEl.value)

  // 用户键盘输入 → 父组件（最终写入 PTY stdin）
  term.onData((data: string) => {
    emit('data', data)
  })

  // 监听 PTY 输出事件
  const topic = `session:${props.sessionId}`
  cleanupEvents = EventsOn(topic, (line: string) => {
    if (line === '{"type":"done"}') return
    term?.write(line)
  })
})

function emitResize() {
  if (!term || !terminalEl.value) return
  const cols = calcCols(terminalEl.value.clientWidth)
  const rows = calcRows(terminalEl.value.clientHeight)
  term.resize(cols, rows)
  // 通知后端 PTY 同步窗口大小
  ResizeTerminal(props.sessionId, cols, rows).catch(() => {})
}

// 切换 session 时清理
watch(() => props.sessionId, () => {
  cleanupEvents?.()
  term?.dispose()
})

onBeforeUnmount(() => {
  cleanupEvents?.()
  resizeObserver?.disconnect()
  term?.dispose()
})
</script>

<style scoped>
.xterm-container {
  width: 100%;
  height: 100%;
  min-height: 0;
}
</style>
```

---

### Task 9: 更新 HomeView.vue 布局

**Files:**
- Modify: `frontend/src/views/HomeView.vue`

- [ ] **Step 1: 替换中间内容区域为 XtermTerminal**

核心改动：
- 移除 `MessageCard` 循环和 `PermissionRequestModal`
- 移除 `Composer`
- 中间 `.messages` 区域替换为 `XtermTerminal`
- 移除 terminal/owner 相关逻辑

```vue
<template>
  <div class="home">
    <TitleBar ... />
    <div class="layout">
      <aside class="left">
        <SessionList ... />
        <UserBar ... />
      </aside>
      <main class="right">
        <template v-if="sessions.active">
          <ToolBar
            :title="displayName"
            :ai-title="sessions.active?.ai_title"
            :project="sessions.active.project"
            :session-id="sessions.active.id"
            :msg-count="sessions.active.msg_count"
            :state="state"
          />
          <div class="terminal-area">
            <XtermTerminal
              v-if="sessions.activeId"
              :key="sessions.activeId"
              :session-id="sessions.activeId"
              @data="onTerminalData"
            />
          </div>
        </template>
        <div v-else class="empty">
          <div class="empty-text">选择左侧会话，或点击 + 创建新会话</div>
        </div>
      </main>
      <ToolTimeline ... />
    </div>
    <NewSessionDialog ... />
    <PermissionToast ... />
  </div>
</template>

<script setup lang="ts">
// ... imports（移除 MessageCard, Composer, PermissionRequestModal 相关）
import XtermTerminal from '../components/XtermTerminal.vue'
import { ResizeTerminal, WriteTerminalInput } from '../composables/useWails'

// 移除：terminalLoading, switchingToApp, owner, isTerminalMode
// 移除：openTerminal, takeback, respondHookPermission, clearHookPermission
// 移除：msgContainer, onScroll, scrollToBottom, userScrolledUp 等滚动逻辑

// 终端数据回调 → 逐键写入 PTY stdin（xterm.js onData 每键触发）
async function onTerminalData(data: string) {
  if (!sessions.activeId) return
  try {
    await WriteTerminalInput(sessions.activeId, data)
  } catch (e: any) {
    console.error('[terminal] write failed:', e?.message)
  }
}
</script>

<style scoped>
/* ... 保留原有样式 ... */
.terminal-area {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #1e1e1e;
}
</style>
```

- [ ] **Step 2: 移除不再需要的 imports 和逻辑**

从 `<script setup>` 中移除：
- `MessageCard`, `PermissionRequestModal`, `Composer` 的 import
- `OpenInTerminal`, `SwitchOwner`, `RespondHookPermission` 的 import
- `terminalLoading`, `switchingToApp`, `isTerminalMode` computed
- `openTerminal()`, `takeback()`, `respondHookPermission()`, `clearHookPermission()` 函数
- `msgContainer`, `isMaximized`, `maximizePollTimer` 等不再需要的 ref
- `onScroll`, `scrollToBottom`, `isNearBottom` 滚动函数
- `pendingScrollFor`, `userScrolledUp` 及相关 watch
- `displayMessages` computed
- `isStreaming` computed

---

### Task 10: 简化 ToolBar.vue

**Files:**
- Modify: `frontend/src/components/ToolBar.vue`

- [ ] **Step 1: 移除终端切换按钮**

移除 `open-terminal` / `takeback` 按钮及相关 props（`terminalLoading`, `switchingToApp`, `owner`）。

简化后 ToolBar 只保留：
- 标题（displayName）
- AI 标题
- 项目名
- 消息数
- 状态指示

```vue
<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <span class="title">{{ title }}</span>
      <span v-if="aiTitle" class="ai-title">{{ aiTitle }}</span>
    </div>
    <div class="toolbar-right">
      <span v-if="project" class="project">{{ project }}</span>
      <span class="msg-count">{{ msgCount }} 条消息</span>
      <span class="state" :class="state">{{ stateLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  title: string
  aiTitle?: string
  project?: string
  sessionId: string
  msgCount: number
  state: string
}>()

const stateLabel = computed(() => {
  const map: Record<string, string> = {
    idle: '空闲',
    waiting: '等待中',
    thinking: '思考中',
    streaming: '生成中',
    running_tool: '工具执行中',
    awaiting_permission: '等待权限',
    done: '已完成',
    ended: '已结束',
  }
  return map[props.state] || props.state
})
</script>
```

---

### Task 11: 简化 sessions store

**Files:**
- Modify: `frontend/src/stores/sessions.ts`

- [ ] **Step 1: 移除 terminal/owner/mode 相关状态**

移除以下 ref：
- `owner`
- `mode`
- `terminalLoading`
- `switchingToApp`

- [ ] **Step 2: 简化 send 函数**

```typescript
async function send(id: string, prompt: string) {
  const trimmed = prompt.trim()
  if (!trimmed) return

  streaming.value = { ...streaming.value, [id]: true }
  state.value = { ...state.value, [id]: 'waiting' }

  try {
    const meta = list.value.find((s) => s.id === id)
    if (!meta) throw new Error('session not found in list')
    await AdoptSession(id, meta.workdir)
    await SendMessage(id, trimmed)
  } catch (e: any) {
    state.value = { ...state.value, [id]: 'idle' }
    streaming.value = { ...streaming.value, [id]: false }
    throw e
  }
}
```

- [ ] **Step 3: 简化 create 函数**

移除 owner/mode 设置，移除 SwitchOwner 调用。

- [ ] **Step 4: 保留 handleHookEvent 中必要的逻辑**

保留 `SessionStart`/`SessionEnd`/`PreToolUse`/`PostToolUse` 处理，移除 terminal/owner 判断。

- [ ] **Step 5: 移除 handleEvent**

`handleEvent` 是 stream-json 事件解析，PTY 模式下不再需要。xterm.js 直接渲染原始输出。

---

### Task 12: 更新 useWails.ts 和 useEventStream.ts

**Files:**
- Modify: `frontend/src/composables/useWails.ts`
- Modify: `frontend/src/composables/useEventStream.ts`

- [ ] **Step 1: useWails.ts — 添加 WriteTerminalInput/ResizeTerminal，移除 SwitchOwner/OpenInTerminal**

```typescript
// 添加到 Window.go.app.App 接口：
WriteTerminalInput: (id: string, data: string) => Promise<void>
ResizeTerminal: (id: string, cols: number, rows: number) => Promise<void>

// 添加导出：
export const WriteTerminalInput = (id: string, data: string) =>
  app().WriteTerminalInput(id, data)
export const ResizeTerminal = (id: string, cols: number, rows: number) =>
  app().ResizeTerminal(id, cols, rows)

// 移除：
// SwitchOwner
// OpenInTerminal
// RespondHookPermission（不再需要阻塞式权限响应）
```

- [ ] **Step 2: useEventStream.ts — 简化 session 事件监听**

移除 `session:${newId}` 的 EventsOn（xterm.js 在 XtermTerminal.vue 内部自行监听）。

保留：
- `app:toast`
- `app:fatal`
- `sessions:list:changed`
- `permission:request`
- `hook:${newId}` 监听

---

### Task 13: 创建 PermissionToast 组件（替代 Modal）

**Files:**
- Create: `frontend/src/components/PermissionToast.vue`

- [ ] **Step 1: 实现轻量 Toast**

```vue
<template>
  <div v-if="visible" class="perm-toast" @click="handleClick">
    <span class="perm-icon">&#9888;</span>
    <span class="perm-text">Claude 请求权限：{{ toolName }}</span>
    <span class="perm-hint">点击查看详情</span>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  toolName: string
  sessionId: string
}>()

const emit = defineEmits<{
  (e: 'navigate', sessionId: string): void
}>()

const visible = ref(false)

watch(() => props.toolName, (name) => {
  if (name) {
    visible.value = true
    setTimeout(() => { visible.value = false }, 8000)
  }
}, { immediate: true })

function handleClick() {
  visible.value = false
  emit('navigate', props.sessionId)
}
</script>

<style scoped>
.perm-toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: #f59e0b;
  color: #000;
  padding: 10px 16px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 1000;
  animation: slideUp 0.3s ease;
}
@keyframes slideUp { from { transform: translateY(20px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
.perm-icon { font-size: 16px }
.perm-hint { opacity: 0.7; font-size: 11px }
</style>
```

---

### Task 14: 清理旧前端组件

**Files:**
- Delete: `frontend/src/components/Composer.vue`
- Delete: `frontend/src/components/MessageCard.vue`
- Delete: `frontend/src/components/PermissionRequestModal.vue`
- Delete: `frontend/src/components/blocks/TextBlock.vue`
- Delete: `frontend/src/components/blocks/ThinkingBlock.vue`
- Delete: `frontend/src/components/blocks/ImageBlock.vue`
- Delete: `frontend/src/components/blocks/ToolUseBlock.vue`
- Delete: `frontend/src/components/blocks/ToolResultBlock.vue`
- Delete: `frontend/src/components/blocks/Truncatable.vue`
- Delete: `frontend/src/components/blocks/tools/AskUserQuestionTool.vue`
- Delete: `frontend/src/components/blocks/tools/BashTool.vue`
- Delete: `frontend/src/components/blocks/tools/EditTool.vue`
- Delete: `frontend/src/components/blocks/tools/GenericTool.vue`
- Delete: `frontend/src/components/blocks/tools/PlanTool.vue`
- Delete: `frontend/src/components/blocks/tools/TodoWriteTool.vue`
- Delete: `frontend/src/components/blocks/tools/WriteTool.vue`

- [ ] **Step 1: 删除所有旧组件文件**

```bash
cd G:/work/lynel-desktop/frontend
rm src/components/Composer.vue
rm src/components/MessageCard.vue
rm src/components/PermissionRequestModal.vue
rm -r src/components/blocks/
```

---

### Task 15: 端到端验证

**Files:**
- Modify: 无（验证阶段）

- [ ] **Step 1: Go 编译**

```bash
cd G:/work/lynel-desktop && go build ./...
```
Expected: PASS

- [ ] **Step 2: 前端类型检查**

```bash
cd G:/work/lynel-desktop/frontend && npx vue-tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Wails dev 完整启动**

```bash
cd G:/work/lynel-desktop && wails dev
```
Expected: 窗口正常启动，创建会话后中间显示 xterm.js 终端

- [ ] **Step 4: 功能验证清单**

- [ ] 新建会话：终端正常启动，显示 Claude 交互界面
- [ ] 输入消息：在终端内直接输入文本，Enter 发送，Claude 正常响应
- [ ] ANSI 渲染：代码块、颜色、粗体等正常显示
- [ ] 切换会话：点击左侧其他会话，终端切换到新会话
- [ ] 工具执行：Claude 执行工具时 ToolTimeline 正常更新
- [ ] 权限提醒：Claude 请求权限时右下角出现 Toast
- [ ] resize：调整窗口大小，终端自适应
- [ ] 关闭会话：正常结束

---

### Task 16: 清理 process.go（保留兼容）

**Files:**
- Modify: `internal/process/process.go`

- [ ] **Step 1: 标记 process.go 为废弃**

在文件顶部添加注释：

```go
// Deprecated: process.go 的 stream-json 模式已被 internal/pty 替代。
// 仅保留 ModeResume 用于外部终端打开场景（如果未来需要恢复）。
// 当前 xterm.js PTY 方案不再使用此包。
```

保持文件不变（不删除，以免影响其他引用），但确认没有活跃调用路径。

---

## 变更总结

| 类别 | 数量 |
|------|------|
| 新增 Go 文件 | 3 |
| 修改 Go 文件 | 4 |
| 新增前端文件 | 2 |
| 修改前端文件 | 4 |
| 删除前端文件 | 16 |
| 新增依赖 | go-pty, @xterm/xterm, @xterm/addon-fit, @xterm/addon-webLinks |
