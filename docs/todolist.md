# Todolist

未解决问题和后续要做的事项。每条带优先级、根因摘要、复现路径。

## 进行中

### [P1] claude `/exit` 后"重新进入"按钮点不开
- **现象**：用户在 claude 终端里执行 `/exit`（或 `exit`）→ claude 进程退出 → 界面显示"重新进入"按钮 → 点击后 claude 立即报 `No conversation found with session ID: <uuid>` 并 exit code=1。
- **代码位置**：
  - `src/main/app.ts:1476-1488` `wirePty` 的 `onExit` 回调（只发 done 事件 + 清 process 引用，没标记"已终止"）
  - `src/main/app.ts:openTerminal` 里的 jsonl 存在性 fallback（**只覆盖 jsonl 不存在的场景**）
  - `src/renderer/src/components/XtermTerminal.vue:reconnect()`（"重新进入"按钮入口）
- **根因摘要**：
  - claude CLI 内部把 `/exit` 过的 session 标记为"已终止"，即使 jsonl 完整存在，再次 `claude --resume <sid>` 也会被它自己拒绝。
  - 当前 `openTerminal` 的 fallback（`PtyMode.New` + 同 sid）只在 `fs.existsSync(jsonlPath) === false` 时触发，对"jsonl 存在但 claude 拒绝 resume"无能为力。
- **已尝试的修复**（本轮 commit，已合并到代码）：
  1. `openTerminal` 加 jsonl 存在性检查 + fallback 到 `PtyMode.New`（仅解决 phantom session 重启场景，未覆盖 `/exit` 重新进入场景）
  2. `createSessionInternal` 末尾的 `addRecentSession` 延迟到首个 `UserPromptSubmit` hook 触发后再写（治本，避免 phantom session 进入 recent 列表）
- **复现路径**：
  1. 新建 session → 发任意 prompt
  2. claude 终端里输入 `/exit` 或 `exit`
  3. 前端出现"Claude 进程已退出 / 重新进入"按钮
  4. 点击按钮 → 主进程日志出现 `mode=resume` → claude 立即 exit code=1 + `No conversation found`
- **可能的下一方向**：
  - 在 `onExit` 回调里给 session 打"已终止"标记（`instanceStore.set(sessions.${id}.terminated, true)`），`openTerminal` 检测到这个标记就直接走 `PtyMode.New` + 同 sid，不再尝试 `--resume`。代价：丢失历史消息上下文（jsonl 仍保留在磁盘，可手动备份）。
  - 或者更激进：把"已终止"session 的 jsonl 在退出时重命名为 `<sid>.jsonl.exited-<filename>`，避免下次 fallback 时被覆盖。
  - 或者最保守：什么都不改，文档化"重新进入"/exit 过的 session 是已知限制。
- **当前代码状态**：未实施"已终止"标记。`openTerminal` 只在 jsonl 文件层面兜底。

### [P1] xterm 切换字体/字号后老 buffer 不重排
- **现象**：从设置面板改字号/字体族/行高后，老内容（切字体前写的）仍按旧 cols 留在屏幕左侧挤成窄条；新内容按新 cols 满宽显示。截图见 `3.png` / `5.png` / `6.png`。
- **代码位置**：`src/renderer/src/components/XtermTerminal.vue` 的 `applyTerminalConfig`。
- **已尝试方案**（按时间顺序，均未根治）：
  1. `fitAddon.fit()` 后调 `term.refresh()` —— 仅刷新渲染，不 re-wrap 旧 buffer。
  2. `(term as any)._core?._renderService?.onCharSizeChanged?.()` 强制 renderer 重测 —— **方法名错的**（xterm 6.0 叫 `handleCharSizeChanged`），且根本不是根因。
  3. `term.reset()` + `term.write(saved)` 手动 reflow，saveBuffer 用 `line.isWrapped` 还原逻辑行 —— colors 全丢，wrap 也不对（fit 算出来的 cols 本身就不对）。
  4. **`applyTerminalConfig` 改为 async，先 `await waitForFontReady()` 再写 `term.options.fontSize/family`** —— code-reviewer 诊断指出的根因：xterm 在 options 写时同步 measure，字体未就绪会拿回退字体的 metrics 锁死 cell.width。当前已采用此方案，但**用户复测仍不生效**，说明 xterm 6.0 这条自动 reflow 链路在 buffer resize 时未触发 re-wrap。
- **可能的下一方向**：
  - 确认 xterm 6.0 是否有 `reflow` 选项/flag 需要显式开启。
  - 回退到 `term.reset() + term.write(saved)` 手动 reflow，但要先解决 cols 算错问题（用隐藏 span 测 char width 直接算 cols，绕过 xterm measure 缓存）。
  - 引入 `xterm-addon-serialize`（第三方），它对 wrap 点的处理比内置 `term.serialize()` 正确。
- **当前代码状态**：`applyTerminalConfig` 已改为 async、`waitForFontReady` 提前到 options 写入之前。`refitAfterFontChange` / `saveBuffer` / `term.reset()+term.write(saved)` 那套手动 reflow 逻辑已删除。
- **临时绕过**：用户已接受"切字体后老内容残留窄条"为已知瑕疵，不阻塞后续工作。等后续根治。

## 已知非阻塞问题

（暂无）
