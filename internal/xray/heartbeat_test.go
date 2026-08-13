package xray

import (
	"encoding/json"
	"testing"

	"github.com/wooxi/nodex/internal/config"
)

// TestBuildOutboundsHeartbeat 验证转发出站 wsSettings 包含 heartbeatPeriod
func TestBuildOutboundsHeartbeat(t *testing.T) {
	m := &Manager{
		cfg: &config.Node{
			Forward: config.Forward{
				Enabled:     true,
				UUID:        "d71b49e6-3fcc-4f2c-86bb-4a0c9135ae1b",
				ServerName:  "chongya.ccwu.cc",
				WSPath:      "/",
				WSHost:      "chongya.ccwu.cc",
				Fingerprint: "chrome",
				HeartbeatPeriod: 15,
				Targets: []config.ForwardTarget{
					{Address: "104.26.15.81", Port: 443},
				},
			},
		},
	}

	outs := m.buildOutbounds()
	if len(outs) < 2 {
		t.Fatalf("期望至少 2 个出站（forward + direct），实际 %d", len(outs))
	}

	forward := outs[0].(map[string]any)
	ss := forward["streamSettings"].(map[string]any)
	ws := ss["wsSettings"].(map[string]any)

	hb, ok := ws["heartbeatPeriod"]
	if !ok {
		t.Fatal("❌ wsSettings 缺少 heartbeatPeriod 字段")
	}
	if hb != 15 {
		t.Fatalf("❌ heartbeatPeriod 期望 15，实际 %v", hb)
	}
	t.Logf("✅ heartbeatPeriod = %v 已生成", hb)

	// 顺带验证 UUID 和 serverName 正确
	settings := forward["settings"].(map[string]any)
	vnext := settings["vnext"].([]any)[0].(map[string]any)
	users := vnext["users"].([]any)[0].(map[string]any)
	if users["id"] != "d71b49e6-3fcc-4f2c-86bb-4a0c9135ae1b" {
		t.Fatalf("❌ 出站 UUID 错误: %v", users["id"])
	}
	t.Logf("✅ 出站 UUID = %v", users["id"])
}

// TestBuildOutboundsHeartbeatDefault 验证未设置 heartbeat 时默认 15
func TestBuildOutboundsHeartbeatDefault(t *testing.T) {
	m := &Manager{
		cfg: &config.Node{
			Forward: config.Forward{
				Enabled:     true,
				UUID:        "test",
				ServerName:  "x.com",
				Targets:     []config.ForwardTarget{{Address: "1.1.1.1", Port: 443}},
				HeartbeatPeriod: 0, // 未设置
			},
		},
	}
	outs := m.buildOutbounds()
	forward := outs[0].(map[string]any)
	ss := forward["streamSettings"].(map[string]any)
	ws := ss["wsSettings"].(map[string]any)
	hb := ws["heartbeatPeriod"]
	if hb != 15 {
		t.Fatalf("❌ 默认 heartbeatPeriod 期望 15，实际 %v", hb)
	}
	t.Logf("✅ 默认 heartbeatPeriod = %v", hb)

	// 打印完整 outbound 供人工核对
	b, _ := json.MarshalIndent(forward, "", "  ")
	t.Logf("完整出站配置:\n%s", string(b))
}
