function Get-ProbeIdentity([string]$Root) {
    Push-Location $Root
    try {
        $paths = @(& git ls-files --cached --others --exclude-standard -- rust tests/linux-ssh/Dockerfile)
        if ($LASTEXITCODE -ne 0) { throw 'source_inventory_failed' }
        $entries = @($paths | Sort-Object -Unique | ForEach-Object {
            @{ path = $_; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_).Hash }
        })
        $text = ($entries | ForEach-Object { $_.path + ':' + $_.sha256 }) -join "`n"
        $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($text)))
        $head = & git rev-parse HEAD
        if ($LASTEXITCODE -ne 0) { throw 'head_lookup_failed' }
        return @{ commit = $head; sourceDigest = $digest; files = $entries; cargoLock = (Get-FileHash rust/Cargo.lock).Hash; npmLock = (Get-FileHash rust/experiments/terminal-probe/package-lock.json).Hash }
    } finally { Pop-Location }
}
