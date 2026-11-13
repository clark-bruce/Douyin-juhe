import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import zlib from 'node:zlib';
import { WebSocketServer } from 'ws';
import { tunnel } from './proxy-fetch.js';

// Creator pages load their application shell from these official ByteDance
// CDN/security domains in addition to the Douyin API hosts. Keep the suffix
// boundary check below; do not broaden the node tunnel to arbitrary HTTPS.
const domains = ['douyin.com', 'douyinstatic.com', 'douyinpic.com', 'douyincdn.com', 'byteimg.com', 'bytecdn.cn', 'bytedance.com', 'bytedance.net', 'bytegecko.com', 'bytescm.com', 'bytetos.com', 'bytednsdoc.com', 'byted-static.com', 'bytegoofy.com', 'ibytedapm.com', 'yhgfb-cn-static.com', 'pstatp.com', 'snssdk.com', 'toutiao.com', 'amemv.com', 'ibytedtos.com', 'zijieapi.com', 'iesdouyin.com', 'bytetcc.com'];
export const platformHostAllowed = host => /^[a-z0-9.-]+$/.test(host) && domains.some(domain => host === domain || host.endsWith('.' + domain));
// Upload and media hosts (ImageX UploadHosts, CDN nodes) vary per request, so
// fetches are not restricted to a domain list. They must still be HTTPS on 443
// without credentials and name a public DNS host: IP literals, single-label
// names and local/internal suffixes are refused so the node cannot be pointed
// at the user's own machine or LAN. The login tunnel keeps the domain list.
const publicDnsName = host => host.length <= 253
  && /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(host)
  && !['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet'].some(suffix => host.endsWith(suffix));
export function platformUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || !publicDnsName(url.hostname)) throw Error('网络出口仅允许 HTTPS 公网域名请求');
  return url;
}
const publicIp = value => {
  if (net.isIP(value) !== 4) return false;
  const [a, b] = value.split('.').map(Number);
  return ![0, 10, 127, 169, 224, 240, 255].includes(a) && a < 224 && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127);
};
const errorFor = (message, { offline = false, uncertain = false } = {}) => Object.assign(Error(message), { nodeOffline: offline, deliveryUncertain: uncertain, code: offline ? 'NODE_OFFLINE' : 'NODE_NETWORK_ERROR' });

// Protocol bytes stay unchanged. A node executes only HTTPS transport; the
// existing server protocol modules still own serialization and receipts.
export function createNodeNetwork({ authenticateNode, resolveProxy, onConnected = () => {}, onPublicIp = () => {}, dial = null } = {}) {
  const agents = new Map(), pending = new Map();
  // ws 默认遇到无效 UTF-8 文本帧会直接断开整条连接，在途请求会全部变成“需核对”。
  // 这里自行校验：坏帧只让对应的那一个请求失败，并记录来源，连接保持。
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 24 * 1024 * 1024, skipUTF8Validation: true });
  let closed = false;
  const disconnect = client => {
    if (agents.get(client.node?.id) === client) agents.delete(client.node.id);
    const jobs = [...pending.values()].filter(job => job.client === client);
    // 只记录节点（agent）长连接的断开原因，便于区分“服务端主动断开”和“对端/网络断开”。
    if (client.role === 'agent' && !client.closeLogged) {
      client.closeLogged = true;
      console.warn('[node-agent-closed]', JSON.stringify({
        node: String(client.node?.id || '').slice(0, 8), cause: client.closeCause || 'peer_closed',
        code: client.closeCode ?? null, reason: String(client.closeReason || '').slice(0, 60), error: String(client.lastError || '').slice(0, 80),
        aliveMs: Date.now() - (client.connectedAt || Date.now()), pending: jobs.length, dispatched: jobs.filter(job => job.dispatched).length,
        targets: jobs.slice(0, 4).map(job => job.target || ''), lastFrameBytes: client.lastFrameBytes ?? null, lastFrameAgoMs: client.lastFrameAt ? Date.now() - client.lastFrameAt : null,
      }));
    }
    for (const job of jobs) job.finish(errorFor('本机节点连接中断，发送结果需核对', { uncertain: job.dispatched && job.mutating }));
  };
  sockets.on('connection', (client, request) => {
    const authTimer = setTimeout(() => client.close(4401, '认证超时'), 5000);
    let tunnelSocket = null;
    client.on('error', error => { client.lastError = error?.code || error?.message || 'error'; });
    client.on('close', (code, reason) => { clearTimeout(authTimer); tunnelSocket?.destroy(); client.closeCode = code; client.closeReason = reason?.toString?.() || ''; disconnect(client); });
    client.on('message', async (raw, binary) => {
      client.lastFrameBytes = raw.length; client.lastFrameAt = Date.now();
      if (tunnelSocket) { if (!binary || !authenticateNode(client.nodeToken)) { client.close(4400); return; } if (!tunnelSocket.write(raw)) client._socket?.pause(); return; }
      if (client.connecting || binary) { client.close(4400); return; }
      let text, invalidUtf8 = false;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { invalidUtf8 = true; text = raw.toString(); }
      let message; try { message = JSON.parse(text); } catch { client.close(4400, '消息格式无效'); return; }
      if (invalidUtf8) {
        const bad = message && typeof message === 'object' ? message : {};
        const job = pending.get(bad.id);
        console.warn('[node-invalid-utf8]', JSON.stringify({
          node: String(client.node?.id || '').slice(0, 8), type: String(bad.type || '').slice(0, 20), bytes: raw.length,
          target: job?.target || '', status: bad.status ?? null, fields: Object.keys(bad).filter(key => JSON.stringify(bad[key] ?? '').includes('\uFFFD')),
        }));
        if (!client.node || bad.type !== 'fetch_result' || !job || job.client !== client) { client.close(4400, '消息格式无效'); return; }
        job.finish(errorFor('本机节点返回无效响应', { uncertain: job.mutating }));
        return;
      }
      if (!client.node) {
        if (message.type !== 'authenticate') { client.close(4401); return; }
        const node = authenticateNode(String(message.token || ''));
        if (!node) { client.close(4401, '设备授权失效'); return; }
        client.node = node; client.nodeToken = String(message.token); clearTimeout(authTimer);
        const peer = String(request.socket.remoteAddress || '').replace(/^::ffff:/, '');
        const forwarded = ['127.0.0.1', '::1'].includes(peer) ? String(request.headers['x-real-ip'] || '') : peer;
        client.publicIp = publicIp(forwarded) ? forwarded : '';
        if (message.role === 'agent') {
          client.role = 'agent'; client.connectedAt = Date.now();
          const previous = agents.get(node.id); if (previous) { previous.closeCause = 'replaced'; disconnect(previous); previous.close(4409, '节点已重新连接'); }
          agents.set(node.id, client);
          if (client.publicIp) Promise.resolve().then(() => onPublicIp(node, client.publicIp)).catch(() => {});
          client.send(JSON.stringify({ type: 'authenticated', nodeId: node.id, publicIp: client.publicIp }));
          Promise.resolve().then(() => onConnected(node)).catch(() => {});
          return;
        }
        if (message.role !== 'tunnel') { client.close(4400); return; }
        try {
          const host = String(message.host || '').toLowerCase();
          if (!platformHostAllowed(host)) throw Error('登录目标无效');
          platformUrl('https://' + host + '/');
          if (message.port !== 443 || !['direct', 'custom'].includes(message.networkMode)) throw Error('登录出口参数无效');
          const count = [...sockets.clients].filter(x => x.node?.id === node.id && x.role === 'tunnel').length;
          if (count >= 64) throw Error('登录连接过多');
          client.role = 'tunnel';
          client.connecting = true;
          const proxy = message.networkMode === 'custom' ? resolveProxy(node.owner, String(message.proxyId || '')) : null;
          if (message.networkMode === 'custom' && !proxy) throw Error('未绑定代理');
          if (dial) tunnelSocket = await dial({ host, proxy });
          else if (proxy) tunnelSocket = await tunnel(proxy, { hostname: host, port: 443 });
          else {
            const addresses = await lookup(host, { all: true, family: 4 });
            if (!addresses.length || addresses.some(x => !publicIp(x.address))) throw Error('目标地址无效');
            tunnelSocket = await new Promise((resolve, reject) => {
              const socket = net.connect({ host: addresses[0].address, port: 443 });
              socket.setTimeout(15000, () => socket.destroy(Error('登录出口连接超时')));
              socket.once('connect', () => resolve(socket)); socket.once('error', reject);
            });
          }
          if (client.readyState !== 1) { tunnelSocket.destroy(); return; }
          tunnelSocket.setTimeout(60000, () => tunnelSocket.destroy());
          tunnelSocket.on('error', () => client.close(4502, '登录出口连接失败'));
          tunnelSocket.on('close', () => client.close());
          tunnelSocket.on('drain', () => client._socket?.resume());
          tunnelSocket.on('data', data => { if (client.readyState !== 1) return; tunnelSocket.pause(); client.send(data, { binary: true }, () => tunnelSocket?.resume()); });
          client.connecting = false;
          client.send(JSON.stringify({ type: 'tunnel_ready' }));
        } catch { client.close(4502, '登录出口连接失败'); }
        return;
      }
      if (!authenticateNode(client.nodeToken)) { client.close(4401); return; }
      if (message.type !== 'fetch_result' && message.type !== 'fetch_result_part') { client.close(4400); return; }
      const job = pending.get(message.id);
      if (!job || job.client !== client) return;
      if (message.error) { job.finish(errorFor('本机节点网络请求失败', { uncertain: job.mutating })); return; }
      // 大响应由启动器拆成多个小帧回传（避免单个 MB 级文本帧在链路上被损坏）。
      // 第 0 片带 status/headers，后续片只带 data；收齐后按原 fetch_result 处理。
      if (message.type === 'fetch_result_part') {
        try {
          const { index, count } = message;
          if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || count > 512 || index < 0 || index >= count || typeof message.data !== 'string' || message.data.length > 512 * 1024) throw Error('分片无效');
          if (index === 0) job.parts = { count, next: 0, chunks: [], size: 0, status: message.status, headers: message.headers };
          const parts = job.parts;
          if (!parts || parts.count !== count || parts.next !== index) throw Error('分片顺序无效');
          parts.chunks.push(message.data); parts.size += message.data.length; parts.next++;
          if (parts.size > 12 * 1024 * 1024) throw Error('响应过大');
          if (parts.next < count) return;
          message.status = parts.status; message.headers = parts.headers; message.body = parts.chunks.join(''); job.parts = null;
        } catch { job.parts = null; job.finish(errorFor('本机节点返回无效响应', { uncertain: job.mutating })); return; }
      }
      try {
        if (!Number.isInteger(message.status) || message.status < 200 || message.status > 599 || typeof message.body !== 'string' || message.body.length > 12 * 1024 * 1024) throw Error('响应无效');
        let body = Buffer.from(message.body, 'base64');
        if (body.length > 8 * 1024 * 1024) throw Error('响应过大');
        job.bytes = body.length;
        const headers = new Headers(message.headers || {});
        const encoding = String(headers.get('content-encoding') || '').toLowerCase();
        const decompress = encoding === 'gzip' ? zlib.gunzipSync : encoding === 'deflate' ? zlib.inflateSync : encoding === 'br' ? zlib.brotliDecompressSync : null;
        // HEAD/204/304 等无正文的响应仍可能带 content-encoding；空正文解压会抛 Z_BUF_ERROR，必须跳过。
        if (decompress) { if (body.length) body = decompress(body, { maxOutputLength: 8 * 1024 * 1024 }); headers.delete('content-encoding'); headers.delete('content-length'); }
        job.finish(null, new Response([204, 205, 304].includes(message.status) || job.method === 'HEAD' ? null : body, { status: message.status, headers }));
      } catch { job.finish(errorFor('本机节点返回无效响应', { uncertain: job.mutating })); }
    });
  });
  const heartbeat = setInterval(() => {
    for (const client of sockets.clients) {
      if (!client.node) continue;
      if (!authenticateNode(client.nodeToken)) { client.closeCause = 'auth_revoked'; client.terminate(); continue; }
      // 主线程被同步任务占住时，定时器会先于 pong 的读取执行；连续多次没有 pong 才判定失联，避免误杀正常连接。
      if (client.alive === false) {
        client.missed = (client.missed || 0) + 1;
        if (client.missed >= 3) { client.closeCause = 'heartbeat_no_pong'; client.terminate(); continue; }
      } else client.missed = 0;
      client.alive = false; client.ping();
    }
  }, 15000); heartbeat.unref();
  sockets.on('connection', client => { client.alive = true; client.on('pong', () => { client.alive = true; }); });
  return {
    handleUpgrade: (request, socket, head) => sockets.handleUpgrade(request, socket, head, client => sockets.emit('connection', client, request)),
    online: (owner, nodeId) => { const client = agents.get(nodeId); return !!client && client.node.owner === owner && client.readyState === 1 && !!authenticateNode(client.nodeToken); },
    publicIp: (owner, nodeId) => { const client = agents.get(nodeId); return client?.node.owner === owner ? client.publicIp || '' : ''; },
    busy: (owner, accountId) => [...pending.values()].some(job => job.client.node.owner === owner && job.accountId === accountId),
    fetchFor: (owner, nodeId, accountId) => async (url, options = {}) => {
      const target = platformUrl(String(url));
      const client = agents.get(nodeId);
      if (closed || !client || client.node.owner !== owner || client.readyState !== 1 || !authenticateNode(client.nodeToken)) throw errorFor('本机节点离线，等待登录器连接', { offline: true });
      if ([...pending.values()].filter(x => x.client === client).length >= 32) throw errorFor('本机节点请求繁忙，请稍后再试');
      const method = String(options.method || 'GET').toUpperCase();
      if (!['GET', 'HEAD', 'POST'].includes(method)) throw Error('协议请求方法无效');
      const body = options.body == null ? null : Buffer.from(options.body);
      const headers = new Headers(options.headers || {});
      // Authorization belongs to the target service (ImageX SigV4 and upload
      // store tokens) and Host is part of that signature, so both are allowed.
      // Host must still name the target, and proxy/hop-by-hop headers stay blocked.
      for (const header of ['proxy-authorization', 'connection', 'transfer-encoding']) if (headers.has(header)) throw Error('节点请求头无效');
      if (headers.has('host') && String(headers.get('host')).toLowerCase() !== target.host) throw Error('节点请求头无效');
      if (body?.length > 8 * 1024 * 1024) throw Error('协议请求过大');
      // 启动器的 HttpClient 不会自动协商压缩；会话同步响应约 1 MB 且每 3 秒一次，
      // 未压缩时会占满本机上行链路并拖慢同一连接上的发送。这里默认请求压缩，
      // 响应在下方按 content-encoding 解压（带 8 MB 输出上限）。
      if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'gzip, deflate');
      options.signal?.throwIfAborted();
      return new Promise((resolve, reject) => {
        const id = randomUUID(), mutating = method === 'POST';
        const finish = (error, response) => { if (!pending.delete(id)) return;
          // 节点请求耗时诊断：超过 2 秒的请求记录目标、排队深度、响应大小，用来区分“上游慢”和“节点链路排队”。
          const elapsed = Date.now() - job.startedAt;
          // 发送链路上的非轮询请求（身份令牌、用户资料、发送本身等）不论快慢都记录，用来拆分一次发送的耗时。
          const routinePoll = /get_message_by_init|web\/notice/.test(job.target);
          if (elapsed > 2000 || !routinePoll) console.warn(elapsed > 2000 ? '[node-fetch-slow]' : '[node-fetch]', JSON.stringify({ node: String(client.node?.id || '').slice(0, 8), target: job.target, ms: elapsed, queued: job.queued, bytes: job.bytes ?? null, ok: !error }));
          clearTimeout(timer); options.signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(response); };
        const abort = () => finish(errorFor('本机节点请求超时，发送结果需核对', { uncertain: mutating }));
        const timer = setTimeout(abort, 35000);
        const job = { id, accountId, client, method, mutating, dispatched: false, finish, target: (method + ' ' + target.host + target.pathname).slice(0, 100), startedAt: Date.now(), queued: [...pending.values()].filter(x => x.client === client).length }; pending.set(id, job);
        options.signal?.addEventListener('abort', abort, { once: true });
        job.dispatched = true;
        client.send(JSON.stringify({ type: 'fetch', id, accountId, url: String(url), method, headers: Object.fromEntries(headers), body: body?.toString('base64') || '' }), error => { if (error) finish(errorFor('本机节点连接中断', { uncertain: mutating })); });
      });
    },
    close: () => { closed = true; clearInterval(heartbeat); for (const client of sockets.clients) { disconnect(client); client.terminate(); } sockets.close(); },
  };
}
