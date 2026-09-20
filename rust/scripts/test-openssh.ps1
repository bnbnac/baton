[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$suffix = [Guid]::NewGuid().ToString('N')
$name = "baton-rust-probe-$suffix"
$tag = "baton-rust-probe:$suffix"
$created = $false
$built = $false
$oldPort = $env:BATON_PROBE_SSH_PORT
$oldKey = $env:BATON_PROBE_HOST_KEY
try {
    & docker build --quiet --tag $tag --file (Join-Path $repo 'tests/linux-ssh/Dockerfile') (Join-Path $repo 'tests/linux-ssh')
    if ($LASTEXITCODE -ne 0) { throw 'fixture_build_failed' }
    $built = $true
    $id = & docker run --detach --name $name --publish '127.0.0.1::22' --label "baton.rust-probe=$suffix" $tag
    if ($LASTEXITCODE -ne 0 -or $id -notmatch '^[0-9a-f]{64}$') { throw 'fixture_start_failed' }
    $created = $true
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
    & node (Join-Path $repo 'rust/tests/openssh.test.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'openssh_probe_failed' }
} finally {
    $env:BATON_PROBE_SSH_PORT = $oldPort
    $env:BATON_PROBE_HOST_KEY = $oldKey
    if ($created) {
        $identity = & docker inspect --format '{{.Id}} {{index .Config.Labels "baton.rust-probe"}}' $id
        if ($LASTEXITCODE -ne 0 -or $identity.Trim() -ne "$id $suffix") { throw 'unsafe_fixture_cleanup' }
        & docker rm --force --volumes $id | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'fixture_cleanup_failed' }
    }
    if ($built) {
        & docker image rm $tag | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'image_cleanup_failed' }
    }
}
