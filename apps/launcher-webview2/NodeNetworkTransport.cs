using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace DouyinJuheLauncherWebView2
{
    // Only the network layer moves to the tenant PC. Protocol bodies and
    // responses remain raw bytes, including 64-bit conversation identifiers.
    sealed class NodeNetworkTransport : IDisposable
    {
        readonly Uri endpoint;
        readonly string token;
        readonly CancellationTokenSource lifetime = new CancellationTokenSource();
        readonly SemaphoreSlim sendLock = new SemaphoreSlim(1, 1);
        readonly HttpClient direct;
        Task runner;
        ClientWebSocket agent;
        readonly HashSet<string> executed = new HashSet<string>();
        public string PublicIp { get; private set; }
        public static bool PlatformHost(string host)
        {
            var domains = new[] { "douyin.com", "douyinstatic.com", "douyinpic.com", "douyincdn.com", "byteimg.com", "bytecdn.cn", "bytedance.com", "bytedance.net", "bytegecko.com", "bytescm.com", "bytetos.com", "bytednsdoc.com", "byted-static.com", "bytegoofy.com", "ibytedapm.com", "yhgfb-cn-static.com", "pstatp.com", "snssdk.com", "toutiao.com", "amemv.com", "ibytedtos.com", "zijieapi.com", "iesdouyin.com", "bytetcc.com" };
            return domains.Any(domain => String.Equals(host, domain, StringComparison.OrdinalIgnoreCase) || host.EndsWith("." + domain, StringComparison.OrdinalIgnoreCase));
        }
        // Upload and media hosts vary per request, so fetches accept any public
        // DNS name over HTTPS/443. IP literals, single-label names and local or
        // internal suffixes are refused so the node cannot be pointed at the
        // user's own machine or LAN. The login tunnel still uses PlatformHost.
        public static bool PublicDnsHost(string host)
        {
            host = (host ?? "").ToLowerInvariant();
            if (host.Length == 0 || host.Length > 253) return false;
            if (!System.Text.RegularExpressions.Regex.IsMatch(host, "^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$")) return false;
            foreach (var suffix in new[] { ".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet" })
                if (host.EndsWith(suffix, StringComparison.Ordinal)) return false;
            return true;
        }
        public NodeNetworkTransport(string api, string nodeToken)
            : this(api, nodeToken, new HttpClientHandler { UseProxy = false, UseCookies = false, AllowAutoRedirect = false }) { }
        internal NodeNetworkTransport(string api, string nodeToken, HttpMessageHandler handler)
        {
            endpoint = NetworkEndpoint(api);
            token = nodeToken;
            direct = new HttpClient(handler);
            direct.Timeout = TimeSpan.FromSeconds(30);
        }
        internal static Uri NetworkEndpoint(string api)
        {
            var parsed = new Uri(api);
            var builder = new UriBuilder(parsed) { Scheme = parsed.Scheme == "https" ? "wss" : parsed.Scheme == "http" ? "ws" : parsed.Scheme, Path = "/api/v1/node/network" };
            return builder.Uri;
        }
        static JavaScriptSerializer Serializer() { return new JavaScriptSerializer { MaxJsonLength = 24 * 1024 * 1024 }; }
        internal static async Task SendJson(ClientWebSocket socket, object value, CancellationToken cancel)
        {
            var bytes = Encoding.UTF8.GetBytes(Serializer().Serialize(value));
            await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, cancel);
        }
        internal static async Task<Dictionary<string, object>> ReadJson(ClientWebSocket socket, CancellationToken cancel)
        {
            using (var data = new MemoryStream())
            {
                var bytes = new byte[32768];
                WebSocketReceiveResult read;
                do
                {
                    read = await socket.ReceiveAsync(new ArraySegment<byte>(bytes), cancel);
                    if (read.MessageType != WebSocketMessageType.Text) throw new IOException("节点连接关闭或响应无效");
                    data.Write(bytes, 0, read.Count);
                    if (data.Length > 24 * 1024 * 1024) throw new IOException("节点响应过大");
                } while (!read.EndOfMessage);
                return Serializer().DeserializeObject(Encoding.UTF8.GetString(data.ToArray())) as Dictionary<string, object>;
            }
        }
        public void Start() { if (runner == null) runner = Task.Run(() => RunAsync()); }
        // 本端认为长连接仍然打开。
        public bool Connected { get { var current = agent; return current != null && current.State == WebSocketState.Open; } }
        // 服务器已断开而本端没收到关闭通知（半死连接）时，直接中止当前连接，RunAsync 会在 3 秒后重新连接。
        public void ForceReconnect()
        {
            var current = agent;
            Log("force_reconnect server_reports_disconnected");
            if (current != null) { try { current.Abort(); } catch { } }
        }
        static void Observe(Task task) { task.ContinueWith(done => { var ignored = done.Exception; }, TaskContinuationOptions.OnlyOnFaulted); }
        async Task RunAsync()
        {
            while (!lifetime.IsCancellationRequested)
            {
                using (var connection = new ClientWebSocket())
                {
                    try
                    {
                        // 保活只用服务端每 15 秒的 ping；客户端 ping 会与大帧发送交错，疑似造成帧损坏。
                        connection.Options.KeepAliveInterval = TimeSpan.Zero;
                        connection.Options.Proxy = null;
                        await connection.ConnectAsync(endpoint, lifetime.Token);
                        await SendJson(connection, new Dictionary<string, object> { { "type", "authenticate" }, { "role", "agent" }, { "token", token } }, lifetime.Token);
                        var auth = await ReadJson(connection, lifetime.Token);
                        if (auth == null || !auth.ContainsKey("type") || Convert.ToString(auth["type"]) != "authenticated") throw new IOException("节点认证失败");
                        agent = connection;
                        PublicIp = auth.ContainsKey("publicIp") ? Convert.ToString(auth["publicIp"]) : "";
                        while (connection.State == WebSocketState.Open && !lifetime.IsCancellationRequested)
                        {
                            var request = await ReadJson(connection, lifetime.Token);
                            if (request == null || !request.ContainsKey("type") || Convert.ToString(request["type"]) != "fetch") throw new IOException("节点任务无效");
                            var id = Convert.ToString(request["id"]);
                            lock (executed) { if (!executed.Add(id)) throw new IOException("重复节点任务"); }
                            // The server never retries a dispatched task. A new connection
                            // gets new IDs; retain only this connection's replay guard.
                            Observe(ExecuteAsync(connection, request));
                        }
                    }
                    catch (Exception error) { Log("agent_loop_ended " + error.GetType().Name + " " + error.Message + " state=" + connection.State + " close=" + connection.CloseStatus + " " + connection.CloseStatusDescription); }
                    finally { if (agent == connection) { agent = null; PublicIp = ""; } lock (executed) executed.Clear(); }
                }
                try { await Task.Delay(3000, lifetime.Token); } catch { }
            }
        }
        async Task ExecuteAsync(ClientWebSocket connection, Dictionary<string, object> task)
        {
            var result = new Dictionary<string, object> { { "type", "fetch_result" }, { "id", task["id"] } };
            try
            {
                var target = new Uri(Convert.ToString(task["url"]));
                if (target.Scheme != "https" || target.Port != 443 || !String.IsNullOrEmpty(target.UserInfo) || !PublicDnsHost(target.Host)) throw new IOException("节点请求目标无效");
                var method = Convert.ToString(task["method"]);
                if (!new[] { "GET", "HEAD", "POST" }.Contains(method)) throw new IOException("节点请求方法无效");
                using (var request = new HttpRequestMessage(new HttpMethod(method), target))
                {
                    var body = Convert.FromBase64String(Convert.ToString(task["body"]));
                    if (body.Length > 8 * 1024 * 1024) throw new IOException("请求过大");
                    if (body.Length > 0 || method == "POST") request.Content = new ByteArrayContent(body);
                    var headers = task["headers"] as Dictionary<string, object>;
                    if (headers != null) foreach (var header in headers)
                    {
                        // Authorization belongs to the target service (ImageX SigV4 and
                        // upload store tokens) and Host is part of that signature, so
                        // both are allowed. Host must still name the target.
                        if (String.Equals(header.Key, "Proxy-Authorization", StringComparison.OrdinalIgnoreCase)) throw new IOException("节点请求头无效");
                        if (String.Equals(header.Key, "Host", StringComparison.OrdinalIgnoreCase))
                        {
                            if (!String.Equals(Convert.ToString(header.Value), target.Host, StringComparison.OrdinalIgnoreCase)) throw new IOException("节点请求头无效");
                            continue;
                        }
                        if (!request.Headers.TryAddWithoutValidation(header.Key, Convert.ToString(header.Value)) && request.Content != null)
                            request.Content.Headers.TryAddWithoutValidation(header.Key, Convert.ToString(header.Value));
                    }
                    var fetchStarted = DateTime.UtcNow;
                    using (var response = await direct.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, lifetime.Token))
                    using (var stream = await response.Content.ReadAsStreamAsync())
                    using (var data = new MemoryStream())
                    {
                        // Diagnostic: time until response headers, plus the host's connection
                        // usage, to tell connection-pool waits from slow upstream responses.
                        var headersMs = (int)(DateTime.UtcNow - fetchStarted).TotalMilliseconds;
                        if (headersMs > 2000)
                        {
                            var point = ServicePointManager.FindServicePoint(target);
                            Log("slow_headers " + method + " " + target.Host + target.AbsolutePath + " headersMs=" + headersMs + " connections=" + point.CurrentConnections + "/" + point.ConnectionLimit);
                        }
                        var bytes = new byte[32768]; int count;
                        while ((count = await stream.ReadAsync(bytes, 0, bytes.Length, lifetime.Token)) > 0)
                        {
                            data.Write(bytes, 0, count);
                            if (data.Length > 8 * 1024 * 1024) throw new IOException("响应过大");
                        }
                        var responseHeaders = new Dictionary<string, object>();
                        foreach (var header in response.Headers) responseHeaders[header.Key] = String.Join(", ", header.Value);
                        foreach (var header in response.Content.Headers) responseHeaders[header.Key] = String.Join(", ", header.Value);
                        result["status"] = (int)response.StatusCode; result["headers"] = responseHeaders;
                        result["body"] = Convert.ToBase64String(data.ToArray());
                    }
                }
            }
            catch { result["error"] = "NODE_FETCH_FAILED"; }
            try
            {
                await sendLock.WaitAsync(lifetime.Token);
                try { if (connection.State == WebSocketState.Open) await SendResult(connection, result); }
                finally { sendLock.Release(); }
            }
            catch (Exception error) { Log("send_result_failed " + error.GetType().Name + " " + error.Message); }
        }
        // 大响应拆成多个小文本帧回传，服务端按 index/count 重组；小响应仍是单个 fetch_result。
        const int PartChars = 32 * 1024;
        async Task SendResult(ClientWebSocket connection, Dictionary<string, object> result)
        {
            var body = result.ContainsKey("body") ? result["body"] as string : null;
            if (body == null || body.Length <= PartChars) { await SendJson(connection, result, lifetime.Token); return; }
            var count = (body.Length + PartChars - 1) / PartChars;
            for (var index = 0; index < count; index++)
            {
                var start = index * PartChars;
                var part = new Dictionary<string, object> { { "type", "fetch_result_part" }, { "id", result["id"] }, { "index", index }, { "count", count }, { "data", body.Substring(start, Math.Min(PartChars, body.Length - start)) } };
                if (index == 0) { part["status"] = result["status"]; part["headers"] = result["headers"]; }
                await SendJson(connection, part, lifetime.Token);
            }
        }
        static void Log(string message)
        {
            try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "douyinjuhe-node-network.log"), DateTime.Now.ToString("o") + " " + message + Environment.NewLine); } catch { }
        }
        public void Dispose() { lifetime.Cancel(); if (agent != null) agent.Abort(); direct.Dispose(); }
    }

    // Loopback-only CONNECT proxy used by the login browser. The encrypted
    // tunnel terminates at the authenticated DouyinJuhe API, then uses exactly
    // the server/direct or tenant-bound proxy chosen for the account.
    sealed class NodeLoginProxy : IDisposable
    {
        readonly TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
        readonly CancellationTokenSource lifetime = new CancellationTokenSource();
        readonly Uri endpoint;
        readonly string token, mode, proxyId;
        readonly Task acceptLoop;
        public int Port { get; private set; }
        // True while the loopback listener is accepting connections. A disposed
        // proxy keeps its old Port number, so callers must check this before
        // handing that port to a new client process.
        public bool Listening { get { return !lifetime.IsCancellationRequested; } }
        public NodeLoginProxy(string api, string nodeToken, string networkMode, string boundProxy)
        {
            endpoint = NodeNetworkTransport.NetworkEndpoint(api);
            token = nodeToken; mode = networkMode; proxyId = boundProxy;
            listener.Start(); Port = ((IPEndPoint)listener.LocalEndpoint).Port;
            acceptLoop = Task.Run(() => AcceptAsync());
        }
        async Task AcceptAsync()
        {
            while (!lifetime.IsCancellationRequested)
            {
                try { var tcp = await listener.AcceptTcpClientAsync(); Observe(ForwardAsync(tcp)); }
                catch { return; }
            }
        }
        static void Observe(Task task) { task.ContinueWith(done => { var ignored = done.Exception; }, TaskContinuationOptions.OnlyOnFaulted); }
        async Task ForwardAsync(TcpClient tcp)
        {
            using (tcp)
            using (var connection = new ClientWebSocket())
            using (var cancel = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token))
            {
                cancel.CancelAfter(TimeSpan.FromMinutes(10));
                var stream = tcp.GetStream();
                var lastTarget = "";
                try
                {
                    var header = new List<byte>(); var one = new byte[1];
                    while (header.Count < 8192)
                    {
                        if (await stream.ReadAsync(one, 0, 1, cancel.Token) == 0) return;
                        header.Add(one[0]);
                        if (header.Count >= 4 && Encoding.ASCII.GetString(header.ToArray(), header.Count - 4, 4) == "\r\n\r\n") break;
                    }
                    var line = Encoding.ASCII.GetString(header.ToArray()).Split('\r')[0].Split(' ');
                    lastTarget = line.Length > 1 ? line[0] + " " + line[1] : "";
                    Uri plain;
                    if (line.Length == 3 && line[0] == "GET" && Uri.TryCreate(line[1], UriKind.Absolute, out plain) && plain.Scheme == "http" && plain.Port == 80 && String.IsNullOrEmpty(plain.UserInfo) && NodeNetworkTransport.PlatformHost(plain.Host))
                    {
                        // Plain-HTTP asset (e.g. avatars) on a platform host: send
                        // the client to HTTPS so it goes through the CONNECT tunnel.
                        var redirect = Encoding.ASCII.GetBytes("HTTP/1.1 307 Temporary Redirect\r\nLocation: https://" + plain.Host + plain.PathAndQuery + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        await stream.WriteAsync(redirect, 0, redirect.Length, cancel.Token);
                        return;
                    }
                    if (line.Length != 3 || line[0] != "CONNECT") throw new IOException("只支持 HTTPS 登录");
                    var target = new Uri("https://" + line[1]);
                    if (target.Port != 443 || !String.IsNullOrEmpty(target.UserInfo) || target.AbsolutePath != "/" || !String.IsNullOrEmpty(target.Query) || !String.IsNullOrEmpty(target.Fragment) || !NodeNetworkTransport.PlatformHost(target.Host)) throw new IOException("登录目标无效");
                    connection.Options.Proxy = null;
                    await connection.ConnectAsync(endpoint, cancel.Token);
                    await NodeNetworkTransport.SendJson(connection, new Dictionary<string, object> { { "type", "authenticate" }, { "role", "tunnel" }, { "token", token }, { "host", target.Host }, { "port", 443 }, { "networkMode", mode }, { "proxyId", proxyId } }, cancel.Token);
                    var ready = await NodeNetworkTransport.ReadJson(connection, cancel.Token);
                    if (ready == null || !ready.ContainsKey("type") || Convert.ToString(ready["type"]) != "tunnel_ready") throw new IOException("登录出口不可用");
                    var ok = Encoding.ASCII.GetBytes("HTTP/1.1 200 Connection Established\r\n\r\n");
                    await stream.WriteAsync(ok, 0, ok.Length, cancel.Token);
                    var toServer = Task.Run(async () => {
                        var bytes = new byte[32768]; int count;
                        while ((count = await stream.ReadAsync(bytes, 0, bytes.Length, cancel.Token)) > 0)
                            await connection.SendAsync(new ArraySegment<byte>(bytes, 0, count), WebSocketMessageType.Binary, true, cancel.Token);
                    });
                    var toBrowser = Task.Run(async () => {
                        var bytes = new byte[32768];
                        while (connection.State == WebSocketState.Open)
                        {
                            var read = await connection.ReceiveAsync(new ArraySegment<byte>(bytes), cancel.Token);
                            if (read.MessageType == WebSocketMessageType.Close) break;
                            if (read.MessageType != WebSocketMessageType.Binary) throw new IOException("登录隧道响应无效");
                            await stream.WriteAsync(bytes, 0, read.Count, cancel.Token);
                        }
                    });
                    await Task.WhenAny(toServer, toBrowser); cancel.Cancel(); connection.Abort(); tcp.Close();
                    try { await Task.WhenAll(toServer, toBrowser); } catch { }
                }
                catch (Exception error)
                {
                    connection.Abort();
                    try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "douyinjuhe-node-network.log"), DateTime.Now.ToString("o") + " login_proxy_failed " + error.GetType().Name + " " + error.Message + " target=" + lastTarget + Environment.NewLine); } catch { }
                }
            }
        }
        public void Dispose() { lifetime.Cancel(); listener.Stop(); }
    }

    sealed partial class MainForm
    {
        NodeNetworkTransport networkAgent;
        NodeLoginProxy creatorLoginProxy, douyinLoginProxy;
        string networkAgentToken;
        string creatorNetworkMode = "local_node", creatorProxyId = "";
        string douyinNetworkMode = "local_node", douyinProxyId = "";
        void EnsureNetworkAgent()
        {
            if (String.IsNullOrWhiteSpace(nodeToken)) return;
            if (networkAgent != null && networkAgentToken == nodeToken) return;
            if (networkAgent != null) networkAgent.Dispose();
            networkAgentToken = nodeToken;
            networkAgent = new NodeNetworkTransport(api, nodeToken); networkAgent.Start();
        }
        void CloseNetwork()
        {
            if (networkAgent != null) networkAgent.Dispose(); networkAgent = null; networkAgentToken = null;
            if (creatorLoginProxy != null) creatorLoginProxy.Dispose(); creatorLoginProxy = null;
            if (douyinLoginProxy != null) douyinLoginProxy.Dispose(); douyinLoginProxy = null;
        }
        async Task<Dictionary<string, object>> ResolveLoginNetworkAsync(Dictionary<string, object> payload)
        {
            EnsureNetworkAgent();
            var mode = payload != null && payload.ContainsKey("networkMode") ? Convert.ToString(payload["networkMode"]) : "local_node";
            if (!new[] { "direct", "custom", "local_node" }.Contains(mode)) throw new InvalidOperationException("网络方式无效。");
            var proxyId = payload != null && payload.ContainsKey("proxyId") ? Convert.ToString(payload["proxyId"]) : "";
            if (mode == "custom" && String.IsNullOrWhiteSpace(proxyId))
            {
                if (String.Equals(mode, douyinNetworkMode, StringComparison.Ordinal)) proxyId = douyinProxyId;
                if (String.IsNullOrWhiteSpace(proxyId) && String.Equals(mode, creatorNetworkMode, StringComparison.Ordinal)) proxyId = creatorProxyId;
            }
            if (mode == "custom" && String.IsNullOrWhiteSpace(proxyId))
            {
                var address = payload != null && payload.ContainsKey("proxyAddress") ? Convert.ToString(payload["proxyAddress"]) : "";
                Uri parsed;
                if (!Uri.TryCreate("http://" + address, UriKind.Absolute, out parsed) || parsed.IsDefaultPort || !String.IsNullOrEmpty(parsed.UserInfo) || parsed.AbsolutePath != "/") throw new InvalidOperationException("请填写有效代理地址和端口。");
                var created = await RequestAsync("POST", "/api/v1/proxies", new Dictionary<string, object> {
                    { "name", parsed.Host + ":" + parsed.Port }, { "protocol", payload["proxyProtocol"] }, { "host", parsed.Host }, { "port", parsed.Port },
                    { "username", payload.ContainsKey("proxyUsername") ? payload["proxyUsername"] : "" }, { "password", payload.ContainsKey("proxyPassword") ? payload["proxyPassword"] : "" },
                    { "expiresAt", payload.ContainsKey("proxyExpiresAt") ? payload["proxyExpiresAt"] : null }
                }, true) as Dictionary<string, object>;
                proxyId = Convert.ToString(created["id"]);
            }
            return new Dictionary<string, object> { { "networkMode", mode }, { "proxyId", mode == "custom" ? proxyId : "" } };
        }
        static void CopyNetwork(Dictionary<string, object> source, Dictionary<string, object> target)
        {
            foreach (var key in new[] { "networkMode", "proxyId" }) if (source.ContainsKey(key)) target[key] = source[key];
        }
        async Task<object> LaunchDouyinWithNetworkAsync(Dictionary<string, object> payload)
        {
            var config = await ResolveLoginNetworkAsync(payload);
            var mode = Convert.ToString(config["networkMode"]); var proxy = Convert.ToString(config["proxyId"]);
            if (Convert.ToBoolean(DouyinChatState()["running"]) && (mode != douyinNetworkMode || proxy != douyinProxyId)) throw new InvalidOperationException("抖音聊天仍在使用原出口，请先退出客户端再切换网络方式。");
            douyinNetworkMode = mode; douyinProxyId = proxy;
            if (!Convert.ToBoolean(DouyinChatState()["running"]))
            {
                if (douyinLoginProxy != null) douyinLoginProxy.Dispose();
                douyinLoginProxy = mode == "local_node" ? null : new NodeLoginProxy(api, nodeToken, mode, proxy);
            }
            var launched = LaunchDouyinChat() as Dictionary<string, object> ?? new Dictionary<string, object>();
            launched["networkMode"] = mode; launched["proxyId"] = proxy;
            return launched;
        }
        async Task<object> PrepareDouyinWithNetworkAsync(Dictionary<string, object> payload)
        {
            var config = await ResolveLoginNetworkAsync(payload);
            douyinNetworkMode = Convert.ToString(config["networkMode"]); douyinProxyId = Convert.ToString(config["proxyId"]);
            // The running client keeps the proxy port it was started with, so the
            // old proxy must stay alive until PrepareDouyinChatLoginAsync has
            // actually closed that client (it resets the proxy afterwards).
            var prepared = await PrepareDouyinChatLoginAsync() as Dictionary<string, object> ?? new Dictionary<string, object>();
            prepared["networkMode"] = douyinNetworkMode; prepared["proxyId"] = douyinProxyId;
            return prepared;
        }
        async Task<HttpResponseMessage> SendCreatorNetworkAsync(HttpRequestMessage request)
        {
            var handler = new HttpClientHandler { UseCookies = false, AllowAutoRedirect = false, UseProxy = creatorLoginProxy != null };
            if (creatorLoginProxy != null) handler.Proxy = new WebProxy("http://127.0.0.1:" + creatorLoginProxy.Port);
            using (var client = new HttpClient(handler)) { client.Timeout = TimeSpan.FromSeconds(20); return await client.SendAsync(request); }
        }
    }
}
