import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FilePlus2, FolderOpen, Sparkles } from 'lucide-react';
import {
  DEFAULT_CANVAS_ZOOM_PERCENT,
  PT_TO_PX_RATIO,
  SELECTION_EVENT_CHANGED,
  SELECTION_EVENT_SEND,
} from '../../core/constants';
import {
  buildSelectionPayload,
  buildWholeSlideSelectionPayload,
  renderTencentDocsSelectionPrompt,
} from '../../core/context-index';
import { DeckEngine, cloneDeck, createEmptyDeck } from '../../core/deck-engine';
import { exportDeckToPptxBuffer, importDeckFromPptxBuffer } from '../../core/ooxml';
import { createSampleDeck } from '../../core/sample-deck';
import type {
  BoundsPt,
  ChartType,
  DocumentSelectionEvent,
  PresentationDeck,
  ShapeKind,
  SlideElement,
  SlideSelectionPayload,
  SlideTransitionType,
} from '../../core/types';
import type { AnyDshClientContext } from '../dsh-types';
import { defaultSelectionBus, type SelectionBus } from '../selection-bus';
import { DocHeaderBar } from './DocHeaderBar';
import { IndexInspectorModal } from './IndexInspectorModal';
import { NotesAndStatusBar } from './NotesAndStatusBar';
import { RibbonToolbar } from './RibbonToolbar';
import { SlideCanvas } from './SlideCanvas';
import { SlideRenderer } from './SlideRenderer';
import { SlideshowModal } from './SlideshowModal';
import { TabStrip } from './TabStrip';
import { ThumbnailRail } from './ThumbnailRail';

export interface PptWorkspaceProps {
  ctx?: AnyDshClientContext;
  selectionBus?: SelectionBus;
  initialDecks?: PresentationDeck[];
  initialActiveDeckId?: string;
  initialPageIndex?: number;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onCollapseSidebar?: () => void;
}

function isVirtualDeckPath(filePath?: string): boolean {
  if (!filePath || !filePath.trim()) return true;
  return filePath.startsWith('/workspace/');
}

export const PptWorkspace: React.FC<PptWorkspaceProps> = ({
  ctx,
  selectionBus = defaultSelectionBus,
  initialDecks,
  initialActiveDeckId,
  initialPageIndex,
  isFullscreen: controlledFullscreen,
  onToggleFullscreen,
  onCollapseSidebar,
}) => {
  const bridge = ctx?.bridge;

  // 默认空态工作区，仅在 bridge 提供或显式传入 initialDecks 时初始化已有文稿
  const [localDecks, setLocalDecks] = useState<PresentationDeck[]>(() => {
    if (bridge) return bridge.getDecks();
    if (initialDecks && initialDecks.length > 0) return initialDecks;
    return [];
  });
  const [localActiveId, setLocalActiveId] = useState<string>(() => {
    if (bridge) return bridge.getActiveDeckId() || bridge.getDecks()[0]?.file_id || '';
    if (initialActiveDeckId) return initialActiveDeckId;
    return (initialDecks && initialDecks[0]?.file_id) || '';
  });
  const [localPageIndexMap, setLocalPageIndexMap] = useState<Record<string, number>>(() =>
    localActiveId ? { [localActiveId]: initialPageIndex ?? 0 } : {},
  );

  // 为每个打开的 deck 维护一个 DeckEngine（支持手动 Undo/Redo 通道）、已保存基线快照与本地提交邮戳
  const enginesRef = useRef<Map<string, DeckEngine>>(new Map());
  const savedBaselinesRef = useRef<Map<string, PresentationDeck>>(new Map());
  const localStampsRef = useRef<Map<string, Set<string>>>(new Map());
  const emptyFileInputRef = useRef<HTMLInputElement | null>(null);
  const [, forceTick] = useState(0);

  const deckStamp = (deck: PresentationDeck): string =>
    `${deck.version}:${deck.updated_at}`;

  const recordLocalStamp = (deck: PresentationDeck) => {
    let set = localStampsRef.current.get(deck.file_id);
    if (!set) {
      set = new Set<string>();
      localStampsRef.current.set(deck.file_id, set);
    }
    set.add(deckStamp(deck));
    if (set.size > 240) {
      const first = set.values().next().value;
      if (first !== undefined) set.delete(first);
    }
  };

  // 若宿主 bridge 支持 subscribe（如 RemoteDshClientBridge），自动订阅远程 SSE / 状态变更
  useEffect(() => {
    if (!bridge?.subscribe) return;
    return bridge.subscribe(() => {
      forceTick((n) => n + 1);
    });
  }, [bridge]);

  const decks = bridge ? bridge.getDecks() : localDecks;
  const activeDeckId = bridge
    ? bridge.getActiveDeckId() || decks[0]?.file_id || ''
    : localActiveId;
  const activeDeck = decks.find((d) => d.file_id === activeDeckId) ?? decks[0];

  const getEngine = (deck: PresentationDeck): DeckEngine => {
    let eng = enginesRef.current.get(deck.file_id);
    if (!eng) {
      eng = new DeckEngine(deck);
      enginesRef.current.set(deck.file_id, eng);
      recordLocalStamp(deck);
    } else {
      const engDeck = eng.getDeckRef();
      const differs =
        engDeck.version !== deck.version || engDeck.updated_at !== deck.updated_at;
      if (differs) {
        const isKnownLocal = localStampsRef.current
          .get(deck.file_id)
          ?.has(deckStamp(deck));
        const aiEditsChanged = engDeck.ai_edits.length !== deck.ai_edits.length;
        // ADR-0001: 仅当确实来自外部 / AI 同步变更时才确立新的手动撤销基线；
        // 本地手动编辑/撤销/重做产生的回声或乱序 SSE 绝不清空手动撤销栈。
        if (!isKnownLocal || aiEditsChanged) {
          eng.resetToBaseline(deck);
          recordLocalStamp(deck);
        }
      }
    }
    return eng;
  };

  const commitEngineDeck = (nextDeck: PresentationDeck, markDirty = true) => {
    recordLocalStamp(nextDeck);
    if (markDirty) {
      setDirtyIds((prev) => new Set(prev).add(nextDeck.file_id));
    }
    if (bridge) {
      bridge.upsertDeck(nextDeck, false);
    } else {
      setLocalDecks((prev) =>
        prev.map((d) => (d.file_id === nextDeck.file_id ? nextDeck : d)),
      );
    }
    forceTick((n) => n + 1);
  };

  const activePageIndex = activeDeck
    ? bridge
      ? Math.max(
          0,
          Math.min(
            activeDeck.slides.length - 1,
            bridge.getActivePageIndex(activeDeck.file_id),
          ),
        )
      : Math.max(
          0,
          Math.min(
            activeDeck.slides.length - 1,
            localPageIndexMap[activeDeck.file_id] ?? 0,
          ),
        )
    : 0;

  const setActivePageIndex = (idx: number) => {
    if (!activeDeck) return;
    const clamped = Math.max(0, Math.min(activeDeck.slides.length - 1, idx));
    setSelectedShapeIds([]);
    if (bridge) {
      bridge.setActivePageIndex(activeDeck.file_id, clamped);
    } else {
      setLocalPageIndexMap((prev) => ({ ...prev, [activeDeck.file_id]: clamped }));
    }
  };

  const [dirtyIds, setDirtyIds] = useState<Set<string>>(() => new Set());
  const [zoomPercent, setZoomPercent] = useState(DEFAULT_CANVAS_ZOOM_PERCENT);
  const [isMarqueeMode, setIsMarqueeMode] = useState(false);
  const [selectedShapeIds, setSelectedShapeIds] = useState<string[]>([]);
  const [showOutline, setShowOutline] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [isSlideSorter, setIsSlideSorter] = useState(false);
  const [slideshowStartIdx, setSlideshowStartIdx] = useState<number | null>(null);
  const [internalFullscreen, setInternalFullscreen] = useState(false);
  const [styleClipboard, setStyleClipboard] = useState<{
    fill?: SlideElement['fill'];
    border?: SlideElement['border'];
    fontColor?: string;
    fontSize?: number;
    bold?: boolean;
  } | null>(null);
  const [inspectPayload, setInspectPayload] = useState<SlideSelectionPayload | null>(null);
  const [localToast, setLocalToast] = useState<string | null>(null);
  const [flashShapeIds, setFlashShapeIds] = useState<string[]>([]);

  const isFullscreen = controlledFullscreen ?? internalFullscreen;

  const notifyToast = (msg: string) => {
    if (bridge?.onToast) {
      bridge.onToast(msg);
    } else {
      setLocalToast(msg);
      setTimeout(() => setLocalToast(null), 2400);
    }
  };

  // 监听来自对话芯片回跳的高亮信号
  const highlightTarget = bridge?.getHighlightTarget();
  useEffect(() => {
    if (!highlightTarget || !activeDeck) return;
    if (highlightTarget.fileId === activeDeck.file_id) {
      setSelectedShapeIds(highlightTarget.shape_ids);
      setFlashShapeIds(highlightTarget.shape_ids);
      const timer = setTimeout(() => setFlashShapeIds([]), 1600);
      return () => clearTimeout(timer);
    }
  }, [highlightTarget?.nonce, activeDeck?.file_id]);

  const currentSlide = activeDeck?.slides[activePageIndex];
  const engine = activeDeck ? getEngine(activeDeck) : null;
  const manualHistory = engine ? engine.getManualHistory() : { undo: [], redo: [] };

  const syncPageAfterHistory = (nextDeck: PresentationDeck, targetPage?: number) => {
    if (
      targetPage !== undefined &&
      nextDeck.slides.length > 0 &&
      targetPage !== activePageIndex
    ) {
      const clamped = Math.max(0, Math.min(nextDeck.slides.length - 1, targetPage));
      setSelectedShapeIds([]);
      if (bridge) {
        bridge.setActivePageIndex(nextDeck.file_id, clamped);
      } else {
        setLocalPageIndexMap((prev) => ({ ...prev, [nextDeck.file_id]: clamped }));
      }
    }
  };

  const performUndo = () => {
    if (!engine?.canUndo()) return;
    const { deck: prev, entry } = engine.undoWithMeta();
    commitEngineDeck(prev);
    syncPageAfterHistory(prev, entry?.page_index);
    if (entry) {
      notifyToast(`已撤销：${entry.label}`);
    }
  };

  const performRedo = () => {
    if (!engine?.canRedo()) return;
    const { deck: next, entry } = engine.redoWithMeta();
    commitEngineDeck(next);
    syncPageAfterHistory(next, entry?.page_index);
    if (entry) {
      notifyToast(`已重做：${entry.label}`);
    }
  };

  const performJumpHistory = (direction: 'undo' | 'redo', steps: number) => {
    if (!engine || steps <= 0) return;
    if (direction === 'undo') {
      const res = engine.undoSteps(steps);
      if (res.count === 0) return;
      commitEngineDeck(res.deck);
      syncPageAfterHistory(res.deck, res.lastEntry?.page_index);
      notifyToast(`已回退 ${res.count} 步手动操作`);
    } else {
      const res = engine.redoSteps(steps);
      if (res.count === 0) return;
      commitEngineDeck(res.deck);
      syncPageAfterHistory(res.deck, res.lastEntry?.page_index);
      notifyToast(`已前进 ${res.count} 步手动操作`);
    }
  };

  // 为真实磁盘路径打开的演示文稿自动确立已保存基线快照
  for (const d of decks) {
    if (
      !isVirtualDeckPath(d.file_path) &&
      !savedBaselinesRef.current.has(d.file_id) &&
      !dirtyIds.has(d.file_id)
    ) {
      savedBaselinesRef.current.set(d.file_id, cloneDeck(d));
    }
  }

  const hasSavedBaseline = activeDeck
    ? savedBaselinesRef.current.has(activeDeck.file_id)
    : false;

  // 全局手动 Undo/Redo 快捷键（放映或输入编辑框聚焦时禁用）
  const shortcutContextRef = useRef<{
    disabled: boolean;
    onUndo: () => void;
    onRedo: () => void;
  }>({
    disabled: true,
    onUndo: () => {},
    onRedo: () => {},
  });

  shortcutContextRef.current = {
    disabled: slideshowStartIdx !== null || inspectPayload !== null || !activeDeck || !engine,
    onUndo: performUndo,
    onRedo: performRedo,
  };

  useEffect(() => {
    const isEditableElement = (node: EventTarget | Element | null): boolean => {
      if (!node || typeof Element === 'undefined' || !(node instanceof Element)) {
        return false;
      }
      const tag = node.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return true;
      }
      return (node as HTMLElement).isContentEditable === true;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const ctxNow = shortcutContextRef.current;
      if (ctxNow.disabled) return;
      if (isEditableElement(e.target) || isEditableElement(document.activeElement)) {
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        ctxNow.onUndo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        ctxNow.onRedo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const selectedElements = useMemo(() => {
    if (!currentSlide) return [];
    return currentSlide.elements.filter((el) => selectedShapeIds.includes(el.shape_id));
  }, [currentSlide, selectedShapeIds]);

  const emitSelectionChanged = (
    payload: SlideSelectionPayload,
    aiPrompt?: string,
  ) => {
    if (!activeDeck) return;
    const finalPayload: SlideSelectionPayload = aiPrompt
      ? { ...payload, aiPrompt }
      : payload;
    const event: DocumentSelectionEvent = {
      documentResourceUri: `dsh-resource://file/${activeDeck.file_name}`,
      filePath: activeDeck.file_path,
      fileType: 'pptx',
      consumerSurface: 'office',
      sequence: selectionBus.nextSequence(),
      sequenceEpoch: '__legacy_epoch__',
      selection: finalPayload,
    };
    selectionBus.emit(SELECTION_EVENT_CHANGED, event);
    ctx?.events?.emit(SELECTION_EVENT_CHANGED, event);
  };

  const emitSelectionSend = (payload: SlideSelectionPayload, prompt: string) => {
    if (!activeDeck) return;
    const finalPayload: SlideSelectionPayload = { ...payload, aiPrompt: prompt };
    const event: DocumentSelectionEvent = {
      documentResourceUri: `dsh-resource://file/${activeDeck.file_name}`,
      filePath: activeDeck.file_path,
      fileType: 'pptx',
      consumerSurface: 'office',
      sequence: selectionBus.nextSequence(),
      sequenceEpoch: '__legacy_epoch__',
      selection: finalPayload,
    };
    selectionBus.emit(SELECTION_EVENT_SEND, event);
    ctx?.events?.emit(SELECTION_EVENT_SEND, event);
  };

  const handleCreateBlankDeck = () => {
    const num = decks.length + 1;
    const blank = createEmptyDeck({
      file_name: `新建演示文稿_${num}.pptx`,
      theme_id: 'deep-ocean-tech',
      title: '新建演示文稿',
    });
    if (bridge) {
      bridge.upsertDeck(blank, true);
      bridge.setActivePageIndex(blank.file_id, 0);
    } else {
      setLocalDecks((prev) => [...prev, blank]);
      setLocalActiveId(blank.file_id);
      setLocalPageIndexMap((prev) => ({ ...prev, [blank.file_id]: 0 }));
    }
    notifyToast(`已创建空白 16:9 演示文稿：${blank.file_name}`);
  };

  const handleImportLocalPptx = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const imported = await importDeckFromPptxBuffer(buf, { fileName: file.name });
      if (bridge) {
        bridge.upsertDeck(imported, true);
        bridge.setActivePageIndex(imported.file_id, 0);
      } else {
        setLocalDecks((prev) => [...prev, imported]);
        setLocalActiveId(imported.file_id);
        setLocalPageIndexMap((prev) => ({ ...prev, [imported.file_id]: 0 }));
      }
      notifyToast(`已导入 ${imported.file_name}（共 ${imported.slides.length} 页）`);
    } catch (err) {
      notifyToast(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleLoadSampleDeck = () => {
    const sample = createSampleDeck();
    enginesRef.current.delete(sample.file_id);
    savedBaselinesRef.current.delete(sample.file_id);
    if (bridge) {
      bridge.upsertDeck(sample, true);
      bridge.setActivePageIndex(sample.file_id, 0);
    } else {
      setLocalDecks((prev) => {
        const exists = prev.some((d) => d.file_id === sample.file_id);
        return exists
          ? prev.map((d) => (d.file_id === sample.file_id ? sample : d))
          : [...prev, sample];
      });
      setLocalActiveId(sample.file_id);
      setLocalPageIndexMap((prev) => ({ ...prev, [sample.file_id]: 0 }));
    }
    notifyToast(`已加载示例模板：${sample.file_name}`);
  };

  const handleSaveDeck = () => {
    if (!activeDeck || !engine) return;
    if (bridge?.saveDeckToFile) {
      void bridge.saveDeckToFile(activeDeck.file_id, activeDeck.file_path).then((res) => {
        if (res.ok) {
          const savedSnapshot = cloneDeck(activeDeck);
          if (res.filePath && res.filePath.trim()) {
            savedSnapshot.file_path = res.filePath.trim();
            engine.getDeckRef().file_path = savedSnapshot.file_path;
            if (savedSnapshot.file_path !== activeDeck.file_path) {
              bridge.upsertDeck(savedSnapshot, false);
            }
          }
          savedBaselinesRef.current.set(savedSnapshot.file_id, cloneDeck(savedSnapshot));
          setDirtyIds((prev) => {
            const next = new Set(prev);
            next.delete(savedSnapshot.file_id);
            return next;
          });
          forceTick((n) => n + 1);
          notifyToast(`已保存 ${savedSnapshot.file_name} (v${savedSnapshot.version})`);
        } else {
          notifyToast(`保存失败：${res.error || '离线模式'}`);
        }
      });
    } else {
      savedBaselinesRef.current.set(activeDeck.file_id, cloneDeck(activeDeck));
      setDirtyIds((prev) => {
        const next = new Set(prev);
        next.delete(activeDeck.file_id);
        return next;
      });
      forceTick((n) => n + 1);
      notifyToast(`已保存 ${activeDeck.file_name} (v${activeDeck.version})`);
    }
  };

  const handleRevertToSaved = () => {
    if (!activeDeck || !engine) return;
    const baseline = savedBaselinesRef.current.get(activeDeck.file_id);
    if (!baseline) return;
    if (
      typeof window !== 'undefined' &&
      typeof window.confirm === 'function' &&
      !window.confirm('将放弃自上次保存以来的全部未保存修改，确定还原？')
    ) {
      return;
    }
    const restored = cloneDeck(baseline);
    engine.resetToBaseline(restored);
    setSelectedShapeIds([]);
    setDirtyIds((prev) => {
      if (!prev.has(activeDeck.file_id)) return prev;
      const next = new Set(prev);
      next.delete(activeDeck.file_id);
      return next;
    });
    commitEngineDeck(restored, false);
    notifyToast(`已还原到上次保存状态：${restored.file_name}`);
  };

  const handleOpenExternal = () => {
    if (!activeDeck) return;
    if (isVirtualDeckPath(activeDeck.file_path)) {
      notifyToast('请先保存或导出为本地 .pptx 文件');
      return;
    }
    if (!bridge?.openExternalFile) {
      notifyToast('当前环境不支持调用系统默认应用打开');
      return;
    }
    void bridge.openExternalFile(activeDeck.file_path).then((res) => {
      if (res.ok) {
        notifyToast(`已使用系统默认应用打开 ${activeDeck.file_name}`);
      } else {
        notifyToast(res.error || '无法使用系统默认应用打开');
      }
    });
  };

  const handleExportPptx = async () => {
    if (!activeDeck) return;
    try {
      const buf = await exportDeckToPptxBuffer(activeDeck);
      const blob = new Blob([new Uint8Array(buf).buffer], {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = activeDeck.file_name.endsWith('.pptx')
        ? activeDeck.file_name
        : `${activeDeck.file_name}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
      notifyToast(`已导出 ${a.download}`);
    } catch (err) {
      notifyToast(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (!activeDeck || !currentSlide || !engine) {
    return (
      <div
        className={`dsh-right-pane ${isFullscreen ? 'is-fullscreen' : ''}`}
        style={{ width: '100%', maxWidth: 'none', height: '100%' }}
        data-testid="dsh-ppt-workspace"
      >
        <div className="ppt-empty-workspace" data-testid="ppt-empty-workspace">
          <div className="ppt-empty-badge">P</div>
          <div className="ppt-empty-title">PPT Studio 空态工作区</div>
          <div className="ppt-empty-subtitle">
            从新建空白演示文稿、导入本地 .pptx 文件或加载内置示例模板开始
          </div>
          <div className="ppt-empty-actions">
            <button
              type="button"
              className="ppt-hud-btn primary"
              data-testid="ppt-empty-create-btn"
              onClick={handleCreateBlankDeck}
            >
              <FilePlus2 size={14} />
              <span>新建空白 PPT</span>
            </button>
            <button
              type="button"
              className="ppt-hud-btn"
              data-testid="ppt-empty-import-btn"
              onClick={() => emptyFileInputRef.current?.click()}
            >
              <FolderOpen size={14} />
              <span>导入本地 .pptx</span>
            </button>
            <button
              type="button"
              className="ppt-hud-btn"
              data-testid="ppt-empty-sample-btn"
              onClick={handleLoadSampleDeck}
            >
              <Sparkles size={14} />
              <span>加载示例模板</span>
            </button>
          </div>
          <input
            ref={emptyFileInputRef}
            type="file"
            accept=".pptx"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void handleImportLocalPptx(file);
                e.target.value = '';
              }
            }}
          />
        </div>
        {(localToast || bridge?.getToastMessage?.()) && (
          <div className="ppt-toast">{localToast || bridge?.getToastMessage?.()}</div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`dsh-right-pane ${isFullscreen ? 'is-fullscreen' : ''}`}
      style={{ width: '100%', maxWidth: 'none', height: '100%' }}
      data-testid="dsh-ppt-workspace"
    >
      {/* 顶部多标签栏（入口 2：+ 新建/导入） */}
      <TabStrip
        decks={decks}
        activeDeckId={activeDeck.file_id}
        dirtyIds={dirtyIds}
        isFullscreen={isFullscreen}
        onSelectTab={(id) => {
          setSelectedShapeIds([]);
          if (bridge) bridge.setActiveDeckId(id);
          else setLocalActiveId(id);
        }}
        onCloseTab={(id) => {
          enginesRef.current.delete(id);
          savedBaselinesRef.current.delete(id);
          localStampsRef.current.delete(id);
          setDirtyIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          setSelectedShapeIds([]);
          if (bridge) {
            bridge.closeDeck(id);
          } else {
            const next = localDecks.filter((d) => d.file_id !== id);
            setLocalDecks(next);
            if (localActiveId === id) {
              setLocalActiveId(next[0]?.file_id ?? '');
            }
          }
        }}
        onCreateBlankDeck={handleCreateBlankDeck}
        onImportLocalPptx={handleImportLocalPptx}
        onToggleFullscreen={() => {
          if (onToggleFullscreen) onToggleFullscreen();
          else setInternalFullscreen((v) => !v);
        }}
        onCollapseSidebar={onCollapseSidebar ?? bridge?.onCollapseRightSidebar}
      />

      {/* 文档标题操作栏 */}
      <DocHeaderBar
        deck={activeDeck}
        isDirty={dirtyIds.has(activeDeck.file_id)}
        canUndo={engine.canUndo()}
        canRedo={engine.canRedo()}
        undoEntries={manualHistory.undo}
        redoEntries={manualHistory.redo}
        hasSavedBaseline={hasSavedBaseline}
        onRename={(newName) => {
          const nextPath = isVirtualDeckPath(activeDeck.file_path)
            ? `/workspace/${newName}`
            : undefined;
          const next = engine.renameDeck(newName, nextPath);
          commitEngineDeck(next);
          notifyToast(`已重命名为 ${newName}`);
        }}
        onLocateFolder={() => notifyToast(`文件位于：${activeDeck.file_path}`)}
        onUndo={performUndo}
        onRedo={performRedo}
        onJumpHistory={performJumpHistory}
        onSave={handleSaveDeck}
        onRevertToSaved={handleRevertToSaved}
        onExportPptx={handleExportPptx}
        onOpenExternal={handleOpenExternal}
        onStartSlideshow={() => setSlideshowStartIdx(activePageIndex)}
        onUndoAiEdit={(editId) => {
          try {
            const res = engine.undoAiEdit(editId);
            commitEngineDeck(res.deck);
            notifyToast(`已撤销 AI 编辑：${res.reverted_edit.summary}`);
          } catch (err) {
            notifyToast(err instanceof Error ? err.message : '无法撤销 AI 编辑');
          }
        }}
        onInspectDeckIndex={() => {
          const payload = buildSelectionPayload(activeDeck, activePageIndex, {
            shape_ids:
              selectedShapeIds.length > 0
                ? selectedShapeIds
                : currentSlide.elements.slice(0, 3).map((e) => e.shape_id),
            selection_mode: selectedShapeIds.length > 1 ? 'multi-element' : 'element',
          });
          setInspectPayload(payload);
        }}
        onShare={handleExportPptx}
      />

      {/* 7 大 Ribbon 工具栏 */}
      <RibbonToolbar
        deck={activeDeck}
        activePageIndex={activePageIndex}
        selectedElements={selectedElements}
        canUndo={engine.canUndo()}
        canRedo={engine.canRedo()}
        isMarqueeMode={isMarqueeMode}
        showOutline={showOutline}
        showNotes={showNotes}
        zoomPercent={zoomPercent}
        onUndo={performUndo}
        onRedo={performRedo}
        onInsertText={() => {
          const res = engine.runTransaction(
            '插入文本框',
            () =>
              engine.addText(activePageIndex, {
                x: 120,
                y: 160,
                w: 320,
                h: 64,
                content: '双击编辑文本内容',
                font_size: 18,
                font_color:
                  activeDeck.theme_id === 'clean-daylight' ? '111827' : 'F1F5F9',
                bold: true,
              }),
            { page_index: activePageIndex },
          );
          commitEngineDeck(engine.getDeck());
          setSelectedShapeIds([res.element.shape_id]);
        }}
        onInsertShape={(shapeType: ShapeKind) => {
          const res = engine.runTransaction(
            '插入图形',
            () =>
              engine.addShape(activePageIndex, {
                shape_type: shapeType,
                x: 180,
                y: 180,
                w: 220,
                h: 110,
                fill_color: '16213A',
                border_color: '38E8D4',
                border_width: 1.5,
                corner_radius: shapeType === 'roundRect' ? 10 : undefined,
                text: '新增图形卡片',
                font_color: 'F1F5F9',
              }),
            { page_index: activePageIndex },
          );
          commitEngineDeck(engine.getDeck());
          setSelectedShapeIds([res.element.shape_id]);
        }}
        onInsertLine={() => {
          const res = engine.runTransaction(
            '插入线条',
            () =>
              engine.addLineShape(activePageIndex, {
                x1: 160,
                y1: 270,
                x2: 460,
                y2: 270,
                line_type: 'arrow',
                color: '38E8D4',
                width: 2,
              }),
            { page_index: activePageIndex },
          );
          commitEngineDeck(engine.getDeck());
          setSelectedShapeIds([res.element.shape_id]);
        }}
        onInsertTable={() => {
          const res = engine.runTransaction(
            '插入表格',
            () =>
              engine.addTable(activePageIndex, {
                x: 140,
                y: 160,
                w: 440,
                h: 180,
                data: [
                  ['维度', '2025 基准', '2026 预测'],
                  ['推理算力占比', '46%', '70%+'],
                  ['单位 Token 成本', '$1.00', '$0.28'],
                ],
              }),
            { page_index: activePageIndex },
          );
          commitEngineDeck(engine.getDeck());
          setSelectedShapeIds([res.element.shape_id]);
        }}
        onInsertChart={(chartType: ChartType) => {
          const res = engine.runTransaction(
            '插入图表',
            () =>
              engine.addChart(activePageIndex, {
                x: 140,
                y: 145,
                w: 460,
                h: 250,
                chart_type: chartType,
                title: '算力与智能体增长指标',
                categories: ['Q1', 'Q2', 'Q3', 'Q4'],
                series: [
                  { name: '推理负载', values: [38, 49, 62, 74], color: '38E8D4' },
                  { name: '训练负载', values: [42, 40, 35, 29], color: '846BFF' },
                ],
                show_data_labels: true,
              }),
            { page_index: activePageIndex },
          );
          commitEngineDeck(engine.getDeck());
          setSelectedShapeIds([res.element.shape_id]);
        }}
        onUpdateTextStyle={(patch) => {
          if (selectedShapeIds.length === 0) {
            notifyToast('请先选中包含文本的元素');
            return;
          }
          engine.runTransaction(
            selectedShapeIds.length > 1 ? '批量修改文字样式' : '修改文字样式',
            () => {
              for (const id of selectedShapeIds) {
                const idx = currentSlide.elements.findIndex((e) => e.shape_id === id);
                if (idx >= 0 && currentSlide.elements[idx].text) {
                  engine.setTextProperty(activePageIndex, idx, patch);
                }
              }
            },
            { page_index: activePageIndex },
          );
          commitEngineDeck(engine.getDeck());
        }}
        onUpdateShapeStyle={(patch) => {
          if (selectedShapeIds.length === 0) {
            notifyToast('请先选中画布元素');
            return;
          }
          engine.runTransaction(
            selectedShapeIds.length > 1 ? '批量修改图形样式' : '修改图形样式',
            () => {
              engine.setShapeProperties(activePageIndex, {
                shape_ids: selectedShapeIds,
                ...patch,
              });
            },
            { page_index: activePageIndex },
          );
          commitEngineDeck(engine.getDeck());
        }}
        onClearFormatting={() => {
          if (selectedShapeIds.length === 0) return;
          engine.runTransaction(
            '清除文字格式',
            () => {
              for (const id of selectedShapeIds) {
                const idx = currentSlide.elements.findIndex((e) => e.shape_id === id);
                if (idx >= 0 && currentSlide.elements[idx].text) {
                  engine.setTextProperty(activePageIndex, idx, {
                    bold: false,
                    italic: false,
                    underline: false,
                    font_size: 13,
                  });
                }
              }
            },
            { page_index: activePageIndex },
          );
          commitEngineDeck(engine.getDeck());
          notifyToast('已清除选中元素字体格式');
        }}
        onCopyStyle={() => {
          if (!styleClipboard) {
            const src = selectedElements[0];
            if (!src) {
              notifyToast('请先选中要复制样式的源元素');
              return;
            }
            setStyleClipboard({
              fill: src.fill,
              border: src.border,
              fontColor: src.text?.fontColor,
              fontSize: src.text?.fontSize,
              bold: src.text?.bold,
            });
            notifyToast('已拾取格式：请点击目标元素后再点一次格式刷应用');
          } else {
            if (selectedShapeIds.length === 0) {
              setStyleClipboard(null);
              return;
            }
            engine.runTransaction(
              '应用格式刷',
              () => {
                for (const id of selectedShapeIds) {
                  const idx = currentSlide.elements.findIndex((e) => e.shape_id === id);
                  if (idx >= 0) {
                    if (styleClipboard.fill) {
                      engine.setShapeProperties(activePageIndex, {
                        shape_index: idx,
                        fill_color: styleClipboard.fill.color,
                        fill_alpha: styleClipboard.fill.alpha,
                      });
                    }
                    if (currentSlide.elements[idx].text && styleClipboard.fontColor) {
                      engine.setTextProperty(activePageIndex, idx, {
                        font_color: styleClipboard.fontColor,
                        font_size: styleClipboard.fontSize,
                        bold: styleClipboard.bold,
                      });
                    }
                  }
                }
              },
              { page_index: activePageIndex },
            );
            setStyleClipboard(null);
            commitEngineDeck(engine.getDeck());
            notifyToast('格式刷已应用');
          }
        }}
        onReorderShape={(op) => {
          if (selectedShapeIds.length === 0) return;
          const idx = currentSlide.elements.findIndex(
            (e) => e.shape_id === selectedShapeIds[0],
          );
          if (idx >= 0) {
            engine.runTransaction(
              '调整图层顺序',
              () => engine.reorderShape(activePageIndex, idx, op),
              { page_index: activePageIndex },
            );
            commitEngineDeck(engine.getDeck());
          }
        }}
        onDeleteSelected={() => {
          const indices = selectedShapeIds
            .map((id) => currentSlide.elements.findIndex((e) => e.shape_id === id))
            .filter((i) => i >= 0);
          if (indices.length > 0) {
            engine.runTransaction(
              indices.length > 1 ? '批量删除元素' : '删除元素',
              () => engine.removeShapes(activePageIndex, indices),
              { page_index: activePageIndex },
            );
            commitEngineDeck(engine.getDeck());
            setSelectedShapeIds([]);
          }
        }}
        onApplyTheme={(themeId) => {
          const updated = engine.runTransaction('切换视觉主题', () =>
            engine.setTheme(themeId, true),
          );
          commitEngineDeck(updated);
          notifyToast('已切换演示文稿视觉主题');
        }}
        onSetPageBackground={(hex) => {
          engine.runTransaction(
            '修改页面背景',
            () => engine.setPageProperties(activePageIndex, { background_color: hex }),
            { page_index: activePageIndex },
          );
          commitEngineDeck(engine.getDeck());
        }}
        onSetTransition={(type: SlideTransitionType) => {
          engine.runTransaction(
            '设置页面切换效果',
            () => engine.setPageProperties(activePageIndex, { transition_type: type }),
            { page_index: activePageIndex },
          );
          commitEngineDeck(engine.getDeck());
          notifyToast(`已设置当前页切换效果：${type}`);
        }}
        onAddAnimation={(animType) => {
          if (selectedShapeIds.length === 0) {
            notifyToast('请先在画布中选中一个元素');
            return;
          }
          const idx = currentSlide.elements.findIndex(
            (e) => e.shape_id === selectedShapeIds[0],
          );
          if (idx >= 0) {
            engine.runTransaction(
              '添加元素动画',
              () => engine.addAnim(activePageIndex, idx, { anim_type: animType }),
              { page_index: activePageIndex },
            );
            commitEngineDeck(engine.getDeck());
            notifyToast(`已添加动画：${animType}`);
          }
        }}
        onRemoveAnimation={() => {
          if (selectedShapeIds.length === 0) return;
          const idx = currentSlide.elements.findIndex(
            (e) => e.shape_id === selectedShapeIds[0],
          );
          if (idx >= 0) {
            engine.runTransaction(
              '移除元素动画',
              () => engine.removeAnim(activePageIndex, idx),
              { page_index: activePageIndex },
            );
            commitEngineDeck(engine.getDeck());
            notifyToast('已移除选中元素动画');
          }
        }}
        onSetAspectRatio={(ratio) => {
          const updated = engine.runTransaction('切换画布比例', () =>
            engine.setSlideSize(ratio),
          );
          commitEngineDeck(updated);
          notifyToast(`画布已切换为 ${ratio === 2 ? '16:9 宽屏' : '4:3 标准'}`);
        }}
        onFindReplace={(find, replace) => {
          const res = engine.runTransaction('查找并替换', () =>
            engine.findReplaceText(find, replace),
          );
          if (res.replacements > 0) {
            commitEngineDeck(engine.getDeck());
          }
          return res.replacements;
        }}
        onStartSlideshow={(fromStart) =>
          setSlideshowStartIdx(fromStart ? 0 : activePageIndex)
        }
        onToggleSlideSorter={() => setIsSlideSorter((v) => !v)}
        onToggleMarqueeMode={() => setIsMarqueeMode((v) => !v)}
        onToggleOutline={() => setShowOutline((v) => !v)}
        onToggleNotes={() => setShowNotes((v) => !v)}
        onChangeZoom={(z) => setZoomPercent(z)}
        onToast={notifyToast}
      />

      {/* 编辑主体：幻灯片浏览网格 OR 缩略图栏 + 中央交互画布 */}
      {isSlideSorter ? (
        <div className="ppt-sorter-grid">
          {activeDeck.slides.map((s, idx) => (
            <div
              key={s.slide_id}
              className={`ppt-sorter-card ${idx === activePageIndex ? 'is-active' : ''}`}
              onClick={() => {
                setActivePageIndex(idx);
                setIsSlideSorter(false);
              }}
            >
              <div style={{ pointerEvents: 'none', overflow: 'hidden', borderRadius: 4 }}>
                <SlideRenderer
                  slide={s}
                  widthPt={activeDeck.width_pt}
                  heightPt={activeDeck.height_pt}
                  scale={158 / (activeDeck.width_pt * PT_TO_PX_RATIO)}
                />
              </div>
              <div style={{ fontSize: 11.5, marginTop: 5, color: '#374151', fontWeight: 500 }}>
                {idx + 1}. {s.title}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="ppt-editor-body">
          {showOutline && (
            <ThumbnailRail
              slides={activeDeck.slides}
              widthPt={activeDeck.width_pt}
              heightPt={activeDeck.height_pt}
              activePageIndex={activePageIndex}
              onSelectPage={setActivePageIndex}
              onSelectWholeSlide={(idx) => {
                setActivePageIndex(idx);
                const payload = buildWholeSlideSelectionPayload(activeDeck, idx);
                setSelectedShapeIds(payload.shape_ids);
                emitSelectionSend(payload, '');
                notifyToast(`已将第 ${idx + 1} 页整页引用描述写入对话输入框`);
              }}
              onAddPage={() => {
                const res = engine.runTransaction(
                  '新增页面',
                  () =>
                    engine.addSlide({
                      insert_index: activePageIndex + 1,
                      bypassDesignGate: true,
                    }),
                  { page_index: activePageIndex + 1 },
                );
                commitEngineDeck(engine.getDeck());
                setActivePageIndex(res.page_index);
              }}
              onDuplicatePage={(idx) => {
                const res = engine.runTransaction(
                  '复制页面',
                  () => engine.duplicateSlide(idx),
                  { page_index: idx + 1 },
                );
                commitEngineDeck(engine.getDeck());
                setActivePageIndex(res.page_index);
              }}
              onDeletePage={(idx) => {
                const targetPage = Math.max(0, Math.min(idx, activeDeck.slides.length - 2));
                engine.runTransaction(
                  '删除页面',
                  () => engine.removeSlide(idx),
                  { page_index: targetPage },
                );
                commitEngineDeck(engine.getDeck());
                setActivePageIndex(targetPage);
              }}
              onMovePage={(from, to) => {
                const updated = engine.runTransaction(
                  '调整页面顺序',
                  () => engine.moveSlide(from, to),
                  { page_index: to },
                );
                commitEngineDeck(updated);
                setActivePageIndex(to);
              }}
            />
          )}

          <SlideCanvas
            deck={activeDeck}
            slide={currentSlide}
            pageIndex={activePageIndex}
            zoomPercent={zoomPercent}
            isMarqueeMode={isMarqueeMode}
            selectedShapeIds={selectedShapeIds}
            flashShapeIds={flashShapeIds}
            onToggleMarqueeMode={() => setIsMarqueeMode((v) => !v)}
            onSelectShapes={(ids) => setSelectedShapeIds(ids)}
            onMoveResizeElement={(shapeId, nextBounds: BoundsPt, kind) => {
              engine.runTransaction(
                kind === 'resize' ? '调整元素大小' : '移动元素',
                () =>
                  engine.setShapeProperties(activePageIndex, {
                    shape_id: shapeId,
                    x: nextBounds.x,
                    y: nextBounds.y,
                    w: nextBounds.w,
                    h: nextBounds.h,
                  }),
                { page_index: activePageIndex },
              );
              commitEngineDeck(engine.getDeck());
            }}
            onCommitInlineText={(shapeId, newText) => {
              const idx = currentSlide.elements.findIndex((e) => e.shape_id === shapeId);
              if (idx >= 0) {
                const prevText = currentSlide.elements[idx].text?.content ?? '';
                if (prevText === newText) return;
                engine.runTransaction(
                  '修改文本内容',
                  () => engine.setText(activePageIndex, idx, newText),
                  { page_index: activePageIndex },
                );
                commitEngineDeck(engine.getDeck());
              }
            }}
            onReorderTop={(shapeId) => {
              const idx = currentSlide.elements.findIndex((e) => e.shape_id === shapeId);
              if (idx >= 0) {
                engine.runTransaction(
                  '元素置顶',
                  () => engine.reorderShape(activePageIndex, idx, 0),
                  { page_index: activePageIndex },
                );
                commitEngineDeck(engine.getDeck());
              }
            }}
            onDuplicateElement={(shapeId) => {
              const src = currentSlide.elements.find((e) => e.shape_id === shapeId);
              if (!src) return;
              if (src.type === 'text' && src.text) {
                const res = engine.runTransaction(
                  '复制元素',
                  () =>
                    engine.addText(activePageIndex, {
                      x: src.bounds.x + 18,
                      y: src.bounds.y + 18,
                      w: src.bounds.w,
                      h: src.bounds.h,
                      content: src.text!.content,
                      font_size: src.text!.fontSize,
                      font_color: src.text!.fontColor,
                      bold: src.text!.bold,
                      align: src.text!.align,
                    }),
                  { page_index: activePageIndex },
                );
                commitEngineDeck(engine.getDeck());
                setSelectedShapeIds([res.element.shape_id]);
              } else {
                const res = engine.runTransaction(
                  '复制元素',
                  () =>
                    engine.addShape(activePageIndex, {
                      shape_type: src.shapeType || 'rect',
                      x: src.bounds.x + 18,
                      y: src.bounds.y + 18,
                      w: src.bounds.w,
                      h: src.bounds.h,
                      fill_color: src.fill?.color || '16213A',
                      border_color: src.border?.color || '38E8D4',
                      text: src.text?.content,
                      font_color: src.text?.fontColor,
                    }),
                  { page_index: activePageIndex },
                );
                commitEngineDeck(engine.getDeck());
                setSelectedShapeIds([res.element.shape_id]);
              }
            }}
            onDeleteElement={(shapeId) => {
              const idx = currentSlide.elements.findIndex((e) => e.shape_id === shapeId);
              if (idx >= 0) {
                engine.runTransaction(
                  '删除元素',
                  () => engine.removeShapes(activePageIndex, [idx]),
                  { page_index: activePageIndex },
                );
                commitEngineDeck(engine.getDeck());
                setSelectedShapeIds((prev) => prev.filter((id) => id !== shapeId));
              }
            }}
            onSendSelectionToComposer={(payload) => {
              emitSelectionSend(payload, '');
              notifyToast('已将选区引用描述写入对话输入框');
            }}
            onSendSelectionAiEdit={(payload, prompt) => {
              emitSelectionSend(payload, prompt);
            }}
            onToast={notifyToast}
          />
        </div>
      )}

      {/* 底部演讲者备注与状态栏 */}
      <NotesAndStatusBar
        notes={currentSlide.notes}
        showNotes={showNotes}
        showOutline={showOutline}
        isSlideSorter={isSlideSorter}
        currentPageIndex={activePageIndex}
        totalPages={activeDeck.slides.length}
        zoomPercent={zoomPercent}
        onChangeNotes={(txt, kind) => {
          engine.runTransaction(
            kind === 'paste' ? '粘贴演讲者备注' : '编辑演讲者备注',
            () => engine.setNotesText(activePageIndex, txt),
            { page_index: activePageIndex },
          );
          commitEngineDeck(engine.getDeck());
        }}
        onToggleNotes={() => setShowNotes((v) => !v)}
        onToggleOutline={() => setShowOutline((v) => !v)}
        onToggleSlideSorter={() => setIsSlideSorter((v) => !v)}
        onStartSlideshow={() => setSlideshowStartIdx(activePageIndex)}
        onFitWindow={() => setZoomPercent(DEFAULT_CANVAS_ZOOM_PERCENT)}
        onChangeZoom={(z) => setZoomPercent(z)}
      />

      {slideshowStartIdx !== null && (
        <SlideshowModal
          deck={activeDeck}
          initialPageIndex={slideshowStartIdx}
          onClose={(lastPageIndex) => {
            setSlideshowStartIdx(null);
            setActivePageIndex(lastPageIndex);
          }}
        />
      )}

      {inspectPayload && (
        <IndexInspectorModal
          payload={inspectPayload}
          xmlPreview={renderTencentDocsSelectionPrompt({
            type: 'resource_link',
            name: inspectPayload.title,
            uri: `tdoc-selection://${encodeURIComponent(inspectPayload.rangeId)}`,
            title: inspectPayload.title,
            _meta: {
              mentionType: 'tencentDocsSelection',
              type: 'document-selection',
              displayAsPhrase: true,
              displayAsContext: false,
              documentResourceUri: `dsh-resource://file/${activeDeck.file_name}`,
              filePath: activeDeck.file_path,
              fileType: 'pptx',
              fileId: activeDeck.file_id,
              rangeId: inspectPayload.rangeId,
              sequence: 1,
              sequenceEpoch: '__legacy_epoch__',
              selectionPayload: inspectPayload,
            },
          })}
          onClose={() => setInspectPayload(null)}
          onCopy={(txt) => {
            navigator.clipboard?.writeText(txt).catch(() => {});
            notifyToast('已复制到剪贴板');
          }}
        />
      )}

      {(localToast || bridge?.getToastMessage?.()) && (
        <div className="ppt-toast">{localToast || bridge?.getToastMessage?.()}</div>
      )}
    </div>
  );
};
