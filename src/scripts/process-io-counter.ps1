$ErrorActionPreference = 'SilentlyContinue'
$samples = 3
$intervalMs = 600
$accum = @{}
$names = @{}

for ($i = 0; $i -lt $samples; $i++) {
    $rows = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfProc_Process
    foreach ($row in $rows) {
        $procId = [int]$row.IDProcess
        if ($procId -le 0) { continue }
        if (-not $accum.ContainsKey($procId)) {
            $accum[$procId] = @{ Read = 0.0; Write = 0.0; Other = 0.0 }
            $names[$procId] = [string]$row.Name
        }
        $accum[$procId].Read += [double]$row.IOReadBytesPerSec
        $accum[$procId].Write += [double]$row.IOWriteBytesPerSec
        $accum[$procId].Other += [double]$row.IOOtherBytesPerSec
    }
    if ($i -lt ($samples - 1)) { Start-Sleep -Milliseconds $intervalMs }
}

foreach ($procId in ($accum.Keys | Sort-Object)) {
    $entry = $accum[$procId]
    $read = $entry.Read / $samples
    $write = $entry.Write / $samples
    $other = $entry.Other / $samples
    Write-Output ("{0}|{1}|{2}|{3}|{4}" -f $procId, $names[$procId], [math]::Round($read, 1), [math]::Round($write, 1), [math]::Round($other, 1))
}
