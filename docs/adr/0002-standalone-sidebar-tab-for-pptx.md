---
status: accepted
---

# `.pptx` 预览接管采用独立 `sidebarRightTabs` 扩展标签页

在 DSH Desktop 中接管 `.pptx` 等演示文稿文件的预览与编辑时，我们选择通过 `ctx.sidebarRightTabs.register` 注册 `priority: 'extension'` 的独立右侧栏标签页，而非将编辑器注册为内置 `documentPreviews`（`sidebar.right.tab.document`）的文档渲染器。

独立标签页优先级高于内置 `text` 预览器的 `fallback` 档位，可自动接管文件树、Deliverables 交付物卡片和对话文件链接触发的 `dsh-resource://file/...` 打开请求，同时避免嵌套 DSH 原生文档预览顶部路径栏占用画布垂直空间，并保留 Guide 新建入口与顶栏「用外部应用打开」兜底按钮。

## Considered Options

- **独立 `sidebarRightTabs` 扩展标签页（已采纳）**：独享右侧栏区域，与 WorkBuddy 布局一致，保留独立新建入口，由插件自行解析 `dsh-resource://file/session/...` 地址并提供外部打开兜底。
- **注册为 `documentPreviews` 文档渲染器**：可复用 DSH 原生文件顶栏、外部打开菜单与文件树切换，但额外头部栏位会压缩 16:9 幻灯片画布空间，且无法单独承载新建空白文稿入口。
