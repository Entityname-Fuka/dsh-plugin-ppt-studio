import {
  SELECTION_DEFAULT_SEQUENCE_EPOCH,
  SELECTION_EVENT_CHANGED,
  SELECTION_EVENT_SEND,
  SELECTION_SENT_DEDUP_CACHE_MAX,
  SELECTION_WAKEUP_MAX_RETRIES,
  SELECTION_WAKEUP_RETRY_INTERVAL_MS,
} from '../core/constants';
import {
  createDocumentSelectionContextBlock,
  getDocumentSelectionBlockKey,
  renderTencentDocsSelectionPrompt,
  syncDocumentSelectionContextBlock,
} from '../core/context-index';
import type {
  DocumentSelectionContextBlock,
  DocumentSelectionEvent,
} from '../core/types';
import type { PendingSelectionWakeup } from './dsh-types';

export type SelectionSendHandler = (payload: {
  prompt: string;
  blocks: DocumentSelectionContextBlock[];
  event: DocumentSelectionEvent;
  _meta: { fileViewerTriggerSource: string };
}) => void;

export class SelectionBus {
  private blocks: DocumentSelectionContextBlock[] = [];
  private dismissedKeys = new Set<string>();
  private sentDedupCache: string[] = [];
  private sentDedupSet = new Set<string>();
  private wakeupQueue: PendingSelectionWakeup[] = [];
  private wakeupTimer: ReturnType<typeof setTimeout> | null = null;
  private sendHandler: SelectionSendHandler | null = null;
  private listeners = new Set<() => void>();
  private sequenceCounter = 1;
  private eventListeners = new Map<string, Set<(payload: unknown) => void>>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    for (const fn of this.listeners) {
      fn();
    }
  }

  on(eventName: string, handler: (payload: unknown) => void): () => void {
    let set = this.eventListeners.get(eventName);
    if (!set) {
      set = new Set();
      this.eventListeners.set(eventName, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  emit(eventName: string, payload: unknown): void {
    const set = this.eventListeners.get(eventName);
    if (set) {
      for (const fn of set) {
        fn(payload);
      }
    }
    if (eventName === SELECTION_EVENT_CHANGED && payload && typeof payload === 'object') {
      this.handleSelectionChanged(payload as DocumentSelectionEvent);
    } else if (eventName === SELECTION_EVENT_SEND && payload && typeof payload === 'object') {
      this.handleSelectionSend(payload as DocumentSelectionEvent);
    }
  }

  nextSequence(): number {
    return this.sequenceCounter++;
  }

  getBlocks(): DocumentSelectionContextBlock[] {
    return this.blocks;
  }

  registerSendHandler(handler: SelectionSendHandler | null): void {
    this.sendHandler = handler;
    if (handler && this.wakeupQueue.length > 0) {
      this.flushWakeupQueue();
    }
  }

  handleSelectionChanged(event: DocumentSelectionEvent): DocumentSelectionContextBlock | null {
    const key = getDocumentSelectionBlockKey({
      documentResourceUri: event.documentResourceUri,
      rangeId: event.selection.rangeId,
      sequenceEpoch: event.sequenceEpoch || SELECTION_DEFAULT_SEQUENCE_EPOCH,
      sequence: event.sequence,
    });

    if (this.dismissedKeys.has(key)) {
      return null;
    }

    const pairId = event.selection.aiPrompt
      ? `pair_${event.selection.rangeId}`
      : undefined;

    this.blocks = syncDocumentSelectionContextBlock(this.blocks, event, {
      replaceExistingDocumentSelection: true,
      selectionPairId: pairId,
      selectionAutoPrompt: Boolean(event.selection.aiPrompt),
    });

    const latest = this.blocks[this.blocks.length - 1] ?? null;
    this.notify();
    return latest;
  }

  handleSelectionSend(event: DocumentSelectionEvent): void {
    const key = getDocumentSelectionBlockKey({
      documentResourceUri: event.documentResourceUri,
      rangeId: event.selection.rangeId,
      sequenceEpoch: event.sequenceEpoch || SELECTION_DEFAULT_SEQUENCE_EPOCH,
      sequence: event.sequence,
    });

    if (this.sentDedupSet.has(key)) {
      return;
    }

    if (this.sendHandler) {
      this.dispatchSend(event, key);
      return;
    }

    this.wakeupQueue.push({
      id: key,
      event,
      retries: 0,
      createdAt: Date.now(),
    });
    this.scheduleWakeupRetry();
  }

  private scheduleWakeupRetry(): void {
    if (this.wakeupTimer !== null) return;
    this.wakeupTimer = setTimeout(() => {
      this.wakeupTimer = null;
      this.flushWakeupQueue();
    }, SELECTION_WAKEUP_RETRY_INTERVAL_MS);
  }

  private flushWakeupQueue(): void {
    if (this.wakeupQueue.length === 0) return;

    if (!this.sendHandler) {
      const remaining: PendingSelectionWakeup[] = [];
      for (const item of this.wakeupQueue) {
        if (item.retries + 1 < SELECTION_WAKEUP_MAX_RETRIES) {
          remaining.push({ ...item, retries: item.retries + 1 });
        }
      }
      this.wakeupQueue = remaining;
      if (this.wakeupQueue.length > 0) {
        this.scheduleWakeupRetry();
      }
      return;
    }

    const items = [...this.wakeupQueue];
    this.wakeupQueue = [];
    for (const item of items) {
      if (!this.sentDedupSet.has(item.id)) {
        this.dispatchSend(item.event, item.id);
      }
    }
  }

  private dispatchSend(event: DocumentSelectionEvent, key: string): void {
    if (!this.sendHandler) return;
    this.recordSentKey(key);
    const block = createDocumentSelectionContextBlock(event, {
      selectionAutoPrompt: Boolean(event.selection.aiPrompt),
    });
    const prompt = event.selection.aiPrompt?.trim() || '请基于该幻灯片选区内容进行分析或优化。';
    this.sendHandler({
      prompt,
      blocks: [block],
      event,
      _meta: { fileViewerTriggerSource: 'keyboard_shortcut' },
    });
  }

  private recordSentKey(key: string): void {
    if (this.sentDedupSet.has(key)) return;
    this.sentDedupSet.add(key);
    this.sentDedupCache.push(key);
    if (this.sentDedupCache.length > SELECTION_SENT_DEDUP_CACHE_MAX) {
      const evicted = this.sentDedupCache.shift();
      if (evicted) this.sentDedupSet.delete(evicted);
    }
  }

  dismissBlock(block: DocumentSelectionContextBlock): void {
    const key = getDocumentSelectionBlockKey(block);
    this.dismissedKeys.add(key);
    this.blocks = this.blocks.filter(
      (b) => getDocumentSelectionBlockKey(b) !== key && b._meta.rangeId !== block._meta.rangeId,
    );
    this.notify();
  }

  clearBlocks(): void {
    if (this.blocks.length === 0) return;
    this.blocks = [];
    this.notify();
  }

  serializeBlocksForPrompt(userMessage: string, extraBlocks?: DocumentSelectionContextBlock[]): string {
    const active = extraBlocks ?? this.blocks;
    return renderTencentDocsSelectionPrompt(active, userMessage);
  }
}

export const defaultSelectionBus = new SelectionBus();
