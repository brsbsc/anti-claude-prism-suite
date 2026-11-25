import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installExtensions } from '../install.mjs';
import { uninstallExtensions } from '../uninstall.mjs';
import { inspectLocalDaemon } from '../scripts/check-upstream.mjs';

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
  assert.doesNotMatch(jsSrc, /streamObserver\.observe\(document\.body/, 'Must never permanently observe document.body');
  assert.match(cssSrc, /data-ag-ps-light="crystal"/);
  assert.match(cssSrc, /data-ag-ps-dark="obsidian"/);
  assert.match(cssSrc, /color-mix\(in srgb, var\(--foreground/);
  assert.match(cssSrc, /agPsLeap/);
  assert.match(cssSrc, /agPsFlipR/);
  assert.match(cssSrc, /agPsRollR/);
  assert.match(cssSrc, /agPsDoubleHop/);
  assert.match(cssSrc, /agPsWiggle/);
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
