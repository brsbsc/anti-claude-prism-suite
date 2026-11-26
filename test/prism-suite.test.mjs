import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installExtensions, installPlugin, installAll } from '../install.mjs';
import { uninstallExtensions, uninstallPlugin, uninstallAll } from '../uninstall.mjs';
import { inspectLocalDaemon } from '../scripts/check-upstream.mjs';
import {
  createPrismFilesServer,
  fallbackLinuxToWindowsPath,
  isSensitivePath,
  buildWindowsExplorerArgs,
  buildWslExplorerArgs,
  isPrivateOrLocalIp,
  validateLanUncPath,
  parseLineCol,
  hasWindowsBatchMeta,
  redactSensitiveText,
  searchTranscripts,
  APP_URI,
  INLINE_URI,
  APP_MIME_TYPE
} from '../plugin/server/index.mjs';
import {
  extractCredentialEmail,
  sanitizeAccountId,
  createAccountVault,
  resolveSafeExecCwd,
  resolveWslInteropEnv,
  cleanPowerShellError
} from '../plugin/server/account-vault.mjs';
import { createAccountManager, parseQuotaText, computeEffectiveQuota } from '../plugin/server/account-manager.mjs';
import { createClientRelauncher } from '../plugin/server/relaunch-client.mjs';
import { createHandoffMemoryStore, redactMemoryText } from '../plugin/server/handoff-memory.mjs';
import {
  UPSTREAM_SCHEMA_VERSION,
  evaluateRepoUpdate,
  checkUpstreams,
  renderMarkdownReport,
  syncUpstreamBaseline
} from '../plugin/server/upstream-radar.mjs';
import { runAccountsCli } from '../scripts/prism-accounts.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('all v0.4.0 extension & helper scripts pass syntax check and enforce zero-body-observer guards', () => {
  const extJsFiles = ['prism-suite.js', 'prism-suite-fx.js', 'prism-suite-workflow.js'];
  const extCssFiles = ['prism-suite.css', 'prism-suite-fx.css', 'prism-suite-workflow.css'];
  for (const name of [...extJsFiles, ...extCssFiles]) {
    assert.equal(fs.existsSync(path.join(REPO, 'extensions', name)), true, `Missing extensions/${name}`);
  }
  for (const name of extJsFiles) {
    execFileSync(process.execPath, ['--check', path.join(REPO, 'extensions', name)], { stdio: 'pipe' });
  }
  execFileSync(process.execPath, ['--check', path.join(REPO, 'scripts', 'fork-session.mjs')], { stdio: 'pipe' });

  const jsSrc = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite.js'), 'utf8');
  const cssSrc = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite.css'), 'utf8');
  const fxSrc = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite-fx.js'), 'utf8');
  const wfSrc = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite-workflow.js'), 'utf8');

  assert.match(jsSrc, /__agPrismSuiteDispose/);
  assert.match(jsSrc, /__agPrismBus/);
  assert.match(jsSrc, /unregisterPanelSection/);
  assert.match(jsSrc, /unregisterOutlineAction/);
  assert.match(jsSrc, /getDockObstacleZones/);
  assert.match(jsSrc, /scanDockObstacles/);
  assert.match(jsSrc, /positionMoreBadgeSafe/);
  assert.match(jsSrc, /lastObstacleSig/);
  assert.match(jsSrc, /openPrismWorkbenchQuick/);
  assert.match(jsSrc, /findWorkbenchEntry/);
  assert.match(jsSrc, /skipSidebar/);
  assert.match(jsSrc, /triggerRadixTrigger/);
  assert.match(jsSrc, /ag-ps-btn-workbench/);
  assert.match(jsSrc, /ensureMascotDodgeWatcher/);
  assert.match(cssSrc, /data-yield="1"/);
  assert.match(jsSrc, /data-ag-ps-tip-status/);
  assert.doesNotMatch(jsSrc, /class="ag-ps-actor"[^>]*title=/, 'Mascot actors must use pointer-safe custom tooltip');
  assert.match(jsSrc, /setAttrIfChanged/);
  assert.match(jsSrc, /compositionend/);
  assert.match(jsSrc, /ag-ps-tooltip/);
  assert.match(jsSrc, /checkGithubUpdate/);
  assert.match(jsSrc, /positionFloatingPanel/);
  assert.match(jsSrc, /isUserActivelyTyping/);
  assert.match(jsSrc, /detectViewportTurnIndex/);
  assert.match(jsSrc, /ag-ps-thought-peek/);
  assert.match(jsSrc, /clampMascotSize/);
  assert.match(jsSrc, /clampMascotMinCount/);
  assert.match(jsSrc, /mascotRoam/);
  assert.match(jsSrc, /mascotCountMode/);
  assert.match(jsSrc, /mascotMinCount/);
  assert.match(jsSrc, /buildMascotRoster/);
  assert.match(jsSrc, /syncMascotRoaming/);
  assert.match(jsSrc, /getMascotSpeedScale/);
  assert.match(jsSrc, /triggerActorTrick/);
  assert.match(jsSrc, /tryBuddyHighFive/);
  assert.match(jsSrc, /detectLeadStatusEmote/);
  assert.match(jsSrc, /wakeMascotFromWait/);
  assert.match(jsSrc, /mascotVibe/);
  assert.doesNotMatch(jsSrc, /streamObserver\.observe\(document\.body/, 'Must never permanently observe document.body');
  assert.doesNotMatch(fxSrc, /new\s+MutationObserver/, 'FX module must not spawn MutationObservers');
  assert.doesNotMatch(wfSrc, /new\s+MutationObserver/, 'Workflow module must not spawn MutationObservers');
  assert.match(fxSrc, /borderBeam/);
  assert.match(fxSrc, /quotaRing/);
  assert.match(fxSrc, /thinkingOrb/);
  assert.match(fxSrc, /bubbleTint/);
  assert.match(fxSrc, /unreadBadge/);
  assert.match(fxSrc, /switchReturnHelper/);
  assert.match(fxSrc, /quotaHandoffAlert/);
  assert.match(fxSrc, /autoDismissOnboarding/);
  assert.match(fxSrc, /tryDismissOnboardingDialog/);
  assert.match(fxSrc, /unregisterPanelSection/);
  assert.match(wfSrc, /imageContextMenu/);
  assert.match(wfSrc, /\.monaco-diff-editor/);
  assert.match(wfSrc, /cleanCopy/);
  assert.match(wfSrc, /sshPaste/);
  assert.match(wfSrc, /i18nExtraMode/);
  assert.match(wfSrc, /inlineEditHelper/);
  assert.match(wfSrc, /sessionFork/);
  assert.match(wfSrc, /unregisterOutlineAction/);
  assert.doesNotMatch(wfSrc, /tid\.includes\(['"]undo['"]\)|tid\.includes\(['"]revert['"]\)/, 'Must never auto-click generic undo/revert buttons');
  assert.match(cssSrc, /data-ag-ps-light="crystal"/);
  assert.match(cssSrc, /data-ag-ps-light="sage"/);
  assert.match(cssSrc, /data-ag-ps-dark="obsidian"/);
  assert.match(cssSrc, /data-ag-ps-dark="marine"/);
  assert.match(cssSrc, /agPsPopIn/);
  assert.match(cssSrc, /\.ag-ps-subpanel/);
  assert.match(cssSrc, /color-mix\(in srgb, var\(--foreground/);
  assert.match(cssSrc, /agPsLeap/);
  assert.match(cssSrc, /agPsFlipR/);
  assert.match(cssSrc, /agPsRollR/);
  assert.match(cssSrc, /agPsDoubleHop/);
  assert.match(cssSrc, /agPsWiggle/);
  assert.match(cssSrc, /agPsComboFlip/);
  assert.match(cssSrc, /agPsDoze/);
  assert.match(cssSrc, /--ag-ps-sprite-w/);
});

test('installExtensions and uninstallExtensions round-trip all 6 files cleanly without touching others', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-suite-test-'));
  try {
    const userDir = path.join(tmp, 'user');
    const keepFile = path.join(userDir, 'extensions', 'other-ext.js');
    fs.mkdirSync(path.dirname(keepFile), { recursive: true });
    fs.writeFileSync(keepFile, '// keep me');

    const ins = installExtensions({ userDir });
    assert.equal(ins.installed.length, 6);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite.css')), true);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite.js')), true);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite-fx.js')), true);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite-workflow.js')), true);

    const un = uninstallExtensions({ userDir });
    assert.equal(un.removed.length, 6);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite.js')), false);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite-fx.js')), false);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite-workflow.js')), false);
    assert.equal(fs.existsSync(keepFile), true, 'Unrelated extension files must be preserved');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('upstream.json and check-upstream daemon compatibility inspector work properly', () => {
  const upstream = JSON.parse(fs.readFileSync(path.join(REPO, 'upstream.json'), 'utf8'));
  assert.equal(upstream.upstreams.antiClaude.repo, 'hongqi7/Anti-Claude');
  assert.equal(upstream.upstreams.obsidianPrism.repo, 'RMvdesi/obsidian-prism');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-daemon-check-'));
  try {
    const coreDir = path.join(tmp, 'core');
    fs.mkdirSync(coreDir, { recursive: true });
    fs.writeFileSync(path.join(coreDir, 'daemon.mjs'), '// stock daemon without hooks');
    const stock = inspectLocalDaemon(tmp);
    assert.equal(stock.found, true);
    assert.equal(stock.compatible, false);
    assert.equal(stock.missing.length, 3);

    fs.writeFileSync(
      path.join(coreDir, 'daemon.mjs'),
      'function listUserExtensionFiles(){} function getUsageSummary(){} function translateText(){}'
    );
    const patched = inspectLocalDaemon(tmp);
    assert.equal(patched.compatible, true);
    assert.equal(patched.missing.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('installPlugin / uninstallPlugin and installAll preserve sibling plugins cleanly', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-plugin-test-'));
  try {
    const userDir = path.join(tmp, 'user');
    const pluginsDir = path.join(tmp, 'plugins');
    const siblingFile = path.join(pluginsDir, 'other-plugin', 'plugin.json');
    fs.mkdirSync(path.dirname(siblingFile), { recursive: true });
    fs.writeFileSync(siblingFile, '{"name":"other"}');

    const res = installAll({ userDir, pluginsDir });
    assert.equal(res.extensions.installed.length, 6);
    assert.equal(fs.existsSync(path.join(pluginsDir, 'prism-files', 'plugin.json')), true);
    assert.equal(fs.existsSync(path.join(pluginsDir, 'prism-files', 'server', 'index.mjs')), true);
    assert.equal(fs.existsSync(path.join(pluginsDir, 'prism-files', 'ui', 'app.html')), true);
    assert.equal(fs.existsSync(path.join(pluginsDir, 'prism-files', 'ui', 'inline.html')), true);

    const un = uninstallAll({ userDir, pluginsDir });
    assert.equal(un.extensions.removed.length, 6);
    assert.equal(un.plugin.removed.length, 1);
    assert.equal(fs.existsSync(path.join(pluginsDir, 'prism-files')), false);
    assert.equal(fs.existsSync(siblingFile), true, 'Sibling plugins must remain untouched');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('prism-files MCP App server enforces protocol, credential guards, SHA-256 save lock, and WSL path conversion', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-mcp-test-'));
  const prevBrain = process.env.PRISM_FILES_BRAIN_DIR;
  try {
    const workDir = path.join(tmp, 'work');
    const brainDir = path.join(tmp, 'brain');
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(path.join(brainDir, 'conv-12345678'), { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });
    process.env.PRISM_FILES_BRAIN_DIR = brainDir;

    const notePath = path.join(workDir, 'notes.md');
    const envPath = path.join(workDir, '.env');
    const brainNote = path.join(brainDir, 'conv-12345678', 'report.md');
    fs.writeFileSync(notePath, '# Hello\nworld', 'utf8');
    fs.writeFileSync(envPath, 'SECRET_KEY=topsecret', 'utf8');
    fs.writeFileSync(brainNote, '# Artifact', 'utf8');

    const srv = createPrismFilesServer({ dataDir, defaultRoot: workDir, accountStateDir: path.join(tmp, 'prism-state') });

    // Protocol handshake & tool visibility (strictly 6 model-visible tools; all accounts_* & upstream tools are app-only)
    const init = await srv.handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    assert.equal(init.result.capabilities.resources !== undefined, true);
    const listRes = await srv.handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const isAppOnly = (t) => t._meta?.ui?.visibility?.length === 1 && t._meta.ui.visibility[0] === 'app';
    const modelTools = listRes.result.tools.filter((t) => !isAppOnly(t));
    assert.deepEqual(
      modelTools.map((t) => t.name).sort(),
      ['open_prism_files', 'prism_memory_list', 'prism_memory_search', 'prism_memory_store', 'prism_quota_sync', 'show_files_inline']
    );
    const appOnlyNames = new Set(listRes.result.tools.filter(isAppOnly).map((t) => t.name));
    for (const priv of ['accounts_status', 'accounts_capture', 'accounts_switch', 'accounts_delete', 'check_upstreams', 'sync_upstream_baseline']) {
      assert.equal(appOnlyNames.has(priv), true, `${priv} must remain visibility:['app']`);
    }

    // Resources return strict MCP App MIME type
    const appHtmlRes = await srv.handleRpc({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: APP_URI } });
    assert.equal(appHtmlRes.result.contents[0].mimeType, APP_MIME_TYPE);
    assert.match(appHtmlRes.result.contents[0].text, /ui\/initialize/);
    assert.match(appHtmlRes.result.contents[0].text, /Prism 工作台/);
    assert.match(appHtmlRes.result.contents[0].text, /后台插件进程仍为旧版本/);
    assert.match(appHtmlRes.result.contents[0].text, /如何添加主号与备用号/);
    const inlineHtmlRes = await srv.handleRpc({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: INLINE_URI } });
    assert.equal(inlineHtmlRes.result.contents[0].mimeType, APP_MIME_TYPE);

    // Inline card + directory + recent artifacts
    const inlineCall = await srv.handleToolCall('show_files_inline', { files: [notePath], title: '交付物' });
    assert.equal(inlineCall.structuredContent.items.length, 1);
    assert.equal(inlineCall.structuredContent.items[0].exists, true);

    const artCall = await srv.handleToolCall('list_recent_artifacts', { limit: 10 });
    assert.equal(artCall.structuredContent.items.length, 1);
    assert.equal(artCall.structuredContent.items[0].name, 'report.md');

    // Protected credentials cannot be previewed or saved
    assert.equal(isSensitivePath(envPath), true);
    const envPrev = srv.readFilePreview(envPath);
    assert.equal(envPrev.previewType, 'protected');
    assert.equal(envPrev.text, undefined);
    const envSave = srv.saveFileContent(envPath, 'hacked', Date.now(), 'deadbeef');
    assert.equal(envSave.ok, false);

    // Brain directory is strictly read-only
    const brainPrev = srv.readFilePreview(brainNote);
    assert.equal(brainPrev.editable, false);
    const brainSave = srv.saveFileContent(brainNote, 'overwrite', brainPrev.mtimeMs, brainPrev.baseHash);
    assert.equal(brainSave.ok, false);

    // Safe workspace edit with SHA-256 optimistic lock
    const prev = srv.readFilePreview(notePath);
    assert.equal(prev.editable, true);
    assert.ok(prev.baseHash);
    const blindSave = srv.saveFileContent(notePath, 'no-lock');
    assert.equal(blindSave.ok, false);
    const okSave = srv.saveFileContent(notePath, '# Updated\nok', prev.mtimeMs, prev.baseHash);
    assert.equal(okSave.ok, true);
    const staleSave = srv.saveFileContent(notePath, '# Stale', prev.mtimeMs, prev.baseHash);
    assert.equal(staleSave.ok, false);
    assert.equal(staleSave.conflict, true);

    // WSL path fallback conversion
    assert.equal(fallbackLinuxToWindowsPath('/mnt/d/AIWorkspace/test.txt'), 'D:\\AIWorkspace\\test.txt');
    assert.equal(fallbackLinuxToWindowsPath('/home/alice/demo.md', 'Ubuntu'), '\\\\wsl.localhost\\Ubuntu\\home\\alice\\demo.md');
  } finally {
    if (prevBrain === undefined) delete process.env.PRISM_FILES_BRAIN_DIR;
    else process.env.PRISM_FILES_BRAIN_DIR = prevBrain;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('prism-files 2.0 enforces Windows space-path reveal, private LAN SMB validation, Open With safety, and redacted transcript search', async () => {
  // 1. Windows & WSL explorer reveal args (spaces, commas, drive root)
  assert.deepEqual(buildWindowsExplorerArgs('D:\\', true), ['D:\\']);
  assert.deepEqual(
    buildWindowsExplorerArgs('D:\\AIWorkspace\\ops\\WS NAS\\my, report.md', false),
    ['/select,"D:\\AIWorkspace\\ops\\WS NAS\\my, report.md"']
  );
  assert.deepEqual(
    buildWslExplorerArgs('D:\\AIWorkspace\\ops\\WS NAS\\my, report.md', false),
    ['/select,', 'D:\\AIWorkspace\\ops\\WS NAS\\my, report.md']
  );

  // 2. Private IP & LAN UNC/SMB validation
  assert.equal(isPrivateOrLocalIp('192.168.1.50'), true);
  assert.equal(isPrivateOrLocalIp('10.0.0.5'), true);
  assert.equal(isPrivateOrLocalIp('100.64.12.34'), true);
  assert.equal(isPrivateOrLocalIp('::ffff:192.168.1.8'), true);
  assert.equal(isPrivateOrLocalIp('8.8.8.8'), false);
  assert.equal(isPrivateOrLocalIp('1.1.1.1'), false);

  const okWsl = await validateLanUncPath('\\\\wsl.localhost\\Ubuntu\\home\\demo');
  assert.equal(okWsl.ok, true);
  const okPrivateDns = await validateLanUncPath('\\\\nas-box\\share\\doc.md', {
    lookupFn: async () => [{ address: '192.168.1.99', family: 4 }]
  });
  assert.equal(okPrivateDns.ok, true);
  const blockedMixedDns = await validateLanUncPath('\\\\evil-rebind.example\\share\\x', {
    lookupFn: async () => [
      { address: '192.168.1.99', family: 4 },
      { address: '93.184.216.34', family: 4 }
    ]
  });
  assert.equal(blockedMixedDns.ok, false);
  assert.equal((await validateLanUncPath('\\\\user@192.168.1.5\\share\\a')).ok, false);
  assert.equal((await validateLanUncPath('\\\\?\\C:\\Windows\\win.ini')).ok, false);

  // 3. Open With line:col & batch metachar guards
  assert.deepEqual(parseLineCol('42', '7'), { line: 42, column: 7 });
  assert.deepEqual(parseLineCol('not-a-num', '-3'), { line: null, column: null });
  assert.equal(hasWindowsBatchMeta('D:\\proj\\hello.js'), false);
  assert.equal(hasWindowsBatchMeta('D:\\proj\\a&calc.exe'), true);

  // 4. Secret redaction + cross-session transcript search + symlink jail
  const redacted = redactSensitiveText('token=sk-1234567890abcdefghij123456 and Bearer eyJhbGciOiJIUzI1NiJ9.abcdef.123456');
  assert.doesNotMatch(redacted, /sk-1234567890/);
  assert.doesNotMatch(redacted, /eyJhbGciOiJIUzI1NiJ9/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-search-test-'));
  try {
    const brainDir = path.join(tmp, 'brain');
    const logDir = path.join(brainDir, 'sess-alpha-001', '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const transcriptFile = path.join(logDir, 'transcript.jsonl');
    fs.writeFileSync(
      transcriptFile,
      [
        JSON.stringify({ role: 'user', content: 'Please optimize BorderBeam shader and check token ghp_secret1234567890abcdef1234567890' }),
        JSON.stringify({ role: 'assistant', content: 'Here is the fix:\n```js\nconst borderBeamSpeed = 1.5;\n```' }),
        'not-valid-json-line'
      ].join('\n'),
      'utf8'
    );

    // Create a symlink session pointing outside brainDir to confirm symlink jail rejects it
    const outsideDir = path.join(tmp, 'outside');
    fs.mkdirSync(path.join(outsideDir, '.system_generated', 'logs'), { recursive: true });
    fs.writeFileSync(
      path.join(outsideDir, '.system_generated', 'logs', 'transcript.jsonl'),
      JSON.stringify({ role: 'user', content: 'BorderBeam secret outside jail' }) + '\n',
      'utf8'
    );
    try {
      fs.symlinkSync(outsideDir, path.join(brainDir, 'sess-symlink-escape'), 'dir');
    } catch {}

    const allHits = searchTranscripts({ query: 'BorderBeam', filter: 'all', brainDir });
    assert.equal(allHits.ok, true);
    assert.ok(allHits.results.length >= 2);
    assert.equal(allHits.results.some((r) => r.sessionId === 'sess-symlink-escape'), false, 'Symlink session must be rejected');
    assert.equal(allHits.results.some((r) => /ghp_secret/.test(r.snippet)), false, 'Secrets must be redacted in snippets');

    const codeHits = searchTranscripts({ query: 'borderBeamSpeed', filter: 'code_cmd', brainDir });
    assert.equal(codeHits.ok, true);
    assert.equal(codeHits.results.length, 1);

    const proseOnlyMiss = searchTranscripts({ query: 'borderBeamSpeed', filter: 'prose', brainDir });
    assert.equal(proseOnlyMiss.results.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.4.1 audit security guards block NTFS ADS, UNC bypasses, secret-slice leaks, symlinked brainDir writes, and nested plugin paths', async () => {
  // P0-4: NTFS ADS & trailing dot/space bypass guards
  assert.equal(isSensitivePath('/work/.env::$DATA'), true);
  assert.equal(isSensitivePath('C:\\work\\.env::$DATA'), true);
  assert.equal(isSensitivePath('/work/.env.'), true);
  assert.equal(isSensitivePath('/work/id_rsa '), true);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-v041-audit-'));
  const prevBrain = process.env.PRISM_FILES_BRAIN_DIR;
  try {
    const workDir = path.join(tmp, 'work');
    const realBrain = path.join(tmp, 'real-brain');
    const linkBrain = path.join(tmp, 'link-brain');
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(path.join(realBrain, 'sess-001', '.system_generated', 'logs'), { recursive: true });

    try {
      fs.symlinkSync(realBrain, linkBrain, 'dir');
    } catch {}
    const effectiveBrain = fs.existsSync(linkBrain) ? linkBrain : realBrain;
    process.env.PRISM_FILES_BRAIN_DIR = effectiveBrain;

    const brainDoc = path.join(realBrain, 'sess-001', 'note.md');
    fs.writeFileSync(brainDoc, '# Brain Artifact', 'utf8');

    // P0-2: Mid-secret match must still redact the secret before snippet slicing
    fs.writeFileSync(
      path.join(realBrain, 'sess-001', '.system_generated', 'logs', 'transcript.jsonl'),
      JSON.stringify({
        role: 'assistant',
        content: 'Key block:\n-----BEGIN RSA PRIVATE KEY-----\n' + 'A'.repeat(120) + 'TARGET_MARKER' + 'B'.repeat(80) + '\n-----END RSA PRIVATE KEY-----'
      }) + '\n',
      'utf8'
    );

    const srv = createPrismFilesServer({ dataDir, defaultRoot: workDir });

    // P0-3: Symlinked brainDir remains strictly read-only
    const brainPrev = srv.readFilePreview(brainDoc);
    assert.equal(brainPrev.editable, false);
    const brainSave = srv.saveFileContent(brainDoc, 'overwrite', brainPrev.mtimeMs, brainPrev.baseHash);
    assert.equal(brainSave.ok, false);

    // P0-1: open_prism_files blocks public UNC & falls back to safe local dir
    const openBlocked = await srv.handleToolCall('open_prism_files', { dir: '\\\\8.8.8.8\\public-share' });
    assert.ok(openBlocked.structuredContent.warning, 'Public UNC dir must trigger warning fallback');
    assert.notEqual(openBlocked.structuredContent.listing.dir, '\\\\8.8.8.8\\public-share');

    // P0-2: Secret prefix sliced away by window still redacted
    const hitMidSecret = searchTranscripts({ query: 'TARGET_MARKER', filter: 'all', brainDir: effectiveBrain });
    assert.equal(hitMidSecret.ok, true);
    assert.equal(hitMidSecret.results.length, 0, 'Redacted private key interior must not leak or match raw key payload');

    // P2: installPlugin / uninstallPlugin must not double-nest prism-files/prism-files
    const pluginsRoot = path.join(tmp, 'plugins-root');
    const explicitTarget = path.join(pluginsRoot, 'prism-files');
    const ins = installPlugin({ pluginsDir: explicitTarget });
    assert.equal(ins.targetDir, explicitTarget);
    assert.equal(fs.existsSync(path.join(explicitTarget, 'prism-files')), false);
    const un = uninstallPlugin({ pluginsDir: explicitTarget });
    assert.deepEqual(un.removed, [explicitTarget]);
    assert.equal(fs.existsSync(explicitTarget), false);
  } finally {
    if (prevBrain === undefined) delete process.env.PRISM_FILES_BRAIN_DIR;
    else process.env.PRISM_FILES_BRAIN_DIR = prevBrain;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.5.0 isolated account relay enforces email verification, ownership preservation, lock, rollback, and primary/backup routing (all mocked)', async () => {
  // 1. Credential email extraction (direct JSON, nested base64 token, JWT, WSL2 envelope)
  assert.equal(extractCredentialEmail(JSON.stringify({ id_token_email: 'Primary@Example.COM' })), 'primary@example.com');
  const innerB64 = Buffer.from(JSON.stringify({ id_token_email: 'Nested@Example.com' }), 'utf8').toString('base64');
  assert.equal(extractCredentialEmail(JSON.stringify({ token: innerB64 })), 'nested@example.com');
  const jwtHeader = Buffer.from('{"alg":"none"}').toString('base64url');
  const jwtBody = Buffer.from('{"email":"JwtUser@Example.org"}').toString('base64url');
  assert.equal(extractCredentialEmail(`${jwtHeader}.${jwtBody}.sig`), 'jwtuser@example.org');
  const wslEnv = JSON.stringify({
    kind: 'prism-wsl-cred-v1',
    oauthTokenB64: Buffer.from(JSON.stringify({ id_token_email: 'Wsl@Example.net' })).toString('base64')
  });
  assert.equal(extractCredentialEmail(wslEnv), 'wsl@example.net');
  assert.throws(() => sanitizeAccountId('../bad'), /INVALID|无效/);

  // 2. Sensitive path protection for Antigravity OAuth tokens & prism-suite metadata
  assert.equal(isSensitivePath('/home/user/.gemini/jetski-standalone-oauth-token'), true);
  assert.equal(isSensitivePath('/home/user/.config/antigravity/credential-user-scope'), true);
  assert.equal(isSensitivePath('/home/user/.gemini/antigravity/prism-suite/accounts.json'), true);
  assert.equal(isSensitivePath('/home/user/.gemini/antigravity/prism-suite/switch.lock'), true);

  // 3. Full mock OS credential store via injected runCmd (never touches real OS vault or ~/.gemini)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-acct-test-'));
  try {
    const stateDir = path.join(tmp, 'prism-suite');
    const brainDir = path.join(tmp, 'brain');
    fs.mkdirSync(path.join(brainDir, 'conv-abc'), { recursive: true });
    const fakeCredStore = new Map();
    const makeCredBlob = (email, secret) =>
      Buffer.from(JSON.stringify({ id_token_email: email, refresh_token: secret }), 'utf8');
    fakeCredStore.set('gemini:antigravity', makeCredBlob('main@example.com', 'tok_main_1'));

    let forceReadVerifyFailAfterWrite = false;
    let activeWriteSeen = false;
    const mockRunCmd = (_bin, args, { input = '' } = {}) => {
      if (args.includes('-EncodedCommand')) {
        const req = JSON.parse(input);
        if (req.op === 'probe') return { status: 0, stdout: '{"ok":true}\n', stderr: '' };
        if (req.op === 'read') {
          if (forceReadVerifyFailAfterWrite && activeWriteSeen && req.target === 'gemini:antigravity') {
            return {
              status: 0,
              stdout: JSON.stringify({ ok: true, found: true, blobB64: Buffer.from('corrupted', 'utf8').toString('base64') }) + '\n',
              stderr: ''
            };
          }
          const b = fakeCredStore.get(req.target);
          return {
            status: 0,
            stdout: JSON.stringify(b ? { ok: true, found: true, blobB64: b.toString('base64') } : { ok: true, found: false }) + '\n',
            stderr: ''
          };
        }
        if (req.op === 'write') {
          if (req.target === 'gemini:antigravity') activeWriteSeen = true;
          fakeCredStore.set(req.target, Buffer.from(req.blobB64, 'base64'));
          return { status: 0, stdout: '{"ok":true,"written":true}\n', stderr: '' };
        }
        if (req.op === 'delete') {
          const had = fakeCredStore.delete(req.target);
          return { status: 0, stdout: JSON.stringify({ ok: true, deleted: had }) + '\n', stderr: '' };
        }
      }
      throw new Error(`Unexpected command: ${_bin}`);
    };

    const vault = createAccountVault({ platform: 'win32', isWsl: false, homeDir: tmp, runCmd: mockRunCmd });
    const mem = createHandoffMemoryStore({ stateDir });
    const mgr = createAccountManager({ homeDir: tmp, stateDir, brainDir, vault, handoffMemory: mem });

    // Default OFF rejects capture/switch
    assert.equal(mgr.getStatus().enabled, false);
    assert.throws(() => mgr.captureCurrentAccount({ role: 'primary' }), /默认关闭|ACCOUNTS_DISABLED/);

    // Explicit opt-in & capture primary + backup
    mgr.setEnabled(true);
    const capPrimary = mgr.captureCurrentAccount({ role: 'primary', alias: '主力号', modelsSupported: ['claude', 'gemini'] });
    assert.equal(capPrimary.account.role, 'primary');
    assert.equal(capPrimary.account.email, 'main@example.com');

    // Simulate external manual login to backup account -> capture as backup
    fakeCredStore.set('gemini:antigravity', makeCredBlob('backup@example.com', 'tok_bak_1'));
    const capBackup = mgr.captureCurrentAccount({ role: 'backup', alias: '备用一', modelsSupported: ['gemini'] });
    assert.equal(capBackup.account.role, 'backup');

    // Dry-run does NOT alter active credential
    const dry = mgr.switchAccount(capPrimary.account.id, { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(extractCredentialEmail(fakeCredStore.get('gemini:antigravity')), 'backup@example.com');

    // Ownership drift guard: externally switch active credential to an unregistered account -> blocked
    fakeCredStore.set('gemini:antigravity', makeCredBlob('stranger@example.com', 'tok_stranger'));
    assert.throws(() => mgr.switchAccount(capPrimary.account.id), /尚未捕获到隔离库|UNCAPTURED_ACTIVE_ACCOUNT/);

    // Restore active to backup & perform verified atomic switch back to primary (with pre-switch 4-element snapshot)
    fakeCredStore.set('gemini:antigravity', makeCredBlob('backup@example.com', 'tok_bak_2'));
    const swRes = mgr.switchAccount(capPrimary.account.id, { handoff: { cwd: tmp, nextAction: '继续验证' } });
    assert.equal(swRes.ok, true);
    assert.equal(swRes.backedUpTo, capBackup.account.id, 'Updated active backup token must be saved to its true owner slot');
    assert.equal(extractCredentialEmail(fakeCredStore.get('gemini:antigravity')), 'main@example.com');
    assert.equal(extractCredentialEmail(fakeCredStore.get(`prism-suite:account:${capBackup.account.id}`)), 'backup@example.com');

    // Recommendation guards & offline quota reset projection (5h / 7d)
    const nowRef = Date.now();
    const parsedQ = parseQuotaText('5h: 75% 剩余 2h30m 后重置; 7d: 已用 96%', nowRef);
    assert.equal(parsedQ.window5hPct, 75);
    assert.equal(parsedQ.window7dPct, 4);
    assert.ok(parsedQ.reset5hAt);

    // Offline primary whose 7d reset timestamp is already in the past projects back to 100%
    mgr.updateAccount(capPrimary.account.id, {
      quota: { window7dPct: 2, window5hPct: 10, reset7dAt: new Date(nowRef - 60000).toISOString(), reset5hAt: new Date(nowRef - 60000).toISOString() }
    });
    const effPrimary = computeEffectiveQuota(mgr.getStatus().accounts.find((a) => a.id === capPrimary.account.id).lastQuota, nowRef);
    assert.equal(effPrimary.effective7dPct, 100);
    assert.equal(effPrimary.reset7dPassed, true);

    const syncedQ = mgr.syncActiveAccountQuota({ window5hPct: 88, window7dPct: 92 });
    assert.equal(syncedQ.ok, true);
    assert.equal(syncedQ.effectiveQuota.effective7dPct, 92);

    mgr.updateAccount(capPrimary.account.id, { quota: { window7dPct: 45, window5hPct: 80 } });
    mgr.updateAccount(capBackup.account.id, { quota: { window7dPct: 85, window5hPct: 90 } });
    const recBackupForClaude = mgr.pickRecommendedTarget({ currentId: capBackup.account.id, activeModel: 'claude-opus' });
    assert.ok(recBackupForClaude.primaryRecovery, 'Healthy primary above hysteresis must trigger recovery prompt');

    // Atomic rollback if active verification fails after swap
    forceReadVerifyFailAfterWrite = true;
    activeWriteSeen = false;
    assert.throws(() => mgr.switchAccount(capBackup.account.id), (err) => err.rolledBack === true);
    forceReadVerifyFailAfterWrite = false;
    assert.equal(extractCredentialEmail(fakeCredStore.get('gemini:antigravity')), 'main@example.com', 'Rollback must restore previous credential');

    // Concurrent lock blocks overlapping switches; stale lock token protects newer lock owner
    const foreignLock = JSON.stringify({ pid: process.pid, hostname: os.hostname(), createdAt: Date.now(), lockToken: 'foreign-owner' });
    fs.writeFileSync(path.join(stateDir, 'switch.lock'), foreignLock);
    assert.throws(() => mgr.switchAccount(capBackup.account.id), /已有切换事务正在进行中|SWITCH_IN_PROGRESS/);
    assert.throws(() => mgr.deleteAccount(capBackup.account.id), /已有切换事务正在进行中|SWITCH_IN_PROGRESS/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(stateDir, 'switch.lock'), 'utf8')).lockToken, 'foreign-owner');
    fs.rmSync(path.join(stateDir, 'switch.lock'), { force: true });

    // Read-only integrity verification & CLI help/status check
    const integrity = mgr.verifyDataIntegrity();
    assert.equal(integrity.brainSessionCount, 1);
    const helpRes = await runAccountsCli(['--help']);
    assert.equal(helpRes.help, true);
    const statusCli = await runAccountsCli(['status', '--json'], { manager: mgr, handoffMemory: mem });
    assert.equal(statusCli.data.accounts.length, 2);
    assert.doesNotMatch(JSON.stringify(statusCli.data), /tok_main_1|tok_bak_2/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.5.0 zero-dep handoff memory redacts secrets and enforces strict chronological order', async () => {
  const redacted = redactMemoryText('sk-1234567890abcdef123456 and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig12345678 password="mysecret"');
  assert.doesNotMatch(redacted, /sk-1234567890|eyJhbGciOi|mysecret/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-mem-test-'));
  try {
    const store = createHandoffMemoryStore({ stateDir: path.join(tmp, 'state'), maxEntries: 5 });
    const oldEntry = store.store({
      project: 'demo-app',
      slot: 'main-dev',
      createdAtMs: 1700000000000,
      createdAt: '2026-11-24T10:00:00.000Z',
      summary: '旧里程碑总结',
      verified: 'token=ghp_12345678901234567890123456',
      nextAction: '旧步骤'
    });
    const newEntry = store.store({
      project: 'demo-app',
      slot: 'main-dev',
      createdAtMs: 1700009000000,
      createdAt: '2026-11-25T10:00:00.000Z',
      summary: '最新切号交接',
      verified: 'npm test 10/10 pass',
      nextAction: '检查上线'
    });

    assert.doesNotMatch(oldEntry.verified, /ghp_1234567890/);
    const listed = store.list({ project: 'demo-app', slot: 'main-dev', limit: 10 });
    assert.equal(listed.entries.length, 2);
    assert.equal(listed.entries[0].id, newEntry.id, 'Newest handoff entry must come first');

    const searched = store.search({ query: '上线', project: 'demo-app' });
    assert.equal(searched.entries[0].id, newEntry.id);
    assert.match(store.formatExternalMemoryStorePrompt(newEntry), /memory_store/);
    assert.match(store.formatResumePrompt(newEntry), /已对齐 \[handoff:demo-app:main-dev\]/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.5.0 selective Upstream Radar keeps root/plugin upstream.json identical and classifies selective candidates', async () => {
  const rootUpstream = fs.readFileSync(path.join(REPO, 'upstream.json'), 'utf8');
  const pluginUpstream = fs.readFileSync(path.join(REPO, 'plugin', 'upstream.json'), 'utf8');
  assert.equal(rootUpstream, pluginUpstream, 'upstream.json and plugin/upstream.json must be byte-identical');
  const parsed = JSON.parse(rootUpstream);
  assert.equal(parsed.schema, UPSTREAM_SCHEMA_VERSION);
  assert.ok(parsed.upstreams.agyPowertools);
  assert.ok(parsed.upstreams.agySwitch);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-radar-test-'));
  try {
    const tmpCfg = path.join(tmp, 'upstream.json');
    fs.writeFileSync(tmpCfg, rootUpstream, 'utf8');

    const mockFetch = async (url) => {
      if (url.includes('WhiteBr1ck/agy-powertools/releases/latest')) {
        return { ok: true, json: async () => ({ tag_name: 'v2.17.0', name: 'v2.17.0', body: 'New widgets' }) };
      }
      if (url.includes('WhiteBr1ck/agy-powertools/commits')) {
        return { ok: true, json: async () => [{ sha: 'abc1234deadbeef', commit: { message: 'feat: add mini sound indicator', committer: { date: '2026-11-26T00:00:00Z' } } }] };
      }
      if (url.includes('WhiteBr1ck/agy-powertools/compare')) {
        return {
          ok: true,
          json: async () => ({
            ahead_by: 3,
            commits: [
              { sha: '1111111', commit: { message: 'fix: update windows credman target reader' } },
              { sha: '2222222', commit: { message: 'feat: add mini sound indicator' } },
              { sha: '3333333', commit: { message: 'docs: tweak readme banner' } }
            ],
            files: [
              { filename: 'lib/credential-vault.mjs' },
              { filename: 'media/demo.gif' }
            ]
          })
        };
      }
      if (url.includes('RMvdesi/obsidian-prism/commits')) {
        return { ok: true, json: async () => [{ sha: '9999999abcdef', commit: { message: 'feat: glassmorphism dock', committer: { date: '2026-11-26T00:00:00Z' } } }] };
      }
      if (url.includes('compare')) {
        return { ok: true, json: async () => ({ ahead_by: 1, commits: [{ sha: '9999999', commit: { message: 'feat: glassmorphism dock' } }], files: [] }) };
      }
      if (url.includes('hongqi7/Anti-Claude/releases/latest')) {
        return { ok: true, json: async () => ({ tag_name: parsed.upstreams.antiClaude.baselineTag }) };
      }
      if (url.includes('hongqi7/Anti-Claude/commits')) {
        return { ok: true, json: async () => [{ sha: parsed.upstreams.antiClaude.baselineCommit + '0000', commit: { message: 'sync', committer: { date: '2026-11-25T00:00:00Z' } } }] };
      }
      if (url.includes('anglee0323/agy-switch/releases/latest')) {
        return { ok: true, json: async () => ({ tag_name: parsed.upstreams.agySwitch.baselineTag }) };
      }
      if (url.includes('anglee0323/agy-switch/commits')) {
        return { ok: true, json: async () => [{ sha: parsed.upstreams.agySwitch.baselineCommit + '0000', commit: { message: 'sync', committer: { date: '2026-11-18T00:00:00Z' } } }] };
      }
      return { ok: false, status: 404, headers: { get: () => null } };
    };

    const report = await checkUpstreams({
      configPath: tmpCfg,
      fetchImpl: mockFetch,
      cacheFile: path.join(tmp, 'cache.json'),
      force: true
    });
    const agyRes = report.results.find((r) => r.key === 'agyPowertools');
    assert.equal(agyRes.impactLevel, 'HIGH');
    assert.equal(agyRes.watchedHits.includes('lib/credential-vault.mjs'), true);
    assert.equal(agyRes.compatFixes.length, 1);
    assert.equal(agyRes.featureCandidates.length, 1);
    assert.equal(agyRes.skippedNoise.length, 1);

    const md = renderMarkdownReport(report);
    assert.match(md, /择优/);
    assert.match(md, /Clean-Room 隔离红线/);
    assert.match(md, /兼容性 \/ 安全必看/);
    assert.match(md, /新增实用 \/ 有趣功能候选/);

    const synced = syncUpstreamBaseline(tmpCfg, { keys: ['agyPowertools'], report });
    assert.deepEqual(synced.updatedKeys, ['agyPowertools']);
    const afterCfg = JSON.parse(fs.readFileSync(tmpCfg, 'utf8'));
    assert.equal(afterCfg.upstreams.agyPowertools.baselineTag, 'v2.17.0');
    assert.equal(afterCfg.upstreams.agyPowertools.baselineCommit, 'abc1234');

    // Cache invalidation check: cached report must NOT return stale hits after baseline config changes on disk
    const mockFetchSynced = async (url) => {
      if (url.includes('agy-powertools/releases/latest')) return { ok: true, json: async () => ({ tag_name: 'v2.17.0' }) };
      if (url.includes('agy-powertools/commits')) return { ok: true, json: async () => [{ sha: 'abc1234', commit: { message: 'v2.17.0' } }] };
      return mockFetch(url);
    };
    const resAfterSync = await checkUpstreams({
      configPath: tmpCfg,
      fetchImpl: mockFetchSynced,
      cacheFile: path.join(tmp, 'cache.json'),
      onlyKeys: ['agyPowertools']
    });
    assert.equal(resAfterSync.fromCache, false, 'Config change must invalidate old cache entry');
    assert.equal(resAfterSync.results[0].impactLevel, 'UP_TO_DATE');

    // sync_upstream_baseline MCP tool end-to-end check on isolated tmp config
    fs.writeFileSync(tmpCfg, rootUpstream, 'utf8');
    const srv = createPrismFilesServer({
      dataDir: path.join(tmp, 'srv-data'),
      defaultRoot: tmp,
      accountStateDir: path.join(tmp, 'srv-state'),
      upstreamConfigPath: tmpCfg,
      upstreamFetch: mockFetch
    });
    const mcpSync = await srv.handleToolCall('sync_upstream_baseline', { keys: ['obsidianPrism'] });
    assert.deepEqual(mcpSync.structuredContent.updatedKeys, ['obsidianPrism']);
    assert.equal(JSON.parse(rootUpstream).upstreams.obsidianPrism.baselineCommit, '2e27680');
    assert.equal(JSON.parse(fs.readFileSync(path.join(REPO, 'upstream.json'), 'utf8')).upstreams.obsidianPrism.baselineCommit, '2e27680');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.5.0 in-place plugin installer preserves directory inode and batch vault recovers from deleted cwd & stale interop', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-fix-test-'));
  const origCwd = process.cwd();
  try {
    // 1. installPlugin preserves root directory inode across updates and removes stale leftovers
    const pluginsDir = path.join(tmp, 'plugins');
    const first = installPlugin({ pluginsDir });
    const firstIno = fs.statSync(first.targetDir).ino;
    const staleFile = path.join(first.targetDir, 'stale-obsolete.txt');
    const staleDir = path.join(first.targetDir, 'stale-dir');
    fs.writeFileSync(staleFile, 'old', 'utf8');
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(path.join(staleDir, 'old.js'), 'x', 'utf8');

    const second = installPlugin({ pluginsDir });
    const secondIno = fs.statSync(second.targetDir).ino;
    assert.equal(secondIno, firstIno, 'installPlugin must preserve plugin root inode so running servers do not lose cwd');
    assert.equal(fs.existsSync(staleFile), false, 'Stale file must be removed during in-place sync');
    assert.equal(fs.existsSync(staleDir), false, 'Stale directory must be removed during in-place sync');

    // 2. resolveSafeExecCwd survives deleted/ENOENT process.cwd() and returns safe path (cross-platform)
    if (process.platform === 'win32') {
      const safeNonWsl = resolveSafeExecCwd({
        isWsl: false,
        homeDir: tmp,
        tmpDir: tmp,
        getCwd: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }
      });
      assert.equal(safeNonWsl, tmp);
    } else {
      const ghostDir = path.join(tmp, 'ghost-cwd');
      fs.mkdirSync(ghostDir, { recursive: true });
      process.chdir(ghostDir);
      fs.rmdirSync(ghostDir);
      const safeNonWsl = resolveSafeExecCwd({ isWsl: false, homeDir: tmp, tmpDir: tmp });
      assert.equal(fs.existsSync(safeNonWsl), true);
      process.chdir(origCwd);
    }
    const safeWslMock = resolveSafeExecCwd({
      isWsl: true,
      homeDir: tmp,
      tmpDir: tmp,
      existsSync: (p) => p === '/mnt/c' || p === tmp
    });
    assert.equal(safeWslMock, '/mnt/c');

    // 3. resolveWslInteropEnv replaces dead WSL_INTEROP socket with newest live *_interop socket
    const interopDir = path.join(tmp, 'wsl-sockets');
    fs.mkdirSync(interopDir, { recursive: true });
    const oldSock = path.join(interopDir, '100_interop');
    const newSock = path.join(interopDir, '200_interop');
    fs.writeFileSync(oldSock, '');
    fs.writeFileSync(newSock, '');
    fs.utimesSync(oldSock, new Date(1700000000000), new Date(1700000000000));
    fs.utimesSync(newSock, new Date(1700005000000), new Date(1700005000000));
    const fixedEnv = resolveWslInteropEnv({ WSL_INTEROP: path.join(interopDir, 'dead_interop') }, true, { interopDir });
    assert.equal(fixedEnv.WSL_INTEROP, newSock);

    // 4. cleanPowerShellError strips PowerShell CLIXML noise cleanly
    const clixml = '#< CLIXML\r\n<Objs Version="1.1"><S S="Error">CredWriteW failed_x000D__x000A_</S></Objs>';
    assert.equal(cleanPowerShellError(clixml, '', 1), 'CredWriteW failed');
    assert.equal(cleanPowerShellError('', '', 1, ''), 'exit 1');

    // 5. Batch CredMan transaction performs save/inspectMany/swap in single powershell invocation
    const fakeCredStore = new Map();
    const makeCredBlob = (email, secret) =>
      Buffer.from(JSON.stringify({ id_token_email: email, refresh_token: secret }), 'utf8');
    fakeCredStore.set('gemini:antigravity', makeCredBlob('alpha@example.com', 'tok_alpha'));
    let cmdCallCount = 0;
    const handleOp = (req) => {
      if (req.op === 'probe') return { ok: true };
      if (req.op === 'read') {
        const b = fakeCredStore.get(req.target);
        return b ? { ok: true, found: true, blobB64: b.toString('base64') } : { ok: true, found: false };
      }
      if (req.op === 'write') {
        fakeCredStore.set(req.target, Buffer.from(req.blobB64, 'base64'));
        return { ok: true, written: true };
      }
      if (req.op === 'delete') {
        return { ok: true, deleted: fakeCredStore.delete(req.target) };
      }
      throw new Error(`bad op: ${req.op}`);
    };
    const batchRunCmd = (_bin, args, { input = '' } = {}) => {
      cmdCallCount += 1;
      assert.ok(args.includes('-EncodedCommand'));
      const parsed = JSON.parse(input);
      if (parsed.op === 'batch') {
        const results = parsed.ops.map(handleOp);
        // Simulate PowerShell 5.1 edge case when ops.length === 1 and results could be single object or array
        return { status: 0, stdout: JSON.stringify({ ok: true, results }) + '\n', stderr: '' };
      }
      return { status: 0, stdout: JSON.stringify(handleOp(parsed)) + '\n', stderr: '' };
    };

    const batchVault = createAccountVault({
      platform: 'win32',
      isWsl: false,
      homeDir: tmp,
      runCmd: batchRunCmd,
      enableBatch: true
    });
    const batchStateDir = path.join(tmp, 'state');
    const batchMgr = createAccountManager({ homeDir: tmp, stateDir: batchStateDir, brainDir: tmp, vault: batchVault });
    batchMgr.setEnabled(true);

    cmdCallCount = 0;
    const a1 = batchMgr.captureCurrentAccount({ role: 'primary', alias: 'A1' });
    assert.equal(cmdCallCount, 3, 'captureCurrentAccount on win32 uses inspectActive + readActive + 1 batch(write+verify)');

    fakeCredStore.set('gemini:antigravity', makeCredBlob('beta@example.com', 'tok_beta'));
    const a2 = batchMgr.captureCurrentAccount({ role: 'backup', alias: 'B2' });

    cmdCallCount = 0;
    const statusRes = batchMgr.getStatus({ forceRefresh: true });
    assert.equal(statusRes.accounts.length, 2);
    assert.equal(cmdCallCount, 3, 'getStatus(forceRefresh) runs probe + activeRead + single inspectSavedMany batch');
    cmdCallCount = 0;
    const statusWarm = batchMgr.getStatus();
    assert.equal(statusWarm.accounts.length, 2);
    assert.equal(cmdCallCount, 1, 'Warm getStatus skips cached probe & inspectSavedMany (only activeRead)');

    cmdCallCount = 0;
    const sw = batchMgr.switchAccount(a1.account.id, { saveSnapshot: false });
    assert.equal(sw.ok, true);
    assert.equal(extractCredentialEmail(fakeCredStore.get('gemini:antigravity')), 'alpha@example.com');
    assert.equal(cmdCallCount, 5, 'win32 batch switch skips cached inspectSaved and merges backup+verify+target read into 1 batch call');

    // Verify wsl-wincred mode minimizes PowerShell calls during getStatus and switchAccount
    const wslHome = path.join(tmp, 'wsl-home');
    fs.mkdirSync(path.join(wslHome, '.gemini'), { recursive: true });
    fs.writeFileSync(path.join(wslHome, '.gemini', 'jetski-standalone-oauth-token'), makeCredBlob('w1@example.com', 'tok_w1'));
    const wslVault = createAccountVault({
      platform: 'linux',
      isWsl: true,
      wslDistro: 'Ubuntu',
      homeDir: wslHome,
      runCmd: batchRunCmd,
      enableBatch: true
    });
    const wslMgr = createAccountManager({ homeDir: wslHome, stateDir: path.join(wslHome, 'state'), brainDir: tmp, vault: wslVault });
    wslMgr.setEnabled(true);
    cmdCallCount = 0;
    const w1 = wslMgr.captureCurrentAccount({ role: 'primary', alias: 'W1' });
    assert.equal(cmdCallCount, 1, 'wsl captureCurrentAccount executes exactly 1 PowerShell batch');
    fs.writeFileSync(path.join(wslHome, '.gemini', 'jetski-standalone-oauth-token'), makeCredBlob('w2@example.com', 'tok_w2'));
    const w2 = wslMgr.captureCurrentAccount({ role: 'backup', alias: 'W2' });
    cmdCallCount = 0;
    const wStatus = wslMgr.getStatus();
    assert.equal(wStatus.accounts.length, 2);
    assert.equal(cmdCallCount, 1, 'wsl getStatus runs only probe because capture already populated savedMetaCache');
    cmdCallCount = 0;
    const wSw = wslMgr.switchAccount(w1.account.id, { saveSnapshot: false });
    assert.equal(wSw.ok, true);
    assert.equal(cmdCallCount, 1, 'wsl switchAccount runs exactly 1 single backup/target batch using cached target metadata');
    assert.equal(extractCredentialEmail(fs.readFileSync(path.join(wslHome, '.gemini', 'jetski-standalone-oauth-token'))), 'w1@example.com');
  } finally {
    try { process.chdir(origCwd); } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.5.0 client relauncher, metadata cache TTL/mtime invalidation, and strict 6-tool visibility', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-relaunch-test-'));
  try {
    // 1. Test createClientRelauncher (dryRun + detached dispatch preserving --remote-debugging-port=0)
    const relaunchCalls = [];
    const mockRelaunchCmd = (_bin, args) => {
      const encIdx = args.indexOf('-EncodedCommand');
      const script = encIdx !== -1 ? Buffer.from(args[encIdx + 1], 'base64').toString('utf16le') : '';
      relaunchCalls.push(script);
      if (script.includes('Win32_Process') && script.includes('hasAntiClaude')) {
        return {
          status: 0,
          stdout: JSON.stringify({
            ok: true,
            targetPath: 'C:\\Users\\Demo\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe',
            hasDebug: true,
            hasAntiClaude: true
          }) + '\n',
          stderr: ''
        };
      }
      return { status: 0, stdout: '{"ok":true,"method":"explorer"}\n', stderr: '' };
    };
    const relauncher = createClientRelauncher({ platform: 'linux', isWsl: true, homeDir: tmp, runCmd: mockRelaunchCmd });
    const dryR = relauncher.scheduleRelaunch({ dryRun: true });
    assert.equal(dryR.ok, true);
    assert.equal(dryR.dryRun, true);
    assert.equal(dryR.preserveDebugPort, true);
    assert.deepEqual(dryR.launchArgs, ['--remote-debugging-port=0']);
    assert.equal(relaunchCalls.length, 1, 'dryRun must only probe and not dispatch worker');

    const realR = relauncher.scheduleRelaunch({ dryRun: false, delayMs: 500 });
    assert.equal(realR.ok, true);
    assert.equal(realR.scheduled, true);
    assert.equal(realR.method, 'explorer');
    assert.equal(relaunchCalls.length, 3, 'Live schedule runs fresh probe + dispatches detached worker script');
    assert.match(relaunchCalls[2], /9BA05972-F6A8-11CF-A442-00A0C90A8F39/);

    // 2. Test vault cache hit, forceRefresh bypass, and external accounts.json mtime invalidation
    const fakeCredStore = new Map();
    const makeCredBlob = (email, secret) =>
      Buffer.from(JSON.stringify({ id_token_email: email, refresh_token: secret }), 'utf8');
    fakeCredStore.set('gemini:antigravity', makeCredBlob('c1@example.com', 'tok_c1'));
    let vaultCmdCount = 0;
    const vaultRunCmd = (_bin, args, { input = '' } = {}) => {
      vaultCmdCount += 1;
      assert.ok(args.includes('-EncodedCommand'));
      const req = JSON.parse(input);
      const handle = (r) => {
        if (r.op === 'probe') return { ok: true };
        if (r.op === 'read') {
          const b = fakeCredStore.get(r.target);
          return b ? { ok: true, found: true, blobB64: b.toString('base64') } : { ok: true, found: false };
        }
        if (r.op === 'write') {
          fakeCredStore.set(r.target, Buffer.from(r.blobB64, 'base64'));
          return { ok: true, written: true };
        }
        return { ok: true };
      };
      if (req.op === 'batch') {
        return { status: 0, stdout: JSON.stringify({ ok: true, results: req.ops.map(handle) }) + '\n', stderr: '' };
      }
      return { status: 0, stdout: JSON.stringify(handle(req)) + '\n', stderr: '' };
    };
    const vault = createAccountVault({ platform: 'win32', isWsl: false, homeDir: tmp, runCmd: vaultRunCmd, enableBatch: true });
    const stateDir = path.join(tmp, 'acct-state');
    const mgr = createAccountManager({ homeDir: tmp, stateDir, brainDir: tmp, vault });
    mgr.setEnabled(true);
    const c1 = mgr.captureCurrentAccount({ role: 'primary', alias: 'C1' });
    assert.equal(mgr.getStatus().autoRelaunchAfterSwitch, true, 'autoRelaunchAfterSwitch defaults to true');

    // Warm up cache -> subsequent getStatus only reads active slot (no probe/inspectSavedMany re-call)
    mgr.getStatus();
    vaultCmdCount = 0;
    mgr.getStatus();
    assert.equal(vaultCmdCount, 1, 'Cached probe & savedMetaCache must skip redundant PowerShell calls');

    // forceRefresh: true bypasses probe & savedMetaCache
    vaultCmdCount = 0;
    mgr.getStatus({ forceRefresh: true });
    assert.equal(vaultCmdCount, 3, 'forceRefresh must bypass cache and re-probe + re-inspect');

    // External accounts.json mtime change invalidates cache automatically
    const acctPath = path.join(stateDir, 'accounts.json');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(acctPath, future, future);
    vaultCmdCount = 0;
    mgr.getStatus();
    assert.equal(vaultCmdCount, 3, 'External mtime change on accounts.json must invalidate vault cache');

    // 3. Test MCP Server wiring: strictly 6 model-visible tools, accounts_relaunch_client hidden, autoRelaunch triggers only on live swap
    fakeCredStore.set('gemini:antigravity', makeCredBlob('c2@example.com', 'tok_c2'));
    mgr.captureCurrentAccount({ role: 'backup', alias: 'C2' });
    let relaunchedCount = 0;
    const fakeRelauncher = {
      scheduleRelaunch: ({ dryRun = false } = {}) => {
        if (!dryRun) relaunchedCount += 1;
        return { ok: true, dryRun, scheduled: !dryRun, method: 'mock' };
      }
    };
    const srv = createPrismFilesServer({
      dataDir: path.join(tmp, 'srv-data'),
      defaultRoot: tmp,
      accountStateDir: stateDir,
      accountManager: mgr,
      clientRelauncher: fakeRelauncher
    });
    const listRpc = await srv.handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const visibleToModel = listRpc.result.tools.filter((t) => !(t._meta?.ui?.visibility || []).includes('app'));
    assert.equal(visibleToModel.length, 6, 'Model-visible tool count must remain strictly 6');
    const relaunchTool = listRpc.result.tools.find((t) => t.name === 'accounts_relaunch_client');
    assert.ok(relaunchTool && relaunchTool._meta?.ui?.visibility?.includes('app'), 'accounts_relaunch_client must be app-only');

    // Dry-run switch must NOT trigger relaunch
    await srv.handleToolCall('accounts_switch', { targetId: c1.account.id, dryRun: true, autoRelaunch: true });
    assert.equal(relaunchedCount, 0);

    // Live switch with autoRelaunch: true triggers scheduleRelaunch once
    const liveSw = await srv.handleToolCall('accounts_switch', { targetId: c1.account.id, dryRun: false, autoRelaunch: true, saveSnapshot: false });
    assert.equal(liveSw.structuredContent.ok, true);
    assert.equal(liveSw.structuredContent.relaunch?.scheduled, true);
    assert.equal(relaunchedCount, 1);

    // Direct accounts_relaunch_client toggle persistence
    const tog = await srv.handleToolCall('accounts_toggle_enabled', { autoRelaunchAfterSwitch: false });
    assert.equal(tog.structuredContent.state.autoRelaunchAfterSwitch, false);
    assert.equal(tog.structuredContent.state.enabled, true, 'Omitted enabled preserves current opt-in state');
  } finally {
    try { process.chdir(origCwd); } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.5.0 polish: incremental quota bridge, auto-capture uncaptured account with rollback safety, lastTab persistence, keyboard/line-ref UI, and in-place Win installer', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-polish-test-'));
  try {
    const fakeCredStore = new Map();
    const makeCredBlob = (email, secret) =>
      Buffer.from(JSON.stringify({ id_token_email: email, refresh_token: secret }), 'utf8');
    fakeCredStore.set('gemini:antigravity', makeCredBlob('main@example.com', 'tok_main'));

    let forceActiveFail = false;
    let activeWriteCount = 0;
    const mockRunCmd = (_bin, args, { input = '' } = {}) => {
      assert.ok(args.includes('-EncodedCommand'));
      const req = JSON.parse(input);
      const handle = (r) => {
        if (r.op === 'probe') return { ok: true };
        if (r.op === 'read') {
          if (forceActiveFail && activeWriteCount > 0 && r.target === 'gemini:antigravity') {
            return { ok: true, found: true, blobB64: Buffer.from('corrupt', 'utf8').toString('base64') };
          }
          const b = fakeCredStore.get(r.target);
          return b ? { ok: true, found: true, blobB64: b.toString('base64') } : { ok: true, found: false };
        }
        if (r.op === 'write') {
          if (r.target === 'gemini:antigravity') activeWriteCount += 1;
          fakeCredStore.set(r.target, Buffer.from(r.blobB64, 'base64'));
          return { ok: true, written: true };
        }
        return { ok: true };
      };
      if (req.op === 'batch') {
        return { status: 0, stdout: JSON.stringify({ ok: true, results: req.ops.map(handle) }) + '\n', stderr: '' };
      }
      return { status: 0, stdout: JSON.stringify(handle(req)) + '\n', stderr: '' };
    };

    const vault = createAccountVault({ platform: 'win32', isWsl: false, homeDir: tmp, runCmd: mockRunCmd, enableBatch: true });
    const stateDir = path.join(tmp, 'acct-state');
    const mgr = createAccountManager({ homeDir: tmp, stateDir, brainDir: tmp, vault });
    mgr.setEnabled(true);
    const mainCap = mgr.captureCurrentAccount({ role: 'primary', alias: '主号' });

    // 1. Incremental quota sync preserves existing window when partial telemetry arrives
    const q1 = mgr.syncActiveAccountQuota({ window5hPct: 72, window7dPct: 88, reset7dAt: new Date(Date.now() + 86400000).toISOString() });
    assert.equal(q1.ok, true);
    const q2 = mgr.syncActiveAccountQuota({ window5hPct: 65 });
    assert.equal(q2.ok, true);
    assert.equal(q2.effectiveQuota.effective5hPct, 65);
    assert.equal(q2.effectiveQuota.effective7dPct, 88, 'Partial 5h live sync must preserve existing 7d quota');
    const qEmpty = mgr.syncActiveAccountQuota({});
    assert.equal(qEmpty.ok, true);
    assert.equal(qEmpty.skipped, true);

    // 2. Uncaptured new account: dryRun previews auto-capture; failed swap rolls back cleanly; live swap auto-captures into backup slot
    fakeCredStore.set('gemini:antigravity', makeCredBlob('fresh@example.com', 'tok_fresh'));
    const dryAuto = mgr.switchAccount(mainCap.account.id, { dryRun: true, autoCaptureUncaptured: true, saveSnapshot: false });
    assert.equal(dryAuto.ok, true);
    assert.equal(dryAuto.wouldAutoCapture?.email, 'fresh@example.com');
    assert.equal(mgr.getStatus().accounts.length, 1, 'dryRun must not mutate accounts.json');

    forceActiveFail = true;
    activeWriteCount = 0;
    assert.throws(() => mgr.switchAccount(mainCap.account.id, { autoCaptureUncaptured: true, saveSnapshot: false }), (e) => e.rolledBack === true);
    forceActiveFail = false;
    assert.equal(mgr.getStatus().accounts.length, 1, 'Failed auto-capture swap must not leave ghost account metadata');

    const liveAuto = mgr.switchAccount(mainCap.account.id, { autoCaptureUncaptured: true, saveSnapshot: false });
    assert.equal(liveAuto.ok, true);
    assert.equal(liveAuto.autoCapturedActive?.email, 'fresh@example.com');
    assert.equal(mgr.getStatus().accounts.length, 2);
    assert.equal(extractCredentialEmail(fakeCredStore.get('gemini:antigravity')), 'main@example.com');
    assert.equal(extractCredentialEmail(fakeCredStore.get(`prism-suite:account:${liveAuto.autoCapturedActive.id}`)), 'fresh@example.com');

    // 3. lastTab state persistence in prism-files MCP server
    const srv = createPrismFilesServer({ dataDir: path.join(tmp, 'srv-data'), defaultRoot: tmp, accountStateDir: stateDir, accountManager: mgr });
    await srv.handleToolCall('update_state', { lastTab: 'accounts' });
    const reopened = await srv.handleToolCall('open_prism_files', {});
    assert.equal(reopened.structuredContent.tab, 'accounts', 'open_prism_files without explicit tab should restore lastTab');
    const explicitTab = await srv.handleToolCall('open_prism_files', { tab: 'browse' });
    assert.equal(explicitTab.structuredContent.tab, 'browse', 'Explicit tab argument overrides lastTab');

    // 4. Static contract checks for bridge ping/pong/ack, account capsule, all switch entries, keyboard flow, line-range quote, in-place Win installer, and v0.5.0 release consistency
    const jsSrc = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite.js'), 'utf8');
    const fxSrc = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite-fx.js'), 'utf8');
    const cssSrc = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite.css'), 'utf8');
    const appHtml = fs.readFileSync(path.join(REPO, 'plugin', 'ui', 'app.html'), 'utf8');
    const inlineHtml = fs.readFileSync(path.join(REPO, 'plugin', 'ui', 'inline.html'), 'utf8');
    const csSrc = fs.readFileSync(path.join(REPO, 'installer', 'win', 'PrismSuiteInstaller.cs'), 'utf8');
    const pkgJson = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    const pluginJson = JSON.parse(fs.readFileSync(path.join(REPO, 'plugin', 'plugin.json'), 'utf8'));

    assert.equal(pkgJson.version, '0.5.0');
    assert.equal(pluginJson.version, '0.5.0');
    assert.equal(Object.keys(pkgJson.dependencies || {}).length, 0, 'Must maintain zero external runtime npm dependencies');
    assert.match(jsSrc, /SUITE_VERSION = '0\.5\.0'/);
    assert.match(inlineHtml, /version: '0\.5\.0'/);
    assert.match(jsSrc, /__agPrismBridge/);
    assert.match(jsSrc, /bridge-ping/);
    assert.match(jsSrc, /bridge-pong/);
    assert.match(jsSrc, /dispatchSwitchTabWithRetry/);
    assert.match(jsSrc, /openWorkbench: openPrismWorkbenchQuick/);
    assert.match(jsSrc, /data-open-workbench-tab="accounts"/);
    assert.match(jsSrc, /parseRelativeResetToIso/);
    assert.match(fxSrc, /ag-ps-nudge-btn-switch/);
    assert.match(fxSrc, /bus\.openWorkbench\('accounts'\)/);
    assert.match(cssSrc, /\.ag-ps-account-bar/);
    assert.match(appHtml, /is-compact-controls/);
    assert.match(appHtml, /btn-preview-copy/);
    assert.match(appHtml, /code-ln/);
    assert.match(appHtml, /stepActiveListSelection/);
    assert.match(appHtml, /autoCaptureUncaptured/);
    assert.match(appHtml, /accounts_relaunch_client/);
    assert.match(appHtml, /navigateFromExternalBridge/);
    assert.match(appHtml, /isExternalNavLocked/);
    assert.match(appHtml, /is-focus-flash/);
    assert.match(csSrc, /PruneObsoletePluginEntries/);
    assert.match(csSrc, /CheckDebugPortShortcutStatus/);
    assert.match(csSrc, /v0\.5\.0/);
    const installPluginSlice = csSrc.slice(csSrc.indexOf('public static int InstallPlugin('), csSrc.indexOf('private static bool IsReparsePoint('));
    assert.doesNotMatch(installPluginSlice, /Directory\.Delete\(targetDir,\s*true\)/, 'InstallPlugin must update in-place without deleting prism-files root');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
