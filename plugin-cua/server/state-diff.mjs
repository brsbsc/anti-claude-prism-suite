// SPDX-License-Identifier: MIT
/**
 * Compact incremental state diff calculator for Prism Computer-Use observations.
 *
 * Compares window/tab title, URL, element count, newly appeared interactive refs,
 * disappeared refs, and value/state transitions, strictly capped at <= 30 lines.
 */

const DEFAULT_MAX_LINES = 30;

function compactText(raw, maxLen = 48) {
  const clean = String(raw ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(1, maxLen - 1))}…`;
}

function extractTitle(obs) {
  if (!obs || typeof obs !== 'object') return '';
  return compactText(
    obs.title ?? obs.windowTitle ?? obs.tabTitle ?? obs.window?.title ?? '',
    80
  );
}

function extractUrl(obs) {
  if (!obs || typeof obs !== 'object') return '';
  return compactText(
    obs.url ?? obs.tabUrl ?? obs.window?.url ?? '',
    96
  );
}

function normalizeRole(el) {
  const raw = String(
    el.role ?? el.controlType ?? el.tag ?? el.tagName ?? el.type ?? 'element'
  )
    .trim()
    .toLowerCase()
    .replace(/^controltype\./, '');
  return compactText(raw || 'element', 20);
}

function extractLabel(el) {
  return compactText(
    el.name ?? el.label ?? el.ariaLabel ?? el.text ?? el.placeholder ?? el.title ?? '',
    44
  );
}

function extractValueSummary(el) {
  if (el.isPassword || el.redacted || String(el.type ?? '').toLowerCase() === 'password') {
    return '[REDACTED]';
  }
  const hasExplicitValue = el.value !== undefined && el.value !== null;
  if (hasExplicitValue) {
    return compactText(String(el.value), 44);
  }
  const flags = [];
  if (typeof el.checked === 'boolean') flags.push(el.checked ? 'checked' : 'unchecked');
  if (typeof el.selected === 'boolean' && el.selected) flags.push('selected');
  if (typeof el.expanded === 'boolean') flags.push(el.expanded ? 'expanded' : 'collapsed');
  if (el.disabled === true || el.enabled === false) flags.push('disabled');
  return flags.join(',');
}

function isInteractiveRole(role) {
  return /^(?:button|link|input|edit|textbox|combobox|select|checkbox|radio|menuitem|tab|switch|slider|spinbutton|treeitem|listitem)$/i.test(
    role
  );
}

function flattenElementsMap(obs) {
  const map = new Map();
  let totalCount = 0;
  if (!obs || typeof obs !== 'object') {
    return { map, totalCount: 0 };
  }

  const visit = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      totalCount += 1;
      const rawRef = String(item.ref ?? item.id ?? '').trim();
      if (rawRef) {
        const ref = rawRef.startsWith('@') ? rawRef : `@${rawRef}`;
        const role = normalizeRole(item);
        const label = extractLabel(item);
        const value = extractValueSummary(item);
        const hasExplicitValue = item.value !== undefined && item.value !== null;
        map.set(ref, {
          ref,
          role,
          label,
          value,
          hasExplicitValue,
          interactive: item.interactive !== undefined ? Boolean(item.interactive) : isInteractiveRole(role)
        });
      }
      if (Array.isArray(item.children)) {
        visit(item.children);
      }
    }
  };

  visit(obs.elements);
  visit(obs.nodes);
  if (Array.isArray(obs.tree)) {
    visit(obs.tree);
  } else if (obs.tree && typeof obs.tree === 'object') {
    visit([obs.tree]);
  }

  return { map, totalCount };
}

function formatRefDescriptor(entry) {
  const labelPart = entry.label ? ` "${entry.label}"` : '';
  return `${entry.ref} [${entry.role}]${labelPart}`;
}

function capLines(rawLines, maxLines, overflowCounts) {
  const limit = Math.max(1, Math.min(DEFAULT_MAX_LINES, Number(maxLines) || DEFAULT_MAX_LINES));
  if (rawLines.length <= limit) {
    return rawLines;
  }
  if (limit === 1) {
    return [rawLines[0]];
  }
  const omitted = rawLines.length - (limit - 1);
  const statsSuffix = overflowCounts
    ? ` (总计 +${overflowCounts.added} / -${overflowCounts.removed} / ~${overflowCounts.modified})`
    : '';
  return [
    ...rawLines.slice(0, limit - 1),
    `... 其余 ${omitted} 项状态变更已折叠${statsSuffix}`
  ];
}

/**
 * Computes a concise, token-efficient incremental diff (<= 30 lines) between
 * two CUA observations.
 */
export function computeObservationDiff(beforeObs, afterObs, options = {}) {
  const maxLines = Math.max(
    1,
    Math.min(DEFAULT_MAX_LINES, Number(options.maxLines) || DEFAULT_MAX_LINES)
  );

  if (!afterObs || typeof afterObs !== 'object') {
    const lines = ['(无可用观察快照)'];
    const text = lines.join('\n');
    return {
      changed: false,
      lines,
      text,
      counts: { added: 0, removed: 0, modified: 0 }
    };
  }

  const afterTitle = extractTitle(afterObs);
  const afterUrl = extractUrl(afterObs);
  const { map: afterMap, totalCount: afterCount } = flattenElementsMap(afterObs);

  if (!beforeObs || typeof beforeObs !== 'object') {
    const initLines = [];
    if (afterTitle) initLines.push(`+ title: "${afterTitle}"`);
    if (afterUrl) initLines.push(`+ url: "${afterUrl}"`);
    initLines.push(`+ elements: ${afterCount}`);

    for (const entry of afterMap.values()) {
      if (entry.interactive || initLines.length < 10) {
        initLines.push(`+ ${formatRefDescriptor(entry)}`);
      }
    }

    const lines = capLines(initLines, maxLines, {
      added: afterMap.size,
      removed: 0,
      modified: 0
    });
    const text = lines.join('\n');
    return {
      changed: true,
      lines,
      text,
      counts: { added: afterMap.size, removed: 0, modified: 0 }
    };
  }

  const beforeTitle = extractTitle(beforeObs);
  const beforeUrl = extractUrl(beforeObs);
  const { map: beforeMap, totalCount: beforeCount } = flattenElementsMap(beforeObs);

  const headerChanges = [];
  if (beforeTitle !== afterTitle) {
    headerChanges.push(`~ title: "${beforeTitle}" -> "${afterTitle}"`);
  }
  if (beforeUrl !== afterUrl) {
    headerChanges.push(`~ url: "${beforeUrl}" -> "${afterUrl}"`);
  }
  if (beforeCount !== afterCount) {
    const delta = afterCount - beforeCount;
    const sign = delta > 0 ? `+${delta}` : `${delta}`;
    headerChanges.push(`~ elements: ${beforeCount} -> ${afterCount} (${sign})`);
  }

  const modifiedLines = [];
  const addedInteractive = [];
  const addedOther = [];
  const removedLines = [];

  for (const [ref, afterEntry] of afterMap.entries()) {
    const beforeEntry = beforeMap.get(ref);
    if (!beforeEntry) {
      const line = `+ ${formatRefDescriptor(afterEntry)}`;
      if (afterEntry.interactive) {
        addedInteractive.push(line);
      } else {
        addedOther.push(line);
      }
      continue;
    }

    if (beforeEntry.value !== afterEntry.value) {
      modifiedLines.push(`~ ${ref}: "${beforeEntry.value}" -> "${afterEntry.value}"`);
    } else if (beforeEntry.label !== afterEntry.label && afterEntry.label) {
      modifiedLines.push(`~ ${ref} [${afterEntry.role}]: "${beforeEntry.label}" -> "${afterEntry.label}"`);
    }
  }

  for (const [ref, beforeEntry] of beforeMap.entries()) {
    if (!afterMap.has(ref)) {
      removedLines.push(`- ${formatRefDescriptor(beforeEntry)}`);
    }
  }

  const counts = {
    added: addedInteractive.length + addedOther.length,
    removed: removedLines.length,
    modified: modifiedLines.length
  };

  const allDiffLines = [
    ...headerChanges,
    ...modifiedLines,
    ...addedInteractive,
    ...addedOther,
    ...removedLines
  ];

  if (allDiffLines.length === 0) {
    const steady = [`= 界面状态无变化 (elements: ${afterCount})`];
    const text = steady.join('\n');
    return {
      changed: false,
      lines: steady,
      text,
      counts
    };
  }

  const lines = capLines(allDiffLines, maxLines, counts);
  const text = lines.join('\n');
  return {
    changed: true,
    lines,
    text,
    counts
  };
}
