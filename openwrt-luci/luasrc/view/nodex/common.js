'use strict';
'require view';
'require ui';
'require dom';

var apiBase = '/cgi-bin/luci/admin/services/nodex/api';

function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: { 'Accept': 'application/json' } };
    if (opts.body) {
        init.method = 'POST';
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opts.body);
    }
    return L.resolveDefault(fetch(apiBase + path, init).then(function (r) {
        return r.json().catch(function () { return {}; });
    }), {});
}

function fmtBytes(n) {
    if (!n) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return n.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function notify(type, msg) {
    ui.addNotification(null, E('p', msg));
}

function stateTag(running) {
    return E('span', {
        'class': running ? 'label label-success' : 'label label-danger'
    }, running ? '运行中' : '已停止');
}

return L.Class.extend({
    api: api,
    fmtBytes: fmtBytes,
    notify: notify,
    stateTag: stateTag
});
