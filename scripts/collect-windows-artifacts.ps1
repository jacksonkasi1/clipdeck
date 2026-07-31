[CmdletBinding()]
param(
    [string]$TargetTriple = 'x86_64-pc-windows-msvc',
    [string]$TargetDirectory = '',
    [string]$OutputDirectory = 'artifacts/windows-x64',
    [string]$ExpectedVersion = '',
    [ValidateRange(1, 512)][int]$MaxExecutableSizeMb = 32,
    [ValidateRange(1, 512)][int]$MaxInstallerSizeMb = 16
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

function Resolve-ProjectPath {
    param([Parameter(Mandatory)][string]$Path)

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $projectRoot $Path))
}

$tauriConfigPath = Join-Path $projectRoot 'src-tauri/tauri.conf.json'
$packageJsonPath = Join-Path $projectRoot 'package.json'
$cargoManifestPath = Join-Path $projectRoot 'src-tauri/Cargo.toml'

$tauriConfig = Get-Content -Raw $tauriConfigPath | ConvertFrom-Json
$packageJson = Get-Content -Raw $packageJsonPath | ConvertFrom-Json
$cargoManifest = Get-Content -Raw $cargoManifestPath
$cargoVersionMatch = [regex]::Match(
    $cargoManifest,
    '(?ms)^\[package\].*?^version\s*=\s*"(?<version>[^"]+)"'
)

if (-not $cargoVersionMatch.Success) {
    throw "Could not read the package version from $cargoManifestPath."
}

$version = [string]$tauriConfig.version
$cargoVersion = $cargoVersionMatch.Groups['version'].Value
$packageVersion = [string]$packageJson.version

if ($version -ne $packageVersion -or $version -ne $cargoVersion) {
    throw "Version mismatch: tauri.conf.json=$version, package.json=$packageVersion, Cargo.toml=$cargoVersion."
}

if ($ExpectedVersion -and $version -ne $ExpectedVersion) {
    throw "Release tag version $ExpectedVersion does not match application version $version."
}

if (-not $TargetDirectory) {
    $TargetDirectory = Join-Path $projectRoot 'src-tauri/target'
}

$targetRoot = Resolve-ProjectPath -Path $TargetDirectory
$outputRoot = Resolve-ProjectPath -Path $OutputDirectory
$releaseRoot = Join-Path $targetRoot "$TargetTriple/release"
$executablePath = Join-Path $releaseRoot 'clipdeck.exe'
$installerName = "Clipdeck_${version}_x64-setup.exe"
$installerPath = Join-Path $releaseRoot "bundle/nsis/$installerName"

foreach ($requiredPath in @($executablePath, $installerPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required Windows artifact was not produced: $requiredPath"
    }

    if ((Get-Item -LiteralPath $requiredPath).Length -le 0) {
        throw "Windows artifact is empty: $requiredPath"
    }
}

$sizeLimits = @{
    $executablePath = [int64]$MaxExecutableSizeMb * 1MB
    $installerPath = [int64]$MaxInstallerSizeMb * 1MB
}
foreach ($artifactPath in $sizeLimits.Keys) {
    $artifactSize = (Get-Item -LiteralPath $artifactPath).Length
    if ($artifactSize -gt $sizeLimits[$artifactPath]) {
        $limitMb = [Math]::Round($sizeLimits[$artifactPath] / 1MB, 2)
        $actualMb = [Math]::Round($artifactSize / 1MB, 2)
        throw "Release-size budget exceeded for $artifactPath ($actualMb MB > $limitMb MB)."
    }
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$copiedArtifacts = foreach ($sourcePath in @($executablePath, $installerPath)) {
    $destinationPath = Join-Path $outputRoot (Split-Path -Leaf $sourcePath)
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force

    $sourceLength = (Get-Item -LiteralPath $sourcePath).Length
    $destinationLength = (Get-Item -LiteralPath $destinationPath).Length
    if ($sourceLength -ne $destinationLength) {
        throw "Artifact size verification failed for $destinationPath."
    }

    Get-Item -LiteralPath $destinationPath
}

$artifactRecords = foreach ($artifact in $copiedArtifacts) {
    $hash = Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256
    $signature = Get-AuthenticodeSignature -LiteralPath $artifact.FullName

    [pscustomobject][ordered]@{
        file = $artifact.Name
        bytes = $artifact.Length
        sha256 = $hash.Hash.ToLowerInvariant()
        authenticodeStatus = [string]$signature.Status
    }
}

$checksums = $artifactRecords |
    Sort-Object file |
    ForEach-Object { "{0}  {1}" -f $_.sha256, $_.file }
$checksumsPath = Join-Path $outputRoot 'SHA256SUMS.txt'
$checksums | Set-Content -LiteralPath $checksumsPath -Encoding utf8NoBOM

$metadata = [ordered]@{
    product = 'Clipdeck'
    version = $version
    target = $TargetTriple
    commit = if ($env:GITHUB_SHA) { $env:GITHUB_SHA } else { (git -C $projectRoot rev-parse HEAD) }
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    sizeBudgetsMb = [ordered]@{
        executable = $MaxExecutableSizeMb
        installer = $MaxInstallerSizeMb
    }
    artifacts = $artifactRecords
}
$metadataPath = Join-Path $outputRoot 'build-metadata.json'
$metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $metadataPath -Encoding utf8NoBOM

if ($env:GITHUB_OUTPUT) {
    "version=$version" | Add-Content -LiteralPath $env:GITHUB_OUTPUT -Encoding utf8
    "artifactDirectory=$outputRoot" | Add-Content -LiteralPath $env:GITHUB_OUTPUT -Encoding utf8
}

Write-Host "Verified Clipdeck $version Windows artifacts in $outputRoot"
$artifactRecords | Format-Table file, bytes, sha256, authenticodeStatus
