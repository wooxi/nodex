'use strict';
'require view';
'require ui';
'require dom';

var common = require('luci.view.nodex.common');

return view.extend({
    load: function () {
        var self = this;
        return common.api('/config').then(function (cfg) {
            self.sys = JSON.parse(JSON.stringify(cfg.system || {}));
            self.web = JSON.parse(JSON.stringify(cfg.web || {}));
            return null;
        });
    },

    render: function () {
        var self = this;
        var s = self.sys;

        var xrayPath = E('input', { 'class': 'cbi-input-text', 'style': 'width:320px', 'value': s.xray_path || '' });
        var hyPath = E('input', { 'class': 'cbi-input-text', 'style': 'width:320px', 'value': s.hysteria_path || '' });
        var logLevel = E('select', { 'class': 'cbi-input-select' }, ['debug', 'info', 'warning', 'error'].map(function (l) {
            return E('option', { 'value': l, 'selected': s.log_level === l ? 'selected' : null }, l);
        }));
        var certPath = E('input', { 'class': 'cbi-input-text', 'style': 'width:320px', 'value': s.cert_path || '' });
        var keyPath = E('input', { 'class': 'cbi-input-text', 'style': 'width:320px', 'value': s.key_path || '' });
        var listen = E('input', { 'class': 'cbi-input-text', 'style': 'width:160px', 'value': self.web.listen || '0.0.0.0' });
        var port = E('input', { 'class': 'cbi-input-text', 'style': 'width:100px', 'type': 'number', 'value': String(self.web.port || 8888) });
        var allowLocal = E('input', { 'type': 'checkbox', 'class': 'cbi-input-checkbox', 'checked': self.web.allow_local ? 'checked' : null });

        var newPwd = E('input', { 'class': 'cbi-input-text', 'style': 'width:280px', 'type': 'password' });

        var saveBtn = E('button', {
            'class': 'cbi-button cbi-button-positive',
            'click': function () {
                common.api('/config').then(function (c) {
                    c.system.xray_path = xrayPath.value;
                    c.system.hysteria_path = hyPath.value;
                    c.system.log_level = logLevel.value;
                    c.system.cert_path = certPath.value;
                    c.system.key_path = keyPath.value;
                    c.web.listen = listen.value;
                    c.web.port = parseInt(port.value, 10) || 8888;
                    c.web.allow_local = allowLocal.checked;
                    return common.api('/config', { method: 'PUT', body: c });
                }).then(function () {
                    ui.addNotification(null, E('p', '配置已保存（重启 nodex 后生效）'));
                }).catch(function (e) {
                    ui.addNotification(null, E('p', String(e && e.message || '保存失败')));
                });
            }
        }, _('保存'));

        var pwdBtn = E('button', {
            'class': 'cbi-button cbi-button-action',
            'click': function () {
                if (newPwd.value.length < 6) { ui.addNotification(null, E('p', '密码至少 6 位')); return; }
                common.api('/config').then(function (c) {
                    c.web.password = newPwd.value;
                    return common.api('/config', { method: 'PUT', body: c });
                }).then(function () {
                    ui.addNotification(null, E('p', '密码已修改'));
                    newPwd.value = '';
                }).catch(function (e) {
                    ui.addNotification(null, E('p', String(e && e.message || '修改失败')));
                });
            }
        }, _('修改密码'));

        return E('div', { 'class': 'cbi-map' }, [
            E('div', { 'class': 'cbi-section cbi-section-node' }, [
                E('div', { 'class': 'cbi-section-node-tabbed' }, [
                    E('h3', null, _('系统设置（全局）')),
                    E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title' }, _('xray 路径')), E('div', { 'class': 'cbi-value-field' }, [xrayPath])]),
                    E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title' }, _('hysteria 路径')), E('div', { 'class': 'cbi-value-field' }, [hyPath])]),
                    E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title' }, _('日志级别')), E('div', { 'class': 'cbi-value-field' }, [logLevel])]),
                    E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title' }, _('hysteria 证书')), E('div', { 'class': 'cbi-value-field' }, [certPath])]),
                    E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title' }, _('hysteria 私钥')), E('div', { 'class': 'cbi-value-field' }, [keyPath])]),
                    E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title' }, _('Web 监听')), E('div', { 'class': 'cbi-value-field' }, [listen, ':', port, E('label', { 'style': 'margin-left:10px' }, '本机免认证 '), allowLocal])]),
                    E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title' }, ''), E('div', { 'class': 'cbi-value-field' }, [saveBtn])])
                ])
            ]),
            E('div', { 'class': 'cbi-section cbi-section-node' }, [
                E('div', { 'class': 'cbi-section-node-tabbed' }, [
                    E('h3', null, _('修改管理密码')),
                    E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title' }, _('新密码')), E('div', { 'class': 'cbi-value-field' }, [newPwd, ' ', pwdBtn])])
                ])
            ])
        ]);
    }
});
