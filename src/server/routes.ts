import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  exportDeckToPptxBuffer,
  importDeckFromPptxBuffer,
} from '../core/index';
import type {
  PresentationDeck,
  SlideSelectionPayload,
} from '../core/index';
import type {
  DeckRegistry,
  DshServerContext,
  DshToolDefinition,
  DshWebServerService,
} from './dsh-compat';

export const PPT_STUDIO_API_PREFIX = '/dsh-ppt-studio/api';

const MAX_JSON_BODY_BYTES = 50 * 1024 * 1024;

async function loadNodeFs(): Promise<typeof import('node:fs/promises')> {
  const specifier = 'node:fs/promises';
  return import(/* @vite-ignore */ specifier);
}

async function loadNodePath(): Promise<typeof import('node:path')> {
  const specifier = 'node:path';
  return import(/* @vite-ignore */ specifier);
}

async function loadNodeChildProcess(): Promise<typeof import('node:child_process')> {
  const specifier = 'node:child_process';
  return import(/* @vite-ignore */ specifier);
}

function getOptionalService<T = any>(
  ctx: DshServerContext,
  key: string
): T | undefined {
  try {
    if (typeof ctx.get === 'function') {
      const val = ctx.get(key);
      if (val !== undefined) return val as T;
    }
  } catch {
    // Cordis proxy throws on uninjected optional service access
  }
  try {
    return (ctx as unknown as Record<string, unknown>)[key] as T | undefined;
  } catch {
    return undefined;
  }
}

function extractCwdFromRecord(record: unknown): string | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const obj = record as Record<string, unknown>;
  const candidates = [
    obj.cwd,
    obj.workspaceRoot,
    (obj.header as Record<string, unknown> | undefined)?.cwd,
    (obj.meta as Record<string, unknown> | undefined)?.cwd,
    (obj.session as Record<string, unknown> | undefined)?.cwd,
    ((obj.session as Record<string, unknown> | undefined)?.header as
      | Record<string, unknown>
      | undefined)?.cwd,
    ((obj.agent as Record<string, unknown> | undefined)?.session as
      | Record<string, unknown>
      | undefined)?.cwd,
    (((obj.agent as Record<string, unknown> | undefined)?.session as
      | Record<string, unknown>
      | undefined)?.header as Record<string, unknown> | undefined)?.cwd,
  ];
  for (const cand of candidates) {
    if (typeof cand === 'string' && cand.trim()) {
      return cand.trim();
    }
  }
  return undefined;
}

async function resolveTargetFilePath(
  ctx: DshServerContext,
  filePath: string,
  sessionId: string | undefined,
  pathMod: typeof import('node:path')
): Promise<string> {
  const trimmed = filePath.trim();
  if (pathMod.isAbsolute(trimmed)) {
    return pathMod.resolve(trimmed);
  }

  if (sessionId && sessionId.trim()) {
    const sid = sessionId.trim();
    let sessionCwd: string | undefined;

    const sessions = getOptionalService(ctx, 'sessions');
    if (sessions) {
      try {
        if (typeof sessions.get === 'function') {
          const found = await Promise.resolve(sessions.get(sid));
          sessionCwd = extractCwdFromRecord(found);
        }
        if (!sessionCwd && typeof sessions.list === 'function') {
          const list = await Promise.resolve(sessions.list());
          if (Array.isArray(list)) {
            const match = list.find(
              (item: any) => item?.id === sid || item?.header?.id === sid
            );
            sessionCwd = extractCwdFromRecord(match);
          }
        }
      } catch {
        // ignore and continue probing other services
      }
    }

    const sessionController = getOptionalService(ctx, 'sessionController');
    if (!sessionCwd && sessionController) {
      try {
        for (const method of ['getSession', 'get', 'resolveAgent'] as const) {
          if (typeof sessionController[method] === 'function') {
            const res = await Promise.resolve(sessionController[method](sid));
            sessionCwd = extractCwdFromRecord(res);
            if (sessionCwd) break;
          }
        }
      } catch {
        // ignore
      }
    }

    const sessionQuery = getOptionalService(ctx, 'sessionQuery');
    if (!sessionCwd && sessionQuery) {
      try {
        if (typeof sessionQuery.readHeader === 'function') {
          const header = await Promise.resolve(sessionQuery.readHeader(sid));
          sessionCwd = extractCwdFromRecord(header);
        }
      } catch {
        // ignore
      }
    }

    const workspaceFiles = getOptionalService(ctx, 'workspaceFiles');
    if (workspaceFiles) {
      try {
        if (!sessionCwd && typeof workspaceFiles.getWorkspaceRoot === 'function') {
          const root = await Promise.resolve(workspaceFiles.getWorkspaceRoot(sid));
          if (typeof root === 'string' && root.trim()) {
            sessionCwd = root.trim();
          }
        }
        if (typeof workspaceFiles.resolve === 'function') {
          const resolved = await Promise.resolve(
            workspaceFiles.resolve(sid, trimmed, sessionCwd)
          );
          if (typeof resolved === 'string' && resolved.trim()) {
            return pathMod.resolve(resolved.trim());
          }
        }
        if (typeof workspaceFiles.stat === 'function') {
          const st = await Promise.resolve(
            workspaceFiles.stat(
              { sessionId: sid, ...(sessionCwd ? { workspaceRoot: sessionCwd } : {}) },
              trimmed
            )
          );
          if (typeof st?.absolutePath === 'string' && st.absolutePath.trim()) {
            return pathMod.resolve(st.absolutePath.trim());
          }
        }
      } catch {
        // ignore and fall back to resolved cwd or process.cwd()
      }
    }

    if (sessionCwd) {
      return pathMod.resolve(sessionCwd, trimmed);
    }
  }

  return pathMod.resolve(trimmed);
}

async function openFileWithOsDefaultApp(absPath: string): Promise<void> {
  const { spawn } = await loadNodeChildProcess();
  let command: string;
  let args: string[];

  if (process.platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', absPath];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [absPath];
  } else {
    command = 'xdg-open';
    args = [absPath];
  }

  await new Promise<void>((resolve, reject) => {
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      let settled = false;
      child.once('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      child.once('spawn', () => {
        if (!settled) {
          settled = true;
          child.unref();
          resolve();
        }
      });
      // Fallback settle in case spawn event is not emitted in a mock
      queueMicrotask(() => {
        if (!settled) {
          settled = true;
          try {
            child.unref?.();
          } catch {
            // ignore
          }
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

function getSingleHeader(
  headers: IncomingMessage['headers'],
  name: string
): string | undefined {
  const value = headers[name.toLowerCase()];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (
    normalized === 'localhost' ||
    normalized === '[::1]' ||
    normalized === '::1'
  ) {
    return true;
  }
  const parts = normalized.split('.');
  return (
    parts.length === 4 &&
    parts[0] === '127' &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

function isLoopbackSocketAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return true;
  const normalized = remoteAddress.toLowerCase();
  if (normalized === '::1' || normalized === '::ffff:127.0.0.1') return true;
  if (normalized.startsWith('::ffff:')) {
    return isLoopbackHostname(normalized.slice('::ffff:'.length));
  }
  return isLoopbackHostname(normalized);
}

function parseAuthority(authority: string, scheme = 'http:'): URL | undefined {
  try {
    return new URL(`${scheme}//${authority}`);
  } catch {
    return undefined;
  }
}

export function isTrustedLoopbackRequest(
  req: IncomingMessage,
  protocol: 'http:' | 'https:' = 'http:'
): boolean {
  if (!isLoopbackSocketAddress(req.socket?.remoteAddress)) {
    return false;
  }

  const host = getSingleHeader(req.headers, 'host');
  if (!host) return false;
  const hostUrl = parseAuthority(host, protocol);
  if (!hostUrl || !isLoopbackHostname(hostUrl.hostname)) {
    return false;
  }

  const secFetchSite = getSingleHeader(req.headers, 'sec-fetch-site')
    ?.trim()
    .toLowerCase();
  if (secFetchSite === 'cross-site') {
    return false;
  }

  const origin = getSingleHeader(req.headers, 'origin');
  if (!origin) return true;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') {
    return false;
  }
  if (!isLoopbackHostname(originUrl.hostname)) {
    return false;
  }
  const hostForScheme = parseAuthority(host, originUrl.protocol);
  return hostForScheme !== undefined && originUrl.host === hostForScheme.host;
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const declared = getSingleHeader(req.headers, 'content-length');
  if (declared !== undefined && Number(declared) > MAX_JSON_BODY_BYTES) {
    throw Object.assign(new Error('Request payload too large'), { status: 413 });
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.byteLength;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw Object.assign(new Error('Request payload too large'), { status: 413 });
    }
    chunks.push(buf);
  }

  const rawText = Buffer.concat(chunks).toString('utf8').trim();
  if (!rawText) return {};
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw Object.assign(new Error('Request body must be a JSON object'), {
        status: 400,
      });
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof Error && 'status' in err) throw err;
    throw Object.assign(new Error('Malformed JSON request body'), { status: 400 });
  }
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw Object.assign(new Error('Invalid URL path encoding'), { status: 400 });
  }
}

function buildContentDisposition(fileName: string): string {
  const finalName = fileName.toLowerCase().endsWith('.pptx')
    ? fileName
    : `${fileName}.pptx`;
  const asciiFallback = finalName
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_');
  const utf8Encoded = encodeURIComponent(finalName);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
}

export function registerPptStudioRoutes(
  ctx: DshServerContext,
  registry: DeckRegistry,
  toolsByName: ReadonlyMap<string, DshToolDefinition<any, any>>
): () => void {
  const sseClients = new Set<ServerResponse>();
  let unsubDeckChange: (() => void) | null = null;
  let currentWebServer: DshWebServerService | null = null;
  let currentRouteDisposer: (() => void) | null = null;
  let injectHandle: unknown = null;
  let disposed = false;

  const broadcastSse = (event: string, data: unknown): void => {
    if (sseClients.size === 0) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of Array.from(sseClients)) {
      if (client.destroyed || client.writableEnded) {
        sseClients.delete(client);
        continue;
      }
      try {
        client.write(frame);
      } catch {
        sseClients.delete(client);
        try {
          client.end();
        } catch {
          // ignore
        }
      }
    }
  };

  const closeAllSse = (): void => {
    if (unsubDeckChange) {
      unsubDeckChange();
      unsubDeckChange = null;
    }
    for (const client of Array.from(sseClients)) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    sseClients.clear();
  };

  const handleRequest = async (
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> => {
    const protocol = currentWebServer?.protocol ?? 'http:';
    if (!isTrustedLoopbackRequest(req, protocol)) {
      sendJson(res, 403, { ok: false, error: 'Forbidden' });
      return;
    }

    const method = (req.method ?? 'GET').toUpperCase();
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;
    if (
      pathname !== PPT_STUDIO_API_PREFIX &&
      !pathname.startsWith(`${PPT_STUDIO_API_PREFIX}/`)
    ) {
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }

    let subPath = pathname.slice(PPT_STUDIO_API_PREFIX.length) || '/';
    if (subPath.length > 1 && subPath.endsWith('/')) {
      subPath = subPath.slice(0, -1);
    }

    try {
      // 1. GET /dsh-ppt-studio/api/decks
      if (method === 'GET' && subPath === '/decks') {
        sendJson(res, 200, {
          ok: true,
          activeFileId: registry.getActiveFileId(),
          decks: registry.listDecks(),
        });
        return;
      }

      // 2. POST /dsh-ppt-studio/api/decks
      if (method === 'POST' && subPath === '/decks') {
        const body = await readJsonBody(req);
        const rawDeck = body.deck as PresentationDeck | undefined;
        if (
          !rawDeck ||
          typeof rawDeck !== 'object' ||
          typeof rawDeck.file_id !== 'string' ||
          !rawDeck.file_id ||
          !Array.isArray(rawDeck.slides)
        ) {
          sendJson(res, 400, {
            ok: false,
            error: 'Invalid body: expected { deck: PresentationDeck }',
          });
          return;
        }
        if (registry.hasDeck(rawDeck.file_id)) {
          registry.getEngine(rawDeck.file_id).loadDeck(rawDeck);
          registry.notifyChange(rawDeck.file_id);
        } else {
          registry.registerDeck(rawDeck);
        }
        if (body.makeActive === true) {
          registry.setActiveFileId(rawDeck.file_id);
        }
        sendJson(res, 200, {
          ok: true,
          deck: registry.getEngine(rawDeck.file_id).getDeck(),
        });
        return;
      }

      // 3. POST /dsh-ppt-studio/api/decks/open-file
      if (method === 'POST' && subPath === '/decks/open-file') {
        const body = await readJsonBody(req);
        const rawFilePath =
          typeof body.filePath === 'string'
            ? body.filePath
            : typeof body.file_path === 'string'
              ? body.file_path
              : '';
        const filePath = rawFilePath.trim();
        const sessionId =
          typeof body.sessionId === 'string' && body.sessionId.trim()
            ? body.sessionId.trim()
            : undefined;
        if (!filePath || /[\0\r\n]/.test(filePath)) {
          sendJson(res, 400, {
            ok: false,
            error: 'Invalid body: expected { filePath: string }',
          });
          return;
        }
        const [fsMod, pathMod] = await Promise.all([loadNodeFs(), loadNodePath()]);
        const absPath = await resolveTargetFilePath(ctx, filePath, sessionId, pathMod);
        let fileBuf: Buffer;
        try {
          fileBuf = await fsMod.readFile(absPath);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException)?.code;
          sendJson(res, code === 'ENOENT' ? 404 : 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        const imported = await importDeckFromPptxBuffer(new Uint8Array(fileBuf), {
          fileName: pathMod.basename(absPath),
          filePath: absPath,
        });
        const existingByPath = registry
          .listDecks()
          .find((d) => d.file_path === absPath);
        if (existingByPath && !registry.hasDeck(imported.file_id)) {
          imported.file_id = existingByPath.file_id;
        }
        if (registry.hasDeck(imported.file_id)) {
          registry.getEngine(imported.file_id).loadDeck(imported, { resetHistory: true });
          registry.notifyChange(imported.file_id);
        } else {
          registry.registerDeck(imported);
        }
        registry.setActiveFileId(imported.file_id);
        sendJson(res, 200, {
          ok: true,
          deck: registry.getEngine(imported.file_id).getDeck(),
        });
        return;
      }

      // 3b. POST /dsh-ppt-studio/api/decks/open-external
      if (method === 'POST' && subPath === '/decks/open-external') {
        const body = await readJsonBody(req);
        const rawFilePath =
          typeof body.filePath === 'string'
            ? body.filePath
            : typeof body.file_path === 'string'
              ? body.file_path
              : '';
        const filePath = rawFilePath.trim();
        const sessionId =
          typeof body.sessionId === 'string' && body.sessionId.trim()
            ? body.sessionId.trim()
            : undefined;
        if (!filePath || /[\0\r\n]/.test(filePath)) {
          sendJson(res, 400, {
            ok: false,
            error: 'Invalid body: expected { filePath: string }',
          });
          return;
        }
        const [fsMod, pathMod] = await Promise.all([loadNodeFs(), loadNodePath()]);
        const absPath = await resolveTargetFilePath(ctx, filePath, sessionId, pathMod);
        let statRes: Awaited<ReturnType<typeof fsMod.stat>>;
        try {
          statRes = await fsMod.stat(absPath);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException)?.code;
          sendJson(res, code === 'ENOENT' || code === 'ENOTDIR' ? 404 : 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        if (!statRes.isFile()) {
          sendJson(res, 400, {
            ok: false,
            error: `Target path is not a file: ${absPath}`,
          });
          return;
        }
        await openFileWithOsDefaultApp(absPath);
        sendJson(res, 200, {
          ok: true,
          filePath: absPath,
        });
        return;
      }

      // 4. POST /dsh-ppt-studio/api/decks/:fileId/save-file
      const saveMatch = subPath.match(/^\/decks\/([^/]+)\/save-file$/);
      if (method === 'POST' && saveMatch) {
        const fileId = decodeSegment(saveMatch[1]);
        if (!registry.hasDeck(fileId)) {
          sendJson(res, 404, {
            ok: false,
            error: `Deck "${fileId}" not found`,
          });
          return;
        }
        const body = await readJsonBody(req);
        const engine = registry.getEngine(fileId);
        const deck = engine.getDeck();
        const rawPath =
          typeof body.filePath === 'string' && body.filePath.trim()
            ? body.filePath.trim()
            : deck.file_path;
        if (!rawPath) {
          sendJson(res, 400, { ok: false, error: 'Missing target filePath' });
          return;
        }
        const [fsMod, pathMod] = await Promise.all([loadNodeFs(), loadNodePath()]);
        const absPath = pathMod.resolve(rawPath);
        await fsMod.mkdir(pathMod.dirname(absPath), { recursive: true });
        const buffer = await exportDeckToPptxBuffer(deck);
        await fsMod.writeFile(absPath, buffer);
        engine.getDeckRef().file_path = absPath;
        sendJson(res, 200, {
          ok: true,
          filePath: absPath,
          bytes: buffer.byteLength,
        });
        return;
      }

      // 5. GET /dsh-ppt-studio/api/decks/:fileId/export
      const exportMatch = subPath.match(/^\/decks\/([^/]+)\/export$/);
      if (method === 'GET' && exportMatch) {
        const fileId = decodeSegment(exportMatch[1]);
        if (!registry.hasDeck(fileId)) {
          sendJson(res, 404, {
            ok: false,
            error: `Deck "${fileId}" not found`,
          });
          return;
        }
        const deck = registry.getEngine(fileId).getDeck();
        const buffer = await exportDeckToPptxBuffer(deck);
        res.writeHead(200, {
          'content-type':
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'content-length': String(buffer.byteLength),
          'content-disposition': buildContentDisposition(deck.file_name),
          'cache-control': 'no-store',
        });
        res.end(Buffer.from(buffer));
        return;
      }

      // 6 & 7. GET/DELETE /dsh-ppt-studio/api/decks/:fileId
      const deckMatch = subPath.match(/^\/decks\/([^/]+)$/);
      if (deckMatch) {
        const fileId = decodeSegment(deckMatch[1]);
        if (method === 'GET') {
          if (!registry.hasDeck(fileId)) {
            sendJson(res, 404, {
              ok: false,
              error: `Deck "${fileId}" not found`,
            });
            return;
          }
          sendJson(res, 200, {
            ok: true,
            deck: registry.getEngine(fileId).getDeck(),
          });
          return;
        }
        if (method === 'DELETE') {
          const removed = registry.removeDeck(fileId);
          sendJson(res, 200, {
            ok: true,
            removed,
            activeFileId: registry.getActiveFileId(),
          });
          return;
        }
      }

      // 8. POST /dsh-ppt-studio/api/tool
      if (method === 'POST' && subPath === '/tool') {
        const body = await readJsonBody(req);
        const toolName = typeof body.name === 'string' ? body.name.trim() : '';
        if (!toolName) {
          sendJson(res, 400, {
            ok: false,
            error: 'Invalid body: expected { name: string, args?: object }',
          });
          return;
        }
        const tool = toolsByName.get(toolName) ?? ctx.tools?.get?.(toolName);
        if (!tool) {
          sendJson(res, 404, {
            ok: false,
            error: `Tool "${toolName}" is not registered`,
          });
          return;
        }
        const toolArgs =
          body.args && typeof body.args === 'object' && !Array.isArray(body.args)
            ? (body.args as Record<string, unknown>)
            : {};
        const result = await tool.execute(toolArgs);
        sendJson(res, 200, { ok: true, result });
        return;
      }

      // 8b. GET /dsh-ppt-studio/api/asset?path=...&deckId=...
      // 把本地图片文件代理成 HTTP 资源，供插件页面 <img> 显示。
      // 支持：绝对路径(path)、或相对某 deck 目录的路径(deckId + 相对 path)。
      if (method === 'GET' && subPath === '/asset') {
        const rawPath = (url.searchParams.get('path') ?? '').trim();
        const deckId = (url.searchParams.get('deckId') ?? '').trim();
        if (!rawPath || /[\0]/.test(rawPath)) {
          sendJson(res, 400, { ok: false, error: 'Missing path' });
          return;
        }
        const [fsMod, pathMod] = await Promise.all([loadNodeFs(), loadNodePath()]);
        let targetPath = rawPath;
        if (!pathMod.isAbsolute(targetPath)) {
          const deck = deckId ? registry.getEngine(deckId).getDeck() : undefined;
          const deckDir = deck?.file_path
            ? pathMod.dirname(deck.file_path)
            : undefined;
          if (deckDir) {
            targetPath = pathMod.resolve(deckDir, targetPath);
          } else {
            // 无 deck 目录可参考时，尝试用现有解析器（含会话 cwd）
            try {
              targetPath = await resolveTargetFilePath(ctx, targetPath, undefined, pathMod);
            } catch {
              /* keep as-is */
            }
          }
        } else {
          targetPath = pathMod.resolve(targetPath);
        }
        let buf: Buffer;
        try {
          buf = await fsMod.readFile(targetPath);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException)?.code;
          sendJson(res, code === 'ENOENT' ? 404 : 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        const ext = pathMod.extname(targetPath).toLowerCase();
        const mime =
          ext === '.png'
            ? 'image/png'
            : ext === '.jpg' || ext === '.jpeg'
              ? 'image/jpeg'
              : ext === '.gif'
                ? 'image/gif'
                : ext === '.webp'
                  ? 'image/webp'
                  : ext === '.svg'
                    ? 'image/svg+xml'
                    : ext === '.bmp'
                      ? 'image/bmp'
                      : 'application/octet-stream';
        res.writeHead(200, {
          'content-type': mime,
          'content-length': String(buf.byteLength),
          'cache-control': 'no-store',
        });
        res.end(buf);
        return;
      }

      // 9. POST /dsh-ppt-studio/api/selections
      if (method === 'POST' && subPath === '/selections') {
        const body = await readJsonBody(req);
        const selection = body.selection as SlideSelectionPayload | undefined;
        if (
          !selection ||
          typeof selection !== 'object' ||
          typeof selection.rangeId !== 'string' ||
          !selection.rangeId
        ) {
          sendJson(res, 400, {
            ok: false,
            error: 'Invalid body: expected { selection: SlideSelectionPayload }',
          });
          return;
        }
        registry.recordSelection(selection);
        broadcastSse('selection-updated', {
          rangeId: selection.rangeId,
          selection,
        });
        sendJson(res, 200, { ok: true, rangeId: selection.rangeId });
        return;
      }

      // 10. GET /dsh-ppt-studio/api/selections/:rangeId
      const selectionMatch = subPath.match(/^\/selections\/([^/]+)$/);
      if (method === 'GET' && selectionMatch) {
        const rangeId = decodeSegment(selectionMatch[1]);
        const selection = registry.getRecordedSelection(rangeId);
        if (!selection) {
          sendJson(res, 404, {
            ok: false,
            error: `Selection "${rangeId}" not found`,
          });
          return;
        }
        sendJson(res, 200, { ok: true, selection });
        return;
      }

      // 11. GET /dsh-ppt-studio/api/events
      if (method === 'GET' && subPath === '/events') {
        if (!unsubDeckChange) {
          unsubDeckChange = registry.onDeckChange((fileId, deck) => {
            broadcastSse('deck-updated', { fileId, deck });
          });
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        res.flushHeaders?.();
        res.write(': connected\n\n');
        sseClients.add(res);

        const cleanupClient = () => {
          sseClients.delete(res);
        };
        req.once('close', cleanupClient);
        res.once('close', cleanupClient);
        res.once('error', cleanupClient);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (err) {
      const status =
        typeof (err as { status?: unknown })?.status === 'number'
          ? (err as { status: number }).status
          : 400;
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        sendJson(res, status, { ok: false, error: message });
      } else if (!res.destroyed && !res.writableEnded) {
        res.end();
      }
    }
  };

  const unmountWebServer = (): void => {
    closeAllSse();
    if (currentRouteDisposer) {
      try {
        currentRouteDisposer();
      } catch {
        // ignore
      }
      currentRouteDisposer = null;
    }
    currentWebServer = null;
  };

  const mountOnWebServer = (ws: DshWebServerService): void => {
    if (disposed) return;
    if (currentWebServer === ws && currentRouteDisposer) return;
    unmountWebServer();
    currentWebServer = ws;
    unsubDeckChange = registry.onDeckChange((fileId, deck) => {
      broadcastSse('deck-updated', { fileId, deck });
    });
    currentRouteDisposer = ws.register({
      kind: 'prefix',
      path: PPT_STUDIO_API_PREFIX,
      handler: handleRequest,
    });
  };

  const immediateWebServer: DshWebServerService | undefined =
    typeof ctx.get === 'function'
      ? (ctx.get('webServer') as DshWebServerService | undefined)
      : ctx.webServer;
  if (immediateWebServer) {
    mountOnWebServer(immediateWebServer);
  }

  if (typeof ctx.inject === 'function') {
    injectHandle = ctx.inject(['webServer'], (webCtx: DshServerContext) => {
      if (disposed) return;
      const ws: DshWebServerService | undefined =
        webCtx.webServer ??
        (typeof webCtx.get === 'function'
          ? (webCtx.get('webServer') as DshWebServerService | undefined)
          : undefined);
      if (!ws) return;
      mountOnWebServer(ws);
      const cleanup = () => {
        if (currentWebServer === ws) {
          unmountWebServer();
        }
      };
      if (typeof webCtx.effect === 'function') {
        webCtx.effect(() => cleanup, 'dsh-plugin-ppt-studio: routes');
        return;
      }
      return cleanup;
    });
  }

  return () => {
    if (disposed) return;
    disposed = true;
    unmountWebServer();
    if (typeof injectHandle === 'function') {
      (injectHandle as () => void)();
    } else if (
      injectHandle &&
      typeof (injectHandle as { dispose?: () => void }).dispose === 'function'
    ) {
      (injectHandle as { dispose: () => void }).dispose();
    }
    injectHandle = null;
  };
}
