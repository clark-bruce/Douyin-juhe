export const API_VERSION = 'v1';
export const HEALTH_PATH = '/api/v1/health';
export { DEFAULT_API_ORIGIN, normalizeApiOrigin } from './connection.js';
export { normalizeUpstreamSession } from './upstream.js';
export function isHealthResponse(value) {
  return value?.service === 'douyinjuhe-api' && value?.apiVersion === API_VERSION && value?.status === 'ok'
    && typeof value?.instanceId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value.instanceId);
}
