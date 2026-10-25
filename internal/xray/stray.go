package xray

import (
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// reapStrays 清理以同一配置文件启动的残留内核进程。
//
// nodex 被 SIGKILL、被 init 脚本直接替换二进制、或容器重建时，它拉起的 xray /
// hysteria 子进程会变成孤儿并继续占着端口。而 Start 里基于 pid 文件的清理只能
// 识别 pid 文件记录的那一个 PID，孤儿不在记录里就清不掉，于是新实例绑定端口失败、
// watchdog 每 10 秒重试一次，形成"检测到未运行 → 自动拉起 → 立即退出"的死循环。
//
// 这里按 /proc 实际命令行匹配（marker + 本节点的配置路径），不依赖 pid 文件。
func reapStrays(confPath, marker string) {
	if confPath == "" || marker == "" {
		return
	}
	self := os.Getpid()
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return
	}
	var pids []int
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil || pid == self {
			continue
		}
		raw, err := os.ReadFile("/proc/" + e.Name() + "/cmdline")
		if err != nil {
			continue
		}
		cmdline := strings.ReplaceAll(string(raw), "\x00", " ")
		if strings.Contains(cmdline, marker) && strings.Contains(cmdline, confPath) {
			pids = append(pids, pid)
		}
	}
	if len(pids) == 0 {
		return
	}
	for _, p := range pids {
		_ = syscall.Kill(p, syscall.SIGTERM)
	}
	time.Sleep(400 * time.Millisecond)
	for _, p := range pids {
		_ = syscall.Kill(p, syscall.SIGKILL)
	}
}
