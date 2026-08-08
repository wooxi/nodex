module("luci.controller.nodex", package.seeall)

local api_base = "http://127.0.0.1:8888"

function index()
    entry({"admin", "services", "nodex"}, alias("admin", "services", "nodex", "index"), _("NodeX"), 80).dependent = false
    entry({"admin", "services", "nodex", "index"}, template("nodex/index"), _("NodeX"), 10)
    entry({"admin", "services", "nodex", "api"}, call("api_proxy"), _("API"), 100).leaf = true
    entry({"admin", "services", "nodex", "backend"}, call("backend_ctl"), _("后端管理"), 90).leaf = true
end

-- 后端管理：action = status | install | restart
-- 用于从 LuCI 快捷下载安装 nodex daemon + xray + hysteria 内核
function backend_ctl(action)
    local http = require "luci.http"
    local util = require "luci.util"
    local jsonc = require "luci.jsonc"

    if action == "status" then
        local nixio = require "nixio"
        local function exists(p)
            local st = nixio.fs.stat(p)
            return st and st.type == "reg"
        end
        local res = {
            nodex_bin = exists("/usr/bin/nodex"),
            xray_bin = exists("/usr/bin/xray"),
            hysteria_bin = exists("/usr/bin/hysteria"),
            nodex_running = (util.exec("/bin/pidof nodex") or "") ~= "",
            nodex_enabled = (util.exec("/etc/init.d/nodex enabled 2>/dev/null && echo yes") or "") ~= ""
        }
        http.status(200)
        http.prepare_content("application/json; charset=utf-8")
        http.write(jsonc.stringify(res))
        return
    end

    if action == "restart" then
        util.exec("/etc/init.d/nodex restart 2>/dev/null; echo done")
        http.status(200)
        http.prepare_content("application/json; charset=utf-8")
        http.write('{"ok":true,"message":"后端已重启"}')
        return
    end

    if action == "install" then
        -- 写安装脚本并执行（下载 nodex + xray + hysteria 到 /usr/bin）
        local script = [[
#!/bin/sh
set -e
NODEX_URL="https://github.com/wooxi/nodex/releases/latest/download/nodex-linux-amd64"
XRAY_URL="https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip"
HY_URL="https://github.com/apernet/hysteria/releases/latest/download/hysteria-linux-amd64"

WORK=/tmp/nodex-install
rm -rf $WORK
mkdir -p $WORK
cd $WORK
echo "[1/4] 下载 nodex..."
curl -sL -m 120 -o nodex $NODEX_URL
echo "[2/4] 下载 xray..."
curl -sL -m 120 -o xray.zip $XRAY_URL
echo "[3/4] 下载 hysteria..."
curl -sL -m 120 -o hysteria $HY_URL

# 校验下载（GitHub 404 时 body 是 "Not Found"）
for f in nodex hysteria; do
    if [ "$(head -c 9 $f 2>/dev/null)" = "Not Found" ]; then
        echo "下载失败: $f 404" >&2
        exit 1
    fi
done
if [ "$(head -c 9 xray.zip)" = "Not Found" ]; then
    echo "下载失败: xray 404" >&2
    exit 1
fi

# 解压 xray
if ! command -v unzip >/dev/null 2>&1; then
    opkg install unzip >/dev/null 2>&1 || { echo "缺少 unzip 且安装失败" >&2; exit 1; }
fi
unzip -o -q xray.zip xray

# 安装二进制
cp nodex /usr/bin/nodex
cp xray /usr/bin/xray
cp hysteria /usr/bin/hysteria
chmod +x /usr/bin/nodex /usr/bin/xray /usr/bin/hysteria

# init.d 脚本（不存在时创建）
if [ ! -f /etc/init.d/nodex ]; then
    cat > /etc/init.d/nodex <<'EOF2'
#!/bin/sh /etc/rc.common
START=99
STOP=10
USE_PROCD=1
PROG=/usr/bin/nodex
CONFIG=/etc/nodex/config.json
start_service() {
    procd_open_instance
    procd_set_param command "$PROG" start
    procd_set_param respawn
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_set_param pidfile /var/run/nodex.pid
    procd_close_instance
}
stop_service() {
    "$PROG" stop
}
restart() {
    stop
    sleep 1
    start
}
EOF2
    chmod +x /etc/init.d/nodex
fi

# 默认配置（不存在时创建）
if [ ! -f /etc/nodex/config.json ]; then
    mkdir -p /etc/nodex
    cat > /etc/nodex/config.json <<'EOF3'
{"web":{"port":8888,"listen":"127.0.0.1","allow_local":true},"panel":{"enabled":false,"url":"","token":"","node_id":0,"node_type":"","pull_interval":60,"push_interval":60},"system":{"xray_path":"/usr/bin/xray","hysteria_path":"/usr/bin/hysteria","log_level":"info","data_dir":"/etc/nodex","cert_path":"","key_path":"","api_port_base":10085,"hy2_api_port_base":8444},"nodes":[]}
EOF3
fi

# hysteria2 默认证书
if [ ! -f /etc/nodex/hy2.crt ] && command -v openssl >/dev/null 2>&1; then
    openssl req -x509 -newkey rsa:2048 -keyout /etc/nodex/hy2.key -out /etc/nodex/hy2.crt -days 3650 -nodes -subj "/CN=nodex" 2>/dev/null
    sed -i 's|"cert_path":""|"cert_path":"/etc/nodex/hy2.crt"|; s|"key_path":""|"key_path":"/etc/nodex/hy2.key"|' /etc/nodex/config.json
fi

# 启动
/etc/init.d/nodex enable 2>/dev/null
/etc/init.d/nodex restart
echo "[4/4] 后端安装完成"
rm -rf $WORK
]]

        local f = io.open("/tmp/nodex-install.sh", "w")
        f:write(script)
        f:close()
        os.execute("chmod +x /tmp/nodex-install.sh")

        -- 异步执行，避免 LuCI 超时
        os.execute("( /tmp/nodex-install.sh > /tmp/nodex-install.log 2>&1 & )")
        http.status(200)
        http.prepare_content("application/json; charset=utf-8")
        http.write('{"ok":true,"message":"后端安装已在后台启动，请稍候 1-2 分钟刷新查看"}')
        return
    end

    http.status(400)
    http.prepare_content("application/json; charset=utf-8")
    http.write('{"error":"unknown action"}')
end

-- API 代理：/admin/services/nodex/api/<path> → http://127.0.0.1:8888/api/<path>
-- LuCI 的 call() 会把路径剩余部分作为参数传入（...）
function api_proxy(...)
    local http = require "luci.http"

    local parts = { ... }
    local path = table.concat(parts, "/")
    local query = http.getenv("QUERY_STRING") or ""
    if query ~= "" then
        path = path .. "?" .. query
    end

    local method = http.getenv("REQUEST_METHOD") or "GET"
    local body = nil
    local content_type = http.getenv("CONTENT_TYPE") or ""
    if method == "POST" or method == "PUT" then
        body = http.content()
        if body == "" then body = nil end
    end

    local ok, resp_body, resp_code = http_request(method, api_base .. "/api/" .. path, body, content_type)
    if not ok then
        resp_code = resp_code or 502
        resp_body = resp_body or '{"error":"proxy failed"}'
    end

    http.status(resp_code)
    http.prepare_content("application/json; charset=utf-8")
    http.write(resp_body)
end

-- 简易 HTTP 客户端（nixio C 模块 socket，无额外依赖）
function http_request(method, url, body, content_type)
    local nixio = require "nixio"

    local host_port, path = url:match("^http://([^/]+)(/.*)$")
    if not host_port then return false, '{"error":"bad url"}', 500 end
    local host, port = host_port:match("^(.+):(%d+)$")
    if not port then host, port = host_port, 80 end

    local s = nixio.socket("inet", "stream")
    if not s then return false, '{"error":"no socket"}', 500 end
    s:setopt("socket", "rcvtimeo", 8)
    s:setopt("socket", "sndtimeo", 8)
    if not s:connect(host, tonumber(port)) then
        s:close()
        return false, '{"error":"backend unreachable"}', 502
    end

    local headers = "Host: " .. host_port .. "\r\n" ..
        "User-Agent: luci-nodex\r\n" ..
        "Content-Type: " .. (content_type ~= "" and content_type or "application/json") .. "\r\n" ..
        "Accept: application/json\r\n" ..
        "Connection: close\r\n"
    local req = method .. " " .. path .. " HTTP/1.1\r\n" .. headers
    if body then
        req = req .. "Content-Length: " .. #body .. "\r\n"
    end
    req = req .. "\r\n"
    if body then req = req .. body end

    s:send(req)
    local resp = ""
    while true do
        local chunk = s:recv(4096)
        if not chunk or chunk == "" then break end
        resp = resp .. chunk
        if #resp > 10 * 1024 * 1024 then break end
    end
    s:close()

    local status = tonumber(resp:match("^HTTP/%d%.%d (%d+)")) or 500
    local _, _, body_part = resp:find("\r\n\r\n(.*)$", 1)
    if not body_part then
        _, _, body_part = resp:find("\n\n(.*)$", 1)
    end
    return true, body_part or "", status
end
