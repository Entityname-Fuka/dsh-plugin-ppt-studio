import React, { useState } from 'react';
import {
  ChevronRight,
  Download,
  ExternalLink,
  MoreHorizontal,
  Share2,
} from 'lucide-react';
import type { ArtifactSlotProps } from '../dsh-types';

export const ArtifactCard: React.FC<ArtifactSlotProps> = ({
  artifact,
  onOpenArtifact,
  onOpenWindow,
  onShareArtifact,
  onViewAllArtifacts,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);

  const sizeLabel =
    artifact.fileSizeLabel ||
    (artifact.fileSizeBytes
      ? `${(artifact.fileSizeBytes / 1024).toFixed(1)} KB`
      : '76.3 KB');

  const totalCount = artifact.totalArtifactsCount ?? 1;
  const sourceCount = artifact.sourceCount ?? 12;

  return (
    <div data-testid="dsh-artifact-entry">
      <div
        className="dsh-artifact-card"
        role="button"
        tabIndex={0}
        onClick={() => onOpenArtifact?.(artifact)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenArtifact?.(artifact);
          }
        }}
        title="点击在右侧工作区打开并编辑演示文稿"
      >
        <div className="dsh-ppt-badge-lg" aria-hidden="true">
          P
        </div>

        <div className="dsh-artifact-info">
          <div className="dsh-artifact-name">{artifact.fileName}</div>
          <div className="dsh-artifact-meta">{sizeLabel}</div>
        </div>

        <div
          className="dsh-artifact-actions"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ppt-popover-anchor">
            <button
              type="button"
              className="dsh-icon-btn"
              title="更多操作"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div className="ppt-dropdown-menu align-right">
                <button
                  type="button"
                  className="ppt-dropdown-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenArtifact?.(artifact);
                  }}
                >
                  <span>在右侧栏打开编辑</span>
                </button>
                <button
                  type="button"
                  className="ppt-dropdown-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenWindow?.(artifact);
                  }}
                >
                  <span>独立窗口打开 (1440×900)</span>
                </button>
                <button
                  type="button"
                  className="ppt-dropdown-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onShareArtifact?.(artifact);
                  }}
                >
                  <span>导出 .pptx 文件</span>
                  <Download size={13} />
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            className="dsh-icon-btn"
            data-office-window-entry="true"
            title="独立窗口打开"
            onClick={() => onOpenWindow?.(artifact)}
          >
            <ExternalLink size={15} />
          </button>

          <button
            type="button"
            className="dsh-share-btn"
            onClick={() => onShareArtifact?.(artifact)}
          >
            <Share2 size={13} />
            <span>分享</span>
          </button>
        </div>
      </div>

      <div className="dsh-artifact-subbar">
        <button
          type="button"
          className="dsh-link-btn"
          onClick={() => onViewAllArtifacts?.() ?? onOpenArtifact?.(artifact)}
        >
          <span>查看所有产物 ({totalCount})</span>
          <ChevronRight size={13} />
        </button>

        <span className="dsh-source-pills">
          <span className="dsh-source-dots" aria-hidden="true">
            <span className="dsh-source-dot" style={{ background: '#2563EB' }} />
            <span className="dsh-source-dot" style={{ background: '#10B981' }} />
            <span className="dsh-source-dot" style={{ background: '#F59E0B' }} />
          </span>
          <span>{sourceCount} 个数据节点</span>
        </span>
      </div>
    </div>
  );
};
