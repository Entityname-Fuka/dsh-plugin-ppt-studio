// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SAMPLE_PAGE_INDEX,
  ENGINE_DEFAULT_PORT,
  ENGINE_HEALTH_POLL_INTERVAL_MS,
  ENGINE_HEALTH_TIMEOUT_MS,
  ENGINE_LOCALAPI_TIMEOUT_MS,
  ENGINE_PORT_SCAN_LIMIT,
  ENGINE_START_RETRY_LIMIT,
  HOST_LOCALE_CHANGED_EVENT,
  HOST_THEME_CHANGED_EVENT,
  JOB_OBJECT_LIMIT_FLAGS,
  SELECTION_EVENT_CHANGED,
  SELECTION_EVENT_SEND,
  SLIDE_EXTENSION_REGEX,
  SUPERVISOR_JOB_DRAIN_POLL_MS,
  SUPERVISOR_JOB_DRAIN_TIMEOUT_MS,
  SUPERVISOR_START_HANDSHAKE,
  SUPERVISOR_TERMINATE_WAIT_MS,
  SUPPORTED_SLIDE_EXTENSIONS,
  buildSelectionPayload,
} from '../src/core/index';
import type { DocumentSelectionEvent } from '../src/core/index';
import {
  apply as applyClientPlugin,
  inject as clientInject,
  name as clientName,
} from '../src/client/index';
import type { DshClientContext } from '../src/client/index';
import {
  DeckRegistry,
  apply as applyServerPlugin,
  inject as serverInject,
  name as serverName,
} from '../src/server/index';
import type { DshServerContext, DshToolDefinition } from '../src/server/index';
import { DesktopShell } from '../src/standalone/DesktopShell';
import { MockDshHost } from '../src/standalone/mock-dsh-host';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flushAsync(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe('DSH Cordis Server & Client Plugin Integration + Three-Entry E2E', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let host: MockDshHost | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    if (host) {
      host.dispose();
      host = null;
    }
  });

  it('registers 45+ slide_* tools via Cordis server apply(ctx) and executes end-to-end tool calls & AI undo', async () => {
    expect(serverName).toBe('dsh-plugin-ppt-studio');
    expect(serverInject).toEqual(['tools']);

    const tools = new Map<string, DshToolDefinition<any, any>>();
    const registry = new DeckRegistry({ loadSampleDeck: true });
    const serverCtx: DshServerContext = {
      tools: {
        register: (tool) => {
          tools.set(tool.name, tool);
          return () => tools.delete(tool.name);
        },
        get: (n) => tools.get(n),
        list: () => Array.from(tools.values()),
      },
      logger: { info: () => {} },
    };

    const dispose = applyServerPlugin(serverCtx, { registry });
    expect(tools.size).toBeGreaterThanOrEqual(45);
    expect(tools.has('slide_query_region')).toBe(true);
    expect(tools.has('slide_resolve_selection')).toBe(true);
    expect(tools.has('slide_undo_ai_edit')).toBe(true);

    // 1. Create a gated deck and verify DESIGN.md contract enforcement
    const createRes = (await tools.get('slide_create_deck')!.execute({
      file_id: 'gated_deck',
      file_name: '门禁测试.pptx',
      require_design_md: true,
    })) as { file_id: string };
    expect(createRes.file_id).toBe('gated_deck');

    expect(() =>
      tools.get('slide_add_slide')!.execute({ file_id: 'gated_deck', title: 'Blocked' }),
    ).toThrow();

    await tools.get('slide_set_design')!.execute({
      file_id: 'gated_deck',
      design_md: '# DESIGN.md\n- 16:9 960x540pt',
    });

    const jsxRes = (await tools.get('slide_add_page_with_jsx')!.execute({
      file_id: 'gated_deck',
      jsx: '<Slide title="JSX Page"><Text shape_id="j_txt" x={45} y={45} w={300} h={40}>Hello DSH</Text></Slide>',
    })) as { page_index: number };
    expect(jsxRes.page_index).toBe(1);

    // 2. Spatial query & selection resolution on sample deck page 6 (index 5)
    const sampleDeck = registry.listDecks().find((d) => d.file_id !== 'gated_deck')!;
    const queryRes = (await tools.get('slide_query_region')!.execute({
      file_id: sampleDeck.file_id,
      page_index: DEFAULT_SAMPLE_PAGE_INDEX,
      bbox_pt: { x: 50, y: 120, w: 540, h: 310 },
    })) as { region: { elements: Array<{ shape_id: string; shape_index: number }> } };

    const chartHit = queryRes.region.elements.find((e) => e.shape_id === 's6_chart_workload');
    expect(chartHit).toBeDefined();

    const resolveRes = (await tools.get('slide_resolve_selection')!.execute({
      file_id: sampleDeck.file_id,
      selection_payload: {
        rangeId: 'range_test_1',
        page_index: DEFAULT_SAMPLE_PAGE_INDEX,
        shape_ids: ['s6_chart_workload'],
      },
    })) as { selection: { shape_indices: number[] } };
    expect(resolveRes.selection.shape_indices).toEqual([chartHit!.shape_index]);

    // 3. Mutate via tool, check recent AI edits, and undo
    await tools.get('slide_update_chart_series_style')!.execute({
      file_id: sampleDeck.file_id,
      page_index: DEFAULT_SAMPLE_PAGE_INDEX,
      shape_index: chartHit!.shape_index,
      series_index: 0,
      color: 'F59E0B',
    });

    const editsRes = (await tools.get('slide_list_recent_ai_edits')!.execute({
      file_id: sampleDeck.file_id,
      limit: 5,
    })) as { edits: Array<{ edit_id: string; tool_name: string }> };
    expect(editsRes.edits[0].tool_name).toBe('slide_update_chart_series_style');

    await tools.get('slide_undo_ai_edit')!.execute({
      file_id: sampleDeck.file_id,
      edit_id: editsRes.edits[0].edit_id,
    });
    const chartAfterUndo = registry
      .getEngine(sampleDeck.file_id)
      .getChartInfo(DEFAULT_SAMPLE_PAGE_INDEX, chartHit!.shape_index);
    expect(chartAfterUndo.series[0].color).toBe('846BFF');

    dispose();
    expect(tools.size).toBe(0);
  });

  it('registers sidebarRightTabs and 3 UI slots via Cordis client apply(ctx)', () => {
    expect(clientName).toBe('dsh-plugin-ppt-studio');
    expect(clientInject).toEqual(['slots', 'sidebarRightTabs', 'sidebarRight']);

    const tabs = new Map<string, any>();
    const slots = new Map<string, any>();
    const clientCtx: DshClientContext = {
      sidebarRightTabs: {
        register: (key, descriptor) => {
          tabs.set(key, descriptor);
          return () => tabs.delete(key);
        },
      },
      slots: {
        register: (reg) => {
          slots.set(`${reg.name}:${reg.key}`, reg);
          return () => slots.delete(`${reg.name}:${reg.key}`);
        },
      },
    };

    const dispose = applyClientPlugin(clientCtx);
    expect(tabs.has('dsh-ppt-studio')).toBe(true);
    expect(tabs.get('dsh-ppt-studio').match('report.pptx')).toBe(true);
    expect(tabs.get('dsh-ppt-studio').match('dsh-ppt://deck_1/demo.pptx')).toBe(true);
    expect(tabs.get('dsh-ppt-studio').match('notes.md')).toBe(false);

    expect(slots.has('sidebar.right.pane.tab:dsh-ppt-studio')).toBe(true);
    expect(slots.has('conversation.message.artifact:dsh-ppt-studio-artifact')).toBe(true);
    expect(slots.has('conversation.composer.context:dsh-ppt-studio-selection')).toBe(true);

    const artifactSlot = slots.get('conversation.message.artifact:dsh-ppt-studio-artifact');
    expect(artifactSlot.match({ fileName: 'deck.pptx' })).toBe(true);
    expect(artifactSlot.match({ fileName: 'image.png' })).toBe(false);

    dispose();
    expect(tabs.size).toBe(0);
    expect(slots.size).toBe(0);
  });

  it('completes full 3-entry E2E flow: artifact card -> + new tab -> free-marquee chip jump -> AI edit canvas refresh', async () => {
    host = new MockDshHost();
    expect(host.getRegisteredToolNames().length).toBeGreaterThanOrEqual(45);
    expect(host.getRegisteredSlotKeys('sidebar.right.pane.tab')).toContain('dsh-ppt-studio');

    await act(async () => {
      root = createRoot(container!);
      root.render(React.createElement(DesktopShell, { host: host! }));
    });

    // Entry 1: Collapse right sidebar, then click conversation artifact card to re-open/focus PPT workspace
    await act(async () => {
      host!.setRightSidebarOpen(false);
    });
    expect(container!.querySelector('[data-testid="dsh-ppt-workspace"]')).toBeNull();

    const artifactCard = container!.querySelector(
      '[data-testid="dsh-artifact-entry"] .dsh-artifact-card',
    ) as HTMLElement | null;
    expect(artifactCard).not.toBeNull();
    await act(async () => {
      artifactCard!.click();
    });
    expect(host.getState().rightSidebarOpen).toBe(true);
    expect(container!.querySelector('[data-testid="dsh-ppt-workspace"]')).not.toBeNull();

    // Entry 2: Click '+' in right TabStrip and create a blank 16:9 .pptx deck
    const plusBtn = container!.querySelector(
      '[data-testid="ppt-tab-add-btn"]',
    ) as HTMLButtonElement | null;
    expect(plusBtn).not.toBeNull();
    await act(async () => {
      plusBtn!.click();
    });
    const newBlankItem = Array.from(
      container!.querySelectorAll('.ppt-dropdown-item'),
    ).find((el) => el.textContent?.includes('新建空白 16:9 演示文稿')) as HTMLButtonElement | undefined;
    expect(newBlankItem).toBeDefined();
    await act(async () => {
      newBlankItem!.click();
    });
    expect(host.getState().decks).toHaveLength(2);
    expect(host.getState().decks[1].width_pt).toBe(960);
    expect(host.getState().decks[1].height_pt).toBe(540);

    // Switch back to the sample deck (first tab)
    const sampleDeck = host.getState().decks[0];
    await act(async () => {
      host!.clientCtx.bridge?.setActiveDeckId(sampleDeck.file_id);
      host!.clientCtx.bridge?.setActivePageIndex(sampleDeck.file_id, DEFAULT_SAMPLE_PAGE_INDEX);
    });

    // Entry 3: Enable Free-Marquee mode, emit docs:selectionChanged for page 6 chart, verify chip & bidirectional jump
    const marqueeToggle = container!.querySelector(
      '[data-testid="ppt-free-marquee-toggle"]',
    ) as HTMLButtonElement | null;
    expect(marqueeToggle).not.toBeNull();
    await act(async () => {
      marqueeToggle!.click();
    });
    expect(marqueeToggle!.classList.contains('is-on')).toBe(true);

    const payload = buildSelectionPayload(sampleDeck, DEFAULT_SAMPLE_PAGE_INDEX, {
      rangeId: 'e2e_s6_chart_range',
      bbox_pt: { x: 54, y: 122, w: 536, h: 304 },
      timestamp: 1760000099999,
    });
    const changedEvent: DocumentSelectionEvent = {
      documentResourceUri: `dsh-resource://file/${sampleDeck.file_name}`,
      filePath: sampleDeck.file_path,
      fileType: 'pptx',
      consumerSurface: 'office',
      sequence: host.selectionBus.nextSequence(),
      sequenceEpoch: '__legacy_epoch__',
      selection: payload,
    };

    await act(async () => {
      host!.selectionBus.emit(SELECTION_EVENT_CHANGED, changedEvent);
    });

    const chipBar = container!.querySelector('[data-testid="dsh-selection-chip-bar"]');
    expect(chipBar).not.toBeNull();
    const chip = chipBar!.querySelector('.dsh-selection-chip') as HTMLElement | null;
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('第 6 页');
    expect(chip!.textContent).toContain('自由框选');

    // Switch away to page 0, then click the selection chip to jump back to page 6 and highlight s6_chart_workload
    await act(async () => {
      host!.clientCtx.bridge?.setActivePageIndex(sampleDeck.file_id, 0);
    });
    expect(host.getState().pageIndexByDeck[sampleDeck.file_id]).toBe(0);

    await act(async () => {
      chip!.click();
    });
    expect(host.getState().pageIndexByDeck[sampleDeck.file_id]).toBe(DEFAULT_SAMPLE_PAGE_INDEX);
    expect(host.getState().highlightTarget?.shape_ids).toContain('s6_chart_workload');

    // Trigger AI precision edit via docs:selectionSend and verify live deck/canvas updates
    const sendEvent: DocumentSelectionEvent = {
      ...changedEvent,
      sequence: host.selectionBus.nextSequence(),
      selection: {
        ...payload,
        rangeId: 'e2e_s6_chart_send',
        aiPrompt: '将选中的柱状图主系列改为琥珀橙 #F59E0B',
      },
    };

    await act(async () => {
      host!.selectionBus.emit(SELECTION_EVENT_SEND, sendEvent);
    });
    await flushAsync(40);

    const updatedSample = host.getState().decks.find((d) => d.file_id === sampleDeck.file_id)!;
    const updatedChart = updatedSample.slides[DEFAULT_SAMPLE_PAGE_INDEX].elements.find(
      (e) => e.shape_id === 's6_chart_workload',
    );
    expect(updatedChart?.chart?.series[0].color).toBe('F59E0B');
    expect(container!.textContent).toContain('slide_update_chart_series_style');
  });

  it('declares valid DSH manifest (dsh.bundle + dsh.client) and executable launch entry in package.json', () => {
    const appRoot = path.resolve(__dirname, '..');
    const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as {
      exports?: Record<string, string>;
      dsh?: {
        engines?: { dsh?: string };
        bundle?: { patch?: string };
        client?: { platform?: string; inject?: string[] };
      };
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml');
    expect(pkg.dsh?.client?.platform).toBe('web');
    expect(pkg.exports?.['./client']).toBe('./dist/client/index.js');
    expect(pkg.dsh?.client?.inject).toEqual([
      '@deepseek-ai/dsh-client-ui-sidebar-right',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-chat',
    ]);
    expect(pkg.bin?.['dsh-ppt-studio']).toBe('./scripts/launch.mjs');
    expect(pkg.scripts?.start).toBe('node scripts/launch.mjs');
    expect(existsSync(path.join(appRoot, 'scripts', 'launch.mjs'))).toBe(true);
  });

  it('matches all 9 empirical presentation extensions and exports verified Ghidra/engine constants', () => {
    expect(SUPPORTED_SLIDE_EXTENSIONS).toEqual([
      '.pptx',
      '.ppt',
      '.pps',
      '.pot',
      '.pptm',
      '.ppsx',
      '.ppsm',
      '.potx',
      '.potm',
    ]);
    expect(HOST_THEME_CHANGED_EVENT).toBe('workbuddy:themeChanged');
    expect(HOST_LOCALE_CHANGED_EVENT).toBe('workbuddy:localeChanged');
    expect(ENGINE_DEFAULT_PORT).toBe(39099);
    expect(ENGINE_PORT_SCAN_LIMIT).toBe(100);
    expect(ENGINE_START_RETRY_LIMIT).toBe(5);
    expect(ENGINE_HEALTH_POLL_INTERVAL_MS).toBe(100);
    expect(ENGINE_HEALTH_TIMEOUT_MS).toBe(60000);
    expect(ENGINE_LOCALAPI_TIMEOUT_MS).toBe(10000);
    expect(SUPERVISOR_START_HANDSHAKE).toBe('{"command":"start"}');
    expect(SUPERVISOR_TERMINATE_WAIT_MS).toBe(5000);
    expect(SUPERVISOR_JOB_DRAIN_TIMEOUT_MS).toBe(1000);
    expect(SUPERVISOR_JOB_DRAIN_POLL_MS).toBe(10);
    expect(JOB_OBJECT_LIMIT_FLAGS).toBe(0x2400);

    const tabs = new Map<string, any>();
    const slots = new Map<string, any>();
    const clientCtx: DshClientContext = {
      sidebarRightTabs: {
        register: (key, descriptor) => {
          tabs.set(key, descriptor);
          return () => tabs.delete(key);
        },
      },
      slots: {
        register: (reg) => {
          slots.set(`${reg.name}:${reg.key}`, reg);
          return () => slots.delete(`${reg.name}:${reg.key}`);
        },
      },
    };

    const dispose = applyClientPlugin(clientCtx);
    const tabDesc = tabs.get('dsh-ppt-studio');
    const artifactSlot = slots.get('conversation.message.artifact:dsh-ppt-studio-artifact');

    for (const ext of SUPPORTED_SLIDE_EXTENSIONS) {
      const fileName = `deck${ext}`;
      expect(SLIDE_EXTENSION_REGEX.test(fileName)).toBe(true);
      expect(tabDesc.match(`${fileName}?readonly=1`)).toBe(true);
      expect(artifactSlot.match({ fileName })).toBe(true);
    }

    for (const other of ['doc.docx', 'sheet.xlsx', 'diagram.png', 'notes.md']) {
      expect(tabDesc.match(other)).toBe(false);
      expect(artifactSlot.match({ fileName: other })).toBe(false);
    }

    dispose();
  });
});
