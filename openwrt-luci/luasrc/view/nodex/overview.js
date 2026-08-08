'use strict';
'require view';
'require ui';
'require dom';
'require rpc';

var common = require('luci.view.nodex.common');

return view.extend({
    load: function () {
        return Promise.all([
            common.api('/status'),
            common.api('/users')
        ]);
    },

    render: function (data) {
        var status = data[0] || {};
        var users = data[1] || {};
        var nodes = status.nodes || [];
        var totalTraffic = (users.users || []).reduce(function (s, u) { return s + (u.traffic || 0); }, 0);
        var online = (users.users || []).filter(function (u) { return u.ips && u.ips.length; }).length;

        var cards = E('div', { 'class': 'cbi-map' }, [
            E('div', { 'class': 'cbi-section cbi-section-node' }, [
                E('div', { 'class': 'cbi-section-node-tabbed' }, [
                    E('table', { 'class': 'cbi-section-table' }, [
                        E('tr', { 'class': 'cbi-section-table-titles' }, [
                            E('th', null, _('节点数')),
                            E('th', null, _('运行中')),
                            E('th', null, _('在线用户')),
                            E('th', null, _('总流量')),
                            E('th', null, _('面板同步'))
                        ]),
                        E('tr', { 'class': 'cbi-section-table-row' }, [
                            E('td', null, String(nodes.length)),
                            E('td', null, String(status.running || 0)),
                            E('td', null, String(online)),
                            E('td', null, common.fmtBytes(totalTraffic)),
                            E('td', null, String(nodes.filter(function (n) { return n.panel && n.panel.running && !n.panel.lastError; }).length + '/' + nodes.length))
                        ])
                    ])
                ])
            ])
        ]);

        var rows = nodes.map(function (n) {
            var ops = E('td', null, [
                E('button', {
                    'class': 'cbi-button cbi-button-action',
                    'click': function () { L.require('ui').showModal(null, '重启节点 ' + n.name + '?', [{ text: '取消', class: 'btn' }, { text: '确定', class: 'btn cbi-button-positive', click: function () {
                        common.api('/action', { body: { action: 'restart', node_id: n.id } }).then(function () { location.reload(); });
                    } }]); }
                }, _('重启')),
                E('button', {
                    'class': 'cbi-button cbi-button-action',
                    'click': function () { L.require('ui').showModal(null, '停止节点 ' + n.name + '?', [{ text: '取消', class: 'btn' }, { text: '确定', class: 'btn cbi-button-negative', click: function () {
                        common.api('/action', { body: { action: 'stop', node_id: n.id } }).then(function () { location.reload(); });
                    } }]); }
                }, _('停止')),
                E('a', { 'class': 'cbi-button cbi-button-action', 'href': L.url('admin/services/nodex/nodeedit', n.id) }, _('配置'))
            ]);
            return E('tr', { 'class': 'cbi-section-table-row' }, [
                E('td', null, [
                    common.stateTag(n.xray && n.xray.running),
                    ' ',
                    E('b', null, n.name),
                    E('span', { 'style': 'color:#999;margin-left:6px' }, n.id)
                ]),
                E('td', null, n.xray ? n.xray.version.split(' ')[0] : '-'),
                E('td', null, n.hy2 && n.hy2.running ? '运行中' : '停止'),
                E('td', null, n.panel && n.panel.lastError ? E('span', { 'class': 'label label-danger' }, '错误') : E('span', { 'class': 'label label-success' }, '正常')),
                E('td', null, (n.panel && n.panel.lastSync) || '-'),
                ops
            ]);
        });

        var table = E('table', { 'class': 'cbi-section-table' }, [
            E('tr', { 'class': 'cbi-section-table-titles' }, [
                E('th', null, _('节点')),
                E('th', null, _('Xray')),
                E('th', null, _('Hysteria2')),
                E('th', null, _('面板同步')),
                E('th', null, _('上次同步')),
                E('th', null, _('操作'))
            ])
        ].concat(rows.length ? rows : [E('tr', null, [E('td', { 'colspan': 6 }, '暂无节点，请到「节点管理」新增')])]));

        return E('div', {}, [
            cards,
            E('div', { 'class': 'cbi-map' }, [
                E('div', { 'class': 'cbi-section cbi-section-node' }, [
                    E('div', { 'class': 'cbi-section-node-tabbed' }, [
                        E('h3', null, _('节点状态')),
                        table
                    ])
                ])
            ]),
            E('div', { 'class': 'cbi-map' }, [
                E('div', { 'class': 'cbi-section cbi-section-node' }, [
                    E('div', { 'class': 'cbi-section-node-tabbed' }, [
                        E('h3', null, _('用户流量')),
                        E('table', { 'class': 'cbi-section-table' }, [
                            E('tr', { 'class': 'cbi-section-table-titles' }, [
                                E('th', null, _('节点')),
                                E('th', null, _('用户 ID')),
                                E('th', null, _('流量')),
                                E('th', null, _('在线 IP'))
                            ])
                        ].concat((users.users || []).map(function (u) {
                            return E('tr', { 'class': 'cbi-section-table-row' }, [
                                E('td', null, u.node_name || '-'),
                                E('td', null, String(u.uid)),
                                E('td', null, common.fmtBytes(u.traffic)),
                                E('td', null, (u.ips || []).join(', ') || '-')
                            ]);
                        })))
                    ])
                ])
            ])
        ]);
    }
});
