[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Installer,
    [Parameter(Mandatory)]
    [string]$MainScreenshot,
    [Parameter(Mandatory)]
    [string]$QuickScreenshot,
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
    # Captures the composed HWND pixels, including native DWM clipping.
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
        throw 'Could not read the Clipdeck window bounds for screenshot capture.'
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

function Get-VisibleWindow([int]$ProcessId, [string]$Title) {
    if (-not ('ClipdeckSmoke.WindowMethods' -as [type])) {
        Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
namespace ClipdeckSmoke {
  public static class WindowMethods {
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  }
}
'@
    }
    $match = [IntPtr]::Zero
    $callback = [ClipdeckSmoke.WindowMethods+EnumWindowsProc]{
        param([IntPtr]$hwnd, [IntPtr]$parameter)
        $owner = [uint32]0
        [void][ClipdeckSmoke.WindowMethods]::GetWindowThreadProcessId($hwnd, [ref]$owner)
        if ($owner -eq $ProcessId -and [ClipdeckSmoke.WindowMethods]::IsWindowVisible($hwnd)) {
            $text = New-Object Text.StringBuilder 256
            [void][ClipdeckSmoke.WindowMethods]::GetWindowText($hwnd, $text, $text.Capacity)
            if ($text.ToString() -eq $Title) { $script:foundWindow = $hwnd; return $false }
        }
        return $true
    }
    $script:foundWindow = [IntPtr]::Zero
    [void][ClipdeckSmoke.WindowMethods]::EnumWindows($callback, [IntPtr]::Zero)
    return $script:foundWindow
}

function Assert-ScreenshotContent([string]$Path, [string]$Name) {
    Add-Type -AssemblyName System.Drawing
    $bitmap = [Drawing.Bitmap]::FromFile($Path)
    try {
        $all = @{}
        $header = @{}
        $step = [Math]::Max(2, [Math]::Floor([Math]::Min($bitmap.Width, $bitmap.Height) / 90))
        for ($y = 0; $y -lt $bitmap.Height; $y += $step) {
            for ($x = 0; $x -lt $bitmap.Width; $x += $step) {
                $pixel = $bitmap.GetPixel($x, $y)
                $key = '{0},{1},{2}' -f ([int]($pixel.R / 16)), ([int]($pixel.G / 16)), ([int]($pixel.B / 16))
                $all[$key] = 1 + [int]($all[$key])
                if ($y -lt [Math]::Min(90, [int]($bitmap.Height / 4))) { $header[$key] = 1 }
            }
        }
        $sampleCount = ($all.Values | Measure-Object -Sum).Sum
        $largest = ($all.Values | Measure-Object -Maximum).Maximum
        if ($all.Count -lt 12 -or $header.Count -lt 6 -or ($largest / $sampleCount) -gt 0.98) {
            throw "$Name screenshot is nearly uniform or its search/header region has no meaningful visual variation."
        }
    } finally {
        $bitmap.Dispose()
    }
}

function Wait-ForJson([string]$Path, [DateTime]$Deadline) {
    do {
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { }
        }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $Deadline)
    return $null
}

$installerPath = Resolve-ProjectPath $Installer
$mainScreenshotPath = Resolve-ProjectPath $MainScreenshot
$quickScreenshotPath = Resolve-ProjectPath $QuickScreenshot
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
    throw "Clipdeck installer was not found: $installerPath"
}

$readyFile = Join-Path ([IO.Path]::GetTempPath()) ("clipdeck-ready-" + [guid]::NewGuid() + '.json')
$quickReadyFile = [IO.Path]::ChangeExtension($readyFile, 'quick.json')
$quickFocusFile = [IO.Path]::ChangeExtension($readyFile, 'quick-focus.json')
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

    Save-WindowScreenshot $process.MainWindowHandle $mainScreenshotPath
    if (-not (Test-Path -LiteralPath $mainScreenshotPath -PathType Leaf) -or (Get-Item $mainScreenshotPath).Length -le 1024) {
        throw 'Clipdeck main startup screenshot was not captured.'
    }
    Assert-ScreenshotContent $mainScreenshotPath 'Main window'

    # Ask the already-running installed binary to route a deterministic request
    # through the single-instance callback and the production readiness gate.
    Start-Process -FilePath $target -ArgumentList '--show-quick' -Wait
    $quickDeadline = [DateTime]::UtcNow.AddSeconds(15)
    $quickReady = Wait-ForJson $quickReadyFile $quickDeadline
    $quickFocus = Wait-ForJson $quickFocusFile $quickDeadline
    do {
        $quickHandle = Get-VisibleWindow $process.Id 'Clipdeck quick clipboard'
        if ($quickHandle -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 150
    } while ([DateTime]::UtcNow -lt $quickDeadline)
    if (-not $quickReady -or -not $quickReady.frontendReady -or -not $quickReady.searchVisible -or -not $quickReady.layoutVisible) {
        throw "Quick frontend did not prove that search and layout were rendered: $($quickReady | ConvertTo-Json -Compress)"
    }
    if (-not $quickFocus.searchFocused) { throw 'Quick search did not confirm focus after opening.' }
    if ($quickHandle -eq [IntPtr]::Zero) { throw 'The ready quick window is not visible.' }

    $quickRect = New-Object ClipdeckSmoke.NativeMethods+RECT
    [void][ClipdeckSmoke.NativeMethods]::GetWindowRect($quickHandle, [ref]$quickRect)
    $dpi = [Math]::Max(96, [ClipdeckSmoke.WindowMethods]::GetDpiForWindow($quickHandle))
    $logicalWidth = ($quickRect.Right - $quickRect.Left) * 96 / $dpi
    $logicalHeight = ($quickRect.Bottom - $quickRect.Top) * 96 / $dpi
    if ([Math]::Abs($logicalWidth - 560) -gt 40 -or [Math]::Abs($logicalHeight - 620) -gt 40) {
        throw "Quick window is not near its compact 560x620 size: $([Math]::Round($logicalWidth))x$([Math]::Round($logicalHeight)) logical pixels."
    }

    $quickStyle = [ClipdeckSmoke.WindowMethods]::GetWindowLong($quickHandle, -16)
    $quickExStyle = [ClipdeckSmoke.WindowMethods]::GetWindowLong($quickHandle, -20)
    # WS_CAPTION is the combination WS_BORDER | WS_DLGFRAME. Testing for either
    # bit alone incorrectly rejects a frameless DWM window that retains only a
    # border style for resize/shadow behavior.
    if (($quickStyle -band 0x00C00000) -eq 0x00C00000) {
        throw ('Quick window unexpectedly has caption decorations (style=0x{0:X8}, exStyle=0x{1:X8}).' -f ([uint32]$quickStyle), ([uint32]$quickExStyle))
    }
    if (($quickExStyle -band 0x00040000) -ne 0) {
        throw ('Quick window unexpectedly has an application taskbar style (style=0x{0:X8}, exStyle=0x{1:X8}).' -f ([uint32]$quickStyle), ([uint32]$quickExStyle))
    }

    $firstQuick = [IO.Path]::ChangeExtension($quickScreenshotPath, 'first.png')
    Save-WindowScreenshot $quickHandle $firstQuick
    Assert-ScreenshotContent $firstQuick 'First quick open'

    Start-Process -FilePath $target -ArgumentList '--hide-quick' -Wait
    $hideDeadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        if ((Get-VisibleWindow $process.Id 'Clipdeck quick clipboard') -eq [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 150
    } while ([DateTime]::UtcNow -lt $hideDeadline)
    if ((Get-VisibleWindow $process.Id 'Clipdeck quick clipboard') -ne [IntPtr]::Zero) {
        throw 'Quick window did not hide through the deterministic native command.'
    }

    Remove-Item -LiteralPath $quickFocusFile -Force -ErrorAction SilentlyContinue
    Start-Process -FilePath $target -ArgumentList '--show-quick' -Wait
    $reopenDeadline = [DateTime]::UtcNow.AddSeconds(10)
    $quickFocus = Wait-ForJson $quickFocusFile $reopenDeadline
    do {
        $quickHandle = Get-VisibleWindow $process.Id 'Clipdeck quick clipboard'
        if ($quickHandle -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 150
    } while ([DateTime]::UtcNow -lt $reopenDeadline)
    if ($quickHandle -eq [IntPtr]::Zero -or -not $quickFocus.searchFocused) {
        throw 'Quick window did not reopen with search focused.'
    }
    Save-WindowScreenshot $quickHandle $quickScreenshotPath
    Assert-ScreenshotContent $quickScreenshotPath 'Reopened quick window'
    Remove-Item -LiteralPath $firstQuick -Force -ErrorAction SilentlyContinue

    Write-Host "Verified installed Clipdeck main and reusable quick UI (PID $($process.Id)); main=$mainScreenshotPath; quick=$quickScreenshotPath"
} finally {
    [Environment]::SetEnvironmentVariable('CLIPDECK_READY_FILE', $oldReadyFile, 'Process')
    Stop-ClipdeckProcesses
    Invoke-QuietUninstall
    Remove-Item -LiteralPath $readyFile, $quickReadyFile, $quickFocusFile -Force -ErrorAction SilentlyContinue
}
