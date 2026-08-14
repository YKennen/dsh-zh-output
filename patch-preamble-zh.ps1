# patch-preamble-zh.ps1 — 把压缩检查点的「前言（preamble）」从英文补丁成中文
#
# 背景：DeepSeek Harness 的 dsh-compaction-basic 在生成压缩检查点时，会在摘要前
# 面拼一段固定英文前言（CHECKPOINT_PREAMBLE）。本脚本把它替换成中文。这是**可选**
# 的本地补丁：官方升级 harness 会覆盖它，届时重跑本脚本即可再次应用。
#
# 用法（在仓库根目录执行）：
#   powershell -ExecutionPolicy Bypass -File .\patch-preamble-zh.ps1          # 应用补丁
#   powershell -ExecutionPolicy Bypass -File .\patch-preamble-zh.ps1 -Check   # 只检查，不修改
#   powershell -ExecutionPolicy Bypass -File .\patch-preamble-zh.ps1 -Restore # 从备份还原为英文

param(
  [switch]$Check,
  [switch]$Restore
)

$ErrorActionPreference = 'Stop'

# ── 英文原文与中文译文 ──────────────────────────────────────────────────────
# 与官方编译产物中 CHECKPOINT_PREAMBLE 的字面文本一一对应。
$EnglishPreamble = 'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.'
$ChinesePreamble = '这是自动生成的检查点，浓缩了对话中较早的一段内容，以释放上下文空间。把捕获到的内容当作既定背景，直接在此基础上继续，不要复述它。直接从后面的消息继续任务，不要提及这个检查点。'

# ── 1) 定位 harness 与编译产物 ─────────────────────────────────────────────
$candidates = @(
  (Join-Path $env:APPDATA 'npm\node_modules\@deepseek-ai\dsh'),
  (Join-Path $env:LOCALAPPDATA 'npm\node_modules\@deepseek-ai\dsh'),
  (Join-Path $env:ProgramFiles 'nodejs\node_modules\@deepseek-ai\dsh'),
  (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node_modules\@deepseek-ai\dsh')
)
$dsh = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $dsh) {
  throw '未找到已安装的 harness（@deepseek-ai/dsh）。请手动指定 dsh-compaction-basic 的编译产物路径。'
}

$file = Join-Path $dsh 'node_modules\@deepseek-ai\dsh-compaction-basic\lib\index.js'
if (-not (Test-Path $file)) {
  throw "未找到编译产物：$file"
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
$content = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)

# ── 2) 判断当前状态 ────────────────────────────────────────────────────────
$hasEnglish = $content.Contains($EnglishPreamble)
$hasChinese = $content.Contains($ChinesePreamble)

if ($Restore) {
  if (-not $hasChinese) {
    Write-Host '当前已是英文原文（或未打补丁），无需还原。'
    return
  }
  $backup = "$file.bak-en"
  if (-not (Test-Path $backup)) { throw "未找到英文备份：$backup" }
  if ($Check) { Write-Host "[Check] 将用备份还原英文前言。"; return }
  Copy-Item -Force $backup $file
  Write-Host "已从备份还原英文前言：$file"
  return
}

if ($hasChinese) {
  Write-Host '前言已是中文，跳过（幂等）。'
  return
}

if (-not $hasEnglish) {
  throw '未找到英文前言原文。官方可能已更改措辞或结构，请参照 PATCHING.md 手动处理。'
}

if ($Check) {
  Write-Host "[Check] 找到英文前言，将替换为中文。目标：$file"
  return
}

# ── 3) 备份并替换 ──────────────────────────────────────────────────────────
if (-not (Test-Path "$file.bak-en")) {
  Copy-Item -Force $file "$file.bak-en"
  Write-Host "已备份英文原文到：$file.bak-en"
}

$updated = $content.Replace($EnglishPreamble, $ChinesePreamble)
[System.IO.File]::WriteAllText($file, $updated, $utf8)
Write-Host "已把前言替换为中文：$file"
Write-Host '重启 dsh web 后生效。'
