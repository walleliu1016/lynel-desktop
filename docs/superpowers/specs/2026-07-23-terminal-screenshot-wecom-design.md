# 终端截图发送企业微信

## 概述

通过企业微信指令 `/screenshot` 将任意会话的终端内容渲染为 PNG 图片发送到企业微信。

| 项目 | 决策 |
|------|------|
| 触发方式 | 企业微信 `/screenshot`（跟随现有会话路由） |
| 截图范围 | 缓冲区最后 50 行 |
| 捕获方案 | 主进程从 `session.getBuffer()` 取原始 ANSI → strip 控制码 → node-canvas 渲染 |
| 颜色保留 | 纯文本白底黑字 |

## 数据流

```
WeCom 收到 /screenshot
  → wecom-channel 识别为截图指令（非文本消息）
  → 目标 sessionId（引用路由 → bot 绑定 → 默认映射）
  → session.getBuffer(sid) 取 ANSI 原始 buffer
  → stripAnsi(text) 清洗 VT/xterm 控制码
  → 取最后 50 行纯文本
  → renderToPng(lines, fontOpts) → Buffer(PNG)
  → wsClient.uploadMedia(pngBuffer, 'image') → mediaId
  → wsClient.sendMediaMessage(chatId, 'image', mediaId)
```

## 组件设计

### 1. `src/main/terminal-screenshot.ts` — 新建

独立模块，纯函数，无 Electron/WeCom 依赖：

```typescript
// 清洗 ANSI 控制码
stripAnsi(raw: string): string

// 渲染文本为 PNG Buffer
renderTextToPng(
  lines: string[],
  fontSize: number = 14,
  padding: number = 16
): Buffer
```

**renderTextToPng 实现要点：**
- 计算最长行宽度 → 固定 canvas 宽度
- 固定行高（fontSize × 1.5）
- 等宽字体 `"Consolas, 'Courier New', monospace"`
- 白底黑字
- 返回 PNG Buffer

### 2. `src/main/channels/wecom-channel.ts` — 修改

**新增控制指令：**
```typescript
const CONTROL_COMMANDS = {
  // 现有
  '/interrupt': '\x03',
  // ...
  // 新增
  '/screenshot': '__screenshot__',
};
```

`__screenshot__` 为 sentinel 值，走截图流程而非 `session.writeInput()`。

**`handleScreenshot(sid: string, chatId: string)` 新增方法：**
1. `session.lookup(sid)` → 校验会话存在
2. `session.getBuffer(sid)` → 取原始 buffer
3. `stripAnsi(buffer)` → 清洗
4. 取最后 50 行（按 `\n` 分割）
5. `renderTextToPng(lines)` → PNG Buffer
6. `wsClient.uploadMedia(buf, 'image')` → mediaId
7. `wsClient.sendMediaMessage(chatId, 'image', mediaId)`
8. 失败时回复文本告知错误原因

### 3. `package.json` — 修改

新增依赖：
```json
"@napi-rs/canvas": "^0.1.68"
```

选用 `@napi-rs/canvas` 而非 `canvas`：Rust 实现，预编译二进制全平台支持（含 Windows），零系统依赖。

## 错误处理

| 场景 | 行为 |
|------|------|
| wsClient 未连接（bot 离线） | 回复文本「Bot 未连接」 |
| 目标 session 不存在 | 回复文本「会话不存在或已关闭」 |
| buffer 为空 | 回复文本「终端暂无内容」 |
| canvas 渲染失败 | 回复文本「截图渲染失败: <原因>」 |
| 上传/发送失败 | 回复文本「截图发送失败: <原因>」 |

## 行数限制

默认截取缓冲区最后 50 行，后续可扩展为 `/screenshot N` 指定行数。YAGNI：首版仅支持固定 50 行。 |

## 输入检测

`handleInboundMessage` 中，`/screenshot` 命令通过以下路由进入：
- `fromWeComMessage` → `mapReplyChatId` → `resolveSessionFromRef(sid)` / bot 绑定 → 确定目标 session

流程与现有 `/interrupt` 一致，区别是不调 `session.writeInput()`。

## 验证方式

1. `npm run test:main` 全绿
2. 启动 mock cloud server + dev server，在企业微信发送 `/screenshot` 验证
3. 多 session 场景：切换前后台验证截图均可用
