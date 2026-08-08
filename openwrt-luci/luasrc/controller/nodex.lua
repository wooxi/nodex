module("luci.controller.nodex", package.seeall)

local api_base = "http://127.0.0.1:8888"

function index()
    entry({"admin", "services", "nodex"}, alias("admin", "services", "nodex", "index"), _("NodeX"), 80).dependent = false
    entry({"admin", "services", "nodex", "index"}, template("nodex/index"), _("NodeX"), 10)
    entry({"admin", "services", "nodex", "api"}, call("api_proxy"), _("API"), 100).leaf = true
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
