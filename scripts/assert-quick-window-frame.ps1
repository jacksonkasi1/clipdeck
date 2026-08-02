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

    # Tauri's Windows shadow for undecorated windows paints a solid white
    # non-client frame. Sample the middle of all four edges while ignoring the
    # rounded corners; normal light-theme content is grey rather than pure white.
    $band = [Math]::Min(12, [Math]::Max(4, [Math]::Floor([Math]::Min($bitmap.Width, $bitmap.Height) / 40)))
    $marginX = [Math]::Floor($bitmap.Width * 0.15)
    $marginY = [Math]::Floor($bitmap.Height * 0.15)
    $sampled = 0
    $nearWhite = 0

    function Measure-Pixel([int]$X, [int]$Y) {
        $script:sampled++
        $pixel = $bitmap.GetPixel($X, $Y)
        $maximum = [Math]::Max($pixel.R, [Math]::Max($pixel.G, $pixel.B))
        $minimum = [Math]::Min($pixel.R, [Math]::Min($pixel.G, $pixel.B))
        if ($pixel.R -ge 248 -and $pixel.G -ge 248 -and $pixel.B -ge 248 -and ($maximum - $minimum) -le 4) {
            $script:nearWhite++
        }
    }

    for ($y = $marginY; $y -lt ($bitmap.Height - $marginY); $y++) {
        for ($x = 0; $x -lt $band; $x++) {
            Measure-Pixel $x $y
            Measure-Pixel ($bitmap.Width - 1 - $x) $y
        }
    }
    for ($x = $marginX; $x -lt ($bitmap.Width - $marginX); $x++) {
        for ($y = 0; $y -lt $band; $y++) {
            Measure-Pixel $x $y
            Measure-Pixel $x ($bitmap.Height - 1 - $y)
        }
    }

    $ratio = if ($sampled) { $nearWhite / $sampled } else { 1 }
    Write-Host ('Quick edge check: {0:P2} near-white pixels across a {1}px band.' -f $ratio, $band)
    if ($ratio -gt 0.20) {
        throw ('Quick window still contains the unwanted solid white outer frame ({0:P2} of sampled edge pixels).' -f $ratio)
    }
} finally {
    $bitmap.Dispose()
}
