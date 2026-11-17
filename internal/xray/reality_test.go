package xray

import (
	"testing"

	"github.com/wooxi/nodex/internal/config"
)

// 面板下发的 Reality 参数必须覆盖本地配置（面板生成并持有密钥）
func TestPanelRealityOverridesLocal(t *testing.T) {
	cfg := config.NodeConfig{
		Protocol: "vless",
		Port:     8443,
		TLS:      2,
		Reality: config.Reality{
			Dest:        "local.example.com:443",
			ServerNames: "local.example.com",
			PrivateKey:  "LOCAL_PRIV",
			ShortIDs:    "aaaa",
		},
	}
	remote := &RemoteConfig{
		Protocol:           "vless",
		Port:               8443,
		Network:            "tcp",
		TLS:                2,
		Flow:               "xtls-rprx-vision",
		RealityDest:        "www.microsoft.com:443",
		RealityServerNames: []string{"www.microsoft.com"},
		RealityPrivateKey:  "PANEL_PRIV",
		RealityShortIDs:    []string{"bbbb"},
	}

	m := &Manager{}
	raw := m.xrayInboundWithNetwork(cfg, nil, "tcp", remote)
	inbound, ok := raw.(map[string]any)
	if !ok {
		t.Fatalf("入站类型异常: %T", raw)
	}
	stream, ok := inbound["streamSettings"].(map[string]any)
	if !ok {
		t.Fatalf("streamSettings 缺失")
	}
	if stream["security"] != "reality" {
		t.Fatalf("security 应为 reality，实际 %v", stream["security"])
	}
	rs, ok := stream["realitySettings"].(map[string]any)
	if !ok {
		t.Fatalf("realitySettings 缺失")
	}
	if rs["privateKey"] != "PANEL_PRIV" {
		t.Errorf("privateKey 未使用面板值，实际 %v", rs["privateKey"])
	}
	if rs["dest"] != "www.microsoft.com:443" {
		t.Errorf("dest 未使用面板值，实际 %v", rs["dest"])
	}
	names, _ := rs["serverNames"].([]string)
	if len(names) != 1 || names[0] != "www.microsoft.com" {
		t.Errorf("serverNames 未使用面板值，实际 %v", rs["serverNames"])
	}
	ids, _ := rs["shortIds"].([]string)
	if len(ids) != 1 || ids[0] != "bbbb" {
		t.Errorf("shortIds 未使用面板值，实际 %v", rs["shortIds"])
	}
}

// 面板未下发 Reality 时回落到本地配置
func TestPanelRealityFallsBackToLocal(t *testing.T) {
	cfg := config.NodeConfig{
		Protocol: "vless",
		Port:     8443,
		TLS:      2,
		Reality: config.Reality{
			Dest:        "local.example.com:443",
			ServerNames: "local.example.com",
			PrivateKey:  "LOCAL_PRIV",
			ShortIDs:    "aaaa",
		},
	}
	remote := &RemoteConfig{Protocol: "vless", Port: 8443, Network: "tcp", TLS: 2}

	m := &Manager{}
	raw := m.xrayInboundWithNetwork(cfg, nil, "tcp", remote)
	inbound := raw.(map[string]any)
	rs := inbound["streamSettings"].(map[string]any)["realitySettings"].(map[string]any)
	if rs["privateKey"] != "LOCAL_PRIV" {
		t.Errorf("应回落到本地私钥，实际 %v", rs["privateKey"])
	}
}

// buildPanelInbound 应采用面板下发的 TLS 模式与证书路径
func TestBuildPanelInboundUsesRemoteTLS(t *testing.T) {
	node := &config.Node{
		NodeType: "vless",
		Node: config.NodeConfig{
			Protocol: "vless",
			Port:     443,
			TLS:      0, // 本地没开 TLS
			CertPath: "/etc/nodex/local.crt",
			KeyPath:  "/etc/nodex/local.key",
		},
	}
	m := &Manager{cfg: node}
	m.SetRemoteConfig(&RemoteConfig{
		Protocol:   "vless",
		Port:       8443,
		Network:    "ws",
		TLS:        1,
		CertPath:   "/etc/nodex/fullchain.pem",
		KeyPath:    "/etc/nodex/privkey.pem",
		ServerName: "cdn.example.com",
		WSPath:     "/ray",
		WSHost:     "cdn.example.com",
	})

	list := m.buildPanelInbound(nil)
	if len(list) != 1 {
		t.Fatalf("应生成 1 个入站，实际 %d", len(list))
	}
	inbound := list[0].(map[string]any)
	if inbound["port"] != 8443 {
		t.Errorf("端口应采用面板值 8443，实际 %v", inbound["port"])
	}
	stream := inbound["streamSettings"].(map[string]any)
	if stream["security"] != "tls" {
		t.Errorf("安全层应采用面板 TLS，实际 %v", stream["security"])
	}
	ws, ok := stream["wsSettings"].(map[string]any)
	if !ok {
		t.Fatalf("wsSettings 缺失")
	}
	if ws["path"] != "/ray" {
		t.Errorf("ws path 应为 /ray，实际 %v", ws["path"])
	}
}

