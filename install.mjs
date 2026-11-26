#!/usr/bin/env node
/**
 * Install Prism Suite extensions and/or Antigravity prism-files plugin.
 *
 * Usage:
 *   node install.mjs [--extensions-only | --plugin-only] [--user-dir <dir>] [--plugin-dir <dir>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db']);

function readArgValue(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < argv.length && argv[idx + 1]) {
    return argv[idx + 1];
  }
  const prefix = `${flag}=`;
  const eqArg = argv.find((arg) => arg.startsWith(prefix));
  if (eqArg) {
    const val = eqArg.slice(prefix.length);
    if (val) return val;
  }
  return null;
}

export function resolveUserDir(argv = process.argv.slice(2)) {
  const flagVal = readArgValue(argv, '--user-dir');
  if (flagVal) {
    return path.resolve(flagVal);
  }
  if (process.env.ANTI_CLAUDE_USER_DIR) {
    return path.resolve(process.env.ANTI_CLAUDE_USER_DIR);
  }
  const stateDir = process.env.ANTI_CLAUDE_STATE_DIR || path.join(os.homedir(), '.gemini', 'antigravity', 'anti-claude');
  return path.join(path.resolve(stateDir), 'user');
}

export function resolvePluginsDir(argv = process.argv.slice(2)) {
  const flagVal = readArgValue(argv, '--plugin-dir');
  if (flagVal) {
    return path.resolve(flagVal);
  }
  if (process.env.ANTIGRAVITY_PLUGINS_DIR) {
    return path.resolve(process.env.ANTIGRAVITY_PLUGINS_DIR);
  }
  return path.join(os.homedir(), '.gemini', 'config', 'plugins');
}

export const EXTENSION_FILES = [
  'prism-suite.css',
  'prism-suite.js',
  'prism-suite-fx.css',
  'prism-suite-fx.js',
  'prism-suite-workflow.css',
  'prism-suite-workflow.js'
];

export function installExtensions({ userDir = resolveUserDir(), srcDir = path.join(__dirname, 'extensions') } = {}) {
  const targetDir = path.join(path.resolve(userDir), 'extensions');
  fs.mkdirSync(targetDir, { recursive: true });
  const installed = [];
  for (const name of EXTENSION_FILES) {
    const src = path.join(srcDir, name);
    const dest = path.join(targetDir, name);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing source extension file: ${src}`);
    }
    fs.copyFileSync(src, dest);
    installed.push(dest);
  }
  return { targetDir, installed };
}

function copyFileInPlace(srcPath, destPath) {
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.prism-inst-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  try {
    fs.copyFileSync(srcPath, tmpPath);
    fs.renameSync(tmpPath, destPath);
  } catch (err) {
    try { fs.rmSync(tmpPath, { force: true }); } catch {}
    if (err && (err.code === 'EXDEV' || err.code === 'EPERM' || err.code === 'EBUSY')) {
      fs.copyFileSync(srcPath, destPath);
      return;
    }
    throw err;
  }
}

/**
 * Sync srcDir into destDir in-place WITHOUT deleting destDir itself,
 * preserving directory inodes so running MCP Server processes never lose cwd.
 */
function syncDirInPlace(srcDir, destDir, installed) {
  fs.mkdirSync(destDir, { recursive: true });
  const srcEntries = fs.readdirSync(srcDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const wantedNames = new Set();
  for (const entry of srcEntries) {
    if (!IGNORED_NAMES.has(entry.name)) {
      wantedNames.add(entry.name);
    }
  }

  for (const existing of fs.readdirSync(destDir, { withFileTypes: true })) {
    if (!wantedNames.has(existing.name)) {
      fs.rmSync(path.join(destDir, existing.name), { recursive: true, force: true });
    }
  }

  for (const entry of srcEntries) {
    if (IGNORED_NAMES.has(entry.name)) continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      if (fs.existsSync(destPath) && !fs.statSync(destPath).isDirectory()) {
        fs.rmSync(destPath, { force: true });
      }
      syncDirInPlace(srcPath, destPath, installed);
    } else if (entry.isFile()) {
      if (fs.existsSync(destPath) && fs.statSync(destPath).isDirectory()) {
        fs.rmSync(destPath, { recursive: true, force: true });
      }
      copyFileInPlace(srcPath, destPath);
      installed.push(destPath);
    }
  }
}

export function resolvePrismFilesTargetDir(pluginsDir) {
  const resolvedPluginsDir = path.resolve(pluginsDir);
  if (path.basename(resolvedPluginsDir).toLowerCase() === 'prism-files') {
    return resolvedPluginsDir;
  }
  return path.join(resolvedPluginsDir, 'prism-files');
}

export function installPlugin({ pluginsDir = resolvePluginsDir(), srcDir = path.join(__dirname, 'plugin') } = {}) {
  const resolvedSrc = path.resolve(srcDir);
  if (!fs.existsSync(resolvedSrc) || !fs.statSync(resolvedSrc).isDirectory()) {
    throw new Error(`Missing source plugin directory: ${resolvedSrc}`);
  }

  const targetDir = resolvePrismFilesTargetDir(pluginsDir);
  if (path.basename(targetDir).toLowerCase() !== 'prism-files') {
    throw new Error(`Unsafe plugin target directory: ${targetDir}`);
  }
  if (resolvedSrc === path.resolve(targetDir)) {
    throw new Error(`Source and target plugin directories are identical: ${targetDir}`);
  }

  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  const installed = [];
  syncDirInPlace(resolvedSrc, targetDir, installed);
  return { targetDir, installed };
}

export function installAll({
  argv = process.argv.slice(2),
  userDir,
  pluginsDir,
  extensionsSrcDir = path.join(__dirname, 'extensions'),
  pluginSrcDir = path.join(__dirname, 'plugin'),
  extensionsOnly,
  pluginOnly
} = {}) {
  const onlyExt = extensionsOnly !== undefined ? Boolean(extensionsOnly) : argv.includes('--extensions-only');
  const onlyPlugin = pluginOnly !== undefined ? Boolean(pluginOnly) : argv.includes('--plugin-only');

  if (onlyExt && onlyPlugin) {
    throw new Error('Cannot combine --extensions-only and --plugin-only');
  }

  const resolvedUserDir = userDir !== undefined ? path.resolve(userDir) : resolveUserDir(argv);
  const resolvedPluginsDir = pluginsDir !== undefined ? path.resolve(pluginsDir) : resolvePluginsDir(argv);

  const extensions = onlyPlugin ? null : installExtensions({ userDir: resolvedUserDir, srcDir: extensionsSrcDir });
  const plugin = onlyExt ? null : installPlugin({ pluginsDir: resolvedPluginsDir, srcDir: pluginSrcDir });

  return { extensions, plugin };
}

function printHelp() {
  console.log([
    'Usage: node install.mjs [options]',
    '',
    'Options:',
    '  --extensions-only    Install only Anti-Claude user extensions (prism-suite*.{css,js}: prism-suite.css, prism-suite.js, prism-suite-fx.css, prism-suite-fx.js, prism-suite-workflow.css, prism-suite-workflow.js)',
    '  --plugin-only        Install only Antigravity prism-files MCP App plugin',
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

  const res = installAll({ argv });
  if (res.extensions) {
    console.log(`[Anti-Claude Extensions] Installed to: ${res.extensions.targetDir}`);
    for (const f of res.extensions.installed) console.log(`  - ${f}`);
  }
  if (res.plugin) {
    console.log(`[Antigravity Plugin: prism-files] Installed to: ${res.plugin.targetDir} (${res.plugin.installed.length} files)`);
    for (const f of res.plugin.installed) console.log(`  - ${f}`);
  }
  if (res.extensions) {
    console.log('Note: Ensure your Anti-Claude daemon supports user/extensions/*.{css,js} hot-loading, getUsageSummary, and translateText RPC.');
  }
  if (res.plugin) {
    console.log('Note: Restart or reload Antigravity to activate the prism-files MCP App plugin.');
  }
}
