import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  exportDeckToPptxBuffer,
  importDeckFromPptxBuffer,
} from '../dist/core/index.js';
import {
  DeckRegistry,
  apply as applyServerPlugin,
} from '../dist/server/index.js';

const OUTPUT_PATH = path.resolve(
  process.cwd(),
  '认识DSH与Agent-零基础入门指南.pptx',
);

// Mount our built DSH server plugin into a local Cordis-like tool host
const registry = new DeckRegistry({ loadSampleDeck: false });
const tools = new Map();
const dispose = applyServerPlugin(
  {
    tools: {
      register: (tool) => {
        tools.set(tool.name, tool);
        return () => tools.delete(tool.name);
      },
      get: (name) => tools.get(name),
      list: () => Array.from(tools.values()),
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  },
  { registry, loadSampleDeck: false },
);

async function call(name, args) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  const res = await tool.execute(args);
  if (res && res.ok === false) {
    throw new Error(`Tool ${name} failed: ${JSON.stringify(res)}`);
  }
  return res;
}

const FILE_ID = 'dsh_agent_intro_beginner';
const BG_DARK = '0B1220';
const CARD_BG = '131E33';
const CARD_ALT = '172540';
const BORDER = '253759';
const TEXT_MAIN = 'F8FAFC';
const TEXT_SUB = 'CBD5E1';
const TEXT_MUTED = '94A3B8';
const CYAN = '38E8D4';
const PURPLE = '846BFF';
const AMBER = 'F59E0B';
const GREEN = '10B981';
const RED = 'F43F5E';

async function addHeader(pageIndex, tag, title, subtitle) {
  await call('slide_set_page_properties', {
    file_id: FILE_ID,
    page_index: pageIndex,
    background_color: BG_DARK,
  });
  await call('slide_add_text', {
    file_id: FILE_ID,
    page_index: pageIndex,
    x: 48,
    y: 22,
    w: 420,
    h: 22,
    text: tag,
    font_size: 11,
    font_color: CYAN,
    bold: true,
    align: 'left',
  });
  await call('slide_add_text', {
    file_id: FILE_ID,
    page_index: pageIndex,
    x: 48,
    y: 44,
    w: 864,
    h: 38,
    text: title,
    font_size: 26,
    font_color: TEXT_MAIN,
    bold: true,
    align: 'left',
  });
  if (subtitle) {
    await call('slide_add_text', {
      file_id: FILE_ID,
      page_index: pageIndex,
      x: 48,
      y: 84,
      w: 864,
      h: 24,
      text: subtitle,
      font_size: 13,
      font_color: TEXT_MUTED,
      align: 'left',
    });
  }
  await call('slide_add_text', {
    file_id: FILE_ID,
    page_index: pageIndex,
    x: 48,
    y: 506,
    w: 600,
    h: 20,
    text: 'DSH Desktop · 零基础认识 AI Agent 入门指南',
    font_size: 10,
    font_color: TEXT_MUTED,
    align: 'left',
  });
  await call('slide_add_text', {
    file_id: FILE_ID,
    page_index: pageIndex,
    x: 820,
    y: 506,
    w: 92,
    h: 20,
    text: `${String(pageIndex + 1).padStart(2, '0')} / 10`,
    font_size: 10,
    font_color: TEXT_MUTED,
    align: 'right',
  });
}

async function addCard(pageIndex, { x, y, w, h, fill = CARD_BG, border = BORDER, accent, title, body, titleColor = TEXT_MAIN, bodySize = 13 }) {
  await call('slide_add_shape', {
    file_id: FILE_ID,
    page_index: pageIndex,
    shape_type: 'roundRect',
    x,
    y,
    w,
    h,
    fill_color: fill,
    border_color: border,
    border_width: 1,
  });
  if (accent) {
    await call('slide_add_shape', {
      file_id: FILE_ID,
      page_index: pageIndex,
      shape_type: 'rect',
      x: x + 16,
      y: y + 16,
      w: 44,
      h: 4,
      fill_color: accent,
    });
  }
  const titleY = accent ? y + 28 : y + 16;
  await call('slide_add_text', {
    file_id: FILE_ID,
    page_index: pageIndex,
    x: x + 16,
    y: titleY,
    w: w - 32,
    h: 28,
    text: title,
    font_size: 16,
    font_color: titleColor,
    bold: true,
    align: 'left',
  });
  await call('slide_add_text', {
    file_id: FILE_ID,
    page_index: pageIndex,
    x: x + 16,
    y: titleY + 32,
    w: w - 32,
    h: h - (titleY - y) - 44,
    text: body,
    font_size: bodySize,
    font_color: TEXT_SUB,
    align: 'left',
  });
}

try {
  // 1. Create Deck & lock DESIGN.md contract
  await call('slide_create_deck', {
    file_id: FILE_ID,
    file_name: '认识DSH与Agent-零基础入门指南.pptx',
    title: '一文看懂 Agent：从零认识 DSH 智能体',
    aspect_ratio: 2,
    theme_id: 'deep-sea-cyan',
  });

  await call('slide_set_design', {
    file_id: FILE_ID,
    design_md: `# DESIGN.md — 零基础认识 DSH 与 Agent
- 画布：16:9（960×540 pt），三区母版（标题 0-108pt / 内容 116-492pt / 页脚 504-530pt）
- 色板：深海蓝底 #0B1220，卡片 #131E33，强调荧光青 #38E8D4、数字紫 #846BFF、暖琥珀 #F59E0B
- 面向对象：从未接触过 AI 与 Agent 的零基础读者，全篇用大白话+生活类比+清晰对比`,
  });

  // ── Slide 0: Cover ──────────────────────────────────────────────────────
  // Clear default placeholder elements from blank slide 0 before laying out cover
  const s0Info = await call('slide_get_page_info', { file_id: FILE_ID, page_index: 0 });
  const placeholderIds = (s0Info.page?.elements ?? []).map((e) => e.shape_id);
  if (placeholderIds.length > 0) {
    await call('slide_remove_shapes', {
      file_id: FILE_ID,
      page_index: 0,
      shape_ids: placeholderIds,
    });
  }
  await call('slide_set_page_properties', {
    file_id: FILE_ID,
    page_index: 0,
    background_color: BG_DARK,
  });
  await call('slide_add_shape', {
    file_id: FILE_ID,
    page_index: 0,
    shape_type: 'roundRect',
    x: 64,
    y: 92,
    w: 224,
    h: 32,
    fill_color: CARD_ALT,
    border_color: CYAN,
    border_width: 1,
  });
  await call('slide_add_text', {
    file_id: FILE_ID,
    page_index: 0,
    x: 64,
    y: 97,
    w: 224,
    h: 22,
    text: 'DSH Desktop 零基础入门课',
    font_size: 12,
    font_color: CYAN,
    bold: true,
    align: 'center',
  });
  await call('slide_add_text', {
    file_id: FILE_ID,
    page_index: 0,
    x: 64,
    y: 146,
    w: 832,
    h: 96,
    text: '一文看懂 Agent：\n从零认识 DSH 智能体',
    font_size: 40,
    font_color: TEXT_MAIN,
    bold: true,
    align: 'left',
  });
  await call('slide_add_text', {
    file_id: FILE_ID,
    page_index: 0,
    x: 64,
    y: 266,
    w: 760,
    h: 54,
    text: '不讲晦涩代码，只用大白话带你搞懂：什么是 Agent、它在 DSH 里能帮你做什么，\n以及零基础也能立刻上手的提示词撰写方法。',
    font_size: 16,
    font_color: TEXT_SUB,
    align: 'left',
  });
  await addCard(0, {
    x: 64,
    y: 356,
    w: 260,
    h: 112,
    accent: CYAN,
    title: '01 听得懂的概念',
    body: '用生活类比讲清普通 AI 与\nAgent 智能体的本质区别',
    bodySize: 12,
  });
  await addCard(0, {
    x: 350,
    y: 356,
    w: 260,
    h: 112,
    accent: PURPLE,
    title: '02 看得见的实战',
    body: '了解 DSH 如何让 Agent 直接\n操作文件、做 PPT 与处理任务',
    bodySize: 12,
  });
  await addCard(0, {
    x: 636,
    y: 356,
    w: 260,
    h: 112,
    accent: AMBER,
    title: '03 用得上的公式',
    body: '套用「4 步黄金提示词法」\n第一次提问就能拿到好结果',
    bodySize: 12,
  });
  await call('slide_set_notes_text', {
    file_id: FILE_ID,
    page_index: 0,
    notes: '开场白：欢迎大家！今天不聊复杂技术词，只用 10 分钟带你认识 DSH 里的 AI Agent，以及如何让它真正帮你分担工作。',
  });

  // ── Slide 1: What is Agent? ─────────────────────────────────────────────
  await call('slide_add_slide', { file_id: FILE_ID, title: '什么是 Agent（智能体）？' });
  await addHeader(
    1,
    'CHAPTER 01 · 核心概念',
    '什么是 Agent（智能体）？',
    '一句话大白话：普通 AI 像「只给建议的顾问」，Agent 像「能直接把活干完的助理」。',
  );
  await addCard(1, {
    x: 48,
    y: 124,
    w: 416,
    h: 268,
    accent: TEXT_MUTED,
    title: '普通聊天 AI（传统问答）',
    titleColor: TEXT_SUB,
    body: '• 你问一句，它答一句，只输出文字建议\n• 看不到你电脑里的真实文件夹与项目\n• 不能自己打开软件、改文档或运行检查\n• 例子：你说“帮我做份 PPT”，它只给你\n  一段文字大纲，你还得自己一页页排版',
    bodySize: 14,
  });
  await addCard(1, {
    x: 496,
    y: 124,
    w: 416,
    h: 268,
    fill: CARD_ALT,
    border: CYAN,
    accent: CYAN,
    title: 'AI Agent 智能体（如 DSH）',
    titleColor: CYAN,
    body: '• 给它一个目标，它会自己拆步骤、按顺序做\n• 能读你的本地资料、调用各种专业工具\n• 做完还会自我检查，发现问题自动修正\n• 例子：你说“帮我做份入门 PPT”，它会\n  直接生成可打开、可预览、可修改的 .pptx',
    bodySize: 14,
  });
  await call('slide_add_shape', {
    file_id: FILE_ID,
    page_index: 1,
    shape_type: 'roundRect',
    x: 48,
    y: 412,
    w: 864,
    h: 72,
    fill_color: CARD_BG,
    border_color: PURPLE,
    border_width: 1,
  });
  await call('slide_add_text', {
    file_id: FILE_ID,
    page_index: 1,
    x: 68,
    y: 426,
    w: 824,
    h: 44,
    text: '核心记忆点：Agent = 大模型的大脑 + 动手干活的工具 + 记住上下文的笔记本 + 遇到问题会自己调整的循环能力。',
    font_size: 14,
    font_color: TEXT_MAIN,
    bold: true,
    align: 'left',
  });
  await call('slide_set_notes_text', {
    file_id: FILE_ID,
    page_index: 1,
    notes: '重点强调对比：很多人以为 AI 就是聊天机器人，而 Agent 最大的跨越是从“说怎么做”变成“帮你做成”。',
  });

  // ── Slide 2: How Agent Works (4 Pillars) ────────────────────────────────
  await call('slide_add_slide', { file_id: FILE_ID, title: 'Agent 为什么能“自己干活”？' });
  await addHeader(
    2,
    'CHAPTER 02 · 工作原理',
    'Agent 为什么能“自己干活”？',
    '就像一位靠谱的新同事，Agent 靠 4 项基本能力配合完成复杂任务：',
  );
  await addCard(2, {
    x: 48,
    y: 126,
    w: 204,
    h: 256,
    accent: CYAN,
    title: '1. 大脑（思考规划）',
    body: '听懂你的需求，把一件大事拆成“第一步、第二步、第三步”，决定先做什么后做什么。',
    bodySize: 13,
  });
  await addCard(2, {
    x: 268,
    y: 126,
    w: 204,
    h: 256,
    accent: PURPLE,
    title: '2. 工具（动手执行）',
    body: '读写文件、搜索资料、生成图表、排版 PPT、运行命令——工具越多，能干的活越丰富。',
    bodySize: 13,
  });
  await addCard(2, {
    x: 488,
    y: 126,
    w: 204,
    h: 256,
    accent: AMBER,
    title: '3. 记忆（记住脉络）',
    body: '记住你之前提过的要求、发过的参考文件与修改意见，不用每次从头重复解释。',
    bodySize: 13,
  });
  await addCard(2, {
    x: 708,
    y: 126,
    w: 204,
    h: 256,
    accent: GREEN,
    title: '4. 反思（检查纠错）',
    body: '每做完一步就看结果对不对，如果发现漏页、报错或格式乱了，会自动修好再交卷。',
    bodySize: 13,
  });
  await call('slide_add_shape', {
    file_id: FILE_ID,
    page_index: 2,
    shape_type: 'roundRect',
    x: 48,
    y: 404,
    w: 864,
    h: 78,
    fill_color: CARD_ALT,
    border_color: BORDER,
    border_width: 1,
  });
  await call('slide_add_text', {
    file_id: FILE_ID,
    page_index: 2,
    x: 68,
    y: 418,
    w: 824,
    h: 50,
    text: '生活类比：你让助理“订明天去上海的早班机票并做行程单”——\n助理先查航班（工具）→ 记住你偏好靠窗（记忆）→ 发现早班售罄改查高铁（反思）→ 整理好行程表发给你（交付）。',
    font_size: 13,
    font_color: TEXT_SUB,
    align: 'left',
  });

  // ── Slide 3: What is DSH? ───────────────────────────────────────────────
  await call('slide_add_slide', { file_id: FILE_ID, title: '认识 DSH：给 Agent 配备的专业工作台' });
  await addHeader(
    3,
    'CHAPTER 03 · 认识 DSH',
    '认识 DSH：给 Agent 配备的专业工作台',
    'DSH（DeepSeek Harness）不是单纯的聊天窗口，而是让 Agent 安全、可控、可视化干活的桌面环境。',
  );
  await addCard(3, {
    x: 48,
    y: 126,
    w: 416,
    h: 168,
    accent: CYAN,
    title: '📂 绑定真实工作区',
    body: '直接关联你电脑里的项目文件夹，Agent 可以读取参考资料、整理素材，并把成品文件直接保存在你指定的位置。',
    bodySize: 13,
  });
  await addCard(3, {
    x: 496,
    y: 126,
    w: 416,
    h: 168,
    accent: PURPLE,
    title: '🧩 丰富的插件扩展生态',
    body: '像给手机装 App 一样给 DSH 装插件：例如装上 PPT Studio 插件后，右侧就能直接预览幻灯片、自由框选局部让 AI 精修。',
    bodySize: 13,
  });
  await addCard(3, {
    x: 48,
    y: 314,
    w: 416,
    h: 168,
    accent: AMBER,
    title: '🛡️ 透明过程与安全护栏',
    body: '每一步调用了什么工具、改了哪个文件都清晰可见；遇到删除文件或高风险操作时，可由你确认把关，既省心又安心。',
    bodySize: 13,
  });
  await addCard(3, {
    x: 496,
    y: 314,
    w: 416,
    h: 168,
    accent: GREEN,
    title: '🤝 随时介入的人机协作',
    body: '不需要等它全部做完才看结果——你可以随时在对话中补充想法、切换模型，或者直接框选某一页让它按你的意思微调。',
    bodySize: 13,
  });

  // ── Slide 4: What Can Agent Do? ─────────────────────────────────────────
  await call('slide_add_slide', { file_id: FILE_ID, title: 'Agent 能做什么？6 大高频日常任务' });
  await addHeader(
    4,
    'CHAPTER 04 · 能力全景',
    'Agent 能做什么？6 大高频日常任务',
    '无论你是不是程序员，只要任务涉及“查资料、理信息、出文档、重复操作”，都可以交给 DSH Agent。',
  );
  const scenarios = [
    { x: 48, y: 126, accent: CYAN, title: '📊 汇报与 PPT 制作', body: '根据零散笔记自动梳理大纲、生成 16:9 演示文稿，并支持框选单页局部改文案、调配色。' },
    { x: 344, y: 126, accent: PURPLE, title: '📝 长文档与周报整理', body: '把聊天记录、会议纪要、多份 Word/PDF 资料快速提炼成条理清晰的总结、周报或方案。' },
    { x: 640, y: 126, accent: AMBER, title: '📈 数据分析与图表', body: '读取表格数据，自动清洗异常值、统计核心指标，并生成直观的柱状图、趋势图和结论。' },
    { x: 48, y: 314, accent: GREEN, title: '🔍 深度调研与比价', body: '围绕一个主题多方收集信息、交叉核对口径，输出带来源说明的调研清单或对比表。' },
    { x: 344, y: 314, accent: CYAN, title: '💻 辅助编程与小工具', body: '哪怕没学过代码，也能用大白话让它帮你写批量重命名脚本、网页小工具或排查报错。' },
    { x: 640, y: 314, accent: PURPLE, title: '🗂️ 批量文件与流程整理', body: '按规则自动归类上百个零散文件、统一命名格式、提取关键字段，告别机械复制粘贴。' },
  ];
  for (const s of scenarios) {
    await addCard(4, { ...s, w: 272, h: 168, bodySize: 12 });
  }

  // ── Slide 5: Efficiency Comparison Chart ────────────────────────────────
  await call('slide_add_slide', { file_id: FILE_ID, title: '真实效率对比：手动操作 vs DSH Agent 协作' });
  await addHeader(
    5,
    'CHAPTER 05 · 效率提升',
    '真实效率对比：手动操作 vs DSH Agent 协作',
    '把重复搜集、初稿搭建和格式对齐交给 Agent，人只需要把关方向和关键结论。',
  );
  await call('slide_add_chart', {
    file_id: FILE_ID,
    page_index: 5,
    chart_type: 'bar',
    title: '常见办公任务平均耗时对比（分钟，示意参考）',
    x: 48,
    y: 126,
    w: 560,
    h: 356,
    categories: ['制作10页PPT', '整理周报纪要', '多文档资料汇总', '批量文件归类'],
    series: [
      { name: '传统纯手动', values: [120, 45, 90, 60], color: PURPLE },
      { name: 'DSH Agent 协作', values: [20, 8, 15, 5], color: CYAN },
    ],
  });
  await addCard(5, {
    x: 628,
    y: 126,
    w: 284,
    h: 170,
    fill: CARD_ALT,
    border: CYAN,
    accent: CYAN,
    title: '⏱️ 节省 70%~85% 耗时',
    titleColor: CYAN,
    body: '最耗时的“从 0 到 1 搭框架、找素材、调格式”由 Agent 几分钟完成，你专注审核重点与最终拍板。',
    bodySize: 13,
  });
  await addCard(5, {
    x: 628,
    y: 312,
    w: 284,
    h: 170,
    accent: AMBER,
    title: '💡 人机分工黄金原则',
    body: '• 人负责：定目标、给背景、做判断\n• Agent 负责：拆步骤、用工具、出初稿、按意见反复精修',
    bodySize: 13,
  });

  // ── Slide 6: Prompt 4-Step Golden Formula ───────────────────────────────
  await call('slide_add_slide', { file_id: FILE_ID, title: '提示词怎么写？零基础「4 步黄金公式」' });
  await addHeader(
    6,
    'CHAPTER 06 · 提示词指南',
    '提示词怎么写？零基础「4 步黄金公式」',
    '提示词（Prompt）其实就是“你给助理下达的任务说明”。说得越清楚，Agent 做得越准！',
  );
  await addCard(6, {
    x: 48,
    y: 126,
    w: 416,
    h: 168,
    accent: CYAN,
    title: '① 定目标与受众（给谁看、达成什么）',
    body: '明确说清你要什么成品，以及给谁用。\n示例：“帮我做一份 10 页的入门 PPT，给从未接触过 AI 的新员工培训用。”',
    bodySize: 13,
  });
  await addCard(6, {
    x: 496,
    y: 126,
    w: 416,
    h: 168,
    accent: PURPLE,
    title: '② 给背景与材料（把参考直接喂给它）',
    body: '把相关文件、笔记、数据或参考图直接 @ 出来或放进工作区。\n示例：“请参考工作区里的 产品介绍.md 与 风格参考.png。”',
    bodySize: 13,
  });
  await addCard(6, {
    x: 48,
    y: 314,
    w: 416,
    h: 168,
    accent: AMBER,
    title: '③ 定结构与风格（想要什么样子）',
    body: '说明篇幅、语言风格和输出格式。\n示例：“语言通俗易懂、多用生活例子；每页不超过 4 条要点；输出为 .pptx 文件。”',
    bodySize: 13,
  });
  await addCard(6, {
    x: 496,
    y: 314,
    w: 416,
    h: 168,
    accent: GREEN,
    title: '④ 设边界与验收（不要什么、怎么算完）',
    body: '提前说清避坑点，减少返工。\n示例：“不要堆砌专业英文缩写，不要编造数据；生成后检查排版不重叠。”',
    bodySize: 13,
  });

  // ── Slide 7: Good vs Bad Prompts Table ──────────────────────────────────
  await call('slide_add_slide', { file_id: FILE_ID, title: '提示词实战对比：这样改效果立竿见影' });
  await addHeader(
    7,
    'CHAPTER 07 · 实战对比',
    '提示词实战对比：这样改效果立竿见影',
    '不用背复杂模板，只需把“模糊的一句话”补充成“带对象、带标准的具体需求”。',
  );
  await call('slide_add_table', {
    file_id: FILE_ID,
    page_index: 7,
    x: 48,
    y: 126,
    w: 864,
    h: 348,
    rows: 5,
    cols: 3,
    data: [
      ['常见任务', '模糊写法 ❌（容易跑偏）', '清晰写法 ✅（一次出好活）'],
      [
        '做 PPT',
        '帮我做一个关于 AI 的 PPT。',
        '面向零基础新人做 10 页 PPT，讲清什么是 Agent 和提示词写法，多用生活比喻，保存为 .pptx。',
      ],
      [
        '写周报',
        '把这些记录整理成周报。',
        '根据工作区 笔记.md 整理本周周报，分“已完成/进行中/下周计划”三栏，每条不超过 25 字。',
      ],
      [
        '局部修改',
        '这一页不好看，改一下。',
        '（框选第 6 页右侧卡片）把文字精简成 3 条要点，强调“节省 70% 时间”，保持深海蓝配色。',
      ],
      [
        '查资料',
        '帮我调研一下智能办公工具。',
        '对比 3 款主流工具的定位、上手门槛与适用人群，整理成 Markdown 表格并标注资料来源。',
      ],
    ],
  });

  // ── Slide 8: Pro Tips in DSH ────────────────────────────────────────────
  await call('slide_add_slide', { file_id: FILE_ID, title: '在 DSH 中指挥 Agent 的 3 个省心技巧' });
  await addHeader(
    8,
    'CHAPTER 08 · 协作技巧',
    '在 DSH 中指挥 Agent 的 3 个省心技巧',
    '把 Agent 当成可以随时沟通的搭档，用好 DSH 的交互特性，事半功倍。',
  );
  await addCard(8, {
    x: 48,
    y: 132,
    w: 272,
    h: 328,
    accent: CYAN,
    title: '技巧 1：先定大纲，再出成品',
    body: '遇到大任务（如 20 页方案、长报告）时，先说：\n\n“先给我列目录和每页要点，我确认后再开始生成。”\n\n这样可以避免方向跑偏，大幅减少返工。',
    bodySize: 13,
  });
  await addCard(8, {
    x: 344,
    y: 132,
    w: 272,
    h: 328,
    accent: PURPLE,
    title: '技巧 2：善用“框选与引用”',
    body: '修改 PPT 或文档时，不用费力描述“左上角第二个蓝色框”：\n\n直接开启右侧 PPT Studio 的「自由框选模式」，框住要改的区域点击引用，Agent 就能毫米级精准定位修改！',
    bodySize: 13,
  });
  await addCard(8, {
    x: 640,
    y: 132,
    w: 272,
    h: 328,
    accent: AMBER,
    title: '技巧 3：多轮迭代，别求一步完美',
    body: '第一版出来有 80 分就已经很棒了！\n\n接下来像改稿一样提具体意见：“第 3 页字体大一点”、“再加一个生活例子”——2~3 轮就能打磨到 95 分以上。',
    bodySize: 13,
  });

  // ── Slide 9: Quick Start Action Checklist ───────────────────────────────
  await call('slide_add_slide', { file_id: FILE_ID, title: '现在就开始：零基础 3 步上手 DSH Agent' });
  await addHeader(
    9,
    'CHAPTER 09 · 立即行动',
    '现在就开始：零基础 3 步上手 DSH Agent',
    '学会使用 Agent 最好的方式，就是今天就交给它一件真实的小事。',
  );
  await addCard(9, {
    x: 48,
    y: 132,
    w: 864,
    h: 96,
    fill: CARD_ALT,
    border: CYAN,
    accent: CYAN,
    title: 'STEP 1 · 挑一件你手头正在做的真实小任务',
    body: '比如：整理本周会议纪要、把一篇文章做成 5 页分享 PPT、或者归类桌面上的杂乱文件。',
    bodySize: 13,
  });
  await addCard(9, {
    x: 48,
    y: 244,
    w: 864,
    h: 96,
    accent: PURPLE,
    title: 'STEP 2 · 套用「4 步黄金公式」发给 DSH',
    body: '写清“给谁看 + 参考哪份文件 + 输出什么格式 + 注意事项”，放心让 Agent 开始拆解与执行。',
    bodySize: 13,
  });
  await addCard(9, {
    x: 48,
    y: 356,
    w: 864,
    h: 96,
    accent: GREEN,
    title: 'STEP 3 · 在右侧预览区查看成品并局部精修',
    body: '打开生成的 .pptx 卡片，用「自由框选模式」圈出想微调的模块，体验人机协同的高效工作流！',
    bodySize: 13,
  });
  await call('slide_set_notes_text', {
    file_id: FILE_ID,
    page_index: 9,
    notes: '总结收尾：鼓励大家现在就用本份 PPT 在 DSH PPT Studio 里试试“自由框选模式”，框选任意一张卡片让 Agent 改写文案或配色。',
  });

  // 2. Export to real OOXML .pptx file
  const deck = registry.getEngine(FILE_ID).getDeck();
  const pptxBuf = await exportDeckToPptxBuffer(deck);
  await writeFile(OUTPUT_PATH, pptxBuf);

  // 3. Roundtrip verification by re-importing the generated .pptx
  const reloadedBuf = await readFile(OUTPUT_PATH);
  const reloadedDeck = await importDeckFromPptxBuffer(reloadedBuf, path.basename(OUTPUT_PATH));

  console.log(
    JSON.stringify({
      ok: true,
      outputPath: OUTPUT_PATH,
      bytes: pptxBuf.byteLength,
      slideCount: reloadedDeck.slides.length,
      totalElements: reloadedDeck.slides.reduce((acc, s) => acc + s.elements.length, 0),
      titles: reloadedDeck.slides.map((s, i) => `${i + 1}. ${s.title}`),
    }, null, 2),
  );
} finally {
  dispose();
}
