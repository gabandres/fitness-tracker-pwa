# The Expo app in a browser, for a rendered check without a device.
#
#   pwsh -File scripts/web-check/server.ps1 start    # (re)start, wait until the page answers
#   pwsh -File scripts/web-check/server.ps1 stop
#   pwsh -File scripts/web-check/server.ps1 status
#
# `start` always stops the old server first: under CI=1 Metro never reloads, so
# a server left running goes on serving the code from before the edit. `stop`
# kills the whole launcher tree AND whatever holds the port: stopping only the
# shell leaves the node child serving, and stopping only the node child leaves
# its parents holding the log file, which makes the next start die at once.
# How to drive the page: the `test-mobile-web` skill.
param(
  [ValidateSet('start', 'stop', 'status')][string]$Action = 'status',
  [int]$Port = 8097
)

$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$state = Join-Path $env:TEMP "ignia-web-$Port.json"

function Get-Listener {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Get-State {
  if (Test-Path $state) { Get-Content $state -Raw | ConvertFrom-Json } else { $null }
}

function Stop-Server {
  $s = Get-State
  if ($s -and (Get-Process -Id $s.pid -ErrorAction SilentlyContinue)) {
    & taskkill /PID $s.pid /T /F *> $null
    "stopped the launcher tree (pid $($s.pid))"
  }
  $c = Get-Listener
  if ($c) {
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    "stopped pid $($c.OwningProcess) on $Port"
  }
  Remove-Item $state -ErrorAction SilentlyContinue
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline -and (Get-Listener)) { Start-Sleep -Milliseconds 500 }
  if (Get-Listener) { "port $Port is STILL held"; exit 1 }
  "port $Port is free"
}

switch ($Action) {
  'stop' { Stop-Server }
  'status' {
    $c = Get-Listener
    $s = Get-State
    if ($c) { "listening on $Port (pid $($c.OwningProcess)); log: $($s.log)" } else { "nothing is listening on $Port" }
  }
  'start' {
    Stop-Server
    $log = Join-Path $env:TEMP ("ignia-web-$Port-" + (Get-Date -Format 'HHmmss') + '.log')
    $env:CI = '1'
    $p = Start-Process -FilePath 'cmd.exe' -WindowStyle Hidden -PassThru -WorkingDirectory (Join-Path $repo 'apps\mobile') `
      -ArgumentList '/c', "npx expo start --web --port $Port > `"$log`" 2>&1"
    @{ pid = $p.Id; log = $log } | ConvertTo-Json | Set-Content $state
    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline -and -not (Get-Listener)) { Start-Sleep -Seconds 2 }
    if (-not (Get-Listener)) {
      "nothing came up on $Port within 120 s; last log lines:"
      if (Test-Path $log) { Get-Content $log -Tail 15 }
      exit 1
    }
    # ONE long request: the first one waits on Metro, and a short timeout that
    # retries never sees it answer.
    $status = 0
    try { $status = (Invoke-WebRequest -Uri "http://localhost:$Port" -UseBasicParsing -TimeoutSec 300).StatusCode } catch { $status = 0 }
    if ($status -ne 200) {
      "listening on $Port but the page did not answer within 300 s; last log lines:"
      if (Test-Path $log) { Get-Content $log -Tail 15 }
      exit 1
    }
    "http://localhost:$Port answers (log: $log). The first page still builds the bundle: it can sit on the splash for 1-2 minutes."
  }
}
