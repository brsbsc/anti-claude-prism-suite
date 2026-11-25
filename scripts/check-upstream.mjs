#!/usr/bin/env node
/**
 * Check upstream releases & commits for both tracked repositories:
 *   1. hongqi7/Anti-Claude (host runtime compatibility)
 *   2. RMvdesi/obsidian-prism (UX idea inspiration reference; clean-room only)
 *
 * Also verifies whether a local Anti-Claude daemon.mjs exposes the required
 * extension hooks (extensions loader, getUsageSummary, translateText).
 *
 * Usage:
 *   node scripts/check-upstream.mjs [--local-anti-claude <dir>] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const UPSTREAM_FILE = path.join(REPO_ROOT, 'upstream.json');

export function inspectLocalDaemon(antiClaudeDir) {
  const daemonPath = path.join(antiClaudeDir, 'core', 'daemon.mjs');
  if (!fs.existsSync(daemonPath)) {
    return { found: false, daemonPath, missing: ['core/daemon.mjs'] };
  }
  const src = fs.readFileSync(daemonPath, 'utf8');
  const required = ['listUserExtensionFiles', 'getUsageSummary', 'translateText'];
  const missing = required.filter((cap) => !src.includes(cap));
  return { found: true, daemonPath, compatible: missing.length === 0, missing };
}

async function fetchJson(url) {
  const headers = {
    'User-Agent': 'anti-claude-prism-suite-upstream-checker',
    Accept: 'application/vnd.github+json'
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function checkRepo(entry) {
  const repo = entry.repo;
  const out = {
    repo,
    role: entry.role,
    baselineTag: entry.baselineTag || '',
    baselineCommit: entry.baselineCommit || '',
    latestTag: '',
    latestCommit: '',
    latestDate: '',
    latestMessage: '',
    hasUpdate: false,
    error: ''
  };
  try {
    const [rel, commit] = await Promise.all([
      fetchJson(`https://api.github.com/repos/${repo}/releases/latest`).catch(() => null),
      fetchJson(`https://api.github.com/repos/${repo}/commits?per_page=1`).catch(() => null)
    ]);
    if (rel && rel.tag_name) out.latestTag = String(rel.tag_name);
    const head = Array.isArray(commit) ? commit[0] : null;
    if (head && head.sha) {
      out.latestCommit = String(head.sha).slice(0, 7);
      out.latestDate = String(head.commit?.committer?.date || '').slice(0, 10);
      out.latestMessage = String(head.commit?.message || '').split(/\r?\n/)[0].slice(0, 90);
    }
    const tagChanged = Boolean(out.latestTag && out.baselineTag && out.latestTag !== out.baselineTag);
    const shaChanged = Boolean(out.latestCommit && out.baselineCommit && !out.latestCommit.startsWith(out.baselineCommit));
    out.hasUpdate = tagChanged || shaChanged;
  } catch (err) {
    out.error = String(err?.message || err);
  }
  return out;
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
  const asJson = argv.includes('--json');
  const localIdx = argv.indexOf('--local-anti-claude');
  const localDir = localIdx !== -1 && localIdx + 1 < argv.length ? path.resolve(argv[localIdx + 1]) : '';

  const cfg = JSON.parse(fs.readFileSync(UPSTREAM_FILE, 'utf8'));
  const results = await Promise.all([
    checkRepo(cfg.upstreams.antiClaude),
    checkRepo(cfg.upstreams.obsidianPrism)
  ]);
  const localCheck = localDir ? inspectLocalDaemon(localDir) : null;

  if (asJson) {
    console.log(JSON.stringify({ updatedAt: cfg.updatedAt, results, localCheck }, null, 2));
  } else {
    console.log('=== Anti-Claude Prism Suite · 上游伴随更新检查 ===');
    for (const r of results) {
      const status = r.error ? `检查失败 (${r.error})` : r.hasUpdate ? '🔔 发现上游更新' : '✅ 已与基线同步';
      console.log(`\n[${r.repo}] (${r.role}) -> ${status}`);
      console.log(`  基线: ${r.baselineTag || '-'}${r.baselineCommit ? ` @ ${r.baselineCommit}` : ''}`);
      console.log(`  最新: ${r.latestTag || '-'}${r.latestCommit ? ` @ ${r.latestCommit} (${r.latestDate})` : ''}`);
      if (r.latestMessage) console.log(`  提交: ${r.latestMessage}`);
    }
    if (localCheck) {
      console.log('\n=== 本地 Anti-Claude 底座能力检查 ===');
      if (!localCheck.found) {
        console.log(`  未找到: ${localCheck.daemonPath}`);
      } else if (localCheck.compatible) {
        console.log(`  ✅ 已具备全部扩展接口 (${localCheck.daemonPath})`);
      } else {
        console.log(`  ⚠️ 缺失接口: ${localCheck.missing.join(', ')}`);
      }
    }
  }
}
