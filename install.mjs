#!/usr/bin/env node
/**
 * Install Prism Suite extensions into Anti-Claude's user extensions directory.
 *
 * Usage:
 *   node install.mjs [--user-dir <dir>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveUserDir(argv = process.argv.slice(2)) {
  const idx = argv.indexOf('--user-dir');
  if (idx !== -1 && idx + 1 < argv.length) {
    return path.resolve(argv[idx + 1]);
  }
  if (process.env.ANTI_CLAUDE_USER_DIR) {
    return path.resolve(process.env.ANTI_CLAUDE_USER_DIR);
  }
  const stateDir = process.env.ANTI_CLAUDE_STATE_DIR || path.join(os.homedir(), '.gemini', 'antigravity', 'anti-claude');
  return path.join(path.resolve(stateDir), 'user');
}

export function installExtensions({ userDir = resolveUserDir(), srcDir = path.join(__dirname, 'extensions') } = {}) {
  const targetDir = path.join(userDir, 'extensions');
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

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
})();

if (isMain) {
  const res = installExtensions();
  console.log(`Installed Anti-Claude Prism Suite to: ${res.targetDir}`);
  for (const f of res.installed) console.log(`  - ${f}`);
  console.log('Note: Ensure your Anti-Claude daemon supports user/extensions/*.{css,js} hot-loading, getUsageSummary, and translateText RPC.');
}
