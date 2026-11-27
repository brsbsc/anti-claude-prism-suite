#!/usr/bin/env node
/**
 * CLI for Anti-Claude Prism Suite Primary / Backup Account Relay (v0.5.0).
 *
 * Security invariants:
 * - Zero plaintext token output.
 * - Never writes to Antigravity local SQLite, brain transcripts, or workspaces.
 * - Credentials stay in isolated OS native vault namespaces (prism-suite:*).
 *
 * Usage:
 *   node scripts/prism-accounts.mjs <command> [options]
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAccountManager } from '../plugin/server/account-manager.mjs';
import { createHandoffMemoryStore } from '../plugin/server/handoff-memory.mjs';

const __filename = fileURLToPath(import.meta.url);

const VALUE_FLAGS = new Set([
  '--state-dir',
  '--role',
  '--alias',
  '--models',
  '--slot',
  '--cwd',
  '--next',
  '--project',
  '--verified'
]);

const BOOL_FLAGS = new Set([
  '--json',
  '--dry-run',
  '--no-snapshot',
  '--allow-uncaptured',
  '--help',
  '-h'
]);

const KNOWN_COMMANDS = new Set([
  'status',
  'enable',
  'disable',
  'capture',
  'set-role',
  'snapshot',
  'memories',
  'switch',
  'delete',
  'verify'
]);

function isKnownCliFlag(token) {
  if (typeof token !== 'string' || !token.startsWith('-')) return false;
  if (VALUE_FLAGS.has(token) || BOOL_FLAGS.has(token)) return true;
  for (const vf of VALUE_FLAGS) {
    if (token.startsWith(`${vf}=`)) return true;
  }
  return false;
}

function readFlagValue(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < argv.length) {
    const next = argv[idx + 1];
    if (typeof next === 'string' && !isKnownCliFlag(next)) return next;
    return '';
  }
  const prefix = `${flag}=`;
  const eq = argv.find((a) => a.startsWith(prefix));
  return eq ? eq.slice(prefix.length) : '';
}

function printHelp() {
  console.log([
    'Anti-Claude Prism Suite · 主备账号接力 CLI (v0.5.0)',
    '',
    '用法:',
    '  node scripts/prism-accounts.mjs <command> [options]',
    '',
    '命令:',
    '  status                           查看当前开启状态、隔离凭据库后端、活跃邮箱与主备账号列表',
    '  enable                           显式开启账号接力模块（默认关闭）',
    '  disable                          关闭账号接力模块（不删除已捕获备份）',
    '  capture [--role primary|backup] [--alias <name>] [--models a,b]',
    '                                   捕获当前活跃凭据存入 OS 原生隔离备份槽',
    '  set-role <id> <primary|backup>   设置账号角色（设为主号时自动降级原主号）',
    '  snapshot [--slot <name>] [--cwd <dir>] [--next <text>]',
    '                                   写入 4 要素脱敏交接快照与槽位交接记忆',
    '  memories [--slot <name>] [--project <name>]',
    '                                   按时间倒序查看最近槽位交接记忆',
    '  switch <id> [--dry-run] [--no-snapshot] [--allow-uncaptured]',
    '                                   安全切换至目标账号凭据槽（推荐先加 --dry-run 预演）',
    '  delete <id>                      移除指定账号的隔离备份槽与元数据（不动活跃态）',
    '  verify                           只读校验会话库隔离与活跃凭据健康度',
    '',
    '通用参数:',
    '  --state-dir <dir>                覆写状态元数据目录（默认 ~/.gemini/antigravity/prism-suite）',
    '  --json                           以 JSON 格式输出（不含任何明文凭据）',
    '  -h, --help                       显示帮助信息'
  ].join('\n'));
}

export async function runAccountsCli(argv = process.argv.slice(2), deps = {}) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    return { help: true, ok: true };
  }

  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.has(a)) {
      if (i + 1 < argv.length && !isKnownCliFlag(argv[i + 1])) i++;
      continue;
    }
    if (a.startsWith('-')) continue;
    positional.push(a);
  }

  const cmd = positional[0] || 'status';
  if (!KNOWN_COMMANDS.has(cmd)) {
    throw Object.assign(new Error(`未知命令: ${cmd}`), { code: 'UNKNOWN_COMMAND' });
  }
  const asJson = argv.includes('--json');
  const stateDir = readFlagValue(argv, '--state-dir') || undefined;
  const ownsMemory = !deps.handoffMemory;
  const handoffMemory = deps.handoffMemory || createHandoffMemoryStore({ stateDir });
  const manager = deps.manager || createAccountManager({ stateDir, handoffMemory });

  try {
    let data;
    if (cmd === 'status') {
      data = manager.getStatus();
    } else if (cmd === 'enable') {
      data = { ok: true, state: manager.setEnabled(true) };
    } else if (cmd === 'disable') {
      data = { ok: true, state: manager.setEnabled(false) };
    } else if (cmd === 'capture') {
      const role = readFlagValue(argv, '--role') || undefined;
      const alias = readFlagValue(argv, '--alias') || '';
      const modelsRaw = readFlagValue(argv, '--models');
      const modelsSupported = modelsRaw ? modelsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
      data = manager.captureCurrentAccount({ role, alias, modelsSupported });
    } else if (cmd === 'set-role') {
      const id = positional[1];
      const role = positional[2];
      data = manager.updateAccount(id, { role });
    } else if (cmd === 'snapshot') {
      data = manager.saveHandoffSnapshot({
        slot: readFlagValue(argv, '--slot') || 'default',
        project: readFlagValue(argv, '--project') || '',
        cwd: readFlagValue(argv, '--cwd') || process.cwd(),
        verifiedSummary: readFlagValue(argv, '--verified') || '',
        nextAction: readFlagValue(argv, '--next') || ''
      });
    } else if (cmd === 'memories') {
      data = handoffMemory.list({
        slot: readFlagValue(argv, '--slot') || '',
        project: readFlagValue(argv, '--project') || '',
        limit: 10
      });
    } else if (cmd === 'switch') {
      const targetId = positional[1];
      const dryRun = argv.includes('--dry-run');
      const saveSnapshot = !argv.includes('--no-snapshot');
      const allowUncapturedActive = argv.includes('--allow-uncaptured');
      data = manager.switchAccount(targetId, {
        dryRun,
        saveSnapshot,
        allowUncapturedActive,
        handoff: { cwd: readFlagValue(argv, '--cwd') || process.cwd() }
      });
    } else if (cmd === 'delete') {
      const targetId = positional[1];
      data = manager.deleteAccount(targetId);
    } else if (cmd === 'verify') {
      data = manager.verifyDataIntegrity();
    } else {
      throw Object.assign(new Error(`未知命令: ${cmd}`), { code: 'UNKNOWN_COMMAND' });
    }

    return { help: false, asJson, cmd, data };
  } finally {
    if (ownsMemory) {
      try { handoffMemory.close?.(); } catch {}
    }
  }
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
})();

if (isMain) {
  runAccountsCli(process.argv.slice(2))
    .then((res) => {
      if (res.help) {
        printHelp();
        return;
      }
      if (res.asJson) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      const d = res.data;
      if (res.cmd === 'status') {
        console.log('=== Anti-Claude Prism Suite · 主备账号接力状态 ===');
        console.log(`模块开关: ${d.enabled ? '✅ 已开启' : '🔒 默认关闭 (使用 enable 开启)'}`);
        console.log(`凭据后端: ${d.vault.backend} (${d.vault.ok ? '就绪' : '不可用'})`);
        console.log(`当前活跃: ${d.activeCredential.exists ? (d.activeCredential.email || '(无法识别邮箱)') : '(未登录)'}`);
        console.log(`已捕获账号 (${d.accounts.length}):`);
        for (const a of d.accounts) {
          const mark = a.isCurrentActive ? '★ ' : '  ';
          const roleLbl = a.role === 'primary' ? '[主号]' : '[备用]';
          console.log(`${mark}${a.id} ${roleLbl} ${a.alias || ''} <${a.email}> ${a.vaultHasBackup ? '🔐已备份' : '⚠️缺备份'}`);
        }
      } else if (res.cmd === 'memories') {
        console.log(`=== 最近槽位交接记忆 (${d.entries.length} / ${d.total}) ===`);
        for (const e of d.entries) {
          console.log(`- [${e.slotTag}] ${e.createdAt} | ${e.summary}`);
          if (e.nextAction) console.log(`  下一步: ${e.nextAction}`);
        }
      } else {
        console.log(d.message || JSON.stringify(d, null, 2));
      }
    })
    .catch((err) => {
      console.error(`[prism-accounts] 错误 (${err?.code || 'ERR'}): ${err?.message || err}`);
      process.exitCode = 1;
    });
}
