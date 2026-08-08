<template>
  <div>
    <div class="card">
      <div class="card-title"><el-icon><Setting /></el-icon>节点配置</div>
      <el-alert type="info" :closable="false" style="margin-bottom:16px"
        title="所有参数均为表单配置，无需手写 JSON。生成按钮可自动生成安全随机值。" />

      <!-- 协议选择 -->
      <div class="protocol-picker">
        <div v-for="p in protocols" :key="p.value"
          class="proto-item" :class="{ active: form.node.protocol === p.value }" @click="pickProtocol(p.value)">
          <el-icon :size="20"><component :is="p.icon" /></el-icon>
          <div class="proto-name">{{ p.label }}</div>
          <div class="proto-desc">{{ p.desc }}</div>
        </div>
      </div>

      <el-form :model="form" label-width="140px" style="max-width:720px;margin-top:20px">
        <!-- 通用 -->
        <el-divider content-position="left">通用设置</el-divider>
        <el-form-item v-if="form.node.protocol !== 'hysteria2'" label="监听端口" required>
          <el-input-number v-model="form.node.port" :min="1" :max="65535" />
          <span class="tip">客户端连接端口</span>
        </el-form-item>
        <el-form-item v-if="form.node.protocol === 'hysteria2'" label="Hysteria2 端口" required>
          <el-input-number v-model="form.node.hy2.port" :min="1" :max="65535" />
          <span class="tip">面板模式：主协议为 xray 时，该端口同时开放 hysteria2</span>
        </el-form-item>
        <el-form-item v-if="['vless','vmess'].includes(form.node.protocol)" label="UUID" required>
          <el-input v-model="form.node.uuid" style="width:360px" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx">
            <template #append>
              <el-button @click="gen('uuid')"><el-icon><Refresh /></el-icon>生成</el-button>
            </template>
          </el-input>
        </el-form-item>

        <!-- vless: TLS / Reality -->
        <template v-if="form.node.protocol === 'vless'">
          <el-divider content-position="left">传输安全 (Reality)</el-divider>
          <el-form-item label="TLS 类型">
            <el-radio-group v-model="form.node.tls">
              <el-radio :value="0">关闭</el-radio>
              <el-radio :value="1">TLS（证书）</el-radio>
              <el-radio :value="2">Reality（推荐）</el-radio>
            </el-radio-group>
          </el-form-item>
          <template v-if="form.node.tls === 2">
            <el-form-item label="目标域名 (dest)" required>
              <el-input v-model="form.node.reality.dest" placeholder="www.amazon.com:443" />
              <div class="pubkey" style="width:100%">建议使用未部署后量子加密(MLKEM)的站点，如 www.amazon.com / www.taobao.com（微软/苹果等已部署 MLKEM，reality 无法兼容）</div>
            </el-form-item>
            <el-form-item label="SNI 列表" required>
              <el-input v-model="form.node.reality.server_names" placeholder="www.microsoft.com（多个用逗号分隔）" />
            </el-form-item>
            <el-form-item label="私钥 (PrivateKey)" required>
              <el-input v-model="form.node.reality.private_key" placeholder="base64 编码的 X25519 私钥">
                <template #append>
                  <el-button @click="genReality"><el-icon><Refresh /></el-icon>生成密钥对</el-button>
                </template>
              </el-input>
              <div v-if="form.node.reality.public_key" class="pubkey">
                公钥（客户端配置用）: <code>{{ form.node.reality.public_key }}</code>
              </div>
            </el-form-item>
            <el-form-item label="Short IDs">
              <el-input v-model="form.node.reality.short_ids" placeholder="留空自动，多个用逗号分隔" />
            </el-form-item>
          </template>
          <template v-else-if="form.node.tls === 1">
            <el-form-item label="证书路径" required>
              <el-input v-model="form.node.cert_path" placeholder="/etc/nodex/cert.pem" />
            </el-form-item>
            <el-form-item label="私钥路径" required>
              <el-input v-model="form.node.key_path" placeholder="/etc/nodex/key.pem" />
            </el-form-item>
          </template>
        </template>

        <!-- Shadowsocks -->
        <template v-if="form.node.protocol === 'shadowsocks'">
          <el-divider content-position="left">Shadowsocks 设置</el-divider>
          <el-form-item label="加密方式">
            <el-select v-model="form.node.ss_method" style="width:300px">
              <el-option label="2022-blake3-aes-128-gcm" value="2022-blake3-aes-128-gcm" />
              <el-option label="2022-blake3-aes-256-gcm" value="2022-blake3-aes-256-gcm" />
              <el-option label="2022-blake3-chacha20-poly1305" value="2022-blake3-chacha20-poly1305" />
              <el-option label="aes-128-gcm" value="aes-128-gcm" />
              <el-option label="aes-256-gcm" value="aes-256-gcm" />
              <el-option label="chacha20-ietf-poly1305" value="chacha20-ietf-poly1305" />
            </el-select>
          </el-form-item>
          <el-alert type="warning" :closable="false" style="margin:0 0 16px 140px;max-width:480px"
            title="面板模式：用户密码由面板 UUID 自动生成，无需在此填写" />
        </template>

        <!-- Hysteria2 -->
        <template v-if="form.node.protocol === 'hysteria2'">
          <el-divider content-position="left">Hysteria2 设置</el-divider>
          <el-form-item label="认证密码" required>
            <el-input v-model="form.node.hy2.password" style="width:360px" placeholder="客户端连接密码">
              <template #append>
                <el-button @click="gen('password')"><el-icon><Refresh /></el-icon>生成</el-button>
              </template>
            </el-input>
          </el-form-item>
          <el-form-item label="混淆 (obfs)">
            <el-radio-group v-model="form.node.hy2.obfs">
              <el-radio value="none">关闭</el-radio>
              <el-radio value="salamander">salamander</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="form.node.hy2.obfs === 'salamander'" label="混淆密码" required>
            <el-input v-model="form.node.hy2.obfs_password" style="width:360px">
              <template #append>
                <el-button @click="gen('hex8')"><el-icon><Refresh /></el-icon>生成</el-button>
              </template>
            </el-input>
          </el-form-item>
          <el-form-item label="上行带宽">
            <el-input-number v-model="form.node.hy2.up_mbps" :min="1" :max="10000" /> <span class="tip">Mbps</span>
          </el-form-item>
          <el-form-item label="下行带宽">
            <el-input-number v-model="form.node.hy2.down_mbps" :min="1" :max="100000" /> <span class="tip">Mbps</span>
          </el-form-item>
          <el-form-item label="忽略客户端带宽">
            <el-switch v-model="form.node.hy2.ignore_bw" />
          </el-form-item>
        </template>

        <!-- 面板模式附加说明 -->
        <template v-if="form.panel.enabled">
          <el-divider content-position="left">面板模式说明</el-divider>
          <el-alert type="success" :closable="false"
            title="已启用面板对接：端口/UUID 等参数在面板侧配置，本地端口与 Reality 参数作为覆盖项生效。用户列表由面板自动同步。" />
        </template>

        <el-form-item style="margin-top:20px">
          <el-button type="primary" :loading="saving" @click="save">保存配置</el-button>
          <el-button :loading="saving" @click="saveAndApply">保存并重启节点</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 本地模式连接信息 -->
    <div v-if="!form.panel.enabled && form.node.protocol !== 'hysteria2'" class="card">
      <div class="card-title"><el-icon><Share /></el-icon>连接信息（本地模式）</div>
      <el-descriptions :column="1" border size="small" style="max-width:720px">
        <el-descriptions-item label="地址">{{ location.hostname }}</el-descriptions-item>
        <el-descriptions-item label="端口">{{ form.node.port }}</el-descriptions-item>
        <el-descriptions-item label="协议">{{ form.node.protocol }}</el-descriptions-item>
        <el-descriptions-item label="UUID">{{ form.node.uuid }}</el-descriptions-item>
        <template v-if="form.node.protocol === 'vless' && form.node.tls === 2">
          <el-descriptions-item label="SNI">{{ form.node.reality.server_names }}</el-descriptions-item>
          <el-descriptions-item label="PublicKey">{{ form.node.reality.public_key }}</el-descriptions-item>
          <el-descriptions-item label="ShortId">{{ form.node.reality.short_ids || '空' }}</el-descriptions-item>
          <el-descriptions-item label="Flow">xtls-rprx-vision</el-descriptions-item>
        </template>
      </el-descriptions>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Setting, Refresh, Share, Lightning, Lock, Key, Connection } from '@element-plus/icons-vue'
import { api } from '../api'

const protocols = [
  { value: 'vless', label: 'VLESS + Reality', desc: '抗封锁首选', icon: Lightning },
  { value: 'vmess', label: 'VMess', desc: '经典协议', icon: Key },
  { value: 'trojan', label: 'Trojan', desc: 'TLS 伪装', icon: Lock },
  { value: 'shadowsocks', label: 'Shadowsocks', desc: '轻量快速', icon: Connection },
  { value: 'hysteria2', label: 'Hysteria2', desc: 'UDP 加速', icon: Share }
]

const form = reactive({
  panel: { enabled: false },
  node: {
    protocol: 'vless', port: 443, uuid: '', tls: 2, cert_path: '', key_path: '',
    reality: { dest: 'www.amazon.com:443', server_names: 'www.amazon.com', private_key: '', public_key: '', short_ids: '' },
    hy2: { port: 8443, password: '', obfs: 'none', obfs_password: '', up_mbps: 100, down_mbps: 1000, ignore_bw: false },
    ss_method: '2022-blake3-aes-128-gcm'
  }
})
const saving = ref(false)

onMounted(async () => {
  try {
    const cfg = await api.get('/api/config')
    form.panel.enabled = cfg.panel.enabled
    form.node = { ...form.node, ...cfg.node, reality: { ...form.node.reality, ...cfg.node.reality }, hy2: { ...form.node.hy2, ...cfg.node.hy2 } }
  } catch (e) {}
})

function pickProtocol(p) { form.node.protocol = p }

async function gen(type) {
  try {
    const res = await api.post('/api/generate', { type })
    if (type === 'uuid') form.node.uuid = res.value
    if (type === 'password') form.node.hy2.password = res.value
    if (type === 'hex8') form.node.hy2.obfs_password = res.value
  } catch (e) { ElMessage.error(e.message) }
}

async function genReality() {
  try {
    const res = await api.post('/api/generate', { type: 'reality' })
    form.node.reality.private_key = res.privateKey
    form.node.reality.public_key = res.publicKey
    form.node.reality.short_ids = res.shortId
    ElMessage.success('已生成 Reality 密钥对（公钥已保存，供客户端配置）')
  } catch (e) { ElMessage.error(e.message) }
}

async function save(apply = false) {
  saving.value = true
  try {
    const cfg = await api.get('/api/config')
    cfg.node = { ...form.node }
    await api.put('/api/config', cfg)
    ElMessage.success('配置已保存')
    if (apply) {
      await api.post('/api/action', { action: 'restart' })
      ElMessage.success('节点已重启')
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.protocol-picker { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
.proto-item { border: 2px solid #e4e7ed; border-radius: 8px; padding: 14px 10px; text-align: center; cursor: pointer; transition: all .2s; }
.proto-item:hover { border-color: #409eff; }
.proto-item.active { border-color: #409eff; background: #ecf5ff; }
.proto-name { font-weight: 600; margin: 8px 0 4px; font-size: 14px; }
.proto-desc { color: #909399; font-size: 12px; }
.tip { color: #909399; font-size: 12px; margin-left: 8px; }
.pubkey { width: 100%; font-size: 12px; color: #67c23a; margin-top: 4px; }
.pubkey code { background: #f0f9eb; padding: 2px 6px; border-radius: 4px; }
@media (max-width: 900px) { .protocol-picker { grid-template-columns: repeat(2, 1fr); } }
</style>
