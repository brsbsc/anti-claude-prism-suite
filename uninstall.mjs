#!/usr/bin/env node
/**
 * Uninstall Prism Suite extensions cleanly from Anti-Claude's user extensions directory.
 *
 * Usage:
 *   node uninstall.mjs [--user-dir <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveUserDir } from './install.mjs';

const __filename = fileURLToPath(import.meta.url);

export function uninstallExtensions({ userDir = resolveUserDir() } = {}) {
  const targetDir = path.join(userDir, 'extensions');
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

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
})();

if (isMain) {
  const res = uninstallExtensions();
  if (res.removed.length) {
    console.log('Removed Anti-Claude Prism Suite files:');
    for (const f of res.removed) console.log(`  - ${f}`);
  } else {
    console.log(`No Prism Suite extension files found in: ${res.targetDir}`);
  }
}
