启用插件的完整步骤（在你的真实环境里，一次配好）：

## 1. 构建插件（如果 lynel-desktop 副本还没装依赖）

```bash
cd /Users/akke/project/lynel-desktop/dsh-lynel-plugin
pnpm install
pnpm build        # 产出 lib/index.js + lib/client.js
```

## 2. 安装进 DSH web profile

`dsh web` 和 lynel-desktop 内嵌的 dsh 都用 `~/.dsh/profiles/web`。插件声明了 `dsh.bundle.patch`，装完会自动加入启动清单：

```bash
# dsh 命令若在 PATH 上：
dsh plugin --profile web add file:/Users/akke/project/lynel-desktop/dsh-lynel-plugin

# 若 dsh 不在 PATH（用 lynel-desktop 自带的）：
node /Users/akke/project/lynel-desktop/node_modules/@deepseek-ai/dsh/lib/bin.js plugin \
  --profile web add file:/Users/akke/project/lynel-desktop/dsh-lynel-plugin
```

装完后 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 会自动多出 `"dsh-lynel-plugin"`。

> 也可以手动装：`cd ~/.dsh/profiles/web && pnpm add file:...`，然后手动把 `dsh-lynel-plugin` 追加进 `package.json` 的 `dsh.profile.bundles` 数组。

## 3. 重启

**完全退出 lynel-desktop 再重新打开**（或直接重启 `dsh web`）。插件只在启动时扫描，不重启不生效。

## 4. 验证已启用

- **命令行**：打开浏览器里 dsh 的地址，或
  ```bash
  curl http://127.0.0.1:<dsh端口>/lynel/config    # 有 JSON 返回 = 宿主端已加载
  ```
- **界面**：打开任意会话 → 标题旁出现「绑定 Bot」按钮；左下角设置 ⚙️ → 出现「Bot 设置」分区 = 客户端已加载。

## 5. 默认配置直接匹配你的环境，无需改动

插件默认值就是给你真实环境用的：

| 配置 | 默认值 |
|---|---|
| bot.json | `~/.lynel-desktop/bot.json` |
| ask 端点 | `http://localhost:17527/deepseek-harness/ask` |
| envelope 端点 | `http://localhost:17527/deepseek-harness/envelope` |

想改的话编辑 `~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- id: dsh-lynel-plugin
  config:
    askEndpoint: 'http://localhost:17528/deepseek-harness/ask'   # 例如临时指向 mock
```

## 6. 两个注意点

1. **你真实的 lynel 后端（17527）还没实现这两个路由**（之前测试时返回 404）。启用后：
   - 轨迹 envelope 会发过去但被 404 丢弃（重试一次后放弃）
   - Ask 钩子后端没响应时自动降级为手动回答面板，不会卡住
   - 需要你的后端按 README 协议实现 `/deepseek-harness/ask` 和 `/deepseek-harness/envelope`
2. **回话注入**：后端拿到 envelope 里的 `sessionId` 后，`POST http://127.0.0.1:<dsh端口>/lynel/send` 即可往会话发消息（dsh 端口在 `src/main/dsh.ts` 启动时已解析，存下来用）。

## 7. 卸载

```bash
dsh plugin --profile web remove dsh-lynel-plugin   # 或 pnpm remove + 从 bundles 移除
```

需要我直接把第 2 步帮你执行掉吗？（要写 `~/.dsh`，上次你拒绝了权限申请，所以这次先问一下——你同意我再操作。）