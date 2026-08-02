[CmdletBinding()]
param(
    [string]$OutputFile = $env:GITHUB_OUTPUT
)

$ErrorActionPreference = 'Stop'
$certificateBase64 = [Environment]::GetEnvironmentVariable('WINDOWS_CERTIFICATE')
$passwordText = [Environment]::GetEnvironmentVariable('WINDOWS_CERTIFICATE_PASSWORD')
$timestampUrl = [Environment]::GetEnvironmentVariable('WINDOWS_TIMESTAMP_URL')
if ([string]::IsNullOrWhiteSpace($timestampUrl)) {
    $timestampUrl = 'http://timestamp.digicert.com'
}

function Write-OutputValue([string]$Name, [string]$Value) {
    if (-not [string]::IsNullOrWhiteSpace($OutputFile)) {
        Add-Content -LiteralPath $OutputFile -Value "$Name=$Value"
    }
}

if ([string]::IsNullOrWhiteSpace($certificateBase64)) {
    Write-Host 'No WINDOWS_CERTIFICATE secret is configured; this verification build will remain unsigned.'
    Write-OutputValue 'enabled' 'false'
    Write-OutputValue 'config' ''
    Write-OutputValue 'subject' 'Unsigned build'
    exit 0
}

if ([string]::IsNullOrWhiteSpace($passwordText)) {
    throw 'WINDOWS_CERTIFICATE is configured but WINDOWS_CERTIFICATE_PASSWORD is missing.'
}

$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$certificatePath = Join-Path $tempRoot 'clipmo-windows-signing.pfx'
$configPath = Join-Path $tempRoot 'clipmo-tauri-signing.json'

# Accept either raw base64 or the BEGIN/END wrapper produced by certutil.
$payload = [regex]::Replace($certificateBase64, '-----BEGIN [^-]+-----|-----END [^-]+-----|\s', '')
try {
    [IO.File]::WriteAllBytes($certificatePath, [Convert]::FromBase64String($payload))
} catch {
    throw "WINDOWS_CERTIFICATE is not a valid base64-encoded PFX: $($_.Exception.Message)"
}

$password = ConvertTo-SecureString -String $passwordText -Force -AsPlainText
$imported = @(Import-PfxCertificate `
    -FilePath $certificatePath `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -Password $password)
$certificate = $imported | Where-Object { $_.HasPrivateKey } | Select-Object -First 1
if (-not $certificate) {
    throw 'The imported Windows signing certificate does not contain a private key.'
}

$config = Get-Content (Join-Path $PSScriptRoot '../src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$config.bundle.windows | Add-Member -NotePropertyName certificateThumbprint -NotePropertyValue $certificate.Thumbprint -Force
$config.bundle.windows | Add-Member -NotePropertyName digestAlgorithm -NotePropertyValue 'sha256' -Force
$config.bundle.windows | Add-Member -NotePropertyName timestampUrl -NotePropertyValue $timestampUrl -Force
$config | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $configPath -Encoding utf8

Write-Host "Imported Windows code-signing certificate: $($certificate.Subject)"
Write-Host "Tauri will sign the application executable and NSIS installer using thumbprint $($certificate.Thumbprint)."
Write-OutputValue 'enabled' 'true'
Write-OutputValue 'config' $configPath
Write-OutputValue 'subject' $certificate.Subject
