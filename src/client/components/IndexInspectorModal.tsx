import React from 'react';
import { Copy, X } from 'lucide-react';
import type {
  DocumentSelectionContextBlock,
  SlideSelectionPayload,
} from '../../core/types';

export interface IndexInspectorModalProps {
  payload: SlideSelectionPayload;
  xmlPreview: string;
  contextBlock?: DocumentSelectionContextBlock;
  onClose: () => void;
  onCopy?: (text: string) => void;
}

export const IndexInspectorModal: React.FC<IndexInspectorModalProps> = ({
  payload,
  xmlPreview,
  contextBlock,
  onClose,
  onCopy,
}) => {
  const jsonText = JSON.stringify(payload, null, 2);

  return (
    <div
      className="ppt-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-label="细粒度上下文索引查看器"
    >
      <div className="ppt-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="ppt-modal-header">
          <span>
            Agent 细粒度选区索引详情 · 第 {payload.page_index + 1} 页 (0-based page_index:{' '}
            {payload.page_index})
          </span>
          <button type="button" className="dsh-icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="ppt-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.55 }}>
            <div>
              <strong>URI</strong>:{' '}
              <code>{contextBlock?.uri || `tdoc-selection://${encodeURIComponent(payload.rangeId)}`}</code>
            </div>
            <div>
              <strong>selection_mode</strong>: <code>{payload.selection_mode}</code> ·{' '}
              <strong>shape_indices (0-based)</strong>:{' '}
              <code>[{payload.shape_indices.join(', ')}]</code> ·{' '}
              <strong>recommended_tools</strong>:{' '}
              <code>{payload.recommended_tools.join(', ')}</code>
            </div>
          </div>

          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 6,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <span>SlideSelectionPayload JSON（直接对齐 slide_* 工具入参）</span>
              <button
                type="button"
                className="ppt-hud-btn"
                onClick={() => onCopy?.(jsonText)}
              >
                <Copy size={12} /> 复制 JSON
              </button>
            </div>
            <pre className="ppt-code-pre">{jsonText}</pre>
          </div>

          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 6,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <span>LLM Prompt 序列化 XML（&lt;tencent_docs_selection&gt;）</span>
              <button
                type="button"
                className="ppt-hud-btn"
                onClick={() => onCopy?.(xmlPreview)}
              >
                <Copy size={12} /> 复制 XML
              </button>
            </div>
            <pre className="ppt-code-pre">{xmlPreview}</pre>
          </div>
        </div>
      </div>
    </div>
  );
};
