# network-stats.ps1
# Returns interface stats and TCP connection state counts as JSON.
# Output: { interfaces: [...], connections: { total, established, listen, timeWait, closeWait } }

$ErrorActionPreference = 'Stop'

$netStats = Get-NetTCPConnection
$total = $netStats.Count
$established = ($netStats | Where-Object { $_.State -eq 'Established' }).Count
$listen = ($netStats | Where-Object { $_.State -eq 'Listen' }).Count
$timeWait = ($netStats | Where-Object { $_.State -eq 'TimeWait' }).Count
$closeWait = ($netStats | Where-Object { $_.State -eq 'CloseWait' }).Count

$interfaces = Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object {
  $stats = Get-NetAdapterStatistics -Name $_.Name -ErrorAction SilentlyContinue
  [PSCustomObject]@{
    iface    = $_.Name
    rxSec    = 0
    txSec    = 0
    rxTotal  = if ($stats) { [math]::Round($stats.ReceivedBytes / 1MB * 10) / 10 } else { 0 }
    txTotal  = if ($stats) { [math]::Round($stats.SentBytes / 1MB * 10) / 10 } else { 0 }
  }
}

[PSCustomObject]@{
  interfaces = $interfaces
  connections = [PSCustomObject]@{
    total      = $total
    established = $established
    listen     = $listen
    timeWait   = $timeWait
    closeWait  = $closeWait
  }
} | ConvertTo-Json -Compress
