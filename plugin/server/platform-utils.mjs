/**
 * Shared zero-dependency platform utilities for Anti-Claude Prism Suite server modules.
 *
 * Pure Node.js >=22 standard library only:
 * - WSL2 detection & interop environment repair
 * - Safe subprocess cwd resolution (survives deleted/unmounted cwd)
 * - PowerShell executable lookup (Windows & WSL2)
 * - /mnt/c/Users Windows profile enumeration under WSL2
 * - Atomic file & JSON writes with explicit permissions
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SKIPPED_WIN_USER_DIRS = new Set(['Public', 'Default', 'Default User', 'All Users']);

export function detectIsWsl({
  platform = process.platform,
  env = process.env,
  procVersionPath = '/proc/version',
  checkMountFallback = false
} = {}) {
  if (platform !== 'linux') return false;
  if (env?.WSL_DISTRO_NAME || env?.WSL_INTEROP) return true;
  try {
    const ver = fs.readFileSync(procVersionPath, 'utf8');
    if (/microsoft|wsl/i.test(ver)) return true;
  } catch {
    // fall through
  }
  return checkMountFallback ? fs.existsSync('/mnt/c/Windows/System32') : false;
}

export function resolveSafeExecCwd({
  isWsl = false,
  platform = process.platform,
  existsSync = fs.existsSync,
  homeDir = os.homedir(),
  tmpDir = os.tmpdir(),
  getCwd = () => process.cwd()
} = {}) {
  const candidates = [];
  if (isWsl) {
    candidates.push('/mnt/c/Windows/Temp', '/mnt/c', homeDir, tmpDir, '/');
  } else {
    try {
      const cur = getCwd();
      if (cur && existsSync(cur)) return cur;
    } catch {}
    candidates.push(homeDir, tmpDir, platform === 'win32' ? 'C:\\' : '/');
  }
  for (const dir of candidates) {
    if (!dir) continue;
    try {
      if (existsSync(dir)) return dir;
    } catch {}
  }
  return platform === 'win32' ? 'C:\\' : '/';
}

export function resolveWslInteropEnv(baseEnv = process.env, isWsl = false, {
  interopDir = '/run/WSL',
  existsSync = fs.existsSync,
  readdirSync = fs.readdirSync,
  statSync = fs.statSync
} = {}) {
  const envCopy = { ...(baseEnv || {}) };
  if (!isWsl) return envCopy;
  const current = envCopy.WSL_INTEROP;
  if (current) {
    try {
      if (existsSync(current)) return envCopy;
    } catch {}
  }
  try {
    if (!existsSync(interopDir)) return envCopy;
    const files = [];
    for (const name of readdirSync(interopDir)) {
      if (!/_interop$/i.test(name)) continue;
      const full = path.join(interopDir, name);
      try {
        const st = statSync(full);
        files.push({ full, mtimeMs: Number(st.mtimeMs) || 0 });
      } catch {}
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (files.length > 0) {
      envCopy.WSL_INTEROP = files[0].full;
    }
  } catch {}
  return envCopy;
}

export function resolvePowerShellExe(isWsl = false) {
  if (!isWsl) {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    const full = path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return fs.existsSync(full) ? full : 'powershell.exe';
  }
  const wslPs = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  return fs.existsSync(wslPs) ? wslPs : 'powershell.exe';
}

export function cleanPowerShellError(stderr = '', stdout = '', status = 1, signal = '') {
  let raw = String(stderr || stdout || '').trim();
  if (raw) {
    raw = raw
      .replace(/^#<\s*CLIXML\s*/i, '')
      .replace(/<Objs\b[\s\S]*$/i, (m) => {
        const msgs = [];
        const re = /<S\s+S="(?:Error|Warning)"[^>]*>([\s\S]*?)<\/S>/gi;
        let hit;
        while ((hit = re.exec(m)) !== null) {
          const text = hit[1]
            .replace(/_x000D__x000A_/gi, ' ')
            .replace(/_x000A_/gi, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .trim();
          if (text) msgs.push(text);
        }
        if (msgs.length) return msgs.join(' ');
        return m.replace(/<[^>]+>/g, ' ');
      })
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (raw) return raw.slice(0, 180);
  const sigNote = signal ? ` (${signal})` : '';
  return `exit ${status ?? 'unknown'}${sigNote}`;
}

export function listWslWindowsUserDirs({
  winUsersRoot = '/mnt/c/Users',
  env = process.env,
  includePathInference = true,
  existsSync = fs.existsSync,
  readdirSync = fs.readdirSync
} = {}) {
  if (!winUsersRoot || !existsSync(winUsersRoot)) return [];
  const dirs = [];
  const seen = new Set();
  const addDir = (dirPath) => {
    if (!dirPath) return;
    const key = dirPath.toLowerCase();
    if (seen.has(key)) return;
    try {
      if (existsSync(dirPath)) {
        seen.add(key);
        dirs.push(dirPath);
      }
    } catch {}
  };
  const addUserName = (name) => {
    const clean = String(name || '').trim();
    if (!clean || clean === '.' || clean === '..' || /[\\/]/.test(clean) || SKIPPED_WIN_USER_DIRS.has(clean)) return;
    addDir(path.join(winUsersRoot, clean));
  };

  if (env?.PRISM_WIN_USER) {
    addUserName(env.PRISM_WIN_USER);
  }
  if (includePathInference && typeof env?.PATH === 'string') {
    for (const seg of env.PATH.split(':')) {
      const m = seg.match(/^\/mnt\/c\/Users\/([^/]+)(?:\/|$)/i);
      if (m) addUserName(m[1]);
    }
  }
  try {
    const curUser = os.userInfo().username;
    if (curUser) addUserName(curUser);
  } catch {}
  addUserName('Administrator');

  try {
    for (const ent of readdirSync(winUsersRoot, { withFileTypes: true })) {
      if (!ent.isDirectory() || SKIPPED_WIN_USER_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
      addDir(path.join(winUsersRoot, ent.name));
    }
  } catch {}

  return dirs;
}

export function writeFileAtomic(targetPath, data, {
  mode = 0o600,
  encoding = 'utf8',
  prefix = '.prism-tmp-'
} = {}) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `${prefix}${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    const opts = { flag: 'wx' };
    if (mode !== undefined && mode !== null) opts.mode = mode;
    if (typeof data === 'string') opts.encoding = encoding;
    fs.writeFileSync(tmpPath, data, opts);
    if (mode !== undefined && mode !== null) {
      try { fs.chmodSync(tmpPath, mode); } catch {}
    }
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try { fs.rmSync(tmpPath, { force: true }); } catch {}
    throw err;
  }
}

export function writeJsonAtomic(filePath, obj, {
  mode = 0o600,
  spaces = 2,
  trailingNewline = true,
  prefix = '.prism-tmp-'
} = {}) {
  const text = `${JSON.stringify(obj, null, spaces)}${trailingNewline ? '\n' : ''}`;
  writeFileAtomic(filePath, text, { mode, encoding: 'utf8', prefix });
}
