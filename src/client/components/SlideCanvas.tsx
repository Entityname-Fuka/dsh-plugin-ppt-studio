import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpToLine,
  Code2,
  Copy,
  Crosshair,
  Layers,
  MessageSquarePlus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  FREE_MARQUEE_MIN_DRAG_PT,
  PT_TO_PX_RATIO,
  SNAP_GUIDE_THRESHOLD_PT,
} from '../../core/constants';
import {
  buildSelectionPayload,
  buildWholeSlideSelectionPayload,
  normalizeRectPt,
  querySlideRegion,
} from '../../core/context-index';
import type {
  BoundsPt,
  PresentationDeck,
  SlideElement,
  SlidePage,
  SlideSelectionPayload,
} from '../../core/types';
import { IndexInspectorModal } from './IndexInspectorModal';
import { SlideRenderer } from './SlideRenderer';

export interface SlideCanvasProps {
  deck: PresentationDeck;
  slide: SlidePage;
  pageIndex: number; // 0-based
  zoomPercent: number;
  isMarqueeMode: boolean;
  selectedShapeIds: string[];
  flashShapeIds: string[];
  onToggleMarqueeMode: () => void;
  onSelectShapes: (shapeIds: string[]) => void;
  onMoveResizeElement: (
    shapeId: string,
    nextBounds: BoundsPt,
    kind?: 'move' | 'resize',
  ) => void;
  onCommitInlineText: (shapeId: string, newText: string) => void;
  onReorderTop: (shapeId: string) => void;
  onDuplicateElement: (shapeId: string) => void;
  onDeleteElement: (shapeId: string) => void;
  onSendSelectionToComposer: (payload: SlideSelectionPayload) => void;
  onSendSelectionAiEdit: (payload: SlideSelectionPayload, prompt: string) => void;
  onToast: (msg: string) => void;
}

type ResizeHandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLES: Array<{ dir: ResizeHandleDir; style: React.CSSProperties; cursor: string }> = [
  { dir: 'nw', style: { top: -4, left: -4 }, cursor: 'nwse-resize' },
  { dir: 'n', style: { top: -4, left: '50%', marginLeft: -4 }, cursor: 'ns-resize' },
  { dir: 'ne', style: { top: -4, right: -4 }, cursor: 'nesw-resize' },
  { dir: 'e', style: { top: '50%', right: -4, marginTop: -4 }, cursor: 'ew-resize' },
  { dir: 'se', style: { bottom: -4, right: -4 }, cursor: 'nwse-resize' },
  { dir: 's', style: { bottom: -4, left: '50%', marginLeft: -4 }, cursor: 'ns-resize' },
  { dir: 'sw', style: { bottom: -4, left: -4 }, cursor: 'nesw-resize' },
  { dir: 'w', style: { top: '50%', left: -4, marginTop: -4 }, cursor: 'ew-resize' },
];

export const SlideCanvas: React.FC<SlideCanvasProps> = ({
  deck,
  slide,
  pageIndex,
  zoomPercent,
  isMarqueeMode,
  selectedShapeIds,
  flashShapeIds,
  onToggleMarqueeMode,
  onSelectShapes,
  onMoveResizeElement,
  onCommitInlineText,
  onReorderTop,
  onDuplicateElement,
  onDeleteElement,
  onSendSelectionToComposer,
  onSendSelectionAiEdit,
  onToast,
}) => {
  const stageScale = zoomPercent / 100;
  const pxPerPt = PT_TO_PX_RATIO * stageScale;
  const stageContainerRef = useRef<HTMLDivElement | null>(null);

  const [editingShapeId, setEditingShapeId] = useState<string | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ v?: number; h?: number }>({});
  // 本地拖拽/缩放实时预览态：拖动过程中仅在画布本地渲染，松手时一次性提交 1 条撤回记录
  const [dragPreview, setDragPreview] = useState<{
    shapeId: string;
    bounds: BoundsPt;
  } | null>(null);

  // 自由框选与整页选中状态
  const [marqueeDraft, setMarqueeDraft] = useState<BoundsPt | null>(null);
  const [marqueeResult, setMarqueeResult] = useState<SlideSelectionPayload | null>(null);
  const [wholeSlideResult, setWholeSlideResult] = useState<SlideSelectionPayload | null>(null);
  const [aiInputOpen, setAiInputOpen] = useState(false);
  const [aiPromptText, setAiPromptText] = useState('');
  const [inspectPayload, setInspectPayload] = useState<SlideSelectionPayload | null>(null);

  useEffect(() => {
    setMarqueeDraft(null);
    setMarqueeResult(null);
    setWholeSlideResult(null);
    setDragPreview(null);
    setAiInputOpen(false);
  }, [deck.file_id, pageIndex]);

  const effectiveSlide = useMemo<SlidePage>(() => {
    if (!dragPreview) return slide;
    return {
      ...slide,
      elements: slide.elements.map((el) =>
        el.shape_id === dragPreview.shapeId
          ? { ...el, bounds: dragPreview.bounds }
          : el,
      ),
    };
  }, [slide, dragPreview]);

  const handleSelectWholeSlide = () => {
    setEditingShapeId(null);
    setMarqueeDraft(null);
    setMarqueeResult(null);
    const payload = buildWholeSlideSelectionPayload(deck, pageIndex);
    setWholeSlideResult(payload);
    onSelectShapes(payload.shape_ids);
  };

  const liveMarqueeHits = useMemo(() => {
    const activeBox = marqueeDraft ?? marqueeResult?.bbox_pt ?? null;
    if (!activeBox || (activeBox.w < 2 && activeBox.h < 2)) return new Set<string>();
    const q = querySlideRegion(slide, pageIndex, activeBox, {
      minOverlapRatio: 0.05,
      selectionMode: 'free-marquee',
    });
    return new Set(q.elements.map((e) => e.shape_id));
  }, [marqueeDraft, marqueeResult, slide, pageIndex]);

  const clientToSlidePt = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = stageContainerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const x = Math.max(0, Math.min(deck.width_pt, (clientX - rect.left) / pxPerPt));
    const y = Math.max(0, Math.min(deck.height_pt, (clientY - rect.top) / pxPerPt));
    return { x, y };
  };

  const handleStageMouseDown = (e: React.MouseEvent) => {
    if (isMarqueeMode) {
      e.preventDefault();
      e.stopPropagation();
      setEditingShapeId(null);
      setMarqueeResult(null);
      setWholeSlideResult(null);
      setAiInputOpen(false);
      const start = clientToSlidePt(e.clientX, e.clientY);
      setMarqueeDraft({ x: start.x, y: start.y, w: 0, h: 0 });

      const onMove = (ev: MouseEvent) => {
        const cur = clientToSlidePt(ev.clientX, ev.clientY);
        setMarqueeDraft(
          normalizeRectPt({
            x: start.x,
            y: start.y,
            w: cur.x - start.x,
            h: cur.y - start.y,
          }),
        );
      };

      const onUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const end = clientToSlidePt(ev.clientX, ev.clientY);
        const rect = normalizeRectPt({
          x: start.x,
          y: start.y,
          w: end.x - start.x,
          h: end.y - start.y,
        });
        setMarqueeDraft(null);

        if (rect.w < FREE_MARQUEE_MIN_DRAG_PT && rect.h < FREE_MARQUEE_MIN_DRAG_PT) {
          // 小点击视为围绕点击点 16x16pt 的框选查询
          const pointBox: BoundsPt = {
            x: Math.max(0, end.x - 8),
            y: Math.max(0, end.y - 8),
            w: 16,
            h: 16,
          };
          const payload = buildSelectionPayload(deck, pageIndex, {
            bbox_pt: pointBox,
            selection_mode: 'free-marquee',
          });
          setMarqueeResult(payload);
          onSelectShapes(payload.shape_ids);
        } else {
          const payload = buildSelectionPayload(deck, pageIndex, {
            bbox_pt: rect,
            selection_mode: 'free-marquee',
          });
          setMarqueeResult(payload);
          onSelectShapes(payload.shape_ids);
        }
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return;
    }

    // 普通模式点空白处取消选中
    if (e.target === e.currentTarget) {
      onSelectShapes([]);
      setEditingShapeId(null);
      setWholeSlideResult(null);
      setAiInputOpen(false);
    }
  };

  const handleElementMouseDown = (e: React.MouseEvent, el: SlideElement) => {
    if (isMarqueeMode) return;
    e.stopPropagation();
    if (editingShapeId === el.shape_id) return;
    setEditingShapeId(null);
    setWholeSlideResult(null);
    setAiInputOpen(false);

    let nextIds: string[];
    if (e.shiftKey) {
      nextIds = selectedShapeIds.includes(el.shape_id)
        ? selectedShapeIds.filter((id) => id !== el.shape_id)
        : [...selectedShapeIds, el.shape_id];
    } else {
      nextIds = [el.shape_id];
    }
    onSelectShapes(nextIds);

    // 拖拽移动 + 5pt 智能参考线（拖动过程仅更新本地预览，松手一次性提交为 1 条撤销记录）
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...el.bounds };
    let moved = false;
    let latestBounds: BoundsPt | null = null;

    const otherCenterXs = [
      deck.width_pt / 2,
      ...slide.elements
        .filter((o) => o.shape_id !== el.shape_id)
        .map((o) => o.bounds.x + o.bounds.w / 2),
    ];
    const otherCenterYs = [
      deck.height_pt / 2,
      ...slide.elements
        .filter((o) => o.shape_id !== el.shape_id)
        .map((o) => o.bounds.y + o.bounds.h / 2),
    ];

    const onMove = (ev: MouseEvent) => {
      const dxPt = (ev.clientX - startX) / pxPerPt;
      const dyPt = (ev.clientY - startY) / pxPerPt;
      if (Math.abs(dxPt) > 1.5 || Math.abs(dyPt) > 1.5) moved = true;
      if (!moved) return;

      let nextX = orig.x + dxPt;
      let nextY = orig.y + dyPt;
      const guides: { v?: number; h?: number } = {};

      const myCx = nextX + orig.w / 2;
      for (const cx of otherCenterXs) {
        if (Math.abs(myCx - cx) <= SNAP_GUIDE_THRESHOLD_PT) {
          nextX = cx - orig.w / 2;
          guides.v = cx;
          break;
        }
      }
      const myCy = nextY + orig.h / 2;
      for (const cy of otherCenterYs) {
        if (Math.abs(myCy - cy) <= SNAP_GUIDE_THRESHOLD_PT) {
          nextY = cy - orig.h / 2;
          guides.h = cy;
          break;
        }
      }

      setSnapGuides(guides);
      latestBounds = {
        ...orig,
        x: Math.round(nextX * 10) / 10,
        y: Math.round(nextY * 10) / 10,
      };
      setDragPreview({ shapeId: el.shape_id, bounds: latestBounds });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setSnapGuides({});
      setDragPreview(null);
      if (
        moved &&
        latestBounds &&
        (latestBounds.x !== orig.x || latestBounds.y !== orig.y)
      ) {
        onMoveResizeElement(el.shape_id, latestBounds, 'move');
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleResizeMouseDown = (
    e: React.MouseEvent,
    el: SlideElement,
    dir: ResizeHandleDir,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...el.bounds };
    let latestBounds: BoundsPt | null = null;

    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / pxPerPt;
      const dy = (ev.clientY - startY) / pxPerPt;
      let { x, y, w, h } = orig;

      if (dir.includes('e')) w = Math.max(16, orig.w + dx);
      if (dir.includes('s')) h = Math.max(12, orig.h + dy);
      if (dir.includes('w')) {
        const nextW = Math.max(16, orig.w - dx);
        x = orig.x + (orig.w - nextW);
        w = nextW;
      }
      if (dir.includes('n')) {
        const nextH = Math.max(12, orig.h - dy);
        y = orig.y + (orig.h - nextH);
        h = nextH;
      }

      latestBounds = {
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        w: Math.round(w * 10) / 10,
        h: Math.round(h * 10) / 10,
      };
      setDragPreview({ shapeId: el.shape_id, bounds: latestBounds });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragPreview(null);
      if (
        latestBounds &&
        (latestBounds.x !== orig.x ||
          latestBounds.y !== orig.y ||
          latestBounds.w !== orig.w ||
          latestBounds.h !== orig.h)
      ) {
        onMoveResizeElement(el.shape_id, latestBounds, 'resize');
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const singleSelectedEl =
    selectedShapeIds.length === 1
      ? effectiveSlide.elements.find((e) => e.shape_id === selectedShapeIds[0])
      : undefined;

  const activeBoxToDraw = marqueeDraft ?? marqueeResult?.bbox_pt ?? null;
  const activeHudResult = wholeSlideResult ?? (isMarqueeMode ? marqueeResult : null);

  return (
    <div className="ppt-canvas-pane">
      <div
        className={`ppt-canvas-viewport ${isMarqueeMode ? 'is-marquee-mode' : ''}`}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !isMarqueeMode) {
            onSelectShapes([]);
            setEditingShapeId(null);
            setWholeSlideResult(null);
            setAiInputOpen(false);
          }
        }}
      >
        {/* 画布右上角悬浮操作组：引用整页 + 自由框选模式 */}
        <div className="ppt-canvas-floating-tools">
          <button
            type="button"
            className={`ppt-whole-slide-pill ${wholeSlideResult ? 'is-on' : ''}`}
            data-testid="ppt-select-whole-slide-btn"
            onClick={() => {
              if (wholeSlideResult) {
                setWholeSlideResult(null);
                setAiInputOpen(false);
                onSelectShapes([]);
              } else {
                handleSelectWholeSlide();
              }
            }}
            title="选中当前整页，直接引用给 Agent 进行整页修改或重排版"
          >
            <Layers size={13} />
            <span>引用整页</span>
          </button>

          <button
            type="button"
            className={`ppt-marquee-pill ${isMarqueeMode ? 'is-on' : ''}`}
            data-testid="ppt-free-marquee-toggle"
            onClick={() => {
              setWholeSlideResult(null);
              if (isMarqueeMode) {
                setMarqueeDraft(null);
                setMarqueeResult(null);
                setAiInputOpen(false);
              }
              onToggleMarqueeMode();
            }}
            title="开启后可在幻灯片上自由拖框，精准索引选中元素并推送到 Agent 对话"
          >
            <Crosshair size={13} />
            <span>自由框选模式</span>
            <span className="ppt-switch-track" aria-hidden="true">
              <span className="ppt-switch-thumb" />
            </span>
          </button>
        </div>

        {/* 居中 16:9 幻灯片画布舞台 */}
        <div
          ref={stageContainerRef}
          style={{ position: 'relative' }}
          onMouseDown={handleStageMouseDown}
        >
          <SlideRenderer
            slide={effectiveSlide}
            widthPt={deck.width_pt}
            heightPt={deck.height_pt}
            scale={stageScale}
            interactive={!isMarqueeMode}
            editingShapeId={editingShapeId}
            onCommitInlineText={(id, txt) => {
              onCommitInlineText(id, txt);
              setEditingShapeId(null);
            }}
            onCancelInlineText={() => setEditingShapeId(null)}
            deckId={deck.file_id}
          >
            {/* 智能对齐参考线 */}
            {snapGuides.v !== undefined && (
              <div
                className="ppt-snap-guide-v"
                style={{ left: `${snapGuides.v * PT_TO_PX_RATIO}px` }}
              />
            )}
            {snapGuides.h !== undefined && (
              <div
                className="ppt-snap-guide-h"
                style={{ top: `${snapGuides.h * PT_TO_PX_RATIO}px` }}
              />
            )}

            {/* 元素交互叠加层（选中态、框选命中高亮、回跳闪烁、缩放手柄） */}
            {effectiveSlide.elements.map((el) => {
              const isSelected = selectedShapeIds.includes(el.shape_id);
              const isMarqueeHit = liveMarqueeHits.has(el.shape_id);
              const isFlashing = flashShapeIds.includes(el.shape_id);
              const leftPx = el.bounds.x * PT_TO_PX_RATIO;
              const topPx = el.bounds.y * PT_TO_PX_RATIO;
              const wPx = el.bounds.w * PT_TO_PX_RATIO;
              const hPx = el.bounds.h * PT_TO_PX_RATIO;

              return (
                <div
                  key={`ov_${el.shape_id}`}
                  className={`ppt-el-overlay ${isSelected ? 'is-selected' : ''} ${
                    isMarqueeHit ? 'is-marquee-hit' : ''
                  } ${isFlashing ? 'is-flash-target' : ''}`}
                  style={{
                    left: `${leftPx}px`,
                    top: `${topPx}px`,
                    width: `${wPx}px`,
                    height: `${hPx}px`,
                    zIndex: (el.zIndex ?? 0) + 100,
                    pointerEvents: isMarqueeMode ? 'none' : 'auto',
                    cursor: isMarqueeMode ? 'crosshair' : 'move',
                  }}
                  onMouseDown={(e) => handleElementMouseDown(e, el)}
                  onDoubleClick={(e) => {
                    if (isMarqueeMode) return;
                    e.stopPropagation();
                    if (el.text || el.type === 'text' || el.type === 'shape') {
                      setEditingShapeId(el.shape_id);
                    }
                  }}
                >
                  {(isMarqueeHit || (isSelected && isMarqueeMode)) && (
                    <span className="ppt-shape-id-badge">{el.shape_id}</span>
                  )}

                  {!isMarqueeMode &&
                    isSelected &&
                    selectedShapeIds.length === 1 &&
                    editingShapeId !== el.shape_id &&
                    HANDLES.map((h) => (
                      <div
                        key={h.dir}
                        className="ppt-resize-handle"
                        style={{ ...h.style, cursor: h.cursor }}
                        onMouseDown={(e) => handleResizeMouseDown(e, el, h.dir)}
                      />
                    ))}
                </div>
              );
            })}

            {/* 自由框选矩形 */}
            {activeBoxToDraw && (
              <div
                className="ppt-marquee-rect"
                style={{
                  left: `${activeBoxToDraw.x * PT_TO_PX_RATIO}px`,
                  top: `${activeBoxToDraw.y * PT_TO_PX_RATIO}px`,
                  width: `${Math.max(4, activeBoxToDraw.w * PT_TO_PX_RATIO)}px`,
                  height: `${Math.max(4, activeBoxToDraw.h * PT_TO_PX_RATIO)}px`,
                }}
              />
            )}

            {/* 整页选中高亮外框 */}
            {wholeSlideResult && <div className="ppt-whole-slide-outline" />}
          </SlideRenderer>

          {/* 普通模式：单选元素悬浮操作条 */}
          {!isMarqueeMode && !wholeSlideResult && singleSelectedEl && !editingShapeId && (
            <div
              className="ppt-el-mini-toolbar"
              style={{
                left: `${Math.max(0, singleSelectedEl.bounds.x * pxPerPt)}px`,
                top: `${Math.max(4, singleSelectedEl.bounds.y * pxPerPt - 34)}px`,
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="ppt-mini-tb-btn is-accent"
                onClick={() => {
                  const payload = buildSelectionPayload(deck, pageIndex, {
                    shape_ids: [singleSelectedEl.shape_id],
                    selection_mode: 'element',
                  });
                  onSendSelectionToComposer(payload);
                }}
              >
                <MessageSquarePlus size={12} /> 引用到对话
              </button>
              <button
                type="button"
                className="ppt-mini-tb-btn"
                title="置于顶层"
                onClick={() => onReorderTop(singleSelectedEl.shape_id)}
              >
                <ArrowUpToLine size={12} /> 置顶
              </button>
              <button
                type="button"
                className="ppt-mini-tb-btn"
                title="复制元素"
                onClick={() => onDuplicateElement(singleSelectedEl.shape_id)}
              >
                <Copy size={12} /> 复制
              </button>
              <button
                type="button"
                className="ppt-mini-tb-btn"
                style={{ color: '#dc2626' }}
                title="删除元素"
                onClick={() => onDeleteElement(singleSelectedEl.shape_id)}
              >
                <Trash2 size={12} /> 删除
              </button>
            </div>
          )}

          {/* 自由框选 / 整页选中：精准索引悬浮 HUD */}
          {activeHudResult && (
            <div
              className="ppt-marquee-hud"
              data-testid={
                activeHudResult.selection_mode === 'whole-slide'
                  ? 'ppt-whole-slide-hud'
                  : 'ppt-marquee-hud'
              }
              style={{
                left: `${Math.max(
                  8,
                  Math.min(
                    deck.width_pt * pxPerPt - 330,
                    activeHudResult.selection_mode === 'whole-slide'
                      ? (deck.width_pt * pxPerPt - 340) / 2
                      : activeHudResult.bbox_pt.x * pxPerPt,
                  ),
                )}px`,
                top: `${Math.min(
                  deck.height_pt * pxPerPt - 20,
                  activeHudResult.selection_mode === 'whole-slide'
                    ? deck.height_pt * pxPerPt + 10
                    : (activeHudResult.bbox_pt.y + activeHudResult.bbox_pt.h) * pxPerPt + 10,
                )}px`,
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="ppt-marquee-hud-meta">
                {activeHudResult.selection_mode === 'whole-slide' && (
                  <span className="ppt-hud-tag">整页模式</span>
                )}
                <span className="ppt-hud-tag">page_index: {activeHudResult.page_index}</span>
                <span className="ppt-hud-tag">
                  {activeHudResult.selection_mode === 'whole-slide'
                    ? `共 ${activeHudResult.shape_ids.length} 个元素`
                    : `命中 ${activeHudResult.shape_ids.length} 个元素`}
                </span>
                <span className="ppt-hud-tag">
                  bbox: [{Math.round(activeHudResult.bbox_pt.x)},{' '}
                  {Math.round(activeHudResult.bbox_pt.y)},{' '}
                  {Math.round(activeHudResult.bbox_pt.w)},{' '}
                  {Math.round(activeHudResult.bbox_pt.h)}] pt
                </span>
              </div>

              {activeHudResult.shape_ids.length > 0 && (
                <div
                  style={{
                    fontSize: 11,
                    color: '#475569',
                    marginBottom: 8,
                    fontFamily: 'var(--dsh-font-mono)',
                    wordBreak: 'break-all',
                  }}
                >
                  shape_ids: {activeHudResult.shape_ids.join(', ')}
                </div>
              )}

              <div className="ppt-hud-actions">
                <button
                  type="button"
                  className="ppt-hud-btn primary"
                  onClick={() => {
                    onSendSelectionToComposer(activeHudResult);
                    onToast(
                      activeHudResult.selection_mode === 'whole-slide'
                        ? `已将第 ${activeHudResult.page_index + 1} 页整页引用写入对话输入框`
                        : '已将细粒度选区芯片写入对话输入框',
                    );
                  }}
                >
                  <MessageSquarePlus size={12} /> 引用到对话
                </button>

                <button
                  type="button"
                  className="ppt-hud-btn"
                  onClick={() => setAiInputOpen((v) => !v)}
                >
                  <Sparkles size={12} />{' '}
                  {activeHudResult.selection_mode === 'whole-slide'
                    ? 'AI 整页修改'
                    : 'AI 精准修改'}
                </button>

                <button
                  type="button"
                  className="ppt-hud-btn"
                  onClick={() => setInspectPayload(activeHudResult)}
                >
                  <Code2 size={12} /> 查看索引 JSON
                </button>

                <button
                  type="button"
                  className="ppt-hud-btn"
                  onClick={() => {
                    setMarqueeResult(null);
                    setWholeSlideResult(null);
                    setAiInputOpen(false);
                  }}
                >
                  <X size={12} /> 取消
                </button>
              </div>

              {aiInputOpen && (
                <form
                  className="ppt-hud-ai-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!aiPromptText.trim()) return;
                    onSendSelectionAiEdit(activeHudResult, aiPromptText.trim());
                    setAiPromptText('');
                    setAiInputOpen(false);
                  }}
                >
                  <input
                    className="ppt-hud-ai-input"
                    autoFocus
                    placeholder={
                      activeHudResult.selection_mode === 'whole-slide'
                        ? '输入整页修改指令，如：整体重排为三栏卡片、换浅色主题、精简文案'
                        : '输入修改指令，如：改成荧光青、标题改短、数值改 80%'
                    }
                    value={aiPromptText}
                    onChange={(e) => setAiPromptText(e.target.value)}
                  />
                  <button type="submit" className="ppt-hud-btn primary">
                    发送
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>

      {inspectPayload && (
        <IndexInspectorModal
          payload={inspectPayload}
          xmlPreview={`<tencent_docs_selection>\n  <selection_payload format="json">${JSON.stringify(
            inspectPayload,
          )}</selection_payload>\n</tencent_docs_selection>`}
          onClose={() => setInspectPayload(null)}
          onCopy={(txt) => {
            navigator.clipboard?.writeText(txt).catch(() => {});
            onToast('已复制到剪贴板');
          }}
        />
      )}
    </div>
  );
};
