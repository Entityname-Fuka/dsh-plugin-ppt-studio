# dsh-plugin-ppt-studio

面向 **DSH Desktop（DeepSeek Harness）** 的原生双面 PPT 生成、交互式编辑与细粒度空间上下文索引插件。支持直接打包挂载至 DSH Cordis 运行时，同时内置独立的三栏模拟宿主预览入口。

---

## 核心功能

- **原生 DSH 双面插件架构**：
  - **服务端（`dist/server/index.js`）**：基于 Cordis 微内核注入 `tools` 服务，提供 30+ 个原子级 `slide_*` 演示文稿构建、文本/形状/表格/图表编辑、动画、主题与 AI 编辑撤销工具。
  - **客户端（`dist/client/index.js`）**：注入 `sidebarRightTabs` 与 `slots`，在 DSH Desktop 右侧停靠栏、对话消息流及输入框无缝融合原生体验。
- **传统 PPT 专业交互工作区**：
  - 7 大 Ribbon 选项卡（开始 / 插入 / 美化 / 切换 / 动画 / 放映 / 视图）
  - 左侧实时缩略图导览栏（添加页面、复制、删除、拖拽重排）
  - 中央 `960 × 540 pt`（16:9）交互画布（拖拽移动、对齐参考线、8 向缩放、双击直接编辑文字、矢量图表与表格渲染）
  - 演讲者备注栏、全屏放映模式（含演讲者视图）与底部缩放状态栏
- **真实 `.pptx` OOXML 打包与解析**：
  - 基于纯 JS `jszip` 生成符合标准 16:9 尺寸（`cx="12192000"`、`cy="6858000"`、`1 pt = 12700 EMU`）的 `.pptx` 文件，并内置 `ppt/dshStudio/index.json` 侧边元数据实现无损往返导入。
- **DESIGN.md 前置契约与 JSX-like 页面编排**：
  - 支持先通过 `slide_set_design` 锁定全篇配色/版式契约，再使用声明式 JSX/AST 快速生成多页幻灯片，自动分配稳定语义化 `shape_id` 与版本化 `ai_edits` 记录（支持 `slide_undo_ai_edit` 精准回滚）。

---

## DSH Desktop 插件安装方式

1. 构建插件产物：
   ```bash
   npm install
   npm run build
   ```
2. 将当前插件目录注册到 DSH Desktop（`desktop` 或 `web` 配置档案）：
   ```bash
   # 安装到 DSH Desktop 桌面端档案
   dsh plugin --profile desktop add C:\Users\ACR\Desktop\app

   # 或安装到 DSH Web 档案
   dsh plugin --profile web add C:\Users\ACR\Desktop\app
   ```
   插件清单通过 `package.json` 中的 `dsh.bundle`（指向数组格式 `./cordis.patch.yml`）、`dsh.client`（`platform: "web"`、`inject` 声明依赖包）与 `exports["./client"]`（指向 `window.__ModuleLoader__.load` 懒加载 CJS 产物 `./dist/client/index.js`）自动向 DSH Desktop 注入 48 个服务端 `slide_*` 工具、`/dsh-ppt-studio/api/*` HTTP/SSE 桥接以及前端右侧停靠栏与对话槽位。

---

## 三大一致入口说明

1. **入口 1：对话流 `.pptx` 产物卡片（`conversation.message.artifact`）**
   - 当 Agent 生成或更新 `.pptx` 文档时，对话流内渲染橙色 `P` 标识产物卡片（含文件名、体积、快捷操作菜单、独立窗口与分享按钮）。点击卡片即可在右侧停靠栏打开或聚焦对应演示文稿标签。
2. **入口 2：右侧多标签栏 `+` 新建与导入**
   - 右侧编辑器顶部多标签条支持多文档并行切换；点击 `+` 可一键新建符合 OOXML 标准的空白 16:9 `.pptx`，或导入本地 `.pptx` 文件继续编辑。
3. **入口 3：对话输入框选区芯片（Chip）双向回跳（`conversation.composer.context`）**
   - 在画布点选元素或框选区域后，系统通过选区总线向对话输入框注入结构化上下文芯片（`tdoc-selection://`）；点击输入框内的芯片可立即反向定位并闪烁高亮原幻灯片对应的页码、元素或框选区域。

---

## 自由框选上下文索引协议

点击画布右上角悬浮胶囊开关 **`自由框选模式`** 后，拖拽鼠标即可框选幻灯片上的任意区域：

- **0-based 与 `pt` 严格零换算对齐**：
  - `page_index`、`shape_index`、表格 `row` / `col` 均采用 **0-based** 索引。
  - 所有坐标与尺寸统一采用 **`pt`**（`960 × 540` 16:9 画布），与后端 `slide_*` 工具入参 1:1 对齐。
- **精细相交快照**：
  - 引擎实时计算框选矩形 `bbox_pt` 与页面元素的交集面积比 `overlap_ratio`，提取 `shape_id`、`shape_index`、`role`、`text_preview`、`table_cells`、`chart_summary` 与 `recommended_tools`。
- **标准化协议封装**：
  - 经 `docs:selectionChanged` / `docs:selectionSend` 事件总线去重同步后，生成 `tdoc-selection://<rangeId>` 资源块（`_meta.mentionType = "tencentDocsSelection"`），并在提交给 Agent 时序列化为标准 `<tencent_docs_selection><selection_payload format="json">...</selection_payload></tencent_docs_selection>` 上下文块，配合正文中 `@tdoc-selection#<timestamp>` 锚点使用。

---

## 离线预览、测试与截图命令

```bash
# 类型检查
npm run typecheck

# 运行全套 Vitest 自动化测试
npm test

# 构建插件包 (dist/core, dist/server, dist/client) 与独立预览宿主 (dist/)
npm run build

# 启动离线三栏桌面预览窗口
python main.py

# 无头静默渲染 1440x900 验收截图（不抢占桌面焦点）
python main.py --screenshot shots/preview.png
```
