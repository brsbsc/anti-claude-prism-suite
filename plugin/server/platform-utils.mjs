/**
 * Shared zero-dependency platform & security utilities for Anti-Claude Prism Suite server modules.
 *
 * Pure Node.js >=22 standard library only:
 * - WSL2 detection & interop environment repair
 * - Safe subprocess cwd resolution & unified sync command runner
 * - PowerShell executable lookup & CLIXML error cleanup
 * - /mnt/<drive>/Users Windows profile enumeration under WSL2
 * - Unified secret redaction & blocked environment variable guard
 * - Unified IPv4/IPv6 classification & anti-SSRF/metadata endpoint guard
 * - Atomic file & JSON writes with symlink guard and non-destructive Windows retry
 * - Cross-process atomic file lock with rename-based stale reclamation
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SKIPPED_WIN_USER_DIRS = new Set(['public', 'default', 'default user', 'all users']);
const SLEEP_ARR = new Int32Array(new SharedArrayBuffer(4));

function sleepSyncMs(ms) {
  const dur = Math.max(1, Math.min(500, Math.round(Number(ms) || 10)));
  try {
    Atomics.wait(SLEEP_ARR, 0, 0, dur);
  } catch {
    const end = Date.now() + dur;
    while (Date.now() < end) {
      // minimal fallback when Atomics.wait is disallowed
    }
  }
}

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
  return checkMountFallback ? (fs.existsSync('/mnt/c/Windows/System32') || fs.existsSync('/c/Windows/System32')) : false;
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
    candidates.push('/mnt/c/Windows/Temp', '/c/Windows/Temp', '/mnt/c', '/c', homeDir, tmpDir, '/');
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
  for (const candidate of [
    '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
    '/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'powershell.exe';
}

export function runCmdSync(bin, args, {
  input = '',
  timeoutMs = 15000,
  maxBuffer = 2 * 1024 * 1024,
  cwd,
  env
} = {}) {
  const spawnOpts = {
    input,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer
  };
  if (cwd) spawnOpts.cwd = cwd;
  if (env) spawnOpts.env = env;
  const res = spawnSync(bin, args, spawnOpts);
  if (res.error) throw res.error;
  return {
    status: res.status ?? (res.signal ? 1 : 0),
    signal: res.signal || '',
    stdout: res.stdout || '',
    stderr: res.stderr || ''
  };
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
  winUsersRoot = '',
  env = process.env,
  includePathInference = true,
  existsSync = fs.existsSync,
  readdirSync = fs.readdirSync,
  statSync = null
} = {}) {
  const effectiveRoot = winUsersRoot || (existsSync('/mnt/c/Users') ? '/mnt/c/Users' : (existsSync('/c/Users') ? '/c/Users' : '/mnt/c/Users'));
  if (!effectiveRoot || !existsSync(effectiveRoot)) return [];
  const effectiveStat = statSync || (existsSync === fs.existsSync ? fs.statSync : null);
  const dirs = [];
  const seen = new Set();
  const addDir = (dirPath) => {
    if (!dirPath) return;
    const key = dirPath.toLowerCase();
    if (seen.has(key)) return;
    try {
      if (!existsSync(dirPath)) return;
      if (typeof effectiveStat === 'function') {
        const st = effectiveStat(dirPath);
        if (st && typeof st.isDirectory === 'function' && !st.isDirectory()) return;
      }
      seen.add(key);
      dirs.push(dirPath);
    } catch {}
  };
  const addUserName = (name) => {
    const clean = String(name || '').trim();
    if (!clean || clean === '.' || clean === '..' || /[\\/]/.test(clean) || SKIPPED_WIN_USER_DIRS.has(clean.toLowerCase())) return;
    addDir(path.join(effectiveRoot, clean));
  };

  if (env?.PRISM_WIN_USER) {
    addUserName(env.PRISM_WIN_USER);
  }
  if (includePathInference && typeof env?.PATH === 'string') {
    const escapedRoot = effectiveRoot.replace(/\/+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pathUserRe = new RegExp(`^${escapedRoot}\\/([^/]+)(?:\\/|$)`, 'i');
    for (const seg of env.PATH.split(':')) {
      const m = seg.match(pathUserRe);
      if (m) addUserName(m[1]);
    }
  }
  try {
    const curUser = os.userInfo().username;
    if (curUser) addUserName(curUser);
  } catch {}
  addUserName('Administrator');

  try {
    for (const ent of readdirSync(effectiveRoot, { withFileTypes: true })) {
      if (!ent.isDirectory() || SKIPPED_WIN_USER_DIRS.has(ent.name.toLowerCase()) || ent.name.startsWith('.')) continue;
      addDir(path.join(effectiveRoot, ent.name));
    }
  } catch {}

  return dirs;
}

/* ---------------- Unified Secret Redaction ---------------- */

export function redactSensitiveText(text, { extraSecrets = [], maxLen = 0 } = {}) {
  let out = String(text ?? '');
  if (!out) return '';

  // Exact scrub of active runtime secrets first (handles non-standard UUID/hex/custom API keys)
  if (Array.isArray(extraSecrets)) {
    for (const sec of extraSecrets) {
      if (typeof sec === 'string' && sec.length >= 6) {
        out = out.split(sec).join('[REDACTED_SECRET]');
      }
    }
  } else if (typeof extraSecrets === 'string' && extraSecrets.length >= 6) {
    out = out.split(extraSecrets).join('[REDACTED_SECRET]');
  }

  // PEM & PGP private key blocks
  out = out.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
    '[REDACTED_PRIVATE_KEY]'
  );
  // URL embedded credentials: scheme://user:pass@host -> scheme://[REDACTED_AUTH]@host
  out = out.replace(
    /\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/\s@'"`]+)@(?=[A-Za-z0-9.-]|\[)/g,
    '$1[REDACTED_AUTH]@'
  );
  // URL query-string credentials: ?api_key=... / &token=...
  out = out.replace(
    /([?&](?:api[_-]?key|key|token|access[_-]?token|secret|auth)=)[^&\s'"`<>]+/gi,
    '$1[REDACTED]'
  );
  // GitHub classic & fine-grained PATs
  out = out.replace(
    /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    '[REDACTED_GH_TOKEN]'
  );
  // OpenAI / Anthropic / Stripe / OpenRouter style sk-... keys
  out = out.replace(
    /\bsk-(?:proj-|ant-|live-|test-|or-v1-)?[A-Za-z0-9_-]{12,}\b/g,
    '[REDACTED_API_KEY]'
  );
  // Other common provider tokens (GitLab, HuggingFace, npm, Groq, xAI, Perplexity)
  out = out.replace(
    /\b(?:glpat-[A-Za-z0-9_-]{16,}|hf_[A-Za-z0-9]{16,}|npm_[A-Za-z0-9]{16,}|gsk_[A-Za-z0-9]{16,}|xai-[A-Za-z0-9_-]{16,}|pplx-[A-Za-z0-9_-]{16,})\b/g,
    '[REDACTED_API_KEY]'
  );
  // Google API keys & OAuth access/refresh tokens
  out = out.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_GOOGLE_KEY]');
  out = out.replace(/\bya29\.[0-9A-Za-z._-]{20,}\b/g, '[REDACTED_GOOGLE_TOKEN]');
  out = out.replace(/(?<![A-Za-z0-9_])1\/\/[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_GOOGLE_TOKEN]');
  // Slack tokens
  out = out.replace(/\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g, '[REDACTED_SLACK_TOKEN]');
  // AWS access key IDs
  out = out.replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]');
  // Standard 3-segment JWTs
  out = out.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    '[REDACTED_JWT]'
  );
  // Authorization Bearer & Basic tokens
  out = out.replace(/\b(Bearer[ \t]+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED_TOKEN]');
  out = out.replace(/\b(Basic[ \t]+)[A-Za-z0-9+/=]{8,}/gi, '$1[REDACTED_TOKEN]');
  // key=value / key: value credential assignments (including x-api-key, secret_key, and escaped/quoted JSON keys)
  out = out.replace(
    /((?:\\?["'])?\b[A-Za-z0-9_.-]*(?:x-api-key|api[_-]?key|secret[_-]?key|private[_-]?key|signing[_-]?key|access[_-]?key|client[_-]?secret|password|passwd|token|secret)(?:\\?["'])?[ \t]*[:=][ \t]*)(?:\\"(?:[^"\\\r\n]|\\.)*\\"|"(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'|[^\s,;'"`}\]]+)/gi,
    '$1[REDACTED]'
  );
  out = out.replace(
    /(\bCookie[ \t]*:[ \t]*)[^\r\n]+/gi,
    '$1[REDACTED_COOKIE]'
  );

  if (maxLen > 0 && out.length > maxLen) {
    return out.slice(0, maxLen);
  }
  return out;
}

/* ---------------- Unified Blocked Environment Variable Guard ---------------- */

const ENV_VAR_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

export const BLOCKED_ENV_VAR_NAMES = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'TMPDIR',
  'SHELL',
  'COMSPEC',
  'NODE_OPTIONS',
  'LD_PRELOAD',
  'WSL_INTEROP',
  'ANTIGRAVITY_CSRF_TOKEN',
  'ANTIGRAVITY_LS_ADDRESS',
  'ANTIGRAVITY_AGENTAPI_EXE',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'NODE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'ELECTRON_RUN_AS_NODE',
  'PYTHONPATH',
  'IFS',
  'PWD',
  'OLDPWD',
  'USER',
  'LOGNAME',
  'USERNAME',
  'HOSTNAME',
  'COMPUTERNAME',
  'SYSTEMROOT',
  'WINDIR',
  'PROGRAMFILES',
  'PROGRAMDATA',
  'HOMEDRIVE',
  'HOMEPATH',
  'PATHEXT',
  'PSMODULEPATH',
  'WSL_DISTRO_NAME',
  'WSLENV',
  'SSH_AUTH_SOCK',
  'GPG_AGENT_INFO',
  'XDG_RUNTIME_DIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'TERM',
  'LANG',
  'LC_ALL',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY'
]);

export function validateEnvVarName(name) {
  if (typeof name !== 'string') {
    throw Object.assign(new Error('环境变量名必须为字符串'), {
      code: 'INVALID_ENV_VAR_NAME'
    });
  }
  const trimmed = name.trim();
  if (!ENV_VAR_NAME_RE.test(trimmed)) {
    throw Object.assign(
      new Error(`非法环境变量名 "${trimmed.slice(0, 64)}"：必须匹配 /^[A-Z][A-Z0-9_]{1,63}$/`),
      { code: 'INVALID_ENV_VAR_NAME' }
    );
  }
  if (BLOCKED_ENV_VAR_NAMES.has(trimmed) || trimmed.startsWith('ANTIGRAVITY_SIDECAR_')) {
    throw Object.assign(
      new Error(`禁止绑定非密钥系统环境变量 "${trimmed}"`),
      { code: 'BLOCKED_ENV_VAR_NAME' }
    );
  }
  return trimmed;
}

/* ---------------- Unified IPv4 / IPv6 & SSRF / Metadata Guards ---------------- */

export function expandIpv6ToWords(rawIpv6) {
  let addr = String(rawIpv6 || '').trim().toLowerCase();
  if (!addr || addr.includes('%')) return null;

  const lastColon = addr.lastIndexOf(':');
  if (lastColon !== -1 && addr.indexOf('.', lastColon) !== -1) {
    const v4Part = addr.slice(lastColon + 1);
    if (!net.isIPv4(v4Part)) return null;
    const octets = v4Part.split('.').map((n) => Number(n));
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    addr = `${addr.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const dblParts = addr.split('::');
  if (dblParts.length > 2) return null;

  const parseSide = (part) => {
    if (!part) return [];
    return part.split(':').map((seg) => {
      if (!/^[0-9a-f]{1,4}$/.test(seg)) return -1;
      return parseInt(seg, 16);
    });
  };

  if (dblParts.length === 1) {
    const groups = parseSide(dblParts[0]);
    if (groups.length !== 8 || groups.some((n) => n < 0)) return null;
    return groups;
  }

  const left = parseSide(dblParts[0]);
  const right = parseSide(dblParts[1]);
  if (left.some((n) => n < 0) || right.some((n) => n < 0)) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array(missing).fill(0), ...right];
}

function wordsToIpv4(hiWord, loWord) {
  return `${(hiWord >> 8) & 0xff}.${hiWord & 0xff}.${(loWord >> 8) & 0xff}.${loWord & 0xff}`;
}

function parseStrictIpv4Octets(ip) {
  if (!net.isIPv4(ip)) return null;
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^(?:0|[1-9]\d{0,2})$/.test(p) ? Number(p) : -1));
  if (nums.some((n) => n < 0 || n > 255)) return null;
  return nums;
}

/**
 * Returns true ONLY if `ip` is a globally routable public unicast IPv4 or IPv6 address.
 * IPv6 uses an explicit global-unicast allowlist (2000::/3 minus special/doc/Teredo/6to4-private ranges).
 */
export function isPublicRoutableIp(ip) {
  if (typeof ip !== 'string') return false;
  let clean = ip.trim();
  if (!clean || clean.includes('%')) return false;
  if (clean.startsWith('[') && clean.endsWith(']')) {
    clean = clean.slice(1, -1);
  }

  if (net.isIPv4(clean)) {
    const nums = parseStrictIpv4Octets(clean);
    if (!nums) return false;
    const [a, b, c] = nums;

    if (a === 0) return false; // 0.0.0.0/8
    if (a === 10) return false; // 10.0.0.0/8 RFC1918
    if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 CGNAT / Tailscale
    if (a === 127) return false; // 127.0.0.0/8 Loopback
    if (a === 169 && b === 254) return false; // 169.254.0.0/16 Link-local / Cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12 RFC1918
    if (a === 192 && b === 0 && c === 0) return false; // 192.0.0.0/24
    if (a === 192 && b === 0 && c === 2) return false; // 192.0.2.0/24 TEST-NET-1
    if (a === 192 && b === 168) return false; // 192.168.0.0/16 RFC1918
    if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15 Benchmarking / FakeIP
    if (a === 198 && b === 51 && c === 100) return false; // 198.51.100.0/24 TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return false; // 203.0.113.0/24 TEST-NET-3
    if (a >= 224) return false; // 224.0.0.0/4 Multicast + 240.0.0.0/4 Reserved
    return true;
  }

  if (net.isIPv6(clean)) {
    const g = expandIpv6ToWords(clean);
    if (!g) return false;

    // IPv4-mapped ::ffff:0:0/96 -> delegate to IPv4 check
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
      return isPublicRoutableIp(wordsToIpv4(g[6], g[7]));
    }

    // Only allow IANA Global Unicast 2000::/3 (blocks ::, ::1, ::w.x.y.z, NAT64, ULA, link-local, multicast, unallocated)
    if ((g[0] & 0xe000) !== 0x2000) return false;

    // 6to4 2002::/16 embeds IPv4 in g[1], g[2]
    if (g[0] === 0x2002) {
      return isPublicRoutableIp(wordsToIpv4(g[1], g[2]));
    }
    // Documentation 2001:db8::/32, Benchmarking 2001:2::/48, Teredo 2001:0000::/32, ORCHIDv2 2001:20::/28
    if (g[0] === 0x2001) {
      if (g[1] === 0x0db8) return false;
      if (g[1] === 0x0002 && g[2] === 0) return false;
      if (g[1] === 0x0000) return false;
      if ((g[1] & 0xfff0) === 0x0020) return false;
    }
    // RFC 9637 Documentation 3fff::/20
    if (g[0] === 0x3fff && (g[1] & 0xf000) === 0x0000) return false;

    return true;
  }

  return false;
}

/**
 * Returns true if `ip` is a loopback, RFC1918 private LAN, CGNAT/Tailscale, ULA, or link-local IP.
 * Used for explicit LAN SMB opt-in checks.
 */
export function isPrivateOrLocalIp(ip, { allowLinkLocal = true } = {}) {
  if (typeof ip !== 'string') return false;
  let s = ip.trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zoneIdx = s.indexOf('%');
  if (zoneIdx !== -1) s = s.slice(0, zoneIdx);
  if (!s) return false;

  if (net.isIPv4(s)) {
    const nums = parseStrictIpv4Octets(s);
    if (!nums) return false;
    const [a, b] = nums;
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (allowLinkLocal && a === 169 && b === 254) return true;
    return false;
  }

  if (net.isIPv6(s)) {
    const g = expandIpv6ToWords(s);
    if (!g) return false;
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0 && g[6] === 0 && g[7] === 1) {
      return true;
    }
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
      return isPrivateOrLocalIp(wordsToIpv4(g[6], g[7]), { allowLinkLocal });
    }
    if ((g[0] & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
    if (allowLinkLocal && (g[0] & 0xffc0) === 0xfe80) return true; // Link-local fe80::/10
    return false;
  }

  return false;
}

const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
  'instance-data.ec2.internal',
  'metadata.tencentyun.com'
]);

/**
 * Returns true for cloud instance metadata endpoints, unspecified 0.0.0.0/::,
 * link-local 169.254.0.0/16 & fe80::/10, IPv6 zone-ID literals, and multicast addresses.
 */
export function isDangerousMetadataOrLinkLocalHost(rawHost) {
  let bare = String(rawHost || '').trim().toLowerCase();
  if (bare.startsWith('[') && bare.endsWith(']')) bare = bare.slice(1, -1);
  bare = bare.replace(/\.+$/, '');
  if (!bare || bare.includes('%')) return true;
  if (METADATA_HOSTNAMES.has(bare)) return true;

  if (net.isIPv4(bare)) {
    const nums = parseStrictIpv4Octets(bare);
    if (!nums) return true;
    const [a, b, c, d] = nums;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b === 100 && c === 100 && d === 200) return true; // Alibaba Cloud ECS IMDS
    if (a >= 224) return true;
    return false;
  }

  if (net.isIPv6(bare)) {
    const g = expandIpv6ToWords(bare);
    if (!g) return true;
    // Unspecified ::
    if (g.every((w) => w === 0)) return true;
    // AWS IPv6 IMDS fd00:ec2::254
    if (g[0] === 0xfd00 && g[1] === 0x0ec2 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0 && g[6] === 0 && g[7] === 0x0254) {
      return true;
    }
    // IPv4-mapped metadata/unspecified/multicast
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
      return isDangerousMetadataOrLinkLocalHost(wordsToIpv4(g[6], g[7]));
    }
    // Link-local fe80::/10 & Multicast ff00::/8
    if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00) return true;
    return false;
  }

  return false;
}

/**
 * Returns true ONLY for explicit loopback or private LAN hosts safe for local cleartext HTTP gateways.
 * Explicitly excludes cloud metadata (169.254.169.254, 100.100.100.200, fd00:ec2::254), 0.0.0.0, link-local, and public Funnel domains.
 */
export function isLocalOrLanHost(rawHost) {
  let bare = String(rawHost || '').trim().toLowerCase();
  if (bare.startsWith('[') && bare.endsWith(']')) bare = bare.slice(1, -1);
  bare = bare.replace(/\.+$/, '');
  if (!bare || isDangerousMetadataOrLinkLocalHost(bare)) return false;

  if (net.isIP(bare) !== 0) {
    return isPrivateOrLocalIp(bare, { allowLinkLocal: false });
  }
  return (
    bare === 'localhost' ||
    bare.endsWith('.local') ||
    bare.endsWith('.lan') ||
    bare.endsWith('.internal') ||
    !bare.includes('.')
  );
}

/* ---------------- Bounded HTTP Response Reader ---------------- */

export async function readResponseTextCapped(
  response,
  maxBytes,
  { rejectOnOverflow = true, errorCode = 'RESPONSE_TOO_LARGE', errorPrefix = '上游响应体超过上限' } = {}
) {
  const makeOverflowError = () =>
    Object.assign(new Error(`${errorPrefix} (${maxBytes} bytes)`), {
      code: errorCode,
      status: 502,
      retriable: false
    });

  const declaredLen = Number(response?.headers?.get?.('content-length') || 0);
  if (rejectOnOverflow && Number.isFinite(declaredLen) && declaredLen > maxBytes) {
    try { await response.body?.cancel?.(); } catch {}
    throw makeOverflowError();
  }

  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let out = '';
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunkLen = value ? (value.byteLength ?? value.length ?? 0) : 0;
        if (!chunkLen) continue;
        if (totalBytes + chunkLen > maxBytes) {
          if (rejectOnOverflow) {
            try { await reader.cancel(); } catch {}
            throw makeOverflowError();
          }
          const remain = Math.max(0, maxBytes - totalBytes);
          if (remain > 0 && typeof value.subarray === 'function') {
            out += decoder.decode(value.subarray(0, remain), { stream: false });
          }
          try { await reader.cancel(); } catch {}
          return out;
        }
        totalBytes += chunkLen;
        out += decoder.decode(value, { stream: true });
      }
      out += decoder.decode();
      return out;
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  if (typeof response?.text === 'function') {
    const raw = await response.text();
    const byteLen = Buffer.byteLength(raw, 'utf8');
    if (byteLen > maxBytes) {
      if (rejectOnOverflow) throw makeOverflowError();
      return Buffer.from(raw, 'utf8').subarray(0, maxBytes).toString('utf8');
    }
    return raw;
  }
  if (typeof response?.json === 'function') {
    const raw = JSON.stringify(await response.json());
    const byteLen = Buffer.byteLength(raw, 'utf8');
    if (byteLen > maxBytes) {
      if (rejectOnOverflow) throw makeOverflowError();
      return Buffer.from(raw, 'utf8').subarray(0, maxBytes).toString('utf8');
    }
    return raw;
  }
  return '';
}

/* ---------------- Symlink-Safe Atomic File Writes ---------------- */

export function assertPathNotSymlink(targetPath, label = '目标路径', { checkAncestors = false, stopAt = '' } = {}) {
  const resolved = path.resolve(targetPath);
  const isSamePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const chain = [];
  if (checkAncestors) {
    const stopResolved = stopAt ? path.resolve(stopAt) : '';
    let cur = resolved;
    for (let i = 0; i < 64; i++) {
      if (stopResolved && cur !== resolved && isSamePath(cur, stopResolved)) break;
      chain.push(cur);
      if (stopResolved && isSamePath(cur, stopResolved)) break;
      const parent = path.dirname(cur);
      if (!parent || parent === cur) break;
      cur = parent;
    }
  } else {
    chain.push(resolved);
  }

  let targetStat = null;
  for (let i = chain.length - 1; i >= 0; i--) {
    let st = null;
    try {
      st = fs.lstatSync(chain[i]);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        if (i === 0) targetStat = null;
        continue;
      }
      throw err;
    }
    if (st.isSymbolicLink()) {
      throw Object.assign(
        new Error(
          i === 0
            ? `安全拒绝：${label} 不能为符号链接 (${chain[i]})`
            : `安全拒绝：${label} 路径包含符号链接 (${chain[i]})`
        ),
        { code: 'SYMLINK_REJECTED' }
      );
    }
    if (i === 0) targetStat = st;
  }
  return targetStat;
}

export function writeFileAtomic(targetPath, data, {
  mode = 0o600,
  dirMode = 0o700,
  encoding = 'utf8',
  prefix = '.prism-tmp-',
  rejectSymlink = false
} = {}) {
  const dir = path.dirname(targetPath);
  if (rejectSymlink) {
    assertPathNotSymlink(dir, '目标父目录');
    assertPathNotSymlink(targetPath, '目标文件');
  }
  fs.mkdirSync(dir, { recursive: true, ...(dirMode !== undefined && dirMode !== null ? { mode: dirMode } : {}) });
  if (rejectSymlink) {
    assertPathNotSymlink(dir, '目标父目录');
  }
  const tmpPath = path.join(dir, `${prefix}${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`);
  let shouldCleanupTmp = true;
  try {
    const opts = { flag: 'wx' };
    if (mode !== undefined && mode !== null) opts.mode = mode;
    if (typeof data === 'string') opts.encoding = encoding;
    try {
      fs.writeFileSync(tmpPath, data, opts);
    } catch (writeErr) {
      if (writeErr && writeErr.code === 'EEXIST') shouldCleanupTmp = false;
      throw writeErr;
    }
    if (mode !== undefined && mode !== null) {
      try { fs.chmodSync(tmpPath, mode); } catch {}
    }
    if (rejectSymlink) {
      assertPathNotSymlink(targetPath, '目标文件');
    }

    // Non-destructive retry on transient Windows AV/handle locks (never rmSync targetPath first)
    const maxAttempts = process.platform === 'win32' ? 4 : 1;
    let lastErr = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        fs.renameSync(tmpPath, targetPath);
        shouldCleanupTmp = false;
        lastErr = null;
        break;
      } catch (renameErr) {
        lastErr = renameErr;
        if (
          attempt + 1 < maxAttempts &&
          process.platform === 'win32' &&
          (renameErr?.code === 'EPERM' || renameErr?.code === 'EACCES' || renameErr?.code === 'EBUSY')
        ) {
          sleepSyncMs(25 * (attempt + 1));
          continue;
        }
        throw renameErr;
      }
    }
    if (lastErr) throw lastErr;
    if (mode !== undefined && mode !== null) {
      try { fs.chmodSync(targetPath, mode); } catch {}
    }
  } finally {
    if (shouldCleanupTmp) {
      try { fs.rmSync(tmpPath, { force: true }); } catch {}
    }
  }
}

export function writeJsonAtomic(filePath, obj, {
  mode = 0o600,
  dirMode = 0o700,
  spaces = 2,
  trailingNewline = true,
  prefix = '.prism-tmp-',
  rejectSymlink = false
} = {}) {
  const text = `${JSON.stringify(obj, null, spaces)}${trailingNewline ? '\n' : ''}`;
  writeFileAtomic(filePath, text, { mode, dirMode, encoding: 'utf8', prefix, rejectSymlink });
}

/* ---------------- Cross-Process Atomic File Lock ---------------- */

function isProcessAliveLocal(pid) {
  const num = Number(pid);
  if (!Number.isInteger(num) || num <= 0) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

/**
 * Acquires an exclusive cross-process lockfile using `openSync('wx')`, mtime-based empty-lock
 * grace window (prevents killing concurrent writer mid-init), and atomic `renameSync` stale reclamation.
 */
export function acquireFileLock(lockFile, {
  staleMs = 120_000,
  emptyGraceMs = 1500,
  maxWaitMs = 1500,
  meta = {},
  errorCode = 'LOCK_BUSY',
  errorMessage = '已有并发任务正在执行，请稍后再试'
} = {}) {
  const lockDir = path.dirname(lockFile);
  fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  const lockToken = crypto.randomBytes(16).toString('hex');
  const payload = JSON.stringify({
    ...meta,
    pid: process.pid,
    hostname: os.hostname(),
    createdAt: Date.now(),
    lockToken
  });
  const waitDeadline = Date.now() + Math.max(0, Number(maxWaitMs) || 0);

  for (let attempt = 0; attempt < 64; attempt++) {
    let fd = null;
    try {
      fd = fs.openSync(lockFile, 'wx', 0o600);
      fs.writeFileSync(fd, payload, 'utf8');
      fs.closeSync(fd);
      fd = null;
      return () => {
        try {
          const cur = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
          if (cur && cur.lockToken === lockToken) {
            fs.rmSync(lockFile, { force: true });
          }
        } catch {}
      };
    } catch (err) {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch {}
        try { fs.rmSync(lockFile, { force: true }); } catch {}
        fd = null;
      }
      if (!err || err.code !== 'EEXIST') throw err;

      let shouldReclaim = false;
      let observedToken = '';
      let observedRaw = '';
      let retryNow = false;
      try {
        const st = fs.lstatSync(lockFile);
        if (st.isSymbolicLink()) {
          throw Object.assign(new Error(`安全拒绝：锁文件不能为符号链接 (${lockFile})`), { code: 'SYMLINK_REJECTED' });
        }
        const ageMs = Date.now() - Number(st.mtimeMs || 0);
        let parsed = null;
        try {
          observedRaw = fs.readFileSync(lockFile, 'utf8');
          if (observedRaw.trim()) parsed = JSON.parse(observedRaw);
        } catch {}
        if (parsed && typeof parsed === 'object') {
          observedToken = typeof parsed.lockToken === 'string' ? parsed.lockToken : '';
          const recAge = Date.now() - Number(parsed.createdAt || st.mtimeMs || 0);
          const sameHost = !parsed.hostname || parsed.hostname === os.hostname();
          const pidAlive = sameHost && Number(parsed.pid) > 0 ? isProcessAliveLocal(parsed.pid) : true;
          if (recAge > staleMs || !pidAlive) {
            shouldReclaim = true;
          }
        } else if (ageMs > Math.min(staleMs, emptyGraceMs)) {
          // Only reclaim unreadable/empty lock after grace period so a concurrent writer mid-write is never evicted
          shouldReclaim = true;
        }
      } catch (statErr) {
        if (statErr?.code === 'ENOENT') {
          retryNow = true;
        } else if (statErr?.code === 'SYMLINK_REJECTED') {
          throw statErr;
        }
      }

      if (retryNow) continue;
      if (shouldReclaim) {
        const stalePath = `${lockFile}.stale-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        try {
          fs.renameSync(lockFile, stalePath);
          let sameHolder = false;
          try {
            const movedRaw = fs.readFileSync(stalePath, 'utf8');
            if (observedToken) {
              const movedParsed = JSON.parse(movedRaw);
              sameHolder = movedParsed?.lockToken === observedToken;
            } else {
              sameHolder = movedRaw === observedRaw;
            }
          } catch {}
          if (!sameHolder) {
            // ABA race: another process replaced lockFile right before renameSync; restore live lock without clobbering
            try {
              fs.linkSync(stalePath, lockFile);
            } catch (linkErr) {
              if (linkErr?.code !== 'EEXIST' && !fs.existsSync(lockFile)) {
                try { fs.renameSync(stalePath, lockFile); } catch {}
              }
            }
            try { fs.rmSync(stalePath, { force: true }); } catch {}
          } else {
            try { fs.rmSync(stalePath, { force: true }); } catch {}
            continue;
          }
        } catch (reclaimErr) {
          if (reclaimErr?.code === 'ENOENT') continue;
        }
      }

      const remainMs = waitDeadline - Date.now();
      if (remainMs > 0) {
        sleepSyncMs(Math.min(remainMs, 25 * Math.min(8, attempt + 1)));
        continue;
      }
      throw Object.assign(new Error(errorMessage), { code: errorCode });
    }
  }
  throw Object.assign(new Error(errorMessage), { code: errorCode });
}
