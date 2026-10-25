# NodeX

节点端守护进程。把面板下发的配置与用户名单落到 Xray / Hysteria 2 内核，并将内核产生的流量与在线状态回传面板。

[English](README.en.md) · [路由器版](https://github.com/wooxi/nodex-luci) · [容器版](https://github.com/wooxi/nodex-docker) · [控制面板](https://github.com/wooxi/xpanel)

---

## 定位

NodeX 运行在节点服务器上，位于面板与内核之间。它没有面向终端用户的注册、订阅与计费界面，那部分属于面板。NodeX 只负责四件事：拉取配置、下发用户、采集流量、托管内核进程。

一个实例可以同时承载多个节点。每个节点是一个独立的内核进程，有独立的监听端口、独立的同步循环和独立的状态。

**本仓库是 NodeX 唯一的源码仓库。** 路由器版与容器版是分发形态，不复制代码，构建时从本仓库拉取。

## 分发形态

同一份 Go 源码，三种安装方式。界面层不同，能力一致。

| 形态 | 仓库 | 构建产物 | 适用场景 |
|---|---|---|---|
| 标准版 | 本仓库 | 单二进制 | 通用 Linux（Debian / Alpine / systemd） |
| 路由器版 | [nodex-luci](https://github.com/wooxi/nodex-luci) | `nodex_*.ipk` + `luci-app-nodex_*.ipk` | OpenWrt x86_64，融入 LuCI 服务菜单 |
| 容器版 | [nodex-docker](https://github.com/wooxi/nodex-docker) | `ghcr.io/wooxi/nodex-docker` | Docker / 群晖 / VPS，数据目录可挂载 |

标准版与容器版使用内置的 Vue 3 管理界面，默认监听 `:8888`。路由器版接入 LuCI 菜单，通过 LuCI 反向代理访问，不额外占用端口。

## 功能

**协议**

| 协议 | 传输与安全 |
|---|---|
| VLESS | Reality / TLS / WebSocket，Reality 支持 `dest`、`serverNames`、`shortIds` |
| VMess | TCP / WebSocket / TLS |
| Trojan | TLS / WebSocket |
| Shadowsocks | `2022-blake3-*` 系列 AEAD 套件 |
| Hysteria 2 | QUIC，Salamander 混淆，上下行带宽声明 |

**节点管理**

- 单实例多节点，每节点独立内核进程、独立端口、独立同步周期
- 内核异常退出后自动拉起，退出码与重启次数在界面可见
- 内核二进制可独立下载、替换与升级，产物落在数据目录，容器重建后不丢失
- 节点级启停

**面板对接**

- 用户名单下发：按面板返回的有效用户生成内核侧白名单，含到期与超量判断
- 节点参数下发：端口、带宽、混淆、证书以面板为准，本地配置仅作兜底
- 流量上报：按用户聚合上下行增量
- 在线状态：在线 IP 与节点心跳
- 面板不可达时保留既有配置继续服务，恢复后自动续传

**转发模式**

入口机与落地机分离的部署方式：把面板入站流量转发至落地服务器。

- 多目标按权重负载
- WebSocket 保活，周期可配
- 转发链路独立于节点协议，不改变面板侧的节点类型

## 安装

### 标准版

从 [Releases](https://github.com/wooxi/nodex/releases) 下载对应架构的二进制：

```bash
install -m 755 nodex-linux-amd64 /usr/local/bin/nodex
nodex -version
```

运行时需要 `xray` 与 `hysteria` 两个内核，默认从 `/usr/bin/xray`、`/usr/bin/hysteria` 加载，路径可在界面中修改。

```bash
nodex start                    # 前台运行，交由 init 系统托管
nodex stop
nodex restart
nodex -config /path/to/config.json
```

首次启动后访问 `http://<host>:8888` 设置管理密码。配置文件默认位于 `/etc/nodex/config.json`，由界面表单生成，无需手工编辑。

### 路由器版与容器版

分别见 [nodex-luci](https://github.com/wooxi/nodex-luci) 与 [nodex-docker](https://github.com/wooxi/nodex-docker)。两者界面不同，面板对接步骤一致：填写面板地址与通信密钥，再为每个节点指定面板节点 ID 与协议类型。

## 与面板的边界

NodeX 与面板之间只有一层 HTTP 约定，没有共享代码、没有数据库、没有运行时依赖。

| | 面板 | NodeX |
|---|---|---|
| 用户数据 | 唯一数据源 | 只读缓存，按周期刷新 |
| 节点参数 | 唯一数据源 | 只读缓存，面板不可达时用本地兜底 |
| 流量计量 | 落库与结算 | 采集与上报 |
| 订阅生成 | 负责 | 不涉及 |
| 内核进程 | 不感知 | 负责拉起与回收 |

因此 NodeX 可以对接任何实现 UniProxy 接口的面板，面板也可以接入任何实现该接口的节点程序。

## 兼容性

| 项 | 要求 |
|---|---|
| 操作系统 | Linux x86_64 / arm64，静态编译，无 glibc 依赖 |
| Go | 1.26（仅构建时） |
| 内核 | Xray-core、Hysteria 2 |
| 面板 | Xboard、V2Board 及兼容 UniProxy 的实现 |

## 相关项目

| 项目 | 说明 |
|---|---|
| [XPanel](https://github.com/wooxi/xpanel) | 控制面板：用户、订阅、节点管理 |
| [nodex-luci](https://github.com/wooxi/nodex-luci) | OpenWrt 安装包与 LuCI 界面 |
| [nodex-docker](https://github.com/wooxi/nodex-docker) | 容器镜像与编排文件 |

## 构建

```bash
cd webui && npm ci && npm run build && cd ..
CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=$(git describe --tags --always)" -o nodex ./cmd/nodex
```

前端产物经 `go:embed` 编入二进制，最终只产出一个静态可执行文件。

## 许可

本项目采用 MIT 许可证，见 [LICENSE](LICENSE)。
