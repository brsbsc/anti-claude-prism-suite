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
  APP_URI,
  INLINE_URI,
  APP_MIME_TYPE
} from '../plugin/server/index.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('extension JS syntax is valid and enforces zero-body-observer performance guards', () => {
  const jsPath = path.join(REPO, 'extensions', 'prism-suite.js');
  const cssPath = path.join(REPO, 'extensions', 'prism-suite.css');
  assert.equal(fs.existsSync(jsPath), true);
  assert.equal(fs.existsSync(cssPath), true);

  execFileSync(process.execPath, ['--check', jsPath], { stdio: 'pipe' });

  const jsSrc = fs.readFileSync(jsPath, 'utf8');
  const cssSrc = fs.readFileSync(cssPath, 'utf8');
  assert.match(jsSrc, /__agPrismSuiteDispose/);
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

test('installExtensions and uninstallExtensions round-trip cleanly without touching other files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-suite-test-'));
  try {
    const userDir = path.join(tmp, 'user');
    const keepFile = path.join(userDir, 'extensions', 'other-ext.js');
    fs.mkdirSync(path.dirname(keepFile), { recursive: true });
    fs.writeFileSync(keepFile, '// keep me');

    const ins = installExtensions({ userDir });
    assert.equal(ins.installed.length, 2);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite.css')), true);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite.js')), true);

    const un = uninstallExtensions({ userDir });
    assert.equal(un.removed.length, 2);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite.css')), false);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite.js')), false);
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
    assert.equal(res.extensions.installed.length, 2);
    assert.equal(fs.existsSync(path.join(pluginsDir, 'prism-files', 'plugin.json')), true);
    assert.equal(fs.existsSync(path.join(pluginsDir, 'prism-files', 'server', 'index.mjs')), true);
    assert.equal(fs.existsSync(path.join(pluginsDir, 'prism-files', 'ui', 'app.html')), true);
    assert.equal(fs.existsSync(path.join(pluginsDir, 'prism-files', 'ui', 'inline.html')), true);

    const un = uninstallAll({ userDir, pluginsDir });
    assert.equal(un.extensions.removed.length, 2);
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

    const srv = createPrismFilesServer({ dataDir, defaultRoot: workDir });

    // Protocol handshake & tool visibility
    const init = await srv.handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    assert.equal(init.result.capabilities.resources !== undefined, true);
    const listRes = await srv.handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const modelTools = listRes.result.tools.filter((t) => !(t._meta?.ui?.visibility?.length === 1 && t._meta.ui.visibility[0] === 'app'));
    assert.deepEqual(modelTools.map((t) => t.name).sort(), ['open_prism_files', 'show_files_inline']);

    // Resources return strict MCP App MIME type
    const appHtmlRes = await srv.handleRpc({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: APP_URI } });
    assert.equal(appHtmlRes.result.contents[0].mimeType, APP_MIME_TYPE);
    assert.match(appHtmlRes.result.contents[0].text, /ui\/initialize/);
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
