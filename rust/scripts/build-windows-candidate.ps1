param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
if($PSVersionTable.PSVersion.Major -lt 7){
    $candidates=@((Join-Path $env:ProgramFiles 'PowerShell/7/pwsh.exe'),(Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'))
    $found=Get-Command pwsh -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if($found){$candidates=@($found.Source)+$candidates}
    $engine=$candidates | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
    if(!$engine){throw 'PowerShell 7 is required; use an absolute path to pwsh.exe.'}
    $forward=@();if($OutputDirectory){$forward=@('-OutputDirectory',$OutputDirectory)}
    & $engine -NoProfile -File $PSCommandPath @forward
    exit $LASTEXITCODE
}
if(!$IsWindows -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64'){throw 'Windows x64 build host required.'}
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$artifactRoot=[IO.Path]::GetFullPath((Join-Path $repo 'artifacts'))+[IO.Path]::DirectorySeparatorChar
if(!$OutputDirectory){$OutputDirectory=Join-Path $repo ('artifacts/rust-phase-5/'+[datetime]::UtcNow.ToString('yyyyMMddTHHmmss')+'-'+[guid]::NewGuid().ToString('N'))}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
if(!$OutputDirectory.StartsWith($artifactRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'OutputDirectory must be under this worktree artifacts directory.'}
if(Test-Path -LiteralPath $OutputDirectory){throw 'OutputDirectory already exists; choose a new directory.'}
for($ancestor=$OutputDirectory;$ancestor;$ancestor=[IO.Path]::GetDirectoryName($ancestor)){
    if((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Reparse output paths are not allowed.'}
}
$node=(Get-Command node -CommandType Application | Select-Object -First 1).Source
$cargo=Join-Path $env:USERPROFILE '.cargo/bin/cargo.exe'
$app=Join-Path $repo 'rust/app'
$envKeys=@('PATH','RUSTUP_TOOLCHAIN','CARGO_INCREMENTAL','CARGO_TARGET_DIR','CARGO_BUILD_TARGET','RUSTFLAGS','CARGO_ENCODED_RUSTFLAGS','TAURI_CONFIG')
$saved=@{};foreach($key in $envKeys){$saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$summaryPath=Join-Path $OutputDirectory 'summary.json'
$receipt=[ordered]@{status='failed';startedUtc=[datetime]::UtcNow.ToString('o');commands=@();failure=$null}
function Step([string]$Name,[string]$Executable,[string[]]$ToolArgs){
    $log=Join-Path $OutputDirectory ($Name+'.log');$timer=[Diagnostics.Stopwatch]::StartNew()
    & $Executable @ToolArgs *> $log
    $code=$LASTEXITCODE
    $receipt.commands+=@{name=$Name;executable=$Executable;arguments=$ToolArgs;exitCode=$code;seconds=$timer.Elapsed.TotalSeconds;log=(Split-Path $log -Leaf)}
    $receipt | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $summaryPath -Encoding utf8
    if($code -ne 0){throw "${Name}_exit_$code (see $log)"}
    Write-Output "PASS $Name ($([math]::Round($timer.Elapsed.TotalSeconds,1))s)"
}
function Snapshot([string]$Path){
    $paths=@(& git ls-files -co --exclude-standard -- rust docs/rust-windows-candidate.md)
    if($LASTEXITCODE -ne 0){throw 'source_inventory_failed'}
    $files=[ordered]@{}
    foreach($file in ($paths | Sort-Object -Unique)){$files[$file]=(Get-FileHash -LiteralPath (Join-Path $repo $file) -Algorithm SHA256).Hash.ToLowerInvariant()}
    $files | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $Path -Encoding utf8
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
Push-Location $repo
$exitCode=1
try{
    $env:PATH=(Split-Path $node)+';'+(Split-Path $cargo)+';'+$PSHOME+';'+$env:PATH
    $env:RUSTUP_TOOLCHAIN='stable';$env:CARGO_INCREMENTAL='0'
    $env:CARGO_TARGET_DIR=Join-Path $repo 'rust/target'
    foreach($key in @('CARGO_BUILD_TARGET','RUSTFLAGS','CARGO_ENCODED_RUSTFLAGS','TAURI_CONFIG')){Remove-Item -LiteralPath "Env:$key" -ErrorAction SilentlyContinue}
    $receipt.commit=(& git rev-parse HEAD);if($LASTEXITCODE -ne 0){throw 'git_revision_failed'}
    $receipt.sourceSha256=Snapshot (Join-Path $OutputDirectory 'source-before.json')
    Step 'toolchain' $cargo @('--version')
    Step 'package-tests' $node @('--test','rust/tests/phase5/package.test.mjs','rust/tests/phase5/report-path.test.mjs')
    Push-Location $app
    try{Step 'ui-typecheck' $node @('node_modules/typescript/bin/tsc','--noEmit');Step 'ui-assets' $node @('node_modules/vite/bin/vite.js','build')}finally{Pop-Location}
    Step 'ui-release' $cargo @('build','--release','--target','x86_64-pc-windows-msvc','--offline','--locked','--manifest-path','rust/Cargo.toml','-p','baton-app','--features','desktop,tauri/custom-protocol','--bin','baton')
    Step 'adapter-release' $cargo @('build','--release','--target','x86_64-pc-windows-msvc','--offline','--locked','--manifest-path','rust/Cargo.toml','-p','baton-adapter','--bin','baton-adapter')
    $after=Snapshot (Join-Path $OutputDirectory 'source-after.json')
    if($after -ne $receipt.sourceSha256){throw 'source_changed_during_build'}
    $package=Join-Path $OutputDirectory 'package';New-Item -ItemType Directory -Path $package | Out-Null
    foreach($name in @('baton.exe','baton-adapter.exe')){Copy-Item -LiteralPath (Join-Path $repo "rust/target/x86_64-pc-windows-msvc/release/$name") -Destination (Join-Path $package $name)}
    Copy-Item -LiteralPath (Join-Path $repo 'docs/rust-windows-candidate.md') -Destination (Join-Path $package 'README.txt')
    @{commit=$receipt.commit;sourceSha256=$receipt.sourceSha256} | ConvertTo-Json | Set-Content (Join-Path $OutputDirectory 'provenance.json') -Encoding utf8
    Step 'manifest' $node @('rust/tests/phase5/package.mjs','create',$package,(Join-Path $OutputDirectory 'provenance.json'))
    Step 'verify-package' $node @('rust/tests/phase5/package.mjs','verify',$package)
    $zip=Join-Path $OutputDirectory 'Baton-windows-x64.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($package,$zip)
    $receipt.zip=@{path='Baton-windows-x64.zip';sha256=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant();bytes=(Get-Item -LiteralPath $zip).Length}
    $receipt.status='built_unaccepted';$exitCode=0
}catch{$receipt.failure=$_.Exception.Message;Write-Output "CANDIDATE_FAILED $($receipt.failure)"}
finally{
    $receipt.finishedUtc=[datetime]::UtcNow.ToString('o');$receipt | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $summaryPath -Encoding utf8
    foreach($key in $envKeys){if($null -eq $saved[$key]){Remove-Item -LiteralPath "Env:$key" -ErrorAction SilentlyContinue}else{[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}}
    Pop-Location
}
Write-Output "CANDIDATE_RECEIPT $summaryPath"
exit $exitCode
