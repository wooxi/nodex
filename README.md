# NodeX 核心源码

NodeX 节点管家——**核心源码仓库**。Go 单二进制 + Vue3 前端，管理 Xray/Hysteria2 节点、对接 Xboard 面板、支持 XrayR 转发模式。

## 分发仓库（安装包）

| 版本 | 仓库 | 内容 |
|---|---|---|
| 🖥 **路由器版（LuCI）** | [wooxi/nodex-luci](https://github.com/wooxi/nodex-luci) | ipk 安装包 + 内核，LuCI 服务菜单集成 |
| 🐳 **Docker 版** | [wooxi/nodex-docker](https://github.com/wooxi/nodex-docker) | Docker 镜像 + 数据持久化 |

## 目录结构

```
cmd/nodex/          入口（版本号构建时注入）
internal/
  config/           配置模型
  manager/          多节点管理器 + 看门狗
  panel/            Xboard 面板对接（UniProxy 协议）
  xray/             xray/hysteria2 进程管理 + 流量统计
  web/              Web API + 前端 embed
webui/              Vue3 前端（Docker 版界面，go:embed 进二进制）
```

## 构建

```bash
cd webui && npm install && npm run build   # 生成 internal/web/dist
cd ..
VERSION=$(git describe --tags --always)
CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=$VERSION" -o nodex ./cmd/nodex
```

## 功能

- 多节点管理（每节点独立 xray/hysteria2 进程，独立端口/API/同步循环）
- Xboard 面板对接（拉用户 / 推流量 / 心跳 / 状态）
- 协议：vless(+Reality/TLS/WS) / vmess / trojan / shadowsocks / hysteria2
- 转发出站（XrayR 转发模式，多目标负载均衡）
- 内核总开关、核心一键下载/更新、流量统计、在线用户/IP
- 内核崩溃自动拉起（看门狗）
