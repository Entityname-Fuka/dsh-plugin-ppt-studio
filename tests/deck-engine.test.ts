import { describe, expect, it } from 'vitest';
import {
  BUILTIN_THEMES,
  DEFAULT_SAMPLE_PAGE_INDEX,
  DeckEngine,
  DesignGateError,
  SLIDE_4_3_HEIGHT_PT,
  SLIDE_4_3_WIDTH_PT,
  SLIDE_CANVAS_HEIGHT_PT,
  SLIDE_CANVAS_WIDTH_PT,
  ZORDER_BRING_FORWARD_OP,
  ZORDER_BRING_TO_FRONT_OP,
  ZORDER_SEND_BACKWARD_OP,
  ZORDER_SEND_TO_BACK_OP,
  compileJsxPage,
  createEmptyDeck,
  createSampleDeck,
  normalizeColor,
} from '../src/core/index';

describe('DeckEngine & Core Model', () => {
  it('initializes 16:9 empty deck and 12-page sample deck with expected defaults', () => {
    const empty = createEmptyDeck({ title: '测试汇报' });
    expect(empty.aspect_ratio).toBe(2);
    expect(empty.width_pt).toBe(SLIDE_CANVAS_WIDTH_PT);
    expect(empty.height_pt).toBe(SLIDE_CANVAS_HEIGHT_PT);
    expect(empty.slides).toHaveLength(1);
    expect(empty.slides[0].elements.length).toBeGreaterThanOrEqual(2);

    const sample = createSampleDeck();
    expect(sample.slides).toHaveLength(12);
    expect(DEFAULT_SAMPLE_PAGE_INDEX).toBe(5);
    const page6 = sample.slides[DEFAULT_SAMPLE_PAGE_INDEX];
    expect(page6.elements.some((e) => e.shape_id === 's6_chart_workload')).toBe(true);
    expect(page6.elements.some((e) => e.shape_id === 's6_kpi_70pct')).toBe(true);

    const engine = new DeckEngine(empty);
    engine.setSlideSize(1);
    expect(engine.getDeck().width_pt).toBe(SLIDE_4_3_WIDTH_PT);
    expect(engine.getDeck().height_pt).toBe(SLIDE_4_3_HEIGHT_PT);
    engine.setSlideSize(2);
    expect(engine.getDeck().width_pt).toBe(SLIDE_CANVAS_WIDTH_PT);
  });

  it('enforces DESIGN.md gate before generating slides unless bypassed', () => {
    const engine = new DeckEngine(createEmptyDeck(), { requireDesignMd: true });

    expect(() => engine.addSlide({ title: '未授权页面' })).toThrow(DesignGateError);
    expect(() =>
      engine.addPageWithJsx({
        jsx: '<Slide title="未授权"><Text x={45} y={45} w={300} h={40}>Hi</Text></Slide>',
      })
    ).toThrow(DesignGateError);

    // Bypass works
    const bypassed = engine.addSlide({ title: '临时跳过', bypassDesignGate: true });
    expect(bypassed.page_index).toBe(1);

    // Setting DESIGN.md unlocks normal generation
    engine.setDesign('# DESIGN.md\n- Theme: Deep Ocean Tech');
    expect(engine.getInfo().has_design_md).toBe(true);
    const added = engine.addSlide({ title: '正式页面' });
    expect(added.page_index).toBe(2);
  });

  it('compiles JSX-like markup (including px->pt conversion) into 0-based SlideElements', () => {
    const theme = BUILTIN_THEMES[0];
    const page = compileJsxPage(
      `<Slide title="架构概览" unit="px" bg="#090D18">
        <Box x={80} y={120} w={480} h={240} fill="#11182B" border="#38E8D4" role="callout">
          <Text relative x={24} y={24} w={400} h={40} fontSize={20} bold={true} color="#F1F5F9">核心架构</Text>
        </Box>
        <Chart x={600} y={120} w={560} h={320} chartType="bar" title="吞吐量" categories={["Q1","Q2"]} series={[{"name":"V1","values":[30,75]}]} />
        <Table x={80} y={400} w={480} h={160} data={[["模块","延迟"],["索引","2ms"]]} />
        <Line x1={80} y1={380} x2={560} y2={380} lineType="arrow" color="#38E8D4" />
      </Slide>`,
      2,
      theme
    );

    expect(page.title).toBe('架构概览');
    expect(page.background.color).toBe('090D18');
    // Box x=80px -> 60pt, y=120px -> 90pt, w=480px -> 360pt
    expect(page.elements[0].bounds).toEqual({ x: 60, y: 90, w: 360, h: 180 });
    // Relative child Text: Box(60,90) + (18,18) = (78, 108)
    expect(page.elements[1].bounds.x).toBe(78);
    expect(page.elements[1].bounds.y).toBe(108);
    expect(page.elements[1].text?.content).toBe('核心架构');

    const chartEl = page.elements.find((e) => e.type === 'chart');
    expect(chartEl?.chart?.series[0].values).toEqual([30, 75]);
    const tableEl = page.elements.find((e) => e.type === 'table');
    expect(tableEl?.table?.rows).toBe(2);
    expect(tableEl?.table?.cells[1][1].text).toBe('2ms');

    // zIndex matches 0-based array index and shape_ids are unique
    const ids = new Set(page.elements.map((e) => e.shape_id));
    expect(ids.size).toBe(page.elements.length);
  });

  it('normalizes colors and validates addShape fill/border contract', () => {
    expect(normalizeColor('#38e8d4')).toBe('38E8D4');
    expect(normalizeColor('0af')).toBe('00AAFF');
    expect(normalizeColor('NONE')).toBe('none');
    expect(() => normalizeColor('invalid')).toThrow();

    const engine = new DeckEngine(createEmptyDeck());
    expect(() =>
      engine.addShape(0, { x: 20, y: 20, w: 100, h: 60 })
    ).toThrow();
    expect(() =>
      engine.addShape(0, {
        x: 20,
        y: 20,
        w: 100,
        h: 60,
        fill_color: 'none',
        border_color: 'none',
      })
    ).toThrow();

    const res = engine.addShape(0, {
      x: 40,
      y: 40,
      w: 160,
      h: 80,
      fill_color: '#11182b',
      border_color: '38E8D4',
      text: 'KPI Card',
    });
    expect(res.element.fill?.color).toBe('11182B');
    expect(res.element.border?.color).toBe('38E8D4');
  });

  it('supports single & batch setShapeProperties (Modes A/B/C), reorderShape, group/ungroup, and removeShapes', () => {
    const engine = new DeckEngine(createEmptyDeck());
    const s1 = engine.addShape(0, { shape_id: 'b1', x: 10, y: 10, w: 100, h: 50, fill_color: '11182B' });
    const s2 = engine.addShape(0, { shape_id: 'b2', x: 120, y: 10, w: 100, h: 50, fill_color: '11182B' });
    const s3 = engine.addShape(0, { shape_id: 'b3', x: 230, y: 10, w: 100, h: 50, fill_color: '11182B' });

    // Mode A: single
    engine.setShapeProperties(0, { shape_id: 'b1', fill_color: '#38e8d4', corner_radius: 12 });
    expect(engine.getShapeInfo(0, undefined, 'b1').fill?.color).toBe('38E8D4');

    // Mode B: 1-to-1 batch
    engine.setShapeProperties(0, {
      shape_indices: [s2.shape_index, s3.shape_index],
      updates: [{ w: 140 }, { w: 180 }],
    });
    expect(engine.getShapeInfo(0, s2.shape_index).bounds.w).toBe(140);
    expect(engine.getShapeInfo(0, s3.shape_index).bounds.w).toBe(180);

    // Mode B mismatch throws
    expect(() =>
      engine.setShapeProperties(0, {
        shape_indices: [s2.shape_index, s3.shape_index],
        updates: [{ w: 100 }],
      })
    ).toThrow();

    // Mode C: shared patch to multiple shapes
    engine.setShapeProperties(0, {
      shape_ids: ['b2', 'b3'],
      border_color: '846BFF',
      border_width: 2,
    });
    expect(engine.getShapeInfo(0, undefined, 'b2').border?.color).toBe('846BFF');
    expect(engine.getShapeInfo(0, undefined, 'b3').border?.color).toBe('846BFF');

    // Reorder z-order
    const front = engine.reorderShape(0, s1.shape_index, ZORDER_BRING_TO_FRONT_OP);
    expect(front.new_index).toBe(engine.getPageInfo(0).elements.length - 1);
    const back = engine.reorderShape(0, front.new_index, ZORDER_SEND_TO_BACK_OP);
    expect(back.new_index).toBe(0);
    const fwd = engine.reorderShape(0, 0, ZORDER_BRING_FORWARD_OP);
    expect(fwd.new_index).toBe(1);
    const bwd = engine.reorderShape(0, 1, ZORDER_SEND_BACKWARD_OP);
    expect(bwd.new_index).toBe(0);

    // Group & ungroup
    const grp = engine.groupShapes(0, [2, 3]);
    expect(engine.getShapeInfo(0, 2).groupId).toBe(grp.group_id);
    const ungrp = engine.ungroupShapes(0, grp.group_id);
    expect(ungrp.ungrouped_count).toBe(2);

    // Remove multiple shapes
    const beforeCount = engine.getPageInfo(0).elements.length;
    const removed = engine.removeShapes(0, [0, 2]);
    expect(removed.removed_ids).toHaveLength(2);
    expect(removed.remaining_count).toBe(beforeCount - 2);
  });

  it('handles text find/replace, 0-based tables, charts, animations, themes, notes, undo/redo, and AI edit rollback', () => {
    const engine = new DeckEngine(createEmptyDeck());
    const txt = engine.addText(0, {
      x: 50,
      y: 320,
      w: 300,
      h: 40,
      content: '旧版本指标 42%',
      font_color: 'FFFFFF',
    });
    engine.appendText(0, txt.shape_index, '补充说明');
    expect(engine.getText(0, txt.shape_index)?.content).toContain('补充说明');
    engine.setTextProperty(0, txt.shape_index, { font_size: 18, bold: true });

    const matches = engine.findText('旧版本');
    expect(matches).toHaveLength(1);
    const replaced = engine.findReplaceText('旧版本', '2026 新版本');
    expect(replaced.replacements).toBe(1);

    // Table (0-based cells)
    const tbl = engine.addTable(0, {
      x: 50,
      y: 380,
      w: 400,
      h: 120,
      data: [
        ['指标', 'Q1', 'Q2'],
        ['延迟', '45ms', '28ms'],
      ],
    });
    engine.setCellText(0, tbl.shape_index, 1, 2, '19ms');
    engine.setCellStyle(0, tbl.shape_index, 1, 2, { bold: true, font_color: '38E8D4' });
    engine.mergeTableCells(0, tbl.shape_index, 0, 1, 0, 2);
    const tableInfo = engine.getTableInfo(0, tbl.shape_index);
    expect(tableInfo.cells[1][2].text).toBe('19ms');
    expect(tableInfo.cells[0][1].colSpan).toBe(2);
    expect(tableInfo.cells[0][2].mergedInto).toEqual({ row: 0, col: 1 });
    expect(() => engine.setCellText(0, tbl.shape_index, 5, 0, 'OOB')).toThrow(RangeError);

    // Chart
    const ch = engine.addChart(0, {
      x: 480,
      y: 300,
      w: 420,
      h: 200,
      chart_type: 'bar',
      title: '推理占比',
      categories: ['2025', '2026'],
      series: [{ name: '推理', values: [60, 76], color: '38E8D4' }],
    });
    engine.updateChartData(0, ch.shape_index, {
      series: [{ name: '推理', values: [62, 80] }],
    });
    engine.changeChartType(0, ch.shape_index, 'line');
    engine.updateChartSeriesStyle(0, ch.shape_index, 0, { color: '846BFF' });
    const chartInfo = engine.getChartInfo(0, ch.shape_index);
    expect(chartInfo.chartType).toBe('line');
    expect(chartInfo.series[0].values).toEqual([62, 80]);
    expect(chartInfo.series[0].color).toBe('846BFF');

    // Animations & Notes & Theme
    const anim = engine.addAnim(0, ch.shape_index, { anim_type: 'fadeIn', duration_ms: 600 });
    expect(engine.getShapeInfo(0, ch.shape_index).animations).toHaveLength(1);
    engine.removeAnim(0, ch.shape_index, anim.anim_id);
    expect(engine.getShapeInfo(0, ch.shape_index).animations).toHaveLength(0);

    engine.setNotesText(0, '演讲备注第一段');
    expect(engine.getNotesText(0)).toBe('演讲备注第一段');

    engine.setTheme('deep-ocean-tech');
    expect(engine.getPageInfo(0).background.color).toBe('090D18');

    // Undo / Redo
    expect(engine.canUndo()).toBe(true);
    engine.undo();
    expect(engine.getDeck().theme_id).not.toBe('deep-ocean-tech');
    expect(engine.canRedo()).toBe(true);
    engine.redo();
    expect(engine.getDeck().theme_id).toBe('deep-ocean-tech');

    // Tracked AI Edit & Rollback
    const { edit } = engine.runTrackedAiEdit(
      'slide_set_text',
      '将标题修改为 AI 改写版',
      () => engine.setText(0, 0, 'AI 改写后标题'),
      { page_index: 0, shape_ids: ['s1_title'] }
    );
    expect(engine.getText(0, 0)?.content).toBe('AI 改写后标题');
    expect(engine.listRecentAiEdits(5)[0].edit_id).toBe(edit.edit_id);

    const reverted = engine.undoAiEdit(edit.edit_id);
    expect(reverted.reverted_edit.reverted).toBe(true);
    expect(engine.getText(0, 0)?.content).not.toBe('AI 改写后标题');
  });

  it('enforces ADR-0001 dual-channel undo isolation across manual edits, external sync baseline resets, and undoAiEdit', () => {
    const engine = new DeckEngine(createEmptyDeck({ title: '双通道测试' }));
    expect(engine.canUndo()).toBe(false);
    expect(engine.canRedo()).toBe(false);

    // 1. Manual edits can be undone and redone
    const added = engine.addText(0, {
      x: 80,
      y: 340,
      w: 240,
      h: 40,
      content: '手动文本 V1',
      font_color: 'F1F5F9',
    });
    engine.setText(0, added.shape_index, '手动文本 V2');
    expect(engine.canUndo()).toBe(true);

    engine.undo();
    expect(engine.getText(0, added.shape_index)?.content).toBe('手动文本 V1');
    expect(engine.canRedo()).toBe(true);

    engine.redo();
    expect(engine.getText(0, added.shape_index)?.content).toBe('手动文本 V2');

    // 2. External/AI deck sync via resetToBaseline clears manual undo/redo stacks without pushing
    const syncedDeck = engine.getDeck();
    syncedDeck.version += 1;
    syncedDeck.slides[0].title = '外部同步基线页';
    engine.resetToBaseline(syncedDeck);
    expect(engine.canUndo()).toBe(false);
    expect(engine.canRedo()).toBe(false);
    const beforeNoopUndo = engine.getDeck();
    engine.undo();
    expect(engine.getDeck().slides[0].title).toBe('外部同步基线页');
    expect(engine.getDeck().version).toBe(beforeNoopUndo.version);

    // loadDeck(..., { resetHistory: true }) also establishes a clean baseline
    engine.addText(0, { x: 90, y: 380, w: 200, h: 36, content: '临时文本' });
    expect(engine.canUndo()).toBe(true);
    engine.loadDeck(syncedDeck, { resetHistory: true });
    expect(engine.canUndo()).toBe(false);
    expect(engine.canRedo()).toBe(false);

    // 3. runTrackedAiEdit establishes a new Manual Undo Baseline
    engine.addShape(0, {
      shape_id: 'manual_before_ai',
      x: 60,
      y: 320,
      w: 120,
      h: 60,
      fill_color: '11182B',
    });
    expect(engine.canUndo()).toBe(true);

    const { edit } = engine.runTrackedAiEdit(
      'slide_set_text',
      'AI 改写主标题',
      () => engine.setText(0, 0, 'AI 主标题结果'),
      { page_index: 0, shape_ids: ['s1_title'] }
    );
    expect(engine.getText(0, 0)?.content).toBe('AI 主标题结果');
    // Manual undo MUST NOT touch the AI edit or pre-AI manual edits
    expect(engine.canUndo()).toBe(false);
    expect(engine.canRedo()).toBe(false);

    // 4. Subsequent manual edit only undoes back to the AI baseline
    engine.addShape(0, {
      shape_id: 'manual_after_ai',
      x: 220,
      y: 320,
      w: 120,
      h: 60,
      fill_color: '38E8D4',
    });
    expect(engine.canUndo()).toBe(true);
    engine.undo();
    expect(engine.getPageInfo(0).elements.some((e) => e.shape_id === 'manual_after_ai')).toBe(false);
    expect(engine.getText(0, 0)?.content).toBe('AI 主标题结果');
    expect(engine.canUndo()).toBe(false);

    // 5. undoAiEdit reverts AI change independently and establishes a new manual baseline
    engine.addShape(0, {
      shape_id: 'manual_before_ai_revert',
      x: 360,
      y: 320,
      w: 120,
      h: 60,
      fill_color: '846BFF',
    });
    expect(engine.canUndo()).toBe(true);

    const aiReverted = engine.undoAiEdit(edit.edit_id);
    expect(aiReverted.reverted_edit.reverted).toBe(true);
    expect(engine.getText(0, 0)?.content).not.toBe('AI 主标题结果');
    expect(engine.canUndo()).toBe(false);
    expect(engine.canRedo()).toBe(false);
  });

  it('tracks labeled manual history, atomic transactions, renameDeck, no-op guards, multi-step jumps, and 100-step capacity', () => {
    const engine = new DeckEngine(createEmptyDeck({ title: '全量撤回测试' }));

    // 1. Atomic transaction groups multi-element updates into 1 labeled entry
    engine.runTransaction(
      '批量修改文字样式',
      () => {
        engine.setTextProperty(0, 0, { bold: false, font_size: 40 });
        engine.setTextProperty(0, 1, { italic: true, font_size: 18 });
      },
      { page_index: 0 }
    );
    expect(engine.getManualHistory().undo).toHaveLength(1);
    expect(engine.getManualHistory().undo[0].label).toBe('批量修改文字样式');
    expect(engine.getManualHistory().undo[0].page_index).toBe(0);

    // 2. No-op transaction and no-op text/notes edits do not push empty records
    engine.runTransaction(
      '移动元素',
      () => {
        const b = engine.getPageInfo(0).elements[0].bounds;
        engine.setShapeProperties(0, {
          shape_id: engine.getPageInfo(0).elements[0].shape_id,
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
        });
      },
      { page_index: 0 }
    );
    engine.setText(0, 0, engine.getText(0, 0)!.content);
    engine.setNotesText(0, '');
    expect(engine.getManualHistory().undo).toHaveLength(1);

    // 3. Move, notes edit, and renameDeck are all recorded with metadata
    const origX = engine.getPageInfo(0).elements[0].bounds.x;
    engine.runTransaction(
      '移动元素',
      () => {
        engine.setShapeProperties(0, { shape_index: 0, x: origX + 42 });
      },
      { page_index: 0 }
    );
    engine.runTransaction(
      '粘贴演讲者备注',
      () => {
        engine.setNotesText(0, '第一段演讲备注');
      },
      { page_index: 0 }
    );
    engine.renameDeck('重命名后的演示.pptx', '/workspace/重命名后的演示.pptx');

    const hist = engine.getManualHistory();
    expect(hist.undo.map((h) => h.label)).toEqual([
      '重命名文档',
      '粘贴演讲者备注',
      '移动元素',
      '批量修改文字样式',
    ]);

    // 4. Multi-step undo & redo preserve redo stack and restore exact states
    const jumpedBack = engine.undoSteps(3);
    expect(jumpedBack.count).toBe(3);
    expect(jumpedBack.lastEntry?.label).toBe('移动元素');
    expect(engine.getDeck().file_name).toBe('新建演示文稿.pptx');
    expect(engine.getNotesText(0)).toBe('');
    expect(engine.getPageInfo(0).elements[0].bounds.x).toBe(origX);
    expect(engine.getManualHistory().undo).toHaveLength(1);
    expect(engine.getManualHistory().redo).toHaveLength(3);

    const jumpedForward = engine.redoSteps(2);
    expect(jumpedForward.count).toBe(2);
    expect(engine.getPageInfo(0).elements[0].bounds.x).toBe(origX + 42);
    expect(engine.getNotesText(0)).toBe('第一段演讲备注');
    expect(engine.getDeck().file_name).toBe('新建演示文稿.pptx');

    // 5. Default capacity supports up to 100 manual undo steps
    const capEngine = new DeckEngine(createEmptyDeck());
    for (let i = 1; i <= 105; i++) {
      capEngine.setNotesText(0, `备注 ${i}`);
    }
    expect(capEngine.getManualHistory().undo).toHaveLength(100);
  });
});
