param([string]$TestCargoExecutable='cargo',[string]$RepositoryRoot,[string]$OutputDirectory,[string]$ManualEvidence)
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
if(!$RepositoryRoot){$RepositoryRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))}
if(!$OutputDirectory){$OutputDirectory=Join-Path $RepositoryRoot ('artifacts/rust-phase-2/'+[datetime]::UtcNow.ToString('yyyyMMddTHHmmss')+'-'+[guid]::NewGuid().ToString('N'))}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
$receipt=[ordered]@{status='failed';failure=$null;runId=(Split-Path $OutputDirectory -Leaf);startedUtc=[datetime]::UtcNow.ToString('o');commands=@()}
$summary=Join-Path $OutputDirectory 'summary.json';$code=1
$oldReport=$env:BATON_DESKTOP_REPORT
function Run-Step([string]$Name,[string]$Executable,[string[]]$ToolArgs){
    $log=Join-Path $OutputDirectory ($Name+'.log');$timer=[Diagnostics.Stopwatch]::StartNew()
    & $Executable @ToolArgs *> $log
    $result=$LASTEXITCODE
    $receipt.commands+=@{name=$Name;executable=$Executable;arguments=$ToolArgs;exitCode=$result;seconds=$timer.Elapsed.TotalSeconds;log=$log}
    if($result -ne 0){throw "${Name}_exit_$result"}
    Write-Output "PASS $Name ($([math]::Round($timer.Elapsed.TotalSeconds,1))s)"
}
function Identity {
    $value=Get-ProbeIdentity $RepositoryRoot
    $value.npmLock=(Get-FileHash 'rust/app/package-lock.json').Hash
    $value.productExecutable=(Get-FileHash 'rust/target/debug/baton.exe').Hash
    $value.acceptanceExecutable=(Get-FileHash 'rust/target/debug/baton-ui-acceptance.exe').Hash
    $value.dirty=[bool]((& git status --porcelain | Out-String).Trim())
    return $value
}
Push-Location $RepositoryRoot
try{
    . (Join-Path $PSScriptRoot 'probe-identity.ps1')
    Run-Step 'fmt' $TestCargoExecutable @('+stable','fmt','--manifest-path','rust/Cargo.toml','--all','--','--check')
    $sourceBefore=Get-ProbeIdentity $RepositoryRoot
    Run-Step 'rust-version' 'rustc' @('+stable','--version')
    Run-Step 'node-version' 'node' @('--version')
    $receipt.os=[Runtime.InteropServices.RuntimeInformation]::OSDescription
    $receipt.rust=(Get-Content "$OutputDirectory/rust-version.log" -Raw).Trim();$receipt.node=(Get-Content "$OutputDirectory/node-version.log" -Raw).Trim()
    Run-Step 'clippy' $TestCargoExecutable @('+stable','clippy','--manifest-path','rust/Cargo.toml','--locked','-p','baton-core','-p','baton-ssh','-p','baton-app','--all-targets','--features','baton-app/desktop','--','-D','warnings')
    Run-Step 'rust-tests' $TestCargoExecutable @('+stable','test','--manifest-path','rust/Cargo.toml','--locked','-p','baton-core','-p','baton-ssh','-p','baton-app','--all-targets','--','--nocapture')
    $npm=Join-Path (Split-Path (Get-Command node -ErrorAction Stop).Source) 'npm.cmd'
    Run-Step 'ui-tests' $npm @('test','--prefix','rust/app')
    Run-Step 'ui-build' $npm @('run','build','--prefix','rust/app')
    Push-Location rust/app
    try{Run-Step 'acceptance-assets' 'node' @('node_modules/vite/bin/vite.js','build','--config','vite.acceptance.config.ts')}finally{Pop-Location}
    Run-Step 'product-build' $TestCargoExecutable @('+stable','build','--manifest-path','rust/Cargo.toml','--locked','-p','baton-app','--features','desktop','--bin','baton')
    Run-Step 'acceptance-build' $TestCargoExecutable @('+stable','build','--manifest-path','rust/Cargo.toml','--locked','-p','baton-app','--features','desktop,acceptance','--bin','baton-ui-acceptance')
    $receipt.identity=Identity
    if($receipt.identity.sourceDigest -ne $sourceBefore.sourceDigest){throw 'source_changed_during_build'}
    $receipt.desktopReport=Join-Path $OutputDirectory 'desktop.json';$env:BATON_DESKTOP_REPORT=$receipt.desktopReport
    Run-Step 'node-tests' 'node' @('--test','--test-concurrency=1','rust/tests/phase2/auth.test.mjs','rust/tests/phase2/ssh.test.mjs','rust/tests/phase2/desktop.test.mjs','rust/tests/phase2/runner.test.mjs','rust/tests/phase2/cleanup.test.mjs','rust/tests/phase2/manual-proxy.test.mjs')
    $receipt.opensshReport=Join-Path $OutputDirectory 'openssh.json';$env:BATON_DESKTOP_REPORT=$receipt.opensshReport
    $receipt.fixtureCleanup=Join-Path $OutputDirectory 'fixture-cleanup.json'
    Run-Step 'openssh' 'pwsh' @('-NoProfile','-File','rust/scripts/test-openssh.ps1','-Desktop','-CleanupReport',$receipt.fixtureCleanup)
    $receipt.manualSmokeReport=Join-Path $OutputDirectory 'manual-smoke.json';$env:BATON_DESKTOP_REPORT=$receipt.manualSmokeReport
    $receipt.manualSmokeCleanup=Join-Path $OutputDirectory 'manual-smoke-cleanup.json'
    Run-Step 'manual-smoke' 'pwsh' @('-NoProfile','-File','rust/scripts/test-openssh.ps1','-Desktop','-ManualSmoke','-CleanupReport',$receipt.manualSmokeCleanup)
    $receipt.identityAfter=Identity
    $receipt.finishedUtc=[datetime]::UtcNow.ToString('o')
    $receipt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $summary
    $arguments=@('rust/tests/phase2/validate-run.mjs',$summary);if($ManualEvidence){$arguments+=[IO.Path]::GetFullPath($ManualEvidence)}
    & node @arguments
    $code=$LASTEXITCODE
    if($code -notin @(0,1,2)){throw "gate_exit_$code"}
}catch{
    $receipt.failure=$_.Exception.Message;$receipt.finishedUtc=[datetime]::UtcNow.ToString('o')
    $receipt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $summary
    Write-Output "PHASE_2_FAILED $($receipt.failure)";$code=1
}finally{$env:BATON_DESKTOP_REPORT=$oldReport;Pop-Location}
Write-Output "PHASE_2_RECEIPT $summary"
exit $code
