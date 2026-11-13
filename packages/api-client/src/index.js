import { HEALTH_PATH, isHealthResponse } from '@douyinjuhe/contracts';
export async function checkConnection(baseUrl = '', fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${HEALTH_PATH}`, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
  if (!response.ok) throw new Error(`服务返回 HTTP ${response.status}`);
  const payload = await response.json();
  if (!isHealthResponse(payload)) throw new Error('服务接口版本不匹配');
  return payload;
}
