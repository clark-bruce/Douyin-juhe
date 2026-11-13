const forbiddenKeys = /cookie|token|secret|password|authorization|csrf/i;

function rejectCredentials(value, path = 'session') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.test(key)) throw new Error(`上游会话禁止携带凭据字段：${path}.${key}`);
    if (child && typeof child === 'object') rejectCredentials(child, `${path}.${key}`);
  }
}

export function normalizeUpstreamSession(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('上游会话状态无效');
  rejectCredentials(input);
  if (typeof input.accountId !== 'string' || !input.accountId.trim()) throw new Error('上游会话缺少账号标识');
  if (!['logged_out', 'pending', 'authenticated', 'expired', 'unavailable'].includes(input.status)) throw new Error('上游会话状态无效');
  if (input.expiresAt !== null && input.expiresAt !== undefined && (!Number.isInteger(input.expiresAt) || input.expiresAt < 0)) throw new Error('上游会话过期时间无效');
  const capabilities = Array.isArray(input.capabilities) ? [...new Set(input.capabilities.filter(value => typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,48}$/.test(value)))] : [];
  return { accountId: input.accountId.trim(), status: input.status, expiresAt: input.expiresAt ?? null, capabilities };
}
