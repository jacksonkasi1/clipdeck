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
$results = foreach ($file in @((Get-Item $application), $installer)) {
    $signature = Get-AuthenticodeSignature -FilePath $file.FullName
    $subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { 'none' }
    $publisher = if ($signature.SignerCertificate) {
        $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    } else {
        'none'
    }
    Write-Host "$($file.Name): signature=$($signature.Status); publisher=$publisher; signer=$subject"
    if ($mustBeSigned -and $signature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
        throw "$($file.Name) was expected to have a valid Authenticode signature, but its status is $($signature.Status)."
    }
    if ($mustBeSigned -and $publisher -ne 'Jackson Kasi') {
        throw "$($file.Name) was signed by '$publisher', not the required publisher 'Jackson Kasi'."
    }
    [pscustomobject]@{ File = $file.Name; Status = [string]$signature.Status; Publisher = $publisher }
}

if ($mustBeSigned) {
    $summary = @('### Authenticode verification: signed and valid', '', '| File | Status | Publisher |', '| --- | --- | --- |')
    $summary += $results | ForEach-Object { "| ``$($_.File)`` | $($_.Status) | $($_.Publisher) |" }
} else {
    $message = 'This verification artifact is unsigned because no trusted Windows certificate secret was available. Publisher metadata alone does not make it a verified-publisher installer.'
    Write-Warning $message
    $summary = @('### Authenticode verification: unsigned', '', $message)
}
if ($env:GITHUB_STEP_SUMMARY) {
    $summary | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Encoding utf8
}
