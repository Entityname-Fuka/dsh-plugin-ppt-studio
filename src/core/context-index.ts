import {
  SELECTION_DEFAULT_SEQUENCE_EPOCH,
  SELECTION_MENTION_TYPE,
  SELECTION_URI_SCHEME,
} from './constants';
import type {
  ActiveDocumentSelection,
  BoundsPt,
  DocumentSelectionContextBlock,
  DocumentSelectionEvent,
  IndexedElementHit,
  PresentationDeck,
  RegionQueryResult,
  SanitizedSlideSelectionPayload,
  SelectionMode,
  SlideElement,
  SlidePage,
  SlideSelectionPayload,
} from './types';

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function normalizeRectPt(rect: BoundsPt): BoundsPt {
  const x = rect.w >= 0 ? rect.x : rect.x + rect.w;
  const y = rect.h >= 0 ? rect.y : rect.y + rect.h;
  const w = Math.abs(rect.w);
  const h = Math.abs(rect.h);
  return {
    x: round2(x),
    y: round2(y),
    w: round2(w),
    h: round2(h),
  };
}

export function computeRectIntersection(a: BoundsPt, b: BoundsPt): BoundsPt | null {
  const ra = normalizeRectPt(a);
  const rb = normalizeRectPt(b);
  const x1 = Math.max(ra.x, rb.x);
  const y1 = Math.max(ra.y, rb.y);
  const x2 = Math.min(ra.x + ra.w, rb.x + rb.w);
  const y2 = Math.min(ra.y + ra.h, rb.y + rb.h);
  if (x2 <= x1 || y2 <= y1) return null;
  return {
    x: round2(x1),
    y: round2(y1),
    w: round2(x2 - x1),
    h: round2(y2 - y1),
  };
}

export function computeOverlapRatio(elementBounds: BoundsPt, queryRect: BoundsPt): number {
  const elRect: BoundsPt = {
    x: elementBounds.x,
    y: elementBounds.y,
    w: Math.max(1, elementBounds.w),
    h: Math.max(1, elementBounds.h),
  };
  const inter = computeRectIntersection(elRect, queryRect);
  if (!inter) return 0;
  const elementArea = elRect.w * elRect.h;
  if (elementArea <= 0) return 0;
  const interArea = inter.w * inter.h;
  return Math.max(0, Math.min(1, round4(interArea / elementArea)));
}

export function computeUnionBounds(boundsList: BoundsPt[]): BoundsPt {
  if (boundsList.length === 0) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boundsList) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return {
    x: round2(minX),
    y: round2(minY),
    w: round2(Math.max(0, maxX - minX)),
    h: round2(Math.max(0, maxY - minY)),
  };
}

function buildTextPreview(el: SlideElement): string | undefined {
  if (el.text?.content) {
    const clean = el.text.content.replace(/\s+/g, ' ').trim();
    return clean.length > 120 ? `${clean.slice(0, 117)}...` : clean;
  }
  if (el.chart) {
    const title = el.chart.title ?? el.name ?? '图表';
    const seriesSummary = el.chart.series.map((s) => s.name).join(' / ');
    return `${title} [${el.chart.chartType}: ${seriesSummary}]`;
  }
  if (el.table) {
    const header = el.table.cells[0]?.map((c) => c.text).filter(Boolean).join(' | ');
    return `表格 ${el.table.rows}x${el.table.cols}${header ? `: ${header}` : ''}`;
  }
  if (el.name) return el.name;
  return undefined;
}

export function buildIndexedElementHit(
  el: SlideElement,
  shapeIndex: number,
  overlapRatio = 1,
  tableCells?: { start_row: number; start_col: number; end_row: number; end_col: number }
): IndexedElementHit {
  const hit: IndexedElementHit = {
    shape_id: el.shape_id,
    shape_index: shapeIndex,
    type: el.type,
    role: el.role,
    bounds_pt: { ...el.bounds },
    overlap_ratio: overlapRatio,
    text_preview: buildTextPreview(el),
    style_summary: {
      fill_color: el.fill?.color,
      border_color: el.border?.color,
      font_size: el.text?.fontSize,
      font_color: el.text?.fontColor,
    },
  };

  if (el.table) {
    hit.table_cells = tableCells ?? {
      start_row: 0,
      start_col: 0,
      end_row: Math.max(0, el.table.rows - 1),
      end_col: Math.max(0, el.table.cols - 1),
    };
  }

  if (el.chart) {
    hit.chart_summary = {
      chart_type: el.chart.chartType,
      title: el.chart.title,
      series_names: el.chart.series.map((s) => s.name),
      categories: [...el.chart.categories],
    };
  }

  return hit;
}

export function recommendToolsForHits(hits: IndexedElementHit[]): string[] {
  const tools = new Set<string>();
  if (hits.length === 0) {
    tools.add('slide_add_shape');
    tools.add('slide_add_text');
    tools.add('slide_add_chart');
    tools.add('slide_set_page_properties');
    return Array.from(tools);
  }

  for (const hit of hits) {
    if (hit.type === 'chart') {
      tools.add('slide_get_chart_info');
      tools.add('slide_update_chart_data');
      tools.add('slide_change_chart_type');
      tools.add('slide_update_chart_series_style');
    } else if (hit.type === 'table') {
      tools.add('slide_get_table_info');
      tools.add('slide_set_cell_text');
      tools.add('slide_set_cell_style');
      tools.add('slide_merge_table_cells');
    } else if (hit.type === 'text') {
      tools.add('slide_set_text');
      tools.add('slide_set_text_property');
      tools.add('slide_set_shape_properties');
    } else {
      tools.add('slide_set_shape_properties');
      if (hit.text_preview) {
        tools.add('slide_set_text');
        tools.add('slide_set_text_property');
      }
    }
  }
  tools.add('slide_remove_shapes');
  return Array.from(tools);
}

export function querySlideRegion(
  deckOrSlide: PresentationDeck | SlidePage,
  pageIndex: number,
  bboxPt: BoundsPt,
  options?: {
    minOverlapRatio?: number;
    selectionMode?: SelectionMode;
    excludeRoles?: string[];
  }
): RegionQueryResult {
  const slide: SlidePage =
    'slides' in deckOrSlide ? deckOrSlide.slides[pageIndex] : deckOrSlide;
  if (!slide) {
    throw new RangeError(`page_index ${pageIndex} not found`);
  }

  const normalizedBox = normalizeRectPt(bboxPt);
  const minOverlap = options?.minOverlapRatio ?? 0.05;
  const exclude = new Set(options?.excludeRoles ?? []);
  const hits: IndexedElementHit[] = [];

  slide.elements.forEach((el, idx) => {
    if (el.role && exclude.has(el.role)) return;
    const ratio = computeOverlapRatio(el.bounds, normalizedBox);
    if (ratio >= minOverlap) {
      hits.push(buildIndexedElementHit(el, idx, ratio));
    }
  });

  // Sort hits by overlap_ratio desc, then zIndex / shape_index asc
  hits.sort((a, b) => {
    if (b.overlap_ratio !== a.overlap_ratio) {
      return b.overlap_ratio - a.overlap_ratio;
    }
    return a.shape_index - b.shape_index;
  });

  const selectionMode: SelectionMode =
    options?.selectionMode ??
    (hits.length > 1 ? 'free-marquee' : hits.length === 1 ? 'free-marquee' : 'free-marquee');

  const textSummary =
    hits
      .map((h) => h.text_preview)
      .filter((t): t is string => Boolean(t))
      .join(' | ') || `第 ${pageIndex + 1} 页框选区域 (${normalizedBox.w}×${normalizedBox.h} pt)`;

  return {
    page_index: pageIndex,
    slide_id: slide.slide_id,
    bbox_pt: normalizedBox,
    selection_mode: selectionMode,
    elements: hits,
    recommended_tools: recommendToolsForHits(hits),
    text_summary: textSummary,
  };
}

export function buildSelectionPayload(
  deck: PresentationDeck,
  pageIndex: number,
  params: {
    rangeId?: string;
    bbox_pt?: BoundsPt;
    shape_ids?: string[];
    shape_indices?: number[];
    selection_mode?: SelectionMode;
    table_cells?: { start_row: number; start_col: number; end_row: number; end_col: number };
    aiPrompt?: string;
    description?: string;
    timestamp?: number;
    minOverlapRatio?: number;
  }
): SlideSelectionPayload {
  const slide = deck.slides[pageIndex];
  if (!slide) {
    throw new RangeError(`page_index ${pageIndex} not found`);
  }

  const timestamp = params.timestamp ?? Date.now();
  let hits: IndexedElementHit[] = [];
  let bboxPt: BoundsPt;
  let selectionMode: SelectionMode;

  if (params.selection_mode === 'whole-slide') {
    hits = slide.elements.map((el, idx) =>
      buildIndexedElementHit(el, idx, 1, params.table_cells)
    );
    bboxPt = {
      x: 0,
      y: 0,
      w: deck.width_pt,
      h: deck.height_pt,
    };
    selectionMode = 'whole-slide';
  } else if (params.bbox_pt) {
    const query = querySlideRegion(slide, pageIndex, params.bbox_pt, {
      minOverlapRatio: params.minOverlapRatio ?? 0.05,
      selectionMode: params.selection_mode ?? 'free-marquee',
    });
    hits = query.elements;
    bboxPt = query.bbox_pt;
    selectionMode = params.selection_mode ?? 'free-marquee';
  } else {
    const indexSet = new Set<number>();
    if (params.shape_indices) {
      for (const idx of params.shape_indices) {
        if (idx >= 0 && idx < slide.elements.length) indexSet.add(idx);
      }
    }
    if (params.shape_ids) {
      for (const id of params.shape_ids) {
        const idx = slide.elements.findIndex((e) => e.shape_id === id);
        if (idx >= 0) indexSet.add(idx);
      }
    }
    const sortedIndices = Array.from(indexSet).sort((a, b) => a - b);
    hits = sortedIndices.map((idx) =>
      buildIndexedElementHit(slide.elements[idx], idx, 1, params.table_cells)
    );
    bboxPt = computeUnionBounds(hits.map((h) => h.bounds_pt));
    selectionMode =
      params.selection_mode ??
      (hits.length > 1 ? 'multi-element' : 'element');
  }

  const shapeIds = hits.map((h) => h.shape_id);
  const shapeIndices = hits.map((h) => h.shape_index);
  const previewJoined = hits
    .map((h) => h.text_preview)
    .filter((t): t is string => Boolean(t))
    .slice(0, 4)
    .join(' · ');
  const summaryText =
    selectionMode === 'whole-slide'
      ? previewJoined
        ? `整页「${slide.title}」：${previewJoined}`
        : `整页「${slide.title}」(P${pageIndex + 1})`
      : previewJoined || `${slide.title} (P${pageIndex + 1})`;

  const rangeId =
    params.rangeId ??
    (selectionMode === 'whole-slide'
      ? `sel_p${pageIndex}_whole_slide_${timestamp.toString(36)}`
      : `sel_p${pageIndex}_${shapeIds.slice(0, 2).join('_') || 'region'}_${timestamp.toString(36)}`);

  const recommendedTools =
    selectionMode === 'whole-slide'
      ? Array.from(
          new Set([
            'slide_get_page_info',
            'slide_set_page_properties',
            'slide_update_page_with_jsx',
            'slide_set_notes_text',
            'slide_add_text',
            'slide_add_shape',
            ...recommendToolsForHits(hits),
          ])
        )
      : recommendToolsForHits(hits);

  return {
    rangeId,
    text: summaryText,
    description:
      params.description ??
      (selectionMode === 'whole-slide'
        ? `第 ${pageIndex + 1} 页 · 整页（${slide.title}，共 ${hits.length} 个元素）`
        : `第 ${pageIndex + 1} 页 (${hits.length} 个元素, ${selectionMode})`),
    timestamp,
    fileId: deck.file_id,
    title:
      selectionMode === 'whole-slide'
        ? `${deck.file_name} · 第 ${pageIndex + 1} 页（整页）`
        : `${deck.file_name} · P${pageIndex + 1}`,
    page_index: pageIndex,
    slide_id: slide.slide_id,
    selection_mode: selectionMode,
    shape_ids: shapeIds,
    shape_indices: shapeIndices,
    bbox_pt: bboxPt,
    elements: hits,
    recommended_tools: recommendedTools,
    aiPrompt: params.aiPrompt,
  };
}

export function buildWholeSlideSelectionPayload(
  deck: PresentationDeck,
  pageIndex: number,
  options?: {
    rangeId?: string;
    aiPrompt?: string;
    description?: string;
    timestamp?: number;
  }
): SlideSelectionPayload {
  return buildSelectionPayload(deck, pageIndex, {
    ...options,
    selection_mode: 'whole-slide',
  });
}

export function sanitizeDocumentSelectionForDraft(
  payload: SlideSelectionPayload
): SanitizedSlideSelectionPayload {
  const clone = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  delete clone.aiPrompt;
  delete clone.sourceApi;
  return clone as unknown as SanitizedSlideSelectionPayload;
}

export function toActiveDocumentSelection(
  event: DocumentSelectionEvent
): ActiveDocumentSelection {
  const sel = event.selection;
  const sanitized = sanitizeDocumentSelectionForDraft(sel);
  return {
    sessionId: event.sessionId,
    documentResourceUri: event.documentResourceUri,
    filePath: event.filePath,
    fileType: event.fileType,
    consumerSurface: event.consumerSurface,
    sequence: event.sequence,
    sequenceEpoch: event.sequenceEpoch || SELECTION_DEFAULT_SEQUENCE_EPOCH,
    fileId: sel.fileId,
    rangeId: sel.rangeId,
    title: sel.title,
    selectionText: sel.text,
    description: sel.description,
    timestamp: sel.timestamp,
    aiPrompt: sel.aiPrompt,
    selectionPayload: sanitized,
  };
}

export function getDocumentSelectionBlockKey(
  input:
    | DocumentSelectionContextBlock
    | ActiveDocumentSelection
    | DocumentSelectionEvent
    | {
        documentResourceUri: string;
        rangeId: string;
        sequenceEpoch?: string;
        sequence: number;
      }
): string {
  if ('_meta' in input) {
    const m = input._meta;
    return `${m.documentResourceUri}\n${m.rangeId}\n${m.sequenceEpoch || SELECTION_DEFAULT_SEQUENCE_EPOCH}\n${m.sequence}`;
  }
  if ('selection' in input) {
    return `${input.documentResourceUri}\n${input.selection.rangeId}\n${input.sequenceEpoch || SELECTION_DEFAULT_SEQUENCE_EPOCH}\n${input.sequence}`;
  }
  return `${input.documentResourceUri}\n${input.rangeId}\n${input.sequenceEpoch || SELECTION_DEFAULT_SEQUENCE_EPOCH}\n${input.sequence}`;
}

export function createDocumentSelectionContextBlock(
  input: ActiveDocumentSelection | DocumentSelectionEvent,
  options?: {
    selectionPairId?: string;
    selectionAutoPrompt?: boolean;
  }
): DocumentSelectionContextBlock {
  const active =
    'selection' in input ? toActiveDocumentSelection(input) : input;

  return {
    type: 'resource_link',
    name: active.title || active.selectionText || '幻灯片选区',
    uri: `${SELECTION_URI_SCHEME}${encodeURIComponent(active.rangeId)}`,
    title: active.title,
    _meta: {
      mentionType: SELECTION_MENTION_TYPE,
      type: 'document-selection',
      displayAsPhrase: true,
      displayAsContext: false,
      documentResourceUri: active.documentResourceUri,
      filePath: active.filePath,
      fileType: active.fileType,
      fileId: active.fileId,
      rangeId: active.rangeId,
      sequence: active.sequence,
      sequenceEpoch: active.sequenceEpoch || SELECTION_DEFAULT_SEQUENCE_EPOCH,
      selectionPayload: active.selectionPayload,
      ...(active.aiPrompt ? { aiPrompt: active.aiPrompt } : {}),
      ...(options?.selectionPairId
        ? { selectionPairId: options.selectionPairId }
        : {}),
      ...(options?.selectionAutoPrompt !== undefined
        ? { selectionAutoPrompt: options.selectionAutoPrompt }
        : {}),
    },
  };
}

export function isDocumentSelectionContextBlock(
  block: unknown
): block is DocumentSelectionContextBlock {
  if (!block || typeof block !== 'object') return false;
  const obj = block as Record<string, unknown>;
  if (obj.type !== 'resource_link') return false;
  const meta = obj._meta as Record<string, unknown> | undefined;
  return (
    meta?.mentionType === SELECTION_MENTION_TYPE &&
    typeof obj.uri === 'string' &&
    obj.uri.startsWith(SELECTION_URI_SCHEME)
  );
}

export function syncDocumentSelectionContextBlock<T = DocumentSelectionContextBlock>(
  blocks: T[],
  activeSelection: ActiveDocumentSelection | DocumentSelectionEvent | null,
  options?: {
    replaceExistingDocumentSelection?: boolean;
    selectionPairId?: string;
    selectionAutoPrompt?: boolean;
  }
): T[] {
  const replaceDoc = options?.replaceExistingDocumentSelection ?? true;
  if (!activeSelection) {
    return blocks.filter((b) => !isDocumentSelectionContextBlock(b));
  }

  const nextBlock = createDocumentSelectionContextBlock(activeSelection, {
    selectionPairId: options?.selectionPairId,
    selectionAutoPrompt: options?.selectionAutoPrompt,
  });
  const nextKey = getDocumentSelectionBlockKey(nextBlock);

  const filtered = blocks.filter((b) => {
    if (!isDocumentSelectionContextBlock(b)) return true;
    if (getDocumentSelectionBlockKey(b) === nextKey) return false;
    if (
      replaceDoc &&
      b._meta.documentResourceUri === nextBlock._meta.documentResourceUri
    ) {
      return false;
    }
    if (b._meta.rangeId === nextBlock._meta.rangeId) {
      return false;
    }
    return true;
  });

  return [...filtered, nextBlock as unknown as T];
}

export function formatSelectionAnchor(timestamp: number): string {
  return `@tdoc-selection#${timestamp}`;
}

export function renderTencentDocsSelectionPrompt(
  blocksInput: DocumentSelectionContextBlock | DocumentSelectionContextBlock[],
  userMessage?: string
): string {
  const blocks = Array.isArray(blocksInput) ? blocksInput : [blocksInput];
  const validBlocks = blocks.filter(isDocumentSelectionContextBlock);
  if (validBlocks.length === 0) {
    return userMessage ?? '';
  }

  const anchors: string[] = [];
  const xmlSegments: string[] = [];

  for (const block of validBlocks) {
    const payload = sanitizeDocumentSelectionForDraft(
      block._meta.selectionPayload as SlideSelectionPayload
    );
    anchors.push(formatSelectionAnchor(payload.timestamp));
    xmlSegments.push(
      [
        '<tencent_docs_selection>',
        `  <selection_payload format="json">${JSON.stringify(payload)}</selection_payload>`,
        '</tencent_docs_selection>',
      ].join('\n')
    );
  }

  const anchorLine = anchors.join(' ');
  const xmlBody = xmlSegments.join('\n');

  if (userMessage && userMessage.trim()) {
    const hasAnchor = userMessage.includes('@tdoc-selection#');
    const promptHeader = hasAnchor ? userMessage.trim() : `${anchorLine} ${userMessage.trim()}`;
    return `${promptHeader}\n\n${xmlBody}`;
  }

  return `${anchorLine}\n${xmlBody}`;
}

/**
 * 生成给「对话输入框内联展示」用的人类可读引用描述文本。
 * 描述引用了 PPT 的哪一页、什么位置的什么元素（含元素文字预览）。
 */
export function formatSelectionReferenceText(
  payload: SlideSelectionPayload,
  options?: { fileName?: string }
): string {
  const page = payload.page_index + 1;
  const fileName =
    options?.fileName ||
    payload.title?.split('·')[0]?.trim() ||
    '演示文稿';
  const mode = payload.selection_mode;

  if (mode === 'whole-slide') {
    const preview = (payload.elements || [])
      .map((el) => el.text_preview)
      .filter((t): t is string => Boolean(t))
      .slice(0, 4)
      .join(' · ');
    return preview
      ? `引用《${fileName}》第 ${page} 页（整页，共 ${payload.elements.length} 个元素）：${preview}`
      : `引用《${fileName}》第 ${page} 页（整页，共 ${payload.elements.length} 个元素）`;
  }

  const modeLabel = selectionModeLabel(mode);
  const parts = (payload.elements || [])
    .slice(0, 6)
    .map((el, i) => {
      const preview = el.text_preview?.trim();
      const typeLabel = el.role || el.type || '元素';
      return preview ? `${i + 1}. ${typeLabel}「${preview}」` : `${i + 1}. ${typeLabel}`;
    });

  const head = `引用《${fileName}》第 ${page} 页 · ${modeLabel}（共 ${payload.elements.length} 个元素）`;
  return parts.length > 0 ? `${head}：\n${parts.join('\n')}` : head;
}

function selectionModeLabel(mode: SlideSelectionPayload['selection_mode']): string {
  switch (mode) {
    case 'free-marquee':
      return '框选区域';
    case 'multi-element':
      return '多选元素';
    case 'table-cells':
      return '表格选区';
    case 'whole-slide':
      return '整页';
    default:
      return '元素';
  }
}

/**
 * 生成输入框内联“引用芯片”的 QuoteSummary（label/title/detail/body）。
 * 芯片上显示 label + title(+detail)，body 为完整描述，作为可展开的引用内容。
 * 这样引用在输入框里呈现为特殊的引用块/chip，而不是一长段纯文本。
 */
export function buildSelectionQuoteSummary(
  payload: SlideSelectionPayload,
  options?: { fileName?: string }
): { label: string; title: string; detail?: string; body: string } {
  const page = payload.page_index + 1;
  const fileName =
    options?.fileName || payload.title?.split('·')[0]?.trim() || '演示文稿';
  const body = formatSelectionReferenceText(payload, options);
  const modeLabel = selectionModeLabel(payload.selection_mode);

  if (payload.selection_mode === 'whole-slide') {
    return {
      label: 'PPT 引用',
      title: `${fileName} · 第 ${page} 页（整页）`,
      detail: `${payload.elements.length} 个元素`,
      body,
    };
  }

  const firstPreview =
    (payload.elements || []).map((el) => el.text_preview?.trim()).find(Boolean) || '';
  const pLabel = (payload.elements || [])[0]?.role || (payload.elements || [])[0]?.type || '';
  const detailParts = [`${payload.elements.length} 个元素`];
  if (pLabel) detailParts.unshift(pLabel);
  if (firstPreview) detailParts.push(`「${firstPreview.slice(0, 18)}」`);

  return {
    label: 'PPT 引用',
    title: `${fileName} · 第 ${page} 页 · ${modeLabel}`,
    detail: detailParts.join(' · '),
    body,
  };
}
