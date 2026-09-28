param([Parameter(Mandatory)][string]$Verification)
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$verificationPath=[IO.Path]::GetFullPath($Verification)
$run=Join-Path $repo ('artifacts/rust-phase-2/manual-'+[guid]::NewGuid().ToString('N'))
$previousRun=$env:BATON_MANUAL_RUN_DIR;$previousReport=$env:BATON_DESKTOP_REPORT
Push-Location $repo
try{
    . "$PSScriptRoot/probe-identity.ps1"
    $identity=Get-ProbeIdentity $repo
    $identity.npmLock=(Get-FileHash rust/app/package-lock.json).Hash
    $identity.productExecutable=(Get-FileHash rust/target/debug/baton.exe).Hash
    $identity.acceptanceExecutable=(Get-FileHash rust/target/debug/baton-ui-acceptance.exe).Hash
    $verified=Get-Content -LiteralPath $verificationPath -Raw | ConvertFrom-Json
    if($verified.status -notin @('manual_pending','passed')){throw 'automated_verification_required'}
    foreach($key in @('sourceDigest','cargoLock','npmLock','productExecutable','acceptanceExecutable')){if($identity[$key] -ne $verified.identity.$key){throw "verification_stale:$key"}}
    New-Item -ItemType Directory -Path $run | Out-Null
    $metadata=@{runId=(Split-Path $run -Leaf);identity=$identity;os=[Runtime.InteropServices.RuntimeInformation]::OSDescription;startedUtc=[datetime]::UtcNow.ToString('o')}
    $metadata | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath "$run/metadata.json"
    $env:BATON_MANUAL_RUN_DIR=$run;$env:BATON_DESKTOP_REPORT=Join-Path $run 'result.json'
    Write-Output "MANUAL_RUN $run"
    & pwsh -NoProfile -File "$PSScriptRoot/test-openssh.ps1" -Desktop -Manual -CleanupReport "$run/fixture-cleanup.json"
    $result=$LASTEXITCODE
    $metadata.finishedUtc=[datetime]::UtcNow.ToString('o')
    $metadata | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath "$run/metadata.json"
    if($result -ne 0){throw "manual_run_exit_$result"}
    Write-Output '관측 기록 수집 종료. 물리 시험 통과 판정은 아직 없습니다.'
}finally{$env:BATON_MANUAL_RUN_DIR=$previousRun;$env:BATON_DESKTOP_REPORT=$previousReport;Pop-Location}
