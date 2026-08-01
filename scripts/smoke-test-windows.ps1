[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Executable,
    [string]$WorkingDirectory = '',
    [ValidateRange(2, 30)]
    [int]$StartupTimeoutSeconds = 6
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executablePath = if ([System.IO.Path]::IsPathRooted($Executable)) {
    [System.IO.Path]::GetFullPath($Executable)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $projectRoot $Executable))
}

if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
    throw "Clipdeck executable was not found: $executablePath"
}

if (-not $WorkingDirectory) { $WorkingDirectory = Split-Path -Parent $executablePath }
$workingDirectoryPath = if ([System.IO.Path]::IsPathRooted($WorkingDirectory)) {
    [System.IO.Path]::GetFullPath($WorkingDirectory)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $projectRoot $WorkingDirectory))
}
if (-not (Test-Path -LiteralPath $workingDirectoryPath -PathType Container)) {
    throw "Smoke-test working directory was not found: $workingDirectoryPath"
}

$process = Start-Process -FilePath $executablePath -WorkingDirectory $workingDirectoryPath -PassThru -WindowStyle Hidden

try {
    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 250
        $process.Refresh()

        if ($process.HasExited) {
            throw "Clipdeck exited during startup with code $($process.ExitCode)."
        }
    }

    Write-Host "Clipdeck remained healthy for $StartupTimeoutSeconds seconds (PID $($process.Id))."
} finally {
    $process.Refresh()
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
        $process.WaitForExit()
    }
}
