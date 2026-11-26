#!/usr/bin/env node
/* ============================================================================
 * Anti-Claude Prism Suite v0.5.0 — Local CDP Session Branching CLI (MIT)
 * Zero external npm dependencies (requires Node.js >= 22 with WebSocket & fetch).
 *
 * Security & Reliability Guardrails:
 *   - Connects STRICTLY to loopback 127.0.0.1 via local DevToolsActivePort
 *   - Validates target URL is an Antigravity hub/workbench page
 *   - Enforces strict input validation, concurrency locking, and timeout guards
 *   - Never executes shell commands or touches external hosts
 *
 * Usage:
 *   node scripts/fork-session.mjs <conversationId> [turnNumber] [options]
 * ============================================================================ */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_TIMEOUT_MS = 15000;
const MIN_TIMEOUT_MS = 3000;
const MAX_TIMEOUT_MS = 60000;
const LOCK_STALE_MS = 30000;
const CONV_ID_RE = /^[A-Za-z0-9._:-]{4,128}$/;

function printUsage() {
  const lines = [
    'Anti-Claude Prism Suite — 本地会话分支工具 (v0.5.0)',
    '',
    '用法:',
    '  node scripts/fork-session.mjs <conversationId> [turnNumber] [选项]',
    '',
    '参数:',
    '  <conversationId>      目标会话 ID（必填，字母/数字/._:-，4~128 字符）',
    '  [turnNumber]          可选，1-based 提问轮次号（1~10000），缺省则从末尾分支',
    '',
    '选项:',
    '  --port-file <path>    显式指定 DevToolsActivePort 文件路径',
    '  --timeout <ms>        超时时间（毫秒，默认 15000，范围 3000~60000）',
    '  --dry-run             仅校验 CDP 连接、目标页与轮次信息，不执行实际分支',
    '  --json                以 JSON 格式输出结果',
    '  -h, --help            显示此帮助信息',
    '',
    '环境变量:',
    '  ANTIGRAVITY_CDP_PORT_FILE  指定 Antigravity 的 DevToolsActivePort 文件路径'
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function parseCliArgs(argv) {
  const opts = {
    conversationId: '',
    turnNumber: null,
    portFile: '',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    dryRun: false,
    json: false,
    help: false
  };

  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      return opts;
    }
    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (arg === '--json') {
      opts.json = true;
      continue;
    }
    if (arg === '--port-file') {
      const next = argv[++i];
      if (!next) throw new Error('参数 --port-file 缺少路径值');
      opts.portFile = next;
      continue;
    }
    if (arg.startsWith('--port-file=')) {
      opts.portFile = arg.slice('--port-file='.length);
      continue;
    }
    if (arg === '--timeout') {
      const next = argv[++i];
      if (!next) throw new Error('参数 --timeout 缺少数值');
      const n = Number(next);
      if (!Number.isFinite(n)) throw new Error(`无效的 --timeout 值: ${next}`);
      opts.timeoutMs = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(n)));
      continue;
    }
    if (arg.startsWith('--timeout=')) {
      const raw = arg.slice('--timeout='.length);
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`无效的 --timeout 值: ${raw}`);
      opts.timeoutMs = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(n)));
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`未知选项: ${arg}`);
    }
    positionals.push(arg);
  }

  if (positionals.length < 1) {
    throw new Error('缺少必填参数 <conversationId>。运行 --help 查看用法。');
  }
  if (positionals.length > 2) {
    throw new Error(`多余的位置参数: ${positionals.slice(2).join(' ')}`);
  }

  const convId = String(positionals[0]).trim();
  if (!CONV_ID_RE.test(convId)) {
    throw new Error(`非法 conversationId（仅允许 4~128 位字母、数字与 . _ : -）: ${convId}`);
  }
  opts.conversationId = convId;

  if (positionals.length === 2) {
    const rawTurn = String(positionals[1]).trim();
    if (!/^\d+$/.test(rawTurn)) {
      throw new Error(`非法 turnNumber（必须为正整数）: ${rawTurn}`);
    }
    const turnNum = Number(rawTurn);
    if (!Number.isInteger(turnNum) || turnNum < 1 || turnNum > 10000) {
      throw new Error(`turnNumber 超出有效范围 (1..10000): ${rawTurn}`);
    }
    opts.turnNumber = turnNum;
  }

  return opts;
}

/* ==========================================================================
 * Cross-Platform DevToolsActivePort Auto-Detection (Windows / WSL / macOS / Linux)
 * ========================================================================== */
function collectPortFileCandidates(explicitPath) {
  const checked = [];
  const existing = [];

  const pushCandidate = (p) => {
    if (!p) return;
    const normalized = path.resolve(p);
    if (checked.includes(normalized)) return;
    checked.push(normalized);
    try {
      const st = fs.statSync(normalized);
      if (st.isFile() && st.size > 0 && st.size < 4096) {
        existing.push({ filePath: normalized, mtimeMs: st.mtimeMs });
      }
    } catch {}
  };

  if (explicitPath) {
    pushCandidate(explicitPath);
    return { checked, existing };
  }

  if (process.env.ANTIGRAVITY_CDP_PORT_FILE) {
    pushCandidate(process.env.ANTIGRAVITY_CDP_PORT_FILE);
  }

  const home = os.homedir();
  const platform = process.platform;

  if (platform === 'win32') {
    if (process.env.APPDATA) {
      pushCandidate(path.join(process.env.APPDATA, 'Antigravity', 'DevToolsActivePort'));
    }
    if (process.env.LOCALAPPDATA) {
      pushCandidate(path.join(process.env.LOCALAPPDATA, 'Antigravity', 'DevToolsActivePort'));
    }
    pushCandidate(path.join(home, 'AppData', 'Roaming', 'Antigravity', 'DevToolsActivePort'));
    pushCandidate(path.join(home, 'AppData', 'Local', 'Antigravity', 'DevToolsActivePort'));
  } else if (platform === 'darwin') {
    pushCandidate(path.join(home, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort'));
  } else {
    // Native Linux paths
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    const xdgData = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    pushCandidate(path.join(xdgConfig, 'Antigravity', 'DevToolsActivePort'));
    pushCandidate(path.join(xdgData, 'Antigravity', 'DevToolsActivePort'));

    // WSL Windows host user profiles (/mnt/c/Users/<user>/AppData/Roaming/Antigravity/DevToolsActivePort)
    const wslUsersRoot = '/mnt/c/Users';
    const skipUsers = new Set(['Public', 'Default', 'Default User', 'All Users', 'desktop.ini']);
    try {
      const entries = fs.readdirSync(wslUsersRoot, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory() || skipUsers.has(ent.name)) continue;
        pushCandidate(path.join(wslUsersRoot, ent.name, 'AppData', 'Roaming', 'Antigravity', 'DevToolsActivePort'));
        pushCandidate(path.join(wslUsersRoot, ent.name, 'AppData', 'Local', 'Antigravity', 'DevToolsActivePort'));
      }
    } catch {}
  }

  // Prefer the most recently modified active port file
  existing.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { checked, existing };
}

function readDevToolsActivePort(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length || !/^\d{1,5}$/.test(lines[0])) {
    throw new Error(`DevToolsActivePort 文件格式无效 (${filePath})`);
  }
  const port = Number(lines[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`DevToolsActivePort 端口号无效 (${port})`);
  }
  const wsPath = lines[1] || '';
  return { port, wsPath, filePath };
}

/* ==========================================================================
 * Loopback-Only CDP Target Discovery & URL Validation
 * ========================================================================== */
function enforceLoopbackWsUrl(rawWsUrl, expectedPort) {
  let parsed;
  try {
    parsed = new URL(String(rawWsUrl || ''));
  } catch {
    throw new Error('无效的 CDP WebSocket URL');
  }
  if (parsed.protocol !== 'ws:') {
    throw new Error(`拒绝非 ws:// 协议的 CDP 地址: ${parsed.protocol}`);
  }
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error(`安全拦截：仅允许连接本地回环 127.0.0.1，拒绝主机 ${parsed.hostname}`);
  }
  const portNum = Number(parsed.port || expectedPort);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error('CDP WebSocket 端口无效');
  }
  // Always normalize hostname strictly to 127.0.0.1
  parsed.hostname = '127.0.0.1';
  parsed.port = String(portNum);
  return parsed.toString();
}

function scoreAntigravityHubTarget(target) {
  if (!target || target.type !== 'page' || !target.webSocketDebuggerUrl) return -1;
  const url = String(target.url || '');
  const title = String(target.title || '');

  // Reject DevTools inspector, blank tabs, and extension pages
  if (!url || /^(?:devtools|chrome-devtools|chrome-extension|about|chrome):/i.test(url)) {
    return -1;
  }

  let score = 0;
  const urlLower = url.toLowerCase();
  const titleLower = title.toLowerCase();

  // Antigravity Electron workbench / hub URLs
  if (urlLower.startsWith('vscode-file://')) score += 40;
  if (urlLower.includes('antigravity') || titleLower.includes('antigravity')) score += 50;
  if (urlLower.includes('workbench') || titleLower.includes('workbench')) score += 25;
  if (urlLower.includes('cascade') || urlLower.includes('jetski') || urlLower.includes('agent')) score += 25;
  if (urlLower.includes('anti-claude') || titleLower.includes('anti-claude')) score += 30;
  if (/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(url)) score += 15;

  // Must match at least one Antigravity / workbench / hub marker
  return score >= 40 ? score : -1;
}

const WSL2_NAT_HINT =
  '检测到处于 WSL2 且读取了 Windows 侧端口文件；若使用默认 NAT 网络，请在 Windows 终端改用 node.exe scripts/fork-session.mjs ... 或启用 WSL networkingMode=mirrored。';

function isRunningInWsl() {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    const osRelease = fs.readFileSync('/proc/sys/kernel/osrelease', 'utf8');
    return /microsoft|wsl/i.test(osRelease);
  } catch {
    return false;
  }
}

function isWindowsUsersPortFile(filePath) {
  return /^\/mnt\/[a-z]\/Users\//i.test(String(filePath || ''));
}

async function discoverAntigravityHubTarget(port, timeoutMs, portFilePath = '') {
  const listUrl = `http://127.0.0.1:${port}/json/list`;
  let res;
  try {
    res = await fetch(listUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(Math.min(timeoutMs, 6000))
    });
  } catch (err) {
    const connErr = new Error(
      `无法连接本地 CDP 端口 127.0.0.1:${port}（${err && err.message ? err.message : '连接失败'}）。` +
      '请确认 Antigravity 正在运行且已启用本地调试端口（DevToolsActivePort 未过期）。'
    );
    connErr.code = 'CDP_CONNECT_FAILED';
    if (isRunningInWsl() && isWindowsUsersPortFile(portFilePath)) {
      connErr.hints = [WSL2_NAT_HINT];
    }
    throw connErr;
  }

  if (!res.ok) {
    throw new Error(`本地 CDP /json/list 返回 HTTP ${res.status}`);
  }

  const targets = await res.json();
  if (!Array.isArray(targets) || !targets.length) {
    throw new Error('本地 CDP 未返回任何可调试页面目标');
  }

  const ranked = targets
    .map((t) => ({ target: t, score: scoreAntigravityHubTarget(t) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    const sampleUrls = targets
      .filter((t) => t && t.type === 'page')
      .slice(0, 3)
      .map((t) => String(t.url || '').slice(0, 80));
    throw new Error(
      '未在本地 CDP 目标中找到已验证的 Antigravity Hub 页面' +
      (sampleUrls.length ? `（已见页面: ${sampleUrls.join(', ')}）` : '')
    );
  }

  const chosen = ranked[0].target;
  const wsUrl = enforceLoopbackWsUrl(chosen.webSocketDebuggerUrl, port);
  return {
    id: chosen.id || '',
    title: chosen.title || '',
    url: chosen.url || '',
    wsUrl
  };
}

/* ==========================================================================
 * Zero-Dependency Built-in WebSocket CDP Client (Node >= 22)
 * ========================================================================== */
class CdpClient {
  constructor(wsUrl, timeoutMs) {
    this.wsUrl = wsUrl;
    this.timeoutMs = timeoutMs;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;

      const openTimer = setTimeout(() => {
        try { ws.close(); } catch {}
        reject(new Error(`连接本地 CDP WebSocket 超时 (${this.timeoutMs}ms)`));
      }, Math.min(this.timeoutMs, 6000));

      ws.addEventListener('open', () => {
        clearTimeout(openTimer);
        resolve();
      });

      ws.addEventListener('error', () => {
        clearTimeout(openTimer);
        reject(new Error('连接本地 CDP WebSocket 发生错误'));
      });

      ws.addEventListener('message', (event) => {
        let msg;
        try {
          msg = JSON.parse(String(event.data || ''));
        } catch {
          return;
        }
        if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
          const entry = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          clearTimeout(entry.timer);
          if (msg.error) {
            entry.reject(new Error(`CDP ${entry.method} 失败: ${msg.error.message || JSON.stringify(msg.error)}`));
          } else {
            entry.resolve(msg.result);
          }
        }
      });

      ws.addEventListener('close', () => {
        this.closed = true;
        for (const [, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.reject(new Error('CDP WebSocket 连接已关闭'));
        }
        this.pending.clear();
      });
    });
  }

  send(method, params = {}, callTimeoutMs = this.timeoutMs) {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('CDP WebSocket 未处于打开状态'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} 超时 (${callTimeoutMs}ms)`));
      }, callTimeoutMs);

      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  close() {
    this.closed = true;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('CDP 客户端已关闭'));
    }
    this.pending.clear();
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }
}

/* ==========================================================================
 * Process-Level Concurrency Lock (Prevents Double-Fork Races)
 * ========================================================================== */
function acquireFileLock() {
  const lockPath = path.join(os.tmpdir(), 'ag-prism-fork-session.lock');
  const payload = JSON.stringify({ pid: process.pid, ts: Date.now() });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, payload, 'utf8');
      fs.closeSync(fd);
      return () => {
        try { fs.unlinkSync(lockPath); } catch {}
      };
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        try {
          const st = fs.statSync(lockPath);
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch {}
        throw new Error('另一个 fork-session 任务正在运行，请稍后重试（防并发重复分支）');
      }
      throw err;
    }
  }
  throw new Error('无法获取本地并发锁');
}

/* ==========================================================================
 * Remote Page Evaluation Payload (Pure JSON-Parameterized Invocation)
 * ========================================================================== */
function buildForkEvaluationExpression(conversationId, turnNumber, dryRun) {
  const argLiteral = JSON.stringify({ conversationId, turnNumber, dryRun });
  return `(async () => {
    const args = ${argLiteral};
    const href = String(window.location.href || '');
    const isHub = (
      /antigravity|workbench|cascade|jetski/i.test(href) ||
      Boolean(document.querySelector('[data-testid="autoscroll-viewport"], [data-testid="pane-titlebar-toolbar"], #antigravity\\\\.agentSidePanelInputBox')) ||
      typeof window.__agPrismBus === 'object' ||
      typeof window.__agProjectCall === 'function' ||
      typeof window.antigravity === 'object'
    );
    if (!isHub) {
      return { ok: false, code: 'NOT_ANTIGRAVITY_HUB', message: '目标页面不是有效的 Antigravity Hub 上下文', href };
    }

    if (window.__agPrismForkInFlight) {
      return { ok: false, code: 'CONCURRENT_FORK', message: '页面内已有正在执行的分支任务，请稍候' };
    }

    // Inspect currently loaded turns if the target conversation is active in DOM
    const userTurns = Array.from(document.querySelectorAll('[data-testid="user-message-content"]'))
      .filter((n) => n && n.isConnected && (n.textContent || '').trim().length > 0);
    const totalLoadedTurns = userTurns.length;
    const isCurrentConvInUrl = href.includes(args.conversationId);

    if (isCurrentConvInUrl && args.turnNumber !== null && totalLoadedTurns > 0 && args.turnNumber > totalLoadedTurns) {
      return {
        ok: false,
        code: 'TURN_OUT_OF_RANGE',
        message: '指定轮次 #' + args.turnNumber + ' 超出当前已加载轮次数 (' + totalLoadedTurns + ')，请先加载历史消息后重试',
        totalLoadedTurns
      };
    }

    const turnPreview = (isCurrentConvInUrl && args.turnNumber !== null && userTurns[args.turnNumber - 1])
      ? String(userTurns[args.turnNumber - 1].textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60)
      : '';

    const hooks = [];
    if (typeof window.__agPrismForkConversation === 'function') hooks.push('__agPrismForkConversation');
    if (typeof window.__agForkConversation === 'function') hooks.push('__agForkConversation');
    if (window.antigravity && typeof window.antigravity.ForkConversation === 'function') hooks.push('antigravity.ForkConversation');
    if (window.antigravity && typeof window.antigravity.forkConversation === 'function') hooks.push('antigravity.forkConversation');
    if (window.__antigravity && typeof window.__antigravity.ForkConversation === 'function') hooks.push('__antigravity.ForkConversation');
    if (window.__antigravity && typeof window.__antigravity.forkConversation === 'function') hooks.push('__antigravity.forkConversation');
    if (typeof window.__agProjectCall === 'function') hooks.push('__agProjectCall');

    if (args.dryRun) {
      return {
        ok: true,
        dryRun: true,
        href,
        conversationId: args.conversationId,
        turnNumber: args.turnNumber,
        isCurrentConvInUrl,
        totalLoadedTurns,
        turnPreview,
        availableHooks: hooks
      };
    }

    window.__agPrismForkInFlight = true;
    try {
      const reqPayload = {
        conversationId: args.conversationId,
        cascadeId: args.conversationId,
        turnNumber: args.turnNumber,
        turnIndex: args.turnNumber !== null ? args.turnNumber - 1 : null
      };

      const directFns = [
        ['__agPrismForkConversation', typeof window.__agPrismForkConversation === 'function' ? window.__agPrismForkConversation : null],
        ['__agForkConversation', typeof window.__agForkConversation === 'function' ? window.__agForkConversation : null],
        ['antigravity.ForkConversation', window.antigravity && typeof window.antigravity.ForkConversation === 'function' ? (p) => window.antigravity.ForkConversation(p) : null],
        ['antigravity.forkConversation', window.antigravity && typeof window.antigravity.forkConversation === 'function' ? (p) => window.antigravity.forkConversation(p) : null],
        ['__antigravity.ForkConversation', window.__antigravity && typeof window.__antigravity.ForkConversation === 'function' ? (p) => window.__antigravity.ForkConversation(p) : null],
        ['__antigravity.forkConversation', window.__antigravity && typeof window.__antigravity.forkConversation === 'function' ? (p) => window.__antigravity.forkConversation(p) : null]
      ];

      for (const [name, fn] of directFns) {
        if (!fn) continue;
        const result = await fn(reqPayload);
        return {
          ok: true,
          via: name,
          conversationId: args.conversationId,
          turnNumber: args.turnNumber,
          turnPreview,
          result: result && typeof result === 'object' ? result : { value: result ?? null }
        };
      }

      if (typeof window.__agProjectCall === 'function') {
        try {
          const rpcRes = await window.__agProjectCall('forkConversation', reqPayload, 12000);
          if (rpcRes && rpcRes.ok) {
            return {
              ok: true,
              via: '__agProjectCall:forkConversation',
              conversationId: args.conversationId,
              turnNumber: args.turnNumber,
              turnPreview,
              result: rpcRes
            };
          }
        } catch {}
      }

      return {
        ok: false,
        code: 'FORK_HOOK_NOT_FOUND',
        message: '已连接到 Antigravity Hub 页面，但未检测到全局 ForkConversation 桥接接口（无损安全降级，未对会话做任何修改）。',
        hints: [
          '原版（stock）Antigravity 构建可能默认不向页面全局暴露 ForkConversation 桥接方法，此为预期内的非破坏性降级。',
          '如需执行自动分支，请使用暴露 ForkConversation 桥接的构建/扩展，或先运行 --dry-run 查看当前页面检测到的可用钩子。'
        ],
        href,
        isCurrentConvInUrl,
        totalLoadedTurns,
        availableHooks: hooks
      };
    } catch (err) {
      return {
        ok: false,
        code: 'FORK_EXEC_ERROR',
        message: String(err && err.message ? err.message : err)
      };
    } finally {
      window.__agPrismForkInFlight = false;
    }
  })()`;
}

/* ==========================================================================
 * Main Entrypoint
 * ========================================================================== */
function emitOutput(opts, data, exitCode = 0) {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else if (data.ok) {
    if (data.dryRun) {
      process.stdout.write(
        `[Dry-Run 就绪] 已验证 Antigravity Hub (${data.target?.title || data.target?.url || 'local'})\n` +
        `  会话 ID: ${data.conversationId}\n` +
        `  目标轮次: ${data.turnNumber ?? '末尾'}\n` +
        `  页面当前已加载轮次: ${data.totalLoadedTurns ?? 0}\n` +
        `  检测到分支接口: ${(data.availableHooks && data.availableHooks.length) ? data.availableHooks.join(', ') : '无（原版 Antigravity 构建可能未暴露全局 ForkConversation 桥接）'}\n`
      );
    } else {
      const forkedId = data.result?.conversationId || data.result?.newConversationId || data.result?.id || '';
      process.stdout.write(
        `[分支成功] 已从会话 ${data.conversationId}` +
        (data.turnNumber !== null ? ` 第 ${data.turnNumber} 轮` : '') +
        ` 创建新分支` +
        (forkedId ? ` -> ${forkedId}` : '') +
        ` (via ${data.via})\n`
      );
    }
  } else {
    process.stderr.write(`[分支失败] ${data.message || '未知错误'}\n`);
    if (Array.isArray(data.hints) && data.hints.length) {
      for (const h of data.hints) {
        process.stderr.write(`  - ${h}\n`);
      }
    }
  }
  process.exitCode = exitCode;
}

async function main() {
  let opts;
  try {
    opts = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`[参数错误] ${err.message}\n`);
    process.exitCode = 2;
    return;
  }

  if (opts.help) {
    printUsage();
    return;
  }

  if (typeof WebSocket !== 'function' || typeof fetch !== 'function') {
    emitOutput(opts, {
      ok: false,
      code: 'NODE_VERSION_TOO_OLD',
      message: `需要 Node.js >= 22（内置 WebSocket 与 fetch），当前版本为 ${process.version}`
    }, 1);
    return;
  }

  let releaseLock = null;
  let cdp = null;

  try {
    releaseLock = acquireFileLock();

    const { checked, existing } = collectPortFileCandidates(opts.portFile);
    if (!existing.length) {
      emitOutput(opts, {
        ok: false,
        code: 'CDP_PORT_FILE_NOT_FOUND',
        message: '未找到本地 Antigravity 的 DevToolsActivePort 文件（CDP 调试端口未启用或 Antigravity 未运行）。',
        checkedPaths: checked,
        hints: [
          '请先以调试端口模式启动 Antigravity，或确认其用户数据目录下存在 DevToolsActivePort。',
          '也可通过环境变量 ANTIGRAVITY_CDP_PORT_FILE 或 --port-file <路径> 显式指定端口文件。',
          `已检索路径数: ${checked.length}${checked.length ? `（示例: ${checked[0]}）` : ''}`
        ]
      }, 1);
      return;
    }

    const active = readDevToolsActivePort(existing[0].filePath);
    const target = await discoverAntigravityHubTarget(active.port, opts.timeoutMs, active.filePath);

    cdp = new CdpClient(target.wsUrl, opts.timeoutMs);
    try {
      await cdp.connect();
    } catch (wsErr) {
      if (isRunningInWsl() && isWindowsUsersPortFile(active.filePath)) {
        wsErr.hints = Array.isArray(wsErr.hints) ? [...wsErr.hints, WSL2_NAT_HINT] : [WSL2_NAT_HINT];
      }
      throw wsErr;
    }

    const expression = buildForkEvaluationExpression(opts.conversationId, opts.turnNumber, opts.dryRun);
    const evalRes = await cdp.send(
      'Runtime.evaluate',
      {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true
      },
      opts.timeoutMs
    );

    if (evalRes && evalRes.exceptionDetails) {
      const desc = evalRes.exceptionDetails.exception?.description || evalRes.exceptionDetails.text || '页面脚本执行异常';
      emitOutput(opts, {
        ok: false,
        code: 'CDP_EVAL_EXCEPTION',
        message: `在 Antigravity Hub 执行分支调用时发生异常：${desc}`
      }, 1);
      return;
    }

    const value = evalRes?.result?.value;
    if (!value || typeof value !== 'object') {
      emitOutput(opts, {
        ok: false,
        code: 'CDP_EMPTY_RESPONSE',
        message: 'Antigravity Hub 未返回有效结果'
      }, 1);
      return;
    }

    if (!value.ok) {
      emitOutput(opts, {
        ...value,
        target: { title: target.title, url: target.url },
        portFile: active.filePath
      }, 1);
      return;
    }

    emitOutput(opts, {
      ...value,
      target: { title: target.title, url: target.url },
      portFile: active.filePath
    }, 0);
  } catch (err) {
    const payload = {
      ok: false,
      code: (err && err.code) || 'FORK_CLI_ERROR',
      message: err && err.message ? err.message : String(err)
    };
    if (err && Array.isArray(err.hints) && err.hints.length) {
      payload.hints = err.hints;
    }
    emitOutput(opts, payload, 1);
  } finally {
    if (cdp) {
      try { cdp.close(); } catch {}
    }
    if (releaseLock) {
      try { releaseLock(); } catch {}
    }
  }
}

await main();
