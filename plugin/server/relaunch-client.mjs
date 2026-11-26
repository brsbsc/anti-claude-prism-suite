/**
 * Detached, process-tree-independent Antigravity client relauncher (v0.5.0).
 *
 * Design guarantees:
 * - Zero external dependencies, MIT clean-room implementation.
 * - Preserves `--remote-debugging-port=0` when active or Anti-Claude extensions are present.
 * - Uses Explorer ShellExecute COM -> WMI Win32_Process.Create -> Start-Process fallback
 *   on Windows/WSL2 so closing the current Antigravity window does NOT kill the relaunch worker.
 * - Only signals Antigravity.exe matching the resolved executable path; never touches unrelated apps.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  cleanPowerShellError,
  detectIsWsl,
  resolveSafeExecCwd,
  resolveWslInteropEnv
} from './account-vault.mjs';

function psSingleQuote(val) {
  return `'${String(val ?? '').replace(/'/g, "''")}'`;
}

function resolvePowerShellExe(isWsl) {
  if (!isWsl) {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    const full = path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return fs.existsSync(full) ? full : 'powershell.exe';
  }
  const wslPs = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  return fs.existsSync(wslPs) ? wslPs : 'powershell.exe';
}

function defaultRunCmd(bin, args, { input = '', timeoutMs = 10000, cwd, env } = {}) {
  const res = spawnSync(bin, args, {
    input,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    ...(cwd ? { cwd } : {}),
    ...(env ? { env } : {})
  });
  if (res.error) throw res.error;
  return {
    status: res.status ?? (res.signal ? 1 : 0),
    signal: res.signal || '',
    stdout: res.stdout || '',
    stderr: res.stderr || ''
  };
}

function defaultSpawnDetached(bin, args, options = {}) {
  const child = spawn(bin, args, {
    shell: false,
    detached: true,
    stdio: 'ignore',
    ...options
  });
  child.unref();
  return true;
}

const PS_PROBE_TARGET_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$target = ''
$hasDebug = $false
$mainProc = Get-CimInstance Win32_Process -Filter "Name='Antigravity.exe'" | Where-Object { $_.ExecutablePath -and ($_.CommandLine -notmatch '--type=') } | Select-Object -First 1
if ($mainProc) {
  $target = [string]$mainProc.ExecutablePath
  if ([string]$mainProc.CommandLine -match '--remote-debugging-port') { $hasDebug = $true }
}
if (-not $target) {
  $cands = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\Antigravity.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'),
    'C:\Program Files\Antigravity\Antigravity.exe',
    'D:\Program Files\Antigravity\Antigravity.exe'
  )
  foreach ($c in $cands) {
    if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) { $target = $c; break }
  }
}
$antiClaudeDir = Join-Path $env:USERPROFILE '.gemini\antigravity\anti-claude'
$hasAntiClaude = Test-Path -LiteralPath $antiClaudeDir -PathType Container
Write-Output (ConvertTo-Json -Compress @{ ok = $true; targetPath = $target; hasDebug = [bool]$hasDebug; hasAntiClaude = [bool]$hasAntiClaude })
`;

const PS_PROBE_TARGET_ENCODED = Buffer.from(PS_PROBE_TARGET_SCRIPT, 'utf16le').toString('base64');

export function buildWinRelaunchWorkerScript({
  targetPath,
  preserveDebugPort = true,
  delayMs = 650
} = {}) {
  const safeDelay = Math.max(250, Math.min(5000, Math.round(Number(delayMs) || 650)));
  const launchArgLine = preserveDebugPort ? '--remote-debugging-port=0' : '';
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `Start-Sleep -Milliseconds ${safeDelay}`,
    `$target = ${psSingleQuote(targetPath)}`,
    '$targetDir = Split-Path -Parent $target',
    'function Get-AgyTargetProcs {',
    "  @(Get-CimInstance Win32_Process -Filter \"Name='Antigravity.exe'\" | Where-Object {",
    '    -not $_.ExecutablePath -or $_.ExecutablePath.Equals($target, [System.StringComparison]::OrdinalIgnoreCase)',
    '  })',
    '}',
    '$origPids = @((Get-AgyTargetProcs) | ForEach-Object { [int]$_.ProcessId } | Where-Object { $_ -gt 0 })',
    'function Get-AgyOrigRemaining {',
    '  if ($origPids.Count -eq 0) { return @() }',
    "  @(Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue | Where-Object { $origPids -contains $_.Id })",
    '}',
    "foreach ($p in (Get-AgyOrigRemaining)) {",
    '  if ($p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() }',
    '}',
    '$deadline = (Get-Date).AddMilliseconds(4500)',
    'while ((Get-Date) -lt $deadline) {',
    '  if ((Get-AgyOrigRemaining).Count -eq 0) { break }',
    '  Start-Sleep -Milliseconds 200',
    '}',
    'foreach ($p in (Get-AgyOrigRemaining)) {',
    '  Stop-Process -Id $p.Id -Force',
    '}',
    '$waitDead = (Get-Date).AddMilliseconds(3000)',
    'while ((Get-Date) -lt $waitDead) {',
    '  if ((Get-AgyOrigRemaining).Count -eq 0) { break }',
    '  Start-Sleep -Milliseconds 180',
    '}',
    'Start-Sleep -Milliseconds 400',
    'Remove-Item Env:ELECTRON_RUN_AS_NODE,Env:NODE_OPTIONS,Env:ANTIGRAVITY_LS_ADDRESS,Env:ANTIGRAVITY_CSRF_TOKEN,Env:ANTIGRAVITY_AGENTAPI_EXE -ErrorAction SilentlyContinue',
    "Get-ChildItem Env:ANTIGRAVITY_SIDECAR_* -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item ('Env:' + $_.Name) -ErrorAction SilentlyContinue }",
    `$argLine = ${psSingleQuote(launchArgLine)}`,
    'if ($argLine) {',
    '  Start-Process -FilePath $target -ArgumentList $argLine -WorkingDirectory $targetDir',
    '} else {',
    '  Start-Process -FilePath $target -WorkingDirectory $targetDir',
    '}',
    'Start-Sleep -Milliseconds 1200',
    'if ((Get-AgyTargetProcs).Count -eq 0) {',
    '  try {',
    "    $sw = [Activator]::CreateInstance([Type]::GetTypeFromCLSID([Guid]'9BA05972-F6A8-11CF-A442-00A0C90A8F39'))",
    '    $h = 0; $d = $sw.FindWindowSW(0, 0, 8, [ref]$h, 1)',
    "    if ($d -and $d.Document -and $d.Document.Application) { $d.Document.Application.ShellExecute($target, $argLine, $targetDir, 'open', 1) }",
    '  } catch {}',
    '}'
  ].join('\r\n');
}

export function buildWinDetachedDispatchScript(workerEncoded) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$psExe = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
    "if (-not (Test-Path -LiteralPath $psExe)) { $psExe = 'powershell.exe' }",
    `$psArgs = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand ' + ${psSingleQuote(workerEncoded)}`,
    "$method = ''",
    'try {',
    "  $sw = [Activator]::CreateInstance([Type]::GetTypeFromCLSID([Guid]'9BA05972-F6A8-11CF-A442-00A0C90A8F39'))",
    '  $hwnd = 0',
    '  $disp = $sw.FindWindowSW(0, 0, 8, [ref]$hwnd, 1)',
    '  if ($disp -and $disp.Document -and $disp.Document.Application) {',
    "    $disp.Document.Application.ShellExecute($psExe, $psArgs, '', 'open', 0)",
    "    $method = 'explorer'",
    '  }',
    '} catch {}',
    'if (-not $method) {',
    '  try {',
    '    $cmdLine = \'"\' + $psExe + \'" \' + $psArgs',
    "    $wmi = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmdLine }",
    '    if ($wmi -and [int]$wmi.ReturnValue -eq 0) { $method = \'wmi\' }',
    '  } catch {}',
    '}',
    'if (-not $method) {',
    '  Start-Process -FilePath $psExe -ArgumentList $psArgs -WindowStyle Hidden',
    "  $method = 'start-process'",
    '}',
    'Write-Output (ConvertTo-Json -Compress @{ ok = $true; method = $method })'
  ].join('\r\n');
}

export function resolveLocalAntigravityTarget({
  platform = process.platform,
  isWsl = detectIsWsl({ platform }),
  homeDir = os.homedir(),
  env = process.env,
  runCmd = defaultRunCmd,
  existsSync = fs.existsSync
} = {}) {
  const antiClaudeLocal = existsSync(path.join(homeDir, '.gemini', 'antigravity', 'anti-claude'));

  if (platform === 'win32' || isWsl) {
    const psExe = resolvePowerShellExe(isWsl);
    const execCwd = resolveSafeExecCwd({ isWsl, platform, homeDir });
    const execEnv = resolveWslInteropEnv(env, isWsl);
    const res = runCmd(
      psExe,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', PS_PROBE_TARGET_ENCODED],
      { timeoutMs: 10000, cwd: execCwd, env: execEnv }
    );
    if (res.status !== 0) {
      throw new Error(`探测 Antigravity 安装路径失败: ${cleanPowerShellError(res.stderr, res.stdout, res.status, res.signal)}`);
    }
    const line = String(res.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '{}';
    const parsed = JSON.parse(line);
    const targetPath = String(parsed.targetPath || '').trim();
    if (!targetPath) {
      return { found: false, targetPath: '', preserveDebugPort: false, launchArgs: [] };
    }
    const preserveDebugPort = Boolean(parsed.hasDebug || parsed.hasAntiClaude || antiClaudeLocal);
    return {
      found: true,
      targetPath,
      preserveDebugPort,
      launchArgs: preserveDebugPort ? ['--remote-debugging-port=0'] : []
    };
  }

  if (platform === 'darwin') {
    for (const candidate of ['/Applications/Antigravity.app', path.join(homeDir, 'Applications', 'Antigravity.app')]) {
      if (existsSync(candidate)) {
        return {
          found: true,
          targetPath: candidate,
          preserveDebugPort: antiClaudeLocal,
          launchArgs: antiClaudeLocal ? ['--remote-debugging-port=0'] : []
        };
      }
    }
    return { found: false, targetPath: '', preserveDebugPort: false, launchArgs: [] };
  }

  if (platform === 'linux') {
    const cands = [
      env?.APPIMAGE,
      '/usr/share/antigravity/antigravity',
      '/opt/Antigravity/antigravity',
      '/usr/bin/antigravity'
    ].filter(Boolean);
    for (const candidate of cands) {
      if (existsSync(candidate)) {
        return {
          found: true,
          targetPath: candidate,
          preserveDebugPort: antiClaudeLocal,
          launchArgs: antiClaudeLocal ? ['--remote-debugging-port=0'] : []
        };
      }
    }
    return { found: false, targetPath: '', preserveDebugPort: false, launchArgs: [] };
  }

  return { found: false, targetPath: '', preserveDebugPort: false, launchArgs: [] };
}

export function createClientRelauncher(options = {}) {
  const platform = options.platform || process.platform;
  const isWsl = options.isWsl !== undefined ? Boolean(options.isWsl) : detectIsWsl({ platform });
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const env = options.env || process.env;
  const runCmd = options.runCmd || defaultRunCmd;
  const spawnDetached = options.spawnDetached || defaultSpawnDetached;
  const existsSync = options.existsSync || fs.existsSync;

  function scheduleRelaunch({ dryRun = false, delayMs = 650 } = {}) {
    let targetInfo;
    try {
      targetInfo = resolveLocalAntigravityTarget({ platform, isWsl, homeDir, env, runCmd, existsSync });
    } catch (err) {
      return { ok: false, code: 'CLIENT_PROBE_FAILED', error: String(err?.message || err) };
    }

    if (!targetInfo.found || !targetInfo.targetPath) {
      return {
        ok: false,
        code: 'CLIENT_NOT_FOUND',
        error: '未检测到本机 Antigravity 可执行文件，请手动重启客户端生效'
      };
    }

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        scheduled: false,
        platform,
        isWsl,
        targetPath: targetInfo.targetPath,
        launchArgs: targetInfo.launchArgs,
        preserveDebugPort: targetInfo.preserveDebugPort
      };
    }

    if (platform === 'win32' || isWsl) {
      const workerScript = buildWinRelaunchWorkerScript({
        targetPath: targetInfo.targetPath,
        preserveDebugPort: targetInfo.preserveDebugPort,
        delayMs
      });
      const workerEncoded = Buffer.from(workerScript, 'utf16le').toString('base64');
      const dispatchScript = buildWinDetachedDispatchScript(workerEncoded);
      const dispatchEncoded = Buffer.from(dispatchScript, 'utf16le').toString('base64');
      const psExe = resolvePowerShellExe(isWsl);
      const execCwd = resolveSafeExecCwd({ isWsl, platform, homeDir });
      const execEnv = resolveWslInteropEnv(env, isWsl);

      const res = runCmd(
        psExe,
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', dispatchEncoded],
        { timeoutMs: 10000, cwd: execCwd, env: execEnv }
      );
      if (res.status !== 0) {
        return {
          ok: false,
          code: 'RELAUNCH_DISPATCH_FAILED',
          error: `拉起重启进程失败: ${cleanPowerShellError(res.stderr, res.stdout, res.status, res.signal)}`
        };
      }
      let method = 'powershell';
      try {
        const line = String(res.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '{}';
        const parsed = JSON.parse(line);
        if (parsed?.method) method = String(parsed.method);
      } catch {}
      return {
        ok: true,
        dryRun: false,
        scheduled: true,
        method,
        targetPath: targetInfo.targetPath,
        preserveDebugPort: targetInfo.preserveDebugPort,
        message: '已脱离进程树调度 Antigravity 重启，客户端将在 1 秒内关闭并自动重开…'
      };
    }

    const delaySec = (Math.max(250, Math.min(5000, Number(delayMs) || 650)) / 1000).toFixed(2);
    if (platform === 'darwin') {
      const argsArg = targetInfo.preserveDebugPort ? ' --args --remote-debugging-port=0' : '';
      const script = [
        `sleep ${delaySec}`,
        'osascript -e \'tell application "Antigravity" to quit\' >/dev/null 2>&1 || true',
        'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do pgrep -x Antigravity >/dev/null 2>&1 || break; sleep 0.3; done',
        'pkill -x Antigravity >/dev/null 2>&1 || true',
        'sleep 0.5',
        `open -n -a ${JSON.stringify(targetInfo.targetPath)}${argsArg}`
      ].join('; ');
      spawnDetached('/bin/sh', ['-c', script], { cwd: homeDir });
      return {
        ok: true,
        dryRun: false,
        scheduled: true,
        method: 'macos-open',
        targetPath: targetInfo.targetPath,
        preserveDebugPort: targetInfo.preserveDebugPort,
        message: '已调度 Antigravity 自动重启…'
      };
    }

    if (platform === 'linux') {
      const argsPart = targetInfo.preserveDebugPort ? ' --remote-debugging-port=0' : '';
      const script = [
        `sleep ${delaySec}`,
        'pkill -TERM -x antigravity >/dev/null 2>&1 || true',
        'sleep 1.2',
        `nohup ${JSON.stringify(targetInfo.targetPath)}${argsPart} >/dev/null 2>&1 &`
      ].join('; ');
      spawnDetached('/bin/sh', ['-c', script], { cwd: homeDir });
      return {
        ok: true,
        dryRun: false,
        scheduled: true,
        method: 'linux-nohup',
        targetPath: targetInfo.targetPath,
        preserveDebugPort: targetInfo.preserveDebugPort,
        message: '已调度 Antigravity 自动重启…'
      };
    }

    return { ok: false, code: 'UNSUPPORTED_PLATFORM', error: `当前平台暂不支持自动重启: ${platform}` };
  }

  return {
    resolveTarget: () => resolveLocalAntigravityTarget({ platform, isWsl, homeDir, env, runCmd, existsSync }),
    scheduleRelaunch
  };
}
