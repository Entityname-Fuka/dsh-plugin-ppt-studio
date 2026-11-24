import type { ReactNode } from 'react';
import { exportDeckToPptxBuffer } from '../core/ooxml';
import { DEFAULT_SAMPLE_PAGE_INDEX, createSampleDeck } from '../core/sample-deck';
import type {
  AiEditResult,
  PresentationDeck,
  SlideSelectionPayload,
} from '../core/types';
import {
  apply as applyClientPlugin,
  defaultSelectionBus,
  SelectionBus,
  type DshArtifactItem,
  type DshClientBridge,
  type DshClientContext,
  type DshSidebarTabDescriptor,
  type DshSidebarTabInfo,
  type DshSlotName,
  type DshSlotRegistration,
  type SelectionFocusTarget,
} from '../client/index';
import {
  DeckRegistry,
  apply as applyServerPlugin,
  executeLocalAiEdit,
  type DshServerContext,
  type DshToolDefinition,
  type DshToolExecutionContext,
} from '../server/index';

export interface MockDshHostState {
  decks: PresentationDeck[];
  activeDeckId: string;
  rightSidebarOpen: boolean;
  pageIndexByDeck: Record<string, number>;
  highlightTarget: {
    fileId: string;
    page_index: number;
    shape_ids: string[];
    bbox_pt?: { x: number; y: number; w: number; h: number };
    nonce: number;
  } | null;
  toastMessage: string | null;
}

export class MockDshHost {
  readonly registry: DeckRegistry;
  readonly selectionBus: SelectionBus;
  readonly serverCtx: DshServerContext;
  readonly clientCtx: DshClientContext;

  private tools = new Map<string, DshToolDefinition<any, any>>();
  private tabDescriptors = new Map<string, DshSidebarTabDescriptor>();
  private openTabs: DshSidebarTabInfo[] = [];
  private slots = new Map<DshSlotName, DshSlotRegistration[]>();
  private listeners = new Set<() => void>();
  private disposers: Array<() => void> = [];
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private state: MockDshHostState;

  constructor(options?: { initialDeck?: PresentationDeck }) {
    const sample = options?.initialDeck ?? createSampleDeck();
    this.registry = new DeckRegistry({ loadSampleDeck: false });
    this.registry.registerDeck(sample);
    this.selectionBus = new SelectionBus();

    this.state = {
      decks: [this.registry.getEngine(sample.file_id).getDeck()],
      activeDeckId: sample.file_id,
      rightSidebarOpen: true,
      pageIndexByDeck: {
        [sample.file_id]:
          sample.slides.length > DEFAULT_SAMPLE_PAGE_INDEX
            ? DEFAULT_SAMPLE_PAGE_INDEX
            : 0,
      },
      highlightTarget: null,
      toastMessage: null,
    };

    this.openTabs = [
      {
        id: sample.file_id,
        uri: `dsh-ppt://${sample.file_id}/${sample.file_name}`,
        title: sample.file_name,
        fileId: sample.file_id,
        filePath: sample.file_path,
      },
    ];

    this.serverCtx = {
      tools: {
        register: (tool) => {
          this.tools.set(tool.name, tool);
          return () => this.tools.delete(tool.name);
        },
        get: (name) => this.tools.get(name),
        list: () => Array.from(this.tools.values()),
        execute: async (name, args, toolCtx) => this.executeTool(name, args, toolCtx),
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const bridge: DshClientBridge = {
      getDecks: () => this.state.decks,
      getActiveDeckId: () => this.state.activeDeckId,
      getDeckById: (fileId) => this.state.decks.find((d) => d.file_id === fileId),
      upsertDeck: (deck, makeActive = false) => this.upsertDeck(deck, makeActive),
      setActiveDeckId: (fileId) => {
        this.state = {
          ...this.state,
          activeDeckId: fileId,
          rightSidebarOpen: true,
        };
        this.notify();
      },
      closeDeck: (fileId) => this.closeDeck(fileId),
      getActivePageIndex: (fileId) => this.state.pageIndexByDeck[fileId] ?? 0,
      setActivePageIndex: (fileId, pageIndex) => {
        this.state = {
          ...this.state,
          pageIndexByDeck: {
            ...this.state.pageIndexByDeck,
            [fileId]: pageIndex,
          },
        };
        this.notify();
      },
      getHighlightTarget: () => this.state.highlightTarget,
      triggerFocusTarget: (target) => this.focusSelectionTarget(target),
      callTool: (name, args) => this.executeTool(name, args),
      executeAiSelectionEdit: (selection, prompt, deck) =>
        this.runAiSelectionEdit(selection, prompt, deck),
      onCollapseRightSidebar: () => this.setRightSidebarOpen(false),
      onToast: (msg) => this.showToast(msg),
    };

    this.clientCtx = {
      sidebarRightTabs: {
        register: (key, descriptor) => {
          this.tabDescriptors.set(key, descriptor);
          return () => this.tabDescriptors.delete(key);
        },
        open: (tab) => {
          const existing = this.openTabs.find(
            (t) => t.id === tab.id || t.uri === tab.uri,
          );
          if (!existing) {
            this.openTabs = [...this.openTabs, tab];
          }
          if (tab.fileId) {
            this.state = {
              ...this.state,
              activeDeckId: tab.fileId,
              rightSidebarOpen: true,
            };
          } else {
            this.state = { ...this.state, rightSidebarOpen: true };
          }
          this.notify();
        },
        focus: (idOrUri) => {
          const found = this.openTabs.find(
            (t) => t.id === idOrUri || t.uri === idOrUri,
          );
          if (found?.fileId) {
            this.state = {
              ...this.state,
              activeDeckId: found.fileId,
              rightSidebarOpen: true,
            };
            this.notify();
          }
        },
        close: (id) => this.closeDeck(id),
        list: () => [...this.openTabs],
        resolve: (uri) => {
          for (const [key, descriptor] of this.tabDescriptors.entries()) {
            if (descriptor.match(uri)) return { key, descriptor };
          }
          return undefined;
        },
      },
      slots: {
        register: (registration) => {
          const list = this.slots.get(registration.name) ?? [];
          list.push(registration);
          this.slots.set(registration.name, list);
          return () => {
            const cur = this.slots.get(registration.name) ?? [];
            this.slots.set(
              registration.name,
              cur.filter((r) => r.key !== registration.key),
            );
          };
        },
        getAll: (name) => [...(this.slots.get(name) ?? [])],
        renderSlot: (name, props) => this.renderSlot(name, props),
      },
      bridge,
      events: {
        emit: (event, payload) => this.selectionBus.emit(event, payload),
        on: (event, handler) => this.selectionBus.on(event, handler),
      },
    };

    // 通过真实 Cordis 插件入口挂载 Server & Client 插件
    this.disposers.push(applyServerPlugin(this.serverCtx, { registry: this.registry }));
    this.disposers.push(
      applyClientPlugin(this.clientCtx, { selectionBus: this.selectionBus }),
    );
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): MockDshHostState => this.state;

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }

  getRegisteredToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getRegisteredSlotKeys(name: DshSlotName): string[] {
    return (this.slots.get(name) ?? []).map((s) => s.key);
  }

  renderSlot(name: DshSlotName, props: Record<string, unknown>): ReactNode {
    const regs = this.slots.get(name) ?? [];
    for (const reg of regs) {
      if (!reg.match || reg.match(props.artifact ?? props)) {
        return reg.render(props);
      }
    }
    return null;
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    toolCtx?: DshToolExecutionContext,
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool "${name}" is not registered`);
    const result = await tool.execute(args, toolCtx);
    this.syncFromRegistry();
    return result;
  }

  private syncFromRegistry(): void {
    const decks = this.registry.listDecks().map((info) => {
      return this.registry.getEngine(info.file_id).getDeck();
    });
    this.state = {
      ...this.state,
      decks,
    };
    this.notify();
  }

  upsertDeck(deck: PresentationDeck, makeActive = false): void {
    if (this.registry.hasDeck(deck.file_id)) {
      this.registry.getEngine(deck.file_id).loadDeck(deck);
    } else {
      this.registry.registerDeck(deck);
    }
    const decks = this.state.decks.some((d) => d.file_id === deck.file_id)
      ? this.state.decks.map((d) => (d.file_id === deck.file_id ? deck : d))
      : [...this.state.decks, deck];

    if (!this.openTabs.some((t) => t.id === deck.file_id)) {
      this.openTabs = [
        ...this.openTabs,
        {
          id: deck.file_id,
          uri: `dsh-ppt://${deck.file_id}/${deck.file_name}`,
          title: deck.file_name,
          fileId: deck.file_id,
          filePath: deck.file_path,
        },
      ];
    }

    this.state = {
      ...this.state,
      decks,
      activeDeckId: makeActive ? deck.file_id : this.state.activeDeckId,
      rightSidebarOpen: makeActive ? true : this.state.rightSidebarOpen,
      pageIndexByDeck: {
        ...this.state.pageIndexByDeck,
        [deck.file_id]: this.state.pageIndexByDeck[deck.file_id] ?? 0,
      },
    };
    this.notify();
  }

  closeDeck(fileId: string): void {
    this.registry.removeDeck(fileId);
    const nextDecks = this.state.decks.filter((d) => d.file_id !== fileId);
    this.openTabs = this.openTabs.filter((t) => t.id !== fileId);
    const nextActive =
      this.state.activeDeckId === fileId
        ? (nextDecks[0]?.file_id ?? '')
        : this.state.activeDeckId;
    this.state = {
      ...this.state,
      decks: nextDecks,
      activeDeckId: nextActive,
    };
    this.notify();
  }

  setRightSidebarOpen(open: boolean): void {
    this.state = { ...this.state, rightSidebarOpen: open };
    this.notify();
  }

  focusSelectionTarget(target: SelectionFocusTarget): void {
    const fileId = target.fileId || this.state.activeDeckId;
    this.state = {
      ...this.state,
      activeDeckId: fileId,
      rightSidebarOpen: true,
      pageIndexByDeck: {
        ...this.state.pageIndexByDeck,
        [fileId]: target.page_index,
      },
      highlightTarget: {
        fileId,
        page_index: target.page_index,
        shape_ids: target.shape_ids,
        bbox_pt: target.bbox_pt,
        nonce: Date.now(),
      },
    };
    this.notify();
    this.showToast(
      `已定位至第 ${target.page_index + 1} 页并高亮 ${target.shape_ids.length} 个元素`,
    );
  }

  async runAiSelectionEdit(
    selection: SlideSelectionPayload | undefined,
    prompt: string,
    targetDeck?: PresentationDeck,
  ): Promise<AiEditResult> {
    const fileId = targetDeck?.file_id ?? selection?.fileId ?? this.state.activeDeckId;
    const engine = this.registry.getEngine(fileId);
    const pageIndex =
      selection?.page_index ?? this.state.pageIndexByDeck[fileId] ?? 0;

    const result = await executeLocalAiEdit({
      instruction: prompt,
      selection,
      page_index: pageIndex,
      file_id: fileId,
      registry: this.registry,
      engine,
      executeTool: (toolName, args) => this.executeTool(toolName, args),
    });

    this.upsertDeck(result.deck, true);
    this.state = {
      ...this.state,
      pageIndexByDeck: {
        ...this.state.pageIndexByDeck,
        [fileId]: result.page_index,
      },
      highlightTarget: {
        fileId,
        page_index: result.page_index,
        shape_ids: result.affected_shape_ids,
        nonce: Date.now(),
      },
    };
    this.notify();
    return result;
  }

  getArtifactForActiveDeck(): DshArtifactItem | null {
    const deck =
      this.state.decks.find((d) => d.file_id === this.state.activeDeckId) ??
      this.state.decks[0];
    if (!deck) return null;
    return {
      id: deck.file_id,
      fileName: deck.file_name,
      filePath: deck.file_path,
      uri: `dsh-ppt://${deck.file_id}/${deck.file_name}`,
      fileId: deck.file_id,
      fileSizeLabel: `${Math.max(42.5, deck.slides.length * 6.35).toFixed(1)} KB`,
      totalArtifactsCount: this.state.decks.length,
      sourceCount: 12,
    };
  }

  async exportActivePptx(): Promise<void> {
    const deck =
      this.state.decks.find((d) => d.file_id === this.state.activeDeckId) ??
      this.state.decks[0];
    if (!deck) return;
    const buf = await exportDeckToPptxBuffer(deck);
    const blob = new Blob([new Uint8Array(buf).buffer], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = deck.file_name;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast(`已导出 ${deck.file_name}`);
  }

  showToast(message: string): void {
    this.state = { ...this.state, toastMessage: message };
    this.notify();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.state = { ...this.state, toastMessage: null };
      this.notify();
    }, 2400);
  }
}

export { defaultSelectionBus };
