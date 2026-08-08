# NodeX — OpenWrt 节点管家

在 OpenWrt 路由器上运行的代理节点管理服务：**Xray（vless/vmess/trojan/ss + Reality）+ Hysteria2** 双内核，通过 V2Board/Xboard 标准协议对接面板，自带 Web 表单化配置界面。

## 功能

- 🚀 **双内核节点**：xray（vless+reality / vmess / trojan / shadowsocks）+ 官方 hysteria2
- 🔗 **Xboard 对接**：标准 UniProxy 协议（拉用户 / 推流量 / 心跳 / 状态），per-user 精确流量统计
- 🎛️ **Web 表单配置**：所有参数均为表单化配置项（非 JSON 手填），支持自动生成密钥/UUID/密码
- 📊 **仪表盘**：节点状态、在线用户、实时流量
- 📦 **OpenWrt 原生安装**：ipk 包 + init.d 开机自启
- 🤖 **GitHub Actions**：自动编译 ipk 并发布 Release

## 架构

```
┌────────────────── OpenWrt ──────────────────┐
│                                            │
│  Web UI (Vue3 表单) ──▶ nodex (Go) ──┐     │
│                                     │     │
│  ┌──────────────┬───────────────────▼──┐   │
│  │ xray 进程     │ hysteria2 进程       │   │
│  │ vless/vmess  │ 官方 hysteria 二进制  │   │
│  │ /trojan/ss   │ auth.http 回调认证    │   │
│  │ gRPC stats   │ /traffic API 统计     │   │
│  └──────┬───────┴──────────┬──────────┘   │
└─────────┼──────────────────┼──────────────┘
          └──── 合并流量 ─────┘
                    │ UniProxy push/alive/status
                    ▼
              Xboard 面板
```

## 安装

```bash
# 1. 安装内核（xray 1.8+，hysteria 2.x）
opkg update
opkg install xray hysteria   # 或手动放置二进制到 /usr/bin/

# 2. 安装 NodeX
opkg install nodex_*.ipk

# 3. 启动
/etc/init.d/nodex enable
/etc/init.d/nodex start

# 4. 打开管理界面
# http://<路由器IP>:8888 （首次访问设置管理密码）
```

## 面板配置步骤

1. 面板后台 → 服务器 → 添加节点（v2ray 或 hysteria 类型），记录 **节点 ID**
2. 面板后台 → 系统设置 → 获取**服务器通信密钥**（server_token）
3. NodeX Web UI → 面板对接 → 填入面板地址 / 密钥 / 节点 ID → 测试连接
4. 节点配置 → 设置端口与 Reality 参数 → 保存
5. 仪表盘 → 启动节点

### 对接协议

| 接口 | 说明 |
|---|---|
| `GET /api/v1/server/UniProxy/config` | 拉取节点配置 |
| `GET /api/v1/server/UniProxy/user` | 拉取用户列表 |
| `POST /api/v1/server/UniProxy/push` | 推送流量 `{uid: [upload, download]}` |
| `POST /api/v1/server/UniProxy/alive` | 在线设备 |
| `POST /api/v1/server/UniProxy/status` | 系统状态 |

## 已知注意事项

- **Reality dest 兼容性**：dest 站点若部署了后量子加密（MLKEM，如 microsoft/apple/baidu），reality 握手会失败。请使用未部署 MLKEM 的站点（默认 `www.amazon.com`，实测兼容）。
- **hysteria2 流量统计**：采用 `auth.http` 回调 + `/traffic` API 实现 per-user 统计（用户名 = 面板 uid，密码 = 用户 uuid），与 Xboard 订阅格式兼容。
- **xray 版本**：官方 release 二进制不含 hysteria2 模块，故 hysteria2 由官方 hysteria 二进制单独运行。

## 开发

```bash
# 前端
cd webui && npm install && npm run build

# 后端（需先构建前端，embed 依赖 dist）
go build -o nodex ./cmd/nodex
```

## 目录结构

```
cmd/nodex/           入口
internal/config/     配置模型（表单映射）
internal/panel/      Xboard 对接（UniProxy 协议 + 同步器）
internal/xray/       xray 进程管理 + gRPC stats + hysteria2 管理
internal/web/        Web API + 前端 embed
webui/               Vue3 前端（表单化配置）
openwrt/             OpenWrt ipk 打包
.github/workflows/   GitHub Actions 编译发布
```
