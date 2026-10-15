# 安装 learning-mode bundle 到当前用户的 DSH profile。
# 用法：pwsh -File .\install.ps1 [-Profile desktop] [-DshHome "$env:USERPROFILE\.dsh"]
param(
  [string]$Profile = 'desktop',
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh')
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pluginSrc = Join-Path $root 'learning-mode'
if (-not (Test-Path $pluginSrc)) { throw "找不到 learning-mode 目录（应与本脚本同级）：$pluginSrc" }

$profileDir = Join-Path $DshHome "profiles\$Profile"
if (-not (Test-Path $profileDir)) { throw "找不到 profile 目录：$profileDir（用 -Profile 指定其它 profile）" }

# profile 目录可能是指向另一个 profile 的 junction（例如 desktop -> default）
$item = Get-Item $profileDir -Force
if ($item.LinkType -eq 'Junction' -or $item.LinkType -eq 'SymbolicLink') {
  $profileDir = $item.Target
  Write-Host "profile 是链接，实际目录：$profileDir"
}

# 1) 复制包
$scopeDir = Join-Path $profileDir 'node_modules\@local'
New-Item -ItemType Directory -Force -Path $scopeDir | Out-Null
$dest = Join-Path $scopeDir 'learning-mode'
if (Test-Path $dest) {
  $existing = Get-Item $dest -Force
  if ($existing.LinkType -eq 'Junction' -or $existing.LinkType -eq 'SymbolicLink') {
    [System.IO.Directory]::Delete($dest)   # 只删链接，不动链接目标
  } else {
    Remove-Item $dest -Recurse -Force
  }
}
Copy-Item $pluginSrc $dest -Recurse -Force
Write-Host "已复制到：$dest"

# 2) 登记依赖 + 组合包
$pkgPath = Join-Path $profileDir 'package.json'
Copy-Item $pkgPath "$pkgPath.bak-learning-mode" -Force
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json

if ($null -eq $pkg.dependencies) {
  $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force
}
if ($pkg.dependencies.PSObject.Properties.Name -notcontains '@local/learning-mode') {
  $pkg.dependencies | Add-Member -NotePropertyName '@local/learning-mode' -NotePropertyValue 'file:./node_modules/@local/learning-mode' -Force
}
if ($null -eq $pkg.dsh) {
  $pkg | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{ profile = [pscustomobject]@{ bundles = @() } }) -Force
}
if ($null -eq $pkg.dsh.profile) {
  $pkg.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{ bundles = @() }) -Force
}
$bundles = @($pkg.dsh.profile.bundles)
if ($bundles -notcontains '@local/learning-mode') {
  $bundles += '@local/learning-mode'
}
$pkg.dsh.profile.bundles = $bundles

$pkg | ConvertTo-Json -Depth 12 | Set-Content -Path $pkgPath -Encoding UTF8
Write-Host "已在 profile package.json 中登记（备份：package.json.bak-learning-mode）"

Write-Host ""
Write-Host "安装完成。请【完全退出并重启】DeepSeek Desktop（含托盘），然后点侧边栏「学习模式」。" -ForegroundColor Green
