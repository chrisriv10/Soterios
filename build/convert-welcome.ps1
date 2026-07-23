# Use Windows Imaging Component (WIC) to properly rasterize SVG
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName WindowsBase

$svgPath = "build/welcome-banner.svg"
if (-not (Test-Path $svgPath)) {
    Write-Error "SVG file not found: $svgPath"
    exit 1
}

# Load SVG using WIC
$decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create(
    [System.Uri]::new((Resolve-Path $svgPath)),
    [System.IO.FileAccess]::Read,
    [System.Windows.Media.Imaging.BitmapCreateOptions]::IgnoreColorProfile
)

$frame = $decoder.Frames[0]
$bmp = New-Object System.Drawing.Bitmap(500, 120)
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.DrawImage($frame, 0, 0, 500, 120)
$bmp.Save("build/welcome-banner.bmp", [System.Drawing.Imaging.ImageFormat]::Bmp)
$graphics.Dispose()
$bmp.Dispose()
Write-Host "Converted welcome-banner.bmp"