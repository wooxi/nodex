<template>
  <div>
    <div class="card">
      <div class="card-title"><el-icon><Link /></el-icon>面板对接设置（Xboard / V2Board）</div>
      <el-alert type="info" :closable="false" style="margin-bottom:16px"
        title="节点通过 V2Board 标准协议与面板通信：自动拉取用户列表、上报流量与在线设备。启用后 xray 将按面板用户动态生成配置。" />
      <el-form :model="form" label-width="130px" style="max-width:640px">
        <el-form-item label="启用面板对接">
          <el-switch v-model="form.panel.enabled" />
        </el-form-item>
        <template v-if="form.panel.enabled">
          <el-form-item label="面板地址" required>
            <el-input v-model="form.panel.url" placeholder="http://192.168.100.4:7001" />
          </el-form-item>
          <el-form-item label="通信密钥" required>
            <el-input v-model="form.panel.token" placeholder="面板后台生成的通信密钥" show-password />
          </el-form-item>
          <el-form-item label="节点 ID" required>
            <el-input-number v-model="form.panel.node_id" :min="1" :max="9999" />
            <span class="tip">面板后台「服务器」列表中的节点 ID</span>
          </el-form-item>
          <el-form-item label="节点类型">
            <el-select v-model="form.panel.node_type" placeholder="自动（推荐）" clearable style="width:220px">
              <el-option label="vless (Reality)" value="vless" />
              <el-option label="vmess" value="vmess" />
              <el-option label="trojan" value="trojan" />
              <el-option label="shadowsocks" value="shadowsocks" />
              <el-option label="hysteria2" value="hysteria" />
            </el-select>
            <span class="tip">留空则由面板返回的协议自动决定</span>
          </el-form-item>
          <el-form-item label="拉取间隔">
            <el-input-number v-model="form.panel.pull_interval" :min="10" :max="600" /> <span class="tip">秒</span>
          </el-form-item>
          <el-form-item label="上报间隔">
            <el-input-number v-model="form.panel.push_interval" :min="10" :max="600" /> <span class="tip">秒</span>
          </el-form-item>
        </template>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="save">保存配置</el-button>
          <el-button v-if="form.panel.enabled" :loading="testing" @click="test">测试面板连接</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="card">
      <div class="card-title"><el-icon><InfoFilled /></el-icon>面板侧操作指引</div>
      <el-steps direction="vertical" :active="5" style="max-width:640px">
        <el-step title="1. 添加节点" description="面板后台 → 服务器 → 添加 V2Ray 节点（或 Hysteria2 节点），记录节点 ID" />
        <el-step title="2. 获取通信密钥" description="面板后台 → 系统设置 → 服务器通信密钥（server_token）" />
        <el-step title="3. 关联用户组" description="确保节点绑定的用户组下有可用的用户（未过期、未封禁）" />
        <el-step title="4. 填写本页配置" description="填入面板地址、通信密钥、节点 ID，点击「测试面板连接」验证" />
        <el-step title="5. 启动节点" description="回到仪表盘点击「启动节点」，NodeX 会自动拉取用户并生成 xray 配置" />
      </el-steps>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Link, InfoFilled } from '@element-plus/icons-vue'
import { api } from '../api'

const form = reactive({
  panel: { enabled: false, url: '', token: '', node_id: 1, node_type: '', pull_interval: 60, push_interval: 60 }
})
const saving = ref(false)
const testing = ref(false)

onMounted(async () => {
  try {
    const cfg = await api.get('/api/config')
    Object.assign(form.panel, cfg.panel)
  } catch (e) {}
})

async function save() {
  saving.value = true
  try {
    const cfg = await api.get('/api/config')
    cfg.panel = { ...form.panel }
    await api.put('/api/config', cfg)
    ElMessage.success('配置已保存')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

async function test() {
  testing.value = true
  try {
    const res = await api.post('/api/config/test', form.panel)
    ElMessage.success(res.message)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    testing.value = false
  }
}
</script>

<style scoped>
.tip { color: #909399; font-size: 12px; margin-left: 8px; }
</style>
