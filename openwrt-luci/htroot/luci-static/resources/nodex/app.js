// NodeX LuCI 前端（LuCI 原生 cbi 风格，无框架）
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
                    throw new Error('API ' + r.status + ': ' + (t || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 120));
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

    function tag(ok, text) {
        return '<span style="color:' + (ok ? '#159b4d' : '#d23333') + ';font-weight:600">' + esc(text) + '</span>';
    }

    function notify(msg, ok) {
        var box = document.getElementById('nodex-content');
        if (!box) return;
        var d = document.createElement('div');
        d.className = 'nx-msg ' + (ok ? 'ok' : 'err');
        d.textContent = msg;
        box.insertBefore(d, box.firstChild);
        setTimeout(function () { d.remove(); }, 5000);
    }

    function protoTag(p) {
        var map = { vless: 'VLESS', vmess: 'VMess', trojan: 'Trojan', shadowsocks: 'SS', hysteria2: 'Hysteria2' };
        return '<span style="color:#1e88e5;font-weight:600">' + (map[p] || esc(p || '未知')) + '</span>';
    }

    function setActiveMenu(page) {
        document.querySelectorAll('#nodex-menu li').forEach(function (li) {
            li.className = li.dataset.page === page ? 'active' : '';
        });
    }

    // ================= 总览 =================
    function renderOverview() {
        var el = document.getElementById('nodex-content');
        el.innerHTML = '<div class="nx-empty">加载中...</div>';
        Promise.all([api('/status'), api('/users')]).then(function (res) {
            var st = res[0], users = res[1].users || [];
            var nodes = st.nodes || [];
            var total = users.reduce(function (s, u) { return s + (u.traffic || 0); }, 0);
            var online = users.filter(function (u) { return u.ips && u.ips.length; }).length;
            var running = st.running || 0;

            function nodeState(n) {
                if (!n.enabled) return '<span style="color:#999">已禁用</span>';
                var ok = (n.xray && n.xray.running) || (n.hy2 && n.hy2.running);
                return ok ? tag(true, '正常') : tag(false, '停止');
            }

            // 系统状态仪表盘（大框：统计 + 面板同步）
            var stats =
                '<div class="cbi-section cbi-section-node" style="margin-bottom:14px"><div class="cbi-section-node-tabbed"><div class="nx-dash">' +
                '<div class="nx-dash-item"><div class="num">' + nodes.length + '</div><div class="lbl">节点</div></div>' +
                '<div class="nx-dash-sep"></div>' +
                '<div class="nx-dash-item"><div class="num' + (running > 0 ? ' ok' : '') + '">' + running + '</div><div class="lbl">运行中</div></div>' +
                '<div class="nx-dash-sep"></div>' +
                '<div class="nx-dash-item"><div class="num' + (online > 0 ? ' ok' : '') + '">' + online + '</div><div class="lbl">在线用户</div></div>' +
                '<div class="nx-dash-sep"></div>' +
                '<div class="nx-dash-item"><div class="num">' + fmtBytes(total) + '</div><div class="lbl">总流量</div></div>' +
                '<div class="nx-dash-sync">' + esc(lastSync || '') + '</div>' +
                '</div></div></div>';

            // 内核总开关
            var xrayOn = nodes.filter(function (n) { return n.enabled && n.xray && n.xray.running; }).length;
            var hy2On = nodes.filter(function (n) { return n.enabled && n.hy2 && n.hy2.running; }).length;
            var enTotal = nodes.filter(function (n) { return n.enabled; }).length;
            function kstatus(on, total) {
                if (on === 0) return tag(false, '已停止');
                if (on === total) return tag(true, '运行中');
                return '<span style="color:#c47d14;font-weight:600">' + on + '/' + total + '</span>';
            }
            // 内核总开关（表格化，对齐紧凑）
            function krow(name, dots, status, stopAct, startAct) {
                return '<tr class="cbi-section-table-row">' +
                    '<td><b>' + name + '</b></td>' +
                    '<td style="white-space:nowrap">' + dots + '</td>' +
                    '<td>' + status + '</td>' +
                    '<td style="white-space:nowrap;text-align:right">' +
                    '<input type="button" class="cbi-button cbi-button-negative" style="margin-right:4px" value="停止" onclick="window.nodexKernel(\'' + stopAct + '\')">' +
                    '<input type="button" class="cbi-button cbi-button-positive" value="启动" onclick="window.nodexKernel(\'' + startAct + '\')">' +
                    '</td></tr>';
            }
            function kdots(kind) {
                return nodes.map(function (n) { return '<span class="nx-dot' + (n[kind] && n[kind].running ? ' on' : ' off') + '"></span>'; }).join(' ');
            }
            var kmaster =
                '<div class="cbi-section cbi-section-node" style="margin-bottom:14px"><div class="cbi-section-node-tabbed"><h3 style="margin:0 0 8px 0">内核总开关</h3>' +
                '<div class="nx-table-wrap"><table class="cbi-section-table">' +
                '<tr class="cbi-section-table-titles"><th>内核</th><th>节点状态</th><th>状态</th><th style="text-align:right">操作</th></tr>' +
                krow('Xray', kdots('xray'), kstatus(xrayOn, enTotal), 'stop-xray', 'start-xray') +
                krow('Hysteria2', kdots('hy2'), kstatus(hy2On, enTotal), 'stop-hy2', 'start-hy2') +
                '</table></div></div></div>';

            // 节点列表（名字/类型/状态/操作）
            var rows = nodes.map(function (n) {
                return '<tr class="cbi-section-table-row">' +
                    '<td><b>' + esc(n.name) + '</b></td>' +
                    '<td>' + protoTag(n.protocol) + '</td>' +
                    '<td>' + nodeState(n) + '</td>' +
                    '<td style="white-space:nowrap">' +
                    '<input type="button" class="cbi-button cbi-button-action" value="重启" onclick="window.nodexRestart(\'' + n.id + '\')"> ' +
                    '<input type="button" class="cbi-button cbi-button-action" value="配置" onclick="window.nodexGoEdit(\'' + n.id + '\')">' +
                    '</td></tr>';
            }).join('');
            var nodelist =
                '<div class="cbi-section cbi-section-node" style="margin-bottom:14px"><div class="cbi-section-node-tabbed">' +
                '<h3 style="margin:0 0 8px 0">节点列表</h3>' +
                '<div class="nx-table-wrap"><table class="cbi-section-table">' +
                '<tr class="cbi-section-table-titles"><th>节点</th><th>协议类型</th><th>状态</th><th>操作</th></tr>' +
                (rows || '<tr><td colspan="4" class="nx-empty">暂无节点</td></tr>') +
                '</table></div></div></div>';

            // 面板同步状态（供仪表盘右上角展示）
            var panelErrs = nodes.filter(function (n) { return n.panel && n.panel.lastError; });
            var panelOk = nodes.length > 0 && panelErrs.length === 0;
            var lastSync = '';
            nodes.forEach(function (n) { if (n.panel && n.panel.lastSync) lastSync = n.panel.lastSync; });

            // 用户流量
            var urows = users.map(function (u) {
                return '<tr class="cbi-section-table-row"><td>' + esc(u.node_name || '-') + '</td><td>' + esc(u.uid) + '</td>' +
                    '<td>' + fmtBytes(u.traffic) + '</td><td>' + esc((u.ips || []).join(', ') || '-') + '</td></tr>';
            }).join('');
            // 面板同步小标签（放用户流量标题旁，彩色）
            var syncBadge = nodes.length === 0
                ? '<span style="font-size:11px;color:#999;font-weight:normal">面板同步 未配置</span>'
                : (panelOk
                    ? '<span style="font-size:11px;color:#159b4d;font-weight:normal">● 面板同步正常' + (lastSync ? ' ' + esc(lastSync.slice(11, 16)) : '') + '</span>'
                    : '<span style="font-size:11px;color:#d23333;font-weight:normal" title="' + esc(panelErrs.map(function (n) { return n.name + ': ' + n.panel.lastError; }).join('\n')) + '">● 面板同步错误</span>');
            var usercard =
                '<div class="cbi-section cbi-section-node"><div class="cbi-section-node-tabbed">' +
                '<h3 style="margin:0 0 8px 0">用户流量 <span style="margin-left:8px">' + syncBadge + '</span></h3>' +
                '<div class="nx-table-wrap"><table class="cbi-section-table">' +
                '<tr class="cbi-section-table-titles"><th>节点</th><th>用户</th><th>流量</th><th>在线 IP</th></tr>' +
                (urows || '<tr><td colspan="4" class="nx-empty">暂无流量数据（用户连接节点后自动统计）</td></tr>') +
                '</table></div></div></div>';

            el.innerHTML =
                '<div class="nx-grid">' +
                '<div class="nx-span2">' + stats + '</div>' +
                kmaster +
                nodelist +
                usercard +
                '</div>';
        }).catch(function (e) { el.innerHTML = '<div class="nx-msg err">' + esc(e.message) + '</div>'; });
    }

    window.nodexKernel = function (action) {
        var name = action.indexOf('xray') >= 0 ? 'Xray' : 'Hysteria2';
        var op = action.indexOf('stop') >= 0 ? '停止' : '启动';
        if (!confirm('确定' + op + '所有节点的 ' + name + '？')) return;
        api('/action', { body: { action: action } }).then(function () {
            notify(name + ' 已' + op, true);
            setTimeout(renderOverview, 2000);
        }).catch(function (e) { notify(e.message || '操作失败', false); });
    };

    window.nodexRestart = function (id) {
        api('/action', { body: { action: 'restart', node_id: id } }).then(function () {
            notify('节点已重启', true);
            setTimeout(renderOverview, 2000);
        }).catch(function (e) { notify(e.message || '操作失败', false); });
    };

    // ================= 节点管理 =================
    function renderNodes() {
        var el = document.getElementById('nodex-content');
        el.innerHTML = '<div class="nx-empty">加载中...</div>';
        api('/status').then(function (st) {
            var nodes = st.nodes || [];
            var rows = nodes.map(function (n) {
                var ok = n.enabled && ((n.xray && n.xray.running) || (n.hy2 && n.hy2.running));
                return '<tr class="cbi-section-table-row">' +
                    '<td><b>' + esc(n.name) + '</b></td>' +
                    '<td>' + protoTag(n.protocol) + '</td>' +
                    '<td>' + (n.enabled ? (ok ? tag(true, '正常') : tag(false, '停止')) : '<span style="color:#999">已禁用</span>') + '</td>' +
                    '<td style="white-space:nowrap">' +
                    '<input type="button" class="cbi-button cbi-button-action" value="编辑" onclick="window.nodexGoEdit(\'' + n.id + '\')"> ' +
                    '<input type="button" class="cbi-button cbi-button-negative" value="删除" onclick="window.nodexDelNode(\'' + n.id + '\',\'' + esc(n.name).replace(/'/g, "\\\'") + '\')">' +
                    '</td></tr>';
            }).join('');
            el.innerHTML =
                '<div style="margin-bottom:10px"><input type="button" class="cbi-button cbi-button-positive" value="新增节点" onclick="window.nodexAddNode()"></div>' +
                '<div class="nx-table-wrap"><table class="cbi-section-table">' +
                '<tr class="cbi-section-table-titles"><th>节点</th><th>协议类型</th><th>状态</th><th>操作</th></tr>' +
                (rows || '<tr><td colspan="4" class="nx-empty">暂无节点</td></tr>') +
                '</table></div>';
        }).catch(function (e) { el.innerHTML = '<div class="nx-msg err">' + esc(e.message) + '</div>'; });
    }

    window.nodexAddNode = function () {
        api('/config').then(function (cfg) {
            cfg.nodes = cfg.nodes || [];
            var node = {
                id: 'n' + Math.random().toString(16).slice(2, 6),
                name: '新节点' + (cfg.nodes.length + 1),
                enabled: true,
                node_id: 1,
                node_type: '',
                forward: { enabled: false, targets: [], fingerprint: 'chrome' },
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

    // ================= 节点编辑 =================
    var PROTOCOLS = [
        { value: 'vless', label: 'VLESS' },
        { value: 'vmess', label: 'VMess' },
        { value: 'trojan', label: 'Trojan' },
        { value: 'shadowsocks', label: 'SS' },
        { value: 'hysteria2', label: 'Hysteria2' }
    ];

    function renderNodeEdit(id) {
        var el = document.getElementById('nodex-content');
        el.innerHTML = '<div class="nx-empty">加载中...</div>';
        api('/config').then(function (cfg) {
            window.nodexGlobalPanel = cfg.panel || {};
            var node = (cfg.nodes || []).filter(function (n) { return n.id === id; })[0];
            if (!node) { el.innerHTML = '<div class="nx-msg err">节点不存在</div>'; return; }
            if (!node.forward) node.forward = { enabled: false, targets: [], fingerprint: 'chrome' };
            window.nodexEditNode = node;
            renderNodeEditForm(node);
        }).catch(function (e) { el.innerHTML = '<div class="nx-msg err">' + esc(e.message) + '</div>'; });
    }

    function fv(node, key) {
        var cur = node;
        key.split('.').forEach(function (k) { cur = cur ? cur[k] : undefined; });
        return cur;
    }

    function renderNodeEditForm(node) {
        var el = document.getElementById('nodex-content');
        var id = node.id;
        var panelEnabled = window.nodexGlobalPanel && window.nodexGlobalPanel.enabled;
        var proto = node.node.protocol;

        // 协议选择
        var protoBtns = PROTOCOLS.map(function (p) {
            return '<span class="nx-proto-item' + (p.value === proto ? ' active' : '') + '" onclick="window.nodexSetProto(\'' + id + '\',\'' + p.value + '\')">' + p.label + '</span>';
        }).join('');

        function field(label, key, type, val, gen) {
            var v = val == null ? '' : val;
            var input = '';
            if (type === 'number') input = '<input type="number" class="cbi-input-text" style="width:120px" data-key="' + key + '" value="' + esc(v) + '">';
            else if (type === 'checkbox') input = '<input type="checkbox" data-key="' + key + '"' + (v ? ' checked' : '') + '>';
            else if (type === 'select') {
                var opts = arguments[5] || [];
                input = '<select class="cbi-input-select" data-key="' + key + '">' + opts.map(function (o) {
                    return '<option value="' + esc(o.value) + '"' + (String(v) === String(o.value) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
                }).join('') + '</select>';
            } else input = '<input type="text" class="cbi-input-text" style="width:340px" data-key="' + key + '" value="' + esc(v) + '">';
            var btn = gen ? '<input type="button" class="cbi-button cbi-button-action" value="生成" onclick="window.nodexGen(\'' + id + '\',\'' + gen + '\',\'' + key + '\')">' : '';
            return '<div class="cbi-value"><label class="cbi-value-title">' + esc(label) + '</label><div class="cbi-value-field">' + input + ' ' + btn + '</div></div>';
        }

        var fields = '';
        if (proto !== 'hysteria2') {
            if (!panelEnabled) fields += field('监听端口', 'node.port', 'number', node.node.port);
            if (proto === 'vless' || proto === 'vmess') fields += field('UUID', 'node.uuid', 'text', node.node.uuid, 'uuid');
            if (proto === 'vless') {
                fields += field('TLS 类型', 'node.tls', 'select', node.node.tls, null, [
                    { value: 0, label: '关闭' }, { value: 1, label: 'TLS 证书' }, { value: 2, label: 'Reality' }
                ]);
                if (String(node.node.tls) === '2') {
                    fields += field('目标域名 dest', 'node.reality.dest', 'text', node.node.reality.dest);
                    fields += field('SNI 列表', 'node.reality.server_names', 'text', node.node.reality.server_names);
                    fields += field('私钥 PrivateKey', 'node.reality.private_key', 'text', node.node.reality.private_key, 'reality');
                    fields += field('Short IDs', 'node.reality.short_ids', 'text', node.node.reality.short_ids);
                } else if (String(node.node.tls) === '1') {
                    fields += field('证书路径', 'node.cert_path', 'text', node.node.cert_path);
                    fields += field('私钥路径', 'node.key_path', 'text', node.node.key_path);
                    fields += field('SNI (serverName)', 'node.server_name', 'text', node.node.server_name);
                }
            }
            if (proto === 'vmess') {
                fields += field('TLS 类型', 'node.tls', 'select', node.node.tls, null, [
                    { value: 0, label: '关闭' }, { value: 1, label: 'TLS 证书' }
                ]);
                if (String(node.node.tls) === '1') {
                    fields += field('证书路径', 'node.cert_path', 'text', node.node.cert_path);
                    fields += field('私钥路径', 'node.key_path', 'text', node.node.key_path);
                    fields += field('SNI (serverName)', 'node.server_name', 'text', node.node.server_name);
                }
            }
            if (proto === 'trojan') {
                fields += '<div class="cbi-value"><label class="cbi-value-title"></label><div class="cbi-value-field"><span style="color:#999;font-size:12px">Trojan 需启用 TLS，用户密码由面板 UUID 自动生成</span></div></div>';
                fields += field('证书路径', 'node.cert_path', 'text', node.node.cert_path);
                fields += field('私钥路径', 'node.key_path', 'text', node.node.key_path);
                fields += field('SNI (serverName)', 'node.server_name', 'text', node.node.server_name);
            }
            if (proto === 'shadowsocks') {
                fields += field('加密方式', 'node.ss_method', 'select', node.node.ss_method, null, [
                    { value: '2022-blake3-aes-128-gcm', label: '2022-blake3-aes-128-gcm' },
                    { value: '2022-blake3-aes-256-gcm', label: '2022-blake3-aes-256-gcm' },
                    { value: 'aes-128-gcm', label: 'aes-128-gcm' },
                    { value: 'chacha20-ietf-poly1305', label: 'chacha20-ietf-poly1305' }
                ]);
            }
        } else {
            if (!panelEnabled) fields += field('监听端口', 'node.hy2.port', 'number', node.node.hy2.port);
            fields += field('认证密码', 'node.hy2.password', 'text', node.node.hy2.password, 'password');
            fields += field('混淆 obfs', 'node.hy2.obfs', 'select', node.node.hy2.obfs, null, [
                { value: 'none', label: '关闭' }, { value: 'salamander', label: 'salamander' }
            ]);
            if (node.node.hy2.obfs === 'salamander') {
                fields += field('混淆密码', 'node.hy2.obfs_password', 'text', node.node.hy2.obfs_password, 'hex8');
            }
            fields += field('上行带宽 Mbps', 'node.hy2.up_mbps', 'number', node.node.hy2.up_mbps);
            fields += field('下行带宽 Mbps', 'node.hy2.down_mbps', 'number', node.node.hy2.down_mbps);
            fields += field('忽略客户端带宽', 'node.hy2.ignore_bw', 'checkbox', node.node.hy2.ignore_bw);
            fields += field('证书路径', 'node.hy2.cert_path', 'text', node.node.hy2.cert_path);
            fields += field('私钥路径', 'node.hy2.key_path', 'text', node.node.hy2.key_path);
        }

        var fwd = node.forward || {};
        var targetsText = (fwd.targets || []).map(function (t) {
            return t.address + (t.port ? ':' + t.port : '') + (t.weight && t.weight !== 1 ? ':' + t.weight : '');
        }).join('\n');

        el.innerHTML =
            '<div class="cbi-section cbi-section-node" style="margin-bottom:14px"><div class="cbi-section-node-tabbed">' +
            '<h3 style="margin:0 0 8px 0">节点编辑：' + esc(node.name) + '</h3>' +
            '<div class="cbi-value"><label class="cbi-value-title">节点名称</label><div class="cbi-value-field"><input type="text" class="cbi-input-text" style="width:280px" id="nx-name" value="' + esc(node.name) + '"></div></div>' +
            '<div class="cbi-value"><label class="cbi-value-title">启用节点</label><div class="cbi-value-field"><input type="checkbox" id="nx-enabled"' + (node.enabled ? ' checked' : '') + '></div></div>' +
            '</div></div>' +

            '<div class="cbi-section cbi-section-node" style="margin-bottom:14px"><div class="cbi-section-node-tabbed">' +
            '<h3 style="margin:0 0 8px 0">面板对接（本节点）</h3>' +
            '<div class="cbi-value"><label class="cbi-value-title">面板节点 ID</label><div class="cbi-value-field"><input type="number" class="cbi-input-text" style="width:100px" id="nx-nodeid" value="' + esc(node.node_id || 0) + '"></div></div>' +
            '<div class="cbi-value"><label class="cbi-value-title">节点类型</label><div class="cbi-value-field"><select class="cbi-input-select" id="nx-nodetype">' +
            '<option value="">自动（推荐）</option>' +
            [['vless', 'vless'], ['vmess', 'vmess'], ['trojan', 'trojan'], ['shadowsocks', 'shadowsocks'], ['hysteria', 'hysteria2']].map(function (t) {
                return '<option value="' + t[0] + '"' + (node.node_type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
            }).join('') + '</select></div></div>' +
            '<div class="cbi-value"><label class="cbi-value-title"></label><div class="cbi-value-field"><input type="button" class="cbi-button cbi-button-action" value="测试面板连接" onclick="window.nodexTestNodePanel(\'' + id + '\')"></div></div>' +
            '</div></div>' +

            '<div class="cbi-section cbi-section-node" style="margin-bottom:14px"><div class="cbi-section-node-tabbed">' +
            '<h3 style="margin:0 0 8px 0">协议</h3>' +
            '<div class="cbi-value"><label class="cbi-value-title">协议类型</label><div class="cbi-value-field"><div class="nx-proto">' + protoBtns + '</div></div></div>' +
            '</div></div>' +

            '<div class="cbi-section cbi-section-node" style="margin-bottom:14px"><div class="cbi-section-node-tabbed">' +
            '<h3 style="margin:0 0 8px 0">协议配置</h3>' + fields + '</div></div>' +

            '<div class="cbi-section cbi-section-node" style="margin-bottom:14px"><div class="cbi-section-node-tabbed">' +
            '<h3 style="margin:0 0 8px 0">转发出站（XrayR 转发模式）</h3>' +
            '<div class="cbi-value"><label class="cbi-value-title">启用转发</label><div class="cbi-value-field"><input type="checkbox" id="nx-fwd-enabled"' + (fwd.enabled ? ' checked' : '') + '></div></div>' +
            '<div class="cbi-value"><label class="cbi-value-title">落地 UUID</label><div class="cbi-value-field"><input type="text" class="cbi-input-text" style="width:340px" id="nx-fwd-uuid" value="' + esc(fwd.uuid || '') + '"></div></div>' +
            '<div class="cbi-value"><label class="cbi-value-title">SNI</label><div class="cbi-value-field"><input type="text" class="cbi-input-text" style="width:340px" id="nx-fwd-sni" value="' + esc(fwd.server_name || '') + '"></div></div>' +
            '<div class="cbi-value"><label class="cbi-value-title">WS 路径</label><div class="cbi-value-field"><input type="text" class="cbi-input-text" style="width:340px" id="nx-fwd-wspath" value="' + esc(fwd.ws_path || '') + '"></div></div>' +
            '<div class="cbi-value"><label class="cbi-value-title">WS Host</label><div class="cbi-value-field"><input type="text" class="cbi-input-text" style="width:340px" id="nx-fwd-wshost" value="' + esc(fwd.ws_host || '') + '"></div></div>' +
            '<div class="cbi-value"><label class="cbi-value-title">目标服务器</label><div class="cbi-value-field"><textarea class="cbi-input-text" rows="5" style="width:340px;font-family:monospace" id="nx-fwd-targets" placeholder="每行一个：IP 或 IP:端口 或 IP:端口:权重">' + esc(targetsText) + '</textarea></div></div>' +
            '</div></div>' +

            '<div class="cbi-section cbi-section-node"><div class="cbi-section-node-tabbed">' +
            '<div class="cbi-value"><label class="cbi-value-title"></label><div class="cbi-value-field">' +
            '<input type="button" class="cbi-button cbi-button-positive" value="保存配置" onclick="window.nodexSaveNode(\'' + id + '\',false)"> ' +
            '<input type="button" class="cbi-button cbi-button-apply" value="保存并重启" onclick="window.nodexSaveNode(\'' + id + '\',true)">' +
            '</div></div></div></div>';
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
        }).catch(function (e) { notify(e.message || '生成失败', false); });
    };

    window.nodexSaveNode = function (id, restart) {
        var cfg = null;
        syncEditNodeFromForm();
        api('/config').then(function (c) {
            cfg = c;
            var idx = cfg.nodes.findIndex(function (n) { return n.id === id; });
            if (idx < 0) throw new Error('节点不存在');
            var node = window.nodexEditNode && window.nodexEditNode.id === id
                ? JSON.parse(JSON.stringify(window.nodexEditNode))
                : cfg.nodes[idx];
            cfg.nodes[idx] = node;
            // 收集协议表单字段
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

    // ================= 面板对接 =================
    function renderPanel() {
        var el = document.getElementById('nodex-content');
        api('/config').then(function (cfg) {
            var p = cfg.panel || {};
            el.innerHTML =
                '<div class="cbi-section cbi-section-node"><div class="cbi-section-node-tabbed">' +
                '<h3 style="margin:0 0 8px 0">面板对接（全局配置）</h3>' +
                '<div class="cbi-value"><label class="cbi-value-title">启用面板对接</label><div class="cbi-value-field"><input type="checkbox" id="nx-p-enabled"' + (p.enabled ? ' checked' : '') + '></div></div>' +
                '<div class="cbi-value"><label class="cbi-value-title">面板地址</label><div class="cbi-value-field"><input type="text" class="cbi-input-text" style="width:340px" id="nx-p-url" value="' + esc(p.url || '') + '"></div></div>' +
                '<div class="cbi-value"><label class="cbi-value-title">通信密钥</label><div class="cbi-value-field"><input type="text" class="cbi-input-text" style="width:340px" id="nx-p-token" value="' + esc(p.token || '') + '"></div></div>' +
                '<div class="cbi-value"><label class="cbi-value-title">拉取/上报间隔</label><div class="cbi-value-field"><input type="number" class="cbi-input-text" style="width:80px" id="nx-p-pull" value="' + esc(p.pull_interval || 60) + '"> / <input type="number" class="cbi-input-text" style="width:80px" id="nx-p-push" value="' + esc(p.push_interval || 60) + '"> 秒</div></div>' +
                '<div class="cbi-value"><label class="cbi-value-title"></label><div class="cbi-value-field">' +
                '<input type="button" class="cbi-button cbi-button-positive" value="保存配置" onclick="window.nodexSavePanel()"> ' +
                '<input type="button" class="cbi-button cbi-button-action" value="测试面板连接" onclick="window.nodexTestPanel()">' +
                '</div></div>' +
                '<div class="cbi-value"><label class="cbi-value-title"></label><div class="cbi-value-field"><span style="color:#999;font-size:12px">节点 ID 与节点类型在「节点管理 → 编辑节点」中单独配置（每节点不同）</span></div></div>' +
                '</div></div>';
        }).catch(function (e) { el.innerHTML = '<div class="nx-msg err">' + esc(e.message) + '</div>'; });
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

    // ================= 系统设置 =================
    function renderSystem() {
        var el = document.getElementById('nodex-content');
        api('/config').then(function (cfg) {
            var s = cfg.system || {};
            el.innerHTML =
                '<div class="cbi-section cbi-section-node" style="margin-bottom:14px"><div class="cbi-section-node-tabbed">' +
                '<h3 style="margin:0 0 8px 0">系统设置（全局）</h3>' +
                '<div class="cbi-value"><label class="cbi-value-title">xray 路径</label><div class="cbi-value-field"><input type="text" class="cbi-input-text" style="width:320px" id="nx-s-xray" value="' + esc(s.xray_path || '') + '"> <span id="nx-core-xray">检测中...</span></div></div>' +
                '<div class="cbi-value"><label class="cbi-value-title">hysteria 路径</label><div class="cbi-value-field"><input type="text" class="cbi-input-text" style="width:320px" id="nx-s-hy" value="' + esc(s.hysteria_path || '') + '"> <span id="nx-core-hy">检测中...</span></div></div>' +
                '<div class="cbi-value"><label class="cbi-value-title">日志级别</label><div class="cbi-value-field"><select class="cbi-input-select" id="nx-s-log">' +
                ['debug', 'info', 'warning', 'error'].map(function (l) {
                    return '<option value="' + l + '"' + (s.log_level === l ? ' selected' : '') + '>' + l + '</option>';
                }).join('') + '</select></div></div>' +
                '<div class="cbi-value"><label class="cbi-value-title">hysteria 证书</label><div class="cbi-value-field"><input type="text" class="cbi-input-text" style="width:320px" id="nx-s-cert" value="' + esc(s.cert_path || '') + '"></div></div>' +
                '<div class="cbi-value"><label class="cbi-value-title">hysteria 私钥</label><div class="cbi-value-field"><input type="text" class="cbi-input-text" style="width:320px" id="nx-s-key" value="' + esc(s.key_path || '') + '"></div></div>' +
                '<div class="cbi-value"><label class="cbi-value-title"></label><div class="cbi-value-field"><input type="button" class="cbi-button cbi-button-positive" value="保存" onclick="window.nodexSaveSystem()"></div></div>' +
                '</div></div>' +
                '<div class="cbi-section cbi-section-node"><div class="cbi-section-node-tabbed">' +
                '<h3 style="margin:0 0 8px 0">修改管理密码</h3>' +
                '<div class="cbi-value"><label class="cbi-value-title">新密码</label><div class="cbi-value-field"><input type="password" class="cbi-input-text" style="width:280px" id="nx-pwd"> <input type="button" class="cbi-button cbi-button-action" value="修改密码" onclick="window.nodexChangePwd()"></div></div>' +
                '</div></div>';
            loadCoreInfo();
        }).catch(function (e) { el.innerHTML = '<div class="nx-msg err">' + esc(e.message) + '</div>'; });
    }

    function loadCoreInfo() {
        ['xray', 'hysteria'].forEach(function (kind) {
            var el = document.getElementById('nx-core-' + (kind === 'xray' ? 'xray' : 'hy'));
            if (!el) return;
            api('/core/info?type=' + kind).then(function (info) {
                if (info.installed) {
                    el.innerHTML = '<span style="color:#159b4d;font-weight:600">' + esc(info.version || '已安装') + '</span> ' +
                        '<input type="button" class="cbi-button cbi-button-action" value="更新" onclick="window.nodexUpdateCore(\'' + kind + '\')">';
                } else {
                    el.innerHTML = '<span style="color:#d23333;font-weight:600">未安装</span> ' +
                        '<input type="button" class="cbi-button cbi-button-positive" value="下载" onclick="window.nodexUpdateCore(\'' + kind + '\')">';
                }
            }).catch(function () {
                el.innerHTML = '<span style="color:#999">未知</span>';
            });
        });
    }

    window.nodexUpdateCore = function (kind) {
        var name = kind === 'xray' ? 'xray' : 'hysteria';
        if (!confirm('将下载最新版 ' + name + ' 核心并替换（节点会短暂重启），继续？')) return;
        api('/core/update', { body: { type: kind } }).then(function (res) {
            notify(name + ' 已更新至 ' + (res.version || '最新版'), true);
            loadCoreInfo();
        }).catch(function (e) { notify(e.message || '更新失败', false); });
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

    // ================= 日志 =================
    function renderLogs() {
        var el = document.getElementById('nodex-content');
        api('/status').then(function (st) {
            var nodes = st.nodes || [];
            var sel = '<select class="cbi-input-select" id="nx-log-node">' + nodes.map(function (n) {
                return '<option value="' + n.id + '">' + esc(n.name) + '</option>';
            }).join('') + '</select>';
            var typeSel = '<select class="cbi-input-select" id="nx-log-type"><option value="error">错误日志</option><option value="access">访问日志</option></select>';
            el.innerHTML =
                '<div class="cbi-section cbi-section-node"><div class="cbi-section-node-tabbed">' +
                '<h3 style="margin:0 0 8px 0">运行日志</h3>' +
                '<div class="nx-logbar">节点 ' + sel + ' 类型 ' + typeSel +
                '<input type="button" class="cbi-button cbi-button-action" value="刷新" onclick="window.nodexLoadLogs()">' +
                '<label style="font-size:12px">自动刷新 <input type="checkbox" id="nx-log-auto" checked></label>' +
                '<span class="info" id="nx-log-info"></span></div>' +
                '<pre class="nx-pre" id="nx-log-pre">（加载中...）</pre>' +
                '</div></div>';
            window.nodexLoadLogs();
            setInterval(function () {
                if (document.getElementById('nx-log-pre') && document.getElementById('nx-log-auto').checked) window.nodexLoadLogs();
            }, 8000);
        }).catch(function (e) { el.innerHTML = '<div class="nx-msg err">' + esc(e.message) + '</div>'; });
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
            if (info) info.textContent = lines.length + ' 行';
            // 纯 DOM 构建（textContent，不依赖 innerHTML，避免 LuCI 环境渲染异常）
            pre.textContent = '';
            lines.forEach(function (l) {
                var cls = 'lg-info';
                if (/ERROR|FATAL|failed|refused|rejected/i.test(l)) cls = 'lg-err';
                else if (/WARN|Warning|deprecated/i.test(l)) cls = 'lg-warn';
                var m = l.match(/^([0-9]{4}[\-/][0-9]{2}[\-/][0-9]{2}[ T][0-9:.+]{6,})/);
                var span = document.createElement('span');
                span.className = cls;
                if (m) {
                    var ts = document.createElement('span');
                    ts.className = 'lg-time';
                    ts.textContent = m[1];
                    span.appendChild(ts);
                    span.appendChild(document.createTextNode(l.slice(m[1].length)));
                } else {
                    span.textContent = l;
                }
                pre.appendChild(span);
                pre.appendChild(document.createTextNode('\n'));
            });
            if (!lines.length) pre.textContent = '（暂无日志）';
            pre.scrollTop = pre.scrollHeight;
        }).catch(function (e) {
            var pre = document.getElementById('nx-log-pre');
            if (pre) pre.innerHTML = '<span style="color:#f07171">' + esc(e.message) + '</span>';
        });
    };

    // ================= 后端状态 =================
    function renderBackend() {
        var el = document.getElementById('nodex-content');
        fetch('/cgi-bin/luci/admin/services/nodex/backend/status').then(function (r) { return r.json(); }).then(function (b) {
            var d = document.createElement('div');
            d.className = 'cbi-section cbi-section-node';
            d.style.marginBottom = '14px';
            d.innerHTML = '<div class="cbi-section-node-tabbed"><h3 style="margin:0 0 8px 0">后端状态</h3>' +
                '<div class="nx-table-wrap"><table class="cbi-section-table">' +
                '<tr class="cbi-section-table-titles"><th>组件</th><th>状态</th></tr>' +
                '<tr class="cbi-section-table-row"><td>nodex 守护进程</td><td>' + (b.nodex_bin ? (b.nodex_running ? tag(true, '运行中') : tag(false, '未运行')) : tag(false, '未安装')) + '</td></tr>' +
                '<tr class="cbi-section-table-row"><td>xray 内核</td><td>' + (b.xray_bin ? tag(true, '已安装') : tag(false, '缺失')) + '</td></tr>' +
                '<tr class="cbi-section-table-row"><td>hysteria 内核</td><td>' + (b.hysteria_bin ? tag(true, '已安装') : tag(false, '缺失')) + '</td></tr>' +
                '</table></div>' +
                '<div style="margin-top:10px">' +
                (b.nodex_bin && b.xray_bin && b.hysteria_bin
                    ? '<input type="button" class="cbi-button cbi-button-action" value="重启后端" onclick="window.nodexRestartBackend()">'
                    : '<input type="button" class="cbi-button cbi-button-positive" value="下载并安装后端" onclick="window.nodexInstallBackend()">') +
                '</div></div>';
            el.appendChild(d);
        }).catch(function () {});
    }

    window.nodexInstallBackend = function () {
        if (!confirm('将下载并安装 nodex 守护进程 + xray + hysteria 内核（约 70MB），继续？')) return;
        fetch('/cgi-bin/luci/admin/services/nodex/backend/install').then(function (r) { return r.json(); }).then(function (res) {
            notify(res.message || '安装已启动', true);
        }).catch(function (e) { notify(e.message || '启动失败', false); });
    };

    window.nodexRestartBackend = function () {
        fetch('/cgi-bin/luci/admin/services/nodex/backend/restart').then(function (r) { return r.json(); }).then(function (res) {
            notify(res.message || '已重启', true);
            setTimeout(function () { location.reload(); }, 3000);
        }).catch(function (e) { notify(e.message || '重启失败', false); });
    };

    // ================= 导航 =================
    window.nodexGo = function (page) {
        setActiveMenu(page);
        if (page === 'nodes') renderNodes();
        else if (page === 'panel') renderPanel();
        else if (page === 'system') renderSystem();
        else if (page === 'logs') renderLogs();
        else renderOverview();
    };

    window.nodexGoEdit = function (id) {
        renderNodeEdit(id);
    };

    // 初始加载
    document.addEventListener('DOMContentLoaded', function () {
        window.nodexGo('overview');
    });
})();
