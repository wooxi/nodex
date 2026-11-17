package panel

import (
	"testing"

	"github.com/wooxi/nodex/internal/config"
)

// 节点级 token 应覆盖全局面板密钥（xpanel 每节点独立 token）
func TestNodeTokenOverridesGlobal(t *testing.T) {
	global := &config.PanelConfig{URL: "https://panel.example.com", Token: "GLOBAL_TOKEN", NodeID: 1}
	node := &config.Node{NodeID: 7, NodeType: "vless", Token: "NODE_TOKEN"}
	c := NewClientForNode(global, node)
	if c.cfg.Token != "NODE_TOKEN" {
		t.Errorf("节点级 token 未生效，实际 %s", c.cfg.Token)
	}
	if c.cfg.NodeID != 7 {
		t.Errorf("node_id 应为 7，实际 %d", c.cfg.NodeID)
	}

	node2 := &config.Node{NodeID: 8, NodeType: "vless"}
	c2 := NewClientForNode(global, node2)
	if c2.cfg.Token != "GLOBAL_TOKEN" {
		t.Errorf("应回落全局 token，实际 %s", c2.cfg.Token)
	}
}
