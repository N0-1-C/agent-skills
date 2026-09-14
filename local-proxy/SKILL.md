---
name: local-proxy
description: 让 AI 在用户没有开系统 VPN 的情况下访问外网。为单条命令临时注入本地代理（默认 127.0.0.1:7891），用于 git push/pull GitHub、npm/pip 安装、调用境外 API 等。全程不写系统代理注册表、不建虚拟网卡、不改路由表或 DNS，只在被执行的子进程内生效。当任务涉及 GitHub、境外网站、被墙服务，或出现连接超时、DNS 污染、SSL 握手失败时使用。
agent_created: true
---

# local-proxy

## 解决什么问题

AI 需要访问外网（最典型的是 `git push` 到 GitHub），但用户系统上并没有开 VPN。
本 skill 在**同一次工具调用内**完成：启动本地代理内核 → 把代理注入这条命令的环境变量 → 执行 → 关闭内核。
不碰系统代理开关、不建虚拟网卡、不改路由表和 DNS。

## 铁律（不得违反）

1. **绝不用 TUN 模式**，**绝不写系统代理**（注册表 `ProxyEnable`），**绝不改 DNS 或路由表**。
   只用 `mixed-port` 端口模式 + 环境变量注入。TUN 才会动系统网络，端口模式不会。
2. 代理只监听 `127.0.0.1`。订阅原文里写的是 `allow-lan: true` + `bind-address: '*'`（等于把代理暴露给整个局域网），
   生成配置时会强制覆盖为 `false` / `127.0.0.1`，不要绕过这一步去手工改配置文件。
3. 订阅地址等同于账号密码，**不得**打印到对话、写入日志或提交进 git 仓库。
   它保存在 `~/.workbuddy/local-proxy/subscription.txt`。

## 环境要求

**必需**（缺任何一个都跑不起来）

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | **≥ 18** | 用来跑 `proxy.mjs` / `tunnel.mjs`。**不需要任何 npm 依赖**，全用 Node 内置模块 |
| 操作系统 | **Windows x64** | 内置的 `mihomo.exe` 是 Windows amd64 二进制 |
| Clash 格式订阅 | 一个订阅地址 | 写进 `~/.workbuddy/local-proxy/subscription.txt` |

**可选**（只影响对应的那类操作，缺了不影响别的）

| 项 | 用在哪 |
|---|---|
| `git` | git push / pull / clone —— 最典型的用途 |
| `curl` | 用 curl 下载或调 API（Windows 10 1803+ 自带） |
| `python` | 用 Python 脚本联网 |
| `ssh` 客户端 | 只有 `run --ssh` 需要（OpenSSH for Windows） |
| Node ≥ 24 | 只有"Node 脚本里用 `fetch`"才需要；Node 22 可用于其他所有场景 |

**不需要**：管理员权限、不用装 VPN 客户端、不用改任何系统设置、不用另外下载内核或 GeoIP 库（都已随 skill 自带）。

一条命令确认全部依赖：

```bash
node "C:/Users/pc/.workbuddy/skills/local-proxy/scripts/proxy.mjs" doctor
```

输出分 `host` / `skill` 两段：`[!!]` 是必须修的，`[--]` 是可选项缺失（正常）。

## 主用法

```bash
node "C:/Users/pc/.workbuddy/skills/local-proxy/scripts/proxy.mjs" <命令> [参数]
```

需要联网的命令一律套在 `run` 里：

```bash
# 单条命令
node "C:/.../proxy.mjs" run "git push origin main"

# 多条命令串起来（推荐，一次调用只启动一次内核）
node "C:/.../proxy.mjs" run "git add -A && git commit -m \"update\" && git push"

# ssh:// 远程的仓库要加 --ssh
node "C:/.../proxy.mjs" run --ssh "git push origin main"
```

## 命令表

| 命令 | 用途 |
|---|---|
| `run "<命令>"` | **主入口**。自动启内核 → 注入代理 → 执行 → 关内核，退出码原样透传 |
| `run --keep "<命令>"` | 同上，但执行完不关内核（用户自己在终端里连续操作时有用） |
| `run --ssh "<命令>"` | 额外为 git 的 ssh:// 远程开隧道（见下） |
| `status` | 运行状态、套餐额度、当前节点、出口 IP |
| `nodes` | 列出所有代理组和节点 |
| `pick <节点名>\|auto` | 切换节点，支持子串模糊匹配（如 `pick 日本1`） |
| `refresh` | 重新拉订阅、重建配置并重载 |
| `up` / `down` | 手工启停 |
| `env` | 打印环境变量（人工排错用） |
| `doctor` | 自检：内核/geo 库/订阅/端口/配置是否安全 |

## 关键限制（务必先读，否则会误判）

### 1. 必须用 `run`，不能指望 `up` 之后的进程还活着

沙箱在**每次工具调用结束时回收整个进程树**，所以上一条调用里 `up` 起来的内核，下一条调用就没了
（`status` 会显示 `DOWN` + `pid ... (stale)`）。
因此启动与执行必须落在同一次调用内 —— 这正是 `run` 做的事。

### 2. 各类客户端是否认 `HTTP_PROXY` 环境变量（本机已实测）

| 客户端 | 走代理 | 说明 |
|---|---|---|
| `git`（https 远程） | ✅ | 本机用 GCM 存凭据，直接可用 |
| `git`（ssh 远程） | 需 `--ssh` | 见下一节 |
| `curl` | ✅ | |
| Python `requests` / `urllib` | ✅ | 默认 `trust_env=True` |
| **Node 内置 `fetch`（v22）** | ❌ | undici 不读 `*_PROXY`，会直连并超时 |
| **Node 内置 `fetch`（v24）** | ✅ | 需 `NODE_USE_ENV_PROXY=1`，`run` 已自动带上 |
| `npm` / `pip` | ✅ | |
| 宿主的联网搜索、网页抓取工具 | ❌ | 在宿主侧执行，**不经过本地代理** |

Node 写脚本要用 `fetch` 时，改走 v24：

```bash
node "C:/.../proxy.mjs" run "\"C:/Program Files/nodejs/node.exe\" your-script.mjs"
```

### 3. SSH 远程要加 `--ssh`

`git@github.com:...` 这类远程不走 HTTP 代理。加 `--ssh` 后 skill 会生成一份临时 ssh 配置并通过 `GIT_SSH_COMMAND` 注入，
只影响这条命令的子进程。

两个本机实测结论：
- 这个机场**不通 `github.com:22`** —— CONNECT 返回 200 但永远等不到 SSH banner，
  所以 `github.com` / `gist.github.com` 被自动改写到 `ssh.github.com:443`（GitHub 官方的备用端点），实测可拿到 banner。
- 使用 `--ssh` 会把主机密钥写入 `~/.ssh/known_hosts`（等价于首次连接时确认），属于预期行为。

如果你用 HTTPS 远程（本机就是 HTTPS + 凭据管理器），不需要 `--ssh`。

### 4. 首次推送可能需要凭据

本机 git 全局装了 Git Credential Manager。凭据已存过时 `git push` 直接成功；
若该仓库从没推过，GCM 可能弹窗或等待输入，在非交互环境里表现为**命令卡住不动**。
遇到这种情况不要反复重试，让用户先在自己终端里手动推一次完成登录，之后 AI 就能静默使用。

### 5. 要调 GitHub API 时怎么拿凭据

本机 Windows 凭据管理器**已存有** `git:https://github.com` 的凭据
（用户 `N0-1-C`，经典 PAT，scopes 为 `gist, repo, workflow`）。
需要带鉴权调 API 时用 `git credential fill` 取 token，但**绝不能把 token 打印出来或落盘**：

```js
const c = spawn('git', ['credential', 'fill'], { stdio: ['pipe', 'pipe', 'pipe'] });
c.stdin.end('protocol=https\nhost=github.com\n\n');   // 从 stdout 解析出 password，仅用于 Authorization 头
```

实测 `api.github.com/user/repos` 正常返回（9 个公开 + 2 个私有），说明 AI 可以在没有任何人工干预的情况下
完成带鉴权的 GitHub 读写。

## 电脑上已经开了 VPN / 代理软件时会怎样

结论：**绝大多数情况完全正常，两者并列共存，互不干扰。**

| 情况 | 结果 | 依据 |
|---|---|---|
| 别的代理客户端在跑（端口模式，只在监听） | ✅ 完全正常 | 本机实测：Clash for Windows 占着 7890、另一个代理占着 14711，两个都在跑，skill 全程正常 |
| 系统代理开着（注册表 `ProxyEnable=1`） | ✅ 正常 | `run` 总是给子进程显式写 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`，覆盖系统设置。而且 git 和 curl 只认环境变量，根本不读注册表 |
| 环境变量里已存在 `*_PROXY` | ✅ 正常 | 实测把环境变量指向**死端口 9999**，`run` 依然成功 → 说明覆盖是彻底的，不会继承 |
| 别的软件占用了 7891 / 9091 | ❌ 起不来 | 改 `settings.json` 里的端口；`doctor` 会直接把冲突报出来 |
| TUN 模式的 VPN（建虚拟网卡 + 改全局路由） | ⚠️ 能用，但变成双层代理 | 内核对外的连接会被 TUN 再抓一次，"代理套代理"——更慢、更绕，而且此时"不动系统网络"这条承诺是被那个软件破坏的，不是本 skill |
| 真正的 VPN（WireGuard / OpenVPN 等改默认路由） | ⚠️ 同上 | 同上 |

两点值得单独说：

1. **内核启动时会被主动剥掉代理环境变量**（`coreEnv()`）。原因：如果环境里 `HTTP_PROXY` 指向 `127.0.0.1:7891`，一个"听话"的内核会连上自己形成死循环。内核本身就是代理，不需要再走代理。
2. **本 skill 从不修改系统代理，也从不关闭别人的代理。** 它和系统里已有的 VPN 是并列关系，不是替代关系。所以"电脑上开着 VPN"和"用这个 skill"可以同时成立。

顺带一提：既然已经有全局代理在跑了，你也可以直接用它 —— 但那是全局生效的、需要你手动开。本 skill 的价值在于**按需、只给单条命令**，用完即走。

## 配置

| 文件 | 作用 |
|---|---|
| `~/.workbuddy/local-proxy/subscription.txt` | 订阅地址（**敏感**，换订阅就改这里，然后 `refresh`） |
| `~/.workbuddy/local-proxy/settings.json` | 端口。默认代理 `7891`、控制 `9091` |
| `~/.workbuddy/local-proxy/run/config.yaml` | 生成的安全配置，不要手工改，用 `refresh` 重建 |
| `~/.workbuddy/local-proxy/mihomo.log` | 内核日志（级别 warning） |

端口 7891 是特意避开 Clash for Windows 的 7890 的，两者可以同时存在、互不干扰。

## 排错

先跑 `doctor`，再看 `references/troubleshooting.md`。
