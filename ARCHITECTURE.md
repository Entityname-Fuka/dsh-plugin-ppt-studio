# DSH Plugin 架构设计蓝图：`dsh-plugin-ppt-studio`

> 架构设计模型：**Gemini 4 Neon**
> 代码实施、编写与测试模型：**Gemini 4 Hydrogen**（`gemini-4-hydrogen-high`）
> 目标宿主：**DSH Desktop（DeepSeek Harness）**
> 交互与入口对标：**WorkBuddy PPT 生成与编辑器**（依据 `MECHANICS.md` 与 `reference/picture-1.png`）

---

## 1. 架构目标与核心设计原则

1. **DSH 原生双面插件规范（Server + Client）**：
   - 遵循 `deepseek-ai/deepseek-harness` 的 Cordis 微内核插件体系：
     - `package.json` 同时声明 `dsh.bundle`（指向 `./cordis.patch.yml`）与 `dsh.client`（`platform: "web"`，挂载右侧停靠标签、对话产物卡片与输入框选区芯片）。
     - **服务端插件（`src/server/`）**：`export const name = 'dsh-plugin-ppt-studio'`、`export const inject = ['tools']`，通过 `ctx.tools.register(defineTool(...))` 注册本地 PPT 引擎的 `slide_*` 精准编辑与索引工具组，并在不依赖未发布私有包的前提下提供类型兼容垫片（duck-typed DSH Cordis `Context`）。
     - **客户端插件（`src/client/`）**：`export function apply(ctx)` 注册 `ctx.sidebarRightTabs.register('dsh-ppt-studio', ...)`、`ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'dsh-ppt-studio', ... })`，并向对话流（`conversation.message`）与输入区（`conversation.composer`）注入与 WorkBuddy 一致的三大入口。
2. **与 WorkBuddy 完全一致的三大入口**：
   - **入口 1（对话流产物卡片）**：Agent 生成或编辑 `.pptx` 后，在对话流中渲染 `.pptx` 产物卡片（橙色 `P` 图标、文件名、体积、`...` 菜单、独立窗/展开图标、深色 `[分享]` 按钮、下方 `查看所有产物 (N) >`）。点击卡片即在 DSH Desktop 右侧停靠栏打开/聚焦对应 PPT 标签页。
   - **入口 2（右侧多标签栏 `+` 新建与打开）**：右侧栏顶部标签条展示已打开演示文稿标签（`[P] 名称.pptx ×`），点击 `+` 可直接新建符合 OOXML 标准的空白 16:9 `.pptx` 或导入本地 `.pptx` 文件。
   - **入口 3（细粒度选区上下文 Chip 双向回跳）**：在画布点选元素或开启 **`自由框选模式`** 框选任意区域后，自动经由 `docs:selectionChanged` / `docs:selectionSend` 协议将 `tdoc-selection://` 芯片写入对话输入框；点击芯片可立即回跳定位并闪烁高亮原幻灯片对应页与元素。
3. **传统 PPT 软件交互体验 + 细粒度 Agent 定位索引**：
   - 完整呈现 `开始 / 插入 / 美化 / 切换 / 动画 / 放映 / 视图` 7 大 Ribbon 选项卡、左侧实时缩略图栏（`添加页面` + 序号 + 拖拽重排）、中央 16:9 交互画布（拖拽移动、对齐参考线、8 向缩放、双击编辑文字、矢量图表/表格渲染）、右上角悬浮 **`自由框选模式`** 开关、底部演讲者备注（`点击添加备注`）及状态栏缩放/放映控制。
   - 所有坐标严格使用 `960 × 540 pt`（`1 pt = 12700 EMU`），`page_index`、`shape_index`、表格 `row`/`col` 全部 **0-based**，确保选区索引与后端 `slide_*` 工具入参 1:1 零换算对齐。
4. **双模式运行（真实 DSH Plugin + 离线 DSH Desktop 宿主预览与 `--screenshot` 验证）**：
   - 构建产物同时产出 DSH 插件包（`dist/server/index.js`、`dist/client/index.js`）以及独立 DSH Desktop 模拟宿主预览包（`dist/preview/`），并由 `app/main.py` 提供 `--screenshot <file.png>` 静默截图验收入口（1440×900，不抢焦点）。

---

## 2. 目录结构与 Swarm 并行边界划分

为保证多 Hydrogen worker 并行开发零冲突，严格按目录划分文件所有权：

```text
app/
├── MECHANICS.md                     # [Neon 产出] 逆向规格书
├── mechanics.json                   # [Neon 产出] 常量与规则表
├── ARCHITECTURE.md                  # [Neon 产出] 本文档
├── package.json                     # [verifier 所有] DSH manifest (dsh.bundle + dsh.client) 与脚本
├── tsconfig.json                    # [verifier 所有] TypeScript 编译配置
├── vite.config.ts                   # [verifier 所有] Preview + Client 构建配置
├── vitest.config.ts                 # [verifier 所有] 单元测试配置
├── cordis.patch.yml                 # [ppt-core 所有] DSH Cordis 服务端/客户端注入声明
├── main.py                          # [verifier 所有] 桌面预览与 --screenshot <file.png> 入口
├── README.md                        # [verifier 所有] DSH Desktop 安装与使用说明
├── index.html                       # [ppt-ui 所有] Standalone DSH Desktop 宿主预览 HTML
├── src/
│   ├── core/                        # [ppt-core 所有] 纯 TypeScript 引擎（零 DOM 依赖，Node/Browser 共用）
│   │   ├── types.ts                 # 权威数据模型、选区协议类型、DSH 接口契约
│   │   ├── constants.ts             # 对齐 mechanics.json 的常量（960x540pt, 12700 EMU, 三区母版等）
│   │   ├── deck-engine.ts           # Deck CRUD、Undo/Redo、AI Edit 历史与撤销、DESIGN.md 门禁、JSX 编译器
│   │   ├── context-index.ts         # 细粒度空间索引、自由框选相交查询、tdoc-selection:// 块构建与 XML 序列化
│   │   ├── ooxml.ts                 # 真实 .pptx OOXML 打包/解析（JSZip + ppt/dshStudio/index.json 无损回环）
│   │   ├── sample-deck.ts           # 中性原创 12 页高质量演示文稿（复现深海蓝+荧光青+数字紫视觉基调）
│   │   └── index.ts                 # core 统一导出
│   ├── server/                      # [ppt-core 所有] DSH Cordis 后端插件
│   │   ├── dsh-compat.ts            # DSH defineTool / Context 类型兼容层
│   │   ├── slide-tools.ts           # 32 个核心 slide_* 工具定义与执行器（对齐 WorkBuddy 0-based/pt 契约）
│   │   ├── ai-edit-simulator.ts     # 本地确定性自然语言指令路由（供离线宿主测试框选->AI精准修改闭环）
│   │   └── index.ts                 # Cordis 插件入口: name, inject=['tools'], apply(ctx)
│   ├── client/                      # [ppt-ui 所有] DSH Desktop 前端插件 + 传统 PPT 交互 UI
│   │   ├── dsh-types.ts             # DSH Client Context / sidebarRightTabs / slots 契约类型
│   │   ├── selection-bus.ts         # docs:selectionChanged / docs:selectionSend 唤醒队列与去重桥
│   │   ├── styles/
│   │   │   └── ppt-studio.css       # 完整视觉样式表（严格对齐 reference/picture-1.png 配色与留白）
│   │   ├── components/
│   │   │   ├── ArtifactCard.tsx     # 对话流 .pptx 产物卡片（入口 1）
│   │   │   ├── SelectionChipBar.tsx # 对话输入框选区 Chip 条与回跳交互（入口 3）
│   │   │   ├── TabStrip.tsx         # 右侧多标签栏 + 新建/导入按钮（入口 2）
│   │   │   ├── DocHeaderBar.tsx     # 文件名编辑、保存、导出 .pptx、放映、分享
│   │   │   ├── RibbonToolbar.tsx    # 7 大 Ribbon 选项卡 + 完整传统 PPT 工具栏
│   │   │   ├── ThumbnailRail.tsx    # 左侧缩略图栏（添加页面 + 拖拽重排 + 右键菜单）
│   │   │   ├── SlideRenderer.tsx    # 高保真 960×540pt 幻灯片渲染器（文本/形状/线箭头/表格/SVG 柱状折线饼图）
│   │   │   ├── SlideCanvas.tsx      # 交互画布（普通编辑拖拽缩放/参考线 + 自由框选模式 Marquee + 悬浮 HUD）
│   │   │   ├── NotesAndStatusBar.tsx# 演讲者备注区 + 底部状态栏（页码/视图切换/放映/适应窗口/缩放）
│   │   │   ├── SlideshowModal.tsx   # 全屏放映 + 演讲者备注模式 + 键盘翻页
│   │   │   ├── IndexInspectorModal.tsx # 细粒度上下文索引 JSON / XML 预览抽屉（可视化验证 Agent 视角）
│   │   │   └── PptWorkspace.tsx     # 右侧停靠栏完整 PPT 工作区容器
│   │   └── index.ts                 # DSH Client 插件入口: apply(ctx) 注册 sidebarRightTabs + slots
│   └── standalone/                  # [ppt-ui 所有] DSH Desktop 模拟宿主（三栏界面，加载同一份 client+server 插件）
│       ├── mock-dsh-host.ts         # 轻量 Cordis 宿主（实现 tools / sidebarRightTabs / slots / selectionBus）
│       ├── DesktopShell.tsx         # 复现 reference/picture-1.png 三栏布局（任务列表 + 对话区 + DSH 右侧栏）
│       └── main.tsx                 # 挂载入口，支持 ?screenshot=1 稳定帧渲染信号
└── tests/                           # [verifier 所有] 自动化单元测试与集成测试（Vitest）
    ├── deck-engine.test.ts          # Deck CRUD、DESIGN.md 门禁、JSX 编排、AI Edit 撤销
    ├── context-index.test.ts        # 自由框选相交查询、0-based 对齐、tdoc-selection:// 与 XML 序列化
    ├── ooxml.test.ts                # 空白模板生成、真实 .pptx 导出与导入无损往返
    └── dsh-plugin.test.ts           # Cordis server 插件工具注册、client 插件 sidebarRightTabs + slots 注册与三入口联调
```

---

## 3. 核心数据模型与接口契约（`src/core/types.ts`）

所有模块必须严格遵守以下核心契约，不得擅自更改字段语义：

### 3.1 演示文稿与元素模型
- **`BoundsPt`**: `{ x: number; y: number; w: number; h: number }`（单位 `pt`，画布默认 `960 × 540`）。
- **`SlideElementType`**: `'text' | 'shape' | 'line' | 'table' | 'chart' | 'image' | 'svg' | 'group'`。
- **`SlideElement`**:
  - `shape_id: string`（全局唯一稳定 ID，如 `s5_chart_workload`）
  - `type: SlideElementType`
  - `name?: string` / `role?: 'title' | 'subtitle' | 'body' | 'kpi' | 'chart' | 'table' | 'badge' | 'footer' | 'decoration' | 'callout'`
  - `bounds: BoundsPt`
  - `rotation?: number`（度）
  - `zIndex: number`
  - `groupId?: string`
  - `shapeType?: 'rect' | 'roundRect' | 'ellipse' | 'triangle' | 'rightArrow' | 'leftArrow' | 'diamond'`
  - `fill?: { color: string; alpha?: number }`（`RRGGBB` 无 `#` 或 `"none"`，`alpha` 0~100）
  - `border?: { color: string; width?: number; dash?: 'solid' | 'dash' | 'dot'; alpha?: number }`
  - `cornerRadius?: number`
  - `line?: { x1: number; y1: number; x2: number; y2: number; lineType: 'line' | 'arrow' | 'doubleArrow'; color: string; width: number; dash?: 'solid' | 'dash' | 'dot' }`
  - `text?: { content: string; fontName?: string; fontSize: number; fontColor: string; bold?: boolean; italic?: boolean; underline?: boolean; align?: 'left' | 'center' | 'right'; vAlign?: 'top' | 'middle' | 'bottom'; lineHeight?: number; spans?: TextSpan[] }`
  - `table?: { rows: number; cols: number; cells: TableCell[][]; headerBg?: string; zebraBg?: string; borderColor?: string }`
  - `chart?: { chartType: 'bar' | 'line' | 'pie' | 'area'; title?: string; categories: string[]; series: ChartSeries[]; showLegend?: boolean; showGridlines?: boolean; showDataLabels?: boolean; yAxisMax?: number; yAxisStep?: number; unit?: string }`
  - `svg?: { viewBox: string; markup: string }`
  - `image?: { src: string; alt?: string; objectFit?: 'cover' | 'contain' }`
  - `animations?: SlideAnimation[]`（`anim_type`, `anim_subtype`, `category`, `trigger`, `durationMs`）
- **`SlidePage`**:
  - `slide_id: string`
  - `title: string`
  - `background: { color: string; gradient?: string }`
  - `transition?: { type: 'none' | 'fade' | 'push' | 'wipe' | 'zoom'; durationMs: number }`
  - `notes: string`
  - `elements: SlideElement[]`（数组顺序即为 0-based `shape_index` 与 z-order 顺序）
- **`PresentationDeck`**:
  - `file_id: string`
  - `file_name: string`
  - `file_path: string`
  - `aspect_ratio: 1 | 2`（`2 = 16:9` -> `960×540pt`，`1 = 4:3` -> `720×540pt`）
  - `width_pt: number`
  - `height_pt: number`
  - `theme_id: string`
  - `design_md?: string`
  - `version: number`
  - `updated_at: number`
  - `slides: SlidePage[]`
  - `sections: SlideSection[]`
  - `comments: SlideComment[]`
  - `ai_edits: AiEditRecord[]`

### 3.2 细粒度选区上下文协议（对齐 WorkBuddy `contexts-DgzzFjnf.js`）
- **`SelectionMode`**: `'element' | 'multi-element' | 'free-marquee' | 'table-cells' | 'chart-series'`
- **`IndexedElementHit`**:
  ```ts
  interface IndexedElementHit {
    shape_id: string;
    shape_index: number; // 0-based，与 slide_* 工具直接对齐
    type: SlideElementType;
    role?: string;
    bounds_pt: BoundsPt;
    overlap_ratio: number; // 0..1（点选为 1，框选为交集面积/元素面积）
    text_preview?: string;
    table_cells?: { start_row: number; start_col: number; end_row: number; end_col: number };
    chart_summary?: { chart_type: string; title?: string; series_names: string[]; categories: string[] };
  }
  ```
- **`SlideSelectionPayload`**（进入 `_meta.selectionPayload` 并透传给 LLM）：
  ```ts
  interface SlideSelectionPayload {
    rangeId: string;
    text: string;
    description?: string;
    timestamp: number;
    fileId: string;
    title: string;
    page_index: number; // 0-based
    slide_id: string;
    selection_mode: SelectionMode;
    shape_ids: string[];
    shape_indices: number[]; // 0-based
    bbox_pt: BoundsPt;
    elements: IndexedElementHit[];
    recommended_tools: string[];
    aiPrompt?: string; // 仅事件层携带，序列化给 LLM 时自动剥离
  }
  ```
- **`DocumentSelectionEvent`**（`docs:selectionChanged` / `docs:selectionSend` 事件载荷）：
  - `sessionId?: string`
  - `documentResourceUri: string`（如 `dsh-resource://file/未来算力与智能体趋势简报.pptx`）
  - `filePath: string`
  - `fileType: 'pptx'`
  - `consumerSurface: 'main' | 'office'`
  - `sequence: number`
  - `sequenceEpoch: string`（默认 `'__legacy_epoch__'`）
  - `selection: SlideSelectionPayload`
- **`DocumentSelectionContextBlock`**（对话输入框 Chip 与消息块）：
  - `type: 'resource_link'`
  - `name: string`
  - `uri: 'tdoc-selection://' + encodeURIComponent(rangeId)`
  - `title: string`
  - `_meta`: 含 `mentionType: 'tencentDocsSelection'`、`type: 'document-selection'`、`displayAsPhrase: true`、`displayAsContext: false`、`documentResourceUri`、`filePath`、`fileType`、`fileId`、`rangeId`、`sequence`、`sequenceEpoch`、`selectionPayload`、`aiPrompt?`、`selectionPairId?`。
- **LLM 序列化输出**（`renderTencentDocsSelectionPrompt(blocks)`）：
  - 输出与 WorkBuddy 完全一致的 `<tencent_docs_selection><selection_payload format="json">...</selection_payload></tencent_docs_selection>` 结构，配合正文内 `@tdoc-selection#<timestamp>` 锚点。

---

## 4. DSH Desktop 集成规范（`package.json` & `cordis.patch.yml` & `src/client/index.ts`）

### 4.1 `package.json` 插件清单字段
```json
{
  "name": "dsh-plugin-ppt-studio",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/server/index.js",
  "exports": {
    ".": "./dist/server/index.js",
    "./client": "./dist/client/index.js",
    "./core": "./dist/core/index.js"
  },
  "keywords": ["dsh-plugin", "deepseek-harness", "ppt", "pptx", "slide-editor"],
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "platform": "web",
      "entry": "./dist/client/index.js",
      "inject": ["sidebarRightTabs", "slots"]
    }
  }
}
```

### 4.2 `cordis.patch.yml`
声明在 DSH Cordis 运行时中自动挂载 `dsh-plugin-ppt-studio` 服务端插件（注册 `slide_*` 工具组）与客户端插件模块。

### 4.3 `src/client/index.ts` 注册逻辑
```ts
export const name = 'dsh-plugin-ppt-studio-client';
export const inject = ['sidebarRightTabs', 'slots'];

export function apply(ctx: DshClientContext) {
  // 1. 注册右侧停靠栏 PPT 标签类型（认领 *.pptx 资源 URI）
  const disposeTab = ctx.sidebarRightTabs.register('dsh-ppt-studio', {
    title: (tab) => tab.title || '演示文稿.pptx',
    match: (uri) => /\.pptx($|\?)/i.test(uri) || uri.startsWith('dsh-ppt://'),
    icon: 'presentation',
  });

  // 2. 注册 sidebar.right.pane.tab 渲染槽（挂载完整 PptWorkspace）
  const disposePane = ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: 'dsh-ppt-studio',
    render: (props) => renderPptWorkspace(props, ctx),
  });

  // 3. 注册对话流产物卡片与输入区选区芯片槽位（与 WorkBuddy 三入口一致）
  const disposeArtifact = ctx.slots.register({
    name: 'conversation.message.artifact',
    key: 'dsh-ppt-studio-artifact',
    match: (artifact) => /\.pptx$/i.test(artifact?.fileName || artifact?.uri || ''),
    render: (props) => renderArtifactCard(props, ctx),
  });

  const disposeComposer = ctx.slots.register({
    name: 'conversation.composer.context',
    key: 'dsh-ppt-studio-selection',
    render: (props) => renderSelectionChipBar(props, ctx),
  });

  return () => {
    disposeTab?.();
    disposePane?.();
    disposeArtifact?.();
    disposeComposer?.();
  };
}
```

---

## 5. 视觉规范与 `reference/picture-1.png` 对齐要点

- **整体亮色桌面壳**：左侧导航 `#F7F8FA`、中栏对话区 `#FFFFFF`、右侧 PPT 工作区 `#FFFFFF`（工具栏与边框 `#EBEDF0`、画布背景 `#F2F4F7`）。
- **品牌与文案合规**：使用中性名称（`DSH Desktop`、`PPT Studio`、`未来算力与智能体趋势简报.pptx`），**严禁照抄 WorkBuddy 品牌 Logo 或原图第三方版权文案**；演示文稿采用自研原创数据与自绘矢量图表，完整复现深海蓝 `#090D18` 底色 + 荧光青 `#38E8D4` + 数字紫 `#846BFF` 的专业视觉质感（默认定位在第 6 页双栏柱状图 + `70%+` KPI 洞察页，缩放 `39%`~自适应，呈现一眼对标的高级感）。
- **关键交互视觉锚点**：
  - 对话流 `.pptx` 产物卡片：橙色圆角 `P` 图标 + 文件名 + 大小 + `...` + 独立窗图标 + 黑色 `[分享]` 按钮 + `查看所有产物 (1) >`。
  - 右侧 PPT 顶部多标签条 + 标题操作栏 + 7 个 Ribbon 选项卡（`开始` 蓝色下划线激活）+ 工具按钮组。
  - 画布右上角醒目的白色悬浮胶囊开关 **`自由框选模式`**，切换后支持真实鼠标框选并弹出精准定位操作条。

---

## 6. 验证与测试策略（`verifier` 所有）

1. **静态检查**：`npx tsc --noEmit` 零报错。
2. **自动化测试（Vitest）**：
   - `deck-engine.test.ts`：覆盖 `DESIGN.md` 门禁、JSX 页面编译、单/批量形状增删改、z-order、文本样式、表格/图表修改、AI 编辑版本记录与 `slide_undo_ai_edit` 撤销。
   - `context-index.test.ts`：覆盖单选、多选、**自由框选**矩形相交算法与 `overlap_ratio`、0-based `page_index`/`shape_index` 与 `slide_*` 工具一致性、`tdoc-selection://` 去重键及 `<tencent_docs_selection>` XML 序列化。
   - `ooxml.test.ts`：覆盖空白 `.pptx` 模板生成、含多页/文本/形状/表格/备注的 `.pptx` ZIP 导出及重新解析导入往返校验。
   - `dsh-plugin.test.ts`：验证服务端 Cordis `apply(ctx)` 成功注册 30+ `slide_*` 工具并可执行端到端工具调用；验证客户端 `apply(ctx)` 成功注册 `sidebarRightTabs` 与 3 个 UI slots 并打通「产物卡片点击 -> 右侧打开 -> 自由框选 -> 选区芯片注入 -> AI 精准编辑 -> 画布实时更新」完整链路。
3. **构建与 `--screenshot` 视觉验收**：
   - 执行 `npm run build` 产出 `dist/server/`、`dist/client/`、`dist/preview/`。
   - 执行 `python main.py --screenshot shots/preview.png` 输出 `1440×900` 实机渲染图，由协调者使用 `read_file` 打开并与 `reference/picture-1.png` 逐区比对。

---

## 7. DSH Desktop 真实运行时契约改造方案（Gemini 4 Neon 架构定稿）

基于对本机真实安装的 `@deepseek-ai/dsh`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-client-modules`、`@deepseek-ai/dsh-client-ui-sidebar-right`、`@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-client-ui-deliverables` 与 `@deepseek-ai/dsh-host-webserver` `.d.ts` 契约的静态核验，必须完成以下 5 项改造，才能让 `dsh-plugin-ppt-studio` 在真实 **DSH Desktop** 中直接安装、加载、热重载并双向联动：

### 7.1 `cordis.patch.yml` 与 `package.json` 真实清单
1. **`cordis.patch.yml`** 必须为顶层 YAML 数组（Loader patch 列表）：
   ```yaml
   - insert:
       - id: ppt-studio
         name: dsh-plugin-ppt-studio
         config:
           requireDesignMd: false
           loadSampleDeck: true
   ```
2. **`package.json`**:
   - `exports` 包含 `"."`、`"./client"`、`"./core"` 与 `"./package.json": "./package.json"`。
   - `dsh.engines`: `{ "dsh": ">=0.1.7" }`。
   - `dsh.bundle`: `{ "patch": "./cordis.patch.yml" }`。
   - `dsh.client`: `{ "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-sidebar-right", "@deepseek-ai/dsh-client-ui-conversation", "@deepseek-ai/dsh-client-ui-chat"] }`（注意：真实 DSH 的 `dsh.client.inject` 填的是处于 boot graph 中的浏览器插件 npm 包名，而非 Cordis 服务名或纯静态库；且不包含 `entry` 字段，宿主通过 `exports["./client"]` 解析客户端入口）。

### 7.2 服务端插件（`src/server/`）：真实 `dsh-tools` + `ctx.webServer` HTTP/SSE 桥接
1. **工具契约对齐 (`src/server/dsh-compat.ts` & `src/server/slide-tools.ts`)**：
   - 每个 `slide_*` 工具必须提供：
     - `parameters`: 标准 JSON Schema 对象（`type: 'object'`, `properties`, `required?`, `additionalProperties: false` 或显式 `boolean`），同时保留 `inputSchema` 别名兼容本地测试。
     - `output`: `{ schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' } }, required: ['ok'] }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }`，100% 通过 `@deepseek-ai/dsh-tools` 的 `assertSupportedJsonSchema` 校验。
     - `async execute(args, exec)`: 统一返回可无损 JSON 序列化的结果对象。
2. **宿主 HTTP/SSE API 桥接 (`src/server/routes.ts`)**：
   - 在 `src/server/index.ts` 的 `apply(ctx, config)` 中，通过 `ctx.inject?.(['webServer'], ...)` 或直接访问 `ctx.webServer`，挂载带 loopback 安全校验的 `/dsh-ppt-studio/api/*` 路由：
     - `GET /dsh-ppt-studio/api/decks`：返回全部 deck 列表与 `activeFileId`
     - `GET /dsh-ppt-studio/api/decks/:fileId`：返回单个 deck 完整 JSON
     - `POST /dsh-ppt-studio/api/decks`：创建或更新 deck
     - `DELETE /dsh-ppt-studio/api/decks/:fileId`：移除 deck
     - `POST /dsh-ppt-studio/api/decks/open-file`：从本地磁盘绝对路径读取真实 `.pptx` 并解析载入 `DeckRegistry`
     - `POST /dsh-ppt-studio/api/decks/:fileId/save-file`：将 deck 打包为真实 `.pptx` 写回磁盘
     - `GET /dsh-ppt-studio/api/decks/:fileId/export`：导出 `.pptx` 二进制流
     - `POST /dsh-ppt-studio/api/tool`：执行任意已注册 `slide_*` 工具
     - `POST /dsh-ppt-studio/api/selections` & `GET /dsh-ppt-studio/api/selections/:rangeId`：跨前后端同步自由框选快照，确保 Agent 调用 `slide_resolve_selection` 命中最新选区
     - `GET /dsh-ppt-studio/api/events`：SSE 实时推送 `deck-updated` / `selection-updated` 事件

### 7.3 客户端插件（`src/client/`）：真实 DSH Client APIs + 远程桥接 + 双模式兼容
1. **`src/client/remote-bridge.ts`**：
   - 在真实 DSH Desktop 浏览器端（未传入 `MockDshHost` 的 `ctx.bridge` 时），自动实例化基于 `/dsh-ppt-studio/api/*` 与 SSE 的 `RemoteDshClientBridge`，实现与 Node 服务端 `DeckRegistry` 的实时双向同步、本地 `.pptx` 打开/保存以及选区上报。
2. **`src/client/index.ts`**：
   - `export const name = 'dsh-plugin-ppt-studio'`，`export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight']`（兼容真实 DSH 与 `MockDshHost`）。
   - 动态注入与卸载 `<style data-plugin="dsh-plugin-ppt-studio" data-plugin-css="dsh-plugin-ppt-studio/client.css">`。
   - **入口 2（右侧多标签栏 + Guide 卡片）**：通过真实单参 `ctx.sidebarRightTabs.register(SidebarRightTabDefinition)` 注册 `id: 'dsh-plugin-ppt-studio'`, `kind: 'ppt-studio'`, `priority: 'extension'`（优先级高于内置 `documentpreview`），认领 `*.pptx` 等 9 种演示文稿扩展名与 `dsh-resource://ppt-studio/**`，并在 Guide 页注册「PPT Studio 演示文稿」快捷新建卡片；通过 `ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'dsh-plugin-ppt-studio' }, PptSidebarTab))` 挂载工作区组件。
   - **入口 1（对话流 `.pptx` 产物卡片）**：通过 `ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({ name: 'conversation.chat.turnTail', id: 'dsh-plugin-ppt-studio-artifact' }, TurnPptArtifactDock))` 渲染与 WorkBuddy 一致的 `.pptx` 产物卡片，点击调用 `ctx.sidebarRight.openResource('dsh-resource://ppt-studio/deck/' + encodeURIComponent(fileId))`。
   - **入口 3（对话输入框选区芯片双向回跳）**：通过 `ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsh-plugin-ppt-studio-selection' }, ComposerSelectionDock))` 渲染选区 Chip 条，点击芯片回跳聚焦原幻灯片与元素，点击「引用到对话」通过真实 `inputActions.insertText(...)` 注入 `<tencent_docs_selection>` XML 与 `@tdoc-selection#<timestamp>` 锚点。
   - 同时保留对 `MockDshHost`（离线三栏预览 + 既有测试）的自动适配分支。

### 7.4 客户端打包协议（`scripts/build-plugin.mjs`）
- `dist/client/index.js` 必须由 esbuild 以 `format: 'cjs'` 打包、外部化 `react` / `react-dom` / `react/jsx-runtime` / `react-dom/client`、内联 `ppt-studio.css` 字符串，并包裹为 DSH 真实懒加载模块注册格式：
  ```js
  window.__ModuleLoader__.load({
    id: "dsh-plugin-ppt-studio",
    factory: (require) => {
      var module = { exports: {} };
      var exports = module.exports;
      /* bundled CJS */
      return module.exports;
    }
  });
  ```

### 7.5 真实 DSH 契约验收标准
- 新增 `tests/dsh-real-contract.test.ts`：校验 `cordis.patch.yml`、`package.json`、`slide_*` 全量工具 JSON Schema 合规性、`dist/client/index.js` 通过 `window.__ModuleLoader__.load` 物化与真实 DSH Context 注册/卸载全链路，以及 `/dsh-ppt-studio/api/*` 服务端路由端到端闭环。
- 通过 `npm run typecheck`、`npm test`、`npm run build`、`python main.py --screenshot shots/preview.png` 及真实 `dsh` 校验。
