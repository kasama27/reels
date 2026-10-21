# เปิด Arn Reels: ถ้ายังไม่รันจะสตาร์ตเซิร์ฟเวอร์แบบซ่อนหน้าต่าง แล้วเปิดเบราว์เซอร์
# -NoBrowser = สตาร์ตอย่างเดียว (ใช้ตอนเปิดอัตโนมัติพร้อมเครื่อง)
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$port = 8791
$url = "http://localhost:$port/"; $probe = "http://127.0.0.1:$port/"

function Test-Up {
    try { Invoke-WebRequest -Uri $probe -UseBasicParsing -TimeoutSec 3 | Out-Null; $true } catch { $false }
}

if (-not (Test-Up)) {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) { Write-Host 'ไม่พบ node ใน PATH' -ForegroundColor Red; Read-Host 'กด Enter เพื่อปิด'; exit 1 }
    $log = Join-Path $dir 'reels.log'
    Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $dir -WindowStyle Hidden `
        -RedirectStandardOutput $log -RedirectStandardError (Join-Path $dir 'reels.err.log')
    for ($i = 0; $i -lt 20 -and -not (Test-Up); $i++) { Start-Sleep -Milliseconds 500 }
    if (-not (Test-Up)) { Write-Host "เซิร์ฟเวอร์ไม่ขึ้น ดู $log" -ForegroundColor Red; Read-Host 'กด Enter เพื่อปิด'; exit 1 }
}
if (-not $NoBrowser) { Start-Process $url }
