/* ============================================================================
 * Prism Suite Extension for Anti-Claude (Clean-Room Original)
 * 6 independent toggleable modules, hot-reload safe, zero GPL code.
 * ============================================================================ */
(() => {
  if (typeof window.__agPrismSuiteDispose === 'function') {
    try { window.__agPrismSuiteDispose(); } catch {}
  }

  const STORAGE_KEY = 'ag_prism_suite_prefs_v1';
  const DEFAULT_PREFS = {
    lightPalette: 'default',   // 'default' | 'crystal' | 'alabaster'
    darkPalette: 'default',    // 'default' | 'obsidian' | 'basalt'
    outline: true,             // Conversation outline + Alt+Up/Down turn jump
    usageExtra: true,          // Book yardstick + 12-week heatmap inside Usage card
    inkStream: true,           // 5-stage CSS.highlights stream fade-in
    mascot: true,              // Composer pixel mascots (0fps idle)
    mascotStyle: 'trio',       // 'trio' | 'crab' | 'cat'
    thoughtMode: 'bilingual'   // 'off' | 'bilingual' | 'immersive'
  };

  let prefs = (() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign({}, DEFAULT_PREFS, JSON.parse(raw));
    } catch {}
    return Object.assign({}, DEFAULT_PREFS);
  })();

  function savePrefs() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch {}
  }

  let disposed = false;
  const cleanups = [];
  const onCleanup = (fn) => cleanups.push(fn);

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

  /* ==========================================================================
   * 1. Multi-Palette Theme Application
   * ========================================================================== */
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
   * 2. Conversation Outline Drawer, Alt+Up/Down Jump & /btw Quick Insert
   * ========================================================================== */
  let jumpToastTimer = 0;
  let lastTurnIndex = -1;

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
    }, 1700);
  }

  function getUserTurnElements() {
    const nodes = Array.from(document.querySelectorAll('[data-testid="user-message-content"]'));
    return nodes.filter((n) => n && n.isConnected && (n.textContent || '').trim().length > 0);
  }

  function jumpToTurn(el, index, total) {
    if (!el) return;
    const bubble = el.closest('[data-testid="user-message-bubble"]') || el.closest('[data-testid="user-message"]') || el;
    bubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
    bubble.classList.remove('ag-ps-turn-pulse');
    void bubble.offsetWidth;
    bubble.classList.add('ag-ps-turn-pulse');
    setTimeout(() => bubble.classList.remove('ag-ps-turn-pulse'), 1500);
    const preview = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 34);
    showJumpToast(`第 ${index + 1} / ${total} 轮 · ${preview}`);
    lastTurnIndex = index;
  }

  function insertBtwQuote(text) {
    const box = document.getElementById('antigravity.agentSidePanelInputBox');
    const editor = box && box.querySelector('[contenteditable="true"], textarea');
    if (!editor) return;
    editor.focus();
    const snippet = `/btw 关于「${String(text || '').replace(/\s+/g, ' ').trim().slice(0, 48)}」：`;
    try {
      document.execCommand('insertText', false, snippet);
    } catch {
      if ('value' in editor) editor.value = snippet;
    }
    showJumpToast('已填入 /btw 支线提问前缀');
  }

  function stepTurn(delta) {
    if (!prefs.outline) return;
    const turns = getUserTurnElements();
    if (!turns.length) {
      showJumpToast('当前视图暂无可跳转的提问轮次');
      return;
    }
    const vp = document.querySelector('[data-testid="autoscroll-viewport"]');
    const vpMid = vp ? vp.getBoundingClientRect().top + vp.getBoundingClientRect().height * 0.42 : window.innerHeight * 0.42;
    let cur = lastTurnIndex;
    if (cur < 0 || cur >= turns.length) {
      let bestDist = Infinity;
      for (let i = 0; i < turns.length; i++) {
        const d = Math.abs(turns[i].getBoundingClientRect().top - vpMid);
        if (d < bestDist) {
          bestDist = d;
          cur = i;
        }
      }
    }
    const next = Math.max(0, Math.min(turns.length - 1, cur + delta));
    jumpToTurn(turns[next], next, turns.length);
  }

  function isEditableTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  }

  function onGlobalKeyDown(e) {
    if (disposed || !prefs.outline) return;
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

  function renderOutlineList(filter = '') {
    const drawer = document.getElementById('ag-ps-outline');
    if (!drawer) return;
    const list = drawer.querySelector('.ag-ps-outline-list');
    if (!list) return;
    const turns = getUserTurnElements();
    const q = String(filter || '').trim().toLowerCase();
    const items = [];
    for (let i = 0; i < turns.length; i++) {
      const txt = (turns[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (q && !txt.toLowerCase().includes(q)) continue;
      items.push({ idx: i, txt, el: turns[i] });
    }
    const countEl = drawer.querySelector('.ag-ps-outline-count');
    if (countEl) countEl.textContent = `${items.length}/${turns.length} 轮`;

    if (!items.length) {
      list.innerHTML = `<div style="padding:14px 8px;text-align:center;color:var(--muted-foreground)">暂无匹配提问（快捷键 Alt+↑/↓ 跳轮）</div>`;
      return;
    }
    list.innerHTML = items
      .map(
        (it) =>
          `<button type="button" class="ag-ps-outline-item" data-turn-idx="${it.idx}">
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
      <input type="text" class="ag-ps-outline-search" placeholder="筛选提问关键词… (Alt+↑/↓ 跳轮)" />
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
        return;
      }
      const row = e.target.closest('[data-turn-idx]');
      if (row) {
        const idx = Number(row.getAttribute('data-turn-idx'));
        const turns = getUserTurnElements();
        if (turns[idx]) jumpToTurn(turns[idx], idx, turns.length);
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
    const widthPx = panelEl.offsetWidth || (panelEl.id === 'ag-ps-outline' ? 286 : 312);
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
   * 3. Usage Book Yardstick + 12-Week Heatmap (augments [data-ov-card="usage"])
   * ========================================================================== */
  const BOOK_YARDSTICKS = [
    { name: '《道德经》', tokens: 7600 },
    { name: '《小王子》', tokens: 21000 },
    { name: '《变形记》', tokens: 28000 },
    { name: '《老人与海》', tokens: 36000 },
    { name: '《浮士德》', tokens: 54000 },
    { name: '《围城》', tokens: 180000 },
    { name: '《三体》全集', tokens: 880000 },
    { name: '《红楼梦》', tokens: 960000 },
    { name: '《哈利·波特》全集', tokens: 1450000 },
    { name: '《大英百科全书》', tokens: 55000000 }
  ];

  function pickBookYardstick(totalTokens) {
    const t = Number(totalTokens) || 0;
    if (t < 1500) return '刚翻开扉页';
    let chosen = BOOK_YARDSTICKS[0];
    for (const b of BOOK_YARDSTICKS) {
      if (t >= b.tokens * 0.8) chosen = b;
    }
    const mult = t / chosen.tokens;
    const multStr = mult >= 100 ? Math.round(mult).toString() : mult >= 10 ? mult.toFixed(1) : mult.toFixed(2).replace(/\.?0+$/, '');
    return `≈ ${multStr} 本${chosen.name}`;
  }

  let heatCache = { ts: 0, data: null };
  let heatInFlight = null;
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
        })
        .catch(() => {})
        .finally(() => { heatInFlight = null; });
    }
    return heatCache.data;
  }

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
    const sig = `${data.todayDate}|${data.totalWindowTokens}|${data.today?.totalTokens}|${bookScopeIdx}`;

    if (existing && existing.getAttribute('data-sig') === sig) return;

    const maxTok = hist.reduce((m, d) => Math.max(m, Number(d.totalTokens) || 0), 0);
    const activeDays = hist.filter((d) => (Number(d.totalTokens) || 0) > 0).length;
    const defaultMeta = `12周活跃 ${activeDays} 天`;

    const cellsHtml = hist
      .map((d) => {
        const tot = Number(d.totalTokens) || 0;
        let lv = 0;
        if (tot > 0 && maxTok > 0) {
          const r = tot / maxTok;
          lv = r >= 0.72 ? 4 : r >= 0.42 ? 3 : r >= 0.16 ? 2 : 1;
        }
        const tip = tot > 0 ? `${d.label} · ${fmtTokens(tot)} · ${d.activeSessions}会话` : `${d.label} · 无消耗`;
        return `<span class="ag-ps-heat-cell" data-lv="${lv}" data-tip="${escapeHtml(tip)}" title="${escapeHtml(`${d.date}: ${fmtTokens(tot)}`)}"></span>`;
      })
      .join('');

    const wrap = existing || document.createElement('div');
    wrap.className = 'ag-ps-usage-extra';
    wrap.setAttribute('data-sig', sig);
    wrap.innerHTML = `
      <div class="ag-ps-book-row" title="点击切换 今日 / 近12周 名著换算">
        <span class="ag-ov-muted">📚 ${scopeLbl}体量</span>
        <span class="ag-ps-book-val">${escapeHtml(bookText)}</span>
      </div>
      <div class="ag-ps-heat-hdr">
        <span class="ag-ov-muted">12 周热力图</span>
        <span class="ag-ps-heat-meta ag-ov-tabular" data-default="${escapeHtml(defaultMeta)}">${escapeHtml(defaultMeta)}</span>
      </div>
      <div class="ag-ps-heat-grid">${cellsHtml}</div>
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
   * 4. 5-Stage Ink Stream Fade-In (CSS.highlights, zero DOM wrapping, 0fps idle)
   * ========================================================================== */
  const SUPPORTS_HIGHLIGHTS = typeof CSS !== 'undefined' && Boolean(CSS.highlights) && typeof Highlight === 'function';
  const INK_NAMES = ['ag-ps-ink-1', 'ag-ps-ink-2', 'ag-ps-ink-3', 'ag-ps-ink-4', 'ag-ps-ink-5'];
  const INK_DURATION_MS = 320;
  let inkEntries = []; // { range, startMs }
  let inkRafId = 0;
  const seenTextLens = new WeakMap();

  function clearInkHighlights() {
    if (inkRafId) {
      cancelAnimationFrame(inkRafId);
      inkRafId = 0;
    }
    inkEntries = [];
    if (SUPPORTS_HIGHLIGHTS) {
      for (const name of INK_NAMES) {
        try { CSS.highlights.delete(name); } catch {}
      }
    }
  }

  function tickInkFade(now) {
    inkRafId = 0;
    if (disposed || !prefs.inkStream || !SUPPORTS_HIGHLIGHTS || !inkEntries.length) {
      clearInkHighlights();
      return;
    }
    const buckets = [[], [], [], [], []];
    const alive = [];
    for (const item of inkEntries) {
      const age = now - item.startMs;
      if (age >= INK_DURATION_MS) continue;
      if (!item.range || !item.range.startContainer || !item.range.startContainer.isConnected) continue;
      const stage = Math.min(4, Math.floor((age / INK_DURATION_MS) * 5));
      buckets[stage].push(item.range);
      alive.push(item);
    }
    inkEntries = alive;
    for (let i = 0; i < 5; i++) {
      try {
        if (buckets[i].length) CSS.highlights.set(INK_NAMES[i], new Highlight(...buckets[i]));
        else CSS.highlights.delete(INK_NAMES[i]);
      } catch {}
    }
    if (inkEntries.length) {
      inkRafId = requestAnimationFrame(tickInkFade);
    }
  }

  function pushInkRange(textNode, fromIdx, toIdx) {
    if (!SUPPORTS_HIGHLIGHTS || !prefs.inkStream || !textNode || textNode.nodeType !== 3) return;
    if (toIdx <= fromIdx || toIdx > textNode.length) return;
    try {
      const range = document.createRange();
      range.setStart(textNode, fromIdx);
      range.setEnd(textNode, toIdx);
      inkEntries.push({ range, startMs: performance.now() });
      if (inkEntries.length > 48) inkEntries = inkEntries.slice(-48);
      if (!inkRafId) inkRafId = requestAnimationFrame(tickInkFade);
    } catch {}
  }

  function isAgentGenerating() {
    return Boolean(document.querySelector('[data-testid="input-cancel-button"]'));
  }

  const streamObserver = new MutationObserver((mutations) => {
    if (disposed || !prefs.inkStream || !SUPPORTS_HIGHLIGHTS || !isAgentGenerating()) return;
    for (const m of mutations) {
      if (m.type === 'characterData' && m.target && m.target.nodeType === 3) {
        const parent = m.target.parentElement;
        if (!parent || parent.closest('pre, code') || !parent.closest('[data-testid="planner-response-text"]')) continue;
        const prevLen = seenTextLens.get(m.target) || 0;
        const curLen = m.target.length;
        seenTextLens.set(m.target, curLen);
        if (curLen > prevLen) {
          pushInkRange(m.target, Math.max(0, prevLen), curLen);
        }
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
  streamObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
  onCleanup(() => {
    streamObserver.disconnect();
    clearInkHighlights();
  });

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

  const CHEER_LINES = ['代码一遍过 ✨', '缓存命中稳稳的', '摸摸头，继续冲！', '0fps 节能待机中', '今天效率拉满 🚀'];
  let wasMascotBusy = false;
  let mascotCheerUntil = 0;
  let mascotIdleSince = Date.now();
  let mascotBubbleTimer = 0;

  function showMascotBubble(text, ms = 2000) {
    const dock = document.getElementById('ag-ps-mascot-dock');
    const b = dock && dock.querySelector('.ag-ps-mascot-bubble');
    if (!b) return;
    b.textContent = text;
    b.setAttribute('data-show', '1');
    clearTimeout(mascotBubbleTimer);
    mascotBubbleTimer = setTimeout(() => b.removeAttribute('data-show'), ms);
  }

  function syncMascotDock() {
    const box = document.getElementById('antigravity.agentSidePanelInputBox');
    let dock = document.getElementById('ag-ps-mascot-dock');
    if (!prefs.mascot || !box) {
      if (dock) dock.remove();
      return;
    }
    const styleKey = prefs.mascotStyle || 'trio';
    if (!dock || dock.parentElement !== box) {
      if (dock) dock.remove();
      dock = document.createElement('div');
      dock.id = 'ag-ps-mascot-dock';
      dock.setAttribute('data-ag-i18n-ignore', '1');
      dock.title = '像素伙伴（点击互动 · 空闲自动 0fps 休眠）';
      dock.addEventListener('click', (e) => {
        e.stopPropagation();
        mascotCheerUntil = Date.now() + 2000;
        dock.setAttribute('data-mood', 'cheer');
        const msg = CHEER_LINES[Math.floor(Math.random() * CHEER_LINES.length)];
        showMascotBubble(msg, 2200);
      });
      box.appendChild(dock);
    }
    if (dock.getAttribute('data-style') !== styleKey) {
      dock.setAttribute('data-style', styleKey);
      const sprites = styleKey === 'crab' ? SVG_CRAB : styleKey === 'cat' ? SVG_CAT : `${SVG_CRAB}${SVG_CAT}${SVG_SLIME}`;
      dock.innerHTML = `<span class="ag-ps-mascot-bubble"></span>${sprites}`;
    }

    const busy = isAgentGenerating();
    const now = Date.now();
    if (busy) {
      mascotIdleSince = now;
      if (!wasMascotBusy) showMascotBubble('思考中… ⚡', 1800);
      dock.setAttribute('data-mood', 'busy');
    } else {
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
    wasMascotBusy = busy;
  }
  onCleanup(() => document.getElementById('ag-ps-mascot-dock')?.remove());

  /* ==========================================================================
   * 6. Thought Process Live Chinese Translation (Bilingual / Immersive)
   * ========================================================================== */
  const thoughtInFlight = new WeakSet();
  const thoughtTextMemo = new WeakMap(); // container -> { src, zh }

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

  function applyThoughtDisplay(bodyEl, zhText, mode) {
    if (!bodyEl || !bodyEl.parentElement) return;
    let box = bodyEl.parentElement.querySelector(':scope > .ag-ps-thought-zh');
    if (mode === 'off' || !zhText) {
      bodyEl.classList.remove('ag-ps-thought-src-dim', 'ag-ps-thought-src-hidden');
      if (box) box.remove();
      return;
    }
    if (!box) {
      box = document.createElement('div');
      box.className = 'ag-ps-thought-zh';
      box.setAttribute('data-ag-i18n-ignore', '1');
      bodyEl.parentElement.insertBefore(box, bodyEl.nextSibling);
    }
    const label = mode === 'immersive' ? '中文思考（沉浸）' : '中文思考（双语）';
    box.innerHTML = `<div class="ag-ps-thought-zh-hdr"><span>${label}</span></div><div>${escapeHtml(zhText)}</div>`;
    if (mode === 'immersive') {
      bodyEl.classList.add('ag-ps-thought-src-hidden');
      bodyEl.classList.remove('ag-ps-thought-src-dim');
    } else {
      bodyEl.classList.remove('ag-ps-thought-src-hidden');
      bodyEl.classList.add('ag-ps-thought-src-dim');
    }
  }

  function translateThoughtContainer(bodyEl, modeOverride = null) {
    if (!bodyEl || typeof window.__agProjectCall !== 'function') return;
    const mode = modeOverride || prefs.thoughtMode;
    if (mode === 'off') {
      applyThoughtDisplay(bodyEl, '', 'off');
      return;
    }
    const srcText = (bodyEl.innerText || bodyEl.textContent || '').trim();
    if (!looksMostlyEnglish(srcText)) return;
    const clipped = srcText.slice(0, 4200);
    const memo = thoughtTextMemo.get(bodyEl);
    if (memo && memo.src === clipped && memo.zh) {
      applyThoughtDisplay(bodyEl, memo.zh, mode);
      return;
    }
    if (thoughtInFlight.has(bodyEl)) return;
    thoughtInFlight.add(bodyEl);
    Promise.resolve(window.__agProjectCall('translateText', { text: clipped, targetLang: 'zh-CN' }, 9000))
      .then((res) => {
        if (disposed || !bodyEl.isConnected) return;
        if (res && res.ok && res.translated && !res.skipped) {
          thoughtTextMemo.set(bodyEl, { src: clipped, zh: res.translated });
          applyThoughtDisplay(bodyEl, res.translated, modeOverride || prefs.thoughtMode);
        }
      })
      .catch(() => {})
      .finally(() => {
        thoughtInFlight.delete(bodyEl);
      });
  }

  function syncThoughtBlocks() {
    const triggers = document.querySelectorAll('[data-testid="thinking-collapsible-trigger"]');
    for (const trig of triggers) {
      const expanded = trig.getAttribute('aria-expanded') === 'true';
      const bodyEl = expanded ? findThoughtBody(trig) : null;
      if (!bodyEl) continue;
      if (prefs.thoughtMode === 'off') {
        applyThoughtDisplay(bodyEl, '', 'off');
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
  function isCurrentlyDark() {
    return (
      document.documentElement.getAttribute('data-ag-theme-mode') === 'dark' ||
      document.body.classList.contains('dark')
    );
  }

  function renderPopoverContent(pop) {
    const darkNow = isCurrentlyDark();
    pop.innerHTML = `
      <div class="ag-ps-pop-hdr">
        <span class="ag-ps-pop-title">✦ 棱镜扩展套件 <span class="ag-ps-pop-badge">${darkNow ? '当前深色' : '当前浅色'}</span></span>
      </div>

      <div class="ag-ps-sec-lbl">浅色主题配色</div>
      <div class="ag-ps-palette-row">
        <button type="button" class="ag-ps-pal-btn" data-set-light="default" data-selected="${prefs.lightPalette === 'default' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:#FFFFFF"></span>纯白默认</button>
        <button type="button" class="ag-ps-pal-btn" data-set-light="crystal" data-selected="${prefs.lightPalette === 'crystal' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:#E8EEF6"></span>白昼冷晶</button>
        <button type="button" class="ag-ps-pal-btn" data-set-light="alabaster" data-selected="${prefs.lightPalette === 'alabaster' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:#EBE6DC"></span>暖白画册</button>
      </div>

      <div class="ag-ps-sec-lbl">深色主题配色</div>
      <div class="ag-ps-palette-row">
        <button type="button" class="ag-ps-pal-btn" data-set-dark="default" data-selected="${prefs.darkPalette === 'default' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:#212120"></span>暖炭默认</button>
        <button type="button" class="ag-ps-pal-btn" data-set-dark="obsidian" data-selected="${prefs.darkPalette === 'obsidian' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:#09090B"></span>深空黑曜</button>
        <button type="button" class="ag-ps-pal-btn" data-set-dark="basalt" data-selected="${prefs.darkPalette === 'basalt' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:#141312"></span>暖炭玄岩</button>
      </div>

      <div class="ag-ps-sec-lbl">增强功能开关</div>
      <div class="ag-ps-toggle-list">
        <div class="ag-ps-toggle-row">
          <div class="ag-ps-toggle-label"><span>会话大纲 &amp; 跳轮</span><span class="ag-ps-toggle-sub">Alt+↑/↓ 跳轮 · Alt+O 大纲</span></div>
          <button type="button" class="ag-ps-switch" data-toggle="outline" data-on="${prefs.outline ? '1' : '0'}"></button>
        </div>
        <div class="ag-ps-toggle-row">
          <div class="ag-ps-toggle-label"><span>名著换算 &amp; 12 周热力图</span><span class="ag-ps-toggle-sub">位于右侧「概览 → 用量统计」底部 <a href="#" data-jump-usage="1" style="color:var(--primary,#2F75C3);text-decoration:none;margin-left:4px">定位 ↗</a></span></div>
          <button type="button" class="ag-ps-switch" data-toggle="usageExtra" data-on="${prefs.usageExtra ? '1' : '0'}"></button>
        </div>
        <div class="ag-ps-toggle-row">
          <div class="ag-ps-toggle-label"><span>五级水墨流式淡入</span><span class="ag-ps-toggle-sub">CSS.highlights 零 DOM 侵入</span></div>
          <button type="button" class="ag-ps-switch" data-toggle="inkStream" data-on="${prefs.inkStream ? '1' : '0'}"></button>
        </div>
        <div class="ag-ps-toggle-row">
          <div class="ag-ps-toggle-label"><span>输入框像素小伙伴</span><span class="ag-ps-toggle-sub">空闲 5s 自动 0fps 休眠</span></div>
          <button type="button" class="ag-ps-switch" data-toggle="mascot" data-on="${prefs.mascot ? '1' : '0'}"></button>
        </div>
        ${
          prefs.mascot
            ? `<div class="ag-ps-toggle-row">
                <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">伙伴样式</span></div>
                <div class="ag-ps-seg-group">
                  <button type="button" class="ag-ps-seg-btn" data-mascot-style="trio" data-selected="${prefs.mascotStyle === 'trio' ? '1' : '0'}">三萌</button>
                  <button type="button" class="ag-ps-seg-btn" data-mascot-style="crab" data-selected="${prefs.mascotStyle === 'crab' ? '1' : '0'}">橘蟹</button>
                  <button type="button" class="ag-ps-seg-btn" data-mascot-style="cat" data-selected="${prefs.mascotStyle === 'cat' ? '1' : '0'}">紫猫</button>
                </div>
              </div>`
            : ''
        }
        <div class="ag-ps-toggle-row">
          <div class="ag-ps-toggle-label"><span>思考过程实时中译</span><span class="ag-ps-toggle-sub">展开英文思考块自动翻译</span></div>
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
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        prefs.lightPalette = lBtn.getAttribute('data-set-light');
        savePrefs();
        applyPalettes();
        renderPopoverContent(pop);
        return;
      }
      const dBtn = e.target.closest('[data-set-dark]');
      if (dBtn) {
        prefs.darkPalette = dBtn.getAttribute('data-set-dark');
        savePrefs();
        applyPalettes();
        renderPopoverContent(pop);
        return;
      }
      const sw = e.target.closest('[data-toggle]');
      if (sw) {
        const k = sw.getAttribute('data-toggle');
        prefs[k] = !prefs[k];
        savePrefs();
        if (k === 'inkStream' && !prefs.inkStream) clearInkHighlights();
        if (k === 'outline' && !prefs.outline) toggleOutlineDrawer(false);
        syncMascotDock();
        syncUsageExtraMount();
        syncToolbarButtons();
        renderPopoverContent(pop);
        return;
      }
      const ms = e.target.closest('[data-mascot-style]');
      if (ms) {
        prefs.mascotStyle = ms.getAttribute('data-mascot-style');
        savePrefs();
        syncMascotDock();
        renderPopoverContent(pop);
        return;
      }
      const tm = e.target.closest('[data-thought-mode]');
      if (tm) {
        prefs.thoughtMode = tm.getAttribute('data-thought-mode');
        savePrefs();
        syncThoughtBlocks();
        renderPopoverContent(pop);
      }
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
   * 8. Lightweight Periodic Sync & Zero-Flicker Overview Observer
   * ========================================================================== */
  let ovMountObserver = null;
  let observedOvEl = null;

  function ensureOverviewObserver() {
    const sec = document.getElementById('ag-claude-ov-sections');
    if (!sec) return;
    if (observedOvEl === sec && ovMountObserver) return;
    if (ovMountObserver) ovMountObserver.disconnect();
    observedOvEl = sec;
    ovMountObserver = new MutationObserver(() => {
      if (disposed || !prefs.usageExtra) return;
      const body = sec.querySelector('[data-ov-card="usage"] .ag-ov-card-body');
      if (body && !body.querySelector('.ag-ps-usage-extra')) {
        syncUsageExtraMount();
      }
    });
    ovMountObserver.observe(sec, { childList: true, subtree: true });
  }
  onCleanup(() => {
    if (ovMountObserver) ovMountObserver.disconnect();
    ovMountObserver = null;
    observedOvEl = null;
  });

  function tickAll() {
    if (disposed) return;
    syncToolbarButtons();
    syncMascotDock();
    ensureOverviewObserver();
    syncUsageExtraMount();
    syncThoughtBlocks();
  }

  tickAll();
  const intervalId = setInterval(tickAll, 1400);
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
