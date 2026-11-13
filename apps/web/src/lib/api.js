export function currentSession() {
  try { return JSON.parse(localStorage.getItem('douyinjuhe.session') || 'null'); }
  catch { return null; }
}

// API restarts during a deployment leave a 3-8 s gap in which nginx answers
// 502/503/504 with an HTML page (no JSON `error`). Only GETs are retried, so a
// message send is never submitted twice. Application errors (JSON `error`)
// are never retried.
const GATEWAY_STATUS = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [1000, 2000, 3000, 3000];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function apiRequest(path, { method = 'GET', body, timeoutMs = 10000 } = {}) {
  const session = currentSession();
  if (!session?.token) throw Object.assign(new Error('请先在登录器连接中登录抖音聚合。'), { status: 401 });
  let response, result = {}, lastError;
  const attempts = method === 'GET' ? 1 + RETRY_DELAYS_MS.length : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const more = attempt + 1 < attempts;
    response = undefined; result = {};
    try {
      response = await fetch(`/api/v1/${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${session.token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      lastError = error;
      // A timeout already waited the full period; retry it once at most.
      if (!more || (error.name === 'TimeoutError' && attempt >= 1)) break;
      await wait(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    try { result = await response.json(); } catch { /* HTTP status still carries the failure */ }
    if (more && GATEWAY_STATUS.has(response.status) && !result.error) { await wait(RETRY_DELAYS_MS[attempt]); continue; }
    break;
  }
  if (!response) {
    const error = lastError || new Error('request failed');
    throw new Error(error.name === 'TimeoutError' ? '请求超时，请稍后重试。' : '无法连接抖音聚合服务。');
  }
  if (!response.ok) {
    const gateway = GATEWAY_STATUS.has(response.status) && !result.error;
    const message = result.error || (gateway ? (method === 'GET' ? '服务正在更新，请几秒后重试。' : '服务暂时不可用，请先确认操作是否已生效，再决定是否重试。') : `请求失败（${response.status}）`);
    throw Object.assign(new Error(message), { status: response.status });
  }
  return result;
}

export async function apiBlob(path, { timeoutMs = 20000 } = {}) {
  const session = currentSession();
  if (!session?.token) throw Object.assign(new Error('请先在登录器连接中登录抖音聚合。'), { status: 401 });
  const endpoint = path.startsWith('/api/v1/') ? path : `/api/v1/${path}`;
  let response;
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new Error(error.name === 'TimeoutError' ? '媒体加载超时，请稍后重试。' : '无法连接抖音聚合服务。');
  }
  if (!response.ok) {
    let result = {};
    try { result = await response.json(); } catch { /* HTTP status still carries the failure */ }
    throw Object.assign(new Error(result.error || `媒体加载失败（${response.status}）`), { status: response.status });
  }
  return response.blob();
}
