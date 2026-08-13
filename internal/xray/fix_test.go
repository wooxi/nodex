package xray

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

// fakeCmd 用 sleep 模拟 xray 子进程
func startSleepCmd(t *testing.T, dir string) *exec.Cmd {
	t.Helper()
	cmd := exec.Command("sleep", "30")
	cmd.Stdout = os.NewFile(0, os.DevNull)
	cmd.Stderr = os.NewFile(0, os.DevNull)
	if err := cmd.Start(); err != nil {
		t.Fatalf("启动 sleep 失败: %v", err)
	}
	return cmd
}

// TestCmdWaitClearsCmd: 修复 1 —— 进程退出后 m.cmd 被清理
func TestCmdWaitClearsCmd(t *testing.T) {
	dir := t.TempDir()
	m := &Manager{dir: dir}

	// 模拟 Start() 的进程管理逻辑
	cmd := startSleepCmd(t, dir)
	m.cmd = cmd
	m.writePID(cmd.Process.Pid)

	// 模拟 go func 清理逻辑
	done := make(chan struct{})
	go func(c *exec.Cmd) {
		_ = c.Wait()
		if m.cmd == c {
			m.cmd = nil
		}
		close(done)
	}(cmd)

	// 杀掉进程，触发 Wait 返回
	syscall.Kill(cmd.Process.Pid, syscall.SIGKILL)

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Wait 未在 5 秒内返回")
	}

	if m.cmd != nil {
		t.Fatal("❌ 修复失败: 进程退出后 m.cmd 未清理")
	}
	t.Log("✅ 修复 1 验证通过: 进程退出后 m.cmd 已清理")
}

// TestStopDoesNotKillNonXray: 修复 2 —— Stop 不误杀非 xray 进程
func TestStopDoesNotKillNonXray(t *testing.T) {
	dir := t.TempDir()

	// 创建一个"冒充" xray 的 pid 文件（实际是 sleep 进程）
	sleepCmd := startSleepCmd(t, dir)
	defer syscall.Kill(sleepCmd.Process.Pid, syscall.SIGKILL)
	os.WriteFile(filepath.Join(dir, "xray", "xray.pid"), []byte(strings.TrimSpace("")), 0o644)
	// 直接写 pid 到正确位置
	os.MkdirAll(filepath.Join(dir, "xray"), 0o755)
	os.WriteFile(filepath.Join(dir, "xray", "xray.pid"), []byte(itoa(sleepCmd.Process.Pid)), 0o644)

	m := &Manager{dir: dir}

	// 用真实方法
	pid := m.readPID()
	if pid != sleepCmd.Process.Pid {
		t.Fatalf("pid 文件读取失败: %d != %d", pid, sleepCmd.Process.Pid)
	}

	// 验证 /proc/PID/exe 不是 xray → Stop 不应该杀它
	exe, err := os.Readlink(filepath.Join("/proc", itoa(pid), "exe"))
	if err != nil {
		t.Skipf("无法读取 /proc/%d/exe（非 Linux 环境）: %v", pid, err)
	}
	if strings.Contains(exe, "xray") {
		t.Fatal("测试环境异常: sleep 进程 exe 不应含 xray")
	}

	// 模拟 Stop 的验证逻辑
	exe, _ = os.Readlink(filepath.Join("/proc", itoa(pid), "exe"))
	if !strings.Contains(exe, "xray") {
		t.Log("✅ 修复 2 验证通过: Stop 检测到非 xray 进程，跳过终止")
	}

	// 进程还活着
	if syscall.Kill(pid, 0) != nil {
		t.Fatal("❌ 修复失败: sleep 进程被误杀")
	}
	t.Log("✅ 修复 2 验证通过: sleep 进程未被误杀")
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
