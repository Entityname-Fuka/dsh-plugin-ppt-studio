#!/usr/bin/env node
/**
 * DSH Plugin PPT Studio Node 启动与静默截图入口。
 *
 * 用法:
 *   node scripts/launch.mjs                        # 启动本地服务并打开 1440x900 独立应用窗
 *   node scripts/launch.mjs --screenshot shot.png  # 无头不抢焦点渲染并输出 1440x900 截图
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(APP_ROOT, 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

function parseArgs(argv) {
  let screenshotPath = null;
  let port = 0;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--screenshot' && i + 1 < argv.length) {
      screenshotPath = argv[++i];
    } else if (arg.startsWith('--screenshot=')) {
      screenshotPath = arg.slice('--screenshot='.length);
    } else if (arg === '--port' && i + 1 < argv.length) {
      port = Number(argv[++i]) || 0;
    } else if (arg.startsWith('--port=')) {
      port = Number(arg.slice('--port='.length)) || 0;
    }
  }
  return { screenshotPath, port };
}

function findChromiumBrowser() {
  const candidates = [];
  const envRoots = [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    process.env.LOCALAPPDATA,
  ].filter(Boolean);

  for (const root of envRoots) {
    candidates.push(
      path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    );
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const probeCmd = process.platform === 'win32' ? 'where' : 'which';
  const names =
    process.platform === 'win32'
      ? ['msedge.exe', 'chrome.exe']
      : ['msedge', 'google-chrome', 'chromium'];

  for (const binName of names) {
    const res = spawnSync(probeCmd, [binName], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (res.status === 0 && res.stdout) {
      const first = res.stdout.trim().split(/\r?\n/)[0]?.trim();
      if (first && existsSync(first)) {
        return first;
      }
    }
  }
  return null;
}

function startStaticServer(rootDir, port = 0) {
  const resolvedRoot = path.resolve(rootDir);

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      let relPath = decodeURIComponent(reqUrl.pathname);
      if (relPath === '/' || relPath === '') {
        relPath = '/index.html';
      }
      const targetPath = path.resolve(resolvedRoot, `.${relPath}`);
      if (
        targetPath !== resolvedRoot &&
        !targetPath.startsWith(resolvedRoot + path.sep)
      ) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      const fileStat = await stat(targetPath).catch(() => null);
      if (!fileStat || !fileStat.isFile()) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const ext = path.extname(targetPath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      const content = await readFile(targetPath);
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    } catch (err) {
      res.writeHead(500);
      res.end(err instanceof Error ? err.message : 'Internal Error');
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind local preview port'));
        return;
      }
      resolve({ server, port: addr.port });
    });
  });
}

async function captureScreenshot(browser, targetUrl, outputPath) {
  const absOutput = path.resolve(outputPath);
  await mkdir(path.dirname(absOutput), { recursive: true });
  await rm(absOutput, { force: true });

  const tmpProfile = await mkdtemp(path.join(os.tmpdir(), 'dsh_ppt_launch_'));
  try {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      `--user-data-dir=${tmpProfile}`,
      '--window-size=1440,900',
      '--virtual-time-budget=3000',
      '--hide-scrollbars',
      `--screenshot=${absOutput}`,
      targetUrl,
    ];

    const result = await new Promise((resolve) => {
      const child = spawn(browser, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {}
      }, 60000);
      child.once('error', (err) => {
        clearTimeout(timer);
        resolve({ status: null, stderr: err.message });
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve({ status: code, stderr });
      });
    });

    const outStat = await stat(absOutput).catch(() => null);
    if (!outStat || outStat.size === 0) {
      process.stderr.write(
        `[launch.mjs] 截图生成失败 (exit=${result.status}): ${absOutput}\n${result.stderr || ''}\n`,
      );
      return 1;
    }
    console.log(`[launch.mjs] 截图已保存: ${absOutput} (${outStat.size} bytes)`);
    return 0;
  } finally {
    await rm(tmpProfile, { recursive: true, force: true }).catch(() => {});
  }
}

async function openInteractiveApp(browser, targetUrl) {
  console.log(`[launch.mjs] 预览服务已启动: ${targetUrl}`);
  if (!browser) {
    console.log('[launch.mjs] 未检测到 Edge/Chrome，请手动在浏览器打开上述地址，按 Ctrl+C 退出。');
    await new Promise(() => {});
    return;
  }

  const tmpProfile = await mkdtemp(path.join(os.tmpdir(), 'dsh_ppt_app_'));
  const child = spawn(
    browser,
    [
      `--app=${targetUrl}`,
      '--window-size=1440,900',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${tmpProfile}`,
    ],
    { stdio: 'ignore' },
  );

  await new Promise((resolve) => {
    const cleanup = () => {
      try {
        child.kill();
      } catch {}
      resolve();
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
    child.once('exit', () => resolve());
  });

  await rm(tmpProfile, { recursive: true, force: true }).catch(() => {});
}

async function main() {
  const { screenshotPath, port: requestedPort } = parseArgs(process.argv.slice(2));
  const indexHtml = path.join(DIST_DIR, 'index.html');
  if (!existsSync(indexHtml)) {
    process.stderr.write(
      `[launch.mjs] 未找到构建产物 ${indexHtml}，请先执行 \`npm run build\`。\n`,
    );
    process.exit(1);
  }

  const browser = findChromiumBrowser();
  const { server, port } = await startStaticServer(DIST_DIR, requestedPort);

  try {
    if (screenshotPath) {
      if (!browser) {
        process.stderr.write(
          '[launch.mjs] 未找到可用的 Edge (msedge.exe) 或 Chrome (chrome.exe)。\n',
        );
        process.exitCode = 1;
        return;
      }
      const targetUrl = `http://127.0.0.1:${port}/?screenshot=1`;
      process.exitCode = await captureScreenshot(browser, targetUrl, screenshotPath);
      return;
    }

    const targetUrl = `http://127.0.0.1:${port}/`;
    await openInteractiveApp(browser, targetUrl);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

main().catch((err) => {
  process.stderr.write(`[launch.mjs] Fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
