#!/usr/bin/env node
/**
 * Uninstall Prism Suite extensions and/or Antigravity prism-files plugin cleanly.
 *
 * Usage:
 *   node uninstall.mjs [--extensions-only | --plugin-only] [--user-dir <dir>] [--plugin-dir <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePluginsDir, resolveUserDir } from './install.mjs';

const __filename = fileURLToPath(import.meta.url);

export function uninstallExtensions({ userDir = resolveUserDir() } = {}) {
  const targetDir = path.join(path.resolve(userDir), 'extensions');
  const removed = [];
  for (const name of ['prism-suite.css', 'prism-suite.js']) {
    const fp = path.join(targetDir, name);
    if (fs.existsSync(fp)) {
      fs.rmSync(fp, { force: true });
      removed.push(fp);
    }
  }
  return { targetDir, removed };
}

export function uninstallPlugin({ pluginsDir = resolvePluginsDir() } = {}) {
  const resolvedPluginsDir = path.resolve(pluginsDir);
  const targetDir = path.join(resolvedPluginsDir, 'prism-files');
  if (path.basename(targetDir) !== 'prism-files') {
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
  pluginOnly
} = {}) {
  const onlyExt = extensionsOnly !== undefined ? Boolean(extensionsOnly) : argv.includes('--extensions-only');
  const onlyPlugin = pluginOnly !== undefined ? Boolean(pluginOnly) : argv.includes('--plugin-only');

  if (onlyExt && onlyPlugin) {
    throw new Error('Cannot combine --extensions-only and --plugin-only');
  }

  const resolvedUserDir = userDir !== undefined ? path.resolve(userDir) : resolveUserDir(argv);
  const resolvedPluginsDir = pluginsDir !== undefined ? path.resolve(pluginsDir) : resolvePluginsDir(argv);

  const extensions = onlyPlugin ? null : uninstallExtensions({ userDir: resolvedUserDir });
  const plugin = onlyExt ? null : uninstallPlugin({ pluginsDir: resolvedPluginsDir });

  return { extensions, plugin };
}

function printHelp() {
  console.log([
    'Usage: node uninstall.mjs [options]',
    '',
    'Options:',
    '  --extensions-only    Uninstall only Anti-Claude user extensions (prism-suite.css, prism-suite.js)',
    '  --plugin-only        Uninstall only Antigravity prism-files plugin',
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
  if (res.plugin) {
    if (res.plugin.removed.length) {
      console.log(`[Antigravity Plugin: prism-files] Removed: ${res.plugin.targetDir}`);
    } else {
      console.log(`[Antigravity Plugin: prism-files] Not found at: ${res.plugin.targetDir}`);
    }
  }
}
