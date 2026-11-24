import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  ASPECT_RATIO_4_3,
  DEFAULT_SAMPLE_PAGE_INDEX,
  DeckEngine,
  OOXML_STANDARD_4_3_CX_EMU,
  OOXML_WIDESCREEN_CX_EMU,
  OOXML_WIDESCREEN_CY_EMU,
  createBlankPptxBuffer,
  createEmptyDeck,
  createSampleDeck,
  exportDeckToPptxBuffer,
  importDeckFromPptxBuffer,
} from '../src/core/index';

describe('OOXML (.pptx) Packaging & Round-Trip Fidelity', () => {
  it('generates valid blank 16:9 and 4:3 .pptx ZIP templates with standard EMU dimensions', async () => {
    const buf16 = await createBlankPptxBuffer({ title: '空白测试页' });
    const zip16 = await JSZip.loadAsync(buf16);

    expect(zip16.file('[Content_Types].xml')).not.toBeNull();
    expect(zip16.file('_rels/.rels')).not.toBeNull();
    expect(zip16.file('ppt/presentation.xml')).not.toBeNull();
    expect(zip16.file('ppt/slides/slide1.xml')).not.toBeNull();
    expect(zip16.file('ppt/notesSlides/notesSlide1.xml')).not.toBeNull();
    expect(zip16.file('ppt/dshStudio/index.json')).not.toBeNull();

    const presXml16 = await zip16.file('ppt/presentation.xml')!.async('string');
    expect(presXml16).toContain(`cx="${OOXML_WIDESCREEN_CX_EMU}"`);
    expect(presXml16).toContain(`cy="${OOXML_WIDESCREEN_CY_EMU}"`);

    const buf43 = await createBlankPptxBuffer({ aspect_ratio: ASPECT_RATIO_4_3 });
    const zip43 = await JSZip.loadAsync(buf43);
    const presXml43 = await zip43.file('ppt/presentation.xml')!.async('string');
    expect(presXml43).toContain(`cx="${OOXML_STANDARD_4_3_CX_EMU}"`);
  });

  it('exports multi-slide sample deck and re-imports losslessly via sidecar', async () => {
    const sample = createSampleDeck();
    const buf = await exportDeckToPptxBuffer(sample);
    const zip = await JSZip.loadAsync(buf);

    for (let i = 1; i <= sample.slides.length; i++) {
      expect(zip.file(`ppt/slides/slide${i}.xml`)).not.toBeNull();
      expect(zip.file(`ppt/notesSlides/notesSlide${i}.xml`)).not.toBeNull();
    }

    const restored = await importDeckFromPptxBuffer(buf, {
      fileName: '重导入测试.pptx',
      preferSidecar: true,
    });

    expect(restored.file_name).toBe('重导入测试.pptx');
    expect(restored.slides).toHaveLength(12);
    expect(restored.design_md).toBe(sample.design_md);
    expect(restored.theme_id).toBe(sample.theme_id);

    const restoredPage6 = restored.slides[DEFAULT_SAMPLE_PAGE_INDEX];
    const origPage6 = sample.slides[DEFAULT_SAMPLE_PAGE_INDEX];
    expect(restoredPage6.elements).toHaveLength(origPage6.elements.length);
    expect(restoredPage6.notes).toBe(origPage6.notes);

    const chart = restoredPage6.elements.find((e) => e.shape_id === 's6_chart_workload');
    expect(chart?.chart?.series[1].values).toEqual([32, 48, 66, 76]);
  });

  it('parses standard OOXML slide/table/notes XML cleanly when sidecar is disabled', async () => {
    const engine = new DeckEngine(createEmptyDeck({ title: 'OOXML 解析测试 & 验证 <1>' }));
    engine.setNotesText(0, '第一页备注：检查 "引号" 与 & 符号');
    engine.addShape(0, {
      shape_id: 'xml_box',
      x: 100,
      y: 300,
      w: 220,
      h: 70,
      fill_color: '11182B',
      border_color: '38E8D4',
      text: '框内文本',
    });
    engine.addTable(0, {
      x: 400,
      y: 300,
      w: 360,
      h: 140,
      data: [
        ['名称', '数值'],
        ['QPS', '12800'],
      ],
    });

    const buf = await exportDeckToPptxBuffer(engine.getDeck());
    const parsedFromXml = await importDeckFromPptxBuffer(buf, {
      fileName: '纯XML解析.pptx',
      preferSidecar: false,
    });

    expect(parsedFromXml.aspect_ratio).toBe(2);
    expect(parsedFromXml.width_pt).toBe(960);
    expect(parsedFromXml.height_pt).toBe(540);
    expect(parsedFromXml.slides).toHaveLength(1);

    const slide = parsedFromXml.slides[0];
    expect(slide.notes).toBe('第一页备注：检查 "引号" 与 & 符号');
    expect(slide.elements.some((e) => e.text?.content.includes('OOXML 解析测试 & 验证 <1>'))).toBe(true);
    expect(slide.elements.some((e) => e.shape_id === 'xml_box' && e.fill?.color === '11182B')).toBe(true);

    const tableEl = slide.elements.find((e) => e.type === 'table');
    expect(tableEl?.table?.rows).toBe(2);
    expect(tableEl?.table?.cols).toBe(2);
    expect(tableEl?.table?.cells[1][1].text).toBe('12800');
  });
});
