import type { ThemeDefinition } from './types';

export const SLIDE_CANVAS_WIDTH_PT = 960;
export const SLIDE_CANVAS_HEIGHT_PT = 540;

export const SLIDE_CANVAS_WIDTH_PX = 1280;
export const SLIDE_CANVAS_HEIGHT_PX = 720;

export const SLIDE_4_3_WIDTH_PT = 720;
export const SLIDE_4_3_HEIGHT_PT = 540;

export const PT_TO_PX_RATIO = 4 / 3;
export const EMU_PER_PT = 12700;

export const OOXML_WIDESCREEN_CX_EMU = 12192000;
export const OOXML_WIDESCREEN_CY_EMU = 6858000;
export const OOXML_STANDARD_4_3_CX_EMU = 9144000;
export const OOXML_STANDARD_4_3_CY_EMU = 6858000;

export const ASPECT_RATIO_16_9 = 2 as const;
export const ASPECT_RATIO_4_3 = 1 as const;

export const ZONE_TITLE_MAX_Y_PX = 120;
export const ZONE_CONTENT_MAX_Y_PX = 660;
export const SAFE_MARGIN_HORIZONTAL_PX = 60;

export const ZONE_TITLE_MAX_Y_PT = 90;
export const ZONE_CONTENT_MAX_Y_PT = 495;
export const SAFE_MARGIN_HORIZONTAL_PT = 45;

export const OFFICE_WINDOW_DEFAULT_WIDTH = 1440;
export const OFFICE_WINDOW_DEFAULT_HEIGHT = 900;

export const RIBBON_TABS = [
  '开始',
  '插入',
  '美化',
  '切换',
  '动画',
  '放映',
  '视图',
] as const;

export type RibbonTabName = (typeof RIBBON_TABS)[number];

export const DEFAULT_CANVAS_ZOOM_PERCENT = 39;

export const SELECTION_EVENT_CHANGED = 'docs:selectionChanged';
export const SELECTION_EVENT_SEND = 'docs:selectionSend';
export const SELECTION_URI_SCHEME = 'tdoc-selection://';
export const SELECTION_MENTION_TYPE = 'tencentDocsSelection';
export const SELECTION_DEFAULT_SEQUENCE_EPOCH = '__legacy_epoch__';

export const SELECTION_WAKEUP_MAX_RETRIES = 20;
export const SELECTION_WAKEUP_RETRY_INTERVAL_MS = 100;
export const SELECTION_SENT_DEDUP_CACHE_MAX = 100;
export const SELECTION_INDEX_BASE = 0;

export const ZORDER_BRING_TO_FRONT_OP = 0;
export const ZORDER_SEND_TO_BACK_OP = 1;
export const ZORDER_BRING_FORWARD_OP = 2;
export const ZORDER_SEND_BACKWARD_OP = 3;

export const FREE_MARQUEE_MIN_DRAG_PT = 6;
export const SNAP_GUIDE_THRESHOLD_PT = 5;

export const SUPPORTED_SLIDE_EXTENSIONS = [
  '.pptx',
  '.ppt',
  '.pps',
  '.pot',
  '.pptm',
  '.ppsx',
  '.ppsm',
  '.potx',
  '.potm',
] as const;

export const SLIDE_EXTENSION_REGEX =
  /\.(pptx|ppt|pps|pot|pptm|ppsx|ppsm|potx|potm)($|\?)/i;

export const HOST_THEME_CHANGED_EVENT = 'workbuddy:themeChanged';
export const HOST_LOCALE_CHANGED_EVENT = 'workbuddy:localeChanged';

export const ENGINE_DEFAULT_PORT = 39099;
export const ENGINE_PORT_SCAN_LIMIT = 100;
export const ENGINE_START_RETRY_LIMIT = 5;
export const ENGINE_HEALTH_POLL_INTERVAL_MS = 100;
export const ENGINE_HEALTH_TIMEOUT_MS = 60000;
export const ENGINE_LOCALAPI_TIMEOUT_MS = 10000;

export const SUPERVISOR_START_HANDSHAKE = '{"command":"start"}';
export const SUPERVISOR_TERMINATE_WAIT_MS = 5000;
export const SUPERVISOR_JOB_DRAIN_TIMEOUT_MS = 1000;
export const SUPERVISOR_JOB_DRAIN_POLL_MS = 10;
export const JOB_OBJECT_LIMIT_FLAGS = 0x2400;

export const DEFAULT_FONT_FAMILY =
  'PingFang SC, Microsoft YaHei, Inter, Segoe UI, sans-serif';

export const BUILTIN_THEMES: ThemeDefinition[] = [
  {
    theme_id: 'deep-ocean-tech',
    name: '深海算力（Deep Ocean Tech）',
    description: '深海蓝底色配荧光青与数字紫，适合算力、AI 与硬科技发布会演示',
    background: '090D18',
    surface: '11182B',
    primary: '38E8D4',
    secondary: '846BFF',
    accent: 'F59E0B',
    textPrimary: 'F1F5F9',
    textSecondary: '94A3B8',
    border: '22304A',
    fontFamily: DEFAULT_FONT_FAMILY,
  },
  {
    theme_id: 'clean-daylight',
    name: '极简白昼（Clean Daylight）',
    description: '纯白底色与科技蓝强调色，适合季度复盘、管理层汇报与产品评审',
    background: 'FFFFFF',
    surface: 'F7F8FA',
    primary: '2563EB',
    secondary: '0EA5E9',
    accent: '10B981',
    textPrimary: '111827',
    textSecondary: '6B7280',
    border: 'E5E7EB',
    fontFamily: DEFAULT_FONT_FAMILY,
  },
  {
    theme_id: 'midnight-slate',
    name: '暗夜石板（Midnight Slate）',
    description: '深灰蓝背景配天蓝与琥珀金，适合架构评审与技术路线汇报',
    background: '0F172A',
    surface: '1E293B',
    primary: '38BDF8',
    secondary: 'A78BFA',
    accent: 'FBBF24',
    textPrimary: 'F8FAFC',
    textSecondary: '94A3B8',
    border: '334155',
    fontFamily: DEFAULT_FONT_FAMILY,
  },
  {
    theme_id: 'warm-executive',
    name: '暖调高管（Warm Executive）',
    description: '象牙米白底色与深棕金调，适合战略规划、投资路演与年度报告',
    background: 'FAF8F5',
    surface: 'F1ECE4',
    primary: 'B45309',
    secondary: '1D4ED8',
    accent: '059669',
    textPrimary: '1C1917',
    textSecondary: '57534E',
    border: 'E7E0D5',
    fontFamily: DEFAULT_FONT_FAMILY,
  },
];

export const BUILTIN_ANIM_TYPES: Array<{
  anim_type: string;
  label: string;
  category: 'entrance' | 'emphasis' | 'exit' | 'motion';
  subtypes: string[];
}> = [
  { anim_type: 'fadeIn', label: '淡入', category: 'entrance', subtypes: ['allAtOnce', 'byParagraph'] },
  { anim_type: 'flyIn', label: '飞入', category: 'entrance', subtypes: ['fromBottom', 'fromLeft', 'fromRight'] },
  { anim_type: 'zoomIn', label: '缩放进入', category: 'entrance', subtypes: ['center', 'slideCenter'] },
  { anim_type: 'wipeIn', label: '擦除', category: 'entrance', subtypes: ['fromLeft', 'fromTop'] },
  { anim_type: 'pulse', label: '脉冲强调', category: 'emphasis', subtypes: ['soft', 'strong'] },
  { anim_type: 'growShrink', label: '放大/缩小', category: 'emphasis', subtypes: ['110%', '90%'] },
  { anim_type: 'fadeOut', label: '淡出', category: 'exit', subtypes: ['allAtOnce'] },
  { anim_type: 'flyOut', label: '飞出', category: 'exit', subtypes: ['toBottom', 'toRight'] },
];

export const PPT_QUICK_ACTIONS = [
  { id: 'summarize', label: '总结提炼', prompt: '请总结提炼当前幻灯片的核心观点与关键数据结论。' },
  { id: 'speech', label: '生成演讲稿', prompt: '请为当前幻灯片生成一段自然流畅、约 120 字的演讲者备注口播稿。' },
  { id: 'polish', label: '润色优化', prompt: '请润色当前选中区域的文案，使其更专业、精炼且有数据说服力。' },
  { id: 'structure', label: '优化结构', prompt: '请分析当前页面的信息层级与排版结构，并给出或直接执行优化建议。' },
] as const;

export function ptToPx(pt: number): number {
  return pt * PT_TO_PX_RATIO;
}

export function pxToPt(px: number): number {
  return px / PT_TO_PX_RATIO;
}

export function ptToEmu(pt: number): number {
  return Math.round(pt * EMU_PER_PT);
}

export function emuToPt(emu: number): number {
  return Math.round((emu / EMU_PER_PT) * 100) / 100;
}

/**
 * Normalize color strings to 6-digit uppercase RRGGBB without '#' or 'none'.
 * Supports '#RGB', 'RGB', '#RRGGBB', 'RRGGBB', 'none'.
 */
export function normalizeColor(input: string | undefined | null, fallback = '000000'): string {
  if (!input) return fallback;
  const trimmed = String(input).trim();
  if (trimmed.toLowerCase() === 'none' || trimmed.toLowerCase() === 'transparent') {
    return 'none';
  }
  const raw = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return raw.toUpperCase();
  }
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return raw
      .split('')
      .map((ch) => ch + ch)
      .join('')
      .toUpperCase();
  }
  if (/^[0-9a-fA-F]{8}$/.test(raw)) {
    return raw.slice(0, 6).toUpperCase();
  }
  throw new Error(`Invalid hex color "${input}": expected 6-digit RRGGBB or "none"`);
}

export function isValidHexColor(input: string): boolean {
  if (!input) return false;
  const trimmed = input.trim();
  if (trimmed.toLowerCase() === 'none') return true;
  const raw = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  return /^[0-9a-fA-F]{6}$/.test(raw) || /^[0-9a-fA-F]{3}$/.test(raw);
}

export function toCssColor(color: string | undefined, alpha = 0): string {
  if (!color || color.toLowerCase() === 'none') return 'transparent';
  const hex = normalizeColor(color);
  if (hex === 'none') return 'transparent';
  if (!alpha || alpha <= 0) return `#${hex}`;
  const clamped = Math.max(0, Math.min(100, alpha));
  const opacity = (100 - clamped) / 100;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity.toFixed(3)})`;
}
