// @vitest-environment jsdom
import http from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import React, { act } from 'react';
import * as ReactDom from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import { describe, expect, it, vi } from 'vitest';
import {
  DeckEngine,
  createEmptyDeck,
  createSampleDeck,
  exportDeckToPptxBuffer,
  type PresentationDeck,
} from '../src/core/index';
import {
  PptWorkspace,
  RemoteDshClientBridge,
  apply as applyClientPlugin,
  parseDshFileResourceAddress,
  resolveTabTitle,
  type DshClientBridge,
  type RealDshClientContext,
} from '../src/client/index';
import {
  DeckRegistry,
  PPT_STUDIO_API_PREFIX,
  apply as applyServerPlugin,
  createSlideTools,
  defaultDeckRegistry,
  type DshServerContext,
  type DshWebRoute,
} from '../src/server/index';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const APP_ROOT = path.resolve(__dirname, '..');

async function httpRequest(
  port: number,
  options: {
    method: string;
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; raw: Buffer; json: () => any }> {
  const payload =
    options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body), 'utf8');
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: options.method,
        path: options.path,
        headers: {
          'sec-fetch-site': 'same-origin',
          ...(payload
            ? {
                'content-type': 'application/json; charset=utf-8',
                'content-length': String(payload.byteLength),
              }
            : {}),
          ...(options.headers ?? {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            raw,
            json: () => JSON.parse(raw.toString('utf8')),
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('Real DSH Desktop Plugin Contract Verification', () => {
  it('declares valid real DSH package.json and cordis.patch.yml manifests', async () => {
    const pkg = JSON.parse(await readFile(path.join(APP_ROOT, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('dsh-plugin-ppt-studio');
    expect(pkg.exports['.']).toBe('./dist/server/index.js');
    expect(pkg.exports['./client']).toBe('./dist/client/index.js');
    expect(pkg.exports['./package.json']).toBe('./package.json');
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml');
    expect(pkg.dsh?.client?.platform).toBe('web');
    expect(Array.isArray(pkg.dsh?.client?.inject)).toBe(true);
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-sidebar-right');
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-conversation');
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-chat');
    expect(pkg.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-ui-slots');
    expect(pkg.dsh.client.entry).toBeUndefined();

    const patchText = await readFile(path.join(APP_ROOT, 'cordis.patch.yml'), 'utf8');
    // Must be a YAML top-level array with `- insert:` referencing dsh-plugin-ppt-studio
    expect(patchText).toMatch(/^\s*-\s*insert:/m);
    expect(patchText).toMatch(/id:\s*ppt-studio/);
    expect(patchText).toMatch(/name:\s*['"]?dsh-plugin-ppt-studio['"]?/);
  });

  it('registers all 50 slide_* tools compliant with real @deepseek-ai/dsh-tools schema contract', async () => {
    const registry = new DeckRegistry({ loadSampleDeck: true });
    const tools = createSlideTools(registry);
    expect(tools.length).toBe(50);

    // Try loading real @deepseek-ai/dsh-tools validator if present on this machine
    let assertObjectJsonSchema: ((schema: unknown) => void) | null = null;
    let assertSupportedJsonSchema: ((schema: unknown) => void) | null = null;
    try {
      const dshToolsPath =
        'file:///C:/Users/ACR/.dsh/profiles/node_modules/@deepseek-ai/dsh-tools/lib/index.js';
      const mod: any = await import(/* @vite-ignore */ dshToolsPath);
      if (typeof mod.assertObjectJsonSchema === 'function') {
        assertObjectJsonSchema = mod.assertObjectJsonSchema;
      }
      if (typeof mod.assertSupportedJsonSchema === 'function') {
        assertSupportedJsonSchema = mod.assertSupportedJsonSchema;
      }
    } catch {
      // Fall back to structural checks when running on a machine without local ~/.dsh
    }

    for (const tool of tools) {
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe('object');
      expect(typeof tool.parameters.additionalProperties).toBe('boolean');
      expect(tool.output).toBeDefined();
      expect(tool.output.schema).toBeDefined();
      expect(typeof tool.output.render).toBe('function');

      if (assertObjectJsonSchema) {
        expect(() => assertObjectJsonSchema!(tool.parameters)).not.toThrow();
      }
      if (assertSupportedJsonSchema) {
        expect(() => assertSupportedJsonSchema!(tool.output.schema)).not.toThrow();
      }

      const rendered = tool.output.render({}, { ok: true, sample: 1 });
      expect(Array.isArray(rendered)).toBe(true);
      expect(rendered[0].type).toBe('text');
      expect(typeof rendered[0].text).toBe('string');
    }
  });

  it('serves /dsh-ppt-studio/api/* HTTP routes via ctx.webServer (decks, tools, selections, file roundtrip)', async () => {
    const registry = new DeckRegistry({ loadSampleDeck: true });
    const routes: DshWebRoute[] = [];
    const registeredTools = new Map<string, any>();

    const serverCtx: DshServerContext = {
      tools: {
        register: (tool) => {
          registeredTools.set(tool.name, tool);
          return () => registeredTools.delete(tool.name);
        },
      },
      webServer: {
        register: (route) => {
          routes.push(route);
          return () => {
            const idx = routes.indexOf(route);
            if (idx >= 0) routes.splice(idx, 1);
          };
        },
      },
    };

    const dispose = applyServerPlugin(serverCtx, { registry });
    expect(routes.length).toBe(1);
    expect(routes[0].kind).toBe('prefix');
    expect(routes[0].path).toBe(PPT_STUDIO_API_PREFIX);

    const apiRoute = routes[0];
    const server = http.createServer((req, res) => {
      void apiRoute.handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      // 1. GET /decks
      const listRes = await httpRequest(port, { method: 'GET', path: `${PPT_STUDIO_API_PREFIX}/decks` });
      expect(listRes.statusCode).toBe(200);
      const listJson = listRes.json();
      expect(listJson.ok).toBe(true);
      expect(listJson.decks.length).toBe(1);
      const activeFileId = listJson.activeFileId;

      // 2. POST /tool
      const toolRes = await httpRequest(port, {
        method: 'POST',
        path: `${PPT_STUDIO_API_PREFIX}/tool`,
        body: { name: 'slide_get_info', args: { file_id: activeFileId } },
      });
      expect(toolRes.statusCode).toBe(200);
      expect(toolRes.json().ok).toBe(true);
      expect(toolRes.json().result.ok).toBe(true);
      expect(toolRes.json().result.info.slides.length).toBeGreaterThan(0);

      // 3. POST /selections + GET /selections/:rangeId
      const selPayload = {
        rangeId: 'range_test_1',
        text: '第 1 页 · 1 个元素',
        timestamp: Date.now(),
        fileId: activeFileId,
        title: 'Test Deck',
        page_index: 0,
        slide_id: 'slide_0',
        selection_mode: 'free-marquee',
        shape_ids: ['s0_title'],
        shape_indices: [0],
        bbox_pt: { x: 40, y: 40, w: 300, h: 120 },
        elements: [],
        recommended_tools: ['slide_set_text'],
      };
      const postSelRes = await httpRequest(port, {
        method: 'POST',
        path: `${PPT_STUDIO_API_PREFIX}/selections`,
        body: { selection: selPayload },
      });
      expect(postSelRes.statusCode).toBe(200);

      const getSelRes = await httpRequest(port, {
        method: 'GET',
        path: `${PPT_STUDIO_API_PREFIX}/selections/range_test_1`,
      });
      expect(getSelRes.statusCode).toBe(200);
      expect(getSelRes.json().selection.rangeId).toBe('range_test_1');

      // 4. Save & Open real .pptx file roundtrip on temp disk path
      const tmpDir = await mkdtemp(path.join(tmpdir(), 'dsh-ppt-route-'));
      const pptxPath = path.join(tmpDir, 'roundtrip.pptx');
      try {
        const emptyDeck = createEmptyDeck({ file_id: 'disk_deck', file_name: 'roundtrip.pptx', title: 'Disk Test' });
        const buf = await exportDeckToPptxBuffer(emptyDeck);
        await writeFile(pptxPath, buf);

        const openFileRes = await httpRequest(port, {
          method: 'POST',
          path: `${PPT_STUDIO_API_PREFIX}/decks/open-file`,
          body: { filePath: pptxPath },
        });
        expect(openFileRes.statusCode).toBe(200);
        expect(openFileRes.json().ok).toBe(true);
        expect(openFileRes.json().deck.file_name).toBe('roundtrip.pptx');
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }

      // 5. Reject cross-site requests
      const badRes = await httpRequest(port, {
        method: 'GET',
        path: `${PPT_STUDIO_API_PREFIX}/decks`,
        headers: { 'sec-fetch-site': 'cross-site' },
      });
      expect(badRes.statusCode).toBe(403);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    dispose();
    expect(routes.length).toBe(0);
    expect(registeredTools.size).toBe(0);
  });

  it('loads built dist/client/index.js via window.__ModuleLoader__.load and wires real DSH slots', async () => {
    const bundlePath = path.join(APP_ROOT, 'dist', 'client', 'index.js');
    const code = await readFile(bundlePath, 'utf8');
    expect(code).toContain('window.__ModuleLoader__.load');
    expect(code).toContain('"dsh-plugin-ppt-studio"');

    let registeredBundle: { id: string; factory: (req: (spec: string) => any) => any } | null = null;
    (globalThis as any).window = globalThis.window ?? {};
    (window as any).__ModuleLoader__ = {
      load(reg: any) {
        registeredBundle = reg;
      },
    };

    // Execute the built lazy CJS bundle in-process
    const runBundle = new Function(code);
    runBundle();

    expect(registeredBundle).not.toBeNull();
    expect(registeredBundle!.id).toBe('dsh-plugin-ppt-studio');

    const exportsObj = registeredBundle!.factory((spec: string) => {
      if (spec === 'react') return React;
      if (spec === 'react-dom') return ReactDom;
      if (spec === 'react/jsx-runtime') return ReactJsxRuntime;
      throw new Error(`Unexpected external require: ${spec}`);
    });

    expect(exportsObj.name).toBe('dsh-plugin-ppt-studio');
    expect(exportsObj.inject).toEqual(['slots', 'sidebarRightTabs', 'sidebarRight']);
    expect(typeof exportsObj.apply).toBe('function');

    // Mount against a real-shaped DSH Client Context
    const registeredTabs: any[] = [];
    const injectedSlots: Array<{ name: string; descriptor: any; component: any }> = [];
    const openedResources: string[] = [];

    const realDshCtx = {
      sidebarRightTabs: {
        register(def: any) {
          registeredTabs.push(def);
          return () => {
            const i = registeredTabs.indexOf(def);
            if (i >= 0) registeredTabs.splice(i, 1);
          };
        },
      },
      sidebarRight: {
        openResource(address: string) {
          openedResources.push(address);
        },
        openTab() {},
      },
      slots: {
        inject(slotName: string, fn: () => any) {
          const cleanup = fn();
          return typeof cleanup === 'function' ? cleanup : () => {};
        },
        register(descriptor: any, component: any) {
          const rec = { name: descriptor.name, descriptor, component };
          injectedSlots.push(rec);
          return () => {
            const i = injectedSlots.indexOf(rec);
            if (i >= 0) injectedSlots.splice(i, 1);
          };
        },
      },
    };

    const dispose = exportsObj.apply(realDshCtx);

    // Verify style tag injected
    const styleEl = document.querySelector('style[data-plugin="dsh-plugin-ppt-studio"]');
    expect(styleEl).not.toBeNull();
    expect(styleEl!.textContent!.length).toBeGreaterThan(100);

    // Verify real SidebarRightTabDefinition
    expect(registeredTabs.length).toBe(1);
    expect(registeredTabs[0].id).toBe('dsh-plugin-ppt-studio');
    expect(registeredTabs[0].kind).toBe('ppt-studio');
    expect(registeredTabs[0].priority).toBe('extension');
    expect(registeredTabs[0].patterns).toContain('*.pptx');
    expect(registeredTabs[0].guide?.length).toBeGreaterThan(0);

    // Verify all 3 real DSH slots registered
    const slotNames = injectedSlots.map((s) => s.name);
    expect(slotNames).toContain('sidebar.right.pane.tab');
    expect(slotNames).toContain('conversation.chat.turnTail');
    expect(slotNames).toContain('conversation.input.dock');

    // Verify clean disposal
    dispose();
    expect(registeredTabs.length).toBe(0);
    expect(injectedSlots.length).toBe(0);
    expect(document.querySelector('style[data-plugin="dsh-plugin-ppt-studio"]')).toBeNull();
  });

  it('defaults loadSampleDeck to false and starts newly loaded decks at page 0 (Page 1)', async () => {
    const patchText = await readFile(path.join(APP_ROOT, 'cordis.patch.yml'), 'utf8');
    expect(patchText).toMatch(/loadSampleDeck:\s*false/);

    expect(defaultDeckRegistry.listDecks()).toHaveLength(0);
    expect(new DeckRegistry().listDecks()).toHaveLength(0);

    const routes: DshWebRoute[] = [];
    const serverCtx: DshServerContext = {
      tools: { register: () => () => {} },
      webServer: {
        register: (route) => {
          routes.push(route);
          return () => {};
        },
      },
    };
    const disposeServer = applyServerPlugin(serverCtx);
    const server = http.createServer((req, res) => {
      void routes[0].handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const listRes = await httpRequest(port, {
        method: 'GET',
        path: `${PPT_STUDIO_API_PREFIX}/decks`,
      });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().decks).toEqual([]);
      expect(listRes.json().activeFileId).toBeNull();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      disposeServer();
    }

    const sample = createSampleDeck();
    const emptyBridge = new RemoteDshClientBridge({ autoConnect: false });
    expect(emptyBridge.getDecks()).toEqual([]);
    expect(emptyBridge.getActiveDeckId()).toBeNull();
    emptyBridge.upsertDeck(sample, true);
    expect(emptyBridge.getActivePageIndex(sample.file_id)).toBe(0);
    emptyBridge.dispose();

    const seededBridge = new RemoteDshClientBridge({
      autoConnect: false,
      initialDecks: [sample],
    });
    expect(seededBridge.getActivePageIndex(sample.file_id)).toBe(0);
    seededBridge.dispose();
  });

  it('parses DSH session/absolute/file URIs, invokes useTabInfo(), resolves session cwd, and validates open-external', async () => {
    // 1. URI parsing & title resolution
    const sessionAddr =
      'dsh-resource://file/session/sess_42/slides/%E4%BA%A7%E5%93%81%20%E6%B1%87%E6%8A%A5.pptx?view=preview';
    expect(parseDshFileResourceAddress(sessionAddr)).toEqual({
      kind: 'session',
      sessionId: 'sess_42',
      filePath: 'slides/产品 汇报.pptx',
    });
    expect(resolveTabTitle(sessionAddr)).toBe('产品 汇报.pptx');

    const winAbsAddr =
      'dsh-resource://file/absolute/C%3A/Users/ACR/My%20Decks/%E6%BC%94%E7%A4%BA.pptx';
    expect(parseDshFileResourceAddress(winAbsAddr)).toEqual({
      kind: 'absolute',
      filePath: 'C:/Users/ACR/My Decks/演示.pptx',
    });
    expect(resolveTabTitle(winAbsAddr)).toBe('演示.pptx');

    const posixAbsAddr = 'dsh-resource://file/absolute/Users/alice/team%20deck.pptx';
    expect(parseDshFileResourceAddress(posixAbsAddr)).toEqual({
      kind: 'absolute',
      filePath: '/Users/alice/team deck.pptx',
    });

    const posixDoubleSlashAddr = 'dsh-resource://file/absolute//Users/alice/team%20deck.pptx';
    expect(parseDshFileResourceAddress(posixDoubleSlashAddr)).toEqual({
      kind: 'absolute',
      filePath: '/Users/alice/team deck.pptx',
    });

    expect(parseDshFileResourceAddress('file:///C:/docs/%E6%96%87%E7%A8%BF.pptx')).toEqual({
      kind: 'file-url',
      filePath: 'C:/docs/文稿.pptx',
    });

    // 2. Real DSH useTabInfo() hook & canOpen verification
    const registeredTabs: any[] = [];
    const registeredSlots: Array<{ name: string; component: React.ComponentType<any> }> = [];
    const openedPayloads: any[] = [];
    const decksList: PresentationDeck[] = [];
    let activeId: string | null = null;

    const mockBridge: DshClientBridge = {
      getDecks: () => decksList,
      getActiveDeckId: () => activeId,
      getDeckById: (id) => decksList.find((d) => d.file_id === id),
      upsertDeck: (deck, makeActive) => {
        const idx = decksList.findIndex((d) => d.file_id === deck.file_id);
        if (idx >= 0) decksList[idx] = deck;
        else decksList.push(deck);
        if (makeActive) activeId = deck.file_id;
      },
      setActiveDeckId: (id) => {
        activeId = id;
      },
      closeDeck: () => {},
      getActivePageIndex: () => 0,
      setActivePageIndex: () => {},
      getHighlightTarget: () => null,
      triggerFocusTarget: () => {},
      openFileFromPath: async (input) => {
        openedPayloads.push(input);
        const deck = createEmptyDeck({
          file_id: 'opened_via_hook',
          file_name: '产品 汇报.pptx',
          file_path: 'C:/proj/slides/产品 汇报.pptx',
        });
        decksList.push(deck);
        activeId = deck.file_id;
        return deck;
      },
    };

    const realCtx: RealDshClientContext = {
      sidebarRightTabs: {
        register: (def) => {
          registeredTabs.push(def);
          return () => {};
        },
      },
      sidebarRight: {
        openResource: () => {},
        openTab: () => {},
      },
      slots: {
        inject: (_name, fn) => {
          const cleanup = fn();
          return typeof cleanup === 'function' ? cleanup : () => {};
        },
        register: (desc, component) => {
          if (component) {
            registeredSlots.push({ name: desc.name, component });
          }
          return () => {};
        },
      },
      bridge: mockBridge,
    };

    const disposeClient = applyClientPlugin(realCtx);
    expect(registeredTabs[0].canOpen(sessionAddr)).toBe(true);
    expect(registeredTabs[0].canOpen(winAbsAddr)).toBe(true);
    expect(registeredTabs[0].canOpen(posixAbsAddr)).toBe(true);
    expect(registeredTabs[0].canOpen('dsh-resource://file/session/sess_42/notes.md')).toBe(false);
    expect(registeredTabs[0].title(sessionAddr)).toBe('产品 汇报.pptx');

    const paneSlot = registeredSlots.find((s) => s.name === 'sidebar.right.pane.tab');
    expect(paneSlot).toBeDefined();

    const mountEl = document.createElement('div');
    document.body.appendChild(mountEl);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(mountEl);
        root.render(
          React.createElement(paneSlot!.component, {
            useTabInfo: () => ({
              tab: { navigation: { address: sessionAddr } },
              panel: { id: 'right' },
            }),
          }),
        );
      });
      expect(openedPayloads).toEqual([
        {
          filePath: 'slides/产品 汇报.pptx',
          resourceAddress: sessionAddr,
          sessionId: 'sess_42',
        },
      ]);
    } finally {
      await act(async () => {
        root?.unmount();
      });
      mountEl.remove();
      disposeClient();
    }

    // 3. Server session cwd resolution on /open-file + error handling on /open-external
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'dsh-ppt-session-'));
    const subDir = path.join(tmpDir, 'slides');
    await mkdir(subDir, { recursive: true });
    const relPptx = path.join(subDir, '产品 汇报.pptx');
    const sampleBuf = await exportDeckToPptxBuffer(
      createEmptyDeck({ file_id: 'sess_deck', file_name: '产品 汇报.pptx', title: 'Session Test' }),
    );
    await writeFile(relPptx, sampleBuf);

    const routes: DshWebRoute[] = [];
    const serverCtx: DshServerContext = {
      tools: { register: () => () => {} },
      sessions: {
        get: (id: string) =>
          id === 'sess_42' ? { header: { id: 'sess_42', cwd: tmpDir } } : undefined,
      },
      webServer: {
        register: (route) => {
          routes.push(route);
          return () => {};
        },
      },
    };

    const disposeServer = applyServerPlugin(serverCtx);
    const server = http.createServer((req, res) => {
      void routes[0].handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const openSessionRes = await httpRequest(port, {
        method: 'POST',
        path: `${PPT_STUDIO_API_PREFIX}/decks/open-file`,
        body: { filePath: 'slides/产品 汇报.pptx', sessionId: 'sess_42' },
      });
      expect(openSessionRes.statusCode).toBe(200);
      expect(openSessionRes.json().ok).toBe(true);
      expect(openSessionRes.json().deck.file_path).toBe(relPptx);

      // open-external 400 for empty filePath
      const emptyExtRes = await httpRequest(port, {
        method: 'POST',
        path: `${PPT_STUDIO_API_PREFIX}/decks/open-external`,
        body: { filePath: '' },
      });
      expect(emptyExtRes.statusCode).toBe(400);

      // open-external 400 for directory instead of file
      const dirExtRes = await httpRequest(port, {
        method: 'POST',
        path: `${PPT_STUDIO_API_PREFIX}/decks/open-external`,
        body: { filePath: subDir },
      });
      expect(dirExtRes.statusCode).toBe(400);

      // open-external 404 for missing file
      const missingExtRes = await httpRequest(port, {
        method: 'POST',
        path: `${PPT_STUDIO_API_PREFIX}/decks/open-external`,
        body: { filePath: path.join(tmpDir, 'does-not-exist.pptx') },
      });
      expect(missingExtRes.statusCode).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      disposeServer();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('supports Empty Workspace, closing last tab, fullscreen slideshow portal & return page, Ctrl+Z isolation, and revert to saved', async () => {
    const mountEl = document.createElement('div');
    document.body.appendChild(mountEl);
    let root: Root | null = null;
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    try {
      // 1. Empty Workspace by default when no bridge & no initialDecks
      await act(async () => {
        root = createRoot(mountEl);
        root.render(React.createElement(PptWorkspace, {}));
      });
      expect(mountEl.querySelector('[data-testid="ppt-empty-workspace"]')).not.toBeNull();
      expect(mountEl.querySelector('[data-testid="ppt-empty-create-btn"]')).not.toBeNull();
      expect(mountEl.querySelector('[data-testid="ppt-empty-import-btn"]')).not.toBeNull();
      const loadSampleBtn = mountEl.querySelector(
        '[data-testid="ppt-empty-sample-btn"]',
      ) as HTMLButtonElement | null;
      expect(loadSampleBtn).not.toBeNull();

      // 2. Load sample deck -> starts at Page 1 (not page 6!)
      await act(async () => {
        loadSampleBtn!.click();
      });
      expect(mountEl.querySelector('[data-testid="ppt-empty-workspace"]')).toBeNull();
      expect(mountEl.textContent).toContain('第 1 页/共 12 页');

      // 3. Open Slideshow -> rendered in document.body portal, navigate 2 pages, close -> lands on Page 3
      const playBtn = mountEl.querySelector(
        'button[title="从当前页开始放映预览"]',
      ) as HTMLButtonElement | null;
      expect(playBtn).not.toBeNull();
      await act(async () => {
        playBtn!.click();
      });
      const slideshowEl = document.body.querySelector('[data-testid="ppt-slideshow-modal"]');
      expect(slideshowEl).not.toBeNull();
      expect(slideshowEl!.textContent).toContain('1 / 12');

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      });
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      });
      expect(slideshowEl!.textContent).toContain('3 / 12');

      // Toggle notes with N key and jump to End/Home
      expect(slideshowEl!.textContent).not.toContain('演讲者备注 (第');
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
      });
      expect(slideshowEl!.textContent).toContain('演讲者备注 (第 3 页)');
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
      });
      expect(slideshowEl!.textContent).toContain('12 / 12');
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      });
      expect(slideshowEl!.textContent).toContain('11 / 12');
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
      });
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      });
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      });
      expect(slideshowEl!.textContent).toContain('3 / 12');

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(document.body.querySelector('[data-testid="ppt-slideshow-modal"]')).toBeNull();
      expect(mountEl.textContent).toContain('第 3 页/共 12 页');

      // Clicking "用系统默认应用打开" on an unsaved virtual deck shows helpful toast
      const sampleExtBtn = mountEl.querySelector(
        '[data-testid="ppt-header-external-btn"]',
      ) as HTMLButtonElement | null;
      expect(sampleExtBtn).not.toBeNull();
      await act(async () => {
        sampleExtBtn!.click();
      });
      expect(mountEl.textContent).toContain('请先保存或导出为本地 .pptx 文件');

      // Unsaved virtual deck has disabled "还原到上次保存" in More menu
      const sampleMoreBtn = mountEl.querySelector(
        '[data-testid="ppt-header-more-btn"]',
      ) as HTMLButtonElement | null;
      await act(async () => {
        sampleMoreBtn!.click();
      });
      const sampleRevertBtn = mountEl.querySelector(
        '[data-testid="ppt-revert-saved-btn"]',
      ) as HTMLButtonElement | null;
      expect(sampleRevertBtn?.disabled).toBe(true);
      expect(sampleRevertBtn?.textContent).toContain('尚未保存过，无法还原');

      // 4. Close the last remaining tab -> returns cleanly to Empty Workspace
      const closeTabBtn = mountEl.querySelector('.ppt-tab-close') as HTMLButtonElement | null;
      expect(closeTabBtn).not.toBeNull();
      await act(async () => {
        closeTabBtn!.click();
      });
      expect(mountEl.querySelector('[data-testid="ppt-empty-workspace"]')).not.toBeNull();

      // 5. Permanent header Undo/Redo, Ctrl+Z isolation on AI sync, and Revert to Last Saved
      await act(async () => {
        root!.unmount();
      });

      const diskDeck = createEmptyDeck({
        file_id: 'disk_test_1',
        file_name: 'disk.pptx',
        file_path: 'C:/temp/disk.pptx',
        title: '初始保存标题',
      });
      let bridgeDecks = [diskDeck];
      let bridgeActiveId: string | null = diskDeck.file_id;
      let bridgePage = 0;
      const listeners = new Set<() => void>();
      const toastHistory: string[] = [];

      const testBridge: DshClientBridge = {
        getDecks: () => bridgeDecks,
        getActiveDeckId: () => bridgeActiveId,
        getDeckById: (id) => bridgeDecks.find((d) => d.file_id === id),
        upsertDeck: (deck) => {
          bridgeDecks = bridgeDecks.map((d) => (d.file_id === deck.file_id ? deck : d));
          listeners.forEach((fn) => fn());
        },
        setActiveDeckId: (id) => {
          bridgeActiveId = id;
          listeners.forEach((fn) => fn());
        },
        closeDeck: (id) => {
          bridgeDecks = bridgeDecks.filter((d) => d.file_id !== id);
          listeners.forEach((fn) => fn());
        },
        getActivePageIndex: () => bridgePage,
        setActivePageIndex: (_id, idx) => {
          bridgePage = idx;
          listeners.forEach((fn) => fn());
        },
        getHighlightTarget: () => null,
        triggerFocusTarget: () => {},
        subscribe: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        onToast: (msg) => toastHistory.push(msg),
        saveDeckToFile: async (_fileId, fp) => ({ ok: true, filePath: fp }),
      };

      await act(async () => {
        root = createRoot(mountEl);
        root.render(
          React.createElement(PptWorkspace, {
            ctx: {
              sidebarRightTabs: { register: () => () => {} },
              slots: { register: () => () => {} },
              bridge: testBridge,
            },
          }),
        );
      });

      const headerUndo = mountEl.querySelector(
        '[data-testid="ppt-header-undo-btn"]',
      ) as HTMLButtonElement | null;
      const headerRedo = mountEl.querySelector(
        '[data-testid="ppt-header-redo-btn"]',
      ) as HTMLButtonElement | null;
      const headerExternal = mountEl.querySelector(
        '[data-testid="ppt-header-external-btn"]',
      ) as HTMLButtonElement | null;
      expect(headerUndo).not.toBeNull();
      expect(headerRedo).not.toBeNull();
      expect(headerExternal).not.toBeNull();
      expect(headerUndo!.disabled).toBe(true);

      // Perform a manual edit (add slide via ThumbnailRail "+ 新建页面" button)
      const addSlideBtn = mountEl.querySelector('.ppt-add-slide-btn') as HTMLButtonElement | null;
      expect(addSlideBtn).not.toBeNull();
      await act(async () => {
        addSlideBtn!.click();
      });
      expect(bridgeDecks[0].slides).toHaveLength(2);
      expect(headerUndo!.disabled).toBe(false);

      // Ctrl+Z undoes manual edit, Ctrl+Y redoes it
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
      });
      expect(bridgeDecks[0].slides).toHaveLength(1);
      expect(headerRedo!.disabled).toBe(false);

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true }));
      });
      expect(bridgeDecks[0].slides).toHaveLength(2);

      // Simulate an external/AI sync update -> establishes new Manual Undo Baseline
      const aiUpdatedDeck = new DeckEngine(bridgeDecks[0]);
      aiUpdatedDeck.runTrackedAiEdit('slide_set_text', 'AI 更新标题', () =>
        aiUpdatedDeck.setText(0, 0, 'AI 新标题'),
      );
      await act(async () => {
        testBridge.upsertDeck(aiUpdatedDeck.getDeck(), false);
      });
      expect(headerUndo!.disabled).toBe(true);
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
      });
      expect(bridgeDecks[0].slides[0].elements[0].text?.content).toBe('AI 新标题');

      // Revert to Last Saved restores initial disk baseline (1 slide, original title)
      const moreBtn = mountEl.querySelector(
        '[data-testid="ppt-header-more-btn"]',
      ) as HTMLButtonElement | null;
      await act(async () => {
        moreBtn!.click();
      });
      const revertBtn = mountEl.querySelector(
        '[data-testid="ppt-revert-saved-btn"]',
      ) as HTMLButtonElement | null;
      expect(revertBtn).not.toBeNull();
      expect(revertBtn!.disabled).toBe(false);
      await act(async () => {
        revertBtn!.click();
      });
      expect(confirmSpy).toHaveBeenCalled();
      expect(bridgeDecks[0].slides).toHaveLength(1);
      expect(bridgeDecks[0].slides[0].elements[0].text?.content).toBe('初始保存标题');
    } finally {
      confirmSpy.mockRestore();
      await act(async () => {
        root?.unmount();
      });
      mountEl.remove();
    }
  });
});
