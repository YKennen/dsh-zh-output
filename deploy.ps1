# deploy.ps1 — 部署 dsh-zh-output 的中文预设与中文上下文压缩引擎
#
# 做的事：
#   1. 定位已安装的 DeepSeek Harness（@deepseek-ai/dsh，通常为全局 npm 安装）。
#   2. 把 lib/zh-compaction.js 复制为 <harness>\node_modules\dsh-zh-compaction\index.js，
#      并生成包描述，使中文压缩引擎的 import 依赖可被解析。
#   3. 把 presets/ 同步到用户预设目录（$DSH_HOME/.agent-presets 或 ~/.dsh/.agent-presets）。
#
# 用法（在仓库根目录执行）：
#   powershell -ExecutionPolicy Bypass -File .\deploy.ps1

$ErrorActionPreference = 'Stop'

# ── 1) 定位已安装的 harness ────────────────────────────────────────────────
$candidates = @(
  (Join-Path $env:APPDATA 'npm\node_modules\@deepseek-ai\dsh'),
  (Join-Path $env:LOCALAPPDATA 'npm\node_modules\@deepseek-ai\dsh'),
  (Join-Path $env:ProgramFiles 'nodejs\node_modules\@deepseek-ai\dsh'),
  (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node_modules\@deepseek-ai\dsh')
)
$dsh = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $dsh) {
  throw '未找到已安装的 harness（@deepseek-ai/dsh）。请手动把 lib\zh-compaction.js 部署到 harness 的 node_modules\dsh-zh-compaction\index.js。'
}
Write-Host "harness: $dsh"

# ── 2) 部署中文压缩引擎到 harness 私有 node_modules ────────────────────────
$pkg = Join-Path $dsh 'node_modules\dsh-zh-compaction'
New-Item -ItemType Directory -Force -Path $pkg | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot 'lib\zh-compaction.js') (Join-Path $pkg 'index.js')
@'
{
  "name": "dsh-zh-compaction",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "exports": { ".": "./index.js" }
}
'@ | Set-Content -Encoding UTF8 (Join-Path $pkg 'package.json')
Write-Host "已部署中文压缩引擎: $pkg"

# ── 3) 同步预设到用户预设目录 ──────────────────────────────────────────────
$root = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$dest = Join-Path $root '.agent-presets'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Recurse -Force (Join-Path $PSScriptRoot 'presets\*') $dest
Write-Host "已同步预设: $dest"

Write-Host ''
Write-Host '完成。重启 dsh web 后生效（新会话选择「（中文）」模式）。'
