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

export const UPSTREAM_SCHEMA_VERSION = 2;
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;

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
    return {
      key,
      repo: entry.repo,
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
    return {
      key,
      repo: entry.repo,
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
    const item = { sha, message: msg };
    const kind = classifyCommitMessage(msg);
    if (kind === 'compat') compatFixes.push(item);
    else if (kind === 'feature') featureCandidates.push(item);
    else if (kind === 'noise') skippedNoise.push(item);
    else featureCandidates.push(item);
  }

  if (skippedFiles.length > 0 && skippedNoise.length === 0) {
    skippedNoise.push({ sha: '-', message: `命中建议跳过目录/文件 (${skippedFiles.slice(0, 4).join(', ')})` });
  }

  // Fallback signal if commit list empty (e.g., tag changed without compare)
  if (!compatFixes.length && !featureCandidates.length && latestMessage) {
    const fallbackKind = classifyCommitMessage(latestMessage);
    const fallbackItem = { sha: latestCommit.slice(0, 7), message: latestMessage };
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

  return {
    key,
    repo: entry.repo,
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
  const cacheKey = crypto.createHash('sha256').update(`${resolvedCfg}|${cfgDigest}|${keys.join(',')}`).digest('hex').slice(0, 12);

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
