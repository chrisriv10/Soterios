$svgContent = [IO.File]::ReadAllText("build/icon.svg")
$ms = New-Object IO.MemoryStream
$sw = New-Object IO.StreamWriter($ms)
$sw.Write($svgContent)
$sw.Flush()
$ms.Position = 0
$img = [System.Drawing.Image]::FromStream($ms)
$bmp = New-Object System.Drawing.Bitmap($img, 500, 120)
$bmp.Save("build/welcome-banner.bmp", [System.Drawing.Imaging.ImageFormat]::Bmp)
$img.Dispose()
$bmp.Dispose()
Write-Host "Converted welcome-banner.bmp"