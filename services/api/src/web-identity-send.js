import { createHash, randomInt, randomUUID } from 'node:crypto';
import { generateABogus } from './douyin-web-sign.js';

const IDENTITY_URL = 'https://www.douyin.com/passport/safe/get_identity_security_token/';
const SEND_URL = 'https://imapi.douyin.com/v1/message/send';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const IDENTITY_CACHE_TTL_MS = 240_000;
const identityCache = new Map();

export class WebIdentitySendError extends Error {
  constructor(message, { stage = 'send', statusCode = null, retrySafe = false } = {}) {
    super(message); this.name = 'WebIdentitySendError'; this.stage = stage; this.statusCode = statusCode; this.retrySafe = retrySafe;
  }
}
const varint = value => { let n = BigInt(value), out = []; if (n < 0n) throw new WebIdentitySendError('协议字段不能为负数', { stage: 'build' }); do { let b = Number(n & 127n); n >>= 7n; if (n) b |= 128; out.push(b); } while (n); return Buffer.from(out); };
const fieldBytes = (n, value) => { const b = Buffer.isBuffer(value) ? value : Buffer.from(value); return Buffer.concat([varint((BigInt(n) << 3n) | 2n), varint(b.length), b]); };
const fieldString = (n, value) => fieldBytes(n, Buffer.from(String(value), 'utf8'));
const fieldVarint = (n, value) => Buffer.concat([varint(BigInt(n) << 3n), varint(value)]);
const fieldExt = (n, key, value) => fieldBytes(n, Buffer.concat([fieldString(1, key), fieldString(2, value)]));
const cookieMap = cookie => Object.fromEntries(String(cookie || '').split(';').map(part => { const i = part.indexOf('='); return i > 0 ? [part.slice(0, i).trim(), part.slice(i + 1).trim()] : ['', '']; }).filter(([k]) => k));

function browserCookies(material) {
  // The launcher uploads the flattened Cookie header as the authoritative
  // session snapshot. Browser state can be older after a relogin; merging it
  // here creates a mixed UID/session/device identity and causes KICK. Only use
  // state cookies for legacy captures that have no flattened header at all.
  const direct = String(material?.cookie || '').trim();
  if (direct) return direct;
  const state = (() => { try { return JSON.parse(material?.browserState || '{}'); } catch { return {}; } })();
  const values = cookieMap('');
  for (const item of Array.isArray(state.cookies) ? state.cookies : []) {
    const domain = String(item?.domain || '').replace(/^\./, '').toLowerCase();
    if (item?.name && item?.value && (!domain || domain === 'douyin.com' || domain.endsWith('.douyin.com'))) values[item.name] = String(item.value);
  }
  return Object.entries(values).map(([k, v]) => `${k}=${v}`).join('; ');
}

function storedIdentityConfig(material) {
  const value = material?.webImIdentity;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export async function fetchWebIdentityToken(material, { fetchImpl = fetch, deviceId = '', cacheKey = '', forceRefresh = false } = {}) {
  const cookie = browserCookies(material); if (!cookie) throw new WebIdentitySendError('Creator 浏览器 Cookie 缺失', { stage: 'identity' });
  const cookies = cookieMap(cookie), uid = String(material?.uid || '').trim(), configured = storedIdentityConfig(material);
  const suppliedToken = String(material?.identitySecurityToken || material?.identity_security_token || configured.identitySecurityToken || configured.identity_security_token || configured.identity_token || '').trim();
  const suppliedDevice = String(material?.identityDeviceId || material?.identity_device_id || configured.identityDeviceId || configured.identity_device_id || deviceId || material?.cardIdentity?.identityDeviceId || configured.device_id || material?.uid || '').trim();
  const suppliedVerifyFp = String(material?.verifyFp || material?.verify_fp || configured.verifyFp || configured.verify_fp || cookies.s_v_web_id || cookies.verifyFp || cookies.verify_fp || cookies.fp || '0').trim() || '0';
  const cookieFingerprint = createHash('sha256').update(cookie).digest('hex').slice(0, 16);
  const key = `${cacheKey || uid || 'unknown'}:${cookieFingerprint}`;
  const cached = identityCache.get(key);
  if (!forceRefresh && cached && Date.now() - cached.createdAt < IDENTITY_CACHE_TTL_MS) return { ...cached.value, cookie };
  if (!forceRefresh && suppliedToken && suppliedDevice) {
    const value = { token: suppliedToken, deviceId: suppliedDevice, cookie, verifyFp: suppliedVerifyFp };
    identityCache.set(key, { value, createdAt: Date.now() });
    return value;
  }
  const trace = randomUUID().replaceAll('-', '').slice(0, 8);
  const params = new URLSearchParams({ passport_jssdk_version: '5.1.4', passport_jssdk_type: 'lite', is_from_ttaccountsdk: '1', aid: '6383', language: 'zh', account_app_language: 'zh-CN', scene: 'im_send_msg', auto_retry_req: '0', skip_verify: 'false', identity_token_force_get_tag: '0', biz_trace_id: trace, id_token_version: '2.1.5' });
  if (cookies.msToken) params.set('msToken', cookies.msToken);
  let csrfToken = '';
  try {
    const preflight = await fetchImpl('https://www.douyin.com/aweme/v1/web/im/spotlight/relation/', { method: 'HEAD', headers: { origin: 'https://www.douyin.com', referer: 'https://www.douyin.com/', 'user-agent': UA, 'x-secsdk-csrf-request': '1', 'x-secsdk-csrf-version': '1.2.22' }, signal: AbortSignal.timeout(10000) });
    const csrf = String(preflight.headers.get('x-ware-csrf-token') || '').split(',').map(x => x.trim())[1];
    if (csrf) csrfToken = csrf;
  } catch { /* best effort */ }
  const query = params.toString();
  try { params.set('a_bogus', generateABogus(query)); } catch { /* optional signer */ }
  const response = await fetchImpl(`${IDENTITY_URL}?${params}`, { headers: { accept: 'application/json, text/plain, */*', cookie, origin: 'https://www.douyin.com', referer: 'https://www.douyin.com/', 'user-agent': UA, 'x-tt-passport-csrf-token': cookies.passport_csrf_token || '', 'x-tt-passport-trace-id': trace, 'x-secsdk-csrf-request': '1', 'x-secsdk-csrf-version': '1.2.22', ...(csrfToken ? { 'x-secsdk-csrf-token': csrfToken } : {}), ...(cookies.bd_ticket_guard_client_data ? { 'bd-ticket-guard-client-data': cookies.bd_ticket_guard_client_data, 'bd-ticket-guard-version': '2', 'bd-ticket-guard-web-sign-type': '1', 'bd-ticket-guard-web-version': '2' } : {}) }, signal: AbortSignal.timeout(15000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new WebIdentitySendError(`Web Identity HTTP ${response.status}`, { stage: 'identity', statusCode: response.status });
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const token = String(payload.identity_security_token || data.identity_security_token || '').trim();
  const resolvedDevice = String(payload.device_id || data.device_id || suppliedDevice || '').trim();
  if (!token || !resolvedDevice) throw new WebIdentitySendError(`Web Identity 响应缺少 token/device_id（${String(payload.error_code || payload.status_code || '')}）`, { stage: 'identity' });
  const value = { token, deviceId: resolvedDevice, cookie, verifyFp: cookies.s_v_web_id || cookies.verifyFp || cookies.verify_fp || cookies.fp || '0' };
  identityCache.set(key, { value, createdAt: Date.now() });
  return value;
}

// conversationType：1 单聊（会话 ID 为 0:1:uid:uid），2 群聊（会话 ID 为纯数字）。
export function buildWebIdentityMessageRequest({ conversationId, senderUid = '', conversationShortId, content, messageType = 7, ticket = '', deviceId, identityToken, verifyFp = '0', clientMessageId = randomUUID(), conversationType = 1 }) {
  const cid = String(conversationId || '').trim(), sender = String(senderUid || '').trim(), short = BigInt(String(conversationShortId || '0')), type = Number(messageType), json = typeof content === 'string' ? content : JSON.stringify(content || {});
  const convType = Number(conversationType);
  if (![1, 2].includes(convType)) throw new WebIdentitySendError('Web IM 会话类型无效', { stage: 'build' });
  if (!cid || short <= 0n || !json.trim() || !deviceId || !identityToken) throw new WebIdentitySendError('Web IM 发送三元组或身份材料不完整', { stage: 'build' });
  if (sender && !/^\d{1,30}$/.test(sender)) throw new WebIdentitySendError('Web Identity 发送方 UID 无效', { stage: 'build' });
  if (convType === 2 && !/^\d{1,30}$/.test(cid)) throw new WebIdentitySendError('Web IM 群聊会话 ID 无效', { stage: 'conversation' });
  if (sender && convType === 1) {
    const participants = cid.match(/^0:1:(\d{1,30}):(\d{1,30})$/);
    // Reuse the platform tuple without reversing it. The protocol checks the
    // participant set, not which position contains the sender.
    if (!participants || participants[1] === participants[2] || !participants.slice(1).includes(sender)) throw new WebIdentitySendError('Web IM 会话 UID 与发送账号不匹配', { stage: 'conversation' });
  }
  const now = Date.now();
  const inner = Buffer.concat([
    fieldString(1, cid), fieldVarint(2, convType), fieldVarint(3, short), fieldString(4, json),
    fieldExt(5, 's:ticket_mode', '0'), fieldExt(5, 'im_client_send_msg_time', String(now - 500)), fieldExt(5, 'old_client_message_id', String(now)),
    fieldExt(5, 'a:plv', '1'), fieldExt(5, 'a:access', 'web_sdk'), fieldExt(5, 's:biz_aid', '6383'), fieldExt(5, 'chat_scene', 'normal'), fieldExt(5, 'a:msg_scene', '1'), fieldExt(5, 'a:relation_type', '0:0'), fieldExt(5, 'a:smp_token_fetch', '11'), fieldExt(5, 'a:ntp_ready', '2'), fieldExt(5, 's:sync_2_newdx', '1'), fieldExt(5, 's:mode', '0'), fieldExt(5, 'a:enter_method', 'click_message'), fieldExt(5, 'a:biz', 'douyin_web'), fieldExt(5, 's:is_stranger', 'false'), fieldExt(5, 'source_aid', '6383'), fieldExt(5, 's:saas_sdk', 'false'), fieldExt(5, 'a:sync2dx', '1'), fieldExt(5, 's:refer', '3'), fieldExt(5, 's:mentioned_users', ''),
    fieldExt(12, 's:reverse_creator_im_ex', '0'), fieldExt(12, 'a:from_role_ids', ''), fieldExt(12, 's:im_creator_chat_opt_exp', '0'), fieldExt(12, 's:send_ignore_ticket', 'true'), fieldExt(12, 's:im_chat_priv_opt_exp', '1'), fieldExt(12, 'a:to_role_ids', '[]'),
    fieldVarint(6, type), fieldString(7, ticket), fieldString(8, clientMessageId)
  ]);
  const outer = Buffer.concat([
    fieldVarint(1, 100), fieldVarint(2, randomInt(100000, 1000000)), fieldString(3, '0.1.8'), fieldString(4, ''), fieldVarint(5, 3), fieldVarint(6, 0), fieldString(7, '0d50935:feat/pc-im-group'), fieldBytes(8, fieldBytes(100, inner)), fieldString(9, deviceId), fieldString(11, 'douyin_pc'),
    ...Object.entries({ session_aid: '6383', session_did: deviceId, app_name: 'douyin_pc', priority_region: 'cn', user_agent: UA, cookie_enabled: 'true', browser_language: 'zh-CN', browser_platform: 'Win32', browser_name: 'Mozilla', browser_version: UA.slice('Mozilla/'.length), browser_online: 'true', screen_width: '1920', screen_height: '1080', referer: 'https://www.douyin.com/', timezone_name: 'Asia/Shanghai', deviceId, webid: deviceId, fp: verifyFp, 'is-retry': '0', identity_security_token: JSON.stringify({ token: identityToken }), identity_security_device_id: deviceId, identity_security_aid: '6383' }).flatMap(([k, v]) => fieldExt(15, k, v)),
    fieldVarint(18, 1), fieldString(21, 'douyin_web'), fieldString(22, 'web_sdk')
  ]);
  return { request: outer, clientMessageId };
}

function readFields(buffer) {
  let offset = 0;
  const read = () => {
    let value = 0n;
    for (let shift = 0n; shift < 70n && offset < buffer.length; shift += 7n) {
      const byte = buffer[offset++]; value |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) return value;
    }
    throw new Error('Web IM 回执 varint 不完整');
  };
  const out = [];
  while (offset < buffer.length) {
    const key = read(), n = Number(key >> 3n), w = Number(key & 7n);
    if (!n) throw new Error('Web IM 回执字段无效');
    let v;
    if (w === 0) v = read();
    else {
      const size = w === 2 ? Number(read()) : w === 1 ? 8 : w === 5 ? 4 : -1;
      if (size < 0 || !Number.isSafeInteger(size) || size > buffer.length - offset) throw new Error('Web IM 回执长度无效');
      v = buffer.subarray(offset, offset + size); offset += size;
    }
    out.push({ n, w, v });
  }
  return out;
}

const responseIdKeys = new Set(['servermsgid', 'servermessageid', 'messageid', 'msgid', 'serverid']);
const responseClientIdKeys = new Set(['clientmsgid', 'clientmessageid', 'oldclientmessageid']);
const responseStatusKeys = new Set(['statuscode', 'code', 'checkcode']);
const responseErrorKeys = new Set(['errordesc', 'message', 'msg', 'statusmessage', 'errormessage', 'errormsg', 'statusmsg', 'checkmessage', 'tips']);
const responseLogKeys = new Set(['logid', 'log_id', 'x-tt-logid']);
const numericMessageId = value => {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return '';
  const text = String(value ?? '').trim();
  return /^\d{1,30}$/.test(text) && BigInt(text) > 0n ? text : '';
};

function scanEmbeddedJson(blob, visit) {
  const text = Buffer.from(blob).toString('utf8');
  const markers = ['{"status', '{"server', '{"message', '{"msg', '{"client', '{"data', '{"code', '{"decision'];
  const seen = new Set();
  for (const marker of markers) {
    let from = 0;
    while (from < text.length) {
      const start = text.indexOf(marker, from);
      if (start < 0 || seen.has(start)) break;
      seen.add(start);
      let depth = 0, inString = false, escaped = false, end = -1;
      for (let index = start; index < Math.min(text.length, start + 65536); index += 1) {
        const char = text[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') inString = false;
          continue;
        }
        if (char === '"') { inString = true; continue; }
        if (char === '{') depth += 1;
        else if (char === '}' && --depth === 0) { end = index + 1; break; }
      }
      if (end > start) {
        try { visit(JSON.parse(text.slice(start, end))); } catch { /* embedded text is optional */ }
      }
      from = start + marker.length;
    }
  }
}

export function parseWebIdentityResponse(raw, clientMessageId) {
  let status = null, protoStatus = null, error = '', decision = '', clientId = '', serverId = '', logId = '';
  const setStatus = value => { if (status === null || status === 0) status = Number(value); };
  // protobuf 协议层状态码优先于 JSON 里附带的 status_code（如 10502 的风控提示）
  const setProtoStatus = value => { if (protoStatus === null || protoStatus === 0) protoStatus = Number(value); setStatus(value); };
  const walkJson = value => {
    if (Array.isArray(value)) return value.forEach(walkJson);
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      const lower = key.toLowerCase();
      const normalized = lower.replaceAll('_', '').replaceAll('-', '');
      if (responseStatusKeys.has(normalized) && typeof item === 'number') setStatus(item);
      if (responseErrorKeys.has(normalized) && item && !error) error = (typeof item === 'object' ? JSON.stringify(item) : String(item)).slice(0, 240);
      if (normalized === 'decision' && item && !decision) decision = String(item).slice(0, 80);
      if (responseIdKeys.has(normalized) && item) serverId ||= numericMessageId(item);
      if (responseClientIdKeys.has(normalized) && item) {
        const value = String(item);
        if (!clientId || value !== String(clientMessageId)) clientId = value;
      }
      if (responseLogKeys.has(lower) && item && !logId) logId = String(item).slice(0, 160);
      walkJson(item);
    }
  };
  const walk = (blob, depth = 0) => {
    if (!blob?.length || depth > 10) return;
    const textValue = blob.toString('utf8');
    if (/^[\s]*[\[{]/.test(textValue)) { try { walkJson(JSON.parse(textValue)); } catch {} }
    scanEmbeddedJson(blob, walkJson);
    let items; try { items = readFields(blob); } catch { return; }
    if (depth === 0) {
      const topStatus = items.find(item => item.n === 3 && item.w === 0);
      if (topStatus) setProtoStatus(topStatus.v);
      const topLog = items.find(item => item.n === 7 && item.w === 2);
      if (topLog) logId = topLog.v.toString('utf8').slice(0, 160);
    }
    const matched = items.some(item => item.w === 2 && item.v.toString('utf8') === clientMessageId);
    if (matched) {
      for (const item of items) {
        if (item.n === 1 && item.w === 0) serverId ||= numericMessageId(item.v);
        else if (item.n === 1 && item.w === 2) serverId ||= numericMessageId(item.v.toString('utf8'));
        else if ((item.n === 3 || item.n === 5) && item.w === 0) setProtoStatus(item.v);
        else if (item.n === 6 && item.w === 2 && !error) error = item.v.toString('utf8').slice(0, 240);
      }
      clientId ||= clientMessageId;
    }
    for (const item of items) if (item.w === 2) walk(item.v, depth + 1);
  };
  const buffer = Buffer.from(raw);
  if (buffer.length <= 4 * 1024 * 1024) walk(buffer);
  // 协议层为 0 且回执带服务端消息 ID：JSON 内的非 0 码只是附带提示，不是拒绝。
  let advisoryStatus = null;
  if (serverId && protoStatus === 0 && status !== 0 && !decision) { advisoryStatus = status; status = 0; }
  return advisoryStatus === null ? { status, error, decision, clientId, serverId, logId } : { status, error, decision, clientId, serverId, logId, advisoryStatus };
}

export async function sendWebIdentityMessage({ material, conversationId, senderUid = '', conversationShortId, ticket, content, messageType = 7, timeoutMs = 30000, fetchImpl = fetch, cacheKey = '', forceIdentityRefresh = false, conversationType = 1 }) {
  const sender = String(senderUid || material?.uid || '').trim();
  if (!/^\d{1,30}$/.test(sender) || String(material?.uid || '').trim() !== sender) throw new WebIdentitySendError('Web IM 身份材料与发送账号 UID 不匹配', { stage: 'build' });
  const identity = await fetchWebIdentityToken(material, { fetchImpl, cacheKey, forceRefresh: forceIdentityRefresh });
  const built = buildWebIdentityMessageRequest({ conversationId, senderUid: sender, conversationShortId, ticket, content, messageType, conversationType, deviceId: identity.deviceId, identityToken: identity.token, verifyFp: identity.verifyFp });
  const response = await fetchImpl(SEND_URL, { method: 'POST', headers: { accept: 'application/x-protobuf', 'content-type': 'application/x-protobuf', cookie: identity.cookie, origin: 'https://www.douyin.com', referer: 'https://www.douyin.com/', 'user-agent': UA }, body: built.request, signal: AbortSignal.timeout(timeoutMs) });
  const raw = Buffer.from(await response.arrayBuffer()); if (Number(response.status) !== 200) throw new WebIdentitySendError(`Web IM HTTP ${response.status}`, { stage: 'http', statusCode: response.status });
  const parsed = parseWebIdentityResponse(raw, built.clientMessageId);
  if ((parsed.status !== null && Number(parsed.status) !== 0) || (parsed.decision && !/^(?:ok|success|accepted?)$/i.test(parsed.decision))) {
    // 诊断：记录上游拒绝时的原始回执（仅响应体，不含 Cookie/令牌），便于定位 10502 等错误码的真实原因。
    console.warn('[web-identity-reject]', JSON.stringify({ messageType, status: parsed.status, decision: parsed.decision, logId: parsed.logId, bytes: raw.length, text: raw.toString('utf8').replace(/[^\x20-\x7e\u4e00-\u9fa5]/g, '.').slice(0, 1500), base64: raw.toString('base64').slice(0, 3000) }));
  }
  if (parsed.decision && !/^(?:ok|success|accepted?)$/i.test(parsed.decision)) {
    throw new WebIdentitySendError(`Web IM 上游拒绝（${parsed.decision}）${parsed.error ? `：${parsed.error}` : ''}`, { stage: 'business' });
  }
  if (parsed.status !== null && Number(parsed.status) !== 0) throw new WebIdentitySendError(`Web IM 上游拒绝（${parsed.status}）${parsed.error ? `：${parsed.error}` : ''}`, { stage: 'business', statusCode: Number(parsed.status) });
  if (parsed.clientId && parsed.clientId !== built.clientMessageId) {
    const error = new WebIdentitySendError('Web IM 回执 client_message_id 不匹配，发送结果待确认', { stage: 'confirm' });
    error.deliveryUncertain = true;
    throw error;
  }
  if (!parsed.serverId) {
    const details = [parsed.status === null ? '' : `status_code=${parsed.status}`, parsed.error ? `message=${parsed.error}` : '', parsed.logId ? `log_id=${parsed.logId}` : ''].filter(Boolean).join(', ');
    const err = new WebIdentitySendError(`Web IM 回执缺少 server_message_id${details ? `（${details}）` : ''}`, { stage: 'confirm' });
    err.deliveryUncertain = true; err.responseStatus = parsed.status; err.responseLogId = parsed.logId;
    throw err;
  }
  return { serverMessageId: parsed.serverId, clientMessageId: built.clientMessageId, statusCode: 0 };
}

export function sendWebIdentityMedia({ material, conversationId, senderUid = '', conversationShortId, ticket, content, messageType, fetchImpl = fetch, cacheKey = '', forceIdentityRefresh = false, conversationType = 1 }) {
  return sendWebIdentityMessage({ material, conversationId, senderUid, conversationShortId, ticket, fetchImpl, cacheKey, forceIdentityRefresh, conversationType, messageType, content });
}
