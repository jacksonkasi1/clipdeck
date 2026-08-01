[CmdletBinding()]
param(
    [string]$TargetTriple = 'x86_64-pc-windows-msvc',
    [string]$TargetDirectory = '',
    [string]$OutputDirectory = 'artifacts/windows-x64',
    [string]$ExpectedVersion = '',
    [ValidateRange(1, 512)][int]$MaxPortableSizeMb = 32,
    [ValidateRange(1, 512)][int]$MaxInstallerSizeMb = 16,
    [switch]$SkipSmokeTest
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

function Resolve-ProjectPath([string]$Path) {
    if ([IO.Path]::IsPathRooted($Path)) { return [IO.Path]::GetFullPath($Path) }
    return [IO.Path]::GetFullPath((Join-Path $projectRoot $Path))
}

function Read-UInt16([byte[]]$Bytes, [int]$Offset) {
    return [BitConverter]::ToUInt16($Bytes, $Offset)
}

function Read-UInt32([byte[]]$Bytes, [int]$Offset) {
    return [BitConverter]::ToUInt32($Bytes, $Offset)
}

function Get-PeInfo([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 512 -or $bytes[0] -ne 0x4d -or $bytes[1] -ne 0x5a) {
        throw "Not a valid PE file: $Path"
    }
    $pe = [int](Read-UInt32 $bytes 0x3c)
    if ($pe + 256 -ge $bytes.Length -or [Text.Encoding]::ASCII.GetString($bytes, $pe, 4) -ne "PE`0`0") {
        throw "Invalid PE header: $Path"
    }
    $machine = Read-UInt16 $bytes ($pe + 4)
    if ($machine -ne 0x8664) {
        throw ('PE file is not x64 (machine 0x{0:x4}): {1}' -f $machine, $Path)
    }

    $sectionsCount = Read-UInt16 $bytes ($pe + 6)
    $optionalSize = Read-UInt16 $bytes ($pe + 20)
    $optional = $pe + 24
    if ((Read-UInt16 $bytes $optional) -ne 0x20b) { throw "Expected PE32+ image: $Path" }
    $importRva = Read-UInt32 $bytes ($optional + 120)
    $sectionTable = $optional + $optionalSize
    $sections = for ($index = 0; $index -lt $sectionsCount; $index++) {
        $offset = $sectionTable + (40 * $index)
        [pscustomobject]@{
            VirtualSize = Read-UInt32 $bytes ($offset + 8)
            VirtualAddress = Read-UInt32 $bytes ($offset + 12)
            RawSize = Read-UInt32 $bytes ($offset + 16)
            RawPointer = Read-UInt32 $bytes ($offset + 20)
        }
    }
    function Convert-Rva([uint32]$Rva) {
        foreach ($section in $sections) {
            $size = [Math]::Max($section.VirtualSize, $section.RawSize)
            if ($Rva -ge $section.VirtualAddress -and $Rva -lt ($section.VirtualAddress + $size)) {
                return [int]($section.RawPointer + $Rva - $section.VirtualAddress)
            }
        }
        throw ('PE RVA 0x{0:x} is outside all sections in {1}' -f $Rva, $Path)
    }

    $imports = @()
    if ($importRva -ne 0) {
        $descriptor = Convert-Rva $importRva
        while ((Read-UInt32 $bytes $descriptor) -ne 0 -or (Read-UInt32 $bytes ($descriptor + 12)) -ne 0) {
            $nameOffset = Convert-Rva (Read-UInt32 $bytes ($descriptor + 12))
            $end = $nameOffset
            while ($end -lt $bytes.Length -and $bytes[$end] -ne 0) { $end++ }
            $imports += [Text.Encoding]::ASCII.GetString($bytes, $nameOffset, $end - $nameOffset)
            $descriptor += 20
        }
    }
    return [pscustomobject]@{ Machine = 'x64'; Imports = $imports }
}

$tauriConfig = Get-Content -Raw (Join-Path $projectRoot 'src-tauri/tauri.conf.json') | ConvertFrom-Json
$packageJson = Get-Content -Raw (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$cargoManifest = Get-Content -Raw (Join-Path $projectRoot 'src-tauri/Cargo.toml')
$cargoLock = Get-Content -Raw (Join-Path $projectRoot 'src-tauri/Cargo.lock')
$cargoVersion = [regex]::Match($cargoManifest, '(?ms)^\[package\].*?^version\s*=\s*"([^"]+)"').Groups[1].Value
$lockVersion = [regex]::Match($cargoLock, '(?ms)^\[\[package\]\]\s*name\s*=\s*"clipdeck"\s*version\s*=\s*"([^"]+)"').Groups[1].Value
$version = [string]$tauriConfig.version
$versions = @([string]$packageJson.version, $cargoVersion, $version, $lockVersion)
if ($versions -contains '' -or ($versions | Select-Object -Unique).Count -ne 1) {
    throw "Version mismatch: package.json=$($packageJson.version), Cargo.toml=$cargoVersion, tauri.conf.json=$version, Cargo.lock=$lockVersion."
}
if ($ExpectedVersion -and $version -ne $ExpectedVersion) {
    throw "Release tag version $ExpectedVersion does not match application version $version."
}
if ($TargetTriple -ne 'x86_64-pc-windows-msvc' -and $TargetTriple -ne 'x86_64-pc-windows-gnu') {
    throw "Only x64 Windows targets can be packaged; got $TargetTriple."
}

if (-not $TargetDirectory) {
    $metadata = cargo metadata --format-version 1 --no-deps --manifest-path (Join-Path $projectRoot 'src-tauri/Cargo.toml') | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'cargo metadata failed while discovering the exact target directory.' }
    $TargetDirectory = [string]$metadata.target_directory
}
$targetRoot = Resolve-ProjectPath $TargetDirectory
$outputRoot = Resolve-ProjectPath $OutputDirectory
$releaseRoot = Join-Path $targetRoot "$TargetTriple/release"
$executablePath = Join-Path $releaseRoot 'clipdeck.exe'
$installerName = "Clipdeck_${version}_x64-setup.exe"
$portableName = "Clipdeck_${version}_portable_x64.zip"
$installerPath = Join-Path $releaseRoot "bundle/nsis/$installerName"

foreach ($path in @($executablePath, $installerPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item $path).Length -le 0) {
        throw "Required non-empty Windows build output was not produced at the exact target path: $path"
    }
}
$exeInfo = Get-PeInfo $executablePath
$loaderRequired = $exeInfo.Imports -contains 'WebView2Loader.dll'
$loaderPath = Join-Path $releaseRoot 'WebView2Loader.dll'
if ($loaderRequired) {
    if (-not (Test-Path -LiteralPath $loaderPath -PathType Leaf) -or (Get-Item $loaderPath).Length -le 0) {
        throw "Clipdeck.exe dynamically imports WebView2Loader.dll, but a non-empty loader is missing: $loaderPath"
    }
    $null = Get-PeInfo $loaderPath
}

# Always start from empty output and staging trees; a previous raw executable or
# wrong-architecture loader must never leak into a release.
if (Test-Path $outputRoot) { Remove-Item -LiteralPath $outputRoot -Recurse -Force }
New-Item -ItemType Directory -Path $outputRoot | Out-Null
$workRoot = Join-Path ([IO.Path]::GetTempPath()) ("clipdeck-package-" + [guid]::NewGuid())
$stageRoot = Join-Path $workRoot 'stage'
$clipdeckRoot = Join-Path $stageRoot 'Clipdeck'
$extractRoot = Join-Path $workRoot 'extract'
New-Item -ItemType Directory -Path $clipdeckRoot -Force | Out-Null
try {
    Copy-Item -LiteralPath $executablePath -Destination (Join-Path $clipdeckRoot 'Clipdeck.exe')
    if ($loaderRequired) { Copy-Item -LiteralPath $loaderPath -Destination $clipdeckRoot }
    @"
Clipdeck $version portable (Windows x64)

Run Clipdeck.exe from this directory. Keep every file in this directory together.
Clipdeck stores user data in the normal per-user application-data location; deleting
this folder does not delete that data.

Microsoft Edge WebView2 Runtime is required. Windows 11 normally includes it. If
Clipdeck does not open, install the Evergreen Runtime from:
https://developer.microsoft.com/microsoft-edge/webview2/

For managed/offline machines, an administrator can deploy Microsoft's x64 Evergreen
Standalone Installer before Clipdeck is started.
"@ | Set-Content -LiteralPath (Join-Path $clipdeckRoot 'README-portable.txt') -Encoding utf8NoBOM

    $portablePath = Join-Path $outputRoot $portableName
    Compress-Archive -LiteralPath $clipdeckRoot -DestinationPath $portablePath -CompressionLevel Optimal
    Copy-Item -LiteralPath $installerPath -Destination (Join-Path $outputRoot $installerName)

    Expand-Archive -LiteralPath $portablePath -DestinationPath $extractRoot
    $entries = @(Get-ChildItem -LiteralPath $extractRoot -Recurse -Force)
    $top = @(Get-ChildItem -LiteralPath $extractRoot -Force)
    if ($top.Count -ne 1 -or -not $top[0].PSIsContainer -or $top[0].Name -cne 'Clipdeck') {
        throw 'Portable ZIP must contain exactly one top-level Clipdeck/ directory.'
    }
    $expectedFiles = @('Clipdeck.exe', 'README-portable.txt')
    if ($loaderRequired) { $expectedFiles += 'WebView2Loader.dll' }
    $actualFiles = @(Get-ChildItem -LiteralPath (Join-Path $extractRoot 'Clipdeck') -File | ForEach-Object Name | Sort-Object)
    $nestedDirectories = @(Get-ChildItem -LiteralPath (Join-Path $extractRoot 'Clipdeck') -Directory -Recurse)
    if ($nestedDirectories.Count -ne 0 -or (Compare-Object ($expectedFiles | Sort-Object) $actualFiles)) {
        throw "Portable ZIP has missing, unexpected, or nested payload paths. Expected: $($expectedFiles -join ', '); actual: $($actualFiles -join ', ')."
    }
    $null = Get-PeInfo (Join-Path $extractRoot 'Clipdeck/Clipdeck.exe')
    if ($loaderRequired) { $null = Get-PeInfo (Join-Path $extractRoot 'Clipdeck/WebView2Loader.dll') }
    if (-not $SkipSmokeTest) {
        & (Join-Path $projectRoot 'scripts/smoke-test-windows.ps1') -Executable (Join-Path $extractRoot 'Clipdeck/Clipdeck.exe') -WorkingDirectory (Join-Path $extractRoot 'Clipdeck')
    }

    $portableSize = (Get-Item $portablePath).Length
    $installerOutput = Join-Path $outputRoot $installerName
    if ($portableSize -gt ([int64]$MaxPortableSizeMb * 1MB)) { throw "Portable ZIP exceeds $MaxPortableSizeMb MB: $portablePath" }
    if ((Get-Item $installerOutput).Length -gt ([int64]$MaxInstallerSizeMb * 1MB)) { throw "Installer exceeds $MaxInstallerSizeMb MB: $installerOutput" }

    Write-Host "Verified exact release assets for Clipdeck ${version}:"
    Get-ChildItem -LiteralPath $outputRoot | Format-Table Name, Length
    Write-Host "Verified portable ZIP payload:"
    $entries | ForEach-Object { Write-Host ("  " + [IO.Path]::GetRelativePath($extractRoot, $_.FullName).Replace('\', '/')) }
} finally {
    if (Test-Path $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
}

if ($env:GITHUB_OUTPUT) {
    "version=$version" | Add-Content -LiteralPath $env:GITHUB_OUTPUT -Encoding utf8
    "installer=$installerName" | Add-Content -LiteralPath $env:GITHUB_OUTPUT -Encoding utf8
    "portable=$portableName" | Add-Content -LiteralPath $env:GITHUB_OUTPUT -Encoding utf8
}
