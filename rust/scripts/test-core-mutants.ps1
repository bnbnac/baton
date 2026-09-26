param()
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$outDir = Join-Path $repoRoot 'artifacts/rust-phase-1'
$runDir = Join-Path $outDir ('mutants/' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $runDir -Force | Out-Null
$started = [DateTime]::UtcNow
$receipt = [ordered]@{ status='failed'; failure=$null; runDirectory=$runDir; baselinePassed=$false; killed=0; mutants=@(); commands=@() }
function Core-Digest {
    $rows = Get-ChildItem -LiteralPath "$repoRoot/rust/crates/baton-core" -Recurse -File | Sort-Object FullName | ForEach-Object { "$($_.FullName) $((Get-FileHash -LiteralPath $_.FullName).Hash)" }
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes(($rows -join "`n"))))
}
function Run-Cargo([string]$Name, [string[]]$ToolArgs, [switch]$ExpectFailure) {
    $log = "$runDir/$Name.log"
    $timer = [Diagnostics.Stopwatch]::StartNew()
    & cargo +stable @ToolArgs *> $log
    $code = $LASTEXITCODE
    $receipt.commands += [ordered]@{ name=$Name; arguments=$ToolArgs; exitCode=$code; seconds=$timer.Elapsed.TotalSeconds; log=$log }
    if (!$ExpectFailure -and $code -ne 0) { throw "${Name}_exit_$code" }
    if ($ExpectFailure -and $code -eq 0) { throw "mutant_survived:$Name" }
    Get-Content -LiteralPath $log -Raw
}
function Replace-Once([string]$Path, [string]$Before, [string]$After) {
    $source = (Get-Content -LiteralPath $Path -Raw).Replace("`r`n","`n")
    if ([regex]::Matches($source,[regex]::Escape($Before)).Count -ne 1) { throw "mutation_anchor_not_unique:$Before" }
    [IO.File]::WriteAllText($Path,$source.Replace($Before,$After))
}
function Package-Pins([string]$Path) {
    $source = Get-Content -LiteralPath $Path -Raw
    [regex]::Matches($source,'(?m)^name = "([^"]+)"\r?\nversion = "([^"]+)"') | ForEach-Object { "$($_.Groups[1].Value)@$($_.Groups[2].Value)" }
}
try {
    $receipt.sourceDigest = Core-Digest
    $baseline = "$runDir/baseline"
    New-Item -ItemType Directory -Path "$baseline/crates" -Force | Out-Null
    Copy-Item -LiteralPath "$repoRoot/rust/crates/baton-core" -Destination "$baseline/crates/baton-core" -Recurse
    @'
[workspace]
resolver = "3"
members = ["crates/baton-core"]
[workspace.package]
edition = "2024"
rust-version = "1.88"
'@ | Set-Content -LiteralPath "$baseline/Cargo.toml"
    Copy-Item -LiteralPath "$repoRoot/rust/Cargo.lock" -Destination "$baseline/Cargo.lock"
    $targetArgs = @('--offline','--target-dir',"$runDir/target",'-p','baton-core','--all-targets')
    # A smaller workspace prunes unrelated lock entries; forbid any new version.
    Run-Cargo 'baseline-compile' (@('test','--manifest-path',"$baseline/Cargo.toml") + $targetArgs + @('--no-run')) | Out-Null
    $originalPins = @(Package-Pins "$repoRoot/rust/Cargo.lock")
    foreach ($pin in (Package-Pins "$baseline/Cargo.lock")) { if ($pin -notin $originalPins) { throw "dependency_pin_changed:$pin" } }
    $baselineOutput = Run-Cargo 'baseline-tests' (@('test','--manifest-path',"$baseline/Cargo.toml",'--locked') + $targetArgs)
    if ($baselineOutput -notmatch 'test result: ok\.' -or $baselineOutput -match '[1-9]\d* (failed|ignored|filtered out)') { throw 'baseline_incomplete' }
    $receipt.baselinePassed = $true
    $variants = @(
        @{ Name='owner'; Suite='input'; Test='foreign_and_stale_inputs_and_results_have_zero_effect' },
        @{ Name='epoch'; Suite='input'; Test='foreign_and_stale_inputs_and_results_have_zero_effect' },
        @{ Name='private'; Suite='output'; Test='public_history_never_comes_from_ui_and_reemitted_private_text_is_public' },
        @{ Name='duplicate'; Suite='input'; Test='duplicate_input_has_one_effect_and_conflict_has_none' }
    )
    foreach ($variant in $variants) {
        $name = $variant.Name
        $copy = "$runDir/$name"
        New-Item -ItemType Directory -Path "$copy/crates" -Force | Out-Null
        Copy-Item -LiteralPath "$baseline/crates/baton-core" -Destination "$copy/crates/baton-core" -Recurse
        Copy-Item -LiteralPath "$baseline/Cargo.toml","$baseline/Cargo.lock" -Destination $copy
        $session = "$copy/crates/baton-core/src/session.rs"
        switch ($name) {
            'owner' { Replace-Once $session 'if self.assigned != Some(c) {' 'if false && self.assigned != Some(c) {' }
            'epoch' { Replace-Once $session 'if self.epoch != epoch {' 'if false && self.epoch != epoch {' }
            'duplicate' {
                Replace-Once "$copy/crates/baton-core/src/input.rs" "return if entry.payload == payload {`n                Ok(entry.result)" "return if entry.payload == payload {`n                self.queued.push_back(id);`n                Ok(entry.result)"
            }
            'private' {
                # Keep a private-created public buffer across handoff: a data leak,
                # not an unrelated missing-buffer panic after deleting one guard.
                Replace-Once $session 'if self.state == State::AgentOwned && public_epoch == Some(self.epoch) {' '{ self.public.get_or_insert_with(|| PublicOutput::new(limits::PUBLIC_UNITS).unwrap());'
                Replace-Once $session "fn begin_transition(&mut self, now: Duration) -> Result<(), CoreError> {`n        self.public = None;" 'fn begin_transition(&mut self, now: Duration) -> Result<(), CoreError> {'
                Replace-Once $session 'self.public = Some(PublicOutput::new(limits::PUBLIC_UNITS).unwrap());' 'self.public.get_or_insert_with(|| PublicOutput::new(limits::PUBLIC_UNITS).unwrap());'
            }
        }
        Run-Cargo "$name-compile" (@('test','--manifest-path',"$copy/Cargo.toml",'--locked') + $targetArgs + @('--no-run')) | Out-Null
        $result = Run-Cargo "$name-test" @('test','--manifest-path',"$copy/Cargo.toml",'--locked','--offline','--target-dir',"$runDir/target",'-p','baton-core','--test',$variant.Suite,$variant.Test,'--','--exact') -ExpectFailure
        if ($result -notmatch "test $($variant.Test) \.\.\. FAILED" -or $result -notmatch 'assertion .*failed' -or $result -notmatch 'test result: FAILED\. 0 passed; 1 failed; 0 ignored;') { throw "not_an_assertion_kill:$name" }
        $receipt.mutants += [ordered]@{ name=$name; compiled=$true; killed=$true; suite=$variant.Suite; test=$variant.Test; log="$runDir/$name-test.log" }
        $receipt.killed++
        Write-Output "MUTANT $name compiled=true killed=true"
    }
    if ((Core-Digest) -ne $receipt.sourceDigest) { throw 'original_source_changed' }
    $receipt.status = 'passed'
} catch {
    $receipt.failure = $_.Exception.Message
} finally {
    $receipt.seconds = ([DateTime]::UtcNow - $started).TotalSeconds
    $receipt | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath "$outDir/mutation-summary.json" -Encoding utf8
}
if ($receipt.status -ne 'passed') { Write-Output "MUTATION_FAILED $($receipt.failure)"; exit 1 }
Write-Output "MUTATIONS killed=$($receipt.killed) survived=0 invalid=0 baseline=passed"
exit 0
