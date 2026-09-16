[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fixtureDirectory = Join-Path $repository 'tests\linux-ssh'
$dockerfile = Join-Path $fixtureDirectory 'Dockerfile'
$suffix = [Guid]::NewGuid().ToString('N')
$containerName = "baton-test-$suffix"
$imageTag = "baton-linux-ssh-test:$suffix"
$containerCreated = $false
$imageCreated = $false
$previousPort = $env:BATON_LINUX_SSH_PORT
$previousContainer = $env:BATON_LINUX_SSH_CONTAINER
$previousFixtureId = $env:BATON_LINUX_SSH_FIXTURE_ID
$previousDotnetHome = $env:DOTNET_CLI_HOME

try {
    & docker build --quiet --tag $imageTag --file $dockerfile $fixtureDirectory
    if ($LASTEXITCODE -ne 0) { throw 'docker_build_failed' }
    $imageCreated = $true

    $containerId = & docker run --detach --name $containerName --publish '127.0.0.1::22' --label "baton.integration=$suffix" $imageTag
    if ($LASTEXITCODE -ne 0 -or $containerId -notmatch '^[0-9a-f]{64}$') { throw 'docker_run_failed' }
    $containerCreated = $true

    $binding = & docker port $containerName '22/tcp'
    if ($LASTEXITCODE -ne 0 -or $binding -notmatch '127\.0\.0\.1:(\d+)$') { throw 'docker_port_failed' }
    $port = [int]$Matches[1]

    $ready = $false
    for ($attempt = 0; $attempt -lt 50 -and -not $ready; $attempt++) {
        $client = [System.Net.Sockets.TcpClient]::new()
        try {
            $connect = $client.ConnectAsync('127.0.0.1', $port)
            $ready = $connect.Wait(200) -and $client.Connected
        }
        catch { $ready = $false }
        finally { $client.Dispose() }
        if (-not $ready) { Start-Sleep -Milliseconds 100 }
    }
    if (-not $ready) { throw 'sshd_not_ready' }

    $env:BATON_LINUX_SSH_PORT = $port.ToString([Globalization.CultureInfo]::InvariantCulture)
    $env:BATON_LINUX_SSH_CONTAINER = $containerName
    $env:BATON_LINUX_SSH_FIXTURE_ID = $suffix
    $env:DOTNET_CLI_HOME = Join-Path $repository '.buildhome'
    & dotnet test (Join-Path $repository 'tests\Baton.Tests\Baton.Tests.csproj') --no-restore --configuration Debug --filter 'FullyQualifiedName~LinuxSshTests'
    if ($LASTEXITCODE -ne 0) { throw 'linux_ssh_tests_failed' }
}
finally {
    $env:BATON_LINUX_SSH_PORT = $previousPort
    $env:BATON_LINUX_SSH_CONTAINER = $previousContainer
    $env:BATON_LINUX_SSH_FIXTURE_ID = $previousFixtureId
    $env:DOTNET_CLI_HOME = $previousDotnetHome

    if ($containerCreated) {
        if ($containerName -notmatch '^baton-test-[0-9a-f]{32}$') { throw 'unsafe_container_name' }
        $actualName = & docker container inspect --format '{{.Name}}' $containerName 2>$null
        if ($LASTEXITCODE -eq 0) {
            if ($actualName.Trim() -ne "/$containerName") { throw 'container_identity_mismatch' }
            $actualLabel = & docker container inspect --format '{{index .Config.Labels "baton.integration"}}' $containerName
            if ($LASTEXITCODE -ne 0 -or $actualLabel.Trim() -ne $suffix) { throw 'container_label_mismatch' }
            & docker container rm --force --volumes $containerName | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'container_cleanup_failed' }
        }
        & docker container inspect $containerName 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { throw 'container_cleanup_verification_failed' }
    }

    if ($imageCreated) {
        & docker image rm $imageTag | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'image_cleanup_failed' }
    }
}
