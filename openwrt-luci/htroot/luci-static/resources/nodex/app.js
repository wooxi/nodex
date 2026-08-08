// NodeX LuCI 前端（独立 JS，无框架依赖）
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
            return r.json().catch(function () {
                // 非 JSON：通常是 LuCI 会话过期返回登录页，自动刷新去重新登录
                setTimeout(function () { location.reload(); }, 500);
                throw new Error('LuCI 会话已过期，正在跳转登录...');
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

    function tag(ok, text) {
        return '<span class="nodex-tag ' + (ok ? 'nodex-tag-ok' : 'nodex-tag-err') + '">' + esc(text) + '</span>';
    }

    function notify(msg, ok) {
        var box = document.getElementById('nodex-content');
        var d = document.createElement('div');
        d.className = ok ? 'nodex-ok' : 'nodex-err';
        d.textContent = msg;
        box.parentNode.insertBefore(d, box);
        setTimeout(function () { d.remove(); }, 5000);
    }

    var PROTOCOLS = [
        { value: 'vless', label: 'VLESS' },
        { value: 'vmess', label: 'VMess' },
        { value: 'trojan', label: 'Trojan' },
        { value: 'shadowsocks', label: 'SS' },
        { value: 'hysteria2', label: 'Hysteria2' }
    ];

    // ---------- 后端状态 ----------
    function renderBackend() {
        var el = document.getElementById('nodex-content');
        var card = document.createElement('div');
        card.className = 'nodex-card';
        card.id = 'nx-backend-card';
        card.innerHTML = '<h3>后端状态</h3><div style="color:#999">检测中...</div>';
        el.appendChild(card);
        fetch('/cgi-bin/luci/admin/services/nodex/backend/status').then(function (r) { return r.json(); }).then(function (b) {
            function bin(ok, name) { return '<span class="nodex-tag ' + (ok ? 'nodex-tag-ok' : 'nodex-tag-err') + '">' + (ok ? '已安装' : '缺失') + '</span> ' + esc(name); }
            var runTag = b.nodex_running ? '<span class="nodex-tag nodex-tag-ok">运行中</span>' : '<span class="nodex-tag nodex-tag-err">未运行</span>';
            var installBtn = (b.nodex_bin && b.xray_bin && b.hysteria_bin)
                ? '<button class="nodex-btn" onclick="window.nodexRestartBackend()">重启后端</button>'
                : '<button class="nodex-btn nodex-btn-primary" onclick="window.nodexInstallBackend()">下载并安装后端</button>';
            card.innerHTML =
                '<h3>后端状态</h3>' +
                '<table class="nodex-table"><tr><th>组件</th><th>状态</th></tr>' +
                '<tr><td>nodex 守护进程</td><td>' + bin(b.nodex_bin, '/usr/bin/nodex') + ' ' + runTag + '</td></tr>' +
                '<tr><td>xray 内核</td><td>' + bin(b.xray_bin, '/usr/bin/xray') + '</td></tr>' +
                '<tr><td>hysteria 内核</td><td>' + bin(b.hysteria_bin, '/usr/bin/hysteria') + '</td></tr>' +
                '</table>' +
                '<div style="margin-top:10px">' + installBtn + '</div>' +
                (b.nodex_bin && !b.nodex_running ? '<div class="nodex-err" style="margin-top:6px">后端未运行，可点击上方按钮或 SSH 执行 /etc/init.d/nodex start</div>' : '');
        }).catch(function () {
            card.innerHTML = '<h3>后端状态</h3><div class="nodex-err">无法检测后端状态</div>';
        });
    }

    window.nodexInstallBackend = function () {
        if (!confirm('将下载并安装 nodex 守护进程 + xray + hysteria 内核（约 70MB），继续？')) return;
        fetch('/cgi-bin/luci/admin/services/nodex/backend/install').then(function (r) { return r.json(); }).then(function (res) {
            notify(res.message || '安装已启动', true);
            setTimeout(function () { renderBackend(); }, 30000);
        }).catch(function (e) { notify(e.message || '启动失败', false); });
    };

    window.nodexRestartBackend = function () {
        fetch('/cgi-bin/luci/admin/services/nodex/backend/restart').then(function (r) { return r.json(); }).then(function (res) {
            notify(res.message || '已重启', true);
            setTimeout(function () { renderBackend(); location.reload(); }, 3000);
        }).catch(function (e) { notify(e.message || '重启失败', false); });
    };

    // ---------- 总览 ----------
    function renderOverview() {
        var el = document.getElementById('nodex-content');
        el.innerHTML = '<div style="color:#999">加载中...</div>';
        renderBackend();
        Promise.all([api('/status'), api('/users')]).then(function (res) {
            var st = res[0], users = res[1].users || [];
            var nodes = st.nodes || [];
            var total = users.reduce(function (s, u) { return s + (u.traffic || 0); }, 0);
            var online = users.filter(function (u) { return u.ips && u.ips.length; }).length;

            function protoTag(p) {
                var map = { vless: 'VLESS', vmess: 'VMess', trojan: 'Trojan', shadowsocks: 'SS', hysteria2: 'Hysteria2' };
                return '<span class="nodex-tag nodex-tag-off">' + (map[p] || esc(p || '未知')) + '</span>';
            }
            function nodeState(n) {
                var ok = (n.xray && n.xray.running) || (n.hy2 && n.hy2.running);
                return ok ? tag(true, '正常') : tag(false, '停止');
            }
            // 面板同步（公共项，聚合显示）
            var panelErrs = nodes.filter(function (n) { return n.panel && n.panel.lastError; });
            var panelOk = nodes.length > 0 && panelErrs.length === 0;
            var lastSync = '';
            nodes.forEach(function (n) { if (n.panel && n.panel.lastSync) lastSync = n.panel.lastSync; });
            var panelHtml = nodes.length === 0
                ? '<span class="nodex-tag nodex-tag-off">未配置</span>'
                : (panelOk
                    ? '<span class="nodex-tag nodex-tag-ok">正常</span>'
                    : '<span class="nodex-tag nodex-tag-err" title="' + esc(panelErrs.map(function (n) { return n.name + ': ' + n.panel.lastError; }).join('\n')) + '">错误</span>');

            function coreVer(n) {
                var v = '';
                if (n.protocol === 'hysteria2') { v = n.hy2 && n.hy2.version ? n.hy2.version : ''; }
                else { v = n.xray && n.xray.version ? n.xray.version : ''; }
                return '<span style="color:#999;font-size:12px">' + esc(v.split(' ')[0]) + '</span>';
            }
            var rows = nodes.map(function (n) {
                return '<tr>' +
                    '<td><b>' + esc(n.name) + '</b></td>' +
                    '<td>' + protoTag(n.protocol) + ' ' + coreVer(n) + '</td>' +
                    '<td>' + (n.enabled ? nodeState(n) : tag(false, '已禁用')) + '</td>' +
                    '<td><button class="nodex-btn" onclick="window.nodexRestart(\'' + n.id + '\')">重启</button>' +
                    '<a class="nodex-btn" href="#nodeedit/' + n.id + '">配置</a></td>' +
                    '</tr>';
            }).join('');

            el.innerHTML =
                '<div class="nodex-card"><h3>总览</h3>' +
                '<table class="nodex-table"><tr><th>节点数</th><th>运行中</th><th>在线用户</th><th>总流量</th></tr>' +
                '<tr><td>' + nodes.length + '</td><td>' + (st.running || 0) + '</td><td>' + online + '</td><td>' + fmtBytes(total) + '</td></tr></table></div>' +
                '<div class="nodex-card"><h3>面板同步</h3>' +
                '<table class="nodex-table"><tr><th>状态</th><th>上次同步</th></tr>' +
                '<tr><td>' + panelHtml + '</td><td>' + esc(lastSync || '-') + '</td></tr></table></div>' +
                '<div class="nodex-card"><h3>节点状态</h3>' +
                '<table class="nodex-table"><tr><th>节点</th><th>节点类型</th><th>节点状态</th><th>操作</th></tr>' +
                (rows || '<tr><td colspan="4">暂无节点</td></tr>') + '</table></div>' +
                '<div class="nodex-card"><h3>用户流量</h3>' +
                '<table class="nodex-table"><tr><th>节点</th><th>用户</th><th>流量</th><th>在线 IP</th></tr>' +
                (users.map(function (u) {
                    return '<tr><td>' + esc(u.node_name || '-') + '</td><td>' + esc(u.uid) + '</td><td>' + fmtBytes(u.traffic) + '</td><td>' + esc((u.ips || []).join(', ') || '-') + '</td></tr>';
                }).join('') || '<tr><td colspan="4" style="color:#999">暂无流量数据（用户连接节点后自动统计）</td></tr>') + '</table></div>';
        }).catch(function (e) { el.innerHTML = '<div class="nodex-err">加载失败: ' + esc(e.message) + '</div>'; });
    }

    window.nodexRestart = function (id) {
        api('/action', { body: { action: 'restart', node_id: id } }).then(function () {
            notify('节点已重启', true);
            setTimeout(renderOverview, 2000);
        });
    };

    // ---------- 节点管理 ----------
    function renderNodes() {
        var el = document.getElementById('nodex-content');
        el.innerHTML = '<div style="color:#999">加载中...</div>';
        api('/status').then(function (st) {
            var nodes = st.nodes || [];
            function protoTag(p) {
                var map = { vless: 'VLESS', vmess: 'VMess', trojan: 'Trojan', shadowsocks: 'SS', hysteria2: 'Hysteria2' };
                return '<span class="nodex-tag nodex-tag-off">' + (map[p] || esc(p || '未知')) + '</span>';
            }
            function nodeState(n) {
                var ok = (n.xray && n.xray.running) || (n.hy2 && n.hy2.running);
                return ok ? tag(true, '正常') : tag(false, '停止');
            }
            var rows = nodes.map(function (n) {
                return '<tr>' +
                    '<td><b>' + esc(n.name) + '</b></td>' +
                    '<td>' + protoTag(n.protocol) + '</td>' +
                    '<td>' + (n.enabled ? nodeState(n) : tag(false, '已禁用')) + '</td>' +
                    '<td><a class="nodex-btn" href="#nodeedit/' + n.id + '">编辑</a>' +
                    '<button class="nodex-btn nodex-btn-danger" onclick="window.nodexDelNode(\'' + n.id + '\',\'' + esc(n.name).replace(/'/g, "\\'") + '\')">删除</button></td>' +
                    '</tr>';
            }).join('');
            el.innerHTML =
                '<div class="nodex-card"><h3>节点管理</h3>' +
                '<div style="margin-bottom:10px"><button class="nodex-btn nodex-btn-primary" onclick="window.nodexAddNode()">新增节点</button></div>' +
                '<table class="nodex-table"><tr><th>节点</th><th>节点类型</th><th>节点状态</th><th>操作</th></tr>' +
                (rows || '<tr><td colspan="4">暂无节点</td></tr>') + '</table></div>';
        }).catch(function (e) { el.innerHTML = '<div class="nodex-err">' + esc(e.message) + '</div>'; });
    }

    window.nodexAddNode = function () {
        // 创建默认节点并跳转到编辑页
        api('/config').then(function (cfg) {
            cfg.nodes = cfg.nodes || [];
            var node = {
                id: 'n' + Math.random().toString(16).slice(2, 6),
                name: '新节点' + (cfg.nodes.length + 1),
                enabled: true,
                node_id: 1,
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
                // 跳转到新节点编辑页
                window.nodexGoEdit(node.id);
            });
        }).catch(function (e) { notify(e.message || '创建失败', false); });
    };

    window.nodexDelNode = function (id, name) {
        if (!confirm('确定删除节点「' + name + '」？')) return;
        api('/config').then(function (cfg) {
            cfg.nodes = (cfg.nodes || []).filter(function (x) { return x.id !== id; });
            return api('/config', { method: 'PUT', body: cfg });
        }).then(function () { notify('已删除', true); renderNodes(); })
            .catch(function (e) { notify(e.message || '删除失败', false); });
    };

    // ---------- 节点编辑 ----------
    function renderNodeEdit(id) {
        var el = document.getElementById('nodex-content');
        el.innerHTML = '<div style="color:#999">加载中...</div>';
        api('/config').then(function (cfg) {
            window.nodexGlobalPanel = cfg.panel || {};
            var node = (cfg.nodes || []).filter(function (n) { return n.id === id; })[0];
            if (!node) { el.innerHTML = '<div class="nodex-err">节点不存在</div>'; return; }
            window.nodexEditNode = node;
            renderNodeEditForm(node);
        }).catch(function (e) { el.innerHTML = '<div class="nodex-err">' + esc(e.message) + '</div>'; });
    }

    function renderNodeEditForm(node) {
        var el = document.getElementById('nodex-content');
        var id = node.id;
            var proto = node.node.protocol;
            var protoBtns = PROTOCOLS.map(function (p) {
                return '<span class="nodex-proto' + (p.value === proto ? ' active' : '') + '" onclick="window.nodexSetProto(\'' + id + '\',\'' + p.value + '\')">' + p.label + '</span>';
            }).join('');

            var fields = '';
            function f(label, key, type, val, gen) {
                var v = val == null ? '' : val;
                var input = '';
                if (type === 'number') input = '<input type="number" data-key="' + key + '" value="' + esc(v) + '">';
                else if (type === 'checkbox') input = '<input type="checkbox" data-key="' + key + '"' + (v ? ' checked' : '') + '>';
                else if (type === 'select') {
                    var opts = arguments[5] || [];
                    input = '<select data-key="' + key + '">' + opts.map(function (o) {
                        return '<option value="' + esc(o.value) + '"' + (String(v) === String(o.value) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
                    }).join('') + '</select>';
                }
                else input = '<input type="text" data-key="' + key + '" value="' + esc(v) + '">';
                var btn = gen ? '<button class="nodex-btn" onclick="window.nodexGen(\'' + id + '\',\'' + gen + '\',\'' + key + '\')">生成</button>' : '';
                return '<div class="nodex-field"><label>' + esc(label) + '</label>' + input + ' ' + btn + '</div>';
            }

            var panelEnabled = window.nodexGlobalPanel && window.nodexGlobalPanel.enabled;
            if (proto !== 'hysteria2') {
                // 面板模式下端口自动同步面板，不显示端口选项
                if (!panelEnabled) {
                    fields += f('监听端口', 'node.port', 'number', node.node.port);
                }
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
                            fields += '<div class="nodex-field"><label>公钥</label><code>' + esc(node.node.reality.public_key) + '</code></div>';
                        }
                        fields += f('Short IDs', 'node.reality.short_ids', 'text', node.node.reality.short_ids);
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
                    fields += f('证书路径', 'node.cert_path', 'text', node.node.cert_path);
                    fields += f('私钥路径', 'node.key_path', 'text', node.node.key_path);
                    fields += f('SNI (serverName)', 'node.server_name', 'text', node.node.server_name);
                    fields += '<div class="nodex-field"><label></label><span style="color:#999;font-size:12px">Trojan 需启用 TLS，用户密码由面板 UUID 自动生成</span></div>';
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
                // 面板模式下 hy2 端口自动同步面板，不显示端口选项
                if (!panelEnabled) {
                    fields += f('监听端口', 'node.hy2.port', 'number', node.node.hy2.port);
                }
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

            var nodeIdInput = '<input type="number" id="nx-nodeid" value="' + esc(node.node_id || 0) + '" style="width:100px">';
            var nodeTypeSel = '<select id="nx-nodetype">' +
                '<option value="">自动（推荐）</option>' +
                [['vless', 'vless'], ['vmess', 'vmess'], ['trojan', 'trojan'], ['shadowsocks', 'shadowsocks'], ['hysteria', 'hysteria2']].map(function (t) {
                    return '<option value="' + t[0] + '"' + (node.node_type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
                }).join('') + '</select>';

            el.innerHTML =
                '<div class="nodex-card"><h3>节点编辑：' + esc(node.name) + ' <a class="nodex-btn" href="javascript:void(0)" onclick="window.nodexGo(\'nodes\')">返回</a></h3>' +
                '<div class="nodex-field"><label>节点名称</label><input type="text" id="nx-name" value="' + esc(node.name) + '"></div>' +
                '<div class="nodex-field"><label>启用节点</label><input type="checkbox" id="nx-enabled"' + (node.enabled ? ' checked' : '') + '></div></div>' +
                '<div class="nodex-card"><h3>面板对接（本节点）</h3>' +
                '<div class="nodex-field"><label>面板节点 ID</label>' + nodeIdInput + '</div>' +
                '<div class="nodex-field"><label>节点类型</label>' + nodeTypeSel + '</div>' +
                '<div class="nodex-field"><label></label><button class="nodex-btn" onclick="window.nodexTestNodePanel(\'' + id + '\')">测试面板连接</button></div>' +
                '<div style="color:#999;font-size:12px;margin-top:4px">提示：面板模式下监听端口、传输网络均自动同步面板节点配置</div></div>' +
                '<div class="nodex-card"><h3>协议</h3><div>' + protoBtns + '</div></div>' +
                '<div class="nodex-card"><h3>协议配置</h3>' + fields + '</div>' +
                '<div class="nodex-card"><h3>转发出站（XrayR 转发模式）</h3>' +
                '<div class="nodex-field"><label>启用转发</label><input type="checkbox" id="nx-fwd-enabled"' + ((node.forward && node.forward.enabled) ? ' checked' : '') + '></div>' +
                '<div class="nodex-field"><label>落地 UUID</label><input type="text" id="nx-fwd-uuid" value="' + esc((node.forward && node.forward.uuid) || '') + '" style="width:340px"></div>' +
                '<div class="nodex-field"><label>SNI</label><input type="text" id="nx-fwd-sni" value="' + esc((node.forward && node.forward.server_name) || '') + '" style="width:340px"></div>' +
                '<div class="nodex-field"><label>WS 路径</label><input type="text" id="nx-fwd-wspath" value="' + esc((node.forward && node.forward.ws_path) || '') + '" style="width:340px"></div>' +
                '<div class="nodex-field"><label>WS Host</label><input type="text" id="nx-fwd-wshost" value="' + esc((node.forward && node.forward.ws_host) || '') + '" style="width:340px"></div>' +
                '<div class="nodex-field"><label>目标服务器</label><textarea id="nx-fwd-targets" rows="5" style="width:340px;vertical-align:top;font-family:monospace;font-size:12px" placeholder="每行一个：IP 或 IP:端口 或 IP:端口:权重">' + esc((node.forward && node.forward.targets || []).map(function (t) { return t.address + (t.port ? ':' + t.port : '') + (t.weight && t.weight !== 1 ? ':' + t.weight : ''); }).join('\n')) + '</textarea></div>' +
                '<div style="color:#999;font-size:12px">启用后入站流量转发到落地节点（vless+ws+tls），代替直连；多目标自动负载均衡</div>' +
                '<div style="margin-top:12px">' +
                '<button class="nodex-btn nodex-btn-primary" onclick="window.nodexSaveNode(\'' + id + '\',false)">保存配置</button> ' +
                '<button class="nodex-btn" onclick="window.nodexSaveNode(\'' + id + '\',true)">保存并重启</button></div></div>';
    }

    window.nodexSetProto = function (id, proto) {
        // 本地切换协议（不闪屏）：保留当前表单值后重渲染
        if (window.nodexEditNode && window.nodexEditNode.id === id) {
            syncEditNodeFromForm();
            window.nodexEditNode.node.protocol = proto;
            renderNodeEditForm(window.nodexEditNode);
        }
    };

    function syncEditNodeFromForm() {
        var nameEl = document.getElementById('nx-name');
        var enEl = document.getElementById('nx-enabled');
        var nidEl = document.getElementById('nx-nodeid');
        var ntypeEl = document.getElementById('nx-nodetype');
        if (window.nodexEditNode && nameEl) {
            window.nodexEditNode.name = nameEl.value;
            window.nodexEditNode.enabled = enEl.checked;
            if (nidEl) window.nodexEditNode.node_id = parseInt(nidEl.value, 10) || 0;
            if (ntypeEl) window.nodexEditNode.node_type = ntypeEl.value;
            // 转发出站
            var fwd = window.nodexEditNode.forward || (window.nodexEditNode.forward = {});
            var fe = document.getElementById('nx-fwd-enabled');
            if (fe) {
                fwd.enabled = fe.checked;
                fwd.uuid = document.getElementById('nx-fwd-uuid').value;
                fwd.server_name = document.getElementById('nx-fwd-sni').value;
                fwd.ws_path = document.getElementById('nx-fwd-wspath').value;
                fwd.ws_host = document.getElementById('nx-fwd-wshost').value;
                fwd.fingerprint = fwd.fingerprint || 'chrome';
                // 解析目标列表：每行 IP 或 IP:port 或 IP:port:weight
                fwd.targets = [];
                var lines = document.getElementById('nx-fwd-targets').value.split('\n');
                lines.forEach(function (ln) {
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
            notify(res.message || '连接成功', true);
        }).catch(function (e) { notify(e.message || '连接失败', false); });
    };

    window.nodexGen = function (id, gen, key) {
        var req = { type: gen === 'reality' ? 'reality' : (gen === 'uuid' ? 'uuid' : (gen === 'hex8' ? 'hex' : 'password')) };
        if (gen === 'hex8') req.len = 8;
        api('/generate', { body: req }).then(function (res) {
            if (gen === 'reality') {
                api('/config').then(function (cfg) {
                    var node = (cfg.nodes || []).filter(function (n) { return n.id === id; })[0];
                    if (node) {
                        node.node.reality.private_key = res.privateKey;
                        node.node.reality.public_key = res.publicKey;
                        node.node.reality.short_ids = res.shortId;
                        return api('/config', { method: 'PUT', body: cfg });
                    }
                }).then(function () { notify('已生成密钥对', true); renderNodeEdit(id); });
            } else {
                var input = document.querySelector('[data-key="' + key + '"]');
                if (input) { input.value = res.value; notify('已生成', true); }
            }
        });
    };

    window.nodexSaveNode = function (id, restart) {
        var cfg = null;
        syncEditNodeFromForm();
        api('/config').then(function (c) {
            cfg = c;
            var idx = cfg.nodes.findIndex(function (n) { return n.id === id; });
            if (idx < 0) throw new Error('节点不存在');
            // 用本地编辑对象（含协议切换等未保存修改）
            var node = window.nodexEditNode && window.nodexEditNode.id === id
                ? JSON.parse(JSON.stringify(window.nodexEditNode))
                : cfg.nodes[idx];
            cfg.nodes[idx] = node;
            document.querySelectorAll('#nodex-content [data-key]').forEach(function (el) {
                var key = el.dataset.key;
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
            return api('/config', { method: 'PUT', body: cfg });
        }).then(function () {
            if (restart) {
                return api('/action', { body: { action: 'restart', node_id: id } }).then(function () { notify('已保存并重启', true); });
            }
            notify('配置已保存', true);
        }).catch(function (e) { notify(e.message || '保存失败', false); });
    };

    // ---------- 面板对接 ----------
    function renderPanel() {
        var el = document.getElementById('nodex-content');
        api('/config').then(function (cfg) {
            var p = cfg.panel || {};
            el.innerHTML =
                '<div class="nodex-card"><h3>面板对接（全局配置）</h3>' +
                '<div class="nodex-field"><label>启用面板对接</label><input type="checkbox" id="nx-p-enabled"' + (p.enabled ? ' checked' : '') + '></div>' +
                '<div class="nodex-field"><label>面板地址</label><input type="text" id="nx-p-url" value="' + esc(p.url || '') + '"></div>' +
                '<div class="nodex-field"><label>通信密钥</label><input type="text" id="nx-p-token" value="' + esc(p.token || '') + '"></div>' +
                '<div class="nodex-field"><label>拉取/上报间隔</label>' +
                '<input type="number" id="nx-p-pull" value="' + esc(p.pull_interval || 60) + '" style="width:80px"> / ' +
                '<input type="number" id="nx-p-push" value="' + esc(p.push_interval || 60) + '" style="width:80px"> 秒</div>' +
                '<div style="margin-top:12px">' +
                '<button class="nodex-btn nodex-btn-primary" onclick="window.nodexSavePanel()">保存配置</button> ' +
                '<button class="nodex-btn" onclick="window.nodexTestPanel()">测试面板连接</button></div></div>';
        }).catch(function (e) { el.innerHTML = '<div class="nodex-err">' + esc(e.message) + '</div>'; });
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
        }).then(function () { notify('配置已保存', true); })
            .catch(function (e) { notify(e.message || '保存失败', false); });
    };

    window.nodexTestPanel = function () {
        api('/nodes/test', { body: {
            url: document.getElementById('nx-p-url').value,
            token: document.getElementById('nx-p-token').value
        } }).then(function (res) {
            notify(res.message || '连接成功', true);
        }).catch(function (e) { notify(e.message || '连接失败', false); });
    };

    // ---------- 系统设置 ----------
    function renderSystem() {
        var el = document.getElementById('nodex-content');
        api('/config').then(function (cfg) {
            var s = cfg.system || {};
            el.innerHTML =
                '<div class="nodex-card"><h3>系统设置（全局）</h3>' +
                '<div class="nodex-field"><label>xray 路径</label><input type="text" id="nx-s-xray" value="' + esc(s.xray_path || '') + '"> <span id="nx-core-xray">检测中...</span></div>' +
                '<div class="nodex-field"><label>hysteria 路径</label><input type="text" id="nx-s-hy" value="' + esc(s.hysteria_path || '') + '"> <span id="nx-core-hy">检测中...</span></div>' +
                '<div class="nodex-field"><label>日志级别</label><select id="nx-s-log">' +
                ['debug', 'info', 'warning', 'error'].map(function (l) {
                    return '<option value="' + l + '"' + (s.log_level === l ? ' selected' : '') + '>' + l + '</option>';
                }).join('') + '</select></div>' +
                '<div class="nodex-field"><label>hysteria 证书</label><input type="text" id="nx-s-cert" value="' + esc(s.cert_path || '') + '"></div>' +
                '<div class="nodex-field"><label>hysteria 私钥</label><input type="text" id="nx-s-key" value="' + esc(s.key_path || '') + '"></div>' +
                '<div style="margin-top:12px"><button class="nodex-btn nodex-btn-primary" onclick="window.nodexSaveSystem()">保存</button></div></div>' +
                '<div class="nodex-card"><h3>修改管理密码</h3>' +
                '<div class="nodex-field"><label>新密码</label><input type="password" id="nx-pwd" style="width:280px"></div>' +
                '<button class="nodex-btn" onclick="window.nodexChangePwd()">修改密码</button></div>';
            loadCoreInfo();
        }).catch(function (e) { el.innerHTML = '<div class="nodex-err">' + esc(e.message) + '</div>'; });
    }

    function loadCoreInfo() {
        ['xray', 'hysteria'].forEach(function (kind) {
            var el = document.getElementById('nx-core-' + (kind === 'xray' ? 'xray' : 'hy'));
            if (!el) return;
            api('/core/info?type=' + kind).then(function (info) {
                var name = kind === 'xray' ? 'xray' : 'hysteria';
                if (info.installed) {
                    el.innerHTML = ' <span class="nodex-tag nodex-tag-ok">' + esc(info.version || '已安装') + '</span>' +
                        ' <button class="nodex-btn" onclick="window.nodexUpdateCore(\'' + kind + '\')">更新</button>';
                } else {
                    el.innerHTML = ' <span class="nodex-tag nodex-tag-err">未安装</span>' +
                        ' <button class="nodex-btn nodex-btn-primary" onclick="window.nodexUpdateCore(\'' + kind + '\')">下载</button>';
                }
            }).catch(function () {
                el.innerHTML = ' <span class="nodex-tag nodex-tag-err">未知</span>';
            });
        });
    }

    window.nodexUpdateCore = function (kind) {
        var name = kind === 'xray' ? 'xray' : 'hysteria';
        if (!confirm('将下载最新版 ' + name + ' 核心并替换（节点会短暂重启），继续？')) return;
        api('/core/update', { body: { type: kind } }).then(function (res) {
            notify(name + ' 已更新至 ' + (res.version || '最新版'), true);
            loadCoreInfo();
        }).catch(function (e) {
            notify(e.message || '更新失败', false);
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
        }).then(function () { notify('已保存（重启 nodex 后生效）', true); })
            .catch(function (e) { notify(e.message || '保存失败', false); });
    };

    window.nodexChangePwd = function () {
        var pwd = document.getElementById('nx-pwd').value;
        if (pwd.length < 6) { notify('密码至少 6 位', false); return; }
        api('/config').then(function (c) {
            c.web.password = pwd;
            return api('/config', { method: 'PUT', body: c });
        }).then(function () { notify('密码已修改', true); document.getElementById('nx-pwd').value = ''; })
            .catch(function (e) { notify(e.message || '修改失败', false); });
    };

    // ---------- 日志 ----------
    function renderLogs() {
        var el = document.getElementById('nodex-content');
        api('/status').then(function (st) {
            var nodes = st.nodes || [];
            var sel = '<select id="nx-log-node">' + nodes.map(function (n) {
                return '<option value="' + n.id + '">' + esc(n.name) + '</option>';
            }).join('') + '</select>';
            var typeSel = '<select id="nx-log-type"><option value="error">错误日志</option><option value="access">访问日志</option></select>';
            el.innerHTML =
                '<div class="nodex-card"><h3>运行日志</h3>' +
                '<div class="nodex-field"><label>节点</label>' + sel + ' ' + typeSel +
                ' <button class="nodex-btn" onclick="window.nodexLoadLogs()">刷新</button></div>' +
                '<pre class="nodex-pre" id="nx-log-pre">（加载中...）</pre></div>';
            window.nodexLoadLogs();
            setInterval(function () {
                if (document.getElementById('nx-log-pre')) window.nodexLoadLogs();
            }, 10000);
        }).catch(function (e) { el.innerHTML = '<div class="nodex-err">' + esc(e.message) + '</div>'; });
    }

    window.nodexLoadLogs = function () {
        var node = document.getElementById('nx-log-node');
        if (!node || !node.value) return;
        var type = document.getElementById('nx-log-type').value;
        api('/logs?node=' + node.value + '&type=' + type).then(function (res) {
            document.getElementById('nx-log-pre').textContent = res.logs || '（暂无日志）';
        });
    };

    // ---------- 路由 ----------
    window.nodexGo = function (page) {
        // 直接渲染（绕开 LuCI hash 路由拦截）
        document.querySelectorAll('.nodex-menu-item').forEach(function (a) {
            a.className = 'nodex-menu-item' + (a.dataset.page === page ? ' active' : '');
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

        document.querySelectorAll('.nodex-menu-item').forEach(function (a) {
            a.className = 'nodex-menu-item' + (a.dataset.page === page ? ' active' : '');
        });

        if (page === 'nodeedit' && parts[1]) { renderNodeEdit(parts[1]); return; }
        window.nodexGo(page);
    }

    window.addEventListener('hashchange', route);
    document.addEventListener('DOMContentLoaded', route);
})();
