$ErrorActionPreference = 'SilentlyContinue'

# Use Windows Performance Counters for reliable per-process IO data
# This provides direct IO rates without needing to sample and calculate deltas
$counters = Get-Counter -Counter '\Process(*)\IO Data Bytes/sec' -SampleInterval 1 -MaxSamples 1 -ErrorAction SilentlyContinue

if ($counters) {
    $counters.CounterSamples | ForEach-Object {
        $path = $_.Path
        $cookedValue = $_.CookedValue
        
        # Extract PID and process name from path like "\\computername\process(name)\io data bytes/sec"
        # Note: Performance counters don't provide PID directly, we'll need to match by name
        $match = $path -match '\\process\((.+?)\)\\io data bytes/sec'
        if ($match) {
            $processName = $Matches[1]
            # _Total and other special instances should be skipped
            if ($processName -ne '_Total' -and $processName -ne '' -and $processName -ne 'Idle') {
                # Since we can't get PID from performance counters, we'll use process name
                # The processViewer will need to match by name instead of PID
                Write-Output "$processName|$cookedValue"
            }
        }
    }
}
