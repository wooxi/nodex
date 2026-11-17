package xray

import (
	"strings"
	"testing"

	"github.com/wooxi/nodex/internal/config"
)

func newHy2TestManager(obfs, obfsPass string) *Hy2Manager {
	node := &config.Node{
		ID:       "t1",
		NodeType: "hysteria",
		Node: config.NodeConfig{
			Protocol: "hysteria2",
			Hy2: config.Hy2{
				Port:         2026,
				Obfs:         obfs,
				ObfsPassword: obfsPass,
				UpMbps:       100,
				DownMbps:     100,
			},
		},
	}
	global := &config.Config{
		System: config.SystemConfig{
			CertPath: "/etc/nodex/hy2.crt",
			KeyPath:  "/etc/nodex/hy2.key",
		},
	}
	node.Node.Hy2.CertPath = ""
	return NewHy2Manager(node, global, "/tmp/nodex-test", 8444)
}

// 开启 salamander 混淆时必须生成 obfs 段（否则客户端套混淆层、服务端按裸 QUIC 解，必然握手失败）
func TestHy2BuildConfigWithObfs(t *testing.T) {
	m := newHy2TestManager("salamander", "deadbeef12345678")
	conf, err := m.BuildConfig("http://127.0.0.1:8888/api/hy2-auth", "secret")
	if err != nil {
		t.Fatalf("BuildConfig 失败: %v", err)
	}
	if !strings.Contains(conf, "obfs:") {
		t.Fatalf("缺少 obfs 段:\n%s", conf)
	}
	if !strings.Contains(conf, "type: salamander") {
		t.Errorf("obfs type 错误:\n%s", conf)
	}
	if !strings.Contains(conf, "password: deadbeef12345678") {
		t.Errorf("obfs 密码缺失:\n%s", conf)
	}
	if !strings.Contains(conf, "listen: 0.0.0.0:2026") {
		t.Errorf("监听端口错误:\n%s", conf)
	}
}

// 关闭混淆（空值或 none）时不能生成 obfs 段
func TestHy2BuildConfigWithoutObfs(t *testing.T) {
	for _, obfs := range []string{"", "none"} {
		m := newHy2TestManager(obfs, "")
		conf, err := m.BuildConfig("http://127.0.0.1:8888/api/hy2-auth", "secret")
		if err != nil {
			t.Fatalf("BuildConfig 失败: %v", err)
		}
		if strings.Contains(conf, "obfs:") {
			t.Errorf("obfs=%q 时不应生成 obfs 段:\n%s", obfs, conf)
		}
	}
}
