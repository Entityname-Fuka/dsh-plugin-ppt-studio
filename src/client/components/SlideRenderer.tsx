import React from 'react';
import type {
  ChartProps,
  SlideElement,
  SlidePage,
  TableProps,
  TextProps,
} from '../../core/types';
import {
  DEFAULT_FONT_FAMILY,
  PT_TO_PX_RATIO,
  SLIDE_CANVAS_HEIGHT_PT,
  SLIDE_CANVAS_WIDTH_PT,
} from '../../core/constants';

export interface SlideRendererProps {
  slide: SlidePage;
  widthPt?: number;
  heightPt?: number;
  /** 1.0 = 1280x720 px; 0.39 = 499x281 px */
  scale: number;
  interactive?: boolean;
  editingShapeId?: string | null;
  onCommitInlineText?: (shapeId: string, newText: string) => void;
  onCancelInlineText?: () => void;
  /** 当前 deck id，用于把相对/本地图片路径经资源端点解析 */
  deckId?: string;
  children?: React.ReactNode;
}

/**
 * 把图片 src 解析成浏览器可直接加载的 URL。
 * - http(s)/data:/blob:/file: 原样返回；
 * - 其余（本地绝对路径、相对路径）走 /dsh-ppt-studio/api/asset 资源端点，
 *   由服务端读取本地文件后回传，避免 <img src="本地路径"> 加载不到。
 */
export function resolveImageSrc(
  src: string | undefined,
  options?: { deckId?: string; apiBase?: string },
): string {
  const raw = (src ?? '').trim();
  if (!raw) return raw;
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
  // file:// 交给浏览器（Electron 渲染进程可直接读本地文件）
  if (/^file:/i.test(raw)) return raw;
  const base = (options?.apiBase ?? '/dsh-ppt-studio/api').replace(/\/+$/, '');
  const params = new URLSearchParams();
  params.set('path', raw);
  if (options?.deckId) params.set('deckId', options.deckId);
  return `${base}/asset?${params.toString()}`;
}

export function normalizeHex(hex?: string): string {
  if (!hex || hex.toLowerCase() === 'none') return 'transparent';
  const clean = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(clean) || /^[0-9a-fA-F]{3}$/.test(clean)) {
    return `#${clean}`;
  }
  return hex;
}

/**
 * alpha: 0 = 不透明, 100 = 完全透明 (对齐 WorkBuddy slide_* 颜色契约)
 */
export function toCssColor(hex?: string, alpha = 0): string {
  if (!hex || hex.toLowerCase() === 'none') return 'transparent';
  const normalized = normalizeHex(hex);
  if (!normalized.startsWith('#')) return normalized;
  const opacity = Math.max(0, Math.min(1, 1 - alpha / 100));
  if (opacity >= 0.999) return normalized;
  const full =
    normalized.length === 4
      ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
      : normalized;
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity.toFixed(3)})`;
}

function isDarkBackground(bgHex?: string): boolean {
  const clean = (bgHex || '090D18').replace(/^#/, '');
  if (clean.length !== 6) return true;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.5;
}

function ptToPx(pt: number): number {
  return pt * PT_TO_PX_RATIO;
}

function dashArrayFor(dash?: 'solid' | 'dash' | 'dot', width = 1): string | undefined {
  if (dash === 'dash') return `${width * 4} ${width * 2.5}`;
  if (dash === 'dot') return `${width * 1.2} ${width * 2.2}`;
  return undefined;
}

function renderTextContent(
  text: TextProps,
  editing: boolean,
  onCommit?: (val: string) => void,
  onCancel?: () => void,
): React.ReactNode {
  const justify =
    text.vAlign === 'middle'
      ? 'center'
      : text.vAlign === 'bottom'
        ? 'flex-end'
        : 'flex-start';
  const textAlign = text.align || 'left';
  const fontSizePx = ptToPx(text.fontSize || 14);
  const lineHeight = text.lineHeight ?? 1.32;
  const baseColor = toCssColor(text.fontColor || 'F1F5F9', 0);

  if (editing) {
    return (
      <textarea
        autoFocus
        defaultValue={text.content}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onBlur={(e) => onCommit?.(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel?.();
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onCommit?.(e.currentTarget.value);
          }
        }}
        style={{
          width: '100%',
          height: '100%',
          resize: 'none',
          border: '1px dashed #38E8D4',
          outline: 'none',
          background: 'rgba(15, 23, 42, 0.72)',
          color: baseColor,
          fontFamily: text.fontName || DEFAULT_FONT_FAMILY,
          fontSize: `${fontSizePx}px`,
          fontWeight: text.bold ? 700 : 400,
          fontStyle: text.italic ? 'italic' : 'normal',
          textAlign,
          lineHeight,
          padding: '4px 6px',
          boxSizing: 'border-box',
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: justify,
        textAlign,
        fontFamily: text.fontName || DEFAULT_FONT_FAMILY,
        fontSize: `${fontSizePx}px`,
        color: baseColor,
        fontWeight: text.bold ? 700 : 400,
        fontStyle: text.italic ? 'italic' : 'normal',
        textDecoration: text.underline ? 'underline' : 'none',
        lineHeight,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflow: 'hidden',
        padding: '2px 4px',
      }}
    >
      {text.spans && text.spans.length > 0 ? (
        <div>
          {text.spans.map((span, idx) => (
            <span
              key={idx}
              style={{
                fontFamily: span.fontName || text.fontName || DEFAULT_FONT_FAMILY,
                fontSize: span.fontSize ? `${ptToPx(span.fontSize)}px` : undefined,
                color: span.fontColor ? toCssColor(span.fontColor) : undefined,
                fontWeight:
                  span.bold !== undefined ? (span.bold ? 700 : 400) : undefined,
                fontStyle:
                  span.italic !== undefined
                    ? span.italic
                      ? 'italic'
                      : 'normal'
                    : undefined,
                textDecoration: span.underline ? 'underline' : undefined,
              }}
            >
              {span.text}
            </span>
          ))}
        </div>
      ) : (
        <div>{text.content}</div>
      )}
    </div>
  );
}

function renderTable(table: TableProps, widthPx: number, heightPx: number) {
  const borderColor = normalizeHex(table.borderColor || '22304A');
  const headerBg = normalizeHex(table.headerBg || '17223B');
  const zebraBg = normalizeHex(table.zebraBg || '0F172A');

  return (
    <table
      style={{
        width: `${widthPx}px`,
        height: `${heightPx}px`,
        borderCollapse: 'collapse',
        tableLayout: 'fixed',
        fontFamily: DEFAULT_FONT_FAMILY,
      }}
    >
      <tbody>
        {table.cells.map((row, rIdx) => (
          <tr
            key={rIdx}
            style={{
              height: table.rowHeights?.[rIdx]
                ? `${ptToPx(table.rowHeights[rIdx])}px`
                : undefined,
            }}
          >
            {row.map((cell, cIdx) => {
              if (cell.mergedInto) return null;
              const bg = cell.bgColor
                ? normalizeHex(cell.bgColor)
                : rIdx === 0
                  ? headerBg
                  : rIdx % 2 === 1
                    ? 'transparent'
                    : zebraBg;
              const cBorder = cell.borderColor
                ? normalizeHex(cell.borderColor)
                : borderColor;
              return (
                <td
                  key={cIdx}
                  rowSpan={cell.rowSpan}
                  colSpan={cell.colSpan}
                  style={{
                    width: table.colWidths?.[cIdx]
                      ? `${ptToPx(table.colWidths[cIdx])}px`
                      : undefined,
                    background: bg,
                    color: normalizeHex(cell.fontColor || (rIdx === 0 ? '38E8D4' : 'E2E8F0')),
                    fontSize: `${ptToPx(cell.fontSize || (rIdx === 0 ? 11 : 10.5))}px`,
                    fontWeight: cell.bold ?? rIdx === 0 ? 700 : 400,
                    fontStyle: cell.italic ? 'italic' : 'normal',
                    textAlign: cell.align || 'left',
                    verticalAlign: cell.vAlign || 'middle',
                    border: `1px solid ${cBorder}`,
                    padding: '6px 9px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {cell.text}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const DEFAULT_CHART_PALETTE = ['#38E8D4', '#846BFF', '#38BDF8', '#F59E0B', '#F472B6'];

function renderChart(
  chart: ChartProps,
  widthPx: number,
  heightPx: number,
  darkBg: boolean,
  shapeId: string,
) {
  const titleColor = darkBg ? '#F1F5F9' : '#111827';
  const axisColor = darkBg ? '#94A3B8' : '#6B7280';
  const gridColor = darkBg ? 'rgba(148, 163, 184, 0.16)' : 'rgba(107, 114, 128, 0.18)';
  const labelColor = darkBg ? '#E2E8F0' : '#1F2937';

  const padTop = chart.title ? 46 : 24;
  const padBottom = chart.showLegend !== false ? 56 : 36;
  const padLeft = 52;
  const padRight = 24;
  const plotW = Math.max(40, widthPx - padLeft - padRight);
  const plotH = Math.max(40, heightPx - padTop - padBottom);

  const allValues = chart.series.flatMap((s) => s.values);
  const rawMax = Math.max(10, ...allValues, chart.yAxisMax || 0);
  const niceMax = chart.yAxisMax || Math.ceil(rawMax / 10) * 10;
  const tickCount = 5;

  if (chart.chartType === 'pie') {
    const firstSeries = chart.series[0]?.values || [];
    const total = Math.max(
      1,
      firstSeries.reduce((acc, v) => acc + Math.max(0, v), 0),
    );
    const cx = widthPx * 0.38;
    const cy = padTop + plotH * 0.52;
    const r = Math.min(plotW * 0.32, plotH * 0.44);
    let startAngle = -Math.PI / 2;

    return (
      <svg width={widthPx} height={heightPx} viewBox={`0 0 ${widthPx} ${heightPx}`}>
        {chart.title && (
          <text
            x={widthPx / 2}
            y={26}
            textAnchor="middle"
            fill={titleColor}
            fontSize={16}
            fontWeight={700}
            fontFamily={DEFAULT_FONT_FAMILY}
          >
            {chart.title}
          </text>
        )}
        {firstSeries.map((val, i) => {
          const angle = (Math.max(0, val) / total) * Math.PI * 2;
          const endAngle = startAngle + angle;
          const x1 = cx + r * Math.cos(startAngle);
          const y1 = cy + r * Math.sin(startAngle);
          const x2 = cx + r * Math.cos(endAngle);
          const y2 = cy + r * Math.sin(endAngle);
          const largeArc = angle > Math.PI ? 1 : 0;
          const pathD = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
          const color =
            chart.series[i]?.color
              ? normalizeHex(chart.series[i]?.color)
              : DEFAULT_CHART_PALETTE[i % DEFAULT_CHART_PALETTE.length];
          startAngle = endAngle;
          return <path key={i} d={pathD} fill={color} stroke={darkBg ? '#090D18' : '#FFFFFF'} strokeWidth={2} />;
        })}
        <circle cx={cx} cy={cy} r={r * 0.48} fill={darkBg ? '#090D18' : '#FFFFFF'} />
        {chart.categories.map((cat, i) => {
          const val = firstSeries[i] ?? 0;
          const pct = ((val / total) * 100).toFixed(1);
          const color = DEFAULT_CHART_PALETTE[i % DEFAULT_CHART_PALETTE.length];
          const ly = padTop + 26 + i * 24;
          const lx = cx + r + 28;
          return (
            <g key={i}>
              <rect x={lx} y={ly - 9} width={10} height={10} rx={2} fill={color} />
              <text x={lx + 16} y={ly} fill={labelColor} fontSize={12} fontFamily={DEFAULT_FONT_FAMILY}>
                {cat} ({pct}%)
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  const catCount = Math.max(1, chart.categories.length);
  const seriesCount = Math.max(1, chart.series.length);

  return (
    <svg width={widthPx} height={heightPx} viewBox={`0 0 ${widthPx} ${heightPx}`}>
      <defs>
        {chart.series.map((s, sIdx) => {
          const base = s.color
            ? normalizeHex(s.color)
            : DEFAULT_CHART_PALETTE[sIdx % DEFAULT_CHART_PALETTE.length];
          return (
            <linearGradient
              key={sIdx}
              id={`grad-${shapeId}-${sIdx}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={base} stopOpacity={0.95} />
              <stop offset="100%" stopColor={base} stopOpacity={0.55} />
            </linearGradient>
          );
        })}
      </defs>

      {chart.title && (
        <text
          x={widthPx / 2}
          y={26}
          textAnchor="middle"
          fill={titleColor}
          fontSize={16}
          fontWeight={700}
          fontFamily={DEFAULT_FONT_FAMILY}
        >
          {chart.title}
        </text>
      )}

      {/* Gridlines & Y-Axis ticks */}
      {Array.from({ length: tickCount + 1 }).map((_, idx) => {
        const ratio = idx / tickCount;
        const y = padTop + plotH * (1 - ratio);
        const tickVal = Math.round(niceMax * ratio);
        return (
          <g key={idx}>
            {chart.showGridlines !== false && (
              <line
                x1={padLeft}
                y1={y}
                x2={padLeft + plotW}
                y2={y}
                stroke={gridColor}
                strokeWidth={1}
                strokeDasharray={idx === 0 ? undefined : '3 3'}
              />
            )}
            <text
              x={padLeft - 8}
              y={y + 4}
              textAnchor="end"
              fill={axisColor}
              fontSize={11}
              fontFamily={DEFAULT_FONT_FAMILY}
            >
              {tickVal}
            </text>
          </g>
        );
      })}

      {/* X-Axis base line */}
      <line
        x1={padLeft}
        y1={padTop + plotH}
        x2={padLeft + plotW}
        y2={padTop + plotH}
        stroke={axisColor}
        strokeOpacity={0.5}
        strokeWidth={1}
      />

      {/* Category labels */}
      {chart.categories.map((cat, cIdx) => {
        const slotW = plotW / catCount;
        const x = padLeft + slotW * cIdx + slotW / 2;
        return (
          <text
            key={cIdx}
            x={x}
            y={padTop + plotH + 18}
            textAnchor="middle"
            fill={axisColor}
            fontSize={12}
            fontFamily={DEFAULT_FONT_FAMILY}
          >
            {cat}
          </text>
        );
      })}

      {/* Bar chart */}
      {chart.chartType === 'bar' &&
        chart.categories.map((_, cIdx) => {
          const slotW = plotW / catCount;
          const groupW = Math.min(slotW * 0.62, seriesCount * 46);
          const barGap = 8;
          const barW = Math.max(10, (groupW - barGap * (seriesCount - 1)) / seriesCount);
          const groupStartX = padLeft + slotW * cIdx + (slotW - groupW) / 2;

          return chart.series.map((s, sIdx) => {
            const val = s.values[cIdx] ?? 0;
            const h = Math.max(2, (Math.max(0, val) / niceMax) * plotH);
            const x = groupStartX + sIdx * (barW + barGap);
            const y = padTop + plotH - h;
            const fillColor = s.color
              ? normalizeHex(s.color)
              : DEFAULT_CHART_PALETTE[sIdx % DEFAULT_CHART_PALETTE.length];

            return (
              <g key={`${cIdx}-${sIdx}`}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx={3}
                  fill={`url(#grad-${shapeId}-${sIdx})`}
                  stroke={fillColor}
                  strokeWidth={1}
                />
                {chart.showDataLabels !== false && (
                  <text
                    x={x + barW / 2}
                    y={y - 6}
                    textAnchor="middle"
                    fill={labelColor}
                    fontSize={11}
                    fontWeight={600}
                    fontFamily={DEFAULT_FONT_FAMILY}
                  >
                    {val}
                    {chart.unit ? chart.unit : ''}
                  </text>
                )}
              </g>
            );
          });
        })}

      {/* Line / Area chart */}
      {(chart.chartType === 'line' || chart.chartType === 'area') &&
        chart.series.map((s, sIdx) => {
          const color = s.color
            ? normalizeHex(s.color)
            : DEFAULT_CHART_PALETTE[sIdx % DEFAULT_CHART_PALETTE.length];
          const points = chart.categories.map((_, cIdx) => {
            const slotW = plotW / catCount;
            const x = padLeft + slotW * cIdx + slotW / 2;
            const val = s.values[cIdx] ?? 0;
            const y = padTop + plotH - (Math.max(0, val) / niceMax) * plotH;
            return { x, y, val };
          });
          const polyPts = points.map((p) => `${p.x},${p.y}`).join(' ');
          const areaPath =
            points.length > 0
              ? `M ${points[0].x} ${padTop + plotH} ` +
                points.map((p) => `L ${p.x} ${p.y}`).join(' ') +
                ` L ${points[points.length - 1].x} ${padTop + plotH} Z`
              : '';

          return (
            <g key={sIdx}>
              {chart.chartType === 'area' && areaPath && (
                <path d={areaPath} fill={color} fillOpacity={0.18} />
              )}
              <polyline
                fill="none"
                stroke={color}
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                points={polyPts}
              />
              {points.map((p, idx) => (
                <g key={idx}>
                  <circle cx={p.x} cy={p.y} r={4} fill={color} stroke="#090D18" strokeWidth={1.5} />
                  {chart.showDataLabels !== false && (
                    <text
                      x={p.x}
                      y={p.y - 9}
                      textAnchor="middle"
                      fill={labelColor}
                      fontSize={11}
                      fontWeight={600}
                    >
                      {p.val}
                    </text>
                  )}
                </g>
              ))}
            </g>
          );
        })}

      {/* Legend */}
      {chart.showLegend !== false && (
        <g transform={`translate(${widthPx / 2 - chart.series.length * 64}, ${heightPx - 20})`}>
          {chart.series.map((s, sIdx) => {
            const color = s.color
              ? normalizeHex(s.color)
              : DEFAULT_CHART_PALETTE[sIdx % DEFAULT_CHART_PALETTE.length];
            const offset = sIdx * 130;
            return (
              <g key={sIdx} transform={`translate(${offset}, 0)`}>
                <rect x={0} y={-8} width={10} height={10} rx={2} fill={color} />
                <text
                  x={15}
                  y={1}
                  fill={axisColor}
                  fontSize={11.5}
                  fontFamily={DEFAULT_FONT_FAMILY}
                >
                  {s.name}
                </text>
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}

function renderCustomShapeSvg(
  el: SlideElement,
  widthPx: number,
  heightPx: number,
  fillCss: string,
  borderCss: string,
  borderWidth: number,
) {
  const kind = el.shapeType;
  let points = '';
  if (kind === 'triangle') {
    points = `${widthPx / 2},2 ${widthPx - 2},${heightPx - 2} 2,${heightPx - 2}`;
  } else if (kind === 'diamond') {
    points = `${widthPx / 2},2 ${widthPx - 2},${heightPx / 2} ${widthPx / 2},${heightPx - 2} 2,${heightPx / 2}`;
  } else if (kind === 'rightArrow') {
    const shaftY1 = heightPx * 0.28;
    const shaftY2 = heightPx * 0.72;
    const headX = widthPx * 0.65;
    points = `2,${shaftY1} ${headX},${shaftY1} ${headX},2 ${widthPx - 2},${heightPx / 2} ${headX},${heightPx - 2} ${headX},${shaftY2} 2,${shaftY2}`;
  } else if (kind === 'leftArrow') {
    const shaftY1 = heightPx * 0.28;
    const shaftY2 = heightPx * 0.72;
    const headX = widthPx * 0.35;
    points = `2,${heightPx / 2} ${headX},2 ${headX},${shaftY1} ${widthPx - 2},${shaftY1} ${widthPx - 2},${shaftY2} ${headX},${shaftY2} ${headX},${heightPx - 2}`;
  }

  return (
    <svg
      width={widthPx}
      height={heightPx}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <polygon
        points={points}
        fill={fillCss}
        stroke={borderCss}
        strokeWidth={borderWidth}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const SlideRenderer: React.FC<SlideRendererProps> = ({
  slide,
  widthPt = SLIDE_CANVAS_WIDTH_PT,
  heightPt = SLIDE_CANVAS_HEIGHT_PT,
  scale,
  interactive = false,
  editingShapeId = null,
  onCommitInlineText,
  onCancelInlineText,
  deckId,
  children,
}) => {
  const stageWidthPx = ptToPx(widthPt);
  const stageHeightPx = ptToPx(heightPt);
  const scaledW = Math.round(stageWidthPx * scale * 10) / 10;
  const scaledH = Math.round(stageHeightPx * scale * 10) / 10;
  const bgHex = slide.background?.color || '090D18';
  const darkBg = isDarkBackground(bgHex);
  const backgroundCss = slide.background?.gradient
    ? slide.background.gradient
    : normalizeHex(bgHex);

  return (
    <div
      className="ppt-stage-outer"
      style={{
        width: `${scaledW}px`,
        height: `${scaledH}px`,
      }}
    >
      <div
        className="ppt-stage-inner"
        style={{
          width: `${stageWidthPx}px`,
          height: `${stageHeightPx}px`,
          transform: `scale(${scale})`,
          background: backgroundCss,
        }}
      >
        {slide.elements.map((el, idx) => {
          const left = ptToPx(el.bounds.x);
          const top = ptToPx(el.bounds.y);
          const w = ptToPx(el.bounds.w);
          const h = ptToPx(el.bounds.h);

          const fillCss = el.fill
            ? toCssColor(el.fill.color, el.fill.alpha ?? 0)
            : 'transparent';
          const borderWidth = el.border?.width ?? (el.border ? 1 : 0);
          const borderCss = el.border
            ? toCssColor(el.border.color, el.border.alpha ?? 0)
            : 'transparent';
          const borderStyle =
            el.border?.dash === 'dash'
              ? 'dashed'
              : el.border?.dash === 'dot'
                ? 'dotted'
                : 'solid';

          const isPolyShape =
            el.type === 'shape' &&
            (el.shapeType === 'triangle' ||
              el.shapeType === 'diamond' ||
              el.shapeType === 'rightArrow' ||
              el.shapeType === 'leftArrow');

          const borderRadius =
            el.shapeType === 'ellipse'
              ? '50%'
              : el.cornerRadius !== undefined
                ? `${ptToPx(el.cornerRadius)}px`
                : el.shapeType === 'roundRect'
                  ? '10px'
                  : '0px';

          return (
            <div
              key={el.shape_id}
              data-shape-id={el.shape_id}
              data-shape-index={idx}
              style={{
                position: 'absolute',
                left: `${left}px`,
                top: `${top}px`,
                width: `${w}px`,
                height: `${h}px`,
                zIndex: el.zIndex ?? idx,
                transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                background: isPolyShape ? 'transparent' : fillCss,
                border:
                  !isPolyShape && borderWidth > 0 && borderCss !== 'transparent'
                    ? `${borderWidth}px ${borderStyle} ${borderCss}`
                    : undefined,
                borderRadius,
                boxSizing: 'border-box',
                pointerEvents: interactive ? 'auto' : 'none',
              }}
            >
              {isPolyShape &&
                renderCustomShapeSvg(el, w, h, fillCss, borderCss, borderWidth)}

              {el.type === 'line' && el.line && (
                <svg
                  width={Math.max(w, 4)}
                  height={Math.max(h, 4)}
                  style={{ overflow: 'visible', display: 'block' }}
                >
                  <defs>
                    <marker
                      id={`arrow-end-${el.shape_id}`}
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1 L 10 5 L 0 9 z" fill={normalizeHex(el.line.color)} />
                    </marker>
                  </defs>
                  <line
                    x1={ptToPx(el.line.x1 - el.bounds.x)}
                    y1={ptToPx(el.line.y1 - el.bounds.y)}
                    x2={ptToPx(el.line.x2 - el.bounds.x)}
                    y2={ptToPx(el.line.y2 - el.bounds.y)}
                    stroke={normalizeHex(el.line.color)}
                    strokeWidth={el.line.width || 2}
                    strokeDasharray={dashArrayFor(el.line.dash, el.line.width || 2)}
                    markerEnd={
                      el.line.lineType === 'arrow' || el.line.lineType === 'doubleArrow'
                        ? `url(#arrow-end-${el.shape_id})`
                        : undefined
                    }
                    markerStart={
                      el.line.lineType === 'doubleArrow'
                        ? `url(#arrow-end-${el.shape_id})`
                        : undefined
                    }
                  />
                </svg>
              )}

              {el.type === 'table' && el.table && renderTable(el.table, w, h)}

              {el.type === 'chart' &&
                el.chart &&
                renderChart(el.chart, w, h, darkBg, el.shape_id)}

              {el.type === 'svg' && el.svg && (
                <svg
                  width={w}
                  height={h}
                  viewBox={el.svg.viewBox}
                  dangerouslySetInnerHTML={{ __html: el.svg.markup }}
                />
              )}

              {el.type === 'image' && el.image && (
                <img
                  src={resolveImageSrc(el.image.src, { deckId })}
                  alt={el.image.alt || ''}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: el.image.objectFit || 'cover',
                    display: 'block',
                  }}
                />
              )}

              {el.text &&
                renderTextContent(
                  el.text,
                  editingShapeId === el.shape_id,
                  (newVal) => onCommitInlineText?.(el.shape_id, newVal),
                  onCancelInlineText,
                )}
            </div>
          );
        })}

        {children}
      </div>
    </div>
  );
};
