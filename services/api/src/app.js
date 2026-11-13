import { createServer } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { randomUUID, createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { API_VERSION, HEALTH_PATH } from '@douyinjuhe/contracts';
import { createBusiness } from './business.js';
import { recentSegments } from './stall-trace.js';
export function createCreatorDiagnosticFileLogger(database) {
  if (!database || database === ':memory:') return event => console.info('[creator-diagnostic]', JSON.stringify(event));
  const directory = resolve(dirname(database), 'logs');
  const file = resolve(directory, 'creator-diagnostic.log');
  return event => {
    try {
      mkdirSync(directory, { recursive: true });
      if (existsSync(file) && statSync(file).size > 5 * 1024 * 1024) {
        const rotated = `${file}.1`;
        if (existsSync(rotated)) unlinkSync(rotated);
        renameSync(file, rotated);
      }
      appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch { /* Diagnostics must not affect account operations. */ }
  };
}
export function createApiServer({ database = ':memory:', creatorDiagnosticLogger = createCreatorDiagnosticFileLogger(database), webRoot = process.env.DOUYINJUHE_WEB_ROOT } = {}) {
  const instanceId = randomUUID();
  const business = createBusiness(database, { creatorDiagnosticLogger });
  // 登录器下载文件。默认取仓库构建产物 build/launcher/DouyinJuheLauncher.exe；
  // 部署方把产物放在别处时用 DOUYINJUHE_LAUNCHER_FILE 指定绝对路径。
  // 版本号默认从源码 LauncherVersion 常量读取，也可用 DOUYINJUHE_LAUNCHER_VERSION 覆盖。
  const launcherFile = resolve(process.env.DOUYINJUHE_LAUNCHER_FILE
    || fileURLToPath(new URL('../../../build/launcher/DouyinJuheLauncher.exe', import.meta.url)));
  const launcherVersionSource = fileURLToPath(new URL('../../../apps/launcher-webview2/Program.cs', import.meta.url));
  const launcherVersion = (() => {
    const override = String(process.env.DOUYINJUHE_LAUNCHER_VERSION || '').trim();
    if (/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(override)) return override;
    try {
      const match = readFileSync(launcherVersionSource, 'utf8').match(/const string LauncherVersion = "(\d+\.\d+\.\d+(?:-[\w.-]+)?)"/);
      if (match) return match[1];
    } catch { /* 源码不在部署目录时退回默认值 */ }
    return '0.2.117-webview2';
  })();
  let launcherSha256 = '';
  const launcherDigest = () => {
    if (launcherSha256) return launcherSha256;
    try { launcherSha256 = createHash('sha256').update(readFileSync(launcherFile)).digest('hex'); }
    catch { return ''; }
    return launcherSha256;
  };
  // 可选：后端直接托管网页构建产物（apps/web/dist），使单进程同时提供网页与 API。
  // 不配置时只提供 API，由 start-local.mjs 或 nginx 托管网页。
  const staticRoot = webRoot ? resolve(webRoot) + sep : null;
  const staticTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };
  const serveStatic = async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = normalize(join(staticRoot, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(staticRoot)) { res.statusCode = 403; res.end(); return; }
    try {
      const body = await readFile(file).catch(error => {
        // 单页应用：没有扩展名的路径回退到首页。
        if (extname(file)) throw error;
        file = join(staticRoot, 'index.html');
        return readFile(file);
      });
      res.writeHead(200, { 'Content-Type': staticTypes[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch { res.statusCode = 404; res.end('Not Found'); }
  };
  const allowedOrigins = new Set(String(process.env.DOUYINJUHE_WEB_ORIGINS || 'http://127.0.0.1:18181,http://localhost:18181')
    .split(',').map(value => value.trim()).filter(Boolean));
  queueMicrotask(() => business.retryPendingMessages().catch(() => {}));
  let serverRefreshRunning = false;
  const refreshServerConversations = async () => {
    if (serverRefreshRunning) return;
    serverRefreshRunning = true;
    try { await business.refreshServerConversations(); }
    finally { serverRefreshRunning = false; }
  };
  // The launcher supplies identity material; the API owns receiving and keeps
  // the web panel current even when the user is not manually refreshing it.
  const serverRefreshTimer = setInterval(() => { refreshServerConversations().catch(() => {}); }, 3_000);
  serverRefreshTimer.unref?.();
  queueMicrotask(() => { refreshServerConversations().catch(() => {}); });
  // 新粉丝检测（聊天通道，只记录事件）独立于 3 秒同步，20 秒一次。
  let followWatchRunning = false;
  const refreshFollowWatch = async () => {
    if (followWatchRunning) return;
    followWatchRunning = true;
    try { await business.refreshFollowWatch(); }
    finally { followWatchRunning = false; }
  };
  const followWatchTimer = setInterval(() => { refreshFollowWatch().catch(() => {}); }, 20_000);
  followWatchTimer.unref?.();
  // 诊断：事件循环被同步任务占住时，所有请求（包括切换会话）都会排队。
  // 每 10 秒记录一次窗口内的最大/p99 延迟，只在超过 200 毫秒时输出。
  const loopDelay = monitorEventLoopDelay({ resolution: 10 }); loopDelay.enable();
  const loopTimer = setInterval(() => {
    const max = Math.round(loopDelay.max / 1e6), p99 = Math.round(loopDelay.percentile(99) / 1e6);
    if (max > 200) {
      // 超过 2 秒的长停顿附带最近的长同步代码段，用来判断是哪类任务占住了主线程。
      const culprits = max > 2000 ? recentSegments() : undefined;
      console.warn('[event-loop-lag]', JSON.stringify({ maxMs: max, p99Ms: p99, ...(culprits ? { segments: culprits } : {}) }));
    }
    loopDelay.reset();
  }, 10_000);
  loopTimer.unref?.();
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    // 诊断：记录耗时超过 300 毫秒的 API 请求（只记方法、脱敏路径、状态码，不含查询串和令牌）。
    const requestStartedAt = Date.now();
    res.once('finish', () => {
      const elapsed = Date.now() - requestStartedAt;
      if (elapsed < 300) return;
      const safePath = String(req.url || '').split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').slice(0, 80);
      console.warn('[api-slow]', JSON.stringify({ method: req.method, path: safePath, status: res.statusCode, ms: elapsed }));
    });
    if (req.url === HEALTH_PATH && req.method === 'GET') {
      res.end(JSON.stringify({ service: 'douyinjuhe-api', apiVersion: API_VERSION, status: 'ok', instanceId }));
      return;
    }
    // 登录器下载：托管构建产物，供网页下载按钮和登录器自更新使用。
    if (req.method === 'GET' && req.url.startsWith('/downloads/launcher/')) {
      const fileName = req.url.slice('/downloads/launcher/'.length);
      if (fileName === 'webview2-latest.json') {
        const digest = launcherDigest();
        if (!digest) { res.statusCode = 404; res.end('Launcher not built'); return; }
        const origin = `http://${req.headers.host || '127.0.0.1:18182'}`;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          version: launcherVersion,
          sha256: digest,
          url: `${origin}/downloads/launcher/DouyinJuheLauncher-WebView2-latest.exe`,
        }));
        return;
      }
      if (fileName === 'DouyinJuheLauncher-WebView2-latest.exe') {
        if (!existsSync(launcherFile)) { res.statusCode = 404; res.end('Launcher not built'); return; }
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment; filename="DouyinJuheLauncher-WebView2-latest.exe"');
        createReadStream(launcherFile).pipe(res);
        return;
      }
    }
    if (await business.route(req, res)) return;
    // API 未命中：若配置了网页目录且非 /api 路径，则交给静态托管。
    if (staticRoot && req.method === 'GET' && !req.url.startsWith('/api/')) { await serveStatic(req, res); return; }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });
  const realtime = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/api/v1/node/network') {
      if (request.headers.origin) { socket.destroy(); return; }
      business.nodeNetwork.handleUpgrade(request, socket, head); return;
    }
    const sameOrigin = (() => { try { return new URL(request.headers.origin).host === request.headers.host; } catch { return false; } })();
    const originAllowed = !request.headers.origin || sameOrigin || allowedOrigins.has(request.headers.origin);
    if (path !== '/api/v1/realtime' || !originAllowed) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    realtime.handleUpgrade(request, socket, head, client => realtime.emit('connection', client));
  });
  realtime.on('connection', client => {
    let owner = null, accounts = new Set(), isAdmin = false;
    const authTimer = setTimeout(() => client.close(4401, '认证超时'), 5000);
    const relay = event => {
      if (owner !== event.owner && !isAdmin) return;
      if (event.type === 'tenant.disabled') { if (owner === event.owner) client.close(4403, '租户已停用'); return; }
      // Account identity can be created or re-bound by a launcher after the
      // web tab has subscribed to the accounts it knew about at login time.
      // Such an account is not in `accounts` yet, so filtering these events
      // would leave the web account list stale until a full page reload.  The
      // event is already scoped to the authenticated tenant (`owner`), and
      // the client handles an unknown account by reloading `/accounts`.
      const isAccountListEvent = event.type === 'account.updated' || event.type === 'account.deleted';
      if (accounts.size && !accounts.has(event.account) && !isAccountListEvent) return;
      // A browser tab can disappear between the readyState check and send.
      // Realtime delivery is auxiliary; it must never turn a successful API
      // write (especially launcher identity upload) into an HTTP 500.
      if (client.readyState !== 1) { business.events.off('event', relay); return; }
      try { client.send(JSON.stringify({ type: 'event', event: event.type, payload: event.payload })); }
      catch { business.events.off('event', relay); try { client.terminate(); } catch { /* already closed */ } }
    };
    client.on('message', raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { client.close(4400, '消息格式无效'); return; }
      if (!owner) {
        if (message.type !== 'authenticate') { client.close(4401, '请先认证'); return; }
        const auth = business.authenticate(message.token);
        if (!auth) { client.close(4401, '登录已失效'); return; }
        owner = auth.owner; isAdmin = auth.role === 'admin';
        clearTimeout(authTimer); business.events.on('event', relay); client.send(JSON.stringify({ type: 'authenticated' })); return;
      }
      if (message.type === 'subscribe') {
        if (!Array.isArray(message.accountIds) || message.accountIds.length > 100 || message.accountIds.some(id => typeof id !== 'string')) { client.close(4400, '订阅参数无效'); return; }
        accounts = new Set(business.ownedAccounts(isAdmin ? null : owner, [...new Set(message.accountIds)]));
        client.send(JSON.stringify({ type: 'subscribed', accountIds: [...accounts] }));
      }
    });
    client.on('close', () => { clearTimeout(authTimer); business.events.off('event', relay); });
    client.on('error', () => {});
  });
  const heartbeat = setInterval(() => { for (const client of realtime.clients) { if (client.isAlive === false) { client.terminate(); continue; } client.isAlive = false; client.ping(); } }, 30000);
  realtime.on('connection', client => { client.isAlive = true; client.on('pong', () => { client.isAlive = true; }); });
  server.on('close', () => { clearInterval(heartbeat); clearInterval(serverRefreshTimer); clearInterval(followWatchTimer); for (const client of realtime.clients) client.terminate(); realtime.close(); business.close(); });
  return server;
}
