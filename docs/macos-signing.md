# macOS 签名与公证方案（GitHub Actions 私钥安全）

- 日期：2026-08-31
- 状态：**已落地**（`build.yml` 挂载 `release` environment 注入凭据，`electron-builder.yml` 开启 hardenedRuntime/entitlements/notarize，公证选**方案 A**）。剩余手动步骤：在 GitHub 配置 5 个 secrets，见下。

## 背景

当前 `.github/workflows/build.yml` 的 mac 构建**不签名不公证**：

```yaml
CSC_IDENTITY_AUTO_DISCOVERY: false   # 禁用了证书自动发现
```

未提供任何证书（`CSC_LINK`）或公证凭据（`APPLE_*`）。打出的 `.dmg` 未经 Apple 公证，用户首次打开会触发 Gatekeeper「无法验证开发者」警告。

## 目标

macOS 产物启用 Developer ID 签名 + notarization（公证），同时保证**私钥/凭据不在仓库中出现、不被 CI 日志泄漏、泄漏后可吊销**。

## 私钥安全原则

1. **私钥永不进仓库**：证书+私钥以 `.p12` 导出，base64 编码后仅存 GitHub Secrets。
2. **`.p12` 用强密码保护**：即使 base64 内容泄漏，无密码无法解出私钥。
3. **签名密码与证书内容分存**两个不同 Secret。
4. **公证凭据最小权限**：优先 App Store Connect API Key（可按权限创建、可独立吊销、可审计），其次 App 专用密码（不用 Apple ID 主密码）。
5. **Secret 环境限定**：repo Settings → Environments 配置 secrets 仅对 `main` / tag 分支可用，fork 的 PR 不可用，防止恶意 PR 窃取。
6. **日志保护**：GitHub 自动对 Secret 打码；workflow 内禁止 `echo ${{ secrets.X }}`。
7. **吊销与轮换**：怀疑泄漏 → Apple Developer 后台撤销证书，重新生成 `.p12` 并更新 Secret。

## GitHub Secrets 清单

### 签名（必需）

| Secret | 内容 | 说明 |
|---|---|---|
| `CSC_LINK` | Developer ID Application 证书 `.p12` 的 **base64** | electron-builder 签名用 |
| `CSC_KEY_PASSWORD` | `.p12` 导出密码 | 解开私钥 |

### 公证（二选一，**当前选用方案 A**）

**方案 A：App Store Connect API Key**（权限可收窄、可独立吊销、可审计，但要先配 API Key）

| Secret | 内容 |
|---|---|
| `APPLE_API_KEY` | `.p8` 私钥内容 |
| `APPLE_API_KEY_ID` | Key ID（App Store Connect → 用户与访问 → 密钥） |
| `APPLE_API_ISSUER` | Issuer ID（同页面顶部） |

**方案 B：Apple ID + App 专用密码**

| Secret | 内容 |
|---|---|
| `APPLE_ID` | Apple ID 邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | appleid.apple.com 生成的「App 专用密码」 |
| `APPLE_TEAM_ID` | 开发者团队 ID |

## build.yml 改动（已落地）

`build` job 挂载 `environment: release`（Environment secrets 绑定 Deployment branches → `v*`），`Build installer` 步骤注入凭据（仅 tag 构建能读到，日常 push 不签名）：

```yaml
  build:
    permissions:
      contents: write
    runs-on: ${{ matrix.os }}
    environment: release   # 仅 v* tag 构建可访问 secrets
    strategy:
      ...

    - name: Build installer
      run: npx electron-builder --${{ matrix.target }} ${{ matrix.arch }} --publish=never
      env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        CSC_IDENTITY_AUTO_DISCOVERY: false
        CSC_LINK: ${{ secrets.CSC_LINK }}                        # 签名
        CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
        APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}              # 公证（方案 A）
        APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
        APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
        APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
```

`electron-builder.yml` mac 段：`hardenedRuntime: true` + `entitlements: build/entitlements.mac.plist`（公证前提）+ `notarize: true`。electron-builder ≥ 24 检测到 `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD`（或 `APPLE_API_*`）凭据后自动执行 notarization（notarytool + staple）。`CSC_IDENTITY_AUTO_DISCOVERY: false` 保留，改为由 `CSC_LINK` 显式注入证书。

## 手动步骤（需在 Mac + GitHub 上操作，CI 无法代劳）

1. **导出证书**：Keychain 访问 → 选中 Developer ID Application 证书 → 右键导出为 `.p12`（勾选私钥，设强密码）。
2. **base64 编码**：
   ```bash
   base64 -i cert.p12 > cert.p12.b64
   ```
   把 `cert.p12.b64` 内容粘入 Secret `CSC_LINK`，密码粘入 `CSC_KEY_PASSWORD`。
3. **生成公证凭据**：
   - 方案 A：App Store Connect → 用户与访问 → 集成 → App Store Connect API → 生成密钥（`App 管理` 权限即可），下载 `.p8`。
   - 方案 B：appleid.apple.com → 登录与安全 → App 专用密码 → 生成，填 `APPLE_APP_SPECIFIC_PASSWORD`。
4. **配置环境限定**：repo Settings → Environments → 新建/编辑，把 secrets 绑定到受保护环境，仅 tag 发布可用。

## 验证

- 本地试签名：`CSC_LINK=<b64> CSC_KEY_PASSWORD=<pw> npx electron-builder --mac --publish=never`
- 发布后检查 Release 产物：`spctl -a -t open -vv dist/*.dmg` 输出 `accepted`；`xcrun stapler validate dist/*.dmg` 成功。
- 确认 workflow 日志中无明文私钥/密码（GitHub 自动打码，若出现需排查）。

## 备注

- 证书签名后过期/撤销需重新生成 `.p12` 并更新 Secret。
- x64 / arm64 两个 mac job 共用同一证书，无需分别导出。
- 本方案不涉及 Windows 签名（code signing for Windows 需要额外 EV 证书，暂不做）。
