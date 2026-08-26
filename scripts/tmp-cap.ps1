param([string]$Name = "shot", [int]$W = 360)
$dir = "C:/Users/gabri/AppData/Local/Temp/claude/Z--macro-app/9a598c1f-0ec2-4ec8-838a-b3f58c27d201/scratchpad/shots"
$raw = "$dir/$Name.raw.png"
$out = "$dir/$Name.png"
& "Z:/packages/android-sdk/platform-tools/adb.exe" exec-out screencap -p > $raw
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($raw)
$h = [int]($img.Height * $W / $img.Width)
$bmp = New-Object System.Drawing.Bitmap($W, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = 'HighQualityBicubic'
$g.DrawImage($img, 0, 0, $W, $h)
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $img.Dispose()
Remove-Item $raw
Write-Output "$out"
