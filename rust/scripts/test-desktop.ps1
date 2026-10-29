param([ValidateSet('terminal','geometry','openssh','all','manual','manual-smoke')][string]$Suite='terminal',[switch]$ExpectFailure)
$ErrorActionPreference='Stop'
$runner=Join-Path $PSScriptRoot '../tests/phase2/desktop.mjs'
$arguments=@($runner)
$previous=$env:BATON_DESKTOP_SUITE
try{$env:BATON_DESKTOP_SUITE=$Suite;if($ExpectFailure){$arguments+='--expect-failure'};& node @arguments;$result=$LASTEXITCODE}finally{$env:BATON_DESKTOP_SUITE=$previous}
exit $result
