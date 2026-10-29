param([Parameter(Mandatory=$true)][int]$Port)
$ErrorActionPreference='Stop'
$rows=@(Get-NetTCPConnection | Where-Object { $_.LocalPort -eq $Port -and $_.State -in @('Listen','Established') })
$result=@($rows | ForEach-Object {
    $process=Get-Process -Id $_.OwningProcess -ErrorAction Stop
    [ordered]@{ state=[string]$_.State; pid=[int]$_.OwningProcess; startedTicks=[string]$process.StartTime.ToUniversalTime().Ticks; localAddress=$_.LocalAddress; localPort=[int]$_.LocalPort; remoteAddress=$_.RemoteAddress; remotePort=[int]$_.RemotePort }
})
[ordered]@{ observedUtc=[DateTime]::UtcNow.ToString('o'); port=$Port; listeners=@($result | Where-Object state -eq 'Listen'); connections=@($result | Where-Object state -eq 'Established') } | ConvertTo-Json -Depth 6 -Compress
