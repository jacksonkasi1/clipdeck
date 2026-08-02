[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$TargetTriple,
    [Parameter(Mandatory)]
    [string]$ExpectedSigned
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot "src-tauri/target/$TargetTriple/release"
$application = Join-Path $releaseRoot 'clipmo.exe'
$installer = Get-ChildItem (Join-Path $releaseRoot 'bundle/nsis/Clipmo_*_x64-setup.exe') -File | Select-Object -First 1
if (-not (Test-Path -LiteralPath $application -PathType Leaf)) {
    throw "Built Clipmo executable was not found: $application"
}
if (-not $installer) {
    throw "Built Clipmo NSIS installer was not found below $releaseRoot."
}

$mustBeSigned = $ExpectedSigned -eq 'true'
foreach ($file in @((Get-Item $application), $installer)) {
    $signature = Get-AuthenticodeSignature -FilePath $file.FullName
    $subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { 'none' }
    Write-Host "$($file.Name): signature=$($signature.Status); signer=$subject"
    if ($mustBeSigned -and $signature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
        throw "$($file.Name) was expected to have a valid Authenticode signature, but its status is $($signature.Status)."
    }
}

if (-not $mustBeSigned) {
    Write-Warning 'This build is unsigned because no trusted Windows certificate secret was available. Publisher metadata is embedded, but SmartScreen trust requires a real Authenticode certificate.'
}
