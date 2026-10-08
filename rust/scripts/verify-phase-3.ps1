param([string]$RepositoryRoot,[string]$OutputDirectory,[string]$ReuseEvidence)
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
if($PSVersionTable.PSVersion.Major -lt 7){
    $candidates=@((Join-Path $env:ProgramFiles 'PowerShell/7/pwsh.exe'),(Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'))
    $pwshCommand=Get-Command pwsh -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if($pwshCommand){$candidates=@($pwshCommand.Source)+$candidates}
    $engine=$candidates | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
    if(!$engine){throw 'PowerShell 7 is required. Run this script with the absolute path to pwsh.exe (for example C:\Program Files\PowerShell\7\pwsh.exe).'}
    $forward=@();foreach($parameterName in $PSBoundParameters.Keys){$forward+=('-'+$parameterName);$forward+=$PSBoundParameters[$parameterName]}
    & $engine -NoProfile -File $PSCommandPath @forward
    exit $LASTEXITCODE
}
if(!$RepositoryRoot){$RepositoryRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))}
if(!$OutputDirectory){$OutputDirectory=Join-Path $RepositoryRoot ('artifacts/rust-phase-3/'+[datetime]::UtcNow.ToString('yyyyMMddTHHmmss')+'-'+[guid]::NewGuid().ToString('N'))}
$RepositoryRoot=[IO.Path]::GetFullPath($RepositoryRoot);$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
$artifactRoot=[IO.Path]::GetFullPath((Join-Path $RepositoryRoot 'artifacts'))+[IO.Path]::DirectorySeparatorChar
if(!$OutputDirectory.StartsWith($artifactRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'OutputDirectory must be within this worktree artifacts directory.'}
if(Test-Path -LiteralPath $OutputDirectory){throw 'OutputDirectory already exists; use a new run directory.'}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$summary=Join-Path $OutputDirectory 'summary.json'
$cargo=Join-Path $env:USERPROFILE '.cargo/bin/cargo.exe'
$node=(Get-Command node -CommandType Application | Select-Object -First 1).Source
$npm=Join-Path (Split-Path $node) 'npm.cmd'
$oldPath=$env:PATH;$env:PATH=$PSHOME+[IO.Path]::PathSeparator+$env:PATH
$receipt=[ordered]@{status='failed';failure=$null;mode='fresh';runId=(Split-Path $OutputDirectory -Leaf);startedUtc=[datetime]::UtcNow.ToString('o');powershell=(Join-Path $PSHOME 'pwsh.exe');commands=@()}
function Step([string]$Name,[string]$Executable,[string[]]$ToolArgs){
    $log=Join-Path $OutputDirectory ($Name+'.log');$timer=[Diagnostics.Stopwatch]::StartNew()
    & $Executable @ToolArgs *> $log
    $result=$LASTEXITCODE
    $receipt.commands+=@{name=$Name;executable=$Executable;arguments=$ToolArgs;exitCode=$result;seconds=$timer.Elapsed.TotalSeconds;log=$log}
    if($result -ne 0){throw "${Name}_exit_$result (see $log)"}
    Write-Output "PASS $Name ($([math]::Round($timer.Elapsed.TotalSeconds,1))s)"
}
Push-Location $RepositoryRoot
$code=1
try {
    if($ReuseEvidence){
        & $node rust/tests/phase3/receipt.mjs reuse ([IO.Path]::GetFullPath($ReuseEvidence)) $RepositoryRoot $summary
        if($LASTEXITCODE -ne 0){throw 'Evidence reuse rejected: source, environment, log, artifact or observation validation failed.'}
        $code=0
    }else{
        Step 'source-before' $node @('rust/tests/phase3/receipt.mjs','snapshot',$RepositoryRoot,(Join-Path $OutputDirectory 'source-before.json'))
        $receipt.before=Get-Content (Join-Path $OutputDirectory 'source-before.json') -Raw | ConvertFrom-Json
        Step 'fmt' $cargo @('+stable','fmt','--manifest-path','rust/Cargo.toml','--all','--','--check')
        Step 'clippy' $cargo @('+stable','clippy','--offline','--locked','--manifest-path','rust/Cargo.toml','-p','baton-core','-p','baton-ipc','-p','baton-adapter','-p','baton-app','--all-targets','--features','baton-app/desktop','--','-D','warnings')
        Step 'rust-tests' $cargo @('+stable','test','--offline','--locked','--manifest-path','rust/Cargo.toml','-p','baton-core','-p','baton-ipc','-p','baton-adapter','-p','baton-app','--all-targets')
        Step 'ui-tests' $npm @('test','--prefix','rust/app')
        Step 'ui-build' $npm @('run','build','--prefix','rust/app')
        Push-Location rust/app
        try{Step 'acceptance-assets' $node @('node_modules/vite/bin/vite.js','build','--config','vite.acceptance.config.ts')}finally{Pop-Location}
        Step 'product-build' $cargo @('+stable','build','--offline','--locked','--manifest-path','rust/Cargo.toml','-p','baton-app','--features','desktop','--bin','baton')
        Step 'adapter-build' $cargo @('+stable','build','--offline','--locked','--manifest-path','rust/Cargo.toml','-p','baton-adapter')
        Step 'acceptance-build' $cargo @('+stable','build','--offline','--locked','--manifest-path','rust/Cargo.toml','-p','baton-app','--features','desktop,acceptance','--bin','baton-ui-acceptance')
        Step 'archive' $node @('rust/tests/phase3/receipt.mjs','archive',$RepositoryRoot,$OutputDirectory)
        $receipt.artifacts=Get-Content (Join-Path $OutputDirectory 'artifacts.json') -Raw | ConvertFrom-Json
        # No builds after this point: observations use exactly these binaries.
        $receipt.nodeFiles=@(Get-ChildItem rust/tests/phase3 -Filter '*.test.mjs' -File | Sort-Object Name | ForEach-Object {$_.FullName})
        Step 'node-tests' $node (@('--test','--test-concurrency=1')+$receipt.nodeFiles)
        Step 'source-after' $node @('rust/tests/phase3/receipt.mjs','snapshot',$RepositoryRoot,(Join-Path $OutputDirectory 'source-after.json'))
        $receipt.after=Get-Content (Join-Path $OutputDirectory 'source-after.json') -Raw | ConvertFrom-Json
        $receipt.finishedUtc=[datetime]::UtcNow.ToString('o')
        $receipt | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $summary
        & $node rust/tests/phase3/receipt.mjs finalize $summary
        if($LASTEXITCODE -ne 0){throw 'Final evidence validation failed.'}
        $code=0
    }
}catch{
    if(Test-Path -LiteralPath $summary){$existing=Get-Content $summary -Raw | ConvertFrom-Json -AsHashtable;$existing.status='failed';$existing.failure=$_.Exception.Message;$existing | ConvertTo-Json -Depth 30 | Set-Content $summary}
    else{$receipt.failure=$_.Exception.Message;$receipt | ConvertTo-Json -Depth 30 | Set-Content $summary}
    Write-Output "PHASE_3_FAILED $($_.Exception.Message)"
}finally{$env:PATH=$oldPath;Pop-Location}
Write-Output "PHASE_3_RECEIPT $summary"
exit $code
