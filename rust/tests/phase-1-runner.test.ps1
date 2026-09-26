param()
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$caseRoot = Join-Path $repoRoot ('artifacts/rust-phase-1/runner-tests/' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path "$caseRoot/repo/rust/scripts" -Force | Out-Null
Copy-Item -LiteralPath "$repoRoot/rust/scripts/verify-phase-1.ps1" -Destination "$caseRoot/repo/rust/scripts/verify-phase-1.ps1"
New-Item -ItemType Directory -Path "$caseRoot/repo/rust/tests" -Force | Out-Null
Copy-Item -LiteralPath $PSCommandPath -Destination "$caseRoot/repo/rust/tests/phase-1-runner.test.ps1"
Copy-Item -LiteralPath "$repoRoot/rust/Cargo.toml","$repoRoot/rust/Cargo.lock" -Destination "$caseRoot/repo/rust"
New-Item -ItemType Directory -Path "$caseRoot/repo/rust/crates" -Force | Out-Null
Copy-Item -LiteralPath "$repoRoot/rust/crates/baton-core" -Destination "$caseRoot/repo/rust/crates/baton-core" -Recurse
@'
if ($args -contains '--version') { Write-Output 'cargo 1.88.0'; exit 0 }
exit 7
'@ | Set-Content -LiteralPath "$caseRoot/fail-cargo.ps1"
@'
if ($args -contains '--version') { Write-Output 'cargo 1.88.0'; exit 0 }
if ($args -contains '--list') {
    foreach ($suite in @('ownership','input','output','races','model')) {
        Write-Output "Running tests/$suite.rs"
    }
}
exit 0
'@ | Set-Content -LiteralPath "$caseRoot/missing-cargo.ps1"
foreach ($case in @(
    @{ File='fail-cargo.ps1'; Expected='fmt_exit_7' },
    @{ File='missing-cargo.ps1'; Expected='required_suite_missing:numbers' }
)) {
    & pwsh -NoProfile -File "$caseRoot/repo/rust/scripts/verify-phase-1.ps1" -TestCargoExecutable "$caseRoot/$($case.File)" *> "$caseRoot/$($case.File).log"
    $code=$LASTEXITCODE
    if ($code -ne 1) { throw "runner swallowed $($case.File): exit $code" }
    $summary=Get-Content -Raw "$caseRoot/repo/artifacts/rust-phase-1/summary.json" | ConvertFrom-Json
    if ($summary.failure -ne $case.Expected) { throw "wrong failure: $($summary.failure)" }
}
Write-Output 'RUNNER_TESTS passed=2 failed=0 skipped=0'
