# dev-cleanup.ps1
# 杀掉所有 lynel-desktop 开发环境遗留进程（node + electron）。
# 用 taskkill /F /T 杀进程树，避免孤儿进程。

$patterns = @(
  'lynel-desktop',
  'tsc --watch',
  'concurrently.*npm run dev',
  'vite/bin/vite',
  'electron\\dist\\electron'
)

$procs = Get-Process -Name node,electron -ErrorAction SilentlyContinue | Where-Object {
  try {
    $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction Stop).CommandLine
    foreach ($p in $patterns) { if ($cmd -match $p) { return $true } }
    return $false
  } catch {
    return $false
  }
}

$killed = 0
foreach ($p in $procs) {
  taskkill /F /T /PID $p.Id 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $killed++ }
}

Write-Host "[dev-cleanup] killed $killed process(es)"
