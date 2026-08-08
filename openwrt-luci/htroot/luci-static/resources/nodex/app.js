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
        return fetch(API + path, init).then(function (r) { return r.json().catch(function () { return {}; }); });
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

            var rows = nodes.map(function (n) {
                return '<tr>' +
                    '<td>' + tag(n.xray && n.xray.running, (n.xray && n.xray.running) ? '运行中' : '已停止') + ' <b>' + esc(n.name) + '</b> <span style="color:#999">' + esc(n.id) + '</span></td>' +
                    '<td>' + esc(n.xray ? n.xray.version.split(' ')[0] : '-') + '</td>' +
                    '<td>' + (n.hy2 && n.hy2.running ? tag(true, '运行中') : tag(false, '停止')) + '</td>' +
                    '<td>' + (n.panel && n.panel.lastError ? '<span class="nodex-tag nodex-tag-err" title="' + esc(n.panel.lastError) + '">错误</span>' : '<span class="nodex-tag nodex-tag-ok">正常</span>') + '</td>' +
                    '<td>' + esc((n.panel && n.panel.lastSync) || '-') + '</td>' +
                    '<td><button class="nodex-btn" onclick="window.nodexRestart(\'' + n.id + '\')">重启</button>' +
                    '<a class="nodex-btn" href="#nodeedit/' + n.id + '">配置</a></td>' +
                    '</tr>';
            }).join('');

            el.innerHTML =
                '<div class="nodex-card"><h3>总览</h3>' +
                '<table class="nodex-table"><tr><th>节点数</th><th>运行中</th><th>在线用户</th><th>总流量</th></tr>' +
                '<tr><td>' + nodes.length + '</td><td>' + (st.running || 0) + '</td><td>' + online + '</td><td>' + fmtBytes(total) + '</td></tr></table></div>' +
                '<div class="nodex-card"><h3>节点状态</h3>' +
                '<table class="nodex-table"><tr><th>节点</th><th>Xray</th><th>Hysteria2</th><th>面板同步</th><th>上次同步</th><th>操作</th></tr>' +
                (rows || '<tr><td colspan="6">暂无节点</td></tr>') + '</table></div>' +
                '<div class="nodex-card"><h3>用户流量</h3>' +
                '<table class="nodex-table"><tr><th>节点</th><th>用户</th><th>流量</th><th>在线 IP</th></tr>' +
                (users.map(function (u) {
                    return '<tr><td>' + esc(u.node_name || '-') + '</td><td>' + esc(u.uid) + '</td><td>' + fmtBytes(u.traffic) + '</td><td>' + esc((u.ips || []).join(', ') || '-') + '</td></tr>';
                }).join('') || '<tr><td colspan="4">暂无数据</td></tr>') + '</table></div>';
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
            var rows = nodes.map(function (n) {
                return '<tr>' +
                    '<td>' + tag(n.enabled && n.xray && n.xray.running, n.enabled ? ((n.xray && n.xray.running) ? '运行中' : '已停止') : '已禁用') + ' <b>' + esc(n.name) + '</b> <span style="color:#999">' + esc(n.id) + '</span></td>' +
                    '<td>' + (n.xray && n.xray.running ? '运行中' : '已停止') + '</td>' +
                    '<td>' + (n.hy2 && n.hy2.running ? '运行中' : '已停止') + '</td>' +
                    '<td><a class="nodex-btn" href="#nodeedit/' + n.id + '">编辑</a>' +
                    '<button class="nodex-btn nodex-btn-danger" onclick="window.nodexDelNode(\'' + n.id + '\',\'' + esc(n.name).replace(/'/g, "\\'") + '\')">删除</button></td>' +
                    '</tr>';
            }).join('');
            el.innerHTML =
                '<div class="nodex-card"><h3>节点管理</h3>' +
                '<div style="margin-bottom:10px"><button class="nodex-btn nodex-btn-primary" onclick="window.nodexAddNode()">新增节点</button></div>' +
                '<table class="nodex-table"><tr><th>节点</th><th>Xray</th><th>Hysteria2</th><th>操作</th></tr>' +
                (rows || '<tr><td colspan="4">暂无节点</td></tr>') + '</table></div>';
        }).catch(function (e) { el.innerHTML = '<div class="nodex-err">' + esc(e.message) + '</div>'; });
    }

    window.nodexAddNode = function () {
        api('/config').then(function (cfg) {
            cfg.nodes = cfg.nodes || [];
            cfg.nodes.push({
                id: 'n' + Math.random().toString(16).slice(2, 6),
                name: '新节点' + (cfg.nodes.length + 1),
                enabled: true,
                node: {
                    protocol: 'vless', port: 8686, uuid: '', tls: 0, cert_path: '', key_path: '', server_name: '',
                    reality: { dest: 'www.amazon.com:443', server_names: 'www.amazon.com', private_key: '', public_key: '', short_ids: '' },
                    hy2: { port: 9443, password: '', obfs: 'none', obfs_password: '', up_mbps: 100, down_mbps: 1000, ignore_bw: false, cert_path: '', key_path: '' },
                    ss_method: '2022-blake3-aes-128-gcm'
                }
            });
            return api('/config', { method: 'PUT', body: cfg });
        }).then(function () { notify('节点已创建', true); renderNodes(); })
            .catch(function (e) { notify(e.message || '创建失败', false); });
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
            var node = (cfg.nodes || []).filter(function (n) { return n.id === id; })[0];
            if (!node) { el.innerHTML = '<div class="nodex-err">节点不存在</div>'; return; }

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

            if (proto !== 'hysteria2') {
                fields += f('监听端口', 'node.port', 'number', node.node.port);
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
                    }
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
                fields += f('监听端口', 'node.hy2.port', 'number', node.node.hy2.port);
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

            el.innerHTML =
                '<div class="nodex-card"><h3>节点编辑：' + esc(node.name) + ' <a class="nodex-btn" href="#nodes">返回</a></h3>' +
                '<div class="nodex-field"><label>节点名称</label><input type="text" id="nx-name" value="' + esc(node.name) + '"></div>' +
                '<div class="nodex-field"><label>启用节点</label><input type="checkbox" id="nx-enabled"' + (node.enabled ? ' checked' : '') + '></div></div>' +
                '<div class="nodex-card"><h3>协议</h3><div>' + protoBtns + '</div></div>' +
                '<div class="nodex-card"><h3>协议配置</h3>' + fields +
                '<div style="margin-top:12px">' +
                '<button class="nodex-btn nodex-btn-primary" onclick="window.nodexSaveNode(\'' + id + '\',false)">保存配置</button> ' +
                '<button class="nodex-btn" onclick="window.nodexSaveNode(\'' + id + '\',true)">保存并重启</button></div></div>';
        }).catch(function (e) { el.innerHTML = '<div class="nodex-err">' + esc(e.message) + '</div>'; });
    }

    window.nodexSetProto = function (id, proto) {
        api('/config').then(function (cfg) {
            var node = (cfg.nodes || []).filter(function (n) { return n.id === id; })[0];
            if (node) { node.node.protocol = proto; return api('/config', { method: 'PUT', body: cfg }); }
        }).then(function () { renderNodeEdit(id); });
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
        api('/config').then(function (c) {
            cfg = c;
            var node = cfg.nodes.filter(function (n) { return n.id === id; })[0];
            if (!node) throw new Error('节点不存在');
            node.name = document.getElementById('nx-name').value;
            node.enabled = document.getElementById('nx-enabled').checked;
            document.querySelectorAll('#nodex-content [data-key]').forEach(function (el) {
                var key = el.dataset.key;
                var v;
                if (el.type === 'checkbox') v = el.checked;
                else if (el.type === 'number') v = parseInt(el.value, 10) || 0;
                else v = el.value;
                var parts = key.split('.');
                var cur = node;
                for (var i = 1; i < parts.length - 1; i++) cur = cur[parts[i]];
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
                '<div class="nodex-field"><label>节点 ID</label><input type="number" id="nx-p-nodeid" value="' + esc(p.node_id || 0) + '"></div>' +
                '<div class="nodex-field"><label>节点类型</label><select id="nx-p-type">' +
                '<option value="">自动（推荐）</option>' +
                ['vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria'].map(function (t) {
                    return '<option value="' + t + '"' + (p.node_type === t ? ' selected' : '') + '>' + t + '</option>';
                }).join('') + '</select></div>' +
                '<div class="nodex-field"><label>拉取/上报间隔</label>' +
                '<input type="number" id="nx-p-pull" value="' + esc(p.pull_interval || 60) + '" style="width:80px"> / ' +
                '<input type="number" id="nx-p-push" value="' + esc(p.push_interval || 60) + '" style="width:80px"> 秒</div>' +
                '<div style="margin-top:12px">' +
                '<button class="nodex-btn nodex-btn-primary" onclick="window.nodexSavePanel()">保存配置</button> ' +
                '<button class="nodex-btn" onclick="window.nodexTestPanel()">测试面板连接</button></div></div>';
        });
    }

    window.nodexSavePanel = function () {
        api('/config').then(function (c) {
            c.panel = {
                enabled: document.getElementById('nx-p-enabled').checked,
                url: document.getElementById('nx-p-url').value,
                token: document.getElementById('nx-p-token').value,
                node_id: parseInt(document.getElementById('nx-p-nodeid').value, 10) || 0,
                node_type: document.getElementById('nx-p-type').value,
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
            token: document.getElementById('nx-p-token').value,
            node_id: parseInt(document.getElementById('nx-p-nodeid').value, 10) || 0,
            node_type: document.getElementById('nx-p-type').value
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
                '<div class="nodex-field"><label>xray 路径</label><input type="text" id="nx-s-xray" value="' + esc(s.xray_path || '') + '"></div>' +
                '<div class="nodex-field"><label>hysteria 路径</label><input type="text" id="nx-s-hy" value="' + esc(s.hysteria_path || '') + '"></div>' +
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
        });
    }

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
        });
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
    function route() {
        var hash = location.hash.replace(/^#\/?/, '');
        var parts = hash.split('/');
        var page = parts[0] || 'overview';

        document.querySelectorAll('.nodex-menu-item').forEach(function (a) {
            a.className = 'nodex-menu-item' + (a.dataset.page === page ? ' active' : '');
        });

        if (page === 'nodes') renderNodes();
        else if (page === 'nodeedit' && parts[1]) renderNodeEdit(parts[1]);
        else if (page === 'panel') renderPanel();
        else if (page === 'system') renderSystem();
        else if (page === 'logs') renderLogs();
        else renderOverview();
    }

    window.addEventListener('hashchange', route);
    document.addEventListener('DOMContentLoaded', route);
})();
