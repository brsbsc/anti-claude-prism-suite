[CmdletBinding()]
param(
    [string]$OutDir = "dist"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$SourceCs = Join-Path (Join-Path $RepoRoot "installer") (Join-Path "win" "PrismSuiteInstaller.cs")
$ExtDir = Join-Path $RepoRoot "extensions"
$ChromeBridgeDir = Join-Path $ExtDir "chrome-cua-bridge"
$PluginDir = Join-Path $RepoRoot "plugin"
$PluginCuaDir = Join-Path $RepoRoot "plugin-cua"
$KernelDir = Join-Path (Join-Path $RepoRoot "vendor") "anti-claude"
$WinCuaCs = Join-Path (Join-Path $RepoRoot "native") (Join-Path "win-cua" "PrismWinCua.cs")

function Assert-NoCommaInPath {
    param(
        [Parameter(Mandatory = $true)][string]$PathValue,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if ($PathValue.Contains(",")) {
        throw ("Path contains comma (',') which breaks csc.exe /resource: parsing ({0}): {1}" -f $Label, $PathValue)
    }
}

Assert-NoCommaInPath -PathValue $RepoRoot -Label "RepoRoot"
Assert-NoCommaInPath -PathValue $SourceCs -Label "SourceCs"

if (-not (Test-Path -LiteralPath $SourceCs -PathType Leaf)) {
    throw "Missing installer source file: $SourceCs"
}
if (-not (Test-Path -LiteralPath $ExtDir -PathType Container)) {
    throw "Missing extensions directory: $ExtDir"
}
if (-not (Test-Path -LiteralPath $ChromeBridgeDir -PathType Container)) {
    throw "Missing chrome-cua-bridge directory: $ChromeBridgeDir"
}
if (-not (Test-Path -LiteralPath $PluginDir -PathType Container)) {
    throw "Missing plugin directory: $PluginDir"
}
if (-not (Test-Path -LiteralPath $KernelDir -PathType Container)) {
    throw "Missing bundled Anti-Claude kernel directory: $KernelDir"
}
foreach ($requiredKernel in @("install.mjs", "package.json", "LICENSE", "cli\statusline.mjs", "rules\claude-execution-sync.md", "core\daemon.mjs", "core\runtime.js", "core\base.css", "core\i18n.json", "user\custom.js", "user\custom.css", "user\config.json", "user\i18n.override.json")) {
    $reqKernelPath = Join-Path $KernelDir $requiredKernel
    if (-not (Test-Path -LiteralPath $reqKernelPath -PathType Leaf)) {
        throw "Missing required Anti-Claude kernel file: $reqKernelPath"
    }
}

foreach ($requiredExt in @("prism-suite.css", "prism-suite.js", "prism-suite-fx.css", "prism-suite-fx.js", "prism-suite-workflow.css", "prism-suite-workflow.js")) {
    $reqPath = Join-Path $ExtDir $requiredExt
    if (-not (Test-Path -LiteralPath $reqPath -PathType Leaf)) {
        throw "Missing required extension file: $reqPath"
    }
}

foreach ($requiredPlugin in @(
    "plugin.json",
    "mcp_config.json",
    "upstream.json",
    "rules\AGENTS.md",
    "server\index.mjs",
    "server\platform-utils.mjs",
    "server\prism-profile.mjs",
    "server\model-hub.mjs",
    "server\handoff-memory.mjs",
    "server\account-manager.mjs",
    "server\account-vault.mjs",
    "server\relaunch-client.mjs",
    "server\upstream-radar.mjs",
    "ui\app.html",
    "ui\inline.html",
    "skills\prism-cross-model-council\SKILL.md",
    "skills\prism-slot-relay\SKILL.md",
    "skills\prism-upstream-absorb\SKILL.md"
)) {
    $reqPluginPath = Join-Path $PluginDir $requiredPlugin
    if (-not (Test-Path -LiteralPath $reqPluginPath -PathType Leaf)) {
        throw "Missing required plugin file: $reqPluginPath"
    }
}

foreach ($requiredBridge in @("manifest.json", "background.js", "popup.html", "popup.js", "content-agent.js", "icons\icon16.png", "icons\icon48.png", "icons\icon128.png")) {
    $reqBridgePath = Join-Path $ChromeBridgeDir $requiredBridge
    if (-not (Test-Path -LiteralPath $reqBridgePath -PathType Leaf)) {
        throw "Missing required chrome-cua-bridge file: $reqBridgePath"
    }
}

$CscCandidates = @(
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$CscExe = $null
foreach ($candidate in $CscCandidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        $CscExe = $candidate
        break
    }
}
if (-not $CscExe) {
    throw "Could not find .NET Framework 4.x csc.exe at expected paths."
}
$FrameworkDir = Split-Path -Parent $CscExe
$WpfDir = Join-Path $FrameworkDir "WPF"

if ([System.IO.Path]::IsPathRooted($OutDir)) {
    $ResolvedOutDir = [System.IO.Path]::GetFullPath($OutDir)
} else {
    $ResolvedOutDir = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $OutDir))
}
if (-not (Test-Path -LiteralPath $ResolvedOutDir -PathType Container)) {
    New-Item -ItemType Directory -Path $ResolvedOutDir -Force | Out-Null
}

$OutExe = Join-Path $ResolvedOutDir "Anti-Claude-Prism-Suite-Setup.exe"
$OutSha = Join-Path $ResolvedOutDir "Anti-Claude-Prism-Suite-Setup.exe.sha256"

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("prism-win-build-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

function Compute-Sha256Hex([string]$FilePath) {
    $shaObj = [System.Security.Cryptography.SHA256]::Create()
    try {
        $stream = [System.IO.File]::OpenRead($FilePath)
        try {
            $bytes = $shaObj.ComputeHash($stream)
        } finally {
            $stream.Dispose()
        }
    } finally {
        $shaObj.Dispose()
    }
    return ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
}

try {
    Assert-NoCommaInPath -PathValue $TempDir -Label "TempDir"
    $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $Utf8WithBom = New-Object System.Text.UTF8Encoding($true)

    # Step 1: Compile native\win-cua\PrismWinCua.cs first if present
    $CompiledWinCua = $false
    $CuaExeTemp = Join-Path $TempDir "prism-win-cua.exe"
    $CuaShaTemp = Join-Path $TempDir "prism-win-cua.exe.sha256"
    if (Test-Path -LiteralPath $WinCuaCs -PathType Leaf) {
        $CuaRspLines = New-Object System.Collections.Generic.List[string]
        $CuaRspLines.Add("/nologo")
        $CuaRspLines.Add("/target:winexe")
        $CuaRspLines.Add("/optimize+")
        $CuaRspLines.Add("/codepage:65001")
        $CuaRspLines.Add("/utf8output")
        $CuaRspLines.Add(('"/out:{0}"' -f $CuaExeTemp))
        if (Test-Path -LiteralPath $WpfDir -PathType Container) {
            $CuaRspLines.Add(('"/lib:{0}"' -f $WpfDir))
        }
        foreach ($stdDll in @("System.dll", "System.Core.dll", "System.Web.Extensions.dll", "System.Windows.Forms.dll", "System.Drawing.dll")) {
            $CuaRspLines.Add(("/reference:{0}" -f $stdDll))
        }
        foreach ($wpfDll in @("UIAutomationClient.dll", "UIAutomationTypes.dll", "WindowsBase.dll")) {
            $wpfFull = Join-Path $WpfDir $wpfDll
            if (Test-Path -LiteralPath $wpfFull -PathType Leaf) {
                $CuaRspLines.Add(('"/reference:{0}"' -f $wpfFull))
            } else {
                $CuaRspLines.Add(("/reference:{0}" -f $wpfDll))
            }
        }
        $CuaRspLines.Add(('"{0}"' -f $WinCuaCs))
        $CuaRspPath = Join-Path $TempDir "build-cua.rsp"
        [System.IO.File]::WriteAllText($CuaRspPath, ($CuaRspLines -join "`r`n") + "`r`n", $Utf8WithBom)

        Write-Host "Compiling native prism-win-cua.exe with $CscExe ..."
        & $CscExe ("@" + $CuaRspPath)
        if ($LASTEXITCODE -ne 0) {
            throw "csc.exe failed compiling PrismWinCua.cs with exit code $LASTEXITCODE"
        }
        if (-not (Test-Path -LiteralPath $CuaExeTemp -PathType Leaf)) {
            throw "Expected prism-win-cua.exe was not created: $CuaExeTemp"
        }
        $cuaHashHex = Compute-Sha256Hex -FilePath $CuaExeTemp
        [System.IO.File]::WriteAllText($CuaShaTemp, ("{0}  prism-win-cua.exe`n" -f $cuaHashHex), $Utf8NoBom)
        $CompiledWinCua = $true
        Write-Host "Compiled prism-win-cua.exe (SHA256: $cuaHashHex)"
    }
    $IgnoredNames = @(".DS_Store", "Thumbs.db")
    $ExcludedDirs = @(".git", "node_modules")

    function Test-ShouldIncludePayloadFile {
        param(
            [Parameter(Mandatory = $true)][System.IO.FileInfo]$File,
            [Parameter(Mandatory = $true)][string]$RootDir
        )
        $name = $File.Name
        foreach ($ign in $IgnoredNames) {
            if ($name.Equals($ign, [System.StringComparison]::OrdinalIgnoreCase)) {
                return $false
            }
        }
        if ($name.EndsWith(".tmp", [System.StringComparison]::OrdinalIgnoreCase) `
            -or $name.EndsWith(".log", [System.StringComparison]::OrdinalIgnoreCase) `
            -or $name.Equals(".env", [System.StringComparison]::OrdinalIgnoreCase) `
            -or $name.StartsWith(".env.", [System.StringComparison]::OrdinalIgnoreCase) `
            -or $name.Equals(".git", [System.StringComparison]::OrdinalIgnoreCase)) {
            return $false
        }
        $rootLen = $RootDir.TrimEnd("\", "/").Length
        $rel = $File.FullName.Substring($rootLen).TrimStart("\", "/")
        $segments = $rel -split '[/\\]'
        for ($i = 0; $i -lt ($segments.Length - 1); $i++) {
            foreach ($exDir in $ExcludedDirs) {
                if ($segments[$i].Equals($exDir, [System.StringComparison]::OrdinalIgnoreCase)) {
                    return $false
                }
            }
        }
        return $true
    }

    $ManifestLines = New-Object System.Collections.Generic.List[string]
    $RspLines = New-Object System.Collections.Generic.List[string]

    $RspLines.Add("/nologo")
    $RspLines.Add("/target:winexe")
    $RspLines.Add("/optimize+")
    $RspLines.Add("/codepage:65001")
    $RspLines.Add("/utf8output")
    $RspLines.Add(('"/out:{0}"' -f $OutExe))
    $RspLines.Add("/reference:System.Windows.Forms.dll")
    $RspLines.Add("/reference:System.Drawing.dll")

    $resIndex = 0

    $extFiles = @(Get-ChildItem -LiteralPath $ExtDir -File |
        Where-Object { Test-ShouldIncludePayloadFile -File $_ -RootDir $ExtDir } |
        Sort-Object -Property Name)

    foreach ($file in $extFiles) {
        Assert-NoCommaInPath -PathValue $file.FullName -Label "ExtensionFile"
        $rel = $file.Name.Replace("\", "/")
        $resName = "payload.extensions.res_" + $resIndex
        $ManifestLines.Add(("{0}|extensions/{1}" -f $resName, $rel))
        $RspLines.Add(('"/resource:{0},{1}"' -f $file.FullName, $resName))
        $resIndex++
    }

    $bridgeRootLen = $ChromeBridgeDir.TrimEnd("\", "/").Length
    $bridgeFiles = @(Get-ChildItem -LiteralPath $ChromeBridgeDir -Recurse -File |
        Where-Object { Test-ShouldIncludePayloadFile -File $_ -RootDir $ChromeBridgeDir } |
        Sort-Object -Property FullName)

    foreach ($file in $bridgeFiles) {
        Assert-NoCommaInPath -PathValue $file.FullName -Label "ChromeBridgeFile"
        $rel = $file.FullName.Substring($bridgeRootLen).TrimStart("\", "/").Replace("\", "/")
        $resName = "payload.chromebridge.res_" + $resIndex
        $ManifestLines.Add(("{0}|chrome-bridge/{1}" -f $resName, $rel))
        $RspLines.Add(('"/resource:{0},{1}"' -f $file.FullName, $resName))
        $resIndex++
    }

    $pluginRootLen = $PluginDir.TrimEnd("\", "/").Length
    $pluginFiles = @(Get-ChildItem -LiteralPath $PluginDir -Recurse -File |
        Where-Object { Test-ShouldIncludePayloadFile -File $_ -RootDir $PluginDir } |
        Sort-Object -Property FullName)

    if ($pluginFiles.Count -eq 0) {
        throw "No plugin files found under: $PluginDir"
    }

    foreach ($file in $pluginFiles) {
        Assert-NoCommaInPath -PathValue $file.FullName -Label "PluginFile"
        $rel = $file.FullName.Substring($pluginRootLen).TrimStart("\", "/").Replace("\", "/")
        $resName = "payload.plugin.res_" + $resIndex
        $ManifestLines.Add(("{0}|plugin/{1}" -f $resName, $rel))
        $RspLines.Add(('"/resource:{0},{1}"' -f $file.FullName, $resName))
        $resIndex++
    }

    if (Test-Path -LiteralPath $PluginCuaDir -PathType Container) {
        $pluginCuaRootLen = $PluginCuaDir.TrimEnd("\", "/").Length
        $pluginCuaFiles = @(Get-ChildItem -LiteralPath $PluginCuaDir -Recurse -File |
            Where-Object { Test-ShouldIncludePayloadFile -File $_ -RootDir $PluginCuaDir } |
            Sort-Object -Property FullName)

        foreach ($file in $pluginCuaFiles) {
            Assert-NoCommaInPath -PathValue $file.FullName -Label "PluginCuaFile"
            $rel = $file.FullName.Substring($pluginCuaRootLen).TrimStart("\", "/").Replace("\", "/")
            $resName = "payload.plugincua.res_" + $resIndex
            $ManifestLines.Add(("{0}|plugin-cua/{1}" -f $resName, $rel))
            $RspLines.Add(('"/resource:{0},{1}"' -f $file.FullName, $resName))
            $resIndex++
        }
    }

    $kernelRootLen = $KernelDir.TrimEnd("\", "/").Length
    $kernelFiles = @(Get-ChildItem -LiteralPath $KernelDir -Recurse -File |
        Where-Object { Test-ShouldIncludePayloadFile -File $_ -RootDir $KernelDir } |
        Sort-Object -Property FullName)

    if ($kernelFiles.Count -eq 0) {
        throw "No kernel files found under: $KernelDir"
    }

    foreach ($file in $kernelFiles) {
        Assert-NoCommaInPath -PathValue $file.FullName -Label "KernelFile"
        $rel = $file.FullName.Substring($kernelRootLen).TrimStart("\", "/").Replace("\", "/")
        if ($CompiledWinCua -and ($rel -ieq "bin/prism-win-cua.exe" -or $rel -ieq "bin/prism-win-cua.exe.sha256")) {
            continue
        }
        $resName = "payload.kernel.res_" + $resIndex
        $ManifestLines.Add(("{0}|kernel/{1}" -f $resName, $rel))
        $RspLines.Add(('"/resource:{0},{1}"' -f $file.FullName, $resName))
        $resIndex++
    }

    if ($CompiledWinCua) {
        $resExe = "payload.kernel.res_" + $resIndex
        $ManifestLines.Add(("{0}|kernel/bin/prism-win-cua.exe" -f $resExe))
        $RspLines.Add(('"/resource:{0},{1}"' -f $CuaExeTemp, $resExe))
        $resIndex++

        $resSha = "payload.kernel.res_" + $resIndex
        $ManifestLines.Add(("{0}|kernel/bin/prism-win-cua.exe.sha256" -f $resSha))
        $RspLines.Add(('"/resource:{0},{1}"' -f $CuaShaTemp, $resSha))
        $resIndex++
    }

    $ManifestPath = Join-Path $TempDir "payload.manifest.txt"
    Assert-NoCommaInPath -PathValue $ManifestPath -Label "ManifestPath"
    $manifestText = ($ManifestLines -join "`n") + "`n"
    [System.IO.File]::WriteAllText($ManifestPath, $manifestText, $Utf8NoBom)
    $RspLines.Add(('"/resource:{0},payload.manifest.txt"' -f $ManifestPath))
    $RspLines.Add(('"{0}"' -f $SourceCs))

    $RspPath = Join-Path $TempDir "build.rsp"
    [System.IO.File]::WriteAllText($RspPath, ($RspLines -join "`r`n") + "`r`n", $Utf8WithBom)

    Write-Host "Building Anti-Claude-Prism-Suite-Setup.exe with $CscExe ..."
    Write-Host "Embedded payload entries: $resIndex"

    & $CscExe ("@" + $RspPath)
    if ($LASTEXITCODE -ne 0) {
        throw "csc.exe failed with exit code $LASTEXITCODE"
    }
    if (-not (Test-Path -LiteralPath $OutExe -PathType Leaf)) {
        throw "Expected installer executable was not created: $OutExe"
    }

    $hashHex = Compute-Sha256Hex -FilePath $OutExe
    [System.IO.File]::WriteAllText($OutSha, ("{0}  Anti-Claude-Prism-Suite-Setup.exe`n" -f $hashHex), $Utf8NoBom)

    $exeSizeKb = [Math]::Round((Get-Item -LiteralPath $OutExe).Length / 1KB, 1)
    Write-Host "Built: $OutExe ($exeSizeKb KB)"
    Write-Host "SHA256: $hashHex"
    Write-Host "Checksum file: $OutSha"
} finally {
    if (Test-Path -LiteralPath $TempDir) {
        Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
