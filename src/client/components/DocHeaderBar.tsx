import React, { useState } from 'react';
import {
  ChevronDown,
  ExternalLink,
  Folder,
  History,
  MoreHorizontal,
  PlayCircle,
  Redo2,
  RotateCcw,
  Save,
  Share2,
  Undo2,
  Upload,
} from 'lucide-react';
import type { ManualHistoryEntry, PresentationDeck } from '../../core/types';

export interface DocHeaderBarProps {
  deck: PresentationDeck;
  isDirty: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  undoEntries?: ManualHistoryEntry[];
  redoEntries?: ManualHistoryEntry[];
  hasSavedBaseline?: boolean;
  onRename: (newName: string) => void;
  onLocateFolder?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onJumpHistory?: (direction: 'undo' | 'redo', steps: number) => void;
  onSave: () => void;
  onRevertToSaved?: () => void;
  onExportPptx: () => void;
  onOpenExternal?: () => void;
  onStartSlideshow: () => void;
  onUndoAiEdit: (editId?: string) => void;
  onInspectDeckIndex: () => void;
  onShare: () => void;
}

function formatHistoryTime(ts: number): string {
  try {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return '';
  }
}

export const DocHeaderBar: React.FC<DocHeaderBarProps> = ({
  deck,
  isDirty,
  canUndo = false,
  canRedo = false,
  undoEntries = [],
  redoEntries = [],
  hasSavedBaseline = false,
  onRename,
  onLocateFolder,
  onUndo,
  onRedo,
  onJumpHistory,
  onSave,
  onRevertToSaved,
  onExportPptx,
  onOpenExternal,
  onStartSlideshow,
  onUndoAiEdit,
  onInspectDeckIndex,
  onShare,
}) => {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(deck.file_name);
  const [moreOpen, setMoreOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const commitName = () => {
    setEditing(false);
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== deck.file_name) {
      const normalized = trimmed.toLowerCase().endsWith('.pptx')
        ? trimmed
        : `${trimmed}.pptx`;
      onRename(normalized);
    }
  };

  const activeAiEdits = deck.ai_edits.filter((e) => !e.reverted).slice(-6).reverse();
  const nextUndo = undoEntries[0];
  const nextRedo = redoEntries[0];
  const undoTitle = nextUndo
    ? `撤销：${nextUndo.label}（还可撤销 ${undoEntries.length} 步）(Ctrl+Z)`
    : '撤销手动修改 (Ctrl+Z)';
  const redoTitle = nextRedo
    ? `重做：${nextRedo.label}（还可重做 ${redoEntries.length} 步）(Ctrl+Y)`
    : '重做手动修改 (Ctrl+Y)';
  // 下拉列表展示：顶部为可重做（最远未来在最上），中间为当前状态，下方为更早状态与初始基线
  const redoDisplayOrder = [...redoEntries].reverse();
  const hasAnyManualHistory = undoEntries.length > 0 || redoEntries.length > 0;

  return (
    <div className="ppt-doc-header">
      <div className="ppt-doc-title-group">
        {editing ? (
          <input
            className="ppt-doc-name-input"
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') {
                setEditing(false);
                setDraftName(deck.file_name);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="ppt-doc-name-btn"
            title="点击重命名演示文稿"
            onClick={() => {
              setDraftName(deck.file_name);
              setEditing(true);
            }}
          >
            {deck.file_name}
          </button>
        )}

        <button
          type="button"
          className="dsh-icon-btn"
          title={`文件路径: ${deck.file_path}`}
          onClick={onLocateFolder}
        >
          <Folder size={14} />
        </button>
      </div>

      <div className="ppt-doc-actions">
        <div className="ppt-popover-anchor ppt-undo-split">
          <button
            type="button"
            className="dsh-icon-btn"
            data-testid="ppt-header-undo-btn"
            disabled={!canUndo}
            title={undoTitle}
            aria-label="撤销手动修改"
            onClick={onUndo}
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            className={`dsh-icon-btn ppt-undo-caret-btn ${historyOpen ? 'is-active' : ''}`}
            data-testid="ppt-manual-history-btn"
            title={`查看手动操作历史（可撤销 ${undoEntries.length} 步）`}
            aria-label="查看手动操作历史"
            onClick={() => {
              setMoreOpen(false);
              setHistoryOpen((v) => !v);
            }}
          >
            <ChevronDown size={11} />
          </button>

          {historyOpen && (
            <div
              className="ppt-dropdown-menu align-right ppt-history-dropdown"
              data-testid="ppt-manual-history-menu"
            >
              <div className="ppt-history-header">
                <History size={12} />
                <span>
                  手动操作历史（可撤销 {undoEntries.length} / 可重做 {redoEntries.length}）
                </span>
              </div>
              {!hasAnyManualHistory ? (
                <div className="ppt-history-empty">暂无可撤销的手动操作</div>
              ) : (
                <div className="ppt-history-list">
                  {redoDisplayOrder.map((entry, idx) => {
                    const stepsToRedo = redoDisplayOrder.length - idx;
                    return (
                      <button
                        key={`redo_${entry.id}_${idx}`}
                        type="button"
                        className="ppt-history-item is-redo"
                        data-testid={`ppt-history-redo-${stepsToRedo}`}
                        onClick={() => {
                          setHistoryOpen(false);
                          onJumpHistory?.('redo', stepsToRedo);
                        }}
                      >
                        <span className="ppt-history-label">{entry.label}</span>
                        <span className="ppt-history-meta">
                          {entry.page_index !== undefined
                            ? `第 ${entry.page_index + 1} 页`
                            : '全局'}{' '}
                          · {formatHistoryTime(entry.timestamp)}
                        </span>
                      </button>
                    );
                  })}

                  <div className="ppt-history-item is-current" data-testid="ppt-history-current">
                    <span className="ppt-history-label">
                      <span className="ppt-history-current-dot" />
                      {nextUndo ? nextUndo.label : '初始基线状态'}
                    </span>
                    <span className="ppt-history-meta">
                      {nextUndo
                        ? `${
                            nextUndo.page_index !== undefined
                              ? `第 ${nextUndo.page_index + 1} 页`
                              : '全局'
                          } · 当前`
                        : '当前'}
                    </span>
                  </div>

                  {undoEntries.slice(1).map((entry, idx) => {
                    const stepsToUndo = idx + 1;
                    return (
                      <button
                        key={`undo_${entry.id}_${idx}`}
                        type="button"
                        className="ppt-history-item"
                        data-testid={`ppt-history-undo-${stepsToUndo}`}
                        onClick={() => {
                          setHistoryOpen(false);
                          onJumpHistory?.('undo', stepsToUndo);
                        }}
                      >
                        <span className="ppt-history-label">{entry.label}</span>
                        <span className="ppt-history-meta">
                          {entry.page_index !== undefined
                            ? `第 ${entry.page_index + 1} 页`
                            : '全局'}{' '}
                          · {formatHistoryTime(entry.timestamp)}
                        </span>
                      </button>
                    );
                  })}

                  {undoEntries.length > 0 && (
                    <button
                      type="button"
                      className="ppt-history-item is-baseline"
                      data-testid="ppt-history-baseline"
                      onClick={() => {
                        setHistoryOpen(false);
                        onJumpHistory?.('undo', undoEntries.length);
                      }}
                    >
                      <span className="ppt-history-label">初始基线状态</span>
                      <span className="ppt-history-meta">回退全部 {undoEntries.length} 步</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className="dsh-icon-btn"
          data-testid="ppt-header-redo-btn"
          disabled={!canRedo}
          title={redoTitle}
          aria-label="重做手动修改"
          onClick={onRedo}
        >
          <Redo2 size={15} />
        </button>

        <button
          type="button"
          className="dsh-icon-btn"
          style={{ position: 'relative' }}
          title={isDirty ? '保存当前更改 (有未保存修改)' : '已保存'}
          onClick={onSave}
        >
          <Save size={15} />
          {isDirty && <span className="ppt-dirty-dot" />}
        </button>

        <button
          type="button"
          className="dsh-icon-btn"
          title="导出并下载标准 .pptx 文件"
          onClick={onExportPptx}
        >
          <Upload size={15} />
        </button>

        <button
          type="button"
          className="dsh-icon-btn"
          data-testid="ppt-header-external-btn"
          title="用系统默认应用打开"
          aria-label="用系统默认应用打开"
          onClick={onOpenExternal}
        >
          <ExternalLink size={15} />
        </button>

        <button
          type="button"
          className="dsh-icon-btn"
          title="从当前页开始放映预览"
          onClick={onStartSlideshow}
        >
          <PlayCircle size={15} />
        </button>

        <div className="ppt-popover-anchor">
          <button
            type="button"
            className="dsh-icon-btn"
            data-testid="ppt-header-more-btn"
            title="更多操作与 AI 编辑历史"
            onClick={() => setMoreOpen((v) => !v)}
          >
            <MoreHorizontal size={15} />
          </button>

          {moreOpen && (
            <div className="ppt-dropdown-menu align-right" style={{ minWidth: 268 }}>
              <button
                type="button"
                className="ppt-dropdown-item"
                data-testid="ppt-revert-saved-btn"
                disabled={!hasSavedBaseline}
                title={
                  hasSavedBaseline
                    ? '放弃未保存修改，还原到上次保存状态'
                    : '尚未保存过，无法还原'
                }
                onClick={() => {
                  if (!hasSavedBaseline) return;
                  setMoreOpen(false);
                  onRevertToSaved?.();
                }}
              >
                <span>还原到上次保存</span>
                {!hasSavedBaseline && (
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>
                    尚未保存过，无法还原
                  </span>
                )}
              </button>
              <button
                type="button"
                className="ppt-dropdown-item"
                onClick={() => {
                  setMoreOpen(false);
                  onInspectDeckIndex();
                }}
              >
                <span>查看当前页上下文索引 JSON</span>
              </button>
              <div
                style={{
                  borderTop: '1px solid #f0f2f5',
                  margin: '4px 0',
                  padding: '4px 8px 2px',
                  fontSize: 11,
                  color: '#9ca3af',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <History size={11} />
                <span>最近 AI 精准编辑记录 ({activeAiEdits.length})</span>
              </div>
              {activeAiEdits.length === 0 ? (
                <div style={{ padding: '6px 9px', fontSize: 11.5, color: '#9ca3af' }}>
                  暂无可撤销的 AI 编辑记录
                </div>
              ) : (
                activeAiEdits.map((rec) => (
                  <button
                    key={rec.edit_id}
                    type="button"
                    className="ppt-dropdown-item"
                    onClick={() => {
                      setMoreOpen(false);
                      onUndoAiEdit(rec.edit_id);
                    }}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 192,
                      }}
                    >
                      v{rec.version}: {rec.summary}
                    </span>
                    <RotateCcw size={12} color="#2563eb" />
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <button type="button" className="dsh-share-btn" onClick={onShare}>
          <Share2 size={13} />
          <span>分享</span>
        </button>
      </div>
    </div>
  );
};
