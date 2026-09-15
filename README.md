# agent-skills

给 AI Agent（WorkBuddy、Claude Code 等）用的技能集合。

每个技能一个独立目录，包含 `SKILL.md`（面向 AI 的说明书）以及需要时附带的脚本与资源。
克隆下来把目录拷进本地技能目录即可使用。

## 技能列表

| 技能 | 用途 | 环境依赖 |
|---|---|---|
| [local-proxy](./local-proxy/) | 让 AI 在没有开系统 VPN 的情况下访问外网（GitHub 推送、npm/pip 安装、调用境外 API），只在被执行的子进程内生效，不改系统网络配置 | Windows + Node.js |
| [portable-runtimes](./portable-runtimes/) | 免安装的 Node / Python / Git 运行时，安装包已内置，解压即用；不写注册表、不改系统 PATH、不需要管理员权限，删目录即卸载 | Windows x64 + Node.js |

## 安装

技能目录约定：

- **用户级**（所有项目可用）：`~/.workbuddy/skills/<技能名>/`
- **项目级**（只在某个仓库里生效）：`<项目>/.workbuddy/skills/<技能名>/`

```bash
git clone https://github.com/N0-1-C/agent-skills.git
cp -r agent-skills/*/ ~/.workbuddy/skills/
```

Windows PowerShell：

```powershell
git clone https://github.com/N0-1-C/agent-skills.git
Get-ChildItem agent-skills -Directory | Copy-Item -Recurse -Destination "$env:USERPROFILE\.workbuddy\skills\"
```

**国内访问 GitHub 慢的话，用 Gitee 镜像**（内容完全同步，提交号一致）：

```bash
git clone https://gitee.com/cqhup/agent-skills.git
cp -r agent-skills/*/ ~/.workbuddy/skills/
```

```powershell
git clone https://gitee.com/cqhup/agent-skills.git
Get-ChildItem agent-skills -Directory | Copy-Item -Recurse -Destination "$env:USERPROFILE\.workbuddy\skills\"
```

---

## local-proxy

给 AI 一个"用完即走"的代理通道。AI 需要联网时自己起内核、注入代理、执行命令、关掉内核，
全程不需要人工介入，也不碰系统网络设置。

**一条命令就是全部用法：**

```bash
node "<技能目录>/scripts/proxy.mjs" run "git push origin main"
```

这条命令内部完成：启动本地内核（`127.0.0.1:7891`）→ 给这条命令注入 `HTTP_PROXY` / `HTTPS_PROXY`
→ 执行 → 关闭内核，退出码原样返回。

### 它做了什么，以及刻意没做什么

| | |
|---|---|
| ✅ 只用 `mixed-port` 端口模式 | 纯用户态进程，只在回环地址上开一个口子，谁主动连谁走代理 |
| ✅ 只监听 `127.0.0.1` | 生成配置时强制覆盖订阅里的 `allow-lan: true` / `bind-address: '*'`，避免把代理暴露给整个局域网 |
| ✅ 只影响子进程 | 代理通过环境变量注入，进程退出即失效 |
| ❌ 不用 TUN 模式 | TUN 要建虚拟网卡、改全局路由表、劫持 DNS，那才叫动系统网络 |
| ❌ 不写系统代理 | 不碰注册表 `ProxyEnable` |
| ❌ 不改路由表和 DNS | |

配套的子命令：`status`（状态/额度/出口 IP）、`nodes`、`pick <节点>`、`refresh`（重拉订阅）、
`doctor`（自检，含环境依赖检查）、`up` / `down`。完整说明见 [local-proxy/SKILL.md](./local-proxy/SKILL.md)。

### 运行环境

**必需**

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | **≥ 18** | 跑 `proxy.mjs` / `tunnel.mjs`。**无任何 npm 依赖**，只用 Node 内置模块 |
| 操作系统 | **Windows x64** | 内置的 `mihomo.exe` 是 Windows amd64 二进制 |
| Clash 格式订阅 | 一个订阅地址 | 写进 `~/.workbuddy/local-proxy/subscription.txt` |

**可选** —— 只影响对应的那类操作，缺了不影响别的功能：

| 项 | 用在哪 |
|---|---|
| `git` | git push / pull / clone（最典型的用途） |
| `curl` | 用 curl 下载或调 API。Windows 10 1803+ 自带 |
| `python` | 用 Python 脚本联网 |
| `ssh` 客户端 | 只有 `run --ssh` 需要（OpenSSH for Windows） |
| Node ≥ 24 | 只有"Node 脚本里用 `fetch`"才需要；Node 22 可用于其他所有场景 |

不需要管理员权限，不需要装任何 VPN 客户端，不需要改动系统设置。
内核与 GeoIP 库都已随仓库提供，克隆即用。

一条命令确认依赖是否齐备：

```bash
node "<技能目录>/scripts/proxy.mjs" doctor
```

输出分 `host` / `skill` 两段，`[!!]` 是必须修的，`[--]` 是可选项缺失（正常）。

### 用之前需要准备什么

**只有一样：一个 Clash 格式的订阅地址**（就是你的机场/VPN 服务商给你的那条订阅链接）。
每个 skill 必备的东西都写在它自己的 `SKILL.md` 里，拿到目录先看那个文件。

`local-proxy` 的填写步骤：

1. 打开机场官网 → 用户中心 → 找「一键订阅」或「Clash 订阅」→ 复制链接
2. 把链接**单独一行**粘贴进 `~/.workbuddy/local-proxy/subscription.txt`（不要加引号、不要有空格）
3. 执行 `refresh` 让它生效：

```bash
node "<skill目录>/scripts/proxy.mjs" refresh
```

看到 `config written` 加一行套餐信息（已用流量 / 到期日）就是成功了。

> ⚠️ 订阅地址等同于账号密码。不要发给别人、不要贴进聊天、不要提交进 git 仓库。
> 仓库的 `.gitignore` 已经排除了这个文件名，但仍请自行注意。

其余依赖（内核、GeoIP 数据库）都已随仓库提供，不需要额外下载，也不需要管理员权限。

### 已经实测过的通道

| 客户端 | 是否走代理 |
|---|---|
| `git`（HTTPS 远程） | ✅ |
| `git`（SSH 远程） | ✅（加 `--ssh`，会把 github/gist 走 `ssh.github.com:443`） |
| `curl` | ✅ |
| Python `requests` / `urllib` | ✅ |
| Node `fetch`（v24，需 `NODE_USE_ENV_PROXY=1`） | ✅ |
| npm / pip | ✅ |
| Node `fetch`（v22 及以下） | ❌ undici 不读 `*_PROXY` |

---

## portable-runtimes

给一台**不想装东西**的电脑准备一套 Node / Python / Git。

有些场景就是不适合装：别人的机器、公司的电脑、临时排查问题的环境。装了会写注册表、改 PATH、
塞服务、留卸载残留。这个技能把**官方发行版的免安装包**直接内置进仓库，一条命令解压成能立刻用的目录，
全程不碰系统，用完删目录就是彻底卸载。

**一条命令：**

```bash
node "<技能目录>/scripts/setup.mjs" --target D:\tools --node lts
```

跑完会打印一段可以直接粘贴的 PATH 片段（只在当前窗口生效）。

### 内置了什么

| 内置包 | 版本 | 来源 |
|---|---|---|
| `node-v24.21.0-win-x64.zip` | Node.js 24.21.0 LTS | nodejs.org |
| `node-v26.8.2-win-x64.zip` | Node.js 26.8.2 Current | nodejs.org |
| `python-3.14.7-embed-amd64.zip` | Python 3.14.7 embeddable | python.org |
| `PortableGit-2.55.0.5-64-bit.7z.exe` | Git for Windows 2.55.0.5（含 Git Bash） | github.com/git-for-windows |

全部是官方原版，未做任何修改；SHA-256 已与官方发布页逐字比对一致
（校验清单 `portable-runtimes/packages/SHA256SUMS.txt`，随时 `--check` 复查）。
**合计约 144 MB**——这是为了保证离线也能用完整拿到，代价是仓库变大。

### 它做了什么，以及刻意没做什么

| | |
|---|---|
| ✅ 解压到用户指定的**一个**目录 | 不往系统目录里塞任何东西 |
| ✅ 不改系统 PATH | 只在当前窗口注入，要不要持久化由用户决定 |
| ✅ 不写注册表、不装服务 | 没有 installer、没有 MSI |
| ✅ 不需要管理员权限 | 普通用户就能跑 |
| ✅ 官方原版 | 没有二次打包、没有魔改 |
| ❌ 不装 Visual C++ 运行库 | 内置的包都自带所需 DLL（Node 静态链接、Python 带 `vcruntime140.dll`） |
| ❌ 不碰 `~/.gitconfig` | PortableGit 把自己当便携的，`HOME` 指向自身目录 |

### 子命令

| 命令 | 用途 |
|---|---|
| `setup.mjs` | 校验 → 解压 → 给 Python 打开 `site` → 冒烟测试 → 打印 PATH 片段 |
| `--target <目录>` | 解压目标，默认 `%USERPROFILE%\portable-runtime` |
| `--node lts\|current\|both\|none` | 选 Node 版本，默认 `lts` |
| `--only git,python` | 只装指定项 |
| `--pip` | 顺带为嵌入式 Python 装好 pip（需要能访问 pypi.org） |
| `--check` / `--list` / `--env` / `--force` | 校验 / 列包 / 只打印 PATH / 强制重解压 |

### 运行环境

**必需**

| 项 | 要求 | 说明 |
|---|---|---|
| 操作系统 | **Windows x64** | 内置的都是 win-x64 二进制 |
| Node.js | **≥ 18** | 只用来跑 `setup.mjs`。零 npm 依赖，纯内置模块 |
| `tar.exe` | Win10 1803+ 自带 | 在 `C:\Windows\System32\tar.exe`，用来解 zip |

不需要管理员权限，不需要 7-Zip，不需要预装任何东西。

### 几个已知边界

- **目标路径要短**。PortableGit 内部目录很深，超过 60 字符时脚本会警告，请换 `D:\tools` 这类短路径。
- **`--pip` 需要联网**。直连不上 pypi 的话，套一层 `local-proxy` 再跑（pip 认 `HTTP_PROXY`）。
- **嵌入式 Python 只有标准库**，没有 `tkinter` / `IDLE` / `venv`。需要这些就不该用免安装方案。
- **内置的是快照，不会自己更新**。要换版本见 `portable-runtimes/SKILL.md` 的「更新内置包」。

---

## 分享给别人 / 让别的 AI 帮忙安装

把**仓库链接**和下面这段**提示词**一起发出去。对方只需要把提示词粘给他的 AI，
再把订阅地址填进尖括号里，剩下全部会自动完成。

**链接**：

- GitHub：<https://github.com/N0-1-C/agent-skills>
- Gitee 镜像（国内更快）：<https://gitee.com/cqhup/agent-skills>

**提示词**：

```text
请帮我安装并使用 agent-skills 仓库里的 local-proxy 技能。

它的作用：让我交给你的联网命令临时走一个只对这条命令生效的代理，
不修改我系统的代理开关、路由表或 DNS，用完即走。

1. 安装：从 https://github.com/N0-1-C/agent-skills 获取仓库
   （国内网络慢的话改用镜像 https://gitee.com/cqhup/agent-skills，内容完全一致）
   把 local-proxy 目录完整复制到 ~/.workbuddy/skills/local-proxy/
2. 配置：我的机场订阅地址是 <在这里粘贴你的 Clash 订阅链接>
   请把它单独一行写入 ~/.workbuddy/local-proxy/subscription.txt
   （如果我没有提供地址，就告诉我该去哪儿复制，不要自己编一个）
3. 自检：执行 node "<skill目录>/scripts/proxy.mjs" doctor
   确认 host requirements 与 skill files and config 两段的必需项都是 [ok]；
   [--] 是可选项缺失，属正常
4. 验证：执行 node "<skill目录>/scripts/proxy.mjs" run "git ls-remote https://github.com/git/git.git HEAD"
   能打印出一个 commit hash 就说明通了
5. 以后凡是我要求你做的事需要访问外网（git push/pull、npm/pip 安装、调用境外 API、
   下载境外文件），都套用：node "<skill目录>/scripts/proxy.mjs" run "<原命令>"
6. 全程不要修改我的系统代理、路由表、DNS，也不要使用 TUN 模式
```

### portable-runtimes 的提示词

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

---

## 说明

- **文档里不再写死机器路径。**命令示例统一用占位符：`<技能目录>` 指该技能所在的目录，
  `<node24>` 指本机 Node ≥ 24 的 `node.exe` 绝对路径。AI 调用时从技能元信息的 base directory 取真实路径，
  人工使用时替换成自己的路径即可。运行期数据仍固定放在 `~/.workbuddy/<技能名>/`，跟技能装在哪无关。
- `local-proxy/bin/mihomo.exe` 取自 [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo) 官方 release
  （`windows-amd64-v1` 通用兼容版），未修改。介意二进制来源的话可以自行替换同名文件。
- `portable-runtimes/packages/` 里的四个包全部是官方原版、未修改，只是原样转存进仓库方便离线取用：
  [Node.js](https://nodejs.org/dist/) 官方 zip、[Python](https://www.python.org/downloads/windows/) 官方
  embeddable zip、[Git for Windows](https://github.com/git-for-windows/git/releases) 官方 PortableGit。
  SHA-256 已逐一与官方发布页比对，想自己核对就跑 `setup.mjs --check`。
- 各技能里提到的第三方工具与订阅服务与本仓库无关，请自行确保使用方式合规。
