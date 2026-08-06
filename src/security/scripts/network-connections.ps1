# network-connections.ps1
# Returns all TCP connections as JSON.
# Output: array of { LocalAddress, LocalPort, RemoteAddress, RemotePort, State, OwningProcess }

$ErrorActionPreference = 'Stop'
Get-NetTCPConnection |
  Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, State, OwningProcess |
  ConvertTo-Json -Compress
