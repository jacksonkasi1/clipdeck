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

function Stop-ClipboardAppProcesses {
    Get-Process -Name 'clipmo', 'clipdeck' -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 500
}

function Get-ClipboardAppUninstaller {
    $roots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($entry in Get-ItemProperty $roots -ErrorAction SilentlyContinue) {
        if (($entry.DisplayName -like 'Clipmo*' -or $entry.DisplayName -like 'Clipdeck*') -and $entry.UninstallString) {
            return [string]$entry.UninstallString
        }
    }
    return $null
}

function Invoke-QuietUninstall {
    $command = Get-ClipboardAppUninstaller
    if (-not $command) { return }
    Stop-ClipboardAppProcesses
    $match = [regex]::Match($command, '^\s*"?([^"\r\n]+?\.exe)"?\s*(.*)$')
    if (-not $match.Success) { throw "Could not parse clipboard-app uninstall command: $command" }
    $arguments = @('/S')
    if ($match.Groups[2].Value.Trim()) { $arguments += $match.Groups[2].Value.Trim() }
    $process = Start-Process -FilePath $match.Groups[1].Value -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Previous clipboard-app uninstall failed with code $($process.ExitCode)." }
}

function Get-ClipmoShortcut {
    $roots = @(
        [Environment]::GetFolderPath('StartMenu'),
        [Environment]::GetFolderPath('CommonStartMenu')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) }
    $shortcuts = @($roots | ForEach-Object {
        Get-ChildItem -LiteralPath $_ -Filter 'Clipmo*.lnk' -File -Recurse -ErrorAction SilentlyContinue
    } | Sort-Object LastWriteTimeUtc -Descending)
    if ($shortcuts.Count -eq 0) { throw 'The installer did not create a Clipmo Start Menu shortcut.' }
    return $shortcuts[0]
}

function Get-ShortcutTarget([string]$ShortcutPath) {
    $shell = New-Object -ComObject WScript.Shell
    return [string]$shell.CreateShortcut($ShortcutPath).TargetPath
}

function Get-ClipmoProcess([string]$ExecutablePath) {
    $expected = [IO.Path]::GetFullPath($ExecutablePath)
    foreach ($process in Get-Process -Name 'clipmo' -ErrorAction SilentlyContinue) {
        try {
            if ([IO.Path]::GetFullPath($process.Path) -eq $expected) { return $process }
        } catch { }
    }
    return $null
}

function Save-WindowScreenshot([IntPtr]$Handle, [string]$Path) {
    Add-Type -AssemblyName System.Drawing
    if (-not ('ClipmoSmoke.NativeMethods' -as [type])) {
        Add-Type @'
using System;
using System.Runtime.InteropServices;
namespace ClipmoSmoke {
  public static class NativeMethods {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  }
}
'@
    }
    $rect = New-Object ClipmoSmoke.NativeMethods+RECT
    if (-not [ClipmoSmoke.NativeMethods]::GetWindowRect($Handle, [ref]$rect)) {
        throw 'Could not read the Clipmo window bounds for screenshot capture.'
    }
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -lt 400 -or $height -lt 400) { throw "Clipmo window bounds are invalid: ${width}x${height}." }
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

function Initialize-WindowMethods {
    if (-not ('ClipmoSmoke.WindowMethods' -as [type])) {
        Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
namespace ClipmoSmoke {
  public static class WindowMethods {
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] public static extern uint GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  }
}
'@
    }
}

function Write-WindowDiagnostics([int]$ProcessId, [string]$Label) {
    Initialize-WindowMethods
    Write-Host "--- $Label : visible top-level windows of process $ProcessId ---"
    $callback = [ClipmoSmoke.WindowMethods+EnumWindowsProc]{
        param([IntPtr]$hwnd, [IntPtr]$parameter)
        $owner = [uint32]0
        [void][ClipmoSmoke.WindowMethods]::GetWindowThreadProcessId($hwnd, [ref]$owner)
        if ($owner -eq $ProcessId -and [ClipmoSmoke.WindowMethods]::IsWindowVisible($hwnd)) {
            $text = New-Object Text.StringBuilder 256
            [void][ClipmoSmoke.WindowMethods]::GetWindowText($hwnd, $text, $text.Capacity)
            $class = New-Object Text.StringBuilder 256
            [void][ClipmoSmoke.WindowMethods]::GetClassName($hwnd, $class, $class.Capacity)
            $style = [ClipmoSmoke.WindowMethods]::GetWindowLong($hwnd, -16)
            $exStyle = [ClipmoSmoke.WindowMethods]::GetWindowLong($hwnd, -20)
            Write-Host ('  hwnd=0x{0:X} style=0x{1:X8} exStyle=0x{2:X8} class="{3}" title="{4}"' -f [int64]$hwnd, ([uint32]$style), ([uint32]$exStyle), $class.ToString(), $text.ToString())
        }
        return $true
    }
    [void][ClipmoSmoke.WindowMethods]::EnumWindows($callback, [IntPtr]::Zero)
    Write-Host '--- end window diagnostics ---'
}

function Get-VisibleWindow([int]$ProcessId, [string]$Title) {
    Initialize-WindowMethods
    $callback = [ClipmoSmoke.WindowMethods+EnumWindowsProc]{
        param([IntPtr]$hwnd, [IntPtr]$parameter)
        $owner = [uint32]0
        [void][ClipmoSmoke.WindowMethods]::GetWindowThreadProcessId($hwnd, [ref]$owner)
        if ($owner -eq $ProcessId -and [ClipmoSmoke.WindowMethods]::IsWindowVisible($hwnd)) {
            $text = New-Object Text.StringBuilder 256
            [void][ClipmoSmoke.WindowMethods]::GetWindowText($hwnd, $text, $text.Capacity)
            if ($text.ToString() -eq $Title) { $script:foundWindow = $hwnd; return $false }
        }
        return $true
    }
    $script:foundWindow = [IntPtr]::Zero
    [void][ClipmoSmoke.WindowMethods]::EnumWindows($callback, [IntPtr]::Zero)
    return $script:foundWindow
}

function Assert-ScreenshotContent([string]$Path, [string]$Name) {
    Add-Type -AssemblyName System.Drawing
    $bitmap = [Drawing.Bitmap]::FromFile($Path)
    try {
        $all = @{}
        $header = @{}
        # Sample at roughly every 3rd pixel so small UI features (icons, hint
        # pills, kbd borders) are still represented in the colour histogram.
        # A coarser step can collapse the legitimate empty state into the same
        # count as a fully unrendered window.
        $step = [Math]::Max(2, [Math]::Floor([Math]::Min($bitmap.Width, $bitmap.Height) / 180))
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
        $largestRatio = $largest / $sampleCount
        Write-Host "$Name screenshot diagnostics: size=$($bitmap.Width)x$($bitmap.Height), colors=$($all.Count), headerColors=$($header.Count), dominant=$('{0:P1}' -f $largestRatio), bytes=$((Get-Item -LiteralPath $Path).Length)."
        # 10 colours is comfortably above the "renderer produced no pixels"
        # baseline of 1-3 distinct buckets while still letting the minimal
        # quick-window empty state pass without decorative chrome.
        if ($all.Count -lt 10 -or $header.Count -lt 6 -or $largestRatio -gt 0.98) {
            throw "$Name screenshot is nearly uniform or its search/header region has no meaningful visual variation."
        }
    } finally {
        $bitmap.Dispose()
    }
}

function Save-RenderedWindowScreenshot(
    [IntPtr]$Handle,
    [string]$Path,
    [string]$Name,
    [int]$TimeoutSeconds = 10
) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $lastError = $null
    do {
        Save-WindowScreenshot $Handle $Path
        try {
            Assert-ScreenshotContent $Path $Name
            return
        } catch {
            $lastError = $_
            Start-Sleep -Milliseconds 500
        }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "$Name did not render meaningful content within ${TimeoutSeconds}s. Last capture failure: $($lastError.Exception.Message)"
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
    throw "Clipmo installer was not found: $installerPath"
}
if ((Split-Path -Leaf $installerPath) -notlike 'Clipmo_*_x64-setup.exe') {
    throw "Installer is not using the Clipmo release name: $installerPath"
}

$readyFile = Join-Path ([IO.Path]::GetTempPath()) ("clipmo-ready-" + [guid]::NewGuid() + '.json')
$quickReadyFile = [IO.Path]::ChangeExtension($readyFile, 'quick.json')
$quickFocusFile = [IO.Path]::ChangeExtension($readyFile, 'quick-focus.json')
$quickStyleFile = [IO.Path]::ChangeExtension($readyFile, 'quick-style.json')
# Kept as an internal compatibility probe while existing native test hooks use it.
$oldReadyFile = [Environment]::GetEnvironmentVariable('CLIPDECK_READY_FILE', 'Process')
try {
    Invoke-QuietUninstall
    Stop-ClipboardAppProcesses
    $install = Start-Process -FilePath $installerPath -ArgumentList '/S' -Wait -PassThru
    if ($install.ExitCode -ne 0) { throw "Clipmo installer failed with code $($install.ExitCode)." }

    $shortcut = Get-ClipmoShortcut
    $target = Get-ShortcutTarget $shortcut.FullName
    if (-not $target -or -not (Test-Path -LiteralPath $target -PathType Leaf)) {
        throw "Clipmo Start Menu shortcut has an invalid target: $target"
    }
    if ((Split-Path -Leaf $target) -ne 'clipmo.exe') {
        throw "Clipmo shortcut does not target clipmo.exe: $target"
    }

    [Environment]::SetEnvironmentVariable('CLIPDECK_READY_FILE', $readyFile, 'Process')
    Start-Process -FilePath $shortcut.FullName

    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    $process = $null
    $ready = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 250
        $process = Get-ClipmoProcess $target
        if ($process) {
            $process.Refresh()
            if ($process.HasExited) { throw "Clipmo exited during startup with code $($process.ExitCode)." }
            if ($process.MainWindowTitle -like '*WebView2*') {
                throw "A blocking WebView2 error dialog opened: $($process.MainWindowTitle)"
            }
        }
        if (Test-Path -LiteralPath $readyFile -PathType Leaf) {
            try { $ready = Get-Content -LiteralPath $readyFile -Raw | ConvertFrom-Json } catch { $ready = $null }
            if ($ready) { break }
        }
    }

    if (-not $process) { throw 'The installed Clipmo process was not created from the Start Menu shortcut.' }
    if (-not $ready) { throw 'Clipmo never emitted frontend readiness; the Tauri webview did not initialize.' }
    if (-not $ready.frontendReady -or -not $ready.windowCreated -or -not $ready.windowVisible -or $ready.windowLabel -ne 'main') {
        throw "Invalid Clipmo readiness payload: $($ready | ConvertTo-Json -Compress)"
    }
    if ([int]$ready.processId -ne $process.Id) {
        throw "Readiness came from PID $($ready.processId), not installed Clipmo PID $($process.Id)."
    }

    $windowDeadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        $process.Refresh()
        if ($process.MainWindowTitle -like '*WebView2*') {
            throw "A blocking WebView2 error dialog opened: $($process.MainWindowTitle)"
        }
        if ($process.MainWindowHandle -ne [IntPtr]::Zero -and $process.MainWindowTitle -like 'Clipmo*') { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $windowDeadline)
    if ($process.MainWindowHandle -eq [IntPtr]::Zero -or $process.MainWindowTitle -notlike 'Clipmo*') {
        throw 'The real visible Clipmo main window was not created.'
    }

    Save-RenderedWindowScreenshot $process.MainWindowHandle $mainScreenshotPath 'Main window'
    if (-not (Test-Path -LiteralPath $mainScreenshotPath -PathType Leaf) -or (Get-Item $mainScreenshotPath).Length -le 1024) {
        throw 'Clipmo main startup screenshot was not captured.'
    }

    Start-Process -FilePath $target -ArgumentList '--show-quick' -Wait
    $quickDeadline = [DateTime]::UtcNow.AddSeconds(15)
    $quickReady = Wait-ForJson $quickReadyFile $quickDeadline
    $quickFocus = Wait-ForJson $quickFocusFile $quickDeadline
    do {
        $quickHandle = Get-VisibleWindow $process.Id 'Clipmo quick clipboard'
        if ($quickHandle -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 150
    } while ([DateTime]::UtcNow -lt $quickDeadline)
    if (-not $quickReady -or -not $quickReady.frontendReady -or -not $quickReady.searchVisible -or -not $quickReady.layoutVisible) {
        throw "Quick frontend did not prove that search and layout were rendered: $($quickReady | ConvertTo-Json -Compress)"
    }
    if (-not $quickFocus.searchFocused) { throw 'Quick search did not confirm focus after opening.' }
    if ($quickHandle -eq [IntPtr]::Zero) { throw 'The ready quick window is not visible.' }

    $quickRect = New-Object ClipmoSmoke.NativeMethods+RECT
    [void][ClipmoSmoke.NativeMethods]::GetWindowRect($quickHandle, [ref]$quickRect)
    $dpi = [Math]::Max(96, [ClipmoSmoke.WindowMethods]::GetDpiForWindow($quickHandle))
    $logicalWidth = ($quickRect.Right - $quickRect.Left) * 96 / $dpi
    $logicalHeight = ($quickRect.Bottom - $quickRect.Top) * 96 / $dpi
    if ([Math]::Abs($logicalWidth - 560) -gt 40 -or [Math]::Abs($logicalHeight - 620) -gt 40) {
        throw "Quick window is not near its compact 560x620 size: $([Math]::Round($logicalWidth))x$([Math]::Round($logicalHeight)) logical pixels."
    }

    Write-WindowDiagnostics $process.Id 'After quick open'
    if (Test-Path -LiteralPath $quickStyleFile -PathType Leaf) {
        Write-Host "Quick style report from the app: $(Get-Content -LiteralPath $quickStyleFile -Raw)"
    } else {
        Write-Host "The app did not write a quick style report to $quickStyleFile."
    }

    $quickStyle = [ClipmoSmoke.WindowMethods]::GetWindowLong($quickHandle, -16)
    $quickExStyle = [ClipmoSmoke.WindowMethods]::GetWindowLong($quickHandle, -20)
    if (($quickStyle -band 0x00C00000) -eq 0x00C00000) {
        throw ('Quick window unexpectedly has caption decorations (style=0x{0:X8}, exStyle=0x{1:X8}).' -f ([uint32]$quickStyle), ([uint32]$quickExStyle))
    }
    $forbiddenQuickStyles = 0x00C00000 -bor 0x00040000 -bor 0x00080000 -bor 0x00020000 -bor 0x00010000
    if (($quickStyle -band $forbiddenQuickStyles) -ne 0) {
        throw ('Quick window retained non-client chrome or resize controls (style=0x{0:X8}, exStyle=0x{1:X8}).' -f ([uint32]$quickStyle), ([uint32]$quickExStyle))
    }
    if (($quickExStyle -band 0x00040000) -ne 0) {
        throw ('Quick window unexpectedly has an application taskbar style (style=0x{0:X8}, exStyle=0x{1:X8}).' -f ([uint32]$quickStyle), ([uint32]$quickExStyle))
    }
    if (($quickExStyle -band 0x00000080) -eq 0) {
        throw ('Quick window is missing the tool-window style required to stay out of the taskbar (style=0x{0:X8}, exStyle=0x{1:X8}).' -f ([uint32]$quickStyle), ([uint32]$quickExStyle))
    }

    # Use the final artifact path for the first capture too, so a failed smoke
    # test still uploads the actual pixels that caused the rendering assertion.
    $firstQuick = $quickScreenshotPath
    Save-RenderedWindowScreenshot $quickHandle $firstQuick 'First quick open'

    Start-Process -FilePath $target -ArgumentList '--hide-quick' -Wait
    $hideDeadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        if ((Get-VisibleWindow $process.Id 'Clipmo quick clipboard') -eq [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 150
    } while ([DateTime]::UtcNow -lt $hideDeadline)
    if ((Get-VisibleWindow $process.Id 'Clipmo quick clipboard') -ne [IntPtr]::Zero) {
        throw 'Quick window did not hide through the deterministic native command.'
    }

    Remove-Item -LiteralPath $quickFocusFile -Force -ErrorAction SilentlyContinue
    Start-Process -FilePath $target -ArgumentList '--show-quick' -Wait
    $reopenDeadline = [DateTime]::UtcNow.AddSeconds(10)
    $quickFocus = Wait-ForJson $quickFocusFile $reopenDeadline
    do {
        $quickHandle = Get-VisibleWindow $process.Id 'Clipmo quick clipboard'
        if ($quickHandle -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 150
    } while ([DateTime]::UtcNow -lt $reopenDeadline)
    if ($quickHandle -eq [IntPtr]::Zero -or -not $quickFocus.searchFocused) {
        throw 'Quick window did not reopen with search focused.'
    }
    Save-RenderedWindowScreenshot $quickHandle $quickScreenshotPath 'Reopened quick window'

    Write-Host "Verified installed Clipmo main and reusable quick UI (PID $($process.Id)); main=$mainScreenshotPath; quick=$quickScreenshotPath"
} finally {
    [Environment]::SetEnvironmentVariable('CLIPDECK_READY_FILE', $oldReadyFile, 'Process')
    Stop-ClipboardAppProcesses
    Invoke-QuietUninstall
    Remove-Item -LiteralPath $readyFile, $quickReadyFile, $quickFocusFile, $quickStyleFile -Force -ErrorAction SilentlyContinue
}
