using System;
using System.Diagnostics;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Net.Http;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography.X509Certificates;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace DouyinJuheLauncherWebView2
{
    sealed partial class MainForm : Form
    {
        readonly WebView2 browser = new WebView2();
        readonly JavaScriptSerializer json = new JavaScriptSerializer();
        readonly HttpClient http = new HttpClient(new HttpClientHandler { UseProxy = false });
        static readonly Uri DouyinChatInstallerUrl = new Uri("https://lf-impc.douyinstatic.com/obj/tos-aweme-im-pc/7094550955558967563/releases/420753164/1.1.33/win32-x64/DouyinChat-x64-default.exe");
        const string DouyinChatInstallerVersion = "1.1.33";
        const long DouyinChatInstallerBytes = 157714200L;
        const string DouyinChatInstallerSha256 = "16b758724841973b9ff464a9f94cd7ba382a0f8591926270046f6eefb5e014e2";
        const string DouyinChatInstallerSigner = "Douyin Vision Co., Ltd.";
        Dictionary<string, object> douyinInstallState = new Dictionary<string, object> { { "phase", "idle" }, { "message", "" } };
        Task<Dictionary<string, object>> douyinInstallTask;
        readonly string api = "http://127.0.0.1:18182";
        readonly string launcherDataPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "DouyinJuheLauncherWebView2");
        string LocalAccountsPath { get { return String.IsNullOrWhiteSpace(userId) ? null : Path.Combine(launcherDataPath, "tenants", userId, "account-materials.dat"); } }
        string ActiveDouyinProfileBindingPath { get { return Path.Combine(launcherDataPath, "douyin-active-profile.json"); } }
        readonly string sessionPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "DouyinJuheLauncherWebView2", "node-session.dat");
        const string LauncherVersion = "0.2.117-webview2";
        const string UpdateManifestUrl = "http://127.0.0.1:18182/downloads/launcher/webview2-latest.json";
        string token;
        string nodeToken;
        string nodeId;
        string userName;
        string userId;
        DateTime douyinLaunchAtUtc = DateTime.MinValue;
        DateTime douyinReadinessBaselineUtc = DateTime.MinValue;
        DateTime douyinAutomaticCloseAtUtc = DateTime.MinValue;
        DateTime douyinFreshProfilePreparedAtUtc = DateTime.MinValue;
        DateTime douyinLoginSuccessBaselineUtc = DateTime.MinValue;
        DateTime douyinTrialReadMarkUtc = DateTime.MinValue;
        DateTime douyinLastProbeUtc = DateTime.MinValue;
        int douyinLoginMarkerBaseline = 0;
        DateTime douyinLoginSeenAtUtc = DateTime.MinValue;
        Form creatorWindow;
        WebView2 creatorBrowser;
        CoreWebView2Environment creatorEnvironment;
        string creatorUserDataPath;
        string creatorProfileUid;
        Dictionary<string, object> creatorState = new Dictionary<string, object> { { "phase", "idle" }, { "message", "创作者中心尚未登录" } };
        const string CreatorHomeUrl = "https://creator.douyin.com/";
        const string CreatorInfoUrl = "https://creator.douyin.com/web/api/media/user/info/";
        const string CreatorUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

        string BundledNativeHelper(string name)
        {
            var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "native", "bin", name + ".exe");
            return File.Exists(path) ? path : null;
        }

        public MainForm()
        {
            // The lightweight shell targets .NET Framework on older Windows hosts;
            // explicitly enable the TLS version required by the HTTPS API.
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
            // .NET Framework limits concurrent connections per host to 2 by default.
            // Two accounts polling imapi.douyin.com every 3 s can occupy both slots
            // and make a send wait for a free connection, so raise the limit.
            ServicePointManager.DefaultConnectionLimit = 32;
            http.Timeout = TimeSpan.FromSeconds(20);
            Text = "抖音聚合登录器";
            try { Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            Width = 1080;
            Height = 740;
            StartPosition = FormStartPosition.CenterScreen;
            browser.Dock = DockStyle.Fill;
            Controls.Add(browser);
            LoadSession();
            FormClosed += (s, e) => CloseNetwork();
            Shown += async (s, e) => await InitializeAsync();
        }

        async Task InitializeAsync()
        {
            var userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "DouyinJuheLauncherWebView2", "EBWebView");
            try
            {
                await EnsureWebView2RuntimeAsync();
                var environment = await CoreWebView2Environment.CreateAsync(null, userData);
                await browser.EnsureCoreWebView2Async(environment);
                browser.CoreWebView2.WebMessageReceived += async (s, e) => await HandleMessageAsync(e.TryGetWebMessageAsString());
                await browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript());
                browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
                browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                browser.CoreWebView2.Settings.IsStatusBarEnabled = false;
                var webRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "web");
                browser.CoreWebView2.SetVirtualHostNameToFolderMapping("app.douyinjuhe.local", webRoot, CoreWebView2HostResourceAccessKind.Allow);
                browser.CoreWebView2.Navigate("https://app.douyinjuhe.local/index.html");
                EnsureNetworkAgent();
            }
            catch (Exception error)
            {
                MessageBox.Show("系统未安装 Microsoft Edge WebView2 Runtime，无法启动抖音聚合登录器。\n\n" + error.Message, "抖音聚合登录器", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }

        async Task EnsureWebView2RuntimeAsync()
        {
            try
            {
                CoreWebView2Environment.GetAvailableBrowserVersionString(null);
                return;
            }
            catch (Exception error)
            {
                try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "douyinjuhe-webview2-runtime.log"), DateTime.Now.ToString("o") + " " + error.GetType().FullName + " " + error.Message + Environment.NewLine); } catch { }
            }
            var choice = MessageBox.Show("这台电脑缺少 Microsoft WebView2 Runtime。\n\n登录器将从微软官方地址下载并安装运行环境，完成后自动继续。", "抖音聚合登录器", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
            if (choice != DialogResult.Yes) throw new InvalidOperationException("未安装 Microsoft WebView2 Runtime，登录器无法启动。");
            var installer = Path.Combine(Path.GetTempPath(), "MicrosoftEdgeWebView2Setup.exe");
            var bytes = await http.GetByteArrayAsync("https://go.microsoft.com/fwlink/?linkid=2124701");
            if (bytes == null || bytes.Length < 100000) throw new InvalidOperationException("WebView2 Runtime 安装包下载失败。");
            File.WriteAllBytes(installer, bytes);
            using (var process = Process.Start(new ProcessStartInfo { FileName = installer, Arguments = "/silent /install", UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden }))
            {
                await Task.Run(() => process.WaitForExit());
                if (process.ExitCode != 0) throw new InvalidOperationException("WebView2 Runtime 安装未完成（退出码 " + process.ExitCode + "）。");
            }
            try { File.Delete(installer); } catch { }
            try { CoreWebView2Environment.GetAvailableBrowserVersionString(null); }
            catch { throw new InvalidOperationException("WebView2 Runtime 安装后仍不可用，请重启登录器重试。"); }
        }

        async Task HandleMessageAsync(string raw)
        {
            Dictionary<string, object> message;
            try { message = json.DeserializeObject(raw) as Dictionary<string, object>; } catch { return; }
            if (message == null || !message.ContainsKey("id") || !message.ContainsKey("method")) return;
            var id = Convert.ToString(message["id"]);
            var method = Convert.ToString(message["method"]);
            var payload = message.ContainsKey("payload") ? message["payload"] as Dictionary<string, object> : null;
            try
            {
                object result;
                if (method == "checkConnection")
                {
                    var health = await RequestAsync("GET", "/api/v1/health", null, false) as Dictionary<string, object> ?? new Dictionary<string, object>();
                    health["ok"] = true;
                    health["apiOrigin"] = api;
                    result = health;
                }
                else if (method == "checkUpdate") result = await CheckUpdateAsync();
                else if (method == "installUpdate") result = await InstallUpdateAsync();
                else if (method == "nodeState") result = await NodeStateAsync();
                else if (method == "localNodeState") result = LocalNodeState();
                else if (method == "loginNode") result = await LoginAsync(payload);
                else if (method == "logoutNode") { CloseNetwork(); token = null; nodeToken = null; nodeId = null; userName = null; userId = null; DeleteSession(); result = new Dictionary<string, object> { { "ok", true } }; }
                else if (method == "bindNode") throw new InvalidOperationException("WebView2 版本请使用租户账号密码登录。");
                else if (method == "localAccounts") result = await LocalAccountsAsync();
                else if (method == "douyinChatState") result = DouyinChatState();
                else if (method == "launchDouyinChat") result = await LaunchDouyinWithNetworkAsync(payload);
                else if (method == "captureDouyinChat") result = await CaptureDouyinChatAsync(payload);
                else if (method == "deleteLocalAccount") result = DeleteLocalAccount(payload);
                else if (method == "deleteAccount") result = await DeleteAccountAsync(payload);
                else if (method == "activateAccount") result = await ActivateAccountAsync(payload);
                else if (method == "nodeWallet") result = await NodeWalletAsync();
                else if (method == "bindAccountSlot") result = await BindAccountSlotAsync(payload);
                else if (method == "copyLocalAccountCookie") result = CopyLocalAccountCookie(payload);
                else if (method == "refreshLocalAccountProfiles") result = await LocalAccountsAsync();
                else if (method == "creatorLoginState") result = CreatorLoginState();
                else if (method == "openCreatorLogin") result = await OpenCreatorLoginAsync(payload, false);
                else if (method == "newCreatorLogin") result = await NewCreatorLoginAsync(payload);
                else if (method == "captureCreator") result = await CaptureCreatorAsync(payload);
                else if (method == "installDouyinChat") result = await InstallDouyinChatAsync();
                else if (method == "prepareDouyinChatLogin") result = await PrepareDouyinWithNetworkAsync(payload);
                else if (method == "completeAccountTask") throw new InvalidOperationException("WebView2 预览版尚未接入网页任务回执。");
                else throw new InvalidOperationException("WebView2 迁移桥尚未接入此功能。");
                Respond(id, result, null);
            }
            catch (Exception error)
            {
                if (method == "captureCreator")
                {
                    var expectedUid = payload == null ? "" : SafeText(payload.ContainsKey("expectedUid") ? payload["expectedUid"] : "", 40);
                    var accountId = payload == null ? "" : SafeText(payload.ContainsKey("accountId") ? payload["accountId"] : "", 80);
                    LogCreatorDiagnostic("creator_capture_failed", "capture_or_upload", expectedUid: expectedUid, accountId: accountId,
                        failureCode: CreatorFailureCode(error.Message));
                }
                Respond(id, null, error.Message);
            }
        }

        Dictionary<string, object>[] ReadLocalAccounts()
        {
            try
            {
                var path = LocalAccountsPath;
                if (String.IsNullOrWhiteSpace(path) || !File.Exists(path)) return new Dictionary<string, object>[0];
                var encrypted = Convert.FromBase64String(File.ReadAllText(path));
                var plain = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
                var value = json.DeserializeObject(Encoding.UTF8.GetString(plain)) as object[];
                var rows = new List<Dictionary<string, object>>();
                if (value != null)
                    foreach (var item in value)
                    {
                        var row = item as Dictionary<string, object>;
                        if (row != null) rows.Add(row);
                    }
                return rows.ToArray();
            }
            catch { throw new InvalidOperationException("本地账号文件无法读取，请使用当前 Windows 用户重试。"); }
        }

        Dictionary<string, object> SafeAccount(Dictionary<string, object> row)
        {
            var safe = new Dictionary<string, object>();
            foreach (var key in new[] { "id", "remoteId", "remoteOnly", "uid", "loginMode", "networkMode", "proxyId", "nodeId", "nodeOnline", "name", "nickname", "note", "douyinId", "avatar", "source", "slot", "currentIp", "status", "statusReason", "checkedAt", "identityStatus", "createdAt", "updatedAt" })
                if (row.ContainsKey(key)) safe[key] = row[key];
            return safe;
        }

        Dictionary<string, object>[] ReadLocalAccountMetadata()
        {
            var rows = new List<Dictionary<string, object>>();
            foreach (var row in ReadLocalAccounts()) rows.Add(SafeAccount(row));
            return rows.ToArray();
        }

        async Task<object> LocalAccountsAsync()
        {
            if (String.IsNullOrWhiteSpace(token) || String.IsNullOrWhiteSpace(userId)) return new Dictionary<string, object> { { "ok", true }, { "accounts", new object[0] }, { "loggedIn", false }, { "serverSynced", false } };
            try
            {
                object[] remote = null;
                Exception remoteError = null;
                for (var attempt = 0; attempt < 2 && remote == null; attempt++)
                {
                    try
                    {
                        if (attempt > 0) await RequestAsync("GET", "/api/v1/health", null, false);
                        remote = await RequestAsync("GET", "/api/v1/accounts", null, true) as object[];
                    }
                    catch (Exception error) { remoteError = error; }
                }
                if (remote == null && remoteError != null) throw remoteError;
                var storedLocal = new List<Dictionary<string, object>>(ReadLocalAccounts());
                var visible = new List<Dictionary<string, object>>();
                var changedLocal = false;
                foreach (var item in remote ?? new object[0])
                {
                    var server = item as Dictionary<string, object>;
                    if (server == null) continue;
                    var uid = Convert.ToString(server.ContainsKey("uid") ? server["uid"] : "");
                    var remoteId = Convert.ToString(server.ContainsKey("id") ? server["id"] : "");
                    var mode = Convert.ToString(server.ContainsKey("loginMode") ? server["loginMode"] : "douyin_chat");
                    var localRow = storedLocal.Find(row => String.Equals(Convert.ToString(row.ContainsKey("remoteId") ? row["remoteId"] : ""), remoteId, StringComparison.Ordinal));
                    if (localRow == null) localRow = storedLocal.Find(row => String.Equals(Convert.ToString(row.ContainsKey("uid") ? row["uid"] : ""), uid, StringComparison.Ordinal) && String.Equals(Convert.ToString(row.ContainsKey("loginMode") ? row["loginMode"] : ""), mode, StringComparison.Ordinal));
                    if (localRow == null)
                    {
                        localRow = new Dictionary<string, object> { { "id", "tenant:" + remoteId }, { "remoteId", remoteId }, { "uid", uid }, { "loginMode", mode } };
                        storedLocal.Add(localRow);
                        changedLocal = true;
                    }
                    if (localRow.ContainsKey("material") && localRow["material"] is Dictionary<string, object>)
                    {
                        localRow["remoteId"] = remoteId;
                    }
                    else if (!String.IsNullOrWhiteSpace(nodeToken) && !String.IsNullOrWhiteSpace(remoteId) && !String.IsNullOrWhiteSpace(uid))
                    {
                        try
                        {
                            var kind = mode == "creator" ? "creator_web" : "duoshan_pc_im";
                            var recovered = await RequestAsync("POST", "/api/v1/node/account-material/read", new Dictionary<string, object> { { "accountId", remoteId }, { "kind", kind } }, true, true) as Dictionary<string, object>;
                            var protectedBlob = Convert.ToString(recovered != null && recovered.ContainsKey("blob") ? recovered["blob"] : "");
                            if (!String.IsNullOrWhiteSpace(protectedBlob))
                            {
                                var plain = ProtectedData.Unprotect(Convert.FromBase64String(protectedBlob), null, DataProtectionScope.CurrentUser);
                                var restored = json.DeserializeObject(Encoding.UTF8.GetString(plain)) as Dictionary<string, object>;
                                var restoredUid = Convert.ToString(restored != null && restored.ContainsKey("uid") ? restored["uid"] : "");
                                var hasCookie = restored != null && restored.ContainsKey("cookie") && !String.IsNullOrWhiteSpace(Convert.ToString(restored["cookie"]));
                                if (restored != null && restoredUid == uid && hasCookie)
                                {
                                    localRow["material"] = restored;
                                    localRow["remoteId"] = remoteId;
                                    changedLocal = true;
                                }
                            }
                        }
                        catch { }
                    }
                    var serverRow = SafeAccount(server);
                    serverRow["remoteId"] = remoteId;
                    serverRow["remoteOnly"] = !(localRow.ContainsKey("material") && localRow["material"] is Dictionary<string, object>);
                    visible.Add(serverRow);
                }
                if (changedLocal) WriteLocalAccounts(storedLocal);
                return new Dictionary<string, object> { { "ok", true }, { "accounts", visible.ToArray() }, { "serverSynced", true } };
            }
            catch (Exception error)
            {
                var errorMessage = error == null ? "" : error.Message;
                var detail = String.IsNullOrWhiteSpace(errorMessage) ? "未知错误" : errorMessage.Replace("\r", " ").Replace("\n", " ").Substring(0, Math.Min(180, errorMessage.Length));
                return new Dictionary<string, object> { { "ok", false }, { "accounts", new object[0] }, { "serverSynced", false }, { "serverError", "服务器账号列表读取失败：" + detail } };
            }
        }

        void WriteLocalAccounts(List<Dictionary<string, object>> rows)
        {
            var path = LocalAccountsPath;
            if (String.IsNullOrWhiteSpace(path)) throw new InvalidOperationException("登录抖音聚合租户账号后才能保存本地身份材料。");
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            var plain = Encoding.UTF8.GetBytes(json.Serialize(rows.ToArray()));
            var encrypted = ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser);
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            var bytes = Encoding.UTF8.GetBytes(Convert.ToBase64String(encrypted));
            try
            {
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush(true);
                }
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            finally { try { if (File.Exists(temporary)) File.Delete(temporary); } catch { } }
        }

        object DeleteLocalAccount(Dictionary<string, object> payload)
        {
            throw new InvalidOperationException("请使用服务器账号删除操作。");
        }

        async Task<object> DeleteAccountAsync(Dictionary<string, object> payload)
        {
            var id = payload == null || !payload.ContainsKey("id") ? "" : Convert.ToString(payload["id"]);
            var remoteId = payload == null || !payload.ContainsKey("remoteId") ? "" : Convert.ToString(payload["remoteId"]);
            if (String.IsNullOrWhiteSpace(remoteId) || String.IsNullOrWhiteSpace(token)) throw new InvalidOperationException("请先登录并从服务器读取账号后再删除。");
            await RequestAsync("DELETE", "/api/v1/accounts/" + Uri.EscapeDataString(remoteId), null, true);
            var rows = new List<Dictionary<string, object>>(ReadLocalAccounts());
            rows.RemoveAll(row => String.Equals(Convert.ToString(row.ContainsKey("remoteId") ? row["remoteId"] : ""), remoteId, StringComparison.Ordinal));
            WriteLocalAccounts(rows);
            return await LocalAccountsAsync();
        }

        async Task<object> ActivateAccountAsync(Dictionary<string, object> payload)
        {
            var remoteId = payload == null || !payload.ContainsKey("remoteId") ? "" : Convert.ToString(payload["remoteId"]);
            var slot = payload == null || !payload.ContainsKey("slot") ? "" : Convert.ToString(payload["slot"]);
            if (String.IsNullOrWhiteSpace(remoteId) || String.IsNullOrWhiteSpace(slot) || String.IsNullOrWhiteSpace(token)) throw new InvalidOperationException("服务器账号、坑位或租户登录状态不可用。");
            return await RequestAsync("POST", "/api/v1/accounts/" + Uri.EscapeDataString(remoteId) + "/activate", new Dictionary<string, object> { { "slot", slot } }, true);
        }

        async Task<object> NodeWalletAsync()
        {
            if (String.IsNullOrWhiteSpace(nodeToken)) throw new InvalidOperationException("登录器尚未登录。");
            return await RequestAsync("POST", "/api/v1/node/wallet", new Dictionary<string, object>(), true, true);
        }

        async Task<object> BindAccountSlotAsync(Dictionary<string, object> payload)
        {
            var remoteId = payload == null || !payload.ContainsKey("remoteId") ? "" : Convert.ToString(payload["remoteId"]);
            if (String.IsNullOrWhiteSpace(remoteId) || remoteId.Length > 200) throw new InvalidOperationException("账号尚未同步到服务器，请先重新登录该账号。");
            if (String.IsNullOrWhiteSpace(nodeToken)) throw new InvalidOperationException("登录器尚未登录。");
            return await RequestAsync("POST", "/api/v1/node/account-slot", new Dictionary<string, object> { { "accountId", remoteId } }, true, true);
        }

        object CopyLocalAccountCookie(Dictionary<string, object> payload)
        {
            var id = payload == null || !payload.ContainsKey("id") ? "" : Convert.ToString(payload["id"]);
            if (String.IsNullOrWhiteSpace(userId) || String.IsNullOrWhiteSpace(token)) throw new InvalidOperationException("请先登录当前租户。");
            foreach (var row in ReadLocalAccounts())
            {
                if (!String.Equals(Convert.ToString(row.ContainsKey("remoteId") ? row["remoteId"] : ""), id, StringComparison.Ordinal)) continue;
                var material = row.ContainsKey("material") ? row["material"] as Dictionary<string, object> : null;
                if (material == null || !material.ContainsKey("cookie")) break;
                var cookie = Convert.ToString(material["cookie"]);
                if (String.IsNullOrWhiteSpace(cookie) || !cookie.Contains("sessionid=")) break;
                Clipboard.SetText(cookie);
                Task.Delay(60000).ContinueWith(_ => { try { if (Clipboard.ContainsText() && Clipboard.GetText() == cookie) Clipboard.Clear(); } catch { } });
                return new Dictionary<string, object> { { "ok", true }, { "clearsAfterSeconds", 60 } };
            }
            throw new InvalidOperationException("账号身份材料不可用。");
        }

        Dictionary<string, object> CreatorLoginState()
        {
            var result = new Dictionary<string, object>();
            foreach (var pair in creatorState) result[pair.Key] = pair.Value;
            result["open"] = creatorWindow != null && !creatorWindow.IsDisposed;
            return result;
        }

        void SetCreatorState(string phase, string message, string uid = null)
        {
            creatorState = new Dictionary<string, object> { { "phase", phase }, { "message", message } };
            if (!String.IsNullOrWhiteSpace(uid)) creatorState["uid"] = uid;
        }

        string CreatorProfileRoot()
        {
            if (String.IsNullOrWhiteSpace(userId)) throw new InvalidOperationException("请先登录抖音聚合租户账号。");
            var root = Path.Combine(launcherDataPath, "tenants", userId, "creator-profiles");
            Directory.CreateDirectory(root);
            return root;
        }

        string CreatorProfilePath(string uid)
        {
            var key = SafeText(uid, 80);
            if (String.IsNullOrWhiteSpace(key)) return null;
            // UID is the normal key.  During a re-login of an older row where
            // the UID is temporarily absent, use the account id as a stable
            // fallback rather than creating a fresh browser fingerprint.
            key = System.Text.RegularExpressions.Regex.Replace(key, "[^A-Za-z0-9_-]", "_");
            if (String.IsNullOrWhiteSpace(key)) return null;
            return Path.Combine(CreatorProfileRoot(), key);
        }

        static string Sha256Hex(string value)
        {
            using (var sha = SHA256.Create())
            {
                var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(value ?? ""));
                return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
            }
        }

        static string DiagnosticTag(string value)
        {
            return String.IsNullOrWhiteSpace(value) ? "" : Sha256Hex(value).Substring(0, 12);
        }

        static string SafeFingerprintTag(string value)
        {
            return System.Text.RegularExpressions.Regex.IsMatch(value ?? "", "^[0-9a-fA-F]{64}$") ? value.Substring(0, 12).ToLowerInvariant() : "";
        }

        static string CreatorFailureCode(string message)
        {
            var value = message ?? "";
            if (value.IndexOf("UID", StringComparison.OrdinalIgnoreCase) >= 0) return "UID_CHECK_FAILED";
            if (value.IndexOf("身份材料", StringComparison.Ordinal) >= 0 || value.IndexOf("材料", StringComparison.Ordinal) >= 0) return "MATERIAL_FAILED";
            if (value.IndexOf("HTTP 409", StringComparison.OrdinalIgnoreCase) >= 0) return "HTTP_409";
            if (value.IndexOf("HTTP 4", StringComparison.OrdinalIgnoreCase) >= 0) return "HTTP_4XX";
            if (value.IndexOf("HTTP 5", StringComparison.OrdinalIgnoreCase) >= 0) return "HTTP_5XX";
            if (value.IndexOf("尚未登录", StringComparison.Ordinal) >= 0 || value.IndexOf("sessionid", StringComparison.OrdinalIgnoreCase) >= 0) return "LOGIN_NOT_READY";
            return "CAPTURE_OR_UPLOAD_FAILED";
        }

        void LogCreatorDiagnostic(string eventName, string stage, string uid = "", string expectedUid = "", string accountId = "", string materialFingerprint = "", string cookieFingerprint = "", string browserStateFingerprint = "", string result = "", string failureCode = "")
        {
            try
            {
                var directory = Path.Combine(launcherDataPath, "logs");
                Directory.CreateDirectory(directory);
                var path = Path.Combine(directory, "creator-diagnostic.log");
                var info = new FileInfo(path);
                if (info.Exists && info.Length > 2 * 1024 * 1024)
                {
                    var previous = path + ".1";
                    if (File.Exists(previous)) File.Delete(previous);
                    File.Move(path, previous);
                }
                var row = new Dictionary<string, object>
                {
                    { "atUtc", DateTime.UtcNow.ToString("o") }, { "source", "launcher" }, { "event", eventName },
                    { "stage", stage }, { "launcherVersion", LauncherVersion }, { "tenantTag", DiagnosticTag(userId) },
                    { "accountTag", DiagnosticTag(accountId) }, { "uidTag", DiagnosticTag(uid) },
                    { "expectedUidTag", DiagnosticTag(expectedUid) }, { "profileKeyTag", DiagnosticTag(String.IsNullOrWhiteSpace(uid) ? "" : "uid:" + uid) },
                    { "profilePathTag", DiagnosticTag(creatorUserDataPath) },
                    { "materialFingerprint", SafeFingerprintTag(materialFingerprint) },
                    { "cookieFingerprint", SafeFingerprintTag(cookieFingerprint) },
                    { "browserStateFingerprint", SafeFingerprintTag(browserStateFingerprint) },
                    { "result", result }, { "failureCode", failureCode }
                };
                File.AppendAllText(path, json.Serialize(row) + Environment.NewLine, new UTF8Encoding(false));
            }
            catch { }
        }

        string CreatorProfileBindingPath(string profilePath)
        {
            return String.IsNullOrWhiteSpace(profilePath) ? null : Path.Combine(profilePath, "creator_profile_binding.json");
        }

        Dictionary<string, object> ReadCreatorProfileBinding(string profilePath)
        {
            var path = CreatorProfileBindingPath(profilePath);
            if (String.IsNullOrWhiteSpace(path) || !File.Exists(path)) return null;
            try { return json.DeserializeObject(File.ReadAllText(path, Encoding.UTF8)) as Dictionary<string, object>; }
            catch { return null; }
        }

        void WriteCreatorProfileBinding(string profilePath, Dictionary<string, object> binding)
        {
            if (String.IsNullOrWhiteSpace(profilePath) || binding == null) throw new InvalidOperationException("Creator Profile 绑定信息无效。");
            Directory.CreateDirectory(profilePath);
            var path = CreatorProfileBindingPath(profilePath);
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllText(temporary, json.Serialize(binding), Encoding.UTF8);
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            finally { try { if (File.Exists(temporary)) File.Delete(temporary); } catch { } }
        }

        Dictionary<string, object> BuildCreatorProfileBinding(string uid, string cookie, string browserState)
        {
            var sessionHashes = new Dictionary<string, object>();
            foreach (var name in new[] { "sessionid", "sessionid_ss", "sid_tt", "msToken" })
            {
                var match = System.Text.RegularExpressions.Regex.Match(cookie ?? "", "(?:^|;\\s*)" + name + "=([^;]*)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                if (match.Success && !String.IsNullOrWhiteSpace(match.Groups[1].Value)) sessionHashes[name] = Sha256Hex(match.Groups[1].Value);
            }
            return new Dictionary<string, object>
            {
                { "creatorUid", uid }, { "profileKey", "uid:" + uid },
                { "cookieFingerprint", Sha256Hex(cookie) }, { "browserStateFingerprint", Sha256Hex(browserState) },
                { "sessionValueHashes", sessionHashes }, { "userAgent", CreatorUserAgent },
                { "source", "douyinjuhe-webview2" }, { "updatedAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }
            };
        }

        string NewCreatorPendingProfile()
        {
            var path = Path.Combine(CreatorProfileRoot(), "pending-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(path);
            return path;
        }

        void PromoteCreatorProfile(string sourcePath, string uid)
        {
            var destination = CreatorProfilePath(uid);
            if (String.IsNullOrWhiteSpace(sourcePath) || String.IsNullOrWhiteSpace(destination) ||
                String.Equals(Path.GetFullPath(sourcePath), Path.GetFullPath(destination), StringComparison.OrdinalIgnoreCase) ||
                !Directory.Exists(sourcePath)) return;
            for (var attempt = 0; attempt < 12; attempt++)
            {
                try
                {
                    if (Directory.Exists(destination))
                    {
                        var backup = destination + ".replaced-" + DateTime.UtcNow.ToString("yyyyMMddHHmmssfff");
                        try { Directory.Move(destination, backup); } catch { }
                    }
                    Directory.Move(sourcePath, destination);
                    return;
                }
                catch { Thread.Sleep(250); }
            }
            // Keep the pending directory as a recoverable profile if WebView2
            // still owns a file.  It is never deleted as part of re-login.
        }

        async Task<object> OpenCreatorLoginAsync(Dictionary<string, object> payload = null, bool forceNew = false)
        {
            if (String.IsNullOrWhiteSpace(token) || String.IsNullOrWhiteSpace(nodeToken) || String.IsNullOrWhiteSpace(userId)) throw new InvalidOperationException("请先登录抖音聚合租户账号，再添加创作者中心账号。");
            var network = await ResolveLoginNetworkAsync(payload);
            var selectedMode = Convert.ToString(network["networkMode"]);
            var selectedProxy = Convert.ToString(network["proxyId"]);
            var expectedUid = payload == null ? "" : Convert.ToString(payload.ContainsKey("expectedUid") ? payload["expectedUid"] : "");
            var accountId = payload == null ? "" : Convert.ToString(payload.ContainsKey("accountId") ? payload["accountId"] : "");
            expectedUid = SafeText(expectedUid, 40);
            accountId = SafeText(accountId, 80);
            if (creatorWindow != null && !creatorWindow.IsDisposed)
            {
                if (selectedMode != creatorNetworkMode || selectedProxy != creatorProxyId) throw new InvalidOperationException("请先关闭当前登录窗口，再切换网络出口。");
                if (!String.IsNullOrWhiteSpace(expectedUid) && !String.Equals(creatorProfileUid, expectedUid, StringComparison.Ordinal))
                    throw new InvalidOperationException("当前创作者窗口属于其他账号，请使用所选账号的重登入口。");
                creatorWindow.Focus();
                SetCreatorState("waiting_login", "请在创作者中心完成登录");
                var existingState = CreatorLoginState(); existingState["networkMode"] = selectedMode; existingState["proxyId"] = selectedProxy; return existingState;
            }
            SetCreatorState("opening", "正在打开创作者中心");
            // Existing-account relogin reuses the account's persistent
            // WebView2 profile. Only a genuinely new account gets a pending
            // directory; that directory is promoted to the UID after capture.
            creatorProfileUid = System.Text.RegularExpressions.Regex.IsMatch(expectedUid ?? "", "^\\d{1,30}$")
                ? expectedUid
                : (String.IsNullOrWhiteSpace(accountId) ? null : "account-" + accountId);
            creatorUserDataPath = creatorProfileUid != null ? CreatorProfilePath(creatorProfileUid) : NewCreatorPendingProfile();
            LogCreatorDiagnostic("creator_login_open", "profile_selected", expectedUid: expectedUid, accountId: accountId,
                result: creatorProfileUid == null ? "temporary_profile" : (Directory.Exists(creatorUserDataPath) ? "existing_account_profile" : "new_account_profile"));
            if (creatorProfileUid != null && Directory.Exists(creatorUserDataPath))
            {
                var binding = ReadCreatorProfileBinding(creatorUserDataPath);
                var boundUid = binding == null || !binding.ContainsKey("creatorUid") ? "" : Convert.ToString(binding["creatorUid"]);
                if (!String.IsNullOrWhiteSpace(boundUid) && !String.Equals(boundUid, expectedUid, StringComparison.Ordinal))
                    throw new InvalidOperationException("Creator Profile 与待重登账号不匹配，已阻止打开旧身份。");
            }
            creatorNetworkMode = selectedMode; creatorProxyId = selectedProxy;
            if (creatorLoginProxy != null) creatorLoginProxy.Dispose();
            creatorLoginProxy = selectedMode == "local_node" ? null : new NodeLoginProxy(api, nodeToken, selectedMode, selectedProxy);
            creatorWindow = new Form { Text = "抖音聚合 · 创作者中心登录", Width = 1180, Height = 820, MinimumSize = new System.Drawing.Size(900, 640), StartPosition = FormStartPosition.CenterParent };
            creatorBrowser = new WebView2 { Dock = DockStyle.Fill };
            creatorWindow.Controls.Add(creatorBrowser);
            creatorWindow.FormClosed += (s, e) =>
            {
                creatorWindow = null;
                creatorBrowser = null;
                creatorEnvironment = null;
                SetCreatorState("idle", "创作者中心尚未登录");
                creatorUserDataPath = null;
                creatorProfileUid = null;
                if (creatorLoginProxy != null) creatorLoginProxy.Dispose(); creatorLoginProxy = null;
            };
            creatorWindow.Show(this);
            try
            {
                var networkArguments = creatorLoginProxy == null ? "--no-proxy-server" : "--proxy-server=http://127.0.0.1:" + creatorLoginProxy.Port + " --proxy-bypass-list=<-loopback>";
                creatorEnvironment = await CoreWebView2Environment.CreateAsync(null, creatorUserDataPath, new CoreWebView2EnvironmentOptions { AdditionalBrowserArguments = networkArguments });
                await creatorBrowser.EnsureCoreWebView2Async(creatorEnvironment);
                creatorBrowser.CoreWebView2.Settings.AreDevToolsEnabled = false;
                creatorBrowser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                creatorBrowser.CoreWebView2.Settings.IsStatusBarEnabled = false;
                creatorBrowser.CoreWebView2.Settings.IsZoomControlEnabled = true;
                if (forceNew)
                {
                    SetCreatorState("opening", "正在清理所选账号的旧登录态");
                    await ClearCreatorLoginStateAsync(creatorBrowser.CoreWebView2);
                    LogCreatorDiagnostic("creator_login_reset", "selected_profile_cleared", expectedUid: expectedUid, accountId: accountId, result: "cookies_and_dom_storage_cleared");
                }
                creatorBrowser.CoreWebView2.Navigate(CreatorHomeUrl);
                SetCreatorState("waiting_login", "请在创作者中心完成登录；完成后点击“读取登录状态”");
                var loginState = CreatorLoginState(); loginState["networkMode"] = selectedMode; loginState["proxyId"] = selectedProxy; return loginState;
            }
            catch
            {
                if (creatorWindow != null && !creatorWindow.IsDisposed) creatorWindow.Close();
                throw;
            }
        }

        internal static Task ClearCreatorLoginStateAsync(CoreWebView2 core)
        {
            if (core == null) throw new InvalidOperationException("创作者浏览器尚未准备完成。");
            // Clear authentication only in this account's WebView2 profile.
            // Keep its directory, browser settings, and other account profiles.
            return core.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.Cookies | CoreWebView2BrowsingDataKinds.AllDomStorage);
        }

        async Task<object> NewCreatorLoginAsync(Dictionary<string, object> payload = null)
        {
            if (creatorWindow != null && !creatorWindow.IsDisposed)
            {
                creatorWindow.Close();
                creatorWindow = null;
                creatorBrowser = null;
            }
            return await OpenCreatorLoginAsync(payload, true);
        }

        static string SafeText(object value, int max)
        {
            var text = value == null ? "" : Convert.ToString(value).Trim();
            if (String.IsNullOrWhiteSpace(text) || text.Length > max) return "";
            foreach (var ch in text) if (Char.IsControl(ch)) return "";
            return text;
        }

        static object PathValue(object value, params string[] path)
        {
            object current = value;
            foreach (var part in path)
            {
                var map = current as Dictionary<string, object>;
                if (map == null || !map.ContainsKey(part)) return null;
                current = map[part];
            }
            return current;
        }

        static object CreatorField(Dictionary<string, object> map, params string[] names)
        {
            foreach (var name in names)
                foreach (var pair in map)
                    if (String.Equals(pair.Key, name, StringComparison.OrdinalIgnoreCase) && pair.Value != null) return pair.Value;
            return null;
        }

        // Creator has changed the profile envelope several times. Keep the
        // lookup scoped to objects that contain both an identity field and a
        // profile field, rather than treating an unrelated numeric `id` as UID.
        static Dictionary<string, object> FindCreatorProfile(object value, int depth = 0)
        {
            if (value == null || depth > 8) return null;
            var map = value as Dictionary<string, object>;
            if (map != null)
            {
                var identity = CreatorField(map, "uid", "user_id", "userId", "author_id", "authorId", "sec_uid", "secUid");
                var nickname = CreatorField(map, "nickname", "name", "unique_id", "uniqueId", "short_id", "shortId");
                var identityText = SafeText(identity, 80);
                if (System.Text.RegularExpressions.Regex.IsMatch(identityText, "^\\d{1,30}$")) return map;
                var genericId = SafeText(CreatorField(map, "id"), 80);
                if (nickname != null && System.Text.RegularExpressions.Regex.IsMatch(genericId, "^\\d{1,30}$")) return map;
                foreach (var child in map.Values)
                {
                    var found = FindCreatorProfile(child, depth + 1);
                    if (found != null) return found;
                }
                return null;
            }
            var array = value as object[];
            if (array != null)
                foreach (var child in array)
                {
                    var found = FindCreatorProfile(child, depth + 1);
                    if (found != null) return found;
                }
            return null;
        }

        async Task<Dictionary<string, object>> ReadCreatorPageProfileAsync()
        {
            if (creatorBrowser == null || creatorBrowser.CoreWebView2 == null) return null;
            // Run the same-origin request inside the logged-in Creator page so
            // httpOnly cookies and any page-required request context are kept.
            // The native HttpClient call above cannot reproduce all of those
            // browser details on newer Creator builds.
            var requestScript = @"(() => { try { const xhr = new XMLHttpRequest(); xhr.open('GET', '/web/api/media/user/info/', false); xhr.setRequestHeader('Accept', 'application/json'); xhr.send(null); return xhr.responseText || ''; } catch (_) { return ''; } })()";
            try
            {
                var requestRaw = await creatorBrowser.CoreWebView2.ExecuteScriptAsync(requestScript);
                var responseText = json.DeserializeObject(requestRaw ?? "null") as string ?? "";
                if (!String.IsNullOrWhiteSpace(responseText))
                {
                    var responseObject = json.DeserializeObject(responseText);
                    var responseProfile = FindCreatorProfile(responseObject);
                    if (responseProfile != null) return responseProfile;
                }
            }
            catch { /* continue with page state fallback */ }
            var script = @"(() => {
              const roots = ['__INITIAL_STATE__','__NEXT_DATA__','__NUXT__','_ROUTER_DATA','__APOLLO_STATE__'];
              const seen = new Set(); let count = 0;
              const pick = value => {
                if (!value || count++ > 6000) return null;
                if (typeof value === 'string') { try { return pick(JSON.parse(value)); } catch (_) { return null; } }
                if (typeof value !== 'object' || seen.has(value)) return null;
                seen.add(value);
                if (Array.isArray(value)) { for (const item of value) { const found = pick(item); if (found) return found; } return null; }
                const keys = Object.keys(value); const key = keys.find(k => /^(uid|user_id|userId|author_id|authorId|sec_uid|secUid)$/i.test(k));
                if (key && /^\d{1,30}$/.test(String(value[key]))) return { uid: String(value[key]), nickname: value.nickname || value.name || '', unique_id: value.unique_id || value.uniqueId || value.short_id || value.shortId || '', sec_uid: value.sec_uid || value.secUid || value.sec_user_id || '', avatar_thumb: value.avatar_thumb || value.avatar_medium || value.avatar_larger || null };
                for (const item of Object.values(value)) { const found = pick(item); if (found) return found; }
                return null;
              };
              for (const key of roots) { const found = pick(window[key]); if (found) return found; }
              for (let i = 0; i < localStorage.length; i++) { const raw = localStorage.getItem(localStorage.key(i)); const found = pick(raw); if (found) return found; }
              return null;
            })()";
            var raw = await creatorBrowser.CoreWebView2.ExecuteScriptAsync(script);
            if (String.IsNullOrWhiteSpace(raw) || raw == "null") return null;
            try
            {
                var value = json.DeserializeObject(raw);
                var encoded = value as string;
                if (encoded != null) value = json.DeserializeObject(encoded);
                return value as Dictionary<string, object>;
            }
            catch { return null; }
        }

        static string CreatorAvatar(object user)
        {
            foreach (var field in new[] { "avatar_thumb", "avatar_medium", "avatar_larger" })
            {
                var avatar = PathValue(user, field) as Dictionary<string, object>;
                var urls = avatar == null ? null : avatar.ContainsKey("url_list") ? avatar["url_list"] as object[] : null;
                if (urls == null) continue;
                foreach (var value in urls)
                {
                    Uri parsed;
                    if (Uri.TryCreate(Convert.ToString(value), UriKind.Absolute, out parsed) && parsed.Scheme == Uri.UriSchemeHttps)
                    {
                        var host = parsed.Host.ToLowerInvariant();
                        if (host == "douyinpic.com" || host.EndsWith(".douyinpic.com") || host == "byteimg.com" || host.EndsWith(".byteimg.com")) return parsed.AbsoluteUri;
                    }
                }
            }
            return "";
        }

        static string CookieHeader(List<Dictionary<string, object>> cookies)
        {
            var parts = new List<string>();
            foreach (var cookie in cookies)
            {
                var name = Convert.ToString(cookie["name"]);
                var value = Convert.ToString(cookie["value"]);
                if (!String.IsNullOrWhiteSpace(name) && !String.IsNullOrWhiteSpace(value)) parts.Add(name + "=" + value);
            }
            return String.Join("; ", parts);
        }

        static string CookieValue(List<Dictionary<string, object>> cookies, string name)
        {
            if (cookies == null || String.IsNullOrWhiteSpace(name)) return "";
            foreach (var cookie in cookies)
                if (String.Equals(Convert.ToString(cookie.ContainsKey("name") ? cookie["name"] : ""), name, StringComparison.OrdinalIgnoreCase))
                    return Convert.ToString(cookie.ContainsKey("value") ? cookie["value"] : "") ?? "";
            return "";
        }

        static Dictionary<string, object> StorageData(List<Dictionary<string, object>> storage, string name)
        {
            if (storage == null) return new Dictionary<string, object>();
            var storageJson = new JavaScriptSerializer();
            foreach (var item in storage)
            {
                if (!String.Equals(Convert.ToString(item.ContainsKey("name") ? item["name"] : ""), name, StringComparison.Ordinal)) continue;
                try
                {
                    var outer = storageJson.DeserializeObject(Convert.ToString(item["value"])) as Dictionary<string, object>;
                    if (outer == null) return new Dictionary<string, object>();
                    var data = outer.ContainsKey("data") ? outer["data"] : outer;
                    if (data is string) data = storageJson.DeserializeObject(Convert.ToString(data));
                    return data as Dictionary<string, object> ?? new Dictionary<string, object>();
                }
                catch { return new Dictionary<string, object>(); }
            }
            return new Dictionary<string, object>();
        }

        static string TextField(Dictionary<string, object> values, params string[] names)
        {
            if (values == null) return "";
            foreach (var name in names)
                if (values.ContainsKey(name) && values[name] != null && !String.IsNullOrWhiteSpace(Convert.ToString(values[name]))) return Convert.ToString(values[name]);
            return "";
        }

        static void CopyCreatorMaterialMetadata(Dictionary<string, object> from, Dictionary<string, object> to)
        {
            foreach (var key in new[] { "creator_user_agent", "web_uid", "sec_uid", "msToken", "ticket", "ts_sign", "client_cert", "private_key", "dtrait", "creator_uid", "creator_sec_uid", "creator_unique_id" })
            {
                if (!from.ContainsKey(key)) continue;
                if (!(from[key] is string)) throw new InvalidOperationException("创作者身份字段格式无效。");
                var value = (string)from[key];
                var max = key == "creator_user_agent" ? 512 :
                    key == "web_uid" || key == "creator_uid" ? 40 :
                    key == "sec_uid" || key == "creator_sec_uid" ? 128 :
                    key == "creator_unique_id" ? 64 :
                    key == "msToken" || key == "ticket" ? 4096 :
                    key == "ts_sign" ? 8192 : 16384;
                if (value.Length > max) throw new InvalidOperationException("创作者身份字段过大，未上传。");
                to[key] = value;
            }
        }

        async Task<object> CaptureCreatorAsync(Dictionary<string, object> payload)
        {
            if (creatorWindow == null || creatorWindow.IsDisposed || creatorBrowser == null || creatorBrowser.CoreWebView2 == null) throw new InvalidOperationException("创作者中心登录窗口未打开。");
            if (Convert.ToString(creatorState["phase"]) == "opening") throw new InvalidOperationException("创作者登录窗口正在准备，请等待登录页面打开。");
            var captureExpectedUid = payload == null ? "" : SafeText(payload.ContainsKey("expectedUid") ? payload["expectedUid"] : "", 40);
            var captureAccountId = payload == null ? "" : SafeText(payload.ContainsKey("accountId") ? payload["accountId"] : "", 80);
            LogCreatorDiagnostic("creator_capture_started", "read_profile", expectedUid: captureExpectedUid, accountId: captureAccountId);
            SetCreatorState("capturing", "正在读取创作者中心登录状态");
            var cookies = new List<CoreWebView2Cookie>();
            foreach (var url in new[] { CreatorHomeUrl, "https://www.douyin.com/" })
            {
                var found = await creatorBrowser.CoreWebView2.CookieManager.GetCookiesAsync(url);
                foreach (var item in found)
                {
                    var exists = false;
                    foreach (var prior in cookies) if (prior.Name == item.Name && prior.Domain == item.Domain && prior.Path == item.Path) { exists = true; break; }
                    if (!exists) cookies.Add(item);
                }
            }
            var compactCookies = new List<Dictionary<string, object>>();
            foreach (var item in cookies)
            {
                var domain = (item.Domain ?? "").TrimStart('.').ToLowerInvariant();
                if (domain != "douyin.com" && !domain.EndsWith(".douyin.com")) continue;
                compactCookies.Add(new Dictionary<string, object>
                {
                    { "name", item.Name }, { "value", item.Value ?? "" }, { "domain", item.Domain ?? "" }, { "path", item.Path ?? "/" },
                    { "secure", item.IsSecure }, { "httpOnly", item.IsHttpOnly }, { "sameSite", item.SameSite.ToString() }
                });
            }
            var cookie = CookieHeader(compactCookies);
            if (!System.Text.RegularExpressions.Regex.IsMatch(cookie, "(?:^|;\\s*)sessionid=[^;\\s]+")) throw new InvalidOperationException("创作者中心尚未登录或缺少 sessionid。");
            // Creator's security SDK may keep web_protect in sessionStorage
            // while crypt_sdk remains in localStorage. Capture both stores so
            // the server can reproduce the browser signing context after the
            // login window is closed.
            var filteredStorage = new List<Dictionary<string, object>>();
            var creatorCaptureUserAgent = "";
            var creatorCaptureDtrait = "";
            // The security SDK writes these values asynchronously after the
            // account page reports that login succeeded. Poll briefly instead
            // of uploading a half-complete state when the user clicks read
            // immediately after the QR flow finishes.
            for (var storageAttempt = 0; storageAttempt < 8; storageAttempt++)
            {
                filteredStorage.Clear();
                var storageScript = "JSON.stringify({origin:location.origin,userAgent:navigator.userAgent,dtrait:String(window.__douyinjuhe_dtrait || ''),localStorage:Object.fromEntries(Object.entries(localStorage)),sessionStorage:Object.fromEntries(Object.entries(sessionStorage))})";
                var storageResult = await creatorBrowser.CoreWebView2.ExecuteScriptAsync(storageScript);
                var rawStorage = json.DeserializeObject(storageResult ?? "null") as string ?? "";
                var storageEnvelope = String.IsNullOrWhiteSpace(rawStorage) ? new Dictionary<string, object>() : json.DeserializeObject(rawStorage) as Dictionary<string, object> ?? new Dictionary<string, object>();
                if (TextField(storageEnvelope, "origin") != CreatorHomeUrl.TrimEnd('/')) throw new InvalidOperationException("当前不是创作者中心页面，未读取身份材料。");
                var localStorage = storageEnvelope.ContainsKey("localStorage") ? storageEnvelope["localStorage"] as Dictionary<string, object> : null;
                var sessionStorage = storageEnvelope.ContainsKey("sessionStorage") ? storageEnvelope["sessionStorage"] as Dictionary<string, object> : null;
                filteredStorage.AddRange(CreatorStorageSelection.MergeAll(localStorage, sessionStorage));
                creatorCaptureUserAgent = TextField(storageEnvelope, "userAgent");
                creatorCaptureDtrait = TextField(storageEnvelope, "dtrait");
                if (CreatorStorageSelection.HasSigningMaterial(filteredStorage)) break;
                await Task.Delay(500);
            }
            if (!CreatorStorageSelection.HasSigningMaterial(filteredStorage)) throw new InvalidOperationException("创作者中心签名材料尚未准备完成，请停留在创作者中心几秒后点击“重新读取”。");
            var browserStateObject = new Dictionary<string, object>
            {
                { "cookies", compactCookies.ToArray() },
                { "origins", new object[] { new Dictionary<string, object> { { "origin", CreatorHomeUrl.TrimEnd('/') }, { "localStorage", filteredStorage.ToArray() } } } }
            };
            var browserState = json.Serialize(browserStateObject);
            if (Encoding.UTF8.GetByteCount(browserState) > 90 * 1024) throw new InvalidOperationException("创作者浏览器状态过大，未上传。");
            // Prefer the authenticated WebView context.  Creator's profile API
            // may return 403/500 to a plain HttpClient even when the same
            // logged-in browser can read it (extra browser headers, httpOnly
            // cookies and security SDK state are required).  The old order made
            // a valid login fail at 70% before the server material was uploaded.
            var userMap = await ReadCreatorPageProfileAsync();
            if (userMap == null)
            {
                var request = new HttpRequestMessage(HttpMethod.Get, CreatorInfoUrl);
                request.Headers.TryAddWithoutValidation("Cookie", cookie);
                request.Headers.TryAddWithoutValidation("Accept", "application/json");
                request.Headers.TryAddWithoutValidation("Referer", CreatorHomeUrl);
                request.Headers.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36");
                var response = await SendCreatorNetworkAsync(request);
                var text = await response.Content.ReadAsStringAsync();
                if (!response.IsSuccessStatusCode) throw new InvalidOperationException("创作者账号资料接口不可用（HTTP " + (int)response.StatusCode + ").");
                var info = json.DeserializeObject(text);
                var user = FindCreatorProfile(info) ?? PathValue(info, "user") ?? PathValue(info, "data", "user") ?? PathValue(info, "data", "user_profile") ?? new Dictionary<string, object>();
                userMap = user as Dictionary<string, object> ?? new Dictionary<string, object>();
            }
            var uid = SafeText(CreatorField(userMap, "uid", "user_id", "userId", "author_id", "authorId", "id"), 40);
            if (!System.Text.RegularExpressions.Regex.IsMatch(uid, "^\\d{1,30}$"))
            {
                var pageProfile = await ReadCreatorPageProfileAsync();
                if (pageProfile != null)
                {
                    userMap = pageProfile;
                    uid = SafeText(CreatorField(userMap, "uid", "user_id", "userId", "author_id", "authorId", "id"), 40);
                }
            }
            if (!System.Text.RegularExpressions.Regex.IsMatch(uid, "^\\d{1,30}$")) throw new InvalidOperationException("创作者资料未返回有效 UID。");
            var expectedUid = payload == null ? "" : SafeText(payload.ContainsKey("expectedUid") ? payload["expectedUid"] : "", 40);
            if (System.Text.RegularExpressions.Regex.IsMatch(expectedUid, "^\\d{1,30}$") &&
                !String.Equals(expectedUid, uid, StringComparison.Ordinal))
                throw new InvalidOperationException("创作者账号 UID 与待重登账号不一致，请使用原账号登录。");
            var profile = new Dictionary<string, object>
            {
                { "uid", uid }, { "nickname", SafeText(CreatorField(userMap, "nickname", "name"), 100) },
                { "douyinId", SafeText(CreatorField(userMap, "unique_id", "uniqueId", "short_id", "shortId"), 64) }, { "avatar", CreatorAvatar(userMap) }
            };
            var protectData = StorageData(filteredStorage, "security-sdk/s_sdk_sign_data_key/web_protect");
            var cryptData = StorageData(filteredStorage, "security-sdk/s_sdk_crypt_sdk");
            var secUid = SafeText(CreatorField(userMap, "sec_uid", "secUid", "sec_user_id"), 128);
            if (String.IsNullOrWhiteSpace(secUid))
            {
                foreach (var item in filteredStorage)
                {
                    if (!String.Equals(Convert.ToString(item["name"]), "user_info", StringComparison.Ordinal)) continue;
                    try
                    {
                        var storedProfile = FindCreatorProfile(StorageData(filteredStorage, "user_info"));
                        if (SafeText(CreatorField(storedProfile, "uid", "user_id", "userId", "author_id", "authorId", "id"), 40) == uid)
                            secUid = SafeText(CreatorField(storedProfile, "sec_uid", "secUid", "sec_user_id"), 128);
                    }
                    catch { /* Optional identity metadata stays empty when absent. */ }
                }
            }
            var webUid = CookieValue(compactCookies, "passport_id");
            if (!System.Text.RegularExpressions.Regex.IsMatch(webUid, "^\\d{1,30}$")) webUid = CookieValue(compactCookies, "unique_id");
            if (!System.Text.RegularExpressions.Regex.IsMatch(webUid, "^\\d{1,30}$")) webUid = "";
            var identityMetadata = new Dictionary<string, object>
            {
                { "creator_user_agent", creatorCaptureUserAgent }, { "web_uid", webUid }, { "sec_uid", secUid },
                { "msToken", CookieValue(compactCookies, "msToken") }, { "dtrait", creatorCaptureDtrait },
                { "creator_uid", uid }, { "creator_sec_uid", secUid }, { "creator_unique_id", Convert.ToString(profile["douyinId"]) },
                { "private_key", TextField(cryptData, "ec_privateKey", "private_key") },
                { "ticket", TextField(protectData, "ticket") }, { "ts_sign", TextField(protectData, "ts_sign", "tsSign") },
                { "client_cert", TextField(protectData, "client_cert", "clientCert") }
            };
            var profileBinding = BuildCreatorProfileBinding(uid, cookie, browserState);
            var materialFingerprint = Sha256Hex(cookie + "\0" + browserState);
            LogCreatorDiagnostic("creator_capture_validated", "uid_and_state_validated", uid, captureExpectedUid, captureAccountId,
                materialFingerprint, Convert.ToString(profileBinding["cookieFingerprint"]), Convert.ToString(profileBinding["browserStateFingerprint"]), "ready");
            SetCreatorState("captured", "创作者登录状态已读取", uid);
            var note = payload == null || !payload.ContainsKey("note") ? "" : Convert.ToString(payload["note"]);
            var result = await SaveAndUploadCreatorAsync(uid, cookie, compactCookies, browserState, profile, profileBinding, identityMetadata, note);
            var capturedProfilePath = creatorUserDataPath;
            creatorProfileUid = uid;
            // The Creator window is only an authentication surface. Once the
            // identity has been captured, close it so the tenant returns to
            // the launcher flow. The WebView2 profile itself is retained and
            // promoted to the account UID; it is the account's stable
            // fingerprint/session container and must not be deleted.
            try { if (creatorWindow != null && !creatorWindow.IsDisposed) creatorWindow.BeginInvoke(new Action(() => { if (creatorWindow != null && !creatorWindow.IsDisposed) creatorWindow.Close(); })); } catch { }
            await Task.Delay(250);
            PromoteCreatorProfile(capturedProfilePath, uid);
            var bindingPath = CreatorProfilePath(uid);
            if (!Directory.Exists(bindingPath)) throw new InvalidOperationException("Creator Profile 保存失败，未写入账号绑定信息。");
            WriteCreatorProfileBinding(bindingPath, profileBinding);
            LogCreatorDiagnostic("creator_profile_promoted", "profile_bound", uid, captureExpectedUid, captureAccountId,
                materialFingerprint, Convert.ToString(profileBinding["cookieFingerprint"]), Convert.ToString(profileBinding["browserStateFingerprint"]), "saved");
            return result;
        }

        async Task<object> SaveAndUploadCreatorAsync(string uid, string cookie, List<Dictionary<string, object>> cookies, string browserState, Dictionary<string, object> profile, Dictionary<string, object> profileBinding, Dictionary<string, object> identityMetadata, string note)
        {
            if (String.IsNullOrWhiteSpace(token) || String.IsNullOrWhiteSpace(nodeToken) || String.IsNullOrWhiteSpace(userId)) throw new InvalidOperationException("请先登录抖音聚合租户账号，再添加创作者中心账号。");
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var row = new Dictionary<string, object>
            {
                { "id", "creator:" + uid }, { "uid", uid }, { "loginMode", "creator" }, { "nickname", profile["nickname"] }, { "note", note ?? "" },
                { "douyinId", profile["douyinId"] }, { "avatar", profile["avatar"] }, { "source", "launcher" }, { "slot", null },
                { "status", "inactive" }, { "identityStatus", "captured_unverified" }, { "createdAt", now }, { "updatedAt", now },
                { "material", new Dictionary<string, object> { { "kind", "creator_web" }, { "uid", uid }, { "cookie", cookie }, { "cookieNames", CookieNames(cookies) }, { "browserState", browserState }, { "profile", profile }, { "profileBinding", profileBinding } } }
            };
            CopyCreatorMaterialMetadata(identityMetadata, (Dictionary<string, object>)row["material"]);
            row["networkMode"] = creatorNetworkMode; row["proxyId"] = creatorProxyId;
            var remote = await UploadCreatorRowAsync(row);
            var webAccountId = Convert.ToString(remote["id"]);
            if (String.IsNullOrWhiteSpace(webAccountId)) throw new InvalidOperationException("服务器未确认创作者账号写入。");
            row["remoteId"] = webAccountId;
            row["remoteOnly"] = false;
            var rows = new List<Dictionary<string, object>>(ReadLocalAccounts());
            rows.RemoveAll(item => String.Equals(Convert.ToString(item.ContainsKey("uid") ? item["uid"] : ""), uid, StringComparison.Ordinal)
                && String.Equals(Convert.ToString(item.ContainsKey("loginMode") ? item["loginMode"] : ""), "creator", StringComparison.Ordinal));
            rows.Insert(0, row);
            WriteLocalAccounts(rows);
            return new Dictionary<string, object> { { "ok", true }, { "localAccount", SafeAccount(row) }, { "uploaded", true }, { "uploadError", "" }, { "webAccountId", webAccountId } };
        }

        async Task<Dictionary<string, object>> UploadCreatorRowAsync(Dictionary<string, object> row)
        {
            if (row == null || Convert.ToString(row["loginMode"]) != "creator") throw new InvalidOperationException("不是创作者中心账号。");
            if (String.IsNullOrWhiteSpace(nodeToken)) throw new InvalidOperationException("登录器尚未连接服务器。");
            var material = row.ContainsKey("material") ? row["material"] as Dictionary<string, object> : null;
            if (material == null) throw new InvalidOperationException("本地创作者身份材料不存在。");
            var uid = Convert.ToString(row["uid"] ?? material["uid"]);
            var cookie = Convert.ToString(material.ContainsKey("cookie") ? material["cookie"] : "");
            var browserState = Convert.ToString(material.ContainsKey("browserState") ? material["browserState"] : "");
            var profile = material.ContainsKey("profile") ? material["profile"] as Dictionary<string, object> : null;
            var profileBinding = material.ContainsKey("profileBinding") ? material["profileBinding"] as Dictionary<string, object> : null;
            if (String.IsNullOrWhiteSpace(uid) || String.IsNullOrWhiteSpace(cookie)) throw new InvalidOperationException("本地创作者身份材料不完整。");
            var nickname = Convert.ToString(row.ContainsKey("nickname") ? row["nickname"] : profile != null && profile.ContainsKey("nickname") ? profile["nickname"] : "");
            var douyinId = Convert.ToString(row.ContainsKey("douyinId") ? row["douyinId"] : profile != null && profile.ContainsKey("douyinId") ? profile["douyinId"] : "");
            var avatar = Convert.ToString(row.ContainsKey("avatar") ? row["avatar"] : profile != null && profile.ContainsKey("avatar") ? profile["avatar"] : "");
            var materialFingerprint = Sha256Hex(cookie + "\0" + browserState);
            var bindingForLog = profileBinding ?? BuildCreatorProfileBinding(uid, cookie, browserState);
            LogCreatorDiagnostic("creator_account_upsert_started", "account_upsert", uid, uid, materialFingerprint: materialFingerprint);
            var accountPayload = new Dictionary<string, object>
            {
                { "uid", uid }, { "nickname", nickname }, { "douyinId", douyinId }, { "avatar", avatar },
                { "name", String.IsNullOrWhiteSpace(nickname) ? (String.IsNullOrWhiteSpace(Convert.ToString(row["note"])) ? uid : Convert.ToString(row["note"])) : nickname }, { "loginMode", "creator" }
            };
            if (!row.ContainsKey("networkMode") || String.IsNullOrWhiteSpace(Convert.ToString(row["networkMode"])))
                row["networkMode"] = String.IsNullOrWhiteSpace(creatorNetworkMode) ? "local_node" : creatorNetworkMode;
            CopyNetwork(row, accountPayload);
            var remote = await RequestAsync("POST", "/api/v1/node/account", accountPayload, true, true) as Dictionary<string, object>;
            var accountId = Convert.ToString(remote["id"]);
            if (String.IsNullOrWhiteSpace(accountId)) throw new InvalidOperationException("网页账号创建响应无效。");
            LogCreatorDiagnostic("creator_account_upsert_succeeded", "account_upsert", uid, uid, accountId, materialFingerprint, result: "server_confirmed");
            var keyResponse = await RequestAsync("POST", "/api/v1/node/material-key", new Dictionary<string, object>(), true, true) as Dictionary<string, object>;
            var publicKey = Convert.ToString(keyResponse["publicKey"]);
            if (String.IsNullOrWhiteSpace(publicKey) || !publicKey.Contains("BEGIN PUBLIC KEY")) throw new InvalidOperationException("服务器身份公钥无效。");
            var serverMaterial = new Dictionary<string, object>
            {
                { "kind", "creator_web" }, { "uid", uid }, { "cookie", cookie },
                { "cookieNames", material.ContainsKey("cookieNames") ? material["cookieNames"] : new object[0] },
                { "browserState", browserState }, { "profile", profile ?? new Dictionary<string, object>() },
                { "profileBinding", bindingForLog }
            };
            CopyCreatorMaterialMetadata(material, serverMaterial);
            var serverBlob = await SealMaterialAsync(publicKey, serverMaterial);
            var localBlob = Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(json.Serialize(serverMaterial)), null, DataProtectionScope.CurrentUser));
            var fingerprintInput = Encoding.UTF8.GetBytes(cookie + "\0" + browserState);
            var fingerprint = BitConverter.ToString(SHA256.Create().ComputeHash(fingerprintInput)).Replace("-", "").ToLowerInvariant();
            LogCreatorDiagnostic("creator_material_upload_started", "material_upload", uid, uid, accountId, fingerprint,
                Convert.ToString(bindingForLog.ContainsKey("cookieFingerprint") ? bindingForLog["cookieFingerprint"] : ""),
                Convert.ToString(bindingForLog.ContainsKey("browserStateFingerprint") ? bindingForLog["browserStateFingerprint"] : ""));
            await RequestAsync("POST", "/api/v1/node/account-material", new Dictionary<string, object>
            {
                { "accountId", accountId }, { "kind", "creator_web" }, { "fingerprint", fingerprint }, { "blob", localBlob }, { "serverBlob", serverBlob },
                { "uid", uid }, { "nickname", nickname }, { "douyinId", douyinId }, { "avatar", avatar }
            }, true, true);
            LogCreatorDiagnostic("creator_material_upload_succeeded", "material_upload", uid, uid, accountId, fingerprint,
                Convert.ToString(bindingForLog.ContainsKey("cookieFingerprint") ? bindingForLog["cookieFingerprint"] : ""),
                Convert.ToString(bindingForLog.ContainsKey("browserStateFingerprint") ? bindingForLog["browserStateFingerprint"] : ""), "server_confirmed");
            return remote;
        }

        async Task SyncPendingCreatorAccountsAsync()
        {
            if (String.IsNullOrWhiteSpace(nodeToken)) return;
            var rows = new List<Dictionary<string, object>>(ReadLocalAccounts());
            foreach (var row in rows)
            {
                if (!row.ContainsKey("loginMode") || Convert.ToString(row["loginMode"]) != "creator") continue;
                if (row.ContainsKey("remoteId") && !String.IsNullOrWhiteSpace(Convert.ToString(row["remoteId"]))) continue;
                try
                {
                    var remote = await UploadCreatorRowAsync(row);
                    row["remoteId"] = Convert.ToString(remote["id"]);
                    row["remoteOnly"] = false;
                }
                catch { /* Keep local capture available; the UI will show the next explicit upload error. */ }
            }
            WriteLocalAccounts(rows);
        }

        static object[] CookieNames(List<Dictionary<string, object>> cookies)
        {
            var names = new List<object>();
            foreach (var cookie in cookies) if (cookie.ContainsKey("name") && !names.Contains(cookie["name"])) names.Add(cookie["name"]);
            return names.ToArray();
        }

        Dictionary<string, object> ReadActiveDouyinProfileBinding()
        {
            try
            {
                if (!File.Exists(ActiveDouyinProfileBindingPath)) return null;
                return json.DeserializeObject(File.ReadAllText(ActiveDouyinProfileBindingPath, Encoding.UTF8)) as Dictionary<string, object>;
            }
            catch { return null; }
        }

        void WriteActiveDouyinProfileBinding(string tenantId)
        {
            if (String.IsNullOrWhiteSpace(tenantId)) throw new InvalidOperationException("抖音聊天 Profile 归属租户无效。");
            Directory.CreateDirectory(launcherDataPath);
            var temporary = ActiveDouyinProfileBindingPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            var binding = new Dictionary<string, object>
            {
                { "tenantId", tenantId },
                { "updatedAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() },
                { "version", LauncherVersion }
            };
            try
            {
                File.WriteAllText(temporary, json.Serialize(binding), new UTF8Encoding(false));
                if (File.Exists(ActiveDouyinProfileBindingPath)) File.Replace(temporary, ActiveDouyinProfileBindingPath, null);
                else File.Move(temporary, ActiveDouyinProfileBindingPath);
            }
            finally { try { if (File.Exists(temporary)) File.Delete(temporary); } catch { } }
        }

        void DeleteActiveDouyinProfileBinding()
        {
            try { if (File.Exists(ActiveDouyinProfileBindingPath)) File.Delete(ActiveDouyinProfileBindingPath); } catch { }
        }

        static string SafeTenantPathPart(string value)
        {
            var key = System.Text.RegularExpressions.Regex.Replace(value ?? "", "[^A-Za-z0-9_-]", "_");
            return String.IsNullOrWhiteSpace(key) ? "unbound" : key;
        }

        Dictionary<string, object> DouyinChatState()
        {
            var programFiles = Environment.GetEnvironmentVariable("ProgramW6432") ?? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            var root = Path.Combine(programFiles, "ByteDance", "抖音聊天");
            // The official launcher prepares the renderer/resource environment
            // and is the supported entry point. Starting douyinim.exe directly
            // can make the client exit a few seconds after launch.
            var launcher = Path.Combine(root, "douyinim_launcher.exe");
            var executable = File.Exists(launcher) ? launcher : Path.Combine(root, "douyinim.exe");
            var installed = File.Exists(executable);
            if (Directory.Exists(root))
            {
                foreach (var dir in Directory.GetDirectories(root))
                {
                    var candidateLauncher = Path.Combine(dir, "douyinim_launcher.exe");
                    var candidate = Path.Combine(dir, "douyinim.exe");
                    if (File.Exists(candidateLauncher)) { executable = candidateLauncher; installed = true; break; }
                    if (File.Exists(candidate)) { executable = candidate; installed = true; break; }
                }
            }

            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "抖音聊天");
            var cookieDb = Path.Combine(profile, "Network", "Cookies");
            var processState = ReadDouyinProcessState(root, cookieDb);
            var version = "";
            if (installed)
            {
                try
                {
                    version = FileVersionInfo.GetVersionInfo(executable).ProductVersion ?? "";
                }
                catch { }
                if (String.IsNullOrWhiteSpace(version))
                {
                    var parent = Path.GetFileName(Path.GetDirectoryName(executable));
                    version = parent ?? "";
                }
            }
            processState["installed"] = installed;
            processState["version"] = version;
            processState["executable"] = executable;
            processState["profile"] = profile;
            processState["cookieDb"] = cookieDb;
            if (!installed)
            {
                processState["phase"] = "not_installed";
                processState["message"] = "未检测到抖音聊天客户端";
            }
            else if (Convert.ToBoolean(processState["running"]))
            {
                processState["message"] = Convert.ToBoolean(processState["cookieDbLocked"])
                    ? "抖音聊天正在运行，登录库暂时被占用"
                    : "抖音聊天正在运行";
            }
            else
            {
                processState["phase"] = "installed";
                processState["message"] = "已检测到抖音聊天，当前未运行";
            }
            if (douyinInstallTask != null && douyinInstallState != null && douyinInstallState.ContainsKey("phase"))
            {
                var installPhase = Convert.ToString(douyinInstallState["phase"]);
                if (installPhase != "idle" && installPhase != "installed")
                {
                    processState["phase"] = installPhase;
                    processState["message"] = douyinInstallState.ContainsKey("message") ? douyinInstallState["message"] : "正在处理抖音聊天安装…";
                }
            }
            return processState;
        }

        [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr handle);
        [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
        static extern bool QueryFullProcessImageName(IntPtr process, uint flags, System.Text.StringBuilder name, ref int size);

        // Process.MainModule throws when this 32-bit launcher inspects the
        // 64-bit Douyin client, so the image path is read through the Win32 API.
        static string ProcessImagePath(Process process)
        {
            var handle = OpenProcess(0x1000, false, process.Id);
            if (handle == IntPtr.Zero) return "";
            try
            {
                var buffer = new System.Text.StringBuilder(1024);
                var size = buffer.Capacity;
                return QueryFullProcessImageName(handle, 0, buffer, ref size) ? buffer.ToString() : "";
            }
            finally { CloseHandle(handle); }
        }

        Dictionary<string, object> ReadDouyinProcessState(string installRoot, string cookieDb)
        {
            var result = new Dictionary<string, object>
            {
                { "running", false }, { "launcherRunning", false }, { "clientRunning", false },
                { "cookieDbLocked", false }, { "pids", new object[0] }, { "startedAt", "" },
                { "phase", "not_running" }
            };
            var pids = new List<object>();
            var started = new List<DateTime>();
            var fullRoot = "";
            try { fullRoot = Path.GetFullPath(installRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar; } catch { }
            foreach (var name in new[] { "douyinim", "douyinim_launcher" })
            {
                try
                {
                    foreach (var process in Process.GetProcessesByName(name))
                    {
                        try
                        {
                            var path = ProcessImagePath(process);
                            if (String.IsNullOrWhiteSpace(path) || !path.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase)) continue;
                            pids.Add(process.Id);
                            DateTime start;
                            try { start = process.StartTime; started.Add(start); } catch { }
                            if (String.Equals(name, "douyinim", StringComparison.OrdinalIgnoreCase)) result["clientRunning"] = true;
                            if (String.Equals(name, "douyinim_launcher", StringComparison.OrdinalIgnoreCase)) result["launcherRunning"] = true;
                        }
                        catch { }
                        finally { process.Dispose(); }
                    }
                }
                catch { }
            }
            result["running"] = Convert.ToBoolean(result["clientRunning"]) || Convert.ToBoolean(result["launcherRunning"]);
            result["pids"] = pids.ToArray();
            if (started.Count > 0) result["startedAt"] = started.Min().ToUniversalTime().ToString("o");
            if (File.Exists(cookieDb))
            {
                try
                {
                    using (var stream = new FileStream(cookieDb, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) { }
                }
                catch (IOException) { result["cookieDbLocked"] = true; }
                catch (UnauthorizedAccessException) { result["cookieDbLocked"] = true; }
            }
            if (Convert.ToBoolean(result["running"])) result["phase"] = Convert.ToBoolean(result["cookieDbLocked"]) ? "running_locked" : "running";
            return result;
        }

        static DateTime LatestDouyinIdentityWriteUtc(string profile)
        {
            if (String.IsNullOrWhiteSpace(profile) || !Directory.Exists(profile)) return DateTime.MinValue;
            var latest = DateTime.MinValue;
            // log_sdk_v2.db is the only stable, non-cookie identity journal in
            // the current client. Do not use generic Chromium files here:
            // their writes happen before a user has logged in and also during
            // risk-control checks.
            foreach (var relative in new[] { "log_sdk_v2.db" })
            {
                try
                {
                    var path = Path.Combine(profile, relative);
                    if (File.Exists(path))
                    {
                        var write = File.GetLastWriteTimeUtc(path);
                        if (write > latest) latest = write;
                    }
                }
                catch { }
            }
            return latest;
        }

        static DateTime LatestDouyinUidDirectoryWriteUtc(string profile)
        {
            var root = Path.Combine(profile ?? "", "db");
            if (!Directory.Exists(root)) return DateTime.MinValue;
            var latest = DateTime.MinValue;
            try
            {
                foreach (var directory in Directory.GetDirectories(root, "*", SearchOption.AllDirectories))
                {
                    var name = Path.GetFileName(directory);
                    if (String.IsNullOrWhiteSpace(name) || name.Any(ch => ch < '0' || ch > '9')) continue;
                    var write = Directory.GetLastWriteTimeUtc(directory);
                    if (write > latest) latest = write;
                }
            }
            catch { }
            return latest;
        }

        static DateTime LatestDouyinLoginSuccessUtc(string profile)
        {
            var root = Path.Combine(profile ?? "", "parfait", "prepare");
            if (!Directory.Exists(root)) return DateTime.MinValue;
            var latest = DateTime.MinValue;
            try
            {
                foreach (var file in Directory.GetFiles(root, "*", SearchOption.AllDirectories))
                {
                    try
                    {
                        var info = new FileInfo(file);
                        if (info.Length <= 0 || info.Length > 8 * 1024 * 1024) continue;
                        var text = File.ReadAllText(file, Encoding.UTF8);
                        if (text.IndexOf("登录成功", StringComparison.OrdinalIgnoreCase) < 0 &&
                            text.IndexOf("status\\\":\\\"confirmed", StringComparison.OrdinalIgnoreCase) < 0) continue;
                        if (info.LastWriteTimeUtc > latest) latest = info.LastWriteTimeUtc;
                    }
                    catch { }
                }
            }
            catch { }
            return latest;
        }

        // The prepare ring is a fixed 1 MB file, so its write time may not track
        // individual log lines. Count the login markers by content instead, and
        // open with full sharing so a writer cannot block us.
        static int CountDouyinLoginMarkers(string profile)
        {
            var root = Path.Combine(profile ?? "", "parfait", "prepare");
            if (!Directory.Exists(root)) return 0;
            var count = 0;
            try
            {
                foreach (var file in Directory.GetFiles(root, "*", SearchOption.AllDirectories))
                {
                    try
                    {
                        string text;
                        using (var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                        {
                            if (stream.Length <= 0 || stream.Length > 8 * 1024 * 1024) continue;
                            var bytes = new byte[stream.Length];
                            var read = 0;
                            while (read < bytes.Length) { var step = stream.Read(bytes, read, bytes.Length - read); if (step <= 0) break; read += step; }
                            text = Encoding.UTF8.GetString(bytes, 0, read);
                        }
                        foreach (var marker in new[] { "登录成功", "status\\\":\\\"confirmed" })
                        {
                            var index = 0;
                            while ((index = text.IndexOf(marker, index, StringComparison.OrdinalIgnoreCase)) >= 0) { count++; index += marker.Length; }
                        }
                    }
                    catch { }
                }
            }
            catch { }
            return count;
        }

        // First moment this launcher saw more login markers than at launch.
        DateTime DouyinLoginSeenUtc(string profile)
        {
            var count = CountDouyinLoginMarkers(profile);
            if (count < douyinLoginMarkerBaseline) douyinLoginMarkerBaseline = count;
            if (count > douyinLoginMarkerBaseline && douyinLoginSeenAtUtc == DateTime.MinValue) douyinLoginSeenAtUtc = DateTime.UtcNow;
            return douyinLoginSeenAtUtc;
        }

        static DateTime LatestDouyinCookieDbWriteUtc(string profile)
        {
            try
            {
                var path = Path.Combine(profile ?? "", "Network", "Cookies");
                return File.Exists(path) ? File.GetLastWriteTimeUtc(path) : DateTime.MinValue;
            }
            catch { return DateTime.MinValue; }
        }

        // Client 1.1.34 no longer creates a numeric uid directory under db;
        // the uid only appears as "<uid>_user" keys in IndexedDB.
        static DateTime LatestDouyinIndexedDbUidWriteUtc(string profile)
        {
            var root = Path.Combine(profile ?? "", "IndexedDB");
            var latest = DateTime.MinValue;
            if (!Directory.Exists(root)) return latest;
            var pattern = new System.Text.RegularExpressions.Regex(@"\d{8,25}_(?:user|kv-store)");
            try
            {
                foreach (var file in Directory.GetFiles(root, "*", SearchOption.AllDirectories))
                {
                    var ext = Path.GetExtension(file);
                    if (ext != ".log" && ext != ".ldb") continue;
                    try
                    {
                        string text;
                        using (var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                        {
                            if (stream.Length <= 0 || stream.Length > 16 * 1024 * 1024) continue;
                            var bytes = new byte[stream.Length];
                            var read = 0;
                            while (read < bytes.Length) { var step = stream.Read(bytes, read, bytes.Length - read); if (step <= 0) break; read += step; }
                            text = Encoding.GetEncoding(28591).GetString(bytes, 0, read);
                        }
                        if (!pattern.IsMatch(text)) continue;
                        var write = File.GetLastWriteTimeUtc(file);
                        if (write > latest) latest = write;
                    }
                    catch { }
                }
            }
            catch { }
            return latest;
        }

        bool DouyinIdentityReadyForAutoRead()
        {
            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "抖音聊天");
            var uidRoot = Path.Combine(profile, "db");
            var hasNumericUid = false;
            try { hasNumericUid = Directory.Exists(uidRoot) && Directory.GetDirectories(uidRoot, "*", SearchOption.AllDirectories).Any(path => { var name = Path.GetFileName(path); return !String.IsNullOrWhiteSpace(name) && name.All(ch => ch >= '0' && ch <= '9'); }); } catch { }
            var idbWrite = LatestDouyinIndexedDbUidWriteUtc(profile);
            if (!hasNumericUid && idbWrite == DateTime.MinValue) return false;
            var signal = LatestDouyinUidDirectoryWriteUtc(profile);
            if (idbWrite > signal) signal = idbWrite;
            var loginSuccess = DouyinLoginSeenUtc(profile);
            var cookieWrite = LatestDouyinCookieDbWriteUtc(profile);
            var freshLogin = douyinFreshProfilePreparedAtUtc != DateTime.MinValue || douyinLaunchAtUtc != DateTime.MinValue;
            if (!freshLogin) return false;
            if (cookieWrite <= douyinReadinessBaselineUtc || cookieWrite == DateTime.MinValue) return false;
            // Let the official client finish risk-control writes before the
            // controlled close. This is the same ten-second settle window
            // used by the original launcher flow.
            if (loginSuccess != DateTime.MinValue)
                return DateTime.UtcNow - loginSuccess >= TimeSpan.FromSeconds(10) && DateTime.UtcNow - douyinLaunchAtUtc >= TimeSpan.FromSeconds(10);
            var stableSince = signal == DateTime.MinValue ? douyinLaunchAtUtc : signal;
            return DateTime.UtcNow - stableSince >= TimeSpan.FromSeconds(10) && DateTime.UtcNow - douyinLaunchAtUtc >= TimeSpan.FromSeconds(10);
        }

        void LogDouyinDiagnostic(string eventName, Dictionary<string, object> state, string code = "", string detail = "")
        {
            try
            {
                var directory = Path.Combine(launcherDataPath, "logs");
                Directory.CreateDirectory(directory);
                var path = Path.Combine(directory, "douyin-diagnostic.log");
                var line = new Dictionary<string, object>
                {
                    { "at", DateTimeOffset.UtcNow.ToString("o") }, { "event", eventName },
                    { "phase", state.ContainsKey("phase") ? state["phase"] : "" },
                    { "running", state.ContainsKey("running") && Convert.ToBoolean(state["running"]) },
                    { "clientRunning", state.ContainsKey("clientRunning") && Convert.ToBoolean(state["clientRunning"]) },
                    { "launcherRunning", state.ContainsKey("launcherRunning") && Convert.ToBoolean(state["launcherRunning"]) },
                    { "cookieDbLocked", state.ContainsKey("cookieDbLocked") && Convert.ToBoolean(state["cookieDbLocked"]) },
                    { "pids", state.ContainsKey("pids") ? state["pids"] : new object[0] },
                    { "code", code ?? "" }, { "detail", detail ?? "" }
                };
                File.AppendAllText(path, json.Serialize(line) + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
        }

        async Task<Dictionary<string, object>> InstallDouyinChatAsync()
        {
            if (douyinInstallTask != null) return await douyinInstallTask;
            var existing = DouyinChatState();
            if (Convert.ToBoolean(existing["installed"]))
            {
                douyinInstallState = new Dictionary<string, object>(existing) { { "phase", "installed" }, { "message", "已检测到抖音聊天，未重复安装。" } };
                return douyinInstallState;
            }
            douyinInstallTask = InstallDouyinChatCoreAsync(existing);
            try { return await douyinInstallTask; }
            finally { douyinInstallTask = null; }
        }

        async Task<Dictionary<string, object>> InstallDouyinChatCoreAsync(Dictionary<string, object> existing)
        {
            var root = Convert.ToString(existing["executable"]);
            var programFiles = Environment.GetEnvironmentVariable("ProgramW6432") ?? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            var installRoot = Path.Combine(programFiles, "ByteDance", "抖音聊天");
            var tempDir = Path.Combine(Path.GetTempPath(), "douyinjuhe-douyin-chat-" + Guid.NewGuid().ToString("N"));
            var partial = Path.Combine(tempDir, "DouyinChat-x64-default.exe.part");
            var installer = Path.Combine(tempDir, "DouyinChat-x64-default.exe");
            Directory.CreateDirectory(tempDir);
            try
            {
                SetDouyinInstallState("downloading", "正在下载抖音聊天官方安装包…");
                using (var response = await http.GetAsync(DouyinChatInstallerUrl, HttpCompletionOption.ResponseHeadersRead))
                {
                    if (!response.IsSuccessStatusCode) throw new InvalidOperationException("抖音聊天安装包下载失败（HTTP " + (int)response.StatusCode + "）。");
                    if (response.RequestMessage != null && response.RequestMessage.RequestUri.Host != DouyinChatInstallerUrl.Host) throw new InvalidOperationException("安装包下载地址发生了不受信任的跳转。");
                    if (response.Content.Headers.ContentLength.HasValue && response.Content.Headers.ContentLength.Value != DouyinChatInstallerBytes) throw new InvalidOperationException("远端安装包大小与清单不一致。");
                    using (var input = await response.Content.ReadAsStreamAsync()) using (var output = new FileStream(partial, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    {
                        await input.CopyToAsync(output);
                    }
                }
                File.Move(partial, installer);
                SetDouyinInstallState("verifying", "正在校验安装包…");
                var info = new FileInfo(installer);
                if (info.Length != DouyinChatInstallerBytes) throw new InvalidOperationException("安装包大小校验失败，已拒绝执行。");
                string digest;
                using (var sha = SHA256.Create()) using (var input = File.OpenRead(installer)) digest = BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
                if (!String.Equals(digest, DouyinChatInstallerSha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("安装包完整性校验失败，已拒绝执行。");
                try
                {
                    var certificate = X509Certificate.CreateFromSignedFile(installer);
                    var subject = certificate.Subject ?? "";
                    if (subject.IndexOf(DouyinChatInstallerSigner, StringComparison.OrdinalIgnoreCase) < 0) throw new InvalidOperationException("安装包签名主体不匹配，已拒绝执行。");
                }
                catch (InvalidOperationException) { throw; }
                catch { /* Windows certificate provider may be unavailable; pinned URL/size/hash remain mandatory. */ }
                SetDouyinInstallState("installing", "等待系统确认并安装抖音聊天…");
                using (var process = Process.Start(new ProcessStartInfo { FileName = installer, Arguments = "/S", UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden }))
                {
                    if (process == null) throw new InvalidOperationException("无法启动抖音聊天安装程序。");
                }
                var deadline = DateTime.UtcNow.AddSeconds(30);
                Dictionary<string, object> installed = null;
                while (DateTime.UtcNow < deadline)
                {
                    await Task.Delay(500);
                    installed = DouyinChatState();
                    if (Convert.ToBoolean(installed["installed"])) break;
                }
                if (installed == null || !Convert.ToBoolean(installed["installed"])) throw new InvalidOperationException("安装程序已结束，但未检测到抖音聊天客户端。");
                installed["phase"] = "installed";
                installed["message"] = "抖音聊天 " + Convert.ToString(installed["version"]) + " 已安装。";
                douyinInstallState = installed;
                LogDouyinDiagnostic("install_completed", installed, "", "官方安装包校验并安装完成");
                return installed;
            }
            catch (Exception error)
            {
                SetDouyinInstallState("error", error.Message);
                LogDouyinDiagnostic("install_failed", existing, "INSTALL_FAILED", error.Message);
                throw;
            }
            finally
            {
                try { if (Directory.Exists(tempDir)) Directory.Delete(tempDir, true); } catch { }
            }
        }

        void SetDouyinInstallState(string phase, string message)
        {
            douyinInstallState = new Dictionary<string, object> { { "phase", phase }, { "installed", false }, { "version", "" }, { "message", message } };
        }

        void RebuildDouyinLoginProxy()
        {
            if (douyinLoginProxy != null) douyinLoginProxy.Dispose();
            douyinLoginProxy = douyinNetworkMode == "local_node" ? null
                : new NodeLoginProxy(api, nodeToken, douyinNetworkMode, douyinProxyId);
        }

        object LaunchDouyinChat()
        {
            if (String.IsNullOrWhiteSpace(token) || String.IsNullOrWhiteSpace(nodeToken) || String.IsNullOrWhiteSpace(userId)) throw new InvalidOperationException("请先登录抖音聚合租户账号，再添加抖音聊天账号。");
            var activeProfile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "抖音聊天");
            var activeBinding = ReadActiveDouyinProfileBinding();
            var activeOwner = activeBinding == null || !activeBinding.ContainsKey("tenantId") ? "" : Convert.ToString(activeBinding["tenantId"]);
            if (Directory.Exists(activeProfile) && (String.IsNullOrWhiteSpace(activeOwner) || !String.Equals(activeOwner, userId, StringComparison.Ordinal)))
                throw new InvalidOperationException("当前抖音聊天 Profile 不属于当前租户，请先点击“添加新账号”准备独立登录状态。");
            var state = DouyinChatState();
            if (!(state["installed"] is bool) || !(bool)state["installed"]) throw new InvalidOperationException("未检测到抖音聊天客户端，请先安装。");
            if (Convert.ToBoolean(state["running"]))
            {
                // A relogin may reuse an already-open client. Start a fresh
                // readiness window so old profile writes cannot trigger a
                // premature shutdown.
                douyinLaunchAtUtc = DateTime.UtcNow;
                var profile = Convert.ToString(state["profile"]);
                var uidWrite = LatestDouyinUidDirectoryWriteUtc(profile);
                var identityWrite = LatestDouyinIdentityWriteUtc(profile);
                var cookieWrite = LatestDouyinCookieDbWriteUtc(profile);
                douyinReadinessBaselineUtc = uidWrite > identityWrite ? uidWrite : identityWrite;
                if (cookieWrite > douyinReadinessBaselineUtc) douyinReadinessBaselineUtc = cookieWrite;
                douyinLoginSuccessBaselineUtc = LatestDouyinLoginSuccessUtc(profile);
                douyinLoginMarkerBaseline = CountDouyinLoginMarkers(profile); douyinLoginSeenAtUtc = DateTime.MinValue; douyinTrialReadMarkUtc = DateTime.MinValue;
                douyinAutomaticCloseAtUtc = DateTime.MinValue;
                state["phase"] = Convert.ToBoolean(state["cookieDbLocked"]) ? "running_locked" : "running";
                state["message"] = Convert.ToBoolean(state["cookieDbLocked"]) ? "抖音聊天已在运行，登录库暂时被占用。" : "抖音聊天已在运行。";
                LogDouyinDiagnostic("launch_skipped_already_running", state);
                return state;
            }
            var executable = Convert.ToString(state["executable"]);
            if (douyinLoginProxy != null && !douyinLoginProxy.Listening) RebuildDouyinLoginProxy();
            var networkArguments = douyinLoginProxy == null ? "--no-proxy-server" : "--proxy-server=http://127.0.0.1:" + douyinLoginProxy.Port + " --proxy-bypass-list=<-loopback>";
            LogDouyinDiagnostic("launch_proxy", state, "", douyinLoginProxy == null ? "no-proxy-server" : "127.0.0.1:" + douyinLoginProxy.Port);
            var psi = new ProcessStartInfo { FileName = executable, Arguments = networkArguments, WorkingDirectory = Path.GetDirectoryName(executable), UseShellExecute = false, WindowStyle = ProcessWindowStyle.Normal };
            // This launcher is 32-bit, so its environment says x86 and points
            // ProgramFiles at "Program Files (x86)". The 64-bit client inherits
            // that and never shows its window; give it the native values.
            var native = Environment.GetEnvironmentVariable("ProgramW6432");
            if (!String.IsNullOrEmpty(native))
            {
                psi.EnvironmentVariables["PROCESSOR_ARCHITECTURE"] = "AMD64";
                psi.EnvironmentVariables.Remove("PROCESSOR_ARCHITEW6432");
                psi.EnvironmentVariables["ProgramFiles"] = native;
                var nativeCommon = Environment.GetEnvironmentVariable("CommonProgramW6432");
                if (!String.IsNullOrEmpty(nativeCommon)) psi.EnvironmentVariables["CommonProgramFiles"] = nativeCommon;
            }
            try { Process.Start(psi); } catch (Exception ex) { throw new InvalidOperationException("启动抖音聊天失败: " + ex.Message, ex); }
            douyinLaunchAtUtc = DateTime.UtcNow;
            var profilePath = Convert.ToString(state["profile"]);
            var uidWriteAtLaunch = LatestDouyinUidDirectoryWriteUtc(profilePath);
            var identityWriteAtLaunch = LatestDouyinIdentityWriteUtc(profilePath);
            var cookieWriteAtLaunch = LatestDouyinCookieDbWriteUtc(profilePath);
            douyinReadinessBaselineUtc = uidWriteAtLaunch > identityWriteAtLaunch ? uidWriteAtLaunch : identityWriteAtLaunch;
            if (cookieWriteAtLaunch > douyinReadinessBaselineUtc) douyinReadinessBaselineUtc = cookieWriteAtLaunch;
            douyinLoginSuccessBaselineUtc = LatestDouyinLoginSuccessUtc(profilePath);
            douyinLoginMarkerBaseline = CountDouyinLoginMarkers(profilePath); douyinLoginSeenAtUtc = DateTime.MinValue; douyinTrialReadMarkUtc = DateTime.MinValue;
            douyinAutomaticCloseAtUtc = DateTime.MinValue;
            state["phase"] = "launched";
            state["message"] = "抖音聊天已启动，请完成登录。";
            LogDouyinDiagnostic("launch_started", state);
            return state;
        }

        async Task<object> PrepareDouyinChatLoginAsync()
        {
            if (String.IsNullOrWhiteSpace(token) || String.IsNullOrWhiteSpace(nodeToken) || String.IsNullOrWhiteSpace(userId)) throw new InvalidOperationException("请先登录抖音聚合租户账号，再添加抖音聊天账号。");
            var state = DouyinChatState();
            if (!(state.ContainsKey("installed") && Convert.ToBoolean(state["installed"])))
                throw new InvalidOperationException("未检测到抖音聊天客户端，请先安装。");

            // The official client exposes one fixed user-data directory, so
            // the historical flow switches accounts by rotating that active
            // directory. Keep every previous profile in a tenant-scoped,
            // unique backup; never delete credentials or prior backups.
            await CloseDouyinChatWithTimeoutAsync(8000);
            // Only now is the old client really gone, so its proxy port can be
            // replaced. Rebuilding earlier left the new client pointed at a
            // closed port and it rendered a blank window.
            RebuildDouyinLoginProxy();
            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "抖音聊天");
            var previousBinding = ReadActiveDouyinProfileBinding();
            var previousOwner = previousBinding == null || !previousBinding.ContainsKey("tenantId") ? "" : Convert.ToString(previousBinding["tenantId"]);
            var backupRoot = String.IsNullOrWhiteSpace(previousOwner)
                ? Path.Combine(launcherDataPath, "quarantine", "douyin-profiles")
                : Path.Combine(launcherDataPath, "tenants", SafeTenantPathPart(previousOwner), "douyin-profiles");
            var backup = Path.Combine(backupRoot, "profile-" + DateTime.UtcNow.ToString("yyyyMMddHHmmssfff") + "-" + Guid.NewGuid().ToString("N"));
            var hadProfile = Directory.Exists(profile);
            try
            {
                if (hadProfile)
                {
                    Directory.CreateDirectory(backupRoot);
                    Exception moveError = null;
                    for (var attempt = 0; attempt < 24; attempt++)
                    {
                        try
                        {
                            Directory.Move(profile, backup);
                            moveError = null;
                            break;
                        }
                        catch (Exception error)
                        {
                            moveError = error;
                        }
                        await Task.Delay(250);
                    }
                    if (moveError != null)
                    {
                        var stateAfterClose = DouyinChatState();
                        LogDouyinDiagnostic("profile_rotate_failed", stateAfterClose, "PROFILE_ROTATE_FAILED", moveError.Message);
                        throw new InvalidOperationException("抖音聊天登录状态仍被客户端占用，暂时无法准备新账号；请等待客户端完全退出后重试。", moveError);
                    }
                }
                DeleteActiveDouyinProfileBinding();
                Directory.CreateDirectory(profile);
                WriteActiveDouyinProfileBinding(userId);
                var launched = LaunchDouyinChat() as Dictionary<string, object> ?? new Dictionary<string, object>();
                douyinFreshProfilePreparedAtUtc = DateTime.UtcNow;
                launched["ok"] = true;
                launched["message"] = "已为新账号准备独立登录状态；旧账号 Profile 已按原租户隔离保存。请在抖音聊天登录新账号。";
                launched["profileReset"] = true;
                launched["profilePreserved"] = hadProfile;
                launched["profileBackupCreated"] = hadProfile;
                return launched;
            }
            catch
            {
                try
                {
                    if (Directory.Exists(profile)) Directory.Delete(profile, true);
                    if (hadProfile && Directory.Exists(backup)) Directory.Move(backup, profile);
                    if (!String.IsNullOrWhiteSpace(previousOwner)) WriteActiveDouyinProfileBinding(previousOwner);
                    else DeleteActiveDouyinProfileBinding();
                }
                catch { }
                throw;
            }
        }

        async Task CloseDouyinChatWithTimeoutAsync(int timeoutMs)
        {
            var processes = new List<Process>();
            var programFiles = Environment.GetEnvironmentVariable("ProgramW6432") ?? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            var installRoot = Path.Combine(programFiles, "ByteDance", "抖音聊天");
            foreach (var name in new[] { "douyinim", "douyinim_launcher" })
            {
                try
                {
                    foreach (var process in Process.GetProcessesByName(name))
                    {
                        try
                        {
                            var executable = ProcessImagePath(process);
                            var fullRoot = Path.GetFullPath(installRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                            if (!String.IsNullOrWhiteSpace(executable) && Path.GetFullPath(executable).StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase)) processes.Add(process);
                            else process.Dispose();
                        }
                        catch { process.Dispose(); }
                    }
                }
                catch { }
            }
            foreach (var process in processes)
            {
                try { if (!process.HasExited && process.MainWindowHandle != IntPtr.Zero) process.CloseMainWindow(); } catch { }
            }
            var deadline = DateTime.UtcNow.AddMilliseconds(Math.Max(1000, timeoutMs));
            while (DateTime.UtcNow < deadline)
            {
                var alive = false;
                foreach (var process in processes) { try { if (!process.HasExited) { alive = true; break; } } catch { } }
                if (!alive) return;
                await Task.Delay(150);
            }
            foreach (var process in processes)
            {
                try { if (!process.HasExited) process.Kill(); } catch { }
            }
            var killDeadline = DateTime.UtcNow.AddMilliseconds(2000);
            while (DateTime.UtcNow < killDeadline)
            {
                var alive = false;
                foreach (var process in processes) { try { if (!process.HasExited) { alive = true; break; } } catch { } }
                if (!alive) return;
                await Task.Delay(100);
            }
            throw new InvalidOperationException("关闭抖音聊天超时，请手动退出后重试。");
        }

        async Task<object> CaptureDouyinChatAsync(Dictionary<string, object> payload)
        {
            if (String.IsNullOrWhiteSpace(token) || String.IsNullOrWhiteSpace(nodeToken) || String.IsNullOrWhiteSpace(userId)) throw new InvalidOperationException("请先登录抖音聚合租户账号，再添加抖音聊天账号。");
            var script = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "native", "capture_duoshan.py");
            if (!File.Exists(script)) throw new InvalidOperationException("预览包缺少身份读取组件。");
            var allowClientRestart = payload != null && payload.ContainsKey("allowClientRestart") && Convert.ToBoolean(payload["allowClientRestart"]);
            var automatic = payload != null && payload.ContainsKey("automatic") && Convert.ToBoolean(payload["automatic"]);
            var processState = DouyinChatState();
            var clientRunning = Convert.ToBoolean(processState["running"]);
            var closeClient = false;
            if (clientRunning)
            {
                if (!automatic) closeClient = allowClientRestart;
                else if (allowClientRestart && DouyinIdentityReadyForAutoRead()) closeClient = true;
                else
                {
                    // Not yet safe to close (the ten-second settle window is kept
                    // as is). Once the login marker is one second old, try one
                    // read without closing the client; it works whenever
                    // Chromium has already released the Cookies DB.
                    var loginSuccess = DouyinLoginSeenUtc(Convert.ToString(processState["profile"]));
                    var loginSeen = loginSuccess != DateTime.MinValue;
                    var trial = loginSeen && DateTime.UtcNow - loginSuccess >= TimeSpan.FromSeconds(1) && loginSuccess != douyinTrialReadMarkUtc;
                    if (trial)
                    {
                        douyinTrialReadMarkUtc = loginSuccess;
                        LogDouyinDiagnostic("capture_trial_read", processState, "TRIAL_READ", "检测到登录一秒后尝试不关闭客户端读取身份");
                    }
                    else if (DateTime.UtcNow - douyinLastProbeUtc < TimeSpan.FromSeconds(3))
                        throw new InvalidOperationException("等待抖音聊天登录完成。");
                    douyinLastProbeUtc = DateTime.UtcNow;
                }
            }
            // The risk dialog appeared when a fresh QR login was closed during
            // its session establishment, so automatic closing only happens after
            // DouyinIdentityReadyForAutoRead(); manual reads may always close.
            if (closeClient)
            {
                var closeCode = automatic ? "AUTO_CLOSE" : "MANUAL_CLOSE";
                var closeEvent = automatic ? "capture_auto_close_requested" : "capture_manual_close_requested";
                var closeDetail = automatic ? "登录身份稳定十秒，自动退出抖音聊天并读取身份" : "用户点击重新读取，受控退出抖音聊天并读取身份";
                LogDouyinDiagnostic(closeEvent, processState, closeCode, closeDetail);
                try
                {
                    // The native helper can only stop the visible client. The
                    // official guard and Chromium children must be closed as
                    // one transaction or the Cookies DB remains locked.
                    await CloseDouyinChatWithTimeoutAsync(8000);
                    LogDouyinDiagnostic(automatic ? "capture_auto_close_completed" : "capture_manual_close_completed", DouyinChatState(), closeCode, "抖音聊天已退出");
                }
                catch (Exception closeError)
                {
                    LogDouyinDiagnostic("capture_manual_close_failed", DouyinChatState(), "MANUAL_CLOSE_FAILED", closeError.Message);
                    throw new InvalidOperationException("抖音聊天退出失败，登录身份尚未读取：" + closeError.Message, closeError);
                }
            }
            var bundledHelper = BundledNativeHelper("capture_duoshan");
            var arguments = bundledHelper == null ? "-B \"" + script + "\" --ipc" : "--ipc";
            var psi = new ProcessStartInfo { FileName = bundledHelper ?? "python.exe", Arguments = arguments, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
            // Keep both streams UTF-8 even on hosts whose active code page is
            // GBK.  The script also writes stdout as explicit UTF-8 bytes.
            psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
            psi.EnvironmentVariables["PYTHONUTF8"] = "1";
            using (var process = Process.Start(psi))
            {
                var output = await process.StandardOutput.ReadToEndAsync();
                var errorOutput = await process.StandardError.ReadToEndAsync();
                process.WaitForExit();
                Dictionary<string, object> captured = null;
                var normalizedOutput = (output ?? string.Empty).Trim().TrimStart('\uFEFF');
                if (!String.IsNullOrWhiteSpace(normalizedOutput))
                {
                    try { captured = json.DeserializeObject(normalizedOutput) as Dictionary<string, object>; }
                    catch
                    {
                        throw new InvalidOperationException("抖音聊天身份读取返回了无效结果，请关闭抖音聊天后点击“重新读取”。");
                    }
                }
                if (process.ExitCode != 0 || captured == null || !captured.ContainsKey("ok") || !(bool)captured["ok"])
                {
                    var captureMessage = "抖音聊天身份读取失败：没有收到有效采集结果。";
                    if (captured != null && captured.ContainsKey("message"))
                    {
                        var reported = Convert.ToString(captured["message"]);
                        if (!String.IsNullOrWhiteSpace(reported) && reported.IndexOf('\uFFFD') < 0) captureMessage = reported;
                    }
                    if (captureMessage.IndexOf('\uFFFD') >= 0) captureMessage = "抖音聊天身份读取失败：返回文本编码异常，请关闭抖音聊天后重试。";
                    var code = captured != null && captured.ContainsKey("code") ? Convert.ToString(captured["code"]) : "CAPTURE_PROCESS_FAILED";
                    LogDouyinDiagnostic("capture_failed", processState, code, captureMessage);
                    // A locked Cookies DB is normal while the client is open.
                    // Preserve only the non-sensitive readiness marker so the
                    // UI can restart once without exposing cookie material.
                    throw new InvalidOperationException(captureMessage);
                }
                var uid = Convert.ToString(captured["uid"]);
                LogDouyinDiagnostic("capture_succeeded", processState, "", "身份材料已读取");
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var row = new Dictionary<string, object> { { "id", "duoshan:" + uid }, { "uid", uid }, { "loginMode", "douyin_chat" }, { "nickname", captured.ContainsKey("nickname") ? Convert.ToString(captured["nickname"]) : "" }, { "note", "" }, { "douyinId", captured.ContainsKey("douyinId") ? Convert.ToString(captured["douyinId"]) : "" }, { "avatar", captured.ContainsKey("avatar") ? Convert.ToString(captured["avatar"]) : "" }, { "source", "launcher" }, { "slot", null }, { "status", "inactive" }, { "identityStatus", "captured_unverified" }, { "createdAt", now }, { "updatedAt", now }, { "material", captured } };
                var remote = await UploadCapturedAsync(captured, row);
                var webAccountId = Convert.ToString(remote["id"]);
                if (String.IsNullOrWhiteSpace(webAccountId)) throw new InvalidOperationException("服务器未确认抖音聊天账号写入。");
                row["remoteId"] = webAccountId;
                row["remoteOnly"] = false;
                var rows = new List<Dictionary<string, object>>(ReadLocalAccounts());
                rows.RemoveAll(item => String.Equals(Convert.ToString(item.ContainsKey("uid") ? item["uid"] : ""), uid, StringComparison.Ordinal)
                    && String.Equals(Convert.ToString(item.ContainsKey("loginMode") ? item["loginMode"] : ""), "douyin_chat", StringComparison.Ordinal));
                rows.Insert(0, row);
                WriteLocalAccounts(rows);
                return new Dictionary<string, object> { { "ok", true }, { "localAccount", SafeAccount(row) }, { "uploaded", true }, { "uploadError", "" }, { "webAccountId", webAccountId } };
            }
        }

        async Task<Dictionary<string, object>> UploadCapturedAsync(Dictionary<string, object> captured, Dictionary<string, object> localRow)
        {
            var uid = Convert.ToString(captured["uid"]);
            var nickname = localRow.ContainsKey("nickname") ? Convert.ToString(localRow["nickname"]) : "";
            var douyinId = localRow.ContainsKey("douyinId") ? Convert.ToString(localRow["douyinId"]) : "";
            var avatar = localRow.ContainsKey("avatar") ? Convert.ToString(localRow["avatar"]) : "";
            localRow["networkMode"] = douyinNetworkMode; localRow["proxyId"] = douyinProxyId;
            var remote = await RequestAsync("POST", "/api/v1/node/account", new Dictionary<string, object>
            {
                { "uid", uid }, { "nickname", nickname }, { "douyinId", douyinId }, { "avatar", avatar },
                { "name", String.IsNullOrWhiteSpace(nickname) ? uid : nickname }, { "loginMode", "douyin_chat" },
                { "networkMode", douyinNetworkMode }, { "proxyId", douyinProxyId }
            }, true, true) as Dictionary<string, object>;
            var accountId = Convert.ToString(remote["id"]);
            if (String.IsNullOrWhiteSpace(accountId)) throw new InvalidOperationException("网页账号创建响应无效。");
            var keyResponse = await RequestAsync("POST", "/api/v1/node/material-key", new Dictionary<string, object>(), true, true) as Dictionary<string, object>;
            var publicKey = Convert.ToString(keyResponse["publicKey"]);
            if (String.IsNullOrWhiteSpace(publicKey) || !publicKey.Contains("BEGIN PUBLIC KEY")) throw new InvalidOperationException("服务器身份公钥无效。");
            var serverMaterial = new Dictionary<string, object>
            {
                { "uid", uid }, { "cookie", Convert.ToString(captured["cookie"]) },
                { "cookieNames", captured.ContainsKey("cookieNames") ? captured["cookieNames"] : new object[0] },
                { "version", captured.ContainsKey("version") ? captured["version"] : "1.1.33" }
            };
            var cardIdentity = captured.ContainsKey("cardIdentity") ? captured["cardIdentity"] as Dictionary<string, object> : null;
            if (cardIdentity != null) serverMaterial["cardIdentity"] = cardIdentity;
            var serverBlob = await SealMaterialAsync(publicKey, serverMaterial);
            var localMaterial = new Dictionary<string, object> { { "uid", uid }, { "cookie", Convert.ToString(captured["cookie"]) }, { "cookieNames", serverMaterial["cookieNames"] }, { "version", serverMaterial["version"] } };
            if (serverMaterial.ContainsKey("cardIdentity")) localMaterial["cardIdentity"] = serverMaterial["cardIdentity"];
            var localBlob = Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(json.Serialize(localMaterial)), null, DataProtectionScope.CurrentUser));
            var fingerprint = BitConverter.ToString(SHA256.Create().ComputeHash(Encoding.UTF8.GetBytes(Convert.ToString(captured["cookie"])))).Replace("-", "").ToLowerInvariant();
            await RequestAsync("POST", "/api/v1/node/account-material", new Dictionary<string, object>
            {
                { "accountId", accountId }, { "kind", "duoshan_pc_im" }, { "fingerprint", fingerprint }, { "blob", localBlob },
                { "serverBlob", serverBlob }, { "uid", uid }, { "nickname", nickname }, { "douyinId", douyinId }, { "avatar", avatar }
            }, true, true);
            // Ask the server to run the authoritative Duoshan sync immediately.
            // The PC material contains the account sec_uid in the init payload;
            // the server resolves nickname/avatar with that identity and stores
            // the result. Poll briefly so a manual “重新读取” reflects the
            // enriched account instead of returning the initial blank fields.
            try
            {
                await RequestAsync("POST", "/api/v1/conversations/sync", new Dictionary<string, object> { { "account", accountId } }, true, true);
                for (var attempt = 0; attempt < 10; attempt++)
                {
                    await Task.Delay(350);
                    var listed = await RequestAsync("GET", "/api/v1/accounts", null, true) as object[];
                    if (listed == null) continue;
                    var serverRow = listed.OfType<Dictionary<string, object>>().FirstOrDefault(item => String.Equals(Convert.ToString(item.ContainsKey("id") ? item["id"] : ""), accountId, StringComparison.Ordinal));
                    if (serverRow == null) continue;
                    foreach (var key in new[] { "nickname", "douyinId", "avatar", "status", "statusReason", "checkedAt", "currentIp" })
                        if (serverRow.ContainsKey(key) && serverRow[key] != null && !String.IsNullOrWhiteSpace(Convert.ToString(serverRow[key]))) localRow[key] = serverRow[key];
                    if (!String.IsNullOrWhiteSpace(Convert.ToString(localRow["nickname"])) || !String.IsNullOrWhiteSpace(Convert.ToString(localRow["avatar"]))) break;
                }
            }
            catch { /* account upload succeeded; enrichment can complete on the next refresh */ }
            localRow["remoteId"] = accountId;
            localRow["remoteOnly"] = false;
            localRow["remoteId"] = accountId;
            localRow["remoteOnly"] = false;
            var savedRows = new List<Dictionary<string, object>>(ReadLocalAccounts());
            savedRows.RemoveAll(item => String.Equals(Convert.ToString(item.ContainsKey("uid") ? item["uid"] : ""), uid, StringComparison.Ordinal)
                && String.Equals(Convert.ToString(item.ContainsKey("loginMode") ? item["loginMode"] : ""), "douyin_chat", StringComparison.Ordinal));
            savedRows.Insert(0, localRow);
            WriteLocalAccounts(savedRows);
            return remote;
        }

        async Task<string> SealMaterialAsync(string publicKey, Dictionary<string, object> material)
        {
            var script = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "native", "seal_material.py");
            if (!File.Exists(script)) throw new InvalidOperationException("预览包缺少身份封装组件。");
            var bundledHelper = BundledNativeHelper("seal_material");
            var psi = new ProcessStartInfo { FileName = bundledHelper ?? "python.exe", Arguments = bundledHelper == null ? "-B \"" + script + "\"" : "", UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
            using (var process = Process.Start(psi))
            {
                process.StandardInput.Write(json.Serialize(new Dictionary<string, object> { { "publicKey", publicKey }, { "material", material } }));
                process.StandardInput.Close();
                var output = await process.StandardOutput.ReadToEndAsync();
                await process.StandardError.ReadToEndAsync();
                process.WaitForExit();
                if (process.ExitCode != 0 || String.IsNullOrWhiteSpace(output)) throw new InvalidOperationException("服务器身份材料封装失败。");
                return output.Trim();
            }
        }

        async Task<object> LoginAsync(Dictionary<string, object> payload)
        {
            var name = payload == null ? "" : Convert.ToString(payload.ContainsKey("name") ? payload["name"] : "");
            var password = payload == null ? "" : Convert.ToString(payload.ContainsKey("password") ? payload["password"] : "");
            if (String.IsNullOrWhiteSpace(name) || String.IsNullOrEmpty(password)) throw new InvalidOperationException("请输入租户用户名和密码。");
            var session = await RequestAsync("POST", "/api/v1/auth/login", new Dictionary<string, object> { { "name", name }, { "password", password } }, false) as Dictionary<string, object>;
            token = Convert.ToString(session["token"]);
            var user = session["user"] as Dictionary<string, object>;
            userName = Convert.ToString(user["name"]);
            userId = Convert.ToString(user["id"]);
            var local = LocalNodeState() as Dictionary<string, object>;
            var attached = await RequestAsync("POST", "/api/v1/nodes/attach", new Dictionary<string, object> { { "name", Environment.MachineName }, { "ip", local != null && local.ContainsKey("ip") ? local["ip"] : "" } }, true) as Dictionary<string, object>;
            nodeId = Convert.ToString(attached["id"]);
            nodeToken = Convert.ToString(attached["token"]);
            if (String.IsNullOrWhiteSpace(nodeToken)) throw new InvalidOperationException("服务器未返回登录器节点令牌。");
            EnsureNetworkAgent();
            SaveSession();
            // A previous capture may have been saved locally while the node was
            // offline or before the tenant login completed.  Once the node is
            // authenticated, retry the complete Creator material upload so the
            // server never has to send with a missing/stale browser state.
            await SyncPendingCreatorAccountsAsync();
            return new Dictionary<string, object> { { "bound", true }, { "loggedIn", true }, { "user", new Dictionary<string, object> { { "id", userId }, { "name", userName } } }, { "id", nodeId }, { "message", "登录成功，正在连接网页。" } };
        }

        void LoadSession()
        {
            try
            {
                if (!File.Exists(sessionPath)) return;
                var encrypted = Convert.FromBase64String(File.ReadAllText(sessionPath));
                var plain = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
                var saved = json.DeserializeObject(Encoding.UTF8.GetString(plain)) as Dictionary<string, object>;
                token = saved == null ? null : Convert.ToString(saved.ContainsKey("token") ? saved["token"] : "");
                nodeToken = saved == null ? null : Convert.ToString(saved.ContainsKey("nodeToken") ? saved["nodeToken"] : "");
                // Older previews persisted the tenant token in place of the node
                // token. Force a clean login instead of repeatedly polling 401.
                if (String.IsNullOrWhiteSpace(nodeToken)) { token = null; nodeToken = null; nodeId = null; userName = null; userId = null; }
                nodeId = saved == null ? null : Convert.ToString(saved.ContainsKey("nodeId") ? saved["nodeId"] : "");
                userName = saved == null ? null : Convert.ToString(saved.ContainsKey("userName") ? saved["userName"] : "");
                userId = saved == null ? null : Convert.ToString(saved.ContainsKey("userId") ? saved["userId"] : "");
            }
            catch { token = null; nodeToken = null; nodeId = null; userName = null; userId = null; }
        }

        void SaveSession()
        {
            if (String.IsNullOrWhiteSpace(token)) return;
            Directory.CreateDirectory(Path.GetDirectoryName(sessionPath));
            var payload = new Dictionary<string, object> { { "token", token }, { "nodeToken", nodeToken ?? "" }, { "nodeId", nodeId ?? "" }, { "userName", userName ?? "" }, { "userId", userId ?? "" } };
            var encrypted = ProtectedData.Protect(Encoding.UTF8.GetBytes(json.Serialize(payload)), null, DataProtectionScope.CurrentUser);
            File.WriteAllText(sessionPath, Convert.ToBase64String(encrypted), Encoding.UTF8);
        }

        void DeleteSession()
        {
            try { if (File.Exists(sessionPath)) File.Delete(sessionPath); } catch { }
        }

        async Task<object> NodeStateAsync()
        {
            if (String.IsNullOrEmpty(token)) return new Dictionary<string, object> { { "bound", false }, { "loggedIn", false }, { "message", "尚未登录，请输入抖音聚合租户账号密码。" } };
            Dictionary<string, object> tenant = null;
            try { tenant = await RequestAsync("GET", "/api/v1/auth/me", null, true) as Dictionary<string, object>; }
            catch { return new Dictionary<string, object> { { "bound", false }, { "loggedIn", false }, { "message", "租户登录已失效，请重新登录后读取账号。" } }; }
            if (tenant == null || String.IsNullOrWhiteSpace(Convert.ToString(tenant.ContainsKey("id") ? tenant["id"] : "")))
                return new Dictionary<string, object> { { "bound", false }, { "loggedIn", false }, { "message", "租户登录状态无效，请重新登录。" } };
            userId = Convert.ToString(tenant["id"]);
            userName = Convert.ToString(tenant.ContainsKey("name") ? tenant["name"] : userName);
            try
            {
                var local = LocalNodeState() as Dictionary<string, object>;
                var polled = await RequestAsync("POST", "/api/v1/node/poll", new Dictionary<string, object> { { "ip", local != null && local.ContainsKey("ip") ? local["ip"] : "" } }, true, true) as Dictionary<string, object>;
                CheckAgentConnection(polled);
            }
            catch { return new Dictionary<string, object> { { "bound", true }, { "loggedIn", true }, { "user", new Dictionary<string, object> { { "id", userId }, { "name", userName } } }, { "id", nodeId }, { "message", "租户已登录，设备连接暂时中断。" } }; }
            return new Dictionary<string, object> { { "bound", true }, { "loggedIn", true }, { "user", new Dictionary<string, object> { { "id", userId }, { "name", userName } } }, { "id", nodeId }, { "message", "设备已连接，等待网页任务。" } };
        }

        int agentMismatchCount;
        // 服务器在 poll 响应里报告是否持有本节点的网络长连接。本端以为连着而服务器说没连，
        // 连续两次（约 30 秒）后强制重连，避免界面显示“已连接”但账号被标为登录器离线。
        void CheckAgentConnection(Dictionary<string, object> polled)
        {
            if (polled == null || !polled.ContainsKey("agentConnected") || !(polled["agentConnected"] is bool)) { agentMismatchCount = 0; return; }
            var serverHas = (bool)polled["agentConnected"];
            var agentNow = networkAgent;
            if (serverHas || agentNow == null) { agentMismatchCount = 0; return; }
            if (++agentMismatchCount < 2) return;
            agentMismatchCount = 0;
            if (agentNow.Connected) agentNow.ForceReconnect();
        }

        object LocalNodeState()
        {
            var host = Dns.GetHostName();
            var ip = networkAgent == null ? "" : networkAgent.PublicIp ?? "";
            return new Dictionary<string, object> { { "ok", true }, { "host", host }, { "ip", ip } };
        }

        // 更新清单签名公钥。部署方用自己的 RSA 私钥签发 webview2-latest.json.sig；
        // 公钥放在同目录 update-key.json 的 modulus 字段（base64）。未配置则拒绝更新。
        static byte[] UpdateKeyModulus()
        {
            var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "update-key.json");
            if (!File.Exists(path)) return null;
            var parsed = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(path)) as Dictionary<string, object>;
            object value;
            if (parsed == null || !parsed.TryGetValue("modulus", out value)) return null;
            try { return Convert.FromBase64String(Convert.ToString(value)); }
            catch { return null; }
        }

        static bool VerifyManifestSignature(byte[] manifestBytes, byte[] signature)
        {
            try
            {
                using (var rsa = new RSACryptoServiceProvider())
                using (var sha = SHA256.Create())
                {
                    var modulus = UpdateKeyModulus();
                    if (modulus == null) return false;
                    rsa.ImportParameters(new RSAParameters { Modulus = modulus, Exponent = new byte[] { 1, 0, 1 } });
                    return rsa.VerifyHash(sha.ComputeHash(manifestBytes), CryptoConfig.MapNameToOID("SHA256"), signature);
                }
            }
            catch { return false; }
        }

        async Task<string> FetchVerifiedManifestAsync()
        {
            var manifestBytes = await http.GetByteArrayAsync(UpdateManifestUrl);
            byte[] signature;
            try { signature = Convert.FromBase64String((await http.GetStringAsync(UpdateManifestUrl + ".sig")).Trim()); }
            catch { throw new InvalidOperationException("更新清单缺少签名，已拒绝更新。"); }
            if (!VerifyManifestSignature(manifestBytes, signature)) throw new InvalidOperationException("更新清单签名无效，已拒绝更新。");
            return Encoding.UTF8.GetString(manifestBytes).TrimStart('\uFEFF');
        }

        async Task<object> CheckUpdateAsync()
        {
            var raw = await FetchVerifiedManifestAsync();
            var manifest = json.DeserializeObject(raw) as Dictionary<string, object>;
            if (manifest == null || !manifest.ContainsKey("version")) throw new InvalidOperationException("轻量版更新清单无效。");
            var latest = Convert.ToString(manifest["version"]);
            return new Dictionary<string, object> { { "ok", true }, { "currentVersion", LauncherVersion }, { "latestVersion", latest }, { "updateAvailable", CompareLauncherVersions(latest, LauncherVersion) > 0 }, { "notes", manifest.ContainsKey("notes") ? manifest["notes"] : "" } };
        }

        static int CompareLauncherVersions(string left, string right)
        {
            var a = ParseLauncherVersion(left); var b = ParseLauncherVersion(right);
            for (var i = 0; i < a.Length; i++) if (a[i] != b[i]) return a[i].CompareTo(b[i]);
            return 0;
        }

        static int[] ParseLauncherVersion(string value)
        {
            var core = (value ?? "").Split('-')[0];
            var parts = core.Split('.');
            var result = new int[4];
            for (var i = 0; i < result.Length && i < parts.Length; i++)
            {
                int parsed;
                if (Int32.TryParse(parts[i], out parsed)) result[i] = parsed;
            }
            return result;
        }

        async Task<object> InstallUpdateAsync()
        {
            var raw = await FetchVerifiedManifestAsync();
            var manifest = json.DeserializeObject(raw) as Dictionary<string, object>;
            if (manifest == null || !manifest.ContainsKey("version") || !manifest.ContainsKey("url") || !manifest.ContainsKey("sha256")) throw new InvalidOperationException("轻量版更新清单无效。");
            var latest = Convert.ToString(manifest["version"]);
            if (CompareLauncherVersions(latest, LauncherVersion) <= 0) return new Dictionary<string, object> { { "ok", true }, { "updateAvailable", false }, { "currentVersion", LauncherVersion }, { "latestVersion", latest } };
            var packageUrl = new Uri(Convert.ToString(manifest["url"]));
            if (packageUrl.Scheme != Uri.UriSchemeHttps || packageUrl.Host != "127.0.0.1" || !packageUrl.AbsolutePath.StartsWith("/downloads/launcher/", StringComparison.Ordinal)) throw new InvalidOperationException("更新包地址不在受信任服务器范围内。");
            // The shared client has a 20 s timeout for API calls. The update
            // package is ~25 MB, so download it with its own longer timeout.
            byte[] bytes;
            using (var downloader = new HttpClient(new HttpClientHandler { UseProxy = false }) { Timeout = TimeSpan.FromMinutes(10) })
                bytes = await downloader.GetByteArrayAsync(packageUrl);
            var expected = Convert.ToString(manifest["sha256"]).Trim().ToLowerInvariant();
            using (var sha = SHA256.Create())
            {
                var actual = BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
                if (!String.Equals(actual, expected, StringComparison.Ordinal)) throw new InvalidOperationException("更新包校验失败。");
            }
            var tempPackage = Path.Combine(Path.GetTempPath(), "douyinjuhe-webview2-" + Guid.NewGuid().ToString("N") + ".zip");
            File.WriteAllBytes(tempPackage, bytes);
            var updater = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "DouyinJuheWebView2Updater.exe");
            if (!File.Exists(updater)) throw new InvalidOperationException("更新组件缺失。");
            var updaterCopy = Path.Combine(Path.GetTempPath(), "douyinjuhe-webview2-updater-" + Guid.NewGuid().ToString("N") + ".exe");
            File.Copy(updater, updaterCopy, true);
            var currentExe = Process.GetCurrentProcess().MainModule.FileName;
            // BaseDirectory 以反斜杠结尾，直接放进引号会让 \" 被当成转义引号，参数被合并，更新器收到的参数不足而静默退出。
            var installDirectory = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var args = "\"" + tempPackage + "\" \"" + installDirectory + "\" \"" + Path.GetFileName(currentExe) + "\" " + Process.GetCurrentProcess().Id;
            Process.Start(new ProcessStartInfo { FileName = updaterCopy, Arguments = args, WorkingDirectory = Path.GetTempPath(), UseShellExecute = true, WindowStyle = ProcessWindowStyle.Hidden });
            BeginInvoke(new Action(Close));
            return new Dictionary<string, object> { { "ok", true }, { "updateAvailable", true }, { "restarting", true }, { "version", latest } };
        }

        async Task<object> RequestAsync(string method, string path, object body, bool auth, bool useNodeToken = false)
        {
            using (var request = new HttpRequestMessage(new HttpMethod(method), api + path))
            {
                var authToken = useNodeToken ? nodeToken : token;
                if (auth && String.IsNullOrEmpty(authToken)) throw new InvalidOperationException("登录器尚未登录。");
                if (auth) request.Headers.TryAddWithoutValidation("Authorization", "Bearer " + authToken);
                request.Headers.TryAddWithoutValidation("X-DouyinJuhe-Launcher", LauncherVersion);
                if (body != null) request.Content = new StringContent(json.Serialize(body), Encoding.UTF8, "application/json");
                var response = await http.SendAsync(request);
                var text = await response.Content.ReadAsStringAsync();
                var data = String.IsNullOrWhiteSpace(text) ? new Dictionary<string, object>() : json.DeserializeObject(text);
                if (!response.IsSuccessStatusCode)
                {
                    var errorData = data as Dictionary<string, object>;
                    var message = errorData != null && errorData.ContainsKey("error")
                        ? Convert.ToString(errorData["error"])
                        : "请求错误 " + (int)response.StatusCode;
                    throw new InvalidOperationException(message);
                }
                return data;
            }
        }

        void Respond(string id, object result, string error)
        {
            var response = new Dictionary<string, object> { { "id", id }, { "ok", error == null } };
            if (error == null) response["result"] = result;
            else response["error"] = error;
            browser.CoreWebView2.PostWebMessageAsString(json.Serialize(response));
        }

        static string BridgeScript()
        {
            return @"(() => { const pending = new Map(); let seq = 0; window.chrome.webview.addEventListener('message', e => { let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (_) { return; } if (!d || !d.id || !pending.has(d.id)) return; const p = pending.get(d.id); pending.delete(d.id); d.ok ? p.resolve(d.result) : p.reject(new Error(d.error || '请求失败')); }); const call = (method, payload) => new Promise((resolve, reject) => { const id = 'wv2-' + (++seq); pending.set(id, {resolve, reject}); window.chrome.webview.postMessage(JSON.stringify({id, method, payload: payload || null})); }); window.douyinjuhe = Object.freeze({ checkConnection: () => call('checkConnection'), checkUpdate: () => call('checkUpdate'), installUpdate: () => call('installUpdate'), nodeState: () => call('nodeState'), localNodeState: () => call('localNodeState'), loginNode: credentials => call('loginNode', credentials), logoutNode: () => call('logoutNode'), bindNode: code => call('bindNode', {code}), localAccounts: () => call('localAccounts'), douyinChatState: () => call('douyinChatState'), launchDouyinChat: options => call('launchDouyinChat', options), captureDouyinChat: options => call('captureDouyinChat', options), installDouyinChat: () => call('installDouyinChat'), prepareDouyinChatLogin: options => call('prepareDouyinChatLogin', options), deleteLocalAccount: id => call('deleteLocalAccount', {id}), deleteAccount: account => call('deleteAccount', account), activateAccount: account => call('activateAccount', account), nodeWallet: () => call('nodeWallet'), bindAccountSlot: account => call('bindAccountSlot', account),copyLocalAccountCookie: id => call('copyLocalAccountCookie', {id}), refreshLocalAccountProfiles: () => call('refreshLocalAccountProfiles'), creatorLoginState: () => call('creatorLoginState'), openCreatorLogin: options => call('openCreatorLogin', options), newCreatorLogin: options => call('newCreatorLogin', options), captureCreator: options => call('captureCreator', options), completeAccountTask: result => call('completeAccountTask', result), onAccountTask: () => () => {}, onLocalAccountUpdated: () => () => {} }); })();";
        }
    }

    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }
}
