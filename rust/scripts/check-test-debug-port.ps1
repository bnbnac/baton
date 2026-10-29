param([Parameter(Mandatory=$true)][int]$Port)
$ErrorActionPreference='Stop'
# Query failure must not look like zero debugger connections.
$connections=@(Get-NetTCPConnection | Where-Object { $_.LocalPort -eq $Port })
[ordered]@{
  observedUtc=[DateTime]::UtcNow.ToString('o')
  port=$Port
  established=@($connections | Where-Object State -eq 'Established').Count
  listening=@($connections | Where-Object State -eq 'Listen').Count
} | ConvertTo-Json -Compress
