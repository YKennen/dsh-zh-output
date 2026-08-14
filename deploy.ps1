# deploy.ps1 — 部署 dsh-zh-output 的中文预设与中文上下文压缩引擎
#
# 做的事：
#   1. 定位用户 DSH 根目录（$DSH_HOME 或 ~/.dsh）。
#   2. 把 lib/zh-compaction.js 部署为 <root>\profiles\node_modules\dsh-zh-compaction\。
#      这个位置是 pnpm workspace 的 hoisted 依赖目录：preset 里的 bare specifier
#      （如 @deepseek-ai/dsh-compaction-basic）就是从 web profile 目录向上在这里
#      解析的，所以中文压缩引擎也必须放在这里才能被 preset 找到，并且它能在这里
#      向上解析到官方的 @deepseek-ai/dsh-* 依赖。
#   3. 把 presets/ 同步到用户预设目录（<root>\.agent-presets）。
#
# 用法（在仓库根目录执行）：
#   powershell -ExecutionPolicy Bypass -File .\deploy.ps1
#
# 注意：pnpm install 重建 profiles\node_modules 时会清掉手动放入的
# dsh-zh-compaction，届时重跑本脚本即可。

$ErrorActionPreference = 'Stop'

# ── 1) 定位用户 DSH 根目录 ─────────────────────────────────────────────────
$root = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
if (-not (Test-Path $root)) { throw "未找到 DSH 根目录：$root" }
Write-Host "DSH 根目录: $root"

# ── 2) 部署中文压缩引擎到 hoisted 依赖目录 ─────────────────────────────────
$hoisted = Join-Path $root 'profiles\node_modules'
if (-not (Test-Path $hoisted)) {
  throw "未找到 hoisted 依赖目录：$hoisted（标准 CLI 部署应存在 profiles\node_modules）"
}
$pkg = Join-Path $hoisted 'dsh-zh-compaction'
if (Test-Path $pkg) { Remove-Item $pkg -Recurse -Force }
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
$dest = Join-Path $root '.agent-presets'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Recurse -Force (Join-Path $PSScriptRoot 'presets\*') $dest
Write-Host "已同步预设: $dest"

Write-Host ''
Write-Host '完成。重启 dsh web 后生效（新会话选择「（中文）」模式）。'
