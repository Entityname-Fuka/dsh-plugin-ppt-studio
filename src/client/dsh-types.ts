import type { ComponentType, ReactNode } from 'react';
import type {
  AiEditResult,
  BoundsPt,
  DocumentSelectionContextBlock,
  DocumentSelectionEvent,
  PresentationDeck,
  SlideSelectionPayload,
} from '../core/types';

export interface DshSidebarTabInfo {
  id: string;
  uri: string;
  title?: string;
  fileId?: string;
  filePath?: string;
  dirty?: boolean;
  meta?: Record<string, unknown>;
}

export interface DshSidebarTabDescriptor {
  title: (tab: DshSidebarTabInfo) => string;
  match: (uri: string) => boolean;
  icon?: string;
}

export interface DshSidebarRightTabsRegistry {
  register: (key: string, descriptor: DshSidebarTabDescriptor) => () => void;
  open?: (tab: DshSidebarTabInfo) => void;
  focus?: (idOrUri: string) => void;
  close?: (id: string) => void;
  list?: () => DshSidebarTabInfo[];
  resolve?: (uri: string) => { key: string; descriptor: DshSidebarTabDescriptor } | undefined;
}

export type DshSlotName =
  | 'sidebar.right.pane.tab'
  | 'conversation.message.artifact'
  | 'conversation.composer.context'
  | 'conversation.chat.turnTail'
  | 'conversation.input.dock'
  | string;

export interface DshSlotRegistration<TProps = any> {
  name: DshSlotName;
  key: string;
  match?: (payload: any) => boolean;
  render: (props: TProps) => ReactNode;
}

export interface DshSlotsRegistry {
  register: <TProps = any>(registration: DshSlotRegistration<TProps>) => () => void;
  getAll?: (name: DshSlotName) => DshSlotRegistration[];
  renderSlot?: (name: DshSlotName, props: any) => ReactNode;
}

export interface RealSidebarRightTabGuideItem {
  id: string;
  order?: number;
  title: () => string;
  description?: () => string;
}

export interface RealSidebarRightTabDefinition {
  id: string;
  kind: string;
  multiple?: boolean;
  keepMounted?: boolean;
  patterns?: string[];
  priority?: 'extension' | 'builtin' | 'fallback';
  canOpen?: (address: string) => boolean;
  title: (address: string) => string;
  guide?: RealSidebarRightTabGuideItem[];
}

export interface RealSidebarRightTabsService {
  register: (definition: RealSidebarRightTabDefinition) => (() => void) | void;
  open?: (tab: DshSidebarTabInfo) => void;
  focus?: (idOrUri: string) => void;
  close?: (id: string) => void;
  list?: () => DshSidebarTabInfo[];
}

export interface RealSidebarRightService {
  openResource: (
    address: string,
    options?: {
      focus?: boolean;
      expand?: boolean;
      title?: string;
      [key: string]: unknown;
    },
  ) => Promise<unknown> | unknown;
  openTab: (
    kind: string,
    options?: {
      address?: string;
      title?: string;
      focus?: boolean;
      expand?: boolean;
      [key: string]: unknown;
    },
  ) => Promise<unknown> | unknown;
  isExpanded?: boolean | (() => boolean);
  toggleExpanded?: (expanded?: boolean) => void;
}

export interface RealSlotDescriptor {
  name: DshSlotName;
  key?: string;
  id?: string;
  order?: number;
  [extra: string]: unknown;
}

export interface RealSlotsService {
  inject: (name: string, fn: () => (() => void) | void) => () => void;
  register: <TProps = any>(
    descriptor: RealSlotDescriptor,
    component?: ComponentType<TProps>,
  ) => (() => void) | void;
}

export interface RealInputActions {
  captureInsertion: () => unknown;
  insertText: (text: string, span?: unknown) => void;
  setDraft: (text: string) => void;
  submit: () => Promise<void> | void;
}

export interface RealSidebarTabInfo {
  id?: string;
  kind?: string;
  title?: string;
  navigation?: {
    address?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RealSidebarTabHookResult {
  tab?: RealSidebarTabInfo;
  panel?: unknown;
  [key: string]: unknown;
}

export interface RealSidebarTabSlotProps {
  useTabInfo?: () => RealSidebarTabHookResult | RealSidebarTabInfo | undefined;
  hooks?: {
    tabInfo?: () => RealSidebarTabInfo | undefined;
    [key: string]: unknown;
  };
  tab?: RealSidebarTabInfo | DshSidebarTabInfo;
  activeDeckId?: string;
  [key: string]: unknown;
}

export interface OpenFileFromPathRequest {
  filePath: string;
  resourceAddress?: string;
  sessionId?: string;
}

export interface RealConversationTurnTailSlotProps {
  turn?: Record<string, unknown>;
  message?: Record<string, unknown>;
  artifact?: DshArtifactItem;
  artifacts?: unknown[];
  deliverables?: unknown[];
  files?: unknown[];
  attachments?: unknown[];
  hooks?: {
    turn?: () => Record<string, unknown> | undefined;
    message?: () => Record<string, unknown> | undefined;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RealConversationInputDockSlotProps {
  inputActions?: RealInputActions;
  sessionId?: string;
  conversationId?: string;
  [key: string]: unknown;
}

export type DshSelectionEventName =
  | 'docs:selectionChanged'
  | 'docs:selectionSend'
  | 'docs:selectionFocus'
  | 'docs:openDocument';

export interface SelectionFocusTarget {
  fileId?: string;
  uri?: string;
  page_index: number;
  shape_ids: string[];
  bbox_pt?: BoundsPt;
  rangeId?: string;
}

export interface DshArtifactItem {
  id: string;
  fileName: string;
  filePath?: string;
  uri: string;
  fileId?: string;
  fileSizeBytes?: number;
  fileSizeLabel?: string;
  totalArtifactsCount?: number;
  sourceCount?: number;
}

export interface ArtifactSlotProps {
  artifact: DshArtifactItem;
  onOpenArtifact?: (artifact: DshArtifactItem) => void;
  onOpenWindow?: (artifact: DshArtifactItem) => void;
  onShareArtifact?: (artifact: DshArtifactItem) => void;
  onViewAllArtifacts?: () => void;
}

export interface ComposerContextSlotProps {
  sessionId?: string;
  onFocusSelection?: (target: SelectionFocusTarget) => void;
  onInspectSelection?: (payload: SlideSelectionPayload) => void;
}

export interface SidebarPaneSlotProps {
  tab?: DshSidebarTabInfo;
  activeDeckId?: string;
}

export interface DshClientBridge {
  getDecks: () => PresentationDeck[];
  getActiveDeckId: () => string | null;
  getDeckById: (fileId: string) => PresentationDeck | undefined;
  upsertDeck: (deck: PresentationDeck, makeActive?: boolean) => void;
  setActiveDeckId: (fileId: string) => void;
  closeDeck: (fileId: string) => void;
  getActivePageIndex: (fileId: string) => number;
  setActivePageIndex: (fileId: string, pageIndex: number) => void;
  getHighlightTarget: () => {
    fileId: string;
    page_index: number;
    shape_ids: string[];
    bbox_pt?: BoundsPt;
    nonce: number;
  } | null;
  triggerFocusTarget: (target: SelectionFocusTarget) => void;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown> | unknown;
  executeAiSelectionEdit?: (
    selection: SlideSelectionPayload,
    prompt: string,
    deck: PresentationDeck,
  ) => Promise<AiEditResult> | AiEditResult;
  onSendComposerPrompt?: (
    prompt: string,
    blocks: DocumentSelectionContextBlock[],
    meta?: Record<string, unknown>,
  ) => void;
  onCollapseRightSidebar?: () => void;
  onToast?: (message: string) => void;
  subscribe?: (listener: () => void) => () => void;
  refreshDecks?: () => Promise<PresentationDeck[]>;
  openFileFromPath?: (
    input: string | OpenFileFromPathRequest,
  ) => Promise<PresentationDeck | null>;
  openExternalFile?: (
    filePath: string,
  ) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  saveDeckToFile?: (
    fileId: string,
    filePath?: string,
  ) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  syncSelection?: (payload: SlideSelectionPayload) => Promise<void>;
  getToastMessage?: () => string | null;
}

export interface DshClientContext {
  sidebarRightTabs: DshSidebarRightTabsRegistry;
  slots: DshSlotsRegistry;
  sidebarRight?: RealSidebarRightService;
  effect?: (fn: () => (() => void) | void, label?: string) => void;
  conversation?: any;
  bridge?: DshClientBridge;
  events?: {
    emit: (event: string, payload: unknown) => void;
    on: (event: string, handler: (payload: any) => void) => () => void;
  };
}

export interface RealDshClientContext {
  sidebarRightTabs: RealSidebarRightTabsService;
  slots: RealSlotsService;
  sidebarRight?: RealSidebarRightService;
  effect?: (fn: () => (() => void) | void, label?: string) => void;
  conversation?: any;
  bridge?: DshClientBridge;
  events?: {
    emit: (event: string, payload: unknown) => void;
    on: (event: string, handler: (payload: any) => void) => () => void;
  };
}

export type AnyDshClientContext = DshClientContext | RealDshClientContext;

export function isRealDshContext(
  ctx: AnyDshClientContext,
): ctx is RealDshClientContext {
  return typeof (ctx.slots as Partial<RealSlotsService> | undefined)?.inject === 'function';
}

export interface PendingSelectionWakeup {
  id: string;
  event: DocumentSelectionEvent;
  retries: number;
  createdAt: number;
}
