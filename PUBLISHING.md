# 发布到 GitHub 指南

本文件手把手说明如何把本仓库发布到 GitHub，并加上「dsh 插件」标记，让其他开发者能发现和安装它。

## 前提

- 已注册 GitHub 账号（你已有）。
- 本机已安装 [Git](https://git-scm.com/)。没有的话先安装（Windows 可在 https://git-scm.com/download/win 下载）。

## 第 1 步：准备仓库名

1. 记住你的 GitHub 用户名（例如 `yourname`）。
2. 仓库名建议就用 `dsh-zh-output`。
3. `package.json` 里的 `name` 保持 `dsh-zh-output`（npm 包名要求全小写、无空格）。

## 第 2 步：在 GitHub 网页上新建空仓库

1. 登录 github.com。
2. 点右上角「+」→「New repository」。
3. Repository name 填 `dsh-zh-output`。
4. 设为 **Public**（公开，供其他开发者使用）。
5. **不要**勾选「Add a README」「Add .gitignore」「Add a license」——本仓库已包含这些文件，勾了会产生冲突。
6. 点「Create repository」。
7. 记下页面显示的仓库地址：`https://github.com/<你的用户名>/dsh-zh-output.git`。

## 第 3 步：在本机初始化并推送

在本仓库根目录 `dsh-zh-output/` 打开终端（PowerShell 或 bash），逐条执行：

```sh
git init
git add .
git commit -m "初始提交：DeepSeek Harness 中文输出插件"
git branch -M main
git remote add origin https://github.com/<你的用户名>/dsh-zh-output.git
git push -u origin main
```

> 把 `<你的用户名>` 换成你的真实 GitHub 用户名。

首次 push 可能要求登录。GitHub 已禁用密码登录，需要用 Personal Access Token（见下一步）或用 GitHub CLI 登录。

## 第 4 步：（如需要）生成 Personal Access Token

1. GitHub 网页 → 右上角头像 → Settings。
2. 左侧最底部 → Developer settings。
3. Personal access tokens → Tokens (classic) → Generate new token (classic)。
4. 勾选 `repo` 权限（完整仓库读写）。
5. 点 Generate，复制得到的 `ghp_...` 字符串（只显示这一次，请存好）。
6. push 弹窗里：用户名填你的 GitHub 用户名，密码填这个 token。

更省事的办法：安装 [GitHub CLI](https://cli.github.com/) 后执行 `gh auth login`，按提示在浏览器登录一次，之后不再操心 token。

## 第 5 步：加上「dsh 插件」标记

「标记」分两层，建议都做。

### 5.1 技术标记（已写好）

`package.json` 里这一段让 `dsh plugin` 把本包识别为 DSH 组合包：

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

无需改动。

### 5.2 仓库 Topics（让 GitHub 搜索能发现）

1. 打开你的仓库主页。
2. 右侧「About」区域，点齿轮图标（⚙）。
3. 在 Topics 框里逐行输入并回车添加：
   - `deepseek-harness`
   - `dsh`
   - `dsh-plugin`
   - `dsh-preset`
   - `chinese`
   - `zh-cn`
4. Description 可填：`DeepSeek Harness 中文输出插件：强制中文思考与输出的中文预设`。
5. 点 Save changes。

## 第 6 步：（可选）发布到 npm

若还想让用户直接 `dsh plugin add dsh-zh-output` 安装（不写 `github:` 前缀），可发布到 npm：

```sh
npm login
npm publish --access public
```

发布前，把 `package.json` 的 `repository` 字段补上你的 GitHub 地址。发布后，README 方式二可改为 `dsh plugin add dsh-zh-output`。

## 完成

现在其他开发者可以通过你的仓库链接使用本插件，或 clone 后按 README 方式一安装中文预设。
