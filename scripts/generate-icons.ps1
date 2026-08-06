# Regenerate the full Clipmo icon set from the master logo.
#
# This is a thin wrapper around scripts/generate-icons.py. The Python
# implementation is the source of truth because it uses Pillow for clean
# vector-style resize quality and produces a proper multi-resolution
# icon.ico that the legacy System.Drawing pipeline could not match.

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$pythonScript = Join-Path $scriptDir 'generate-icons.py'

if (-not (Test-Path -Path $pythonScript -PathType Leaf)) {
    throw "Icon generator not found at $pythonScript"
}

$python = $null
foreach ($candidate in @('python', 'python3', 'py')) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($cmd) { $python = $candidate; break }
}
if (-not $python) {
    throw 'Python is required to regenerate the icon set. Install Python 3.10+ and ensure `python` is on PATH.'
}

Write-Host "[icons] delegating to $python $pythonScript"
& $python $pythonScript
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
