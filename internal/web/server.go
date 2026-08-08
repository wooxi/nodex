package web

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/wooxi/nodex/internal/config"
	"github.com/wooxi/nodex/internal/panel"
	"github.com/wooxi/nodex/internal/xray"
)

//go:embed all:dist
var distFS embed.FS

// Server Web 管理服务
type Server struct {
	cfg     *config.Config
	cfgPath string
	xm      *xray.Manager
	hy2     *xray.Hy2Manager
	syncer  *panel.Syncer
	stats   *xray.StatsCollector

	mu       sync.Mutex
	sessions map[string]time.Time
}

func New(cfg *config.Config, cfgPath string, xm *xray.Manager, hy2 *xray.Hy2Manager, syncer *panel.Syncer, stats *xray.StatsCollector) *Server {
	return &Server{
		cfg:      cfg,
		cfgPath:  cfgPath,
		xm:       xm,
		hy2:      hy2,
		syncer:   syncer,
		stats:    stats,
		sessions: map[string]time.Time{},
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// API
	mux.HandleFunc("/api/login", s.handleLogin)
	mux.HandleFunc("/api/logout", s.handleLogout)
	mux.HandleFunc("/api/hy2-auth", s.handleHy2Auth) // hysteria2 认证回调（仅限本机）
	mux.HandleFunc("/api/status", s.auth(s.handleStatus))
	mux.HandleFunc("/api/config", s.auth(s.handleConfig))
	mux.HandleFunc("/api/config/test", s.auth(s.handlePanelTest))
	mux.HandleFunc("/api/action", s.auth(s.handleAction))
	mux.HandleFunc("/api/logs", s.auth(s.handleLogs))
	mux.HandleFunc("/api/users", s.auth(s.handleUsers))
	mux.HandleFunc("/api/generate", s.auth(s.handleGenerate))

	// 前端静态资源
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		log.Fatalf("[nodex] 前端资源缺失: %v", err)
	}
	fileServer := http.FileServer(http.FS(sub))
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		// SPA 路由回退
		p := strings.TrimPrefix(r.URL.Path, "/")
		if _, err := fs.Stat(sub, p); err != nil {
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	}))

	return mux
}

// ---------- 认证 ----------

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("X-Auth-Token")
		if token == "" {
			if c, err := r.Cookie("nodex_token"); err == nil {
				token = c.Value
			}
		}
		s.mu.Lock()
		exp, ok := s.sessions[token]
		if ok && time.Since(exp) > 24*time.Hour {
			delete(s.sessions, token)
			ok = false
		}
		s.mu.Unlock()
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "未登录或登录已过期"})
			return
		}
		next(w, r)
	}
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method"})
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "参数错误"})
		return
	}
	// 首次使用：设置密码
	if s.cfg.Web.Password == "" {
		if len(req.Password) < 6 {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "密码至少 6 位"})
			return
		}
		hash, err := config.HashPassword(req.Password)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "密码加密失败"})
			return
		}
		s.cfg.Web.Password = hash
		s.saveConfig()
	}
	if !config.CheckPassword(s.cfg.Web.Password, req.Password) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "密码错误"})
		return
	}
	token := genToken()
	s.mu.Lock()
	s.sessions[token] = time.Now()
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"token": token})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	token := r.Header.Get("X-Auth-Token")
	s.mu.Lock()
	delete(s.sessions, token)
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---------- API ----------

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"xray": map[string]any{
			"running": s.xm.IsRunning(),
			"version": s.xm.Version(),
			"pid":     s.xm.Pid(),
		},
		"hy2": map[string]any{
			"running": s.hy2.IsRunning(),
			"version": s.hy2.Version(),
			"pid":     s.hy2.Pid(),
		},
		"panel":      s.syncer.Status(),
		"configured": s.cfg.Panel.Enabled,
	})
}

// handleHy2Auth hysteria2 认证回调（hysteria auth.http 模式）
// 请求: {addr, auth, tx}  响应: {ok, id}
// 仅允许本机回环访问
func (s *Server) handleHy2Auth(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.RemoteAddr, "127.0.0.1:") && !strings.HasPrefix(r.RemoteAddr, "[::1]:") {
		writeJSON(w, http.StatusForbidden, map[string]any{"ok": false})
		return
	}
	var req struct {
		Auth string `json:"auth"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false})
		return
	}
	if uid, ok := s.hy2.AuthUser(req.Auth); ok {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": fmt.Sprintf("%d", uid)})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": false})
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, s.cfg)
	case http.MethodPut:
		var newCfg config.Config
		if err := json.NewDecoder(r.Body).Decode(&newCfg); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "配置格式错误"})
			return
		}
		// 密码：空则保留原值；非 bcrypt 明文则加密
		if newCfg.Web.Password == "" {
			newCfg.Web.Password = s.cfg.Web.Password
		} else if !strings.HasPrefix(newCfg.Web.Password, "$2") {
			hash, err := config.HashPassword(newCfg.Web.Password)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "密码加密失败"})
				return
			}
			newCfg.Web.Password = hash
		}
		if err := newCfg.Validate(); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
			return
		}
		newCfg.EnsureDefaults()
		s.cfg = &newCfg
		s.saveConfig()
		s.syncer.UpdateConfig(s.cfg)
		s.xm.UpdateConfig(s.cfg)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "config": s.cfg})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method"})
	}
}

func (s *Server) handlePanelTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method"})
		return
	}
	var req struct {
		URL      string `json:"url"`
		Token    string `json:"token"`
		NodeID   int    `json:"node_id"`
		NodeType string `json:"node_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "参数错误"})
		return
	}
	if req.URL == "" || req.Token == "" || req.NodeID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "请填写面板地址、通信密钥和节点 ID"})
		return
	}
	client := panel.NewClient(&config.PanelConfig{
		URL: req.URL, Token: req.Token, NodeID: req.NodeID, NodeType: req.NodeType,
	})
	msg, err := client.Test(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": msg})
}

func (s *Server) handleAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method"})
		return
	}
	var req struct {
		Action string `json:"action"` // start|stop|restart|sync
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "参数错误"})
		return
	}
	switch req.Action {
	case "start":
		s.syncer.Start()
		if err := s.xm.Start(); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
			return
		}
		if err := s.startHy2(); err != nil {
			log.Printf("[nodex] 启动 hysteria2 失败: %v", err)
		}
		go s.connectStats()
	case "stop":
		s.xm.Stop()
		s.hy2.Stop()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	case "restart":
		s.syncer.Start()
		if err := s.xm.Restart(); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
			return
		}
		s.hy2.Stop()
		if err := s.startHy2(); err != nil {
			log.Printf("[nodex] 启动 hysteria2 失败: %v", err)
		}
		s.stats.Reset()
		s.syncer.ResetHy2()
		go s.connectStats()
	case "sync":
		go func() {
			s.syncer.Start()
			s.xm.Restart()
			s.hy2.Stop()
			s.startHy2()
			s.stats.Reset()
			s.syncer.ResetHy2()
		}()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "已触发同步并重启节点"})
		return
	default:
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "未知操作"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// startHy2 启动 hysteria2（需要 hysteria 二进制 + 证书）
func (s *Server) startHy2() error {
	// 本地模式：注入本地用户
	if !s.cfg.Panel.Enabled && s.cfg.Node.UUID != "" {
		s.hy2.SetUsers([]xray.User{{ID: 1, UUID: s.cfg.Node.UUID}})
	}
	return s.hy2.Start(s.hy2AuthURL(), s.syncer.Hy2Secret())
}

// hy2AuthURL hysteria 认证回调地址
func (s *Server) hy2AuthURL() string {
	return fmt.Sprintf("http://127.0.0.1:%d/api/hy2-auth", s.cfg.Web.Port)
}

// connectStats 连接 xray 的 gRPC stats API（带重试，等待 xray 就绪）
func (s *Server) connectStats() {
	for i := 0; i < 15; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		err := s.stats.Connect(ctx, "127.0.0.1:10085")
		cancel()
		if err == nil {
			log.Printf("[nodex] 已连接 xray API")
			return
		}
		time.Sleep(2 * time.Second)
	}
	log.Printf("[nodex] 连接 xray API 失败（15 次重试后放弃）")
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	path := s.cfg.XrayErrorLogPath()
	if r.URL.Query().Get("type") == "access" {
		path = s.cfg.XrayLogPath()
	}
	data, err := os.ReadFile(path)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"logs": ""})
		return
	}
	lines := strings.Split(string(data), "\n")
	if len(lines) > 200 {
		lines = lines[len(lines)-200:]
	}
	writeJSON(w, http.StatusOK, map[string]any{"logs": strings.Join(lines, "\n")})
}

func (s *Server) handleUsers(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	traffic, err := s.stats.GetTraffic(ctx)
	if err != nil {
		log.Printf("[nodex] xray stats: %v", err)
		traffic = map[int64]xray.Traffic{}
	}
	log.Printf("[nodex] xray stats 返回 %d 个用户", len(traffic))
	// 合并 hysteria2 流量
	hy2t, err := s.hy2.FetchTraffic(ctx, s.syncer.Hy2Secret())
	if err != nil {
		log.Printf("[nodex] hy2 traffic: %v", err)
	}
	for uid, t := range hy2t {
		if v, ok := traffic[uid]; ok {
			v.Up += t.Up
			v.Down += t.Down
			traffic[uid] = v
		} else {
			traffic[uid] = t
		}
	}
	alive := s.syncer.AliveUsers()
	type userInfo struct {
		UID     int64  `json:"uid"`
		Up      int64  `json:"up"`
		Down    int64  `json:"down"`
		Traffic int64  `json:"traffic"`
		IPs     []string `json:"ips"`
	}
	out := []userInfo{}
	for uid, v := range traffic {
		ips := alive[uid]
		out = append(out, userInfo{UID: uid, Up: v.Up, Down: v.Down, Traffic: v.Up + v.Down, IPs: ips})
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

func (s *Server) handleGenerate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method"})
		return
	}
	var req struct {
		Type string `json:"type"` // uuid|password|hex|reality
		Len  int    `json:"len"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "参数错误"})
		return
	}
	switch req.Type {
	case "uuid":
		writeJSON(w, http.StatusOK, map[string]any{"value": config.GenUUID()})
	case "password", "hex":
		n := req.Len
		if n <= 0 {
			n = 16
		}
		writeJSON(w, http.StatusOK, map[string]any{"value": config.GenHex(n)})
	case "reality":
		priv, pub, sid, err := xray.GenRealityKeys()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"privateKey": priv, "publicKey": pub, "shortId": sid})
	default:
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "未知类型"})
	}
}

// ---------- 工具 ----------

func (s *Server) saveConfig() {
	if err := s.cfg.Save(s.cfgPath); err != nil {
		log.Printf("[nodex] 保存配置失败: %v", err)
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func genToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}
