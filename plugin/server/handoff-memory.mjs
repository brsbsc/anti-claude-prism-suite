/**
 * Zero-dependency structured Slot Handoff Memory store for Anti-Claude Prism Suite (v0.5.0).
 *
 * Complementary to Tab 4 transcript search (which scans raw chat logs) and external memory-mcp:
 * - Stores concise 4-element slot handoff records in ~/.gemini/antigravity/prism-suite/handoff-memories.jsonl (0600).
 * - Strictly orders list() chronologically (newest first) so stale milestones never shadow latest progress.
 * - Redacts tokens/secrets/JWTs/passwords BEFORE persisting to disk or returning to callers.
 * - Generates copy-ready sync prompts for users who also run external memory-mcp (memory_store / resume).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_ENTRY_BYTES = 8192;

export function redactMemoryText(text) {
  let out = String(text ?? '');
  if (!out) return '';
  // Private keys
  out = out.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
    '[REDACTED_PRIVATE_KEY]'
  );
  // sk-... OpenAI / Anthropic / Stripe keys
  out = out.replace(/\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_API_KEY]');
  // GitHub tokens
  out = out.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED_GH_TOKEN]');
  // Google API keys
  out = out.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_GOOGLE_KEY]');
  // Standard 3-segment JWTs
  out = out.replace(/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]');
  // Bearer tokens
  out = out.replace(/\b(Bearer[ \t]+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED_TOKEN]');
  // key=value / key: value credential assignments
  out = out.replace(
    /\b([A-Za-z0-9_.-]*(?:password|passwd|token|secret|api[_-]?key)[ \t]*[:=][ \t]*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;'"`]+)/gi,
    '$1[REDACTED]'
  );
  return out;
}

function normalizeSlug(val, fallback = 'default', maxLen = 40) {
  const s = String(val || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
  return s || fallback;
}

function normalizeTags(rawTags, project, slot) {
  const set = new Set([`project:${project}`, `handoff:${project}:${slot}`]);
  if (Array.isArray(rawTags)) {
    for (const t of rawTags) {
      const clean = redactMemoryText(String(t || '').trim()).slice(0, 64);
      if (clean) set.add(clean);
    }
  }
  return Array.from(set).slice(0, 16);
}

function writeJsonlAtomic0600(filePath, entries) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.prism-mem-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  const payload = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
  try {
    fs.writeFileSync(tmpPath, payload, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(tmpPath, 0o600);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.rmSync(tmpPath, { force: true }); } catch {}
    throw err;
  }
}

export function createHandoffMemoryStore(options = {}) {
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const stateDir = path.resolve(options.stateDir || path.join(homeDir, '.gemini', 'antigravity', 'prism-suite'));
  const filePath = path.join(stateDir, 'handoff-memories.jsonl');
  const maxEntries = Math.max(10, Math.min(2000, Number(options.maxEntries) || 500));

  function readAllNewestFirst() {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    const items = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        if (obj && typeof obj === 'object' && obj.id) {
          items.push(obj);
        }
      } catch {
        // skip corrupted line
      }
    }
    // Strict chronological newest-first ordering
    items.sort((a, b) => {
      const ta = Number(a.createdAtMs) || Date.parse(a.createdAt || '') || 0;
      const tb = Number(b.createdAtMs) || Date.parse(b.createdAt || '') || 0;
      if (tb !== ta) return tb - ta;
      return String(b.id).localeCompare(String(a.id));
    });
    return items;
  }

  function store(input = {}) {
    const nowMs = Number(input.createdAtMs) || Date.now();
    const createdAt = input.createdAt || new Date(nowMs).toISOString();
    const project = normalizeSlug(input.project || (input.cwd ? path.basename(String(input.cwd)) : 'workspace'), 'workspace', 48);
    const slot = normalizeSlug(input.slot || 'default', 'default', 32);
    const tags = normalizeTags(input.tags, project, slot);

    const entry = {
      id: `mem-${nowMs}-${crypto.randomBytes(3).toString('hex')}`,
      createdAt,
      createdAtMs: nowMs,
      project,
      slot,
      slotTag: `handoff:${project}:${slot}`,
      tags,
      source: redactMemoryText(String(input.source || 'manual').slice(0, 32)),
      summary: redactMemoryText(String(input.summary || '').trim().slice(0, 600)),
      cwd: redactMemoryText(String(input.cwd || '').trim().slice(0, 300)),
      gitBranch: redactMemoryText(String(input.gitBranch || '').trim().slice(0, 96)),
      gitHead: redactMemoryText(String(input.gitHead || '').trim().slice(0, 24)),
      gitDirtyCount: Math.max(0, Math.round(Number(input.gitDirtyCount) || 0)),
      conversationPath: redactMemoryText(String(input.conversationPath || '').trim().slice(0, 240)),
      verified: redactMemoryText(String(input.verified || '').trim().slice(0, 1200)),
      nextAction: redactMemoryText(String(input.nextAction || '').trim().slice(0, 800)),
      content: redactMemoryText(String(input.content || '').trim().slice(0, 2400))
    };

    if (!entry.summary && !entry.content && !entry.verified && !entry.nextAction) {
      throw Object.assign(new Error('交接记忆内容不能为空（至少填写 summary / verified / nextAction / content 之一）'), {
        code: 'EMPTY_MEMORY'
      });
    }
    if (!entry.summary) {
      entry.summary = (entry.nextAction || entry.verified || entry.content).slice(0, 160);
    }

    // Bound serialized entry below MAX_ENTRY_BYTES
    while (Buffer.byteLength(JSON.stringify(entry), 'utf8') > MAX_ENTRY_BYTES && entry.content.length > 0) {
      entry.content = entry.content.slice(0, Math.floor(entry.content.length * 0.7));
    }
    while (Buffer.byteLength(JSON.stringify(entry), 'utf8') > MAX_ENTRY_BYTES && entry.verified.length > 0) {
      entry.verified = entry.verified.slice(0, Math.floor(entry.verified.length * 0.7));
    }

    const existing = readAllNewestFirst();
    const next = [entry, ...existing].slice(0, maxEntries);
    writeJsonlAtomic0600(filePath, next);
    return entry;
  }

  function list({ project = '', slot = '', tag = '', limit = 10 } = {}) {
    const cleanProject = project ? normalizeSlug(project, '', 48) : '';
    const cleanSlot = slot ? normalizeSlug(slot, '', 32) : '';
    const cleanTag = String(tag || '').trim().toLowerCase();
    const cap = Math.max(1, Math.min(100, Number(limit) || 10));

    const all = readAllNewestFirst();
    const filtered = all.filter((e) => {
      if (cleanProject && e.project !== cleanProject) return false;
      if (cleanSlot && e.slot !== cleanSlot) return false;
      if (cleanTag) {
        const hasTag = Array.isArray(e.tags) && e.tags.some((t) => String(t).toLowerCase() === cleanTag);
        if (!hasTag && String(e.slotTag || '').toLowerCase() !== cleanTag) return false;
      }
      return true;
    });
    return {
      ok: true,
      total: filtered.length,
      entries: filtered.slice(0, cap)
    };
  }

  function search({ query = '', project = '', slot = '', tag = '', limit = 10 } = {}) {
    const q = redactMemoryText(String(query || '').trim()).toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 8);
    if (!terms.length) {
      return list({ project, slot, tag, limit });
    }
    const { entries: pool } = list({ project, slot, tag, limit: 500 });
    const cap = Math.max(1, Math.min(50, Number(limit) || 10));
    const scored = [];
    const now = Date.now();

    for (const e of pool) {
      const haySummary = `${e.summary} ${e.nextAction}`.toLowerCase();
      const hayTags = (Array.isArray(e.tags) ? e.tags.join(' ') : '').toLowerCase();
      const hayBody = `${e.verified} ${e.content} ${e.cwd} ${e.gitBranch}`.toLowerCase();
      let score = 0;
      let matched = false;

      if (haySummary.includes(q)) { score += 20; matched = true; }
      if (hayBody.includes(q)) { score += 10; matched = true; }

      let termHits = 0;
      for (const term of terms) {
        let hit = false;
        if (haySummary.includes(term)) { score += 8; hit = true; }
        if (hayTags.includes(term)) { score += 6; hit = true; }
        if (hayBody.includes(term)) { score += 4; hit = true; }
        if (hit) termHits++;
      }
      if (termHits > 0) matched = true;
      if (!matched) continue;

      const ageHours = Math.max(0, (now - (Number(e.createdAtMs) || now)) / 3600000);
      const recencyBonus = ageHours < 24 ? 5 : ageHours < 168 ? 2 : 0;
      scored.push({ entry: e, score: score + recencyBonus });
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (Number(b.entry.createdAtMs) || 0) - (Number(a.entry.createdAtMs) || 0);
    });

    return {
      ok: true,
      total: scored.length,
      entries: scored.slice(0, cap).map((s) => s.entry)
    };
  }

  function remove(id) {
    const cleanId = String(id || '').trim();
    if (!cleanId) return { ok: false, removed: false };
    const existing = readAllNewestFirst();
    const filtered = existing.filter((e) => e.id !== cleanId);
    if (filtered.length === existing.length) {
      return { ok: true, removed: false };
    }
    writeJsonlAtomic0600(filePath, filtered);
    return { ok: true, removed: true };
  }

  function formatExternalMemoryStorePrompt(entry) {
    if (!entry) return '';
    const contentLines = [
      `[${entry.slotTag}] (${entry.createdAt})`,
      `工作目录：${entry.cwd || '(未指定)'}`,
      `Git：${entry.gitBranch ? `${entry.gitBranch} @ ${entry.gitHead || '-'} (改动 ${entry.gitDirtyCount} 项)` : '非 Git 目录'}`,
      `已验证进度：${entry.verified || entry.summary}`,
      `下一步：${entry.nextAction || '继续推进'}`
    ];
    return [
      '请调用 memory_store（或写入你外部的 memory-mcp）记录以下 4 要素交接记忆：',
      `- tags: ${JSON.stringify(entry.tags)}`,
      `- summary: ${entry.summary}`,
      '- content:',
      contentLines.join('\n')
    ].join('\n');
  }

  function formatResumePrompt(entry) {
    if (!entry) return '';
    return [
      `接力 [${entry.slot}]`,
      `已对齐 [${entry.slotTag}]（来自 ${entry.createdAt} 交接）｜工作目录：${entry.cwd || '(保持当前)'}｜上次进度：${entry.verified || entry.summary}｜现在继续：${entry.nextAction || '按上次进度继续'}`
    ].join('\n');
  }

  return {
    filePath,
    store,
    list,
    search,
    remove,
    formatExternalMemoryStorePrompt,
    formatResumePrompt
  };
}
