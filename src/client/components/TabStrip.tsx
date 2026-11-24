import React, { useRef, useState } from 'react';
import {
  FilePlus2,
  FolderOpen,
  Maximize2,
  Minimize2,
  PanelRightClose,
  Plus,
  X,
} from 'lucide-react';
import type { PresentationDeck } from '../../core/types';

export interface TabStripProps {
  decks: PresentationDeck[];
  activeDeckId: string;
  dirtyIds?: Set<string>;
  isFullscreen: boolean;
  onSelectTab: (fileId: string) => void;
  onCloseTab: (fileId: string) => void;
  onCreateBlankDeck: () => void;
  onImportLocalPptx: (file: File) => void;
  onToggleFullscreen: () => void;
  onCollapseSidebar?: () => void;
}

export const TabStrip: React.FC<TabStripProps> = ({
  decks,
  activeDeckId,
  dirtyIds,
  isFullscreen,
  onSelectTab,
  onCloseTab,
  onCreateBlankDeck,
  onImportLocalPptx,
  onToggleFullscreen,
  onCollapseSidebar,
}) => {
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="ppt-tab-strip">
      <div className="ppt-tabs-scroll">
        {decks.map((deck) => {
          const active = deck.file_id === activeDeckId;
          const isDirty = dirtyIds?.has(deck.file_id);
          return (
            <div
              key={deck.file_id}
              className={`ppt-tab-item ${active ? 'is-active' : ''}`}
              role="tab"
              aria-selected={active}
              onClick={() => onSelectTab(deck.file_id)}
              title={deck.file_name}
            >
              <span className="dsh-ppt-badge-sm" aria-hidden="true">
                P
              </span>
              <span className="ppt-tab-label">
                {deck.file_name}
                {isDirty ? ' *' : ''}
              </span>
              <button
                type="button"
                className="ppt-tab-close"
                aria-label={`关闭 ${deck.file_name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(deck.file_id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}

        <div className="ppt-tab-plus-wrap ppt-popover-anchor">
          <button
            type="button"
            className="dsh-icon-btn"
            title="新建或导入 .pptx 演示文稿"
            data-testid="ppt-tab-add-btn"
            onClick={() => setPlusMenuOpen((v) => !v)}
          >
            <Plus size={16} />
          </button>

          {plusMenuOpen && (
            <div className="ppt-dropdown-menu" style={{ minWidth: 196 }}>
              <button
                type="button"
                className="ppt-dropdown-item"
                onClick={() => {
                  setPlusMenuOpen(false);
                  onCreateBlankDeck();
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <FilePlus2 size={14} />
                  新建空白 16:9 演示文稿
                </span>
              </button>
              <button
                type="button"
                className="ppt-dropdown-item"
                onClick={() => {
                  setPlusMenuOpen(false);
                  fileInputRef.current?.click();
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <FolderOpen size={14} />
                  导入本地 .pptx 文件...
                </span>
              </button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".pptx"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onImportLocalPptx(file);
                e.target.value = '';
              }
            }}
          />
        </div>
      </div>

      <div className="ppt-tab-strip-right">
        <button
          type="button"
          className="dsh-icon-btn"
          title={isFullscreen ? '退出全屏' : '展开全屏'}
          onClick={onToggleFullscreen}
        >
          {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        {onCollapseSidebar && (
          <button
            type="button"
            className="dsh-icon-btn"
            title="折叠右侧工作区"
            onClick={onCollapseSidebar}
          >
            <PanelRightClose size={15} />
          </button>
        )}
      </div>
    </div>
  );
};
