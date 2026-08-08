package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
)

// Config 是 NodeX 的完整配置，由 Web 前端表单生成，用户不直接编辑 JSON。
type Config struct {
	Web    WebConfig    `json:"web"`
	Panel  PanelConfig  `json:"panel"`
	Node   NodeConfig   `json:"node"`
	System SystemConfig `json:"system"`
}

type WebConfig struct {
	Port     int    `json:"port"`     // Web 管理端口
	Password string `json:"password"` // 管理密码明文（保存时存 hash，见 HashPassword）
}

type PanelConfig struct {
	Enabled      bool   `json:"enabled"`       // 是否启用面板对接
	URL          string `json:"url"`           // 面板地址，如 http://192.168.100.4:7001
	Token        string `json:"token"`         // 面板通信密钥
	NodeID       int    `json:"node_id"`       // 面板节点 ID
	NodeType     string `json:"node_type"`     // 节点类型（vless/trojan/shadowsocks/vmess/hysteria），留空由面板返回决定
	PullInterval int    `json:"pull_interval"` // 拉取配置/用户间隔（秒）
	PushInterval int    `json:"push_interval"` // 推送流量/心跳间隔（秒）
}

type NodeConfig struct {
	// 本地模式协议（面板模式下面板配置优先）
	Protocol string `json:"protocol"` // vless | vmess | trojan | shadowsocks | hysteria2
	Port     int    `json:"port"`     // 监听端口
	UUID     string `json:"uuid"`     // vless/vmess 用户 ID

	// TLS / Reality
	TLS        int     `json:"tls"` // 0=关闭 1=TLS 2=Reality
	CertPath   string  `json:"cert_path"`
	KeyPath    string  `json:"key_path"`
	ServerName string  `json:"server_name"`
	Reality    Reality `json:"reality"`

	// Hysteria2
	Hy2 Hy2 `json:"hy2"`

	// Shadowsocks
	SSMethod string `json:"ss_method"`
}

type Reality struct {
	Dest        string `json:"dest"`         // 如 www.microsoft.com:443
	ServerNames string `json:"server_names"` // 逗号分隔
	PrivateKey  string `json:"private_key"`
	ShortIDs    string `json:"short_ids"` // 逗号分隔
	PublicKey   string `json:"public_key"` // 只读展示用
}

type Hy2 struct {
	Port         int    `json:"port"`
	Password     string `json:"password"`
	Obfs         string `json:"obfs"` // none | salamander
	ObfsPassword string `json:"obfs_password"`
	UpMbps       int    `json:"up_mbps"`
	DownMbps     int    `json:"down_mbps"`
	IgnoreBW     bool   `json:"ignore_bw"`
	BinPath      string `json:"bin_path"` // hysteria 可执行文件路径
	CertPath     string `json:"cert_path"`
	KeyPath      string `json:"key_path"`
}

type SystemConfig struct {
	XrayPath string `json:"xray_path"` // xray 可执行文件路径
	LogLevel string `json:"log_level"` // debug|info|warning|error
	DataDir  string `json:"data_dir"`  // 数据目录（配置/xray 配置/日志）
}

const DefaultConfigPath = "/etc/nodex/config.json"

func Default() *Config {
	return &Config{
		Web: WebConfig{Port: 8888},
		Panel: PanelConfig{
			PullInterval: 60,
			PushInterval: 60,
		},
		Node: NodeConfig{
			Protocol: "vless",
			Port:     443,
			TLS:      2, // reality
			SSMethod: "2022-blake3-aes-128-gcm",
			Reality: Reality{
				Dest:        "www.amazon.com:443",
				ServerNames: "www.amazon.com",
				ShortIDs:    "",
			},
			Hy2: Hy2{
				Port:     8443,
				Obfs:     "none",
				UpMbps:   100,
				DownMbps: 1000,
				BinPath:  "/usr/bin/hysteria",
			},
		},
		System: SystemConfig{
			XrayPath: "/usr/bin/xray",
			LogLevel: "info",
			DataDir:  "/etc/nodex",
		},
	}
}

func (c *Config) DataDir() string {
	if c.System.DataDir == "" {
		return "/etc/nodex"
	}
	return c.System.DataDir
}

func (c *Config) XrayConfigPath() string  { return filepath.Join(c.DataDir(), "xray", "config.json") }
func (c *Config) XrayLogPath() string     { return filepath.Join(c.DataDir(), "xray", "access.log") }
func (c *Config) XrayErrorLogPath() string { return filepath.Join(c.DataDir(), "xray", "error.log") }
func (c *Config) XrayPidFile() string     { return filepath.Join(c.DataDir(), "xray", "xray.pid") }

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Default(), nil
		}
		return nil, err
	}
	cfg := Default()
	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *Config) Save(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func (c *Config) ConfigPath() string { return DefaultConfigPath }

// Validate 校验表单提交的配置
func (c *Config) Validate() error {
	if c.Web.Port < 1 || c.Web.Port > 65535 {
		return errors.New("Web 管理端口无效")
	}
	if c.Panel.Enabled {
		if c.Panel.URL == "" {
			return errors.New("面板地址不能为空")
		}
		if c.Panel.Token == "" {
			return errors.New("面板通信密钥不能为空")
		}
		if c.Panel.NodeID <= 0 {
			return errors.New("节点 ID 必须大于 0")
		}
	}
	switch c.Node.Protocol {
	case "vless", "vmess", "trojan", "shadowsocks", "hysteria2":
	default:
		return errors.New("不支持的协议: " + c.Node.Protocol)
	}
	if c.Node.Port < 1 || c.Node.Port > 65535 {
		return errors.New("节点端口无效")
	}
	if c.Node.TLS == 2 && c.Node.Reality.PrivateKey == "" {
		return errors.New("Reality 私钥不能为空（可点击自动生成）")
	}
	return nil
}

// EnsureDefaults 填充空字段的默认值（如自动生成 UUID）
func (c *Config) EnsureDefaults() {
	if c.Node.UUID == "" {
		c.Node.UUID = newUUID()
	}
	if c.Node.Hy2.Password == "" {
		c.Node.Hy2.Password = randHex(16)
	}
	if c.Node.Hy2.ObfsPassword == "" && c.Node.Hy2.Obfs == "salamander" {
		c.Node.Hy2.ObfsPassword = randHex(8)
	}
}

func IntOr(s string, def int) int {
	if s == "" {
		return def
	}
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return def
}
