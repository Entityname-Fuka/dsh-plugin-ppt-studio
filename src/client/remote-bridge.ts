import type {
  BoundsPt,
  PresentationDeck,
  SlideSelectionPayload,
} from '../core/types';
import type {
  DshClientBridge,
  OpenFileFromPathRequest,
  SelectionFocusTarget,
} from './dsh-types';

export interface RemoteDshClientBridgeOptions {
  baseUrl?: string;
  autoConnect?: boolean;
  initialDecks?: PresentationDeck[];
  onCollapseRightSidebar?: () => void;
  onToast?: (message: string) => void;
}

export interface HighlightTargetState {
  fileId: string;
  page_index: number;
  shape_ids: string[];
  bbox_pt?: BoundsPt;
  nonce: number;
}

const DEFAULT_API_BASE = '/dsh-ppt-studio/api';

function normalizeBaseUrl(raw?: string): string {
  const value = (raw || DEFAULT_API_BASE).trim();
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function clampPageIndex(deck: PresentationDeck | undefined, idx: number): number {
  if (!deck || deck.slides.length === 0) return 0;
  return Math.max(0, Math.min(deck.slides.length - 1, idx));
}

export class RemoteDshClientBridge implements DshClientBridge {
  private readonly baseUrl: string;
  private decks: PresentationDeck[];
  private activeDeckId: string | null;
  private pageIndexByDeck: Record<string, number>;
  private highlightTarget: HighlightTargetState | null = null;
  private listeners = new Set<() => void>();
  private eventSource: EventSource | null = null;
  private disposed = false;
  private hasRemoteSync = false;
  private pendingRefresh: Promise<PresentationDeck[]> | null = null;
  private pendingUpsertSeq = new Map<string, number>();
  private inFlightUpserts = new Map<string, number>();
  private localCommittedStamps = new Map<string, Set<string>>();
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private toastMessage: string | null = null;
  private toastCallback?: (message: string) => void;

  private static deckStamp(deck: PresentationDeck): string {
    return `${deck.version}:${deck.updated_at}`;
  }

  private recordLocalStamp(deck: PresentationDeck): void {
    let set = this.localCommittedStamps.get(deck.file_id);
    if (!set) {
      set = new Set<string>();
      this.localCommittedStamps.set(deck.file_id, set);
    }
    set.add(RemoteDshClientBridge.deckStamp(deck));
    if (set.size > 200) {
      const first = set.values().next().value;
      if (first !== undefined) set.delete(first);
    }
  }

  private isStaleLocalEcho(incoming: PresentationDeck): boolean {
    const current = this.getDeckById(incoming.file_id);
    if (!current) return false;
    const incomingStamp = RemoteDshClientBridge.deckStamp(incoming);
    const currentStamp = RemoteDshClientBridge.deckStamp(current);
    if (incomingStamp === currentStamp) return true;
    const inFlight = this.inFlightUpserts.get(incoming.file_id) ?? 0;
    const knownLocal = this.localCommittedStamps.get(incoming.file_id);
    if (knownLocal?.has(incomingStamp)) {
      return true;
    }
    // While our own POST /decks is still in flight, ignore older server snapshots
    // that have the same AI edit count (avoiding race with SSE / refreshDecks).
    if (
      inFlight > 0 &&
      incoming.ai_edits.length === current.ai_edits.length &&
      incoming.version <= current.version
    ) {
      return true;
    }
    return false;
  }

  onCollapseRightSidebar?: () => void;

  constructor(options?: RemoteDshClientBridgeOptions) {
    this.baseUrl = normalizeBaseUrl(options?.baseUrl);
    this.onCollapseRightSidebar = options?.onCollapseRightSidebar;
    this.toastCallback = options?.onToast;

    const initial = options?.initialDecks ? [...options.initialDecks] : [];

    this.decks = initial;
    this.activeDeckId = initial[0]?.file_id ?? null;
    this.pageIndexByDeck = {};
    for (const deck of initial) {
      this.pageIndexByDeck[deck.file_id] = 0;
    }

    if (options?.autoConnect !== false) {
      void this.refreshDecks();
      this.connectEvents();
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    if (this.disposed) return;
    for (const fn of this.listeners) {
      fn();
    }
  }

  onToast = (message: string): void => {
    if (this.toastCallback) {
      this.toastCallback(message);
      return;
    }
    this.toastMessage = message;
    this.notify();
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null;
      this.toastMessage = null;
      this.notify();
    }, 2400);
  };

  getToastMessage = (): string | null => this.toastMessage;

  setToastHandler(handler: ((message: string) => void) | undefined): void {
    this.toastCallback = handler;
  }

  getDecks = (): PresentationDeck[] => this.decks;

  getActiveDeckId = (): string | null => this.activeDeckId;

  getDeckById = (fileId: string): PresentationDeck | undefined =>
    this.decks.find((d) => d.file_id === fileId);

  getActivePageIndex = (fileId: string): number => {
    const deck = this.getDeckById(fileId);
    const saved = this.pageIndexByDeck[fileId];
    if (typeof saved === 'number') {
      return clampPageIndex(deck, saved);
    }
    return 0;
  };

  setActivePageIndex = (fileId: string, pageIndex: number): void => {
    const deck = this.getDeckById(fileId);
    const clamped = clampPageIndex(deck, pageIndex);
    this.pageIndexByDeck = {
      ...this.pageIndexByDeck,
      [fileId]: clamped,
    };
    this.notify();
  };

  setActiveDeckId = (fileId: string): void => {
    if (this.activeDeckId === fileId) return;
    this.activeDeckId = fileId;
    if (!(fileId in this.pageIndexByDeck)) {
      this.pageIndexByDeck = {
        ...this.pageIndexByDeck,
        [fileId]: 0,
      };
    }
    this.notify();
  };

  getHighlightTarget = (): HighlightTargetState | null => this.highlightTarget;

  triggerFocusTarget = (target: SelectionFocusTarget): void => {
    const fileId = target.fileId || this.activeDeckId || this.decks[0]?.file_id;
    if (!fileId) return;

    const deck = this.getDeckById(fileId);
    const clampedPage = clampPageIndex(deck, target.page_index);
    this.activeDeckId = fileId;
    this.pageIndexByDeck = {
      ...this.pageIndexByDeck,
      [fileId]: clampedPage,
    };
    this.highlightTarget = {
      fileId,
      page_index: clampedPage,
      shape_ids: [...target.shape_ids],
      bbox_pt: target.bbox_pt,
      nonce: Date.now(),
    };
    this.notify();
    this.onToast(
      `已定位至第 ${clampedPage + 1} 页并高亮 ${target.shape_ids.length} 个元素`,
    );
  };

  private applyLocalDeckUpsert(deck: PresentationDeck, makeActive = false): void {
    const exists = this.decks.some((d) => d.file_id === deck.file_id);
    this.decks = exists
      ? this.decks.map((d) => (d.file_id === deck.file_id ? deck : d))
      : [...this.decks, deck];

    if (!(deck.file_id in this.pageIndexByDeck)) {
      this.pageIndexByDeck = {
        ...this.pageIndexByDeck,
        [deck.file_id]: 0,
      };
    } else {
      this.pageIndexByDeck = {
        ...this.pageIndexByDeck,
        [deck.file_id]: clampPageIndex(deck, this.pageIndexByDeck[deck.file_id]),
      };
    }

    if (makeActive || !this.activeDeckId) {
      this.activeDeckId = deck.file_id;
    }
    this.notify();
  }

  upsertDeck = (deck: PresentationDeck, makeActive = false): void => {
    this.recordLocalStamp(deck);
    const seq = (this.pendingUpsertSeq.get(deck.file_id) ?? 0) + 1;
    this.pendingUpsertSeq.set(deck.file_id, seq);
    this.inFlightUpserts.set(
      deck.file_id,
      (this.inFlightUpserts.get(deck.file_id) ?? 0) + 1,
    );
    this.applyLocalDeckUpsert(deck, makeActive);

    if (typeof fetch !== 'function') {
      this.inFlightUpserts.set(
        deck.file_id,
        Math.max(0, (this.inFlightUpserts.get(deck.file_id) ?? 1) - 1),
      );
      return;
    }
    void fetch(`${this.baseUrl}/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deck, makeActive }),
    })
      .then(async (res) => {
        if (!res.ok || this.disposed) return;
        const data = (await res.json().catch(() => null)) as {
          deck?: PresentationDeck;
        } | null;
        if (data?.deck && data.deck.file_id) {
          this.hasRemoteSync = true;
          // Ignore stale response if a newer local edit has already been issued
          if (this.pendingUpsertSeq.get(deck.file_id) !== seq) return;
          if (this.isStaleLocalEcho(data.deck)) return;
          this.applyLocalDeckUpsert(data.deck, makeActive);
        }
      })
      .catch(() => {})
      .finally(() => {
        this.inFlightUpserts.set(
          deck.file_id,
          Math.max(0, (this.inFlightUpserts.get(deck.file_id) ?? 1) - 1),
        );
      });
  };

  closeDeck = (fileId: string): void => {
    this.decks = this.decks.filter((d) => d.file_id !== fileId);
    if (this.activeDeckId === fileId) {
      this.activeDeckId = this.decks[0]?.file_id ?? null;
    }
    this.notify();

    if (typeof fetch !== 'function') return;
    void fetch(`${this.baseUrl}/decks/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    }).catch(() => {});
  };

  async refreshDecks(): Promise<PresentationDeck[]> {
    if (this.disposed || typeof fetch !== 'function') {
      return this.decks;
    }
    if (this.pendingRefresh) {
      return this.pendingRefresh;
    }

    const request = (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/decks`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok || this.disposed) {
          return this.decks;
        }
        const data = (await res.json().catch(() => null)) as
          | PresentationDeck[]
          | {
              decks?: PresentationDeck[];
              activeFileId?: string | null;
              active_file_id?: string | null;
            }
          | null;

        const remoteDecks = Array.isArray(data)
          ? data
          : Array.isArray(data?.decks)
            ? data.decks
            : null;

        if (!remoteDecks) {
          return this.decks;
        }

        if (remoteDecks.length > 0 || this.hasRemoteSync) {
          this.hasRemoteSync = true;
          this.decks = remoteDecks.map((remote) => {
            if (this.isStaleLocalEcho(remote)) {
              return this.getDeckById(remote.file_id) ?? remote;
            }
            return remote;
          });

          const serverActive = Array.isArray(data)
            ? null
            : (data?.activeFileId ?? data?.active_file_id ?? null);

          if (
            !this.activeDeckId ||
            !remoteDecks.some((d) => d.file_id === this.activeDeckId)
          ) {
            this.activeDeckId =
              (serverActive && remoteDecks.some((d) => d.file_id === serverActive)
                ? serverActive
                : remoteDecks[0]?.file_id) ?? null;
          }

          const nextPages: Record<string, number> = {};
          for (const deck of remoteDecks) {
            const prev = this.pageIndexByDeck[deck.file_id];
            nextPages[deck.file_id] =
              typeof prev === 'number' ? clampPageIndex(deck, prev) : 0;
          }
          this.pageIndexByDeck = nextPages;
          this.notify();
        }
        return this.decks;
      } catch {
        return this.decks;
      } finally {
        this.pendingRefresh = null;
      }
    })();

    this.pendingRefresh = request;
    return request;
  }

  connectEvents(): void {
    if (
      this.disposed ||
      this.eventSource ||
      typeof EventSource !== 'function'
    ) {
      return;
    }
    try {
      const es = new EventSource(`${this.baseUrl}/events`);
      this.eventSource = es;

      const handleDeckUpdated = (rawData?: string) => {
        if (this.disposed) return;
        if (rawData) {
          try {
            const parsed = JSON.parse(rawData) as {
              deck?: PresentationDeck;
              fileId?: string;
              file_id?: string;
            };
            if (parsed?.deck && parsed.deck.file_id) {
              this.hasRemoteSync = true;
              if (!this.isStaleLocalEcho(parsed.deck)) {
                this.applyLocalDeckUpsert(parsed.deck, false);
              }
            }
          } catch {
            // ignore malformed event payload and fall back to GET /decks
          }
        }
        void this.refreshDecks();
      };

      es.addEventListener('deck-updated', (ev) => {
        const raw = (ev as MessageEvent).data;
        handleDeckUpdated(typeof raw === 'string' ? raw : undefined);
      });

      es.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        try {
          const parsed = JSON.parse(ev.data) as { type?: string };
          if (parsed?.type === 'deck-updated') {
            handleDeckUpdated(ev.data);
          }
        } catch {
          // ignore heartbeat / non-JSON SSE frames
        }
      };

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED && this.eventSource === es) {
          this.eventSource = null;
        }
      };
    } catch {
      this.eventSource = null;
    }
  }

  async openFileFromPath(
    input: string | OpenFileFromPathRequest,
  ): Promise<PresentationDeck | null> {
    const req: OpenFileFromPathRequest =
      typeof input === 'string' ? { filePath: input } : input;
    const filePath = req.filePath?.trim();
    if (!filePath || typeof fetch !== 'function') return null;
    try {
      const res = await fetch(`${this.baseUrl}/decks/open-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath,
          file_path: filePath,
          ...(req.resourceAddress ? { resourceAddress: req.resourceAddress } : {}),
          ...(req.sessionId ? { sessionId: req.sessionId } : {}),
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json().catch(() => null)) as
        | PresentationDeck
        | { deck?: PresentationDeck }
        | null;
      const deck =
        data && 'deck' in data && data.deck
          ? data.deck
          : data && 'file_id' in data
            ? (data as PresentationDeck)
            : null;
      if (!deck) return null;
      this.hasRemoteSync = true;
      this.applyLocalDeckUpsert(deck, true);
      this.setActivePageIndex(deck.file_id, 0);
      return deck;
    } catch {
      return null;
    }
  }

  async openExternalFile(
    filePath: string,
  ): Promise<{ ok: boolean; filePath?: string; error?: string }> {
    if (!filePath || typeof fetch !== 'function') {
      return { ok: false, error: '当前环境不支持调用系统外部应用' };
    }
    try {
      const res = await fetch(`${this.baseUrl}/decks/open-external`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, file_path: filePath }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        filePath?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        return {
          ok: false,
          error: data?.error || `HTTP ${res.status}`,
        };
      }
      return {
        ok: data?.ok ?? true,
        filePath: data?.filePath ?? filePath,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async saveDeckToFile(
    fileId: string,
    filePath?: string,
  ): Promise<{ ok: boolean; filePath?: string; error?: string }> {
    if (typeof fetch !== 'function') {
      return { ok: false, error: '当前环境不支持网络保存' };
    }
    try {
      const deck = this.getDeckById(fileId);
      const res = await fetch(
        `${this.baseUrl}/decks/${encodeURIComponent(fileId)}/save-file`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath: filePath ?? deck?.file_path,
            file_path: filePath ?? deck?.file_path,
            deck,
          }),
        },
      );
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        filePath?: string;
        file_path?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        return {
          ok: false,
          error: data?.error || `HTTP ${res.status}`,
        };
      }
      return {
        ok: data?.ok ?? true,
        filePath: data?.filePath ?? data?.file_path ?? filePath ?? deck?.file_path,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (typeof fetch !== 'function') {
      return { ok: false, offline: true, error: 'fetch is unavailable' };
    }
    try {
      const res = await fetch(`${this.baseUrl}/tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          tool: name,
          args,
          arguments: args,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        return data ?? { ok: false, error: `HTTP ${res.status}` };
      }
      void this.refreshDecks();
      return data;
    } catch (err) {
      return {
        ok: false,
        offline: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async syncSelection(payload: SlideSelectionPayload): Promise<void> {
    if (this.disposed || typeof fetch !== 'function') return;
    try {
      await fetch(`${this.baseUrl}/selections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          selection: payload,
        }),
      });
    } catch {
      // graceful offline fallback
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {
        // ignore
      }
      this.eventSource = null;
    }
    this.listeners.clear();
  }
}
