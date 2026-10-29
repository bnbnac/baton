param([Parameter(Mandatory)][int]$ProcessId,[Parameter(Mandatory)][string]$Executable,[Parameter(Mandatory)][string]$StartedTicks)
$ErrorActionPreference='Stop'
$expected=[IO.Path]::GetFullPath($Executable)
$process=Get-Process -Id $ProcessId -ErrorAction Stop
if ($process.StartTime.ToUniversalTime().Ticks.ToString() -ne $StartedTicks -or $process.Path -ne $expected) { throw 'test_process_identity_mismatch' }
# Request the normal window-close path; never kill a process on this path.
if (!$process.CloseMainWindow()) { throw 'test_window_close_not_requested' }
Write-Output 'normal_close_requested'
