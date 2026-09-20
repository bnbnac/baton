param([Parameter(Mandatory)][string]$Manifest)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$owned = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
$expected = [IO.Path]::GetFullPath((Join-Path $root 'rust/target/debug/baton-terminal-probe.exe'))
if ($owned.path -ne $expected -or $owned.pid -le 0 -or $owned.startedTicks -le 0) { throw 'invalid_terminal_identity' }
$current = Get-Process -Id $owned.pid -ErrorAction SilentlyContinue
if ($current) {
    if ($current.Path -ne $expected -or $current.StartTime.ToUniversalTime().Ticks -ne $owned.startedTicks) { throw 'terminal_identity_mismatch' }
    [void]$current.CloseMainWindow()
    if (!$current.WaitForExit(2000)) { Stop-Process -InputObject $current; [void]$current.WaitForExit(2000) }
    if (!$current.HasExited) { throw 'terminal_recovery_failed' }
}
