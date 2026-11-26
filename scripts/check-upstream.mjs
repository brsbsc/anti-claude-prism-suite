#!/usr/bin/env node
/**
 * Check upstream releases & commits with selective-adoption Radar (v0.5.0).
 *
 * Principle: ONLY surface breaking host/credential compatibility updates & useful/fun feature
 * candidates for user approval. NEVER blindly copy-paste upstream code or import GPL-3.0 code.
 *
 * Usage:
 *   node scripts/check-upstream.mjs [--local-anti-claude <dir>] [--only keys] [--markdown] [--json] [--force] [--sync-baseline [keys]] [--fail-on-high]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkUpstreams, renderMarkdownReport, syncUpstreamBaseline } from '../plugin/server/upstream-radar.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const UPSTREAM_FILE = path.join(REPO_ROOT, 'upstream.json');
const PLUGIN_UPSTREAM_FILE = path.join(REPO_ROOT, 'plugin', 'upstream.json');

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

function readArgVal(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < argv.length && !argv[idx + 1].startsWith('--')) return argv[idx + 1];
  const prefix = `${flag}=`;
  const eq = argv.find((a) => a.startsWith(prefix));
  return eq ? eq.slice(prefix.length) : '';
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
  const asMarkdown = argv.includes('--markdown');
  const force = argv.includes('--force');
  const failOnHigh = argv.includes('--fail-on-high');
  const doSyncBaseline = argv.includes('--sync-baseline') || argv.some((a) => a.startsWith('--sync-baseline='));
  const onlyRaw = readArgVal(argv, '--only');
  const onlyKeys = onlyRaw ? onlyRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const syncKeysRaw = readArgVal(argv, '--sync-baseline');
  const syncKeys = syncKeysRaw ? syncKeysRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const localDirRaw = readArgVal(argv, '--local-anti-claude');
  const localDir = localDirRaw ? path.resolve(localDirRaw) : '';

  const report = await checkUpstreams({
    configPath: UPSTREAM_FILE,
    force,
    onlyKeys
  });
  const localCheck = localDir ? inspectLocalDaemon(localDir) : null;

  let syncRes = null;
  if (doSyncBaseline) {
    syncRes = syncUpstreamBaseline(UPSTREAM_FILE, { keys: syncKeys, report });
    if (syncRes.updatedKeys.length && fs.existsSync(path.dirname(PLUGIN_UPSTREAM_FILE))) {
      fs.copyFileSync(UPSTREAM_FILE, PLUGIN_UPSTREAM_FILE);
    }
  }

  if (asJson && !asMarkdown) {
    console.log(JSON.stringify({ ...report, localCheck, syncRes }, null, 2));
  } else if (asMarkdown) {
    const md = renderMarkdownReport(report);
    if (asJson) {
      console.log(JSON.stringify({ ...report, markdown: md, localCheck, syncRes }, null, 2));
    } else {
      console.log(md);
    }
  } else {
    console.log('=== Anti-Claude Prism Suite · 上游更新雷达 (择优吸收 · 绝不照搬照抄) ===');
    for (const r of report.results) {
      const status = r.error
        ? `⚠️ 检查失败 (${r.error})`
        : r.hasUpdate
          ? `🔔 ${r.impactLevel} (ahead ${r.aheadBy})`
          : '✅ 已与基线同步';
      console.log(`\n[${r.repo}] (${r.role}, ${r.license}) -> ${status}`);
      console.log(`  基线: ${r.baselineTag || '-'} @ ${r.baselineCommit || '-'}`);
      console.log(`  最新: ${r.latestTag || '-'} @ ${r.latestCommit || '-'} (${r.latestDate || '-'})`);
      if (r.hasUpdate) {
        if (r.watchedHits.length) console.log(`  关键路径命中: ${r.watchedHits.join(', ')}`);
        if (r.compatFixes.length) {
          console.log('  [兼容性/安全必看]:');
          for (const c of r.compatFixes) console.log(`    - ${c.sha} ${c.message}`);
        }
        if (r.featureCandidates.length) {
          console.log('  [实用/有趣新功能候选 · 由你决定是否融合]:');
          for (const c of r.featureCandidates) console.log(`    - ${c.sha} ${c.message}`);
        }
        if (r.skippedNoise.length) {
          console.log(`  [建议跳过杂项]: ${r.skippedNoise.length} 项`);
        }
      }
    }
    if (localCheck) {
      console.log('\n=== 本地 Anti-Claude 底座能力检查 ===');
      if (!localCheck.found) console.log(`  未找到: ${localCheck.daemonPath}`);
      else if (localCheck.compatible) console.log(`  ✅ 已具备全部扩展接口 (${localCheck.daemonPath})`);
      else console.log(`  ⚠️ 缺失接口: ${localCheck.missing.join(', ')}`);
    }
    if (syncRes) {
      console.log(`\n[基线同步] 已更新: ${syncRes.updatedKeys.join(', ') || '(无)'}`);
    }
  }

  if (failOnHigh && report.summary.high > 0) {
    process.exitCode = 2;
  }
}
