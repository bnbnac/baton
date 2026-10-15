param([Parameter(Mandatory)][string]$Evidence,[switch]$VerifyExited)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$r=Get-Content -LiteralPath $Evidence -Raw | ConvertFrom-Json
$identities=@([pscustomobject]@{pid=$r.pid;startedTicks=$r.startedTicks;kind='app'})
$identities+=@($r.adapters|ForEach-Object {[pscustomobject]@{pid=$_.pid;startedTicks=$_.startedTicks;kind='adapter'}})
$identities+=@($r.descendants|Where-Object {$VerifyExited -or !$_.exited}|ForEach-Object {
 if(!$_.dataDirectoryMatch){throw 'unowned_descendant'}
 [pscustomobject]@{pid=$_.pid;startedTicks=$_.startedTicks;kind='webview'}
})
if(@($identities|Group-Object pid|Where-Object Count -gt 1).Count){throw 'duplicate_pid'}
$rows=@(foreach($i in $identities){
 $p=Get-Process -Id $i.pid -ErrorAction SilentlyContinue
 if(!$p){if($VerifyExited){continue};throw 'process_missing'}
 if($p.StartTime.ToUniversalTime().Ticks.ToString() -ne $i.startedTicks){if($VerifyExited){continue};throw 'identity_changed'}
 if($VerifyExited){[pscustomobject]@{pid=$i.pid;startedTicks=$i.startedTicks};continue}
 $role=$i.kind
 if($role -eq 'webview'){
  if($p.ProcessName -ne 'msedgewebview2'){throw 'unexpected_descendant'}
  $c=Get-CimInstance Win32_Process -Filter "ProcessId = $($i.pid)"
  if(!$c.CommandLine){throw 'command_line_missing'}
  $role=if($c.CommandLine -match '--type=([^ ]+)'){$Matches[1]}else{'browser'}
 }
 $p.Refresh()
 if($p.StartTime.ToUniversalTime().Ticks.ToString() -ne $i.startedTicks){throw 'identity_changed'}
 [pscustomobject]@{pid=$i.pid;startedTicks=$i.startedTicks;role=$role;privateBytes=$p.PrivateMemorySize64;workingSetBytes=$p.WorkingSet64}
})
ConvertTo-Json -InputObject $rows -Depth 5 -Compress
