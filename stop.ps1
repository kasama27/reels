# ปิด Arn Reels (ฆ่า node ที่ฟังพอร์ต 8791 เท่านั้น)
$port = 8791
$conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) { Write-Host 'Arn Reels ไม่ได้รันอยู่'; return }
foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force }
Write-Host 'ปิด Arn Reels แล้ว'
