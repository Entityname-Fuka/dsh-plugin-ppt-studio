// @vitest-environment node
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PPT_STUDIO_API_PREFIX, registerPptStudioRoutes } from '../src/server/routes';
import { resolveImageSrc } from '../src/client/components/SlideRenderer';

// 最小合法 1x1 PNG 字节
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

interface Fixture {
  dir: string;
  absImage: string;
  deckPath: string;
  server: http.Server;
  base: string;
}

let fx: Fixture;

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ppt-asset-'));
  const absImage = path.join(dir, 'abs.png');
  writeFileSync(absImage, Buffer.from(PNG_B64, 'base64'));
  mkdirSync(path.join(dir, 'figs'));
  writeFileSync(path.join(dir, 'figs', 'rel.png'), Buffer.from(PNG_B64, 'base64'));
  const deckPath = path.join(dir, 'deck.pptx');

  let handler: ((req: http.IncomingMessage, res: http.ServerResponse) => void) | null =
    null;
  const fakeWebServer = {
    protocol: 'http:',
    register: (cfg: { handler: typeof handler }) => {
      handler = cfg.handler;
      return () => {};
    },
  };
  const fakeCtx = {
    get: (k: string) => (k === 'webServer' ? fakeWebServer : undefined),
    webServer: fakeWebServer,
    inject: () => () => {},
  } as any;
  const fakeRegistry = {
    onDeckChange: () => () => {},
    listDecks: () => [],
    getActiveFileId: () => null,
    setActiveFileId: () => {},
    hasDeck: () => true,
    registerDeck: () => {},
    removeDeck: () => false,
    recordSelection: () => {},
    getRecordedSelection: () => undefined,
    getEngine: (id: string) => ({
      getDeck: () => ({ file_id: id, file_path: deckPath, slides: [] }),
    }),
  } as any;

  registerPptStudioRoutes(fakeCtx, fakeRegistry, new Map());

  const server = http.createServer((req, res) => handler!(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  fx = { dir, absImage, deckPath, server, base: `http://127.0.0.1:${addr.port}` };
});

afterAll(() => {
  fx.server?.close();
  try {
    rmSync(fx.dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function fetchAsset(query: string): Promise<{ status: number; ct?: string; buf: Buffer }> {
  return new Promise((resolve, reject) => {
    http
      .get(`${fx.base}${PPT_STUDIO_API_PREFIX}/asset?${query}`, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            ct: res.headers['content-type'] as string | undefined,
            buf: Buffer.concat(chunks),
          }),
        );
      })
      .on('error', reject);
  });
}

describe('image asset endpoint', () => {
  it('serves an absolute-path image as image/png bytes', async () => {
    const r = await fetchAsset(`path=${encodeURIComponent(fx.absImage)}`);
    expect(r.status).toBe(200);
    expect(r.ct).toBe('image/png');
    expect(r.buf.slice(0, 4).toString('hex')).toBe('89504e47');
  });

  it('resolves a relative path against the deck directory', async () => {
    const r = await fetchAsset(`path=${encodeURIComponent('figs/rel.png')}&deckId=d1`);
    expect(r.status).toBe(200);
    expect(r.buf.length).toBeGreaterThan(0);
  });

  it('404s for a missing file', async () => {
    const r = await fetchAsset(`path=${encodeURIComponent('/no/such/file.png')}`);
    expect(r.status).toBe(404);
  });
});

describe('resolveImageSrc', () => {
  it('passes through remote/data/file URLs', () => {
    expect(resolveImageSrc('https://x/a.png')).toBe('https://x/a.png');
    expect(resolveImageSrc('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
    expect(resolveImageSrc('file:///a.png')).toBe('file:///a.png');
  });

  it('routes local paths through the asset endpoint with deckId', () => {
    const abs = resolveImageSrc('/Users/a/fig.png', { deckId: 'd1' });
    expect(abs.startsWith(`${PPT_STUDIO_API_PREFIX}/asset?`)).toBe(true);
    expect(abs).toContain('deckId=d1');
    expect(abs).toContain(encodeURIComponent('/Users/a/fig.png'));

    const rel = resolveImageSrc('./figs/a.png', { deckId: 'd2' });
    expect(rel).toContain(`path=${encodeURIComponent('./figs/a.png')}`);
  });

  it('returns empty for empty src', () => {
    expect(resolveImageSrc('')).toBe('');
    expect(resolveImageSrc(undefined)).toBe('');
  });
});
