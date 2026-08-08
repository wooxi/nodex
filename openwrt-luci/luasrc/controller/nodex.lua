module("luci.controller.nodex", package.seeall)

local api_base = "http://127.0.0.1:8888"

function index()
    entry({"admin", "services", "nodex"}, alias("admin", "services", "nodex", "overview"), _("NodeX"), 80).dependent = false
    entry({"admin", "services", "nodex", "overview"}, view("nodex/overview"), _("总览"), 10)
    entry({"admin", "services", "nodex", "nodes"}, view("nodex/nodes"), _("节点管理"), 20)
    entry({"admin", "services", "nodex", "nodeedit"}, view("nodex/nodeedit"), _("节点编辑"), 30)
    entry({"admin", "services", "nodex", "panel"}, view("nodex/panel"), _("面板对接"), 40)
    entry({"admin", "services", "nodex", "system"}, view("nodex/system"), _("系统设置"), 50)
    entry({"admin", "services", "nodex", "logs"}, view("nodex/logs"), _("运行日志"), 60)
    entry({"admin", "services", "nodex", "api"}, call("api_proxy"), _("API"), 100).leaf = true
end

-- API 代理：/admin/services/nodex/api/<path> → http://127.0.0.1:8888/api/<path>
function api_proxy()
    local http = require "luci.http"
    local jsonc = require "luci.jsonc"
    local nixio = require "nixio"
    local socket = require "nixio.socket"

    local parts = http.pathargs or {}
    local path = table.concat(parts, "/")
    local query = http.getenv("QUERY_STRING") or ""
    if query ~= "" then
        path = path .. "?" .. query
    end

    local method = http.getenv("REQUEST_METHOD") or "GET"
    local body = nil
    local content_type = http.getenv("CONTENT_TYPE") or ""
    if method == "POST" or method == "PUT" then
        local len = tonumber(http.getenv("CONTENT_LENGTH") or "0") or 0
        if len > 0 then
            body = http.getbody(len)
        end
    end

    local url = api_base .. "/api/" .. path
    local out = { status = 502, body = '{"error":"proxy failed"}' }

    -- 使用 nixio socket 实现 HTTP 请求（无额外依赖）
    local ok, resp_body, resp_code = http_request(method, url, body, content_type)
    if ok then
        out.status = resp_code
        out.body = resp_body
    end

    http.status(out.status)
    http.prepare_content("application/json; charset=utf-8")
    http.write(out.body)
end

-- 简易 HTTP 客户端（nixio socket，避免依赖 curl）
function http_request(method, url, body, content_type)
    local socket = require "nixio.socket"
    local parsed = url:match("^http://([^/]+)(/.*)$")
    if not parsed then return false, "", 500 end
    local host_port, path = parsed:match("^([^/]+)(/.*)$")
    local host, port = host_port:match("^(.+):(%d+)$")
    if not port then host, port = host_port, 80 end

    local s = socket.tcp()
    if not s then return false, "", 500 end
    s:setopt("socket", "reuseaddr", true)
    s:settimeout(8)
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
    -- 去掉响应头
    local _, _, body_part = resp:find("\r\n\r\n(.*)$", 1)
    if not body_part then
        _, _, body_part = resp:find("\n\n(.*)$", 1)
    end
    return true, body_part or "", status
end
