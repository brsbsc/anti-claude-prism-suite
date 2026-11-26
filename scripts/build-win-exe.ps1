[CmdletBinding()]
param(
    [string]$OutDir = "dist"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$SourceCs = Join-Path (Join-Path $RepoRoot "installer") (Join-Path "win" "PrismSuiteInstaller.cs")
$ExtDir = Join-Path $RepoRoot "extensions"
$PluginDir = Join-Path $RepoRoot "plugin"
$KernelDir = Join-Path (Join-Path $RepoRoot "vendor") "anti-claude"

if (-not (Test-Path -LiteralPath $SourceCs -PathType Leaf)) {
    throw "Missing installer source file: $SourceCs"
}
if (-not (Test-Path -LiteralPath $ExtDir -PathType Container)) {
    throw "Missing extensions directory: $ExtDir"
}
if (-not (Test-Path -LiteralPath $PluginDir -PathType Container)) {
    throw "Missing plugin directory: $PluginDir"
}
if (-not (Test-Path -LiteralPath $KernelDir -PathType Container)) {
    throw "Missing bundled Anti-Claude kernel directory: $KernelDir"
}
foreach ($requiredKernel in @("install.mjs", "package.json", "LICENSE", "core\daemon.mjs", "core\runtime.js", "core\base.css", "core\i18n.json", "user\custom.js", "user\custom.css", "user\config.json")) {
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

try {
    $IgnoredNames = @(".DS_Store", "Thumbs.db")
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

    $extFiles = Get-ChildItem -LiteralPath $ExtDir -File |
        Where-Object { $IgnoredNames -notcontains $_.Name -and -not $_.Name.EndsWith(".tmp") } |
        Sort-Object -Property Name

    foreach ($file in $extFiles) {
        $rel = $file.Name.Replace("\", "/")
        $resName = "payload.extensions.res_" + $resIndex
        $ManifestLines.Add(("{0}|extensions/{1}" -f $resName, $rel))
        $RspLines.Add(('"/resource:{0},{1}"' -f $file.FullName, $resName))
        $resIndex++
    }

    $pluginRootLen = $PluginDir.TrimEnd("\", "/").Length
    $pluginFiles = Get-ChildItem -LiteralPath $PluginDir -Recurse -File |
        Where-Object { $IgnoredNames -notcontains $_.Name -and -not $_.Name.EndsWith(".tmp") } |
        Sort-Object -Property FullName

    if ($pluginFiles.Count -eq 0) {
        throw "No plugin files found under: $PluginDir"
    }

    foreach ($file in $pluginFiles) {
        $rel = $file.FullName.Substring($pluginRootLen).TrimStart("\", "/").Replace("\", "/")
        $resName = "payload.plugin.res_" + $resIndex
        $ManifestLines.Add(("{0}|plugin/{1}" -f $resName, $rel))
        $RspLines.Add(('"/resource:{0},{1}"' -f $file.FullName, $resName))
        $resIndex++
    }

    $kernelRootLen = $KernelDir.TrimEnd("\", "/").Length
    $kernelFiles = Get-ChildItem -LiteralPath $KernelDir -Recurse -File |
        Where-Object { $IgnoredNames -notcontains $_.Name -and -not $_.Name.EndsWith(".tmp") } |
        Sort-Object -Property FullName

    if ($kernelFiles.Count -eq 0) {
        throw "No kernel files found under: $KernelDir"
    }

    foreach ($file in $kernelFiles) {
        $rel = $file.FullName.Substring($kernelRootLen).TrimStart("\", "/").Replace("\", "/")
        $resName = "payload.kernel.res_" + $resIndex
        $ManifestLines.Add(("{0}|kernel/{1}" -f $resName, $rel))
        $RspLines.Add(('"/resource:{0},{1}"' -f $file.FullName, $resName))
        $resIndex++
    }

    $ManifestPath = Join-Path $TempDir "payload.manifest.txt"
    $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $Utf8WithBom = New-Object System.Text.UTF8Encoding($true)

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

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $fs = [System.IO.File]::OpenRead($OutExe)
        try {
            $hashBytes = $sha.ComputeHash($fs)
        } finally {
            $fs.Dispose()
        }
    } finally {
        $sha.Dispose()
    }
    $hashHex = ([System.BitConverter]::ToString($hashBytes)).Replace("-", "").ToLowerInvariant()
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
