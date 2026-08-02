[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Screenshot
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$path = [IO.Path]::GetFullPath($Screenshot)
if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Quick-window screenshot was not found: $path"
}

$bitmap = [Drawing.Bitmap]::FromFile($path)
try {
    if ($bitmap.Width -lt 400 -or $bitmap.Height -lt 400) {
        throw "Quick-window screenshot is unexpectedly small: $($bitmap.Width)x$($bitmap.Height)."
    }

    # Tauri's Windows shadow for undecorated windows can paint only a one-pixel
    # white non-client frame. Averaging an entire band would hide that defect, so
    # inspect each depth independently across the middle 70% of all four edges.
    # The relative sampling makes this check independent of Windows DPI scaling.
    $band = [Math]::Min(12, [Math]::Max(4, [Math]::Floor([Math]::Min($bitmap.Width, $bitmap.Height) / 40)))
    $marginX = [Math]::Floor($bitmap.Width * 0.15)
    $marginY = [Math]::Floor($bitmap.Height * 0.15)
    $solidThreshold = 0.85
    $depths = @()

    function Test-NearWhite([Drawing.Color]$Pixel) {
        $maximum = [Math]::Max($Pixel.R, [Math]::Max($Pixel.G, $Pixel.B))
        $minimum = [Math]::Min($Pixel.R, [Math]::Min($Pixel.G, $Pixel.B))
        return $Pixel.R -ge 248 -and $Pixel.G -ge 248 -and $Pixel.B -ge 248 -and ($maximum - $minimum) -le 4
    }

    for ($depth = 0; $depth -lt $band; $depth++) {
        $leftWhite = 0
        $rightWhite = 0
        $verticalSamples = $bitmap.Height - (2 * $marginY)
        for ($y = $marginY; $y -lt ($bitmap.Height - $marginY); $y++) {
            if (Test-NearWhite ($bitmap.GetPixel($depth, $y))) { $leftWhite++ }
            if (Test-NearWhite ($bitmap.GetPixel($bitmap.Width - 1 - $depth, $y))) { $rightWhite++ }
        }

        $topWhite = 0
        $bottomWhite = 0
        $horizontalSamples = $bitmap.Width - (2 * $marginX)
        for ($x = $marginX; $x -lt ($bitmap.Width - $marginX); $x++) {
            if (Test-NearWhite ($bitmap.GetPixel($x, $depth))) { $topWhite++ }
            if (Test-NearWhite ($bitmap.GetPixel($x, $bitmap.Height - 1 - $depth))) { $bottomWhite++ }
        }

        $ratios = @(
            ($leftWhite / $verticalSamples)
            ($rightWhite / $verticalSamples)
            ($topWhite / $horizontalSamples)
            ($bottomWhite / $horizontalSamples)
        )
        $depths += [pscustomobject]@{
            Depth = $depth
            Left = $ratios[0]
            Right = $ratios[1]
            Top = $ratios[2]
            Bottom = $ratios[3]
            Minimum = ($ratios | Measure-Object -Minimum).Minimum
        }
    }

    foreach ($measurement in $depths) {
        Write-Host ('Quick edge depth {0}px: left={1:P1}, right={2:P1}, top={3:P1}, bottom={4:P1} near-white.' -f `
            $measurement.Depth, $measurement.Left, $measurement.Right, $measurement.Top, $measurement.Bottom)
        if ($measurement.Minimum -ge $solidThreshold) {
            throw ('Quick window contains a solid white frame at edge depth {0}px (all four middle edge sections are at least {1:P0} near-white).' -f `
                $measurement.Depth, $solidThreshold)
        }
    }
} finally {
    $bitmap.Dispose()
}
