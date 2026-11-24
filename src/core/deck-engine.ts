import {
  ASPECT_RATIO_16_9,
  ASPECT_RATIO_4_3,
  BUILTIN_ANIM_TYPES,
  BUILTIN_THEMES,
  DEFAULT_FONT_FAMILY,
  SLIDE_4_3_HEIGHT_PT,
  SLIDE_4_3_WIDTH_PT,
  SLIDE_CANVAS_HEIGHT_PT,
  SLIDE_CANVAS_WIDTH_PT,
  ZORDER_BRING_FORWARD_OP,
  ZORDER_BRING_TO_FRONT_OP,
  ZORDER_SEND_BACKWARD_OP,
  ZORDER_SEND_TO_BACK_OP,
  normalizeColor,
  pxToPt,
} from './constants';
import type {
  AiEditRecord,
  ChartProps,
  ChartSeries,
  ChartType,
  DashStyle,
  DeckEngineOptions,
  ImageProps,
  JsxNodeTag,
  JsxPageNode,
  LineType,
  ManualHistoryEntry,
  PresentationDeck,
  ShapeKind,
  SlideAnimation,
  SlideElement,
  SlidePage,
  SlideTransitionType,
  TableCell,
  TableProps,
  TextProps,
  ThemeDefinition,
} from './types';

export class DesignGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesignGateError';
  }
}

export function cloneDeck<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36).slice(-4);
  return `${prefix}_${ts}${rand}`;
}

function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function createBlankSlide(
  slideId?: string,
  title = '空白页',
  bgColor = 'FFFFFF'
): SlidePage {
  return {
    slide_id: slideId ?? generateId('slide'),
    title,
    background: { color: normalizeColor(bgColor, 'FFFFFF') },
    transition: { type: 'none', durationMs: 350 },
    notes: '',
    elements: [],
  };
}

export function createEmptyDeck(params?: {
  file_id?: string;
  file_name?: string;
  file_path?: string;
  aspect_ratio?: 1 | 2;
  theme_id?: string;
  title?: string;
  design_md?: string;
}): PresentationDeck {
  const aspect = params?.aspect_ratio ?? ASPECT_RATIO_16_9;
  const width_pt =
    aspect === ASPECT_RATIO_4_3 ? SLIDE_4_3_WIDTH_PT : SLIDE_CANVAS_WIDTH_PT;
  const height_pt =
    aspect === ASPECT_RATIO_4_3 ? SLIDE_4_3_HEIGHT_PT : SLIDE_CANVAS_HEIGHT_PT;
  const theme =
    BUILTIN_THEMES.find((t) => t.theme_id === params?.theme_id) ??
    BUILTIN_THEMES[1];
  const fileName = params?.file_name ?? '新建演示文稿.pptx';
  const fileId = params?.file_id ?? generateId('deck');
  const firstSlide = createBlankSlide('slide_1', params?.title ?? '标题页', theme.background);
  firstSlide.elements.push(
    {
      shape_id: 's1_title',
      type: 'text',
      name: '主标题',
      role: 'title',
      bounds: { x: 64, y: 170, w: width_pt - 128, h: 72 },
      zIndex: 0,
      text: {
        content: params?.title ?? '双击输入演示文稿标题',
        fontName: theme.fontFamily,
        fontSize: 36,
        fontColor: theme.textPrimary,
        bold: true,
        align: 'center',
        vAlign: 'middle',
      },
    },
    {
      shape_id: 's1_subtitle',
      type: 'text',
      name: '副标题',
      role: 'subtitle',
      bounds: { x: 120, y: 256, w: width_pt - 240, h: 40 },
      zIndex: 1,
      text: {
        content: '点击添加副标题或使用自由框选让 AI 协助完善',
        fontName: theme.fontFamily,
        fontSize: 16,
        fontColor: theme.textSecondary,
        align: 'center',
        vAlign: 'middle',
      },
    }
  );

  return {
    file_id: fileId,
    file_name: fileName,
    file_path: params?.file_path ?? `/workspace/${fileName}`,
    aspect_ratio: aspect,
    width_pt,
    height_pt,
    theme_id: theme.theme_id,
    design_md: params?.design_md,
    version: 1,
    updated_at: Date.now(),
    slides: [firstSlide],
    sections: [],
    comments: [],
    ai_edits: [],
  };
}

/**
 * Lightweight JSX-like XML/markup parser supporting <Slide>, <Box>, <Text>, <Chart>, <Table>, <SVG>, <Image>, <Line>.
 */
export function parseJsxMarkup(markup: string): JsxPageNode {
  const src = markup.trim();
  let pos = 0;

  function skipWs(): void {
    while (pos < src.length && /\s/.test(src[pos])) pos++;
  }

  function parseQuotedOrExpr(): unknown {
    skipWs();
    const ch = src[pos];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      pos++;
      let out = '';
      while (pos < src.length && src[pos] !== quote) {
        if (src[pos] === '\\' && pos + 1 < src.length) {
          pos++;
        }
        out += src[pos++];
      }
      if (src[pos] === quote) pos++;
      return out;
    }
    if (ch === '{') {
      pos++;
      let depth = 1;
      const start = pos;
      let inStr: string | null = null;
      while (pos < src.length && depth > 0) {
        const c = src[pos];
        if (inStr) {
          if (c === '\\') pos++;
          else if (c === inStr) inStr = null;
        } else {
          if (c === '"' || c === "'") inStr = c;
          else if (c === '{') depth++;
          else if (c === '}') depth--;
        }
        pos++;
      }
      const raw = src.slice(start, pos - 1).trim();
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      if (raw === 'null') return null;
      if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
      try {
        return JSON.parse(raw);
      } catch {
        // Attempt relaxing single-quoted or unquoted JS object keys
        try {
          const normalized = raw
            .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
            .replace(/'/g, '"');
          return JSON.parse(normalized);
        } catch {
          return raw;
        }
      }
    }
    return true;
  }

  function parseNode(): JsxPageNode {
    skipWs();
    if (src[pos] !== '<') {
      throw new Error(`Expected '<' at position ${pos} in JSX markup`);
    }
    pos++; // skip '<'
    let tagName = '';
    while (pos < src.length && /[A-Za-z0-9_]/.test(src[pos])) {
      tagName += src[pos++];
    }
    const props: Record<string, unknown> = {};
    while (pos < src.length) {
      skipWs();
      if (src.slice(pos, pos + 2) === '/>') {
        pos += 2;
        return { tag: tagName as JsxNodeTag, props, children: [] };
      }
      if (src[pos] === '>') {
        pos++;
        break;
      }
      let key = '';
      while (pos < src.length && /[A-Za-z0-9_-]/.test(src[pos])) {
        key += src[pos++];
      }
      if (!key) {
        pos++;
        continue;
      }
      skipWs();
      if (src[pos] === '=') {
        pos++;
        props[key] = parseQuotedOrExpr();
      } else {
        props[key] = true;
      }
    }

    const children: Array<JsxPageNode | string> = [];
    while (pos < src.length) {
      if (src.slice(pos, pos + 2) === '</') {
        pos += 2;
        while (pos < src.length && src[pos] !== '>') pos++;
        if (src[pos] === '>') pos++;
        break;
      }
      if (src[pos] === '<') {
        children.push(parseNode());
      } else {
        let txt = '';
        while (pos < src.length && src[pos] !== '<') {
          txt += src[pos++];
        }
        const trimmed = txt.trim();
        if (trimmed) children.push(trimmed);
      }
    }
    return { tag: tagName as JsxNodeTag, props, children };
  }

  return parseNode();
}

function readNum(
  props: Record<string, unknown> | undefined,
  keys: string[],
  fallback: number,
  convertPx = false
): number {
  if (!props) return fallback;
  for (const k of keys) {
    const val = props[k];
    if (typeof val === 'number' && Number.isFinite(val)) {
      return convertPx ? round2(pxToPt(val)) : round2(val);
    }
  }
  return fallback;
}

function readStr(
  props: Record<string, unknown> | undefined,
  keys: string[]
): string | undefined {
  if (!props) return undefined;
  for (const k of keys) {
    const val = props[k];
    if (typeof val === 'string') return val;
  }
  return undefined;
}

function readBool(
  props: Record<string, unknown> | undefined,
  keys: string[],
  fallback?: boolean
): boolean | undefined {
  if (!props) return fallback;
  for (const k of keys) {
    const val = props[k];
    if (typeof val === 'boolean') return val;
  }
  return fallback;
}

export function compileJsxPage(
  input: JsxPageNode | string,
  pageIndex: number,
  theme?: ThemeDefinition
): SlidePage {
  const root = typeof input === 'string' ? parseJsxMarkup(input) : input;
  const activeTheme = theme ?? BUILTIN_THEMES[0];
  const rootProps = root.props ?? {};
  const convertPx = readStr(rootProps, ['unit']) === 'px';
  const slideBg = normalizeColor(
    readStr(rootProps, ['background', 'bg', 'bgColor']) ?? activeTheme.background,
    activeTheme.background
  );
  const slideTitle =
    readStr(rootProps, ['title', 'name']) ?? `第 ${pageIndex + 1} 页`;
  const slideNotes = readStr(rootProps, ['notes']) ?? '';
  const slideId = readStr(rootProps, ['slide_id', 'id']) ?? `slide_${pageIndex + 1}_${Date.now().toString(36).slice(-3)}`;

  const elements: SlideElement[] = [];
  const usedIds = new Set<string>();
  let seq = 0;

  function allocShapeId(
    explicitId: string | undefined,
    role: string | undefined,
    tag: string
  ): string {
    if (explicitId && !usedIds.has(explicitId)) {
      usedIds.add(explicitId);
      return explicitId;
    }
    const base = `s${pageIndex + 1}_${(role ?? tag).toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
    let candidate = `${base}_${++seq}`;
    while (usedIds.has(candidate)) {
      candidate = `${base}_${++seq}`;
    }
    usedIds.add(candidate);
    return candidate;
  }

  function collectText(node: JsxPageNode): string {
    const p = node.props ?? {};
    const propText = readStr(p, ['content', 'text']);
    if (propText !== undefined) return propText;
    const parts: string[] = [];
    for (const c of node.children ?? []) {
      if (typeof c === 'string') parts.push(c);
      else if (c.tag === 'Text') parts.push(collectText(c));
    }
    return parts.join('\n');
  }

  function visit(node: JsxPageNode, offsetX: number, offsetY: number): void {
    const p = node.props ?? {};
    const usePx = convertPx || readStr(p, ['unit']) === 'px';
    const x = round2(offsetX + readNum(p, ['x', 'left'], 45, usePx));
    const y = round2(offsetY + readNum(p, ['y', 'top'], 45, usePx));
    const w = round2(readNum(p, ['w', 'width'], 240, usePx));
    const h = round2(readNum(p, ['h', 'height'], 80, usePx));
    const role = readStr(p, ['role']);
    const explicitId = readStr(p, ['shape_id', 'id']);
    const name = readStr(p, ['name']);

    if (node.tag === 'Slide') {
      for (const child of node.children ?? []) {
        if (typeof child !== 'string') visit(child, 0, 0);
      }
      return;
    }

    if (node.tag === 'Box') {
      const fillRaw = readStr(p, ['fill', 'fillColor', 'bg', 'background']);
      const borderRaw = readStr(p, ['border', 'borderColor', 'stroke']);
      const shapeType = (readStr(p, ['shapeType', 'shape']) ?? 'roundRect') as ShapeKind;
      const cornerRadius = readNum(p, ['cornerRadius', 'radius'], 8, usePx);
      const fillAlpha = readNum(p, ['fillAlpha', 'alpha'], 0);
      const borderWidth = readNum(p, ['borderWidth', 'strokeWidth'], 1);
      const boxText = readStr(p, ['text', 'content']);

      const el: SlideElement = {
        shape_id: allocShapeId(explicitId, role ?? 'box', 'box'),
        type: 'shape',
        name,
        role,
        bounds: { x, y, w, h },
        zIndex: elements.length,
        shapeType,
        cornerRadius,
        fill: fillRaw
          ? { color: normalizeColor(fillRaw), alpha: fillAlpha }
          : { color: activeTheme.surface, alpha: 0 },
        border: borderRaw
          ? { color: normalizeColor(borderRaw), width: borderWidth }
          : { color: activeTheme.border, width: 1 },
      };

      if (boxText) {
        el.text = {
          content: boxText,
          fontName: readStr(p, ['fontName']) ?? activeTheme.fontFamily,
          fontSize: readNum(p, ['fontSize'], 13, usePx),
          fontColor: normalizeColor(
            readStr(p, ['fontColor', 'color']) ?? activeTheme.textPrimary
          ),
          bold: readBool(p, ['bold'], false),
          align: (readStr(p, ['align']) as TextProps['align']) ?? 'left',
          vAlign: (readStr(p, ['vAlign']) as TextProps['vAlign']) ?? 'middle',
        };
      }
      elements.push(el);

      // Recurse into children using absolute or relative positioning
      for (const child of node.children ?? []) {
        if (typeof child === 'string') {
          if (!el.text) {
            el.text = {
              content: child,
              fontName: activeTheme.fontFamily,
              fontSize: readNum(p, ['fontSize'], 13, usePx),
              fontColor: normalizeColor(
                readStr(p, ['fontColor', 'color']) ?? activeTheme.textPrimary
              ),
              bold: readBool(p, ['bold'], false),
              align: (readStr(p, ['align']) as TextProps['align']) ?? 'left',
              vAlign: (readStr(p, ['vAlign']) as TextProps['vAlign']) ?? 'middle',
            };
          }
        } else {
          const childRelative = readBool(child.props, ['relative'], false);
          visit(child, childRelative ? x : 0, childRelative ? y : 0);
        }
      }
      return;
    }

    if (node.tag === 'Text') {
      const content = collectText(node);
      const fontColor = normalizeColor(
        readStr(p, ['fontColor', 'color']) ?? activeTheme.textPrimary
      );
      elements.push({
        shape_id: allocShapeId(explicitId, role ?? 'text', 'text'),
        type: 'text',
        name,
        role,
        bounds: { x, y, w, h },
        zIndex: elements.length,
        text: {
          content,
          fontName: readStr(p, ['fontName']) ?? activeTheme.fontFamily,
          fontSize: readNum(p, ['fontSize'], 14, usePx),
          fontColor,
          bold: readBool(p, ['bold'], false),
          italic: readBool(p, ['italic'], false),
          underline: readBool(p, ['underline'], false),
          align: (readStr(p, ['align']) as TextProps['align']) ?? 'left',
          vAlign: (readStr(p, ['vAlign']) as TextProps['vAlign']) ?? 'top',
          lineHeight: readNum(p, ['lineHeight'], 1.35),
        },
      });
      return;
    }

    if (node.tag === 'Chart') {
      const categories = Array.isArray(p.categories)
        ? (p.categories as unknown[]).map(String)
        : ['Q1', 'Q2', 'Q3', 'Q4'];
      const seriesRaw = Array.isArray(p.series) ? p.series : [];
      const series: ChartSeries[] = seriesRaw.map((s, idx) => {
        const obj = s as Record<string, unknown>;
        const palette = [
          activeTheme.primary,
          activeTheme.secondary,
          activeTheme.accent,
        ];
        return {
          name: String(obj.name ?? `系列 ${idx + 1}`),
          values: Array.isArray(obj.values)
            ? obj.values.map((v) => Number(v) || 0)
            : [],
          color: normalizeColor(
            typeof obj.color === 'string'
              ? obj.color
              : palette[idx % palette.length]
          ),
        };
      });
      elements.push({
        shape_id: allocShapeId(explicitId, role ?? 'chart', 'chart'),
        type: 'chart',
        name: name ?? readStr(p, ['title']) ?? '图表',
        role: role ?? 'chart',
        bounds: { x, y, w, h },
        zIndex: elements.length,
        chart: {
          chartType: (readStr(p, ['chartType', 'type']) as ChartType) ?? 'bar',
          title: readStr(p, ['title']),
          categories,
          series,
          showLegend: readBool(p, ['showLegend'], true),
          showGridlines: readBool(p, ['showGridlines'], true),
          showDataLabels: readBool(p, ['showDataLabels'], false),
          yAxisMax: typeof p.yAxisMax === 'number' ? p.yAxisMax : undefined,
          yAxisStep: typeof p.yAxisStep === 'number' ? p.yAxisStep : undefined,
          unit: readStr(p, ['unitLabel', 'unit']),
        },
      });
      return;
    }

    if (node.tag === 'Table') {
      const rowsData = Array.isArray(p.data)
        ? (p.data as unknown[][])
        : [['指标', '数值'], ['示例', '100%']];
      const rows = rowsData.length;
      const cols = rows > 0 ? Math.max(...rowsData.map((r) => r.length)) : 1;
      const cells: TableCell[][] = rowsData.map((row, rIdx) =>
        Array.from({ length: cols }, (_, cIdx) => ({
          text: String(row[cIdx] ?? ''),
          bold: rIdx === 0,
          fontSize: rIdx === 0 ? 12 : 11,
          fontColor: rIdx === 0 ? activeTheme.textPrimary : activeTheme.textSecondary,
          bgColor: rIdx === 0 ? activeTheme.surface : undefined,
          align: cIdx === 0 ? 'left' : 'center',
          vAlign: 'middle',
        }))
      );
      elements.push({
        shape_id: allocShapeId(explicitId, role ?? 'table', 'table'),
        type: 'table',
        name: name ?? '表格',
        role: role ?? 'table',
        bounds: { x, y, w, h },
        zIndex: elements.length,
        table: {
          rows,
          cols,
          cells,
          headerBg: normalizeColor(readStr(p, ['headerBg']) ?? activeTheme.surface),
          borderColor: normalizeColor(
            readStr(p, ['borderColor']) ?? activeTheme.border
          ),
        },
      });
      return;
    }

    if (node.tag === 'SVG') {
      elements.push({
        shape_id: allocShapeId(explicitId, role ?? 'svg', 'svg'),
        type: 'svg',
        name: name ?? '矢量图形',
        role,
        bounds: { x, y, w, h },
        zIndex: elements.length,
        svg: {
          viewBox: readStr(p, ['viewBox']) ?? `0 0 ${w} ${h}`,
          markup: readStr(p, ['markup']) ?? '',
        },
      });
      return;
    }

    if (node.tag === 'Image') {
      elements.push({
        shape_id: allocShapeId(explicitId, role ?? 'image', 'image'),
        type: 'image',
        name: name ?? '图片',
        role,
        bounds: { x, y, w, h },
        zIndex: elements.length,
        image: {
          src: readStr(p, ['src']) ?? '',
          alt: readStr(p, ['alt']) ?? name,
          objectFit: (readStr(p, ['objectFit']) as ImageProps['objectFit']) ?? 'contain',
        },
      });
      return;
    }

    if (node.tag === 'Line') {
      const x1 = readNum(p, ['x1'], x, usePx);
      const y1 = readNum(p, ['y1'], y, usePx);
      const x2 = readNum(p, ['x2'], x + w, usePx);
      const y2 = readNum(p, ['y2'], y, usePx);
      const minX = Math.min(x1, x2);
      const minY = Math.min(y1, y2);
      elements.push({
        shape_id: allocShapeId(explicitId, role ?? 'line', 'line'),
        type: 'line',
        name,
        role: role ?? 'decoration',
        bounds: {
          x: minX,
          y: minY,
          w: Math.max(1, Math.abs(x2 - x1)),
          h: Math.max(1, Math.abs(y2 - y1)),
        },
        zIndex: elements.length,
        line: {
          x1,
          y1,
          x2,
          y2,
          lineType: (readStr(p, ['lineType']) as LineType) ?? 'line',
          color: normalizeColor(readStr(p, ['color']) ?? activeTheme.primary),
          width: readNum(p, ['width', 'strokeWidth'], 1.5),
          dash: (readStr(p, ['dash']) as DashStyle) ?? 'solid',
        },
      });
    }
  }

  visit(root, 0, 0);

  return {
    slide_id: slideId,
    title: slideTitle,
    background: { color: slideBg },
    transition: { type: 'none', durationMs: 350 },
    notes: slideNotes,
    elements,
  };
}

interface ManualHistorySnapshot extends ManualHistoryEntry {
  snapshot: string;
}

export class DeckEngine {
  private deck: PresentationDeck;
  private options: Required<DeckEngineOptions>;
  private undoStack: ManualHistorySnapshot[] = [];
  private redoStack: ManualHistorySnapshot[] = [];
  private transactionDepth = 0;
  private transactionCaptured = false;

  constructor(initialDeck?: PresentationDeck, options?: DeckEngineOptions) {
    this.deck = initialDeck ? cloneDeck(initialDeck) : createEmptyDeck();
    this.options = {
      requireDesignMd: options?.requireDesignMd ?? false,
      maxHistory: options?.maxHistory ?? 100,
    };
    this.reindexAllElements();
  }

  private reindexSlide(slide: SlidePage): void {
    slide.elements.forEach((el, idx) => {
      el.zIndex = idx;
    });
  }

  private reindexAllElements(): void {
    for (const slide of this.deck.slides) {
      this.reindexSlide(slide);
    }
  }

  private deckContentSignature(deck: PresentationDeck): string {
    return JSON.stringify({
      file_name: deck.file_name,
      file_path: deck.file_path,
      aspect_ratio: deck.aspect_ratio,
      width_pt: deck.width_pt,
      height_pt: deck.height_pt,
      theme_id: deck.theme_id,
      design_md: deck.design_md,
      slides: deck.slides,
      sections: deck.sections,
      comments: deck.comments,
    });
  }

  private pushUndoSnapshot(label = '修改幻灯片', pageIndex?: number): void {
    if (this.transactionDepth > 0) {
      if (this.transactionCaptured) return;
      this.transactionCaptured = true;
    }
    this.undoStack.push({
      id: generateId('hist'),
      label,
      page_index: pageIndex,
      timestamp: Date.now(),
      snapshot: JSON.stringify(this.deck),
    });
    if (this.undoStack.length > this.options.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /**
   * Groups multiple DeckEngine mutations into a single atomic manual undo entry
   * with a human-readable label and page_index. No-op mutations do not push an entry.
   */
  runTransaction<T>(
    label: string,
    fn: () => T,
    meta?: { page_index?: number }
  ): T {
    const isOuter = this.transactionDepth === 0;
    const beforeSig = isOuter ? this.deckContentSignature(this.deck) : '';
    const beforeSnapshot = isOuter ? JSON.stringify(this.deck) : '';
    const prevRedoStack = isOuter ? this.redoStack : null;

    this.transactionDepth += 1;
    if (isOuter) {
      this.transactionCaptured = true;
    }
    try {
      const result = fn();
      if (isOuter) {
        const afterSig = this.deckContentSignature(this.deck);
        if (afterSig !== beforeSig) {
          this.undoStack.push({
            id: generateId('hist'),
            label,
            page_index: meta?.page_index,
            timestamp: Date.now(),
            snapshot: beforeSnapshot,
          });
          if (this.undoStack.length > this.options.maxHistory) {
            this.undoStack.shift();
          }
          this.redoStack = [];
        } else if (prevRedoStack) {
          this.redoStack = prevRedoStack;
        }
      }
      return result;
    } catch (err) {
      if (isOuter) {
        this.deck = JSON.parse(beforeSnapshot) as PresentationDeck;
        this.reindexAllElements();
        if (prevRedoStack) this.redoStack = prevRedoStack;
      }
      throw err;
    } finally {
      this.transactionDepth -= 1;
      if (this.transactionDepth === 0) {
        this.transactionCaptured = false;
      }
    }
  }

  private bumpVersion(): void {
    this.deck.version += 1;
    this.deck.updated_at = Date.now();
  }

  private assertPageIndex(pageIndex: number): SlidePage {
    if (
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex >= this.deck.slides.length
    ) {
      throw new RangeError(
        `page_index ${pageIndex} out of bounds (0..${this.deck.slides.length - 1})`
      );
    }
    return this.deck.slides[pageIndex];
  }

  private assertShapeIndex(slide: SlidePage, shapeIndex: number): SlideElement {
    if (
      !Number.isInteger(shapeIndex) ||
      shapeIndex < 0 ||
      shapeIndex >= slide.elements.length
    ) {
      throw new RangeError(
        `shape_index ${shapeIndex} out of bounds (0..${slide.elements.length - 1})`
      );
    }
    return slide.elements[shapeIndex];
  }

  private assertDesignGate(bypass?: boolean): void {
    if (this.options.requireDesignMd && !bypass) {
      if (!this.deck.design_md || !this.deck.design_md.trim()) {
        throw new DesignGateError(
          'DESIGN.md contract is required before generating slides. Call slide_set_design first or pass bypassDesignGate.'
        );
      }
    }
  }

  getDeck(): PresentationDeck {
    return cloneDeck(this.deck);
  }

  getDeckRef(): PresentationDeck {
    return this.deck;
  }

  loadDeck(deck: PresentationDeck, options?: { resetHistory?: boolean }): void {
    if (options?.resetHistory) {
      this.resetToBaseline(deck);
      return;
    }
    this.pushUndoSnapshot();
    this.deck = cloneDeck(deck);
    this.reindexAllElements();
  }

  /**
   * Replaces the deck and establishes it as a fresh Manual Undo Baseline,
   * clearing manual undo/redo stacks without touching AI edit history.
   */
  resetToBaseline(deck: PresentationDeck): void {
    this.deck = cloneDeck(deck);
    this.undoStack = [];
    this.redoStack = [];
    this.reindexAllElements();
  }

  setRequireDesignMd(require: boolean): void {
    this.options.requireDesignMd = require;
  }

  getRequireDesignMd(): boolean {
    return this.options.requireDesignMd;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getManualHistory(): {
    undo: ManualHistoryEntry[];
    redo: ManualHistoryEntry[];
  } {
    return {
      undo: [...this.undoStack].reverse().map(({ id, label, page_index, timestamp }) => ({
        id,
        label,
        page_index,
        timestamp,
      })),
      redo: [...this.redoStack].reverse().map(({ id, label, page_index, timestamp }) => ({
        id,
        label,
        page_index,
        timestamp,
      })),
    };
  }

  renameDeck(newName: string, newPath?: string): PresentationDeck {
    const trimmed = newName.trim();
    if (!trimmed) return this.getDeck();
    const targetPath = newPath !== undefined ? newPath : this.deck.file_path;
    if (trimmed === this.deck.file_name && targetPath === this.deck.file_path) {
      return this.getDeck();
    }
    this.pushUndoSnapshot('重命名文档');
    this.deck.file_name = trimmed;
    this.deck.file_path = targetPath;
    this.bumpVersion();
    return this.getDeck();
  }

  undoWithMeta(): {
    deck: PresentationDeck;
    entry: ManualHistoryEntry | null;
  } {
    const prev = this.undoStack.pop();
    if (!prev) return { deck: this.getDeck(), entry: null };
    this.redoStack.push({
      id: prev.id,
      label: prev.label,
      page_index: prev.page_index,
      timestamp: prev.timestamp,
      snapshot: JSON.stringify(this.deck),
    });
    this.deck = JSON.parse(prev.snapshot) as PresentationDeck;
    this.reindexAllElements();
    return {
      deck: this.getDeck(),
      entry: {
        id: prev.id,
        label: prev.label,
        page_index: prev.page_index,
        timestamp: prev.timestamp,
      },
    };
  }

  redoWithMeta(): {
    deck: PresentationDeck;
    entry: ManualHistoryEntry | null;
  } {
    const next = this.redoStack.pop();
    if (!next) return { deck: this.getDeck(), entry: null };
    this.undoStack.push({
      id: next.id,
      label: next.label,
      page_index: next.page_index,
      timestamp: next.timestamp,
      snapshot: JSON.stringify(this.deck),
    });
    this.deck = JSON.parse(next.snapshot) as PresentationDeck;
    this.reindexAllElements();
    return {
      deck: this.getDeck(),
      entry: {
        id: next.id,
        label: next.label,
        page_index: next.page_index,
        timestamp: next.timestamp,
      },
    };
  }

  undoSteps(steps: number): {
    deck: PresentationDeck;
    count: number;
    lastEntry: ManualHistoryEntry | null;
  } {
    const n = Math.max(0, Math.min(Math.floor(steps), this.undoStack.length));
    let lastEntry: ManualHistoryEntry | null = null;
    for (let i = 0; i < n; i++) {
      lastEntry = this.undoWithMeta().entry;
    }
    return { deck: this.getDeck(), count: n, lastEntry };
  }

  redoSteps(steps: number): {
    deck: PresentationDeck;
    count: number;
    lastEntry: ManualHistoryEntry | null;
  } {
    const n = Math.max(0, Math.min(Math.floor(steps), this.redoStack.length));
    let lastEntry: ManualHistoryEntry | null = null;
    for (let i = 0; i < n; i++) {
      lastEntry = this.redoWithMeta().entry;
    }
    return { deck: this.getDeck(), count: n, lastEntry };
  }

  undo(): PresentationDeck {
    return this.undoWithMeta().deck;
  }

  redo(): PresentationDeck {
    return this.redoWithMeta().deck;
  }

  setDesign(designMd: string): PresentationDeck {
    this.pushUndoSnapshot();
    this.deck.design_md = designMd;
    this.bumpVersion();
    return this.getDeck();
  }

  getInfo(): {
    file_id: string;
    file_name: string;
    file_path: string;
    aspect_ratio: 1 | 2;
    width_pt: number;
    height_pt: number;
    theme_id: string;
    has_design_md: boolean;
    version: number;
    slide_count: number;
    slides: Array<{
      page_index: number;
      slide_id: string;
      title: string;
      element_count: number;
    }>;
  } {
    return {
      file_id: this.deck.file_id,
      file_name: this.deck.file_name,
      file_path: this.deck.file_path,
      aspect_ratio: this.deck.aspect_ratio,
      width_pt: this.deck.width_pt,
      height_pt: this.deck.height_pt,
      theme_id: this.deck.theme_id,
      has_design_md: Boolean(this.deck.design_md && this.deck.design_md.trim()),
      version: this.deck.version,
      slide_count: this.deck.slides.length,
      slides: this.deck.slides.map((s, idx) => ({
        page_index: idx,
        slide_id: s.slide_id,
        title: s.title,
        element_count: s.elements.length,
      })),
    };
  }

  getPageInfo(pageIndex: number): {
    page_index: number;
    slide_id: string;
    title: string;
    background: SlidePage['background'];
    transition?: SlidePage['transition'];
    notes: string;
    elements: Array<SlideElement & { shape_index: number }>;
  } {
    const slide = this.assertPageIndex(pageIndex);
    return {
      page_index: pageIndex,
      slide_id: slide.slide_id,
      title: slide.title,
      background: cloneDeck(slide.background),
      transition: slide.transition ? cloneDeck(slide.transition) : undefined,
      notes: slide.notes,
      elements: slide.elements.map((el, idx) => ({
        ...cloneDeck(el),
        shape_index: idx,
      })),
    };
  }

  addSlide(params?: {
    insert_index?: number;
    title?: string;
    background_color?: string;
    notes?: string;
    bypassDesignGate?: boolean;
  }): { page_index: number; slide: SlidePage } {
    this.assertDesignGate(params?.bypassDesignGate);
    this.pushUndoSnapshot();
    const theme =
      BUILTIN_THEMES.find((t) => t.theme_id === this.deck.theme_id) ??
      BUILTIN_THEMES[0];
    const insertAt =
      params?.insert_index !== undefined
        ? clamp(params.insert_index, 0, this.deck.slides.length)
        : this.deck.slides.length;
    const slide = createBlankSlide(
      undefined,
      params?.title ?? `第 ${insertAt + 1} 页`,
      params?.background_color ?? theme.background
    );
    if (params?.notes) slide.notes = params.notes;
    this.deck.slides.splice(insertAt, 0, slide);
    this.bumpVersion();
    return { page_index: insertAt, slide: cloneDeck(slide) };
  }

  addPageWithJsx(params: {
    jsx: JsxPageNode | string;
    insert_index?: number;
    bypassDesignGate?: boolean;
  }): { page_index: number; slide: SlidePage } {
    this.assertDesignGate(params.bypassDesignGate);
    this.pushUndoSnapshot();
    const theme =
      BUILTIN_THEMES.find((t) => t.theme_id === this.deck.theme_id) ??
      BUILTIN_THEMES[0];
    const insertAt =
      params.insert_index !== undefined
        ? clamp(params.insert_index, 0, this.deck.slides.length)
        : this.deck.slides.length;
    const compiled = compileJsxPage(params.jsx, insertAt, theme);
    this.reindexSlide(compiled);
    this.deck.slides.splice(insertAt, 0, compiled);
    this.bumpVersion();
    return { page_index: insertAt, slide: cloneDeck(compiled) };
  }

  duplicateSlide(pageIndex: number): { page_index: number; slide: SlidePage } {
    const src = this.assertPageIndex(pageIndex);
    this.pushUndoSnapshot();
    const copy = cloneDeck(src);
    copy.slide_id = generateId('slide');
    copy.title = `${src.title} (副本)`;
    copy.elements = copy.elements.map((el, idx) => ({
      ...el,
      shape_id: `${el.shape_id}_copy_${idx}_${Date.now().toString(36).slice(-3)}`,
    }));
    const insertAt = pageIndex + 1;
    this.deck.slides.splice(insertAt, 0, copy);
    this.reindexSlide(copy);
    this.bumpVersion();
    return { page_index: insertAt, slide: cloneDeck(copy) };
  }

  removeSlide(pageIndex: number): { removed_slide_id: string; slide_count: number } {
    if (this.deck.slides.length <= 1) {
      throw new Error('Cannot remove the last remaining slide');
    }
    const target = this.assertPageIndex(pageIndex);
    this.pushUndoSnapshot();
    this.deck.slides.splice(pageIndex, 1);
    this.bumpVersion();
    return {
      removed_slide_id: target.slide_id,
      slide_count: this.deck.slides.length,
    };
  }

  moveSlide(fromIndex: number, toIndex: number): PresentationDeck {
    this.assertPageIndex(fromIndex);
    const dest = clamp(toIndex, 0, this.deck.slides.length - 1);
    if (fromIndex === dest) return this.getDeck();
    this.pushUndoSnapshot();
    const [moved] = this.deck.slides.splice(fromIndex, 1);
    this.deck.slides.splice(dest, 0, moved);
    this.bumpVersion();
    return this.getDeck();
  }

  setPageProperties(
    pageIndex: number,
    props: {
      title?: string;
      background_color?: string;
      background_gradient?: string;
      transition_type?: SlideTransitionType;
      transition_duration_ms?: number;
    }
  ): SlidePage {
    const slide = this.assertPageIndex(pageIndex);
    this.pushUndoSnapshot();
    if (props.title !== undefined) slide.title = props.title;
    if (props.background_color !== undefined) {
      slide.background.color = normalizeColor(props.background_color);
    }
    if (props.background_gradient !== undefined) {
      slide.background.gradient = props.background_gradient;
    }
    if (props.transition_type !== undefined) {
      slide.transition = {
        type: props.transition_type,
        durationMs:
          props.transition_duration_ms ?? slide.transition?.durationMs ?? 350,
      };
    } else if (props.transition_duration_ms !== undefined && slide.transition) {
      slide.transition.durationMs = props.transition_duration_ms;
    }
    this.bumpVersion();
    return cloneDeck(slide);
  }

  setSlideSize(aspectRatio: 1 | 2): PresentationDeck {
    this.pushUndoSnapshot();
    this.deck.aspect_ratio = aspectRatio;
    this.deck.width_pt =
      aspectRatio === ASPECT_RATIO_4_3
        ? SLIDE_4_3_WIDTH_PT
        : SLIDE_CANVAS_WIDTH_PT;
    this.deck.height_pt =
      aspectRatio === ASPECT_RATIO_4_3
        ? SLIDE_4_3_HEIGHT_PT
        : SLIDE_CANVAS_HEIGHT_PT;
    this.bumpVersion();
    return this.getDeck();
  }

  getShapeInfo(
    pageIndex: number,
    shapeIndex?: number,
    shapeId?: string
  ): SlideElement & { shape_index: number } {
    const slide = this.assertPageIndex(pageIndex);
    let idx = shapeIndex;
    if (idx === undefined && shapeId) {
      idx = slide.elements.findIndex((e) => e.shape_id === shapeId);
    }
    if (idx === undefined || idx < 0) {
      throw new Error(`Shape not found on page ${pageIndex}`);
    }
    const el = this.assertShapeIndex(slide, idx);
    return { ...cloneDeck(el), shape_index: idx };
  }

  private nextShapeId(slide: SlidePage, pageIndex: number, prefix: string): string {
    const existing = new Set(slide.elements.map((e) => e.shape_id));
    let i = slide.elements.length + 1;
    let candidate = `s${pageIndex + 1}_${prefix}_${i}`;
    while (existing.has(candidate)) {
      i++;
      candidate = `s${pageIndex + 1}_${prefix}_${i}`;
    }
    return candidate;
  }

  addShape(
    pageIndex: number,
    spec: {
      shape_id?: string;
      name?: string;
      role?: string;
      shape_type?: ShapeKind;
      x: number;
      y: number;
      w: number;
      h: number;
      fill_color?: string;
      fill_alpha?: number;
      border_color?: string;
      border_width?: number;
      border_dash?: DashStyle;
      corner_radius?: number;
      rotation?: number;
      text?: string;
      font_size?: number;
      font_color?: string;
      bold?: boolean;
      align?: 'left' | 'center' | 'right';
    }
  ): { shape_index: number; element: SlideElement } {
    const slide = this.assertPageIndex(pageIndex);
    const fillColor = spec.fill_color
      ? normalizeColor(spec.fill_color)
      : undefined;
    const borderColor = spec.border_color
      ? normalizeColor(spec.border_color)
      : undefined;

    const hasFill = fillColor !== undefined && fillColor !== 'none';
    const hasBorder = borderColor !== undefined && borderColor !== 'none';
    if (!hasFill && !hasBorder) {
      throw new Error(
        'slide_add_shape requires at least one of fill_color or border_color (cannot both be omitted or "none")'
      );
    }

    this.pushUndoSnapshot();
    const shapeId =
      spec.shape_id ?? this.nextShapeId(slide, pageIndex, spec.role ?? 'shape');
    const el: SlideElement = {
      shape_id: shapeId,
      type: 'shape',
      name: spec.name,
      role: spec.role,
      bounds: {
        x: round2(spec.x),
        y: round2(spec.y),
        w: Math.max(1, round2(spec.w)),
        h: Math.max(1, round2(spec.h)),
      },
      rotation: spec.rotation,
      zIndex: slide.elements.length,
      shapeType: spec.shape_type ?? 'rect',
      cornerRadius: spec.corner_radius,
      fill: fillColor ? { color: fillColor, alpha: spec.fill_alpha ?? 0 } : undefined,
      border: borderColor
        ? {
            color: borderColor,
            width: spec.border_width ?? 1,
            dash: spec.border_dash ?? 'solid',
          }
        : undefined,
    };

    if (spec.text !== undefined) {
      el.text = {
        content: spec.text,
        fontName: DEFAULT_FONT_FAMILY,
        fontSize: spec.font_size ?? 13,
        fontColor: normalizeColor(spec.font_color, 'F1F5F9'),
        bold: spec.bold ?? false,
        align: spec.align ?? 'center',
        vAlign: 'middle',
      };
    }

    slide.elements.push(el);
    this.reindexSlide(slide);
    this.bumpVersion();
    return {
      shape_index: slide.elements.length - 1,
      element: cloneDeck(el),
    };
  }

  addShapes(
    pageIndex: number,
    specs: Array<Parameters<DeckEngine['addShape']>[1]>
  ): Array<{ shape_index: number; element: SlideElement }> {
    this.assertPageIndex(pageIndex);
    if (!specs.length) return [];
    const results: Array<{ shape_index: number; element: SlideElement }> = [];
    for (const s of specs) {
      results.push(this.addShape(pageIndex, s));
    }
    return results;
  }

  addLineShape(
    pageIndex: number,
    spec: {
      shape_id?: string;
      name?: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      line_type?: LineType;
      color?: string;
      width?: number;
      dash?: DashStyle;
    }
  ): { shape_index: number; element: SlideElement } {
    const slide = this.assertPageIndex(pageIndex);
    this.pushUndoSnapshot();
    const minX = Math.min(spec.x1, spec.x2);
    const minY = Math.min(spec.y1, spec.y2);
    const el: SlideElement = {
      shape_id: spec.shape_id ?? this.nextShapeId(slide, pageIndex, 'line'),
      type: 'line',
      name: spec.name ?? '连接线',
      role: 'decoration',
      bounds: {
        x: round2(minX),
        y: round2(minY),
        w: Math.max(1, round2(Math.abs(spec.x2 - spec.x1))),
        h: Math.max(1, round2(Math.abs(spec.y2 - spec.y1))),
      },
      zIndex: slide.elements.length,
      line: {
        x1: round2(spec.x1),
        y1: round2(spec.y1),
        x2: round2(spec.x2),
        y2: round2(spec.y2),
        lineType: spec.line_type ?? 'line',
        color: normalizeColor(spec.color, '38E8D4'),
        width: spec.width ?? 1.5,
        dash: spec.dash ?? 'solid',
      },
    };
    slide.elements.push(el);
    this.reindexSlide(slide);
    this.bumpVersion();
    return {
      shape_index: slide.elements.length - 1,
      element: cloneDeck(el),
    };
  }

  setShapeProperties(
    pageIndex: number,
    params: {
      // Mode A: single shape
      shape_index?: number;
      shape_id?: string;
      // Mode B / C: batch
      shape_indices?: number[];
      shape_ids?: string[];
      updates?: Array<Record<string, unknown>>;
      // Single or shared properties (Mode A & Mode C)
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      rotation?: number;
      fill_color?: string;
      fill_alpha?: number;
      border_color?: string;
      border_width?: number;
      border_dash?: DashStyle;
      corner_radius?: number;
      name?: string;
    }
  ): { updated_indices: number[]; elements: SlideElement[] } {
    const slide = this.assertPageIndex(pageIndex);

    const resolveIndices = (): number[] => {
      if (params.shape_indices && params.shape_indices.length > 0) {
        return params.shape_indices;
      }
      if (params.shape_ids && params.shape_ids.length > 0) {
        return params.shape_ids.map((id) => {
          const idx = slide.elements.findIndex((e) => e.shape_id === id);
          if (idx < 0) throw new Error(`shape_id "${id}" not found on page ${pageIndex}`);
          return idx;
        });
      }
      if (params.shape_index !== undefined) return [params.shape_index];
      if (params.shape_id) {
        const idx = slide.elements.findIndex((e) => e.shape_id === params.shape_id);
        if (idx < 0) {
          throw new Error(`shape_id "${params.shape_id}" not found on page ${pageIndex}`);
        }
        return [idx];
      }
      throw new Error('Must provide shape_index, shape_id, shape_indices, or shape_ids');
    };

    const indices = resolveIndices();
    for (const idx of indices) this.assertShapeIndex(slide, idx);

    this.pushUndoSnapshot();

    const applyPatch = (el: SlideElement, patch: Record<string, unknown>): void => {
      if (typeof patch.x === 'number') el.bounds.x = round2(patch.x);
      if (typeof patch.y === 'number') el.bounds.y = round2(patch.y);
      if (typeof patch.w === 'number') el.bounds.w = Math.max(1, round2(patch.w));
      if (typeof patch.h === 'number') el.bounds.h = Math.max(1, round2(patch.h));
      if (typeof patch.rotation === 'number') el.rotation = patch.rotation;
      if (typeof patch.corner_radius === 'number') el.cornerRadius = patch.corner_radius;
      if (typeof patch.name === 'string') el.name = patch.name;

      if (typeof patch.fill_color === 'string') {
        const c = normalizeColor(patch.fill_color);
        if (c === 'none') {
          el.fill = undefined;
        } else {
          el.fill = {
            color: c,
            alpha:
              typeof patch.fill_alpha === 'number'
                ? patch.fill_alpha
                : el.fill?.alpha ?? 0,
          };
        }
      } else if (typeof patch.fill_alpha === 'number' && el.fill) {
        el.fill.alpha = patch.fill_alpha;
      }

      if (typeof patch.border_color === 'string') {
        const bc = normalizeColor(patch.border_color);
        if (bc === 'none') {
          el.border = undefined;
        } else {
          el.border = {
            color: bc,
            width:
              typeof patch.border_width === 'number'
                ? patch.border_width
                : el.border?.width ?? 1,
            dash:
              (patch.border_dash as DashStyle | undefined) ??
              el.border?.dash ??
              'solid',
          };
        }
      } else {
        if (typeof patch.border_width === 'number' && el.border) {
          el.border.width = patch.border_width;
        }
        if (typeof patch.border_dash === 'string' && el.border) {
          el.border.dash = patch.border_dash as DashStyle;
        }
      }

      // If it's a line and color/width provided
      if (el.type === 'line' && el.line) {
        if (typeof patch.fill_color === 'string' && patch.fill_color !== 'none') {
          el.line.color = normalizeColor(patch.fill_color);
        }
        if (typeof patch.border_color === 'string' && patch.border_color !== 'none') {
          el.line.color = normalizeColor(patch.border_color);
        }
        if (typeof patch.border_width === 'number') {
          el.line.width = patch.border_width;
        }
      }
    };

    if (params.updates && params.updates.length > 0) {
      // Mode B: 1-to-1 batch
      if (params.updates.length !== indices.length) {
        throw new Error(
          `Batch updates length (${params.updates.length}) must match target shape count (${indices.length})`
        );
      }
      indices.forEach((idx, i) => {
        applyPatch(slide.elements[idx], params.updates![i]);
      });
    } else {
      // Mode A or Mode C: apply shared patch to all target shapes
      const sharedPatch: Record<string, unknown> = {
        x: params.x,
        y: params.y,
        w: params.w,
        h: params.h,
        rotation: params.rotation,
        fill_color: params.fill_color,
        fill_alpha: params.fill_alpha,
        border_color: params.border_color,
        border_width: params.border_width,
        border_dash: params.border_dash,
        corner_radius: params.corner_radius,
        name: params.name,
      };
      for (const idx of indices) {
        applyPatch(slide.elements[idx], sharedPatch);
      }
    }

    this.bumpVersion();
    return {
      updated_indices: indices,
      elements: indices.map((i) => cloneDeck(slide.elements[i])),
    };
  }

  removeShapes(
    pageIndex: number,
    shapeIndices: number[]
  ): { removed_ids: string[]; remaining_count: number } {
    const slide = this.assertPageIndex(pageIndex);
    const uniqueSorted = [...new Set(shapeIndices)].sort((a, b) => b - a);
    for (const idx of uniqueSorted) this.assertShapeIndex(slide, idx);
    this.pushUndoSnapshot();
    const removedIds: string[] = [];
    for (const idx of uniqueSorted) {
      const [removed] = slide.elements.splice(idx, 1);
      if (removed) removedIds.push(removed.shape_id);
    }
    this.reindexSlide(slide);
    this.bumpVersion();
    return {
      removed_ids: removedIds.reverse(),
      remaining_count: slide.elements.length,
    };
  }

  reorderShape(
    pageIndex: number,
    shapeIndex: number,
    op: 0 | 1 | 2 | 3
  ): { old_index: number; new_index: number } {
    const slide = this.assertPageIndex(pageIndex);
    this.assertShapeIndex(slide, shapeIndex);
    const len = slide.elements.length;
    let newIndex = shapeIndex;
    if (op === ZORDER_BRING_TO_FRONT_OP) newIndex = len - 1;
    else if (op === ZORDER_SEND_TO_BACK_OP) newIndex = 0;
    else if (op === ZORDER_BRING_FORWARD_OP) newIndex = Math.min(len - 1, shapeIndex + 1);
    else if (op === ZORDER_SEND_BACKWARD_OP) newIndex = Math.max(0, shapeIndex - 1);
    else throw new Error(`Invalid z-order op ${op}; expected 0, 1, 2, or 3`);

    if (newIndex !== shapeIndex) {
      this.pushUndoSnapshot();
      const [item] = slide.elements.splice(shapeIndex, 1);
      slide.elements.splice(newIndex, 0, item);
      this.reindexSlide(slide);
      this.bumpVersion();
    }
    return { old_index: shapeIndex, new_index: newIndex };
  }

  groupShapes(pageIndex: number, shapeIndices: number[]): { group_id: string } {
    const slide = this.assertPageIndex(pageIndex);
    if (shapeIndices.length < 2) {
      throw new Error('At least 2 shapes are required to form a group');
    }
    for (const idx of shapeIndices) this.assertShapeIndex(slide, idx);
    this.pushUndoSnapshot();
    const groupId = generateId('grp');
    for (const idx of shapeIndices) {
      slide.elements[idx].groupId = groupId;
    }
    this.bumpVersion();
    return { group_id: groupId };
  }

  ungroupShapes(pageIndex: number, groupId: string): { ungrouped_count: number } {
    const slide = this.assertPageIndex(pageIndex);
    this.pushUndoSnapshot();
    let count = 0;
    for (const el of slide.elements) {
      if (el.groupId === groupId) {
        delete el.groupId;
        count++;
      }
    }
    if (count > 0) this.bumpVersion();
    return { ungrouped_count: count };
  }

  getText(pageIndex: number, shapeIndex: number): TextProps | null {
    const slide = this.assertPageIndex(pageIndex);
    const el = this.assertShapeIndex(slide, shapeIndex);
    return el.text ? cloneDeck(el.text) : null;
  }

  addText(
    pageIndex: number,
    spec: {
      shape_id?: string;
      name?: string;
      role?: string;
      x: number;
      y: number;
      w: number;
      h: number;
      content: string;
      font_name?: string;
      font_size?: number;
      font_color?: string;
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      align?: 'left' | 'center' | 'right';
      v_align?: 'top' | 'middle' | 'bottom';
      line_height?: number;
    }
  ): { shape_index: number; element: SlideElement } {
    const slide = this.assertPageIndex(pageIndex);
    this.pushUndoSnapshot();
    const el: SlideElement = {
      shape_id: spec.shape_id ?? this.nextShapeId(slide, pageIndex, spec.role ?? 'text'),
      type: 'text',
      name: spec.name,
      role: spec.role ?? 'body',
      bounds: {
        x: round2(spec.x),
        y: round2(spec.y),
        w: Math.max(10, round2(spec.w)),
        h: Math.max(10, round2(spec.h)),
      },
      zIndex: slide.elements.length,
      text: {
        content: spec.content,
        fontName: spec.font_name ?? DEFAULT_FONT_FAMILY,
        fontSize: spec.font_size ?? 14,
        fontColor: normalizeColor(spec.font_color, 'F1F5F9'),
        bold: spec.bold ?? false,
        italic: spec.italic ?? false,
        underline: spec.underline ?? false,
        align: spec.align ?? 'left',
        vAlign: spec.v_align ?? 'top',
        lineHeight: spec.line_height ?? 1.35,
      },
    };
    slide.elements.push(el);
    this.reindexSlide(slide);
    this.bumpVersion();
    return {
      shape_index: slide.elements.length - 1,
      element: cloneDeck(el),
    };
  }

  setText(pageIndex: number, shapeIndex: number, content: string): SlideElement {
    const slide = this.assertPageIndex(pageIndex);
    const el = this.assertShapeIndex(slide, shapeIndex);
    if (el.text && el.text.content === content) {
      return cloneDeck(el);
    }
    this.pushUndoSnapshot('修改文本内容', pageIndex);
    if (!el.text) {
      el.text = {
        content,
        fontName: DEFAULT_FONT_FAMILY,
        fontSize: 14,
        fontColor: 'F1F5F9',
        align: 'left',
        vAlign: 'middle',
      };
    } else {
      el.text.content = content;
    }
    this.bumpVersion();
    return cloneDeck(el);
  }

  appendText(pageIndex: number, shapeIndex: number, extra: string): SlideElement {
    const slide = this.assertPageIndex(pageIndex);
    const el = this.assertShapeIndex(slide, shapeIndex);
    this.pushUndoSnapshot();
    if (!el.text) {
      el.text = {
        content: extra,
        fontName: DEFAULT_FONT_FAMILY,
        fontSize: 14,
        fontColor: 'F1F5F9',
        align: 'left',
        vAlign: 'middle',
      };
    } else {
      el.text.content = el.text.content
        ? `${el.text.content}\n${extra}`
        : extra;
    }
    this.bumpVersion();
    return cloneDeck(el);
  }

  setTextProperty(
    pageIndex: number,
    shapeIndex: number,
    props: {
      font_name?: string;
      font_size?: number;
      font_color?: string;
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      align?: 'left' | 'center' | 'right';
      v_align?: 'top' | 'middle' | 'bottom';
      line_height?: number;
    }
  ): SlideElement {
    const slide = this.assertPageIndex(pageIndex);
    const el = this.assertShapeIndex(slide, shapeIndex);
    if (!el.text) {
      throw new Error(`Element at shape_index ${shapeIndex} has no text container`);
    }
    this.pushUndoSnapshot();
    if (props.font_name !== undefined) el.text.fontName = props.font_name;
    if (props.font_size !== undefined) {
      el.text.fontSize = Math.max(6, Math.min(200, props.font_size));
    }
    if (props.font_color !== undefined) {
      el.text.fontColor = normalizeColor(props.font_color);
    }
    if (props.bold !== undefined) el.text.bold = props.bold;
    if (props.italic !== undefined) el.text.italic = props.italic;
    if (props.underline !== undefined) el.text.underline = props.underline;
    if (props.align !== undefined) el.text.align = props.align;
    if (props.v_align !== undefined) el.text.vAlign = props.v_align;
    if (props.line_height !== undefined) el.text.lineHeight = props.line_height;
    this.bumpVersion();
    return cloneDeck(el);
  }

  findText(
    query: string,
    pageIndex?: number
  ): Array<{
    page_index: number;
    shape_index: number;
    shape_id: string;
    matched_text: string;
  }> {
    if (!query) return [];
    const results: Array<{
      page_index: number;
      shape_index: number;
      shape_id: string;
      matched_text: string;
    }> = [];
    const start = pageIndex !== undefined ? pageIndex : 0;
    const end =
      pageIndex !== undefined ? pageIndex + 1 : this.deck.slides.length;
    for (let p = start; p < end; p++) {
      const slide = this.assertPageIndex(p);
      slide.elements.forEach((el, sIdx) => {
        if (el.text && el.text.content.includes(query)) {
          results.push({
            page_index: p,
            shape_index: sIdx,
            shape_id: el.shape_id,
            matched_text: el.text.content,
          });
        }
        if (el.table) {
          for (const row of el.table.cells) {
            for (const cell of row) {
              if (cell.text.includes(query)) {
                results.push({
                  page_index: p,
                  shape_index: sIdx,
                  shape_id: el.shape_id,
                  matched_text: cell.text,
                });
              }
            }
          }
        }
      });
    }
    return results;
  }

  findReplaceText(
    find: string,
    replace: string,
    pageIndex?: number
  ): { replacements: number } {
    if (!find) return { replacements: 0 };
    this.pushUndoSnapshot();
    let count = 0;
    const start = pageIndex !== undefined ? pageIndex : 0;
    const end =
      pageIndex !== undefined ? pageIndex + 1 : this.deck.slides.length;
    for (let p = start; p < end; p++) {
      const slide = this.assertPageIndex(p);
      for (const el of slide.elements) {
        if (el.text && el.text.content.includes(find)) {
          const parts = el.text.content.split(find);
          count += parts.length - 1;
          el.text.content = parts.join(replace);
        }
        if (el.table) {
          for (const row of el.table.cells) {
            for (const cell of row) {
              if (cell.text.includes(find)) {
                const parts = cell.text.split(find);
                count += parts.length - 1;
                cell.text = parts.join(replace);
              }
            }
          }
        }
      }
    }
    if (count > 0) this.bumpVersion();
    else this.undoStack.pop();
    return { replacements: count };
  }

  addTable(
    pageIndex: number,
    spec: {
      shape_id?: string;
      name?: string;
      x: number;
      y: number;
      w: number;
      h: number;
      rows?: number;
      cols?: number;
      data?: string[][];
      header_bg?: string;
      zebra_bg?: string;
      border_color?: string;
    }
  ): { shape_index: number; element: SlideElement } {
    const slide = this.assertPageIndex(pageIndex);
    const data = spec.data;
    const rows = data ? data.length : Math.max(1, spec.rows ?? 3);
    const cols = data
      ? Math.max(1, ...data.map((r) => r.length))
      : Math.max(1, spec.cols ?? 3);
    const headerBg = normalizeColor(spec.header_bg, '1A243D');
    const zebraBg = spec.zebra_bg ? normalizeColor(spec.zebra_bg) : undefined;
    const borderColor = normalizeColor(spec.border_color, '22304A');

    this.pushUndoSnapshot();
    const cells: TableCell[][] = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => ({
        text: data?.[r]?.[c] ?? '',
        bold: r === 0,
        fontSize: r === 0 ? 12 : 11,
        fontColor: r === 0 ? 'F1F5F9' : 'CBD5E1',
        bgColor: r === 0 ? headerBg : r % 2 === 1 ? zebraBg : undefined,
        align: c === 0 ? 'left' : 'center',
        vAlign: 'middle',
      }))
    );

    const el: SlideElement = {
      shape_id: spec.shape_id ?? this.nextShapeId(slide, pageIndex, 'table'),
      type: 'table',
      name: spec.name ?? '数据表',
      role: 'table',
      bounds: {
        x: round2(spec.x),
        y: round2(spec.y),
        w: Math.max(40, round2(spec.w)),
        h: Math.max(30, round2(spec.h)),
      },
      zIndex: slide.elements.length,
      table: {
        rows,
        cols,
        cells,
        headerBg,
        zebraBg,
        borderColor,
      },
    };
    slide.elements.push(el);
    this.reindexSlide(slide);
    this.bumpVersion();
    return {
      shape_index: slide.elements.length - 1,
      element: cloneDeck(el),
    };
  }

  getTableInfo(pageIndex: number, shapeIndex: number): TableProps {
    const slide = this.assertPageIndex(pageIndex);
    const el = this.assertShapeIndex(slide, shapeIndex);
    if (!el.table) {
      throw new Error(`Element at shape_index ${shapeIndex} is not a table`);
    }
    return cloneDeck(el.table);
  }

  private assertTableCell(
    table: TableProps,
    row: number,
    col: number
  ): TableCell {
    if (
      !Number.isInteger(row) ||
      row < 0 ||
      row >= table.rows ||
      !Number.isInteger(col) ||
      col < 0 ||
      col >= table.cols
    ) {
      throw new RangeError(
        `Table cell (${row}, ${col}) out of bounds (0..${table.rows - 1}, 0..${table.cols - 1})`
      );
    }
    return table.cells[row][col];
  }

  setCellText(
    pageIndex: number,
    shapeIndex: number,
    row: number,
    col: number,
    text: string
  ): TableProps {
    const slide = this.assertPageIndex(pageIndex);
    const el = this.assertShapeIndex(slide, shapeIndex);
    if (!el.table) {
      throw new Error(`Element at shape_index ${shapeIndex} is not a table`);
    }
    const cell = this.assertTableCell(el.table, row, col);
    this.pushUndoSnapshot();
    cell.text = text;
    this.bumpVersion();
    return cloneDeck(el.table);
  }

  setCellStyle(
    pageIndex: number,
    shapeIndex: number,
    row: number,
    col: number,
    style: {
      bg_color?: string;
      font_color?: string;
      font_size?: number;
      bold?: boolean;
      italic?: boolean;
      align?: 'left' | 'center' | 'right';
    }
  ): TableProps {
    const slide = this.assertPageIndex(pageIndex);
    const el = this.assertShapeIndex(slide, shapeIndex);
    if (!el.table) {
      throw new Error(`Element at shape_index ${shapeIndex} is not a table`);
    }
    const cell = this.assertTableCell(el.table, row, col);
    this.pushUndoSnapshot();
    if (style.bg_color !== undefined) {
      const bg = normalizeColor(style.bg_color);
      cell.bgColor = bg === 'none' ? undefined : bg;
    }
    if (style.font_color !== undefined) {
      cell.fontColor = normalizeColor(style.font_color);
    }
    if (style.font_size !== undefined) cell.fontSize = style.font_size;
    if (style.bold !== undefined) cell.bold = style.bold;
    if (style.italic !== undefined) cell.italic = style.italic;
    if (style.align !== undefined) cell.align = style.align;
    this.bumpVersion();
    return cloneDeck(el.table);
  }

  mergeTableCells(
    pageIndex: number,
    shapeIndex: number,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number
  ): TableProps {
    const slide = this.assertPageIndex(pageIndex);
    const el = this.assertShapeIndex(slide, shapeIndex);
    if (!el.table) {
      throw new Error(`Element at shape_index ${shapeIndex} is not a table`);
    }
    this.assertTableCell(el.table, startRow, startCol);
    this.assertTableCell(el.table, endRow, endCol);
    const r0 = Math.min(startRow, endRow);
    const r1 = Math.max(startRow, endRow);
    const c0 = Math.min(startCol, endCol);
    const c1 = Math.max(startCol, endCol);

    this.pushUndoSnapshot();
    const anchor = el.table.cells[r0][c0];
    anchor.rowSpan = r1 - r0 + 1;
    anchor.colSpan = c1 - c0 + 1;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (r === r0 && c === c0) continue;
        el.table.cells[r][c].mergedInto = { row: r0, col: c0 };
      }
    }
    this.bumpVersion();
    return cloneDeck(el.table);
  }

  addChart(
    pageIndex: number,
    spec: {
      shape_id?: string;
      name?: string;
      x: number;
      y: number;
      w: number;
      h: number;
      chart_type: ChartType;
      title?: string;
      categories: string[];
      series: ChartSeries[];
      show_legend?: boolean;
      show_gridlines?: boolean;
      show_data_labels?: boolean;
      y_axis_max?: number;
      y_axis_step?: number;
      unit?: string;
    }
  ): { shape_index: number; element: SlideElement } {
    const slide = this.assertPageIndex(pageIndex);
    this.pushUndoSnapshot();
    const palette = ['38E8D4', '846BFF', 'F59E0B', '38BDF8'];
    const el: SlideElement = {
      shape_id: spec.shape_id ?? this.nextShapeId(slide, pageIndex, 'chart'),
      type: 'chart',
      name: spec.name ?? spec.title ?? '统计图表',
      role: 'chart',
      bounds: {
        x: round2(spec.x),
        y: round2(spec.y),
        w: Math.max(80, round2(spec.w)),
        h: Math.max(60, round2(spec.h)),
      },
      zIndex: slide.elements.length,
      chart: {
        chartType: spec.chart_type,
        title: spec.title,
        categories: [...spec.categories],
        series: spec.series.map((s, idx) => ({
          name: s.name,
          values: [...s.values],
          color: normalizeColor(s.color, palette[idx % palette.length]),
        })),
        showLegend: spec.show_legend ?? true,
        showGridlines: spec.show_gridlines ?? true,
        showDataLabels: spec.show_data_labels ?? false,
        yAxisMax: spec.y_axis_max,
        yAxisStep: spec.y_axis_step,
        unit: spec.unit,
      },
    };
    slide.elements.push(el);
    this.reindexSlide(slide);
    this.bumpVersion();
    return {
      shape_index: slide.elements.length - 1,
      element: cloneDeck(el),
    };
  }

  getChartInfo(pageIndex: number, shapeIndex: number): ChartProps {
    const slide = this.assertPageIndex(pageIndex);
    const el = this.assertShapeIndex(slide, shapeIndex);
    if (!el.chart) {
      throw new Error(`Element at shape_index ${shapeIndex} is not a chart`);
    }
    return cloneDeck(el.chart);
  }

  updateChartData(
    pageIndex: number,
    shapeIndex: number,
    data: {
      title?: string;
      categories?: string[];
      series?: ChartSeries[];
      unit?: string;
      y_axis_max?: number;
      y_axis_step?: number;
    }
  ): ChartProps {
    const slide = this.assertPageIndex(pageIndex);
    const el = this.assertShapeIndex(slide, shapeIndex);
    if (!el.chart) {
      throw new Error(`Element at shape_index ${shapeIndex} is not a chart`);
    }
    this.pushUndoSnapshot();
    if (data.title !== undefined) el.chart.title = data.title;
    if (data.categories !== undefined) el.chart.categories = [...data.categories];
    if (data.series !== undefined) {
      el.chart.series = data.series.map((s, idx) => ({
        name: s.name,
        values: [...s.values],
        color: s.color
          ? normalizeColor(s.color)
          : el.chart?.series[idx]?.color ?? '38E8D4',
      }));
    }
    if (data.unit !== undefined) el.chart.unit = data.unit;
    if (data.y_axis_max !== undefined) el.chart.yAxisMax = data.y_axis_max;
    if (data.y_axis_step !== undefined) el.chart.yAxisStep = data.y_axis_step;
    this.bumpVersion();
    return cloneDeck(el.chart);
  }

  changeChartType(
    pageIndex: number,
    shapeIndex: number,
    chartType: ChartType
  ): ChartProps {
    const slide = this.assertPageIndex(pageIndex);
    const el = this.assertShapeIndex(slide, shapeIndex);
    if (!el.chart) {
      throw new Error(`Element at shape_index ${shapeIndex} is not a chart`);
    }
    this.pushUndoSnapshot();
    el.chart.chartType = chartType;
    this.bumpVersion();
    return cloneDeck(el.chart);
  }

  updateChartSeriesStyle(
    pageIndex: number,
    shapeIndex: number,
    seriesIndex: number,
    style: { name?: string; color?: string }
  ): ChartProps {
    const slide = this.assertPageIndex(pageIndex);
    const el = this.assertShapeIndex(slide, shapeIndex);
    if (!el.chart) {
      throw new Error(`Element at shape_index ${shapeIndex} is not a chart`);
    }
    if (
      !Number.isInteger(seriesIndex) ||
      seriesIndex < 0 ||
      seriesIndex >= el.chart.series.length
    ) {
      throw new RangeError(`series_index ${seriesIndex} out of bounds`);
    }
    this.pushUndoSnapshot();
    const target = el.chart.series[seriesIndex];
    if (style.name !== undefined) target.name = style.name;
    if (style.color !== undefined) target.color = normalizeColor(style.color);
    this.bumpVersion();
    return cloneDeck(el.chart);
  }

  listAnimTypes(): typeof BUILTIN_ANIM_TYPES {
    return BUILTIN_ANIM_TYPES;
  }

  addAnim(
    pageIndex: number,
    shapeIndex: number,
    spec: {
      anim_type: string;
      anim_subtype?: string;
      category?: SlideAnimation['category'];
      trigger?: SlideAnimation['trigger'];
      duration_ms?: number;
      delay_ms?: number;
    }
  ): SlideAnimation {
    const slide = this.assertPageIndex(pageIndex);
    const el = this.assertShapeIndex(slide, shapeIndex);
    const meta = BUILTIN_ANIM_TYPES.find((a) => a.anim_type === spec.anim_type);
    this.pushUndoSnapshot();
    const anim: SlideAnimation = {
      anim_id: generateId('anim'),
      anim_type: spec.anim_type,
      anim_subtype: spec.anim_subtype ?? meta?.subtypes[0],
      category: spec.category ?? meta?.category ?? 'entrance',
      trigger: spec.trigger ?? 'onClick',
      durationMs: spec.duration_ms ?? 500,
      delayMs: spec.delay_ms ?? 0,
    };
    if (!el.animations) el.animations = [];
    el.animations.push(anim);
    this.bumpVersion();
    return cloneDeck(anim);
  }

  removeAnim(
    pageIndex: number,
    shapeIndex: number,
    animId?: string
  ): { removed_count: number } {
    const slide = this.assertPageIndex(pageIndex);
    const el = this.assertShapeIndex(slide, shapeIndex);
    if (!el.animations || el.animations.length === 0) {
      return { removed_count: 0 };
    }
    this.pushUndoSnapshot();
    const before = el.animations.length;
    if (animId) {
      el.animations = el.animations.filter((a) => a.anim_id !== animId);
    } else {
      el.animations = [];
    }
    const removed = before - el.animations.length;
    if (removed > 0) this.bumpVersion();
    else this.undoStack.pop();
    return { removed_count: removed };
  }

  listBuiltinThemes(): ThemeDefinition[] {
    return cloneDeck(BUILTIN_THEMES);
  }

  setTheme(themeId: string, applyToExistingSlides = true): PresentationDeck {
    const theme = BUILTIN_THEMES.find((t) => t.theme_id === themeId);
    if (!theme) {
      throw new Error(`Unknown theme_id "${themeId}"`);
    }
    this.pushUndoSnapshot();
    this.deck.theme_id = theme.theme_id;
    if (applyToExistingSlides) {
      for (const slide of this.deck.slides) {
        slide.background.color = theme.background;
        for (const el of slide.elements) {
          if (el.role === 'title' && el.text) {
            el.text.fontColor = theme.textPrimary;
          } else if (el.role === 'subtitle' && el.text) {
            el.text.fontColor = theme.textSecondary;
          }
        }
      }
    }
    this.bumpVersion();
    return this.getDeck();
  }

  getNotesText(pageIndex: number): string {
    return this.assertPageIndex(pageIndex).notes;
  }

  setNotesText(pageIndex: number, notes: string): SlidePage {
    const slide = this.assertPageIndex(pageIndex);
    if (slide.notes === notes) {
      return cloneDeck(slide);
    }
    this.pushUndoSnapshot('编辑演讲者备注', pageIndex);
    slide.notes = notes;
    this.bumpVersion();
    return cloneDeck(slide);
  }

  /**
   * Executes a mutating callback as a tracked AI Edit, recording a full pre-edit snapshot
   * so slide_undo_ai_edit can revert cleanly.
   */
  runTrackedAiEdit<T>(
    toolName: string,
    summary: string,
    fn: () => T,
    meta?: {
      page_index?: number;
      shape_ids?: string[];
      selection_range_id?: string;
    }
  ): { result: T; edit: AiEditRecord } {
    const beforeSnapshot = JSON.stringify({
      aspect_ratio: this.deck.aspect_ratio,
      width_pt: this.deck.width_pt,
      height_pt: this.deck.height_pt,
      theme_id: this.deck.theme_id,
      design_md: this.deck.design_md,
      slides: this.deck.slides,
      sections: this.deck.sections,
      comments: this.deck.comments,
    });
    const result = fn();
    const edit: AiEditRecord = {
      edit_id: generateId('aiedit'),
      version: this.deck.version,
      timestamp: Date.now(),
      tool_name: toolName,
      summary,
      page_index: meta?.page_index,
      shape_ids: meta?.shape_ids,
      selection_range_id: meta?.selection_range_id,
      before_snapshot: beforeSnapshot,
      reverted: false,
    };
    this.deck.ai_edits.push(edit);
    // ADR-0001: AI edit establishes a new Manual Undo Baseline and isolates manual undo/redo
    this.undoStack = [];
    this.redoStack = [];
    return { result, edit: cloneDeck(edit) };
  }

  listRecentAiEdits(limit = 20): AiEditRecord[] {
    const items = this.deck.ai_edits
      .slice(-Math.max(1, limit))
      .reverse()
      .map((e) => ({
        edit_id: e.edit_id,
        version: e.version,
        timestamp: e.timestamp,
        tool_name: e.tool_name,
        summary: e.summary,
        page_index: e.page_index,
        shape_ids: e.shape_ids ? [...e.shape_ids] : undefined,
        selection_range_id: e.selection_range_id,
        before_snapshot: e.before_snapshot,
        reverted: Boolean(e.reverted),
      }));
    return items;
  }

  undoAiEdit(editId?: string): {
    reverted_edit: AiEditRecord;
    deck: PresentationDeck;
  } {
    const targetIdx = editId
      ? this.deck.ai_edits.findIndex((e) => e.edit_id === editId && !e.reverted)
      : (() => {
          for (let i = this.deck.ai_edits.length - 1; i >= 0; i--) {
            if (!this.deck.ai_edits[i].reverted) return i;
          }
          return -1;
        })();

    if (targetIdx < 0) {
      throw new Error(
        editId
          ? `No active AI edit found with edit_id "${editId}"`
          : 'No AI edits available to undo'
      );
    }

    const target = this.deck.ai_edits[targetIdx];
    const restored = JSON.parse(target.before_snapshot) as Pick<
      PresentationDeck,
      | 'aspect_ratio'
      | 'width_pt'
      | 'height_pt'
      | 'theme_id'
      | 'design_md'
      | 'slides'
      | 'sections'
      | 'comments'
    >;
    this.deck.aspect_ratio = restored.aspect_ratio;
    this.deck.width_pt = restored.width_pt;
    this.deck.height_pt = restored.height_pt;
    this.deck.theme_id = restored.theme_id;
    this.deck.design_md = restored.design_md;
    this.deck.slides = restored.slides;
    this.deck.sections = restored.sections;
    this.deck.comments = restored.comments;
    target.reverted = true;
    // Also mark any newer non-reverted edits after targetIdx as reverted when rolling back to an earlier edit
    for (let i = targetIdx + 1; i < this.deck.ai_edits.length; i++) {
      this.deck.ai_edits[i].reverted = true;
    }
    this.reindexAllElements();
    this.bumpVersion();
    // ADR-0001: Post-revert state becomes the new Manual Undo Baseline
    this.undoStack = [];
    this.redoStack = [];
    return {
      reverted_edit: cloneDeck(target),
      deck: this.getDeck(),
    };
  }
}
