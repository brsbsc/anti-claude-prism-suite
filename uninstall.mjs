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
  resolvePluginsDir,
  resolvePrismFilesTargetDir,
  resolveStateDirFromUserDir,
  resolveUserDir
} from './install.mjs';

const __filename = fileURLToPath(import.meta.url);
const GENERATED_EXTENSION_FILES = ['prism-suite-00-prefs.js'];

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

  if (deactivateDaemon && fs.existsSync(runtimeInstallScript)) {
    try {
      execFileSync(process.execPath, [runtimeInstallScript, 'uninstall'], {
        cwd: runtimeDir,
        env: { ...process.env, ANTI_CLAUDE_NO_NETWORK: '1' },
        timeout: 25000,
        windowsHide: true,
        stdio: 'ignore'
      });
    } catch {}
  }

  if (fs.existsSync(runtimeDir)) {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    removed.push(runtimeDir);
  }

  // In sandbox / non-daemon mode, clean untouched template user/base files we deployed
  if (!deactivateDaemon) {
    const baseDir = path.join(resolvedStateDir, 'base');
    for (const fileName of KERNEL_USER_LAYER_FILES) {
      const livePath = path.join(resolvedUserDir, fileName);
      const basePath = path.join(baseDir, fileName);
      if (fs.existsSync(livePath) && fs.existsSync(basePath)) {
        try {
          if (fs.readFileSync(livePath, 'utf8') === fs.readFileSync(basePath, 'utf8')) {
            fs.rmSync(livePath, { force: true });
            removed.push(livePath);
          }
        } catch {}
      }
    }
    for (const sub of ['base', 'incoming']) {
      const subDir = path.join(resolvedStateDir, sub);
      if (fs.existsSync(subDir)) {
        fs.rmSync(subDir, { recursive: true, force: true });
      }
    }
  }

  return { stateDir: resolvedStateDir, runtimeDir, removed };
}

export function uninstallPlugin({ pluginsDir = resolvePluginsDir() } = {}) {
  const targetDir = resolvePrismFilesTargetDir(pluginsDir);
  if (path.basename(targetDir).toLowerCase() !== 'prism-files') {
    throw new Error(`Unsafe plugin target directory: ${targetDir}`);
  }

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    return { targetDir, removed: [targetDir] };
  }
  return { targetDir, removed: [] };
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
  const plugin = onlyExt ? null : uninstallPlugin({ pluginsDir: resolvedPluginsDir });

  let kernel = null;
  if (removeKernel && !onlyPlugin) {
    const defaultHostUserDir = path.join(os.homedir(), '.gemini', 'antigravity', 'anti-claude', 'user');
    const isDefaultHost = userDir === undefined && path.resolve(resolvedUserDir) === path.resolve(defaultHostUserDir);
    const shouldDeactivate = deactivateKernelDaemon !== undefined ? Boolean(deactivateKernelDaemon) : isDefaultHost;
    kernel = uninstallKernel({ userDir: resolvedUserDir, deactivateDaemon: shouldDeactivate });
  }

  return { extensions, plugin, kernel };
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
    if (res.kernel.removed.length) {
      console.log(`[Bundled Anti-Claude Kernel] Removed runtime from: ${res.kernel.stateDir}`);
    } else {
      console.log(`[Bundled Anti-Claude Kernel] No bundled runtime found in: ${res.kernel.stateDir}`);
    }
  }
  if (res.plugin) {
    if (res.plugin.removed.length) {
      console.log(`[Antigravity Plugin: prism-files] Removed: ${res.plugin.targetDir}`);
    } else {
      console.log(`[Antigravity Plugin: prism-files] Not found at: ${res.plugin.targetDir}`);
    }
  }
}
