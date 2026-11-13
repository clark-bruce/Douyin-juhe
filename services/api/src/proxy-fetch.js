import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import zlib from 'node:zlib';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function authHeader(proxy) {
  return proxy.username ? `Basic ${Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64')}` : '';
}

function connect(proxy) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    const timer = setTimeout(() => socket.destroy(new Error('代理连接超时')), 15000);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

function readConnectResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      socket.off('data', onData);
      const line = buffer.subarray(0, end).toString('latin1').split('\r\n')[0] || '';
      if (!/^HTTP\/1\.[01] 2\d\d\b/.test(line)) { reject(new Error('代理拒绝建立 HTTPS 隧道')); return; }
      const remainder = buffer.subarray(end + 4);
      if (remainder.length) socket.unshift(remainder);
      resolve();
    };
    socket.on('data', onData); socket.once('error', reject);
  });
}

async function socks5Tunnel(proxy, target) {
  const socket = await connect(proxy);
  const read = size => new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const onData = chunk => { buf = Buffer.concat([buf, chunk]); if (buf.length >= size) { socket.off('data', onData); resolve(buf); } };
    socket.on('data', onData); socket.once('error', reject);
  });
  const credentials = proxy.username ? Buffer.from([2]) : Buffer.from([0]);
  socket.write(Buffer.concat([Buffer.from([5, credentials.length]), credentials]));
  const greeting = await read(2);
  if (greeting[1] === 255 || (greeting[1] === 2 && !proxy.username)) throw new Error('SOCKS5 认证失败');
  if (greeting[1] === 2) {
    const user = Buffer.from(proxy.username), pass = Buffer.from(proxy.password || '');
    socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
    const login = await read(2); if (login[1] !== 0) throw new Error('SOCKS5 用户名或密码错误');
  }
  const host = Buffer.from(target.hostname);
  socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, host.length]), host, Buffer.from([target.port >> 8, target.port & 255])]));
  const header = await read(4); if (header[1] !== 0) throw new Error(`SOCKS5 连接目标失败（${header[1]}）`);
  const length = header[3] === 1 ? 4 : header[3] === 4 ? 16 : (await read(1))[0];
  await read(length + 2);
  return socket;
}

export async function tunnel(proxy, target) {
  if (proxy.protocol === 'socks5') return socks5Tunnel(proxy, target);
  let socket = await connect(proxy);
  if (proxy.protocol === 'https') {
    socket = await new Promise((resolve, reject) => {
      const secure = tls.connect({ socket, servername: proxy.host });
      secure.once('secureConnect', () => resolve(secure)); secure.once('error', reject);
    });
  }
  const auth = authHeader(proxy);
  socket.write(`CONNECT ${target.hostname}:${target.port} HTTP/1.1\r\nHost: ${target.hostname}:${target.port}\r\n${auth ? `Proxy-Authorization: ${auth}\r\n` : ''}Connection: keep-alive\r\n\r\n`);
  await readConnectResponse(socket);
  return socket;
}

function requestWithSocket(target, options, socket) {
  const transport = target.protocol === 'https:' ? https : http;
  return transport.request({ hostname: target.hostname, port: target.port, method: options.method || 'GET', path: `${target.pathname}${target.search}`, headers: options.headers, socket, agent: false, servername: target.hostname }, response => response);
}

export async function proxyFetch(input, options = {}, proxy = null) {
  if (!proxy) return fetch(input, options);
  const target = new URL(input);
  const headers = Object.fromEntries(new Headers(options.headers || {}).entries());
  const body = options.body === undefined || options.body === null ? null : Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body));
  if (body && !headers['content-length']) headers['content-length'] = String(body.length);
  const response = await new Promise(async (resolve, reject) => {
    try {
      let request;
      if (!proxy) {
        const transport = target.protocol === 'https:' ? https : http;
        request = transport.request({ hostname: target.hostname, port: target.port, method: options.method || 'GET', path: `${target.pathname}${target.search}`, headers, agent: false }, resolve);
      } else if (proxy.protocol === 'http' && target.protocol === 'http:') {
        request = http.request({ hostname: proxy.host, port: proxy.port, method: options.method || 'GET', path: target.href, headers: { ...headers, host: target.host, ...(authHeader(proxy) ? { 'proxy-authorization': authHeader(proxy) } : {}) }, agent: false }, resolve);
      } else {
        let socket = await tunnel(proxy, target);
        if (target.protocol === 'https:') socket = await new Promise((ok, no) => { const secure = tls.connect({ socket, servername: target.hostname }); secure.once('secureConnect', () => ok(secure)); secure.once('error', no); });
        request = requestWithSocket(target, { ...options, headers }, socket); request.once('response', resolve);
      }
      if (options.signal) {
        if (options.signal.aborted) { request.destroy(new Error('请求已取消')); return; }
        options.signal.addEventListener('abort', () => request.destroy(new Error('请求已取消')), { once: true });
      }
      request.once('error', reject); if (body) request.write(body); request.end();
    } catch (error) { reject(error); }
  });
  const chunks = []; let size = 0;
  for await (const chunk of response) { size += chunk.length; if (size > MAX_RESPONSE_BYTES) throw new Error('代理响应过大'); chunks.push(chunk); }
  let payload = Buffer.concat(chunks);
  const responseHeaders = new Headers(response.headers);
  const encoding = String(responseHeaders.get('content-encoding') || '').toLowerCase();
  if (encoding.includes('gzip')) payload = zlib.gunzipSync(payload);
  else if (encoding.includes('deflate')) payload = zlib.inflateSync(payload);
  if (encoding.includes('gzip') || encoding.includes('deflate')) responseHeaders.delete('content-encoding');
  return { ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, headers: responseHeaders, arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength), text: async () => payload.toString('utf8'), json: async () => JSON.parse(payload.toString('utf8')) };
}

export const proxyFetchFor = proxy => {
  const fetchWithProxy = (input, options) => proxyFetch(input, options, proxy);
  // Lets protocol helpers distinguish the production proxy transport from a
  // test/in-process fetch implementation without exposing proxy credentials.
  fetchWithProxy.isDouyinJuheProxyFetch = true;
  return fetchWithProxy;
};
