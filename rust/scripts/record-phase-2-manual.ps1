param([Parameter(Mandatory)][string]$RunDirectory,[Parameter(Mandatory)][string]$Observations,[string]$OutputPath)
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$RunDirectory=[IO.Path]::GetFullPath($RunDirectory);$Observations=[IO.Path]::GetFullPath($Observations)
if(!$OutputPath){$OutputPath=Join-Path $RunDirectory 'manual-evidence.json'}else{$OutputPath=[IO.Path]::GetFullPath($OutputPath)}
Push-Location $repo
try{
    . "$PSScriptRoot/probe-identity.ps1"
    $identity=Get-ProbeIdentity $repo
    $identity.npmLock=(Get-FileHash rust/app/package-lock.json).Hash
    $identity.productExecutable=(Get-FileHash rust/target/debug/baton.exe).Hash
    $identity.acceptanceExecutable=(Get-FileHash rust/target/debug/baton-ui-acceptance.exe).Hash
    $identity | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath "$RunDirectory/identity-current.json"
    & node rust/tests/phase2/record-manual.mjs $RunDirectory $Observations $OutputPath
    $result=$LASTEXITCODE
}finally{Pop-Location}
Write-Output "MANUAL_RECEIPT $OutputPath"
exit $result
