'use strict';
'require view';
'require ui';
'require dom';

var common = require('luci.view.nodex.common');

var protocols = [
    { value: 'vless', label: 'VLESS + Reality/WS' },
    { value: 'vmess', label: 'VMess' },
    { value: 'trojan', label: 'Trojan' },
    { value: 'shadowsocks', label: 'Shadowsocks' },
    { value: 'hysteria2', label: 'Hysteria2' }
];

return view.extend({
    load: function () {
        var self = this;
        return common.api('/config').then(function (cfg) {
            self.nodeId = L.getenv('PATH_INFO').split('/').pop();
            self.cfg = cfg;
            var found = (cfg.nodes || []).filter(function (n) { return n.id === self.nodeId; })[0];
            if (!found) throw new Error('节点不存在');
            self.node = JSON.parse(JSON.stringify(found));
            return null;
        });
    },

    render: function () {
        var self = this;
        this.container = E('div', { 'class': 'cbi-map' });
        var container = this.container;

        // 基本信息
        var nameInput = E('input', { 'class': 'cbi-input-text', 'style': 'width:280px', 'value': self.node.name });
        var enabledInput = E('input', { 'type': 'checkbox', 'class': 'cbi-input-checkbox', 'checked': self.node.enabled ? 'checked' : null });

        // 协议选择
        var protoBtns = protocols.map(function (p) {
            return E('button', {
                'class': 'cbi-button cbi-button-action' + (self.node.node.protocol === p.value ? ' cbi-button-positive' : ''),
                'click': function () { self.node.node.protocol = p.value; location.reload(); }
            }, p.label);
        });

        container.appendChild(E('div', { 'class': 'cbi-section cbi-section-node' }, [
            E('div', { 'class': 'cbi-section-node-tabbed' }, [
                E('h3', null, _('基本信息')),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('节点名称')),
                    E('div', { 'class': 'cbi-value-field' }, [nameInput])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('启用节点')),
                    E('div', { 'class': 'cbi-value-field' }, [enabledInput])
                ])
            ])
        ]));

        container.appendChild(E('div', { 'class': 'cbi-section cbi-section-node' }, [
            E('div', { 'class': 'cbi-section-node-tabbed' }, [
                E('h3', null, _('协议')),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('协议类型')),
                    E('div', { 'class': 'cbi-value-field' }, protoBtns)
                ])
            ])
        ]));

        // 协议对应表单
        var formSection = this.buildForm();
        this.formContainer = formSection;
        container.appendChild(formSection);

        var saveBtn = E('button', {
            'class': 'cbi-button cbi-button-positive',
            'click': function () {
                self.node.name = nameInput.value;
                self.node.enabled = enabledInput.checked;
                self.collectForm();
                var cfg = self.cfg;
                cfg.nodes = (cfg.nodes || []).map(function (n) { return n.id === self.node.id ? self.node : n; });
                common.api('/config', { method: 'PUT', body: cfg }).then(function () {
                    ui.addNotification(null, E('p', '配置已保存'));
                    location.hash = L.url('admin/services/nodex/nodes');
                }).catch(function (e) { ui.addNotification(null, E('p', String(e && e.message || '保存失败'))); });
            }
        }, _('保存配置'));

        var restartBtn = E('button', {
            'class': 'cbi-button cbi-button-action',
            'click': function () {
                self.node.name = nameInput.value;
                self.node.enabled = enabledInput.checked;
                self.collectForm();
                var cfg = self.cfg;
                cfg.nodes = (cfg.nodes || []).map(function (n) { return n.id === self.node.id ? self.node : n; });
                common.api('/config', { method: 'PUT', body: cfg }).then(function () {
                    return common.api('/action', { body: { action: 'restart', node_id: self.node.id } });
                }).then(function () {
                    ui.addNotification(null, E('p', '节点已重启'));
                }).catch(function (e) { ui.addNotification(null, E('p', String(e && e.message || '操作失败'))); });
            }
        }, _('保存并重启'));

        container.appendChild(E('div', { 'class': 'cbi-section' }, [E('div', { 'class': 'cbi-section-node-tabbed' }, [E('div', { 'class': 'cbi-value' }, [E('div', { 'class': 'cbi-value-field' }, [saveBtn, ' ', restartBtn])])])]));

        return container;
    },

    // 构建协议表单（vless → xray 区；hysteria2 → hy2 区）
    buildForm: function () {
        var self = this;
        var proto = self.node.node.protocol;
        var rows = [];

        if (proto !== 'hysteria2') {
            rows.push(this.field('port', '监听端口', 'number'));
            if (proto === 'vless' || proto === 'vmess') {
                rows.push(this.field('uuid', 'UUID', 'text', 'uuid'));
            }
            if (proto === 'vless') {
                rows.push(this.field('tls', 'TLS 类型', 'select', null, [
                    { value: '0', label: '关闭' }, { value: '1', label: 'TLS 证书' }, { value: '2', label: 'Reality' }
                ]));
                if (String(self.node.node.tls) === '2') {
                    rows.push(this.field('reality.dest', '目标域名 dest', 'text'));
                    rows.push(this.field('reality.server_names', 'SNI 列表', 'text'));
                    rows.push(this.field('reality.private_key', '私钥 PrivateKey', 'text', 'reality'));
                    rows.push(this.field('reality.short_ids', 'Short IDs', 'text'));
                } else if (String(self.node.node.tls) === '1') {
                    rows.push(this.field('cert_path', '证书路径', 'text'));
                    rows.push(this.field('key_path', '私钥路径', 'text'));
                }
            }
            if (proto === 'shadowsocks') {
                rows.push(this.field('ss_method', '加密方式', 'select', null, [
                    { value: '2022-blake3-aes-128-gcm', label: '2022-blake3-aes-128-gcm' },
                    { value: '2022-blake3-aes-256-gcm', label: '2022-blake3-aes-256-gcm' },
                    { value: 'aes-128-gcm', label: 'aes-128-gcm' },
                    { value: 'chacha20-ietf-poly1305', label: 'chacha20-ietf-poly1305' }
                ]));
            }
        } else {
            rows.push(this.field('hy2.port', '监听端口', 'number'));
            rows.push(this.field('hy2.password', '认证密码', 'text', 'password'));
            rows.push(this.field('hy2.obfs', '混淆 obfs', 'select', null, [
                { value: 'none', label: '关闭' }, { value: 'salamander', label: 'salamander' }
            ]));
            if (self.node.node.hy2.obfs === 'salamander') {
                rows.push(this.field('hy2.obfs_password', '混淆密码', 'text', 'hex8'));
            }
            rows.push(this.field('hy2.up_mbps', '上行带宽 Mbps', 'number'));
            rows.push(this.field('hy2.down_mbps', '下行带宽 Mbps', 'number'));
            rows.push(this.field('hy2.ignore_bw', '忽略客户端带宽', 'checkbox'));
            rows.push(this.field('hy2.cert_path', '证书路径', 'text'));
            rows.push(this.field('hy2.key_path', '私钥路径', 'text'));
        }

        return E('div', { 'class': 'cbi-section cbi-section-node' }, [
            E('div', { 'class': 'cbi-section-node-tabbed' }, [
                E('h3', null, _('协议配置') + '：' + (protocols.filter(function (p) { return p.value === proto; })[0] || {}).label),
                rows
            ])
        ]);
    },

    // 生成表单行
    field: function (key, label, type, gen, options) {
        var self = this;
        var val = this.getVal(key);
        var input;

        if (type === 'number') {
            input = E('input', { 'class': 'cbi-input-text', 'style': 'width:120px', 'type': 'number', 'value': String(val) });
        } else if (type === 'checkbox') {
            input = E('input', { 'type': 'checkbox', 'class': 'cbi-input-checkbox', 'checked': val ? 'checked' : null });
        } else if (type === 'select') {
            input = E('select', { 'class': 'cbi-input-select' }, (options || []).map(function (o) {
                return E('option', { 'value': o.value, 'selected': String(val) === String(o.value) ? 'selected' : null }, o.label);
            }));
        } else {
            input = E('input', { 'class': 'cbi-input-text', 'style': 'width:360px', 'type': 'text', 'value': String(val || '') });
        }

        input.dataset.key = key;
        input.dataset.type = type;

        var fieldEl = E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _(label)),
            E('div', { 'class': 'cbi-value-field' }, [input])
        ]);

        if (gen) {
            var genBtn = E('button', {
                'class': 'cbi-button cbi-button-action',
                'click': function () {
                    var type = gen === 'reality' ? 'reality' : (gen === 'uuid' ? 'uuid' : (gen === 'hex8' ? 'hex' : 'password'));
                    var req = { type: type };
                    if (gen === 'hex8') req.len = 8;
                    common.api('/generate', { body: req }).then(function (res) {
                        if (gen === 'reality') {
                            self.setVal('reality.private_key', res.privateKey);
                            self.setVal('reality.public_key', res.publicKey);
                            self.setVal('reality.short_ids', res.shortId);
                            ui.addNotification(null, E('p', '已生成密钥对'));
                        } else {
                            self.setVal(key, res.value);
                        }
                        location.reload();
                    });
                }
            }, _('生成'));
            fieldEl.lastChild.appendChild(genBtn);
        }
        return fieldEl;
    },

    getVal: function (key) {
        var cur = this.node.node;
        key.split('.').forEach(function (k) { cur = cur ? cur[k] : undefined; });
        return cur;
    },

    setVal: function (key, v) {
        var parts = key.split('.');
        var cur = this.node.node;
        for (var i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
        cur[parts[parts.length - 1]] = v;
    },

    // 从表单收集值（按 data-key）
    collectForm: function () {
        var els = this.formContainer.querySelectorAll('input[data-key], select[data-key]');
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            var key = el.dataset.key;
            var v;
            if (el.dataset.type === 'checkbox') {
                v = el.checked;
            } else if (el.dataset.type === 'number') {
                v = parseInt(el.value, 10) || 0;
            } else {
                v = el.value;
            }
            this.setVal(key, v);
        }
    }
});
