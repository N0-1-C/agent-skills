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
`doctor`（自检）、`up` / `down`。完整说明见 [local-proxy/SKILL.md](./local-proxy/SKILL.md)。

### 你需要准备的

一个 Clash 格式的订阅地址（机场订阅），写进 `~/.workbuddy/local-proxy/subscription.txt`。
**这个文件等同账号密码，不要提交进任何仓库。**

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

## 说明

- 技能文档里出现的绝对路径（`C:\Users\...`）是本机的，换机器时按需调整。
- `local-proxy/bin/mihomo.exe` 取自 [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo) 官方 release
  （`windows-amd64-v1` 通用兼容版），未修改。介意二进制来源的话可以自行替换同名文件。
- 各技能里提到的第三方工具与订阅服务与本仓库无关，请自行确保使用方式合规。
