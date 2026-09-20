param([string]$ReportPath, [switch]$ExpectFailure)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$exe = Join-Path $root 'rust/target/debug/baton-terminal-probe.exe'
if (!$ReportPath) { $ReportPath = Join-Path $root '.superpowers/sdd/2026-09-20-rust-phase-0/webview-result.json' }
$ReportPath = [IO.Path]::GetFullPath($ReportPath)
$oldReport = $env:BATON_TERMINAL_REPORT
$runReport = Join-Path ([IO.Path]::GetDirectoryName($ReportPath)) (([guid]::NewGuid().ToString('N')) + '.json')
$probeProcess = $null
try {
    $env:BATON_TERMINAL_REPORT = $runReport
    $probeProcess = Start-Process -FilePath $exe -WindowStyle Hidden -PassThru
    $started = $probeProcess.StartTime.ToUniversalTime().Ticks
    $limit = [datetime]::UtcNow.AddSeconds(45)
    while (!(Test-Path -LiteralPath $runReport)) {
        if ($probeProcess.HasExited) { throw 'webview_exited_without_report' }
        if ([datetime]::UtcNow -gt $limit) { throw 'webview_report_timeout' }
        Start-Sleep -Milliseconds 100
    }
    $result = Get-Content -Raw -LiteralPath $runReport | ConvertFrom-Json
    Move-Item -LiteralPath $runReport -Destination $ReportPath -Force
    $failed = @($result | Where-Object { !$_.passed })
    $result | ConvertTo-Json -Depth 8
    if (!$result.Count -or (($failed.Count -gt 0) -ne [bool]$ExpectFailure)) { throw 'unexpected_webview_result' }
} finally {
    $env:BATON_TERMINAL_REPORT = $oldReport
    if ($probeProcess -and !$probeProcess.HasExited) {
        $current = Get-Process -Id $probeProcess.Id -ErrorAction SilentlyContinue
        if ($current -and $current.StartTime.ToUniversalTime().Ticks -eq $started -and $current.Path -eq [IO.Path]::GetFullPath($exe)) {
            [void]$current.CloseMainWindow()
            if (!$current.WaitForExit(3000)) { Stop-Process -InputObject $current; [void]$current.WaitForExit(3000) }
        } else { throw 'owned_process_identity_mismatch' }
    }
}
