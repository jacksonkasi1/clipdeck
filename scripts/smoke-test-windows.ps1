[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Installer,
    [Parameter(Mandatory)]
    [string]$Screenshot,
    [ValidateRange(10, 120)]
    [int]$StartupTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

function Resolve-ProjectPath([string]$Path) {
    if ([IO.Path]::IsPathRooted($Path)) { return [IO.Path]::GetFullPath($Path) }
    return [IO.Path]::GetFullPath((Join-Path $projectRoot $Path))
}

function Stop-ClipdeckProcesses {
    Get-Process -Name 'clipdeck' -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 500
}

function Get-ClipdeckUninstaller {
    $roots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($entry in Get-ItemProperty $roots -ErrorAction SilentlyContinue) {
        if ($entry.DisplayName -like 'Clipdeck*' -and $entry.UninstallString) {
            return [string]$entry.UninstallString
        }
    }
    return $null
}

function Invoke-QuietUninstall {
    $command = Get-ClipdeckUninstaller
    if (-not $command) { return }
    Stop-ClipdeckProcesses
    $match = [regex]::Match($command, '^\s*"?([^"\r\n]+?\.exe)"?\s*(.*)$')
    if (-not $match.Success) { throw "Could not parse Clipdeck uninstall command: $command" }
    $arguments = @('/S')
    if ($match.Groups[2].Value.Trim()) { $arguments += $match.Groups[2].Value.Trim() }
    $process = Start-Process -FilePath $match.Groups[1].Value -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Previous Clipdeck uninstall failed with code $($process.ExitCode)." }
}

function Get-ClipdeckShortcut {
    $roots = @(
        [Environment]::GetFolderPath('StartMenu'),
        [Environment]::GetFolderPath('CommonStartMenu')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) }
    $shortcuts = @($roots | ForEach-Object {
        Get-ChildItem -LiteralPath $_ -Filter 'Clipdeck*.lnk' -File -Recurse -ErrorAction SilentlyContinue
    } | Sort-Object LastWriteTimeUtc -Descending)
    if ($shortcuts.Count -eq 0) { throw 'The installer did not create a Clipdeck Start Menu shortcut.' }
    return $shortcuts[0]
}

function Get-ShortcutTarget([string]$ShortcutPath) {
    $shell = New-Object -ComObject WScript.Shell
    return [string]$shell.CreateShortcut($ShortcutPath).TargetPath
}

function Get-ClipdeckProcess([string]$ExecutablePath) {
    $expected = [IO.Path]::GetFullPath($ExecutablePath)
    foreach ($process in Get-Process -Name 'clipdeck' -ErrorAction SilentlyContinue) {
        try {
            if ([IO.Path]::GetFullPath($process.Path) -eq $expected) { return $process }
        } catch { }
    }
    return $null
}

function Save-WindowScreenshot([IntPtr]$Handle, [string]$Path) {
    Add-Type -AssemblyName System.Drawing
    if (-not ('ClipdeckSmoke.NativeMethods' -as [type])) {
        Add-Type @'
using System;
using System.Runtime.InteropServices;
namespace ClipdeckSmoke {
  public static class NativeMethods {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  }
}
'@
    }
    $rect = New-Object ClipdeckSmoke.NativeMethods+RECT
    if (-not [ClipdeckSmoke.NativeMethods]::GetWindowRect($Handle, [ref]$rect)) {
        throw 'Could not read the Clipdeck main-window bounds for screenshot capture.'
    }
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -lt 400 -or $height -lt 400) { throw "Clipdeck window bounds are invalid: ${width}x${height}." }
    $directory = Split-Path -Parent $Path
    if ($directory) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    $bitmap = New-Object Drawing.Bitmap $width, $height
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
        $bitmap.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$installerPath = Resolve-ProjectPath $Installer
$screenshotPath = Resolve-ProjectPath $Screenshot
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
    throw "Clipdeck installer was not found: $installerPath"
}

$readyFile = Join-Path ([IO.Path]::GetTempPath()) ("clipdeck-ready-" + [guid]::NewGuid() + '.json')
$oldReadyFile = [Environment]::GetEnvironmentVariable('CLIPDECK_READY_FILE', 'Process')
try {
    # This deliberately exercises a fresh install even when a prior Clipdeck build
    # is present on the test machine.
    Invoke-QuietUninstall
    Stop-ClipdeckProcesses
    $install = Start-Process -FilePath $installerPath -ArgumentList '/S' -Wait -PassThru
    if ($install.ExitCode -ne 0) { throw "Clipdeck installer failed with code $($install.ExitCode)." }

    $shortcut = Get-ClipdeckShortcut
    $target = Get-ShortcutTarget $shortcut.FullName
    if (-not $target -or -not (Test-Path -LiteralPath $target -PathType Leaf)) {
        throw "Clipdeck Start Menu shortcut has an invalid target: $target"
    }

    [Environment]::SetEnvironmentVariable('CLIPDECK_READY_FILE', $readyFile, 'Process')
    # Start the .lnk itself: this verifies the same Start Menu launch path users use.
    Start-Process -FilePath $shortcut.FullName

    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    $process = $null
    $ready = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 250
        $process = Get-ClipdeckProcess $target
        if ($process) {
            $process.Refresh()
            if ($process.HasExited) { throw "Clipdeck exited during startup with code $($process.ExitCode)." }
            if ($process.MainWindowTitle -like '*WebView2*') {
                throw "A blocking WebView2 error dialog opened: $($process.MainWindowTitle)"
            }
        }
        if (Test-Path -LiteralPath $readyFile -PathType Leaf) {
            try { $ready = Get-Content -LiteralPath $readyFile -Raw | ConvertFrom-Json } catch { $ready = $null }
            if ($ready) { break }
        }
    }

    if (-not $process) { throw 'The installed Clipdeck process was not created from the Start Menu shortcut.' }
    if (-not $ready) { throw 'Clipdeck never emitted frontend readiness; the Tauri webview did not initialize.' }
    if (-not $ready.frontendReady -or -not $ready.windowCreated -or -not $ready.windowVisible -or $ready.windowLabel -ne 'main') {
        throw "Invalid Clipdeck readiness payload: $($ready | ConvertTo-Json -Compress)"
    }
    if ([int]$ready.processId -ne $process.Id) {
        throw "Readiness came from PID $($ready.processId), not installed Clipdeck PID $($process.Id)."
    }

    $windowDeadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        $process.Refresh()
        if ($process.MainWindowTitle -like '*WebView2*') {
            throw "A blocking WebView2 error dialog opened: $($process.MainWindowTitle)"
        }
        if ($process.MainWindowHandle -ne [IntPtr]::Zero -and $process.MainWindowTitle -like 'Clipdeck*') { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $windowDeadline)
    if ($process.MainWindowHandle -eq [IntPtr]::Zero -or $process.MainWindowTitle -notlike 'Clipdeck*') {
        throw 'The real visible Clipdeck main window was not created.'
    }

    Save-WindowScreenshot $process.MainWindowHandle $screenshotPath
    if (-not (Test-Path -LiteralPath $screenshotPath -PathType Leaf) -or (Get-Item $screenshotPath).Length -le 1024) {
        throw 'Clipdeck startup screenshot was not captured.'
    }
    Write-Host "Verified installed Clipdeck UI from Start Menu (PID $($process.Id)); readiness=$readyFile; screenshot=$screenshotPath"
} finally {
    [Environment]::SetEnvironmentVariable('CLIPDECK_READY_FILE', $oldReadyFile, 'Process')
    Stop-ClipdeckProcesses
    Invoke-QuietUninstall
    Remove-Item -LiteralPath $readyFile -Force -ErrorAction SilentlyContinue
}
