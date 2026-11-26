/* ============================================================================
 * Anti-Claude Prism Suite v0.5.0 (Clean-Room Original, MIT)
 * Performance-first architecture:
 *   - Zero document.body MutationObserver (0.0ms typing latency in composer)
 *   - Stream ink observer attaches ONLY to [data-testid="autoscroll-viewport"]
 *     during active generation and disconnects immediately on idle
 *   - Typing-grace + IME composition + touch-drag guard + dirty-checked DOM writes
 *   - Versioned event bus (window.__agPrismBus v4) for modular companion extensions
 * ============================================================================ */
(() => {
  if (typeof window.__agPrismSuiteDispose === 'function') {
    try { window.__agPrismSuiteDispose(); } catch {}
  }

  const SUITE_VERSION = '0.5.6';
  const REPO_RELEASES_API = 'https://api.github.com/repos/wushuai0802/anti-claude-prism-suite/releases/latest';
  const REPO_RELEASES_URL = 'https://github.com/wushuai0802/anti-claude-prism-suite/releases/latest';
  const STORAGE_KEY = 'ag_prism_suite_prefs_v1';
  const LIVE_QUOTA_STORAGE_KEY = 'ag_prism_live_quota_v1';
  const ACCOUNT_SUMMARY_STORAGE_KEY = 'ag_prism_account_summary_v1';
  const ANTI_CLAUDE_QUOTA_CACHE_KEY = 'ag_claude_ux_quota_cache_v1';
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
    mascotVibe: 'lively',      // 'calm' | 'lively' (personality intensity)
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
        merged.mascotVibe = merged.mascotVibe === 'calm' ? 'calm' : 'lively';
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

  /* ---- Typing-grace, IME composition & touch-drag guard ---- */
  let lastTypingAt = 0;
  let isComposing = false;
  let isTouchDragging = false;
  let composeResetTimer = 0;

  function markUserTyping(e) {
    const t = e && e.target;
    if (t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) {
      lastTypingAt = Date.now();
    }
  }
  function onCompositionStart(e) {
    isComposing = true;
    markUserTyping(e);
    clearTimeout(composeResetTimer);
    composeResetTimer = setTimeout(() => { isComposing = false; }, 8000);
  }
  function onCompositionEnd(e) {
    isComposing = false;
    clearTimeout(composeResetTimer);
    markUserTyping(e);
  }
  function onTouchStart() { isTouchDragging = true; }
  function onTouchEnd() { isTouchDragging = false; }

  document.addEventListener('keydown', markUserTyping, { capture: true, passive: true });
  document.addEventListener('compositionstart', onCompositionStart, { capture: true, passive: true });
  document.addEventListener('compositionupdate', markUserTyping, { capture: true, passive: true });
  document.addEventListener('compositionend', onCompositionEnd, { capture: true, passive: true });
  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  document.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
  document.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });
  onCleanup(() => {
    clearTimeout(composeResetTimer);
    document.removeEventListener('keydown', markUserTyping, true);
    document.removeEventListener('compositionstart', onCompositionStart, true);
    document.removeEventListener('compositionupdate', markUserTyping, true);
    document.removeEventListener('compositionend', onCompositionEnd, true);
    document.removeEventListener('touchstart', onTouchStart, true);
    document.removeEventListener('touchend', onTouchEnd, true);
    document.removeEventListener('touchcancel', onTouchEnd, true);
  });

  function isUserActivelyTyping() {
    return isComposing || isTouchDragging || Date.now() - lastTypingAt < 1800;
  }

  /* ---- Dirty-checked attribute & CSS var writers (prevent full-page style recalcs) ---- */
  function setAttrIfChanged(el, attr, val) {
    if (!el) return false;
    if (val === null || val === undefined || val === false) {
      if (!el.hasAttribute(attr)) return false;
      el.removeAttribute(attr);
      return true;
    }
    const str = String(val);
    if (el.getAttribute(attr) === str) return false;
    el.setAttribute(attr, str);
    return true;
  }

  function setStyleVarIfChanged(el, prop, val) {
    if (!el || !el.style) return false;
    if (val === null || val === undefined || val === '') {
      if (!el.style.getPropertyValue(prop)) return false;
      el.style.removeProperty(prop);
      return true;
    }
    const str = String(val);
    if (el.style.getPropertyValue(prop) === str) return false;
    el.style.setProperty(prop, str);
    return true;
  }

  /* ==========================================================================
   * 1. Multi-Palette Theme Application
   * ========================================================================== */
  const LIGHT_NAMES = { default: '纯白默认', crystal: '白昼冷晶', alabaster: '暖白画册', sage: '松雾青岚' };
  const DARK_NAMES = { default: '暖炭默认', obsidian: '深空黑曜', basalt: '暖炭玄岩', marine: '深海墨蓝' };
  const LIGHT_ACCENTS = { default: '#2F75C3', crystal: '#2563EB', alabaster: '#B45309', sage: '#15803D' };
  const DARK_ACCENTS = { default: '#60A5FA', obsidian: '#3B82F6', basalt: '#D97706', marine: '#38BDF8' };

  function isCurrentlyDark() {
    return (
      document.documentElement.getAttribute('data-ag-theme-mode') === 'dark' ||
      document.body.classList.contains('dark')
    );
  }

  function getThemeAccent() {
    if (isCurrentlyDark()) return DARK_ACCENTS[prefs.darkPalette] || DARK_ACCENTS.default;
    return LIGHT_ACCENTS[prefs.lightPalette] || LIGHT_ACCENTS.default;
  }

  function applyPalettes() {
    const html = document.documentElement;
    if (!html) return;
    setAttrIfChanged(html, 'data-ag-ps-light', prefs.lightPalette && prefs.lightPalette !== 'default' ? prefs.lightPalette : null);
    setAttrIfChanged(html, 'data-ag-ps-dark', prefs.darkPalette && prefs.darkPalette !== 'default' ? prefs.darkPalette : null);
  }
  applyPalettes();
  onCleanup(() => {
    setAttrIfChanged(document.documentElement, 'data-ag-ps-light', null);
    setAttrIfChanged(document.documentElement, 'data-ag-ps-dark', null);
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
    // Unified overlay priority stack: Image Context Menu > Suite Popover > Outline Drawer > Inline Editor
    const imgMenu = document.getElementById('ag-ps-img-menu');
    if (imgMenu && imgMenu.isConnected) {
      if (typeof window.__agPrismCloseImageMenu === 'function') {
        try { window.__agPrismCloseImageMenu(); } catch { imgMenu.remove(); }
      } else {
        imgMenu.remove();
      }
      return true;
    }
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
    const inlineEd = document.querySelector('.ag-ps-inline-editor');
    if (inlineEd && inlineEd.isConnected) {
      if (typeof window.__agPrismCloseInlineEditor === 'function') {
        try { window.__agPrismCloseInlineEditor(); } catch { inlineEd.remove(); }
      } else {
        inlineEd.remove();
      }
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
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
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

  const outlineTextCache = new WeakMap();
  const registeredOutlineActions = [];

  function getCachedTurnText(el) {
    if (!el) return '';
    const rawLen = el.textContent ? el.textContent.length : 0;
    const prev = outlineTextCache.get(el);
    if (prev && prev.len === rawLen) return prev.txt;
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    outlineTextCache.set(el, { len: rawLen, txt });
    return txt;
  }

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
      const txt = getCachedTurnText(turns[i]);
      if (q && !txt.toLowerCase().includes(q)) continue;
      items.push({ idx: i, txt, isCurrent: i === curIdx });
    }
    const countEl = drawer.querySelector('.ag-ps-outline-count');
    if (countEl) countEl.textContent = `已加载 ${turns.length} 轮`;

    if (!items.length) {
      list.innerHTML = `<div style="padding:14px 8px;text-align:center;color:var(--muted-foreground)">暂无匹配提问（快捷键 Alt+↑/↓ 跳轮）</div>`;
      return;
    }
    const extraBtns = (idx) =>
      registeredOutlineActions
        .map(
          (act) =>
            `<button type="button" class="ag-ps-outline-btw ag-ps-outline-act" data-outline-act="${escapeHtml(act.id)}" data-act-idx="${idx}" data-ag-ps-tip="${escapeHtml(act.title || act.label)}">${escapeHtml(act.label)}</button>`
        )
        .join('');
    list.innerHTML = items
      .map(
        (it) =>
          `<div class="ag-ps-outline-item" role="listitem"${it.isCurrent ? ' aria-current="true"' : ''}>
            <button type="button" class="ag-ps-outline-main" data-turn-idx="${it.idx}">
              <span class="ag-ps-outline-idx">#${it.idx + 1}</span>
              <span class="ag-ps-outline-txt" data-ag-ps-tip="${escapeHtml(it.txt)}">${escapeHtml(it.txt.slice(0, 60))}</span>
            </button>
            ${extraBtns(it.idx)}
            <button type="button" class="ag-ps-outline-btw" data-btw-idx="${it.idx}" data-ag-ps-tip="作为 /btw 支线提问">btw</button>
          </div>`
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
        <span style="font-weight:600;font-size:12.5px;letter-spacing:-0.015em">会话大纲</span>
        <span class="ag-ps-outline-count ag-ps-pop-meta">0 轮</span>
      </div>
      <input type="text" class="ag-ps-outline-search" placeholder="筛选提问关键词… (Alt+↑/↓ 跳轮 · Esc 关)" />
      <div class="ag-ps-outline-list" role="list"></div>
    `;
    const input = drawer.querySelector('.ag-ps-outline-search');
    input.addEventListener('input', () => renderOutlineList(input.value));
    drawer.addEventListener('click', (e) => {
      e.stopPropagation();
      const actEl = e.target.closest('[data-outline-act]');
      if (actEl) {
        e.stopPropagation();
        const actId = actEl.getAttribute('data-outline-act');
        const idx = Number(actEl.getAttribute('data-act-idx'));
        const act = registeredOutlineActions.find((a) => a.id === actId);
        const turns = getUserTurnElements();
        if (act && typeof act.onClick === 'function' && turns[idx]) {
          try { act.onClick(idx, turns[idx], buildBusHelpers()); } catch {}
        }
        drawer.removeAttribute('data-open');
        syncToolbarActiveStates();
        return;
      }
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
  onCleanup(() => {
    clearTimeout(heatPartialTimer);
    document.querySelectorAll('.ag-ps-usage-extra').forEach((n) => n.remove());
  });

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
    if (mascotWaitingDoze) wakeMascotFromWait();
    else if (!mascotFirstTokenSeen) mascotFirstTokenSeen = true;
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
        { key: 'floor:cat', label: '紫猫', svg: SVG_CAT },
        { key: 'floor:slime', label: '蓝萌', svg: SVG_SLIME }
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
  const COMBO_LINES = [
    '别戳啦！正在帮你狂省 Token ✨',
    '连击 ×5！送你 99% 缓存好运 🍀',
    '头晕啦～再戳我就去写 Bug 啦 🌀',
    '摸头暴击！灵感 +999 🚀'
  ];
  let wasMascotBusy = false;
  let mascotCheerUntil = 0;
  let mascotIdleSince = Date.now();
  let mascotBubbleTimer = 0;
  let mascotRoamingActive = false;
  let mascotActors = []; // [{ key, label, busy, el, emoteEl, emoteText, emoteTempUntil, tapTimes, x, facing, moveTimer, settleTimer, clickTimer, roaming }]
  let lastTrackWidth = 0;
  let lastRosterSig = '';
  let mascotSnapRaf = 0;
  let mascotBusyStartedAt = 0;
  let mascotBusyStartLen = 0;
  let mascotFirstTokenSeen = true;
  let mascotWaitingDoze = false;
  let lastHighFiveAt = 0;

  function setActorEmote(actor, text, isSleepZ = false, tempMs = 0) {
    if (!actor || !actor.emoteEl) return;
    const now = Date.now();
    if (tempMs > 0) {
      actor.emoteTempUntil = now + tempMs;
      if (actor.emoteTimer) clearTimeout(actor.emoteTimer);
      actor.emoteTimer = setTimeout(() => {
        actor.emoteTimer = 0;
        actor.emoteTempUntil = 0;
        if (!disposed && actor.emoteEl?.isConnected) {
          actor.emoteText = '';
          actor.emoteEl.textContent = '';
          actor.emoteEl.removeAttribute('data-show');
          actor.emoteEl.removeAttribute('data-sleep-z');
        }
      }, tempMs);
    } else if (actor.emoteTempUntil > now) {
      return; // Let transient high-five / combo emote finish
    }
    const want = String(text || '');
    if (actor.emoteText !== want) {
      actor.emoteText = want;
      actor.emoteEl.textContent = want;
    }
    if (want) {
      actor.emoteEl.setAttribute('data-show', '1');
      if (isSleepZ) actor.emoteEl.setAttribute('data-sleep-z', '1');
      else actor.emoteEl.removeAttribute('data-sleep-z');
    } else {
      actor.emoteEl.removeAttribute('data-show');
      actor.emoteEl.removeAttribute('data-sleep-z');
    }
  }

  function sampleLatestResponseLen() {
    const vp = document.querySelector('[data-testid="autoscroll-viewport"]');
    if (!vp) return 0;
    const resps = vp.querySelectorAll('[data-testid="planner-response-text"], [data-testid="agent-response"]');
    if (resps.length) {
      const last = resps[resps.length - 1];
      return (last && last.textContent ? last.textContent.length : 0);
    }
    return 0;
  }

  function detectLeadStatusEmote(mainBusy) {
    // 1. High context pressure or cache collapse warning (O(1) memory check)
    const stats = window.__ag_last_metrics && window.__ag_last_metrics.stats;
    const curId = getCurrentCascadeIdFromUrl();
    if (stats && (!curId || !window.__ag_last_metrics.cascadeId || window.__ag_last_metrics.cascadeId === curId)) {
      if (stats.cacheCollapsed || (Number(stats.pct) || 0) >= 85) {
        return { icon: '💦', tip: '上下文偏高或缓存波动，可考虑 /compact' };
      }
    }
    if (!mainBusy) return { icon: '', tip: '' };
    if (mascotWaitingDoze) return { icon: '…', tip: '等待模型首字输出中' };
    // 2. Lightweight stage hint: tool call vs deep thinking
    if (document.querySelector('.animate-shimmer-text')) {
      return { icon: '🔧', tip: '工具执行中' };
    }
    const triggers = document.querySelectorAll('[data-testid="thinking-collapsible-trigger"]');
    if (triggers.length) {
      const lastTxt = (triggers[triggers.length - 1].textContent || '').trim();
      if (lastTxt && !/\d+\s*s\b|\d+\s*秒|已思考|Thought\s+for/i.test(lastTxt)) {
        return { icon: '💡', tip: '深度思考中' };
      }
    }
    return { icon: '', tip: '' };
  }

  function wakeMascotFromWait() {
    if (!mascotWaitingDoze) return;
    mascotFirstTokenSeen = true;
    mascotWaitingDoze = false;
    const dock = document.getElementById('ag-ps-mascot-dock');
    if (!dock || !mascotActors.length) return;
    mascotActors.forEach((a) => {
      if (a.el && a.el.getAttribute('data-act') === 'doze') {
        a.el.removeAttribute('data-act');
        const ms = triggerActorTrick(a, 'leap');
        if (a.clickTimer) clearTimeout(a.clickTimer);
        a.clickTimer = setTimeout(() => {
          a.clickTimer = 0;
          if (a.el?.getAttribute('data-act') === 'leap') a.el.removeAttribute('data-act');
        }, ms);
      }
    });
    showMascotBubble('出字啦！冲冲冲 ⚡', 1700);
    syncMascotRoaming(dock);
  }

  function cancelSnapRaf() {
    if (mascotSnapRaf) {
      cancelAnimationFrame(mascotSnapRaf);
      mascotSnapRaf = 0;
    }
  }
  onCleanup(cancelSnapRaf);

  let mascotBubbleOwner = null;
  let lastObstacleSig = '';

  function syncBubbleEdgeAlign(bubble, actor, dock) {
    if (!bubble || !actor || !dock) return;
    const trackW = dock.clientWidth || dock.parentElement?.getBoundingClientRect().width || 0;
    if (trackW <= 0) return;
    const { w } = getMascotDims();
    const center = actor.x + w / 2;
    if (center > trackW - 140) bubble.setAttribute('data-align', 'right');
    else if (center < 140) bubble.setAttribute('data-align', 'left');
    else bubble.removeAttribute('data-align');
  }

  function showMascotBubble(text, ms = 2000, actor = null) {
    const dock = document.getElementById('ag-ps-mascot-dock');
    const b = dock && dock.querySelector('.ag-ps-mascot-bubble');
    if (!b) return;
    const target = actor && actor.el?.isConnected ? actor : mascotActors[0] || null;
    if (target && target.el && b.parentElement !== target.el) {
      target.el.appendChild(b);
    }
    mascotBubbleOwner = target;
    syncBubbleEdgeAlign(b, target, dock);
    b.textContent = text;
    b.setAttribute('data-show', '1');
    clearTimeout(mascotBubbleTimer);
    mascotBubbleTimer = setTimeout(() => b.removeAttribute('data-show'), ms);
  }
  onCleanup(() => {
    clearTimeout(mascotBubbleTimer);
    mascotBubbleOwner = null;
  });

  function getMascotDims() {
    const w = clampMascotSize(prefs.mascotSize);
    const h = Math.max(14, Math.round((w * 11) / 12));
    const gap = Math.max(4, Math.round(w * 0.22));
    return { w, h, gap };
  }

  function getCurrentTokPerSec() {
    const el = document.getElementById('ag-live-metrics-text');
    const txt = (el && el.textContent) || (window.__ag_last_metrics && window.__ag_last_metrics.inlineHtml) || '';
    const m = String(txt).match(/(\d+(?:\.\d+)?)\s*tok\/s/i);
    if (!m) return 0;
    const v = Number(m[1]);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  function getMascotSpeedScale() {
    const tps = getCurrentTokPerSec();
    if (tps <= 0) return 1;
    // Map ~30 tok/s -> 0.78x (calm), ~80 tok/s -> 1.0x (brisk), 180+ tok/s -> 2.0x (turbo)
    const raw = 0.62 + tps / 140;
    return Math.max(0.75, Math.min(2.05, raw));
  }

  function syncMascotSpeedVars(dock) {
    if (!dock) return 1;
    const scale = getMascotSpeedScale();
    const trot = Math.max(0.14, Math.min(0.36, 0.28 / scale));
    const roll = Math.max(0.24, Math.min(0.60, 0.46 / scale));
    dock.style.setProperty('--ag-ps-trot-dur', `${trot.toFixed(2)}s`);
    dock.style.setProperty('--ag-ps-roll-dur', `${roll.toFixed(2)}s`);
    return scale;
  }

  function clearActorTimers(actor) {
    if (!actor) return;
    if (actor.moveTimer) { clearTimeout(actor.moveTimer); actor.moveTimer = 0; }
    if (actor.settleTimer) { clearTimeout(actor.settleTimer); actor.settleTimer = 0; }
    if (actor.clickTimer) { clearTimeout(actor.clickTimer); actor.clickTimer = 0; }
    if (actor.emoteTimer) { clearTimeout(actor.emoteTimer); actor.emoteTimer = 0; }
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

  /* ---- Smart Button-Obstacle Avoidance & Playful Pointer-Dodge for Mascots ---- */
  function scanDockObstacles(dock) {
    if (!dock || !dock.isConnected) return { zones: [], crowded: false, sig: '' };
    const dockRect = dock.getBoundingClientRect();
    if (!dockRect.width) return { zones: [], crowded: false, sig: '' };
    const { w, h, gap } = getMascotDims();
    const bandTop = dockRect.top - Math.max(h, 26) - 10;
    const bandBottom = dockRect.bottom + 12;
    const searchRoot = dock.closest('main, [role="main"]') || document.body;
    if (!searchRoot) return { zones: [], crowded: false, sig: '' };

    const rawZones = [];
    const controls = searchRoot.querySelectorAll('button, [role="button"], a[href], input:not([type="hidden"]), [role="tab"], [role="radio"]');
    for (let i = 0; i < controls.length; i++) {
      const el = controls[i];
      if (!el.isConnected || dock.contains(el) || el.closest('#ag-ps-orb-dock, #ag-ps-popover, #ag-ps-tooltip')) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.width > 280) continue;
      if (r.bottom < bandTop || r.top > bandBottom) continue;
      if (r.right < dockRect.left - 8 || r.left > dockRect.right + 8) continue;
      const l = Math.max(0, Math.floor(r.left - dockRect.left) - 10);
      const ri = Math.min(Math.ceil(dockRect.width), Math.ceil(r.right - dockRect.left) + 10);
      if (ri > l) rawZones.push([l, ri]);
    }
    if (!rawZones.length) return { zones: [], crowded: false, sig: '' };
    rawZones.sort((a, b) => a[0] - b[0]);
    const merged = [rawZones[0]];
    for (let i = 1; i < rawZones.length; i++) {
      const prev = merged[merged.length - 1];
      if (rawZones[i][0] <= prev[1] + 12) {
        prev[1] = Math.max(prev[1], rawZones[i][1]);
      } else {
        merged.push(rawZones[i]);
      }
    }

    const totalBlockedW = merged.reduce((sum, z) => sum + (z[1] - z[0]), 0);
    const hasBadge = Boolean(dock.querySelector('.ag-ps-more-badge'));
    const rightBound = Math.max(12, Math.round(dockRect.width - (hasBadge ? 44 : 16)));
    const needW = mascotActors.length ? mascotActors.length * w + Math.max(0, mascotActors.length - 1) * gap : w;
    let cursor = 12;
    let maxFreeGap = 0;
    for (let i = 0; i < merged.length; i++) {
      if (merged[i][0] > cursor) {
        maxFreeGap = Math.max(maxFreeGap, Math.min(rightBound, merged[i][0]) - cursor);
      }
      cursor = Math.max(cursor, merged[i][1]);
    }
    if (rightBound > cursor) {
      maxFreeGap = Math.max(maxFreeGap, rightBound - cursor);
    }
    const crowded = totalBlockedW > dockRect.width * 0.65 || (mascotActors.length > 0 && maxFreeGap < needW);
    const sig = `${crowded ? '1' : '0'}|${merged.map((z) => `${z[0]}:${z[1]}`).join(',')}`;
    return { zones: merged, crowded, sig };
  }

  function getDockObstacleZones(dock) {
    return scanDockObstacles(dock).zones;
  }

  function isIntervalBlocked(x, w, zones) {
    for (let i = 0; i < zones.length; i++) {
      if (x + w > zones[i][0] && x < zones[i][1]) return true;
    }
    return false;
  }

  function findNearestSafeX(curX, w, minX, maxX, zones, avoidLeft, avoidRight) {
    const allZones = avoidRight > avoidLeft ? [...zones, [avoidLeft, avoidRight]] : zones;
    let bestX = null;
    let bestDist = Infinity;
    for (let x = minX; x <= maxX; x += 6) {
      if (!isIntervalBlocked(x, w, allZones)) {
        const d = Math.abs(x - curX);
        if (d < bestDist) {
          bestDist = d;
          bestX = x;
        }
      }
    }
    return bestX;
  }

  function computeHomePositions(trackW, count, hasOverflowBadge, dock = null, scan = null) {
    const { w, gap } = getMascotDims();
    const rightPad = hasOverflowBadge ? 44 : 16;
    const totalW = count * w + Math.max(0, count - 1) * gap;
    const info = scan || (dock ? scanDockObstacles(dock) : { zones: [], crowded: false });
    const zones = info.zones || [];
    let anchorRight = trackW - rightPad;

    // If right-side controls (e.g. ^ / × or interactive card buttons) overlap default home, park neatly to their left
    for (let i = zones.length - 1; i >= 0; i--) {
      const [zl, zr] = zones[i];
      if (zr >= anchorRight - totalW && zl < anchorRight) {
        if (zl - 10 - totalW >= 12) {
          anchorRight = zl - 10;
        }
      }
    }

    const startX = Math.max(12, Math.round(anchorRight - totalW));
    const xs = [];
    for (let i = 0; i < count; i++) {
      let cx = startX + i * (w + gap);
      if (zones.length && isIntervalBlocked(cx, w, zones)) {
        const safe = findNearestSafeX(cx, w, 12, Math.max(12, trackW - rightPad - w), zones, 0, 0);
        if (safe !== null) cx = safe;
      }
      xs.push(cx);
    }
    return xs;
  }

  function positionMoreBadgeSafe(dock, xs, zones) {
    const badge = dock && dock.querySelector('.ag-ps-more-badge');
    if (!badge) return;
    if (!xs.length) {
      badge.hidden = true;
      return;
    }
    const { w } = getMascotDims();
    const trackW = dock.clientWidth || dock.parentElement?.getBoundingClientRect().width || 0;
    const badgeW = Math.max(24, badge.offsetWidth || 26);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const candidates = [maxX + w + 6, minX - badgeW - 6];
    let chosen = null;
    for (const c of candidates) {
      const rounded = Math.round(c);
      if (rounded >= 6 && rounded + badgeW <= trackW - 6 && !isIntervalBlocked(rounded, badgeW, zones)) {
        chosen = rounded;
        break;
      }
    }
    if (chosen === null) {
      badge.hidden = true;
    } else {
      badge.hidden = false;
      badge.style.left = `${chosen}px`;
      badge.style.right = 'auto';
    }
  }

  let dodgeHostEl = null;
  let dodgeHostAc = null;
  let lastDodgeCheckAt = 0;
  let dodgeRestoreTimer = 0;

  function detachMascotDodgeWatcher() {
    if (dodgeHostAc) {
      try { dodgeHostAc.abort(); } catch {}
      dodgeHostAc = null;
    }
    dodgeHostEl = null;
    if (dodgeRestoreTimer) {
      clearTimeout(dodgeRestoreTimer);
      dodgeRestoreTimer = 0;
    }
  }
  onCleanup(detachMascotDodgeWatcher);

  function ensureMascotDodgeWatcher(box) {
    if (!box) return;
    if (dodgeHostEl === window && dodgeHostAc) return;
    detachMascotDodgeWatcher();
    dodgeHostEl = window;
    dodgeHostAc = new AbortController();
    window.addEventListener(
      'pointermove',
      (e) => {
        if (disposed || !mascotActors.length) return;
        const now = Date.now();
        if (now - lastDodgeCheckAt < 80) return;
        lastDodgeCheckAt = now;
        const dock = document.getElementById('ag-ps-mascot-dock');
        if (!dock || !dock.isConnected || dock.getAttribute('data-yield') === '1') return;
        const dockRect = dock.getBoundingClientRect();
        if (!dockRect.width) return;
        const { w, h } = getMascotDims();
        if (e.clientY < dockRect.top - Math.max(h, 26) - 12 || e.clientY > dockRect.bottom + 14) return;
        const scan = scanDockObstacles(dock);
        if (scan.crowded) {
          dock.setAttribute('data-yield', '1');
          if (tipTarget && dock.contains(tipTarget)) hideCustomTooltip();
          return;
        }
        const zones = scan.zones;
        if (!zones.length) return;
        const localPx = e.clientX - dockRect.left;
        const nearZone = zones.find(([zl, zr]) => localPx >= zl - 16 && localPx <= zr + 16);
        if (!nearZone) return;

        const { minX, maxX } = getMascotRunwayBounds(dock);
        let dodgedAny = false;
        for (const actor of mascotActors) {
          if (!actor.el || !actor.el.isConnected) continue;
          const overlapsPointerZone = actor.x + w > nearZone[0] - 10 && actor.x < nearZone[1] + 10;
          if (!overlapsPointerZone) continue;
          const safeX = findNearestSafeX(actor.x, w, minX, maxX, zones, nearZone[0] - 12, nearZone[1] + 12);
          if (safeX !== null && Math.abs(safeX - actor.x) >= 10) {
            const dir = safeX < actor.x ? -1 : 1;
            actor.el.setAttribute('data-dodging', '1');
            actor.el.setAttribute('data-act', 'run');
            applyActorTransform(actor, safeX, dir, 0.24);
            setActorEmote(actor, '💨', false, 680);
            if (tipTarget === actor.el) hideCustomTooltip();
            dodgedAny = true;
            setTimeout(() => {
              if (!disposed && actor.el?.isConnected) {
                actor.el.removeAttribute('data-dodging');
                if (actor.el.getAttribute('data-act') === 'run' && !actor.roaming) {
                  actor.el.removeAttribute('data-act');
                }
              }
            }, 420);
          } else {
            // No safe escape slot on runway: yield smoothly so button clicks pass straight through
            dock.setAttribute('data-yield', '1');
            if (tipTarget && dock.contains(tipTarget)) hideCustomTooltip();
            dodgedAny = true;
            break;
          }
        }
        if (dodgedAny && !mascotRoamingActive) {
          clearTimeout(dodgeRestoreTimer);
          dodgeRestoreTimer = setTimeout(() => {
            dodgeRestoreTimer = 0;
            if (!disposed && !mascotRoamingActive) {
              const d2 = document.getElementById('ag-ps-mascot-dock');
              if (d2) {
                const s2 = scanDockObstacles(d2);
                if (!s2.crowded) d2.removeAttribute('data-yield');
                parkActorsHome(d2, false, false, s2);
              }
            }
          }, 2600);
        }
      },
      { passive: true, signal: dodgeHostAc.signal }
    );
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
    if (mascotBubbleOwner === actor) {
      const dock = actor.el.parentElement;
      const b = actor.el.querySelector('.ag-ps-mascot-bubble');
      if (b && b.getAttribute('data-show') === '1') syncBubbleEdgeAlign(b, actor, dock);
    }
  }

  function parkActorsHome(dock, instant, onlyIdleActors = false, scan = null) {
    if (!dock || !mascotActors.length) return;
    const trackW = dock.clientWidth || dock.parentElement?.getBoundingClientRect().width || 0;
    if (trackW <= 0) return;
    lastTrackWidth = trackW;
    const hasBadge = Boolean(dock.querySelector('.ag-ps-more-badge'));
    const info = scan || scanDockObstacles(dock);
    const xs = computeHomePositions(trackW, mascotActors.length, hasBadge, dock, info);
    cancelSnapRaf();
    if (instant) dock.setAttribute('data-snap', '1');
    else dock.removeAttribute('data-snap');
    mascotActors.forEach((actor, idx) => {
      if (onlyIdleActors && actor.roaming) return;
      if (actor.el) actor.el.removeAttribute('data-act');
      applyActorTransform(actor, xs[idx], 1, instant ? 0 : 0.45);
    });
    positionMoreBadgeSafe(dock, xs, info.zones || []);
    if (instant) {
      mascotSnapRaf = requestAnimationFrame(() => {
        mascotSnapRaf = 0;
        if (!disposed && dock.isConnected) dock.removeAttribute('data-snap');
      });
    }
  }

  function triggerActorTrick(actor, preferredAct) {
    if (!actor || !actor.el) return 0;
    const facingRight = actor.facing >= 0;
    const isCalm = prefs.mascotVibe === 'calm';
    let act = preferredAct;
    if (!act) {
      const r = Math.random();
      if (isCalm) {
        act = r < 0.55 ? 'leap' : 'wiggle';
      } else if (r < 0.34) {
        act = facingRight ? 'flip-r' : 'flip-l';
      } else if (r < 0.58) {
        act = 'leap';
      } else if (r < 0.80) {
        act = 'double-hop';
      } else {
        act = 'wiggle';
      }
    }
    const durMap = {
      'combo-flip': 1340,
      'flip-r': 740,
      'flip-l': 740,
      'double-hop': 760,
      wiggle: 680,
      leap: 640
    };
    const ms = durMap[act] || 660;
    actor.el.removeAttribute('data-act');
    void actor.el.offsetWidth;
    actor.el.setAttribute('data-act', act);
    return ms;
  }

  function tryBuddyHighFive(actor, idx) {
    if (!actor || prefs.mascotVibe === 'calm' || mascotActors.length < 2) return false;
    const now = Date.now();
    if (now - lastHighFiveAt < 6000) return false;
    const { w } = getMascotDims();
    const neighbor = mascotActors.find((other, oi) => {
      if (oi === idx || !other.el?.isConnected) return false;
      const act = other.el.getAttribute('data-act') || '';
      if (act === 'run' || act === 'roll-r' || act === 'roll-l' || act === 'combo-flip') return false;
      return Math.abs(other.x - actor.x) <= w + 20;
    });
    if (!neighbor || Math.random() > 0.48) return false;
    lastHighFiveAt = now;
    // Turn toward each other and share a quick high-five hop
    const actorFacesRight = neighbor.x >= actor.x ? 1 : -1;
    applyActorTransform(actor, actor.x, actorFacesRight, 0.15);
    applyActorTransform(neighbor, neighbor.x, -actorFacesRight, 0.15);
    const msA = triggerActorTrick(actor, 'leap');
    const msB = triggerActorTrick(neighbor, 'leap');
    const icon = Math.random() < 0.55 ? '🤝' : '⚡';
    setActorEmote(actor, icon, false, 900);
    setActorEmote(neighbor, icon, false, 900);
    if (neighbor.clickTimer) clearTimeout(neighbor.clickTimer);
    neighbor.clickTimer = setTimeout(() => {
      neighbor.clickTimer = 0;
      if (neighbor.el?.getAttribute('data-act') === 'leap') neighbor.el.removeAttribute('data-act');
    }, msB);
    actor.settleTimer = setTimeout(() => {
      actor.settleTimer = 0;
      if (actor.el?.getAttribute('data-act') === 'leap') actor.el.removeAttribute('data-act');
      scheduleActorRoamStep(idx);
    }, msA);
    return true;
  }

  function scheduleActorRoamStep(idx, initialDelayMs) {
    const actor = mascotActors[idx];
    if (!actor || !actor.roaming || !mascotRoamingActive || disposed || document.hidden || mascotWaitingDoze) return;
    clearActorTimers(actor);
    const isCalm = prefs.mascotVibe === 'calm';
    const delay = typeof initialDelayMs === 'number'
      ? initialDelayMs
      : (isCalm ? 1500 : 850) + Math.floor(Math.random() * (isCalm ? 2400 : 1850));

    actor.moveTimer = setTimeout(() => {
      actor.moveTimer = 0;
      if (!actor.roaming || !mascotRoamingActive || disposed || document.hidden || mascotWaitingDoze) return;
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
      const obstacleZones = getDockObstacleZones(dock);
      if (span >= w * 2 && roll < (isCalm ? 0.52 : 0.58)) {
        let targetX = actor.x;
        const minStep = Math.min(48, span * 0.25);
        for (let attempt = 0; attempt < 10; attempt++) {
          const cand = minX + Math.random() * span;
          if (Math.abs(cand - actor.x) < minStep) continue;
          if (obstacleZones.length && isIntervalBlocked(cand, w, obstacleZones)) continue;
          const crowded = mascotActors.some((o, oi) => oi !== idx && Math.abs(o.x - cand) < w + 8);
          targetX = cand;
          if (!crowded) break;
        }
        if (obstacleZones.length && isIntervalBlocked(targetX, w, obstacleZones)) {
          const safe = findNearestSafeX(targetX, w, minX, maxX, obstacleZones, 0, 0);
          if (safe !== null) targetX = safe;
        }
        const dist = Math.abs(targetX - actor.x);
        if (dist >= 10) {
          const speedScale = syncMascotSpeedVars(dock) * (isCalm ? 0.72 : 1);
          const doRollDash = !isCalm && dist >= 65 && Math.random() < (speedScale >= 1.35 ? 0.42 : 0.26);
          const baseSpeed = doRollDash ? 115 + Math.random() * 45 : 88 + Math.random() * 48;
          const speed = baseSpeed * speedScale;
          const dur = Math.max(0.34, Math.min(2.6, dist / speed));
          const dir = targetX < actor.x ? -1 : 1;
          actor.el.setAttribute('data-act', doRollDash ? (dir > 0 ? 'roll-r' : 'roll-l') : 'run');
          applyActorTransform(actor, targetX, dir, dur);
          actor.settleTimer = setTimeout(() => {
            actor.settleTimer = 0;
            if (!actor.roaming || !mascotRoamingActive || disposed || !actor.el?.isConnected || mascotWaitingDoze) return;
            if (tryBuddyHighFive(actor, idx)) return;
            const landRoll = Math.random();
            if (landRoll < (isCalm ? 0.22 : 0.42)) {
              const trickMs = triggerActorTrick(actor);
              actor.settleTimer = setTimeout(() => {
                actor.settleTimer = 0;
                actor.el?.removeAttribute('data-act');
                scheduleActorRoamStep(idx);
              }, trickMs);
            } else {
              actor.el.removeAttribute('data-act');
              scheduleActorRoamStep(idx);
            }
          }, Math.round(dur * 1000) + 40);
          return;
        }
      }

      if (roll < (isCalm ? 0.78 : 0.90)) {
        const trickMs = triggerActorTrick(actor);
        actor.settleTimer = setTimeout(() => {
          actor.settleTimer = 0;
          actor.el?.removeAttribute('data-act');
          scheduleActorRoamStep(idx);
        }, trickMs);
      } else {
        applyActorTransform(actor, actor.x, actor.facing * -1, 0.2);
        actor.settleTimer = setTimeout(() => {
          actor.settleTimer = 0;
          if (!actor.roaming || !mascotRoamingActive || disposed || mascotWaitingDoze) return;
          applyActorTransform(actor, actor.x, actor.facing * -1, 0.2);
          scheduleActorRoamStep(idx, 900 + Math.floor(Math.random() * 1300));
        }, 520);
      }
    }, delay);
  }

  function syncMascotRoaming(dock) {
    if (!dock || !prefs.mascotRoam || REDUCED_MOTION || document.hidden || mascotWaitingDoze || (dock.clientWidth || 0) < 480) {
      if (mascotRoamingActive) stopMascotRoaming(!mascotWaitingDoze);
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
    const homeXs = computeHomePositions(dock.clientWidth || 0, mascotActors.length, hasBadge, dock);
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
        const now = Date.now();
        mascotCheerUntil = now + 2000;
        let isCombo = false;
        if (actor) {
          actor.tapTimes = (actor.tapTimes || []).filter((t) => now - t <= 2000);
          actor.tapTimes.push(now);
          isCombo = actor.tapTimes.length >= 5;
          if (isCombo) actor.tapTimes = [];

          const curAct = actorEl.getAttribute('data-act') || '';
          const isMoving = curAct === 'run' || curAct === 'roll-r' || curAct === 'roll-l';
          if (isCombo || !isMoving) {
            if (isCombo) clearActorTimers(actor);
            const trickMs = triggerActorTrick(actor, isCombo ? 'combo-flip' : undefined);
            if (isCombo) setActorEmote(actor, '✨', false, 1500);
            if (actor.clickTimer) clearTimeout(actor.clickTimer);
            const appliedAct = actorEl.getAttribute('data-act');
            actor.clickTimer = setTimeout(() => {
              actor.clickTimer = 0;
              if (actorEl.getAttribute('data-act') === appliedAct) actorEl.removeAttribute('data-act');
              if (isCombo && actor.roaming && mascotRoamingActive && !disposed) {
                scheduleActorRoamStep(idx, 500);
              }
            }, trickMs);
          }
        } else {
          dock.setAttribute('data-mood', 'cheer');
        }
        const pool = isCombo ? COMBO_LINES : CHEER_LINES;
        const line = pool[Math.floor(Math.random() * pool.length)];
        const msg = !isCombo && prefs.mascotCountMode === 'agents' && actor?.label ? `${actor.label}：${line}` : line;
        showMascotBubble(msg, isCombo ? 2800 : 2200, actor);
      });
      box.appendChild(dock);
      rebuilt = true;
    }
    ensureMascotDodgeWatcher(box);
    if (rebuilt || rosterSig !== lastRosterSig) {
      stopMascotRoaming(false);
      lastRosterSig = rosterSig;
      dock.setAttribute('data-mode', prefs.mascotCountMode);
      const actorsHtml = roster
        .map(
          (item, idx) =>
            `<span class="ag-ps-actor" data-actor-idx="${idx}" data-busy="${item.busy ? '1' : '0'}" style="--ag-ps-idx:${idx}" data-ag-ps-tip="${escapeHtml(item.label)} · ${item.busy ? '运行中' : '待命'}" data-ag-ps-tip-status="${item.busy ? 'busy' : 'idle'}"><span class="ag-ps-emote" aria-hidden="true"></span><span class="ag-ps-actor-body">${item.svg}</span></span>`
        )
        .join('');
      const badgeHtml = overflow > 0 ? `<span class="ag-ps-more-badge" data-ag-ps-tip="还有 ${overflow} 个活跃 Agent">+${overflow}</span>` : '';
      dock.innerHTML = `<span class="ag-ps-mascot-bubble"></span>${actorsHtml}${badgeHtml}`;
      mascotActors = Array.from(dock.querySelectorAll('.ag-ps-actor')).map((el, idx) => ({
        key: roster[idx].key,
        label: roster[idx].label,
        busy: roster[idx].busy,
        el,
        emoteEl: el.querySelector('.ag-ps-emote'),
        emoteText: '',
        emoteTempUntil: 0,
        emoteTimer: 0,
        tapTimes: [],
        x: 0,
        facing: 1,
        moveTimer: 0,
        settleTimer: 0,
        clickTimer: 0,
        roaming: false
      }));
      applyMascotSizeVars(dock, false);
      parkActorsHome(dock, true, false);
      const obs = scanDockObstacles(dock);
      lastObstacleSig = obs.sig;
      const { w } = getMascotDims();
      const anyBlocked = obs.zones.length > 0 && mascotActors.some((a) => isIntervalBlocked(a.x, w, obs.zones));
      if (obs.crowded || anyBlocked) {
        dock.setAttribute('data-yield', '1');
        if (tipTarget && dock.contains(tipTarget)) hideCustomTooltip();
      } else {
        dock.removeAttribute('data-yield');
      }
    } else {
      mascotActors.forEach((actor, idx) => {
        const item = roster[idx];
        if (!item) return;
        actor.busy = item.busy;
        actor.label = item.label;
        if (actor.el) {
          setAttrIfChanged(actor.el, 'data-busy', item.busy ? '1' : '0');
          setAttrIfChanged(actor.el, 'data-ag-ps-tip', `${item.label} · ${item.busy ? '运行中' : '待命'}`);
          setAttrIfChanged(actor.el, 'data-ag-ps-tip-status', item.busy ? 'busy' : 'idle');
        }
      });
      applyMascotSizeVars(dock, false);
      const obs = scanDockObstacles(dock);
      const { w } = getMascotDims();
      const sigChanged = obs.sig !== lastObstacleSig;
      if (sigChanged) lastObstacleSig = obs.sig;
      const anyBlocked = obs.zones.length > 0 && mascotActors.some((a) => isIntervalBlocked(a.x, w, obs.zones));
      if (obs.crowded) {
        dock.setAttribute('data-yield', '1');
        if (tipTarget && dock.contains(tipTarget)) hideCustomTooltip();
      } else if (sigChanged || anyBlocked) {
        parkActorsHome(dock, false, mascotRoamingActive, obs);
        const stillBlocked = obs.zones.length > 0 && mascotActors.some((a) => isIntervalBlocked(a.x, w, obs.zones));
        if (stillBlocked) {
          dock.setAttribute('data-yield', '1');
          if (tipTarget && dock.contains(tipTarget)) hideCustomTooltip();
        } else {
          dock.removeAttribute('data-yield');
        }
      } else {
        dock.removeAttribute('data-yield');
      }
    }
    dock.setAttribute('data-vibe', prefs.mascotVibe === 'calm' ? 'calm' : 'lively');
    syncMascotCompactGuard();

    const anyBusy = mascotActors.some((a) => a.busy);
    const now = Date.now();
    if (anyBusy) {
      mascotIdleSince = now;
      if (!wasMascotBusy) {
        mascotBusyStartedAt = now;
        mascotBusyStartLen = sampleLatestResponseLen();
        mascotFirstTokenSeen = false;
        mascotWaitingDoze = false;
        showMascotBubble(prefs.mascotRoam ? '开工啦！出发巡逻 ⚡' : '思考中… ⚡', 1800);
      } else if (!mascotFirstTokenSeen) {
        const curLen = sampleLatestResponseLen();
        if (Math.abs(curLen - mascotBusyStartLen) > 12) {
          if (mascotWaitingDoze) wakeMascotFromWait();
          else mascotFirstTokenSeen = true;
        } else if (now - mascotBusyStartedAt >= 8000 && !mascotWaitingDoze) {
          // High TTFT waiting (>8s without first token): gently doze until first token arrives
          mascotWaitingDoze = true;
          stopMascotRoaming(false);
          mascotActors.forEach((a) => {
            if (a.busy && a.el) a.el.setAttribute('data-act', 'doze');
          });
        }
      }
      dock.setAttribute('data-mood', 'busy');
      mascotActors.forEach((a) => {
        if (a.el) {
          if (!a.busy) a.el.setAttribute('data-sleep', '1');
          else a.el.removeAttribute('data-sleep');
        }
      });
      syncMascotSpeedVars(dock);
      if (!mascotWaitingDoze) syncMascotRoaming(dock);
    } else {
      mascotFirstTokenSeen = true;
      mascotWaitingDoze = false;
      if (mascotRoamingActive) {
        stopMascotRoaming(true);
      }
      mascotActors.forEach((a) => {
        a.el?.removeAttribute('data-sleep');
        if (a.el?.getAttribute('data-act') === 'doze') a.el.removeAttribute('data-act');
      });
      if (wasMascotBusy) {
        mascotCheerUntil = now + 1900 + mascotActors.length * 110;
        showMascotBubble('完成啦 ✨', 2400);
      }
      if (now < mascotCheerUntil) {
        dock.setAttribute('data-mood', 'cheer');
      } else if (now - mascotIdleSince >= 5000) {
        dock.setAttribute('data-mood', 'sleep');
      } else {
        dock.setAttribute('data-mood', 'calm');
      }
    }

    // Update lightweight status micro-emote on lead actor (O(1), no extra timers)
    const lead = mascotActors[0];
    if (lead) {
      const moodNow = dock.getAttribute('data-mood');
      const status = detectLeadStatusEmote(Boolean(busy));
      if (status.icon) {
        setActorEmote(lead, status.icon, false);
        if (status.tip && lead.el) {
          setAttrIfChanged(lead.el, 'data-ag-ps-tip', `${lead.label} · ${status.tip}`);
          setAttrIfChanged(lead.el, 'data-ag-ps-tip-status', 'busy');
        }
      } else if (moodNow === 'sleep') {
        setActorEmote(lead, 'zZ', true);
      } else {
        setActorEmote(lead, '', false);
      }
      for (let i = 1; i < mascotActors.length; i++) {
        setActorEmote(mascotActors[i], '', false);
      }
    }
    wasMascotBusy = anyBusy;
  }
  onCleanup(() => {
    stopMascotRoaming(false);
    mascotActors = [];
    lastRosterSig = '';
    lastObstacleSig = '';
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
  const thoughtBoxByTrigger = new WeakMap(); // triggerBtn -> { box, bodyEl }
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
    const tracked = triggerBtn ? thoughtBoxByTrigger.get(triggerBtn) : null;
    if (tracked) {
      if (tracked.box && tracked.box.isConnected) tracked.box.remove();
      if (tracked.bodyEl) {
        tracked.bodyEl.classList.remove('ag-ps-thought-src-dim', 'ag-ps-thought-src-hidden');
      }
      thoughtBoxByTrigger.delete(triggerBtn);
    }
    const parent = triggerBtn && triggerBtn.parentElement;
    if (!parent) return;
    parent.querySelectorAll(':scope > .ag-ps-thought-zh').forEach((n) => n.remove());
    parent.querySelectorAll('.ag-ps-thought-src-dim, .ag-ps-thought-src-hidden').forEach((n) => {
      n.classList.remove('ag-ps-thought-src-dim', 'ag-ps-thought-src-hidden');
    });
    const fallbackBody = findThoughtBody(triggerBtn);
    if (fallbackBody && fallbackBody.parentElement && fallbackBody.parentElement !== parent) {
      fallbackBody.parentElement.querySelectorAll(':scope > .ag-ps-thought-zh').forEach((n) => n.remove());
      fallbackBody.classList.remove('ag-ps-thought-src-dim', 'ag-ps-thought-src-hidden');
    }
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
    return box;
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

  function translateThoughtContainer(bodyEl, triggerBtn = null) {
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
      const box = applyThoughtDisplay(bodyEl, memo.zh, mode);
      if (triggerBtn && box) thoughtBoxByTrigger.set(triggerBtn, { box, bodyEl });
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
          const box = applyThoughtDisplay(bodyEl, res.translated, prefs.thoughtMode);
          if (triggerBtn && box) thoughtBoxByTrigger.set(triggerBtn, { box, bodyEl });
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
        thoughtBoxByTrigger.delete(trig);
        continue;
      }
      // Only defer the actively streaming last thinking block (which has no completed duration yet)
      const trigTxt = (trig.textContent || '').trim();
      const isCompleted = /\d+\s*s\b|\d+\s*秒|已思考|Thought\s+for/i.test(trigTxt);
      if (isBusy && i === triggers.length - 1 && !isCompleted) {
        const memo = thoughtTextMemo.get(bodyEl);
        if (memo && memo.zh) {
          const box = applyThoughtDisplay(bodyEl, memo.zh, prefs.thoughtMode);
          if (box) thoughtBoxByTrigger.set(trig, { box, bodyEl });
        }
        continue;
      }
      translateThoughtContainer(bodyEl, trig);
    }
  }
  onCleanup(() => {
    document.querySelectorAll('.ag-ps-thought-zh').forEach((n) => n.remove());
    document.querySelectorAll('.ag-ps-thought-src-dim, .ag-ps-thought-src-hidden').forEach((n) => {
      n.classList.remove('ag-ps-thought-src-dim', 'ag-ps-thought-src-hidden');
    });
  });

  /* ==========================================================================
   * 7. Titlebar Entry, Theme-Adaptive Tooltip, Update Capsule & v4 Event Bus
   * ========================================================================== */
  const registeredPanelSections = [];
  const busSubscribers = new Set();
  let cachedComposerEl = null;

  function getComposerEl() {
    if (cachedComposerEl && cachedComposerEl.isConnected) return cachedComposerEl;
    const inputBox = document.getElementById('antigravity.agentSidePanelInputBox');
    if (inputBox) {
      cachedComposerEl =
        inputBox.closest('[data-testid="composer-container"]') ||
        inputBox.closest('form') ||
        inputBox.parentElement ||
        inputBox;
      return cachedComposerEl;
    }
    const fallback = document.querySelector('[data-testid="composer-container"]');
    cachedComposerEl = fallback || null;
    return cachedComposerEl;
  }

  function parseRelativeResetToIso(durationText, nowMs = Date.now()) {
    const s = String(durationText || '').trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      const t = Date.parse(s);
      return Number.isFinite(t) ? new Date(t).toISOString() : '';
    }
    let totalMs = 0;
    const dayM = s.match(/(\d+(?:\.\d+)?)\s*(?:d|day|days|天)/i);
    const hourM = s.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|小时|时)/i);
    const minM = s.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes|分钟|分)/i);
    if (dayM) totalMs += Number(dayM[1]) * 86400000;
    if (hourM) totalMs += Number(hourM[1]) * 3600000;
    if (minM) totalMs += Number(minM[1]) * 60000;
    if (totalMs > 0 && Number.isFinite(totalMs)) {
      return new Date(nowMs + totalMs).toISOString();
    }
    return '';
  }

  function readAntiClaudeQuotaCache() {
    try {
      const raw = typeof localStorage === 'object' && localStorage ? localStorage.getItem(ANTI_CLAUDE_QUOTA_CACHE_KEY) : null;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.groups) || parsed.groups.length === 0) return null;

      const rawKey = String(parsed.accountKey || '').trim();
      const firstSeg = rawKey.split('|')[0].trim().toLowerCase();
      const accountEmail = firstSeg.includes('@') && firstSeg.length <= 254 ? firstSeg : '';
      const tierName = String(parsed.tierName || '').trim().slice(0, 24);
      const nowMs = Date.now();

      const detectActiveFamily = () => {
        try {
          const trig = document.querySelector('#antigravity\\.agentSidePanelInputBox button[data-testid="model-selector-trigger"], button[data-testid="model-selector-trigger"]');
          const txt = String(trig?.textContent || '').toLowerCase();
          if (/claude|sonnet|opus/i.test(txt)) return 'claude';
          if (/gpt/i.test(txt)) return 'gpt';
          if (/gemini/i.test(txt)) return 'gemini';
        } catch {}
        return '';
      };

      const families = {};
      const parsedGroups = [];
      for (const g of parsed.groups) {
        if (!g || !Array.isArray(g.buckets) || g.buckets.length === 0) continue;
        const dn = String(g.displayName || '').trim();
        let famKey = 'other';
        if (/gemini/i.test(dn)) famKey = 'gemini';
        else if (/claude/i.test(dn)) famKey = 'claude';
        else if (/gpt/i.test(dn)) famKey = 'gpt';

        let g5 = null;
        let g7 = null;
        let r5 = '';
        let r7 = '';
        for (const b of g.buckets) {
          if (!b || typeof b !== 'object') continue;
          const frac = typeof b.remainingFraction === 'number'
            ? b.remainingFraction
            : (b.remaining && typeof b.remaining.value === 'number' ? b.remaining.value : null);
          if (frac === null || !Number.isFinite(frac)) continue;
          const pct = Math.max(0, Math.min(100, Math.round(frac * 1000) / 10));
          const secRaw = b.resetTime && b.resetTime.seconds !== undefined ? Number(b.resetTime.seconds) : NaN;
          const resetMs = Number.isFinite(secRaw) && secRaw > 0 ? secRaw * 1000 : NaN;
          const resetIso = Number.isFinite(resetMs) ? new Date(resetMs).toISOString() : '';

          const win = String(b.window || b.displayName || '').trim().toLowerCase();
          let isWeekly = /week|7d|每周|周/.test(win);
          let is5h = /5h|5\s*hour|5\s*小时|short/.test(win);
          if (!isWeekly && !is5h && Number.isFinite(resetMs)) {
            if ((resetMs - nowMs) / 3600000 > 6) isWeekly = true;
            else is5h = true;
          }
          if (isWeekly) {
            if (g7 === null || pct < g7) {
              g7 = pct;
              if (resetIso) r7 = resetIso;
            }
          } else {
            if (g5 === null || pct < g5) {
              g5 = pct;
              if (resetIso) r5 = resetIso;
            }
          }
        }

        if (g5 !== null || g7 !== null) {
          parsedGroups.push({ famKey, g5, g7, r5, r7 });
          if (famKey !== 'other') {
            const cur = families[famKey] || {};
            if (g5 !== null && (cur.pct5h === undefined || g5 < cur.pct5h)) cur.pct5h = g5;
            if (g7 !== null && (cur.pct7d === undefined || g7 < cur.pct7d)) cur.pct7d = g7;
            families[famKey] = cur;
          }
        }
      }

      if (!parsedGroups.length) return null;
      const activeFam = detectActiveFamily();
      const preferred = (activeFam && parsedGroups.find((g) => g.famKey === activeFam)) || parsedGroups[0];
      const all5 = parsedGroups.map((g) => g.g5).filter((n) => typeof n === 'number');
      const all7 = parsedGroups.map((g) => g.g7).filter((n) => typeof n === 'number');
      const pct5h = preferred.g5 !== null ? preferred.g5 : (all5.length ? Math.min(...all5) : null);
      const pct7d = preferred.g7 !== null ? preferred.g7 : (all7.length ? Math.min(...all7) : null);
      const reset5hAt = preferred.r5 || (parsedGroups.find((g) => g.r5)?.r5 || '');
      const reset7dAt = preferred.r7 || (parsedGroups.find((g) => g.r7)?.r7 || '');
      const vals = [pct5h, pct7d].filter((n) => typeof n === 'number');
      const minPct = vals.length ? Math.min(...vals) : null;
      return {
        pct5h,
        pct7d,
        minPct,
        reset5hAt,
        reset7dAt,
        families: Object.keys(families).length ? families : null,
        accountEmail,
        tierName,
        observedAt: Number(parsed.ts) || nowMs
      };
    } catch {
      return null;
    }
  }

  function getQuotaState() {
    const cached = readAntiClaudeQuotaCache();
    if (cached && (typeof cached.pct5h === 'number' || typeof cached.pct7d === 'number')) {
      return cached;
    }
    let pct5h = null;
    let pct7d = null;
    let reset5hAt = '';
    let reset7dAt = '';
    try {
      const ov = document.getElementById('ag-claude-ov-sections') || document.querySelector('[data-testid="overview-panel"]');
      if (ov) {
        const txt = ov.textContent || '';
        const m5 = txt.match(/5\s*(?:小时|h)[^\d%]{0,24}(\d{1,3}(?:\.\d+)?)\s*%\s*(?:已用|used|剩余|left)?/i);
        const m7 = txt.match(/(?:每周|周限额|周额度|weekly|7d)[^\d%]{0,24}(\d{1,3}(?:\.\d+)?)\s*%\s*(?:已用|used|剩余|left)?/i);
        const toRemaining = (m) => {
          if (!m) return null;
          const v = Number(m[1]);
          if (!Number.isFinite(v)) return null;
          const isUsed = /已用|used/i.test(m[0]);
          const rem = isUsed ? 100 - v : v;
          return Math.max(0, Math.min(100, Math.round(rem * 10) / 10));
        };
        pct5h = toRemaining(m5);
        pct7d = toRemaining(m7);
        const nowMs = Date.now();
        const r5 = txt.match(/5\s*(?:小时|h)[^;\n]{0,42}?(\d+\s*(?:h|小时)(?:\s*\d+\s*(?:m|分))?|\d+\s*(?:m|分钟?))/i);
        const r7 = txt.match(/(?:每周|周限额|周额度|weekly|7d)[^;\n]{0,42}?(\d+\s*(?:d|天)(?:\s*\d+\s*(?:h|小时))?|\d+\s*(?:h|小时))/i);
        if (r5) reset5hAt = parseRelativeResetToIso(r5[1], nowMs);
        if (r7) reset7dAt = parseRelativeResetToIso(r7[1], nowMs);
      }
    } catch {}
    const vals = [pct5h, pct7d].filter((n) => typeof n === 'number');
    const minPct = vals.length ? Math.min(...vals) : null;
    return { pct5h, pct7d, minPct, reset5hAt, reset7dAt, families: null, accountEmail: '', tierName: '' };
  }

  /* ---- Sanitized Workbench Bridge (Main Window <-> Prism Files MCP App iframe) ---- */
  const ALLOWED_BRIDGE_TABS = new Set(['browse', 'artifacts', 'pins', 'search', 'accounts']);
  const bridgeSessionId = `ps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let bridgeTargetWin = null;
  let bridgeTargetOrigin = '*';
  let bridgeLastSeenAt = 0;
  let pendingWorkbenchTab = '';
  let pendingWorkbenchTabAt = 0;
  let pendingIntentId = '';
  let bridgeRetryTimers = [];
  let lastPushedQuotaSig = '';
  let lastPushedQuotaAt = 0;

  let cachedLiveQuota = (() => {
    try {
      const raw = localStorage.getItem(LIVE_QUOTA_STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p === 'object') return p;
      }
    } catch {}
    return { pct5h: null, pct7d: null, reset5hAt: '', reset7dAt: '', observedAt: 0 };
  })();

  let cachedAccountSummary = (() => {
    try {
      const raw = localStorage.getItem(ACCOUNT_SUMMARY_STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p === 'object') return p;
      }
    } catch {}
    return null;
  })();

  function clearBridgeRetryTimers() {
    while (bridgeRetryTimers.length) {
      clearTimeout(bridgeRetryTimers.pop());
    }
  }

  function isTrustedBridgeOrigin(origin) {
    const o = String(origin || '').trim();
    if (!o || o === 'null') return true; // Sandboxed srcdoc MCP App iframe
    if (o === window.location.origin) return true;
    return /^(?:app|vscode-webview|file):\/\//i.test(o) || /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(o);
  }

  function collectCandidateFrameWindows() {
    const wins = [];
    const seen = new Set();
    const pushWin = (w) => {
      if (!w || w === window || seen.has(w)) return;
      seen.add(w);
      wins.push(w);
    };
    if (bridgeTargetWin) pushWin(bridgeTargetWin);
    try {
      const frames = document.querySelectorAll('iframe');
      for (let i = 0; i < frames.length; i++) {
        const cw = frames[i].contentWindow;
        pushWin(cw);
        // Best-effort 1-level nested frame scan when same-origin
        try {
          const innerCount = cw && cw.frames ? cw.frames.length : 0;
          for (let j = 0; j < Math.min(innerCount, 6); j++) {
            pushWin(cw.frames[j]);
          }
        } catch {}
      }
    } catch {}
    return wins;
  }

  function isOwnedIframeWindow(win) {
    if (!win || win === window) return false;
    if (win === bridgeTargetWin) return true;
    const candidates = collectCandidateFrameWindows();
    if (candidates.includes(win)) return true;
    try {
      if (win.parent === window || win.top === window) return true;
    } catch {}
    return false;
  }

  function postBridgeMessage(win, payload, origin = bridgeTargetOrigin) {
    if (!win || typeof win.postMessage !== 'function') return false;
    const safeOrigin = origin && origin !== 'null' ? origin : '*';
    try {
      win.postMessage(
        Object.assign({ __agPrismBridge: 'v1', sessionId: bridgeSessionId, source: 'prism-suite', target: 'prism-files' }, payload),
        safeOrigin
      );
      return true;
    } catch {
      return false;
    }
  }

  function broadcastBridgePing() {
    const reqId = `ping-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const wins = collectCandidateFrameWindows();
    for (let i = 0; i < wins.length; i++) {
      postBridgeMessage(wins[i], { type: 'bridge-ping', requestId: reqId }, '*');
    }
  }

  function clearPendingWorkbenchNav() {
    clearBridgeRetryTimers();
    pendingIntentId = '';
    pendingWorkbenchTab = '';
    pendingWorkbenchTabAt = 0;
  }

  function dispatchSwitchTabWithRetry(targetTab) {
    if (!targetTab || !ALLOWED_BRIDGE_TABS.has(targetTab)) return;
    clearBridgeRetryTimers();
    const intentId = `nav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    pendingWorkbenchTab = targetTab;
    pendingWorkbenchTabAt = Date.now();
    pendingIntentId = intentId;

    const sendAttempt = (attempt) => {
      if (disposed || pendingIntentId !== intentId) return;
      const reqId = `${intentId}-r${attempt}`;
      if (bridgeTargetWin) {
        postBridgeMessage(bridgeTargetWin, {
          type: 'switch-tab',
          intentId,
          requestId: reqId,
          tab: targetTab,
          focus: true
        }, bridgeTargetOrigin);
      }
      // Also broadcast discovery ping + switch-tab to candidate frames on early/retry attempts so hot-reloaded or nested frames pick it up
      if (!bridgeTargetWin || attempt === 1 || attempt === 3) {
        const wins = collectCandidateFrameWindows();
        for (let i = 0; i < wins.length; i++) {
          if (wins[i] === bridgeTargetWin) continue;
          postBridgeMessage(wins[i], { type: 'bridge-ping', requestId: `p-${reqId}` }, '*');
          postBridgeMessage(wins[i], {
            type: 'switch-tab',
            intentId,
            requestId: reqId,
            tab: targetTab,
            focus: true
          }, '*');
        }
      }
    };

    const delays = [0, 100, 260, 600, 1100, 1800];
    for (let i = 0; i < delays.length; i++) {
      const idx = i;
      if (delays[i] === 0) {
        sendAttempt(0);
      } else {
        bridgeRetryTimers.push(setTimeout(() => sendAttempt(idx), delays[idx]));
      }
    }
  }

  function sanitizeQuotaPayload(q) {
    if (!q || typeof q !== 'object') return null;
    const normPct = (v) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10) / 10)) : null;
    };
    const pct5h = normPct(q.pct5h);
    const pct7d = normPct(q.pct7d);
    let families = null;
    if (q.families && typeof q.families === 'object') {
      const cleanFam = {};
      for (const fk of ['gemini', 'claude', 'gpt']) {
        const src = q.families[fk];
        if (!src || typeof src !== 'object') continue;
        const rec = {};
        const f5 = normPct(src.pct5h);
        const f7 = normPct(src.pct7d);
        if (f5 !== null) rec.pct5h = f5;
        if (f7 !== null) rec.pct7d = f7;
        if (Object.keys(rec).length) cleanFam[fk] = rec;
      }
      if (Object.keys(cleanFam).length) families = cleanFam;
    }
    if (pct5h === null && pct7d === null && !families) return null;
    const rawEmail = typeof q.accountEmail === 'string' ? q.accountEmail.trim().toLowerCase() : '';
    const accountEmail = rawEmail.includes('@') && rawEmail.length <= 254 ? rawEmail : '';
    return {
      pct5h,
      pct7d,
      reset5hAt: typeof q.reset5hAt === 'string' ? q.reset5hAt.slice(0, 40) : '',
      reset7dAt: typeof q.reset7dAt === 'string' ? q.reset7dAt.slice(0, 40) : '',
      families,
      accountEmail,
      tierName: typeof q.tierName === 'string' ? q.tierName.trim().slice(0, 24) : '',
      observedAt: Number(q.observedAt) || Date.now()
    };
  }

  function syncWorkbenchTooltip() {
    const wbBtn = document.getElementById('ag-ps-btn-workbench');
    if (!wbBtn) return;
    const parts = ['快捷打开 Prism 工作台'];
    if (cachedAccountSummary && cachedAccountSummary.activeAlias) {
      const roleTag = cachedAccountSummary.activeRole === 'primary' ? '主号' : '备号';
      parts.push(`${roleTag}: ${cachedAccountSummary.activeAlias}`);
    }
    const q = cachedLiveQuota;
    if (q && (typeof q.pct5h === 'number' || typeof q.pct7d === 'number')) {
      const qBits = [];
      if (typeof q.pct5h === 'number') qBits.push(`5h ${q.pct5h}%`);
      if (typeof q.pct7d === 'number') qBits.push(`7d ${q.pct7d}%`);
      if (qBits.length) parts.push(qBits.join(' · '));
    }
    setAttrIfChanged(wbBtn, 'data-ag-ps-tip', parts.join(' ｜ '));
  }

  function pushLiveQuotaToBridge(force = false) {
    const live = sanitizeQuotaPayload(getQuotaState());
    if (!live) return;
    cachedLiveQuota = live;
    try { localStorage.setItem(LIVE_QUOTA_STORAGE_KEY, JSON.stringify(live)); } catch {}
    syncWorkbenchTooltip();
    const famSig = live.families
      ? Object.entries(live.families).map(([k, v]) => `${k}:${v.pct5h ?? ''}/${v.pct7d ?? ''}`).join(',')
      : '';
    const sig = `${live.accountEmail || ''}|${live.pct5h ?? ''}|${live.pct7d ?? ''}|${live.reset5hAt.slice(0, 16)}|${live.reset7dAt.slice(0, 16)}|${famSig}`;
    const now = Date.now();
    if (!force && sig === lastPushedQuotaSig && now - lastPushedQuotaAt < 60000) return;
    lastPushedQuotaSig = sig;
    lastPushedQuotaAt = now;
    if (bridgeTargetWin) {
      if (!postBridgeMessage(bridgeTargetWin, { type: 'quota-sync', quota: live })) {
        bridgeTargetWin = null;
      }
    }
  }

  function onWorkbenchBridgeMessage(event) {
    if (disposed) return;
    const data = event && event.data;
    if (!data || typeof data !== 'object' || data.__agPrismBridge !== 'v1') return;
    if (!isTrustedBridgeOrigin(event.origin)) return;
    const src = event.source;
    if (!src || src === window) return;
    if (data.source && data.source !== 'prism-files') return;
    const replyOrigin = event.origin && event.origin !== 'null' ? event.origin : '*';

    if (data.type === 'ready' || data.type === 'bridge-pong') {
      if (!isOwnedIframeWindow(src)) return;
      bridgeTargetWin = src;
      bridgeTargetOrigin = replyOrigin;
      bridgeLastSeenAt = Date.now();
      const liveNow = sanitizeQuotaPayload(getQuotaState()) || (cachedLiveQuota && (cachedLiveQuota.pct5h !== null || cachedLiveQuota.pct7d !== null) ? cachedLiveQuota : null);
      const wantTab =
        pendingWorkbenchTab && Date.now() - pendingWorkbenchTabAt < 8000 && ALLOWED_BRIDGE_TABS.has(pendingWorkbenchTab)
          ? pendingWorkbenchTab
          : '';
      postBridgeMessage(src, {
        type: 'init-sync',
        switchTab: wantTab,
        intentId: wantTab ? (pendingIntentId || `init-${Date.now().toString(36)}`) : '',
        focus: Boolean(wantTab),
        quota: liveNow
      }, replyOrigin);
      return;
    }

    if (data.type === 'ack') {
      if (!isOwnedIframeWindow(src)) return;
      bridgeTargetWin = src;
      bridgeTargetOrigin = replyOrigin;
      bridgeLastSeenAt = Date.now();
      if (data.ok && pendingIntentId && data.intentId === pendingIntentId) {
        pendingIntentId = '';
        pendingWorkbenchTab = '';
        pendingWorkbenchTabAt = 0;
        clearBridgeRetryTimers();
      }
      return;
    }

    if (data.type === 'account-summary' && data.summary && typeof data.summary === 'object') {
      if (!isOwnedIframeWindow(src)) return;
      bridgeTargetWin = src;
      bridgeTargetOrigin = replyOrigin;
      bridgeLastSeenAt = Date.now();
      const s = data.summary;
      cachedAccountSummary = {
        enabled: Boolean(s.enabled),
        activeAlias: String(s.activeAlias || '').trim().slice(0, 32),
        activeEmail: String(s.activeEmail || '').trim().slice(0, 64),
        activeRole: s.activeRole === 'primary' ? 'primary' : (s.activeRole === 'backup' ? 'backup' : ''),
        accountCount: Math.max(0, Math.min(99, Number(s.accountCount) || 0)),
        pendingSwitchEmail: String(s.pendingSwitchEmail || '').trim().slice(0, 64),
        updatedAt: Date.now()
      };
      try { localStorage.setItem(ACCOUNT_SUMMARY_STORAGE_KEY, JSON.stringify(cachedAccountSummary)); } catch {}
      syncWorkbenchTooltip();
      const pop = document.getElementById('ag-ps-popover');
      if (pop && pop.getAttribute('data-open') === '1') {
        renderPopoverContent(pop);
      }
    }
  }
  window.addEventListener('message', onWorkbenchBridgeMessage);
  onCleanup(() => {
    window.removeEventListener('message', onWorkbenchBridgeMessage);
    clearBridgeRetryTimers();
    bridgeTargetWin = null;
  });
  setTimeout(() => { if (!disposed) broadcastBridgePing(); }, 450);

  function emitBus(type) {
    if (disposed) return;
    const payload = {
      type,
      prefs: Object.assign({}, prefs),
      busy: isAgentGenerating(),
      dark: isCurrentlyDark(),
      path: window.location.pathname
    };
    for (const fn of busSubscribers) {
      try { fn(payload); } catch {}
    }
  }

  function setPref(key, val) {
    if (!key) return;
    if (prefs[key] === val) return;
    prefs[key] = val;
    savePrefs();
    emitBus('prefs');
    const pop = document.getElementById('ag-ps-popover');
    if (pop && pop.getAttribute('data-open') === '1') {
      renderPopoverContent(pop);
    }
  }

  function buildBusHelpers() {
    return {
      prefs: Object.assign({}, prefs),
      getPrefs: () => Object.assign({}, prefs),
      setPref,
      refreshPopover: () => {
        const pop = document.getElementById('ag-ps-popover');
        if (pop && pop.getAttribute('data-open') === '1') renderPopoverContent(pop);
      },
      showToast: showJumpToast,
      isDark: isCurrentlyDark,
      isBusy: isAgentGenerating,
      escapeHtml
    };
  }

  /* ---- GitHub Release Update Checker (on-demand only, zero auto network calls) ---- */
  let updateState = { status: 'idle', latest: '', url: REPO_RELEASES_URL };

  function compareSemver(a, b) {
    const pa = String(a || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
  }

  async function checkGithubUpdate() {
    if (updateState.status === 'checking') return;
    updateState = { status: 'checking', latest: '', url: REPO_RELEASES_URL };
    const pop = document.getElementById('ag-ps-popover');
    if (pop && pop.getAttribute('data-open') === '1') renderPopoverContent(pop);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000);
      const res = await fetch(REPO_RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (disposed) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (disposed) return;
      const tag = String(data.tag_name || '').trim();
      const url = typeof data.html_url === 'string' && /^https:\/\/github\.com\//.test(data.html_url) ? data.html_url : REPO_RELEASES_URL;
      if (tag && compareSemver(tag, SUITE_VERSION) > 0) {
        updateState = { status: 'available', latest: tag, url };
        showJumpToast(`发现新版本 ${tag}，可前往 Releases 下载更新`);
      } else {
        updateState = { status: 'latest', latest: tag || `v${SUITE_VERSION}`, url };
        showJumpToast(`当前已是最新版本 v${SUITE_VERSION}`);
      }
    } catch {
      if (disposed) return;
      updateState = { status: 'error', latest: '', url: REPO_RELEASES_URL };
      showJumpToast('检查更新失败，请稍后再试');
    }
    if (disposed) return;
    const p2 = document.getElementById('ag-ps-popover');
    if (p2 && p2.getAttribute('data-open') === '1') renderPopoverContent(p2);
  }

  /* ---- Pointer-Safe Theme-Adaptive Custom Tooltip Engine (data-ag-ps-tip) ---- */
  let tipEl = null;
  let tipTarget = null;

  function ensureTooltipEl() {
    if (tipEl && tipEl.isConnected) return tipEl;
    tipEl = document.createElement('div');
    tipEl.id = 'ag-ps-tooltip';
    tipEl.setAttribute('role', 'tooltip');
    tipEl.setAttribute('data-ag-i18n-ignore', '1');
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function hideCustomTooltip() {
    tipTarget = null;
    if (tipEl) tipEl.removeAttribute('data-show');
  }

  function showCustomTooltip(target, evt) {
    if (disposed || !target) return;
    const text = target.getAttribute('data-ag-ps-tip');
    if (!text) return;
    tipTarget = target;
    const el = ensureTooltipEl();
    const status = target.getAttribute('data-ag-ps-tip-status') || '';
    el.textContent = '';
    if (status === 'busy' || status === 'idle') {
      const dot = document.createElement('span');
      dot.className = 'ag-ps-tip-dot';
      dot.setAttribute('data-status', status);
      el.appendChild(dot);
    }
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    el.setAttribute('data-show', '1');

    const r = target.getBoundingClientRect();
    const tw = el.offsetWidth || 140;
    const th = el.offsetHeight || 28;
    const isMascot = target.classList.contains('ag-ps-actor');
    const clearance = isMascot ? 16 : 12;

    let left = Math.round(r.left + r.width / 2 - tw / 2);
    left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));

    // Strictly prefer ABOVE target so the OS pointer below never obscures text
    let top = Math.round(r.top - th - clearance);
    let place = 'top';
    if (top < 8) {
      top = Math.round(r.bottom + 14);
      place = 'bottom';
      if (evt && typeof evt.clientY === 'number' && top <= evt.clientY + 18) {
        top = Math.min(window.innerHeight - th - 8, Math.round(evt.clientY + 22));
      }
    } else if (evt && typeof evt.clientY === 'number' && top + th > evt.clientY - 12) {
      top = Math.max(8, Math.round(evt.clientY - th - 16));
    }

    el.setAttribute('data-place', place);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function onTipOver(e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-ag-ps-tip]') : null;
    if (t && t !== tipTarget) showCustomTooltip(t, e);
  }
  function onTipOut(e) {
    if (!tipTarget) return;
    const rel = e.relatedTarget;
    if (!rel || !tipTarget.contains(rel)) hideCustomTooltip();
  }
  document.addEventListener('mouseover', onTipOver, true);
  document.addEventListener('mouseout', onTipOut, true);
  document.addEventListener('focusin', onTipOver, true);
  document.addEventListener('focusout', hideCustomTooltip, true);
  document.addEventListener('scroll', hideCustomTooltip, true);
  onCleanup(() => {
    document.removeEventListener('mouseover', onTipOver, true);
    document.removeEventListener('mouseout', onTipOut, true);
    document.removeEventListener('focusin', onTipOver, true);
    document.removeEventListener('focusout', hideCustomTooltip, true);
    document.removeEventListener('scroll', hideCustomTooltip, true);
    if (tipEl) tipEl.remove();
    tipEl = null;
  });

  function renderPopoverContent(pop) {
    const darkNow = isCurrentlyDark();
    const helpers = buildBusHelpers();
    const extraSectionsHtml = registeredPanelSections
      .slice()
      .sort((a, b) => (a.order || 50) - (b.order || 50))
      .map((sec) => {
        let body = '';
        try { body = String(sec.render ? sec.render(helpers.prefs, helpers) : ''); } catch {}
        if (!body) return '';
        return `<div class="ag-ps-ext-section" data-ext-sec="${escapeHtml(sec.id)}">
          ${sec.title ? `<div class="ag-ps-sec-lbl"><span>${escapeHtml(sec.title)}</span></div>` : ''}
          ${body}
        </div>`;
      })
      .join('');
    const updateBtnText =
      updateState.status === 'checking'
        ? '检查中…'
        : updateState.status === 'available'
          ? `新版本 ${escapeHtml(updateState.latest)} ↗`
          : updateState.status === 'latest'
            ? '已是最新 ✓'
            : updateState.status === 'error'
              ? '重试检查'
              : '检查更新';
    const liveQ = sanitizeQuotaPayload(getQuotaState()) || cachedLiveQuota;
    const accSum = cachedAccountSummary;
    const shortEmail = (em) => {
      const s = String(em || '').trim();
      if (!s) return '';
      const at = s.indexOf('@');
      if (at <= 0) return s.slice(0, 16);
      const local = s.slice(0, at);
      return local.length > 12 ? `${local.slice(0, 10)}…` : local;
    };
    const accTitle = accSum?.activeAlias
      ? `${accSum.activeRole === 'primary' ? '★ ' : ''}${accSum.activeAlias}${accSum.activeEmail ? ` · ${shortEmail(accSum.activeEmail)}` : ''}`
      : (accSum?.activeEmail ? shortEmail(accSum.activeEmail) : '多账号安全接力');
    const quotaChips = [];
    if (liveQ && typeof liveQ.pct5h === 'number') {
      const tier5 = liveQ.pct5h >= 50 ? 'ok' : liveQ.pct5h >= 20 ? 'warn' : 'danger';
      quotaChips.push(`<span class="ag-ps-qchip" data-tier="${tier5}">5h ${liveQ.pct5h}%</span>`);
    }
    if (liveQ && typeof liveQ.pct7d === 'number') {
      const tier7 = liveQ.pct7d >= 50 ? 'ok' : liveQ.pct7d >= 20 ? 'warn' : 'danger';
      quotaChips.push(`<span class="ag-ps-qchip" data-tier="${tier7}">7d ${liveQ.pct7d}%</span>`);
    }
    const accSubHtml = accSum?.pendingSwitchEmail
      ? `<span class="ag-ps-qchip" data-tier="warn">待重启切至 ${escapeHtml(shortEmail(accSum.pendingSwitchEmail))}</span>`
      : (quotaChips.length
        ? quotaChips.join('')
        : `<span class="ag-ps-toggle-sub">${accSum?.accountCount ? `已捕获 ${accSum.accountCount} 个账号` : '打开工作台同步主备账号与额度'}</span>`);

    pop.innerHTML = `
      <div class="ag-ps-pop-hdr">
        <span class="ag-ps-pop-title">✦ 棱镜扩展套件</span>
        <span style="display:inline-flex;align-items:center;gap:6px;">
          <button type="button" class="ag-ps-mini-reset" data-open-workbench="1" title="快捷打开 Prism 工作台（文件 / 历史检索 / 账号接力）">工作台 ↗</button>
          <span class="ag-ps-pop-meta">${darkNow ? '深色模式' : '浅色模式'} · v${SUITE_VERSION}</span>
        </span>
      </div>

      <div class="ag-ps-account-bar">
        <div class="ag-ps-account-info">
          <div class="ag-ps-account-name">
            <span class="ag-ps-account-dot" data-online="${accSum?.activeEmail ? '1' : '0'}" aria-hidden="true"></span>
            <span class="ag-ps-account-text">${escapeHtml(accTitle)}</span>
          </div>
          <div class="ag-ps-account-meta">${accSubHtml}</div>
        </div>
        <button type="button" class="ag-ps-account-cta" data-open-workbench-tab="accounts" title="打开 Prism 工作台并直达「账号接力」页签">⚡ 切号</button>
      </div>

      <div class="ag-ps-sec-lbl"><span>浅色配色</span><span class="ag-ps-sec-tag">${!darkNow ? '当前生效' : '浅色首选'}</span></div>
      <div class="ag-ps-palette-row">
        <button type="button" class="ag-ps-pal-btn" data-set-light="default" data-selected="${prefs.lightPalette === 'default' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:linear-gradient(135deg,#FFFFFF 52%,#2F75C3 52%)"></span>纯白默认</button>
        <button type="button" class="ag-ps-pal-btn" data-set-light="crystal" data-selected="${prefs.lightPalette === 'crystal' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:linear-gradient(135deg,#E8EEF6 52%,#2563EB 52%)"></span>白昼冷晶</button>
        <button type="button" class="ag-ps-pal-btn" data-set-light="alabaster" data-selected="${prefs.lightPalette === 'alabaster' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:linear-gradient(135deg,#F1ECE2 52%,#B45309 52%)"></span>暖白画册</button>
        <button type="button" class="ag-ps-pal-btn" data-set-light="sage" data-selected="${prefs.lightPalette === 'sage' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:linear-gradient(135deg,#E6EFE9 52%,#15803D 52%)"></span>松雾青岚</button>
      </div>

      <div class="ag-ps-sec-lbl"><span>深色配色</span><span class="ag-ps-sec-tag">${darkNow ? '当前生效' : '深色首选'}</span></div>
      <div class="ag-ps-palette-row">
        <button type="button" class="ag-ps-pal-btn" data-set-dark="default" data-selected="${prefs.darkPalette === 'default' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:linear-gradient(135deg,#212120 52%,#60A5FA 52%)"></span>暖炭默认</button>
        <button type="button" class="ag-ps-pal-btn" data-set-dark="obsidian" data-selected="${prefs.darkPalette === 'obsidian' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:linear-gradient(135deg,#09090B 52%,#3B82F6 52%)"></span>深空黑曜</button>
        <button type="button" class="ag-ps-pal-btn" data-set-dark="basalt" data-selected="${prefs.darkPalette === 'basalt' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:linear-gradient(135deg,#141312 52%,#D97706 52%)"></span>暖炭玄岩</button>
        <button type="button" class="ag-ps-pal-btn" data-set-dark="marine" data-selected="${prefs.darkPalette === 'marine' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:linear-gradient(135deg,#0B1220 52%,#38BDF8 52%)"></span>深海墨蓝</button>
      </div>

      <div class="ag-ps-sec-lbl"><span>增强功能</span></div>
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
            ? `<div class="ag-ps-subpanel">
                <div class="ag-ps-toggle-row">
                  <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">数量${prefs.mascotCountMode === 'agents' ? `（1 主控 + ${getLiveSubagents().length} 活跃）` : ''}</span></div>
                  <div class="ag-ps-seg-group">
                    <button type="button" class="ag-ps-seg-btn" data-mascot-count-mode="fixed" data-selected="${prefs.mascotCountMode === 'fixed' ? '1' : '0'}">固定</button>
                    <button type="button" class="ag-ps-seg-btn" data-mascot-count-mode="agents" data-selected="${prefs.mascotCountMode === 'agents' ? '1' : '0'}">跟随 Agent</button>
                  </div>
                </div>
                ${
                  prefs.mascotCountMode === 'fixed'
                    ? `<div class="ag-ps-toggle-row">
                        <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">样式</span></div>
                        <div class="ag-ps-seg-group">
                          <button type="button" class="ag-ps-seg-btn" data-mascot-style="trio" data-selected="${prefs.mascotStyle === 'trio' ? '1' : '0'}">三萌</button>
                          <button type="button" class="ag-ps-seg-btn" data-mascot-style="crab" data-selected="${prefs.mascotStyle === 'crab' ? '1' : '0'}">橘蟹</button>
                          <button type="button" class="ag-ps-seg-btn" data-mascot-style="cat" data-selected="${prefs.mascotStyle === 'cat' ? '1' : '0'}">紫猫</button>
                        </div>
                      </div>`
                    : `<div class="ag-ps-toggle-row">
                        <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">保底数量</span></div>
                        <div class="ag-ps-seg-group">
                          <button type="button" class="ag-ps-seg-btn" data-mascot-min-count="1" data-selected="${clampMascotMinCount(prefs.mascotMinCount) === 1 ? '1' : '0'}">1只</button>
                          <button type="button" class="ag-ps-seg-btn" data-mascot-min-count="2" data-selected="${clampMascotMinCount(prefs.mascotMinCount) === 2 ? '1' : '0'}">2只</button>
                          <button type="button" class="ag-ps-seg-btn" data-mascot-min-count="3" data-selected="${clampMascotMinCount(prefs.mascotMinCount) === 3 ? '1' : '0'}">3只</button>
                        </div>
                      </div>`
                }
                <div class="ag-ps-toggle-row">
                  <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">工作态漫游跑跳</span></div>
                  <button type="button" class="ag-ps-switch" data-toggle="mascotRoam" data-on="${prefs.mascotRoam ? '1' : '0'}"></button>
                </div>
                <div class="ag-ps-toggle-row">
                  <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">性格</span></div>
                  <div class="ag-ps-seg-group">
                    <button type="button" class="ag-ps-seg-btn" data-mascot-vibe="calm" data-selected="${prefs.mascotVibe === 'calm' ? '1' : '0'}">温顺</button>
                    <button type="button" class="ag-ps-seg-btn" data-mascot-vibe="lively" data-selected="${prefs.mascotVibe !== 'calm' ? '1' : '0'}">活泼</button>
                  </div>
                </div>
                <div class="ag-ps-toggle-row">
                  <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">大小</span></div>
                  <div class="ag-ps-range-wrap">
                    <input type="range" class="ag-ps-range" data-mascot-size="1" min="${MASCOT_SIZE_MIN}" max="${MASCOT_SIZE_MAX}" step="2" value="${clampMascotSize(prefs.mascotSize)}" aria-label="像素伙伴大小" />
                    <span class="ag-ps-range-val" data-mascot-size-val="1">${clampMascotSize(prefs.mascotSize)}px</span>
                    <button type="button" class="ag-ps-mini-reset" data-mascot-size-reset="1" ${clampMascotSize(prefs.mascotSize) === MASCOT_SIZE_DEFAULT ? 'disabled' : ''}>复位</button>
                  </div>
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
      ${extraSectionsHtml}
      <div class="ag-ps-about-bar">
        <span class="ag-ps-about-ver">Prism Suite v${SUITE_VERSION}</span>
        ${
          updateState.status === 'available'
            ? `<a class="ag-ps-update-pill" data-update-link="1" href="${escapeHtml(updateState.url)}" target="_blank" rel="noopener noreferrer">${updateBtnText}</a>`
            : `<button type="button" class="ag-ps-update-pill" data-check-update="1" ${updateState.status === 'checking' ? 'disabled' : ''}>${updateBtnText}</button>`
        }
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
      const chkUpd = e.target.closest('[data-check-update]');
      if (chkUpd) {
        e.preventDefault();
        checkGithubUpdate();
        return;
      }
      const extSecEl = e.target.closest('[data-ext-sec]');
      if (extSecEl) {
        const secId = extSecEl.getAttribute('data-ext-sec');
        const sec = registeredPanelSections.find((s) => s.id === secId);
        if (sec && typeof sec.onClick === 'function') {
          try {
            if (sec.onClick(e, buildBusHelpers()) === true) return;
          } catch {}
        }
      }
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
          if (disposed) return;
          syncUsageExtraMount();
          const card = document.querySelector('#ag-claude-ov-sections [data-ov-card="usage"]');
          if (card) {
            card.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'center' });
            card.classList.remove('ag-ps-turn-pulse');
            void card.offsetWidth;
            card.classList.add('ag-ps-turn-pulse');
            setTimeout(() => {
              if (!disposed) card.classList.remove('ag-ps-turn-pulse');
            }, 1500);
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
        emitBus('theme');
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
        emitBus('theme');
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
        emitBus('prefs');
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
      const mv = e.target.closest('[data-mascot-vibe]');
      if (mv) {
        prefs.mascotVibe = mv.getAttribute('data-mascot-vibe') === 'calm' ? 'calm' : 'lively';
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
      const wbTabBtn = e.target.closest('[data-open-workbench-tab]');
      if (wbTabBtn) {
        const targetTab = wbTabBtn.getAttribute('data-open-workbench-tab') || 'accounts';
        togglePopover(false);
        openPrismWorkbenchQuick(targetTab);
        return;
      }
      const wbBtn = e.target.closest('[data-open-workbench]');
      if (wbBtn) {
        togglePopover(false);
        openPrismWorkbenchQuick();
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
      const extSecEl = e.target.closest('[data-ext-sec]');
      if (extSecEl) {
        const sec = registeredPanelSections.find((s) => s.id === extSecEl.getAttribute('data-ext-sec'));
        if (sec && typeof sec.onInput === 'function') {
          try { sec.onInput(e, buildBusHelpers()); } catch {}
          return;
        }
      }
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
      const extSecEl = e.target.closest('[data-ext-sec]');
      if (extSecEl) {
        const sec = registeredPanelSections.find((s) => s.id === extSecEl.getAttribute('data-ext-sec'));
        if (sec && typeof sec.onChange === 'function') {
          try { sec.onChange(e, buildBusHelpers()); } catch {}
          return;
        }
      }
      const slider = e.target.closest('[data-mascot-size]');
      if (!slider) return;
      const sz = clampMascotSize(slider.value);
      prefs.mascotSize = sz;
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

  let workbenchOpening = false;

  function findWorkbenchEntry(root = document, { skipSidebar = false } = {}) {
    if (!root || !root.querySelectorAll) return null;
    const candidates = root.querySelectorAll('button, a, [role="tab"], [role="button"], [role="menuitem"]');
    for (const el of candidates) {
      if (!el.isConnected || el.closest('#ag-ps-popover, #ag-ps-outline, [data-testid="autoscroll-viewport"]')) continue;
      if (el.id === 'ag-ps-btn-workbench' || el.id === 'ag-ps-btn-suite' || el.id === 'ag-ps-btn-outline') continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (skipSidebar && !el.closest('[role="menu"], [data-radix-popper-content-wrapper]') && (el.closest('aside, nav, [data-testid*="sidebar" i]') || r.left < 280)) {
        continue;
      }
      const txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      const aria = String(el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
      if ((txt.length <= 28 && /Prism\s*(?:工作台|文件)/i.test(txt)) || /Prism\s*(?:工作台|文件)/i.test(aria)) {
        return el;
      }
    }
    return null;
  }

  function triggerRadixTrigger(el) {
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch {}
    try {
      if (typeof PointerEvent === 'function') {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }));
      }
    } catch {}
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    } catch {}
    try { el.click(); } catch {}
  }

  function hoverAndClickMenuItem(el) {
    if (!el) return;
    for (const type of ['pointerenter', 'pointermove', 'mouseover', 'mouseenter']) {
      try {
        const Evt = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Evt(type, { bubbles: true, cancelable: true }));
      } catch {}
    }
    try { el.focus({ preventScroll: true }); } catch {}
    try { el.click(); } catch {}
  }

  function findMoreToolbarButton(toolbar) {
    if (!toolbar) return null;
    const menuBtn = toolbar.querySelector('button[aria-haspopup="menu"]:not(.ag-ps-tb-btn)');
    if (menuBtn) return menuBtn;
    const buttons = Array.from(toolbar.querySelectorAll('button')).filter(
      (b) => b.isConnected && !b.classList.contains('ag-ps-tb-btn') && b.getAttribute('data-testid') !== 'toggle-overview-panel'
    );
    const tagged = buttons.find((b) => {
      const lbl = `${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`;
      return /more|更多|menu|菜单|action|选项/i.test(lbl);
    });
    return tagged || buttons[0] || null;
  }

  function trySidebarFallback() {
    const fallback = findWorkbenchEntry(document, { skipSidebar: false });
    if (!fallback) return false;
    const isAlreadyHere =
      fallback.getAttribute('aria-current') === 'page' ||
      fallback.getAttribute('data-active') === 'true' ||
      (!document.querySelector('[data-testid="autoscroll-viewport"]') && !document.getElementById('antigravity.agentSidePanelInputBox'));
    if (isAlreadyHere) {
      showJumpToast('当前已在 Prism 工作台');
      return true;
    }
    triggerRadixTrigger(fallback);
    return true;
  }

  function openPrismWorkbenchQuick(targetTab = '') {
    const wantTab = targetTab && ALLOWED_BRIDGE_TABS.has(targetTab) ? targetTab : '';
    if (wantTab) {
      dispatchSwitchTabWithRetry(wantTab);
    } else {
      // Opening the workbench from general buttons must not inherit a stale account-switch intent
      clearPendingWorkbenchNav();
    }
    // 1. Prioritize already-open right-side aux pane tab (skipping left global sidebar)
    const rightTab = findWorkbenchEntry(document, { skipSidebar: true });
    if (rightTab) {
      triggerRadixTrigger(rightTab);
      if (wantTab) {
        // Re-ping after aux pane becomes visible so focus + tab switch completes even if pane was hidden/unmounted
        bridgeRetryTimers.push(setTimeout(() => {
          if (!disposed && pendingIntentId) broadcastBridgePing();
        }, 160));
      }
      return true;
    }
    if (workbenchOpening) return false;
    const toolbar = document.querySelector('[data-testid="pane-titlebar-toolbar"]');
    const moreBtn = findMoreToolbarButton(toolbar);
    if (!moreBtn) {
      if (!trySidebarFallback()) {
        showJumpToast('请在右侧栏点「+」或「⋮ → 扩展插件」打开「Prism 工作台」');
      }
      return false;
    }
    workbenchOpening = true;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      try {
        // 2. Open via native toolbar menu (⋮ -> 扩展插件 -> Prism 工作台) for side-by-side aux pane
        triggerRadixTrigger(moreBtn);
        let subTrigger = null;
        for (let i = 0; i < 6; i++) {
          await sleep(60);
          if (disposed) return;
          const menus = document.querySelectorAll('[role="menu"], [data-radix-popper-content-wrapper]');
          for (const m of menus) {
            const directItem = findWorkbenchEntry(m, { skipSidebar: false });
            if (directItem) {
              directItem.click();
              return;
            }
            const items = m.querySelectorAll('[role="menuitem"], button');
            for (const it of items) {
              const t = String(it.textContent || '').replace(/\s+/g, ' ').trim();
              if (/扩展插件|Plugins|Extensions/i.test(t)) {
                subTrigger = it;
                break;
              }
            }
            if (subTrigger) break;
          }
          if (subTrigger) break;
        }
        if (subTrigger) {
          hoverAndClickMenuItem(subTrigger);
          for (let j = 0; j < 7; j++) {
            await sleep(65);
            if (disposed) return;
            const menus = document.querySelectorAll('[role="menu"], [data-radix-popper-content-wrapper]');
            for (const m of menus) {
              const target = findWorkbenchEntry(m, { skipSidebar: false });
              if (target) {
                target.click();
                return;
              }
            }
          }
        }
        try {
          (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        } catch {}
        if (!disposed) {
          // 3. Fallback to left sidebar global view only if aux pane menu didn't have it
          if (!trySidebarFallback()) {
            showJumpToast('未检测到已启用的 Prism 工作台入口，请先在 Plugins Manager 确认已启用');
          }
        }
      } finally {
        workbenchOpening = false;
      }
    })();
    return true;
  }

  function syncToolbarButtons() {
    const toolbar = document.querySelector('[data-testid="pane-titlebar-toolbar"]');
    if (!toolbar) return;

    let wbBtn = document.getElementById('ag-ps-btn-workbench');
    if (!wbBtn || wbBtn.parentElement !== toolbar) {
      if (wbBtn) wbBtn.remove();
      wbBtn = document.createElement('button');
      wbBtn.id = 'ag-ps-btn-workbench';
      wbBtn.type = 'button';
      wbBtn.className = 'ag-ps-tb-btn';
      wbBtn.setAttribute('data-ag-i18n-ignore', '1');
      wbBtn.setAttribute('data-ag-ps-tip', '快捷打开 Prism 工作台（文件 / 历史检索 / 账号接力 / 上游雷达）');
      wbBtn.textContent = '工作台';
      wbBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPrismWorkbenchQuick();
      });
      toolbar.insertBefore(wbBtn, toolbar.firstChild);
    }

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
    document.getElementById('ag-ps-btn-workbench')?.remove();
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
  let lastDarkState = isCurrentlyDark();
  function tickAll() {
    if (disposed || document.hidden) return;
    // Detect SPA conversation switch and close stale outline drawer
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      cachedComposerEl = null;
      const drawer = document.getElementById('ag-ps-outline');
      if (drawer && drawer.getAttribute('data-open') === '1') {
        renderOutlineList('');
      }
      emitBus('route');
    }
    const darkNow = isCurrentlyDark();
    if (darkNow !== lastDarkState) {
      lastDarkState = darkNow;
      emitBus('theme');
    }
    const busy = isAgentGenerating();
    syncStreamObserver(busy);
    // Defer non-urgent DOM scans while user is actively typing in composer
    if (isUserActivelyTyping() && !busy) return;
    syncToolbarButtons();
    syncWorkbenchTooltip();
    syncMascotDock(busy);
    ensureOverviewObserver();
    syncUsageExtraMount();
    syncThoughtBlocks(busy);
    pushLiveQuotaToBridge(false);
    emitBus('tick');
  }

  function onVisibilityChange() {
    if (disposed) return;
    if (document.hidden) {
      detachStreamObserver();
      clearInkHighlights();
      stopMascotRoaming(false);
      emitBus('visibility');
    } else {
      emitBus('visibility');
      tickAll();
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  onCleanup(() => document.removeEventListener('visibilitychange', onVisibilityChange));

  /* ---- Publish Versioned Event Bus (window.__agPrismBus v4) ---- */
  const prismBus = {
    version: 4,
    suiteVersion: SUITE_VERSION,
    getPrefs: () => Object.assign({}, prefs),
    registerDefaults(defaultsObj) {
      if (!defaultsObj || typeof defaultsObj !== 'object') return;
      let changed = false;
      for (const [k, v] of Object.entries(defaultsObj)) {
        if (!(k in prefs)) {
          prefs[k] = v;
          changed = true;
        }
      }
      if (changed) emitBus('prefs');
    },
    setPref,
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      busSubscribers.add(fn);
      return () => busSubscribers.delete(fn);
    },
    registerPanelSection(spec) {
      if (!spec || !spec.id) return;
      const idx = registeredPanelSections.findIndex((s) => s.id === spec.id);
      if (idx >= 0) registeredPanelSections[idx] = spec;
      else registeredPanelSections.push(spec);
      const pop = document.getElementById('ag-ps-popover');
      if (pop && pop.getAttribute('data-open') === '1') renderPopoverContent(pop);
    },
    unregisterPanelSection(id) {
      if (!id) return;
      const idx = registeredPanelSections.findIndex((s) => s.id === id);
      if (idx >= 0) {
        registeredPanelSections.splice(idx, 1);
        const pop = document.getElementById('ag-ps-popover');
        if (pop && pop.getAttribute('data-open') === '1') renderPopoverContent(pop);
      }
    },
    registerOutlineAction(spec) {
      if (!spec || !spec.id) return;
      const idx = registeredOutlineActions.findIndex((a) => a.id === spec.id);
      if (idx >= 0) registeredOutlineActions[idx] = spec;
      else registeredOutlineActions.push(spec);
    },
    unregisterOutlineAction(id) {
      if (!id) return;
      const idx = registeredOutlineActions.findIndex((a) => a.id === id);
      if (idx >= 0) registeredOutlineActions.splice(idx, 1);
    },
    isBusy: isAgentGenerating,
    isDark: isCurrentlyDark,
    isTyping: isUserActivelyTyping,
    getComposerEl,
    getViewportEl: () => document.querySelector('[data-testid="autoscroll-viewport"]'),
    getThemeAccent,
    getQuotaState,
    openWorkbench: openPrismWorkbenchQuick,
    showToast: showJumpToast,
    refreshPopover: () => {
      const pop = document.getElementById('ag-ps-popover');
      if (pop && pop.getAttribute('data-open') === '1') renderPopoverContent(pop);
    },
    setAttrIfChanged,
    setStyleVarIfChanged,
    onCleanup
  };
  window.__agPrismBus = prismBus;
  const attachedInitFns = new Set();
  if (window.__agPrismModules && typeof window.__agPrismModules === 'object') {
    for (const initFn of Object.values(window.__agPrismModules)) {
      if (typeof initFn === 'function' && !attachedInitFns.has(initFn)) {
        attachedInitFns.add(initFn);
        try { initFn(prismBus); } catch {}
      }
    }
  }
  if (Array.isArray(window.__agPrismBusQueue)) {
    const queued = window.__agPrismBusQueue.splice(0, window.__agPrismBusQueue.length);
    for (const initFn of queued) {
      if (typeof initFn === 'function' && !attachedInitFns.has(initFn)) {
        attachedInitFns.add(initFn);
        try { initFn(prismBus); } catch {}
      }
    }
  }
  onCleanup(() => {
    busSubscribers.clear();
    if (window.__agPrismBus === prismBus) {
      try { delete window.__agPrismBus; } catch { window.__agPrismBus = null; }
    }
  });

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
