param([string]$ManualEvidence)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $PSScriptRoot 'probe-identity.ps1')
$evidence = Join-Path $root 'artifacts/rust-phase-0'
New-Item -ItemType Directory -Force $evidence | Out-Null
$checks = [Collections.Generic.List[object]]::new()
$oldToolchain = $env:RUSTUP_TOOLCHAIN
function Run-Check([string]$Name, [scriptblock]$Action) {
    $log = Join-Path $evidence ($Name + '.log')
    $watch = [Diagnostics.Stopwatch]::StartNew()
    & $Action *> $log
    $code = $LASTEXITCODE
    $checks.Add(@{ name = $Name; exitCode = $code; durationMs = $watch.ElapsedMilliseconds; log = $log })
    if ($code -ne 0) { Get-Content $log -Tail 25; throw ('check_failed:' + $Name) }
    Write-Output ($Name + ': PASS')
}
Push-Location $root
$exitCode = 1
try {
    $identity = Get-ProbeIdentity $root
    $env:RUSTUP_TOOLCHAIN = 'stable'
    if ((& rustc +stable --version) -notmatch '^rustc 1\.88\.0 ') { throw 'toolchain_mismatch' }
    Run-Check 'fmt' { cargo +stable fmt --manifest-path rust/Cargo.toml --all -- --check }
    Run-Check 'frontend' { Push-Location rust/experiments/terminal-probe; try { npm.cmd run build } finally { Pop-Location } }
    Run-Check 'clippy' { cargo +stable clippy --manifest-path rust/Cargo.toml --workspace --all-targets --features desktop --locked -- -D warnings }
    Run-Check 'rust-unit' { cargo +stable test --manifest-path rust/Cargo.toml --workspace --locked }
    Run-Check 'build-ssh-mcp' { cargo +stable build --manifest-path rust/Cargo.toml --locked -p baton-ssh-probe -p baton-mcp-probe }
    Run-Check 'build-webview' {
        Push-Location rust/experiments/terminal-probe
        try { node node_modules/@tauri-apps/cli/tauri.js build --debug --features desktop --no-bundle } finally { Pop-Location }
    }
    Run-Check 'node-integration' { node --test --test-reporter=tap rust/tests/ssh.test.mjs rust/tests/auth.test.mjs rust/tests/mcp.test.mjs rust/tests/cleanup.test.mjs }
    $nodeLog = Get-Content (Join-Path $evidence 'node-integration.log') -Raw
    if ($nodeLog -notmatch '(?m)^# tests 25\r?$' -or $nodeLog -notmatch '(?m)^# pass 25\r?$' -or $nodeLog -notmatch '(?m)^# skipped 0\r?$') { throw 'node_case_inventory_mismatch' }
    $unitLog = Get-Content (Join-Path $evidence 'rust-unit.log') -Raw
    if ($unitLog -notmatch '9 passed; 0 failed; 0 ignored') { throw 'rust_case_inventory_mismatch' }
    Run-Check 'openssh' { pwsh -NoProfile -File rust/scripts/test-openssh.ps1 }
    $webviewReport = Join-Path $evidence 'webview.json'
    Run-Check 'webview' { pwsh -NoProfile -File rust/scripts/test-terminal.ps1 -ReportPath $webviewReport }
    $webview = @(Get-Content $webviewReport -Raw | ConvertFrom-Json)
    $expected = @('cpr_agent_owned','mixed_queries','split_1','split_2','split_3','two_cpr','alternate','origin','scroll_region','wrap_pending','wrap_max','untrusted_sequences','output_pressure','queue_overload','query_overload','token_attacks','expired','epoch','tokenless')
    $expected += @('leading_zero','osc_escape','dcs_escape','untracked_prefix')
    $expected += @(1..14 | ForEach-Object { 'mixed_split_' + $_ })
    $expected += 'input_paths'
    if (($webview.name -join ',') -ne ($expected -join ',') -or @($webview | Where-Object { !$_.passed }).Count) { throw 'webview_case_inventory_mismatch' }
    $after = Get-ProbeIdentity $root
    if ($identity.sourceDigest -ne $after.sourceDigest -or $identity.commit -ne $after.commit) { throw 'source_changed_during_verification' }
    $manualVerified = $false
    if ($ManualEvidence) {
        $manual = Get-Content -LiteralPath $ManualEvidence -Raw | ConvertFrom-Json
        $required = @('physical-key','physical-paste','ime-commit','mouse','hidden-restore','minimize-restore','webview-descendant-exit')
        if ($manual.commit -ne $identity.commit -or $manual.sourceDigest -ne $identity.sourceDigest) { throw 'stale_manual_evidence' }
        if (($manual.cases.name -join ',') -ne ($required -join ',') -or @($manual.cases | Where-Object { !$_.passed }).Count -or !(Test-Path -LiteralPath $manual.screenshot)) { throw 'manual_evidence_incomplete' }
        $manualVerified = $true
    }
    $runtime = Get-Content ($webviewReport + '.cleanup.json') -Raw | ConvertFrom-Json
    $summary = @{ identity = $identity; timestamp = [datetime]::UtcNow.ToString('o'); windows = [Environment]::OSVersion.Version.ToString(); webview = $runtime.webviewVersion; executableHash = (Get-FileHash rust/target/debug/baton-terminal-probe.exe).Hash; checks = $checks; automatic = @{ rustUnit = 9; nodeIntegration = 25; openssh = 1; webview = 38; failed = 0; skipped = 0 }; manualVerified = $manualVerified; decision = if ($manualVerified) { 'adopt' } else { 'blocked' } }
    $summary | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $evidence 'summary.json')
    $exitCode = if ($manualVerified) { 0 } else { 2 }
    Write-Output ('Phase 0: ' + $summary.decision + ' (physical Windows UI evidence required)')
} catch {
    Write-Error -ErrorAction Continue $_
    @{ decision = 'failed'; checks = $checks; reason = $_.Exception.Message } | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $evidence 'summary.json')
} finally {
    $env:RUSTUP_TOOLCHAIN = $oldToolchain
    Pop-Location
}
exit $exitCode
