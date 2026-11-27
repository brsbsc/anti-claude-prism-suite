/**
 * Upstream Radar for Anti-Claude Prism Suite (v0.5.0).
 *
 * Core principle: SELECTIVE ADOPTION ONLY (绝不照搬照抄 · 由用户决定是否融合)
 * - Compares each tracked upstream against upstream.json baselines via GitHub Releases & Compare APIs.
 * - Classifies changes into:
 *     1. compatFixes        (breaking host hooks / auth credential path fixes -> must inspect)
 *     2. featureCandidates  (useful or fun new features -> presented as optional user-decided candidates)
 *     3. skippedNoise       (upstream-specific docs, self-branding, CI/packaging noise -> skip)
 * - Enforces Clean-Room boundaries (e.g., GPL-3.0 repos never supply code, only conceptual inspiration).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  acquireFileLock,
  detectIsWsl,
  listWslWindowsUserDirs,
  resolvePowerShellExe,
  resolveSafeExecCwd,
  resolveWslInteropEnv,
  writeJsonAtomic
} from './platform-utils.mjs';

const execFileAsync = promisify(execFile);

export const UPSTREAM_SCHEMA_VERSION = 2;
const RADAR_CACHE_SCHEMA_VERSION = 4;
const PRISM_OFFICIAL_REPO = 'wushuai0802/anti-claude-prism-suite';
const REPO_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const MAX_TAR_ENTRIES = 2000;
const MAX_TAR_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'codeload.github.com'
]);

const UPSTREAM_ZH_META = {
  'anti-claude': {
    displayNameZh: 'Anti-Claude（主界面核心）',
    roleZh: 'Antigravity 界面美化与守护进程上游'
  },
  'agy-powertools': {
    displayNameZh: 'agy-powertools（启动器与效率参考）',
    roleZh: '快捷方式启动、多账号与多语言思路参考'
  },
  'obsidian-prism': {
    displayNameZh: 'obsidian-prism（视觉特效参考）',
    roleZh: '粒子球与动效交互参考（GPL 仅借思路不搬代码）'
  },
  'agy-switch': {
    displayNameZh: 'agy-switch（切号机制参考）',
    roleZh: '多账号切换流程与安全边界参考'
  },
  'windows-mcp': {
    displayNameZh: 'Windows-MCP（桌面无障碍操控参考）',
    roleZh: 'UIA 无障碍树压缩、操控状态浮层与显式授权机制参考'
  },
  'playwright-mcp': {
    displayNameZh: 'Playwright-MCP（浏览器无障碍操控参考）',
    roleZh: '浏览器扩展桥协议与无障碍快照压缩策略参考（Apache-2.0）'
  },
  'antigravity-codex-computer-control': {
    displayNameZh: 'antigravity-codex-computer-control（安全策略与增量对比参考）',
    roleZh: '操控安全拦截策略与动作前后增量 diff 思路参考（禁二进制）'
  }
};
UPSTREAM_ZH_META['mac-codex-cua'] = UPSTREAM_ZH_META['antigravity-codex-computer-control'];

function resolveUpstreamZhMeta(key, entry = {}) {
  const kebabKey = String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  const repoSlug = String(entry?.repo || '').split('/').pop()?.toLowerCase() || '';
  return (
    UPSTREAM_ZH_META[kebabKey] ||
    UPSTREAM_ZH_META[repoSlug] || {
      displayNameZh: entry?.repo || key,
      roleZh: entry?.role || ''
    }
  );
}

export function compareSemver(a, b) {
  const parse = (v) => {
    const clean = String(v || '').replace(/^v/i, '').trim().split('+')[0];
    const dashIdx = clean.indexOf('-');
    const core = (dashIdx === -1 ? clean : clean.slice(0, dashIdx)).split('.').map((n) => parseInt(n, 10) || 0);
    const pre = dashIdx === -1 ? [] : clean.slice(dashIdx + 1).split('.').filter(Boolean);
    return { core, pre };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((pa.core[i] || 0) !== (pb.core[i] || 0)) return (pa.core[i] || 0) - (pb.core[i] || 0);
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i++) {
    if (i >= pa.pre.length) return -1;
    if (i >= pb.pre.length) return 1;
    const sa = pa.pre[i];
    const sb = pb.pre[i];
    const na = /^\d+$/.test(sa) ? Number(sa) : null;
    const nb = /^\d+$/.test(sb) ? Number(sb) : null;
    if (na !== null && nb !== null) {
      if (na !== nb) return na - nb;
    } else if (na !== null) {
      return -1;
    } else if (nb !== null) {
      return 1;
    } else if (sa !== sb) {
      return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

function stripConventionalPrefix(msg) {
  const raw = String(msg || '').split(/\r?\n/)[0].trim();
  const m = raw.match(/^(feat|fix|perf|refactor|security|docs?|chore|ci|build|style|test)(?:\(([^)]+)\))?!?:\s*(.+)$/i);
  if (!m) return { prefix: '', scope: '', body: raw };
  return { prefix: m[1].toLowerCase(), scope: (m[2] || '').trim(), body: (m[3] || '').trim() };
}

function tagZhForPrefix(prefix, msg) {
  const p = String(prefix || '').toLowerCase();
  if (p === 'feat') return '新功能';
  if (p === 'fix') return '修复';
  if (p === 'perf') return '性能';
  if (p === 'security') return '安全';
  if (p === 'refactor') return '优化';
  if (/\b(fix|bug|crash|timeout|leak|security)\b/i.test(msg)) return '修复';
  if (/\b(feat|add|support|new)\b/i.test(msg)) return '新功能';
  return '更新';
}

const PRE_MT_TERM_REPLACEMENTS = [
  [/\bpure[-\s]?Node(?:\.js)?\b/gi, '纯Node.js'],
  [/\bNode\.js\b/gi, 'Node.js'],
  [/\bWindows\s+\.lnk\s+helper\b/gi, 'Windows快捷方式启动器'],
  [/\.lnk\b/gi, '.lnk快捷方式'],
  [/\bLNK\b/g, '.lnk快捷方式'],
  [/\btooltipNote\b/gi, '运行中提示条(tooltipNote)'],
  [/\bProject\s+composer\b/gi, '项目输入框'],
  [/\bcomposer\b/gi, '输入框'],
  [/\bmodel\s+menu\b/gi, '模型选择菜单'],
  [/\bHoverCard\s+portal\s+isolation\b/gi, 'HoverCard浮层隔离'],
  [/\bportal\s+isolation\b/gi, '浮层容器隔离'],
  [/\bhost[-\s]?i18n\s+hot[-\s]?heal\b/gi, '宿主汉化热自愈'],
  [/\bhost[-\s]?i18n\b/gi, '宿主汉化'],
  [/\bhot[-\s]?heal\b/gi, '热自愈'],
  [/\bhot[-\s]?reload\b/gi, '热重载'],
  [/\bACP\s+filter\b/gi, 'ACP进程过滤'],
  [/\bloop\s+throttle\b/gi, '循环节流'],
  [/\bsubtle[-\s]?motion\s+mascot\s+guard\b/gi, '微动效模式桌宠防误触保护'],
  [/\bsubtle[-\s]?motion\b/gi, '微动效模式'],
  [/\bmascot\s+guard\b/gi, '桌宠防误触保护'],
  [/\bmascot\b/gi, '像素桌宠'],
  [/\bdark\s+aura\s+presets?\b/gi, '深色极光背景预设'],
  [/\bOrchestrator\s+L2\s+submenu\b/gi, 'Orchestrator二级子菜单'],
  [/\bcamp[-\s]?aware\s+colors?\b/gi, '模型家族区分配色'],
  [/\bModels\s+tab\b/gi, '模型页签'],
  [/\bcustom\s+property\b/gi, 'CSS变量'],
  [/\bexternal\s+dashboard\b/gi, '外部面板'],
  [/\bFile\.Replace\s+stall\b/gi, 'File.Replace杀软卡顿'],
  [/\brepo[-\s]?hygiene\s+gates?\b/gi, '仓库规范门禁'],
  [/\bzero[-\s]?AMSI\b/gi, '防杀软误报(免AMSI拦截)'],
  [/\bToS\s+sync\b/gi, '服务条款状态同步'],
  [/\brelaunch\b/gi, '自动重启'],
  [/\bi18n\b/gi, '多语言汉化'],
  [/\baccessibility\s+snapshots?\b/gi, '无障碍快照'],
  [/\baccessibility\s+trees?\b/gi, '无障碍树'],
  [/\bUIA\s+trees?\b/gi, 'UIA无障碍树'],
  [/\bbrowser\s+extension\s+bridge\b/gi, '浏览器扩展桥'],
  [/\bextension\s+bridge\b/gi, '浏览器扩展桥'],
  [/\bcontrol[\s_-]?overlay\b/gi, '操控状态浮层'],
  [/\bcontrol[\s_-]?consent\b/gi, '显式操控授权(control_consent)'],
  [/\bsafety[\s_-]?policy\b/gi, '安全拦截策略'],
  [/\banonymized[\s_-]?telemetry\b/gi, '匿名遥测'],
  [/\btelemetry\b/gi, '遥测']
];

function preRewriteTermsForMt(text) {
  let out = String(text || '');
  for (const [re, rep] of PRE_MT_TERM_REPLACEMENTS) {
    out = out.replace(re, rep);
  }
  return out;
}

export function polishZhTechTerms(text) {
  return String(text || '')
    .replace(/纯节点/g, '纯 Node.js ')
    .replace(/滤波器/g, '过滤')
    .replace(/环路节流阀|节流阀/g, '循环节流')
    .replace(/微妙运动/g, '微动效模式')
    .replace(/吉祥物护卫|吉祥物守卫/g, '桌宠防误触保护')
    .replace(/吉祥物/g, '像素桌宠')
    .replace(/门户隔离/g, '浮层容器隔离')
    .replace(/主机[-\s]*多语言汉化/g, '宿主多语言汉化')
    .replace(/黑暗光环/g, '深色极光背景')
    .replace(/模型选项卡/g, '模型页签')
    .replace(/外部仪表板/g, '外部面板')
    .replace(/可访问性树|辅助功能树/g, '无障碍树')
    .replace(/可访问性快照|辅助功能快照/g, '无障碍快照')
    .replace(/(?<!浏览器)扩展桥接?(?:器)?/g, '浏览器扩展桥')
    .replace(/控制覆盖(?:层)?|操控覆盖(?:层)?/g, '操控状态浮层')
    .replace(/\.lnk\s*(?:helper|快捷方式)?/gi, '.lnk 快捷方式')
    .replace(/\btooltipNote\b/gi, '运行中提示条(tooltipNote)')
    .replace(/\bProject composer\b/gi, '项目输入框')
    .replace(/\bcomposer\b/gi, '输入框')
    .replace(/\bmodel menu\b/gi, '模型选择菜单')
    .replace(/\brelaunch\b/gi, '自动重启')
    .replace(/\bToS\s*sync\b/gi, '服务条款状态同步')
    .replace(/\bzero-AMSI\b/gi, '防杀软误报(免AMSI拦截)')
    .replace(/\bAMSI\b/g, 'AMSI')
    .replace(/\bi18n\b/gi, '多语言汉化')
    .replace(/\bCI test\b/gi, 'CI 自动测试')
    .replace(/\baccessibility\s+snapshots?\b/gi, '无障碍快照')
    .replace(/\baccessibility\s+trees?\b/gi, '无障碍树')
    .replace(/\bbrowser\s+extension\s+bridge\b/gi, '浏览器扩展桥')
    .replace(/\bextension\s+bridge\b/gi, '浏览器扩展桥')
    .replace(/\bcontrol[\s_-]?overlay\b/gi, '操控状态浮层')
    .replace(/\bcontrol[\s_-]?consent\b/gi, '显式操控授权(control_consent)')
    .replace(/\btelemetry\b/gi, '遥测')
    .replace(/\s+/g, ' ')
    .trim();
}

export function localizeCommitLocally(rawMsg) {
  const { prefix, body } = stripConventionalPrefix(rawMsg);
  const tagZh = tagZhForPrefix(prefix, rawMsg);
  if (/[\u4e00-\u9fff]/.test(body)) {
    return { tagZh, summaryZh: polishZhTechTerms(body) };
  }
  const phraseRules = [
    [/^support dragging and pasting local files\s*(?:&|and)\s*folders in Project composer$/i, '支持在项目输入框中直接拖拽和粘贴本地文件与文件夹'],
    [/^adapt model menu to Antigravity\s+(v?[\d.]+)\s+tooltipNote$/i, '适配 Antigravity $1 运行中模型菜单提示属性(tooltipNote)与双语提示条'],
    [/^extend Windows \.lnk helper timeout to (\d+s) and pass full env in CI test$/i, '延长 Windows .lnk 快捷方式启动器超时至 $1，并在 CI 测试中传递完整环境变量'],
    [/^zero-AMSI Windows \.lnk relaunch, multi-account ToS sync, Skills i18n, and auto-check update reminders(?:\s*\((v?[\d.]+)\))?$/i, '防杀软误报的 Windows .lnk 快捷方式重启、多账号服务条款同步、Skills 汉化与自动检查更新提醒'],
    [/^use fileURLToPath instead of URL\.pathname for spaced\/non-ASCII repo paths(.*)$/i, '改用 fileURLToPath 修复含空格或非 ASCII 中文路径下的跨平台测试解析$1'],
    [/^bump version to\s+(.+)$/i, '版本号升级至 $1']
  ];
  for (const [re, rep] of phraseRules) {
    if (re.test(body)) {
      return { tagZh, summaryZh: body.replace(re, rep).trim() };
    }
  }
  // Avoid awkward word-by-word Chinglish on unknown commits; keep clean stripped subject when offline
  return { tagZh, summaryZh: body || String(rawMsg || '').trim() };
}

export function extractZhReleaseHighlights(releaseBodies = [], maxItems = 12) {
  const bodies = Array.isArray(releaseBodies) ? releaseBodies : [releaseBodies];
  const out = [];
  const seen = new Set();
  for (const rawBody of bodies) {
    if (!rawBody || typeof rawBody !== 'string') continue;
    let inAckOrSkipSection = false;
    for (const rawLine of rawBody.split(/\r?\n/)) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      if (/^#{1,4}\s+/.test(trimmed)) {
        inAckOrSkipSection = /acknowledg|credits|致谢|standalone installers|独立安装包|english\s+(?:release\s+)?notes/i.test(trimmed);
        continue;
      }
      if (inAckOrSkipSection) continue;
      const m = trimmed.match(/^[-*]\s+(.+)$/);
      if (!m) continue;
      // Skip pure English italic translation lines like `*Unified Smoked...*`
      if (/^\*[^*]+\*$/.test(m[1].trim()) && !/[\u4e00-\u9fff]{4,}/.test(m[1])) continue;
      const cleaned = m[1]
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleaned || cleaned.length < 8 || !/[\u4e00-\u9fff]{4,}/.test(cleaned)) continue;
      if (/^(?:代码贡献|问题定位|衷心感谢|Windows\s*\(|macOS\s*\(|Linux\s*\()/i.test(cleaned)) continue;
      const shortLine = cleaned.length > 140 ? `${cleaned.slice(0, 138)}…` : cleaned;
      const dedupKey = shortLine.slice(0, 36);
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      out.push(shortLine);
      if (out.length >= maxItems) return out;
    }
  }
  return out;
}

async function translateBatchToZh(texts, { fetchImpl = globalThis.fetch } = {}) {
  const unique = [];
  const seen = new Set();
  for (const t of texts) {
    const clean = String(t || '').trim();
    if (!clean || /[\u4e00-\u9fff]{4,}/.test(clean) || seen.has(clean)) continue;
    seen.add(clean);
    unique.push(clean);
  }
  const map = new Map();
  if (!unique.length || typeof fetchImpl !== 'function') return map;
  const batch = unique.slice(0, 28);
  // Pre-rewrite domain terms & use numbered lines so machine translation stays idiomatic
  const joined = batch.map((line, i) => `[${i + 1}] ${preRewriteTermsForMt(line)}`).join('\n');
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(joined)}`;
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': 'anti-claude-prism-suite' },
      signal: AbortSignal.timeout(3500)
    });
    if (!res || !res.ok) return map;
    const data = await res.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) return map;
    const full = data[0].map((seg) => (Array.isArray(seg) ? String(seg[0] || '') : '')).join('');
    for (const line of full.split(/\r?\n/)) {
      const m = line.trim().match(/^[\[【]\s*(\d+)\s*[\]】]\s*(.+)$/);
      if (!m) continue;
      const idx = Number(m[1]) - 1;
      if (idx >= 0 && idx < batch.length) {
        const zh = polishZhTechTerms(m[2]);
        if (zh) map.set(batch[idx], zh);
      }
    }
  } catch {
    // Graceful fallback to local phrase/clean subject
  }
  return map;
}

function pathMatchesPattern(filePath, pattern) {
  const f = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const p = String(pattern || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!f || !p) return false;
  if (p.endsWith('/')) return f.startsWith(p);
  return f === p || f.startsWith(`${p}/`);
}

function classifyCommitMessage(msg, role = '') {
  const first = String(msg || '').split(/\r?\n/)[0].trim();
  const low = first.toLowerCase();
  if (/^(docs?|chore|ci|build|style|test)(\(.+\))?:|\b(readme|changelog|bump version|release v|typo|license)\b/i.test(low)) {
    return 'noise';
  }
  const isHostOrSecuritySignal = /\b(antigravity\s*v?\d+\.\d+|v2\.3\d|compat|credential|keychain|credman|oauth|amsi|defender|klif|kaspersky)\b/i.test(low);
  if (role === 'inspiration-only' || role === 'ecosystem-watch') {
    return isHostOrSecuritySignal ? 'compat' : 'feature';
  }
  if (role === 'cua-reference' || role === 'browser-cua-reference') {
    const isCuaBreakingOrSecurity =
      /^security(\(.+\))?:/i.test(low) ||
      /^(?:feat|fix|refactor)(\([^)]*\))?!:/i.test(low) ||
      /\b(security|cve(?:-\d{4}-\d+)?|(?:control_)?consent|(?:prompt[\s_-]+)?injection|sandbox|extension[\s_-]+protocol|antigravity)\b/i.test(low) ||
      /\bbreaking\b.*\b(accessibility|uia|extension|protocol|consent)\b/i.test(low);
    return isCuaBreakingOrSecurity ? 'compat' : 'feature';
  }
  if (isHostOrSecuritySignal || /^(fix|perf|refactor|security)(\(.+\))?:|\b(daemon|hook|crash|leak)\b/i.test(low)) {
    return 'compat';
  }
  if (/^(feat|add|support)(\(.+\))?:|\b(new|feature|theme|widget|orb|mascot|tab|search|switch)\b/i.test(low)) {
    return 'feature';
  }
  return 'other';
}

function loadUpstreamConfig(configPath) {
  const resolved = path.resolve(configPath);
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  return { configPath: resolved, config: raw };
}

export function evaluateRepoUpdate(key, entry, fetched = {}) {
  const baselineTag = String(entry.baselineTag || '').trim();
  const baselineCommit = String(entry.baselineCommit || '').trim();
  const watchedPaths = Array.isArray(entry.watchedPaths) ? entry.watchedPaths : (Array.isArray(entry.trackedPaths) ? entry.trackedPaths : []);
  const excludedPaths = Array.isArray(entry.excludedPaths) ? entry.excludedPaths : [];

  const latestTag = String(fetched.latestTag || '').trim();
  const latestIsPrerelease = Boolean(fetched.latestIsPrerelease);
  const latestCommit = String(fetched.latestCommit || '').trim();
  const latestDate = String(fetched.latestDate || '').trim();
  const latestMessage = String(fetched.latestMessage || '').split(/\r?\n/)[0].slice(0, 120);
  const releaseName = String(fetched.releaseName || latestTag || '').trim();
  const releaseBodies = Array.isArray(fetched.releaseBodies) && fetched.releaseBodies.length
    ? fetched.releaseBodies
    : (fetched.releaseNotes ? [String(fetched.releaseNotes)] : []);
  const releaseNotes = String(fetched.releaseNotes || releaseBodies[0] || '').trim().slice(0, 1600);
  const zhReleaseHighlights = extractZhReleaseHighlights(releaseBodies, 12);
  const releaseUrl = String(fetched.releaseUrl || (latestTag ? `https://github.com/${entry.repo}/releases/tag/${latestTag}` : '')).trim();
  const compareCommits = Array.isArray(fetched.commits) ? fetched.commits : [];
  const changedFiles = Array.isArray(fetched.changedFiles) ? fetched.changedFiles : [];
  const aheadBy = Number.isFinite(Number(fetched.aheadBy)) ? Number(fetched.aheadBy) : compareCommits.length;

  if (fetched.error) {
    const zhMeta = resolveUpstreamZhMeta(key, entry);
    return {
      key,
      repo: entry.repo,
      displayNameZh: zhMeta.displayNameZh,
      roleZh: zhMeta.roleZh,
      role: entry.role || '',
      license: entry.license || '',
      absorptionPolicy: entry.absorptionPolicy || 'selective',
      adoptionBoundary: entry.adoptionBoundary || '',
      baselineTag,
      baselineCommit,
      latestTag,
      latestCommit: latestCommit ? latestCommit.slice(0, 7) : '',
      latestDate,
      latestMessage,
      hasUpdate: false,
      impactLevel: 'ERROR',
      aheadBy: 0,
      watchedHits: [],
      compatFixes: [],
      featureCandidates: [],
      skippedNoise: [],
      rateLimited: Boolean(fetched.rateLimited),
      rateLimitReset: fetched.rateLimitReset || '',
      error: String(fetched.error)
    };
  }

  const tagChanged = Boolean(latestTag && baselineTag && latestTag !== baselineTag);
  const shaChanged = Boolean(latestCommit && baselineCommit && !latestCommit.toLowerCase().startsWith(baselineCommit.toLowerCase()));
  const hasUpdate = tagChanged || shaChanged || aheadBy > 0;

  if (!hasUpdate) {
    const zhMeta = resolveUpstreamZhMeta(key, entry);
    return {
      key,
      repo: entry.repo,
      displayNameZh: zhMeta.displayNameZh,
      roleZh: zhMeta.roleZh,
      role: entry.role || '',
      license: entry.license || '',
      absorptionPolicy: entry.absorptionPolicy || 'selective',
      adoptionBoundary: entry.adoptionBoundary || '',
      baselineTag,
      baselineCommit,
      latestTag: latestTag || baselineTag,
      latestCommit: (latestCommit || baselineCommit).slice(0, 7),
      latestDate,
      latestMessage,
      hasUpdate: false,
      impactLevel: 'UP_TO_DATE',
      aheadBy: 0,
      watchedHits: [],
      compatFixes: [],
      featureCandidates: [],
      skippedNoise: [],
      releaseUrl,
      rateLimited: false,
      error: ''
    };
  }

  const watchedHits = [];
  const skippedFiles = [];
  for (const f of changedFiles) {
    const filename = typeof f === 'string' ? f : String(f?.filename || '');
    if (!filename) continue;
    if (watchedPaths.some((p) => pathMatchesPattern(filename, p))) {
      watchedHits.push(filename);
    } else if (excludedPaths.some((p) => pathMatchesPattern(filename, p))) {
      skippedFiles.push(filename);
    }
  }

  const compatFixes = [];
  const featureCandidates = [];
  const skippedNoise = [];

  for (const c of compareCommits.slice(0, 30)) {
    const sha = String(c?.sha || '').slice(0, 7);
    const msg = String(c?.message || c?.commit?.message || '').split(/\r?\n/)[0].trim();
    if (!msg) continue;
    const loc = localizeCommitLocally(msg);
    const kind = classifyCommitMessage(msg, entry.role || '');
    const tagZh = kind === 'compat' && loc.tagZh === '新功能' ? '兼容适配' : loc.tagZh;
    const item = { sha, message: msg, tagZh, summaryZh: loc.summaryZh };
    if (kind === 'compat') compatFixes.push(item);
    else if (kind === 'feature') featureCandidates.push(item);
    else if (kind === 'noise') skippedNoise.push(item);
    else featureCandidates.push(item);
  }

  if (skippedFiles.length > 0 && skippedNoise.length === 0) {
    skippedNoise.push({ sha: '-', message: `命中建议跳过目录/文件 (${skippedFiles.slice(0, 4).join(', ')})`, tagZh: '跳过', summaryZh: `命中建议跳过目录/文件 (${skippedFiles.slice(0, 4).join(', ')})` });
  }

  // Fallback signal if commit list empty (e.g., tag changed without compare)
  if (!compatFixes.length && !featureCandidates.length && !skippedNoise.length && latestMessage) {
    const fallbackKind = classifyCommitMessage(latestMessage, entry.role || '');
    const loc = localizeCommitLocally(latestMessage);
    const fallbackItem = { sha: latestCommit.slice(0, 7), message: latestMessage, tagZh: loc.tagZh, summaryZh: loc.summaryZh };
    if (fallbackKind === 'compat') compatFixes.push(fallbackItem);
    else if (fallbackKind === 'noise') skippedNoise.push(fallbackItem);
    else featureCandidates.push(fallbackItem);
  }

  const isHostOrFeatureRef = entry.role === 'host-runtime' || entry.role === 'feature-reference';
  let impactLevel = 'LOW';
  if (watchedHits.length > 0 || (tagChanged && isHostOrFeatureRef) || (entry.role === 'host-runtime' && compatFixes.length > 0)) {
    impactLevel = 'HIGH';
  } else if (tagChanged || compatFixes.length > 0 || featureCandidates.length > 0) {
    impactLevel = 'MEDIUM';
  }

  const zhMeta = resolveUpstreamZhMeta(key, entry);

  return {
    key,
    repo: entry.repo,
    displayNameZh: zhMeta.displayNameZh,
    roleZh: zhMeta.roleZh,
    role: entry.role || '',
    license: entry.license || '',
    absorptionPolicy: entry.absorptionPolicy || 'selective',
    adoptionBoundary: entry.adoptionBoundary || '',
    baselineTag,
    baselineCommit,
    latestTag: latestTag || baselineTag,
    latestIsPrerelease,
    latestCommit: (latestCommit || baselineCommit).slice(0, 7),
    latestDate,
    latestMessage,
    releaseName,
    releaseNotes,
    zhReleaseHighlights,
    releaseUrl,
    hasUpdate: true,
    impactLevel,
    aheadBy,
    watchedHits: watchedHits.slice(0, 12),
    compatFixes: compatFixes.slice(0, 20),
    featureCandidates: featureCandidates.slice(0, 20),
    skippedNoise: skippedNoise.slice(0, 10),
    rateLimited: false,
    error: ''
  };
}

async function defaultFetchJson(url, { fetchImpl = globalThis.fetch, token = process.env.GITHUB_TOKEN || '' } = {}) {
  const headers = {
    'User-Agent': 'anti-claude-prism-suite-upstream-radar',
    Accept: 'application/vnd.github+json'
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(9000) });
  if (!res.ok) {
    const remaining = res.headers?.get?.('x-ratelimit-remaining');
    const resetEpoch = Number(res.headers?.get?.('x-ratelimit-reset') || 0);
    const rateLimited = res.status === 429 || (res.status === 403 && remaining === '0');
    const resetIso = resetEpoch ? new Date(resetEpoch * 1000).toISOString() : '';
    throw Object.assign(new Error(rateLimited ? 'GitHub API 触发限流，请稍后再试或配置 GITHUB_TOKEN' : `HTTP ${res.status}`), {
      status: res.status,
      rateLimited,
      rateLimitReset: resetIso
    });
  }
  return res.json();
}

export async function checkUpstreams({
  configPath,
  fetchImpl = globalThis.fetch,
  token = process.env.GITHUB_TOKEN || '',
  cacheFile = path.join(os.homedir(), '.gemini', 'antigravity', 'prism-suite', 'upstream-cache.json'),
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  force = false,
  onlyKeys = []
} = {}) {
  const { configPath: resolvedCfg, config } = loadUpstreamConfig(configPath);
  const upstreams = config.upstreams || {};
  const keys = Object.keys(upstreams).filter((k) => !onlyKeys.length || onlyKeys.includes(k));
  const cfgDigest = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 12);
  const cacheKey = crypto.createHash('sha256').update(`cache-v${RADAR_CACHE_SCHEMA_VERSION}|${resolvedCfg}|${cfgDigest}|${keys.join(',')}`).digest('hex').slice(0, 12);

  if (!force && cacheFile && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (cached && cached.cacheKey === cacheKey && Date.now() - Number(cached.checkedAtMs || 0) < cacheTtlMs) {
        return { ...cached.report, fromCache: true };
      }
    } catch {
      // ignore invalid cache
    }
  }

  const results = await Promise.all(
    keys.map(async (key) => {
      const entry = upstreams[key];
      const repo = String(entry?.repo || '').trim();
      if (!REPO_SLUG_RE.test(repo)) {
        return evaluateRepoUpdate(key, entry || {}, { error: `非法上游仓库标识: ${repo || '(空)'}` });
      }
      try {
        const fetchReleasesWithFallback = async () => {
          try {
            const list = await defaultFetchJson(`https://api.github.com/repos/${repo}/releases?per_page=6`, { fetchImpl, token });
            if (Array.isArray(list) && list.length > 0) return list;
          } catch (err) {
            if (err && err.rateLimited) throw err;
          }
          try {
            const single = await defaultFetchJson(`https://api.github.com/repos/${repo}/releases/latest`, { fetchImpl, token });
            return single && typeof single === 'object' ? [single] : [];
          } catch (err) {
            if (err && err.rateLimited) throw err;
            return [];
          }
        };

        const [relList, commits] = await Promise.all([
          fetchReleasesWithFallback(),
          defaultFetchJson(`https://api.github.com/repos/${repo}/commits?per_page=1`, { fetchImpl, token })
        ]);
        const rel = Array.isArray(relList) && relList.length > 0 ? relList[0] : null;
        const baselineTagClean = String(entry.baselineTag || '').trim();
        const newerRelBodies = [];
        if (Array.isArray(relList)) {
          for (const item of relList) {
            if (!item || typeof item !== 'object') continue;
            if (baselineTagClean && item.tag_name === baselineTagClean) break;
            if (item.body) newerRelBodies.push(String(item.body));
          }
        }
        const head = Array.isArray(commits) ? commits[0] : null;
        const headSha = String(head?.sha || '').trim();
        const baselineCommit = String(entry.baselineCommit || '').trim();

        let compareData = null;
        if (headSha && baselineCommit && !headSha.toLowerCase().startsWith(baselineCommit.toLowerCase())) {
          compareData = await defaultFetchJson(
            `https://api.github.com/repos/${repo}/compare/${encodeURIComponent(baselineCommit)}...${encodeURIComponent(headSha)}`,
            { fetchImpl, token }
          ).catch(() => null);
        }

        return evaluateRepoUpdate(key, entry, {
          latestTag: rel?.tag_name || '',
          latestIsPrerelease: Boolean(rel?.prerelease),
          releaseName: rel?.name || rel?.tag_name || '',
          releaseNotes: rel?.body || '',
          releaseBodies: newerRelBodies,
          releaseUrl: rel?.html_url || '',
          latestCommit: headSha,
          latestDate: String(head?.commit?.committer?.date || '').slice(0, 10),
          latestMessage: head?.commit?.message || '',
          aheadBy: compareData?.ahead_by ?? (compareData?.commits?.length || 0),
          commits: Array.isArray(compareData?.commits)
            ? compareData.commits.map((c) => ({ sha: c.sha, message: c.commit?.message || '' }))
            : [],
          changedFiles: Array.isArray(compareData?.files) ? compareData.files.map((f) => f.filename) : []
        });
      } catch (err) {
        return evaluateRepoUpdate(key, entry, {
          error: String(err?.message || err),
          rateLimited: Boolean(err?.rateLimited),
          rateLimitReset: err?.rateLimitReset || ''
        });
      }
    })
  );

  // Only translate commits that were NOT already cleanly localized into Chinese by local phrase rules
  if (fetchImpl === globalThis.fetch) {
    const bodiesToTranslate = [];
    for (const r of results) {
      for (const c of [...(r.compatFixes || []), ...(r.featureCandidates || []), ...(r.skippedNoise || [])]) {
        if (c.sha === '-') continue;
        if (/[\u4e00-\u9fff]{4,}/.test(String(c.summaryZh || ''))) continue;
        const { body } = stripConventionalPrefix(c.message);
        if (body && !/[\u4e00-\u9fff]{4,}/.test(body)) bodiesToTranslate.push(body);
      }
    }
    if (bodiesToTranslate.length) {
      const zhMap = await translateBatchToZh(bodiesToTranslate, { fetchImpl });
      if (zhMap.size > 0) {
        for (const r of results) {
          for (const c of [...(r.compatFixes || []), ...(r.featureCandidates || []), ...(r.skippedNoise || [])]) {
            if (c.sha === '-' || /[\u4e00-\u9fff]{4,}/.test(String(c.summaryZh || ''))) continue;
            const { body } = stripConventionalPrefix(c.message);
            if (zhMap.has(body)) {
              c.summaryZh = zhMap.get(body);
            }
          }
        }
      }
    }
  }

  const summary = {
    high: results.filter((r) => r.impactLevel === 'HIGH').length,
    medium: results.filter((r) => r.impactLevel === 'MEDIUM').length,
    low: results.filter((r) => r.impactLevel === 'LOW').length,
    upToDate: results.filter((r) => r.impactLevel === 'UP_TO_DATE').length,
    errors: results.filter((r) => r.impactLevel === 'ERROR').length
  };

  const report = {
    schema: UPSTREAM_SCHEMA_VERSION,
    checkedAt: new Date().toISOString(),
    checkedAtMs: Date.now(),
    configUpdatedAt: config.updatedAt || '',
    policyNote: '仅择优评估对本项目有帮助的兼容性修复与实用/有趣新功能，由用户决定是否融合；严禁照搬照抄。',
    fromCache: false,
    summary,
    results
  };

  if (cacheFile && summary.errors === 0) {
    try {
      writeJsonAtomic(cacheFile, { cacheKey, checkedAtMs: report.checkedAtMs, report }, { mode: 0o600, dirMode: 0o700, rejectSymlink: true });
    } catch {
      // non-fatal cache write
    }
  }

  return report;
}

export function renderMarkdownReport(report) {
  const lines = [
    '## Anti-Claude Prism Suite · 上游更新择优评估雷达（Upstream Radar）',
    '',
    `> **原则**：${report.policyNote || '只吸收对我们有帮助的兼容性修复或新增实用/有趣功能，作为候选清单交由用户决定是否融合；严禁照搬照抄。'}`,
    `> 检测时间：${report.checkedAt} ｜ HIGH: ${report.summary?.high ?? 0} ｜ MEDIUM: ${report.summary?.medium ?? 0} ｜ LOW: ${report.summary?.low ?? 0} ｜ 已同步: ${report.summary?.upToDate ?? 0}`,
    '',
    '| 上游仓库 | 角色 / 协议 | 基线 → 最新 | 影响等级 | 候选处理 |',
    '| --- | --- | --- | --- | --- |'
  ];

  for (const r of report.results || []) {
    const baseStr = `${r.baselineTag || '-'}@${r.baselineCommit || '-'}`;
    const latStr = r.impactLevel === 'ERROR' ? '检查失败' : `${r.latestTag || '-'}@${r.latestCommit || '-'}`;
    const badge =
      r.impactLevel === 'HIGH'
        ? '🔴 HIGH'
        : r.impactLevel === 'MEDIUM'
          ? '🟡 MEDIUM'
          : r.impactLevel === 'LOW'
            ? '🟢 LOW'
            : r.impactLevel === 'ERROR'
              ? '⚠️ ERROR'
              : '✅ 已同步';
    const action = r.impactLevel === 'UP_TO_DATE'
      ? '无需动作'
      : r.impactLevel === 'ERROR'
        ? r.error
        : `必看 ${r.compatFixes.length} / 候选 ${r.featureCandidates.length} / 跳过 ${r.skippedNoise.length}`;
    lines.push(`| [${r.repo}](https://github.com/${r.repo}) | \`${r.role}\` (${r.license || '-'}) | \`${baseStr}\` → \`${latStr}\` | ${badge} | ${action} |`);
  }

  const activeUpdates = (report.results || []).filter((r) => r.hasUpdate);
  if (activeUpdates.length) {
    lines.push('', '### 候选融合清单（请用户逐项决定是否融合，未选中项一律跳过）');
    for (const r of activeUpdates) {
      lines.push('', `#### ${r.repo} (\`${r.impactLevel}\`, ahead ${r.aheadBy})`);
      if (r.license && /GPL/i.test(r.license)) {
        lines.push(`> ⚠️ **Clean-Room 隔离红线（${r.license}）**：仅参考 UX 创意与交互构思，严禁复制或移植任何代码到本 MIT 仓库！`);
      } else {
        if (r.license === 'Apache-2.0') {
          lines.push('> 📜 **Apache-2.0 协议合规提醒**：优先以 Clean-Room 方式参考协议与思路；若确需复用任何 Apache-2.0 代码片段，必须保留原版权声明并同步登记 `THIRD_PARTY_NOTICES.md`。');
        }
        if (r.role === 'cua-reference' || r.role === 'browser-cua-reference' || r.key === 'macCodexCua') {
          const boundaryText = r.adoptionBoundary || '仅以 Clean-Room 纯 Node.js 方式参考机制设计。';
          lines.push(`> 🛡️ **CUA 安全与 Clean-Room 边界**：${boundaryText}（硬性红线：严禁引入任何预编译二进制文件、原生驱动或开启遥测！）`);
        } else if (r.adoptionBoundary) {
          lines.push(`> 边界：${r.adoptionBoundary}`);
        }
      }
      if (r.watchedHits.length) {
        lines.push(`- 命中关键路径：${r.watchedHits.map((f) => `\`${f}\``).join(', ')}`);
      }
      if (r.compatFixes.length) {
        lines.push('- **兼容性 / 安全必看（建议优先评估）**：');
        for (const c of r.compatFixes) lines.push(`  - [ ] \`${c.sha}\` ${c.message}`);
      }
      if (r.featureCandidates.length) {
        lines.push('- **新增实用 / 有趣功能候选（供用户勾选决定是否融合）**：');
        for (const c of r.featureCandidates) lines.push(`  - [ ] \`${c.sha}\` ${c.message}`);
      }
      if (r.skippedNoise.length) {
        lines.push(`- 建议自动跳过（杂项 / 上游独有构建）：${r.skippedNoise.map((c) => c.message).slice(0, 3).join('；')}`);
      }
    }
    lines.push(
      '',
      '### 给 AI 的只读评估提示词（可一键复制使用）',
      '```text',
      '请对照上述候选清单，对有更新的上游做只读对比评估：仅挑出对 anti-claude-prism-suite 真正有价值的兼容性修复与实用/有趣功能供我拍板，不要照搬照抄上游全文实现；评估确认后用 node scripts/check-upstream.mjs --sync-baseline 更新基线。',
      '```'
    );
  }

  return lines.join('\n');
}

export function syncUpstreamBaseline(configPath, { keys = [], report = null } = {}) {
  const { configPath: resolvedCfg, config } = loadUpstreamConfig(configPath);
  const upstreams = config.upstreams || {};
  const byKey = new Map((report?.results || []).map((r) => [r.key, r]));
  const updatedKeys = [];

  for (const [k, entry] of Object.entries(upstreams)) {
    if (keys.length && !keys.includes(k)) continue;
    const hit = byKey.get(k);
    if (!hit || hit.impactLevel === 'ERROR') continue;
    const nextTag = hit.latestTag || entry.baselineTag;
    const nextCommit = hit.latestCommit ? hit.latestCommit.slice(0, 7) : entry.baselineCommit;
    if (nextTag !== entry.baselineTag || nextCommit !== entry.baselineCommit) {
      entry.baselineTag = nextTag;
      entry.baselineCommit = nextCommit;
      updatedKeys.push(k);
    }
  }

  if (updatedKeys.length) {
    config.updatedAt = new Date().toISOString().slice(0, 10);
    writeJsonAtomic(resolvedCfg, config, { mode: null, dirMode: 0o755 });
  }

  return { ok: true, configPath: resolvedCfg, updatedKeys, config };
}

/* ============================================================================
 * Prism Suite Self-Update (1-Click Verified Update for End Users)
 * - Strictly pinned to https://github.com/wushuai0802/anti-claude-prism-suite
 * - Mandatory SHA-256 verification before executing silent in-place installer
 * - Updates Windows extensions + Windows plugin + WSL2 plugin in one step
 * ============================================================================ */
function isAllowedPrismReleaseAssetUrl(url, repo = PRISM_OFFICIAL_REPO) {
  const s = String(url || '').trim();
  const escaped = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^https://github\\.com/${escaped}/releases/download/v?\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?/[A-Za-z0-9._-]+$`).test(s);
}

function isAllowedPrismTarballUrl(url, repo = PRISM_OFFICIAL_REPO) {
  const s = String(url || '').trim();
  const escaped = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`^https://github\\.com/${escaped}/archive/refs/tags/v?\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?\\.tar\\.gz$`).test(s) ||
    new RegExp(`^https://github\\.com/${escaped}/releases/download/v?\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?/[A-Za-z0-9._-]+\\.tar\\.gz$`).test(s)
  );
}

function extractReleaseHighlights(body) {
  const lines = String(body || '').split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (/^#{1,6}\s|^>\s|^\|/.test(trimmed)) continue;
    const m = trimmed.match(/^[-*]\s+(.+)$/);
    if (!m) continue;
    const clean = m[1]
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .trim();
    if (clean && clean.length >= 6) {
      out.push(clean.slice(0, 120));
      if (out.length >= 5) break;
    }
  }
  return out;
}

function createWindowsNtfsTempDirForUpdate() {
  const mkSecureDir = (baseDir) => {
    const dir = fs.mkdtempSync(path.join(baseDir, 'prism-suite-update-'));
    try { fs.chmodSync(dir, 0o700); } catch {}
    return dir;
  };
  if (process.platform === 'win32') {
    return mkSecureDir(os.tmpdir());
  }
  const userDirs = listWslWindowsUserDirs();
  let curUser = '';
  try { curUser = String(os.userInfo().username || '').toLowerCase(); } catch {}
  const prioritized = curUser
    ? [
        ...userDirs.filter((d) => path.basename(d).toLowerCase() === curUser),
        ...userDirs.filter((d) => path.basename(d).toLowerCase() !== curUser)
      ]
    : userDirs;
  for (const userDir of prioritized) {
    const t = path.join(userDir, 'AppData', 'Local', 'Temp');
    if (fs.existsSync(t)) {
      try {
        return mkSecureDir(t);
      } catch {}
    }
  }
  return mkSecureDir(os.tmpdir());
}

function assertAllowedDownloadHost(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    throw Object.assign(new Error(`非法下载地址: ${urlStr}`), { code: 'UNTRUSTED_DOWNLOAD_URL' });
  }
  if (u.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(u.hostname.toLowerCase())) {
    throw Object.assign(new Error(`拒绝不受信任的重定向域名: ${u.hostname}`), { code: 'UNTRUSTED_REDIRECT_HOST' });
  }
  return u.toString();
}

async function fetchBinaryBounded(url, { fetchImpl = globalThis.fetch, token = '', maxBytes = MAX_DOWNLOAD_BYTES } = {}) {
  let curUrl = assertAllowedDownloadHost(url);
  let res = null;
  for (let hop = 0; hop < 4; hop++) {
    const headers = { 'User-Agent': 'anti-claude-prism-suite-updater' };
    if (token && new URL(curUrl).hostname === 'github.com') {
      headers.Authorization = `Bearer ${token}`;
    }
    res = await fetchImpl(curUrl, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    if (res && res.status >= 300 && res.status < 400) {
      const loc = res.headers?.get?.('location') || '';
      if (!loc) throw new Error(`重定向缺少目标地址 (HTTP ${res.status})`);
      curUrl = assertAllowedDownloadHost(new URL(loc, curUrl).toString());
      continue;
    }
    break;
  }
  if (!res || !res.ok) {
    throw new Error(`下载失败 (HTTP ${res?.status || 'ERR'}): ${path.basename(curUrl)}`);
  }
  const declaredLen = Number(res.headers?.get?.('content-length') || 0);
  if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
    throw Object.assign(new Error(`下载体积超限 (${declaredLen} bytes)`), { code: 'DOWNLOAD_TOO_LARGE' });
  }
  let buf;
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch {}
          throw Object.assign(new Error(`下载体积超限 (> ${maxBytes} bytes)`), { code: 'DOWNLOAD_TOO_LARGE' });
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      try { reader.releaseLock?.(); } catch {}
    }
    buf = Buffer.concat(chunks, total);
  } else {
    const ab = await res.arrayBuffer();
    buf = Buffer.from(ab);
    if (buf.length > maxBytes) {
      throw Object.assign(new Error(`下载体积超限 (${buf.length} bytes)`), { code: 'DOWNLOAD_TOO_LARGE' });
    }
  }
  if (buf.length === 0) throw new Error(`下载内容为空: ${path.basename(curUrl)}`);
  return buf;
}

function parseStrictSha256File(text, expectedFileName = 'Anti-Claude-Prism-Suite-Setup.exe') {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length !== 1) {
    throw Object.assign(new Error('官方 .sha256 校验文件包含多行或为空，已中止更新'), { code: 'INVALID_SHA256_FILE' });
  }
  const m = lines[0].match(/^([a-fA-F0-9]{64})(?:\s+\*?(.+))?$/);
  if (!m) {
    throw Object.assign(new Error('官方 .sha256 校验文件格式异常，已中止更新'), { code: 'INVALID_SHA256_FILE' });
  }
  if (m[2]) {
    const base = path.basename(m[2].trim());
    if (base.toLowerCase() !== expectedFileName.toLowerCase()) {
      throw Object.assign(new Error(`SHA-256 校验文件名不匹配: ${base}`), { code: 'INVALID_SHA256_FILE' });
    }
  }
  return m[1].toLowerCase();
}

function acquireSelfUpdateLock(lockDir = path.join(os.homedir(), '.gemini', 'antigravity', 'prism-suite')) {
  return acquireFileLock(path.join(lockDir, 'self-update.lock'), {
    staleMs: 3 * 60 * 1000,
    errorCode: 'UPDATE_IN_PROGRESS',
    errorMessage: '已有更新任务正在进行中，请勿重复点击'
  });
}

export function assertSafeTarEntryPath(entryPath) {
  const clean = String(entryPath || '').replace(/\r$/, '');
  if (!clean || !clean.trim()) {
    throw Object.assign(new Error('归档包含空白路径条目，已中止解压'), { code: 'UNSAFE_TAR_ENTRY' });
  }
  if (clean.includes('\0') || clean.startsWith('/') || clean.startsWith('\\') || /^[A-Za-z]:/.test(clean)) {
    throw Object.assign(new Error(`归档包含绝对路径，已中止解压: ${clean}`), { code: 'UNSAFE_TAR_ENTRY' });
  }
  const segs = clean.split(/[\\/]+/);
  if (segs.some((s) => s === '..' || /^[A-Za-z]:/.test(s))) {
    throw Object.assign(new Error(`归档包含路径穿越或盘符段条目，已中止解压: ${clean}`), { code: 'UNSAFE_TAR_ENTRY' });
  }
}

export function parseTarVerboseSize(line) {
  // Match integer byte size immediately preceding GNU ("2026-11-26 09:00") or BSD ("Nov 26 09:00" / "Nov 26 2026") timestamp,
  // regardless of whether owner/group columns are names or numeric UIDs (e.g. 0/0 or 0 0).
  const m = String(line || '').match(
    /\s(\d+)\s+(?:\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?|[A-Za-z]{3}\s+\d{1,2}\s+(?:\d{1,2}:\d{2}(?::\d{2})?|\d{4})|\d{1,2}\s+[A-Za-z]{3}\s+(?:\d{1,2}:\d{2}(?::\d{2})?|\d{4}))\s+/
  );
  if (m) {
    const n = Number(m[1]);
    if (Number.isSafeInteger(n) && n >= 0) return n;
  }
  throw Object.assign(new Error(`无法解析归档条目体积，已拒绝解压: ${String(line || '').slice(0, 80)}`), {
    code: 'UNSAFE_TAR_ENTRY'
  });
}

export async function auditTarEntriesSafe(tarPath, execFn) {
  const listed = await execFn('tar', ['-tvzf', tarPath], { timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
  const verboseLines = String(listed?.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (verboseLines.length === 0) {
    throw Object.assign(new Error('归档条目列表为空，已中止解压'), { code: 'UNSAFE_TAR_ENTRY' });
  }
  if (verboseLines.length > MAX_TAR_ENTRIES) {
    throw Object.assign(new Error(`归档条目数超限 (${verboseLines.length} > ${MAX_TAR_ENTRIES})，已中止解压`), { code: 'UNSAFE_TAR_ENTRY' });
  }
  let totalBytes = 0;
  for (const line of verboseLines) {
    const typeChar = line[0];
    // Strict allowlist: regular files ('-') and directories ('d') only
    if (typeChar !== '-' && typeChar !== 'd') {
      throw Object.assign(new Error(`归档包含非普通文件/目录项，已中止解压: ${line.slice(0, 80)}`), { code: 'UNSAFE_TAR_ENTRY' });
    }
    if (typeChar === '-') {
      totalBytes += parseTarVerboseSize(line);
      if (totalBytes > MAX_TAR_UNCOMPRESSED_BYTES) {
        throw Object.assign(
          new Error(`归档解压体积超限 (> ${MAX_TAR_UNCOMPRESSED_BYTES} bytes)，已中止解压`),
          { code: 'TAR_BOMB_DETECTED' }
        );
      }
    }
  }

  const plainListed = await execFn('tar', ['-tzf', tarPath], { timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
  const plainLines = String(plainListed?.stdout || '').split(/\r?\n/).map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0);
  if (plainLines.length === 0 || plainLines.length > MAX_TAR_ENTRIES) {
    throw Object.assign(new Error('归档条目列表为空或超限，已中止解压'), { code: 'UNSAFE_TAR_ENTRY' });
  }
  for (const entryPath of plainLines) {
    assertSafeTarEntryPath(entryPath);
  }
}

async function fetchAndVerifyTarballBuffer({
  tarballUrl,
  tarballSha256Url = '',
  tarballAssetName = '',
  requireTarballSha256 = false,
  fetchImpl,
  token
}) {
  if (!tarballUrl) {
    throw Object.assign(new Error('缺少官方源码包下载地址'), { code: 'MISSING_TARBALL' });
  }
  if (requireTarballSha256 && !tarballSha256Url) {
    throw Object.assign(new Error('官方 Release 缺少源码包 SHA-256 校验文件，已中止自动升级'), { code: 'MISSING_TARBALL_SHA256' });
  }
  const [tarBuf, shaBuf] = await Promise.all([
    fetchBinaryBounded(tarballUrl, { fetchImpl, token, maxBytes: MAX_DOWNLOAD_BYTES }),
    tarballSha256Url
      ? fetchBinaryBounded(tarballSha256Url, { fetchImpl, token, maxBytes: 4096 })
      : Promise.resolve(null)
  ]);
  const actualSha = crypto.createHash('sha256').update(tarBuf).digest('hex').toLowerCase();
  let sha256Verified = false;
  if (shaBuf) {
    const expectedName = tarballAssetName || path.basename(new URL(tarballUrl).pathname);
    const expectedSha = parseStrictSha256File(shaBuf.toString('utf8'), expectedName);
    if (actualSha !== expectedSha) {
      throw Object.assign(new Error('下载的官方源码包 SHA-256 校验不匹配，已中止更新'), { code: 'SHA256_MISMATCH' });
    }
    sha256Verified = true;
  }
  return {
    tarBuf,
    sha256Verified,
    sha256Prefix: actualSha.slice(0, 16)
  };
}

async function extractAndInstallVerifiedTarball(
  verifiedTar,
  { execFn, pluginDir = '', pluginOnly = false }
) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-suite-tar-'));
  try { fs.chmodSync(tmpDir, 0o700); } catch {}
  const tarPath = path.join(tmpDir, 'release.tar.gz');
  const extractDir = path.join(tmpDir, 'src');
  try {
    fs.mkdirSync(extractDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tarPath, verifiedTar.tarBuf, { mode: 0o600 });
    await auditTarEntriesSafe(tarPath, execFn);
    await execFn('tar', ['-xzf', tarPath, '-C', extractDir, '--strip-components=1'], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    const installScript = path.join(extractDir, 'install.mjs');
    if (!fs.existsSync(installScript)) {
      throw new Error('解压后的官方包缺少 install.mjs');
    }
    const args = [installScript];
    if (pluginOnly) args.push('--plugin-only');
    if (pluginDir) args.push('--plugin-dir', pluginDir);
    const execRes = await execFn(process.execPath, args, { cwd: extractDir, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    return {
      ...execRes,
      sha256Verified: verifiedTar.sha256Verified,
      sha256Prefix: verifiedTar.sha256Prefix
    };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function translateWindowsSecurityError(err) {
  const detail = `${err?.message || ''}\n${err?.stderr || ''}`;
  if (/smartscreen|blocked|virus|defender|operation did not complete successfully/i.test(detail)) {
    return Object.assign(
      new Error('安装器被 Windows 安全策略/SmartScreen 拦截，可前往 Releases 页面手动下载运行安装包'),
      { code: 'WINDOWS_SECURITY_BLOCKED' }
    );
  }
  return err;
}

async function resolveWslExeWindowsPath(exePath, execFn) {
  if (/^\/mnt\/([a-zA-Z])\//.test(exePath)) {
    return exePath.replace(/^\/mnt\/([a-zA-Z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\');
  }
  let converted = '';
  try {
    const res = await execFn('wslpath', ['-w', exePath], { timeout: 5000 });
    converted = String(res?.stdout || '').trim();
  } catch {
    converted = '';
  }
  const isValidWinPath =
    (/^[a-zA-Z]:\\/.test(converted) || /^\\\\[^\\]+\\[^\\]+/.test(converted)) &&
    !/[\x00-\x1f\x7f]/.test(converted);
  if (!isValidWinPath) {
    throw Object.assign(
      new Error(`无法将 WSL 安装器路径转换为合法 Windows 路径: ${exePath}`),
      { code: 'INVALID_WINDOWS_INSTALLER_PATH' }
    );
  }
  return converted;
}

async function runWindowsInstallerWithFallback(exePath, args, { execFn, wsl, tmpDir }) {
  const execOpts = {
    timeout: 45000,
    windowsHide: true,
    cwd: resolveSafeExecCwd({ isWsl: wsl, tmpDir }),
    env: wsl ? resolveWslInteropEnv(process.env, true) : process.env,
    maxBuffer: 4 * 1024 * 1024
  };
  try {
    return await execFn(exePath, args, execOpts);
  } catch (err) {
    if (wsl && err && (err.code === 'EACCES' || /EACCES|permission denied/i.test(String(err.message || '')))) {
      // DrvFS metadata/noexec fallback: invoke Windows Start-Process -Wait via encoded PowerShell
      const winExePath = await resolveWslExeWindowsPath(exePath, execFn);
      const psArgsJson = JSON.stringify(args);
      const psScript = `$ErrorActionPreference = 'Stop'; $p = Start-Process -FilePath '${winExePath.replace(/'/g, "''")}' -ArgumentList (ConvertFrom-Json '${psArgsJson.replace(/'/g, "''")}') -WindowStyle Hidden -Wait -PassThru; if ($null -eq $p) { exit 1 }; exit $p.ExitCode`;
      const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
      try {
        return await execFn(
          resolvePowerShellExe(wsl),
          ['-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-EncodedCommand', encoded],
          execOpts
        );
      } catch (psErr) {
        throw translateWindowsSecurityError(psErr);
      }
    }
    throw translateWindowsSecurityError(err);
  }
}

export async function checkPrismSelfUpdate({
  currentVersion = '0.0.0',
  repo = PRISM_OFFICIAL_REPO,
  fetchImpl = globalThis.fetch,
  token = process.env.GITHUB_TOKEN || ''
} = {}) {
  const cleanRepo = String(repo || PRISM_OFFICIAL_REPO).trim();
  if (!REPO_SLUG_RE.test(cleanRepo)) {
    throw Object.assign(new Error(`非法更新仓库标识: ${cleanRepo}`), { code: 'INVALID_REPO' });
  }
  const cur = String(currentVersion || '0.0.0').replace(/^v/i, '').trim();
  const rel = await defaultFetchJson(`https://api.github.com/repos/${cleanRepo}/releases/latest`, { fetchImpl, token });
  const latestTag = String(rel?.tag_name || '').trim();
  if (!latestTag || !/^v?\d+\.\d+\.\d+/.test(latestTag)) {
    throw new Error('未获取到有效的官方发布版本号');
  }
  const latestVersion = latestTag.replace(/^v/i, '');
  const assets = Array.isArray(rel?.assets) ? rel.assets : [];
  const exeRaw = assets.find((a) => /^Anti-Claude-Prism-Suite-Setup\.exe$/i.test(String(a?.name || ''))) || null;
  const shaRaw = assets.find((a) => /^Anti-Claude-Prism-Suite-Setup\.exe\.sha256$/i.test(String(a?.name || ''))) || null;
  const tarAssetRaw = assets.find((a) => /^Anti-Claude-Prism-Suite-Source\.tar\.gz$/i.test(String(a?.name || ''))) || null;
  const tarShaRaw = assets.find((a) => /^Anti-Claude-Prism-Suite-Source\.tar\.gz\.sha256$/i.test(String(a?.name || ''))) || null;
  const exeUrl = exeRaw && isAllowedPrismReleaseAssetUrl(exeRaw.browser_download_url, cleanRepo) ? exeRaw.browser_download_url : '';
  const shaUrl = shaRaw && isAllowedPrismReleaseAssetUrl(shaRaw.browser_download_url, cleanRepo) ? shaRaw.browser_download_url : '';
  const tarAssetUrl = tarAssetRaw && isAllowedPrismTarballUrl(tarAssetRaw.browser_download_url, cleanRepo) ? tarAssetRaw.browser_download_url : '';
  const tarShaUrl = tarAssetUrl && tarShaRaw && isAllowedPrismReleaseAssetUrl(tarShaRaw.browser_download_url, cleanRepo) ? tarShaRaw.browser_download_url : '';
  const archiveTarballUrl = `https://github.com/${cleanRepo}/archive/refs/tags/${latestTag}.tar.gz`;
  const effectiveTarballUrl = tarAssetUrl || (isAllowedPrismTarballUrl(archiveTarballUrl, cleanRepo) ? archiveTarballUrl : '');
  const releaseUrl = typeof rel?.html_url === 'string' && rel.html_url.startsWith(`https://github.com/${cleanRepo}/`)
    ? rel.html_url
    : `https://github.com/${cleanRepo}/releases/tag/${latestTag}`;

  return {
    ok: true,
    repo: cleanRepo,
    currentVersion: cur,
    latestTag,
    latestVersion,
    hasUpdate: compareSemver(latestVersion, cur) > 0,
    publishedAt: String(rel?.published_at || '').slice(0, 16).replace('T', ' '),
    releaseName: String(rel?.name || latestTag).trim(),
    releaseUrl,
    highlights: extractReleaseHighlights(rel?.body || ''),
    exeAsset: exeUrl ? { name: exeRaw.name, url: exeUrl, size: Number(exeRaw.size) || 0 } : null,
    sha256Asset: shaUrl ? { name: shaRaw.name, url: shaUrl } : null,
    tarballAsset: tarAssetUrl ? { name: tarAssetRaw.name, url: tarAssetUrl, size: Number(tarAssetRaw.size) || 0 } : null,
    tarballSha256Asset: tarShaUrl ? { name: tarShaRaw.name, url: tarShaUrl } : null,
    tarballUrl: effectiveTarballUrl,
    checkedAt: new Date().toISOString()
  };
}

export async function applyPrismSelfUpdate({
  currentVersion = '0.0.0',
  force = false,
  pluginDir = '',
  lockDir = '',
  repo = PRISM_OFFICIAL_REPO,
  fetchImpl = globalThis.fetch,
  token = process.env.GITHUB_TOKEN || '',
  runExecFile = null,
  platform = process.platform,
  isWsl = null,
  requireTarballSha256 = false
} = {}) {
  const releaseLock = acquireSelfUpdateLock(lockDir || undefined);
  try {
    const info = await checkPrismSelfUpdate({ currentVersion, repo, fetchImpl, token });
    if (!force && !info.hasUpdate) {
      return {
        ok: true,
        skipped: true,
        upToDate: true,
        updatedTo: info.latestTag,
        latestVersion: info.latestVersion,
        previousVersion: info.currentVersion,
        needsRestart: false,
        releaseUrl: info.releaseUrl,
        message: `当前已是最新正式版 v${info.currentVersion}，无需重复更新`
      };
    }

    const wsl = typeof isWsl === 'boolean' ? isWsl : detectIsWsl({ platform, checkMountFallback: true });
    const useWinInstaller = platform === 'win32' || wsl;
    const execFn = runExecFile || (async (file, args, opts) => {
      const res = await execFileAsync(file, args, { windowsHide: true, ...opts });
      return { stdout: res.stdout || '', stderr: res.stderr || '' };
    });

    if (useWinInstaller) {
      if (!info.exeAsset?.url || !info.sha256Asset?.url) {
        throw Object.assign(new Error(`最新正式版 ${info.latestTag} 缺少安装包或 SHA-256 校验文件，无法安全自动升级`), {
          code: 'MISSING_RELEASE_ASSET'
        });
      }
      if (wsl && !info.tarballUrl) {
        throw Object.assign(new Error(`最新正式版 ${info.latestTag} 缺少 WSL 源码包下载地址，无法安全升级 WSL 端插件`), {
          code: 'MISSING_TARBALL'
        });
      }
      const mustVerifyTarSha = Boolean(requireTarballSha256 || info.tarballAsset);
      // Download & SHA-256 verify BOTH the Windows Setup.exe AND (in WSL2) the source tarball BEFORE executing Setup.exe
      const [shaBuf, exeBuf, verifiedWslTar] = await Promise.all([
        fetchBinaryBounded(info.sha256Asset.url, { fetchImpl, token, maxBytes: 4096 }),
        fetchBinaryBounded(info.exeAsset.url, { fetchImpl, token, maxBytes: MAX_DOWNLOAD_BYTES }),
        wsl
          ? fetchAndVerifyTarballBuffer({
              tarballUrl: info.tarballUrl,
              tarballSha256Url: info.tarballSha256Asset?.url || '',
              tarballAssetName: info.tarballAsset?.name || '',
              requireTarballSha256: mustVerifyTarSha,
              fetchImpl,
              token
            })
          : Promise.resolve(null)
      ]);
      const expectedSha = parseStrictSha256File(shaBuf.toString('utf8'), info.exeAsset.name || 'Anti-Claude-Prism-Suite-Setup.exe');
      const actualSha = crypto.createHash('sha256').update(exeBuf).digest('hex').toLowerCase();
      if (actualSha !== expectedSha) {
        throw Object.assign(new Error('下载的安装包 SHA-256 校验不匹配，已中止更新以保障安全'), { code: 'SHA256_MISMATCH' });
      }

      const tmpDir = createWindowsNtfsTempDirForUpdate();
      const exePath = path.join(tmpDir, 'Anti-Claude-Prism-Suite-Setup.exe');
      let cleanupPending = false;
      let runRes = null;
      let wslLog = '';
      let tarballSha256Verified = false;
      try {
        fs.writeFileSync(exePath, exeBuf, { mode: 0o700 });
        // Critical: inside WSL2 pass --no-wsl to avoid recursive WSL -> Windows -> wsl.exe deadlock; update WSL plugin natively below
        const installerArgs = wsl ? ['--silent-install', '--no-wsl'] : ['--silent-install'];
        runRes = await runWindowsInstallerWithFallback(exePath, installerArgs, { execFn, wsl, tmpDir });
        if (wsl && verifiedWslTar) {
          const wslRes = await extractAndInstallVerifiedTarball(verifiedWslTar, {
            execFn,
            pluginDir: pluginDir || path.join(os.homedir(), '.gemini', 'config', 'plugins'),
            pluginOnly: true
          });
          tarballSha256Verified = Boolean(wslRes?.sha256Verified);
          wslLog = String(wslRes?.stdout || '').trim().slice(0, 400);
        }
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          cleanupPending = true;
        }
      }
      return {
        ok: true,
        updatedTo: info.latestTag,
        latestVersion: info.latestVersion,
        previousVersion: info.currentVersion,
        sha256Verified: wsl ? tarballSha256Verified : true,
        exeSha256Verified: true,
        tarballSha256Verified,
        sha256Prefix: actualSha.slice(0, 16),
        method: wsl ? 'wsl-split-safe-update' : 'win-silent-installer',
        needsRestart: true,
        cleanupPending,
        releaseUrl: info.releaseUrl,
        log: [String(runRes?.stdout || '').trim().slice(0, 400), wslLog].filter(Boolean).join('\n'),
        message: wsl
          ? `已完成双端原地升级至 ${info.latestTag}（Windows 扩展经 SHA-256 校验安装，WSL 插件本地无递归升级保 inode；重启 Antigravity 生效）`
          : `已通过官方安装包完成原地升级至 ${info.latestTag}（SHA-256 校验通过，重启 Antigravity 生效）`
      };
    }

    // macOS / native Linux: download official release tarball, verify SHA-256 when provided, audit entries, and run install.mjs
    const verifiedPosixTar = await fetchAndVerifyTarballBuffer({
      tarballUrl: info.tarballUrl,
      tarballSha256Url: info.tarballSha256Asset?.url || '',
      tarballAssetName: info.tarballAsset?.name || '',
      requireTarballSha256: Boolean(requireTarballSha256 || info.tarballAsset),
      fetchImpl,
      token
    });
    const runRes = await extractAndInstallVerifiedTarball(verifiedPosixTar, { execFn, pluginDir });
    return {
      ok: true,
      updatedTo: info.latestTag,
      latestVersion: info.latestVersion,
      previousVersion: info.currentVersion,
      sha256Verified: Boolean(runRes?.sha256Verified),
      tarballSha256Verified: Boolean(runRes?.sha256Verified),
      sha256Prefix: runRes?.sha256Prefix || '',
      method: 'posix-tarball-installer',
      needsRestart: true,
      releaseUrl: info.releaseUrl,
      log: String(runRes?.stdout || '').trim().slice(0, 800),
      message: `已从官方 Release 源码包原地升级至 ${info.latestTag}（重启 Antigravity 生效）`
    };
  } finally {
    releaseLock();
  }
}
