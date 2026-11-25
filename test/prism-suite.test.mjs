import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installExtensions } from '../install.mjs';
import { uninstallExtensions } from '../uninstall.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('extension JS syntax is valid and exposes clean dispose hook', () => {
  const jsPath = path.join(REPO, 'extensions', 'prism-suite.js');
  const cssPath = path.join(REPO, 'extensions', 'prism-suite.css');
  assert.equal(fs.existsSync(jsPath), true);
  assert.equal(fs.existsSync(cssPath), true);

  execFileSync(process.execPath, ['--check', jsPath], { stdio: 'pipe' });

  const jsSrc = fs.readFileSync(jsPath, 'utf8');
  const cssSrc = fs.readFileSync(cssPath, 'utf8');
  assert.match(jsSrc, /__agPrismSuiteDispose/);
  assert.match(jsSrc, /positionFloatingPanel/);
  assert.match(jsSrc, /translateText/);
  assert.match(jsSrc, /getUsageSummary/);
  assert.match(cssSrc, /data-ag-ps-light="crystal"/);
  assert.match(cssSrc, /data-ag-ps-dark="obsidian"/);
  assert.match(cssSrc, /::highlight\(ag-ps-ink-1\)/);
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
