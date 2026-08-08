<template>
  <div>
    <div class="card">
      <div class="card-title"><el-icon><Tools /></el-icon>系统设置</div>
      <el-form :model="form" label-width="140px" style="max-width:640px">
        <el-form-item label="Web 管理端口">
          <el-input-number v-model="form.web.port" :min="1" :max="65535" />
          <span class="tip">修改后需重启 nodex 服务生效</span>
        </el-form-item>
        <el-form-item label="xray 路径">
          <el-input v-model="form.system.xray_path" placeholder="/usr/bin/xray" style="width:320px" />
        </el-form-item>
        <el-form-item label="日志级别">
          <el-select v-model="form.system.log_level" style="width:200px">
            <el-option label="debug" value="debug" />
            <el-option label="info" value="info" />
            <el-option label="warning" value="warning" />
            <el-option label="error" value="error" />
          </el-select>
        </el-form-item>
        <el-form-item label="数据目录">
          <el-input v-model="form.system.data_dir" placeholder="/etc/nodex" style="width:320px" disabled />
          <span class="tip">配置文件与日志存放位置</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="card">
      <div class="card-title"><el-icon><Lock /></el-icon>修改管理密码</div>
      <el-form label-width="140px" style="max-width:640px" @submit.prevent>
        <el-form-item label="新密码" required>
          <el-input v-model="newPwd" type="password" show-password style="width:320px" />
        </el-form-item>
        <el-form-item>
          <el-button type="warning" :loading="changing" @click="changePwd">修改密码</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="card">
      <div class="card-title"><el-icon><InfoFilled /></el-icon>关于</div>
      <el-descriptions :column="1" size="small" border style="max-width:640px">
        <el-descriptions-item label="NodeX 版本">v0.1.0</el-descriptions-item>
        <el-descriptions-item label="功能">Xray 节点（vless/vmess/trojan/ss）+ Hysteria2 · Xboard 对接 · Web 表单配置</el-descriptions-item>
        <el-descriptions-item label="安装位置">/usr/bin/nodex · 配置文件 /etc/nodex/config.json</el-descriptions-item>
      </el-descriptions>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Tools, Lock, InfoFilled } from '@element-plus/icons-vue'
import { api } from '../api'

const form = reactive({ web: { port: 8888 }, system: { xray_path: '', log_level: 'info', data_dir: '' } })
const newPwd = ref('')
const saving = ref(false)
const changing = ref(false)

onMounted(async () => {
  try {
    const cfg = await api.get('/api/config')
    form.web.port = cfg.web.port
    form.system.xray_path = cfg.system.xray_path
    form.system.log_level = cfg.system.log_level
    form.system.data_dir = cfg.system.data_dir
  } catch (e) {}
})

async function save() {
  saving.value = true
  try {
    const cfg = await api.get('/api/config')
    cfg.web.port = form.web.port
    cfg.system.xray_path = form.system.xray_path
    cfg.system.log_level = form.system.log_level
    await api.put('/api/config', cfg)
    ElMessage.success('已保存')
  } catch (e) { ElMessage.error(e.message) } finally { saving.value = false }
}

async function changePwd() {
  if (newPwd.value.length < 6) { ElMessage.warning('密码至少 6 位'); return }
  changing.value = true
  try {
    const cfg = await api.get('/api/config')
    cfg.web.password = newPwd.value
    await api.put('/api/config', cfg)
    ElMessage.success('密码已修改')
    newPwd.value = ''
  } catch (e) { ElMessage.error(e.message) } finally { changing.value = false }
}
</script>

<style scoped>
.tip { color: #909399; font-size: 12px; margin-left: 8px; }
</style>
