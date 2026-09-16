#requires -Version 7.2
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fixtureId = [Guid]::NewGuid().ToString('N')
$containerName = "baton-close-test-$fixtureId"
$imageTag = "baton-close-test:$fixtureId"
$createdImage = $false
$createdContainer = $false
$previousDotnetHome = $env:DOTNET_CLI_HOME
$probe = $null
$results = [Collections.Generic.List[object]]::new()

function Read-RemoteProcess([int] $remotePid) {
    $raw = & docker exec $containerName cat "/proc/$remotePid/stat" 2>$null
    if ($LASTEXITCODE -ne 0) { return [pscustomobject]@{ pid = $remotePid; state = 'absent'; active = $false; startTicks = $null } }
    if ($raw -notmatch '^\d+ \(.*\) (.+)$') { throw 'invalid_proc_stat' }
    $fields = $Matches[1] -split ' '
    return [pscustomobject]@{ pid = $remotePid; state = $fields[0]; active = $fields[0] -notin @('Z','X'); startTicks = $fields[19] }
}
function Read-TrackedProcesses($tracked) {
    $snapshot = [ordered]@{}
    foreach ($name in @('shellPid','sshdPid','backgroundPid','detachedPid','foregroundPid')) {
        $snapshot[$name] = Read-RemoteProcess $tracked.$name
    }
    return $snapshot
}
try {
    $env:DOTNET_CLI_HOME = Join-Path $repository '.buildhome'
    & dotnet build (Join-Path $repository 'tests\Baton.LifecycleProbe') -c Debug --configfile (Join-Path $repository 'NuGet.Config')
    if ($LASTEXITCODE -ne 0) { throw 'probe_build_failed' }
    & docker build --quiet --tag $imageTag (Join-Path $repository 'tests\linux-ssh')
    if ($LASTEXITCODE -ne 0) { throw 'fixture_build_failed' }
    $createdImage = $true
    & docker run --detach --init --name $containerName --publish '127.0.0.1::22' --label "baton.lifecycle=$fixtureId" $imageTag | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'fixture_start_failed' }
    $createdContainer = $true
    $binding = & docker port $containerName '22/tcp'
    if ($LASTEXITCODE -ne 0 -or $binding -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'invalid_fixture_binding' }
    $port = $Matches[1]
    Start-Sleep -Milliseconds 500
    $versions = & docker exec $containerName sh -c 'cat /etc/alpine-release; bash --version | head -n 1; /usr/sbin/sshd -V 2>&1'
    foreach ($mode in @('registry_dispose', 'process_kill')) {
        $start = [Diagnostics.ProcessStartInfo]::new('dotnet')
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardInput = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $start.ArgumentList.Add((Join-Path $repository 'tests\Baton.LifecycleProbe\bin\Debug\net10.0-windows\Baton.LifecycleProbe.dll'))
        $start.ArgumentList.Add($port)
        $probe = [Diagnostics.Process]::Start($start)
        $line = $probe.StandardOutput.ReadLineAsync().WaitAsync([TimeSpan]::FromSeconds(20)).GetAwaiter().GetResult()
        if (!$line) { throw 'probe_failed_before_ready' }
        $tracked = $line | ConvertFrom-Json
        $before = Read-TrackedProcesses $tracked
        foreach ($entry in $before.Values) { if (!$entry.active) { throw 'fixture_process_not_running_before_close' } }
        $timer = [Diagnostics.Stopwatch]::StartNew()
        if ($mode -eq 'registry_dispose') {
            $probe.StandardInput.WriteLine('dispose')
            $ack = $probe.StandardOutput.ReadLineAsync().WaitAsync([TimeSpan]::FromSeconds(5)).GetAwaiter().GetResult()
            if ($ack -ne 'registry_disposed') { throw 'missing_dispose_ack' }
        } else {
            $probe.Kill()
            if (!$probe.WaitForExit(5000)) { throw 'probe_kill_timeout' }
        }
        do {
            $after = Read-TrackedProcesses $tracked
            $ordinaryActive = $after.shellPid.active -or $after.sshdPid.active -or $after.backgroundPid.active -or $after.foregroundPid.active
            if ($ordinaryActive) { Start-Sleep -Milliseconds 100 }
        } while ($ordinaryActive -and $timer.Elapsed.TotalSeconds -lt 10)
        $elapsed = $timer.ElapsedMilliseconds
        $result = [pscustomobject]@{ mode = $mode; observationMs = $elapsed; before = $before; after = $after; hostAliveDuringObservation = !$probe.HasExited; versions = $versions }
        $results.Add($result)
        $result | ConvertTo-Json -Depth 6 -Compress
        if ($ordinaryActive) { throw 'ordinary_process_survived_observation_window' }
        if (!$after.detachedPid.active -or $after.detachedPid.startTicks -ne $before.detachedPid.startTicks) { throw 'detached_control_did_not_survive' }
        if ($mode -eq 'registry_dispose' -and $probe.HasExited) { throw 'probe_exited_before_dispose_observation' }
        if (!$probe.HasExited) {
            $probe.StandardInput.WriteLine('exit')
            if (!$probe.WaitForExit(5000)) { throw 'probe_exit_timeout' }
        }
        $probe.Dispose()
        $probe = $null
    }
    $reportDirectory = Join-Path $repository 'artifacts\verification'
    New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
    ConvertTo-Json -InputObject $results.ToArray() -Depth 6 | Set-Content -LiteralPath (Join-Path $reportDirectory 'server-lifecycle.json') -Encoding utf8
}
finally {
    if ($probe) { if (!$probe.HasExited) { $probe.Kill(); $probe.WaitForExit() }; $probe.Dispose() }
    $env:DOTNET_CLI_HOME = $previousDotnetHome
    if ($createdContainer) {
        $label = & docker inspect --format '{{index .Config.Labels "baton.lifecycle"}}' $containerName
        if ($LASTEXITCODE -ne 0 -or $label.Trim() -ne $fixtureId -or $containerName -notmatch '^baton-close-test-[0-9a-f]{32}$') { throw 'fixture_identity_mismatch' }
        & docker rm --force --volumes $containerName | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'fixture_cleanup_failed' }
    }
    if ($createdImage) { & docker image rm $imageTag | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'fixture_image_cleanup_failed' } }
}
