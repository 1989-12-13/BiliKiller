# 用 System.Drawing 生成 BiliKiller 扩展图标（16/32/48/128）
# 配色取自哔哩哔哩品牌粉渐变（#FB7299 → #FF6699），白色字母 B 作为标识。
Add-Type -AssemblyName System.Drawing

function New-Icon {
    param([int]$Size, [string]$Path)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $c1 = [System.Drawing.Color]::FromArgb(255, 251, 114, 153) # #FB7299
    $c2 = [System.Drawing.Color]::FromArgb(255, 255, 102, 153) # #FF6699

    $rect = New-Object System.Drawing.RectangleF(0, 0, $Size, $Size)
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 90)

    # 圆角矩形背景，圆角比例与界面中的 8px / 32px 标识块一致
    $r = [Math]::Max(2, [int]($Size * 0.25))
    $d = $r * 2
    $shape = New-Object System.Drawing.Drawing2D.GraphicsPath
    $shape.AddArc(0, 0, $d, $d, 180, 90)
    $shape.AddArc($Size - $d, 0, $d, $d, 270, 90)
    $shape.AddArc($Size - $d, $Size - $d, $d, $d, 0, 90)
    $shape.AddArc(0, $Size - $d, $d, $d, 90, 90)
    $shape.CloseFigure()
    $g.FillPath($bg, $shape)

    # 白色字母 B：字号按画布比例给足，保证 16px 下仍能辨认
    $fontSize = [Math]::Max(7, [int]($Size * 0.68))
    $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString('B', $font, [System.Drawing.Brushes]::White, $rect, $sf)

    $font.Dispose()
    $bg.Dispose()
    $shape.Dispose()
    $g.Dispose()
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Generated $Path"
}

$dir = Join-Path (Join-Path $PSScriptRoot '..') 'icons'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
New-Icon -Size 16  -Path (Join-Path $dir 'icon16.png')
New-Icon -Size 32  -Path (Join-Path $dir 'icon32.png')
New-Icon -Size 48  -Path (Join-Path $dir 'icon48.png')
New-Icon -Size 128 -Path (Join-Path $dir 'icon128.png')
Write-Host 'All icons generated.'
