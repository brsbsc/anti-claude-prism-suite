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

export function installExtensions({ userDir = resolveUserDir(), srcDir = path.join(__dirname, 'extensions') } = {}) {
  const targetDir = path.join(path.resolve(userDir), 'extensions');
  fs.mkdirSync(targetDir, { recursive: true });
  const files = ['prism-suite.css', 'prism-suite.js'];
  const installed = [];
  for (const name of files) {
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

function copyDirRecursive(srcDir, destDir, installed) {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, installed);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      installed.push(destPath);
    }
  }
}

export function installPlugin({ pluginsDir = resolvePluginsDir(), srcDir = path.join(__dirname, 'plugin') } = {}) {
  const resolvedSrc = path.resolve(srcDir);
  if (!fs.existsSync(resolvedSrc) || !fs.statSync(resolvedSrc).isDirectory()) {
    throw new Error(`Missing source plugin directory: ${resolvedSrc}`);
  }

  const resolvedPluginsDir = path.resolve(pluginsDir);
  const targetDir = path.join(resolvedPluginsDir, 'prism-files');
  if (path.basename(targetDir) !== 'prism-files') {
    throw new Error(`Unsafe plugin target directory: ${targetDir}`);
  }
  if (resolvedSrc === path.resolve(targetDir)) {
    throw new Error(`Source and target plugin directories are identical: ${targetDir}`);
  }

  fs.mkdirSync(resolvedPluginsDir, { recursive: true });
  // Clean stale files inside prism-files/ only; never touch sibling plugins.
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  const installed = [];
  copyDirRecursive(resolvedSrc, targetDir, installed);
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
    '  --extensions-only    Install only Anti-Claude user extensions (prism-suite.css, prism-suite.js)',
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
