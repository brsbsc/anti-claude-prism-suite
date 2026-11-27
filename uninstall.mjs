#!/usr/bin/env node
/**
 * Uninstall Prism Suite extensions, Antigravity prism-files plugin,
 * and optionally the bundled Anti-Claude runtime kernel (--with-kernel).
 *
 * Usage:
 *   node uninstall.mjs [--extensions-only | --plugin-only] [--with-kernel] [--user-dir <dir>] [--plugin-dir <dir>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  EXTENSION_FILES,
  KERNEL_USER_LAYER_FILES,
  resolveChromeBridgeTargetDir,
  resolvePluginsDir,
  resolvePrismCuaTargetDir,
  resolvePrismFilesTargetDir,
  resolveStateDirFromUserDir,
  resolveUserDir
} from './install.mjs';

const __filename = fileURLToPath(import.meta.url);
const GENERATED_EXTENSION_FILES = ['prism-suite-00-prefs.js'];

function pathsEqual(a, b) {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

function cleanUntouchedUserTemplates(resolvedUserDir, resolvedStateDir, removed) {
  const baseDir = path.join(resolvedStateDir, 'base');
  for (const fileName of KERNEL_USER_LAYER_FILES) {
    const livePath = path.join(resolvedUserDir, fileName);
    const basePath = path.join(baseDir, fileName);
    try {
      const liveLst = fs.lstatSync(livePath, { throwIfNoEntry: false });
      const baseLst = fs.lstatSync(basePath, { throwIfNoEntry: false });
      if (!liveLst || !baseLst || liveLst.isSymbolicLink() || baseLst.isSymbolicLink() || !liveLst.isFile() || !baseLst.isFile()) {
        continue;
      }
      if (fs.readFileSync(livePath, 'utf8') === fs.readFileSync(basePath, 'utf8')) {
        fs.rmSync(livePath, { force: true });
        removed.push(livePath);
      }
    } catch {}
  }
}

export function uninstallExtensions({ userDir = resolveUserDir() } = {}) {
  const targetDir = path.join(path.resolve(userDir), 'extensions');
  const removed = [];
  for (const name of [...EXTENSION_FILES, ...GENERATED_EXTENSION_FILES]) {
    const fp = path.join(targetDir, name);
    if (fs.existsSync(fp)) {
      fs.rmSync(fp, { force: true });
      removed.push(fp);
    }
  }
  return { targetDir, removed };
}

export function uninstallKernel({ userDir = resolveUserDir(), stateDir, deactivateDaemon = false } = {}) {
  const resolvedUserDir = path.resolve(userDir);
  const resolvedStateDir = stateDir ? path.resolve(stateDir) : resolveStateDirFromUserDir(resolvedUserDir);
  const runtimeDir = path.join(resolvedStateDir, 'runtime');
  const runtimeInstallScript = path.join(runtimeDir, 'install.mjs');
  const removed = [];

  let daemonDeactivateError = null;
  if (deactivateDaemon) {
    // Before runtime/install.mjs uninstall removes base/, clean untouched template files
    // when install-state.json records empty `files` (installed via Prism Suite --skip-user-layer).
    try {
      const stRaw = fs.readFileSync(path.join(resolvedStateDir, 'install-state.json'), 'utf8');
      const st = JSON.parse(stRaw);
      const filesObj = st && typeof st === 'object' ? st.files : null;
      if (filesObj && typeof filesObj === 'object' && !Array.isArray(filesObj) && Object.keys(filesObj).length === 0) {
        cleanUntouchedUserTemplates(resolvedUserDir, resolvedStateDir, removed);
      }
    } catch {}

    if (fs.existsSync(runtimeInstallScript)) {
      try {
        execFileSync(process.execPath, [runtimeInstallScript, 'uninstall'], {
          cwd: runtimeDir,
          env: {
            ...process.env,
            ANTI_CLAUDE_NO_NETWORK: '1',
            ANTI_CLAUDE_STATE_DIR: resolvedStateDir,
            ANTI_CLAUDE_USER_DIR: resolvedUserDir
          },
          timeout: 25000,
          windowsHide: true,
          stdio: 'ignore'
        });
      } catch (err) {
        daemonDeactivateError = String(err?.message || err).split('\n')[0];
      }
    }
  }

  if (!daemonDeactivateError && fs.existsSync(runtimeDir)) {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    removed.push(runtimeDir);
  }

  // In sandbox / non-daemon mode, clean untouched template user/base files we deployed
  if (!deactivateDaemon) {
    cleanUntouchedUserTemplates(resolvedUserDir, resolvedStateDir, removed);
    for (const sub of ['base', 'incoming']) {
      const subDir = path.join(resolvedStateDir, sub);
      if (fs.existsSync(subDir)) {
        fs.rmSync(subDir, { recursive: true, force: true });
      }
    }
  }

  return { stateDir: resolvedStateDir, runtimeDir, removed, daemonDeactivateError };
}

export function uninstallChromeBridge({ userDir = resolveUserDir(), stateDir } = {}) {
  const targetDir = resolveChromeBridgeTargetDir(userDir, stateDir);
  if (path.basename(targetDir).toLowerCase() !== 'chrome-bridge') {
    throw new Error(`Unsafe chrome-bridge target directory: ${targetDir}`);
  }
  const removed = [];
  const lst = fs.lstatSync(targetDir, { throwIfNoEntry: false });
  if (lst && !lst.isSymbolicLink()) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    removed.push(targetDir);
  }
  const suiteDir = path.dirname(targetDir);
  if (path.basename(suiteDir).toLowerCase() === 'prism-suite') {
    try {
      const suiteLst = fs.lstatSync(suiteDir, { throwIfNoEntry: false });
      if (suiteLst && suiteLst.isDirectory() && !suiteLst.isSymbolicLink() && fs.readdirSync(suiteDir).length === 0) {
        fs.rmSync(suiteDir, { recursive: false });
      }
    } catch {}
  }
  return { targetDir, removed };
}

export function uninstallPlugin({ pluginsDir = resolvePluginsDir() } = {}) {
  const targetDir = resolvePrismFilesTargetDir(pluginsDir);
  if (path.basename(targetDir).toLowerCase() !== 'prism-files') {
    throw new Error(`Unsafe plugin target directory: ${targetDir}`);
  }

  const removed = [];
  const filesLst = fs.lstatSync(targetDir, { throwIfNoEntry: false });
  if (filesLst && !filesLst.isSymbolicLink()) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    removed.push(targetDir);
  }

  const cuaTargetDir = resolvePrismCuaTargetDir(pluginsDir);
  const cuaRemoved = [];
  if (path.basename(cuaTargetDir).toLowerCase() === 'prism-cua') {
    const cuaLst = fs.lstatSync(cuaTargetDir, { throwIfNoEntry: false });
    if (cuaLst && !cuaLst.isSymbolicLink()) {
      fs.rmSync(cuaTargetDir, { recursive: true, force: true });
      cuaRemoved.push(cuaTargetDir);
    }
  }

  return cuaRemoved.length
    ? { targetDir, removed, cuaTargetDir, cuaRemoved }
    : { targetDir, removed };
}

export function uninstallAll({
  argv = process.argv.slice(2),
  userDir,
  pluginsDir,
  extensionsOnly,
  pluginOnly,
  withKernel,
  deactivateKernelDaemon
} = {}) {
  const onlyExt = extensionsOnly !== undefined ? Boolean(extensionsOnly) : argv.includes('--extensions-only');
  const onlyPlugin = pluginOnly !== undefined ? Boolean(pluginOnly) : argv.includes('--plugin-only');

  if (onlyExt && onlyPlugin) {
    throw new Error('Cannot combine --extensions-only and --plugin-only');
  }

  const resolvedUserDir = userDir !== undefined ? path.resolve(userDir) : resolveUserDir(argv);
  const resolvedPluginsDir = pluginsDir !== undefined ? path.resolve(pluginsDir) : resolvePluginsDir(argv);
  const removeKernel = withKernel !== undefined ? Boolean(withKernel) : argv.includes('--with-kernel');

  const extensions = onlyPlugin ? null : uninstallExtensions({ userDir: resolvedUserDir });
  const chromeBridge = onlyPlugin ? null : uninstallChromeBridge({ userDir: resolvedUserDir });
  const plugin = onlyExt ? null : uninstallPlugin({ pluginsDir: resolvedPluginsDir });

  let kernel = null;
  if (removeKernel && !onlyPlugin) {
    const defaultHostUserDir = path.join(os.homedir(), '.gemini', 'antigravity', 'anti-claude', 'user');
    const isDefaultHost = userDir === undefined && pathsEqual(resolvedUserDir, defaultHostUserDir);
    const shouldDeactivate = deactivateKernelDaemon !== undefined ? Boolean(deactivateKernelDaemon) : isDefaultHost;
    kernel = uninstallKernel({ userDir: resolvedUserDir, deactivateDaemon: shouldDeactivate });
  }

  return { extensions, chromeBridge, plugin, kernel };
}

function printHelp() {
  console.log([
    'Usage: node uninstall.mjs [options]',
    '',
    'Options:',
    '  --extensions-only    Uninstall only Prism Suite user extensions (prism-suite*.{css,js})',
    '  --plugin-only        Uninstall only Antigravity prism-files plugin',
    '  --with-kernel        Also uninstall the bundled Anti-Claude runtime kernel & background daemon',
    '  --user-dir <dir>     Override Anti-Claude user dir (default: ~/.gemini/antigravity/anti-claude/user)',
    '  --plugin-dir <dir>   Override Antigravity plugins dir (default: ~/.gemini/config/plugins)',
    '  -h, --help           Show this help message'
  ].join('\n'));
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
})();

if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const res = uninstallAll({ argv });
  if (res.extensions) {
    if (res.extensions.removed.length) {
      console.log(`[Anti-Claude Extensions] Removed from ${res.extensions.targetDir}:`);
      for (const f of res.extensions.removed) console.log(`  - ${f}`);
    } else {
      console.log(`[Anti-Claude Extensions] No Prism Suite files found in: ${res.extensions.targetDir}`);
    }
  }
  if (res.kernel) {
    if (res.kernel.daemonDeactivateError) {
      console.error(`[Bundled Anti-Claude Kernel] Failed to deactivate daemon (runtime preserved at ${res.kernel.runtimeDir} for retry): ${res.kernel.daemonDeactivateError}`);
      process.exitCode = 1;
    } else if (res.kernel.removed.length) {
      console.log(`[Bundled Anti-Claude Kernel] Removed runtime from: ${res.kernel.stateDir}`);
    } else {
      console.log(`[Bundled Anti-Claude Kernel] No bundled runtime found in: ${res.kernel.stateDir}`);
    }
  }
  if (res.chromeBridge && res.chromeBridge.removed.length) {
    console.log(`[Chrome/Edge MV3 CUA Bridge] Removed: ${res.chromeBridge.targetDir}`);
  }
  if (res.plugin) {
    if (res.plugin.removed.length) {
      console.log(`[Antigravity Plugin: prism-files] Removed: ${res.plugin.targetDir}`);
    } else {
      console.log(`[Antigravity Plugin: prism-files] Not found at: ${res.plugin.targetDir}`);
    }
    if (res.plugin.cuaRemoved?.length) {
      console.log(`[Antigravity Plugin: prism-cua] Removed: ${res.plugin.cuaTargetDir}`);
    }
  }
}
