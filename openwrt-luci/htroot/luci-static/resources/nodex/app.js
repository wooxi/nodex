// NodeX LuCI 前端 v0.3.0（独立 JS，无框架依赖，响应式多设备）
(function () {
    'use strict';

    var API = '/cgi-bin/luci/admin/services/nodex/api';

    function api(path, opts) {
        opts = opts || {};
        var init = { method: opts.method || 'GET', headers: { 'Accept': 'application/json' } };
        if (opts.body) {
            init.method = opts.method || 'POST';
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(opts.body);
        }
        return fetch(API + path, init).then(function (r) {
            return r.text().then(function (t) {
                try {
                    return JSON.parse(t);
                } catch (e) {
                    throw new Error('API ' + r.status + ': ' + (t || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 150));
                }
            });
        });
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function fmtBytes(n) {
        if (!n) return '0 B';
        var units = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
        while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
        return n.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    }

    var PROTO_MAP = { vless: 'VLESS', vmess: 'VMess', trojan: 'Trojan', shadowsocks: 'SS', hysteria2: 'Hysteria2', hysteria: 'Hysteria2' };

    function protoBadge(p) {
        return '<span class="nx-badge">' + esc(PROTO_MAP[p] || p || '未知') + '</span>';
    }

    function msg(text, ok) {
        var box = document.getElementById('nodex-content');
        if (!box) return;
        var d = document.createElement('div');
        d.className = 'nx-msg ' + (ok ? 'ok' : 'err');
        d.textContent = text;
        box.insertBefore(d, box.firstChild);
        setTimeout(function () { d.remove(); }, 5000);
    }

    // ---------- 后端状态（hero） ----------
    function renderBackend() {
        var pill = document.getElementById('nx-backend-pill');
        var btn = document.getElementById('nx-backend-btn');
        if (!pill) return;
        fetch('/cgi-bin/luci/admin/services/nodex/backend/status').then(function (r) { return r.json(); }).then(function (b) {
            pill.className = 'nx-pill';
            if (b.nodex_running) {
                pill.innerHTML = '<span class="nx-dot ok"></span>后端运行中';
            } else if (b.nodex_bin) {
                pill.className = 'nx-pill err';
                pill.innerHTML = '<span class="nx-dot err"></span>后端未运行';
            } else {
                pill.className = 'nx-pill err';
                pill.innerHTML = '<span class="nx-dot err"></span>后端未安装';
            }
            if (b.nodex_bin && b.xray_bin && b.hysteria_bin) {
                btn.style.display = '';
                btn.textContent = '重启后端';
                btn.onclick = function () {
                    fetch('/cgi-bin/luci/admin/services/nodex/backend/restart').then(function (r) { return r.json(); })
                        .then(function (res) { msg(res.message || '已重启', true); setTimeout(renderBackend, 2500); })
                        .catch(function (e) { msg(e.message || '重启失败', false); });
                };
            } else {
                btn.style.display = '';
                btn.className = 'nx-btn primary';
                btn.textContent = '下载安装后端';
                btn.onclick = function () {
                    if (!confirm('将下载并安装 nodex 守护进程 + xray + hysteria 内核（约 70MB），继续？')) return;
                    fetch('/cgi-bin/luci/admin/services/nodex/backend/install').then(function (r) { return r.json(); })
                        .then(function (res) { msg(res.message || '安装已启动', true); setTimeout(renderBackend, 30000); })
                        .catch(function (e) { msg(e.message || '启动失败', false); });
                };
            }
        }).catch(function () {
            pill.innerHTML = '后端检测失败';
        });
    }

    // ---------- 总览 ----------
    function renderOverview() {
        var el = document.getElementById('nodex-content');
        el.innerHTML = '<div class="nx-hint">加载中...</div>';
        Promise.all([api('/status'), api('/users')]).then(function (res) {
            var st = res[0], users = (res[1] && res[1].users) || [];
            var nodes = st.nodes || [];
            var totalTraffic = users.reduce(function (s, u) { return s + (u.traffic || 0); }, 0);
            var online = users.filter(function (u) { return u.ips && u.ips.length; }).length;
            var running = 0;
            nodes.forEach(function (n) {
                if (n.enabled && ((n.xray && n.xray.running) || (n.hy2 && n.hy2.running))) running++;
            });

            // 统计卡片
            var stats =
                '<div class="nx-stats">' +
                '<div class="nx-stat"><div class="num">' + nodes.length + '</div><div class="lbl"><span class="ico">◉</span>节点总数</div></div>' +
                '<div class="nx-stat"><div class="num' + (running > 0 ? ' ok' : '') + '">' + running + '</div><div class="lbl"><span class="ico">⚡</span>运行中</div></div>' +
                '<div class="nx-stat"><div class="num' + (online > 0 ? ' ok' : '') + '">' + online + '</div><div class="lbl"><span class="ico">●</span>在线用户</div></div>' +
                '<div class="nx-stat"><div class="num">' + fmtBytes(totalTraffic) + '</div><div class="lbl"><span class="ico">⇅</span>累计流量</div></div>' +
                '</div>';

            // 节点卡片
            var nodeCards = nodes.map(function (n) {
                var xOk = n.xray && n.xray.running;
                var hOk = n.hy2 && n.hy2.running;
                var state = !n.enabled ? 'off' : (xOk || hOk ? 'ok' : 'err');
                var xVer = n.xray && n.xray.version ? n.xray.version.split(' ')[0] : (n.xray ? '未安装' : '-');
                var hVer = n.hy2 && n.hy2.version ? (n.hy2.version.split('\t').pop() || n.hy2.version) : (n.hy2 ? '未安装' : '-');
                var errStrip = (n.panel && n.panel.lastError) ? '<div class="nx-node-err" title="' + esc(n.panel.lastError) + '">⚠ ' + esc(n.panel.lastError) + '</div>' : '';
                var syncInfo = (n.panel && n.panel.lastSync && n.panel.lastSync.indexOf('0001') !== 0) ? n.panel.lastSync.slice(5) : '';
                return '<div class="nx-node ' + state + '">' +
                    '<div class="nx-node-head">' +
                    '<span class="nx-node-name">' + esc(n.name) + '</span>' +
                    protoBadge(n.protocol) +
                    (n.enabled ? '' : '<span class="nx-badge off">已禁用</span>') +
                    '</div>' +
                    errStrip +
                    '<div class="nx-node-kernels">' +
                    '<div class="nx-kernel"><span class="nx-dot ' + (n.enabled && n.xray ? (xOk ? 'ok' : 'err') : 'muted') + '"></span>' +
                    '<span class="k">Xray</span><span class="v">' + esc(xVer) + '</span>' +
                    '<span class="st ' + (xOk ? 'on' : 'off') + '">' + (n.enabled ? (xOk ? '运行中' : '已停止') : '-') + '</span></div>' +
                    '<div class="nx-kernel"><span class="nx-dot ' + (n.enabled && n.hy2 ? (hOk ? 'ok' : 'err') : 'muted') + '"></span>' +
                    '<span class="k">Hysteria2</span><span class="v">' + esc(hVer) + '</span>' +
                    '<span class="st ' + (hOk ? 'on' : 'off') + '">' + (n.enabled ? (hOk ? '运行中' : '已停止') : '-') + '</span></div>' +
                    '</div>' +
                    '<div class="nx-node-foot">' +
                    '<button class="nx-btn sm" onclick="window.nodexRestart(\'' + n.id + '\')">重启</button>' +
                    '<button class="nx-btn sm" onclick="window.nodexGoEdit(\'' + n.id + '\')">配置</button>' +
                    (syncInfo ? '<span class="nx-sync">同步 ' + esc(syncInfo) + '</span>' : '') +
                    '</div>' +
                    '</div>';
            }).join('');

            // 内核总开关
            var xrayOn = nodes.filter(function (n) { return n.enabled && n.xray && n.xray.running; }).length;
            var hy2On = nodes.filter(function (n) { return n.enabled && n.hy2 && n.hy2.running; }).length;
            var en = nodes.filter(function (n) { return n.enabled; }).length;
            function kmState(on, total) {
                if (total === 0) return '<span class="nx-kstatus off">无节点</span>';
                if (on === 0) return '<span class="nx-kstatus off">已停止</span>';
                if (on === total) return '<span class="nx-kstatus ok">运行中</span>';
                return '<span class="nx-kstatus part">' + on + '/' + total + '</span>';
            }
            function kmDots(kind) {
                return nodes.map(function (n) {
                    var r = n.enabled && n[kind] && n[kind].running;
                    return '<span class="nx-dot ' + (n.enabled ? (r ? 'on' : 'off') : 'muted') + '"></span>';
                }).join('');
            }
            var km =
                '<div class="nx-kmaster">' +
                '<div class="nx-krow"><span class="nx-kname">Xray</span><span class="nx-kdots">' + kmDots('xray') + '</span>' +
                kmState(xrayOn, en) +
                '<span style="margin-left:auto;display:flex;gap:8px">' +
                '<button class="nx-btn sm" onclick="window.nodexKernel(\'stop-xray\')">停止</button>' +
                '<button class="nx-btn sm primary" onclick="window.nodexKernel(\'start-xray\')">启动</button></span></div>' +
                '<div class="nx-krow"><span class="nx-kname">Hysteria2</span><span class="nx-kdots">' + kmDots('hy2') + '</span>' +
                kmState(hy2On, en) +
                '<span style="margin-left:auto;display:flex;gap:8px">' +
                '<button class="nx-btn sm" onclick="window.nodexKernel(\'stop-hy2\')">停止</button>' +
                '<button class="nx-btn sm primary" onclick="window.nodexKernel(\'start-hy2\')">启动</button></span></div>' +
                '</div>';

            // 用户流量
            var panelErrs = nodes.filter(function (n) { return n.panel && n.panel.lastError; });
            var lastSync = '';
            nodes.forEach(function (n) { if (n.panel && n.panel.lastSync && n.panel.lastSync.indexOf('0001') !== 0) lastSync = n.panel.lastSync; });
            var panelTag = nodes.length === 0
                ? '<span class="nx-tag off">未配置</span>'
                : (panelErrs.length === 0
                    ? '<span class="nx-tag ok">正常</span>'
                    : '<span class="nx-tag err" title="' + esc(panelErrs.map(function (n) { return n.name + ': ' + n.panel.lastError; }).join('\n')) + '">错误</span>');

            var userRows = users.map(function (u) {
                return '<tr>' +
                    '<td>' + esc(u.node_name || '-') + '</td>' +
                    '<td><span class="nx-tag off">UID ' + esc(u.uid) + '</span></td>' +
                    '<td>' + fmtBytes(u.traffic) + '</td>' +
                    '<td>' + (u.ips && u.ips.length ? u.ips.map(function (ip) { return '<span class="nx-tag ok">' + esc(ip) + '</span>'; }).join(' ') : '<span class="nx-tag off">离线</span>') + '</td>' +
                    '</tr>';
            }).join('');

            el.innerHTML = stats +
                '<div class="nx-card"><h3>节点状态<span class="nx-h3-side"><span style="margin-right:10px">面板同步 ' + panelTag + '</span>上次同步 ' + esc(lastSync || '-') + '</span></h3>' +
                '<div class="nx-nodes">' + (nodeCards || '<div class="nx-empty" style="grid-column:1/-1">暂无节点，去「节点管理」新增</div>') + '</div></div>' +
                '<div class="nx-card"><h3>内核总开关</h3>' + km + '</div>' +
                '<div class="nx-card"><h3>用户流量</h3>' +
                (users.length
                    ? '<div class="nx-table-wrap"><table class="nx-table"><tr><th>节点</th><th>用户</th><th>累计流量</th><th>在线 IP</th></tr>' + userRows + '</table></div>'
                    : '<div class="nx-empty">暂无流量数据（用户连接节点后自动统计）</div>') +
                '</div>';
        }).catch(function (e) { el.innerHTML = '<div class="nx-hint">加载失败: ' + esc(e.message) + '</div>'; });
    }

    window.nodexKernel = function (action) {
        var name = action.indexOf('xray') >= 0 ? 'Xray' : 'Hysteria2';
        var op = action.indexOf('stop') >= 0 ? '停止' : '启动';
        if (!confirm('确定' + op + '所有节点的 ' + name + '？')) return;
        api('/action', { body: { action: action } }).then(function () {
            msg(name + ' 已' + op, true);
            setTimeout(renderOverview, 1500);
        }).catch(function (e) { msg(e.message || '操作失败', false); });
    };

    window.nodexRestart = function (id) {
        api('/action', { body: { action: 'restart', node_id: id } }).then(function () {
            msg('节点已重启', true);
            setTimeout(renderOverview, 1500);
        }).catch(function (e) { msg(e.message || '重启失败', false); });
    };

    // ---------- 节点管理 ----------
    function renderNodes() {
        var el = document.getElementById('nodex-content');
        el.innerHTML = '<div class="nx-hint">加载中...</div>';
        api('/status').then(function (st) {
            var nodes = st.nodes || [];
            var cards = nodes.map(function (n) {
                var xOk = n.xray && n.xray.running;
                var hOk = n.hy2 && n.hy2.running;
                var state = !n.enabled ? 'off' : (xOk || hOk ? 'ok' : 'err');
                return '<div class="nx-node ' + state + '">' +
                    '<div class="nx-node-head">' +
                    '<span class="nx-node-name">' + esc(n.name) + '</span>' +
                    protoBadge(n.protocol) +
                    (n.enabled ? '' : '<span class="nx-badge off">已禁用</span>') +
                    '</div>' +
                    '<div class="nx-node-kernels">' +
                    '<div class="nx-kernel"><span class="nx-dot ' + (xOk ? 'ok' : 'muted') + '"></span><span class="k">Xray</span><span class="st ' + (xOk ? 'on' : 'off') + '">' + (xOk ? '运行中' : '已停止') + '</span></div>' +
                    '<div class="nx-kernel"><span class="nx-dot ' + (hOk ? 'ok' : 'muted') + '"></span><span class="k">Hysteria2</span><span class="st ' + (hOk ? 'on' : 'off') + '">' + (hOk ? '运行中' : '已停止') + '</span></div>' +
                    '</div>' +
                    '<div class="nx-node-foot">' +
                    '<button class="nx-btn sm" onclick="window.nodexGoEdit(\'' + n.id + '\')">编辑</button>' +
                    '<button class="nx-btn sm danger" onclick="window.nodexDelNode(\'' + n.id + '\',\'' + esc(n.name).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')">删除</button>' +
                    '<span class="nx-sync">节点 ID ' + esc(n.id) + '</span>' +
                    '</div></div>';
            }).join('');
            el.innerHTML =
                '<div class="nx-card"><h3>节点管理<span class="nx-h3-side"><button class="nx-btn sm primary" onclick="window.nodexAddNode()">＋ 新增节点</button></span></h3>' +
                '<div class="nx-nodes">' + (cards || '<div class="nx-empty" style="grid-column:1/-1">暂无节点</div>') + '</div></div>';
        }).catch(function (e) { el.innerHTML = '<div class="nx-hint">' + esc(e.message) + '</div>'; });
    }

    window.nodexAddNode = function () {
        api('/config').then(function (cfg) {
            cfg.nodes = cfg.nodes || [];
            var maxId = cfg.nodes.reduce(function (m, x) { return Math.max(m, x.node_id || 0); }, 0);
            var node = {
                id: 'n' + Math.random().toString(16).slice(2, 6),
                name: '新节点' + (cfg.nodes.length + 1),
                enabled: true,
                node_id: maxId + 1,
                node_type: '',
                node: {
                    protocol: 'vless', port: 8686, uuid: '', tls: 0, cert_path: '', key_path: '', server_name: '',
                    reality: { dest: 'www.amazon.com:443', server_names: 'www.amazon.com', private_key: '', public_key: '', short_ids: '' },
                    hy2: { port: 9443, password: '', obfs: 'none', obfs_password: '', up_mbps: 100, down_mbps: 1000, ignore_bw: false, cert_path: '', key_path: '' },
                    ss_method: '2022-blake3-aes-128-gcm'
                }
            };
            cfg.nodes.push(node);
            return api('/config', { method: 'PUT', body: cfg }).then(function () {
                window.nodexGoEdit(node.id);
            });
        }).catch(function (e) { msg(e.message || '创建失败', false); });
    };

    window.nodexDelNode = function (id, name) {
        if (!confirm('确定删除节点「' + name + '」？')) return;
        api('/config').then(function (cfg) {
            cfg.nodes = (cfg.nodes || []).filter(function (x) { return x.id !== id; });
            return api('/config', { method: 'PUT', body: cfg });
        }).then(function () { msg('已删除', true); renderNodes(); })
            .catch(function (e) { msg(e.message || '删除失败', false); });
    };

    // ---------- 节点编辑 ----------
    var PROTOCOLS = [
        { value: 'vless', label: 'VLESS' },
        { value: 'vmess', label: 'VMess' },
        { value: 'trojan', label: 'Trojan' },
        { value: 'shadowsocks', label: 'SS' },
        { value: 'hysteria2', label: 'Hysteria2' }
    ];

    function renderNodeEdit(id) {
        var el = document.getElementById('nodex-content');
        el.innerHTML = '<div class="nx-hint">加载中...</div>';
        api('/config').then(function (cfg) {
            window.nodexGlobalPanel = cfg.panel || {};
            var node = (cfg.nodes || []).filter(function (n) { return n.id === id; })[0];
            if (!node) { el.innerHTML = '<div class="nx-hint">节点不存在</div>'; return; }
            window.nodexEditNode = node;
            renderNodeEditForm(node);
        }).catch(function (e) { el.innerHTML = '<div class="nx-hint">' + esc(e.message) + '</div>'; });
    }

    function f(label, key, type, val, gen, opts) {
        var v = val == null ? '' : val;
        var input = '';
        if (type === 'number') input = '<input type="number" data-key="' + key + '" value="' + esc(v) + '">';
        else if (type === 'checkbox') input = '<label class="nx-switch"><input type="checkbox" data-key="' + key + '"' + (v ? ' checked' : '') + '><span class="trk"></span></label>';
        else if (type === 'select') {
            input = '<select data-key="' + key + '">' + (opts || []).map(function (o) {
                return '<option value="' + esc(o.value) + '"' + (String(v) === String(o.value) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
            }).join('') + '</select>';
        }
        else input = '<input type="text" data-key="' + key + '" value="' + esc(v) + '" autocomplete="off">';
        var btn = gen ? '<button class="nx-btn sm" onclick="window.nodexGen(\'' + gen + '\',\'' + key + '\')">生成</button>' : '';
        return '<div class="nx-field"><label>' + esc(label) + '</label>' + input + ' ' + btn + '</div>';
    }

    function renderNodeEditForm(node) {
        var el = document.getElementById('nodex-content');
        var id = node.id;
        var proto = node.node.protocol;
        var panelEnabled = window.nodexGlobalPanel && window.nodexGlobalPanel.enabled;

        var protoBtns = PROTOCOLS.map(function (p) {
            return '<span class="nx-proto-item' + (p.value === proto ? ' active' : '') + '" onclick="window.nodexSetProto(\'' + id + '\',\'' + p.value + '\')">' + p.label + '</span>';
        }).join('');

        var fields = '';
        if (proto !== 'hysteria2') {
            if (!panelEnabled) fields += f('监听端口', 'node.port', 'number', node.node.port);
            if (proto === 'vless' || proto === 'vmess') fields += f('UUID', 'node.uuid', 'text', node.node.uuid, 'uuid');
            if (proto === 'vless') {
                fields += f('TLS 类型', 'node.tls', 'select', node.node.tls, null, [
                    { value: 0, label: '关闭' }, { value: 1, label: 'TLS 证书' }, { value: 2, label: 'Reality' }
                ]);
                if (String(node.node.tls) === '2') {
                    fields += f('目标域名 dest', 'node.reality.dest', 'text', node.node.reality.dest);
                    fields += f('SNI 列表', 'node.reality.server_names', 'text', node.node.reality.server_names);
                    fields += f('私钥 PrivateKey', 'node.reality.private_key', 'text', node.node.reality.private_key, 'reality');
                    if (node.node.reality.public_key) {
                        fields += '<div class="nx-field"><label>公钥 PublicKey</label><code style="font-size:12px">' + esc(node.node.reality.public_key) + '</code></div>';
                    }
                    fields += f('Short IDs', 'node.reality.short_ids', 'text', node.node.reality.short_ids);
                    fields += '<div class="nx-field"><span class="hint">提示：Reality dest 请选择未启用后量子加密（MLKEM）的站点，如 www.amazon.com</span></div>';
                } else if (String(node.node.tls) === '1') {
                    fields += f('证书路径', 'node.cert_path', 'text', node.node.cert_path);
                    fields += f('私钥路径', 'node.key_path', 'text', node.node.key_path);
                    fields += f('SNI (serverName)', 'node.server_name', 'text', node.node.server_name);
                }
            }
            if (proto === 'vmess') {
                fields += f('TLS 类型', 'node.tls', 'select', node.node.tls, null, [
                    { value: 0, label: '关闭' }, { value: 1, label: 'TLS 证书' }
                ]);
                if (String(node.node.tls) === '1') {
                    fields += f('证书路径', 'node.cert_path', 'text', node.node.cert_path);
                    fields += f('私钥路径', 'node.key_path', 'text', node.node.key_path);
                    fields += f('SNI (serverName)', 'node.server_name', 'text', node.node.server_name);
                }
            }
            if (proto === 'trojan') {
                fields += f('TLS 类型', 'node.tls', 'select', String(node.node.tls) === '1' ? 1 : 1, null, [
                    { value: 1, label: 'TLS 证书（必需）' }
                ]);
                fields += f('证书路径', 'node.cert_path', 'text', node.node.cert_path);
                fields += f('私钥路径', 'node.key_path', 'text', node.node.key_path);
                fields += f('SNI (serverName)', 'node.server_name', 'text', node.node.server_name);
                fields += '<div class="nx-field"><span class="hint">Trojan 协议强制要求 TLS，用户密码由面板 UUID 自动生成</span></div>';
            }
            if (proto === 'shadowsocks') {
                fields += f('加密方式', 'node.ss_method', 'select', node.node.ss_method, null, [
                    { value: '2022-blake3-aes-128-gcm', label: '2022-blake3-aes-128-gcm' },
                    { value: '2022-blake3-aes-256-gcm', label: '2022-blake3-aes-256-gcm' },
                    { value: 'aes-128-gcm', label: 'aes-128-gcm' },
                    { value: 'chacha20-ietf-poly1305', label: 'chacha20-ietf-poly1305' }
                ]);
            }
        } else {
            if (!panelEnabled) fields += f('监听端口', 'node.hy2.port', 'number', node.node.hy2.port);
            fields += f('认证密码', 'node.hy2.password', 'text', node.node.hy2.password, 'password');
            fields += f('混淆 obfs', 'node.hy2.obfs', 'select', node.node.hy2.obfs, null, [
                { value: 'none', label: '关闭' }, { value: 'salamander', label: 'salamander' }
            ]);
            if (node.node.hy2.obfs === 'salamander') {
                fields += f('混淆密码', 'node.hy2.obfs_password', 'text', node.node.hy2.obfs_password, 'hex8');
            }
            fields += f('上行带宽 Mbps', 'node.hy2.up_mbps', 'number', node.node.hy2.up_mbps);
            fields += f('下行带宽 Mbps', 'node.hy2.down_mbps', 'number', node.node.hy2.down_mbps);
            fields += f('忽略客户端带宽', 'node.hy2.ignore_bw', 'checkbox', node.node.hy2.ignore_bw);
            fields += f('证书路径', 'node.hy2.cert_path', 'text', node.node.hy2.cert_path);
            fields += f('私钥路径', 'node.hy2.key_path', 'text', node.node.hy2.key_path);
        }

        var fwd = node.forward || { fingerprint: 'chrome', targets: [] };
        var fwdTargets = (fwd.targets || []).map(function (t) {
            return t.address + (t.port ? ':' + t.port : '') + (t.weight && t.weight !== 1 ? ':' + t.weight : '');
        }).join('\n');

        el.innerHTML =
            '<div class="nx-card"><h3>节点编辑：' + esc(node.name) + '<span class="nx-h3-side"><button class="nx-btn sm" onclick="window.nodexGo(\'nodes\')">返回列表</button></span></h3>' +
            '<div class="nx-form">' +
            f('节点名称', 'name', 'text', node.name) +
            '<div class="nx-field"><label>启用节点</label><label class="nx-switch"><input type="checkbox" id="nx-enabled"' + (node.enabled ? ' checked' : '') + '><span class="trk"></span></label></div>' +
            '</div></div>' +
            '<div class="nx-card"><h3>面板对接（本节点）</h3><div class="nx-form">' +
            f('面板节点 ID', 'node_id', 'number', node.node_id) +
            '<div class="nx-field"><label>节点类型</label><select id="nx-nodetype">' +
            '<option value="">自动（推荐）</option>' +
            [['vless', 'vless'], ['vmess', 'vmess'], ['trojan', 'trojan'], ['shadowsocks', 'shadowsocks'], ['hysteria', 'hysteria2']].map(function (t) {
                return '<option value="' + t[0] + '"' + (node.node_type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
            }).join('') + '</select></div>' +
            '<div class="nx-field"><label></label><button class="nx-btn" onclick="window.nodexTestNodePanel(\'' + id + '\')">测试面板连接</button></div>' +
            '<div class="nx-field"><span class="hint">面板模式下监听端口、传输网络自动同步面板节点配置</span></div>' +
            '</div></div>' +
            '<div class="nx-card"><h3>协议</h3><div class="nx-proto">' + protoBtns + '</div></div>' +
            '<div class="nx-card"><h3>协议配置</h3><div class="nx-form">' + fields + '</div></div>' +
            '<div class="nx-card"><h3>转发出站（XrayR 转发模式）</h3><div class="nx-form">' +
            '<div class="nx-field"><label>启用转发</label><label class="nx-switch"><input type="checkbox" id="nx-fwd-enabled"' + (fwd.enabled ? ' checked' : '') + '><span class="trk"></span></label></div>' +
            f('落地 UUID', 'nx-fwd-uuid', 'text', fwd.uuid || '') +
            f('SNI', 'nx-fwd-sni', 'text', fwd.server_name || '') +
            f('WS 路径', 'nx-fwd-wspath', 'text', fwd.ws_path || '') +
            f('WS Host', 'nx-fwd-wshost', 'text', fwd.ws_host || '') +
            '<div class="nx-field"><label>目标服务器</label><textarea id="nx-fwd-targets" rows="5" placeholder="每行一个：IP 或 IP:端口 或 IP:端口:权重">' + esc(fwdTargets) + '</textarea></div>' +
            '<div class="nx-field"><span class="hint">启用后入站流量转发到落地节点（vless+ws+tls）代替直连，多目标自动负载均衡</span></div>' +
            '</div></div>' +
            '<div class="nx-card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
            '<button class="nx-btn primary" onclick="window.nodexSaveNode(\'' + id + '\',false)">保存配置</button>' +
            '<button class="nx-btn" onclick="window.nodexSaveNode(\'' + id + '\',true)">保存并重启</button>' +
            '<span class="nx-hint" style="margin-left:auto">保存节点配置只会重启该节点</span></div>';
    }

    window.nodexSetProto = function (id, proto) {
        if (window.nodexEditNode && window.nodexEditNode.id === id) {
            syncEditNodeFromForm();
            window.nodexEditNode.node.protocol = proto;
            if (proto === 'trojan') window.nodexEditNode.node.tls = 1;
            renderNodeEditForm(window.nodexEditNode);
        }
    };

    function syncEditNodeFromForm() {
        var nameEl = document.querySelector('[data-key="name"]');
        var enEl = document.getElementById('nx-enabled');
        var ntypeEl = document.getElementById('nx-nodetype');
        if (!window.nodexEditNode) return;
        if (nameEl) window.nodexEditNode.name = nameEl.value;
        if (enEl) window.nodexEditNode.enabled = enEl.checked;
        if (ntypeEl) window.nodexEditNode.node_type = ntypeEl.value;
        var fwd = window.nodexEditNode.forward || (window.nodexEditNode.forward = {});
        var fe = document.getElementById('nx-fwd-enabled');
        if (fe) {
            fwd.enabled = fe.checked;
            fwd.uuid = document.getElementById('nx-fwd-uuid').value;
            fwd.server_name = document.getElementById('nx-fwd-sni').value;
            fwd.ws_path = document.getElementById('nx-fwd-wspath').value;
            fwd.ws_host = document.getElementById('nx-fwd-wshost').value;
            fwd.fingerprint = fwd.fingerprint || 'chrome';
            fwd.targets = [];
            document.getElementById('nx-fwd-targets').value.split('\n').forEach(function (ln) {
                ln = ln.trim();
                if (!ln) return;
                var parts = ln.split(':');
                var t = { address: parts[0], port: 0, weight: 1 };
                if (parts.length > 1) t.port = parseInt(parts[1], 10) || 0;
                if (parts.length > 2) t.weight = parseInt(parts[2], 10) || 1;
                fwd.targets.push(t);
            });
        }
    }

    window.nodexTestNodePanel = function (id) {
        syncEditNodeFromForm();
        api('/config').then(function (cfg) {
            var n = (cfg.nodes || []).filter(function (x) { return x.id === id; })[0];
            if (!n) throw new Error('节点不存在');
            return api('/nodes/test', { body: {
                url: cfg.panel.url || '',
                token: cfg.panel.token || '',
                node_id: n.node_id || 0,
                node_type: n.node_type || ''
            } });
        }).then(function (res) {
            msg(res.message || '连接成功', true);
        }).catch(function (e) { msg(e.message || '连接失败', false); });
    };

    window.nodexGen = function (gen, key) {
        var req = { type: gen === 'reality' ? 'reality' : (gen === 'uuid' ? 'uuid' : (gen === 'hex8' ? 'hex' : 'password')) };
        if (gen === 'hex8') req.len = 8;
        api('/generate', { body: req }).then(function (res) {
            if (gen === 'reality') {
                api('/config').then(function (cfg) {
                    var node = (cfg.nodes || []).filter(function (n) { return n.id === window.nodexEditNode.id; })[0];
                    if (node) {
                        node.node.reality.private_key = res.privateKey;
                        node.node.reality.public_key = res.publicKey;
                        node.node.reality.short_ids = res.shortId;
                        return api('/config', { method: 'PUT', body: cfg });
                    }
                }).then(function () { msg('已生成密钥对', true); renderNodeEdit(window.nodexEditNode.id); });
            } else {
                var input = document.querySelector('[data-key="' + key + '"]');
                if (input) { input.value = res.value; msg('已生成', true); }
            }
        }).catch(function (e) { msg(e.message || '生成失败', false); });
    };

    window.nodexSaveNode = function (id, restart) {
        syncEditNodeFromForm();
        api('/config').then(function (c) {
            var idx = c.nodes.findIndex(function (n) { return n.id === id; });
            if (idx < 0) throw new Error('节点不存在');
            var node = window.nodexEditNode && window.nodexEditNode.id === id
                ? JSON.parse(JSON.stringify(window.nodexEditNode))
                : c.nodes[idx];
            c.nodes[idx] = node;
            document.querySelectorAll('#nodex-content [data-key]').forEach(function (el) {
                var key = el.dataset.key;
                if (key.indexOf('nx-') === 0 || key === 'name') return; // 单独处理
                var v;
                if (el.type === 'checkbox') v = el.checked;
                else if (el.type === 'number') v = parseInt(el.value, 10) || 0;
                else v = el.value;
                var parts = key.split('.');
                var cur = node;
                for (var i = 1; i < parts.length - 1; i++) {
                    if (cur[parts[i]] == null) cur[parts[i]] = {};
                    cur = cur[parts[i]];
                }
                cur[parts[parts.length - 1]] = v;
            });
            return api('/config', { method: 'PUT', body: c });
        }).then(function () {
            if (restart) {
                return api('/action', { body: { action: 'restart', node_id: id } }).then(function () { msg('已保存并重启该节点', true); });
            }
            msg('配置已保存', true);
        }).catch(function (e) { msg(e.message || '保存失败', false); });
    };

    // ---------- 面板对接 ----------
    function renderPanel() {
        var el = document.getElementById('nodex-content');
        api('/config').then(function (cfg) {
            var p = cfg.panel || {};
            el.innerHTML =
                '<div class="nx-card"><h3>面板对接（全局配置）</h3><div class="nx-form">' +
                '<div class="nx-field"><label>启用面板对接</label><label class="nx-switch"><input type="checkbox" id="nx-p-enabled"' + (p.enabled ? ' checked' : '') + '><span class="trk"></span></label></div>' +
                '<div class="nx-field"><label>面板地址</label><input type="text" id="nx-p-url" value="' + esc(p.url || '') + '" placeholder="https://panel.example.com" autocomplete="off"></div>' +
                '<div class="nx-field"><label>通信密钥</label><input type="text" id="nx-p-token" value="' + esc(p.token || '') + '" autocomplete="off"></div>' +
                '<div class="nx-field"><label>拉取 / 上报间隔</label>' +
                '<input type="number" id="nx-p-pull" value="' + esc(p.pull_interval || 60) + '" style="max-width:100px"> 秒 / ' +
                '<input type="number" id="nx-p-push" value="' + esc(p.push_interval || 60) + '" style="max-width:100px"> 秒</div>' +
                '<div class="nx-field"><span class="hint">同步间隔以面板返回的 base_config 优先；保存面板配置不重启节点内核</span></div>' +
                '<div class="nx-field"><label></label><span style="display:flex;gap:10px">' +
                '<button class="nx-btn primary" onclick="window.nodexSavePanel()">保存配置</button>' +
                '<button class="nx-btn" onclick="window.nodexTestPanel()">测试面板连接</button></span></div>' +
                '</div></div>';
        }).catch(function (e) { el.innerHTML = '<div class="nx-hint">' + esc(e.message) + '</div>'; });
    }

    window.nodexSavePanel = function () {
        api('/config').then(function (c) {
            c.panel = {
                enabled: document.getElementById('nx-p-enabled').checked,
                url: document.getElementById('nx-p-url').value,
                token: document.getElementById('nx-p-token').value,
                pull_interval: parseInt(document.getElementById('nx-p-pull').value, 10) || 60,
                push_interval: parseInt(document.getElementById('nx-p-push').value, 10) || 60
            };
            return api('/config', { method: 'PUT', body: c });
        }).then(function () { msg('配置已保存', true); })
            .catch(function (e) { msg(e.message || '保存失败', false); });
    };

    window.nodexTestPanel = function () {
        api('/nodes/test', { body: {
            url: document.getElementById('nx-p-url').value,
            token: document.getElementById('nx-p-token').value
        } }).then(function (res) {
            msg(res.message || '连接成功', true);
        }).catch(function (e) { msg(e.message || '连接失败', false); });
    };

    // ---------- 系统设置 ----------
    function renderSystem() {
        var el = document.getElementById('nodex-content');
        api('/config').then(function (cfg) {
            var s = cfg.system || {};
            el.innerHTML =
                '<div class="nx-card"><h3>系统设置（全局）</h3><div class="nx-form">' +
                '<div class="nx-field"><label>xray 路径</label><input type="text" id="nx-s-xray" value="' + esc(s.xray_path || '') + '"> <span id="nx-core-xray" style="margin-left:auto"></span></div>' +
                '<div class="nx-field"><label>hysteria 路径</label><input type="text" id="nx-s-hy" value="' + esc(s.hysteria_path || '') + '"> <span id="nx-core-hy" style="margin-left:auto"></span></div>' +
                '<div class="nx-field"><label>日志级别</label><select id="nx-s-log">' +
                ['debug', 'info', 'warning', 'error'].map(function (l) {
                    return '<option value="' + l + '"' + (s.log_level === l ? ' selected' : '') + '>' + l + '</option>';
                }).join('') + '</select></div>' +
                '<div class="nx-field"><label>hysteria 证书</label><input type="text" id="nx-s-cert" value="' + esc(s.cert_path || '') + '"></div>' +
                '<div class="nx-field"><label>hysteria 私钥</label><input type="text" id="nx-s-key" value="' + esc(s.key_path || '') + '"></div>' +
                '<div class="nx-field"><label></label><button class="nx-btn primary" onclick="window.nodexSaveSystem()">保存</button></div>' +
                '<div class="nx-field"><span class="hint">修改内核路径/证书后需重启后端生效</span></div>' +
                '</div></div>' +
                '<div class="nx-card"><h3>修改管理密码</h3><div class="nx-form">' +
                '<div class="nx-field"><label>新密码</label><input type="password" id="nx-pwd" autocomplete="new-password"></div>' +
                '<div class="nx-field"><label></label><button class="nx-btn" onclick="window.nodexChangePwd()">修改密码</button></div>' +
                '</div></div>';
            loadCoreInfo();
        }).catch(function (e) { el.innerHTML = '<div class="nx-hint">' + esc(e.message) + '</div>'; });
    }

    function loadCoreInfo() {
        ['xray', 'hysteria'].forEach(function (kind) {
            var el = document.getElementById('nx-core-' + (kind === 'xray' ? 'xray' : 'hy'));
            if (!el) return;
            api('/core/info?type=' + kind).then(function (info) {
                var name = kind === 'xray' ? 'xray' : 'hysteria';
                if (info.installed) {
                    el.innerHTML = '<span class="nx-tag ok">' + esc(info.version || '已安装') + '</span>' +
                        ' <button class="nx-btn sm" onclick="window.nodexUpdateCore(\'' + kind + '\')">更新</button>';
                } else {
                    el.innerHTML = '<span class="nx-tag err">未安装</span>' +
                        ' <button class="nx-btn sm primary" onclick="window.nodexUpdateCore(\'' + kind + '\')">下载</button>';
                }
            }).catch(function () {
                el.innerHTML = '<span class="nx-tag off">未知</span>';
            });
        });
    }

    window.nodexUpdateCore = function (kind) {
        var name = kind === 'xray' ? 'xray' : 'hysteria';
        if (!confirm('将下载最新版 ' + name + ' 核心并替换（节点会短暂重启），继续？')) return;
        api('/core/update', { body: { type: kind } }).then(function (res) {
            msg(name + ' 已更新至 ' + (res.version || '最新版'), true);
            loadCoreInfo();
        }).catch(function (e) {
            msg(e.message || '更新失败', false);
        });
    };

    window.nodexSaveSystem = function () {
        api('/config').then(function (c) {
            c.system.xray_path = document.getElementById('nx-s-xray').value;
            c.system.hysteria_path = document.getElementById('nx-s-hy').value;
            c.system.log_level = document.getElementById('nx-s-log').value;
            c.system.cert_path = document.getElementById('nx-s-cert').value;
            c.system.key_path = document.getElementById('nx-s-key').value;
            return api('/config', { method: 'PUT', body: c });
        }).then(function () { msg('已保存（重启后端后生效）', true); })
            .catch(function (e) { msg(e.message || '保存失败', false); });
    };

    window.nodexChangePwd = function () {
        var pwd = document.getElementById('nx-pwd').value;
        if (pwd.length < 6) { msg('密码至少 6 位', false); return; }
        api('/config').then(function (c) {
            c.web.password = pwd;
            return api('/config', { method: 'PUT', body: c });
        }).then(function () { msg('密码已修改', true); document.getElementById('nx-pwd').value = ''; })
            .catch(function (e) { msg(e.message || '修改失败', false); });
    };

    // ---------- 日志 ----------
    var logTimer = null;

    function renderLogs() {
        var el = document.getElementById('nodex-content');
        if (logTimer) { clearInterval(logTimer); logTimer = null; }
        api('/status').then(function (st) {
            var nodes = st.nodes || [];
            var sel = '<select id="nx-log-node">' + nodes.map(function (n) {
                return '<option value="' + n.id + '">' + esc(n.name) + '</option>';
            }).join('') + '</select>';
            var typeSel = '<select id="nx-log-type"><option value="error">错误日志</option><option value="access">访问日志</option></select>';
            el.innerHTML =
                '<div class="nx-card"><h3>运行日志<span class="nx-h3-side" id="nx-log-info"></span></h3>' +
                '<div class="nx-logbar">' +
                sel + typeSel +
                '<button class="nx-btn sm" onclick="window.nodexLoadLogs()">刷新</button>' +
                '<label style="font-size:12.5px;color:var(--nx-muted);display:flex;align-items:center;gap:6px;cursor:pointer">' +
                '<input type="checkbox" id="nx-log-auto" checked style="accent-color:var(--nx-accent)">自动刷新</label>' +
                '</div>' +
                '<pre class="nx-pre" id="nx-log-pre">（加载中...）</pre></div>';
            window.nodexLoadLogs();
            logTimer = setInterval(function () {
                if (document.getElementById('nx-log-pre') && document.getElementById('nx-log-auto').checked) window.nodexLoadLogs();
            }, 8000);
        }).catch(function (e) { el.innerHTML = '<div class="nx-hint">' + esc(e.message) + '</div>'; });
    }

    window.nodexLoadLogs = function () {
        var node = document.getElementById('nx-log-node');
        if (!node || !node.value) return;
        var type = document.getElementById('nx-log-type').value;
        api('/logs?node=' + node.value + '&type=' + type).then(function (res) {
            var pre = document.getElementById('nx-log-pre');
            var info = document.getElementById('nx-log-info');
            var raw = res.logs || '';
            var lines = raw.split('\n').filter(function (l) { return l.trim() !== ''; });
            if (info) info.textContent = '共 ' + lines.length + ' 行';
            var html = lines.map(function (l) {
                var cls = 'lg-info';
                if (/ERROR|FATAL|failed|refused|rejected/i.test(l)) cls = 'lg-err';
                else if (/WARN|Warning|deprecated/i.test(l)) cls = 'lg-warn';
                l = l.replace(/^([0-9]{4}[\/-][0-9]{2}[\/-][0-9]{2}[ T][0-9:.+]{6,})/, '<span class="lg-time">$1</span>');
                return '<span class="' + cls + '">' + esc(l) + '</span>';
            }).join('\n');
            pre.innerHTML = html || '<span style="color:#64788f">（暂无日志）</span>';
            pre.scrollTop = pre.scrollHeight;
        }).catch(function (e) {
            var pre = document.getElementById('nx-log-pre');
            if (pre) pre.innerHTML = '<span style="color:#f07171">' + esc(e.message) + '</span>';
        });
    };

    // ---------- 路由 ----------
    window.nodexGo = function (page) {
        if (page !== 'logs' && logTimer) { clearInterval(logTimer); logTimer = null; }
        document.querySelectorAll('.nx-nav-item').forEach(function (a) {
            a.classList.toggle('active', a.dataset.page === page);
        });
        if (page === 'nodes') renderNodes();
        else if (page === 'panel') renderPanel();
        else if (page === 'system') renderSystem();
        else if (page === 'logs') renderLogs();
        else renderOverview();
    };

    window.nodexGoEdit = function (id) {
        renderNodeEdit(id);
    };

    function route() {
        var hash = location.hash.replace(/^#\/?/, '');
        var parts = hash.split('/');
        var page = parts[0] || 'overview';
        if (page === 'nodeedit' && parts[1]) { renderNodeEdit(parts[1]); return; }
        window.nodexGo(page);
    }

    window.addEventListener('hashchange', route);
    document.addEventListener('DOMContentLoaded', function () {
        renderBackend();
        route();
    });
})();
