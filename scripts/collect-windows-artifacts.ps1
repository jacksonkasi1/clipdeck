[CmdletBinding()]
param(
    [string]$TargetTriple = 'x86_64-pc-windows-msvc',
    [string]$TargetDirectory = '',
    [string]$OutputDirectory = 'artifacts/windows-x64',
    [string]$ExpectedVersion = '',
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
$installerPath = Join-Path $releaseRoot "bundle/nsis/$installerName"

foreach ($path in @($executablePath, $installerPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item $path).Length -le 0) {
        throw "Required non-empty Windows build output was not produced at the exact target path: $path"
    }
}
$null = Get-PeInfo $executablePath

# Portable publication is intentionally disabled until Clipdeck can bootstrap
# WebView2 itself. Installed builds rely on Tauri's NSIS downloadBootstrapper.
if (Test-Path $outputRoot) { Remove-Item -LiteralPath $outputRoot -Recurse -Force }
New-Item -ItemType Directory -Path $outputRoot | Out-Null
$installerOutput = Join-Path $outputRoot $installerName
Copy-Item -LiteralPath $installerPath -Destination $installerOutput
if ((Get-Item $installerOutput).Length -gt ([int64]$MaxInstallerSizeMb * 1MB)) {
    throw "Installer exceeds $MaxInstallerSizeMb MB: $installerOutput"
}

$mainScreenshotName = "Clipdeck_${version}_main-startup.png"
$quickScreenshotName = "Clipdeck_${version}_quick-startup.png"
$mainScreenshotPath = Join-Path $outputRoot $mainScreenshotName
$quickScreenshotPath = Join-Path $outputRoot $quickScreenshotName
if (-not $SkipSmokeTest) {
    & (Join-Path $projectRoot 'scripts/smoke-test-windows.ps1') `
        -Installer $installerOutput `
        -MainScreenshot $mainScreenshotPath `
        -QuickScreenshot $quickScreenshotPath
}

Write-Host "Verified exact release installer for Clipdeck ${version}:"
Get-ChildItem -LiteralPath $outputRoot | Format-Table Name, Length

if ($env:GITHUB_OUTPUT) {
    "version=$version" | Add-Content -LiteralPath $env:GITHUB_OUTPUT -Encoding utf8
    "installer=$installerName" | Add-Content -LiteralPath $env:GITHUB_OUTPUT -Encoding utf8
    "main_screenshot=$mainScreenshotName" | Add-Content -LiteralPath $env:GITHUB_OUTPUT -Encoding utf8
    "quick_screenshot=$quickScreenshotName" | Add-Content -LiteralPath $env:GITHUB_OUTPUT -Encoding utf8
}
