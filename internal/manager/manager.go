package manager

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wooxi/nodex/internal/config"
	"github.com/wooxi/nodex/internal/panel"
	"github.com/wooxi/nodex/internal/xray"
)

// Runtime 单个节点的运行时（xray + hysteria2 + 同步器 + stats）
type Runtime struct {
	Cfg    *config.Node
	Index  int
	Dir    string
	Xray   *xray.Manager
	Hy2    *xray.Hy2Manager
	Stats  *xray.StatsCollector
	Syncer *panel.Syncer
}

// Manager 多节点管理器
type Manager struct {
	global *config.Config
	cfgPath string
	mu      sync.Mutex
	nodes   map[string]*Runtime
	// 节点顺序（按配置顺序）
	order []string
}

func New(global *config.Config, cfgPath string) *Manager {
	return &Manager{
		global:  global,
		cfgPath: cfgPath,
		nodes:   map[string]*Runtime{},
	}
}

// Rebuild 按配置重建全部节点运行时（保留已运行状态则调用方先 Stop）
func (m *Manager) Rebuild(cfg *config.Config) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.global = cfg
	m.nodes = map[string]*Runtime{}
	m.order = nil
	for i, n := range cfg.Nodes {
		dir := cfg.NodeDataDir(n)
		apiPort := cfg.System.APIPortBase + i
		hy2Port := cfg.System.Hy2APIPortBase + i
		xm := xray.NewManager(n, cfg, dir, apiPort)
		hy2 := xray.NewHy2Manager(n, cfg, dir, hy2Port)
		stats := xray.NewStatsCollector()
		syncer := panel.NewSyncer(n, cfg, dir, xm, hy2, stats)
		rt := &Runtime{
			Cfg: n, Index: i, Dir: dir,
			Xray: xm, Hy2: hy2, Stats: stats, Syncer: syncer,
		}
		m.nodes[n.ID] = rt
		m.order = append(m.order, n.ID)
	}
}

// Runtimes 按配置顺序返回节点运行时
func (m *Manager) Runtimes() []*Runtime {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*Runtime, 0, len(m.order))
	for _, id := range m.order {
		if rt, ok := m.nodes[id]; ok {
			out = append(out, rt)
		}
	}
	return out
}

func (m *Manager) Get(id string) *Runtime {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.nodes[id]
}

// StartAll 启动所有启用节点
func (m *Manager) StartAll() {
	for _, rt := range m.Runtimes() {
		if !rt.Cfg.Enabled {
			continue
		}
		m.startOne(rt)
	}
}

// startOne 启动单个节点的全部组件
func (m *Manager) startOne(rt *Runtime) {
	// 注入认证信息
	rt.Hy2.SetAuth(fmt.Sprintf("http://127.0.0.1:%d/api/hy2-auth?node=%s", m.global.Web.Port, rt.Cfg.ID), rt.Syncer.Hy2Secret())
	// 本地模式（面板未启用）注入本地用户
	if !m.global.Panel.Enabled && rt.Cfg.Node.UUID != "" {
		rt.Xray.SetUsers([]xray.User{{ID: 1, UUID: rt.Cfg.Node.UUID}})
		rt.Hy2.SetUsers([]xray.User{{ID: 1, UUID: rt.Cfg.Node.UUID}})
	}
	rt.Syncer.Start()
	if err := rt.Xray.Start(); err != nil {
		log.Printf("[nodex][%s] 启动 xray 失败: %v", rt.Cfg.ID, err)
	} else {
		go m.connectStats(rt)
	}
	if err := rt.Hy2.Start(); err != nil {
		log.Printf("[nodex][%s] 启动 hysteria2 失败: %v", rt.Cfg.ID, err)
	}
}

// StopAll 停止所有节点
func (m *Manager) StopAll() {
	for _, rt := range m.Runtimes() {
		m.Stop(rt.Cfg.ID)
	}
}

// Stop 停止单个节点
func (m *Manager) Stop(id string) {
	rt := m.Get(id)
	if rt == nil {
		return
	}
	rt.Syncer.Stop()
	rt.Xray.Stop()
	rt.Hy2.Stop()
	rt.Stats.Close()
}

// Restart 重启单个节点
func (m *Manager) Restart(id string) {
	m.Stop(id)
	time.Sleep(300 * time.Millisecond)
	if rt := m.Get(id); rt != nil && rt.Cfg.Enabled {
		m.startOne(rt)
	}
}

// SyncAll 触发全节点同步（面板配置变更后）
func (m *Manager) SyncAll() {
	for _, rt := range m.Runtimes() {
		rt.Syncer.Start()
	}
}

// connectStats 连接节点 xray API（带重试）
func (m *Manager) connectStats(rt *Runtime) {
	apiPort := m.global.System.APIPortBase + rt.Index
	for i := 0; i < 15; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		err := rt.Stats.Connect(ctx, fmt.Sprintf("127.0.0.1:%d", apiPort))
		cancel()
		if err == nil {
			log.Printf("[nodex][%s] 已连接 xray API", rt.Cfg.ID)
			return
		}
		time.Sleep(2 * time.Second)
	}
	log.Printf("[nodex][%s] 连接 xray API 失败（15 次重试后放弃）", rt.Cfg.ID)
}

// Status 返回全部节点状态
func (m *Manager) Status() []map[string]any {
	out := []map[string]any{}
	for _, rt := range m.Runtimes() {
		out = append(out, rt.Status())
	}
	return out
}

// Status 单节点状态
func (rt *Runtime) Status() map[string]any {
	return map[string]any{
		"id":       rt.Cfg.ID,
		"name":     rt.Cfg.Name,
		"enabled":  rt.Cfg.Enabled,
		"protocol": rt.Cfg.Node.Protocol,
		"xray": map[string]any{
			"running": rt.Xray.IsRunning(),
			"version": rt.Xray.Version(),
			"pid":     rt.Xray.Pid(),
		},
		"hy2": map[string]any{
			"running": rt.Hy2.IsRunning(),
			"version": rt.Hy2.Version(),
			"pid":     rt.Hy2.Pid(),
		},
		"panel": rt.Syncer.Status(),
	}
}

// CoreInfo 核心二进制信息（版本 + 安装状态）
func (m *Manager) CoreInfo(kind string) map[string]any {
	path := m.global.System.XrayPath
	if kind == "hysteria" {
		path = m.global.System.HysteriaPath
	}
	installed := false
	if _, err := os.Stat(path); err == nil {
		installed = true
	}
	ver := ""
	if installed {
		if kind == "xray" {
			out, err := exec.Command(path, "version").Output()
			if err == nil {
				ver = strings.SplitN(string(out), "\n", 2)[0]
			}
		} else {
			out, err := exec.Command(path, "version").Output()
			if err == nil {
				for _, line := range strings.Split(string(out), "\n") {
					if strings.Contains(line, "Version") {
						ver = strings.TrimSpace(line)
						break
					}
				}
			}
		}
	}
	return map[string]any{
		"installed": installed,
		"version":   ver,
		"path":      path,
	}
}

// UpdateCore 下载并更新核心二进制（nodex release 统一托管）
func (m *Manager) UpdateCore(kind string) (string, error) {
	if kind != "xray" && kind != "hysteria" {
		return "", fmt.Errorf("未知核心类型: %s", kind)
	}
	// 停止全部节点（核心文件在被使用）
	m.StopAll()
	defer func() {
		m.StartAll()
	}()

	url := fmt.Sprintf("https://github.com/wooxi/nodex/releases/latest/download/%s-linux-amd64", kind)
	tmp := filepath.Join(os.TempDir(), "nodex-core-"+kind)
	resp, err := http.Get(url)
	if err != nil {
		return "", fmt.Errorf("下载失败: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下载失败: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 100<<20))
	if err != nil {
		return "", fmt.Errorf("读取下载内容失败: %v", err)
	}
	if len(data) < 4 || string(data[:4]) == "404 " || string(data[:9]) == "Not Found" {
		return "", fmt.Errorf("下载内容无效（可能版本不存在）")
	}
	// ELF 校验
	if len(data) < 4 || data[0] != 0x7f || data[1] != 'E' || data[2] != 'L' || data[3] != 'F' {
		return "", fmt.Errorf("下载内容不是有效的可执行文件")
	}
	if err := os.WriteFile(tmp, data, 0o755); err != nil {
		return "", fmt.Errorf("写入失败: %v", err)
	}
	path := m.global.System.XrayPath
	if kind == "hysteria" {
		path = m.global.System.HysteriaPath
	}
	if err := os.Rename(tmp, path); err != nil {
		return "", fmt.Errorf("替换失败: %v", err)
	}
	os.Chmod(path, 0o755)
	info := m.CoreInfo(kind)
	return info["version"].(string), nil
}

// Users 单节点用户流量（xray + hy2 合并）
func (rt *Runtime) Users(ctx context.Context) []map[string]any {
	traffic, err := rt.Stats.GetTraffic(ctx)
	if err != nil {
		log.Printf("[nodex][%s] xray stats: %v", rt.Cfg.ID, err)
		traffic = map[int64]xray.Traffic{}
	}
	hy2t, err := rt.Hy2.FetchTraffic(ctx)
	if err == nil {
		for uid, t := range hy2t {
			if v, ok := traffic[uid]; ok {
				v.Up += t.Up
				v.Down += t.Down
				traffic[uid] = v
			} else {
				traffic[uid] = t
			}
		}
	}
	alive := rt.Syncer.AliveUsers()
	out := []map[string]any{}
	for uid, v := range traffic {
		out = append(out, map[string]any{
			"uid": uid, "up": v.Up, "down": v.Down, "traffic": v.Up + v.Down,
			"ips": alive[uid],
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i]["traffic"].(int64) > out[j]["traffic"].(int64)
	})
	return out
}

// ResetStats 重置节点流量快照
func (rt *Runtime) ResetStats() {
	rt.Stats.Reset()
	rt.Syncer.ResetHy2()
}
