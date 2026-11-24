# WorkBuddy PPT 交互、生成引擎与细粒度上下文索引逆向规格书（MECHANICS）

> 逆向分析模型：**Gemini 4 Neon**
> 分析目标：`D:\WorkBuddy\WorkBuddy.exe`（Electron 64-bit）及 `D:\WorkBuddy\resources\app.asar.unpacked\`
> 视觉基线：`E:\Craft Anything\reference\picture-1.png`
> 说明：本文档所有规则均来自静态逆向取证，已明确标注源码/文档出处；仅在本地引擎闭源二进制/远端资源内无法静态观测的细节，均标记为 `estimated` 并附推导依据。

---

## 0. 二进制壳体与 REA 取证记录（PE + Electron ASAR + JS AST）

1. **主程序壳体二进制取证（`D:\WorkBuddy\WorkBuddy.exe`）**：
   - 格式：`PE32+`（`pei-x86-64`，`machine = 0x8664`），体积 `204,590,360 bytes`，SHA-256：`5ea5d8ba6f6a435c27c239115647886a9646f76ff5a721e82f84f0ff16ac5e15`。
   - **GNU `objdump` PE 头与节表实证**（REA `inspect_with_objdump`，`ev_f581c299d23eb2d3b33f3e1667f1e41a257e975e43cdcf811fc09df9253654cb` & `ev_e7cbbae900b167771f5604e22046f6a75bc05e5d4353af6808301b81f0502ad3`）：
     - 入口点地址（Entry Point）：`0x0000000144d4d450`
     - `.text` 代码段：VMA `0x0000000140001000`，大小 `0x09e18c00`，文件偏移 `0x00000600`
     - `.rdata` 只读数据段：VMA `0x0000000149e1a000`，大小 `0x01e52100`，文件偏移 `0x09e19200`
     - `.data` 数据段：VMA `0x000000014bc6d000`，大小 `0x000cde00`，文件偏移 `0x0bc6b400`
     - `.rsrc` 资源段：VMA `0x000000014c5c8000`，大小 `0x0001ea50`，文件偏移 `0x0c1fce00`
   - **Electron Fuses 二进制位实证**（REA `inspect_electron_fuses`，`ev_69df257fe436e4e667232fdbb7130a21222a9b9307d7245472abe9cdc6487b5c`）：
     - Fuse Sentinel 文件偏移 `0x0a10fb50`（`168886096`，对应 `.rdata` VMA `0x000000014a110950`）：`OnlyLoadAppFromAsar = enabled`、`EnableEmbeddedAsarIntegrityValidation = enabled`、`GrantFileProtocolExtraPrivileges = enabled`、`EnableCookieEncryption = disabled`。
   - **PE 资源表取证**（REA `inspect_pe_resources`，`ev_8bd4f7cfbc8c1bb985897bbcb53b053ccb4f4986e6121973ab06937bfb7ff018`）：确认嵌入了 Electron ASAR 完整性校验资源 `INTEGRITY/ELECTRONASAR`（RVA `0x0c5c8c70`，VMA `0x000000014c5c8c70`，文件偏移 `203414128`，`251 bytes`）与 `Integrity/ElectronAsar`（RVA `0x0c5c8d70`，VMA `0x000000014c5c8d70`，文件偏移 `203414384`，`122 bytes`）。上述二进制实证共同证实 `WorkBuddy.exe` 为标准 Electron 宿主壳，全部 PPT 交互、选区索引与 OOXML 业务逻辑均由 `app.asar` 与 `D:\WorkBuddy\resources\app.asar.unpacked\` 的 JavaScript 模块承载。
   - **Ghidra 12.1.4 原生反编译核验实证（JDK 21.0.12.1）**：
     - 已在 `GHIDRA_INSTALL_DIR=E:\ghidra_12.1.4_PUBLIC` 与 `JAVA_HOME=C:\Program Files\Java\jdk-21.0.12.1` 下通过 `binary_session` 全部 8/8 项健康检查。
     - **壳体边界（`D:\WorkBuddy\WorkBuddy.exe`）**：已通过 `open_binary` 打开并尝试 `procedure_pseudo_code("0x144d4d450")`；因该文件为 204.59 MB 的 Electron/Chromium 巨型可执行体（`.text` 165 MB），Ghidra 默认全量自动分析超过 REA MCP 单次 3 分钟超时上限（`context deadline exceeded`）；其壳体属性已由上述 `objdump`、Electron Fuses 与 PE 资源表完整实证。
     - **PPT 本地引擎守护进程反编译（`D:\WorkBuddy\resources\workbuddy-editor-sdk-supervisor.exe`）**：`sha256: 977e76b7735d33f317496880dcd7705018251a0cf0f57a9905499383281bdce4`，`image_base: 0x140000000`，971 函数 / 564 字符串（`ev_5ee3af438eb70c8b00a2fede2720a84c59c1c2d79a328951b7efe3d369df1e31`），已完成字符串检索、交叉引用追踪与 3 个核心函数伪代码反编译：
       - **`FUN_140003ed0`（`0x140003ed0`，`ev_7a04b1f8f4b4f159ec856032960defc73da021afb8d5d98d2aeef3529938b83c`）**：引擎可执行文件路径校验器。要求 `--engine-path` 为绝对路径（经 `FUN_1400049c0` + `GetFullPathNameW` 归一化），再以 `GetFileAttributesW` 严格校验 `(attrs != INVALID_FILE_ATTRIBUTES) && ((attrs & 0x10) == 0)`（必须为常规文件而非目录），否则抛出 `"editor_sdk is not a regular file: "`。
       - **`FUN_140004b80`（`0x140004b80`，`ev_eb81ad1711a69cd24f750f14c375acaa5b4823669756b406cb0847bfc7768ec0`）**：命令行解析器。支持 `--exit-receipt`（`0x140025868`，须为盘符或 UNC 绝对路径）、`--wait-for-start`（`0x140025908`）、`--engine-stdin-fd`（须 `>= 3`）、`--lifeline-fd`（`0x140025a00`，须 `>= 3` 且不得与 `engine-stdin-fd` 相同）、`--engine-path`（`0x140025a50`，必填）、`--engine-arg`（可重复推入参数向量）、`--grace-ms`（`0x140025a90`）。
       - **`FUN_1400063a0`（`0x1400063a0`，`ev_d0014ad000854feb7906b63e065701c2f238e3fffe9959a9b9f22ae39e35831a`）**：Editor SDK 进程与 Win32 Job Object 生命周期主控函数。规则如下：
         1. 将 lifeline 与 control（stdin `0xfffffff6`）句柄通过 `SetHandleInformation(h, 1, 0)` 取消继承。
         2. 启用 `--wait-for-start` 时，逐字节读取 control 管道（缓冲区上限 `0x80 = 128 bytes`）直至 `\n`，严格校验启动握手为精确 `19 bytes`（`0x13`）JSON：`{"command":"start"}`。
         3. 子进程默认 stdin 重定向至 `NUL`（或指定的 `--engine-stdin-fd`），以挂起标志（`0x200`）拉起 `editor_sdk.exe` 并绑定到 Win32 Job Object；若在嵌套父 Job 中分配失败（日志串 `0x140025d00`），自动叠加 `CREATE_BREAKAWAY_FROM_JOB`（`0x01000200`）重试启动。
         4. 双线程监听 lifeline 与 control（`WaitForMultipleObjects(2, ..., INFINITE)`）；关闭阶段执行 `TerminateJobObject(job, 1)`，等待主进程退出上限 **`5000 ms`**（`WaitForSingleObject(..., 5000)`），若退出码仍为 `STILL_ACTIVE (0x103)` 则收敛为 `1`；随后以 `Sleep(10)` 周期轮询 `QueryInformationJobObject(..., JobObjectBasicAccountingInformation, ...)`（总排空上限 **`1000 ms`**），直至 Job 内活跃进程数归零再写回 exit receipt 并 `ExitProcess`。
     - **原生 Job Object Node 扩展反编译（`D:\WorkBuddy\resources\app.asar.unpacked\cli\bin\native\win32-x64\job-object.node`）**：`sha256: 2cf45879db3bd988b9dfe92c610f64b75534a536e69bb76a5e2000fbb72d9e11`，`image_base: 0x180000000`，895 函数 / 802 字符串（`ev_06326fa329938dab4618c436f9aaf2f6bebe4d0c50c4d05893ba50f65ab821b4`），已完成字符串检索（`ev_eecb5a2e66727e8f1adb911f4afc5821131a9109066a8935571c3b176ba57449`）、交叉引用追踪与 5 个核心函数伪代码反编译：
       - **`FUN_1800014eb`（`0x1800014eb`，`ev_96a74505c6f1ff71df4380f339f8938752816a66ce8664af60c2c9160b2050ea`）**：Windows 无孤儿进程 Job Object 初始化核心。先以 `GetModuleHandleExW(0x5, &FUN_1800014eb, &hModule)`（`GET_MODULE_HANDLE_EX_FLAG_PIN | GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS`）锁定模块防卸载；调用 `CreateJobObjectW(NULL, NULL)`；将 `JOBOBJECT_EXTENDED_LIMIT_INFORMATION`（`0x90 = 144 bytes`）清零后将 `LimitFlags` 设为精确组合 **`0x2400`**（`0x2000 = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` | `0x0400 = JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION`），再执行 `SetInformationJobObject(..., JobObjectExtendedLimitInformation, ..., 0x90)` 与 `AssignProcessToJobObject(hJob, GetCurrentProcess())`。
       - **`FUN_1800017ce`（`0x1800017ce`，`ev_9903cf2f00062b609fd7ba0cd8ad0397e80bdc7f7916f6d47dcb9903f36178c7`）与 `FUN_1800015f3`（`0x1800015f3`，`ev_78cedb33f45b35fbc924aea42af2f574e6c56fd3d674a69d8cff0914e2b79fe8`）**：注册并实现 N-API 方法 `ensureKillOnCloseJob`，缓存单次初始化结果并在失败时抛出带 Win32 错误码的 `ERR_AGENT_CLI_WINDOWS_JOB (win32=...)`。
       - **`FUN_18000201e`（`0x18000201e`，`ev_536bb7836a14d1cba86c563416dc9230ab304af2fd5f688a8f6b011c4b3ab1ad`）与 `FUN_180001921`（`0x180001921`，`ev_9eb9391c84dfd776d47657f47103ed9a249e81f75ff9bc09942e72a6059a65c1`）**：注册并实现 N-API 方法 `isProcessInJob(pid)`，缺失 PID 时抛出 `"Expected a process ID"`。
2. **本地 PPT 引擎包协议与端口取证（`@tencent/tencent-docs-ai-engine@0.2.196-wb`，`editor_sdk.exe` `0.0.0.499`）**：
   - 位置：`D:\WorkBuddy\resources\app.asar.unpacked\node_modules\@tencent\tencent-docs-ai-engine\`（内含 `bin/win32-x64/editor_sdk.exe`，199.54 MB，嵌入式 ZIP 提供 `/static/<type>/pc.html`，支持 `--static_dir=<dir>` 覆盖）。
   - **服务端口与探活常量**：默认端口 **`39099`**（双栈 `::` / `127.0.0.1` 向上最多扫描 **`100`** 个端口，启动失败重试 **`5`** 次）；端口发现文件 `tencent-docs-engine.port`（桥接轮询间隔 `500 ms`，超时 `30,000 ms`）；就绪探活 `GET /health`（间隔 `100 ms`，单次超时 `250 ms`，总超时 `60,000 ms`）；MCP 端点 `/mcp`（本地工具前缀 `mcp__tencent_docs_local__`）；本地控制接口 `GET /localapi/editor/status`、`POST /localapi/save`、`POST /localapi/editor/close`（单次超时 `10,000 ms`）。
   - **PPT（slide）预览与联动规则**：
     - URL 模板：`http://127.0.0.1:<port>/static/slide/pc.html?title=<basename>&localFilePath=<absPath>&globalPadId=<md5(filePath)>&local_edit=1&client=sdk_local_wb&hideTitlebar=1`（只读预览态将 `client` 设为 `sdk_local_preview`）。
     - 支持演示文稿扩展名全集（9 种）：`.pptx`、`.ppt`、`.pps`、`.pot`、`.pptm`、`.ppsx`、`.ppsm`、`.potx`、`.potm`。
     - 宿主与编辑器主题/语言联动 `postMessage` 事件：`workbuddy:themeChanged`、`workbuddy:localeChanged`。
     - `lib/common/selection-prompt.js` 再次实证：引擎侧对 `slide` 选区不做硬编码字段裁剪，将完整 JSON 序列化进 `<tencent_docs_selection><selection_payload format="json">...</selection_payload></tencent_docs_selection>` 并以 `@tdoc-selection#<timestamp>` 关联。
3. **核心 JavaScript 模块 AST 与源码取证（`D:\WorkBuddy\resources\app.asar.unpacked\`）**：
   - REA `analyze_javascript_application`（`ev_5677fdc4aee248019909b5faa9ae2318f0970f05acc88b7d4baf9bf486a2dd0f`）：完整解析 8 个核心文件（`63,322` AST 节点、`1,951` 条发现、`0` 解析失败、`3` 个 `contextBridge` API 与 `5` 个 IPC 操作），覆盖 `office-selection-wakeup-BlYISva8.js`、`selection-quote-conversation-input-eBPyMR25.js`、`office-chat-conversations-mRQuX-Jd.js`、`office-content-kind-DLBzZV74.js`、`local-docs-facade-DG5QSCD0.js`、`builtin-window-apps-DULS9NhF.js`、`bootstrap-BBdb8JCl.js` 与 `resources/tdoc-preview-preload.js`。
   - `renderer/assets/contexts-DgzzFjnf.js` 精确函数偏移：`toActiveDocumentSelection`（`6498871..6499862`）、`createDocumentSelectionContextBlock`（`6501288..6502731`）、`isDocumentSelectionContextBlock`（`6502731..6502834`）、`getDocumentSelectionBlockKey`（`6505170..6505546`）、`syncDocumentSelectionContextBlock`（`6505767..6506076`）、`sanitizeDocumentSelectionForDraft`（`6542851..6543359`）、`createDocumentSelectionPhraseRenderer`（`6545480..6545827`）、`useDocumentSelectionInputBinding`（`6545868..6547055`）、`useTencentDocsConversationDocumentSelectionBridge`（`6555111..6555901`）、`renderTencentDocsSelectionPrompt`（`5851100..5859700`）。

---

## 1. 整体入口架构与界面布局（Entry Parity）

WorkBuddy 对 `.pptx` 演示文稿提供**三大一致入口**（实证自 `artifact-slot-panel-DlzKPlfh.js`、`detail-panel-wrapper-BZPa078h.js`、`src-DRFw_ZFg.js`、`bootstrap-BBdb8JCl.js`、`builtin-window-apps-DULS9NhF.js`）：

1. **对话流产物卡片入口（主入口）**
   - 来源：`renderer/assets/artifact-slot-panel-DlzKPlfh.js` + `reference/picture-1.png`
   - 结构：圆角浅灰卡片（`#F7F8FA`），左侧橙色 `P` 图标，中部文件名（`.pptx`）与文件大小（如 `76.3 KB`），右侧依次为更多 `...`、独立窗打开按钮（`data-office-window-entry`，独立 Office 窗口默认尺寸 `1440 × 900`，来源：`builtin-window-apps-DULS9NhF.js`）、黑色 `[分享]` 按钮；卡片下方附 `查看所有产物 (N) >`。
   - 交互：点击产物卡片立即在**右侧停靠栏**中以多标签形式打开 PPT 编辑器；已打开时自动聚焦对应标签。
2. **右侧多标签栏 `+` 新建 / 打开入口**
   - 来源：`renderer/assets/src-DRFw_ZFg.js`（`ArtifactTabsBar`）+ `renderer/assets/bootstrap-BBdb8JCl.js`（`slidesEntries()`）
   - 交互：点击右侧标签栏 `+` 可新建空白 16:9 `.pptx`（使用标准 OOXML 最小包模板 `slidesEntries()`，`sldSz cx="12192000" cy="6858000"`）或打开本地 `.pptx` 文件；支持多标签切换、拖拽排序、关闭、展开全屏与收起侧栏。
3. **对话输入框选区上下文 Chip 双向回跳入口**
   - 来源：`renderer/assets/contexts-DgzzFjnf.js`（`createDocumentSelectionPhraseRenderer`）+ `renderer/assets/office-selection-wakeup-BlYISva8.js`
   - 交互：在 PPT 画布中点选元素或开启**自由框选模式**拖拽框选后，自动向当前对话输入框同步/插入 `DocumentSelectionChip`；点击该 chip 可反向跳转定位并高亮原幻灯片的对应页码、形状或框选区域。

---

## 2. 传统 PPT 软件交互模型（Ribbon + 缩略图 + 画布 + 备注 + 状态栏）

来源：`reference/picture-1.png` + `renderer/assets/local-docs-facade-DG5QSCD0.js`（`/static/slide/pc.html`）+ `resources/tdoc-preview-preload.js`

| 区域 | 结构与交互行为 | 出处 |
|---|---|---|
| **顶部标签栏** | `[P] 文件名.pptx ×` + `+` 新建/打开 + 全屏展开 + 侧栏切换 | `src-DRFw_ZFg.js` & `picture-1.png` |
| **文档标题栏** | 文件名（可重命名）+ 文件夹定位图标；右侧：保存、导出/上传、放映预览、更多 `...`、深色 `[分享]` 按钮 | `bootstrap-BBdb8JCl.js` & `picture-1.png` |
| **7 大 Ribbon 选项卡** | `开始`（激活态蓝色下划线 `#2563EB`）、`插入`、`美化`、`切换`、`动画`、`放映`、`视图` | `picture-1.png` |
| **`开始` 工具栏** | 左侧 2×2 快捷操作（撤销、重做、格式刷、清除格式）\| `插入 ▾` \| `字体 Aa ▾` \| `段落 ▾` \| `绘图 ▾` \| `动画` \| `页面设置 ▾` \| `打印` \| 搜索与折叠箭头 | `picture-1.png` |
| **左侧缩略图导览栏** | 顶部 `添加页面` 按钮 + 带 1-based 展示序号的 16:9 缩略图竖排列表，当前页蓝框高亮，支持新增/复制/删除/拖拽重排 | `picture-1.png` |
| **中央交互画布** | 浅灰工作台底（`#F2F4F7`）居中渲染 16:9 幻灯片，右上角常驻悬浮胶囊 **`自由框选模式` 开关**；支持普通编辑态（拖拽移动、对齐参考线、8 向缩放、双击编辑文字、右键层级/引用）与自由框选态 | `picture-1.png` & `slide.md` |
| **演讲者备注区** | 画布下方折叠/常驻区域，占位文案 `点击添加备注`，读写对接 `slide_get_notes_text` / `slide_set_notes_text` | `picture-1.png` & `slideengine_references.md` |
| **底部状态栏** | 左侧大纲开关 + `第 X 页/共 Y 页`；右侧备注开关、幻灯片浏览视图、放映按钮、适应窗口、`- 39% +` 缩放步进 | `picture-1.png` |

---

## 3. PPT 生成与编辑引擎规范（Coordinates, OOXML, DESIGN.md & `slide_*` Tools）

来源：`resources/plugins/workbuddy-builtin/builtin-plugins/tencent-private-docs-plugin/skills/tencent-private-docs/slide/entry.md`、`references/slideengine_references.md`、`sidebar-pptx-generator/references/*.md`、`skills/workbuddy-local-office-edit/slide.md`

### 3.1 坐标系与版式常量
- **逻辑画布尺寸（16:9 标准）**：
  - 引擎工具坐标：`960 × 540 pt`（`slideengine_references.md` 第 782 行）
  - JSX 布局参考：`1280 × 720 px`（换算系数 `1 pt = 4/3 px`，即 `960pt = 1280px`、`540pt = 720px`）
  - OOXML EMU 换算：`1 pt = 12700 EMU`；16:9 尺寸 `cx = 12192000 EMU`，`cy = 6858000 EMU`（来源：`bootstrap-BBdb8JCl.js` `slidesEntries()` 及 `slideengine_references.md` 第 459 行）
  - 4:3 尺寸：`aspect_ratio = 1`（`960 × 720 pt` / `720 × 540 pt`），16:9 为 `aspect_ratio = 2`（`slideengine_references.md` 第 1831 行）
- **常规页三区母版（1280×720 px / 折算 960×540 pt）**：
  - A 标题区：`y = 0..120 px`（`0..90 pt`）
  - B 内容区：`y = 120..660 px`（`90..495 pt`）
  - C 页脚区：`y = 660..720 px`（`495..540 pt`）
  - 左右安全边距：`60..80 px`（`45..60 pt`）
- **颜色格式规范**：
  - `slide_*` 工具接口采用 6 位十六进制 `RRGGBB`（不含 `#` 前缀），透明度 `0~100`（`0` = 不透明，`100` = 完全透明）；`"none"` 表示移除填充/边框。
  - 插入普通形状（`slide_add_shape`）时必须提供 `fill_color` 或 `border_color` 之一，否则拒绝。
- **0-based 对齐铁律**（来源：`workbuddy-local-office-edit/slide.md` 第 18-20 行）：
  - `page_index`、`shape_index`、表格 `row` / `col` 全部为 **0-based**。
  - 选区信息里的索引与 `slide_*` 工具入参**严格直接对齐**，Agent 无需 `+1` 或 `-1` 换算。

### 3.2 生成工作流与核心工具集
1. **DESIGN.md 设计契约前置门（`slide_set_design`）**：
   - 先固化全篇设计契约（色板、字体、三区版式、视觉母题与自检条件），再逐页构建幻灯片。
2. **声明式逐页生成（`<Slide>` / `<Box>` / `<Text>` / `<Chart>` / `<Table>` / `<Image>` / `<SVG>`）**：
   - 支持通过结构化页面规格或 JSX-like 声明快速生成单页，并自动为每个生成元素分配**稳定且语义化的 `shape_id`**（如 `s5_chart_workload`、`s5_kpi_70pct`）及连续 0-based `shape_index`。
3. **原子级 `slide_*` 精准修改工具组**（实证共 78 个工具，本次在 DSH Plugin 中完整实现核心高频子集）：
   - **文档与页管理**：`slide_create_deck`、`slide_set_design`、`slide_get_info`、`slide_get_page_info`、`slide_add_slide`、`slide_add_page_with_jsx`、`slide_duplicate_slide`、`slide_remove_slide`、`slide_move_slide`、`slide_set_page_properties`、`slide_set_slide_size`
   - **形状与图形**：`slide_get_shape_info`、`slide_add_shape`、`slide_add_shapes`、`slide_add_line_shape`、`slide_set_shape_properties`（支持 A 单形状 / B 批量一对一 / C 批量多对一）、`slide_remove_shapes`、`slide_reorder_shape`（`op`: 0=置顶 / 1=置底 / 2=上移 / 3=下移）、`slide_group_shapes` / `slide_ungroup_shapes`
   - **文本与查找**：`slide_get_text`、`slide_add_text`、`slide_set_text`、`slide_append_text`、`slide_set_text_property`、`slide_find_text`、`slide_find_replace_text`
   - **表格与图表**：`slide_add_table`、`slide_get_table_info`、`slide_set_cell_text`、`slide_set_cell_style`、`slide_merge_table_cells`、`slide_add_chart`、`slide_get_chart_info`、`slide_update_chart_data`、`slide_change_chart_type`、`slide_update_chart_series_style`
   - **动画、主题、备注与撤销**：`slide_list_anim_types`、`slide_add_anim`、`slide_remove_anim`、`slide_list_builtin_themes`、`slide_set_theme`、`slide_get_notes_text`、`slide_set_notes_text`、`slide_list_recent_ai_edits`、`slide_undo_ai_edit`
   - **细粒度选区与空间索引查询（增强对齐）**：`slide_query_region`（按 `page_index` + `bbox_pt` 查询命中的所有元素与重叠比例）、`slide_resolve_selection`（将 `tdoc-selection://` 或 `rangeId` 解析为最新元素详情）。

---

## 4. 细粒度上下文索引与选区通信协议（Fine-Grained Context Indexing）

来源：`renderer/assets/contexts-DgzzFjnf.js`（偏移 6498871..6557862、5851100..5859700）、`renderer/assets/office-selection-wakeup-BlYISva8.js`、`resources/tdoc-preview-preload.js`、`skills/workbuddy-local-office-edit/slide.md`

### 4.1 选区事件流（双向解耦 + 唤醒重放队列）
- **引擎桥接**：`window.mqq.invoke` 触发 `docx.onSelectionChange` / `docx.onSelectionSend`（前提：`window.__WB_DOCS_FEATURE_LIST__.aiEdit === true`）。
- **宿主双通道事件**：
  1. `docs:selectionChanged`：同步/更新对话输入框草稿中的选区 Chip（不立即发送），若带 `selection.aiPrompt` 则自动附带配对文本块（`selectionPairId` + `selectionAutoPrompt`）。
  2. `docs:selectionSend`：携带可选 `selection.aiPrompt` 直接触发 `sendPrompt`（附 `_meta: { fileViewerTriggerSource: 'keyboard_shortcut' }`）。
- **唤醒队列参数**（`office-selection-wakeup-BlYISva8.js`）：
  - 最大重试次数：`20`，轮询间隔：`100 ms`，已消费发送去重集合上限：`100`。
- **去重键算法**（`getDocumentSelectionBlockKey`）：
  - `${documentResourceUri}\n${rangeId}\n${sequenceEpoch}\n${sequence}`
  - 缺省 `sequenceEpoch` 为 `'__legacy_epoch__'`；已手动关闭的 Chip 存入 `dismissedKeysRef`，同一 `sessionId` 下不重复弹出。

### 4.2 选区 Chip 数据结构与 LLM Prompt 序列化
- **对话输入框 `resource_link` Chip 块**（`createDocumentSelectionContextBlock`）：
  - `type`: `'resource_link'`
  - `uri`: `'tdoc-selection://' + encodeURIComponent(rangeId)`
  - `_meta.mentionType`: `'tencentDocsSelection'`
  - `_meta.type`: `'document-selection'`
  - `_meta.displayAsPhrase`: `true`，`_meta.displayAsContext`: `false`
  - `_meta.selectionPayload`: 透传引擎上报的结构化定位对象（剥离 `aiPrompt` / `sourceApi`）
- **发往 Agent/LLM 的标准 XML 封装**（`renderTencentDocsSelectionPrompt`）：
  - 在用户消息中用 `@tdoc-selection#<timestamp>` 锚点引用，并在上下文区注入：
    ```xml
    <tencent_docs_selection>
      <selection_payload format="json">
        {"rangeId":"...","page_index":5,"shape_ids":["..."],"shape_indices":[2],"bbox_pt":{"x":36,"y":135,"w":556,"h":310},...}
      </selection_payload>
    </tencent_docs_selection>
    ```
- **自由框选模式扩展字段（标注 `estimated`）**：
  - 由于腾讯文档本地引擎 `http://127.0.0.1/static/slide/pc.html` 的前端静态包未解包在 `app.asar.unpacked` 中，其框选上报的额外可选键无法静态直读（已在 REA 中登记为 `unk_e504dd7a2f81d8e7f98948172a5ad795e7a9f26379cdc26ce810da6a3f55f789`）。
  - 结合 `slide.md`（确认 `page_index`、`shape_index`、表格行列均为 0-based 且 `pt` 坐标对齐）及 `contexts-DgzzFjnf.js` 的全量透传机制，我们在 `selectionPayload` 中规范化输出：
    - `rangeId`（必填，实证）
    - `text`（必填，实证，汇总选中元素文本摘要）
    - `timestamp`（实证）
    - `page_index`（0-based，实证自 `slide.md`）
    - `shape_ids` / `shape_indices`（0-based，实证自 `slide.md`）
    - `selection_mode`: `'element' | 'multi-element' | 'free-marquee' | 'table-cells' | 'chart-series'`（`estimated`）
    - `bbox_pt`: `{ x, y, w, h }`（`pt` 单位精确框选矩形，`estimated`）
    - `elements`: 命中元素细粒度快照数组 `[{ shape_id, shape_index, type, role, bounds_pt, overlap_ratio, text_preview, style_summary, table_cells?, chart_summary? }]`（`estimated`）
    - `recommended_tools`: 推荐给 Agent 的下一步精准调用提示（如 `slide_set_shape_properties` / `slide_update_chart_data` / `slide_set_text`）（`estimated`）

---

## 5. Office 快捷提示词与辅助行为

来源：`renderer/assets/office-chat-conversations-mRQuX-Jd.js`
- 针对 `ppt` 文档类型内置 4 类快捷提示词动作：`summarize`（总结提炼）、`speech`（生成演讲稿）、`polish`（润色优化）、`structure`（优化结构）。
- 切换标签或关闭存在未发送选区编辑时，触发未提交选区确认保护（`useDocumentSelectionTabSwitchConfirm`）。
