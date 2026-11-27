#!/usr/bin/env node
/**
 * Install bundled Anti-Claude runtime kernel, Prism Suite extensions,
 * and/or Antigravity prism-files MCP App plugin in one standalone step.
 *
 * Usage:
 *   node install.mjs [--extensions-only | --plugin-only] [--no-kernel] [--no-kernel-daemon] [--user-dir <dir>] [--plugin-dir <dir>]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db']);
export const KERNEL_USER_LAYER_FILES = ['config.json', 'custom.css', 'custom.js', 'i18n.override.json'];

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

function pathsEqual(a, b) {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
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

export function resolveStateDirFromUserDir(userDir = resolveUserDir()) {
  const resolved = path.resolve(userDir);
  if (path.basename(resolved).toLowerCase() === 'user') {
    return path.dirname(resolved);
  }
  return path.join(resolved, '.anti-claude');
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

const SLEEP_BUF = new Int32Array(new SharedArrayBuffer(4));
function sleepMsSync(ms) {
  try { Atomics.wait(SLEEP_BUF, 0, 0, ms); } catch {}
}

function assertSafeDirectory(dirPath, anchorDir = '') {
  const resolvedTarget = path.resolve(dirPath);
  if (anchorDir) {
    const resolvedAnchor = path.resolve(anchorDir);
    const anchorSt = fs.lstatSync(resolvedAnchor, { throwIfNoEntry: false });
    if (anchorSt) {
      if (anchorSt.isSymbolicLink()) {
        throw new Error(`Refusing to operate under symlinked anchor directory: ${resolvedAnchor}`);
      }
      if (!anchorSt.isDirectory()) {
        throw new Error(`Expected directory at anchor path: ${resolvedAnchor}`);
      }
    }
    const rel = path.relative(resolvedAnchor, resolvedTarget);
    if (rel && (rel.startsWith('..') || path.isAbsolute(rel))) {
      throw new Error(`Managed path escapes anchor root (${resolvedAnchor}): ${resolvedTarget}`);
    }
    const parts = rel ? rel.split(path.sep).filter(Boolean) : [];
    let walk = resolvedAnchor;
    for (const seg of parts) {
      walk = path.join(walk, seg);
      const st = fs.lstatSync(walk, { throwIfNoEntry: false });
      if (st) {
        if (st.isSymbolicLink()) {
          throw new Error(`Refusing to operate through symlinked ancestor or directory: ${walk}`);
        }
        if (!st.isDirectory()) {
          throw new Error(`Expected directory along managed path: ${walk}`);
        }
      }
    }
    return;
  }
  const cur = fs.lstatSync(resolvedTarget, { throwIfNoEntry: false });
  if (cur) {
    if (cur.isSymbolicLink()) {
      throw new Error(`Refusing to operate through symlinked directory: ${resolvedTarget}`);
    }
    if (!cur.isDirectory()) {
      throw new Error(`Expected directory at path: ${resolvedTarget}`);
    }
  }
}

function atomicWriteInPlace(destPath, anchorDir, prefix, writeTmpFn) {
  const dir = path.dirname(destPath);
  assertSafeDirectory(dir, anchorDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  assertSafeDirectory(dir, anchorDir);
  const existing = fs.lstatSync(destPath, { throwIfNoEntry: false });
  if (existing && (existing.isSymbolicLink() || existing.isDirectory())) {
    throw new Error(`Refusing to overwrite symlink or directory with file: ${destPath}`);
  }
  const tmpPath = path.join(dir, `${prefix}${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`);
  let shouldCleanupTmp = true;
  try {
    try {
      writeTmpFn(tmpPath);
    } catch (wErr) {
      if (wErr && wErr.code === 'EEXIST') shouldCleanupTmp = false;
      throw wErr;
    }
    const maxAttempts = process.platform === 'win32' ? 4 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const cur = fs.lstatSync(destPath, { throwIfNoEntry: false });
        if (cur && (cur.isSymbolicLink() || cur.isDirectory())) {
          throw new Error(`Refusing to overwrite symlink or directory with file: ${destPath}`);
        }
        fs.renameSync(tmpPath, destPath);
        shouldCleanupTmp = false;
        break;
      } catch (renameErr) {
        if (
          attempt + 1 < maxAttempts &&
          process.platform === 'win32' &&
          (renameErr?.code === 'EPERM' || renameErr?.code === 'EACCES' || renameErr?.code === 'EBUSY')
        ) {
          sleepMsSync(25 * (attempt + 1));
          continue;
        }
        throw renameErr;
      }
    }
  } finally {
    if (shouldCleanupTmp) {
      try { fs.rmSync(tmpPath, { force: true }); } catch {}
    }
  }
}

function copyFileInPlace(srcPath, destPath, anchorDir = '') {
  atomicWriteInPlace(destPath, anchorDir, '.prism-inst-', (tmpPath) => {
    fs.copyFileSync(srcPath, tmpPath, fs.constants.COPYFILE_EXCL);
  });
}

function writeTextInPlace(destPath, content, anchorDir = '') {
  atomicWriteInPlace(destPath, anchorDir, '.prism-write-', (tmpPath) => {
    fs.writeFileSync(tmpPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  });
}

/**
 * Sync srcDir into destDir in-place WITHOUT deleting destDir itself,
 * preserving directory inodes so running MCP Server / Daemon processes never lose cwd.
 */
function syncDirInPlace(srcDir, destDir, installed, anchorDir = '') {
  assertSafeDirectory(destDir, anchorDir);
  fs.mkdirSync(destDir, { recursive: true });
  assertSafeDirectory(destDir, anchorDir);
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
    const destLst = fs.lstatSync(destPath, { throwIfNoEntry: false });
    if (destLst && destLst.isSymbolicLink()) {
      fs.rmSync(destPath, { force: true });
    }
    if (entry.isDirectory()) {
      const curLst = fs.lstatSync(destPath, { throwIfNoEntry: false });
      if (curLst && !curLst.isDirectory()) {
        fs.rmSync(destPath, { force: true });
      }
      syncDirInPlace(srcPath, destPath, installed, anchorDir);
    } else if (entry.isFile()) {
      const curLst = fs.lstatSync(destPath, { throwIfNoEntry: false });
      if (curLst && curLst.isDirectory()) {
        fs.rmSync(destPath, { recursive: true, force: true });
      }
      copyFileInPlace(srcPath, destPath, anchorDir);
      installed.push(destPath);
    }
  }
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

function threeWayMergeJsonObj(base, local, remote) {
  if (deepEqual(local, base)) return JSON.parse(JSON.stringify(remote));
  if (deepEqual(remote, base)) return JSON.parse(JSON.stringify(local));
  if (!isPlainObject(base) || !isPlainObject(local) || !isPlainObject(remote)) {
    return JSON.parse(JSON.stringify(local));
  }
  const out = {};
  const keys = [...new Set([...Object.keys(remote), ...Object.keys(local)])];
  for (const k of keys) {
    const inB = Object.prototype.hasOwnProperty.call(base, k);
    const inL = Object.prototype.hasOwnProperty.call(local, k);
    const inR = Object.prototype.hasOwnProperty.call(remote, k);
    if (inB && !inL) continue;
    if (inB && !inR) {
      if (inL && !deepEqual(local[k], base[k])) out[k] = JSON.parse(JSON.stringify(local[k]));
      continue;
    }
    if (!inB) {
      if (inL && inR) out[k] = threeWayMergeJsonObj({}, local[k], remote[k]);
      else out[k] = JSON.parse(JSON.stringify(inL ? local[k] : remote[k]));
      continue;
    }
    out[k] = threeWayMergeJsonObj(base[k], local[k], remote[k]);
  }
  return out;
}

/**
 * Deploy bundled Anti-Claude runtime kernel (`vendor/anti-claude`) into `<stateDir>/runtime`
 * and safely sync user-layer base files without clobbering user customizations.
 */
export function installKernel({
  userDir = resolveUserDir(),
  stateDir,
  srcDir = path.join(__dirname, 'vendor', 'anti-claude'),
  activateDaemon = false
} = {}) {
  const resolvedSrc = path.resolve(srcDir);
  if (!fs.existsSync(path.join(resolvedSrc, 'install.mjs')) || !fs.existsSync(path.join(resolvedSrc, 'core', 'daemon.mjs'))) {
    throw new Error(`Missing bundled Anti-Claude kernel directory: ${resolvedSrc}`);
  }

  const resolvedUserDir = path.resolve(userDir);
  const resolvedStateDir = stateDir ? path.resolve(stateDir) : resolveStateDirFromUserDir(resolvedUserDir);
  const stateAnchor = path.dirname(resolvedStateDir);
  const userAnchor = path.dirname(resolvedUserDir);
  const runtimeDir = path.join(resolvedStateDir, 'runtime');
  const baseDir = path.join(resolvedStateDir, 'base');
  const incomingDir = path.join(resolvedStateDir, 'incoming');

  assertSafeDirectory(resolvedStateDir, stateAnchor);
  assertSafeDirectory(runtimeDir, stateAnchor);
  assertSafeDirectory(baseDir, stateAnchor);
  assertSafeDirectory(incomingDir, stateAnchor);
  const userInsideState = !path.relative(resolvedStateDir, resolvedUserDir).startsWith('..') && !path.isAbsolute(path.relative(resolvedStateDir, resolvedUserDir));
  const effectiveUserAnchor = userInsideState ? stateAnchor : userAnchor;
  assertSafeDirectory(resolvedUserDir, effectiveUserAnchor);

  const installed = [];
  syncDirInPlace(resolvedSrc, runtimeDir, installed, stateAnchor);

  fs.mkdirSync(resolvedUserDir, { recursive: true });
  fs.mkdirSync(baseDir, { recursive: true });

  const userLayer = { created: [], updated: [], merged: [], keptLocal: [] };
  for (const fileName of KERNEL_USER_LAYER_FILES) {
    const templatePath = path.join(resolvedSrc, 'user', fileName);
    if (!fs.existsSync(templatePath)) continue;
    const remoteText = fs.readFileSync(templatePath, 'utf8');
    const livePath = path.join(resolvedUserDir, fileName);
    const basePath = path.join(baseDir, fileName);

    const liveLst = fs.lstatSync(livePath, { throwIfNoEntry: false });
    const baseLst = fs.lstatSync(basePath, { throwIfNoEntry: false });
    if ((liveLst && liveLst.isSymbolicLink()) || (baseLst && baseLst.isSymbolicLink())) {
      throw new Error(`Refusing to modify symlinked user configuration file: ${livePath}`);
    }

    if (!liveLst) {
      writeTextInPlace(livePath, remoteText, effectiveUserAnchor);
      writeTextInPlace(basePath, remoteText, stateAnchor);
      userLayer.created.push(fileName);
      continue;
    }

    const localText = fs.readFileSync(livePath, 'utf8');
    const baseText = baseLst && baseLst.isFile() ? fs.readFileSync(basePath, 'utf8') : null;
    if (localText === remoteText) {
      if (baseText !== remoteText) writeTextInPlace(basePath, remoteText, stateAnchor);
      continue;
    }
    if (baseText !== null && sha256Text(localText) === sha256Text(baseText)) {
      writeTextInPlace(livePath, remoteText, effectiveUserAnchor);
      writeTextInPlace(basePath, remoteText, stateAnchor);
      userLayer.updated.push(fileName);
      continue;
    }
    if (fileName.endsWith('.json') && baseText !== null) {
      let parsedTriple = null;
      try {
        parsedTriple = {
          base: JSON.parse(baseText),
          local: JSON.parse(localText),
          remote: JSON.parse(remoteText)
        };
      } catch {
        parsedTriple = null;
      }
      if (parsedTriple) {
        const merged = threeWayMergeJsonObj(parsedTriple.base, parsedTriple.local, parsedTriple.remote);
        const mergedText = `${JSON.stringify(merged, null, 2)}\n`;
        if (mergedText !== localText) writeTextInPlace(livePath, mergedText, effectiveUserAnchor);
        writeTextInPlace(basePath, remoteText, stateAnchor);
        userLayer.merged.push(fileName);
        continue;
      }
    }
    if (baseText !== remoteText) {
      writeTextInPlace(path.join(incomingDir, fileName), remoteText, stateAnchor);
    }
    userLayer.keptLocal.push(fileName);
  }

  let daemonActivated = false;
  let daemonNote = '';
  if (activateDaemon) {
    let keepAgentsRule = false;
    let keepCli = false;
    try {
      const stRaw = fs.readFileSync(path.join(resolvedStateDir, 'install-state.json'), 'utf8');
      const st = JSON.parse(stRaw);
      keepAgentsRule = st?.options?.agentsRule === true;
      keepCli = st?.options?.cli === true;
    } catch {}

    const runtimeInstallScript = path.join(runtimeDir, 'install.mjs');
    const args = [runtimeInstallScript, 'install', '--no-auto-update', '--skip-user-layer'];
    if (!keepCli) args.push('--no-cli');
    if (!keepAgentsRule) args.push('--no-agents-rule');
    try {
      // Use stdio: 'ignore' so detached grandchild daemon on Windows never inherits open stdout/stderr pipes
      execFileSync(process.execPath, args, {
        cwd: runtimeDir,
        env: {
          ...process.env,
          ANTI_CLAUDE_NO_NETWORK: '1',
          ANTI_CLAUDE_STATE_DIR: resolvedStateDir,
          ANTI_CLAUDE_USER_DIR: resolvedUserDir
        },
        timeout: 35000,
        windowsHide: true,
        stdio: 'ignore'
      });
      daemonActivated = true;
    } catch (err) {
      daemonNote = String(err?.message || err).split('\n')[0];
    }
  }

  return {
    stateDir: resolvedStateDir,
    runtimeDir,
    userDir: resolvedUserDir,
    installed,
    userLayer,
    daemonActivated,
    daemonNote
  };
}

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
    copyFileInPlace(src, dest);
    installed.push(dest);
  }
  return { targetDir, installed };
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
  kernelSrcDir = path.join(__dirname, 'vendor', 'anti-claude'),
  extensionsOnly,
  pluginOnly,
  skipKernel,
  activateKernelDaemon
} = {}) {
  const onlyExt = extensionsOnly !== undefined ? Boolean(extensionsOnly) : argv.includes('--extensions-only');
  const onlyPlugin = pluginOnly !== undefined ? Boolean(pluginOnly) : argv.includes('--plugin-only');

  if (onlyExt && onlyPlugin) {
    throw new Error('Cannot combine --extensions-only and --plugin-only');
  }

  const resolvedUserDir = userDir !== undefined ? path.resolve(userDir) : resolveUserDir(argv);
  const resolvedPluginsDir = pluginsDir !== undefined ? path.resolve(pluginsDir) : resolvePluginsDir(argv);

  const noKernel = skipKernel !== undefined
    ? Boolean(skipKernel)
    : (onlyExt || onlyPlugin || argv.includes('--no-kernel'));

  let kernel = null;
  if (!noKernel && fs.existsSync(path.join(kernelSrcDir, 'install.mjs'))) {
    const defaultHostUserDir = path.join(os.homedir(), '.gemini', 'antigravity', 'anti-claude', 'user');
    const isCustomSandbox =
      userDir !== undefined ||
      Boolean(readArgValue(argv, '--user-dir')) ||
      Boolean(process.env.ANTI_CLAUDE_USER_DIR) ||
      Boolean(process.env.ANTI_CLAUDE_STATE_DIR);
    const isCrossMountOnLinux = process.platform === 'linux' && /^\/mnt\/[a-z]\//i.test(resolvedUserDir);
    const shouldActivate = activateKernelDaemon !== undefined
      ? Boolean(activateKernelDaemon)
      : (!isCustomSandbox && !isCrossMountOnLinux && !argv.includes('--no-kernel-daemon') && pathsEqual(resolvedUserDir, defaultHostUserDir));

    kernel = installKernel({
      userDir: resolvedUserDir,
      srcDir: kernelSrcDir,
      activateDaemon: shouldActivate
    });
  }

  const extensions = onlyPlugin ? null : installExtensions({ userDir: resolvedUserDir, srcDir: extensionsSrcDir });
  const plugin = onlyExt ? null : installPlugin({ pluginsDir: resolvedPluginsDir, srcDir: pluginSrcDir });

  return { kernel, extensions, plugin };
}

function printHelp() {
  console.log([
    'Usage: node install.mjs [options]',
    '',
    'Options:',
    '  --extensions-only    Install only Prism Suite user extensions (prism-suite*.{css,js})',
    '  --plugin-only        Install only Antigravity prism-files MCP App plugin',
    '  --no-kernel          Skip deploying the bundled Anti-Claude runtime kernel',
    '  --no-kernel-daemon   Deploy bundled Anti-Claude kernel files without registering/starting host daemon',
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
  if (res.kernel) {
    console.log(`[Bundled Anti-Claude Kernel] Deployed to: ${res.kernel.runtimeDir} (${res.kernel.installed.length} files, daemon=${res.kernel.daemonActivated ? 'active' : 'files-only'})`);
    if (res.kernel.daemonNote) {
      console.log(`  Note: ${res.kernel.daemonNote}`);
    }
  }
  if (res.extensions) {
    console.log(`[Anti-Claude Extensions] Installed to: ${res.extensions.targetDir}`);
    for (const f of res.extensions.installed) console.log(`  - ${f}`);
  }
  if (res.plugin) {
    console.log(`[Antigravity Plugin: prism-files] Installed to: ${res.plugin.targetDir} (${res.plugin.installed.length} files)`);
    for (const f of res.plugin.installed) console.log(`  - ${f}`);
  }
  if (res.plugin) {
    console.log('Note: Restart or reload Antigravity to activate the prism-files MCP App plugin.');
  }
}
