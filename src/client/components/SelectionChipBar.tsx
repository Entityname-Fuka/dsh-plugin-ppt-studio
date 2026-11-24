import React, { useState, useSyncExternalStore } from 'react';
import { Code2, Crosshair, MessageSquarePlus, X } from 'lucide-react';
import { renderTencentDocsSelectionPrompt } from '../../core/context-index';
import type { DocumentSelectionContextBlock, SlideSelectionPayload } from '../../core/types';
import type { SelectionFocusTarget } from '../dsh-types';
import type { SelectionBus } from '../selection-bus';
import { IndexInspectorModal } from './IndexInspectorModal';

export interface SelectionChipBarProps {
  selectionBus: SelectionBus;
  onFocusSelection?: (target: SelectionFocusTarget) => void;
  onCopyToast?: (msg: string) => void;
  onInsertPrompt?: (serializedPrompt: string) => void;
}

function formatChipText(block: DocumentSelectionContextBlock): string {
  const payload = block._meta.selectionPayload;
  const pageNum = payload.page_index + 1;
  const count = payload.shape_ids.length;
  if (payload.selection_mode === 'whole-slide') {
    return `第 ${pageNum} 页 · 整页 (${count} 个元素)`;
  }
  const modeLabel =
    payload.selection_mode === 'free-marquee'
      ? '自由框选'
      : payload.selection_mode === 'multi-element'
        ? '多选'
        : payload.selection_mode === 'table-cells'
          ? '表格选区'
          : '元素';
  return `第 ${pageNum} 页 · ${modeLabel} · ${count} 个元素`;
}

export const SelectionChipBar: React.FC<SelectionChipBarProps> = ({
  selectionBus,
  onFocusSelection,
  onCopyToast,
  onInsertPrompt,
}) => {
  const blocks = useSyncExternalStore(
    selectionBus.subscribe,
    () => selectionBus.getBlocks(),
    () => selectionBus.getBlocks(),
  );
  const [inspectingBlock, setInspectingBlock] = useState<DocumentSelectionContextBlock | null>(
    null,
  );

  if (blocks.length === 0) return null;

  return (
    <>
      <div className="dsh-selection-chip-bar" data-testid="dsh-selection-chip-bar">
        {blocks.map((block) => {
          const payload = block._meta.selectionPayload as SlideSelectionPayload;
          return (
            <div
              key={block.uri}
              className="dsh-selection-chip"
              role="button"
              tabIndex={0}
              title={`点击定位并高亮：${payload.text}`}
              onClick={() =>
                onFocusSelection?.({
                  fileId: block._meta.fileId,
                  uri: block._meta.documentResourceUri,
                  page_index: payload.page_index,
                  shape_ids: payload.shape_ids,
                  bbox_pt: payload.bbox_pt,
                  rangeId: payload.rangeId,
                })
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onFocusSelection?.({
                    fileId: block._meta.fileId,
                    uri: block._meta.documentResourceUri,
                    page_index: payload.page_index,
                    shape_ids: payload.shape_ids,
                    bbox_pt: payload.bbox_pt,
                    rangeId: payload.rangeId,
                  });
                }
              }}
            >
              <span className="dsh-ppt-badge-sm" style={{ width: 14, height: 14, fontSize: 9 }}>
                P
              </span>
              <Crosshair size={11} />
              <span className="dsh-selection-chip-label">{formatChipText(block)}</span>

              {onInsertPrompt && (
                <button
                  type="button"
                  className="dsh-selection-chip-action"
                  data-testid="dsh-selection-insert-btn"
                  title="插入到对话"
                  aria-label="插入到对话"
                  style={{ padding: '1px 5px', fontSize: 10.5, fontWeight: 600, gap: 3 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onInsertPrompt(renderTencentDocsSelectionPrompt(block));
                  }}
                >
                  <MessageSquarePlus size={11} />
                  <span>插入引用</span>
                </button>
              )}

              <button
                type="button"
                className="dsh-selection-chip-action"
                title="查看 Agent 索引 JSON / XML"
                onClick={(e) => {
                  e.stopPropagation();
                  setInspectingBlock(block);
                }}
              >
                <Code2 size={11} />
              </button>

              <button
                type="button"
                className="dsh-selection-chip-action"
                title="移除此选区引用"
                aria-label="移除此选区引用"
                onClick={(e) => {
                  e.stopPropagation();
                  selectionBus.dismissBlock(block);
                }}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>

      {inspectingBlock && (
        <IndexInspectorModal
          payload={inspectingBlock._meta.selectionPayload as SlideSelectionPayload}
          contextBlock={inspectingBlock}
          xmlPreview={renderTencentDocsSelectionPrompt(inspectingBlock)}
          onClose={() => setInspectingBlock(null)}
          onCopy={(txt) => {
            navigator.clipboard?.writeText(txt).catch(() => {});
            onCopyToast?.('已复制到剪贴板');
          }}
        />
      )}
    </>
  );
};
