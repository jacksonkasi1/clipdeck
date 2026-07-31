Add-Type -AssemblyName System.Drawing

$sizes = @(32, 64, 128, 256)

foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)

    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        ([System.Drawing.Point]::new(0, 0)),
        ([System.Drawing.Point]::new($s, $s)),
        ([System.Drawing.Color]::FromArgb(255, 0, 120, 212)),
        ([System.Drawing.Color]::FromArgb(255, 98, 0, 238))
    )
    $g.FillRectangle($bg, 0, 0, $s, $s)

    $fontSize = [int]($s * 0.55)
    $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = 'Center'
    $sf.LineAlignment = 'Center'
    $g.DrawString('C', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(0, 0, $s, $s)), $sf)

    $g.Dispose()
    $bmp.Save("D:\WORK\WORK\OPENSOURCE\clipdeck\src-tauri\icons\$s.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "wrote $s.png"
}

# Tauri expects specific filenames: 32x32.png, 128x128.png, 128x128@2x.png, icon.ico, tray.png
Copy-Item "D:\WORK\WORK\OPENSOURCE\clipdeck\src-tauri\icons\32.png"  "D:\WORK\WORK\OPENSOURCE\clipdeck\src-tauri\icons\32x32.png"
Copy-Item "D:\WORK\WORK\OPENSOURCE\clipdeck\src-tauri\icons\128.png" "D:\WORK\WORK\OPENSOURCE\clipdeck\src-tauri\icons\128x128.png"
Copy-Item "D:\WORK\WORK\OPENSOURCE\clipdeck\src-tauri\icons\256.png" "D:\WORK\WORK\OPENSOURCE\clipdeck\src-tauri\icons\128x128@2x.png"

# tray icon (just reuse 32px)
Copy-Item "D:\WORK\WORK\OPENSOURCE\clipdeck\src-tauri\icons\32.png"  "D:\WORK\WORK\OPENSOURCE\clipdeck\src-tauri\icons\tray.png"

# ICO file: combine 16, 32, 48, 64
$icoSizes = @(16, 32, 48, 64)
$icoImages = @()
foreach ($s in $icoSizes) {
    $b = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($b)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        ([System.Drawing.Point]::new(0, 0)),
        ([System.Drawing.Point]::new($s, $s)),
        ([System.Drawing.Color]::FromArgb(255, 0, 120, 212)),
        ([System.Drawing.Color]::FromArgb(255, 98, 0, 238))
    )
    $g.FillRectangle($bg, 0, 0, $s, $s)
    $fs = [int]($s * 0.55)
    $fn = New-Object System.Drawing.Font('Segoe UI', $fs, [System.Drawing.FontStyle]::Bold)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
    $g.DrawString('C', $fn, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(0, 0, $s, $s)), $sf)
    $g.Dispose()
    $icoImages += $b
}

$icoPath = "D:\WORK\WORK\OPENSOURCE\clipdeck\src-tauri\icons\icon.ico"
$fs = [System.IO.File]::OpenWrite($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICONDIR header
$bw.Write([uint16]0)        # Reserved
$bw.Write([uint16]1)        # Type (1 = icon)
$bw.Write([uint16]$icoImages.Count)

# Compute pixel data sizes and offsets
$dataStart = 6 + (16 * $icoImages.Count)
$offsets = @()
$dataChunks = @()
foreach ($img in $icoImages) {
    $ms = New-Object System.IO.MemoryStream
    $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytes = $ms.ToArray()
    $dataChunks += ,$pngBytes
    $offsets += $dataStart
    $dataStart += $pngBytes.Length
    $ms.Dispose()
}

# ICONDIRENTRY for each image
for ($i = 0; $i -lt $icoImages.Count; $i++) {
    $size = $icoImages[$i].Width
    $widthByte = if ($size -ge 256) { 0 } else { $size }
    $bw.Write([byte]$widthByte)
    $bw.Write([byte]$widthByte)
    $bw.Write([byte]0)   # ColorCount
    $bw.Write([byte]0)   # Reserved
    $bw.Write([uint16]1) # ColorPlanes
    $bw.Write([uint16]32) # BitsPerPixel
    $bw.Write([uint32]$dataChunks[$i].Length) # Size
    $bw.Write([uint32]$offsets[$i])           # Offset
}

# Pixel data
foreach ($chunk in $dataChunks) {
    $bw.Write($chunk)
}

$bw.Close()
$fs.Close()
foreach ($img in $icoImages) { $img.Dispose() }
Write-Host "wrote icon.ico"
