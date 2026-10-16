# sync-skills.ps1 — 上游 mattpocock/skills → ~/.dsh/skills 镜像同步（#1，PowerShell 版）
# 与 scripts/sync-skills.sh 同逻辑双实现（human 拍板：ps1 + sh，mac 不做）。
#
# 用法：
#   pwsh -File scripts/sync-skills.ps1 [-DryRun]
# 环境变量：
#   SYNC_SKILLS_UPSTREAM  上游 clone 目录（默认 C:\Work\code\skills，不存在则自动 clone）
#   SYNC_SKILLS_TARGET    镜像目标（默认 ~\.dsh\skills；测试时指到临时目录）
#
# 本地适配层（#10/#1 纪律）：GLOSSARY 家族 → CONTEXT 家族（内容+文件名）；
# implement-spec 不同步（ADR-0005）；scripts/sync-skills.exclude fork 保护。
[CmdletBinding()]
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 显式 UTF-8（无 BOM）读写：绝不依赖宿主码页。#63 实测：Windows PowerShell 5.1
# 下 `Get-Content -Raw` / `Set-Content` 默认 ANSI（zh-CN = GBK），会把非 ASCII 压成
# `?`（`→` 的 E2 86 92 → E2 86 3F），产出非法 UTF-8 → 技能加载器拒绝该技能。
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Read-Text([string]$Path) { [System.IO.File]::ReadAllText($Path, $Utf8NoBom) }
function Write-Text([string]$Path, [string]$Text) { [System.IO.File]::WriteAllText($Path, $Text, $Utf8NoBom) }

$Up       = if ($env:SYNC_SKILLS_UPSTREAM) { $env:SYNC_SKILLS_UPSTREAM } else { 'C:\Work\code\skills' }
$Target   = if ($env:SYNC_SKILLS_TARGET)   { $env:SYNC_SKILLS_TARGET }   else { Join-Path $HOME '.dsh\skills' }
$Here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExcludeFile = Join-Path $Here 'sync-skills.exclude'
$Categories   = @('engineering', 'productivity', 'misc', 'in-progress')
$SkipSkills   = @('implement-spec')   # ADR-0005

# —— 上游就绪 ——
if (-not (Test-Path (Join-Path $Up '.git'))) {
  if ($DryRun) { throw "上游 clone 不存在（$Up）——先去掉 -DryRun 让脚本自动 clone" }
  git clone https://github.com/mattpocock/skills $Up
} else {
  git -C $Up pull --ff-only *> $null
  if ($LASTEXITCODE -ne 0) { Write-Warning "上游 pull 失败（离线？），沿用现有内容" }
}

$Excluded = if (Test-Path $ExcludeFile) {
  Get-Content $ExcludeFile -Encoding utf8 | Where-Object { $_ -and -not $_.TrimStart().StartsWith('#') } | ForEach-Object { $_.Trim() }
} else { @() }

function Test-TreeEqual([string]$A, [string]$B) {
  if (-not (Test-Path $B)) { return $false }
  $ha = Get-ChildItem $A -Recurse -File | Sort-Object FullName
  $hb = Get-ChildItem $B -Recurse -File | Sort-Object FullName
  if ($ha.Count -ne $hb.Count) { return $false }
  for ($i = 0; $i -lt $ha.Count; $i++) {
    $ra = $ha[$i].FullName.Substring($A.Length); $rb = $hb[$i].FullName.Substring($B.Length)
    if ($ra -ne $rb) { return $false }
    if ((Get-FileHash $ha[$i].FullName).Hash -ne (Get-FileHash $hb[$i].FullName).Hash) { return $false }
  }
  return $true
}

function Invoke-Transforms([string]$Dir) {
  Get-ChildItem $Dir -Recurse -File | Where-Object {
    $_.Extension -in '.md', '.yaml', '.yml', '.json', '.txt', ''
  } | ForEach-Object {
    $c = Read-Text $_.FullName
    if ($c -notmatch 'GLOSSARY|implement-spec') { return }
    # 适配层：GLOSSARY 家族 → CONTEXT 家族 + implement-spec 路由剔除（ADR-0005，#10 金标）
    $n = $c -replace 'GLOSSARY-MAP\.md', 'CONTEXT-MAP.md' -replace 'GLOSSARY-FORMAT\.md', 'CONTEXT-FORMAT.md' -replace 'GLOSSARY\.md', 'CONTEXT.md'
    $n = ($n -split "`n" | Where-Object { $_ -notmatch '^\s*- \*\*`/implement-spec`\*\* for the whole spec' }) -join "`n"
    $n = $n -replace 'Then work the tickets one of two ways:', 'Then work the tickets:'
    $n = $n -replace "; ``/implement-spec``'s implementers each drive ``/tdd``, and it runs one ``/code-review`` over the integration branch\.", '.'
    $n = $n -replace "`r`n", "`n"   # 行尾统一 LF（上游 clone 受 autocrlf 影响可能 CRLF；现存镜像为 LF）
    if ($n -ne $c) { Write-Text $_.FullName $n }
  }
  Get-ChildItem $Dir -Recurse -Filter 'GLOSSARY-FORMAT.md' | ForEach-Object {
    Rename-Item $_.FullName 'CONTEXT-FORMAT.md'
  }
  # 行尾归一 LF：所有文本文件（判定=首 4KB 无 NUL 字节；未触 transform 的也要归一）
  Get-ChildItem $Dir -Recurse -File | ForEach-Object {
    $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
    $probe = [Math]::Min(4096, $bytes.Length)
    for ($i = 0; $i -lt $probe; $i++) { if ($bytes[$i] -eq 0) { return } }
    $c = Read-Text $_.FullName
    $n = $c -replace "`r`n", "`n"
    if ($n -ne $c) { Write-Text $_.FullName $n }
  }
}

New-Item -ItemType Directory -Force -Path $Target | Out-Null
$changed = 0; $warned = 0
foreach ($cat in $Categories) {
  $srcRoot = Join-Path $Up "skills\$cat"
  if (-not (Test-Path $srcRoot)) { continue }
  foreach ($src in Get-ChildItem $srcRoot -Directory) {
    $name = $src.Name
    $dst = Join-Path $Target $name
    if ($SkipSkills -contains $name -or $Excluded -contains $name) {
      if ((Test-Path $dst) -and -not (Test-TreeEqual $src.FullName $dst)) {
        Write-Warning "FORK-DRIFT ${name}：本地 fork 与上游有差异（不覆盖，人工核对）"
        $warned++
      }
      continue
    }
    if ($DryRun) {
      # 变换后比变换后：dry-run 对 src 也过一遍适配层，避免已同步状态永远误报
      $scratch = Join-Path ([System.IO.Path]::GetTempPath()) ("sync-dry-" + [System.Guid]::NewGuid().ToString('N'))
      Copy-Item -Recurse $src.FullName $scratch
      Invoke-Transforms $scratch
      if (-not (Test-TreeEqual $scratch $dst)) {
        Write-Host "DRY-RUN will-sync $name"; $changed++
      }
      Remove-Item -Recurse -Force $scratch
    } else {
      $tmp = "$dst.tmp-sync"
      if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
      Copy-Item -Recurse $src.FullName $tmp
      Invoke-Transforms $tmp
      if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
      Move-Item $tmp $dst
      Write-Host "✓ synced $name"; $changed++
    }
  }
}

if ($DryRun) { Write-Host "—— dry-run 完：将同步 $changed 个技能（上游 → 适配层 → 镜像）" }
else         { Write-Host "—— 同步完：$changed 个技能，$warned 个 fork 警告" }
