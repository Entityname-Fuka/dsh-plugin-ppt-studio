import React, { useState } from 'react';
import { Copy, MessageSquarePlus, Trash2 } from 'lucide-react';
import type { SlidePage } from '../../core/types';
import { PT_TO_PX_RATIO } from '../../core/constants';
import { SlideRenderer } from './SlideRenderer';

export interface ThumbnailRailProps {
  slides: SlidePage[];
  widthPt: number;
  heightPt: number;
  activePageIndex: number;
  onSelectPage: (pageIndex: number) => void;
  onSelectWholeSlide?: (pageIndex: number) => void;
  onAddPage: () => void;
  onDuplicatePage: (pageIndex: number) => void;
  onDeletePage: (pageIndex: number) => void;
  onMovePage: (fromIndex: number, toIndex: number) => void;
}

export const ThumbnailRail: React.FC<ThumbnailRailProps> = ({
  slides,
  widthPt,
  heightPt,
  activePageIndex,
  onSelectPage,
  onSelectWholeSlide,
  onAddPage,
  onDuplicatePage,
  onDeletePage,
  onMovePage,
}) => {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const thumbScale = 104 / (widthPt * PT_TO_PX_RATIO);

  return (
    <aside className="ppt-thumbnail-rail" aria-label="幻灯片缩略图导航">
      <button
        type="button"
        className="ppt-add-slide-btn"
        onClick={onAddPage}
        data-testid="ppt-add-slide-btn"
      >
        添加页面
      </button>

      <div className="ppt-thumb-list">
        {slides.map((slide, idx) => {
          const active = idx === activePageIndex;
          const isOver = dragOverIndex === idx && dragIndex !== idx;
          return (
            <div
              key={slide.slide_id}
              className={`ppt-thumb-row ${active ? 'is-active' : ''} ${
                isOver ? 'is-drag-over' : ''
              }`}
              draggable
              onDragStart={(e) => {
                setDragIndex(idx);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(idx));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverIndex(idx);
              }}
              onDragLeave={() => {
                if (dragOverIndex === idx) setDragOverIndex(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragIndex ?? Number(e.dataTransfer.getData('text/plain'));
                setDragIndex(null);
                setDragOverIndex(null);
                if (!Number.isNaN(from) && from !== idx) {
                  onMovePage(from, idx);
                }
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setDragOverIndex(null);
              }}
              onClick={() => onSelectPage(idx)}
              title={`第 ${idx + 1} 页: ${slide.title}`}
            >
              <span className="ppt-thumb-index">{idx + 1}</span>
              <div className="ppt-thumb-frame">
                <SlideRenderer
                  slide={slide}
                  widthPt={widthPt}
                  heightPt={heightPt}
                  scale={thumbScale}
                />
                <div
                  className="ppt-thumb-hover-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  {onSelectWholeSlide && (
                    <button
                      type="button"
                      className="ppt-thumb-mini-btn is-accent"
                      title="引用整页给 Agent 修改"
                      data-testid={`ppt-thumb-ref-page-${idx}`}
                      onClick={() => onSelectWholeSlide(idx)}
                    >
                      <MessageSquarePlus size={10} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="ppt-thumb-mini-btn"
                    title="复制此页"
                    onClick={() => onDuplicatePage(idx)}
                  >
                    <Copy size={10} />
                  </button>
                  {slides.length > 1 && (
                    <button
                      type="button"
                      className="ppt-thumb-mini-btn"
                      title="删除此页"
                      onClick={() => onDeletePage(idx)}
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
};
