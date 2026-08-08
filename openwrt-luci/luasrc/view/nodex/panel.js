'use strict';
'require view';
'require ui';
'require dom';

var common = require('luci.view.nodex.common');

return view.extend({
    load: function () {
        var self = this;
        return common.api('/config').then(function (cfg) {
            self.panel = JSON.parse(JSON.stringify(cfg.panel || {}));
            return null;
        });
    },

    render: function () {
        var self = this;
        var p = self.panel;

        var enabled = E('input', { 'type': 'checkbox', 'class': 'cbi-input-checkbox', 'checked': p.enabled ? 'checked' : null });
        var url = E('input', { 'class': 'cbi-input-text', 'style': 'width:360px', 'value': p.url || '' });
        var token = E('input', { 'class': 'cbi-input-text', 'style': 'width:360px', 'type': 'password', 'value': p.token || '' });
        var nodeId = E('input', { 'class': 'cbi-input-text', 'style': 'width:120px', 'type': 'number', 'value': String(p.node_id || 0) });
        var nodeType = E('select', { 'class': 'cbi-input-select' }, [
            E('option', { 'value': '', 'selected': !p.node_type ? 'selected' : null }, _('自动（推荐）')),
            E('option', { 'value': 'vless', 'selected': p.node_type === 'vless' ? 'selected' : null }, 'vless'),
            E('option', { 'value': 'vmess', 'selected': p.node_type === 'vmess' ? 'selected' : null }, 'vmess'),
            E('option', { 'value': 'trojan', 'selected': p.node_type === 'trojan' ? 'selected' : null }, 'trojan'),
            E('option', { 'value': 'shadowsocks', 'selected': p.node_type === 'shadowsocks' ? 'selected' : null }, 'shadowsocks'),
            E('option', { 'value': 'hysteria', 'selected': p.node_type === 'hysteria' ? 'selected' : null }, 'hysteria2')
        ]);
        var pullInt = E('input', { 'class': 'cbi-input-text', 'style': 'width:100px', 'type': 'number', 'value': String(p.pull_interval || 60) });
        var pushInt = E('input', { 'class': 'cbi-input-text', 'style': 'width:100px', 'type': 'number', 'value': String(p.push_interval || 60) });

        var testBtn = E('button', {
            'class': 'cbi-button cbi-button-action',
            'click': function () {
                common.api('/nodes/test', { body: {
                    url: url.value, token: token.value, node_id: parseInt(nodeId.value, 10) || 0, node_type: nodeType.value
                } }).then(function (res) {
                    ui.addNotification(null, E('p', res.message || '连接成功'));
                }).catch(function (e) {
                    ui.addNotification(null, E('p', String(e && e.message || '连接失败')));
                });
            }
        }, _('测试面板连接'));

        var saveBtn = E('button', {
            'class': 'cbi-button cbi-button-positive',
            'click': function () {
                var cfg = self.cfg ? self.cfg : {};
                common.api('/config').then(function (c) {
                    c.panel = {
                        enabled: enabled.checked,
                        url: url.value,
                        token: token.value,
                        node_id: parseInt(nodeId.value, 10) || 0,
                        node_type: nodeType.value,
                        pull_interval: parseInt(pullInt.value, 10) || 60,
                        push_interval: parseInt(pushInt.value, 10) || 60
                    };
                    return common.api('/config', { method: 'PUT', body: c });
                }).then(function () {
                    ui.addNotification(null, E('p', '配置已保存'));
                }).catch(function (e) {
                    ui.addNotification(null, E('p', String(e && e.message || '保存失败')));
                });
            }
        }, _('保存配置'));

        return E('div', { 'class': 'cbi-map' }, [
            E('div', { 'class': 'cbi-section cbi-section-node' }, [
                E('div', { 'class': 'cbi-section-node-tabbed' }, [
                    E('h3', null, _('面板对接（全局配置）')),
                    E('div', { 'class': 'cbi-value' }, [
                        E('label', { 'class': 'cbi-value-title' }, _('启用面板对接')),
                        E('div', { 'class': 'cbi-value-field' }, [enabled])
                    ]),
                    E('div', { 'class': 'cbi-value' }, [
                        E('label', { 'class': 'cbi-value-title' }, _('面板地址')),
                        E('div', { 'class': 'cbi-value-field' }, [url])
                    ]),
                    E('div', { 'class': 'cbi-value' }, [
                        E('label', { 'class': 'cbi-value-title' }, _('通信密钥')),
                        E('div', { 'class': 'cbi-value-field' }, [token])
                    ]),
                    E('div', { 'class': 'cbi-value' }, [
                        E('label', { 'class': 'cbi-value-title' }, _('节点 ID')),
                        E('div', { 'class': 'cbi-value-field' }, [nodeId])
                    ]),
                    E('div', { 'class': 'cbi-value' }, [
                        E('label', { 'class': 'cbi-value-title' }, _('节点类型')),
                        E('div', { 'class': 'cbi-value-field' }, [nodeType])
                    ]),
                    E('div', { 'class': 'cbi-value' }, [
                        E('label', { 'class': 'cbi-value-title' }, _('拉取/上报间隔')),
                        E('div', { 'class': 'cbi-value-field' }, [pullInt, ' / ', pushInt, ' 秒'])
                    ]),
                    E('div', { 'class': 'cbi-value' }, [
                        E('label', { 'class': 'cbi-value-title' }, ''),
                        E('div', { 'class': 'cbi-value-field' }, [saveBtn, ' ', testBtn])
                    ])
                ])
            ])
        ]);
    }
});
