param([switch]$Mutation, [string]$TestCargoExecutable = 'cargo')
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$outDir = Join-Path $repoRoot 'artifacts/rust-phase-1'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$started = [DateTime]::UtcNow
$receipt = [ordered]@{ status='failed'; failure=$null; startedUtc=$started.ToString('o'); commands=@(); passed=0; failed=0; skipped=0; suites=@(); model=$null; mutations=$null }
function Source-Digest {
    $paths = @('rust/Cargo.toml','rust/Cargo.lock')
    foreach ($dir in @('rust/crates/baton-core','rust/scripts','rust/tests')) {
        $paths += Get-ChildItem -LiteralPath (Join-Path $repoRoot $dir) -File -Recurse | ForEach-Object { [IO.Path]::GetRelativePath($repoRoot,$_.FullName).Replace('\','/') }
    }
    $rows = foreach ($path in ($paths | Sort-Object -Unique)) { "$path $((Get-FileHash -LiteralPath (Join-Path $repoRoot $path) -Algorithm SHA256).Hash)" }
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes(($rows -join "`n"))))
}
function Run-Step([string]$Name, [string]$Executable, [string[]]$ToolArgs) {
    $log = Join-Path $outDir "$Name.log"
    $timer = [Diagnostics.Stopwatch]::StartNew()
    & $Executable @ToolArgs *> $log
    $code = $LASTEXITCODE
    $receipt.commands += [ordered]@{ name=$Name; executable=$Executable; arguments=$ToolArgs; exitCode=$code; seconds=$timer.Elapsed.TotalSeconds; log=$log }
    if ($code -ne 0) { throw "${Name}_exit_$code" }
    Get-Content -LiteralPath $log -Raw
}
Push-Location $repoRoot
try {
    $receipt.sourceDigest = Source-Digest
    $receipt.commit = (& git rev-parse HEAD 2>$null | Out-String).Trim()
    $receipt.dirty = [bool]((& git status --porcelain 2>$null | Out-String).Trim())
    $receipt.os = [Runtime.InteropServices.RuntimeInformation]::OSDescription
    $receipt.rust = (Run-Step 'rust-version' 'rustc' @('+stable','--version')).Trim()
    if ($receipt.rust -notmatch '^rustc 1\.88\.0 ') { throw 'rust_version_mismatch' }
    $receipt.cargo = (Run-Step 'cargo-version' $TestCargoExecutable @('+stable','--version')).Trim()
    Run-Step 'fmt' $TestCargoExecutable @('+stable','fmt','--manifest-path','rust/Cargo.toml','-p','baton-core','--','--check') | Out-Null
    Run-Step 'clippy' $TestCargoExecutable @('+stable','clippy','--manifest-path','rust/Cargo.toml','--locked','-p','baton-core','--all-targets','--','-D','warnings') | Out-Null
    $testArgs = @('+stable','test','--manifest-path','rust/Cargo.toml','--locked','-p','baton-core','--all-targets')
    $listing = Run-Step 'list' $TestCargoExecutable ($testArgs + @('--','--list'))
    $required = @('numbers','ownership','input','output','races','model')
    foreach ($suite in $required) {
        if ($listing -notmatch "Running tests[/\\]$suite\.rs") { throw "required_suite_missing:$suite" }
    }
    $keyTests = @('safe_numbers_reject_before_rounding','connection_sees_only_assigned_sessions','foreign_and_stale_inputs_and_results_have_zero_effect','duplicate_input_has_one_effect_and_conflict_has_none','public_history_never_comes_from_ui_and_reemitted_private_text_is_public','accepted_control_before_first_poll_prevents_all_writes','read_rechecks_after_wakeup_before_return','model_1000_seeds_200_events')
    foreach ($test in $keyTests) {
        if ($listing -notmatch "(?m)^${test}: test\s*$") { throw "required_test_missing:$test" }
    }
    $result = Run-Step 'core-tests' $TestCargoExecutable ($testArgs + @('--','--nocapture'))
    foreach ($suite in $required) {
        if ($result -notmatch "Running tests[/\\]$suite\.rs") { throw "required_suite_not_run:$suite" }
    }
    foreach ($test in $keyTests) {
        if ($result -notmatch "(?m)^test $test \.\.\. ok\s*$") { throw "required_test_not_passed:$test" }
    }
    $totals = [regex]::Matches($result,'test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out;')
    if ($totals.Count -ne ($required.Count + 1)) { throw 'test_summary_missing' }
    foreach ($total in $totals) {
        if ([int]$total.Groups[1].Value -eq 0 -or [int]$total.Groups[4].Value -ne 0 -or [int]$total.Groups[5].Value -ne 0) { throw 'empty_or_filtered_suite' }
        $receipt.passed += [int]$total.Groups[1].Value
        $receipt.failed += [int]$total.Groups[2].Value
        $receipt.skipped += [int]$total.Groups[3].Value
    }
    if ($receipt.failed -ne 0 -or $receipt.skipped -ne 0) { throw 'failed_or_ignored_tests' }
    if ($result -notmatch 'seeds=(\d+) events=(\d+) accepted=(\d+) rejected=(\d+) transition_observations=(\d+)') { throw 'model_evidence_missing' }
    $receipt.model = [ordered]@{ seeds=[int]$Matches[1]; events=[int]$Matches[2]; accepted=[int]$Matches[3]; rejected=[int]$Matches[4]; transitionObservations=[int]$Matches[5] }
    if ($receipt.model.seeds -ne 1000 -or $receipt.model.events -ne 200000) { throw 'model_coverage_incomplete' }
    $receipt.suites = $required
    if ($Mutation) {
        Run-Step 'mutants' 'pwsh' @('-NoProfile','-File',"$PSScriptRoot/test-core-mutants.ps1") | Out-Null
        $receipt.mutations = Get-Content -LiteralPath "$outDir/mutation-summary.json" -Raw | ConvertFrom-Json
        if (!$receipt.mutations.baselinePassed -or $receipt.mutations.killed -ne 4 -or $receipt.mutations.status -ne 'passed') { throw 'mutation_evidence_incomplete' }
    }
    if ((Source-Digest) -ne $receipt.sourceDigest) { throw 'source_changed_during_verification' }
    $receipt.status = 'passed'
} catch {
    $receipt.failure = $_.Exception.Message
} finally {
    $receipt.seconds = ([DateTime]::UtcNow - $started).TotalSeconds
    $receipt | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath "$outDir/summary.json" -Encoding utf8
    Pop-Location
}
if ($receipt.status -ne 'passed') { Write-Output "PHASE_1_FAILED $($receipt.failure)"; exit 1 }
Write-Output "PHASE_1 passed=$($receipt.passed) failed=$($receipt.failed) skipped=$($receipt.skipped) model_events=$($receipt.model.events)"
exit 0
