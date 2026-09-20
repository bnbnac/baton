[CmdletBinding()]
param([switch]$InjectFailure, [string]$CleanupReport, [switch]$StallAfterReady)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$suffix = [Guid]::NewGuid().ToString('N')
$name = "baton-rust-probe-$suffix"
$tag = "baton-rust-probe:$suffix"
$created = $false
$built = $false
$oldPort = $env:BATON_PROBE_SSH_PORT
$oldKey = $env:BATON_PROBE_HOST_KEY
function Save-OwnedFixture {
    if ($CleanupReport) {
        $temporary = $CleanupReport + '.owned.partial'
        @{ id = $id; name = $name; label = $suffix; tag = $tag; imageId = $imageId } | ConvertTo-Json | Set-Content -LiteralPath $temporary
        Move-Item -LiteralPath $temporary -Destination ($CleanupReport + '.owned.json') -Force
    }
}
try {
    Save-OwnedFixture
    $imageId = & docker build --quiet --tag $tag --file (Join-Path $repo 'tests/linux-ssh/Dockerfile') (Join-Path $repo 'tests/linux-ssh')
    if ($LASTEXITCODE -ne 0) { throw 'fixture_build_failed' }
    $built = $true
    Save-OwnedFixture
    $id = & docker run --detach --name $name --publish '127.0.0.1::22' --label "baton.rust-probe=$suffix" $tag
    if ($LASTEXITCODE -ne 0 -or $id -notmatch '^[0-9a-f]{64}$') { throw 'fixture_start_failed' }
    $created = $true
    Save-OwnedFixture
    $binding = & docker port $id '22/tcp'
    if ($LASTEXITCODE -ne 0 -or $binding -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'fixture_port_failed' }
    $env:BATON_PROBE_SSH_PORT = $Matches[1]
    $key = & docker exec $id ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
    if ($LASTEXITCODE -ne 0 -or $key -notmatch '(SHA256:[A-Za-z0-9+/]+)') { throw 'fixture_fingerprint_failed' }
    $env:BATON_PROBE_HOST_KEY = $Matches[1]
    $ready = $false
    for ($i = 0; $i -lt 50 -and -not $ready; $i++) {
        $tcp = [Net.Sockets.TcpClient]::new()
        try { $ready = $tcp.ConnectAsync('127.0.0.1', [int]$env:BATON_PROBE_SSH_PORT).Wait(200) -and $tcp.Connected }
        catch { $ready = $false }
        finally { $tcp.Dispose() }
        if (-not $ready) { Start-Sleep -Milliseconds 100 }
    }
    if (-not $ready) { throw 'fixture_not_ready' }
    if ($StallAfterReady) {
        Set-Content -LiteralPath ($CleanupReport + '.barrier') 'container-ready'
        Start-Sleep -Seconds 60
        throw 'stall_not_interrupted'
    }
    if ($InjectFailure) { throw 'injected_container-ready' }
    & node (Join-Path $repo 'rust/tests/openssh.test.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'openssh_probe_failed' }
} finally {
    $env:BATON_PROBE_SSH_PORT = $oldPort
    $env:BATON_PROBE_HOST_KEY = $oldKey
    if ($created) {
        $identity = & docker inspect --format '{{.Id}} {{.Name}} {{index .Config.Labels "baton.rust-probe"}}' $id
        if ($LASTEXITCODE -ne 0 -or $identity.Trim() -ne "$id /$name $suffix") { throw 'unsafe_fixture_cleanup' }
        & docker rm --force --volumes $id | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'fixture_cleanup_failed' }
    }
    if ($built) {
        & docker image rm $tag | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'image_cleanup_failed' }
    }
    if ($CleanupReport) {
        $remaining = @(& docker ps --all --quiet --filter "label=baton.rust-probe=$suffix")
        if ($LASTEXITCODE -ne 0) { throw 'cleanup_inspection_failed' }
        @{ id = $id; name = $name; label = $suffix; remaining = $remaining.Count } | ConvertTo-Json | Set-Content -LiteralPath $CleanupReport
        if ($remaining.Count -ne 0) { throw 'container_leaked' }
    }
}
