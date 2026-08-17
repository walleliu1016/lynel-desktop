# Lynel 项目落地页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个纯 HTML 单文件营销落地页 `landing/index.html`，展示 Lynel Desktop 产品价值并从云服务拉取版本下载。

**Architecture:** 单文件自包含（内联 CSS + JS，零构建零依赖），浅色红蓝主题 + 现代动效。下载逻辑复用 desktop 更新接口约定：`GET /api/update/check?platform&arch&version=0&channel=stable`（base = `window.location.origin`）；降级/无 JS 走 `/api/update/download`（不传 version，云服务返回最新版）。更新日志走可选增强接口 `/api/update/list`，缺失时降级为单条。

**Tech Stack:** 原生 HTML/CSS/JS（无框架、无构建、无外链字体），`IntersectionObserver` + `fetch` + `navigator.userAgentData`。

## Global Constraints

- 单文件：CSS、JS 全部内联在 `landing/index.html`，不得引入外部文件或 CDN。
- 配色必须取自 spec 视觉系统：品牌蓝 `#1e5af5`、品牌红 `#e63946`、背景 `#f7f8fa`/`#ffffff`、标题 `#0d1321`、正文 `#3f4756`、弱化 `#8a93a6`。
- 下载 base URL 一律用 `window.location.origin`，不得硬编码域名。
- 页面不得写死版本号（`0.0.21` 等）；最新版/下载链接/更新日志全走接口。
- 降级链保证页面永不空白：接口失败 → 静态相对链接；无 JS → `<a href>` 仍可下载。
- 动效尊重 `prefers-reduced-motion`（关闭时降级为纯淡入）。
- 文件放在仓库根 `landing/index.html`；不污染 electron-builder 打包。

---

### Task 1: 骨架与视觉系统

**Files:**
- Create: `landing/index.html`

**Interfaces:**
- Produces: 页面根骨架，含 `<head>` SEO、CSS 变量、全局样式、8 个空 `<section>` 占位（`hero` / `painpoints` / `features` / `showcase` / `download` / `changelog` / `faq`）、`<header>`、`<footer>`、末尾空 `<script>` 块。

- [ ] **Step 1: 创建目录与文件骨架**

创建 `landing/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Lynel Desktop · 把 Claude Code / Codex 等 CLI 装进一个本地窗口</title>
<meta name="description" content="跨平台多 Agent 会话管理桌面 App：多会话、统一权限审批、实时 Trace、企业微信远程。支持 Claude Code / Codex / OpenCode / OMP 与 DeepSeek Harness 界面。">
<meta property="og:title" content="Lynel Desktop">
<meta property="og:description" content="把 Claude Code / Codex 等 CLI 装进一个本地窗口。">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='14' height='14' fill='%231e5af5' rx='4'/%3E%3Crect x='18' width='14' height='14' fill='%23e63946' rx='4'/%3E%3Crect y='18' width='14' height='14' fill='%23e63946' rx='4' opacity='.6'/%3E%3Crect x='18' y='18' width='14' height='14' fill='%231e5af5' opacity='.6'/%3E%3C/svg%3E">
<style>
/* ===== 根变量 ===== */
:root {
  --bg: #f7f8fa; --surface: #ffffff; --line: #eef1f5;
  --brand-blue: #1e5af5; --brand-blue-dark: #1749cc; --brand-blue-soft: #e8f0fe;
  --brand-red: #e63946; --brand-red-dark: #c92a37; --brand-red-soft: #fff0f0;
  --ink: #0d1321; --body: #3f4756; --muted: #8a93a6;
  --success: #10b981;
  --radius-btn: 8px; --radius-card: 14px; --radius-frame: 16px;
  --shadow: 0 8px 30px rgba(13, 24, 41, 0.08);
  --shadow-lg: 0 18px 50px rgba(13, 24, 41, 0.14);
  --font: "PingFang SC", "Microsoft YaHei", Inter, -apple-system, Arial, sans-serif;
  --mono: "Source Code Pro", ui-monospace, SFMono-Regular, monospace;
  --container: 1120px;
  --space: clamp(64px, 10vw, 120px);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0; background: var(--bg); color: var(--body);
  font-family: var(--font); line-height: 1.7;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4 { margin: 0; color: var(--ink); line-height: 1.25; font-weight: 800; letter-spacing: -0.02em; }
a { color: var(--brand-blue); text-decoration: none; }
a:hover { color: var(--brand-blue-dark); }
img { max-width: 100%; display: block; }
.container { max-width: var(--container); margin: 0 auto; padding: 0 24px; }
section { padding: var(--space) 0; scroll-margin-top: 72px; }

/* ===== 通用动效基元 ===== */
.reveal { opacity: 0; transform: translateY(24px); transition: opacity .5s ease, transform .5s ease; }
.reveal.in { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .reveal { opacity: 1; transform: none; transition: none; }
}
</style>
</head>
<body>
<header class="site-nav" id="top"></header>
<main>
  <section class="hero" id="hero"></section>
  <section class="painpoints" id="painpoints"></section>
  <section class="features" id="features"></section>
  <section class="showcase" id="showcase"></section>
  <section class="download" id="download"></section>
  <section class="changelog" id="changelog"></section>
  <section class="faq" id="faq"></section>
</main>
<footer class="site-foot"></footer>
<script>
"use strict";
</script>
</body>
</html>
```

- [ ] **Step 2: 结构校验**

Run:
```bash
node -e 'const s=require("fs").readFileSync("landing/index.html","utf8");
const want=["hero","painpoints","features","showcase","download","changelog","faq"];
const got=[...s.matchAll(/<section class="([a-z]+)"/g)].map(m=>m[1]);
const miss=want.filter(w=>!got.includes(w));
if(miss.length){console.error("缺区块:",miss);process.exit(1);}
console.log("OK sections:",got.join(","));'
```
Expected: `OK sections: hero,painpoints,features,showcase,download,changelog,faq`

- [ ] **Step 3: 起本地静态服务预览**

Run:
```bash
node -e 'const http=require("http"),fs=require("fs"),path=require("path");
http.createServer((q,s)=>{let f=path.join("landing",decodeURIComponent(q.url.split("?")[0]));if(f.endsWith("/"))f+="index.html";fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);s.end("404");}else{s.writeHead(200,{"content-type":"text/html; charset=utf-8"});s.end(d);}});}).listen(3000,()=>console.log("http://localhost:3000"));'
```
Expected: 浏览器打开 `http://localhost:3000` 可见空白页面骨架（导航/区块/页脚均空，但无报错）。

- [ ] **Step 4: Commit**

```bash
git add landing/index.html
git commit -m "feat(landing): 落地页骨架与视觉系统"
```

---

### Task 2: 顶部导航 + Hero + 主截图位

**Files:**
- Modify: `landing/index.html`（`<header>` 与 `.hero` 区；CSS 追加导航与 Hero 样式）

**Interfaces:**
- Consumes: Task 1 的骨架与 `.reveal` 动效基元。
- Produces: 导航结构 `.site-nav`（含 `#nav-download` 按钮）；Hero 内 `.hero-eyebrow`、`h1`（`.hl` 高亮 span）、`.hero-sub`、`.dl-cta`（主按钮 `#btn-dl-primary`、副按钮 `#btn-dl-all`）、`.platform-pills`、`.hero-shot` 截图容器、`.hero-glow` 背景。

- [ ] **Step 1: 写入导航与 Hero 结构**

在 `<header class="site-nav">` 与 `<section class="hero">` 中填入：

```html
<header class="site-nav" id="top">
  <div class="container nav-in">
    <a class="brand" href="#top"><span class="brand-mark"></span>Lynel&nbsp;Desktop</a>
    <nav class="nav-links">
      <a href="#features">功能</a>
      <a href="#showcase">界面</a>
      <a href="#download">下载</a>
      <a href="#changelog">更新日志</a>
    </nav>
    <a class="btn btn-primary btn-sm" href="#download" id="nav-download">下载</a>
  </div>
</header>
```

```html
<section class="hero" id="hero">
  <div class="hero-glow" aria-hidden="true"></div>
  <div class="container hero-in">
    <p class="hero-eyebrow">跨平台 · 多 Agent · 开源</p>
    <h1>把 <span class="hl hl-blue">Claude Code</span> / <span class="hl hl-red">Codex</span> / <span class="hl hl-blue">OpenCode</span> / <span class="hl hl-red">OMP</span><br>装进一个本地窗口</h1>
    <p class="hero-sub">多会话管理 · 统一权限审批 · 实时 Trace · 企业微信远程<br>托管多个终端 CLI，一套会话，两种界面。</p>
    <div class="dl-cta">
      <a class="btn btn-primary" id="btn-dl-primary" href="/api/update/download?platform=win&arch=x64">检测下载平台…</a>
      <a class="btn btn-ghost" id="btn-dl-all" href="#download">所有下载选项</a>
    </div>
    <div class="platform-pills">
      <span>macOS</span><span>Windows</span><span>Linux</span>
    </div>
    <div class="hero-shot shot" data-name="hero">
      <img src="" alt="Lynel Desktop 主窗口截图（三段式布局）" loading="eager">
      <div class="shot-fallback">主窗口截图 · 左会话列表 | 中终端 | 右 Trace</div>
    </div>
  </div>
</section>
```

CSS 追加（含导航吸顶、Hero、按钮、截图位兜底、背景光斑动画）：

```css
/* 导航 */
.site-nav { position: sticky; top: 0; z-index: 50; background: rgba(247,248,250,.85); backdrop-filter: blur(12px); border-bottom: 1px solid transparent; transition: border-color .3s ease, box-shadow .3s ease; }
.site-nav.scrolled { border-color: var(--line); box-shadow: 0 4px 20px rgba(13,24,41,.05); }
.nav-in { height: 60px; display: flex; align-items: center; gap: 32px; }
.brand { display: flex; align-items: center; gap: 8px; color: var(--ink); font-weight: 800; font-size: 17px; }
.brand-mark { width: 18px; height: 18px; display: inline-grid; grid-template-columns: 1fr 1fr; gap: 2px; }
.brand-mark::before, .brand-mark::after { content:""; border-radius: 3px; }
.brand-mark::before { background: var(--brand-blue); }
.brand-mark::after { background: var(--brand-red); }
.nav-links { display: flex; gap: 24px; margin-left: auto; }
.nav-links a { color: var(--body); font-size: 14px; font-weight: 600; }
.nav-links a:hover { color: var(--brand-blue); }

/* 按钮 */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: var(--radius-btn); padding: 12px 22px; font-weight: 700; font-size: 15px; transition: transform .15s ease, background .15s ease, box-shadow .15s ease; }
.btn:active { transform: scale(.98); }
.btn-primary { background: var(--brand-blue); color: #fff; box-shadow: 0 6px 18px rgba(30,90,245,.3); }
.btn-primary:hover { background: var(--brand-blue-dark); color: #fff; transform: translateY(-1px) scale(1.02); }
.btn-ghost { background: var(--surface); color: var(--ink); border: 1px solid var(--line); }
.btn-ghost:hover { border-color: #d4dbe6; transform: translateY(-1px); }
.btn-sm { padding: 8px 16px; font-size: 14px; }

/* Hero */
.hero { position: relative; overflow: hidden; padding-top: clamp(56px, 9vw, 104px); text-align: center; }
.hero-glow { position: absolute; inset: 0; z-index: -1; background: radial-gradient(480px 300px at 20% 20%, rgba(30,90,245,.12), transparent 70%), radial-gradient(480px 300px at 80% 30%, rgba(230,57,70,.10), transparent 70%); animation: breathe 12s ease-in-out infinite; }
@keyframes breathe { 0%,100% { opacity:.6; transform: scale(1); } 50% { opacity:1; transform: scale(1.06); } }
.hero-eyebrow { display: inline-block; font-size: 13px; font-weight: 700; letter-spacing: .06em; color: var(--brand-blue); background: var(--brand-blue-soft); border: 1px solid #d7e3ff; padding: 6px 14px; border-radius: 999px; margin-bottom: 20px; }
.hero h1 { font-size: clamp(32px, 5.4vw, 56px); margin-bottom: 18px; }
.hl { font-weight: inherit; }
.hl-blue { color: var(--brand-blue); }
.hl-red { color: var(--brand-red); }
.hero-sub { font-size: clamp(15px, 2vw, 18px); color: var(--muted); margin: 0 0 28px; }
.dl-cta { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
.platform-pills { display: flex; gap: 10px; justify-content: center; margin-top: 18px; }
.platform-pills span { font-size: 12px; color: var(--muted); background: var(--surface); border: 1px solid var(--line); padding: 3px 10px; border-radius: 999px; }
.hero-shot { margin: 44px auto 0; max-width: 980px; }

/* 截图位通用 */
.shot { position: relative; border-radius: var(--radius-frame); border: 1px solid var(--line); background: var(--surface); box-shadow: var(--shadow-lg); overflow: hidden; transition: transform .3s ease, box-shadow .3s ease; }
.shot:hover { transform: scale(1.02); box-shadow: var(--shadow-lg); }
.shot img { width: 100%; height: auto; }
.shot-fallback { display: flex; align-items: center; justify-content: center; min-height: 320px; color: var(--muted); font-size: 14px; background: linear-gradient(135deg, #fafbfc, #f2f4f7); }
@media (prefers-reduced-motion: reduce) { .hero-glow { animation: none; } }
```

- [ ] **Step 2: 滚动吸顶状态 JS**

在 `<script>` 中追加：

```js
const nav = document.querySelector('.site-nav');
addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 40), { passive: true });
```

- [ ] **Step 3: 校验 + 预览**

Run Task 1 的 node 结构校验（含 section 检查）+ `node --check` 校验脚本语法：
```bash
node -e 'const s=require("fs").readFileSync("landing/index.html","utf8");
const js=[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join("\n");
require("fs").writeFileSync("landing/_tmp.js",js);'
node --check landing/_tmp.js && rm landing/_tmp.js
```
Expected: `node --check` 无输出（语法 OK）。浏览器预览可见导航、Hero 标题、下载按钮、截图占位。

- [ ] **Step 4: Commit**

```bash
git add landing/index.html
git commit -m "feat(landing): 顶部导航与 Hero 区"
```

---

### Task 3: 痛点 + 功能亮点 + 界面展示

**Files:**
- Modify: `landing/index.html`（`#painpoints` / `#features` / `#showcase` 区；CSS 追加卡片与展示样式）

**Interfaces:**
- Consumes: Task 1 的 `.reveal` 基元、Task 2 的 `.shot` 截图位样式。
- Produces: `.card` 卡片类、`.feature-grid`（7 卡）、`.showcase-grid`（3 大图，各含 `.shot` 截图位）、卡片 hover 渐变条。

- [ ] **Step 1: 痛点→解决方案 3 卡**

```html
<section class="painpoints" id="painpoints">
  <div class="container">
    <h2 class="sec-title reveal">为什么需要 Lynel Desktop</h2>
    <div class="card-grid cols-3">
      <article class="card reveal">
        <h3>多会话难管理</h3>
        <p>多个 Claude / Codex 会话散在各终端，看不出谁在跑、跑到了哪。</p>
        <div class="card-fix">会话列表一眼看清状态，随时切换。</div>
      </article>
      <article class="card reveal">
        <h3>权限弹窗打断</h3>
        <p>PermissionRequest 弹在终端里，要切回窗口手动确认，节奏全断。</p>
        <div class="card-fix">权限仲裁器统一审批，主窗口 / 企业微信多通道处理。</div>
      </article>
      <article class="card reveal">
        <h3>Hooks 配置繁琐</h3>
        <p>改 settings.json 要开编辑器、背 schema，每台机器都要配。</p>
        <div class="card-fix">临时 settings 注入，零配置即用。</div>
      </article>
    </div>
  </div>
</section>
```

- [ ] **Step 2: 功能亮点 7 卡**

```html
<section class="features" id="features">
  <div class="container">
    <h2 class="sec-title reveal">能力一览</h2>
    <div class="card-grid cols-3 feature-grid">
      <article class="card reveal"><h3>多 Agent 托管</h3><p>Claude Code / Codex / OpenCode / OMP 统一托管，按类型恢复会话。</p></article>
      <article class="card reveal"><h3>权限仲裁器</h3><p>所有权限请求集中审批，先到先生效，多通道解决。</p></article>
      <article class="card reveal"><h3>Trace 面板</h3><p>实时 API 请求列表：状态、模型、延迟、费用一屏看清。</p></article>
      <article class="card reveal"><h3>企业微信通道</h3><p>远程收发消息、审批权限、AskUserQuestion 模板卡片。</p></article>
      <article class="card reveal"><h3>云端上行</h3><p>阶段事件批量推送，会话元数据同步至云服务。</p></article>
      <article class="card reveal"><h3>历史会话自动扫描</h3><p>读取本地项目目录与 recent-sessions，文件变化即时刷新。</p></article>
      <article class="card reveal"><h3>DeepSeek Harness 界面</h3><p>内嵌 DSH Web 前端，支持 Bot 绑定、提问接管、轨迹实时转发。</p></article>
    </div>
  </div>
</section>
```

- [ ] **Step 3: 界面展示 3 大图**

```html
<section class="showcase" id="showcase">
  <div class="container">
    <h2 class="sec-title reveal">界面一览</h2>
    <div class="showcase-grid">
      <figure class="shot reveal" data-name="showcase-terminal">
        <img src="" alt="xterm 终端里 agent 流式运行" loading="lazy">
        <figcaption class="shot-caption">xterm 原生终端 · PTY 驱动交互式 agent</figcaption>
        <div class="shot-fallback">终端运行示意图</div>
      </figure>
      <figure class="shot reveal" data-name="showcase-dsh">
        <img src="" alt="DeepSeek Harness Web 界面" loading="lazy">
        <figcaption class="shot-caption">DeepSeek Harness Web 界面 · 支持绑定 Bot</figcaption>
        <div class="shot-fallback">DSH 界面示意图</div>
      </figure>
      <figure class="shot reveal" data-name="showcase-wecom">
        <img src="" alt="企业微信审批卡片" loading="lazy">
        <figcaption class="shot-caption">企业微信远程 · 审批卡片与进度</figcaption>
        <div class="shot-fallback">企业微信审批示意</div>
      </figure>
    </div>
  </div>
</section>
```

CSS 追加：

```css
.sec-title { font-size: clamp(24px, 3.4vw, 34px); text-align: center; margin-bottom: 40px; }
.card-grid { display: grid; gap: 20px; }
.cols-3 { grid-template-columns: repeat(3, 1fr); }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); padding: 26px; position: relative; overflow: hidden; transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
.card::before { content:""; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, var(--brand-blue), var(--brand-red)); transform: scaleX(0); transform-origin: left; transition: transform .3s ease; }
.card:hover { transform: translateY(-4px); box-shadow: var(--shadow); border-color: #dde4ee; }
.card:hover::before { transform: scaleX(1); }
.card h3 { font-size: 17px; margin-bottom: 8px; }
.card p { font-size: 14px; margin: 0 0 12px; color: var(--muted); }
.card-fix { font-size: 14px; font-weight: 600; color: var(--brand-blue); border-left: 3px solid var(--brand-blue-soft); padding-left: 10px; }
.feature-grid { grid-template-columns: repeat(3, 1fr); }
.showcase-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; }
.showcase-grid .shot { margin: 0; }
.shot-caption { padding: 14px 16px; font-size: 13px; color: var(--muted); border-top: 1px solid var(--line); }
@media (max-width: 900px) { .cols-3, .feature-grid, .showcase-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 4: 校验 + 预览**

Run: Task 1 结构校验（期望 section 仍齐全，`showcase` 内含 3 个 `.shot`）+ `node --check`。
Expected: 卡片网格、7 功能卡、3 大图展示正确。

- [ ] **Step 5: Commit**

```bash
git add landing/index.html
git commit -m "feat(landing): 痛点、功能亮点与界面展示区"
```

---

### Task 4: 下载交互逻辑（JS 核心）

**Files:**
- Modify: `landing/index.html`（`#download` 区结构 + CSS + `<script>` 中平台检测 / fetch / 渲染）

**Interfaces:**
- Consumes: Task 2 的 `#btn-dl-primary` / `#btn-dl-all` 按钮、`.platform-pills`。
- Produces: 纯函数 `detectPlatform() → {platform, arch}`、`dlUrl(platform, arch, version?)`、`fetchCheck(platform, arch) → CheckResult|null`；下载区 DOM：`.plat-tabs`（tab 按钮 data-plat / data-arch）、`.dl-meta`（版本/大小/状态）。

- [ ] **Step 1: 下载区结构**

```html
<section class="download" id="download">
  <div class="container">
    <h2 class="sec-title reveal">下载 Lynel Desktop</h2>
    <div class="dl-panel reveal">
      <div class="plat-tabs" role="tablist" aria-label="选择平台">
        <button class="tab" data-plat="win" data-arch="x64">Windows</button>
        <button class="tab" data-plat="mac" data-arch="x64">macOS · Intel</button>
        <button class="tab" data-plat="mac" data-arch="arm64">macOS · Apple Silicon</button>
        <button class="tab" data-plat="linux" data-arch="x64">Linux</button>
      </div>
      <div class="dl-meta">
        <span class="dl-version" id="dl-version">版本检测中…</span>
        <span class="dl-size" id="dl-size"></span>
      </div>
      <a class="btn btn-primary btn-lg" id="btn-dl-current" href="/api/update/download?platform=win&arch=x64">准备下载…</a>
      <p class="dl-hint" id="dl-hint"></p>
    </div>
  </div>
</section>
```

CSS 追加：

```css
.dl-panel { max-width: 640px; margin: 0 auto; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-frame); padding: 32px; text-align: center; box-shadow: var(--shadow); }
.plat-tabs { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-bottom: 22px; }
.tab { padding: 8px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--body); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; transition: all .15s ease; }
.tab:hover { border-color: #c9d4e6; }
.tab.active { background: var(--brand-blue); color: #fff; border-color: var(--brand-blue); }
.dl-meta { display: flex; gap: 14px; justify-content: center; align-items: baseline; margin-bottom: 20px; }
.dl-version { font-family: var(--mono); font-weight: 700; color: var(--ink); font-size: 18px; }
.dl-size { color: var(--muted); font-size: 13px; }
.btn-lg { padding: 15px 34px; font-size: 16px; min-width: 260px; }
.dl-hint { margin: 16px 0 0; font-size: 13px; color: var(--muted); }
.btn.loading { opacity: .7; pointer-events: none; }
.btn.loading::after { content:""; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 2: 平台检测纯函数 + fetch 封装**

在 `<script>` 中追加：

```js
"use strict";
const ORIGIN = window.location.origin;

function detectPlatform() {
  let platform = '';
  let arch = 'x64';
  const ua = navigator.userAgent;
  const uad = navigator.userAgentData;
  if (uad && uad.platform) platform = uad.platform.toLowerCase();
  else if (/win/i.test(ua)) platform = 'win';
  else if (/mac/i.test(ua) || /darwin/i.test(ua)) platform = 'mac';
  else if (/linux/i.test(ua)) platform = 'linux';
  else platform = 'win';
  if (/arm64|aarch64/i.test(ua)) arch = 'arm64';
  if (platform === 'win') {
    if (/\bx64\b|WOW64/i.test(ua) || /win64/i.test(ua)) arch = 'x64';
  }
  return { platform: platform === 'win' ? 'win' : platform, arch };
}

function dlUrl(platform, arch, version) {
  const base = ORIGIN + '/api/update/download?platform=' + platform + '&arch=' + arch;
  return version ? base + '&version=' + encodeURIComponent(version) : base;
}

async function fetchCheck(platform, arch) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const url = ORIGIN + '/api/update/check?platform=' + platform + '&arch=' + arch + '&version=0&channel=stable';
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; } finally { clearTimeout(timer); }
}
```

- [ ] **Step 3: 主按钮 + tabs 渲染**

在 `<script>` 中追加：

```js
const $ = (s) => document.querySelector(s);
const current = { ...detectPlatform(), info: null };
const PLAT_LABEL = { win: 'Windows', mac: 'macOS', linux: 'Linux' };

function applyButton(btn, platform, arch, info) {
  const ver = info && info.version ? 'v' + info.version : '';
  const size = info && info.size ? ' · ' + fmtSize(info.size) : '';
  btn.textContent = (info ? '下载 ' + PLAT_LABEL[platform] + ' ' + arch + ' 版 ' + ver + size : '准备下载…');
  btn.href = info && info.downloadUrl ? info.downloadUrl : dlUrl(platform, arch);
}
function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(0) + ' MB' : (n / 1024).toFixed(0) + ' KB'; }

async function loadInfo(platform, arch, btn) {
  btn.classList.add('loading');
  const info = await fetchCheck(platform, arch);
  btn.classList.remove('loading');
  if (info && info.downloadUrl) {
    applyButton(btn, platform, arch, info);
    return info;
  }
  btn.textContent = '下载 ' + PLAT_LABEL[platform] + ' ' + arch + ' 版';
  btn.href = dlUrl(platform, arch);
  $('#dl-hint').textContent = '自动检测失败，已回退为云服务直链（最新版）。';
  return null;
}

// 主按钮
const btnPrimary = $('#btn-dl-primary');
loadInfo(current.platform, current.arch, btnPrimary).then((info) => { current.info = info; renderMeta(info); });

// 下载区当前按钮 + tabs
const btnCurrent = $('#btn-dl-current');
let active = { ...current };
function renderMeta(info) {
  const ver = $('#dl-version'), size = $('#dl-size');
  ver.textContent = info && info.version ? 'v' + info.version : '最新版';
  size.textContent = info && info.size ? fmtSize(info.size) : '';
}
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    active = { platform: tab.dataset.plat, arch: tab.dataset.arch };
    const info = loadInfo(active.platform, active.arch, btnCurrent);
    btnCurrent.classList.add('loading');
    Promise.resolve(info).then((r) => { btnCurrent.classList.remove('loading'); renderMeta(r); });
  });
});
// 初始选中当前平台 tab
document.querySelectorAll('.tab').forEach((t) => {
  if (t.dataset.plat === current.platform && t.dataset.arch === current.arch) t.classList.add('active');
});
```

- [ ] **Step 4: 校验 + 预览**

Run: `node --check`（从 HTML 提取 script）+ 结构校验 + 浏览器预览。
Expected: 页面加载后主按钮文本变为「下载 Windows x64 版 vX.Y.Z · NN MB」（若接口 404 则回退为静态文本）。点击不同 tab 按钮进入 loading 再更新。

- [ ] **Step 5: Commit**

```bash
git add landing/index.html
git commit -m "feat(landing): 下载交互逻辑（平台检测/接口/降级）"
```

---

### Task 5: 更新日志 + FAQ + 页脚 + 滚动动效

**Files:**
- Modify: `landing/index.html`（`#changelog` / `#faq` / `<footer>` 区；`<script>` 追加 list 接口渲染与 IntersectionObserver）

**Interfaces:**
- Consumes: Task 4 的 `fetchCheck`、`current`、`fmtSize`。
- Produces: `.log-list`（版本条目）、`renderChangelog(list)` 降级路径；`IntersectionObserver` 全局 `.reveal` 触发；页脚结构。

- [ ] **Step 1: 更新日志 + FAQ + 页脚结构**

```html
<section class="changelog" id="changelog">
  <div class="container">
    <h2 class="sec-title reveal">更新日志</h2>
    <div class="log-list reveal" id="log-list">加载中…</div>
  </div>
</section>
<section class="faq" id="faq">
  <div class="container">
    <h2 class="sec-title reveal">常见问题</h2>
    <div class="faq-grid">
      <details class="faq-item reveal"><summary>支持哪些 Agent？</summary><p>Claude Code、Codex、OpenCode、OMP，以及内嵌的 DeepSeek Harness Web 界面。</p></details>
      <details class="faq-item reveal"><summary>我的本地会话会被上传吗？</summary><p>会话数据默认本地存储；仅在你配置并开启云服务时，才按需上行同步。</p></details>
      <details class="faq-item reveal"><summary>如何远程控制？</summary><p>绑定企业微信 Bot 后，可在手机端收发消息、审批权限、查看进度。</p></details>
    </div>
  </div>
</section>
<footer class="site-foot">
  <div class="container foot-in">
    <span>© 2026 Lynel Desktop · MIT License</span>
    <span class="foot-links"><a href="https://github.com/walleliu1016/lynel-desktop" target="_blank" rel="noopener">GitHub</a><a href="/docs/usage.md">使用文档</a></span>
  </div>
</footer>
```

CSS 追加：

```css
.log-list { max-width: 720px; margin: 0 auto; }
.log-item { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); padding: 18px 22px; margin-bottom: 12px; }
.log-item h3 { font-size: 15px; display: flex; align-items: baseline; gap: 12px; }
.log-item .ver { font-family: var(--mono); color: var(--brand-blue); }
.log-item .date { font-size: 12px; color: var(--muted); font-weight: 400; }
.log-item pre, .log-item p { font-size: 13px; color: var(--body); white-space: pre-wrap; margin: 8px 0 0; }
.faq-grid { max-width: 720px; margin: 0 auto; display: grid; gap: 12px; }
.faq-item { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); padding: 0 22px; }
.faq-item summary { cursor: pointer; padding: 16px 0; font-weight: 700; color: var(--ink); font-size: 15px; }
.faq-item p { margin: 0 0 16px; font-size: 14px; }
.site-foot { border-top: 1px solid var(--line); padding: 32px 0; }
.foot-in { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; color: var(--muted); font-size: 13px; }
.foot-links { display: flex; gap: 20px; }
```

- [ ] **Step 2: 更新日志渲染 + 降级**

在 `<script>` 中追加：

```js
async function fetchList() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const resp = await fetch(ORIGIN + '/api/update/list', { signal: ctrl.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; } finally { clearTimeout(timer); }
}
function renderChangelog(versions) {
  const box = $('#log-list');
  if (!versions || !versions.length) {
    box.innerHTML = '<div class="log-item"><h3><span class="ver">' + (current.info && current.info.version ? 'v' + current.info.version : '最新版') + '</span></h3><p>' + esc((current.info && current.info.releaseNotes) || '暂无更新日志。') + '</p></div>';
    return;
  }
  box.innerHTML = versions.slice(0, 5).map((v) =>
    '<div class="log-item"><h3><span class="ver">v' + esc(v.version) + '</span><span class="date">' + esc((v.releaseDate || '').slice(0, 10)) + '</span></h3><p>' + esc(v.releaseNotes || '') + '</p></div>'
  ).join('');
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
fetchList().then((data) => renderChangelog(data && data.versions));
```

- [ ] **Step 3: 全局滚动动效**

在 `<script>` 中追加：

```js
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((el, i) => {
    el.style.transitionDelay = (i % 3) * 60 + 'ms';
    io.observe(el);
  });
} else {
  document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
}
```

- [ ] **Step 4: 校验 + 预览**

Run: `node --check` + 结构校验 + 浏览器预览。
Expected: 更新日志显示列表（接口 404 时降级为单条）；FAQ 可展开；滚动时区块逐个淡入；页脚正常。

- [ ] **Step 5: Commit**

```bash
git add landing/index.html
git commit -m "feat(landing): 更新日志、FAQ、页脚与滚动动效"
```

---

### Task 6: 无障碍 + 性能收尾 + 全量验证

**Files:**
- Modify: `landing/index.html`（补 focus 样式、`aria` 细节、移动端微调；无需新增结构）

**Interfaces:**
- Consumes: 全部前序任务的产出。

- [ ] **Step 1: 补充无障碍与移动端收尾**

在 CSS 追加：

```css
:focus-visible { outline: 2px solid var(--brand-blue); outline-offset: 2px; }
.tab:focus-visible, .btn:focus-visible, .nav-links a:focus-visible { outline: 2px solid var(--brand-blue); outline-offset: 2px; }
.hero-shot .shot-fallback { min-height: 420px; }
@media (max-width: 640px) {
  .nav-links { display: none; }
  .hero h1 br { display: none; }
  .dl-panel { padding: 22px 16px; }
  .btn-lg { min-width: 100%; }
}
```

确保：所有 `<img>` 有 `alt`；tabs 有 `role="tablist"`；按钮有可读文本；对比度达标（品牌蓝 `#1e5af5` 在白底上 contrast ≥ 4.5）。

- [ ] **Step 2: 全量验证清单**

Run 以下全部并逐项确认：

```bash
# 1. 结构：8 个 section + 页脚 + script 语法
node -e 'const s=require("fs").readFileSync("landing/index.html","utf8");
const want=["hero","painpoints","features","showcase","download","changelog","faq"];
const got=[...s.matchAll(/<section class="([a-z]+)"/g)].map(m=>m[1]);
if(want.some(w=>!got.includes(w))){console.error("缺 section");process.exit(1);}
const shots=[...s.matchAll(/class="[^"]*\bshot\b[^"]*"/g)].length;
console.log("sections:",got.length,"shots:",shots);
if(!s.includes("<footer")||!s.includes("</footer>")){console.error("缺 footer");process.exit(1);}'
# 2. JS 语法
node -e 'const s=require("fs").readFileSync("landing/index.html","utf8");
require("fs").writeFileSync("landing/_tmp.js",[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join("\n"));'
node --check landing/_tmp.js && rm landing/_tmp.js
# 3. 无外链/无 CDN/无写死版本号
node -e 'const s=require("fs").readFileSync("landing/index.html","utf8");
if(/https?:\/\/[^"\s]*(?:\.css|\.js)/.test(s)){console.error("发现外链资源");process.exit(1);}
if(/0\.0\.(2[0-9]|1[0-9])/.test(s)){console.error("发现写死版本号");process.exit(1);}
console.log("no external assets, no hardcoded version");'
```

手动逐项确认：
- 浏览器打开 `http://localhost:3000`：滚动区块逐个淡入；Hero 光斑呼吸；导航滚动后吸顶毛玻璃
- 下载按钮：接口可达 → 显示真实版本/大小/直链；接口 404 → 回退静态文本 + 提示；点击各平台 tab 正常切换
- 禁用 JS（DevTools）刷新：页面完整可读，下载链接仍是相对 `/api/update/download?...`
- 移动端视口（375px）：单列、导航链接隐藏、按钮全宽
- 模拟 `prefers-reduced-motion: reduce`：无动效、内容全部可见

- [ ] **Step 3: Commit**

```bash
git add landing/index.html
git commit -m "feat(landing): 无障碍、性能与全量验证收尾"
```

---

## Self-Review 记录

**Spec 覆盖：**
- 视觉系统（配色/字体/圆角/阴影）→ Task 1
- 7 区块 + 导航 + 页脚 → Task 2/3/5
- 截图位①-⑦ 与 `.shot` 兜底 → Task 2/3
- 下载交互（平台检测/check 接口/tabs/降级链）→ Task 4
- 更新日志（list 接口 + 降级）→ Task 5
- 动效清单（scroll reveal/光斑/卡片 hover/tab 淡入/spinner/吸顶）→ Task 2/3/4/5
- 降级链（无 JS 静态链接、接口失败回退）→ Task 4/6
- 无障碍（aria/focus/reduced-motion/对比度）→ Task 5/6
- 性能（零外链、lazy）→ Task 3（`loading="lazy"`）/6
- 测试（本地 serve + 手动清单）→ Task 1 起每步 + Task 6 全量

**占位符扫描：** 无 TBD/TODO；每个代码步骤含完整实现。

**类型一致性：** `detectPlatform()` 返回 `{platform, arch}`；`fetchCheck(platform,arch)` 返回 `CheckResult|null`；`dlUrl(platform,arch,version?)`；`fmtSize(n)`；`renderChangelog(versions)`；`esc(s)` 在各 task 使用处签名一致。
