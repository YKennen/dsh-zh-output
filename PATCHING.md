# 中文化压缩「前言」的可重复补丁方法

## 背景

DeepSeek Harness 的上下文压缩在生成检查点时，消息由两段组成：

```
<前言 preamble>            ← 这一段是官方硬编码的英文
<compacted-summary>
  ……摘要内容……            ← 这一段已由 dsh-zh-compaction 改为中文
</compacted-summary>
```

摘要内容已经中文化了，但**前言**（`CHECKPOINT_PREAMBLE`）是 `@deepseek-ai/dsh-compaction-basic` 编译产物里硬编码的英文元指令，纯插件覆盖不到。本目录提供两种方式把前言也改成中文；**这是可选的**，不修改也不影响其余功能。

> 官方升级 harness 会覆盖这段修改。好在方法可以**重复应用**：升级后重跑脚本，或照着手动方法再改一次即可。

## 修改位置

编译产物（以全局 npm 安装为例）：

```
<harness>\node_modules\@deepseek-ai\dsh-compaction-basic\lib\index.js
```

其中 `harness` 通常是 `%APPDATA%\npm\node_modules\@deepseek-ai\dsh`。

要改的是文件里这一行（`CHECKPOINT_PREAMBLE` 的赋值）：

- **英文原文**：

  ```
  This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.
  ```

- **中文译文**：

  ```
  这是自动生成的检查点，浓缩了对话中较早的一段内容，以释放上下文空间。把捕获到的内容当作既定背景，直接在此基础上继续，不要复述它。直接从后面的消息继续任务，不要提及这个检查点。
  ```

## 方法一：用脚本（推荐）

在仓库根目录执行：

```powershell
# 先查看会改什么（不修改）
powershell -ExecutionPolicy Bypass -File .\patch-preamble-zh.ps1 -Check

# 应用补丁
powershell -ExecutionPolicy Bypass -File .\patch-preamble-zh.ps1

# 想还原成英文
powershell -ExecutionPolicy Bypass -File .\patch-preamble-zh.ps1 -Restore
```

脚本行为：

- **幂等**：前言已是中文时直接跳过；
- **自动备份**：首次修改前把英文原文备份到 `index.js.bak-en`；
- **可还原**：`-Restore` 用备份还原英文。

## 方法二：手动修改

1. 用编辑器打开 `lib\index.js`；
2. 找到 `const CHECKPOINT_PREAMBLE = "…";` 这一行；
3. 把引号内的英文替换成上面的中文译文（只改引号内的文字，别动引号和分号）；
4. 保存为 **UTF-8 无 BOM** 编码，重启 dsh web。

## 官方更新后如何重新应用

1. 升级 harness 后，先确认编译产物里是否仍是上面那行英文原文；
   - 如果**文本没变**：直接重跑 `patch-preamble-zh.ps1` 即可；
   - 如果**文本变了**（官方改了措辞）：脚本会报「未找到英文前言原文」并停住，此时按「方法二」用新的原文重新替换成中文，并同步更新本文件里的原文/译文，脚本下次就能再次匹配。
2. 改完重启 dsh web。

## 已知的另一处英文（可选）

模型收到的系统提示第一句还有一段 harness 写死的身份声明 `You are an AI agent powered by DeepSeek Harness.`，它由 host 组合的 `system-prompt`（`includeHarnessIdentity`）注入，与压缩无关。若也想中文化，可在 host 组合里把 `system-prompt` 的 `includeHarnessIdentity` 设为 `false` 并自行在 persona 里提供中文身份句；这属于 host 配置，不在本补丁范围内。
