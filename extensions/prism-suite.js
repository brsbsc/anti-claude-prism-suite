/* ============================================================================
 * Anti-Claude Prism Suite v0.2.0 (Clean-Room Original, MIT)
 * Performance-first architecture:
 *   - Zero document.body MutationObserver (0.0ms typing latency in composer)
 *   - Stream ink observer attaches ONLY to [data-testid="autoscroll-viewport"]
 *     during active generation and disconnects immediately on idle
 *   - Typing-grace guard + visibility pause on lightweight periodic sync
 *   - Reused CSS Highlight objects with 30fps throttling & reduced-motion guard
 * ============================================================================ */
(() => {
  if (typeof window.__agPrismSuiteDispose === 'function') {
    try { window.__agPrismSuiteDispose(); } catch {}
  }

  const STORAGE_KEY = 'ag_prism_suite_prefs_v1';
  const MASCOT_SIZE_MIN = 16;
  const MASCOT_SIZE_MAX = 36;
  const MASCOT_SIZE_DEFAULT = 24;
  const MASCOT_MIN_COUNT_DEFAULT = 1;

  function clampMascotSize(val) {
    const n = Number(val);
    if (!Number.isFinite(n)) return MASCOT_SIZE_DEFAULT;
    const stepped = Math.round(n / 2) * 2;
    return Math.max(MASCOT_SIZE_MIN, Math.min(MASCOT_SIZE_MAX, stepped));
  }

  function clampMascotMinCount(val) {
    const n = Math.round(Number(val));
    if (!Number.isFinite(n)) return MASCOT_MIN_COUNT_DEFAULT;
    return Math.max(1, Math.min(3, n));
  }

  const DEFAULT_PREFS = {
    lightPalette: 'default',   // 'default' | 'crystal' | 'alabaster'
    darkPalette: 'default',    // 'default' | 'obsidian' | 'basalt'
    outline: true,             // Conversation outline + Alt+Up/Down turn jump
    usageExtra: true,          // Book yardstick + weekday-aligned 12-week heatmap
    inkStream: true,           // 5-stage CSS.highlights stream fade-in
    mascot: true,              // Composer pixel mascots (0fps idle)
    mascotCountMode: 'fixed',  // 'fixed' | 'agents' (follow live swarm / subagent count)
    mascotMinCount: MASCOT_MIN_COUNT_DEFAULT, // 1..3 floor count in 'agents' mode
    mascotStyle: 'trio',       // 'trio' | 'crab' | 'cat' (used in fixed mode)
    mascotRoam: true,          // Random run & leap along composer top while busy
    mascotSize: MASCOT_SIZE_DEFAULT, // 16..36 px (step 2)
    thoughtMode: 'bilingual'   // 'off' | 'bilingual' | 'immersive'
  };

  let prefs = (() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const merged = Object.assign({}, DEFAULT_PREFS, JSON.parse(raw));
        merged.mascotSize = clampMascotSize(merged.mascotSize);
        merged.mascotRoam = merged.mascotRoam !== false;
        merged.mascotCountMode = merged.mascotCountMode === 'agents' ? 'agents' : 'fixed';
        merged.mascotMinCount = clampMascotMinCount(merged.mascotMinCount);
        return merged;
      }
    } catch {}
    return Object.assign({}, DEFAULT_PREFS);
  })();

  function savePrefs() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch {}
  }

  let disposed = false;
  const cleanups = [];
  const onCleanup = (fn) => cleanups.push(fn);

  const REDUCED_MOTION = (() => {
    try {
      return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  })();

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtTokens(n) {
    const v = Number(n) || 0;
    if (!Number.isFinite(v) || v <= 0) return '0';
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '')}B`;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(Math.round(v));
  }

  /* ---- Typing-grace tracker: never run background DOM scans while user is typing ---- */
  let lastTypingAt = 0;
  function markUserTyping(e) {
    const t = e && e.target;
    if (t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) {
      lastTypingAt = Date.now();
    }
  }
  document.addEventListener('keydown', markUserTyping, { capture: true, passive: true });
  document.addEventListener('compositionstart', markUserTyping, { capture: true, passive: true });
  document.addEventListener('compositionupdate', markUserTyping, { capture: true, passive: true });
  onCleanup(() => {
    document.removeEventListener('keydown', markUserTyping, true);
    document.removeEventListener('compositionstart', markUserTyping, true);
    document.removeEventListener('compositionupdate', markUserTyping, true);
  });

  function isUserActivelyTyping() {
    return Date.now() - lastTypingAt < 1800;
  }

  /* ==========================================================================
   * 1. Multi-Palette Theme Application
   * ========================================================================== */
  const LIGHT_NAMES = { default: '纯白默认', crystal: '白昼冷晶', alabaster: '暖白画册' };
  const DARK_NAMES = { default: '暖炭默认', obsidian: '深空黑曜', basalt: '暖炭玄岩' };

  function isCurrentlyDark() {
    return (
      document.documentElement.getAttribute('data-ag-theme-mode') === 'dark' ||
      document.body.classList.contains('dark')
    );
  }

  function applyPalettes() {
    const html = document.documentElement;
    if (!html) return;
    if (prefs.lightPalette && prefs.lightPalette !== 'default') {
      html.setAttribute('data-ag-ps-light', prefs.lightPalette);
    } else {
      html.removeAttribute('data-ag-ps-light');
    }
    if (prefs.darkPalette && prefs.darkPalette !== 'default') {
      html.setAttribute('data-ag-ps-dark', prefs.darkPalette);
    } else {
      html.removeAttribute('data-ag-ps-dark');
    }
  }
  applyPalettes();
  onCleanup(() => {
    document.documentElement?.removeAttribute('data-ag-ps-light');
    document.documentElement?.removeAttribute('data-ag-ps-dark');
  });

  /* ==========================================================================
   * 2. Conversation Outline Drawer, Viewport-Anchored Alt+Up/Down Jump & /btw
   * ========================================================================== */
  let jumpToastTimer = 0;

  function showJumpToast(text) {
    let el = document.getElementById('ag-ps-jump-toast');
    if (!el && document.body) {
      el = document.createElement('div');
      el.id = 'ag-ps-jump-toast';
      el.setAttribute('data-ag-i18n-ignore', '1');
      document.body.appendChild(el);
    }
    if (!el) return;
    el.textContent = text;
    el.setAttribute('data-show', '1');
    clearTimeout(jumpToastTimer);
    jumpToastTimer = setTimeout(() => {
      el.removeAttribute('data-show');
    }, 2000);
  }
  onCleanup(() => clearTimeout(jumpToastTimer));

  function getUserTurnElements() {
    const nodes = Array.from(document.querySelectorAll('[data-testid="user-message-content"]'));
    return nodes.filter((n) => n && n.isConnected && (n.textContent || '').trim().length > 0);
  }

  function detectViewportTurnIndex(turns) {
    if (!turns.length) return -1;
    const vp = document.querySelector('[data-testid="autoscroll-viewport"]');
    const vpRect = vp ? vp.getBoundingClientRect() : { top: 0, height: window.innerHeight };
    const anchorY = vpRect.top + vpRect.height * 0.35;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < turns.length; i++) {
      const r = turns[i].getBoundingClientRect();
      const dist = Math.abs(r.top - anchorY);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function jumpToTurn(el, index, total) {
    if (!el) return;
    const bubble = el.closest('[data-testid="user-message-bubble"]') || el.closest('[data-testid="user-message"]') || el;
    bubble.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'center' });
    bubble.classList.remove('ag-ps-turn-pulse');
    void bubble.offsetWidth;
    bubble.classList.add('ag-ps-turn-pulse');
    setTimeout(() => bubble.classList.remove('ag-ps-turn-pulse'), 1500);
    const preview = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 36);
    showJumpToast(`第 ${index + 1} / ${total} 轮 · ${preview}`);
  }

  function insertBtwQuote(text) {
    const snippet = `/btw 关于「${String(text || '').replace(/\s+/g, ' ').trim().slice(0, 48)}」：`;
    const box = document.getElementById('antigravity.agentSidePanelInputBox');
    const editor = box && box.querySelector('[contenteditable="true"], textarea');
    let inserted = false;
    if (editor) {
      editor.focus();
      const before = (editor.textContent || editor.value || '').length;
      try {
        document.execCommand('insertText', false, snippet);
        const after = (editor.textContent || editor.value || '').length;
        inserted = after > before;
      } catch {}
      if (!inserted && editor.tagName === 'TEXTAREA') {
        editor.value = snippet + (editor.value || '');
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        inserted = true;
      }
    }
    if (inserted) {
      showJumpToast('已填入 /btw 支线提问前缀');
      return;
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(snippet).then(
        () => showJumpToast('已复制 /btw 引用，按 Ctrl+V 粘贴'),
        () => showJumpToast('未能写入输入框，请手动输入 /btw')
      );
    } else {
      showJumpToast('未能写入输入框，请手动输入 /btw');
    }
  }

  function stepTurn(delta) {
    if (!prefs.outline) return;
    const turns = getUserTurnElements();
    if (!turns.length) {
      showJumpToast('当前视图暂无可跳转的提问轮次');
      return;
    }
    // Always compute relative to current viewport reading position (never stale after manual scroll)
    const cur = detectViewportTurnIndex(turns);
    const next = Math.max(0, Math.min(turns.length - 1, cur + delta));
    jumpToTurn(turns[next], next, turns.length);
  }

  function isEditableTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  }

  function closeTopFloatingPanel(restoreFocus = false) {
    const pop = document.getElementById('ag-ps-popover');
    if (pop && pop.getAttribute('data-open') === '1') {
      pop.removeAttribute('data-open');
      syncToolbarActiveStates();
      if (restoreFocus) document.getElementById('ag-ps-btn-suite')?.focus();
      return true;
    }
    const drawer = document.getElementById('ag-ps-outline');
    if (drawer && drawer.getAttribute('data-open') === '1') {
      drawer.removeAttribute('data-open');
      syncToolbarActiveStates();
      if (restoreFocus) document.getElementById('ag-ps-btn-outline')?.focus();
      return true;
    }
    return false;
  }

  function onGlobalKeyDown(e) {
    if (disposed) return;
    if (e.key === 'Escape') {
      if (closeTopFloatingPanel(true)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (!prefs.outline) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.key === 'ArrowUp' && (!isEditableTarget(e.target) || e.shiftKey)) {
        e.preventDefault();
        stepTurn(-1);
      } else if (e.key === 'ArrowDown' && (!isEditableTarget(e.target) || e.shiftKey)) {
        e.preventDefault();
        stepTurn(1);
      } else if (e.key.toLowerCase() === 'o' && !isEditableTarget(e.target)) {
        e.preventDefault();
        toggleOutlineDrawer();
      }
    }
  }
  window.addEventListener('keydown', onGlobalKeyDown, true);
  onCleanup(() => window.removeEventListener('keydown', onGlobalKeyDown, true));

  let resizeRaf = 0;
  function onWindowResize() {
    if (disposed || resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      const pop = document.getElementById('ag-ps-popover');
      if (pop && pop.getAttribute('data-open') === '1') {
        positionFloatingPanel(pop, document.getElementById('ag-ps-btn-suite'));
      }
      const drawer = document.getElementById('ag-ps-outline');
      if (drawer && drawer.getAttribute('data-open') === '1') {
        positionFloatingPanel(drawer, document.getElementById('ag-ps-btn-outline'));
      }
      syncMascotCompactGuard();
    });
  }
  window.addEventListener('resize', onWindowResize, { passive: true });
  onCleanup(() => {
    window.removeEventListener('resize', onWindowResize);
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
  });

  function renderOutlineList(filter = '') {
    const drawer = document.getElementById('ag-ps-outline');
    if (!drawer) return;
    const list = drawer.querySelector('.ag-ps-outline-list');
    if (!list) return;
    const turns = getUserTurnElements();
    const curIdx = detectViewportTurnIndex(turns);
    const q = String(filter || '').trim().toLowerCase();
    const items = [];
    for (let i = 0; i < turns.length; i++) {
      const txt = (turns[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (q && !txt.toLowerCase().includes(q)) continue;
      items.push({ idx: i, txt, isCurrent: i === curIdx });
    }
    const countEl = drawer.querySelector('.ag-ps-outline-count');
    if (countEl) countEl.textContent = `已加载 ${turns.length} 轮`;

    if (!items.length) {
      list.innerHTML = `<div style="padding:14px 8px;text-align:center;color:var(--muted-foreground)">暂无匹配提问（快捷键 Alt+↑/↓ 跳轮）</div>`;
      return;
    }
    list.innerHTML = items
      .map(
        (it) =>
          `<button type="button" class="ag-ps-outline-item" data-turn-idx="${it.idx}"${it.isCurrent ? ' aria-current="true"' : ''}>
            <span class="ag-ps-outline-idx">#${it.idx + 1}</span>
            <span class="ag-ps-outline-txt" title="${escapeHtml(it.txt)}">${escapeHtml(it.txt.slice(0, 60))}</span>
            <span class="ag-ps-outline-btw" data-btw-idx="${it.idx}" title="作为 /btw 支线提问">btw</span>
          </button>`
      )
      .join('');
  }

  function ensureOutlineDrawer() {
    let drawer = document.getElementById('ag-ps-outline');
    if (drawer) return drawer;
    drawer = document.createElement('div');
    drawer.id = 'ag-ps-outline';
    drawer.setAttribute('data-ag-i18n-ignore', '1');
    drawer.innerHTML = `
      <div class="ag-ps-outline-hdr">
        <span style="font-weight:600;font-size:12.5px">会话大纲</span>
        <span class="ag-ps-outline-count ag-ps-pop-badge">0 轮</span>
      </div>
      <input type="text" class="ag-ps-outline-search" placeholder="筛选提问关键词… (Alt+↑/↓ 跳轮 · Esc 关)" />
      <div class="ag-ps-outline-list"></div>
    `;
    const input = drawer.querySelector('.ag-ps-outline-search');
    input.addEventListener('input', () => renderOutlineList(input.value));
    drawer.addEventListener('click', (e) => {
      const btw = e.target.closest('[data-btw-idx]');
      if (btw) {
        e.stopPropagation();
        const idx = Number(btw.getAttribute('data-btw-idx'));
        const turns = getUserTurnElements();
        if (turns[idx]) insertBtwQuote(turns[idx].textContent || '');
        drawer.removeAttribute('data-open');
        syncToolbarActiveStates();
        return;
      }
      const row = e.target.closest('[data-turn-idx]');
      if (row) {
        const idx = Number(row.getAttribute('data-turn-idx'));
        const turns = getUserTurnElements();
        if (turns[idx]) {
          jumpToTurn(turns[idx], idx, turns.length);
          renderOutlineList(input ? input.value : '');
        }
      }
    });
    document.body.appendChild(drawer);
    onCleanup(() => drawer.remove());
    return drawer;
  }

  function positionFloatingPanel(panelEl, anchorBtn) {
    if (!panelEl) return;
    const rect = anchorBtn && anchorBtn.isConnected ? anchorBtn.getBoundingClientRect() : null;
    const topPx = rect ? Math.max(48, Math.round(rect.bottom + 8)) : 78;
    const widthPx = panelEl.offsetWidth || (panelEl.id === 'ag-ps-outline' ? 292 : 316);
    let leftPx = rect ? Math.round(rect.right - widthPx) : window.innerWidth - widthPx - 16;
    leftPx = Math.max(12, Math.min(window.innerWidth - widthPx - 12, leftPx));
    panelEl.style.top = `${topPx}px`;
    panelEl.style.left = `${leftPx}px`;
    panelEl.style.right = 'auto';
    panelEl.style.maxHeight = `calc(100vh - ${topPx + 14}px)`;
  }

  function toggleOutlineDrawer(forceState) {
    const drawer = ensureOutlineDrawer();
    const pop = document.getElementById('ag-ps-popover');
    if (pop) pop.removeAttribute('data-open');
    const open = typeof forceState === 'boolean' ? forceState : drawer.getAttribute('data-open') !== '1';
    if (open) {
      drawer.setAttribute('data-open', '1');
      positionFloatingPanel(drawer, document.getElementById('ag-ps-btn-outline'));
      const input = drawer.querySelector('.ag-ps-outline-search');
      if (input) input.value = '';
      renderOutlineList('');
    } else {
      drawer.removeAttribute('data-open');
    }
    syncToolbarActiveStates();
  }

  /* ==========================================================================
   * 3. Usage Book Yardstick + Weekday-Aligned 12-Week Heatmap
   * ========================================================================== */
  const BOOK_YARDSTICKS = [
    { name: '《道德经》', unit: '本', tokens: 7600 },
    { name: '《小王子》', unit: '本', tokens: 21000 },
    { name: '《变形记》', unit: '本', tokens: 28000 },
    { name: '《老人与海》', unit: '本', tokens: 36000 },
    { name: '《浮士德》', unit: '本', tokens: 54000 },
    { name: '《围城》', unit: '本', tokens: 180000 },
    { name: '《三体》全集', unit: '套', tokens: 880000 },
    { name: '《红楼梦》', unit: '部', tokens: 960000 },
    { name: '《哈利·波特》全集', unit: '套', tokens: 1450000 },
    { name: '《大英百科全书》', unit: '套', tokens: 55000000 },
    { name: '《四库全书》', unit: '部', tokens: 550000000 }
  ];

  function pickBookYardstick(totalTokens) {
    const t = Number(totalTokens) || 0;
    if (t < 1500) return '刚翻开扉页';
    let chosen = BOOK_YARDSTICKS[0];
    for (const b of BOOK_YARDSTICKS) {
      if (t >= b.tokens * 0.75) chosen = b;
    }
    const mult = t / chosen.tokens;
    const multStr = mult >= 100 ? Math.round(mult).toString() : mult >= 10 ? mult.toFixed(1) : mult.toFixed(2).replace(/\.?0+$/, '');
    return `≈ ${multStr} ${chosen.unit}${chosen.name}`;
  }

  function computeStreakDays(hist) {
    if (!Array.isArray(hist) || !hist.length) return 0;
    let streak = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      if ((Number(hist[i].totalTokens) || 0) > 0) streak += 1;
      else if (i === hist.length - 1) continue; // Allow today still 0 when checking yesterday streak
      else break;
    }
    return streak;
  }

  let heatCache = { ts: 0, data: null };
  let heatInFlight = null;
  let heatPartialTimer = 0;
  let bookScopeIdx = 0; // 0: 12周, 1: 今日

  function ensureHeatmapData(force = false) {
    if (!prefs.usageExtra || typeof window.__agProjectCall !== 'function') return null;
    const now = Date.now();
    if (!force && heatCache.data && !heatCache.data.partial && now - heatCache.ts < 30000) {
      return heatCache.data;
    }
    if (!heatInFlight) {
      heatInFlight = Promise.resolve(window.__agProjectCall('getUsageSummary', { days: 84, force: Boolean(force) }, 10000))
        .then((res) => {
          if (disposed || !res || !res.ok) return;
          heatCache = { ts: Date.now(), data: res };
          syncUsageExtraMount();
          if (res.partial && !document.hidden) {
            clearTimeout(heatPartialTimer);
            heatPartialTimer = setTimeout(() => {
              heatPartialTimer = 0;
              if (!disposed && prefs.usageExtra && !document.hidden) ensureHeatmapData(true);
            }, 1100);
          }
        })
        .catch(() => {})
        .finally(() => { heatInFlight = null; });
    }
    return heatCache.data;
  }
  onCleanup(() => clearTimeout(heatPartialTimer));

  function syncUsageExtraMount() {
    const cardBody = document.querySelector('#ag-claude-ov-sections [data-ov-card="usage"] .ag-ov-card-body');
    const existing = cardBody && cardBody.querySelector('.ag-ps-usage-extra');
    if (!prefs.usageExtra) {
      if (existing) existing.remove();
      return;
    }
    if (!cardBody) return;
    const data = ensureHeatmapData(false);
    if (!data || !Array.isArray(data.dailyHistory) || !data.dailyHistory.length) return;

    const hist = data.dailyHistory;
    const scopeTokens = bookScopeIdx === 0 ? data.totalWindowTokens : (data.today ? data.today.totalTokens : 0);
    const scopeLbl = bookScopeIdx === 0 ? '近12周' : '今日';
    const bookText = pickBookYardstick(scopeTokens);
    const sig = `${data.todayDate}|${data.totalWindowTokens}|${data.today?.totalTokens}|${data.partial ? 1 : 0}|${bookScopeIdx}`;

    if (existing && existing.getAttribute('data-sig') === sig) return;

    const maxTok = hist.reduce((m, d) => Math.max(m, Number(d.totalTokens) || 0), 0);
    const activeDays = hist.filter((d) => (Number(d.totalTokens) || 0) > 0).length;
    const streak = computeStreakDays(hist);
    const avgActive = activeDays > 0 ? Math.round(data.totalWindowTokens / activeDays) : 0;
    const defaultMeta = data.partial
      ? `同步中 · 活跃 ${activeDays} 天`
      : `连续 ${streak} 天 · 活跃日均 ${fmtTokens(avgActive)}`;

    // Align grid rows strictly to Monday (0) .. Sunday (6)
    const firstParts = String(hist[0].date || '').split('-').map(Number);
    const firstDate = firstParts.length === 3 ? new Date(firstParts[0], firstParts[1] - 1, firstParts[2]) : new Date();
    const leadPads = (firstDate.getDay() + 6) % 7;

    const padHtml = Array.from({ length: leadPads }, () => `<span class="ag-ps-heat-cell is-pad" aria-hidden="true"></span>`).join('');
    const cellsHtml = hist
      .map((d) => {
        const tot = Number(d.totalTokens) || 0;
        let lv = 0;
        if (tot > 0 && maxTok > 0) {
          const r = tot / maxTok;
          lv = r >= 0.72 ? 4 : r >= 0.42 ? 3 : r >= 0.16 ? 2 : 1;
        }
        const tip = tot > 0 ? `${d.label} · ${fmtTokens(tot)} · ${d.activeSessions}会话` : `${d.label} · 无消耗`;
        return `<span class="ag-ps-heat-cell" data-lv="${lv}" data-tip="${escapeHtml(tip)}" title="${escapeHtml(`${d.date}: ${fmtTokens(tot)} (${d.activeSessions} 会话)`)}"></span>`;
      })
      .join('');

    const wrap = existing || document.createElement('div');
    wrap.className = 'ag-ps-usage-extra';
    wrap.setAttribute('data-sig', sig);
    wrap.innerHTML = `
      <div class="ag-ps-book-row" title="点击切换 今日 / 近12周 名著换算（基于精确总量 ${fmtTokens(scopeTokens)}）">
        <span class="ag-ov-muted">📚 ${scopeLbl}体量</span>
        <span class="ag-ps-book-val">${escapeHtml(bookText)}</span>
      </div>
      <div class="ag-ps-heat-hdr">
        <span class="ag-ov-muted">12 周热力图</span>
        <span class="ag-ps-heat-meta ag-ov-tabular" data-default="${escapeHtml(defaultMeta)}">${escapeHtml(defaultMeta)}</span>
      </div>
      <div class="ag-ps-heat-grid">${padHtml}${cellsHtml}</div>
      <div class="ag-ps-heat-foot ag-ov-tabular">
        <span>周一→周日</span>
        <span>活跃 ${activeDays} / ${hist.length} 天</span>
      </div>
    `;
    if (!existing) {
      wrap.addEventListener('click', (e) => {
        if (e.target.closest('.ag-ps-book-row')) {
          bookScopeIdx = (bookScopeIdx + 1) % 2;
          syncUsageExtraMount();
        }
      });
      wrap.addEventListener('mouseover', (e) => {
        const cell = e.target.closest('.ag-ps-heat-cell[data-tip]');
        if (!cell) return;
        const meta = wrap.querySelector('.ag-ps-heat-meta');
        if (meta) {
          meta.textContent = cell.getAttribute('data-tip') || defaultMeta;
          meta.setAttribute('data-hover', '1');
        }
      });
      wrap.addEventListener('mouseout', (e) => {
        const cell = e.target.closest('.ag-ps-heat-cell');
        if (!cell || (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.ag-ps-heat-cell'))) return;
        const meta = wrap.querySelector('.ag-ps-heat-meta');
        if (meta) {
          meta.textContent = meta.getAttribute('data-default') || defaultMeta;
          meta.removeAttribute('data-hover');
        }
      });
      cardBody.appendChild(wrap);
    }
  }

  /* ==========================================================================
   * 4. Zero-Latency 5-Stage Ink Stream Fade-In
   *    - NEVER observes document.body (0.0ms impact on typing in composer)
   *    - Attaches ONLY to [data-testid="autoscroll-viewport"] while generating
   *    - Reuses 5 persistent Highlight instances + 30fps throttling
   * ========================================================================== */
  const SUPPORTS_HIGHLIGHTS = typeof CSS !== 'undefined' && Boolean(CSS.highlights) && typeof Highlight === 'function';
  const INK_NAMES = ['ag-ps-ink-1', 'ag-ps-ink-2', 'ag-ps-ink-3', 'ag-ps-ink-4', 'ag-ps-ink-5'];
  const INK_HIGHLIGHTS = SUPPORTS_HIGHLIGHTS ? INK_NAMES.map(() => new Highlight()) : [];
  const INK_DURATION_MS = 320;
  const INK_FRAME_INTERVAL_MS = 33; // ~30fps cap even on 144Hz/300Hz monitors
  let inkEntries = [];
  let inkRafId = 0;
  let lastInkTickMs = 0;
  const seenTextLens = new WeakMap();

  function clearInkHighlights() {
    if (inkRafId) {
      cancelAnimationFrame(inkRafId);
      inkRafId = 0;
    }
    inkEntries = [];
    if (SUPPORTS_HIGHLIGHTS) {
      for (let i = 0; i < INK_NAMES.length; i++) {
        try {
          INK_HIGHLIGHTS[i].clear();
          CSS.highlights.delete(INK_NAMES[i]);
        } catch {}
      }
    }
  }

  function tickInkFade(now) {
    inkRafId = 0;
    if (disposed || !prefs.inkStream || REDUCED_MOTION || !SUPPORTS_HIGHLIGHTS || !inkEntries.length) {
      clearInkHighlights();
      return;
    }
    if (now - lastInkTickMs < INK_FRAME_INTERVAL_MS) {
      inkRafId = requestAnimationFrame(tickInkFade);
      return;
    }
    lastInkTickMs = now;
    for (let i = 0; i < 5; i++) INK_HIGHLIGHTS[i].clear();
    const alive = [];
    for (const item of inkEntries) {
      const age = now - item.startMs;
      if (age >= INK_DURATION_MS) continue;
      if (!item.range || !item.range.startContainer || !item.range.startContainer.isConnected) continue;
      const stage = Math.min(4, Math.floor((age / INK_DURATION_MS) * 5));
      INK_HIGHLIGHTS[stage].add(item.range);
      alive.push(item);
    }
    inkEntries = alive;
    for (let i = 0; i < 5; i++) {
      try {
        if (INK_HIGHLIGHTS[i].size > 0) CSS.highlights.set(INK_NAMES[i], INK_HIGHLIGHTS[i]);
        else CSS.highlights.delete(INK_NAMES[i]);
      } catch {}
    }
    if (inkEntries.length) {
      inkRafId = requestAnimationFrame(tickInkFade);
    }
  }

  function pushInkRange(textNode, fromIdx, toIdx) {
    if (!SUPPORTS_HIGHLIGHTS || !prefs.inkStream || REDUCED_MOTION || !textNode || textNode.nodeType !== 3) return;
    if (toIdx <= fromIdx || toIdx > textNode.length) return;
    try {
      const range = document.createRange();
      range.setStart(textNode, fromIdx);
      range.setEnd(textNode, toIdx);
      inkEntries.push({ range, startMs: performance.now() });
      if (inkEntries.length > 36) inkEntries = inkEntries.slice(-36);
      if (!inkRafId) inkRafId = requestAnimationFrame(tickInkFade);
    } catch {}
  }

  let streamObserver = null;
  let observedStreamVp = null;

  function detachStreamObserver() {
    if (streamObserver) {
      streamObserver.disconnect();
      streamObserver = null;
    }
    observedStreamVp = null;
  }

  function syncStreamObserver(isBusy) {
    if (disposed || !prefs.inkStream || REDUCED_MOTION || !SUPPORTS_HIGHLIGHTS || !isBusy || document.hidden) {
      detachStreamObserver();
      if (!isBusy) clearInkHighlights();
      return;
    }
    const vp = document.querySelector('[data-testid="autoscroll-viewport"]');
    if (!vp) return;
    if (streamObserver && observedStreamVp === vp) return;
    detachStreamObserver();
    observedStreamVp = vp;
    streamObserver = new MutationObserver((mutations) => {
      if (disposed || !prefs.inkStream) return;
      for (const m of mutations) {
        if (m.type === 'characterData' && m.target && m.target.nodeType === 3) {
          const parent = m.target.parentElement;
          if (!parent || parent.closest('pre, code') || !parent.closest('[data-testid="planner-response-text"]')) continue;
          const prevLen = seenTextLens.get(m.target) || 0;
          const curLen = m.target.length;
          seenTextLens.set(m.target, curLen);
          if (curLen > prevLen) pushInkRange(m.target, prevLen, curLen);
        } else if (m.type === 'childList' && m.addedNodes && m.addedNodes.length) {
          const host = m.target && m.target.nodeType === 1 ? m.target : m.target?.parentElement;
          if (!host || host.closest('pre, code') || !host.closest('[data-testid="planner-response-text"]')) continue;
          for (const n of m.addedNodes) {
            if (n.nodeType === 3 && n.length > 0 && n.length <= 240) {
              seenTextLens.set(n, n.length);
              pushInkRange(n, 0, n.length);
            }
          }
        }
      }
    });
    streamObserver.observe(vp, { childList: true, subtree: true, characterData: true });
  }
  onCleanup(() => {
    detachStreamObserver();
    clearInkHighlights();
  });

  function isAgentGenerating() {
    return Boolean(document.querySelector('[data-testid="input-cancel-button"]'));
  }

  /* ==========================================================================
   * 5. Composer Pixel Mascots (Original Crisp Pixel SVGs, 0fps Idle)
   * ========================================================================== */
  const SVG_CRAB = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="2" y="2" width="1" height="2" fill="#E06C3A"/><rect x="9" y="2" width="1" height="2" fill="#E06C3A"/>
    <rect x="1" y="3" width="1" height="2" fill="#F28552"/><rect x="10" y="3" width="1" height="2" fill="#F28552"/>
    <rect x="3" y="3" width="6" height="5" fill="#EA7541"/><rect x="2" y="4" width="8" height="3" fill="#EA7541"/>
    <rect x="4" y="5" width="1" height="1" fill="#18181B"/><rect x="7" y="5" width="1" height="1" fill="#18181B"/>
    <rect x="2" y="8" width="1" height="2" fill="#C9592B"/><rect x="4" y="8" width="1" height="2" fill="#C9592B"/>
    <rect x="7" y="8" width="1" height="2" fill="#C9592B"/><rect x="9" y="8" width="1" height="2" fill="#C9592B"/>
  </svg>`;

  const SVG_CAT = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="2" y="1" width="2" height="2" fill="#8B5CF6"/><rect x="8" y="1" width="2" height="2" fill="#8B5CF6"/>
    <rect x="2" y="3" width="8" height="5" fill="#9D76FA"/><rect x="3" y="2" width="6" height="1" fill="#9D76FA"/>
    <rect x="4" y="5" width="1" height="1" fill="#18181B"/><rect x="7" y="5" width="1" height="1" fill="#18181B"/>
    <rect x="5" y="6" width="2" height="1" fill="#F9A8D4"/>
    <rect x="3" y="8" width="2" height="2" fill="#7C3AED"/><rect x="7" y="8" width="2" height="2" fill="#7C3AED"/>
    <rect x="10" y="6" width="1" height="3" fill="#8B5CF6"/>
  </svg>`;

  const SVG_SLIME = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="4" y="3" width="4" height="1" fill="#3B82F6"/>
    <rect x="3" y="4" width="6" height="1" fill="#60A5FA"/>
    <rect x="2" y="5" width="8" height="4" fill="#3B82F6"/>
    <rect x="3" y="9" width="6" height="1" fill="#2563EB"/>
    <rect x="4" y="6" width="1" height="1" fill="#FFFFFF"/><rect x="7" y="6" width="1" height="1" fill="#FFFFFF"/>
  </svg>`;

  const SVG_FROG = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="2" y="2" width="2" height="2" fill="#22C55E"/><rect x="8" y="2" width="2" height="2" fill="#22C55E"/>
    <rect x="3" y="2" width="1" height="1" fill="#18181B"/><rect x="8" y="2" width="1" height="1" fill="#18181B"/>
    <rect x="2" y="4" width="8" height="4" fill="#4ADE80"/>
    <rect x="4" y="6" width="4" height="2" fill="#BBF7D0"/>
    <rect x="2" y="8" width="2" height="2" fill="#16A34A"/><rect x="8" y="8" width="2" height="2" fill="#16A34A"/>
  </svg>`;

  const SVG_CHICK = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="5" y="1" width="2" height="1" fill="#EA580C"/>
    <rect x="3" y="2" width="6" height="6" fill="#FBBF24"/>
    <rect x="2" y="4" width="8" height="3" fill="#F59E0B"/>
    <rect x="4" y="4" width="1" height="1" fill="#18181B"/><rect x="7" y="4" width="1" height="1" fill="#18181B"/>
    <rect x="5" y="5" width="2" height="1" fill="#EA580C"/>
    <rect x="4" y="8" width="1" height="2" fill="#D97706"/><rect x="7" y="8" width="1" height="2" fill="#D97706"/>
  </svg>`;

  const SVG_BUNNY = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="3" y="0" width="2" height="3" fill="#F472B6"/><rect x="7" y="0" width="2" height="3" fill="#F472B6"/>
    <rect x="3" y="3" width="6" height="5" fill="#F9A8D4"/>
    <rect x="2" y="4" width="8" height="3" fill="#F472B6"/>
    <rect x="4" y="5" width="1" height="1" fill="#18181B"/><rect x="7" y="5" width="1" height="1" fill="#18181B"/>
    <rect x="3" y="8" width="2" height="2" fill="#DB2777"/><rect x="7" y="8" width="2" height="2" fill="#DB2777"/>
  </svg>`;

  const SPRITE_POOL = [SVG_CRAB, SVG_CAT, SVG_SLIME, SVG_FROG, SVG_CHICK, SVG_BUNNY];
  const MAX_DYNAMIC_ACTORS = 8;

  function hashString(str) {
    let h = 2166136261;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function getCurrentCascadeIdFromUrl() {
    const m = String(window.location.pathname || '').match(/\/c\/([0-9a-f-]{36})/i);
    return m ? m[1] : (window.__ag_watched_cascade_id || '');
  }

  function getLiveSubagents() {
    const metrics = window.__ag_last_metrics;
    const curId = getCurrentCascadeIdFromUrl();
    if (!metrics || !metrics.stats || !Array.isArray(metrics.stats.children)) return [];
    if (curId && metrics.cascadeId && metrics.cascadeId !== curId) return [];
    return metrics.stats.children
      .filter((c) => c && !c.killed)
      .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
  }

  function buildMascotRoster(busy) {
    if (prefs.mascotCountMode === 'agents') {
      const subs = getLiveSubagents();
      // If overflow (> 7), prioritize running workers in selection, then sort stably by id so DOM never churns mid-roam
      const selectedSubs =
        subs.length > MAX_DYNAMIC_ACTORS - 1
          ? subs
              .slice()
              .sort((a, b) => {
                if (Boolean(b.running) !== Boolean(a.running)) return b.running ? 1 : -1;
                return String(a.id || '').localeCompare(String(b.id || ''));
              })
              .slice(0, MAX_DYNAMIC_ACTORS - 1)
              .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
          : subs;
      const visibleSubs = selectedSubs;
      const overflow = Math.max(0, subs.length - visibleSubs.length);
      const roster = [
        {
          key: 'coordinator',
          label: '主控 Agent',
          svg: SVG_CRAB,
          busy: Boolean(busy)
        }
      ];
      for (let i = 0; i < visibleSubs.length; i++) {
        const sub = visibleSubs[i];
        const name = sub.agentName || sub.title || `子 Agent #${i + 1}`;
        // Pick stable distinct sprite from non-crab pool first so coordinator stands out
        const poolIdx = 1 + (hashString(sub.id || name) % (SPRITE_POOL.length - 1));
        roster.push({
          key: `sub:${sub.id || i}`,
          label: name,
          svg: SPRITE_POOL[poolIdx],
          busy: Boolean(sub.running)
        });
      }
      // Guarantee user-selected floor count (1..3) so composer is never empty when no subagents are active
      const floorCount = clampMascotMinCount(prefs.mascotMinCount);
      const fillerSpecs = [
        { key: 'floor:cat', label: '保底伙伴 · 紫猫', svg: SVG_CAT },
        { key: 'floor:slime', label: '保底伙伴 · 蓝萌', svg: SVG_SLIME }
      ];
      let fi = 0;
      while (roster.length < floorCount && fi < fillerSpecs.length) {
        const f = fillerSpecs[fi++];
        roster.push({
          key: f.key,
          label: f.label,
          svg: f.svg,
          busy: Boolean(busy)
        });
      }
      return { roster, overflow, liveSubCount: subs.length };
    }
    const styleKey = prefs.mascotStyle || 'trio';
    const fixedItems =
      styleKey === 'crab'
        ? [{ key: 'fixed:crab', label: '橘蟹伙伴', svg: SVG_CRAB, busy: Boolean(busy) }]
        : styleKey === 'cat'
          ? [{ key: 'fixed:cat', label: '紫猫伙伴', svg: SVG_CAT, busy: Boolean(busy) }]
          : [
              { key: 'fixed:crab', label: '橘蟹伙伴', svg: SVG_CRAB, busy: Boolean(busy) },
              { key: 'fixed:cat', label: '紫猫伙伴', svg: SVG_CAT, busy: Boolean(busy) },
              { key: 'fixed:slime', label: '蓝萌伙伴', svg: SVG_SLIME, busy: Boolean(busy) }
            ];
    return { roster: fixedItems, overflow: 0, liveSubCount: 0 };
  }

  const CHEER_LINES = ['代码一遍过 ✨', '缓存命中稳稳的', '摸摸头，继续冲！', '0fps 节能待机中', '今天效率拉满 🚀'];
  let wasMascotBusy = false;
  let mascotCheerUntil = 0;
  let mascotIdleSince = Date.now();
  let mascotBubbleTimer = 0;
  let mascotRoamingActive = false;
  let mascotActors = []; // [{ key, label, busy, el, x, facing, moveTimer, settleTimer, clickTimer, roaming }]
  let lastTrackWidth = 0;
  let lastRosterSig = '';
  let mascotSnapRaf = 0;

  function cancelSnapRaf() {
    if (mascotSnapRaf) {
      cancelAnimationFrame(mascotSnapRaf);
      mascotSnapRaf = 0;
    }
  }
  onCleanup(cancelSnapRaf);

  function showMascotBubble(text, ms = 2000) {
    const dock = document.getElementById('ag-ps-mascot-dock');
    const b = dock && dock.querySelector('.ag-ps-mascot-bubble');
    if (!b) return;
    b.textContent = text;
    b.setAttribute('data-show', '1');
    clearTimeout(mascotBubbleTimer);
    mascotBubbleTimer = setTimeout(() => b.removeAttribute('data-show'), ms);
  }
  onCleanup(() => clearTimeout(mascotBubbleTimer));

  function getMascotDims() {
    const w = clampMascotSize(prefs.mascotSize);
    const h = Math.max(14, Math.round((w * 11) / 12));
    const gap = Math.max(4, Math.round(w * 0.22));
    return { w, h, gap };
  }

  function clearActorTimers(actor) {
    if (!actor) return;
    if (actor.moveTimer) { clearTimeout(actor.moveTimer); actor.moveTimer = 0; }
    if (actor.settleTimer) { clearTimeout(actor.settleTimer); actor.settleTimer = 0; }
    if (actor.clickTimer) { clearTimeout(actor.clickTimer); actor.clickTimer = 0; }
  }

  function getMascotRunwayBounds(dock) {
    const trackW = dock ? (dock.clientWidth || dock.parentElement?.getBoundingClientRect().width || 0) : 0;
    const { w } = getMascotDims();
    const hasBadge = Boolean(dock && dock.querySelector('.ag-ps-more-badge'));
    const minX = Math.min(92, Math.max(12, Math.round(trackW * 0.16)));
    const maxX = Math.max(minX, Math.round(trackW - (hasBadge ? 44 : 16) - w));
    return { trackW, w, minX, maxX, hasBadge };
  }

  function clampRoamingActorsInBounds(dock) {
    if (!dock || !mascotRoamingActive) return;
    const { trackW, minX, maxX } = getMascotRunwayBounds(dock);
    if (trackW <= 0) return;
    for (const actor of mascotActors) {
      if (!actor.roaming || !actor.el) continue;
      const clamped = Math.max(minX, Math.min(maxX, actor.x));
      if (Math.abs(clamped - actor.x) >= 1) {
        applyActorTransform(actor, clamped, actor.facing, 0.25);
      }
    }
  }

  function stopMascotRoaming(parkHome = true) {
    mascotRoamingActive = false;
    const dock = document.getElementById('ag-ps-mascot-dock');
    if (dock) dock.removeAttribute('data-roaming');
    for (const actor of mascotActors) {
      clearActorTimers(actor);
      actor.roaming = false;
      if (actor.el) actor.el.removeAttribute('data-act');
    }
    if (parkHome && dock) {
      parkActorsHome(dock, false);
    }
  }
  onCleanup(() => stopMascotRoaming(false));

  function computeHomePositions(trackW, count, hasOverflowBadge) {
    const { w, gap } = getMascotDims();
    const rightPad = hasOverflowBadge ? 44 : 16;
    const totalW = count * w + Math.max(0, count - 1) * gap;
    const startX = Math.max(12, Math.round(trackW - rightPad - totalW));
    const xs = [];
    for (let i = 0; i < count; i++) {
      xs.push(startX + i * (w + gap));
    }
    return xs;
  }

  function applyActorTransform(actor, x, facing, durSec) {
    if (!actor || !actor.el) return;
    actor.x = x;
    actor.facing = facing;
    actor.el.style.setProperty('--ag-ps-x', `${Math.round(x)}px`);
    actor.el.style.setProperty('--ag-ps-flip', String(facing));
    if (typeof durSec === 'number') {
      actor.el.style.setProperty('--ag-ps-dur', `${durSec.toFixed(2)}s`);
    }
  }

  function parkActorsHome(dock, instant, onlyIdleActors = false) {
    if (!dock || !mascotActors.length) return;
    const trackW = dock.clientWidth || dock.parentElement?.getBoundingClientRect().width || 0;
    if (trackW <= 0) return;
    lastTrackWidth = trackW;
    const hasBadge = Boolean(dock.querySelector('.ag-ps-more-badge'));
    const xs = computeHomePositions(trackW, mascotActors.length, hasBadge);
    cancelSnapRaf();
    if (instant) dock.setAttribute('data-snap', '1');
    else dock.removeAttribute('data-snap');
    mascotActors.forEach((actor, idx) => {
      if (onlyIdleActors && actor.roaming) return;
      if (actor.el) actor.el.removeAttribute('data-act');
      applyActorTransform(actor, xs[idx], 1, instant ? 0 : 0.55);
    });
    if (instant) {
      mascotSnapRaf = requestAnimationFrame(() => {
        mascotSnapRaf = 0;
        if (!disposed && dock.isConnected) dock.removeAttribute('data-snap');
      });
    }
  }

  function scheduleActorRoamStep(idx, initialDelayMs) {
    const actor = mascotActors[idx];
    if (!actor || !actor.roaming || !mascotRoamingActive || disposed || document.hidden) return;
    clearActorTimers(actor);
    const delay = typeof initialDelayMs === 'number'
      ? initialDelayMs
      : 900 + Math.floor(Math.random() * 1900);

    actor.moveTimer = setTimeout(() => {
      actor.moveTimer = 0;
      if (!actor.roaming || !mascotRoamingActive || disposed || document.hidden) return;
      const dock = document.getElementById('ag-ps-mascot-dock');
      if (!dock || !actor.el?.isConnected) return;
      const trackW = dock.clientWidth || 0;
      if (trackW < 480) {
        stopMascotRoaming(true);
        return;
      }
      const { w } = getMascotDims();
      const hasBadge = Boolean(dock.querySelector('.ag-ps-more-badge'));
      const minX = Math.min(92, Math.max(12, Math.round(trackW * 0.16)));
      const maxX = Math.max(minX, Math.round(trackW - (hasBadge ? 44 : 16) - w));
      const span = maxX - minX;

      const roll = Math.random();
      if (span >= w * 2 && roll < 0.64) {
        let targetX = actor.x;
        const minStep = Math.min(48, span * 0.25);
        for (let attempt = 0; attempt < 6; attempt++) {
          const cand = minX + Math.random() * span;
          if (Math.abs(cand - actor.x) < minStep) continue;
          const crowded = mascotActors.some((o, oi) => oi !== idx && Math.abs(o.x - cand) < w + 8);
          targetX = cand;
          if (!crowded) break;
        }
        const dist = Math.abs(targetX - actor.x);
        if (dist >= 10) {
          const speed = 88 + Math.random() * 48;
          const dur = Math.max(0.45, Math.min(2.4, dist / speed));
          const dir = targetX < actor.x ? -1 : 1;
          actor.el.setAttribute('data-act', 'run');
          applyActorTransform(actor, targetX, dir, dur);
          actor.settleTimer = setTimeout(() => {
            actor.settleTimer = 0;
            if (!actor.roaming || !mascotRoamingActive || disposed || !actor.el?.isConnected) return;
            if (Math.random() < 0.32) {
              actor.el.setAttribute('data-act', 'leap');
              actor.settleTimer = setTimeout(() => {
                actor.settleTimer = 0;
                actor.el?.removeAttribute('data-act');
                scheduleActorRoamStep(idx);
              }, 640);
            } else {
              actor.el.removeAttribute('data-act');
              scheduleActorRoamStep(idx);
            }
          }, Math.round(dur * 1000) + 40);
          return;
        }
      }

      if (roll < 0.88) {
        actor.el.setAttribute('data-act', 'leap');
        actor.settleTimer = setTimeout(() => {
          actor.settleTimer = 0;
          actor.el?.removeAttribute('data-act');
          scheduleActorRoamStep(idx);
        }, 640);
      } else {
        applyActorTransform(actor, actor.x, actor.facing * -1, 0.2);
        scheduleActorRoamStep(idx, 1000 + Math.floor(Math.random() * 1400));
      }
    }, delay);
  }

  function syncMascotRoaming(dock) {
    if (!dock || !prefs.mascotRoam || REDUCED_MOTION || document.hidden || (dock.clientWidth || 0) < 480) {
      if (mascotRoamingActive) stopMascotRoaming(true);
      return;
    }
    const anyBusy = mascotActors.some((a) => a.busy);
    if (!anyBusy) {
      if (mascotRoamingActive) stopMascotRoaming(true);
      return;
    }
    mascotRoamingActive = true;
    dock.setAttribute('data-roaming', '1');
    const hasBadge = Boolean(dock.querySelector('.ag-ps-more-badge'));
    const homeXs = computeHomePositions(dock.clientWidth || 0, mascotActors.length, hasBadge);
    mascotActors.forEach((actor, idx) => {
      if (actor.busy) {
        if (!actor.roaming) {
          actor.roaming = true;
          scheduleActorRoamStep(idx, 200 + idx * 280 + Math.floor(Math.random() * 260));
        }
      } else if (actor.roaming) {
        clearActorTimers(actor);
        actor.roaming = false;
        actor.el?.removeAttribute('data-act');
        applyActorTransform(actor, homeXs[idx], 1, 0.55);
      }
    });
  }

  function applyMascotSizeVars(dock, repositionHome) {
    if (!dock) return;
    const { w, h } = getMascotDims();
    dock.style.setProperty('--ag-ps-sprite-w', `${w}px`);
    dock.style.setProperty('--ag-ps-sprite-h', `${h}px`);
    if (repositionHome) {
      parkActorsHome(dock, true, mascotRoamingActive);
      clampRoamingActorsInBounds(dock);
    }
  }

  function syncMascotCompactGuard() {
    const box = document.getElementById('antigravity.agentSidePanelInputBox');
    const dock = document.getElementById('ag-ps-mascot-dock');
    if (!box || !dock) return;
    const w = box.getBoundingClientRect().width;
    if (w > 0 && w < 420) {
      dock.setAttribute('data-compact-hide', '1');
      if (mascotRoamingActive) stopMascotRoaming(false);
      return;
    }
    dock.removeAttribute('data-compact-hide');
    if (w < 480 && mascotRoamingActive) {
      stopMascotRoaming(true);
    } else if (w > 0 && Math.abs(w - lastTrackWidth) > 2) {
      parkActorsHome(dock, true, mascotRoamingActive);
      clampRoamingActorsInBounds(dock);
    }
  }

  function syncMascotDock(busy) {
    const box = document.getElementById('antigravity.agentSidePanelInputBox');
    let dock = document.getElementById('ag-ps-mascot-dock');
    if (!prefs.mascot || !box) {
      stopMascotRoaming(false);
      mascotActors = [];
      lastRosterSig = '';
      if (dock) dock.remove();
      return;
    }
    const { roster, overflow } = buildMascotRoster(busy);
    const rosterSig = `${prefs.mascotCountMode}|${overflow}|${roster.map((r) => r.key).join(',')}`;
    let rebuilt = false;
    if (!dock || dock.parentElement !== box) {
      stopMascotRoaming(false);
      if (dock) dock.remove();
      dock = document.createElement('div');
      dock.id = 'ag-ps-mascot-dock';
      dock.setAttribute('data-ag-i18n-ignore', '1');
      dock.addEventListener('click', (e) => {
        const actorEl = e.target.closest('.ag-ps-actor');
        if (!actorEl) return;
        e.stopPropagation();
        const idx = Number(actorEl.getAttribute('data-actor-idx'));
        const actor = mascotActors[idx];
        mascotCheerUntil = Date.now() + 2000;
        if (mascotRoamingActive && actor) {
          if (actorEl.getAttribute('data-act') !== 'run') {
            actorEl.setAttribute('data-act', 'leap');
            if (actor.clickTimer) clearTimeout(actor.clickTimer);
            actor.clickTimer = setTimeout(() => {
              actor.clickTimer = 0;
              if (actorEl.getAttribute('data-act') === 'leap') actorEl.removeAttribute('data-act');
            }, 640);
          }
        } else {
          dock.setAttribute('data-mood', 'cheer');
        }
        const line = CHEER_LINES[Math.floor(Math.random() * CHEER_LINES.length)];
        const msg = prefs.mascotCountMode === 'agents' && actor?.label ? `${actor.label}：${line}` : line;
        showMascotBubble(msg, 2200);
      });
      box.appendChild(dock);
      rebuilt = true;
    }
    if (rebuilt || rosterSig !== lastRosterSig) {
      stopMascotRoaming(false);
      lastRosterSig = rosterSig;
      dock.setAttribute('data-mode', prefs.mascotCountMode);
      const actorsHtml = roster
        .map(
          (item, idx) =>
            `<span class="ag-ps-actor" data-actor-idx="${idx}" data-busy="${item.busy ? '1' : '0'}" title="${escapeHtml(item.label)}（${item.busy ? '运行中' : '待命 · 0fps'}）"><span class="ag-ps-actor-body">${item.svg}</span></span>`
        )
        .join('');
      const badgeHtml = overflow > 0 ? `<span class="ag-ps-more-badge" title="还有 ${overflow} 个活跃 Agent">+${overflow}</span>` : '';
      dock.innerHTML = `<span class="ag-ps-mascot-bubble"></span>${actorsHtml}${badgeHtml}`;
      mascotActors = Array.from(dock.querySelectorAll('.ag-ps-actor')).map((el, idx) => ({
        key: roster[idx].key,
        label: roster[idx].label,
        busy: roster[idx].busy,
        el,
        x: 0,
        facing: 1,
        moveTimer: 0,
        settleTimer: 0,
        clickTimer: 0,
        roaming: false
      }));
      applyMascotSizeVars(dock, false);
      parkActorsHome(dock, true, false);
    } else {
      // Update per-actor live busy status & hover title without rebuilding DOM
      mascotActors.forEach((actor, idx) => {
        const item = roster[idx];
        if (!item) return;
        actor.busy = item.busy;
        actor.label = item.label;
        if (actor.el) {
          actor.el.setAttribute('data-busy', item.busy ? '1' : '0');
          actor.el.title = `${item.label}（${item.busy ? '运行中' : '待命 · 0fps'}）`;
        }
      });
      applyMascotSizeVars(dock, false);
    }
    syncMascotCompactGuard();

    const anyBusy = mascotActors.some((a) => a.busy);
    const now = Date.now();
    if (anyBusy) {
      mascotIdleSince = now;
      if (!wasMascotBusy) showMascotBubble(prefs.mascotRoam ? '开工啦！出发巡逻 ⚡' : '思考中… ⚡', 1800);
      dock.setAttribute('data-mood', 'busy');
      mascotActors.forEach((a) => {
        if (a.el) {
          if (!a.busy) a.el.setAttribute('data-sleep', '1');
          else a.el.removeAttribute('data-sleep');
        }
      });
      syncMascotRoaming(dock);
    } else {
      if (mascotRoamingActive) {
        stopMascotRoaming(true);
      }
      mascotActors.forEach((a) => a.el?.removeAttribute('data-sleep'));
      if (wasMascotBusy) {
        mascotCheerUntil = now + 2400;
        showMascotBubble('完成啦 ✨', 2200);
      }
      if (now < mascotCheerUntil) {
        dock.setAttribute('data-mood', 'cheer');
      } else if (now - mascotIdleSince >= 5000) {
        dock.setAttribute('data-mood', 'sleep');
      } else {
        dock.setAttribute('data-mood', 'calm');
      }
    }
    wasMascotBusy = anyBusy;
  }
  onCleanup(() => {
    stopMascotRoaming(false);
    mascotActors = [];
    lastRosterSig = '';
    document.getElementById('ag-ps-mascot-dock')?.remove();
  });

  /* ==========================================================================
   * 6. Thought Process Live Chinese Translation
   *    - Waits until generation settles (no repeated RPC every tick while streaming)
   *    - Cleans up cleanly when thinking block collapses
   *    - Per-block "看原文 / 看译文" peek toggle in immersive mode
   * ========================================================================== */
  const thoughtInFlight = new WeakSet();
  const thoughtTextMemo = new WeakMap(); // bodyEl -> { src, zh, ver }
  const thoughtPeekOriginal = new WeakSet(); // bodyEl user chose to peek original
  let thoughtSeq = 0;

  function looksMostlyEnglish(text) {
    const s = String(text || '').trim();
    if (s.length < 24) return false;
    const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
    const latin = (s.match(/[A-Za-z]/g) || []).length;
    return latin >= 16 && cjk / Math.max(1, cjk + latin) < 0.42;
  }

  function findThoughtBody(triggerBtn) {
    const parent = triggerBtn && triggerBtn.parentElement;
    if (!parent) return null;
    for (const ch of Array.from(parent.children)) {
      if (ch === triggerBtn || ch.classList.contains('ag-ps-thought-zh')) continue;
      if ((ch.textContent || '').trim().length > 0) return ch;
    }
    const next = parent.nextElementSibling;
    if (next && !next.classList.contains('ag-ps-thought-zh') && (next.textContent || '').trim().length > 0) {
      return next;
    }
    return null;
  }

  function removeThoughtBoxNear(triggerBtn) {
    const parent = triggerBtn && triggerBtn.parentElement;
    if (!parent) return;
    parent.querySelectorAll(':scope > .ag-ps-thought-zh').forEach((n) => n.remove());
    parent.querySelectorAll('.ag-ps-thought-src-dim, .ag-ps-thought-src-hidden').forEach((n) => {
      n.classList.remove('ag-ps-thought-src-dim', 'ag-ps-thought-src-hidden');
    });
  }

  function applyThoughtDisplay(bodyEl, zhText, mode) {
    if (!bodyEl || !bodyEl.parentElement) return;
    let box = bodyEl.parentElement.querySelector(':scope > .ag-ps-thought-zh');
    if (mode === 'off' || !zhText) {
      bodyEl.classList.remove('ag-ps-thought-src-dim', 'ag-ps-thought-src-hidden');
      if (box) box.remove();
      return;
    }
    const peeking = thoughtPeekOriginal.has(bodyEl);
    if (!box) {
      box = document.createElement('div');
      box.className = 'ag-ps-thought-zh';
      box.setAttribute('data-ag-i18n-ignore', '1');
      box.addEventListener('click', (e) => {
        const btn = e.target.closest('.ag-ps-thought-peek');
        if (!btn) return;
        e.stopPropagation();
        if (thoughtPeekOriginal.has(bodyEl)) thoughtPeekOriginal.delete(bodyEl);
        else thoughtPeekOriginal.add(bodyEl);
        const memo = thoughtTextMemo.get(bodyEl);
        applyThoughtDisplay(bodyEl, memo ? memo.zh : zhText, prefs.thoughtMode);
      });
      bodyEl.parentElement.insertBefore(box, bodyEl.nextSibling);
    }
    const effectiveImmersive = mode === 'immersive' && !peeking;
    box.setAttribute('data-mode', effectiveImmersive ? 'immersive' : 'bilingual');
    const hdrHtml = mode === 'immersive'
      ? `<div class="ag-ps-thought-zh-hdr"><button type="button" class="ag-ps-thought-peek">${peeking ? '隐藏原文' : '查看原文'}</button></div>`
      : `<div class="ag-ps-thought-zh-hdr"><span>译文</span></div>`;
    box.innerHTML = `${hdrHtml}<div>${escapeHtml(zhText)}</div>`;
    if (effectiveImmersive) {
      bodyEl.classList.add('ag-ps-thought-src-hidden');
      bodyEl.classList.remove('ag-ps-thought-src-dim');
    } else {
      bodyEl.classList.remove('ag-ps-thought-src-hidden');
      bodyEl.classList.add('ag-ps-thought-src-dim');
    }
  }

  function extractCleanThoughtText(bodyEl) {
    if (!bodyEl) return '';
    try {
      const clone = bodyEl.cloneNode(true);
      clone.querySelectorAll('style, script, noscript').forEach((n) => n.remove());
      return (clone.textContent || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    } catch {
      return (bodyEl.innerText || '').trim();
    }
  }

  function translateThoughtContainer(bodyEl) {
    if (!bodyEl || typeof window.__agProjectCall !== 'function') return;
    const mode = prefs.thoughtMode;
    if (mode === 'off') {
      applyThoughtDisplay(bodyEl, '', 'off');
      return;
    }
    const srcText = extractCleanThoughtText(bodyEl);
    if (!looksMostlyEnglish(srcText)) return;
    const clipped = srcText.slice(0, 9800);
    const memo = thoughtTextMemo.get(bodyEl);
    if (memo && memo.src === clipped && memo.zh) {
      applyThoughtDisplay(bodyEl, memo.zh, mode);
      return;
    }
    if (thoughtInFlight.has(bodyEl)) return;
    const myVer = ++thoughtSeq;
    thoughtTextMemo.set(bodyEl, { src: clipped, zh: memo ? memo.zh : '', ver: myVer });
    thoughtInFlight.add(bodyEl);
    Promise.resolve(window.__agProjectCall('translateText', { text: clipped, targetLang: 'zh-CN' }, 12000))
      .then((res) => {
        if (disposed || !bodyEl.isConnected) return;
        const latest = thoughtTextMemo.get(bodyEl);
        if (!latest || latest.ver !== myVer) return; // Discard stale response
        if (res && res.ok && res.translated && !res.skipped) {
          thoughtTextMemo.set(bodyEl, { src: clipped, zh: res.translated, ver: myVer });
          applyThoughtDisplay(bodyEl, res.translated, prefs.thoughtMode);
        }
      })
      .catch(() => {})
      .finally(() => {
        thoughtInFlight.delete(bodyEl);
      });
  }

  function syncThoughtBlocks(isBusy) {
    const triggers = document.querySelectorAll('[data-testid="thinking-collapsible-trigger"]');
    for (let i = 0; i < triggers.length; i++) {
      const trig = triggers[i];
      const expanded = trig.getAttribute('aria-expanded') === 'true';
      if (!expanded) {
        removeThoughtBoxNear(trig);
        continue;
      }
      const bodyEl = findThoughtBody(trig);
      if (!bodyEl) continue;
      if (prefs.thoughtMode === 'off') {
        applyThoughtDisplay(bodyEl, '', 'off');
        continue;
      }
      // Only defer the actively streaming last thinking block (which has no completed duration yet)
      const trigTxt = (trig.textContent || '').trim();
      const isCompleted = /\d+\s*s\b|\d+\s*秒|已思考|Thought\s+for/i.test(trigTxt);
      if (isBusy && i === triggers.length - 1 && !isCompleted) {
        const memo = thoughtTextMemo.get(bodyEl);
        if (memo && memo.zh) applyThoughtDisplay(bodyEl, memo.zh, prefs.thoughtMode);
        continue;
      }
      translateThoughtContainer(bodyEl);
    }
  }
  onCleanup(() => {
    document.querySelectorAll('.ag-ps-thought-zh').forEach((n) => n.remove());
    document.querySelectorAll('.ag-ps-thought-src-dim, .ag-ps-thought-src-hidden').forEach((n) => {
      n.classList.remove('ag-ps-thought-src-dim', 'ag-ps-thought-src-hidden');
    });
  });

  /* ==========================================================================
   * 7. Titlebar Entry & Control Popover
   * ========================================================================== */
  function renderPopoverContent(pop) {
    const darkNow = isCurrentlyDark();
    pop.innerHTML = `
      <div class="ag-ps-pop-hdr">
        <span class="ag-ps-pop-title">✦ 棱镜扩展套件 <span class="ag-ps-pop-badge">${darkNow ? '当前深色' : '当前浅色'}</span></span>
      </div>

      <div class="ag-ps-sec-lbl"><span>浅色主题配色</span><span class="ag-ps-sec-tag">${!darkNow ? '即时生效' : '浅色首选'}</span></div>
      <div class="ag-ps-palette-row">
        <button type="button" class="ag-ps-pal-btn" data-set-light="default" data-selected="${prefs.lightPalette === 'default' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:#FFFFFF"></span>纯白默认</button>
        <button type="button" class="ag-ps-pal-btn" data-set-light="crystal" data-selected="${prefs.lightPalette === 'crystal' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:#E8EEF6"></span>白昼冷晶</button>
        <button type="button" class="ag-ps-pal-btn" data-set-light="alabaster" data-selected="${prefs.lightPalette === 'alabaster' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:#EBE6DC"></span>暖白画册</button>
      </div>

      <div class="ag-ps-sec-lbl"><span>深色主题配色</span><span class="ag-ps-sec-tag">${darkNow ? '即时生效' : '深色首选'}</span></div>
      <div class="ag-ps-palette-row">
        <button type="button" class="ag-ps-pal-btn" data-set-dark="default" data-selected="${prefs.darkPalette === 'default' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:#212120"></span>暖炭默认</button>
        <button type="button" class="ag-ps-pal-btn" data-set-dark="obsidian" data-selected="${prefs.darkPalette === 'obsidian' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:#09090B"></span>深空黑曜</button>
        <button type="button" class="ag-ps-pal-btn" data-set-dark="basalt" data-selected="${prefs.darkPalette === 'basalt' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:#141312"></span>暖炭玄岩</button>
      </div>

      <div class="ag-ps-sec-lbl"><span>增强功能开关</span><span class="ag-ps-sec-tag">v0.2.2</span></div>
      <div class="ag-ps-toggle-list">
        <div class="ag-ps-toggle-row">
          <div class="ag-ps-toggle-label"><span>会话大纲 &amp; 跳轮</span><span class="ag-ps-toggle-sub">Alt+↑/↓ 跳轮 · Alt+O 大纲</span></div>
          <button type="button" class="ag-ps-switch" data-toggle="outline" data-on="${prefs.outline ? '1' : '0'}"></button>
        </div>
        <div class="ag-ps-toggle-row">
          <div class="ag-ps-toggle-label"><span>名著换算 &amp; 12 周热力图</span><span class="ag-ps-toggle-sub">右侧「概览 → 用量统计」底部 <a href="#" data-jump-usage="1" style="color:var(--primary,#2F75C3);text-decoration:none;margin-left:4px">定位 ↗</a></span></div>
          <button type="button" class="ag-ps-switch" data-toggle="usageExtra" data-on="${prefs.usageExtra ? '1' : '0'}"></button>
        </div>
        <div class="ag-ps-toggle-row">
          <div class="ag-ps-toggle-label"><span>五级水墨流式淡入</span><span class="ag-ps-toggle-sub">仅生成态生效 · 打字零开销</span></div>
          <button type="button" class="ag-ps-switch" data-toggle="inkStream" data-on="${prefs.inkStream ? '1' : '0'}"></button>
        </div>
        <div class="ag-ps-toggle-row">
          <div class="ag-ps-toggle-label"><span>输入框像素小伙伴</span><span class="ag-ps-toggle-sub">空闲 5s 自动 0fps 休眠</span></div>
          <button type="button" class="ag-ps-switch" data-toggle="mascot" data-on="${prefs.mascot ? '1' : '0'}"></button>
        </div>
        ${
          prefs.mascot
            ? `<div class="ag-ps-toggle-row">
                <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">伙伴数量${prefs.mascotCountMode === 'agents' ? `（当前 1 主控 + ${getLiveSubagents().length} 活跃）` : ''}</span></div>
                <div class="ag-ps-seg-group">
                  <button type="button" class="ag-ps-seg-btn" data-mascot-count-mode="fixed" data-selected="${prefs.mascotCountMode === 'fixed' ? '1' : '0'}">固定</button>
                  <button type="button" class="ag-ps-seg-btn" data-mascot-count-mode="agents" data-selected="${prefs.mascotCountMode === 'agents' ? '1' : '0'}">跟随 Agent</button>
                </div>
              </div>
              ${
                prefs.mascotCountMode === 'fixed'
                  ? `<div class="ag-ps-toggle-row">
                      <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">伙伴样式</span></div>
                      <div class="ag-ps-seg-group">
                        <button type="button" class="ag-ps-seg-btn" data-mascot-style="trio" data-selected="${prefs.mascotStyle === 'trio' ? '1' : '0'}">三萌</button>
                        <button type="button" class="ag-ps-seg-btn" data-mascot-style="crab" data-selected="${prefs.mascotStyle === 'crab' ? '1' : '0'}">橘蟹</button>
                        <button type="button" class="ag-ps-seg-btn" data-mascot-style="cat" data-selected="${prefs.mascotStyle === 'cat' ? '1' : '0'}">紫猫</button>
                      </div>
                    </div>`
                  : `<div class="ag-ps-toggle-row">
                      <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">保底数量（无子 Agent 时常驻）</span></div>
                      <div class="ag-ps-seg-group">
                        <button type="button" class="ag-ps-seg-btn" data-mascot-min-count="1" data-selected="${clampMascotMinCount(prefs.mascotMinCount) === 1 ? '1' : '0'}">1只</button>
                        <button type="button" class="ag-ps-seg-btn" data-mascot-min-count="2" data-selected="${clampMascotMinCount(prefs.mascotMinCount) === 2 ? '1' : '0'}">2只</button>
                        <button type="button" class="ag-ps-seg-btn" data-mascot-min-count="3" data-selected="${clampMascotMinCount(prefs.mascotMinCount) === 3 ? '1' : '0'}">3只</button>
                      </div>
                    </div>`
              }
              <div class="ag-ps-toggle-row">
                <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">工作态漫游跑跳（闲时自动归位）</span></div>
                <button type="button" class="ag-ps-switch" data-toggle="mascotRoam" data-on="${prefs.mascotRoam ? '1' : '0'}"></button>
              </div>
              <div class="ag-ps-toggle-row">
                <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">伙伴大小</span></div>
                <div class="ag-ps-range-wrap">
                  <input type="range" class="ag-ps-range" data-mascot-size="1" min="${MASCOT_SIZE_MIN}" max="${MASCOT_SIZE_MAX}" step="2" value="${clampMascotSize(prefs.mascotSize)}" aria-label="像素伙伴大小" />
                  <span class="ag-ps-range-val" data-mascot-size-val="1">${clampMascotSize(prefs.mascotSize)}px</span>
                  <button type="button" class="ag-ps-mini-reset" data-mascot-size-reset="1" ${clampMascotSize(prefs.mascotSize) === MASCOT_SIZE_DEFAULT ? 'disabled' : ''}>复位</button>
                </div>
              </div>`
            : ''
        }
        <div class="ag-ps-toggle-row">
          <div class="ag-ps-toggle-label"><span>思考过程实时中译</span><span class="ag-ps-toggle-sub">经 Google 翻译 · 沉浸可看原文</span></div>
          <div class="ag-ps-seg-group">
            <button type="button" class="ag-ps-seg-btn" data-thought-mode="off" data-selected="${prefs.thoughtMode === 'off' ? '1' : '0'}">关</button>
            <button type="button" class="ag-ps-seg-btn" data-thought-mode="bilingual" data-selected="${prefs.thoughtMode === 'bilingual' ? '1' : '0'}">双语</button>
            <button type="button" class="ag-ps-seg-btn" data-thought-mode="immersive" data-selected="${prefs.thoughtMode === 'immersive' ? '1' : '0'}">沉浸</button>
          </div>
        </div>
      </div>
    `;
  }

  function ensurePopover() {
    let pop = document.getElementById('ag-ps-popover');
    if (pop) return pop;
    pop = document.createElement('div');
    pop.id = 'ag-ps-popover';
    pop.setAttribute('data-ag-i18n-ignore', '1');
    pop.addEventListener('click', (e) => {
      e.stopPropagation();
      const jumpUsage = e.target.closest('[data-jump-usage]');
      if (jumpUsage) {
        e.preventDefault();
        pop.removeAttribute('data-open');
        syncToolbarActiveStates();
        const ovBtn = document.querySelector('[data-testid="toggle-overview-panel"]');
        const ovPanel = document.querySelector('[data-testid="overview-panel"]');
        if ((!ovPanel || ovPanel.hidden || ovPanel.getAttribute('aria-hidden') === 'true') && ovBtn) {
          ovBtn.click();
        }
        setTimeout(() => {
          syncUsageExtraMount();
          const card = document.querySelector('#ag-claude-ov-sections [data-ov-card="usage"]');
          if (card) {
            card.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'center' });
            card.classList.remove('ag-ps-turn-pulse');
            void card.offsetWidth;
            card.classList.add('ag-ps-turn-pulse');
            setTimeout(() => card.classList.remove('ag-ps-turn-pulse'), 1500);
          }
        }, 180);
        return;
      }
      const lBtn = e.target.closest('[data-set-light]');
      if (lBtn) {
        const val = lBtn.getAttribute('data-set-light');
        prefs.lightPalette = val;
        savePrefs();
        applyPalettes();
        renderPopoverContent(pop);
        const name = LIGHT_NAMES[val] || val;
        showJumpToast(isCurrentlyDark() ? `已设为浅色首选「${name}」，切换浅色模式时生效` : `已切换浅色配色：${name}`);
        return;
      }
      const dBtn = e.target.closest('[data-set-dark]');
      if (dBtn) {
        const val = dBtn.getAttribute('data-set-dark');
        prefs.darkPalette = val;
        savePrefs();
        applyPalettes();
        renderPopoverContent(pop);
        const name = DARK_NAMES[val] || val;
        showJumpToast(!isCurrentlyDark() ? `已设为深色首选「${name}」，切换深色模式时生效` : `已切换深色配色：${name}`);
        return;
      }
      const sw = e.target.closest('[data-toggle]');
      if (sw) {
        const k = sw.getAttribute('data-toggle');
        prefs[k] = !prefs[k];
        savePrefs();
        const busy = isAgentGenerating();
        if (k === 'inkStream') syncStreamObserver(busy);
        if (k === 'outline' && !prefs.outline) toggleOutlineDrawer(false);
        syncMascotDock(busy);
        syncUsageExtraMount();
        syncToolbarButtons();
        renderPopoverContent(pop);
        return;
      }
      const mcm = e.target.closest('[data-mascot-count-mode]');
      if (mcm) {
        prefs.mascotCountMode = mcm.getAttribute('data-mascot-count-mode') === 'agents' ? 'agents' : 'fixed';
        savePrefs();
        syncMascotDock(isAgentGenerating());
        renderPopoverContent(pop);
        return;
      }
      const mmc = e.target.closest('[data-mascot-min-count]');
      if (mmc) {
        prefs.mascotMinCount = clampMascotMinCount(mmc.getAttribute('data-mascot-min-count'));
        savePrefs();
        syncMascotDock(isAgentGenerating());
        renderPopoverContent(pop);
        return;
      }
      const ms = e.target.closest('[data-mascot-style]');
      if (ms) {
        prefs.mascotStyle = ms.getAttribute('data-mascot-style');
        savePrefs();
        syncMascotDock(isAgentGenerating());
        renderPopoverContent(pop);
        return;
      }
      const mReset = e.target.closest('[data-mascot-size-reset]');
      if (mReset) {
        prefs.mascotSize = MASCOT_SIZE_DEFAULT;
        savePrefs();
        applyMascotSizeVars(document.getElementById('ag-ps-mascot-dock'), true);
        renderPopoverContent(pop);
        return;
      }
      const tm = e.target.closest('[data-thought-mode]');
      if (tm) {
        prefs.thoughtMode = tm.getAttribute('data-thought-mode');
        savePrefs();
        syncThoughtBlocks(isAgentGenerating());
        renderPopoverContent(pop);
      }
    });
    pop.addEventListener('input', (e) => {
      const slider = e.target.closest('[data-mascot-size]');
      if (!slider) return;
      const sz = clampMascotSize(slider.value);
      prefs.mascotSize = sz;
      applyMascotSizeVars(document.getElementById('ag-ps-mascot-dock'), true);
      const valEl = pop.querySelector('[data-mascot-size-val]');
      if (valEl) valEl.textContent = `${sz}px`;
      const resetBtn = pop.querySelector('[data-mascot-size-reset]');
      if (resetBtn) resetBtn.disabled = sz === MASCOT_SIZE_DEFAULT;
    });
    pop.addEventListener('change', (e) => {
      const slider = e.target.closest('[data-mascot-size]');
      if (!slider) return;
      prefs.mascotSize = clampMascotSize(slider.value);
      savePrefs();
      applyMascotSizeVars(document.getElementById('ag-ps-mascot-dock'), true);
    });
    document.body.appendChild(pop);
    onCleanup(() => pop.remove());
    return pop;
  }

  function togglePopover(forceState) {
    const pop = ensurePopover();
    const drawer = document.getElementById('ag-ps-outline');
    if (drawer) drawer.removeAttribute('data-open');
    const open = typeof forceState === 'boolean' ? forceState : pop.getAttribute('data-open') !== '1';
    if (open) {
      renderPopoverContent(pop);
      pop.setAttribute('data-open', '1');
      positionFloatingPanel(pop, document.getElementById('ag-ps-btn-suite'));
    } else {
      pop.removeAttribute('data-open');
    }
    syncToolbarActiveStates();
  }

  function syncToolbarActiveStates() {
    const popOpen = document.getElementById('ag-ps-popover')?.getAttribute('data-open') === '1';
    const outOpen = document.getElementById('ag-ps-outline')?.getAttribute('data-open') === '1';
    const pBtn = document.getElementById('ag-ps-btn-suite');
    const oBtn = document.getElementById('ag-ps-btn-outline');
    if (pBtn) pBtn.setAttribute('data-active', popOpen ? '1' : '0');
    if (oBtn) oBtn.setAttribute('data-active', outOpen ? '1' : '0');
  }

  function syncToolbarButtons() {
    const toolbar = document.querySelector('[data-testid="pane-titlebar-toolbar"]');
    if (!toolbar) return;
    let outBtn = document.getElementById('ag-ps-btn-outline');
    if (prefs.outline) {
      if (!outBtn || outBtn.parentElement !== toolbar) {
        if (outBtn) outBtn.remove();
        outBtn = document.createElement('button');
        outBtn.id = 'ag-ps-btn-outline';
        outBtn.type = 'button';
        outBtn.className = 'ag-ps-tb-btn';
        outBtn.setAttribute('data-ag-i18n-ignore', '1');
        outBtn.title = '会话大纲 (Alt+O) · 上下跳轮 (Alt+↑/↓)';
        outBtn.textContent = '大纲';
        outBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleOutlineDrawer();
        });
        toolbar.insertBefore(outBtn, toolbar.firstChild);
      }
    } else if (outBtn) {
      outBtn.remove();
    }

    let suiteBtn = document.getElementById('ag-ps-btn-suite');
    if (!suiteBtn || suiteBtn.parentElement !== toolbar) {
      if (suiteBtn) suiteBtn.remove();
      suiteBtn = document.createElement('button');
      suiteBtn.id = 'ag-ps-btn-suite';
      suiteBtn.type = 'button';
      suiteBtn.className = 'ag-ps-tb-btn';
      suiteBtn.setAttribute('data-ag-i18n-ignore', '1');
      suiteBtn.title = '棱镜扩展套件（主题 / 像素伙伴 / 思考翻译 / 热力图）';
      suiteBtn.textContent = '✦ 棱镜';
      suiteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePopover();
      });
      toolbar.insertBefore(suiteBtn, toolbar.firstChild);
    }
    syncToolbarActiveStates();
  }
  onCleanup(() => {
    document.getElementById('ag-ps-btn-suite')?.remove();
    document.getElementById('ag-ps-btn-outline')?.remove();
    document.getElementById('ag-ps-jump-toast')?.remove();
  });

  function onDocClickOutside(e) {
    if (disposed) return;
    const pop = document.getElementById('ag-ps-popover');
    if (pop && pop.getAttribute('data-open') === '1' && !pop.contains(e.target) && !e.target.closest('#ag-ps-btn-suite')) {
      pop.removeAttribute('data-open');
      syncToolbarActiveStates();
    }
    const drawer = document.getElementById('ag-ps-outline');
    if (drawer && drawer.getAttribute('data-open') === '1' && !drawer.contains(e.target) && !e.target.closest('#ag-ps-btn-outline')) {
      drawer.removeAttribute('data-open');
      syncToolbarActiveStates();
    }
  }
  document.addEventListener('click', onDocClickOutside);
  onCleanup(() => document.removeEventListener('click', onDocClickOutside));

  /* ==========================================================================
   * 8. Lightweight Periodic Sync, Visibility Pause & Shallow Overview Observer
   * ========================================================================== */
  let ovMountObserver = null;
  let observedOvEl = null;

  function ensureOverviewObserver() {
    const sec = document.getElementById('ag-claude-ov-sections');
    if (!sec) return;
    if (observedOvEl === sec && ovMountObserver) return;
    if (ovMountObserver) ovMountObserver.disconnect();
    observedOvEl = sec;
    // Shallow childList observation only (no subtree overhead)
    ovMountObserver = new MutationObserver(() => {
      if (disposed || !prefs.usageExtra) return;
      const body = sec.querySelector('[data-ov-card="usage"] .ag-ov-card-body');
      if (body && !body.querySelector('.ag-ps-usage-extra')) {
        syncUsageExtraMount();
      }
    });
    ovMountObserver.observe(sec, { childList: true });
  }
  onCleanup(() => {
    if (ovMountObserver) ovMountObserver.disconnect();
    ovMountObserver = null;
    observedOvEl = null;
  });

  let lastPath = window.location.pathname;
  function tickAll() {
    if (disposed || document.hidden) return;
    // Detect SPA conversation switch and close stale outline drawer
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      const drawer = document.getElementById('ag-ps-outline');
      if (drawer && drawer.getAttribute('data-open') === '1') {
        renderOutlineList('');
      }
    }
    const busy = isAgentGenerating();
    syncStreamObserver(busy);
    // Defer non-urgent DOM scans while user is actively typing in composer
    if (isUserActivelyTyping() && !busy) return;
    syncToolbarButtons();
    syncMascotDock(busy);
    ensureOverviewObserver();
    syncUsageExtraMount();
    syncThoughtBlocks(busy);
  }

  function onVisibilityChange() {
    if (disposed) return;
    if (document.hidden) {
      detachStreamObserver();
      clearInkHighlights();
      stopMascotRoaming(false);
    } else {
      tickAll();
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  onCleanup(() => document.removeEventListener('visibilitychange', onVisibilityChange));

  tickAll();
  const intervalId = setInterval(tickAll, 2400);
  onCleanup(() => clearInterval(intervalId));

  window.__agPrismSuiteDispose = function () {
    if (disposed) return;
    disposed = true;
    while (cleanups.length) {
      const fn = cleanups.pop();
      try { fn(); } catch {}
    }
  };
  if (typeof window.ctx?.onCleanup === 'function') {
    window.ctx.onCleanup(window.__agPrismSuiteDispose);
  }
})();
