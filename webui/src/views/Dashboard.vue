<template>
  <div>
    <!-- 状态卡片 -->
    <div class="stat-row">
      <div class="stat-card">
        <div class="stat-label">Xray 节点状态</div>
        <div class="stat-value">
          <el-tag :type="status.xray && status.xray.running ? 'success' : 'danger'" size="large">
            {{ status.xray && status.xray.running ? '运行中' : '已停止' }}
          </el-tag>
        </div>
        <div class="stat-sub">PID: {{ status.xray && status.xray.pid || '-' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Xray 版本</div>
        <div class="stat-value version">{{ status.xray ? status.xray.version : '-' }}</div>
        <div class="stat-sub">可执行文件</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">面板对接</div>
        <div class="stat-value">
          <el-tag :type="status.configured ? 'primary' : 'info'" size="large">
            {{ status.configured ? '已启用' : '未启用' }}
          </el-tag>
        </div>
        <div class="stat-sub">{{ panelStatus }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">在线用户</div>
        <div class="stat-value">{{ onlineCount }}</div>
        <div class="stat-sub">近 10 分钟活跃</div>
      </div>
    </div>

    <!-- 操作 -->
    <div class="card">
      <div class="card-title"><el-icon><VideoPlay /></el-icon>节点控制</div>
      <el-space>
        <el-button type="success" :loading="acting" @click="act('start')">启动节点</el-button>
        <el-button type="danger" :loading="acting" @click="act('stop')">停止节点</el-button>
        <el-button type="warning" :loading="acting" @click="act('restart')">重启节点</el-button>
        <el-button :loading="acting" @click="act('sync')">同步面板并重启</el-button>
      </el-space>
      <div v-if="status.panel && status.panel.lastError" class="panel-err">
        <el-alert type="error" :closable="false" :title="'面板同步错误：' + status.panel.lastError" style="margin-top:12px" />
      </div>
    </div>

    <!-- 用户流量表 -->
    <div class="card">
      <div class="card-title"><el-icon><User /></el-icon>用户流量（累计）</div>
      <el-table :data="users" size="small" v-loading="loadingUsers" empty-text="暂无流量数据（面板对接后自动统计）">
        <el-table-column prop="uid" label="用户 ID" width="120" />
        <el-table-column label="累计流量" width="160">
          <template #default="{ row }"><b>{{ fmtBytes(row.traffic) }}</b></template>
        </el-table-column>
        <el-table-column label="在线 IP">
          <template #default="{ row }">
            <el-tag v-for="ip in row.ips" :key="ip" size="small" style="margin-right:4px">{{ ip }}</el-tag>
            <span v-if="!row.ips || !row.ips.length" class="offline">离线</span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { VideoPlay, User } from '@element-plus/icons-vue'
import { api, fmtBytes } from '../api'

const status = ref({})
const users = ref([])
const acting = ref(false)
const loadingUsers = ref(false)
let timer = null

const panelStatus = computed(() => {
  const p = status.value.panel
  if (!p) return ''
  if (!status.value.configured) return '本地模式'
  return `上次同步 ${p.lastSync}${p.lastError ? '（有错误）' : ''}`
})
const onlineCount = computed(() => users.value.filter(u => u.ips && u.ips.length).length)

async function refresh() {
  try {
    status.value = await api.get('/api/status')
    const res = await api.get('/api/users')
    users.value = res.users
  } catch (e) {}
}

async function act(action) {
  acting.value = true
  try {
    const res = await api.post('/api/action', { action })
    ElMessage.success(res.message || '操作成功')
    setTimeout(refresh, 1500)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    acting.value = false
  }
}

onMounted(() => { refresh(); timer = setInterval(refresh, 10000) })
onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 16px; }
.stat-card { background: #fff; border-radius: 8px; padding: 20px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.stat-label { color: #909399; font-size: 13px; margin-bottom: 10px; }
.stat-value { font-size: 22px; font-weight: 600; }
.stat-value.version { font-size: 16px; word-break: break-all; }
.stat-sub { color: #c0c4cc; font-size: 12px; margin-top: 8px; }
.offline { color: #c0c4cc; font-size: 12px; }
@media (max-width: 900px) { .stat-row { grid-template-columns: repeat(2, 1fr); } }
</style>
