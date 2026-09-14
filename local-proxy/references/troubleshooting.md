# local-proxy 排错手册

所有结论均在本机实测过（Windows 10 19045 / mihomo v1.19.30 / Node 22 与 24）。

---

## 先跑自检

```bash
node "C:/Users/pc/.workbuddy/skills/local-proxy/scripts/proxy.mjs" doctor
```

九项检查应全为 `[ok]`。任何 `[!!]` 项的备注里通常已写明下一步。

---

## 症状对照

### `status` 显示 DOWN，并且 `pid ... (stale)`

不是故障。沙箱会在每次工具调用结束时回收进程树，上一次调用里 `up` 的内核必然消失。

**解决**：不要先 `up` 再在另一次调用里执行命令，直接用 `run`，它把启动和执行放在同一次调用内。

---

### `Connection closed by UNKNOWN port 65535` / `kex_exchange_identification`

这是 ssh 隧道没建起来，和 HTTP 代理本身无关。

已排除的原因：
- 代理不放行 22 端口 → **不是**。实测 `CONNECT github.com:22 -> HTTP 200`，
  但隧道建立后**永远收不到 SSH banner**，说明机场节点到 GitHub 22 端口的出口是不通的。
- `connect.exe` 坏了 → **不是**。它在 cmd 下能正常拿到 banner，只是被 OpenSSH 直接 exec 时会立刻退出。

**最终方案**：用 skill 自带的 `scripts/tunnel.mjs` 做 ProxyCommand，并把 `github.com` 改写到 `ssh.github.com:443`。
带上 `--ssh` 即可，正常情况下不会再出现此报错。

---

### `fetch failed` / `UND_ERR_CONNECT_TIMEOUT`（Node 脚本里）

Node 内置 `fetch` 基于 undici，**不读 `HTTP_PROXY` 环境变量**，会尝试直连并超时。

- Node ≥ 24：`run` 已经自动注入 `NODE_USE_ENV_PROXY=1`，直接可用。
- Node 22 及以下：改用 v24 执行脚本。

```bash
node "C:/.../proxy.mjs" run "\"C:/Program Files/nodejs/node.exe\" script.mjs"
```

对照：curl、git、Python 都正常读环境变量，不受此影响。

---

### 命令跑完显示 `proxy exit check FAILED`

内核起来了，但走不通。按顺序试：

1. `proxy.mjs nodes` —— 看当前选中的节点是不是 `DIRECT` 这类无效项；
2. `proxy.mjs pick auto` —— 交给自动选速组挑一个；
3. `proxy.mjs pick 日本1` —— 指定具体节点（支持子串匹配）。

---

### 端口被占用

`settings.json` 里改 `proxyPort` / `controllerPort`，然后 `refresh`。
默认的 7891 / 9091 是为了避开 Clash for Windows 的 7890 / 9090。

判断占用者是谁：

```powershell
Get-NetTCPConnection -LocalPort 7891 -State Listen |
  ForEach-Object { Get-Process -Id $_.OwningProcess | Select-Object ProcessName, Path }
```

---

### 订阅拉不下来

`refresh` 会依次尝试：直连 → 直连(跳过证书校验) → 经 127.0.0.1 的 7891 / 7890 / 7897 / 10809。
报错信息里会列出每一次尝试的失败原因。

常见原因：
- 订阅域名本身被墙，且本机没有任何可用代理 → 先用别的方式让 7890 可用（比如打开 Clash for Windows）。
- 订阅过期：`status` 会显示到期日。

---

### 想确认"系统真的没被改"

对比以下四项即可，本 skill 不应造成任何变化：

```powershell
(Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings").ProxyEnable   # 应为 0
Get-NetAdapter | Select-Object Name, InterfaceDescription                                            # 不应出现 TAP/Wintun
Get-NetRoute -DestinationPrefix "0.0.0.0/0"                                                          # 默认路由不应变化
Get-DnsClientServerAddress -AddressFamily IPv4                                                       # DNS 不应变化
```

参考基线（2026-09-14 实测）：`ProxyEnable=0`；网卡仅有以太网(未连接)、WLAN、蓝牙、Hyper-V Default Switch；
默认路由只有 `WLAN -> 192.168.31.1`；DNS 为 `192.168.31.1`。

---

## 内核日志

`~/.workbuddy/local-proxy/mihomo.log`，级别 `warning`，正常启动只有 4 行：

```
Start initial configuration in progress
Geodata Loader mode: memconservative
Geosite Matcher implementation: succinct
Initial configuration complete, total time: 4ms
```

配置有问题时这里会出现 `level=error`，是定位配置类故障的第一现场。

---

## 更新内核

当前内核为 mihomo `v1.19.30`（`windows-amd64-v1`，通用兼容版）。
替换 `~/.workbuddy/skills/local-proxy/bin/mihomo.exe` 即可，无需改配置。
若机场后续启用 hysteria2 / tuic / reality 等新协议，mihomo 版本过旧会解析失败，
此时去 <https://github.com/MetaCubeX/mihomo/releases> 取 `windows-amd64-v1` 的 zip 替换。
