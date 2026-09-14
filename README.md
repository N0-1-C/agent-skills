# agent-skills

给 AI Agent（WorkBuddy、Claude Code 等）用的技能集合。

每个技能一个独立目录，包含 `SKILL.md`（面向 AI 的说明书）以及需要时附带的脚本与资源。
克隆下来把目录拷进本地技能目录即可使用。

## 技能列表

| 技能 | 用途 | 环境依赖 |
|---|---|---|
| [local-proxy](./local-proxy/) | 让 AI 在没有开系统 VPN 的情况下访问外网（GitHub 推送、npm/pip 安装、调用境外 API），只在被执行的子进程内生效，不改系统网络配置 | Windows + Node.js |

## 安装

技能目录约定：

- **用户级**（所有项目可用）：`~/.workbuddy/skills/<技能名>/`
- **项目级**（只在某个仓库里生效）：`<项目>/.workbuddy/skills/<技能名>/`

```bash
git clone https://github.com/N0-1-C/agent-skills.git
cp -r agent-skills/local-proxy ~/.workbuddy/skills/
```

Windows PowerShell：

```powershell
git clone https://github.com/N0-1-C/agent-skills.git
Copy-Item -Recurse agent-skills\local-proxy "$env:USERPROFILE\.workbuddy\skills\"
```

**国内访问 GitHub 慢的话，用 Gitee 镜像**（内容完全同步，提交号一致）：

```bash
git clone https://gitee.com/cqhup/agent-skills.git
cp -r agent-skills/local-proxy ~/.workbuddy/skills/
```

```powershell
git clone https://gitee.com/cqhup/agent-skills.git
Copy-Item -Recurse agent-skills\local-proxy "$env:USERPROFILE\.workbuddy\skills\"
```

---

## local-proxy

给 AI 一个"用完即走"的代理通道。AI 需要联网时自己起内核、注入代理、执行命令、关掉内核，
全程不需要人工介入，也不碰系统网络设置。

**一条命令就是全部用法：**

```bash
node "C:/Users/pc/.workbuddy/skills/local-proxy/scripts/proxy.mjs" run "git push origin main"
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
node "C:/Users/pc/.workbuddy/skills/local-proxy/scripts/proxy.mjs" doctor
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

---

## 说明

- 技能文档里出现的绝对路径（`C:\Users\...`）是本机的，换机器时按需调整。
- `local-proxy/bin/mihomo.exe` 取自 [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo) 官方 release
  （`windows-amd64-v1` 通用兼容版），未修改。介意二进制来源的话可以自行替换同名文件。
- 各技能里提到的第三方工具与订阅服务与本仓库无关，请自行确保使用方式合规。
