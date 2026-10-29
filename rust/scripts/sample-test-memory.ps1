param([Parameter(Mandatory)][string]$Evidence,[Parameter(Mandatory)][string]$AdapterPids)
$ErrorActionPreference='Stop'
$receipt=Get-Content -LiteralPath $Evidence -Raw | ConvertFrom-Json
$ids=@([int]$receipt.pid)+@($receipt.descendants | Where-Object { !$_.exited } | ForEach-Object { [int]$_.pid })+@($AdapterPids.Split(',') | ForEach-Object { [int]$_ })
$rows=@(foreach($targetId in ($ids | Select-Object -Unique)) {
 $p=Get-Process -Id $targetId -ErrorAction Stop
 [pscustomobject]@{pid=$p.Id;startedTicks=$p.StartTime.ToUniversalTime().Ticks.ToString();privateBytes=$p.PrivateMemorySize64;workingSetBytes=$p.WorkingSet64}
})
@{processes=$rows;privateBytes=($rows | Measure-Object privateBytes -Sum).Sum;workingSetBytes=($rows | Measure-Object workingSetBytes -Sum).Sum} | ConvertTo-Json -Depth 5 -Compress
