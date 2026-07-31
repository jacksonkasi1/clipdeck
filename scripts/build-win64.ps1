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

$releaseRoot = Join-Path $BuildRoot "$target\release"
Write-Host "Application executable: $(Join-Path $releaseRoot 'clipdeck.exe')"
Write-Host "Installer: $(Join-Path $releaseRoot 'bundle\nsis\Clipdeck_0.1.0_x64-setup.exe')"
