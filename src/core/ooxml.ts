import JSZip from 'jszip';
import {
  ASPECT_RATIO_16_9,
  ASPECT_RATIO_4_3,
  DEFAULT_FONT_FAMILY,
  OOXML_STANDARD_4_3_CX_EMU,
  OOXML_STANDARD_4_3_CY_EMU,
  OOXML_WIDESCREEN_CX_EMU,
  OOXML_WIDESCREEN_CY_EMU,
  SLIDE_4_3_HEIGHT_PT,
  SLIDE_4_3_WIDTH_PT,
  SLIDE_CANVAS_HEIGHT_PT,
  SLIDE_CANVAS_WIDTH_PT,
  emuToPt,
  normalizeColor,
  ptToEmu,
} from './constants';
import { cloneDeck, createEmptyDeck } from './deck-engine';
import type {
  PresentationDeck,
  ShapeKind,
  SlideElement,
  SlidePage,
  TableCell,
} from './types';

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(str: string): string {
  return String(str)
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="DSH Studio Theme">
  <a:themeElements>
    <a:clrScheme name="DSH">
      <a:dk1><a:srgbClr val="090D18"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="11182B"/></a:dk2>
      <a:lt2><a:srgbClr val="F1F5F9"/></a:lt2>
      <a:accent1><a:srgbClr val="38E8D4"/></a:accent1>
      <a:accent2><a:srgbClr val="846BFF"/></a:accent2>
      <a:accent3><a:srgbClr val="F59E0B"/></a:accent3>
      <a:accent4><a:srgbClr val="38BDF8"/></a:accent4>
      <a:accent5><a:srgbClr val="10B981"/></a:accent5>
      <a:accent6><a:srgbClr val="EC4899"/></a:accent6>
      <a:hlink><a:srgbClr val="38E8D4"/></a:hlink>
      <a:folHlink><a:srgbClr val="846BFF"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="DSH">
      <a:majorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Microsoft YaHei"/></a:majorFont>
      <a:minorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Microsoft YaHei"/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="DSH">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;

const SLIDE_MASTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`;

const SLIDE_MASTER_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const SLIDE_LAYOUT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
</p:sldLayout>`;

const SLIDE_LAYOUT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

function mapShapeKindToPrst(kind?: ShapeKind): string {
  switch (kind) {
    case 'roundRect':
      return 'roundRect';
    case 'ellipse':
      return 'ellipse';
    case 'triangle':
      return 'triangle';
    case 'rightArrow':
      return 'rightArrow';
    case 'leftArrow':
      return 'leftArrow';
    case 'diamond':
      return 'diamond';
    default:
      return 'rect';
  }
}

function buildTextBodyXml(el: SlideElement): string {
  const txt = el.text;
  if (!txt) {
    return `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody>`;
  }
  const algn =
    txt.align === 'center' ? 'ctr' : txt.align === 'right' ? 'r' : 'l';
  const anchor =
    txt.vAlign === 'middle' ? 'ctr' : txt.vAlign === 'bottom' ? 'b' : 't';
  const sz = Math.round((txt.fontSize || 14) * 100);
  const color = normalizeColor(txt.fontColor, 'F1F5F9');
  const fontColorXml =
    color === 'none'
      ? ''
      : `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
  const bAttr = txt.bold ? ' b="1"' : '';
  const iAttr = txt.italic ? ' i="1"' : '';
  const uAttr = txt.underline ? ' u="sng"' : '';
  const paragraphs = (txt.content || '').split(/\r?\n/);

  const pXml = paragraphs
    .map(
      (line) =>
        `<a:p><a:pPr algn="${algn}"/><a:r><a:rPr lang="zh-CN" sz="${sz}"${bAttr}${iAttr}${uAttr} dirty="0">${fontColorXml}</a:rPr><a:t>${escapeXml(line)}</a:t></a:r></a:p>`
    )
    .join('');

  return `<p:txBody><a:bodyPr wrap="square" anchor="${anchor}"/><a:lstStyle/>${pXml}</p:txBody>`;
}

function buildChartGroupXml(
  el: SlideElement,
  allocId: () => number,
): string {
  const chart = el.chart!;
  const bx = el.bounds.x;
  const by = el.bounds.y;
  const bw = el.bounds.w;
  const bh = el.bounds.h;

  const xEmu = ptToEmu(bx);
  const yEmu = ptToEmu(by);
  const cxEmu = Math.max(12700, ptToEmu(bw));
  const cyEmu = Math.max(12700, ptToEmu(bh));

  const children: string[] = [];
  const pushRect = (
    name: string,
    x: number,
    y: number,
    w: number,
    h: number,
    fillHex: string,
    borderHex?: string,
    prst: 'rect' | 'roundRect' = 'rect',
  ) => {
    const id = allocId();
    const ln = borderHex
      ? `<a:ln w="9525"><a:solidFill><a:srgbClr val="${normalizeColor(borderHex)}"/></a:solidFill></a:ln>`
      : '';
    children.push(`<p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="${ptToEmu(x)}" y="${ptToEmu(y)}"/><a:ext cx="${Math.max(12700, ptToEmu(w))}" cy="${Math.max(12700, ptToEmu(h))}"/></a:xfrm>
        <a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>
        <a:solidFill><a:srgbClr val="${normalizeColor(fillHex)}"/></a:solidFill>
        ${ln}
      </p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody>
    </p:sp>`);
  };

  const pushLabel = (
    name: string,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    fontSize: number,
    colorHex: string,
    align: 'l' | 'ctr' | 'r' = 'ctr',
    bold = false,
  ) => {
    const id = allocId();
    const sz = Math.round(fontSize * 100);
    children.push(`<p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="${ptToEmu(x)}" y="${ptToEmu(y)}"/><a:ext cx="${Math.max(12700, ptToEmu(w))}" cy="${Math.max(12700, ptToEmu(h))}"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:noFill/>
      </p:spPr>
      <p:txBody>
        <a:bodyPr wrap="square" anchor="ctr" lIns="0" tIns="0" rIns="0" bIns="0"/>
        <a:lstStyle/>
        <a:p><a:pPr algn="${align}"/><a:r><a:rPr lang="zh-CN" sz="${sz}"${bold ? ' b="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${normalizeColor(colorHex)}"/></a:solidFill></a:rPr><a:t>${escapeXml(text)}</a:t></a:r></a:p>
      </p:txBody>
    </p:sp>`);
  };

  // 1. Card background
  pushRect(
    `${el.shape_id}_bg`,
    bx,
    by,
    bw,
    bh,
    el.fill?.color && el.fill.color !== 'none' ? el.fill.color : '11182B',
    el.border?.color && el.border.color !== 'none' ? el.border.color : '253759',
    'roundRect',
  );

  // 2. Title
  if (chart.title) {
    pushLabel(`${el.shape_id}_title`, bx + 16, by + 12, bw - 32, 24, chart.title, 13, 'F8FAFC', 'l', true);
  }

  // 3. Legend
  const defaultColors = ['38E8D4', '846BFF', 'F59E0B', '10B981', '38BDF8'];
  const series = chart.series ?? [];
  const categories = chart.categories ?? [];
  let legendX = bx + 16;
  const legendY = by + (chart.title ? 40 : 14);
  series.forEach((s, si) => {
    const color = s.color || defaultColors[si % defaultColors.length];
    pushRect(`${el.shape_id}_lg_sw_${si}`, legendX, legendY + 4, 10, 10, color);
    const lblW = Math.min(140, Math.max(54, s.name.length * 11 + 14));
    pushLabel(`${el.shape_id}_lg_tx_${si}`, legendX + 14, legendY, lblW, 18, s.name, 10, 'CBD5E1', 'l');
    legendX += lblW + 22;
  });

  // 4. Plot area
  const plotX = bx + 28;
  const plotY = legendY + 26;
  const plotW = Math.max(80, bw - 56);
  const plotH = Math.max(60, bh - (plotY - by) - 42);
  const maxVal = Math.max(
    1,
    chart.yAxisMax ?? 0,
    ...series.flatMap((s) => s.values.map((v) => (Number.isFinite(v) ? v : 0))),
  );

  // Gridlines & baseline
  for (let g = 0; g <= 3; g++) {
    const gy = plotY + (plotH * g) / 3;
    pushRect(`${el.shape_id}_grid_${g}`, plotX, gy, plotW, g === 3 ? 1.2 : 0.6, g === 3 ? '334155' : '1E293B');
  }

  // 5. Bars per category
  const catCount = Math.max(1, categories.length);
  const serCount = Math.max(1, series.length);
  const groupW = plotW / catCount;
  const barGap = 4;
  const barW = Math.max(8, Math.min(34, (groupW * 0.68 - barGap * (serCount - 1)) / serCount));
  const totalBarsW = barW * serCount + barGap * (serCount - 1);

  categories.forEach((cat, ci) => {
    const groupStartX = plotX + ci * groupW + (groupW - totalBarsW) / 2;
    series.forEach((s, si) => {
      const val = Number(s.values[ci] ?? 0);
      const ratio = Math.max(0.03, Math.min(1, val / maxVal));
      const barH = Math.max(4, plotH * ratio);
      const xBar = groupStartX + si * (barW + barGap);
      const yBar = plotY + plotH - barH;
      const color = s.color || defaultColors[si % defaultColors.length];
      pushRect(`${el.shape_id}_bar_${ci}_${si}`, xBar, yBar, barW, barH, color);
      pushLabel(
        `${el.shape_id}_val_${ci}_${si}`,
        xBar - 6,
        Math.max(plotY - 14, yBar - 16),
        barW + 12,
        14,
        `${val}${chart.unit ?? ''}`,
        9,
        'E2E8F0',
        'ctr',
        true,
      );
    });
    pushLabel(
      `${el.shape_id}_cat_${ci}`,
      plotX + ci * groupW,
      plotY + plotH + 6,
      groupW,
      24,
      cat,
      10,
      'CBD5E1',
      'ctr',
    );
  });

  const grpId = allocId();
  return `<p:grpSp>
    <p:nvGrpSpPr>
      <p:cNvPr id="${grpId}" name="${escapeXml(el.shape_id)}"/>
      <p:cNvGrpSpPr/>
      <p:nvPr/>
    </p:nvGrpSpPr>
    <p:grpSpPr>
      <a:xfrm>
        <a:off x="${xEmu}" y="${yEmu}"/>
        <a:ext cx="${cxEmu}" cy="${cyEmu}"/>
        <a:chOff x="${xEmu}" y="${yEmu}"/>
        <a:chExt cx="${cxEmu}" cy="${cyEmu}"/>
      </a:xfrm>
    </p:grpSpPr>
    ${children.join('\n')}
  </p:grpSp>`;
}

function buildShapeXml(el: SlideElement, allocId: () => number): string {
  if (el.type === 'chart' && el.chart) {
    return buildChartGroupXml(el, allocId);
  }
  const numericId = allocId();
  const x = ptToEmu(el.bounds.x);
  const y = ptToEmu(el.bounds.y);
  const cx = Math.max(12700, ptToEmu(el.bounds.w));
  const cy = Math.max(12700, ptToEmu(el.bounds.h));
  const isTextOnly = el.type === 'text';
  const prst = mapShapeKindToPrst(el.shapeType);
  const rotAttr = el.rotation ? ` rot="${Math.round(el.rotation * 60000)}"` : '';

  let fillXml = '<a:noFill/>';
  if (el.fill && el.fill.color !== 'none') {
    const color = normalizeColor(el.fill.color);
    const alphaAttr =
      el.fill.alpha && el.fill.alpha > 0
        ? `<a:alpha val="${Math.round((100 - el.fill.alpha) * 1000)}"/>`
        : '';
    fillXml = `<a:solidFill><a:srgbClr val="${color}">${alphaAttr}</a:srgbClr></a:solidFill>`;
  }

  let lnXml = '';
  if (el.type === 'line' && el.line) {
    const lc = normalizeColor(el.line.color, '38E8D4');
    const lw = ptToEmu(el.line.width || 1.5);
    lnXml = `<a:ln w="${lw}"><a:solidFill><a:srgbClr val="${lc}"/></a:solidFill></a:ln>`;
  } else if (el.border && el.border.color !== 'none') {
    const bc = normalizeColor(el.border.color);
    const bw = ptToEmu(el.border.width ?? 1);
    lnXml = `<a:ln w="${bw}"><a:solidFill><a:srgbClr val="${bc}"/></a:solidFill></a:ln>`;
  }

  if (el.type === 'table' && el.table) {
    return buildTableGraphicFrameXml(el, numericId);
  }

  return `<p:sp>
    <p:nvSpPr>
      <p:cNvPr id="${numericId}" name="${escapeXml(el.shape_id)}"/>
      <p:cNvSpPr${isTextOnly ? ' txBox="1"' : ''}/>
      <p:nvPr/>
    </p:nvSpPr>
    <p:spPr>
      <a:xfrm${rotAttr}><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
      <a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>
      ${fillXml}
      ${lnXml}
    </p:spPr>
    ${buildTextBodyXml(el)}
  </p:sp>`;
}

function buildTableGraphicFrameXml(el: SlideElement, numericId: number): string {
  const table = el.table!;
  const x = ptToEmu(el.bounds.x);
  const y = ptToEmu(el.bounds.y);
  const cx = Math.max(12700, ptToEmu(el.bounds.w));
  const cy = Math.max(12700, ptToEmu(el.bounds.h));
  const colW = Math.round(cx / Math.max(1, table.cols));
  const rowH = Math.round(cy / Math.max(1, table.rows));

  const gridCols = Array.from(
    { length: table.cols },
    () => `<a:gridCol w="${colW}"/>`
  ).join('');

  const rowsXml = table.cells
    .map((row) => {
      const cellsXml = row
        .map((cell) => {
          const fill = cell.bgColor
            ? `<a:solidFill><a:srgbClr val="${normalizeColor(cell.bgColor)}"/></a:solidFill>`
            : '<a:noFill/>';
          const sz = Math.round((cell.fontSize ?? 11) * 100);
          const fc = normalizeColor(cell.fontColor, 'F1F5F9');
          const bAttr = cell.bold ? ' b="1"' : '';
          return `<a:tc>
            <a:txBody>
              <a:bodyPr/>
              <a:lstStyle/>
              <a:p><a:r><a:rPr lang="zh-CN" sz="${sz}"${bAttr}><a:solidFill><a:srgbClr val="${fc}"/></a:solidFill></a:rPr><a:t>${escapeXml(cell.text)}</a:t></a:r></a:p>
            </a:txBody>
            <a:tcPr>${fill}</a:tcPr>
          </a:tc>`;
        })
        .join('');
      return `<a:tr h="${rowH}">${cellsXml}</a:tr>`;
    })
    .join('');

  return `<p:graphicFrame>
    <p:nvGraphicFramePr>
      <p:cNvPr id="${numericId}" name="${escapeXml(el.shape_id)}"/>
      <p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>
      <p:nvPr/>
    </p:nvGraphicFramePr>
    <p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></p:xfrm>
    <a:graphic>
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
        <a:tbl>
          <a:tblPr firstRow="1" bandRow="1"/>
          <a:tblGrid>${gridCols}</a:tblGrid>
          ${rowsXml}
        </a:tbl>
      </a:graphicData>
    </a:graphic>
  </p:graphicFrame>`;
}

function buildSlideXml(slide: SlidePage): string {
  const bgHex = normalizeColor(slide.background?.color, 'FFFFFF');
  const bgXml =
    bgHex === 'none'
      ? ''
      : `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bgHex}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;

  let nextId = 2;
  const allocId = () => nextId++;
  const shapesXml = slide.elements
    .map((el) => buildShapeXml(el, allocId))
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="${escapeXml(slide.title)}">
    ${bgXml}
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      ${shapesXml}
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

function buildNotesSlideXml(notes: string): string {
  const paragraphs = (notes || '').split(/\r?\n/);
  const pXml = paragraphs
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="zh-CN"/><a:t>${escapeXml(line)}</a:t></a:r></a:p>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/>${pXml}</p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>`;
}

export async function createBlankPptxBuffer(options?: {
  aspect_ratio?: 1 | 2;
  title?: string;
}): Promise<Uint8Array> {
  const deck = createEmptyDeck({
    aspect_ratio: options?.aspect_ratio ?? ASPECT_RATIO_16_9,
    title: options?.title ?? '空白演示文稿',
  });
  return exportDeckToPptxBuffer(deck);
}

export async function exportDeckToPptxBuffer(
  deck: PresentationDeck
): Promise<Uint8Array> {
  const zip = new JSZip();

  const cx =
    deck.aspect_ratio === ASPECT_RATIO_4_3
      ? OOXML_STANDARD_4_3_CX_EMU
      : OOXML_WIDESCREEN_CX_EMU;
  const cy =
    deck.aspect_ratio === ASPECT_RATIO_4_3
      ? OOXML_STANDARD_4_3_CY_EMU
      : OOXML_WIDESCREEN_CY_EMU;
  const szType = deck.aspect_ratio === ASPECT_RATIO_4_3 ? 'screen4x3' : 'screen16x9';

  const slideCount = deck.slides.length;
  const slideOverrides = deck.slides
    .map(
      (_, i) =>
        `  <Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`
    )
    .join('\n');

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="json" ContentType="application/json"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${slideOverrides}
</Types>`;

  const sldIdLst = deck.slides
    .map(
      (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`
    )
    .join('');

  const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${sldIdLst}</p:sldIdLst>
  <p:sldSz cx="${cx}" cy="${cy}" type="${szType}"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;

  const slideRelsEntries = deck.slides
    .map(
      (_, i) =>
        `  <Relationship Id="rId${i + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`
    )
    .join('\n');

  const presentationRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
${slideRelsEntries}
</Relationships>`;

  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', RELS_XML);
  zip.file('ppt/presentation.xml', presentationXml);
  zip.file('ppt/_rels/presentation.xml.rels', presentationRelsXml);
  zip.file('ppt/theme/theme1.xml', THEME_XML);
  zip.file('ppt/slideMasters/slideMaster1.xml', SLIDE_MASTER_XML);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', SLIDE_MASTER_RELS_XML);
  zip.file('ppt/slideLayouts/slideLayout1.xml', SLIDE_LAYOUT_XML);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', SLIDE_LAYOUT_RELS_XML);

  for (let i = 0; i < slideCount; i++) {
    const slide = deck.slides[i];
    const num = i + 1;
    zip.file(`ppt/slides/slide${num}.xml`, buildSlideXml(slide));
    zip.file(
      `ppt/slides/_rels/slide${num}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${num}.xml"/>
</Relationships>`
    );
    zip.file(`ppt/notesSlides/notesSlide${num}.xml`, buildNotesSlideXml(slide.notes));
    zip.file(
      `ppt/notesSlides/_rels/notesSlide${num}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${num}.xml"/>
</Relationships>`
    );
  }

  // Lossless structured sidecar for DSH Studio round-trip fidelity
  const sidecarDeck = cloneDeck(deck);
  zip.file('ppt/dshStudio/index.json', JSON.stringify(sidecarDeck, null, 2));

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

function extractAttr(tag: string, attrName: string): string | undefined {
  const re = new RegExp(`\\b${attrName}="([^"]*)"`, 'i');
  const m = tag.match(re);
  return m ? unescapeXml(m[1]) : undefined;
}

function extractAllTextFromXml(xmlFragment: string): string {
  const paragraphs: string[] = [];
  const pMatches = xmlFragment.match(/<a:p\b[\s\S]*?<\/a:p>/g);
  if (pMatches && pMatches.length > 0) {
    for (const p of pMatches) {
      const tMatches = [...p.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)];
      paragraphs.push(tMatches.map((m) => unescapeXml(m[1])).join(''));
    }
    return paragraphs.join('\n').trim();
  }
  const tMatches = [...xmlFragment.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)];
  return tMatches.map((m) => unescapeXml(m[1])).join('').trim();
}

function parseSlideXmlToPage(
  slideXml: string,
  slideIndex: number,
  notesText: string
): SlidePage {
  const cSldTag = slideXml.match(/<p:cSld\b[^>]*>/)?.[0] ?? '';
  const slideTitle =
    extractAttr(cSldTag, 'name') || `幻灯片 ${slideIndex + 1}`;

  const bgMatch = slideXml.match(/<p:bg>[\s\S]*?<\/p:bg>/);
  const bgColorMatch = bgMatch?.[0].match(/<a:srgbClr\s+val="([0-9a-fA-F]{6})"/);
  const bgColor = bgColorMatch ? bgColorMatch[1].toUpperCase() : 'FFFFFF';

  const elements: SlideElement[] = [];

  // Parse <p:sp> shapes/textboxes
  const spMatches = slideXml.match(/<p:sp\b[\s\S]*?<\/p:sp>/g) ?? [];
  spMatches.forEach((sp, idx) => {
    const cNvPr = sp.match(/<p:cNvPr\b[^>]*>/)?.[0] ?? '';
    const shapeName = extractAttr(cNvPr, 'name');
    const cNvSpPr = sp.match(/<p:cNvSpPr\b[^>]*>/)?.[0] ?? '';
    const isTxBox = extractAttr(cNvSpPr, 'txBox') === '1';

    const offTag = sp.match(/<a:off\b[^>]*>/)?.[0] ?? '';
    const extTag = sp.match(/<a:ext\b[^>]*>/)?.[0] ?? '';
    const x = emuToPt(Number(extractAttr(offTag, 'x') ?? 0));
    const y = emuToPt(Number(extractAttr(offTag, 'y') ?? 0));
    const w = Math.max(10, emuToPt(Number(extractAttr(extTag, 'cx') ?? 127000)));
    const h = Math.max(10, emuToPt(Number(extractAttr(extTag, 'cy') ?? 127000)));

    const prstTag = sp.match(/<a:prstGeom\b[^>]*>/)?.[0] ?? '';
    const prst = (extractAttr(prstTag, 'prst') ?? 'rect') as ShapeKind;

    const spPrBlock = sp.match(/<p:spPr>[\s\S]*?<\/p:spPr>/)?.[0] ?? '';
    const fillBlock = spPrBlock.match(/<a:solidFill>[\s\S]*?<\/a:solidFill>/)?.[0];
    const fillHex = fillBlock?.match(/val="([0-9a-fA-F]{6})"/)?.[1];

    const lnBlock = spPrBlock.match(/<a:ln\b[\s\S]*?<\/a:ln>/)?.[0];
    const borderHex = lnBlock?.match(/val="([0-9a-fA-F]{6})"/)?.[1];
    const lnTag = lnBlock?.match(/<a:ln\b[^>]*>/)?.[0] ?? '';
    const borderWidthEmu = Number(extractAttr(lnTag, 'w') ?? 12700);

    const txBody = sp.match(/<p:txBody>[\s\S]*?<\/p:txBody>/)?.[0] ?? '';
    const textContent = extractAllTextFromXml(txBody);
    const rPrTag = txBody.match(/<a:rPr\b[^>]*>/)?.[0] ?? '';
    const szAttr = extractAttr(rPrTag, 'sz');
    const fontSize = szAttr ? Math.round(Number(szAttr) / 100) : 14;
    const bold = extractAttr(rPrTag, 'b') === '1';
    const italic = extractAttr(rPrTag, 'i') === '1';
    const fontHex =
      txBody.match(/<a:rPr\b[\s\S]*?<a:srgbClr\s+val="([0-9a-fA-F]{6})"/)?.[1] ??
      (bgColor === 'FFFFFF' ? '111827' : 'F1F5F9');

    const el: SlideElement = {
      shape_id:
        shapeName && /^[A-Za-z0-9_-]+$/.test(shapeName)
          ? shapeName
          : `s${slideIndex + 1}_el_${idx + 1}`,
      type: isTxBox || (!fillHex && !borderHex && textContent) ? 'text' : 'shape',
      name: shapeName || undefined,
      bounds: { x, y, w, h },
      zIndex: elements.length,
      shapeType: prst,
      fill: fillHex ? { color: fillHex.toUpperCase(), alpha: 0 } : undefined,
      border: borderHex
        ? { color: borderHex.toUpperCase(), width: emuToPt(borderWidthEmu) }
        : undefined,
    };

    if (textContent) {
      el.text = {
        content: textContent,
        fontName: DEFAULT_FONT_FAMILY,
        fontSize,
        fontColor: fontHex.toUpperCase(),
        bold,
        italic,
        align: 'left',
        vAlign: 'top',
      };
    }

    elements.push(el);
  });

  // Parse <p:graphicFrame> containing <a:tbl>
  const gfMatches =
    slideXml.match(/<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g) ?? [];
  gfMatches.forEach((gf, idx) => {
    const tbl = gf.match(/<a:tbl>[\s\S]*?<\/a:tbl>/)?.[0];
    if (!tbl) return;
    const offTag = gf.match(/<a:off\b[^>]*>/)?.[0] ?? '';
    const extTag = gf.match(/<a:ext\b[^>]*>/)?.[0] ?? '';
    const x = emuToPt(Number(extractAttr(offTag, 'x') ?? 0));
    const y = emuToPt(Number(extractAttr(offTag, 'y') ?? 0));
    const w = Math.max(40, emuToPt(Number(extractAttr(extTag, 'cx') ?? 2540000)));
    const h = Math.max(30, emuToPt(Number(extractAttr(extTag, 'cy') ?? 1270000)));

    const trMatches = tbl.match(/<a:tr\b[\s\S]*?<\/a:tr>/g) ?? [];
    const cells: TableCell[][] = trMatches.map((tr, rIdx) => {
      const tcMatches = tr.match(/<a:tc\b[\s\S]*?<\/a:tc>/g) ?? [];
      return tcMatches.map((tc) => ({
        text: extractAllTextFromXml(tc),
        bold: rIdx === 0,
        fontSize: rIdx === 0 ? 12 : 11,
        fontColor: '111827',
        align: 'left',
        vAlign: 'middle',
      }));
    });
    const rows = cells.length || 1;
    const cols = rows > 0 ? Math.max(1, ...cells.map((r) => r.length)) : 1;

    elements.push({
      shape_id: `s${slideIndex + 1}_table_${idx + 1}`,
      type: 'table',
      name: '导入表格',
      role: 'table',
      bounds: { x, y, w, h },
      zIndex: elements.length,
      table: {
        rows,
        cols,
        cells,
      },
    });
  });

  return {
    slide_id: `slide_${slideIndex + 1}`,
    title: slideTitle,
    background: { color: bgColor },
    transition: { type: 'none', durationMs: 350 },
    notes: notesText,
    elements,
  };
}

export async function importDeckFromPptxBuffer(
  data: Uint8Array | ArrayBuffer,
  options?: {
    fileName?: string;
    filePath?: string;
    preferSidecar?: boolean;
  }
): Promise<PresentationDeck> {
  const zip = await JSZip.loadAsync(data);
  const preferSidecar = options?.preferSidecar ?? true;

  if (preferSidecar) {
    const sidecarFile = zip.file('ppt/dshStudio/index.json');
    if (sidecarFile) {
      const jsonText = await sidecarFile.async('string');
      const parsed = JSON.parse(jsonText) as PresentationDeck;
      if (options?.fileName) parsed.file_name = options.fileName;
      if (options?.filePath) parsed.file_path = options.filePath;
      return parsed;
    }
  }

  // Fallback: standard OOXML parser
  let aspectRatio: 1 | 2 = ASPECT_RATIO_16_9;
  let widthPt = SLIDE_CANVAS_WIDTH_PT;
  let heightPt = SLIDE_CANVAS_HEIGHT_PT;

  const presFile = zip.file('ppt/presentation.xml');
  if (presFile) {
    const presXml = await presFile.async('string');
    const sldSz = presXml.match(/<p:sldSz\b[^>]*>/)?.[0];
    if (sldSz) {
      const cx = Number(extractAttr(sldSz, 'cx') ?? OOXML_WIDESCREEN_CX_EMU);
      const cy = Number(extractAttr(sldSz, 'cy') ?? OOXML_WIDESCREEN_CY_EMU);
      if (cx > 0 && cy > 0) {
        const ratio = cx / cy;
        if (Math.abs(ratio - 4 / 3) < 0.1) {
          aspectRatio = ASPECT_RATIO_4_3;
          widthPt = SLIDE_4_3_WIDTH_PT;
          heightPt = SLIDE_4_3_HEIGHT_PT;
        } else {
          aspectRatio = ASPECT_RATIO_16_9;
          widthPt = emuToPt(cx);
          heightPt = emuToPt(cy);
        }
      }
    }
  }

  const slideFiles = Object.keys(zip.files)
    .map((p) => {
      const m = p.match(/^ppt\/slides\/slide(\d+)\.xml$/i);
      return m ? { path: p, num: Number(m[1]) } : null;
    })
    .filter((v): v is { path: string; num: number } => v !== null)
    .sort((a, b) => a.num - b.num);

  const slides: SlidePage[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const sf = slideFiles[i];
    const slideXml = await zip.file(sf.path)!.async('string');
    let notesText = '';
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${sf.num}.xml`);
    if (notesFile) {
      const notesXml = await notesFile.async('string');
      notesText = extractAllTextFromXml(notesXml);
    }
    slides.push(parseSlideXmlToPage(slideXml, i, notesText));
  }

  const fileName = options?.fileName ?? '导入的演示文稿.pptx';
  const deck = createEmptyDeck({
    file_name: fileName,
    file_path: options?.filePath ?? `/workspace/${fileName}`,
    aspect_ratio: aspectRatio,
  });
  deck.width_pt = widthPt;
  deck.height_pt = heightPt;
  if (slides.length > 0) {
    deck.slides = slides;
  }
  return deck;
}
