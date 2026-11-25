import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  SELECTION_EVENT_CHANGED,
  SELECTION_EVENT_SEND,
  SLIDE_EXTENSION_REGEX,
} from '../core/constants';
import { buildSelectionQuoteSummary, formatSelectionReferenceText, renderTencentDocsSelectionPrompt } from '../core/context-index';
import { exportDeckToPptxBuffer } from '../core/ooxml';
import type {
  DocumentSelectionEvent,
  PresentationDeck,
} from '../core/types';
import { ArtifactCard } from './components/ArtifactCard';
import { PptWorkspace } from './components/PptWorkspace';
import { SelectionChipBar } from './components/SelectionChipBar';
import {
  isRealDshContext,
  type AnyDshClientContext,
  type ArtifactSlotProps,
  type ComposerContextSlotProps,
  type DshArtifactItem,
  type DshClientBridge,
  type DshClientContext,
  type RealConversationInputDockSlotProps,
  type RealConversationTurnTailSlotProps,
  type RealDshClientContext,
  type RealInputActions,
  type RealSidebarTabSlotProps,
  type SidebarPaneSlotProps,
} from './dsh-types';
import { RemoteDshClientBridge } from './remote-bridge';
import { defaultSelectionBus, SelectionBus } from './selection-bus';

declare const __PPT_STUDIO_CSS__: string | undefined;

export const name = 'dsh-plugin-ppt-studio';
export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight'] as const;

const PLUGIN_STYLE_ATTR = 'data-plugin';
const PLUGIN_STYLE_VALUE = 'dsh-plugin-ppt-studio';
const PLUGIN_CSS_ATTR = 'data-plugin-css';
const PLUGIN_CSS_VALUE = 'dsh-plugin-ppt-studio/client.css';
const RESOURCE_DECK_PREFIX = 'dsh-resource://ppt-studio/deck/';

let mountedStyleRefs = 0;

function mountPluginStyles(): () => void {
  if (typeof document === 'undefined' || !document.head) {
    return () => {};
  }

  const cssText = typeof __PPT_STUDIO_CSS__ === 'string' ? __PPT_STUDIO_CSS__ : '';
  const selector = `style[${PLUGIN_STYLE_ATTR}="${PLUGIN_STYLE_VALUE}"][${PLUGIN_CSS_ATTR}="${PLUGIN_CSS_VALUE}"]`;
  let styleEl = document.head.querySelector(selector) as HTMLStyleElement | null;

  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.setAttribute(PLUGIN_STYLE_ATTR, PLUGIN_STYLE_VALUE);
    styleEl.setAttribute(PLUGIN_CSS_ATTR, PLUGIN_CSS_VALUE);
    styleEl.textContent = cssText;
    document.head.appendChild(styleEl);
  } else if (cssText && styleEl.textContent !== cssText) {
    styleEl.textContent = cssText;
  }

  mountedStyleRefs += 1;

  return () => {
    mountedStyleRefs = Math.max(0, mountedStyleRefs - 1);
    if (mountedStyleRefs === 0) {
      const current = document.head?.querySelector(selector);
      if (current && current.parentNode) {
        current.parentNode.removeChild(current);
      }
    }
  };
}

function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export interface ParsedDshFileAddress {
  kind: 'session' | 'absolute' | 'file-url' | 'deck' | 'raw';
  filePath: string;
  sessionId?: string;
  deckId?: string;
}

export function parseDshFileResourceAddress(address: string): ParsedDshFileAddress {
  if (!address) {
    return { kind: 'raw', filePath: '' };
  }
  const stripped = address.split('?')[0].split('#')[0];

  if (stripped.startsWith(RESOURCE_DECK_PREFIX)) {
    const rawId = stripped.slice(RESOURCE_DECK_PREFIX.length);
    return {
      kind: 'deck',
      filePath: '',
      deckId: rawId ? safeDecodeSegment(rawId) : undefined,
    };
  }

  const sessionPrefix = 'dsh-resource://file/session/';
  if (stripped.startsWith(sessionPrefix)) {
    const rest = stripped.slice(sessionPrefix.length);
    const slashIdx = rest.indexOf('/');
    if (slashIdx < 0) {
      return {
        kind: 'session',
        sessionId: rest ? safeDecodeSegment(rest) : undefined,
        filePath: '',
      };
    }
    const sessionId = safeDecodeSegment(rest.slice(0, slashIdx));
    const rawPathPart = rest.slice(slashIdx + 1);
    const decodedSegments = rawPathPart.split('/').map(safeDecodeSegment);
    let filePath = decodedSegments.join('/');
    filePath = filePath.replace(/^\/([a-zA-Z]:)/, '$1');
    return {
      kind: 'session',
      sessionId: sessionId || undefined,
      filePath,
    };
  }

  const absolutePrefix = 'dsh-resource://file/absolute/';
  if (stripped.startsWith(absolutePrefix)) {
    const rawRest = stripped.slice(absolutePrefix.length);
    const decodedSegments = rawRest.split('/').map(safeDecodeSegment);
    let filePath = decodedSegments.join('/');
    if (/^\/[a-zA-Z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    } else if (!/^[a-zA-Z]:/.test(filePath) && !filePath.startsWith('/')) {
      filePath = `/${filePath}`;
    }
    return {
      kind: 'absolute',
      filePath,
    };
  }

  const genericFilePrefix = 'dsh-resource://file/';
  if (stripped.startsWith(genericFilePrefix)) {
    const rawRest = stripped.slice(genericFilePrefix.length);
    const decodedSegments = rawRest.split('/').map(safeDecodeSegment);
    let filePath = decodedSegments.join('/');
    filePath = filePath.replace(/^\/([a-zA-Z]:)/, '$1');
    return {
      kind: 'raw',
      filePath,
    };
  }

  if (stripped.startsWith('file://')) {
    try {
      const url = new URL(stripped);
      const decodedPath = safeDecodeSegment(url.pathname);
      const filePath =
        url.host && url.host.toLowerCase() !== 'localhost'
          ? `//${url.host}${decodedPath}`
          : decodedPath.replace(/^\/([a-zA-Z]:)/, '$1');
      return {
        kind: 'file-url',
        filePath,
      };
    } catch {
      return { kind: 'file-url', filePath: stripped };
    }
  }

  return {
    kind: 'raw',
    filePath: stripped,
  };
}

function normalizeComparePath(value: string | undefined): string {
  if (!value) return '';
  const unified = value.replace(/\\/g, '/');
  return /^[a-zA-Z]:\//.test(unified) ? unified.toLowerCase() : unified;
}

function normalizeDiskAddress(address: string): string {
  return parseDshFileResourceAddress(address).filePath;
}

function extractDeckIdFromResource(address: string): string | null {
  return parseDshFileResourceAddress(address).deckId ?? null;
}

export function resolveTabTitle(address: string, bridge?: DshClientBridge): string {
  if (!address || address === 'dsh-resource://ppt-studio/new') {
    return 'PPT Studio';
  }
  const parsed = parseDshFileResourceAddress(address);
  if (parsed.deckId) {
    const deck = bridge?.getDeckById(parsed.deckId);
    return deck?.file_name || `${parsed.deckId}.pptx`;
  }
  const clean = parsed.filePath || address.split('?')[0].split('#')[0];
  const base = clean.split(/[\\/]/).filter(Boolean).pop();
  if (base) {
    return safeDecodeSegment(base);
  }
  return '演示文稿.pptx';
}

function toArtifactItem(raw: unknown, bridge?: DshClientBridge): DshArtifactItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const fileName =
    (typeof obj.fileName === 'string' && obj.fileName) ||
    (typeof obj.file_name === 'string' && obj.file_name) ||
    (typeof obj.name === 'string' && obj.name) ||
    (typeof obj.title === 'string' && obj.title) ||
    '';
  const filePath =
    (typeof obj.filePath === 'string' && obj.filePath) ||
    (typeof obj.file_path === 'string' && obj.file_path) ||
    (typeof obj.path === 'string' && obj.path) ||
    undefined;
  const uri =
    (typeof obj.uri === 'string' && obj.uri) ||
    (typeof obj.url === 'string' && obj.url) ||
    (typeof obj.resourceUri === 'string' && obj.resourceUri) ||
    '';
  const fileId =
    (typeof obj.fileId === 'string' && obj.fileId) ||
    (typeof obj.file_id === 'string' && obj.file_id) ||
    (typeof obj.id === 'string' && obj.id) ||
    undefined;

  const probe = fileName || filePath || uri;
  const parsedProbe = parseDshFileResourceAddress(probe);
  if (!probe || (!SLIDE_EXTENSION_REGEX.test(probe) && !SLIDE_EXTENSION_REGEX.test(parsedProbe.filePath))) {
    return null;
  }

  const resolvedName =
    fileName ||
    (filePath ? safeDecodeSegment(normalizeDiskAddress(filePath).split(/[\\/]/).pop() || '') : '') ||
    (uri ? safeDecodeSegment(normalizeDiskAddress(uri).split(/[\\/]/).pop() || '') : '') ||
    '演示文稿.pptx';

  const matchedDeck =
    (fileId ? bridge?.getDeckById(fileId) : undefined) ??
    bridge?.getDecks().find((d) => d.file_path === filePath || d.file_name === resolvedName);

  const resolvedId = fileId || matchedDeck?.file_id || resolvedName;

  return {
    id: resolvedId,
    fileId: matchedDeck?.file_id ?? fileId ?? resolvedId,
    fileName: resolvedName,
    filePath: filePath ?? matchedDeck?.file_path,
    uri: uri || `${RESOURCE_DECK_PREFIX}${encodeURIComponent(resolvedId)}`,
    fileSizeBytes: typeof obj.fileSizeBytes === 'number' ? obj.fileSizeBytes : undefined,
    fileSizeLabel: typeof obj.fileSizeLabel === 'string' ? obj.fileSizeLabel : undefined,
    totalArtifactsCount:
      typeof obj.totalArtifactsCount === 'number' ? obj.totalArtifactsCount : undefined,
    sourceCount: typeof obj.sourceCount === 'number' ? obj.sourceCount : undefined,
  };
}

function collectToolResultDecks(
  items: unknown[],
  bridge?: DshClientBridge,
): DshArtifactItem[] {
  const results: DshArtifactItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const toolName =
      (typeof obj.toolName === 'string' && obj.toolName) ||
      (typeof obj.name === 'string' && obj.name) ||
      (typeof obj.tool === 'string' && obj.tool) ||
      '';
    if (!toolName.startsWith('slide_')) continue;

    const candidates = [obj.result, obj.output, obj.args, obj.input, obj];
    for (const cand of candidates) {
      if (!cand || typeof cand !== 'object') continue;
      const c = cand as Record<string, unknown>;
      const fid =
        (typeof c.file_id === 'string' && c.file_id) ||
        (typeof c.fileId === 'string' && c.fileId) ||
        '';
      if (fid) {
        const deck = bridge?.getDeckById(fid);
        if (deck) {
          results.push({
            id: deck.file_id,
            fileId: deck.file_id,
            fileName: deck.file_name,
            filePath: deck.file_path,
            uri: `${RESOURCE_DECK_PREFIX}${encodeURIComponent(deck.file_id)}`,
            fileSizeLabel: `${Math.max(42.5, deck.slides.length * 6.35).toFixed(1)} KB`,
            totalArtifactsCount: bridge?.getDecks().length || 1,
            sourceCount: deck.slides.length,
          });
          continue;
        }
      }
      const asArt = toArtifactItem(c, bridge);
      if (asArt) results.push(asArt);
    }
  }
  return results;
}

function extractArtifactsFromTurnProps(
  props: RealConversationTurnTailSlotProps,
  bridge?: DshClientBridge,
): DshArtifactItem[] {
  const found: DshArtifactItem[] = [];

  if (props.artifact) {
    const item = toArtifactItem(props.artifact, bridge);
    if (item) found.push(item);
  }

  const turn = props.turn ?? props.hooks?.turn?.();
  const message = props.message ?? props.hooks?.message?.();
  const containers = [props, turn, message].filter(
    (v): v is Record<string, unknown> => Boolean(v && typeof v === 'object'),
  );

  for (const container of containers) {
    const directArrays = [
      container.artifacts,
      container.deliverables,
      container.files,
      container.attachments,
    ];
    for (const arr of directArrays) {
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        const art = toArtifactItem(entry, bridge);
        if (art) found.push(art);
      }
    }

    const toolArrays = [container.toolCalls, container.toolResults, container.parts, container.blocks];
    for (const arr of toolArrays) {
      if (Array.isArray(arr)) {
        found.push(...collectToolResultDecks(arr, bridge));
      }
    }
  }

  // 若对话轮次仅提供了纯文本且提及已注册的 .pptx 文件，补充匹配对应 deck
  if (found.length === 0 && bridge) {
    const role = (turn?.role ?? message?.role) as string | undefined;
    const textContent =
      (typeof turn?.content === 'string' && turn.content) ||
      (typeof message?.content === 'string' && message.content) ||
      (typeof turn?.text === 'string' && turn.text) ||
      '';
    if (textContent && role !== 'user') {
      for (const deck of bridge.getDecks()) {
        if (textContent.includes(deck.file_name)) {
          found.push({
            id: deck.file_id,
            fileId: deck.file_id,
            fileName: deck.file_name,
            filePath: deck.file_path,
            uri: `${RESOURCE_DECK_PREFIX}${encodeURIComponent(deck.file_id)}`,
            fileSizeLabel: `${Math.max(42.5, deck.slides.length * 6.35).toFixed(1)} KB`,
            totalArtifactsCount: bridge.getDecks().length,
            sourceCount: deck.slides.length,
          });
        }
      }
    }
  }

  const dedup = new Map<string, DshArtifactItem>();
  for (const art of found) {
    const key = art.fileId || art.filePath || art.fileName;
    if (!dedup.has(key)) {
      dedup.set(key, art);
    }
  }
  return Array.from(dedup.values());
}

async function exportArtifactToPptx(deck: PresentationDeck | undefined, bridge?: DshClientBridge) {
  if (!deck) {
    bridge?.onToast?.('未找到可导出的演示文稿数据');
    return;
  }
  try {
    const buf = await exportDeckToPptxBuffer(deck);
    const blob = new Blob([new Uint8Array(buf).buffer], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = deck.file_name.endsWith('.pptx') ? deck.file_name : `${deck.file_name}.pptx`;
    a.click();
    URL.revokeObjectURL(url);
    bridge?.onToast?.(`已导出 ${a.download}`);
  } catch (err) {
    bridge?.onToast?.(`导出失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

export function renderPptWorkspace(
  props: SidebarPaneSlotProps,
  ctx: AnyDshClientContext,
  selectionBus: SelectionBus = defaultSelectionBus,
) {
  return React.createElement(PptWorkspace, {
    ctx,
    selectionBus,
    initialActiveDeckId: props.activeDeckId ?? props.tab?.fileId,
  });
}

export function renderArtifactCard(props: ArtifactSlotProps, ctx: AnyDshClientContext) {
  return React.createElement(ArtifactCard, {
    artifact: props.artifact,
    onOpenArtifact: (art) => {
      if (props.onOpenArtifact) {
        props.onOpenArtifact(art);
      } else if (art.fileId && ctx.bridge) {
        ctx.bridge.setActiveDeckId(art.fileId);
      } else if (!isRealDshContext(ctx)) {
        ctx.sidebarRightTabs.open?.({
          id: art.fileId || art.id,
          uri: art.uri,
          title: art.fileName,
          fileId: art.fileId,
          filePath: art.filePath,
        });
      } else {
        const targetId = art.fileId || art.id;
        void ctx.sidebarRight?.openResource(
          `${RESOURCE_DECK_PREFIX}${encodeURIComponent(targetId)}`,
        );
      }
    },
    onOpenWindow: props.onOpenWindow,
    onShareArtifact: props.onShareArtifact,
    onViewAllArtifacts: props.onViewAllArtifacts,
  });
}

export function renderSelectionChipBar(
  props: ComposerContextSlotProps,
  ctx: AnyDshClientContext,
  selectionBus: SelectionBus = defaultSelectionBus,
) {
  return React.createElement(SelectionChipBar, {
    selectionBus,
    onFocusSelection: (target) => {
      if (props.onFocusSelection) {
        props.onFocusSelection(target);
      } else {
        ctx.bridge?.triggerFocusTarget(target);
      }
    },
    onCopyToast: (msg) => ctx.bridge?.onToast?.(msg),
  });
}

function applyRealDshClient(
  ctx: RealDshClientContext,
  bus: SelectionBus,
): () => void {
  const disposers: Array<() => void> = [];
  const disposeStyles = mountPluginStyles();
  disposers.push(disposeStyles);

  let existingBridge: DshClientBridge | undefined;
  try {
    existingBridge = ctx.bridge;
  } catch {
    // Real Cordis Context proxy rejects reading non-injected properties like `bridge`
    existingBridge = undefined;
  }

  const ownedRemoteBridge = existingBridge
    ? null
    : new RemoteDshClientBridge({
        onCollapseRightSidebar: () => ctx.sidebarRight?.toggleExpanded?.(false),
      });
  const effectiveBridge: DshClientBridge = existingBridge ?? ownedRemoteBridge!;
  const effectiveCtx: RealDshClientContext = existingBridge
    ? ctx
    : {
        slots: ctx.slots,
        sidebarRightTabs: ctx.sidebarRightTabs,
        sidebarRight: ctx.sidebarRight,
        bridge: effectiveBridge,
      };

  if (ownedRemoteBridge) {
    disposers.push(() => ownedRemoteBridge.dispose());
  }

  let latestInputActions: RealInputActions | null = null;

  const syncSelectionToServer = (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    const ev = payload as Partial<DocumentSelectionEvent>;
    if (ev.selection && typeof effectiveBridge.syncSelection === 'function') {
      void effectiveBridge.syncSelection(ev.selection);
    }
  };

  disposers.push(bus.on(SELECTION_EVENT_CHANGED, syncSelectionToServer));
  disposers.push(bus.on(SELECTION_EVENT_SEND, syncSelectionToServer));

  // 选区发送到对话：
  //  - 纯引用（无 aiPrompt）：作为“引用芯片”(QuoteSummary)写入输入框，显示为特殊引用块；
  //  - AI 内联编辑（带 aiPrompt）：保留结构化 prompt 供 Agent 理解。
  bus.registerSendHandler(({ prompt, blocks, event }) => {
    const hasAiPrompt = Boolean(event.selection.aiPrompt?.trim());
    const fileName = effectiveBridge.getDeckById(event.selection.fileId)?.file_name;
    const text = hasAiPrompt
      ? renderTencentDocsSelectionPrompt(blocks, prompt)
      : formatSelectionReferenceText(event.selection, { fileName });
    const summary = hasAiPrompt
      ? undefined
      : buildSelectionQuoteSummary(event.selection, { fileName });
    if (insertReferenceText(text, summary)) {
      effectiveBridge.onToast?.(
        hasAiPrompt ? '已将选区与 AI 指令写入对话输入框' : '已将引用写入对话输入框',
      );
      return;
    }
    if (typeof effectiveBridge.onSendComposerPrompt === 'function') {
      try {
        effectiveBridge.onSendComposerPrompt(text, [], { source: 'ppt-studio' });
        effectiveBridge.onToast?.('已将引用发送到对话');
        return;
      } catch {
        /* fall through */
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    effectiveBridge.onToast?.('已复制引用内容到剪贴板（当前环境未提供输入框接口）');
  });
  disposers.push(() => bus.registerSendHandler(null));

  const PptSidebarTab: React.FC<RealSidebarTabSlotProps> = (props) => {
    let tabInfoFromUseHook: unknown;
    if (typeof props.useTabInfo === 'function') {
      try {
        tabInfoFromUseHook = props.useTabInfo();
      } catch {
        tabInfoFromUseHook = undefined;
      }
    }
    const tabInfo = tabInfoFromUseHook ?? props.hooks?.tabInfo?.() ?? props.tab;
    const rawAddress =
      (tabInfo && typeof tabInfo === 'object' && 'tab' in tabInfo
        ? ((tabInfo as { tab?: { navigation?: { address?: unknown }; uri?: unknown } }).tab
            ?.navigation?.address ??
            (tabInfo as { tab?: { uri?: unknown } }).tab?.uri)
        : undefined) ??
      (tabInfo && typeof tabInfo === 'object' && 'navigation' in tabInfo
        ? (tabInfo as { navigation?: { address?: unknown } }).navigation?.address
        : undefined) ??
      (tabInfo && typeof tabInfo === 'object' && 'uri' in tabInfo
        ? (tabInfo as { uri?: unknown }).uri
        : undefined) ??
      '';
    const address = typeof rawAddress === 'string' ? rawAddress : '';

    const openedAddressToFileIdRef = useRef<Map<string, string>>(new Map());
    const inFlightOpenRef = useRef<string | null>(null);
    const lastFailedOpenRef = useRef<string | null>(null);
    const parsedAddress = useMemo(
      () => parseDshFileResourceAddress(address),
      [address],
    );
    const deckIdFromUri = parsedAddress.deckId ?? null;

    useEffect(() => {
      if (!address) return;

      if (deckIdFromUri) {
        effectiveBridge.setActiveDeckId(deckIdFromUri);
        if (
          !effectiveBridge.getDeckById(deckIdFromUri) &&
          typeof effectiveBridge.refreshDecks === 'function'
        ) {
          void effectiveBridge.refreshDecks().then(() => {
            if (effectiveBridge.getDeckById(deckIdFromUri)) {
              effectiveBridge.setActiveDeckId(deckIdFromUri);
            }
          });
        }
        return;
      }

      const diskPath = parsedAddress.filePath;
      if (diskPath && SLIDE_EXTENSION_REGEX.test(diskPath)) {
        const openKey = `${parsedAddress.sessionId ?? ''}::${diskPath}`;
        const rememberedId = openedAddressToFileIdRef.current.get(openKey);
        const rememberedDeck = rememberedId
          ? effectiveBridge.getDeckById(rememberedId)
          : undefined;
        if (rememberedId && !rememberedDeck) {
          openedAddressToFileIdRef.current.delete(openKey);
        }

        const existing =
          rememberedDeck ??
          effectiveBridge.getDecks().find((d) => {
            const normDeck = normalizeComparePath(d.file_path);
            return (
              normDeck === normalizeComparePath(diskPath) ||
              normDeck === normalizeComparePath(address)
            );
          });

        if (existing) {
          effectiveBridge.setActiveDeckId(existing.file_id);
          return;
        }

        if (
          inFlightOpenRef.current !== openKey &&
          lastFailedOpenRef.current !== openKey &&
          typeof effectiveBridge.openFileFromPath === 'function'
        ) {
          inFlightOpenRef.current = openKey;
          void effectiveBridge
            .openFileFromPath({
              filePath: diskPath,
              resourceAddress: address,
              sessionId: parsedAddress.sessionId,
            })
            .then((opened) => {
              if (opened?.file_id) {
                openedAddressToFileIdRef.current.set(openKey, opened.file_id);
                lastFailedOpenRef.current = null;
              } else {
                lastFailedOpenRef.current = openKey;
              }
            })
            .catch(() => {
              lastFailedOpenRef.current = openKey;
            })
            .finally(() => {
              if (inFlightOpenRef.current === openKey) {
                inFlightOpenRef.current = null;
              }
            });
        }
      }
    }, [address, deckIdFromUri, parsedAddress.filePath, parsedAddress.sessionId]);

    return React.createElement('div', {
      className: 'dsh-plugin-root dsh-plugin-pane-root',
      style: { width: '100%', height: '100%', minHeight: 0, display: 'flex' },
    }, React.createElement(PptWorkspace, {
      ctx: effectiveCtx,
      selectionBus: bus,
      initialActiveDeckId: deckIdFromUri ?? props.activeDeckId,
      onCollapseSidebar: () => ctx.sidebarRight?.toggleExpanded?.(false),
    }));
  };

  const TurnPptArtifactDock: React.FC<RealConversationTurnTailSlotProps> = (props) => {
    const [, setDeckSyncTick] = useState(0);
    useEffect(() => {
      if (!effectiveBridge.subscribe) return;
      return effectiveBridge.subscribe(() => {
        setDeckSyncTick((n) => n + 1);
      });
    }, []);

    const artifacts = extractArtifactsFromTurnProps(props, effectiveBridge);
    if (artifacts.length === 0) return null;

    const openArtifact = (art: DshArtifactItem) => {
      const targetId = art.fileId || art.id;
      if (
        art.filePath &&
        !effectiveBridge.getDeckById(targetId) &&
        typeof effectiveBridge.openFileFromPath === 'function'
      ) {
        void effectiveBridge.openFileFromPath(art.filePath).then((opened) => {
          const id = opened?.file_id || targetId;
          void ctx.sidebarRight?.openResource(
            `${RESOURCE_DECK_PREFIX}${encodeURIComponent(id)}`,
          );
        });
        return;
      }
      if (targetId) {
        effectiveBridge.setActiveDeckId(targetId);
      }
      void ctx.sidebarRight?.openResource(
        `${RESOURCE_DECK_PREFIX}${encodeURIComponent(targetId)}`,
      );
    };

    return React.createElement(
      'div',
      { className: 'dsh-plugin-root' },
      React.createElement(
        React.Fragment,
        null,
        artifacts.map((art) =>
          React.createElement(ArtifactCard, {
            key: art.id || art.fileName,
            artifact: art,
            onOpenArtifact: openArtifact,
            onOpenWindow: (item) => {
              openArtifact(item);
              ctx.sidebarRight?.toggleExpanded?.(true);
            },
            onShareArtifact: (item) => {
              const deck = item.fileId
                ? effectiveBridge.getDeckById(item.fileId)
                : effectiveBridge.getDecks().find((d) => d.file_name === item.fileName);
              void exportArtifactToPptx(deck, effectiveBridge);
            },
            onViewAllArtifacts: () => openArtifact(art),
          }),
        ),
      ),
    );
  };

  // 只用于捕获宿主注入的 inputActions（不渲染任何悬浮 UI）。
  // 选区引用改为“内联文字”直接写入输入框，不再显示 chip 悬浮窗。
  const ComposerInputCapture: React.FC<RealConversationInputDockSlotProps> = (props) => {
    useEffect(() => {
      latestInputActions = props.inputActions ?? null;
      return () => {
        if (latestInputActions === props.inputActions) {
          latestInputActions = null;
        }
      };
    }, [props.inputActions]);
    return null;
  };

  // 把选区引用作为“引用芯片(chip)”写入对话输入框，而不是普通长文本。
  // 走官方 InputActions.insertQuote(text, summary)：输入框里渲染成 QuotePreview
  // 引用块（类似 skill 的特殊激活样式，可整体删除）；summary 提供 label/title/detail
  // 作为芯片上的短标题，text 作为实际发送内容。
  const insertReferenceText = (
    text: string,
    summary?: { label: string; title: string; detail?: string; body: string },
  ): boolean => {
    const actions = latestInputActions;
    if (!actions) return false;
    if (typeof (actions as any).insertQuote === 'function') {
      try {
        const ok = (actions as any).insertQuote(text, summary);
        if (ok !== false) return true;
      } catch {
        /* fall through */
      }
    }
    if (typeof actions.insertText === 'function') {
      const span = actions.captureInsertion?.();
      const ok = actions.insertText(text, span as any);
      if (ok !== false) return true;
    }
    if (typeof actions.setDraft === 'function') {
      actions.setDraft(text);
      return true;
    }
    return false;
  };

  // 入口 2：注册右侧栏标签 + Guide 新建入口
  const disposeTab = ctx.sidebarRightTabs.register({
    id: 'dsh-plugin-ppt-studio',
    kind: 'ppt-studio',
    priority: 'extension',
    multiple: true,
    keepMounted: true,
    patterns: [
      '*.pptx',
      '*.ppt',
      '*.pps',
      '*.pot',
      '*.pptm',
      '*.ppsx',
      '*.ppsm',
      '*.potx',
      '*.potm',
      'dsh-resource://ppt-studio/**',
    ],
    canOpen: (address: string) => {
      if (!address) return false;
      if (
        address.startsWith('dsh-resource://ppt-studio/') ||
        address.startsWith('dsh-ppt://')
      ) {
        return true;
      }
      const parsed = parseDshFileResourceAddress(address);
      return Boolean(parsed.filePath && SLIDE_EXTENSION_REGEX.test(parsed.filePath));
    },
    title: (address: string) => resolveTabTitle(address, effectiveBridge),
    guide: [
      {
        id: 'ppt-studio-new',
        order: 50,
        title: () => 'PPT Studio 演示文稿',
        description: () => '新建或编辑 16:9 演示文稿，支持自由框选精准引用',
      },
    ],
  });
  if (typeof disposeTab === 'function') {
    disposers.push(disposeTab);
  }

  // 右侧标签体槽位
  const disposePane = ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register(
      { name: 'sidebar.right.pane.tab', key: 'dsh-plugin-ppt-studio' },
      PptSidebarTab,
    ),
  );
  if (typeof disposePane === 'function') {
    disposers.push(disposePane);
  }

  // 入口 1：对话流 .pptx 产物卡片槽位
  const disposeArtifact = ctx.slots.inject('conversation.chat.turnTail', () =>
    ctx.slots.register(
      { name: 'conversation.chat.turnTail', id: 'dsh-plugin-ppt-studio-artifact' },
      TurnPptArtifactDock,
    ),
  );
  if (typeof disposeArtifact === 'function') {
    disposers.push(disposeArtifact);
  }

  // 入口 3：隐藏捕获输入框能力（inputActions），不渲染任何悬浮 UI。
  // 选区引用改为“内联文字”写入输入框，不再显示 chip 悬浮窗。
  const disposeComposer = ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register(
      { name: 'conversation.input.dock', id: 'dsh-plugin-ppt-studio-input-capture' },
      ComposerInputCapture,
    ),
  );
  if (typeof disposeComposer === 'function') {
    disposers.push(disposeComposer);
  }

  const cleanup = () => {
    while (disposers.length > 0) {
      const fn = disposers.pop();
      fn?.();
    }
  };

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => cleanup, 'dsh-plugin-ppt-studio: lifecycle');
  }

  return cleanup;
}

function applyMockDshClient(
  ctx: DshClientContext,
  bus: SelectionBus,
): () => void {
  const disposeStyles = mountPluginStyles();

  // 1. 注册右侧停靠栏 PPT 标签类型（认领全部 9 种演示文稿扩展名与 dsh-ppt:// URI）
  const disposeTab = ctx.sidebarRightTabs.register('dsh-ppt-studio', {
    title: (tab) => tab.title || '演示文稿.pptx',
    match: (uri) => SLIDE_EXTENSION_REGEX.test(uri) || uri.startsWith('dsh-ppt://'),
    icon: 'presentation',
  });

  // 2. 注册 sidebar.right.pane.tab 渲染槽（挂载完整 PptWorkspace）
  const disposePane = ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: 'dsh-ppt-studio',
    render: (props: SidebarPaneSlotProps) => renderPptWorkspace(props, ctx, bus),
  });

  // 3. 注册对话流产物卡片与输入区选区芯片槽位（与 WorkBuddy 三入口一致）
  const disposeArtifact = ctx.slots.register({
    name: 'conversation.message.artifact',
    key: 'dsh-ppt-studio-artifact',
    match: (artifact) => SLIDE_EXTENSION_REGEX.test(artifact?.fileName || artifact?.uri || ''),
    render: (props: ArtifactSlotProps) => renderArtifactCard(props, ctx),
  });

  const disposeComposer = ctx.slots.register({
    name: 'conversation.composer.context',
    key: 'dsh-ppt-studio-selection',
    render: (props: ComposerContextSlotProps) => renderSelectionChipBar(props, ctx, bus),
  });

  return () => {
    disposeTab?.();
    disposePane?.();
    disposeArtifact?.();
    disposeComposer?.();
    disposeStyles();
  };
}

export function apply(
  ctx: AnyDshClientContext,
  options?: { selectionBus?: SelectionBus },
): () => void {
  const bus = options?.selectionBus ?? defaultSelectionBus;

  if (isRealDshContext(ctx)) {
    try {
      return applyRealDshClient(ctx, bus);
    } catch (err) {
      console.error('[dsh-plugin-ppt-studio] applyRealDshClient threw:', err);
      throw err;
    }
  }
  return applyMockDshClient(ctx, bus);
}

export * from './dsh-types';
export * from './remote-bridge';
export * from './selection-bus';
export { ArtifactCard } from './components/ArtifactCard';
export { SelectionChipBar } from './components/SelectionChipBar';
export { TabStrip } from './components/TabStrip';
export { DocHeaderBar } from './components/DocHeaderBar';
export { RibbonToolbar } from './components/RibbonToolbar';
export { ThumbnailRail } from './components/ThumbnailRail';
export { SlideRenderer } from './components/SlideRenderer';
export { SlideCanvas } from './components/SlideCanvas';
export { NotesAndStatusBar } from './components/NotesAndStatusBar';
export { SlideshowModal } from './components/SlideshowModal';
export { IndexInspectorModal } from './components/IndexInspectorModal';
export { PptWorkspace } from './components/PptWorkspace';
