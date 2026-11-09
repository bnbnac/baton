<#
.SYNOPSIS
  main 최신 커밋을 release로 빌드해 %LOCALAPPDATA%\Baton\versions\<짧은 해시>\ 에 설치하고
  %LOCALAPPDATA%\Baton\current junction을 새 버전으로 옮긴다.

.DESCRIPTION
  - baton.exe 또는 baton-adapter.exe가 실행 중이면 종료하지 않고 중단한다.
  - HEAD가 origin/main과 같고 추적 파일 변경이 없을 때만 빌드한다.
  - 하네스(MCP 클라이언트) 설정은 바꾸지 않는다. 설정에 넣을 어댑터 경로만 출력한다.
  - -DryRun 또는 -WhatIf: 검사와 계획 출력만 하고 빌드·복사·junction·삭제는 하지 않는다.

.PARAMETER Keep
  남길 최근 버전 폴더 수(현재 버전 포함). 기본 3.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$DryRun,
    [ValidateRange(1, 50)][int]$Keep = 3
)

$ErrorActionPreference = 'Stop'
$dry = $DryRun.IsPresent -or $WhatIfPreference
if ($WhatIfPreference) { $WhatIfPreference = $false }

$target = 'x86_64-pc-windows-msvc'
$exeNames = @('baton.exe', 'baton-adapter.exe')
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$rustDir = Join-Path $repo 'rust'
$appDir = Join-Path $rustDir 'app'
$releaseDir = Join-Path $rustDir "target/$target/release"

if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA 환경 변수가 없습니다.' }
$root = Join-Path $env:LOCALAPPDATA 'Baton'
$versionsDir = Join-Path $root 'versions'
$currentLink = Join-Path $root 'current'

function Say([string]$Message) { Write-Host $Message }
function Plan([string]$Message) { Write-Host "[DRY-RUN] $Message" }
function Fail([string]$Message) { throw $Message }
function Sha256([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function GitCmd([string[]]$GitArgs) {
    $out = & git -C $repo @GitArgs
    if ($LASTEXITCODE -ne 0) { Fail "git $($GitArgs -join ' ') 실패 (exit $LASTEXITCODE)" }
    return $out
}
function Run([string]$Dir, [string]$Exe, [string[]]$ToolArgs) {
    Say "> $Exe $($ToolArgs -join ' ')"
    Push-Location $Dir
    try {
        & $Exe @ToolArgs
        if ($LASTEXITCODE -ne 0) { Fail "$Exe $($ToolArgs -join ' ') 실패 (exit $LASTEXITCODE)" }
    } finally { Pop-Location }
}
function IsJunction([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    return ($null -ne $item) -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
}
function JunctionTarget([string]$Path) {
    if (-not (IsJunction $Path)) { return $null }
    $t = (Get-Item -LiteralPath $Path -Force).Target
    if ($t -is [array]) { $t = $t[0] }
    return $t
}
# 이름으로 종료하지 않는다. 실행 여부만 보고 사용자가 직접 닫게 한다.
function RunningBatonProcesses {
    @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('baton', 'baton-adapter') })
}

if ($dry) { Say '드라이런: 변경 없이 검사와 계획만 출력합니다.' }

# 1) 실행 중 프로세스 확인
$running = RunningBatonProcesses
if ($running.Count -gt 0) {
    Say '실행 중인 Baton 프로세스가 있습니다. 종료하지 않습니다:'
    foreach ($p in $running) {
        $path = $null
        try { $path = $p.Path } catch { }
        Say ("  PID {0}  {1}  {2}" -f $p.Id, $p.ProcessName, $path)
    }
    Say '앱을 닫고, 어댑터를 쓰는 Claude 세션을 종료한 뒤 다시 실행하세요.'
    if (-not $dry) { Fail 'baton/baton-adapter 실행 중이라 중단합니다.' }
    Plan '실제 실행이면 여기서 중단됩니다.'
}

# 2) main 최신 여부 확인
Say 'origin/main을 가져옵니다.'
GitCmd @('fetch', 'origin', 'main') | Out-Null
$head = (GitCmd @('rev-parse', 'HEAD')).Trim()
$originMain = (GitCmd @('rev-parse', 'origin/main')).Trim()
if ($head -ne $originMain) {
    Fail "HEAD($($head.Substring(0, 7)))가 origin/main($($originMain.Substring(0, 7)))과 다릅니다. main을 최신으로 맞춘 뒤 실행하세요."
}
$dirty = @(GitCmd @('status', '--porcelain', '--untracked-files=no'))
if ($dirty.Count -gt 0) { Fail '추적 파일에 변경이 있습니다. 정리한 뒤 실행하세요.' }
$short = (GitCmd @('rev-parse', '--short=7', 'HEAD')).Trim()
$versionDir = Join-Path $versionsDir $short
Say "대상 커밋: $head"

# 3) 이미 설치된 버전이면 빌드를 건너뛴다
$alreadyInstalled = $false
if (Test-Path -LiteralPath $versionDir) {
    $mf = Join-Path $versionDir 'manifest.json'
    if (-not (Test-Path -LiteralPath $mf)) { Fail "$versionDir 가 있으나 manifest.json이 없습니다. 직접 확인하세요." }
    $m = Get-Content -LiteralPath $mf -Raw | ConvertFrom-Json
    if ($m.commit -ne $head) { Fail "$short 폴더의 manifest 커밋이 다릅니다." }
    foreach ($n in $exeNames) {
        $f = Join-Path $versionDir $n
        if (-not (Test-Path -LiteralPath $f) -or (Sha256 $f) -ne $m.files.$n.sha256) { Fail "$short 폴더의 $n 해시가 manifest와 다릅니다." }
    }
    $alreadyInstalled = $true
    Say "버전 $short 는 이미 설치돼 있고 해시가 일치합니다. 빌드를 건너뜁니다."
}

# 4) 빌드
if (-not $alreadyInstalled) {
    if ($dry) {
        if (-not (Test-Path -LiteralPath (Join-Path $appDir 'node_modules'))) { Plan 'npm ci --offline (node_modules 없음)' }
        Plan 'npm run build  (rust/app)'
        Plan "cargo +stable build --release --target $target --offline --locked -p baton-app --features desktop,tauri/custom-protocol --bin baton"
        Plan "cargo +stable build --release --target $target --offline --locked -p baton-adapter --bin baton-adapter"
    } else {
        if (-not (Test-Path -LiteralPath (Join-Path $appDir 'node_modules'))) {
            Run $appDir 'npm' @('ci', '--offline')
        }
        Run $appDir 'npm' @('run', 'build')
        Run $rustDir 'cargo' @('+stable', 'build', '--release', '--target', $target, '--offline', '--locked', '-p', 'baton-app', '--features', 'desktop,tauri/custom-protocol', '--bin', 'baton')
        Run $rustDir 'cargo' @('+stable', 'build', '--release', '--target', $target, '--offline', '--locked', '-p', 'baton-adapter', '--bin', 'baton-adapter')
        foreach ($n in $exeNames) {
            $f = Join-Path $releaseDir $n
            if (-not (Test-Path -LiteralPath $f)) { Fail "빌드 산출물이 없습니다: $n" }
        }
    }
}

# 5) 버전 폴더로 복사 + 해시 검증
if (-not $alreadyInstalled) {
    if ($dry) {
        Plan "$versionDir 에 baton.exe, baton-adapter.exe, manifest.json 복사 후 SHA256 검증"
    } else {
        New-Item -ItemType Directory -Force -Path $versionsDir | Out-Null
        $staging = Join-Path $versionsDir ".$short.tmp"
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
        New-Item -ItemType Directory -Path $staging | Out-Null
        $files = [ordered]@{}
        foreach ($n in $exeNames) {
            $src = Join-Path $releaseDir $n
            $dst = Join-Path $staging $n
            Copy-Item -LiteralPath $src -Destination $dst
            $srcHash = Sha256 $src
            if ((Sha256 $dst) -ne $srcHash) { Fail "$n 복사본 해시가 원본과 다릅니다." }
            $files[$n] = [ordered]@{ sha256 = $srcHash; bytes = (Get-Item -LiteralPath $dst).Length }
        }
        $manifest = [ordered]@{
            commit      = $head
            shortCommit = $short
            builtUtc    = [datetime]::UtcNow.ToString('o')
            target      = $target
            appFeatures = 'desktop,tauri/custom-protocol'
            files       = $files
        }
        $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $staging 'manifest.json') -Encoding utf8
        Move-Item -LiteralPath $staging -Destination $versionDir
        foreach ($n in $exeNames) {
            if ((Sha256 (Join-Path $versionDir $n)) -ne $files[$n].sha256) { Fail "$n 설치 후 해시 검증 실패." }
        }
        Say "설치 완료: $versionDir (해시 검증 통과)"
    }
}

# 6) current junction 이동
$previousTarget = $null
if (Test-Path -LiteralPath $currentLink) {
    if (-not (IsJunction $currentLink)) { Fail "$currentLink 가 junction이 아닙니다. 직접 확인하세요." }
    $previousTarget = JunctionTarget $currentLink
}
$already = $previousTarget -and ([IO.Path]::GetFullPath($previousTarget).TrimEnd('\') -ieq [IO.Path]::GetFullPath($versionDir).TrimEnd('\'))
if ($already) {
    Say "current는 이미 $short 를 가리킵니다."
} elseif ($dry) {
    Plan "current junction -> $versionDir"
} else {
    if ($previousTarget) {
        # 디렉터리 비재귀 삭제는 junction 링크만 지우고 대상 폴더는 건드리지 않는다.
        [IO.Directory]::Delete($currentLink)
    }
    New-Item -ItemType Junction -Path $currentLink -Target $versionDir | Out-Null
    Say "current -> $versionDir"
}

# 7) 오래된 버전 정리
if (Test-Path -LiteralPath $versionsDir) {
    $protect = @($short)
    if ($previousTarget) { $protect += (Split-Path -Leaf $previousTarget) }
    $dirs = @(Get-ChildItem -LiteralPath $versionsDir -Directory -Force | Where-Object { $_.Name -notlike '.*' } | Sort-Object LastWriteTimeUtc -Descending)
    $keepNames = @($dirs | Select-Object -First $Keep | ForEach-Object { $_.Name }) + $protect
    $procPaths = @()
    foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) { try { if ($p.Path) { $procPaths += $p.Path } } catch { } }
    foreach ($d in $dirs) {
        if ($keepNames -contains $d.Name) { continue }
        if ($d.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        $prefix = $d.FullName.TrimEnd('\') + '\'
        $inUse = @($procPaths | Where-Object { $_.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
        if ($inUse.Count -gt 0) { Say "사용 중이라 건너뜀: $($d.Name)"; continue }
        if ($dry) { Plan "오래된 버전 삭제: $($d.Name)"; continue }
        Remove-Item -LiteralPath $d.FullName -Recurse -Force
        Say "오래된 버전 삭제: $($d.Name)"
    }
}

# 8) 하네스 설정에 넣을 경로 안내 (설정은 자동 변경하지 않음)
$adapterPath = Join-Path $currentLink 'baton-adapter.exe'
Say ''
Say '하네스(MCP 클라이언트) 설정은 변경하지 않았습니다. 어댑터 명령은 아래 절대 경로를 사용하세요:'
Say "  $adapterPath"
Say '새 어댑터를 쓰려면 해당 Claude 세션을 다시 시작하세요. 앱은 current\baton.exe 로 실행합니다.'
if ($dry) { Say '드라이런이므로 아무것도 변경하지 않았습니다.' }
