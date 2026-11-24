import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SAMPLE_PAGE_INDEX,
  SELECTION_DEFAULT_SEQUENCE_EPOCH,
  SELECTION_MENTION_TYPE,
  SELECTION_URI_SCHEME,
  buildSelectionPayload,
  buildWholeSlideSelectionPayload,
  computeOverlapRatio,
  computeRectIntersection,
  createDocumentSelectionContextBlock,
  createEmptyDeck,
  createSampleDeck,
  getDocumentSelectionBlockKey,
  normalizeRectPt,
  querySlideRegion,
  renderTencentDocsSelectionPrompt,
  sanitizeDocumentSelectionForDraft,
  syncDocumentSelectionContextBlock,
  toActiveDocumentSelection,
} from '../src/core/index';
import type { DocumentSelectionEvent } from '../src/core/index';

describe('Fine-Grained Context Index & WorkBuddy Selection Protocol', () => {
  it('normalizes reverse-dragged marquee rects and computes exact intersection & overlap_ratio', () => {
    const norm = normalizeRectPt({ x: 300, y: 250, w: -100, h: -50 });
    expect(norm).toEqual({ x: 200, y: 200, w: 100, h: 50 });

    const elBounds = { x: 100, y: 100, w: 200, h: 100 };
    const halfBox = { x: 200, y: 100, w: 150, h: 100 };
    const inter = computeRectIntersection(elBounds, halfBox);
    expect(inter).toEqual({ x: 200, y: 100, w: 100, h: 100 });
    expect(computeOverlapRatio(elBounds, halfBox)).toBe(0.5);
    expect(computeOverlapRatio(elBounds, { x: 50, y: 50, w: 400, h: 300 })).toBe(1);
    expect(computeOverlapRatio(elBounds, { x: 400, y: 400, w: 50, h: 50 })).toBe(0);
  });

  it('queries page 6 (index 5) chart & KPI region with strict 0-based shape_index alignment', () => {
    const deck = createSampleDeck();
    const pageIndex = DEFAULT_SAMPLE_PAGE_INDEX;
    const slide = deck.slides[pageIndex];

    // Free-marquee over the left grouped bar chart (x: 58, y: 126, w: 528, h: 298)
    const chartQuery = querySlideRegion(
      deck,
      pageIndex,
      { x: 50, y: 120, w: 540, h: 310 },
      { excludeRoles: ['decoration'] }
    );

    expect(chartQuery.page_index).toBe(5);
    expect(chartQuery.selection_mode).toBe('free-marquee');
    const chartHit = chartQuery.elements.find((h) => h.shape_id === 's6_chart_workload');
    expect(chartHit).toBeDefined();
    expect(chartHit?.overlap_ratio).toBe(1);

    // Strict 0-based alignment with slide.elements array index
    const actualIdx = slide.elements.findIndex((e) => e.shape_id === 's6_chart_workload');
    expect(chartHit?.shape_index).toBe(actualIdx);
    expect(chartHit?.chart_summary?.chart_type).toBe('bar');
    expect(chartHit?.chart_summary?.series_names).toEqual([
      '预训练算力占比',
      '实时推理与 Agent 占比',
    ]);
    expect(chartQuery.recommended_tools).toContain('slide_update_chart_data');

    // Free-marquee over right KPI area (70%+)
    const kpiQuery = querySlideRegion(deck, pageIndex, { x: 630, y: 155, w: 270, h: 100 });
    const kpiHit = kpiQuery.elements.find((h) => h.shape_id === 's6_kpi_70pct');
    expect(kpiHit).toBeDefined();
    expect(kpiHit?.text_preview).toContain('70%+');
    expect(kpiQuery.recommended_tools).toContain('slide_set_text');
  });

  it('builds selection payloads for element, multi-element, table-cells, and free-marquee modes', () => {
    const deck = createSampleDeck();

    // Single element selection
    const single = buildSelectionPayload(deck, 5, {
      shape_ids: ['s6_kpi_70pct'],
      timestamp: 1700000000001,
    });
    expect(single.selection_mode).toBe('element');
    expect(single.shape_ids).toEqual(['s6_kpi_70pct']);
    expect(single.elements[0].overlap_ratio).toBe(1);

    // Multi-element selection -> union bbox
    const multi = buildSelectionPayload(deck, 5, {
      shape_ids: ['s6_kpi_70pct', 's6_kpi_headline'],
      timestamp: 1700000000002,
    });
    expect(multi.selection_mode).toBe('multi-element');
    expect(multi.shape_indices).toHaveLength(2);
    expect(multi.bbox_pt.h).toBeGreaterThan(72);

    // Table cells selection on page 7 (index 6)
    const tableSlide = deck.slides[6];
    const tableIdx = tableSlide.elements.findIndex((e) => e.type === 'table');
    expect(tableIdx).toBeGreaterThanOrEqual(0);
    const tableSel = buildSelectionPayload(deck, 6, {
      shape_indices: [tableIdx],
      selection_mode: 'table-cells',
      table_cells: { start_row: 1, start_col: 1, end_row: 2, end_col: 3 },
      timestamp: 1700000000003,
    });
    expect(tableSel.elements[0].table_cells).toEqual({
      start_row: 1,
      start_col: 1,
      end_row: 2,
      end_col: 3,
    });
    expect(tableSel.recommended_tools).toContain('slide_set_cell_text');
  });

  it('implements tdoc-selection:// block creation, dedup key, sync, sanitization, and XML prompt rendering', () => {
    const deck = createSampleDeck();
    const payload = buildSelectionPayload(deck, 5, {
      rangeId: 'range_s6_chart_1',
      bbox_pt: { x: 54, y: 122, w: 536, h: 304 },
      aiPrompt: '请把荧光青柱子改为琥珀金并突出 2026 E 数据',
      timestamp: 1760000001234,
    });

    const sanitized = sanitizeDocumentSelectionForDraft(payload);
    expect((sanitized as Record<string, unknown>).aiPrompt).toBeUndefined();
    expect((sanitized as Record<string, unknown>).sourceApi).toBeUndefined();

    const event: DocumentSelectionEvent = {
      sessionId: 'sess_1',
      documentResourceUri: `dsh-resource://file/${deck.file_name}`,
      filePath: deck.file_path,
      fileType: 'pptx',
      consumerSurface: 'office',
      sequence: 7,
      sequenceEpoch: '',
      selection: payload,
    };

    const active = toActiveDocumentSelection(event);
    expect(active.sequenceEpoch).toBe(SELECTION_DEFAULT_SEQUENCE_EPOCH);

    const block = createDocumentSelectionContextBlock(active, {
      selectionPairId: 'pair_1',
      selectionAutoPrompt: true,
    });
    expect(block.type).toBe('resource_link');
    expect(block.uri).toBe(`${SELECTION_URI_SCHEME}${encodeURIComponent('range_s6_chart_1')}`);
    expect(block._meta.mentionType).toBe(SELECTION_MENTION_TYPE);
    expect(block._meta.displayAsPhrase).toBe(true);
    expect(block._meta.displayAsContext).toBe(false);
    expect(block._meta.selectionPairId).toBe('pair_1');

    // Dedup key format matches WorkBuddy spec
    const expectedKey = `${event.documentResourceUri}\nrange_s6_chart_1\n${SELECTION_DEFAULT_SEQUENCE_EPOCH}\n7`;
    expect(getDocumentSelectionBlockKey(block)).toBe(expectedKey);
    expect(getDocumentSelectionBlockKey(event)).toBe(expectedKey);

    // Syncing replaces older selection on same document while preserving non-selection blocks
    const nonSelBlock = { type: 'text', text: 'extra context' };
    const synced1 = syncDocumentSelectionContextBlock<unknown>([nonSelBlock], event);
    expect(synced1).toHaveLength(2);

    const event2: DocumentSelectionEvent = {
      ...event,
      sequence: 8,
      selection: { ...payload, rangeId: 'range_s6_kpi_2', timestamp: 1760000005678 },
    };
    const synced2 = syncDocumentSelectionContextBlock<unknown>(synced1, event2, {
      replaceExistingDocumentSelection: true,
    });
    expect(synced2).toHaveLength(2);

    // Clearing active selection removes selection blocks but keeps normal blocks
    const cleared = syncDocumentSelectionContextBlock<unknown>(synced2, null);
    expect(cleared).toEqual([nonSelBlock]);

    // XML Prompt Rendering
    const xmlPrompt = renderTencentDocsSelectionPrompt(block, '请优化选中图表配色');
    expect(xmlPrompt).toContain('@tdoc-selection#1760000001234 请优化选中图表配色');
    expect(xmlPrompt).toContain('<tencent_docs_selection>');
    expect(xmlPrompt).toContain('<selection_payload format="json">');
    expect(xmlPrompt).toContain('"page_index":5');
    expect(xmlPrompt).not.toContain('请把荧光青柱子改为琥珀金');
  });

  it('supports whole-slide selection payload with full canvas bbox, all elements, and empty-slide fallback', () => {
    const deck = createSampleDeck();
    const pageIndex = DEFAULT_SAMPLE_PAGE_INDEX;
    const slide = deck.slides[pageIndex];

    const whole = buildWholeSlideSelectionPayload(deck, pageIndex, {
      timestamp: 1760000009999,
    });

    expect(whole.selection_mode).toBe('whole-slide');
    expect(whole.page_index).toBe(pageIndex);
    expect(whole.slide_id).toBe(slide.slide_id);
    expect(whole.bbox_pt).toEqual({
      x: 0,
      y: 0,
      w: deck.width_pt,
      h: deck.height_pt,
    });
    expect(whole.shape_ids).toEqual(slide.elements.map((e) => e.shape_id));
    expect(whole.shape_indices).toEqual(slide.elements.map((_, i) => i));
    expect(whole.recommended_tools).toContain('slide_set_page_properties');
    expect(whole.recommended_tools).toContain('slide_update_page_with_jsx');
    expect(whole.title).toContain('整页');
    expect(whole.description).toContain('整页');

    // Works cleanly even on an empty slide with 0 elements
    const emptyDeck = createEmptyDeck({ title: '空白封面' });
    emptyDeck.slides[0].elements = [];
    const emptyWhole = buildWholeSlideSelectionPayload(emptyDeck, 0, {
      timestamp: 1760000010000,
    });
    expect(emptyWhole.selection_mode).toBe('whole-slide');
    expect(emptyWhole.shape_ids).toEqual([]);
    expect(emptyWhole.bbox_pt).toEqual({
      x: 0,
      y: 0,
      w: emptyDeck.width_pt,
      h: emptyDeck.height_pt,
    });

    const event: DocumentSelectionEvent = {
      documentResourceUri: `dsh-resource://file/${deck.file_name}`,
      filePath: deck.file_path,
      fileType: 'pptx',
      consumerSurface: 'office',
      sequence: 9,
      sequenceEpoch: SELECTION_DEFAULT_SEQUENCE_EPOCH,
      selection: whole,
    };
    const block = createDocumentSelectionContextBlock(event);
    const prompt = renderTencentDocsSelectionPrompt(block, '把这一整页改成浅色极简风格');
    expect(prompt).toContain('@tdoc-selection#1760000009999 把这一整页改成浅色极简风格');
    expect(prompt).toContain('"selection_mode":"whole-slide"');
  });
});
