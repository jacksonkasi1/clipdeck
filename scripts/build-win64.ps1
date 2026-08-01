[CmdletBinding()]
param(
    [ValidateSet('gnu', 'msvc')]
    [string]$Toolchain = 'gnu',
    [string]$BuildRoot = 'D:\Program\rust-target\clipdeck'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$target = "x86_64-pc-windows-$Toolchain"

New-Item -ItemType Directory -Path $BuildRoot -Force | Out-Null
$env:CARGO_TARGET_DIR = $BuildRoot

if ($Toolchain -eq 'gnu') {
    $mingwBin = 'D:\Program\MinGW\mingw64\bin'
    $rustToolchain = 'stable-x86_64-pc-windows-gnu'
    $rustSelfContained = "D:\.rustup\toolchains\$rustToolchain\lib\rustlib\$target\bin\self-contained"

    if (-not (Test-Path (Join-Path $mingwBin 'gcc.exe'))) {
        throw "MinGW was not found at $mingwBin. Install it there or build with -Toolchain msvc."
    }

    $env:RUSTUP_TOOLCHAIN = $rustToolchain
    $env:Path = "$mingwBin;$rustSelfContained;$env:Path"
}

Push-Location $projectRoot
try {
    npm ci
    npx tauri build --target $target
} finally {
    Pop-Location
}

$metadata = cargo metadata --format-version 1 --no-deps --manifest-path (Join-Path $projectRoot 'src-tauri\Cargo.toml') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not discover Cargo target directory.' }
$releaseRoot = Join-Path ([string]$metadata.target_directory) "$target\release"
$tauriConfig = Get-Content -Raw (Join-Path $projectRoot 'src-tauri\tauri.conf.json') | ConvertFrom-Json
$installerName = "Clipdeck_$($tauriConfig.version)_x64-setup.exe"
$installerPath = Join-Path $releaseRoot "bundle\nsis\$installerName"
Write-Host "Application executable: $(Join-Path $releaseRoot 'clipdeck.exe')"
Write-Host "Installer: $installerPath"
Write-Host "Run scripts/collect-windows-artifacts.ps1 -TargetTriple $target to create and verify the portable ZIP."
