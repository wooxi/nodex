package panel

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/mem"

	"github.com/wooxi/nodex/internal/config"
	"github.com/wooxi/nodex/internal/xray"
)

// Syncer 面板同步器：定时拉配置/用户，推送流量/心跳/状态
// 流量来源：xray gRPC stats + hysteria2 /traffic API，合并后按 Xboard 格式推送
//   push 格式: {uid: [upload, download]}
type Syncer struct {
	cfg       *config.Config
	panel     *Client
	xm        *xray.Manager
	hy2       *xray.Hy2Manager
	stats     *xray.StatsCollector
	accessLog *AccessLog

	hy2Last map[int64]xray.Traffic // hysteria2 流量快照

	lastFingerprint string // 最近应用的配置指纹

	mu       sync.Mutex
	running  bool
	stopCh   chan struct{}
	lastSync time.Time
	lastErr  string
}

func NewSyncer(cfg *config.Config, xm *xray.Manager, hy2 *xray.Hy2Manager, stats *xray.StatsCollector) *Syncer {
	return &Syncer{
		cfg:       cfg,
		panel:     NewClient(&cfg.Panel),
		xm:        xm,
		hy2:       hy2,
		stats:     stats,
		accessLog: NewAccessLog(cfg),
		hy2Last:   map[int64]xray.Traffic{},
	}
}

func (s *Syncer) UpdateConfig(cfg *config.Config) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg = cfg
	s.panel = NewClient(&cfg.Panel)
	s.accessLog.UpdateConfig(cfg)
	s.xm.UpdateConfig(cfg)
	s.hy2.UpdateConfig(cfg)
}

// Start 启动后台同步循环
func (s *Syncer) Start() {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.stopCh = make(chan struct{})
	ch := s.stopCh
	s.mu.Unlock()

	go func() {
		log.Println("[nodex] 同步器已启动")
		// 启动即立即同步一次
		s.syncOnce()
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ch:
				log.Println("[nodex] 同步器已停止")
				return
			case <-ticker.C:
				s.syncOnce()
			}
		}
	}()
}

func (s *Syncer) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.running {
		return
	}
	s.running = false
	close(s.stopCh)
}

// Status 同步器状态
func (s *Syncer) Status() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return map[string]any{
		"running":  s.running,
		"lastSync": s.lastSync.Format("2006-01-02 15:04:05"),
		"lastError": s.lastErr,
	}
}

// syncOnce 执行一轮完整同步
func (s *Syncer) syncOnce() {
	s.mu.Lock()
	cfg := s.cfg
	s.mu.Unlock()

	if !cfg.Panel.Enabled {
		return
	}

	ctx := context.Background()

	// 1. 拉取节点配置（端口/网络/TLS 等，本地覆盖为辅）
	remote, err := s.panel.FetchConfig(ctx)
	if err != nil {
		s.setErr("拉取节点配置失败: " + err.Error())
		return
	}
	// 解析 ws/grpc 传输参数并注入 xray
	remoteCfg := &xray.RemoteConfig{
		Protocol: remote.Protocol,
		Port:     remote.ServerPort,
		Network:  remote.Network,
		TLS:      remote.TLS,
		Flow:     remote.Flow,
		Cipher:   remote.Cipher,
	}
	if len(remote.NetworkSettings) > 0 {
		var ns struct {
			Path string `json:"path"`
			Host string `json:"host"`
		}
		if err := json.Unmarshal(remote.NetworkSettings, &ns); err == nil {
			remoteCfg.WSPath = ns.Path
			remoteCfg.WSHost = ns.Host
		}
	}
	s.xm.SetRemoteConfig(remoteCfg)
	// 2. 拉取用户列表并注入 xray 与 hysteria2
	users, err := s.panel.FetchUsers(ctx)
	if err != nil {
		s.setErr("拉取用户列表失败: " + err.Error())
		return
	}
	s.xm.SetUsers(users)
	s.hy2.SetUsers(users)
	s.accessLog.SetUsers(users)
	if len(users) == 0 {
		s.setErr("面板返回的用户列表为空（节点未关联任何用户组）")
		return
	}

	// 3. 若面板指定了协议且本地未显式覆盖，采用面板协议
	if remote.Protocol != "" && cfg.Panel.NodeType == "" {
		cfg.Panel.NodeType = remote.Protocol
		s.xm.UpdateConfig(cfg)
	}

	// 3.5 配置指纹变化时重启 xray（使 remote/users 生效）
	fingerprint := fmt.Sprintf("%s|%d|%s|%d|%v",
		remoteCfg.Protocol, remoteCfg.Port, remoteCfg.Network, remoteCfg.TLS, users)
	if fingerprint != s.lastFingerprint {
		s.lastFingerprint = fingerprint
		if err := s.xm.Restart(); err != nil {
			s.setErr("重启 xray 应用配置失败: " + err.Error())
			return
		}
		s.stats.Reset()
		s.ResetHy2()
		log.Printf("[nodex] 面板配置已应用（端口=%d 网络=%s 用户=%d）", remoteCfg.Port, remoteCfg.Network, len(users))
	}

	// 4. 推送流量增量（xray + hysteria2 合并）
	diffs := map[int64]xray.Traffic{}
	xdiff, err := s.stats.SnapshotAndDiff(ctx)
	if err != nil {
		s.setErr("读取 xray 流量统计失败: " + err.Error())
		return
	}
	for uid, d := range xdiff {
		diffs[uid] = d
	}
	hdiff, err := s.hy2.SnapshotAndDiff(ctx, s.hy2Secret(), &s.hy2Last)
	if err == nil {
		for uid, d := range hdiff {
			if v, ok := diffs[uid]; ok {
				v.Up += d.Up
				v.Down += d.Down
				diffs[uid] = v
			} else {
				diffs[uid] = d
			}
		}
	}
	if len(diffs) > 0 {
		// 转成 Xboard push 格式 {uid: [upload, download]}
		payload := map[int64][2]int64{}
		for uid, d := range diffs {
			payload[uid] = [2]int64{d.Up, d.Down}
		}
		if err := s.panel.PushTraffic(ctx, payload); err != nil {
			s.setErr("推送流量失败: " + err.Error())
			return
		}
	}

	// 5. 推送在线设备
	if alive := s.accessLog.AliveIPs(3 * time.Minute); len(alive) > 0 {
		if err := s.panel.PushAlive(ctx, alive); err != nil {
			s.setErr("推送在线设备失败: " + err.Error())
			return
		}
	}

	// 6. 推送服务器状态
	if status := s.collectStatus(); status != nil {
		if err := s.panel.PushStatus(ctx, status); err != nil {
			// 状态推送失败不影响主流程
			log.Printf("[nodex] 状态推送失败: %v", err)
		}
	}

	s.mu.Lock()
	s.lastSync = time.Now()
	s.lastErr = ""
	s.mu.Unlock()
	log.Printf("[nodex] 同步完成：用户 %d 个", len(users))
}

func (s *Syncer) setErr(msg string) {
	s.mu.Lock()
	s.lastErr = msg
	s.lastSync = time.Now()
	s.mu.Unlock()
	log.Printf("[nodex] %s", msg)
}

// collectStatus 收集系统状态（Xboard /status 协议）
func (s *Syncer) collectStatus() map[string]any {
	vm, err := mem.VirtualMemory()
	if err != nil {
		return nil
	}
	cp, err := cpu.Percent(0, false)
	if err != nil || len(cp) == 0 {
		cp = []float64{0}
	}
	du, err := disk.Usage("/")
	if err != nil {
		return nil
	}
	sw, _ := mem.SwapMemory()
	if sw == nil {
		sw = &mem.SwapMemoryStat{}
	}
	return map[string]any{
		"cpu": int(cp[0]),
		"mem": map[string]any{
			"total": int(vm.Total),
			"used":  int(vm.Used),
		},
		"swap": map[string]any{
			"total": int(sw.Total),
			"used":  int(sw.Used),
		},
		"disk": map[string]any{
			"total": int(du.Total),
			"used":  int(du.Used),
		},
	}
}

// AliveUsers 返回最近活跃的 uid -> ip 列表（供 Web UI 展示）
func (s *Syncer) AliveUsers() map[int64][]string {
	return s.accessLog.AliveIPs(10 * time.Minute)
}

// Hy2Secret 公开 hysteria traffic API 密钥（供 web 层启动 hy2 用）
func (s *Syncer) Hy2Secret() string {
	return s.hy2Secret()
}

// ResetHy2 清空 hysteria2 流量快照（hy2 重启后调用）
func (s *Syncer) ResetHy2() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.hy2Last = map[int64]xray.Traffic{}
}

// hy2Secret 生成稳定的 hysteria traffic API 密钥（从配置派生，重启不变）
func (s *Syncer) hy2Secret() string {
	h := sha256.Sum256([]byte("nodex-hy2:" + s.cfg.System.DataDir + ":" + s.cfg.Web.Password))
	return hex.EncodeToString(h[:16])
}

// AccessLog 解析 xray access log 提取在线设备（uid -> IP 集合）
type AccessLog struct {
	mu      sync.Mutex
	path    string
	offsets map[int64]int64 // uid -> 上次解析到的文件偏移
	alive   map[int64]map[string]time.Time // uid -> ip -> 最后活跃时间
	users   map[int64]string               // uid -> uuid
}

func NewAccessLog(cfg *config.Config) *AccessLog {
	return &AccessLog{
		path:    cfg.XrayLogPath(),
		offsets: map[int64]int64{},
		alive:   map[int64]map[string]time.Time{},
		users:   map[int64]string{},
	}
}

func (a *AccessLog) UpdateConfig(cfg *config.Config) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.path = cfg.XrayLogPath()
}

func (a *AccessLog) SetUsers(users []xray.User) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.users = map[int64]string{}
	for _, u := range users {
		a.users[u.ID] = u.UUID
	}
}

// Parse 增量解析 access log（每次只读新增部分）
func (a *AccessLog) Parse() {
	a.mu.Lock()
	defer a.mu.Unlock()

	f, err := os.Open(a.path)
	if err != nil {
		return
	}
	defer f.Close()

	// 从上次偏移继续读
	off := a.offsets[0]
	if st, err := f.Stat(); err == nil && st.Size() < off {
		off = 0 // 日志被轮转/截断
	}
	if _, err := f.Seek(off, 0); err != nil {
		return
	}
	buf := make([]byte, 64*1024)
	n, err := f.Read(buf)
	if err != nil && n == 0 {
		return
	}
	a.offsets[0] = off + int64(n)

	now := time.Now()
	for _, line := range strings.Split(string(buf[:n]), "\n") {
		// 格式: 2026/08/08 12:00:00 from 1.2.3.4:5555 accepted tcp:xxx:443 [email@...]
		if !strings.Contains(line, "from ") || !strings.Contains(line, "accepted ") {
			continue
		}
		parts := strings.Fields(line)
		// 找 from 后的 IP
		var ip string
		for i, p := range parts {
			if p == "from" && i+1 < len(parts) {
				ip = strings.Split(parts[i+1], ":")[0]
				break
			}
		}
		// 找 email
		uid := a.findUID(line)
		if ip == "" || uid == 0 {
			continue
		}
		if a.alive[uid] == nil {
			a.alive[uid] = map[string]time.Time{}
		}
		a.alive[uid][ip] = now
	}
}

// findUID 从日志行提取 uid（[uid@nodex]）
func (a *AccessLog) findUID(line string) int64 {
	idx := strings.Index(line, "[")
	if idx < 0 {
		return 0
	}
	end := strings.Index(line[idx:], "]")
	if end < 0 {
		return 0
	}
	email := line[idx+1 : idx+end]
	if uid, ok := xray.ParseEmail(email); ok {
		return uid
	}
	// 兼容面板直发的 email（如 uuid@uuid）
	for uid, uuid := range a.users {
		if strings.Contains(email, uuid) {
			return uid
		}
	}
	return 0
}

// AliveIPs 返回最近 window 内活跃的 uid -> ip 列表
func (a *AccessLog) AliveIPs(window time.Duration) map[int64][]string {
	a.Parse()
	a.mu.Lock()
	defer a.mu.Unlock()

	cutoff := time.Now().Add(-window)
	out := map[int64][]string{}
	for uid, ips := range a.alive {
		var list []string
		for ip, t := range ips {
			if t.After(cutoff) {
				list = append(list, ip)
			}
		}
		if len(list) > 0 {
			out[uid] = list
		}
	}
	return out
}
