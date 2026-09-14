---
name: portable-runtimes
description: 给一台"不想装东西"的电脑提供免安装的 Node / Python / Git 运行时。安装包已随技能内置，解压即用；不写注册表、不改系统 PATH、不装系统服务、不需要管理员权限，删掉目录即彻底卸载。当用户说"不想装 Python / Git / Node"、"别污染我的电脑"、"要绿色版 / 便携版 / 免安装"、"公司的电脑不让装软件"、"U 盘里带一套开发环境"时使用。
agent_created: true
---

# portable-runtimes

## 解决什么问题

用户不想（或不被允许）在电脑上装 Python / Git / Node —— 装了会写注册表、改 PATH、塞服务、留卸载残留，
在别人的机器或公司电脑上尤其别扭。

本技能把**官方发行版的免安装包**直接内置进来，一条命令解压成一个可以立刻使用的运行时目录。
全程不碰系统，用完删目录即卸载。

内置的三个工具（四个包）都是**官方原版**，没有二次打包、没有修改：

| 内置包 | 版本 | 官方来源 |
|---|---|---|
| Node.js 24.21.0 LTS | `node-v24.21.0-win-x64.zip` | nodejs.org/dist |
| Node.js 26.8.2 Current | `node-v26.8.2-win-x64.zip` | nodejs.org/dist |
| Python 3.14.7 embeddable | `python-3.14.7-embed-amd64.zip` | python.org/ftp |
| Git for Windows 2.55.0.5 PortableGit | `PortableGit-2.55.0.5-64-bit.7z.exe` | github.com/git-for-windows |

四个包的 SHA-256 都已与官方发布页逐字比对一致，校验清单在 `packages/SHA256SUMS.txt`，随时可复查。

## 主用法

```bash
# 默认：全装到 %USERPROFILE%\portable-runtime，Node 取 LTS
node "<技能目录>/scripts/setup.mjs"

# 指定目录（推荐放短路径，Git 内部目录很深）
node "<技能目录>/scripts/setup.mjs" --target D:\tools

# 顺带把 Python 的 pip 装好
node "<技能目录>/scripts/setup.mjs" --target D:\tools --pip

# 只装 Python 和 Git，不要 Node
node "<技能目录>/scripts/setup.mjs" --target D:\tools --only python,git
```

跑完会打印一段可以直接粘贴的 PATH 片段。**注意：`setup.mjs` 只解压，不会去改系统 PATH**——
要不要长期生效由用户自己决定。

## 命令表

| 命令 | 用途 |
|---|---|
| `setup.mjs` | 主入口。校验 → 解压 → 给 Python 开 `site` → 冒烟测试 → 打印 PATH 片段 |
| `setup.mjs --target <目录>` | 指定解压目标（默认 `%USERPROFILE%\portable-runtime`） |
| `setup.mjs --node lts\|current\|both\|none` | 选 Node 版本，默认 `lts` |
| `setup.mjs --only git,python` | 只装指定项（`git` / `python` / `node-lts` / `node-current`） |
| `setup.mjs --pip` | 解压后自动为嵌入式 Python 装 pip（**需要能访问 pypi.org**） |
| `setup.mjs --check` | 只校验内置包的 SHA-256，不解压。校验失败退出码 1 |
| `setup.mjs --list` | 列出内置包与哈希 |
| `setup.mjs --env` | 只打印 PATH 片段，不动文件 |
| `setup.mjs --force` | 目标已存在时也重新解压 |

## 装完长什么样

假设 `--target D:\tools --node both`：

```
D:\tools\
  node-v24.21.0-win-x64\        node.exe  npm.cmd  npx.cmd
  node-v26.8.2-win-x64\         node.exe  npm.cmd  npx.cmd
  python-3.14.7-embed-amd64\    python.exe  Lib\site-packages\
  PortableGit-2.55.0.5-64-bit\  git-bash.exe  cmd\git.exe  bin\bash.exe
```

`setup.mjs` 打印的 PATH 片段形如：

```powershell
# PowerShell（只在当前窗口生效，关掉即失效）
$env:PATH = "D:\tools\PortableGit-2.55.0.5-64-bit\cmd;D:\tools\PortableGit-2.55.0.5-64-bit\bin;D:\tools\python-3.14.7-embed-amd64;...;" + $env:PATH
```

想临时用一次也行，不动 PATH：

```powershell
& "D:\tools\node-v24.21.0-win-x64\node.exe" app.js
& "D:\tools\python-3.14.7-embed-amd64\python.exe" script.py
& "D:\tools\PortableGit-2.55.0.5-64-bit\cmd\git.exe" --version
```

## 为什么算"不污染"

| | |
|---|---|
| ✅ 不解压进任何系统目录 | 全部落在用户指定的一个目录里 |
| ✅ 不写注册表 | 没有 installer，没有 MSI，没有服务注册 |
| ✅ 不改系统 PATH | 只在当前窗口注入；要不要持久化由用户决定 |
| ✅ 不需要管理员权限 | 普通用户权限就能跑 |
| ✅ 官方原版 | 没有二次打包、没有魔改 |
| ✅ 删掉目录 = 彻底卸载 | 不留残留 |

PortableGit 会把自己当成"便携"的，`HOME` 指向自身目录，不会去碰 `C:\Users\<你>\.gitconfig`。

**唯一的例外**：`--pip` 装 pip 时，pip 会把下载的 wheel 缓存到 `%LOCALAPPDATA%\pip\cache`（几 MB，
属于正常缓存，不影响任何软件）。想完全避免，装库时加 `--no-cache-dir`。

## 环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| 操作系统 | **Windows x64** | 内置的都是 win-x64 二进制 |
| Node.js | **≥ 18** | 只是用来跑 `setup.mjs`。零 npm 依赖，纯内置模块 |
| `tar.exe` | Windows 10 1803+ 自带 | 在 `C:\Windows\System32\tar.exe`，用来解 zip |

不需要管理员权限，不需要装 7-Zip，不需要装任何东西。

## 关键限制（先读，否则会误判）

### 1. 目标路径别太长

PortableGit 内部有很深的目录（`mingw64\libexec\git-core\...`）。目标目录超过 60 字符时
`setup.mjs` 会主动警告——**请换短路径**（`D:\tools` 这种），否则可能撞上 Windows 的 260 字符路径上限。
真撞上了：开注册表 `LongPathsEnabled`，或者换个短目录。

### 2. `--pip` 需要联网，而且 pip 自己不走本技能的代理

`setup.mjs --pip` 会调用 `python.exe get-pip.py`。如果这台机器直连不上 pypi.org，
先把命令套进 `local-proxy` 再跑：

```bash
node "<local-proxy>/scripts/proxy.mjs" run "node \"<本技能>/scripts/setup.mjs\" --target D:\tools --pip"
```

（`pip` 和 `python` 都认 `HTTP_PROXY` / `HTTPS_PROXY`，所以套一层就够了。）

### 3. 嵌入式 Python 的几个"没有"

embeddable 包是最小化的：**只有标准库 + pip**（本技能已帮你打开 `site`，所以 pip 能正常装东西）。
它**没有** `tkinter`、`IDLE`、`venv`、`pydoc` 的独立入口、也没有文档。
需要这些的话，它替代不了完整版 Python —— 但那也意味着要装东西，跟本技能的前提冲突。

### 4. 两个 Node 版本按需选，别都装

- `lts`（默认）：生产/日常，兼容性最好
- `current`：想尝鲜新特性
- 两个 zip 加起来 75MB，都装也行，但要清楚自己为什么装。

### 5. 内置的是"快照"，不是"永远最新"

包是随技能一起分发的固定版本，**不会自己更新**。要更新见下一节。

## 更新内置包

技能内置的是固定快照。想换成新版本：

```bash
# 1. 用 local-proxy 拉最新的三个包（会自动打印 SHA-256）
node "<local-proxy>/scripts/proxy.mjs" run "node \"C:\Users\pc\node24\node.exe\" <local-proxy>/references/fetch-dist.mjs D:\tmp --resolve"

# 2. 把新包替换进 packages/，文件名不要改格式
# 3. 重新生成校验清单
node -e "..."   # 或者手工把 SHA-256 写进 packages/SHA256SUMS.txt，再把 setup.mjs 里 PACKAGES 的版本号改掉
```

改完记得同步更新 `PACKAGES` 里的 `file` / `title` / `probe` 三处，以及本文件的版本表。

## 排错

先跑自检：

```bash
node "<技能目录>/scripts/setup.mjs" --check
```

| 症状 | 原因 / 处理 |
|---|---|
| `找不到 Windows 自带的 tar.exe` | 系统太老（< Win10 1803）。手工用 `Expand-Archive` 解包，或装个 7-Zip |
| 解压报"路径过长" | 换短目标目录，或开 `LongPathsEnabled` |
| `✗ 校验失败` | 内置包损坏（下载不全、被安全软件动过）。重新获取仓库 |
| Git 解压后 `git-bash.exe` 缺失 | SFX 解压被中断。加 `--force` 重跑 |
| `python -m pip` 报没有 pip | 说明没跑过 `--pip`。要么补跑，要么手工 `python.exe tools\get-pip.py` |
| 粘贴 PATH 后 `node` 还是老的 | 窗口没重开，或者你的 PATH 里更靠前的位置有另一个 node。用 `Get-Command node` 确认 |
| 控制台中文乱码 | 用的是 936 代码页的老控制台；`chcp 65001` 一下，或换 Windows Terminal |

## 分享给别人 / 让别的 AI 帮忙安装

**链接**：

- GitHub：<https://github.com/N0-1-C/agent-skills>
- Gitee 镜像（国内更快）：<https://gitee.com/cqhup/agent-skills>

**提示词**：

```text
请帮我安装 agent-skills 仓库里的 portable-runtimes 技能，我要在这台电脑上用
Node / Python / Git，但不想装任何东西、不想污染系统。

1. 从 https://github.com/N0-1-C/agent-skills 获取仓库
   （国内慢就换镜像 https://gitee.com/cqhup/agent-skills，内容一致）
   把 portable-runtimes 目录完整复制到 ~/.workbuddy/skills/portable-runtimes/
   （注意：packages/ 里有约 144MB 安装包，别漏）
2. 先自检：node "<技能目录>/scripts/setup.mjs" --check
   确认四个包 SHA-256 全部 OK
3. 解压到 <我想放的目录，用短路径，例如 D:\tools>：
   node "<技能目录>/scripts/setup.mjs" --target <上面的目录> --node lts
4. 跑完把打印出来的 PATH 片段告诉我，我要在当前窗口临时用
5. 以后凡是要用 node / python / git，都先注入那段 PATH，或者直接用全路径
6. 全程不要改我的系统 PATH、不要写注册表、不要装任何系统组件
```
