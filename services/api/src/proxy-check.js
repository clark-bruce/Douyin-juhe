import net from 'node:net';
import tls from 'node:tls';

const targetHost = 'example.com';
const targetPort = 443;
const timeoutMs = 8000;

function connectTcp(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: address, port });
    const timer = setTimeout(() => socket.destroy(new Error('连接超时')), timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

function connectTls(socket, servername) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername });
    const timer = setTimeout(() => secure.destroy(new Error('TLS 握手超时')), timeoutMs);
    secure.once('secureConnect', () => { clearTimeout(timer); resolve(secure); });
    secure.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

function createReader(socket) {
  let buffered = Buffer.alloc(0);
  const waiters = [];
  socket.on('data', chunk => {
    buffered = Buffer.concat([buffered, chunk]);
    while (waiters.length && buffered.length >= waiters[0].size) {
      const waiter = waiters.shift();
      const value = buffered.subarray(0, waiter.size);
      buffered = buffered.subarray(waiter.size);
      waiter.resolve(value);
    }
  });
  socket.on('close', () => { while (waiters.length) waiters.shift().reject(new Error('代理提前关闭连接')); });
  socket.on('error', error => { while (waiters.length) waiters.shift().reject(error); });
  return {
    read(size) {
      if (buffered.length >= size) {
        const value = buffered.subarray(0, size);
        buffered = buffered.subarray(size);
        return Promise.resolve(value);
      }
      return new Promise((resolve, reject) => waiters.push({ size, resolve, reject }));
    },
    async until(delimiter, maxBytes = 8192) {
      const chunks = [];
      let size = 0;
      while (size < maxBytes) {
        const chunk = await this.read(1);
        chunks.push(chunk);
        size += 1;
        const value = Buffer.concat(chunks);
        if (value.subarray(-delimiter.length).equals(delimiter)) return value;
      }
      throw new Error('代理响应过长');
    },
  };
}

async function checkHttpProxy(proxy, socket) {
  const reader = createReader(socket);
  const auth = proxy.username ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}\r\n` : '';
  socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}Proxy-Connection: Keep-Alive\r\n\r\n`);
  const response = (await reader.until(Buffer.from('\r\n\r\n'))).toString('latin1');
  if (!/^HTTP\/1\.[01] 200\b/.test(response)) throw new Error('代理拒绝建立隧道');
}

async function checkSocksProxy(proxy, socket) {
  const reader = createReader(socket);
  const hasAuth = Boolean(proxy.username);
  socket.write(Buffer.from(hasAuth ? [5, 2, 0, 2] : [5, 1, 0]));
  const [version, method] = await reader.read(2);
  if (version !== 5 || method === 255 || (method === 2 && !hasAuth)) throw new Error('SOCKS5 认证方式不匹配');
  if (method === 2) {
    const username = Buffer.from(proxy.username), password = Buffer.from(proxy.password);
    if (username.length > 255 || password.length > 255) throw new Error('SOCKS5 认证信息过长');
    socket.write(Buffer.concat([Buffer.from([1, username.length]), username, Buffer.from([password.length]), password]));
    const [authVersion, authStatus] = await reader.read(2);
    if (authVersion !== 1 || authStatus !== 0) throw new Error('SOCKS5 用户名或密码错误');
  } else if (method !== 0) throw new Error('SOCKS5 不支持所需认证方式');

  const domain = Buffer.from(targetHost);
  socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, domain.length]), domain, Buffer.from([targetPort >> 8, targetPort & 0xff])]));
  const [replyVersion, reply, , addressType] = await reader.read(4);
  if (replyVersion !== 5 || reply !== 0) throw new Error('SOCKS5 连接目标失败');
  const addressLength = addressType === 1 ? 4 : addressType === 4 ? 16 : addressType === 3 ? (await reader.read(1))[0] : 0;
  if (!addressLength) throw new Error('SOCKS5 返回地址无效');
  await reader.read(addressLength + 2);
}

export async function checkProxy(proxy) {
  // The proxy endpoint may intentionally be a tenant-local gateway (for example 127.0.0.1).
  // The target is fixed to example.com, so this check cannot be used as an arbitrary SSRF primitive.
  let socket = await connectTcp(proxy.host, proxy.port);
  try {
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('代理响应超时')));
    if (proxy.protocol === 'https') socket = await connectTls(socket, proxy.host);
    const startedAt = Date.now();
    if (proxy.protocol === 'socks5') await checkSocksProxy(proxy, socket);
    else await checkHttpProxy(proxy, socket);
    return { latencyMs: Date.now() - startedAt };
  } finally {
    socket.destroy();
  }
}
