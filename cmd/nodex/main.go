package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/wooxi/nodex/internal/config"
	"github.com/wooxi/nodex/internal/panel"
	"github.com/wooxi/nodex/internal/web"
	"github.com/wooxi/nodex/internal/xray"
)

var version = "0.1.0"

func main() {
	var (
		cfgPath = flag.String("config", "", "配置文件路径（默认 /etc/nodex/config.json）")
		showVer = flag.Bool("version", false, "显示版本")
	)
	flag.Parse()

	if *showVer {
		fmt.Printf("nodex %s\n", version)
		return
	}

	if *cfgPath == "" {
		*cfgPath = config.DefaultConfigPath
	}

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Fatalf("[nodex] 加载配置失败: %v", err)
	}

	// 确保数据目录存在
	if err := os.MkdirAll(cfg.DataDir(), 0o755); err != nil {
		log.Fatalf("[nodex] 创建数据目录失败: %v", err)
	}

	xm := xray.NewManager(cfg)
	hy2 := xray.NewHy2Manager(cfg)
	stats := xray.NewStatsCollector()
	syncer := panel.NewSyncer(cfg, xm, hy2, stats)

	// OpenWrt init 脚本调用 start 时启动节点
	if len(os.Args) > 1 && os.Args[1] == "start" {
		syncer.Start()
		if err := xm.Start(); err != nil {
			log.Printf("[nodex] 启动 xray 失败: %v", err)
		}
		if err := hy2.Start(fmt.Sprintf("http://127.0.0.1:%d/api/hy2-auth", cfg.Web.Port), syncer.Hy2Secret()); err != nil {
			log.Printf("[nodex] 启动 hysteria2 失败: %v", err)
		}
		time.Sleep(1 * time.Second)
		connectStats(stats)
	}
	if len(os.Args) > 1 && os.Args[1] == "stop" {
		xm.Stop()
		hy2.Stop()
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "restart" {
		xm.Restart()
		hy2.Stop()
		if err := hy2.Start(fmt.Sprintf("http://127.0.0.1:%d/api/hy2-auth", cfg.Web.Port), syncer.Hy2Secret()); err != nil {
			log.Printf("[nodex] 启动 hysteria2 失败: %v", err)
		}
		return
	}

	srv := web.New(cfg, *cfgPath, xm, hy2, syncer, stats)
	addr := fmt.Sprintf("0.0.0.0:%d", cfg.Web.Port)
	log.Printf("[nodex] NodeX v%s Web 管理界面: http://%s", version, addr)
	if err := http.ListenAndServe(addr, srv.Handler()); err != nil {
		log.Fatalf("[nodex] Web 服务启动失败: %v", err)
	}
}

func connectStats(stats *xray.StatsCollector) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := stats.Connect(ctx, "127.0.0.1:10085"); err != nil {
		log.Printf("[nodex] 连接 xray API 失败: %v", err)
	}
}
