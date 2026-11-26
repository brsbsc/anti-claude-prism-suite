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
import { resolveSafeExecCwd, resolveWslInteropEnv } from './account-vault.mjs';

const execFileAsync = promisify(execFile);

export const UPSTREAM_SCHEMA_VERSION = 2;
const RADAR_CACHE_SCHEMA_VERSION = 3;
export const PRISM_OFFICIAL_REPO = 'wushuai0802/anti-claude-prism-suite';
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'codeload.github.com'
]);

const UPSTREAM_ZH_META = {
  antiClaude: {
    displayNameZh: 'Anti-Claude（主界面核心）',
    roleZh: 'Antigravity 界面美化与守护进程上游'
  },
  'anti-claude': {
    displayNameZh: 'Anti-Claude（主界面核心）',
    roleZh: 'Antigravity 界面美化与守护进程上游'
  },
  agyPowertools: {
    displayNameZh: 'agy-powertools（启动器与效率参考）',
    roleZh: '快捷方式启动、多账号与多语言思路参考'
  },
  'agy-powertools': {
    displayNameZh: 'agy-powertools（启动器与效率参考）',
    roleZh: '快捷方式启动、多账号与多语言思路参考'
  },
  obsidianPrism: {
    displayNameZh: 'obsidian-prism（视觉特效参考）',
    roleZh: '粒子球与动效交互参考（GPL 仅借思路不搬代码）'
  },
  'obsidian-prism': {
    displayNameZh: 'obsidian-prism（视觉特效参考）',
    roleZh: '粒子球与动效交互参考（GPL 仅借思路不搬代码）'
  },
  agySwitch: {
    displayNameZh: 'agy-switch（切号机制参考）',
    roleZh: '多账号切换流程与安全边界参考'
  },
  'agy-switch': {
    displayNameZh: 'agy-switch（切号机制参考）',
    roleZh: '多账号切换流程与安全边界参考'
  }
};

export function compareSemver(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
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

function polishZhTechTerms(text) {
  return String(text || '')
    .replace(/\.lnk\s*(?:helper|快捷方式)?/gi, '桌面快捷方式')
    .replace(/\btooltipNote\b/gi, '悬停提示文案')
    .replace(/\bProject composer\b/gi, '项目输入框')
    .replace(/\bcomposer\b/gi, '输入框')
    .replace(/\bmodel menu\b/gi, '模型选择菜单')
    .replace(/\brelaunch\b/gi, '自动重启')
    .replace(/\bToS\s*sync\b/gi, '服务条款状态同步')
    .replace(/\bzero-AMSI\b/gi, '防杀软误报(无AMSI拦截)')
    .replace(/\bAMSI\b/g, '安全扫描(AMSI)')
    .replace(/\bi18n\b/gi, '多语言汉化')
    .replace(/\bCI test\b/gi, 'CI 自动测试')
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
    [/^adapt model menu to Antigravity\s+(v?[\d.]+)\s+tooltipNote$/i, '适配 Antigravity $1 模型菜单的悬停提示文案变更'],
    [/^extend Windows \.lnk helper timeout to (\d+s) and pass full env in CI test$/i, '延长 Windows 快捷方式启动器超时至 $1，并在 CI 测试中传递完整环境变量'],
    [/^zero-AMSI Windows \.lnk relaunch, multi-account ToS sync, Skills i18n, and auto-check update reminders(?:\s*\((v?[\d.]+)\))?$/i, '防杀软误报的 Windows 快捷方式重启、多账号服务条款同步、Skills 汉化与自动更新提醒']
  ];
  for (const [re, rep] of phraseRules) {
    if (re.test(body)) {
      return { tagZh, summaryZh: body.replace(re, rep) };
    }
  }
  // Avoid awkward word-by-word Chinglish on unknown commits; keep clean stripped subject when offline
  return { tagZh, summaryZh: body || String(rawMsg || '').trim() };
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
  const batch = unique.slice(0, 18);
  // Numbered lines survive machine translation reliably without delimiter corruption
  const joined = batch.map((line, i) => `[${i + 1}] ${line}`).join('\n');
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

function classifyCommitMessage(msg) {
  const first = String(msg || '').split(/\r?\n/)[0].trim();
  const low = first.toLowerCase();
  if (/^(docs?|chore|ci|build|style|test)(\(.+\))?:|\b(readme|changelog|bump version|release v|typo|license)\b/i.test(low)) {
    return 'noise';
  }
  if (/^(fix|perf|refactor|security)(\(.+\))?:|\b(compat|credential|keychain|credman|daemon|hook|crash|leak)\b/i.test(low)) {
    return 'compat';
  }
  if (/^(feat|add|support)(\(.+\))?:|\b(new|feature|theme|widget|orb|mascot|tab|search|switch)\b/i.test(low)) {
    return 'feature';
  }
  return 'other';
}

export function loadUpstreamConfig(configPath) {
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
  const latestCommit = String(fetched.latestCommit || '').trim();
  const latestDate = String(fetched.latestDate || '').trim();
  const latestMessage = String(fetched.latestMessage || '').split(/\r?\n/)[0].slice(0, 100);
  const releaseName = String(fetched.releaseName || latestTag || '').trim();
  const releaseNotes = String(fetched.releaseNotes || '').trim().slice(0, 1200);
  const releaseUrl = String(fetched.releaseUrl || (latestTag ? `https://github.com/${entry.repo}/releases/tag/${latestTag}` : '')).trim();
  const compareCommits = Array.isArray(fetched.commits) ? fetched.commits : [];
  const changedFiles = Array.isArray(fetched.changedFiles) ? fetched.changedFiles : [];
  const aheadBy = Number.isFinite(Number(fetched.aheadBy)) ? Number(fetched.aheadBy) : compareCommits.length;

  if (fetched.error) {
    const zhMeta = UPSTREAM_ZH_META[key] || { displayNameZh: entry.repo, roleZh: entry.role || '' };
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
    const zhMeta = UPSTREAM_ZH_META[key] || { displayNameZh: entry.repo, roleZh: entry.role || '' };
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

  for (const c of compareCommits.slice(0, 20)) {
    const sha = String(c?.sha || '').slice(0, 7);
    const msg = String(c?.message || c?.commit?.message || '').split(/\r?\n/)[0].trim();
    if (!msg) continue;
    const loc = localizeCommitLocally(msg);
    const item = { sha, message: msg, tagZh: loc.tagZh, summaryZh: loc.summaryZh };
    const kind = classifyCommitMessage(msg);
    if (kind === 'compat') compatFixes.push(item);
    else if (kind === 'feature') featureCandidates.push(item);
    else if (kind === 'noise') skippedNoise.push(item);
    else featureCandidates.push(item);
  }

  if (skippedFiles.length > 0 && skippedNoise.length === 0) {
    skippedNoise.push({ sha: '-', message: `命中建议跳过目录/文件 (${skippedFiles.slice(0, 4).join(', ')})`, tagZh: '跳过', summaryZh: `命中建议跳过目录/文件 (${skippedFiles.slice(0, 4).join(', ')})` });
  }

  // Fallback signal if commit list empty (e.g., tag changed without compare)
  if (!compatFixes.length && !featureCandidates.length && latestMessage) {
    const fallbackKind = classifyCommitMessage(latestMessage);
    const loc = localizeCommitLocally(latestMessage);
    const fallbackItem = { sha: latestCommit.slice(0, 7), message: latestMessage, tagZh: loc.tagZh, summaryZh: loc.summaryZh };
    if (fallbackKind === 'compat') compatFixes.push(fallbackItem);
    else featureCandidates.push(fallbackItem);
  }

  const isHostOrFeatureRef = entry.role === 'host-runtime' || entry.role === 'feature-reference';
  let impactLevel = 'LOW';
  if (watchedHits.length > 0 || (tagChanged && isHostOrFeatureRef) || (entry.role === 'host-runtime' && compatFixes.length > 0)) {
    impactLevel = 'HIGH';
  } else if (tagChanged || compatFixes.length > 0 || featureCandidates.length > 0) {
    impactLevel = 'MEDIUM';
  }

  const zhMeta = UPSTREAM_ZH_META[key] || { displayNameZh: entry.repo, roleZh: entry.role || '' };

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
    releaseName,
    releaseNotes,
    releaseUrl,
    hasUpdate: true,
    impactLevel,
    aheadBy,
    watchedHits: watchedHits.slice(0, 12),
    compatFixes: compatFixes.slice(0, 8),
    featureCandidates: featureCandidates.slice(0, 8),
    skippedNoise: skippedNoise.slice(0, 6),
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
      const repo = entry.repo;
      try {
        const [rel, commits] = await Promise.all([
          defaultFetchJson(`https://api.github.com/repos/${repo}/releases/latest`, { fetchImpl, token }).catch((err) => {
            if (err && (err.status === 404 || err.status === 403 && !err.rateLimited)) return null;
            if (err && err.rateLimited) throw err;
            return null;
          }),
          defaultFetchJson(`https://api.github.com/repos/${repo}/commits?per_page=1`, { fetchImpl, token })
        ]);
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
          releaseName: rel?.name || rel?.tag_name || '',
          releaseNotes: rel?.body || '',
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
      for (const c of [...(r.compatFixes || []), ...(r.featureCandidates || [])]) {
        if (/[\u4e00-\u9fff]{4,}/.test(String(c.summaryZh || ''))) continue;
        const { body } = stripConventionalPrefix(c.message);
        if (body && !/[\u4e00-\u9fff]{4,}/.test(body)) bodiesToTranslate.push(body);
      }
    }
    if (bodiesToTranslate.length) {
      const zhMap = await translateBatchToZh(bodiesToTranslate, { fetchImpl });
      if (zhMap.size > 0) {
        for (const r of results) {
          for (const c of [...(r.compatFixes || []), ...(r.featureCandidates || [])]) {
            if (/[\u4e00-\u9fff]{4,}/.test(String(c.summaryZh || ''))) continue;
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
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ cacheKey, checkedAtMs: report.checkedAtMs, report }, null, 2), 'utf8');
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
      } else if (r.adoptionBoundary) {
        lines.push(`> 边界：${r.adoptionBoundary}`);
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
    if (hit.latestTag) entry.baselineTag = hit.latestTag;
    if (hit.latestCommit) entry.baselineCommit = hit.latestCommit.slice(0, 7);
    updatedKeys.push(k);
  }

  if (updatedKeys.length) {
    config.updatedAt = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(resolvedCfg, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
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
  return new RegExp(`^https://github\\.com/${escaped}/releases/download/v\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?/[A-Za-z0-9._-]+$`).test(s);
}

function isAllowedPrismTarballUrl(url, repo = PRISM_OFFICIAL_REPO) {
  const s = String(url || '').trim();
  const escaped = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^https://github\\.com/${escaped}/archive/refs/tags/v\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?\\.tar\\.gz$`).test(s);
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

function detectIsWslHost(platform = process.platform) {
  if (platform !== 'linux') return false;
  try {
    const ver = fs.readFileSync('/proc/version', 'utf8');
    if (/microsoft/i.test(ver)) return true;
  } catch {}
  return fs.existsSync('/mnt/c/Windows/System32');
}

function resolveWindowsNtfsTempDirForUpdate() {
  if (process.platform === 'win32') {
    return path.join(os.tmpdir(), `prism-suite-update-${Date.now()}`);
  }
  const winUsersRoot = '/mnt/c/Users';
  const candidates = [];
  if (process.env.PRISM_WIN_USER) candidates.push(process.env.PRISM_WIN_USER);
  try {
    const cur = os.userInfo().username;
    if (cur) candidates.push(cur);
  } catch {}
  candidates.push('Administrator');
  for (const u of candidates) {
    const t = path.join(winUsersRoot, u, 'AppData', 'Local', 'Temp');
    if (fs.existsSync(t)) {
      return path.join(t, `prism-suite-update-${Date.now()}`);
    }
  }
  try {
    const skip = new Set(['Public', 'Default', 'Default User', 'All Users']);
    for (const ent of fs.readdirSync(winUsersRoot, { withFileTypes: true })) {
      if (!ent.isDirectory() || skip.has(ent.name) || ent.name.startsWith('.')) continue;
      const t = path.join(winUsersRoot, ent.name, 'AppData', 'Local', 'Temp');
      if (fs.existsSync(t)) {
        return path.join(t, `prism-suite-update-${Date.now()}`);
      }
    }
  } catch {}
  return path.join(os.tmpdir(), `prism-suite-update-${Date.now()}`);
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
  fs.mkdirSync(lockDir, { recursive: true });
  const lockFile = path.join(lockDir, 'self-update.lock');
  const token = crypto.randomBytes(12).toString('hex');
  const STALE_MS = 3 * 60 * 1000;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, createdAt: Date.now(), token }), { flag: 'wx', mode: 0o600 });
      return () => {
        try {
          if (!fs.existsSync(lockFile)) return;
          const cur = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
          if (cur && cur.token === token) fs.rmSync(lockFile, { force: true });
        } catch {}
      };
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
      let stale = false;
      try {
        const cur = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        const age = Date.now() - Number(cur?.createdAt || 0);
        let alive = false;
        try {
          if (Number(cur?.pid) > 0) {
            process.kill(Number(cur.pid), 0);
            alive = true;
          }
        } catch (e) {
          alive = e && e.code === 'EPERM';
        }
        if (age > STALE_MS || !alive) stale = true;
      } catch {
        stale = true;
      }
      if (stale && attempt === 0) {
        try { fs.rmSync(lockFile, { force: true }); } catch {}
        continue;
      }
      throw Object.assign(new Error('已有更新任务正在进行中，请勿重复点击'), { code: 'UPDATE_IN_PROGRESS' });
    }
  }
  throw Object.assign(new Error('无法获取更新互斥锁'), { code: 'UPDATE_IN_PROGRESS' });
}

async function auditTarEntriesSafe(tarPath, execFn) {
  const listed = await execFn('tar', ['-tvzf', tarPath], { timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
  const lines = String(listed?.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const typeChar = line[0];
    if (typeChar === 'l' || typeChar === 'h' || typeChar === 'c' || typeChar === 'b' || typeChar === 'p') {
      throw Object.assign(new Error(`归档包含不安全链接或设备项，已中止解压: ${line.slice(0, 80)}`), { code: 'UNSAFE_TAR_ENTRY' });
    }
    const parts = line.split(/\s+/);
    const entryPath = parts.slice(5).join(' ').trim();
    if (!entryPath) continue;
    if (entryPath.startsWith('/') || entryPath.startsWith('\\') || /^[A-Za-z]:/.test(entryPath)) {
      throw Object.assign(new Error(`归档包含绝对路径，已中止解压: ${entryPath}`), { code: 'UNSAFE_TAR_ENTRY' });
    }
    const segs = entryPath.split(/[\\/]+/);
    if (segs.includes('..')) {
      throw Object.assign(new Error(`归档包含路径穿越条目，已中止解压: ${entryPath}`), { code: 'UNSAFE_TAR_ENTRY' });
    }
  }
}

async function installPluginFromTarballSafely({ tarballUrl, fetchImpl, token, execFn, pluginDir = '', extensionsOnly = false, pluginOnly = false }) {
  if (!tarballUrl) {
    throw Object.assign(new Error('缺少官方源码包下载地址'), { code: 'MISSING_TARBALL' });
  }
  const tarBuf = await fetchBinaryBounded(tarballUrl, { fetchImpl, token, maxBytes: MAX_DOWNLOAD_BYTES });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-suite-tar-'));
  const tarPath = path.join(tmpDir, 'release.tar.gz');
  const extractDir = path.join(tmpDir, 'src');
  try {
    fs.mkdirSync(extractDir, { recursive: true });
    fs.writeFileSync(tarPath, tarBuf);
    await auditTarEntriesSafe(tarPath, execFn);
    await execFn('tar', ['-xzf', tarPath, '-C', extractDir, '--strip-components=1'], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    const installScript = path.join(extractDir, 'install.mjs');
    if (!fs.existsSync(installScript)) {
      throw new Error('解压后的官方包缺少 install.mjs');
    }
    const args = [installScript];
    if (pluginOnly) args.push('--plugin-only');
    else if (extensionsOnly) args.push('--extensions-only');
    if (pluginDir) args.push('--plugin-dir', pluginDir);
    return await execFn(process.execPath, args, { cwd: extractDir, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function runWindowsInstallerWithFallback(exePath, args, { execFn, wsl, tmpDir }) {
  const execOpts = {
    timeout: 45000,
    windowsHide: true,
    cwd: resolveSafeExecCwd(tmpDir),
    env: wsl ? resolveWslInteropEnv(process.env) : process.env,
    maxBuffer: 4 * 1024 * 1024
  };
  try {
    return await execFn(exePath, args, execOpts);
  } catch (err) {
    if (wsl && err && (err.code === 'EACCES' || /EACCES|permission denied/i.test(String(err.message || '')))) {
      // DrvFS metadata/noexec fallback: invoke Windows Start-Process -Wait via encoded PowerShell
      const winExePath = exePath.replace(/^\/mnt\/([a-zA-Z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\');
      const psArgsJson = JSON.stringify(args);
      const psScript = `$p = Start-Process -FilePath '${winExePath.replace(/'/g, "''")}' -ArgumentList (ConvertFrom-Json '${psArgsJson.replace(/'/g, "''")}') -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
      const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
      return await execFn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-EncodedCommand', encoded],
        execOpts
      );
    }
    if (/smartscreen|blocked|virus|defender|operation did not complete successfully/i.test(String(err?.message || err?.stderr || ''))) {
      throw Object.assign(
        new Error('安装器被 Windows 安全策略/SmartScreen 拦截，可前往 Releases 页面手动下载运行安装包'),
        { code: 'WINDOWS_SECURITY_BLOCKED' }
      );
    }
    throw err;
  }
}

export async function checkPrismSelfUpdate({
  currentVersion = '0.0.0',
  repo = PRISM_OFFICIAL_REPO,
  fetchImpl = globalThis.fetch,
  token = process.env.GITHUB_TOKEN || ''
} = {}) {
  const cur = String(currentVersion || '0.0.0').replace(/^v/i, '').trim();
  const rel = await defaultFetchJson(`https://api.github.com/repos/${repo}/releases/latest`, { fetchImpl, token });
  const latestTag = String(rel?.tag_name || '').trim();
  if (!latestTag || !/^v?\d+\.\d+\.\d+/.test(latestTag)) {
    throw new Error('未获取到有效的官方发布版本号');
  }
  const latestVersion = latestTag.replace(/^v/i, '');
  const assets = Array.isArray(rel?.assets) ? rel.assets : [];
  const exeRaw = assets.find((a) => /^Anti-Claude-Prism-Suite-Setup\.exe$/i.test(String(a?.name || ''))) || null;
  const shaRaw = assets.find((a) => /^Anti-Claude-Prism-Suite-Setup\.exe\.sha256$/i.test(String(a?.name || ''))) || null;
  const exeUrl = exeRaw && isAllowedPrismReleaseAssetUrl(exeRaw.browser_download_url, repo) ? exeRaw.browser_download_url : '';
  const shaUrl = shaRaw && isAllowedPrismReleaseAssetUrl(shaRaw.browser_download_url, repo) ? shaRaw.browser_download_url : '';
  const tarballUrl = `https://github.com/${repo}/archive/refs/tags/${latestTag}.tar.gz`;
  const releaseUrl = typeof rel?.html_url === 'string' && rel.html_url.startsWith(`https://github.com/${repo}/`)
    ? rel.html_url
    : `https://github.com/${repo}/releases/tag/${latestTag}`;

  return {
    ok: true,
    repo,
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
    tarballUrl: isAllowedPrismTarballUrl(tarballUrl, repo) ? tarballUrl : '',
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
  isWsl = null
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

    const wsl = typeof isWsl === 'boolean' ? isWsl : detectIsWslHost(platform);
    const useWinInstaller = platform === 'win32' || wsl;
    const execFn = runExecFile || (async (file, args, opts) => {
      const res = await execFileAsync(file, args, opts);
      return { stdout: res.stdout || '', stderr: res.stderr || '' };
    });

    if (useWinInstaller) {
      if (!info.exeAsset?.url || !info.sha256Asset?.url) {
        throw Object.assign(new Error(`最新正式版 ${info.latestTag} 缺少安装包或 SHA-256 校验文件，无法安全自动升级`), {
          code: 'MISSING_RELEASE_ASSET'
        });
      }
      const [shaBuf, exeBuf] = await Promise.all([
        fetchBinaryBounded(info.sha256Asset.url, { fetchImpl, token, maxBytes: 4096 }),
        fetchBinaryBounded(info.exeAsset.url, { fetchImpl, token, maxBytes: MAX_DOWNLOAD_BYTES })
      ]);
      const expectedSha = parseStrictSha256File(shaBuf.toString('utf8'), info.exeAsset.name || 'Anti-Claude-Prism-Suite-Setup.exe');
      const actualSha = crypto.createHash('sha256').update(exeBuf).digest('hex').toLowerCase();
      if (actualSha !== expectedSha) {
        throw Object.assign(new Error('下载的安装包 SHA-256 校验不匹配，已中止更新以保障安全'), { code: 'SHA256_MISMATCH' });
      }

      const tmpDir = resolveWindowsNtfsTempDirForUpdate();
      fs.mkdirSync(tmpDir, { recursive: true });
      const exePath = path.join(tmpDir, 'Anti-Claude-Prism-Suite-Setup.exe');
      let cleanupPending = false;
      try {
        fs.writeFileSync(exePath, exeBuf);
        // Critical: inside WSL2 pass --no-wsl to avoid recursive WSL -> Windows -> wsl.exe deadlock; update WSL plugin natively below
        const installerArgs = wsl ? ['--silent-install', '--no-wsl'] : ['--silent-install'];
        const runRes = await runWindowsInstallerWithFallback(exePath, installerArgs, { execFn, wsl, tmpDir });
        let wslLog = '';
        if (wsl && info.tarballUrl) {
          const wslRes = await installPluginFromTarballSafely({
            tarballUrl: info.tarballUrl,
            fetchImpl,
            token,
            execFn,
            pluginDir: pluginDir || path.join(os.homedir(), '.gemini', 'config', 'plugins'),
            pluginOnly: true
          });
          wslLog = String(wslRes?.stdout || '').trim().slice(0, 400);
        }
        return {
          ok: true,
          updatedTo: info.latestTag,
          latestVersion: info.latestVersion,
          previousVersion: info.currentVersion,
          sha256Verified: true,
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
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          cleanupPending = true;
        }
      }
    }

    // macOS / native Linux: download official release tag tarball, audit entries, and run install.mjs
    const runRes = await installPluginFromTarballSafely({
      tarballUrl: info.tarballUrl,
      fetchImpl,
      token,
      execFn,
      pluginDir
    });
    return {
      ok: true,
      updatedTo: info.latestTag,
      latestVersion: info.latestVersion,
      previousVersion: info.currentVersion,
      sha256Verified: false,
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
