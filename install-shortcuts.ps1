# สร้างไอคอน "Arn Reels" บนเดสก์ท็อป (กดเปิดเอง) และ/หรือให้เปิดอัตโนมัติตอนเข้า Windows
#   .\install-shortcuts.ps1            สร้างไอคอนเดสก์ท็อป + เปิดอัตโนมัติตอนบูต
#   .\install-shortcuts.ps1 -NoAuto    เฉพาะไอคอนเดสก์ท็อป
#   .\install-shortcuts.ps1 -Remove    ลบทั้งสองอย่าง
param([switch]$NoAuto, [switch]$Remove)
$dir = $PSScriptRoot
$ws = New-Object -ComObject WScript.Shell
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Arn Reels.lnk'
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Arn Reels (auto).lnk'

if ($Remove) {
    Remove-Item $desktop, $startup -ErrorAction SilentlyContinue
    Write-Host 'ลบทางลัดแล้ว'; return
}

function New-Link($path, $args2) {
    $s = $ws.CreateShortcut($path)
    $s.TargetPath = (Get-Command powershell.exe).Source
    $s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dir\start.ps1`" $args2"
    $s.WorkingDirectory = $dir
    $s.IconLocation = "$dir\arn-reels.ico,0"
    $s.Description = 'Arn Reels'
    $s.Save()
}

New-Link $desktop ''
Write-Host "สร้างไอคอนเดสก์ท็อป: $desktop"
if (-not $NoAuto) {
    New-Link $startup '-NoBrowser'
    Write-Host "ตั้งเปิดอัตโนมัติตอนเข้า Windows: $startup"
}
