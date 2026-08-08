'use strict';
'require view';
'require ui';
'require dom';

var common = require('luci.view.nodex.common');

return view.extend({
    load: function () {
        var self = this;
        return common.api('/status').then(function (st) {
            self.nodes = st.nodes || [];
            return null;
        });
    },

    render: function () {
        var self = this;
        var sel = E('select', { 'class': 'cbi-input-select' }, self.nodes.map(function (n) {
            return E('option', { 'value': n.id }, n.name);
        }));
        var typeSel = E('select', { 'class': 'cbi-input-select' }, [
            E('option', { 'value': 'error' }, _('错误日志')),
            E('option', { 'value': 'access' }, _('访问日志'))
        ]);
        var pre = E('pre', { 'style': 'background:#222;color:#ddd;padding:10px;border-radius:4px;max-height:60vh;overflow:auto;font-size:12px' }, '（加载中...）');

        function loadLogs() {
            var node = sel.value;
            if (!node) return;
            common.api('/logs?node=' + node + '&type=' + typeSel.value).then(function (res) {
                pre.textContent = res.logs || '（暂无日志）';
            });
        }
        sel.addEventListener('change', loadLogs);
        typeSel.addEventListener('change', loadLogs);

        var refreshBtn = E('button', { 'class': 'cbi-button cbi-button-action', 'click': loadLogs }, _('刷新'));

        // 自动刷新
        setInterval(function () { if (document.body.contains(pre)) loadLogs(); }, 8000);
        setTimeout(loadLogs, 300);

        return E('div', { 'class': 'cbi-map' }, [
            E('div', { 'class': 'cbi-section cbi-section-node' }, [
                E('div', { 'class': 'cbi-section-node-tabbed' }, [
                    E('h3', null, _('运行日志')),
                    E('div', { 'class': 'cbi-value' }, [
                        E('label', { 'class': 'cbi-value-title' }, _('节点')),
                        E('div', { 'class': 'cbi-value-field' }, [sel, ' ', typeSel, ' ', refreshBtn])
                    ]),
                    E('div', { 'class': 'cbi-value' }, [
                        E('label', { 'class': 'cbi-value-title' }, ''),
                        E('div', { 'class': 'cbi-value-field', 'style': 'width:100%' }, [pre])
                    ])
                ])
            ])
        ]);
    }
});
