$counters = Get-Counter -Counter '\Process(*)\IO Data Bytes/sec' -SampleInterval 1 -MaxSamples 1 -ErrorAction SilentlyContinue
if ($counters) {
    $counters.CounterSamples | ForEach-Object {
        $path = $_.Path
        $cookedValue = $_.CookedValue
        Write-Output "$path|$cookedValue"
    }
}
