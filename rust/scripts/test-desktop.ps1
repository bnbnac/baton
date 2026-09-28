param([ValidateSet('terminal','all')][string]$Suite='terminal',[switch]$ExpectFailure)
$ErrorActionPreference='Stop'
$runner=Join-Path $PSScriptRoot '../tests/phase2/desktop.mjs'
$arguments=@($runner)
if($ExpectFailure){$arguments+='--expect-failure'}
& node @arguments
exit $LASTEXITCODE
