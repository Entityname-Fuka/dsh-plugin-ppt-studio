import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, StickyNote, X } from 'lucide-react';
import type { PresentationDeck } from '../../core/types';
import { PT_TO_PX_RATIO } from '../../core/constants';
import { SlideRenderer } from './SlideRenderer';

export interface SlideshowModalProps {
  deck: PresentationDeck;
  initialPageIndex: number;
  onClose: (lastPageIndex: number) => void;
}

const AUTO_HIDE_DELAY_MS = 2000;

export const SlideshowModal: React.FC<SlideshowModalProps> = ({
  deck,
  initialPageIndex,
  onClose,
}) => {
  const [pageIdx, setPageIdx] = useState(
    Math.max(0, Math.min(deck.slides.length - 1, initialPageIndex)),
  );
  const [showNotes, setShowNotes] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 720,
  }));

  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageIdxRef = useRef(pageIdx);
  pageIdxRef.current = pageIdx;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const enteredFullscreenRef = useRef(false);
  const closedRef = useRef(false);
  const isHoveringControlsRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHideControls = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      if (!isHoveringControlsRef.current) {
        setControlsVisible(false);
      }
    }, AUTO_HIDE_DELAY_MS);
  }, [clearHideTimer]);

  const triggerClose = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    clearHideTimer();
    if (
      typeof document !== 'undefined' &&
      document.fullscreenElement === containerRef.current &&
      typeof document.exitFullscreen === 'function'
    ) {
      void document.exitFullscreen().catch(() => {});
    }
    onCloseRef.current(pageIdxRef.current);
  }, [clearHideTimer]);

  // Enter true OS Fullscreen when mounted, track fullscreen exits & viewport size
  useEffect(() => {
    const el = containerRef.current;
    const updateViewport = () => {
      if (typeof window === 'undefined') return;
      setViewport({
        w: window.innerWidth || 1280,
        h: window.innerHeight || 720,
      });
    };

    const handleFullscreenChange = () => {
      updateViewport();
      if (typeof document === 'undefined') return;
      if (document.fullscreenElement === el) {
        enteredFullscreenRef.current = true;
      } else if (enteredFullscreenRef.current && !document.fullscreenElement) {
        triggerClose();
      }
    };

    if (el && typeof el.requestFullscreen === 'function') {
      try {
        Promise.resolve(el.requestFullscreen())
          .then(() => {
            enteredFullscreenRef.current = true;
            updateViewport();
          })
          .catch(() => {
            // Gracefully degrade to fixed viewport fullscreen (z-index: 99999)
          });
      } catch {
        // Gracefully degrade to fixed viewport fullscreen
      }
    }

    scheduleHideControls();
    window.addEventListener('resize', updateViewport);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      clearHideTimer();
      window.removeEventListener('resize', updateViewport);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (
        typeof document !== 'undefined' &&
        document.fullscreenElement === el &&
        typeof document.exitFullscreen === 'function'
      ) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, [clearHideTimer, scheduleHideControls, triggerClose]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        triggerClose();
      } else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        e.stopPropagation();
        setPageIdx((i) => Math.min(deck.slides.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        e.stopPropagation();
        setPageIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        e.stopPropagation();
        setPageIdx(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        e.stopPropagation();
        setPageIdx(Math.max(0, deck.slides.length - 1));
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        e.stopPropagation();
        setShowNotes((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deck.slides.length, triggerClose]);

  const slide = deck.slides[pageIdx];
  if (!slide) return null;

  const baseW = deck.width_pt * PT_TO_PX_RATIO;
  const baseH = deck.height_pt * PT_TO_PX_RATIO;
  const padX = Math.max(16, viewport.w * 0.02);
  const padY = Math.max(16, viewport.h * 0.02);
  const scale = Math.max(
    0.2,
    Math.min((viewport.w - padX) / baseW, (viewport.h - padY) / baseH),
  );

  const modalContent = (
    <div
      ref={containerRef}
      className={`ppt-slideshow-backdrop dsh-plugin-root ${controlsVisible ? '' : 'is-idle'}`}
      role="dialog"
      aria-modal="true"
      aria-label="全屏放映模式"
      data-testid="ppt-slideshow-modal"
      onMouseMove={() => {
        setControlsVisible(true);
        scheduleHideControls();
      }}
    >
      <div className="ppt-slideshow-stage">
        <SlideRenderer
          slide={slide}
          widthPt={deck.width_pt}
          heightPt={deck.height_pt}
          scale={scale}
        />
      </div>

      {showNotes && (
        <aside
          className="ppt-slideshow-notes-drawer"
          aria-label="演讲者备注"
        >
          <div className="ppt-slideshow-notes-title">
            演讲者备注 (第 {pageIdx + 1} 页)
          </div>
          <div className="ppt-slideshow-notes-body">
            {slide.notes || '（当前页暂无演讲者备注）'}
          </div>
        </aside>
      )}

      <div
        className={`ppt-slideshow-controls ${controlsVisible ? 'is-visible' : 'is-hidden'}`}
        onMouseEnter={() => {
          isHoveringControlsRef.current = true;
          clearHideTimer();
          setControlsVisible(true);
        }}
        onMouseLeave={() => {
          isHoveringControlsRef.current = false;
          scheduleHideControls();
        }}
      >
        <button
          type="button"
          className="ppt-slideshow-btn"
          disabled={pageIdx === 0}
          title="上一页 (←)"
          onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
        >
          <ChevronLeft size={14} />
        </button>

        <span>
          {pageIdx + 1} / {deck.slides.length} · {slide.title}
        </span>

        <button
          type="button"
          className="ppt-slideshow-btn"
          disabled={pageIdx >= deck.slides.length - 1}
          title="下一页 (→ / 空格)"
          onClick={() => setPageIdx((i) => Math.min(deck.slides.length - 1, i + 1))}
        >
          <ChevronRight size={14} />
        </button>

        <button
          type="button"
          className={`ppt-slideshow-btn ${showNotes ? 'is-active' : ''}`}
          onClick={() => setShowNotes((v) => !v)}
          title="切换演讲者备注面板 (N)"
        >
          <StickyNote size={13} />
        </button>

        <button
          type="button"
          className="ppt-slideshow-btn"
          onClick={triggerClose}
          title="退出放映 (Esc)"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
};
