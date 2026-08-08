# NodeX — OpenWrt 节点管家（Xray + Hysteria2 + Xboard 对接）

## 1. 目标

在 OpenWrt（x86_64）路由器上部署一个服务，实现：

- 运行 **Xray**（vless+reality / vmess / trojan / ss）和 **Hysteria2** 节点
- 节点通过 V2Board/Xboard 标准 API（UniProxy/UniPush/Alive）与面板对接
- 自带 **Web 前端**，所有配置均为**表单化配置项**（非 JSON 手填）
- 打包为 **ipk**，由 **GitHub Actions** 用 OpenWrt SDK 编译发布

## 2. 架构

```
┌────────────────────────── OpenWrt ──────────────────────────┐
│                                                            │
│   ┌─────────────┐    ┌──────────────────────────────────┐  │
│   │  Web UI     │    │          nodex (Go 单二进制)      │  │
│   │  (Vue3 表单) │───▶│  ┌────────────┐  ┌─────────────┐ │  │
│   └─────────────┘    │  │ 配置管理    │  │ 面板对接    │ │  │
│   :8888 (HTTP)       │  │ (表单→JSON) │  │ (xboard API)│ │  │
│                      │  └─────┬──────┘  └──────┬──────┘ │  │
│                      │  ┌─────▼──────┐         │         │  │
│                      │  │ 进程管理    │◀────────┘         │  │
│                      │  │ xray/hysteria│                 │  │
│                      │  └─────┬──────┘                   │  │
│                      └────────┼──────────────────────────┘  │
│              ┌────────────────▼───────────────┐             │
│              │ xray (vless/vmess/trojan/ss/   │             │
│              │       hysteria2 inbound)       │             │
│              └────────────────┬───────────────┘             │
└───────────────────────────────┼─────────────────────────────┘
                                │ V2Board 协议
                                ▼
                     ┌───────────────────┐
                     │  Xboard 面板      │
                     │ /api/v1/server/   │
                     │  UniProxy/UniPush │
                     │  /Alive           │
                     └───────────────────┘
```

### 核心决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 主程序语言 | **Go**（静态编译，CGO 关闭） | 单二进制、交叉编译简单、OpenWrt x86_64 直接跑 |
| 前端 | **Vue3 + Vite**，`go:embed` 嵌入二进制 | 无外部依赖，一个文件搞定 |
| 内核 | **双内核**：xray + 官方 hysteria2 二进制 | xray release 不含 hysteria2 模块；hysteria2 用 auth.http 回调实现 per-user 统计 |
| 面板协议 | **Xboard UniProxy 协议**（push 格式 `{uid: [up, down]}`） | 与 Xboard 源码逐字段核对 |
| 配置存储 | `/etc/nodex/config.json`（UI 表单生成，用户不手写） | 表单→结构化配置 |
| 打包 | **ipk**（opkg） + `/etc/init.d/nodex` | 原生安装方式，开机自启 |
| CI | **GitHub Actions** + OpenWrt SDK | 自动编译 ipk 并发布 Release |

## 3. 面板对接协议（V2Board/Xboard 标准）

| 接口 | 方法 | 用途 | 频率 |
|---|---|---|---|
| `GET /api/v1/server/UniProxy?token={token}` | GET | 拉取节点配置 + 用户列表 | 启动时 + 每 60s |
| `POST /api/v1/server/UniPush` | POST | 推送在线用户 + 用户流量 | 每 60s |
| `POST /api/v1/server/Alive` | POST | 心跳（节点在线状态） | 每 60s |

- 流量数据来源：xray gRPC stats API（`StatsService.GetStats`），按用户维度统计
- 节点配置从面板拉取后**合并本地覆盖项**（端口、协议等可在本地表单覆盖）

## 4. 前端页面（全部表单化，无 JSON 编辑）

### 4.1 登录页
- 首次访问设置管理密码 → 登录

### 4.2 仪表盘
- 节点运行状态（xray 进程、内存、运行时长）
- 在线用户列表 + 实时流量曲线
- 今日流量 / 总流量统计
- 最近日志

### 4.3 面板对接（表单）
| 配置项 | 说明 |
|---|---|
| 面板地址 | `https://panel.example.com` |
| 通信 Token | 面板节点处生成的 token |
| 节点 ID | 面板中的节点 ID |
| 同步间隔 | 拉取配置频率（默认 60s） |
| 流量上报间隔 | 默认 60s |

### 4.4 节点配置（表单，按协议分组）

**通用：**
- 监听端口（数字输入）
- 入站协议选择：`vless+reality` / `vmess` / `trojan` / `shadowsocks` / `hysteria2` / `全部启用`
- UUID 自动生成按钮（或手动填写）
- 流量统计开关

**TLS / Reality（vless 必选）：**
- 目标域名 dest（如 `www.microsoft.com`）
- serverNames 列表（逗号分隔）
- PrivateKey 自动生成按钮 / 手动填写
- ShortIds 列表

**Hysteria2：**
- 密码（自动生成按钮）
- obfs 类型（none / salamander）+ 密码
- up / down 带宽（Mbps 数字输入）
- 忽略客户端带宽声明（开关）

**证书（vmess/trojan/ss 若用 TLS）：**
- 证书路径（文本框）
- 私钥路径（文本框）
- 或"自动自签证书"开关 + 域名

### 4.5 系统设置
- Web 管理端口（默认 8888）
- 管理密码修改
- xray 可执行文件路径 / 版本检查
- 日志级别选择（下拉：debug/info/warn/error）
- 恢复出厂 / 备份导出

### 4.6 日志页
- 实时滚动日志（WebSocket 或轮询）
- 级别过滤

## 5. 项目结构

```
nodex/
├── cmd/nodex/main.go          # 入口：serve / version 子命令
├── internal/
│   ├── config/                # 配置模型 + 表单校验 + 默认值
│   ├── panel/                 # Xboard 对接（UniProxy/UniPush/Alive）
│   ├── xray/                  # xray 配置生成 + 进程管理 + gRPC stats
│   ├── web/                   # HTTP 服务 + 路由 + API
│   └── log/                   # 日志轮转
├── webui/                     # Vue3 前端
│   ├── src/pages/             # 登录/仪表盘/面板/节点/系统/日志
│   └── ...
├── openwrt/                   # OpenWrt 打包
│   ├── nodex.init             # /etc/init.d 脚本
│   ├── Makefile               # ipk 构建
│   └── files/                 # 默认配置文件等
├── .github/workflows/build.yml  # GH Actions: 编译 ipk + release
└── Makefile                   # 本地构建（go build + 前端打包）
```

## 6. GitHub Actions 流程

```yaml
on: [push, workflow_dispatch]
jobs:
  build-ipk:
    runs-on: ubuntu-latest
    steps:
      - 检出代码
      - 构建 Go 二进制 (GOOS=linux GOARCH=amd64 CGO_ENABLED=0)
      - 构建前端并 embed
      - 下载 OpenWrt SDK (x86_64, 与路由器版本匹配)
      - make package/nodex/compile → 产出 .ipk
      - 上传 artifact + 创建 Release（打 tag 时）
```

## 7. 里程碑

1. **M1**：Go 服务骨架 + xray 进程管理 + 本地测试节点跑通（无面板）
2. **M2**：Web UI 表单化配置（登录/仪表盘/节点配置/系统设置）
3. **M3**：Xboard 对接（UniProxy/UniPush/Alive + 流量统计）
4. **M4**：OpenWrt ipk 打包 + init.d + GitHub Actions 编译发布
5. **M5**：真机部署到 192.168.100.1 + 面板联调

## 8. 待确认

- [ ] Xboard 面板地址 / token（可后补，先本地模式开发）
- [ ] 需要支持的全部协议（默认：vless+reality + hysteria2 优先）
- [ ] 项目名确认：NodeX？（可改名）
- [ ] GitHub 仓库地址（用于 Actions 编译）
