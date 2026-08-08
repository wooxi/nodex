'use strict';
'require view';
'require ui';
'require dom';

var common = require('luci.view.nodex.common');

return view.extend({
    load: function () {
        return common.api('/status');
    },

    render: function (status) {
        var nodes = status.nodes || [];

        var addBtn = E('button', {
            'class': 'cbi-button cbi-button-action',
            'click': function () { this.addNode(); }.bind(this)
        }, _('新增节点'));

        var rows = nodes.map(function (n) {
            return E('tr', { 'class': 'cbi-section-table-row' }, [
                E('td', null, [
                    common.stateTag(n.enabled ? (n.xray && n.xray.running) : false),
                    ' ',
                    E('b', null, n.name),
                    E('span', { 'style': 'color:#999;margin-left:6px' }, n.id)
                ]),
                E('td', null, n.xray && n.xray.running ? '运行中' : '已停止'),
                E('td', null, n.hy2 && n.hy2.running ? '运行中' : '已停止'),
                E('td', null, [
                    E('a', { 'class': 'cbi-button cbi-button-action', 'href': L.url('admin/services/nodex/nodeedit', n.id) }, _('编辑')),
                    E('button', {
                        'class': 'cbi-button cbi-button-negative',
                        'click': function () { this.removeNode(n); }.bind(this)
                    }, _('删除'))
                ])
            ]);
        });

        return E('div', { 'class': 'cbi-map' }, [
            E('div', { 'class': 'cbi-section cbi-section-node' }, [
                E('div', { 'class': 'cbi-section-node-tabbed' }, [
                    E('div', { 'style': 'margin-bottom:10px' }, [addBtn]),
                    E('table', { 'class': 'cbi-section-table' }, [
                        E('tr', { 'class': 'cbi-section-table-titles' }, [
                            E('th', null, _('节点')),
                            E('th', null, _('Xray')),
                            E('th', null, _('Hysteria2')),
                            E('th', null, _('操作'))
                        ])
                    ].concat(rows.length ? rows : [E('tr', null, [E('td', { 'colspan': 4 }, '暂无节点')])]))
                ])
            ])
        ]);
    },

    addNode: function () {
        common.api('/config').then(function (cfg) {
            var node = {
                id: 'n' + Math.random().toString(16).slice(2, 6),
                name: '新节点' + (cfg.nodes ? cfg.nodes.length + 1 : 1),
                enabled: true,
                node: {
                    protocol: 'vless', port: 8686, uuid: '', tls: 0, cert_path: '', key_path: '', server_name: '',
                    reality: { dest: 'www.amazon.com:443', server_names: 'www.amazon.com', private_key: '', public_key: '', short_ids: '' },
                    hy2: { port: 9443, password: '', obfs: 'none', obfs_password: '', up_mbps: 100, down_mbps: 1000, ignore_bw: false, cert_path: '', key_path: '' },
                    ss_method: '2022-blake3-aes-128-gcm'
                }
            };
            cfg.nodes = cfg.nodes || [];
            cfg.nodes.push(node);
            return common.api('/config', { method: 'PUT', body: cfg });
        }).then(function () {
            location.reload();
        }).catch(function (e) {
            ui.addNotification(null, E('p', String(e && e.message || '创建失败')));
        });
    },

    removeNode: function (n) {
        var self = this;
        ui.showModal(null, '确定删除节点「' + n.name + '」？', [
            { text: _('取消'), class: 'btn' },
            {
                text: _('确定'), class: 'btn cbi-button-negative', click: function () {
                    common.api('/config').then(function (cfg) {
                        cfg.nodes = (cfg.nodes || []).filter(function (x) { return x.id !== n.id; });
                        return common.api('/config', { method: 'PUT', body: cfg });
                    }).then(function () { location.reload(); })
                        .catch(function (e) { ui.addNotification(null, E('p', String(e && e.message || '删除失败'))); });
                }
            }
        ]);
    }
});
