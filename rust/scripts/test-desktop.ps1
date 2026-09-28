param([ValidateSet('terminal','geometry','openssh','all')][string]$Suite='terminal',[switch]$ExpectFailure)
$ErrorActionPreference='Stop'
$runner=Join-Path $PSScriptRoot '../tests/phase2/desktop.mjs'
$arguments=@($runner)
$env:BATON_DESKTOP_SUITE=$Suite
if($ExpectFailure){$arguments+='--expect-failure'}
& node @arguments
exit $LASTEXITCODE
