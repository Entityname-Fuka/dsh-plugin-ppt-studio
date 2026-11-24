import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutGrid,
  ListTree,
  Maximize,
  Minus,
  MonitorPlay,
  Plus,
  StickyNote,
} from 'lucide-react';

export interface NotesAndStatusBarProps {
  notes: string;
  showNotes: boolean;
  showOutline: boolean;
  isSlideSorter: boolean;
  currentPageIndex: number; // 0-based
  totalPages: number;
  zoomPercent: number;
  onChangeNotes: (notes: string, kind?: 'edit' | 'paste') => void;
  onToggleNotes: () => void;
  onToggleOutline: () => void;
  onToggleSlideSorter: () => void;
  onStartSlideshow: () => void;
  onFitWindow: () => void;
  onChangeZoom: (nextZoom: number) => void;
}

export const NotesAndStatusBar: React.FC<NotesAndStatusBarProps> = ({
  notes,
  showNotes,
  showOutline,
  isSlideSorter,
  currentPageIndex,
  totalPages,
  zoomPercent,
  onChangeNotes,
  onToggleNotes,
  onToggleOutline,
  onToggleSlideSorter,
  onStartSlideshow,
  onFitWindow,
  onChangeZoom,
}) => {
  const [draft, setDraft] = useState(notes);
  const lastCommittedRef = useRef(notes);
  const isComposingRef = useRef(false);
  const pendingPasteRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(notes);
    lastCommittedRef.current = notes;
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, [notes, currentPageIndex]);

  useEffect(() => {
    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
    };
  }, []);

  const commitDraft = (nextValue: string, kind: 'edit' | 'paste') => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (nextValue === lastCommittedRef.current) return;
    lastCommittedRef.current = nextValue;
    onChangeNotes(nextValue, kind);
  };

  return (
    <>
      {showNotes && (
        <div className="ppt-notes-bar">
          <textarea
            className="ppt-notes-textarea"
            data-testid="ppt-notes-textarea"
            placeholder="点击添加备注"
            value={draft}
            onCompositionStart={() => {
              isComposingRef.current = true;
              if (idleTimerRef.current) {
                clearTimeout(idleTimerRef.current);
                idleTimerRef.current = null;
              }
            }}
            onCompositionEnd={(e) => {
              isComposingRef.current = false;
              const val = e.currentTarget.value;
              setDraft(val);
              commitDraft(val, 'edit');
            }}
            onPaste={() => {
              // 若粘贴前已有未收口的非输入法打字，先将其收口为 1 条
              if (draft !== lastCommittedRef.current) {
                commitDraft(draft, 'edit');
              }
              pendingPasteRef.current = true;
            }}
            onChange={(e) => {
              const val = e.target.value;
              setDraft(val);
              if (pendingPasteRef.current) {
                pendingPasteRef.current = false;
                commitDraft(val, 'paste');
                return;
              }
              if (isComposingRef.current) {
                return;
              }
              // 非输入法连续输入（英文/删除等）在停顿 800ms 或失焦时合并为 1 条记录
              if (idleTimerRef.current) {
                clearTimeout(idleTimerRef.current);
              }
              idleTimerRef.current = setTimeout(() => {
                idleTimerRef.current = null;
                commitDraft(val, 'edit');
              }, 800);
            }}
            onBlur={() => {
              if (!isComposingRef.current) {
                commitDraft(draft, 'edit');
              }
            }}
          />
        </div>
      )}

      <div className="ppt-status-bar">
        <div className="ppt-status-group">
          <button
            type="button"
            className={`dsh-icon-btn ${showOutline ? 'is-active' : ''}`}
            style={{ width: 22, height: 22 }}
            title="切换缩略图 / 大纲导航"
            onClick={onToggleOutline}
          >
            <ListTree size={13} />
          </button>
          <span>
            第 {Math.min(totalPages, currentPageIndex + 1)} 页/共 {totalPages} 页
          </span>
        </div>

        <div className="ppt-status-group">
          <button
            type="button"
            className="dsh-icon-btn"
            style={{
              width: 22,
              height: 22,
              color: showNotes ? '#2563EB' : undefined,
            }}
            title="显示/隐藏演讲者备注"
            onClick={onToggleNotes}
          >
            <StickyNote size={13} />
          </button>

          <button
            type="button"
            className="dsh-icon-btn"
            style={{
              width: 22,
              height: 22,
              color: isSlideSorter ? '#2563EB' : undefined,
            }}
            title="幻灯片浏览视图"
            onClick={onToggleSlideSorter}
          >
            <LayoutGrid size={13} />
          </button>

          <button
            type="button"
            className="dsh-icon-btn"
            style={{ width: 22, height: 22 }}
            title="从当前页放映"
            onClick={onStartSlideshow}
          >
            <MonitorPlay size={13} />
          </button>

          <button
            type="button"
            className="dsh-icon-btn"
            style={{ width: 22, height: 22 }}
            title="适应窗口 (39%)"
            onClick={onFitWindow}
          >
            <Maximize size={13} />
          </button>

          <div className="ppt-zoom-control">
            <button
              type="button"
              className="ppt-zoom-btn"
              title="缩小画布"
              onClick={() => onChangeZoom(Math.max(20, zoomPercent - 5))}
            >
              <Minus size={11} />
            </button>
            <span style={{ minWidth: 34, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
              {zoomPercent}%
            </span>
            <button
              type="button"
              className="ppt-zoom-btn"
              title="放大画布"
              onClick={() => onChangeZoom(Math.min(140, zoomPercent + 5))}
            >
              <Plus size={11} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
