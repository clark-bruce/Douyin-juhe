export const DEFAULT_API_ORIGIN = 'http://127.0.0.1:18182';

// 生产连接只允许 HTTPS；HTTP 仅用于本机开发。
export function normalizeApiOrigin(input = DEFAULT_API_ORIGIN) {
  const url = new URL(input);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('API 地址必须为不含凭据和路径的服务地址');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('远端 API 必须使用 HTTPS');
  }
  return url.origin;
}
