#!/usr/bin/env node
/**
 * Prism Files MCP App Server (Clean-Room Original, MIT, Zero External Dependencies)
 * Part of Anti-Claude Prism Suite v0.3.0
 *
 * Implements MCP stdio JSON-RPC 2.0 + SEP-1865 MCP Apps UI resources:
 *   - Model-visible tools (only 2, minimal context footprint):
 *       1. show_files_inline  -> inline interactive file card in conversation
 *       2. open_prism_files   -> Aux Pane + Global Sidebar file & artifact workbench
 *   - App-only tools (visibility: ["app"], hidden from model):
 *       3. list_directory
 *       4. read_file_preview
 *       5. save_file_content  (guarded workspace-only optimistic-lock atomic write)
 *       6. list_recent_artifacts (scans ~/.gemini/antigravity/brain/)
 *       7. reveal_in_explorer (cross-platform Windows / WSL / macOS / Linux)
 *       8. get_state / update_state (persisted to --data_dir/state.json)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, '..');

export const APP_URI = 'ui://prism-files/app.html';
export const INLINE_URI = 'ui://prism-files/inline.html';
export const APP_MIME_TYPE = 'text/html;profile=mcp-app';
const SERVER_INFO = { name: 'prism-files', version: '0.3.0' };
const MAX_TEXT_PREVIEW_BYTES = 256 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_SAVE_BYTES = 512 * 1024;
const MAX_STDIN_BUFFER_BYTES = 16 * 1024 * 1024;

const IMAGE_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon'
};

const SENSITIVE_SEGMENTS = new Set(['.ssh', '.gnupg', '.aws', '.codex', '.claude', '.cc-switch']);
const SENSITIVE_BASENAME_RE = /^(?:\.env(?:\..+)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?|auth\.json|credentials\.json|cc-switch\.db|.*\.(?:pem|key|p12|pfx|kdbx))$/i;

export function isSensitivePath(targetPath) {
  const resolved = path.resolve(targetPath);
  const parts = resolved.split(path.sep);
  if (parts.some((p) => SENSITIVE_SEGMENTS.has(p.toLowerCase()))) return true;
  const base = path.basename(resolved);
  return SENSITIVE_BASENAME_RE.test(base);
}

export function sha256Hex(bufOrStr) {
  return crypto.createHash('sha256').update(bufOrStr).digest('hex');
}

export function detectWsl() {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    const ver = fs.readFileSync('/proc/version', 'utf8');
    return /microsoft|wsl/i.test(ver);
  } catch {
    return false;
  }
}

export function fallbackLinuxToWindowsPath(linuxPath, distroName = process.env.WSL_DISTRO_NAME || 'Ubuntu') {
  const norm = path.resolve(linuxPath);
  const mnt = norm.match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/);
  if (mnt) {
    const drive = mnt[1].toUpperCase();
    const rest = (mnt[2] || '').replace(/\//g, '\\');
    return rest ? `${drive}:\\${rest}` : `${drive}:\\`;
  }
  const winRest = norm.replace(/\//g, '\\');
  return `\\\\wsl.localhost\\${distroName}${winRest}`;
}

export async function toWindowsPathFromWsl(linuxPath) {
  const abs = path.resolve(linuxPath);
  try {
    const { stdout } = await execFileAsync('wslpath', ['-w', abs], { timeout: 4000 });
    const out = String(stdout || '').trim();
    if (out) return out;
  } catch {}
  return fallbackLinuxToWindowsPath(abs);
}

export function resolveHomeAndBrain() {
  const home = os.homedir();
  const brainDir = process.env.PRISM_FILES_BRAIN_DIR
    ? path.resolve(process.env.PRISM_FILES_BRAIN_DIR)
    : path.join(home, '.gemini', 'antigravity', 'brain');
  return { home, brainDir };
}

export function isPathInside(childPath, parentPath) {
  if (!childPath || !parentPath) return false;
  const rel = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function hasSensitiveSegment(targetPath) {
  return isSensitivePath(targetPath);
}

export function expandUserPath(rawPath, fallbackDir) {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) return path.resolve(fallbackDir || process.cwd());
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2).replace(/\.?0+$/, '')} GB`;
}

export function getFileKind(fileName, isDir) {
  if (isDir) return 'dir';
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (IMAGE_MIME_BY_EXT[ext]) return 'image';
  if (ext === '.md' || ext === '.mdx' || ext === '.markdown') return 'markdown';
  if (ext === '.pdf') return 'pdf';
  if (['.doc', '.docx', '.xls', '.xlsx', '.csv', '.ppt', '.pptx'].includes(ext)) return 'office';
  if (['.zip', '.tar', '.gz', '.7z', '.rar'].includes(ext)) return 'archive';
  if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.cs', '.go', '.rs', '.java', '.json', '.yaml', '.yml', '.toml', '.css', '.html', '.xml', '.sql', '.sh', '.ps1', '.cmd'].includes(ext)) {
    return 'code';
  }
  return 'file';
}

export function createPrismFilesServer({ dataDir = '', defaultRoot = process.cwd() } = {}) {
  const stateFile = dataDir ? path.join(path.resolve(dataDir), 'state.json') : '';
  const { home, brainDir } = resolveHomeAndBrain();
  const isWsl = detectWsl();
  const platformLabel =
    process.platform === 'darwin'
      ? 'macOS Finder'
      : process.platform === 'win32'
        ? 'Windows 资源管理器'
        : isWsl
          ? 'Windows 资源管理器 (WSL)'
          : '系统文件管理器';

  function loadState() {
    const defaults = {
      pinnedPaths: [],
      lastPath: path.resolve(defaultRoot || home),
      showHidden: false,
      doubleClickAction: 'reveal' // 'reveal' | 'open_tab'
    };
    if (!stateFile) return defaults;
    try {
      if (fs.existsSync(stateFile)) {
        const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        return {
          pinnedPaths: Array.isArray(parsed.pinnedPaths) ? parsed.pinnedPaths.filter((p) => typeof p === 'string').slice(0, 30) : [],
          lastPath: typeof parsed.lastPath === 'string' && parsed.lastPath ? parsed.lastPath : defaults.lastPath,
          showHidden: Boolean(parsed.showHidden),
          doubleClickAction: parsed.doubleClickAction === 'open_tab' ? 'open_tab' : 'reveal'
        };
      }
    } catch {}
    return defaults;
  }

  function saveState(patch) {
    const cur = loadState();
    const next = {
      pinnedPaths: Array.isArray(patch?.pinnedPaths) ? patch.pinnedPaths.filter((p) => typeof p === 'string').slice(0, 30) : cur.pinnedPaths,
      lastPath: typeof patch?.lastPath === 'string' && patch.lastPath ? patch.lastPath : cur.lastPath,
      showHidden: typeof patch?.showHidden === 'boolean' ? patch.showHidden : cur.showHidden,
      doubleClickAction: patch?.doubleClickAction === 'open_tab' || patch?.doubleClickAction === 'reveal' ? patch.doubleClickAction : cur.doubleClickAction
    };
    if (stateFile) {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      const tmp = `${stateFile}.tmp-${process.pid}-${Date.now()}`;
      try {
        fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
        fs.renameSync(tmp, stateFile);
      } catch {
        try { fs.rmSync(tmp, { force: true }); } catch {}
      }
    }
    return next;
  }

  function buildFileItem(absPath, baseDir = '') {
    const resolved = path.resolve(absPath);
    let st = null;
    try {
      st = fs.statSync(resolved);
    } catch {
      return {
        path: resolved,
        uri: pathToFileURL(resolved).href,
        name: path.basename(resolved) || resolved,
        relPath: baseDir ? path.relative(baseDir, resolved) : resolved,
        isDir: false,
        exists: false,
        size: 0,
        sizeText: '不存在',
        mtimeMs: 0,
        kind: 'file'
      };
    }
    const isDir = st.isDirectory();
    const name = path.basename(resolved) || resolved;
    return {
      path: resolved,
      uri: pathToFileURL(resolved).href,
      name,
      relPath: baseDir ? (path.relative(baseDir, resolved) || name) : resolved,
      isDir,
      exists: true,
      size: isDir ? 0 : st.size,
      sizeText: isDir ? '文件夹' : formatBytes(st.size),
      mtimeMs: Math.round(st.mtimeMs),
      kind: getFileKind(name, isDir)
    };
  }

  function listDirectory(rawDir, showHidden = false, query = '') {
    const dir = expandUserPath(rawDir, loadState().lastPath || defaultRoot || home);
    if (!fs.existsSync(dir)) {
      return { ok: false, error: `目录不存在：${dir}`, dir, entries: [] };
    }
    const st = fs.statSync(dir);
    const targetDir = st.isDirectory() ? dir : path.dirname(dir);
    let rawEntries = [];
    try {
      rawEntries = fs.readdirSync(targetDir, { withFileTypes: true });
    } catch (err) {
      return { ok: false, error: `无法读取目录：${err.message}`, dir: targetDir, entries: [] };
    }
    const q = String(query || '').trim().toLowerCase();
    const items = [];
    for (const ent of rawEntries) {
      const name = ent.name;
      if (!showHidden && name.startsWith('.')) continue;
      if (q && !name.toLowerCase().includes(q)) continue;
      const full = path.join(targetDir, name);
      let isDir = ent.isDirectory();
      let size = 0;
      let mtimeMs = 0;
      try {
        const s = fs.statSync(full);
        isDir = s.isDirectory();
        size = isDir ? 0 : s.size;
        mtimeMs = Math.round(s.mtimeMs);
      } catch {}
      items.push({
        path: full,
        uri: pathToFileURL(full).href,
        name,
        isDir,
        size,
        sizeText: isDir ? '' : formatBytes(size),
        mtimeMs,
        kind: getFileKind(name, isDir)
      });
    }
    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    const truncated = items.length > 400;
    const parent = path.dirname(targetDir);
    saveState({ lastPath: targetDir });
    return {
      ok: true,
      dir: targetDir,
      parent: parent !== targetDir ? parent : '',
      total: items.length,
      truncated,
      entries: items.slice(0, 400),
      platformLabel
    };
  }

  function readFilePreview(rawPath) {
    const abs = expandUserPath(rawPath);
    if (!fs.existsSync(abs)) return { ok: false, error: '文件不存在', path: abs };
    let st;
    try {
      st = fs.statSync(abs);
    } catch (err) {
      return { ok: false, error: err.message, path: abs };
    }
    if (st.isDirectory()) return { ok: false, error: '目标是文件夹而非文件', path: abs, isDir: true };

    const ext = path.extname(abs).toLowerCase();
    const name = path.basename(abs);
    const kind = getFileKind(name, false);
    const real = (() => { try { return fs.realpathSync(abs); } catch { return abs; } })();
    if (isSensitivePath(abs) || isSensitivePath(real)) {
      return {
        ok: true,
        path: abs,
        uri: pathToFileURL(abs).href,
        name,
        kind,
        previewType: 'protected',
        size: st.size,
        sizeText: formatBytes(st.size),
        mtimeMs: Math.round(st.mtimeMs),
        editable: false
      };
    }
    const editableBlocked =
      isPathInside(real, brainDir) ||
      st.size > MAX_SAVE_BYTES;

    if (IMAGE_MIME_BY_EXT[ext]) {
      if (st.size > MAX_IMAGE_PREVIEW_BYTES) {
        return {
          ok: true,
          path: abs,
          uri: pathToFileURL(abs).href,
          name,
          kind: 'image',
          previewType: 'too_large',
          size: st.size,
          sizeText: formatBytes(st.size),
          mtimeMs: Math.round(st.mtimeMs),
          editable: false
        };
      }
      const b64 = fs.readFileSync(abs).toString('base64');
      return {
        ok: true,
        path: abs,
        uri: pathToFileURL(abs).href,
        name,
        kind: 'image',
        previewType: 'image',
        mime: IMAGE_MIME_BY_EXT[ext],
        dataUrl: `data:${IMAGE_MIME_BY_EXT[ext]};base64,${b64}`,
        size: st.size,
        sizeText: formatBytes(st.size),
        mtimeMs: Math.round(st.mtimeMs),
        editable: false
      };
    }

    const readLen = Math.min(st.size, MAX_TEXT_PREVIEW_BYTES);
    const fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(readLen);
    try {
      fs.readSync(fd, buf, 0, readLen, 0);
    } finally {
      fs.closeSync(fd);
    }
    // Check NUL byte for binary files
    let isBinary = false;
    const probeLen = Math.min(buf.length, 4096);
    for (let i = 0; i < probeLen; i++) {
      if (buf[i] === 0) {
        isBinary = true;
        break;
      }
    }
    if (isBinary) {
      return {
        ok: true,
        path: abs,
        uri: pathToFileURL(abs).href,
        name,
        kind,
        previewType: 'binary',
        size: st.size,
        sizeText: formatBytes(st.size),
        mtimeMs: Math.round(st.mtimeMs),
        editable: false
      };
    }
    const truncated = st.size > MAX_TEXT_PREVIEW_BYTES;
    return {
      ok: true,
      path: abs,
      uri: pathToFileURL(abs).href,
      name,
      kind,
      previewType: kind === 'markdown' ? 'markdown' : 'text',
      text: buf.toString('utf8'),
      baseHash: truncated ? '' : sha256Hex(buf),
      truncated,
      size: st.size,
      sizeText: formatBytes(st.size),
      mtimeMs: Math.round(st.mtimeMs),
      editable: !editableBlocked && !truncated
    };
  }

  function saveFileContent(rawPath, content, expectedMtimeMs, baseHash = '') {
    const abs = expandUserPath(rawPath);
    if (!fs.existsSync(abs)) return { ok: false, error: '文件不存在，拒绝创建未知路径' };
    const real = fs.realpathSync(abs);
    if (isPathInside(real, brainDir)) {
      return { ok: false, error: '为保护会话产物，brain/ 目录仅允许只读预览' };
    }
    if (isSensitivePath(abs) || isSensitivePath(real)) {
      return { ok: false, error: '受保护凭据或配置目录禁止通过工作台写入' };
    }
    const st = fs.statSync(real);
    if (st.isDirectory()) return { ok: false, error: '目标为目录，无法写入' };
    const text = String(content ?? '');
    const byteLen = Buffer.byteLength(text, 'utf8');
    if (byteLen > MAX_SAVE_BYTES) {
      return { ok: false, error: `文件内容超过安全编辑上限 (${formatBytes(MAX_SAVE_BYTES)})` };
    }
    if (baseHash) {
      const curHash = sha256Hex(fs.readFileSync(real));
      if (curHash !== String(baseHash)) {
        return {
          ok: false,
          conflict: true,
          error: '文件内容已在外部变更，请刷新后再保存',
          currentMtimeMs: Math.round(st.mtimeMs)
        };
      }
    } else if (typeof expectedMtimeMs === 'number' && Number.isFinite(expectedMtimeMs)) {
      const curMtime = Math.round(st.mtimeMs);
      if (Math.abs(curMtime - Math.round(expectedMtimeMs)) > 1) {
        return {
          ok: false,
          conflict: true,
          error: '文件已在外部发生变更，请刷新后再保存',
          currentMtimeMs: curMtime
        };
      }
    } else {
      return { ok: false, error: '缺少版本校验信息（baseHash / expectedMtimeMs），已拒绝盲写' };
    }
    const fileMode = (st.mode & 0o777) || 0o600;
    const tmp = path.join(path.dirname(real), `.prism-save-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}.tmp`);
    try {
      const outBuf = Buffer.from(text, 'utf8');
      fs.writeFileSync(tmp, outBuf, { flag: 'wx', mode: fileMode });
      try { fs.chmodSync(tmp, fileMode); } catch {}
      fs.renameSync(tmp, real);
      const nextSt = fs.statSync(real);
      return {
        ok: true,
        path: abs,
        size: nextSt.size,
        sizeText: formatBytes(nextSt.size),
        mtimeMs: Math.round(nextSt.mtimeMs),
        baseHash: sha256Hex(outBuf)
      };
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      return { ok: false, error: `保存失败：${err.message}` };
    }
  }

  function listRecentArtifacts(limit = 50) {
    if (!fs.existsSync(brainDir)) {
      return { ok: true, brainDir, items: [], platformLabel };
    }
    const found = [];
    let sessions = [];
    try {
      sessions = fs.readdirSync(brainDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => {
          const full = path.join(brainDir, d.name);
          let mtime = 0;
          try { mtime = fs.statSync(full).mtimeMs; } catch {}
          return { name: d.name, full, mtime };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 24);
    } catch {
      sessions = [];
    }

    for (const sess of sessions) {
      let ents = [];
      try { ents = fs.readdirSync(sess.full, { withFileTypes: true }); } catch { continue; }
      for (const ent of ents) {
        if (ent.name.startsWith('.')) continue;
        const full = path.join(sess.full, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === 'scratch') continue;
          continue;
        }
        if (/\.resolved(\.\d+)?$|\.metadata\.json$/i.test(ent.name)) continue;
        let st;
        try { st = fs.statSync(full); } catch { continue; }
        found.push({
          path: full,
          uri: pathToFileURL(full).href,
          name: ent.name,
          sessionId: sess.name.slice(0, 8),
          isDir: false,
          size: st.size,
          sizeText: formatBytes(st.size),
          mtimeMs: Math.round(st.mtimeMs),
          kind: getFileKind(ent.name, false)
        });
      }
    }
    found.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return {
      ok: true,
      brainDir,
      items: found.slice(0, Math.max(1, Math.min(120, Number(limit) || 50))),
      platformLabel
    };
  }

  async function revealInExplorer(rawPath) {
    const abs = expandUserPath(rawPath);
    if (!fs.existsSync(abs)) {
      return { ok: false, error: `路径不存在：${abs}`, path: abs };
    }
    const isDir = fs.statSync(abs).isDirectory();
    try {
      if (process.platform === 'darwin') {
        await execFileAsync('open', ['-R', abs], { timeout: 8000 });
        return { ok: true, path: abs, method: 'macos-finder' };
      }
      if (process.platform === 'win32') {
        try {
          await execFileAsync('explorer.exe', [isDir ? abs : `/select,${abs}`], { timeout: 8000 });
        } catch (err) {
          // explorer.exe routinely exits with code 1 even when the window opens cleanly
          if (err && typeof err.code === 'number' && err.code !== 1) throw err;
        }
        return { ok: true, path: abs, method: 'windows-explorer' };
      }
      if (isWsl) {
        const winPath = await toWindowsPathFromWsl(abs);
        const explorerBin = fs.existsSync('/mnt/c/Windows/explorer.exe') ? '/mnt/c/Windows/explorer.exe' : 'explorer.exe';
        const args = isDir || winPath.includes(',') ? [isDir ? winPath : path.win32.dirname(winPath)] : [`/select,${winPath}`];
        try {
          await execFileAsync(explorerBin, args, { timeout: 8000 });
        } catch (err) {
          if (err && typeof err.code === 'number' && err.code !== 1) throw err;
        }
        return { ok: true, path: abs, winPath, method: 'wsl-windows-explorer' };
      }
      const openTarget = isDir ? abs : path.dirname(abs);
      await execFileAsync('xdg-open', [openTarget], { timeout: 8000 });
      return { ok: true, path: abs, method: 'linux-xdg-open' };
    } catch (err) {
      return { ok: false, error: `打开系统文件管理器失败：${err.message}`, path: abs };
    }
  }

  function readUiHtml(uri) {
    const envPath = uri === INLINE_URI ? process.env.PRISM_FILES_INLINE_HTML : process.env.PRISM_FILES_APP_HTML;
    const fp = envPath ? path.resolve(envPath) : path.join(PLUGIN_ROOT, 'ui', uri === INLINE_URI ? 'inline.html' : 'app.html');
    return fs.readFileSync(fp, 'utf8');
  }

  const TOOLS = [
    {
      name: 'show_files_inline',
      title: '内联文件卡片',
      description: 'Render an interactive inline file card list in the conversation so the user can open files in Antigravity native tabs or double-click to reveal them in Windows Explorer / macOS Finder.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Optional short heading for the file card (e.g. "本次交付物")' },
          baseDir: { type: 'string', description: 'Optional base directory for relative display paths' },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of absolute file or directory paths to display'
          }
        },
        required: ['files']
      },
      _meta: {
        ui: { resourceUri: INLINE_URI }
      }
    },
    {
      name: 'open_prism_files',
      title: 'Prism 文件',
      description: 'Open the Prism Files workbench in the side pane or sidebar for workspace file tree browsing, live code/Markdown/image preview & safe editing, selection quoting to AI, recent brain artifacts, and system file explorer reveal.',
      inputSchema: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Optional initial directory path' },
          tab: { type: 'string', enum: ['browse', 'artifacts', 'pins'], description: 'Optional initial tab' },
          selectFile: { type: 'string', description: 'Optional file path to preview immediately' }
        }
      },
      _meta: {
        ui: { resourceUri: APP_URI },
        'com.google.antigravity/ui': {
          entrypoints: [
            { type: 'aux_pane', title: 'Prism 文件' },
            { type: 'global', title: 'Prism 文件' }
          ]
        }
      }
    },
    {
      name: 'list_directory',
      description: 'App-only: list directory contents',
      inputSchema: {
        type: 'object',
        properties: {
          dir: { type: 'string' },
          showHidden: { type: 'boolean' },
          query: { type: 'string' }
        }
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'read_file_preview',
      description: 'App-only: read bounded text or image preview for a file',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'save_file_content',
      description: 'App-only: save edited text file with SHA-256 / mtime optimistic lock',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          expectedMtimeMs: { type: 'number' },
          baseHash: { type: 'string' }
        },
        required: ['path', 'content']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'list_recent_artifacts',
      description: 'App-only: list recent Antigravity brain artifacts',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number' } }
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'reveal_in_explorer',
      description: 'App-only: reveal a file or folder in the native OS file manager (Windows Explorer / WSL / macOS Finder / Linux)',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'get_state',
      description: 'App-only: read persisted plugin preferences and pins',
      inputSchema: { type: 'object', properties: {} },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'update_state',
      description: 'App-only: update persisted plugin preferences and pins',
      inputSchema: {
        type: 'object',
        properties: {
          pinnedPaths: { type: 'array', items: { type: 'string' } },
          lastPath: { type: 'string' },
          showHidden: { type: 'boolean' },
          doubleClickAction: { type: 'string', enum: ['reveal', 'open_tab'] }
        }
      },
      _meta: { ui: { visibility: ['app'] } }
    }
  ];

  async function handleToolCall(name, args = {}) {
    if (name === 'show_files_inline') {
      const files = Array.isArray(args.files) ? args.files.filter((f) => typeof f === 'string' && f.trim()).slice(0, 40) : [];
      const baseDir = args.baseDir ? expandUserPath(args.baseDir) : '';
      const items = files.map((f) => buildFileItem(expandUserPath(f), baseDir));
      const title = String(args.title || (items.length === 1 ? '文件定位卡片' : `文件卡片 (${items.length})`)).trim();
      return {
        content: [
          {
            type: 'text',
            text: `已展示 ${items.length} 个文件的交互卡片（双击或点「定位」可在 ${platformLabel} 中高亮打开）：\n` +
              items.map((it) => `- ${it.path}`).join('\n')
          }
        ],
        structuredContent: { title, items, platformLabel }
      };
    }

    if (name === 'open_prism_files') {
      const state = loadState();
      const initDir = args.dir ? expandUserPath(args.dir) : (fs.existsSync(state.lastPath) ? state.lastPath : path.resolve(defaultRoot || home));
      const listing = listDirectory(initDir, state.showHidden, '');
      const tab = ['browse', 'artifacts', 'pins'].includes(args.tab) ? args.tab : 'browse';
      const selectFile = args.selectFile ? expandUserPath(args.selectFile) : '';
      return {
        content: [{ type: 'text', text: `已打开 Prism 文件工作台（当前目录：${listing.dir || initDir}）` }],
        structuredContent: {
          tab,
          state,
          listing,
          selectFile,
          brainDir,
          homeDir: home,
          platformLabel
        }
      };
    }

    if (name === 'list_directory') {
      const res = listDirectory(args.dir, Boolean(args.showHidden), args.query || '');
      return { content: [{ type: 'text', text: JSON.stringify(res) }], structuredContent: res };
    }

    if (name === 'read_file_preview') {
      const res = readFilePreview(args.path);
      return { content: [{ type: 'text', text: res.ok ? `Loaded ${res.name}` : res.error }], structuredContent: res };
    }

    if (name === 'save_file_content') {
      const res = saveFileContent(args.path, args.content, args.expectedMtimeMs, args.baseHash || '');
      return { content: [{ type: 'text', text: res.ok ? `Saved ${res.path}` : res.error }], structuredContent: res };
    }

    if (name === 'list_recent_artifacts') {
      const res = listRecentArtifacts(args.limit);
      return { content: [{ type: 'text', text: `Found ${res.items.length} recent artifacts` }], structuredContent: res };
    }

    if (name === 'reveal_in_explorer') {
      const res = await revealInExplorer(args.path);
      return { content: [{ type: 'text', text: res.ok ? `Revealed ${res.path}` : res.error }], structuredContent: res };
    }

    if (name === 'get_state') {
      const state = loadState();
      const pinnedItems = state.pinnedPaths.map((p) => buildFileItem(p));
      const res = { ok: true, state, pinnedItems, homeDir: home, brainDir, platformLabel };
      return { content: [{ type: 'text', text: JSON.stringify(state) }], structuredContent: res };
    }

    if (name === 'update_state') {
      const state = saveState(args || {});
      const pinnedItems = state.pinnedPaths.map((p) => buildFileItem(p));
      const res = { ok: true, state, pinnedItems, homeDir: home, brainDir, platformLabel };
      return { content: [{ type: 'text', text: JSON.stringify(state) }], structuredContent: res };
    }

    throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });
  }

  async function handleRpc(req) {
    if (!req || typeof req !== 'object') return null;
    const { id, method, params } = req;
    const isNotification = id === undefined || id === null;

    try {
      if (method === 'initialize') {
        const clientVer = params?.protocolVersion || '2025-06-18';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: clientVer,
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false }
            },
            serverInfo: SERVER_INFO
          }
        };
      }
      if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
        return null;
      }
      if (method === 'ping') {
        return { jsonrpc: '2.0', id, result: {} };
      }
      if (method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
      }
      if (method === 'tools/call') {
        const result = await handleToolCall(params?.name, params?.arguments || {});
        return { jsonrpc: '2.0', id, result };
      }
      if (method === 'resources/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            resources: [
              {
                uri: APP_URI,
                name: 'Prism Files Workbench',
                mimeType: APP_MIME_TYPE,
                _meta: { ui: { prefersBorder: false } }
              },
              {
                uri: INLINE_URI,
                name: 'Prism Files Inline Card',
                mimeType: APP_MIME_TYPE,
                _meta: { ui: { prefersBorder: false } }
              }
            ]
          }
        };
      }
      if (method === 'resources/read') {
        const uri = params?.uri;
        if (uri !== APP_URI && uri !== INLINE_URI) {
          throw Object.assign(new Error(`Resource not found: ${uri}`), { code: -32002 });
        }
        const html = readUiHtml(uri);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: APP_MIME_TYPE,
                text: html,
                _meta: { ui: { prefersBorder: false } }
              }
            ]
          }
        };
      }
      if (isNotification) return null;
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
    } catch (err) {
      if (isNotification) return null;
      return {
        jsonrpc: '2.0',
        id,
        error: { code: typeof err?.code === 'number' ? err.code : -32000, message: String(err?.message || err) }
      };
    }
  }

  return { handleRpc, handleToolCall, listDirectory, readFilePreview, saveFileContent, listRecentArtifacts, revealInExplorer, loadState, saveState };
}

function parseDataDirArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--data_dir=')) return a.slice('--data_dir='.length);
    if (a === '--data_dir' && i + 1 < argv.length) return argv[i + 1];
  }
  return '';
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
})();

if (isMain) {
  const dataDir = parseDataDirArg(process.argv.slice(2));
  const server = createPrismFilesServer({ dataDir, defaultRoot: process.cwd() });
  let buffer = '';

  const sendLine = (obj) => {
    if (!obj) return;
    process.stdout.write(`${JSON.stringify(obj)}\n`);
  };

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer, 'utf8') > MAX_STDIN_BUFFER_BYTES) {
      buffer = '';
      return;
    }
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      Promise.resolve(server.handleRpc(parsed))
        .then(sendLine)
        .catch(() => {});
    }
  });
  process.stdin.resume();
}
