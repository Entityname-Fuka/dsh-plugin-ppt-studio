import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runBuild() {
  await mkdir(path.join(appRoot, 'dist', 'core'), { recursive: true });
  await mkdir(path.join(appRoot, 'dist', 'server'), { recursive: true });
  await mkdir(path.join(appRoot, 'dist', 'client'), { recursive: true });

  // 1. 打包纯 TS 核心引擎（无 DOM/Node 专属依赖）
  await build({
    entryPoints: [path.join(appRoot, 'src', 'core', 'index.ts')],
    outfile: path.join(appRoot, 'dist', 'core', 'index.js'),
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    target: 'es2022',
    sourcemap: false,
    external: ['jszip'],
  });

  // 2. 打包 DSH Cordis 服务端插件
  await build({
    entryPoints: [path.join(appRoot, 'src', 'server', 'index.ts')],
    outfile: path.join(appRoot, 'dist', 'server', 'index.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    sourcemap: false,
    external: ['jszip'],
  });

  // 3. 打包 DSH Desktop 前端插件（外部化 react/react-dom，内联 CSS 并包裹懒加载模块注册协议）
  const cssSrc = path.join(appRoot, 'src', 'client', 'styles', 'ppt-studio.css');
  const cssDst = path.join(appRoot, 'dist', 'client', 'ppt-studio.css');
  const hasCss = await exists(cssSrc);
  const cssText = hasCss ? await readFile(cssSrc, 'utf8') : '';

  const clientBuild = await build({
    entryPoints: [path.join(appRoot, 'src', 'client', 'index.ts')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: false,
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
    define: {
      __PPT_STUDIO_CSS__: JSON.stringify(cssText),
    },
    loader: {
      '.css': 'empty',
    },
  });

  const bundledCjs = clientBuild.outputFiles?.[0]?.text ?? '';
  if (!bundledCjs) {
    throw new Error('[build-plugin] esbuild produced empty client bundle');
  }

  const wrappedClient = [
    'window.__ModuleLoader__.load({',
    '  id: "dsh-plugin-ppt-studio",',
    '  factory: (require) => {',
    '    var module = { exports: {} };',
    '    var exports = module.exports;',
    bundledCjs,
    '    return module.exports;',
    '  }',
    '});',
    '',
  ].join('\n');

  await writeFile(path.join(appRoot, 'dist', 'client', 'index.js'), wrappedClient, 'utf8');

  // 4. 复制插件样式表到 dist/client/ppt-studio.css
  if (hasCss) {
    await copyFile(cssSrc, cssDst);
  }

  // 5. 若存在 gcc 与 scripts/launcher.c，编译可复现的无黑框 Win32 启动器 dsh-ppt-studio.exe
  const launcherSrc = path.join(appRoot, 'scripts', 'launcher.c');
  const launcherExe = path.join(appRoot, 'dsh-ppt-studio.exe');
  const buildScriptPath = fileURLToPath(import.meta.url);
  if (process.platform === 'win32' && (await exists(launcherSrc))) {
    const [srcStat, scriptStat, exeStat] = await Promise.all([
      stat(launcherSrc),
      stat(buildScriptPath),
      stat(launcherExe).catch(() => null),
    ]);
    if (exeStat && exeStat.mtimeMs >= Math.max(srcStat.mtimeMs, scriptStat.mtimeMs)) {
      console.log('[build-plugin] Reusing up-to-date dsh-ppt-studio.exe');
    } else {
      const mingwGcc = 'C:\\msys64\\mingw64\\bin\\gcc.exe';
      let gccBin = (await exists(mingwGcc)) ? mingwGcc : null;
      if (!gccBin) {
        const probe = spawnSync('where', ['gcc.exe'], { encoding: 'utf8', windowsHide: true });
        if (probe.status === 0 && probe.stdout) {
          const candidate = probe.stdout.trim().split(/\r?\n/)[0]?.trim();
          if (candidate && (await exists(candidate))) {
            gccBin = candidate;
          }
        }
      }
      if (gccBin) {
        const res = spawnSync(
          gccBin,
          ['-O2', '-mwindows', '-municode', '-Wl,--no-insert-timestamp', launcherSrc, '-o', launcherExe],
          { encoding: 'utf8', windowsHide: true },
        );
        if (res.status !== 0) {
          throw new Error(
            `[build-plugin] gcc failed (${res.status}): ${res.stderr || res.stdout || 'unknown error'}`,
          );
        }
        console.log('[build-plugin] Built dsh-ppt-studio.exe (deterministic PE)');
      }
    }

    const distLauncherExe = path.join(appRoot, 'dist', 'dsh-ppt-studio.exe');
    const distPkgLauncherExe = path.join(appRoot, 'dist', 'dsh-plugin-ppt-studio.exe');
    if (await exists(launcherExe)) {
      await copyFile(launcherExe, distLauncherExe);
      await copyFile(launcherExe, distPkgLauncherExe);
      console.log('[build-plugin] Synced dist/dsh-ppt-studio.exe and dist/dsh-plugin-ppt-studio.exe');
    }
  }

  console.log('[build-plugin] Built dist/core/index.js, dist/server/index.js, dist/client/index.js');
}

runBuild().catch((err) => {
  console.error('[build-plugin] Failed:', err);
  process.exit(1);
});
