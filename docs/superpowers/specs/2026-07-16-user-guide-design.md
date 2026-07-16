# 使用指南（标题栏入口 + 指南标签页）设计文档

日期：2026-07-16
状态：已批准

## 背景与目标

Lynel Desktop 需要一个内置的"使用指南"，帮助用户了解应用功能。入口放在标题栏设置按钮左边；指南内容较多，需要支持多章节组织与导航。

## 需求确认结果

- **内容来源**：Markdown 文件打包进应用，用已有的 `marked` 库渲染。
- **内容组织**：多个 `.md` 文件，每个文件一个章节，左侧目录导航切换。
- **展示容器**：标签页（与设置 Tab 同模式），复用现有 `GlobalTabs` 机制。

## 设计

### 1. 标题栏入口

- `src/renderer/src/components/Icon.vue`：注册 lucide 的 `CircleHelp` 图标，名为 `help`。
- `src/renderer/src/components/TitleBar.vue`：
  - 新增 prop `showGuide?: boolean`（默认不显示）。
  - 在设置按钮左边渲染一个同样式 `iconbtn`（`v-if="showGuide"`），`aria-label`/`title` 为"使用指南"，点击 emit `guide` 事件。
- `src/renderer/src/views/HomeView.vue`：`<TitleBar show-guide @guide="openGuideTab" />`，`openGuideTab()` 调用 `tabsStore.openGuide()`。
- 登录页 / 设置页 / 欢迎页不传 `showGuide`，不显示该按钮（这些页面没有 Tab 系统，避免出现点击无响应的按钮）。

### 2. Tab 类型扩展

- `src/renderer/src/types/tab.ts`：`TabType` 增加 `'guide'`。
- `src/renderer/src/stores/tabs.ts`：新增 `openGuide()`，实现与 `openSettings()` 同构——单例 Tab（id 为 `guide`），标题"使用指南"，已存在则激活。
- `src/renderer/src/views/HomeView.vue`：内容区新增 `v-show="tabsStore.activeType === 'guide'"` 的面板，内含 `<GuideTab />`。

### 3. 指南内容与 GuideTab 组件

**内容目录**：`src/renderer/src/guide/`

- 每章一个 Markdown 文件，文件名格式 `NN-章节名.md`（如 `01-快速开始.md`、`02-会话管理.md`）。
- 数字前缀决定章节顺序；去掉前缀和扩展名后的部分作为左侧导航显示的章节名。
- 后续新增/修改章节只需增改 `.md` 文件，无需改代码。

**组件**：`src/renderer/src/components/GuideTab.vue`

- 用 `import.meta.glob('../guide/*.md', { query: '?raw', import: 'default', eager: true })` 在构建期把全部章节打包进 bundle，运行时零 IO。
- 解析 glob 结果：按文件名排序生成章节列表 `{ key, title, markdown }[]`，默认选中第一章。
- 布局：
  - 左侧章节导航，固定宽约 200px，独立滚动，当前章节高亮。
  - 右侧内容区，`marked.parse()` 渲染为 HTML 后 `v-html` 输出，独立滚动。
  - 切换章节时内容区滚动回顶部。
- Markdown 排版样式（标题、段落、代码块、行内代码、列表、表格、引用、链接）全部使用 `styles/theme.css` 的 CSS 变量，不硬编码颜色，跟随主题。

**安全说明**：渲染内容全部来自仓库内打包的本地文件，无用户输入与远程内容，不引入 DOMPurify（YAGNI）。

**初始内容**：创建章节文件骨架（快速开始、会话管理等），具体文案由用户后续补充完善。

## 错误处理

- `guide/` 目录为空或 glob 无匹配时，内容区显示"暂无指南内容"占位文案，不报错。
- 章节 Markdown 解析失败（理论上不会发生）时显示原始文本兜底。

## 测试与验证

- `npm run test:main` 全绿（本次不涉及主进程代码，作为回归确认）。
- `cd src/renderer && npx vue-tsc --noEmit` 全绿。
- 手动验证：
  1. 首页标题栏出现"使用指南"按钮（设置左边），登录页不出现。
  2. 点击打开"使用指南" Tab，重复点击不产生重复 Tab。
  3. 章节导航切换正常，内容渲染样式跟随主题，切章节回到顶部。
  4. 关闭 Tab 后可重新打开。

## 影响范围

| 文件 | 变更 |
| --- | --- |
| `components/Icon.vue` | 注册 `help` 图标 |
| `components/TitleBar.vue` | 新增指南按钮 + `showGuide` prop + `guide` 事件 |
| `views/HomeView.vue` | 传 prop、处理事件、新增 guide 面板 |
| `types/tab.ts` | `TabType` 增加 `'guide'` |
| `stores/tabs.ts` | 新增 `openGuide()` |
| `components/GuideTab.vue` | 新增组件 |
| `guide/*.md` | 新增内容目录与章节骨架 |

不涉及主进程、IPC、PTY、代理等任何后端逻辑。
