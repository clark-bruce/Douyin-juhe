import { createHash } from 'node:crypto';
import { traceSync } from './stall-trace.js';
const INIT_TEMPLATE = 'CPsPEJJOGgUwLjEuOCIAKAMwAToYMGQ1MDkzNTpmZWF0L3BjLWltLWdyb3VwQg7afwsImozqlKnKlQMQAUoBMFoJZG91eWluX3BjcgYzNjAwMDB6EwoLc2Vzc2lvbl9haWQSBDYzODN6EAoLc2Vzc2lvbl9kaWQSATB6FQoIYXBwX25hbWUSCWRvdXlpbl9wY3oVCg9wcmlvcml0eV9yZWdpb24SAmNuen0KCnVzZXJfYWdlbnQSb01vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS8xNDQuMC4wLjAgU2FmYXJpLzUzNy4zNnoWCg5jb29raWVfZW5hYmxlZBIEdHJ1ZXoZChBicm93c2VyX2xhbmd1YWdlEgV6aC1DTnoZChBicm93c2VyX3BsYXRmb3JtEgVXaW4zMnoXCgxicm93c2VyX25hbWUSB01vemlsbGF6egoPYnJvd3Nlcl92ZXJzaW9uEmc1LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzE0NC4wLjAuMCBTYWZhcmkvNTM3LjM2ehYKDmJyb3dzZXJfb25saW5lEgR0cnVlehQKDHNjcmVlbl93aWR0aBIEMTI4MHoUCg1zY3JlZW5faGVpZ2h0EgM3MjB6IgoHcmVmZXJlchIXaHR0cHM6Ly93d3cuZG91eWluLmNvbS96HgoNdGltZXpvbmVfbmFtZRINQXNpYS9TaGFuZ2hhaXoNCghkZXZpY2VJZBIBMHoNCghpcy1yZXRyeRIBMJABAaoBCmRvdXlpbl93ZWKyAQd3ZWJfc2Rr';
const HISTORY_TEMPLATE = 'CK0CEKBOGgUwLjEuOCIAKAMwADoYMGQ1MDkzNTpmZWF0L3BjLWltLWdyb3VwQj7qEjsKIDA6MTo5ODM0ODUxMDIxMToyMDI0NjY0ODE3NzQwNDI2EAEYsYSArvWSuKhqIAEo4JTE+5yk/AIwMkoBMFoJZG91eWluX3BjcgYzNjAwMDB6EwoLc2Vzc2lvbl9haWQSBDYzODN6EAoLc2Vzc2lvbl9kaWQSATB6FQoIYXBwX25hbWUSCWRvdXlpbl9wY3oVCg9wcmlvcml0eV9yZWdpb24SAmNuen0KCnVzZXJfYWdlbnQSb01vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS8xNDQuMC4wLjAgU2FmYXJpLzUzNy4zNnoWCg5jb29raWVfZW5hYmxlZBIEdHJ1ZXoZChBicm93c2VyX2xhbmd1YWdlEgV6aC1DTnoZChBicm93c2VyX3BsYXRmb3JtEgVXaW4zMnoXCgxicm93c2VyX25hbWUSB01vemlsbGF6egoPYnJvd3Nlcl92ZXJzaW9uEmc1LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzE0NC4wLjAuMCBTYWZhcmkvNTM3LjM2ehYKDmJyb3dzZXJfb25saW5lEgR0cnVlehQKDHNjcmVlbl93aWR0aBIEMTI4MHoUCg1zY3JlZW5faGVpZ2h0EgM3MjB6IgoHcmVmZXJlchIXaHR0cHM6Ly93d3cuZG91eWluLmNvbS96HgoNdGltZXpvbmVfbmFtZRINQXNpYS9TaGFuZ2hhaXoNCghkZXZpY2VJZBIBMHoNCghpcy1yZXRyeRIBMJABAaoBCmRvdXlpbl93ZWKyAQd3ZWJfc2Rr';
const MAX_RESPONSE = 16 * 1024 * 1024;

export class DouyinWebSyncError extends Error {}

export class CreatorIdentityResolutionError extends DouyinWebSyncError {
  constructor(message, { status = 0, code = 'creator_identity_resolution_failed' } = {}) {
    super(message);
    this.name = 'CreatorIdentityResolutionError';
    this.status = Number(status) || 0;
    this.code = code;
  }
}

// strict=false 用于“探测”任意字节是否是 protobuf：失败返回 null 而不是抛异常。
// 异常对象要抓调用栈，探测路径上每轮同步会失败成千上万次，曾占掉数秒 CPU 并堵住主线程。
function readVarint(buffer, start, strict = true) {
  let value = 0n, shift = 0n, offset = start;
  while (offset < buffer.length && shift < 70n) {
    const byte = buffer[offset++]; value |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [value, offset];
    shift += 7n;
  }
  if (!strict) return null;
  throw new DouyinWebSyncError('Protobuf varint truncated');
}
function varint(value) {
  let input = BigInt(value), bytes = [];
  do { let byte = Number(input & 0x7fn); input >>= 7n; if (input) byte |= 0x80; bytes.push(byte); } while (input);
  return Buffer.from(bytes);
}
function parseFields(buffer, strict = true) {
  const result = [];
  const bad = message => { if (strict) throw new DouyinWebSyncError(message); return null; };
  for (let offset = 0; offset < buffer.length;) {
    const keyRead = readVarint(buffer, offset, strict);
    if (!keyRead) return null;
    const [key, next] = keyRead; offset = next;
    const number = Number(key >> 3n), wire = Number(key & 7n);
    if (!number) return bad('Invalid protobuf field');
    let value;
    if (wire === 0) { const read = readVarint(buffer, offset, strict); if (!read) return null; [value, offset] = read; }
    else if (wire === 1) { if (offset + 8 > buffer.length) return bad('Truncated fixed64'); value = buffer.subarray(offset, offset + 8); offset += 8; }
    else if (wire === 2) {
      const read = readVarint(buffer, offset, strict); if (!read) return null;
      const [size, begin] = read; offset = begin; const end = offset + Number(size);
      if (end > buffer.length) return bad('Truncated bytes');
      value = buffer.subarray(offset, end); offset = end;
    }
    else if (wire === 5) { if (offset + 4 > buffer.length) return bad('Truncated fixed32'); value = buffer.subarray(offset, offset + 4); offset += 4; }
    else return bad(`Unsupported wire type ${wire}`);
    result.push({ number, wire, value });
  }
  return result;
}
function encodeField(field) {
  const head = varint((BigInt(field.number) << 3n) | BigInt(field.wire));
  if (field.wire === 0) return Buffer.concat([head, varint(field.value)]);
  if (field.wire === 2) return Buffer.concat([head, varint(field.value.length), field.value]);
  return Buffer.concat([head, field.value]);
}
const encodeFields = entries => Buffer.concat(entries.map(encodeField));
const values = (entries, number, wire) => entries.filter(item => item.number === number && (wire === undefined || item.wire === wire)).map(item => item.value);
const first = (entries, number, wire, fallback = undefined) => values(entries, number, wire)[0] ?? fallback;
const stringValue = value => Buffer.isBuffer(value) ? value.toString('utf8') : value === undefined ? '' : String(value);
function replace(entries, number, wire, value) {
  const next = entries.filter(item => item.number !== number);
  if (value !== undefined && value !== null) next.push({ number, wire, value });
  next.sort((a, b) => a.number - b.number);
  return next;
}
function patchTemplate(encoded, commandId, mutate) {
  let outer = parseFields(Buffer.from(encoded, 'base64'));
  let body = parseFields(first(outer, 8, 2));
  let command = parseFields(first(body, commandId, 2));
  command = mutate(command);
  body = replace(body, commandId, 2, encodeFields(command));
  outer = replace(outer, 2, 0, BigInt(Date.now() % 2_000_000_000));
  outer = replace(outer, 8, 2, encodeFields(body));
  return encodeFields(outer);
}

export function buildInitialSyncRequest(cursor = null) {
  return patchTemplate(INIT_TEMPLATE, 2043, command => {
    const cursorWire = cursor && typeof cursor === 'object' ? Number(cursor.wire) : 2;
    const cursorValue = cursor && typeof cursor === 'object' ? cursor.value : cursor;
    if (cursor !== null && cursorWire !== 0 && cursorWire !== 2) throw new DouyinWebSyncError(`Unsupported cursor wire type ${cursorWire}`);
    command = replace(command, 1, cursorWire, cursor === null ? undefined : cursorWire === 0 ? BigInt(cursorValue) : Buffer.from(String(cursorValue)));
    return replace(command, 2, 0, cursor === null ? 0n : 1n);
  });
}
export function buildHistoryRequest({ conversationId, conversationType, shortId, cursor, limit = 50 }) {
  return patchTemplate(HISTORY_TEMPLATE, 301, command => {
    command = replace(command, 1, 2, Buffer.from(conversationId));
    command = replace(command, 2, 0, BigInt(conversationType));
    command = replace(command, 3, 0, BigInt(shortId));
    command = replace(command, 4, 0, 1n);
    command = replace(command, 5, 0, BigInt(cursor));
    return replace(command, 6, 0, BigInt(limit));
  });
}

function normalizeAvatarUrl(value) {
  const text = String(value || '').trim();
  if (!/^https?:\/\//i.test(text)) return '';
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase();
    // qlogo.cn hosts WeChat avatars, which Douyin reuses for WeChat-login users.
    if (!['douyinpic.com', 'byteimg.com', 'douyincdn.com', 'qlogo.cn'].some(domain => host === domain || host.endsWith(`.${domain}`))) return '';
    const expires = Number(parsed.searchParams.get('x-expires') || 0);
    if (expires && expires <= Math.floor(Date.now() / 1000) + 60 && host.endsWith('douyinpic.com') && parsed.pathname.includes('/aweme-avatar/')) {
      const resource = parsed.pathname.split('/aweme-avatar/', 2)[1].split('~', 1)[0].replace(/^\/+|\/+$/g, '');
      if (resource) return `https://p3-pc.douyinpic.com/img/aweme-avatar/${resource}~c5_168x168.jpeg?from=2956013662`;
      return '';
    }
    return parsed.href;
  } catch { return ''; }
}
function firstAvatarUrl(value, depth = 0) {
  if (depth > 7 || value === null || value === undefined) return '';
  if (Buffer.isBuffer(value)) {
    const text = value.toString('utf8').trim();
    const direct = normalizeAvatarUrl(text);
    if (direct) return direct;
    if (text.startsWith('{') || text.startsWith('[')) {
      try { const nested = firstAvatarUrl(JSON.parse(text), depth + 1); if (nested) return nested; } catch { /* protobuf bytes */ }
    }
    // 递归探测任意字节是否是嵌套 protobuf：非严格模式失败时返回 null，不创建异常对象。
    const nestedFields = parseFields(value, false);
    if (nestedFields) for (const item of nestedFields) if (item.wire === 2) {
      const nested = firstAvatarUrl(item.value, depth + 1);
      if (nested) return nested;
    }
    return '';
  }
  if (typeof value === 'string') {
    const direct = normalizeAvatarUrl(value);
    if (direct) return direct;
    if (value.trim().startsWith('{') || value.trim().startsWith('[')) {
      try { return firstAvatarUrl(JSON.parse(value), depth + 1); } catch { return ''; }
    }
    return '';
  }
  if (Array.isArray(value)) {
    for (const item of value) { const url = firstAvatarUrl(item, depth + 1); if (url) return url; }
    return '';
  }
  if (typeof value === 'object') {
    for (const key of ['url_list', 'origin_url_list', 'download_url_list', 'url', 'uri']) {
      const url = firstAvatarUrl(value[key], depth + 1);
      if (url) return url;
    }
    for (const nested of Object.values(value)) { const url = firstAvatarUrl(nested, depth + 1); if (url) return url; }
  }
  return '';
}

function stringExtensions(entries) {
  const result = {};
  for (const raw of entries || []) {
    try {
      const fields = parseFields(raw, false);
      if (!fields) continue;
      const key = stringValue(first(fields, 1, 2)).trim();
      const value = stringValue(first(fields, 2, 2)).trim();
      if (key && value) result[key] = value;
    } catch { /* optional metadata can use another protobuf layout */ }
  }
  return result;
}

function parseCore(raw) {
  if (!raw) return {};
  const data = parseFields(raw);
  let avatar = firstAvatarUrl(first(data, 7, 2));
  const extensions = stringExtensions([...values(data, 9, 2), ...values(data, 11, 2)]);
  if (!avatar) {
    for (const key of ['a:ab_avatar', 'avatar', 'conversation_icon', 'avatar_url']) {
      if (extensions[key]) { avatar = firstAvatarUrl(extensions[key]); if (avatar) break; }
    }
  }
  const name = stringValue(first(data, 5, 2)).trim()
    || extensions.name || extensions.conversation_name || extensions['a:s_name']
    || extensions.nick_name || extensions.nickname || extensions.display_name || '';
  return { name: name.slice(0, 100), avatar };
}
function parseMembers(raw) {
  if (!raw) return [];
  return values(parseFields(raw), 1, 2).map(item => {
    const data = parseFields(item);
    const avatar = firstAvatarUrl([
      ...values(data, 7, 2), ...values(data, 8, 2), ...values(data, 9, 2), ...values(data, 10, 2)
    ]);
    const name = stringValue(first(data, 2, 2)).trim()
      || stringValue(first(data, 3, 2)).trim()
      || stringValue(first(data, 4, 2)).trim();
    return { uid: String(first(data, 1, 0, 0n)), secUid: stringValue(first(data, 5, 2)), name: name.slice(0, 100), avatar };
  });
}

function collectNestedMembers(raw, depth = 0, output = []) {
  if (!raw || depth > 7) return output;
  const fields = parseFields(raw, false);
  if (!fields) return output;
  const uidValue = first(fields, 1, 0);
  const uid = uidValue === undefined ? '' : String(uidValue);
  const name = [2, 3, 4].map(number => stringValue(first(fields, number, 2)).trim()).find(Boolean) || '';
  const secUid = stringValue(first(fields, 5, 2)).trim();
  const avatar = firstAvatarUrl([...
    values(fields, 7, 2), ...values(fields, 8, 2), ...values(fields, 9, 2), ...values(fields, 10, 2)
  ]);
  // User IDs are positive decimal values. Requiring at least one identity
  // attribute prevents ordinary protobuf field-1 counters from becoming users.
  if (/^\d{4,30}$/.test(uid) && (name || secUid || avatar)) output.push({ uid, name: name.slice(0, 100), secUid, avatar });
  for (const item of fields) if (item.wire === 2) collectNestedMembers(item.value, depth + 1, output);
  return output;
}

// Diagnostic only: describes protobuf layout (field number, wire type, byte
// length) without exposing any value. Used to see whether private conversation
// payloads carry a peer name/avatar that the parser does not read yet.
function protoShape(raw, depth = 0) {
  const fields = parseFields(raw, false);
  if (!fields) return null;
  return fields.slice(0, 40).map(item => {
    const base = `${item.number}:${item.wire}`;
    if (item.wire !== 2) return base;
    const nested = depth < 3 && item.value.length > 1 ? protoShape(item.value, depth + 1) : null;
    return nested?.length ? { [`${base}:${item.value.length}`]: nested } : `${base}:${item.value.length}`;
  });
}

// Diagnostic only: extension key names plus value length/kind. Values are never
// returned, so no user content leaves the parser.
function extensionLayout(raw) {
  if (!raw) return [];
  let core;
  try { core = parseFields(raw); } catch { return []; }
  const layout = [];
  const visit = (entries, tag) => {
    for (const entry of entries) {
      try {
        const fields = parseFields(entry);
        const key = stringValue(first(fields, 1, 2)).trim();
        const value = first(fields, 2, 2);
        const text = Buffer.isBuffer(value) ? value.toString('utf8').trim() : '';
        const kind = !text ? 'empty' : /^https?:\/\//i.test(text) ? 'url' : /^[{[]/.test(text) ? 'json' : /^\d+$/.test(text) ? 'digits' : 'text';
        layout.push(`${tag}|${/^[\w:.\-]{1,64}$/.test(key) ? key : '?'}|${kind}|${text.length}`);
      } catch { layout.push(`${tag}|?|bad|0`); }
    }
  };
  visit(values(core, 11, 2), 'c11');
  visit(values(core, 9, 2), 'c9');
  return layout.slice(0, 40);
}

function parseConversation(raw, accountUid) {
  const data = parseFields(raw), protocolId = stringValue(first(data, 1, 2));
  if (!protocolId) throw new DouyinWebSyncError('Conversation ID missing');
  const protocolType = Number(first(data, 3, 0, 0n));
  const members = [...parseMembers(first(data, 6, 2)), ...collectNestedMembers(raw)]
    .filter((item, index, all) => item.uid && all.findIndex(candidate => candidate.uid === item.uid) === index);
  const other = members.find(item => item.uid && item.uid !== accountUid) || members.find(item => item.secUid) || {};
  const type = protocolType === 2 ? 'group' : 'private';
  // Creator Web sending addresses a private peer by sec_uid. Keep the
  // numeric UID in peer metadata/message identities, but expose sec_uid as
  // the conversation target so an existing synced row can send directly.
  const peerId = type === 'group' ? protocolId : (other.secUid || other.uid || protocolId.split(':').findLast(value => value && value !== accountUid) || protocolId);
  const core = parseCore(first(data, 50, 2));
  const badgeCount = Number(first(data, 10, 0, 0n));
  const placeholder = type === 'private' && !core.name && !other.name && !core.avatar && !other.avatar;
  return {
    shapeDiagnostic: placeholder ? { shape: protoShape(raw), ext: extensionLayout(first(data, 50, 2)) } : undefined,
    protocolId, protocolType: protocolType || (type === 'group' ? 2 : 1), type,
    peerId: String(peerId).slice(0, 200), peerSecUid: type === 'private' ? String(other.secUid || '').slice(0, 256) : '',
    title: String(core.name || other.name || (type === 'group' ? `群聊 ${String(peerId).slice(-8)}` : `用户 ${String(peerId).slice(-8)}`)).slice(0, 100),
    peerUid: String(other.uid || '').slice(0, 64), peerName: String(other.name || '').slice(0, 100), avatar: core.avatar || other.avatar || '',
    shortId: String(first(data, 2, 0, 0n)), ticket: stringValue(first(data, 4, 2)).slice(0, 2000),
    unread: Number.isSafeInteger(badgeCount) ? Math.max(0, Math.min(badgeCount, 2147483647)) : 0
  };
}
function visibleNestedText(value, depth = 0) {
  if (depth > 7 || value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text || ['ok', 'success', 'system', 'notice', 'notification'].includes(text.toLowerCase()) || /^-?\d+$/.test(text)) return '';
    if (text.startsWith('{') || text.startsWith('[')) {
      try { const nested = visibleNestedText(JSON.parse(text), depth + 1); if (nested) return nested; } catch { return ''; }
    }
    if (/^https?:\/\//i.test(text) || text.length > 5000) return '';
    return text;
  }
  if (Array.isArray(value)) {
    for (const item of value) { const text = visibleNestedText(item, depth + 1); if (text) return text; }
    return '';
  }
  if (typeof value === 'object') {
    const preferred = ['status_tips', 'tips', 'prompt', 'toast', 'text', 'hint_text', 'msgHint', 'hint', 'desc', 'description', 'receiver_description', 'push_detail', 'receiver_push_detail', 'content_title', 'content', 'message', 'title', 'display_name'];
    for (const key of preferred) if (key in value) { const text = visibleNestedText(value[key], depth + 1); if (text) return text; }
    for (const nested of Object.values(value)) { const text = visibleNestedText(nested, depth + 1); if (text) return text; }
  }
  return '';
}
function messageUsers(data) {
  if (!data || typeof data !== 'object') return [];
  const users = [];
  const visit = (value, depth = 0) => {
    if (depth > 6 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    const uid = String(value.uid || value.user_id || value.userId || '').trim();
    const secUid = String(value.sec_uid || value.sec_user_id || value.secUid || '').trim();
    const name = String(value.nickname || value.nick_name || value.display_name || '').trim();
    const avatar = firstAvatarUrl(value.avatar_168x168 || value.avatar_thumb || value.avatar_medium || value.avatar_larger || value.avatar_url || value.avatar);
    if (uid || secUid || name || avatar) users.push({ uid, secUid, name: name.slice(0, 100), avatar });
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(data);
  return users;
}
function localizedMessageText(data) {
  const resources = Array.isArray(data?.locale_resources) ? data.locale_resources : [];
  const resource = resources.find(item => /^zh(?:-|$)/i.test(String(item?.lang || ''))) || resources[0];
  let output = String(resource?.text || '').trim();
  if (!output) return '';
  const names = [...(Array.isArray(data.active_users) ? data.active_users : []), ...(Array.isArray(data.passive_users) ? data.passive_users : [])]
    .map(item => String(item?.nickname || item?.nick_name || item?.display_name || '').trim()).filter(Boolean);
  output = output.replace(/\{(\d+)\}/g, (match, index) => names[Number(index)] || match);
  return output.includes('{') ? '' : output;
}

function firstReadableValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function liveShareMessageText(data) {
  if (!data || typeof data !== 'object') return '';
  const source = data.live || data.live_room || data.room || data.room_info || data.live_info || data;
  if (!source || typeof source !== 'object') return '';
  const owner = firstReadableValue(source, ['room_owner_name', 'anchor_name', 'owner_name', 'author_name', 'user_name', 'nickname', 'nick_name']);
  const title = firstReadableValue(source, ['room_title', 'live_title', 'title', 'room_name', 'content_title']);
  const description = firstReadableValue(source, ['push_detail', 'room_description', 'description', 'desc', 'content']);
  const liveUrl = firstReadableValue(source, ['room_url', 'live_url', 'share_url', 'web_url', 'url']);
  const cover = firstReadableValue(source, ['cover_url', 'cover', 'cover_image', 'room_cover']);
  const headline = [owner, title || description].filter(Boolean).join('：');
  if (!headline && !liveUrl && !cover) return '';
  const suffix = liveUrl ? `（${liveUrl}）` : '';
  return `[直播分享] ${headline || '直播间'}${suffix}`.slice(0, 5000);
}

// 纯函数：结果只取决于 (content, type)。每 3 秒的同步和每次会话列表重建都会对
// 同一批未变化的消息重复做 JSON 解析 + 序列化 + 正则，CPU 剖析里它是自身耗时最大的函数。
// 用有上限的 Map 做 LRU 缓存；超长内容不缓存，避免占用过多内存。
const FORMAT_CACHE_LIMIT = 8000, FORMAT_CACHE_MAX_KEY = 4000;
const formatCache = new Map();
export function formatDouyinMessageContent(content, type = 0) {
  const raw = typeof content === 'string' ? content : String(content || '');
  if (raw.length > FORMAT_CACHE_MAX_KEY) return formatDouyinMessageContentUncached(content, type);
  const key = `${Number(type)}\u0000${raw}`;
  if (formatCache.has(key)) { const hit = formatCache.get(key); formatCache.delete(key); formatCache.set(key, hit); return hit; }
  const value = formatDouyinMessageContentUncached(content, type);
  formatCache.set(key, value);
  if (formatCache.size > FORMAT_CACHE_LIMIT) formatCache.delete(formatCache.keys().next().value);
  return value;
}
function formatDouyinMessageContentUncached(content, type = 0) {
  if (Number(type) === 50001) return null;
  const raw = String(content || '').trim();
  if (/recall\s+content\s+hided/i.test(raw)) return '[消息已撤回]';
  if (!raw) return ({ 5: '[表情]', 8: '[分享视频]', 17: '[语音]', 21: '[互动消息]', 27: '[图片]', 60: '[分享卡片]' })[type] || null;
  let data;
  try { data = JSON.parse(raw); }
  catch {
    // Values normalized by an earlier server build are already display text;
    // do not reinterpret bracketed placeholders as opaque system JSON.
    if (/^\[(?:图片|表情|分享视频|分享卡片|视频|语音|互动消息|会话提示|会话动态|会话状态更新|消息已撤回|加密消息)\](?:\s|$)/.test(raw)) return raw;
    // Creator type 92 is an encrypted protobuf payload transported as
    // base64. Never expose the ciphertext as if it were user text.
    if (Number(type) === 92 && /^[A-Za-z0-9+/=_-]{40,}$/.test(raw)) return '[加密消息]';
    return raw.startsWith('{') || raw.startsWith('[') ? `[系统消息 · 类型 ${Number(type) || 0}]` : raw.slice(0, 5000);
  }
  if (!data || typeof data !== 'object') return String(data ?? '').slice(0, 5000) || '[消息]';
  if (/recall\s+content\s+hided/i.test(JSON.stringify(data))) return '[消息已撤回]';
  if (!Array.isArray(data) && Object.keys(data).length === 0) return ({ 5: '[表情]', 8: '[分享视频]', 17: '[语音]', 21: '[互动消息]', 27: '[图片]', 60: '[分享卡片]' })[Number(type)] || null;
  const liveSignal = Number(type) === 21 || Boolean(data.live || data.live_room || data.room || data.room_info || data.live_info
    || ['room_owner_name', 'anchor_name', 'room_title', 'live_title', 'room_url', 'live_url'].some(key => key in data));
  if (liveSignal) {
    const liveText = liveShareMessageText(data);
    if (liveText) return liveText;
  }
  if (Number(type) === 7) return String(data.text || visibleNestedText(data) || '[文本消息]').slice(0, 5000);
  if (Number(type) === 5 || Array.isArray(data.stickers)) return data.display_name ? `[表情] ${String(data.display_name).slice(0, 100)}` : '[表情]';
  if (Number(type) === 17) return '[语音]';
  if (Number(type) === 27 || (data.resource_url && !data.itemId && !data.item_id)) return '[图片]';
  const video = data.video || data.video_info || data.aweme?.video || data.item?.video || data.item?.video_info;
  if (video && typeof video === 'object') {
    const title = String(data.content_title || data.desc || data.title || data.item?.desc || video.desc || '').trim();
    return title ? `[视频] ${title.slice(0, 500)}` : '[视频]';
  }
  if (Number(type) === 8 || data.itemId || data.item_id || data.aweme_id) {
    const title = String(data.content_title || '').trim();
    return title ? `[分享视频] ${title.slice(0, 500)}` : '[分享视频]';
  }
  if (Number(type) === 60 || data.card_key || data.im_dynamic_patch || data.is_card) {
    const title = visibleNestedText({ title: data.title, push_detail: data.push_detail, description: data.description, receiver_description: data.receiver_description });
    return title ? `[分享卡片] ${title.slice(0, 1000)}` : '[分享卡片]';
  }
  if (Number(type) === 21) return liveShareMessageText(data) || '[互动消息]';
  const localized = localizedMessageText(data);
  if (localized) return localized.slice(0, 5000);
  // System event payloads are only useful when they contain localized or
  // readable text. Empty/opaque events are transport updates, not messages.
  if ([1, 30, 40001, 1001].includes(Number(type))) return null;
  const text = visibleNestedText(data);
  return text ? text.slice(0, 5000) : `[系统消息 · 类型 ${Number(type) || 0}]`;
}

function renderableMediaUrl(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return '';
  if (typeof value === 'string') {
    if (!/^https:\/\//i.test(value)) return '';
    try {
      const url = new URL(value), host = url.hostname.toLowerCase();
      return ['douyinpic.com', 'byteimg.com', 'douyincdn.com', 'bytedance.com'].some(domain => host === domain || host.endsWith(`.${domain}`)) ? url.href : '';
    } catch { return ''; }
  }
  if (Array.isArray(value)) {
    for (const item of value) { const found = renderableMediaUrl(item, depth + 1); if (found) return found; }
    return '';
  }
  if (typeof value === 'object') {
    for (const key of ['url_list', 'origin_url_list', 'large_url_list', 'medium_url_list', 'thumb_url_list', 'still_url_list', 'download_url_list', 'url', 'uri', 'resource_url']) {
      const found = renderableMediaUrl(value[key], depth + 1); if (found) return found;
    }
    for (const nested of Object.values(value)) { const found = renderableMediaUrl(nested, depth + 1); if (found) return found; }
  }
  return '';
}

function firstMediaField(value, keys, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    for (const item of value) { const found = firstMediaField(item, keys, depth + 1); if (found) return found; }
    return '';
  }
  if (typeof value !== 'object') return '';
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 2000);
  }
  for (const nested of Object.values(value)) {
    const found = firstMediaField(nested, keys, depth + 1);
    if (found) return found;
  }
  return '';
}

export function extractDouyinMessageMedia(content, type = 0) {
  let data = content;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return null; } }
  if (!data || typeof data !== 'object') return null;
  const messageType = Number(type), url = renderableMediaUrl(data);
  const liveSource = data.live || data.live_room || data.room || data.room_info || data.live_info;
  const liveSignal = messageType === 21 || Boolean(liveSource || ['room_owner_name', 'anchor_name', 'room_title', 'live_title', 'room_url', 'live_url'].some(key => key in data));
  if (liveSignal) {
    const source = liveSource && typeof liveSource === 'object' ? liveSource : data;
    const liveUrl = firstReadableValue(source, ['room_url', 'live_url', 'share_url', 'web_url', 'url']);
    const poster = renderableMediaUrl(firstReadableValue(source, ['cover_url', 'cover', 'cover_image', 'room_cover']));
    const owner = firstReadableValue(source, ['room_owner_name', 'anchor_name', 'owner_name', 'nickname', 'nick_name']);
    const title = firstReadableValue(source, ['room_title', 'live_title', 'title', 'room_name', 'content_title', 'description']);
    if (liveUrl || poster || owner || title) return { kind: 'live', url: liveUrl || url, poster, name: owner, title, width: 0, height: 0 };
  }
  if (messageType === 5 || Array.isArray(data.stickers)) return {
    kind: 'emoji', url, name: String(data.display_name || '').slice(0, 100),
    width: Math.max(0, Math.min(4096, Number(data.width || data.url?.width || 0) || 0)),
    height: Math.max(0, Math.min(4096, Number(data.height || data.url?.height || 0) || 0))
  };
  if (messageType === 27 || data.resource_url && !data.itemId && !data.item_id) return {
    kind: 'image', url, skey: firstMediaField(data, ['skey']),
    width: Math.max(0, Math.min(16384, Number(data.cover_width || data.width || 0) || 0)),
    height: Math.max(0, Math.min(16384, Number(data.cover_height || data.height || 0) || 0))
  };
  const video = data.video || data.video_info || data.aweme?.video || data.item?.video || data.item?.video_info;
  const videoLike = video && typeof video === 'object' || data.play_addr || data.download_addr || data.play_url;
  if (videoLike) {
    const source = video && typeof video === 'object' ? video : data;
    const url = renderableMediaUrl(source.play_addr || source.download_addr || source.url_list || source.play_url || data.play_addr || data.download_addr || data.play_url);
    const posterSource = source.poster || source.cover || source.cover_url || source.cover_url_list || data.poster || data.cover || data.cover_url || data.cover_url_list || data.content_thumb;
    const poster = renderableMediaUrl(posterSource);
    const videoId = String(source.vid || source.video_id || data.itemId || data.item_id || data.aweme_id || '').slice(0, 200);
    return {
      kind: 'video', url, poster, videoId,
      // These are Duoshan media fields. The desktop client uses them to
      // fetch/decode encrypted poster and video bytes; they are not PC-chat
      // credentials and must remain attached to the media object.
      posterOid: firstMediaField(posterSource, ['oid', 'poster_oid', 'cover_oid']),
      posterSkey: firstMediaField(posterSource, ['skey', 'poster_skey', 'cover_skey']),
      posterMd5: firstMediaField(posterSource, ['md5', 'poster_md5', 'cover_md5']),
      videoTkey: firstMediaField(source, ['tkey', 'video_tkey']),
      videoSkey: firstMediaField(source, ['skey', 'video_skey']),
      width: Number(data.width || source.width || 0) || 0, height: Number(data.height || source.height || 0) || 0
    };
  }
  return null;
}

function parseMessage(raw, accountUid, conversationId, memberMap = new Map()) {
  const data = parseFields(raw), serverId = String(first(data, 3, 0, 0n));
  const indexInConversation = String(first(data, 4, 0, 0n));
  const sender = String(first(data, 7, 0, 0n)), messageType = Number(first(data, 6, 0, 0n));
  const rawContent = stringValue(first(data, 8, 2));
  let contentData = null;
  try { contentData = JSON.parse(rawContent); } catch { /* plain text is valid */ }
  const identities = messageUsers(contentData);
  const senderIdentity = identities.find(item => item.uid === sender) || identities.find(item => item.secUid && item.secUid === stringValue(first(data, 14, 2))) || {};
  const memberIdentity = memberMap.get(sender) || {};
  const memberSecUid = typeof memberIdentity === 'string' ? memberIdentity : String(memberIdentity.secUid || '');
  const senderSecUid = stringValue(first(data, 14, 2)) || memberSecUid || senderIdentity.secUid || '';
  let created = Number(first(data, 10, 0, 0n));
  if (created && created < 1_000_000_000_000) created *= 1000;
  return {
    conversationId, serverMessageId: serverId, indexInConversation, sender, senderSecUid,
    senderName: senderIdentity.name || (typeof memberIdentity === 'object' ? memberIdentity.name || '' : ''),
    senderAvatar: senderIdentity.avatar || (typeof memberIdentity === 'object' ? memberIdentity.avatar || '' : ''), identities,
    direction: sender === accountUid ? 'outbound' : 'inbound', messageType,
    content: formatDouyinMessageContent(rawContent, messageType), media: extractDouyinMessageMedia(contentData, messageType), created,
    diagnostic: contentData && typeof contentData === 'object' ? {
      keys: Object.keys(contentData).sort().slice(0, 40),
      aweType: Number(contentData.aweType || contentData.awemeType || 0),
      activeUsers: Array.isArray(contentData.active_users) ? contentData.active_users.length : 0,
      passiveUsers: Array.isArray(contentData.passive_users) ? contentData.passive_users.length : 0,
      localeResources: Array.isArray(contentData.locale_resources) ? contentData.locale_resources.length : 0,
      fields: [...new Set(data.map(field => `${field.number}:${field.wire}`))].sort(),
      extKeys: values(data, 9, 2).map(value => { const fields = parseFields(value, false); return fields ? stringValue(first(fields, 1, 2)) : ''; }).filter(Boolean).sort().slice(0, 30),
      rawLength: Buffer.byteLength(rawContent), startsJson: /^[\[{]/.test(rawContent.trim()), endsJson: /[\]}]$/.test(rawContent.trim()), replacementChars: (rawContent.match(/�/g) || []).length
    } : {
      keys: [], aweType: 0, activeUsers: 0, passiveUsers: 0, localeResources: 0,
      fields: [...new Set(data.map(field => `${field.number}:${field.wire}`))].sort(),
      extKeys: values(data, 9, 2).map(value => { const fields = parseFields(value, false); return fields ? stringValue(first(fields, 1, 2)) : ''; }).filter(Boolean).sort().slice(0, 30),
      rawLength: Buffer.byteLength(rawContent), startsJson: /^[\[{]/.test(rawContent.trim()), endsJson: /[\]}]$/.test(rawContent.trim()), replacementChars: (rawContent.match(/�/g) || []).length
    }
  };
}

function hydrateConversationFromMessages(conversation, accountUid) {
  if (conversation.type !== 'private' || !Array.isArray(conversation.messages)) return conversation;
  const peerMessage = conversation.messages.find(message => String(message.sender || '') !== String(accountUid)
    && (message.senderName || message.senderAvatar));
  if (!peerMessage) return conversation;
  if (peerMessage.senderName && /^用户\s+\d+$/.test(conversation.title || '')) {
    conversation.title = peerMessage.senderName.slice(0, 100);
  }
  conversation.peerName = conversation.peerName || peerMessage.senderName || '';
  conversation.avatar = conversation.avatar || peerMessage.senderAvatar || '';
  return conversation;
}

function responseBody(raw, commandId) {
  const response = parseFields(raw), status = Number(first(response, 3, 0, 0n));
  if (status !== 0) throw new DouyinWebSyncError(`上游返回 ${status}: ${stringValue(first(response, 4, 2)).slice(0, 160)}`);
  const containerRaw = first(response, 6, 2);
  if (!containerRaw) throw new DouyinWebSyncError('上游响应缺少命令体');
  const body = first(parseFields(containerRaw), commandId, 2);
  if (!body) throw new DouyinWebSyncError(`上游响应缺少命令 ${commandId}`);
  return parseFields(body);
}
function updateConversationHistoryCursor(conversation) {
  const indexes = conversation.messages.map(item => item.indexInConversation)
    .filter(value => /^\d+$/.test(String(value || '')) && BigInt(value) > 0n).map(BigInt);
  conversation.historyCursor = indexes.length ? String(indexes.reduce((min, value) => value < min ? value : min)) : '0';
  conversation.historyHasMore = conversation.messages.length >= 20 && conversation.historyCursor !== '0';
}

function mergeConversationMessages(target, incoming, accountUid) {
  const messages = new Map(target.messages.map(item => [item.serverMessageId, item]));
  for (const message of incoming.messages) messages.set(message.serverMessageId, message);
  target.messages = [...messages.values()];
  target.avatar = target.avatar || incoming.avatar || '';
  target.ticket = target.ticket || incoming.ticket || '';
  if (!target.title || /^用户\s+\S+$/.test(target.title)) target.title = incoming.title || target.title;
  hydrateConversationFromMessages(target, accountUid);
  updateConversationHistoryCursor(target);
}

// seen: 可选 Set，保存此前已成功入库的会话条目哈希。字节完全相同的条目没有任何新内容，
// 轮询时直接跳过解析；本次新出现的哈希放进返回值 entryHashes，由调用方在入库成功后登记。
export function parseInitialSyncResponse(raw, accountUid, seen = null) {
  const body = responseBody(raw, 2043), conversations = [], entryHashes = [];
  for (const entryRaw of values(body, 1, 2)) {
    if (seen) {
      const hash = createHash('sha1').update(entryRaw).digest('base64');
      if (seen.has(hash)) continue;
      entryHashes.push(hash);
    }
    const entry = parseFields(entryRaw), conversationRaw = first(entry, 1, 2);
    if (!conversationRaw) continue;
    const conversation = parseConversation(conversationRaw, accountUid);
    const memberMap = new Map([
      ...parseMembers(first(parseFields(conversationRaw), 6, 2)),
      ...collectNestedMembers(conversationRaw),
    ].map(item => [item.uid, item]));
    conversation.messages = values(entry, 2, 2).map(item => parseMessage(item, accountUid, conversation.protocolId, memberMap)).filter(item => item.serverMessageId !== '0' && item.content !== null);
    hydrateConversationFromMessages(conversation, accountUid);
    updateConversationHistoryCursor(conversation);
    conversations.push(conversation);
  }
  const cursorField = body.find(item => item.number === 3 && (item.wire === 0 || item.wire === 2));
  return {
    conversations, entryHashes,
    hasMore: first(body, 2, 0, 0n) !== 0n,
    nextCursor: cursorField ? { wire: cursorField.wire, value: cursorField.wire === 0 ? String(cursorField.value) : stringValue(cursorField.value) } : null
  };
}
export function parseHistoryResponse(raw, accountUid, conversationId) {
  const body = responseBody(raw, 301);
  return { messages: values(body, 1, 2).map(item => parseMessage(item, accountUid, conversationId)).filter(item => item.serverMessageId !== '0' && item.content !== null), nextCursor: String(first(body, 2, 0, 0n)), hasMore: first(body, 3, 0, 0n) !== 0n };
}

async function post(cookie, endpoint, payload, fetchImpl = fetch, requestHeaders = {}) {
  const response = await fetchImpl(endpoint, { method: 'POST', headers: {
    'content-type': 'application/x-protobuf', accept: 'application/x-protobuf', cookie,
    referer: 'https://www.douyin.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    ...requestHeaders, cookie,
  }, body: payload, signal: AbortSignal.timeout(30000) });
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.length > MAX_RESPONSE) throw new DouyinWebSyncError('上游响应过大');
  if (!response.ok) throw new DouyinWebSyncError(`上游 HTTP ${response.status}`);
  if (raw[0] === 0x7b) throw new DouyinWebSyncError('上游返回了空 JSON 协议壳');
  return raw;
}
export async function diagnoseDouyinWebTransport({ cookie, fetchImpl = fetch }) {
  const raw = await post(cookie, 'https://imapi.douyin.com/v1/message/get_message_by_init', buildInitialSyncRequest(), fetchImpl);
  const outer = parseFields(raw), container = first(outer, 6, 2);
  const commands = container ? parseFields(container) : [];
  const initRaw = first(commands, 2043, 2);
  const init = initRaw ? parseFields(initRaw) : [];
  const cursorField = init.find(item => item.number === 3);
  return {
    bytes: raw.length,
    prefixHex: raw.subarray(0, 24).toString('hex'),
    status: Number(first(outer, 3, 0, 0n)),
    error: stringValue(first(outer, 4, 2)).slice(0, 160),
    outerFields: [...new Set(outer.map(item => item.number))],
    commandFields: [...new Set(commands.map(item => item.number))],
    initFields: [...new Set(init.map(item => item.number))],
    hasMore: first(init, 2, 0, 0n) !== 0n,
    cursorWire: cursorField?.wire ?? null,
    cursorValue: cursorField?.wire === 0 ? String(cursorField.value) : cursorField?.wire === 2 ? stringValue(cursorField.value).slice(0, 80) : ''
  };
}
const SEEN_ENTRY_LIMIT = 3000;
const seenEntryHashes = new Map();
export async function syncDouyinWebConversations({ cookie, accountUid, maxPages = 5, maxConversations = 300, cursor = null, fetchImpl = fetch, requestHeaders = {}, onPage = null, skipUnchanged = false, traceLabel = 'sync' }) {
  const output = [], byConversation = new Map(), cursors = new Set();
  let seen = null;
  // 键包含 cookie：不同租户绑定同一账号、或重新登录后，都从空记录开始，不会互相跳过。
  const seenKey = `${accountUid}|${createHash('sha1').update(String(cookie || '')).digest('base64')}`;
  if (skipUnchanged) {
    seen = seenEntryHashes.get(seenKey);
    if (!seen) { seen = new Set(); seenEntryHashes.set(seenKey, seen); }
  } else seenEntryHashes.delete(seenKey);
  let nextCursor = cursor;
  let hasMore = false;
  for (let page = 0; page < maxPages && output.length < maxConversations; page++) {
    const raw = await post(cookie, 'https://imapi.douyin.com/v1/message/get_message_by_init', buildInitialSyncRequest(nextCursor), fetchImpl, requestHeaders);
    const parsed = traceSync(`parse:${traceLabel}`, () => parseInitialSyncResponse(raw, accountUid, seen)), pageRows = new Map();
    for (const item of parsed.conversations) {
      let target = byConversation.get(item.protocolId);
      if (target) mergeConversationMessages(target, item, accountUid);
      else if (output.length < maxConversations) {
        target = { ...item, messages: [] };
        mergeConversationMessages(target, item, accountUid);
        byConversation.set(item.protocolId, target); output.push(target);
      }
      if (!target) continue;
      const currentPage = pageRows.get(item.protocolId);
      if (currentPage) mergeConversationMessages(currentPage, item, accountUid);
      else pageRows.set(item.protocolId, { ...target, messages: [...item.messages] });
    }
    const cursorKey = parsed.nextCursor ? `${parsed.nextCursor.wire}:${parsed.nextCursor.value}` : '';
    hasMore = parsed.hasMore;
    nextCursor = parsed.nextCursor || nextCursor;
    // Persist each page before waiting on another upstream round trip.
    // Returning false lets the caller fence a superseded login session.
    const pageAccepted = onPage ? await onPage({ conversations: [...pageRows.values()], nextCursor, hasMore, page: page + 1 }) : true;
    // 只有入库回调正常返回才登记哈希；回调抛错或被围栏拒绝时下次仍会完整解析。
    if (seen && pageAccepted !== false) {
      for (const hash of parsed.entryHashes) seen.add(hash);
      if (seen.size > SEEN_ENTRY_LIMIT) seen.clear();
    }
    if (pageAccepted === false) break;
    if (!parsed.hasMore || !cursorKey || cursors.has(cursorKey)) break;
    cursors.add(cursorKey);
  }
  return { conversations: output, nextCursor, hasMore };
}
export async function syncDouyinWebHistory({ cookie, accountUid, conversationId, conversationType, shortId, cursor, limit = 50, fetchImpl = fetch, requestHeaders = {} }) {
  const raw = await post(cookie, 'https://imapi.douyin.com/v1/message/get_by_conversation', buildHistoryRequest({ conversationId, conversationType, shortId, cursor, limit }), fetchImpl, requestHeaders);
  return parseHistoryResponse(raw, accountUid, conversationId);
}

function parseCookieHeader(value) {
  return Object.fromEntries(String(value || '').split(';').map(part => {
    const index = part.indexOf('=');
    return index > 0 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : ['', ''];
  }).filter(([key]) => key));
}

export function randomMsToken() {
  const alphabet = 'ABCDEFGHIGKLMNOPQRSTUVWXYZabcdefghigklmnopqrstuvwxyz0123456789=';
  let result = '';
  for (let index = 0; index < 107; index++) result += alphabet[Math.floor(Math.random() * alphabet.length)];
  return result;
}

export function mergeBrowserStateCookies(cookie, browserState) {
  const cookies = parseCookieHeader(cookie);
  if (typeof browserState !== 'string' || !browserState) return cookies;
  try {
    const state = JSON.parse(browserState);
    for (const item of Array.isArray(state?.cookies) ? state.cookies : []) {
      const name = String(item?.name || '').trim();
      const value = String(item?.value || '');
      const domain = String(item?.domain || '').replace(/^\./, '').toLowerCase();
      if (name && value && (domain === 'douyin.com' || domain.endsWith('.douyin.com'))) cookies[name] = value;
    }
  } catch {
    // The caller will report the upstream identity error with a safe reason.
  }
  return cookies;
}

function findCurrentUserUid(value, depth = 0) {
  if (!value || depth > 8 || typeof value !== 'object') return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCurrentUserUid(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  const direct = value.user_uid ?? value.userUid;
  if (/^\d{1,30}$/.test(String(direct || '').trim())) return String(direct).trim();
  for (const item of Object.values(value)) {
    const found = findCurrentUserUid(item, depth + 1);
    if (found) return found;
  }
  return '';
}

export async function fetchCurrentCreatorUid({ cookie, browserState = '', fetchImpl = fetch }) {
  const cookies = mergeBrowserStateCookies(cookie, browserState);
  const cookieHeader = Object.entries(cookies).map(([name, value]) => name + '=' + value).join('; ')
  if (!cookieHeader) {
    throw new CreatorIdentityResolutionError('Creator 当前登录 Cookie 缺失', { code: 'creator_current_uid_cookie_missing' });
  }
  const verifyFp = String(cookies.s_v_web_id || cookies.verifyFp || cookies.verify_fp || '').trim();
  const webid = /^\d{8,30}$/.test(verifyFp) ? verifyFp : String(Math.floor(1e18 + Math.random() * 9e18));
  const query = new URLSearchParams({
    device_platform: 'webapp',
    aid: '6383',
    channel: 'channel_pc_web',
    pc_client_type: '1',
    update_version_code: '170400',
    version_code: '170400',
    version_name: '17.4.0',
    cookie_enabled: 'true',
    screen_width: '1707',
    screen_height: '960',
    browser_language: 'zh-CN',
    browser_platform: 'Win32',
    browser_name: 'Edge',
    browser_version: '125.0.0.0',
    browser_online: 'true',
    engine_name: 'Blink',
    engine_version: '125.0.0.0',
    os_name: 'Windows',
    os_version: '10',
    cpu_core_num: '32',
    device_memory: '8',
    platform: 'PC',
    downlink: '10',
    effective_type: '4g',
    round_trip_time: '100',
    webid,
    msToken: ((cookies.ttwid || fetchImpl === fetch || fetchImpl?.isDouyinJuheProxyFetch)
      ? await fetchDynamicMsToken(cookies.ttwid, fetchImpl)
      : '') || cookies.msToken || cookies.ms_token || randomMsToken(),
  });
  if (verifyFp) {
    query.set('verifyFp', verifyFp);
    query.set('fp', verifyFp);
  }
  query.set('a_bogus', generateABogus(query.toString()));
  const response = await fetchImpl('https://www.douyin.com/aweme/v1/web/query/user/?' + query, {
    headers: {
      accept: 'application/json, text/plain, */*',
      cookie: cookieHeader,
      referer: 'https://www.douyin.com/',
      origin: 'https://www.douyin.com',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new CreatorIdentityResolutionError('Creator 当前账号接口拒绝请求（HTTP ' + response.status + '）', {
      status: Number(response.status) || 0, code: 'creator_current_uid_upstream_rejected',
    });
  }
  const payload = await response.json().catch(() => ({}));
  const uid = findCurrentUserUid(payload);
  if (!uid) {
    throw new CreatorIdentityResolutionError('Creator 当前账号接口未返回 user_uid', {
      code: 'creator_current_uid_missing',
    });
  }
  return uid;
}

const MSTOKEN_CUSTOM = 'Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe';
let msTokenCache = { value: '', expires: 0 };
function reportRc4(key, data) {
  const box = Array.from({ length: 256 }, (_, index) => index); let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + box[i] + key[i % key.length]) & 255; [box[i], box[j]] = [box[j], box[i]]; }
  const output = [], state = { i: 0, j: 0 };
  for (const byte of data) { state.i = (state.i + 1) & 255; state.j = (state.j + box[state.i]) & 255; [box[state.i], box[state.j]] = [box[state.j], box[state.i]]; output.push(byte ^ box[(box[state.i] + box[state.j]) & 255]); }
  return output;
}
function reportBase64(bytes) {
  let output = '';
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const length = Math.min(3, bytes.length - offset), value = ((bytes[offset] || 0) << 16) | ((bytes[offset + 1] || 0) << 8) | (bytes[offset + 2] || 0);
    output += MSTOKEN_CUSTOM[(value >>> 18) & 63] + MSTOKEN_CUSTOM[(value >>> 12) & 63] + (length > 1 ? MSTOKEN_CUSTOM[(value >>> 6) & 63] : '=') + (length > 2 ? MSTOKEN_CUSTOM[value & 63] : '=');
  }
  return output;
}
function buildMsTokenReport() {
  const fingerprint = {
    tokenList: [], navigator: { appCodeName: 'Mozilla', appMinorVersion: 'undefined', appName: 'Netscape', appVersion: '5.0 (Windows)', buildID: 'undefined', doNotTrack: 'null', msDoNotTrack: 'undefined', oscpu: 'undefined', platform: 'Win32', product: 'Gecko', productSub: '20030107', cpuClass: 'undefined', vendor: 'Google Inc.', vendorSub: 'undefined', deviceMemory: '8', language: 'zh-CN', systemLanguage: 'undefined', userLanguage: 'undefined', webdriver: 'false', cookieEnabled: 1, vibrate: 4, credentials: 4, storage: 4, requestMediaKeySystemAccess: 4, bluetooth: 4, hardwareConcurrency: 12, maxTouchPoints: -1, languages: 'zh-CN,zh', touchEvent: 1, touchstart: 2 },
    wID: { load: 0, nap: '6', nativeLength: 33, jsFontsList: '0', timestamp: String(Date.now()), timezone: 8, magic: 3, canvas: '-1', wProps: 374262, dProps: 2, jsv: '', browserType: 0, iframe: 2, devicePixelRatio: 1, location: 'https://www.douyin.com/' },
    window: { Image: 3, isSecureContext: 4, ActiveXObject: 4, toolbar: 4, locationbar: 4, external: 4, mozRTCPeerConnection: 4, postMessage: 3, webkitRequestAnimationFrame: 4, BluetoothUUID: 4, netscape: 4, localStorage: 11, sessionStorage: 11, indexDB: 4, devicePixelRatio: 1, location: 'https://www.douyin.com/' },
    webgl: {}, document: { characterSet: 'UTF-8', compatMode: 'undefined', documentMode: 'undefined', layers: 4, all: 4, images: 4 }, screen: { innerWidth: 1920, innerHeight: 937, outerWidth: 1920, outerHeight: 1040, screenX: 0, screenY: 0, pageXOffset: 0, pageYOffset: 0, availWidth: 1920, availHeight: 1040, sizeWidth: 1920, sizeHeight: 1080, clientWidth: 1910, clientHeight: 937, colorDepth: 24, pixelDepth: 24 }, plugins: { plugin: [], pv: '0' }, custom: {}
  };
  const plaintext = Buffer.from(JSON.stringify(fingerprint), 'utf8'), nonce = Math.floor(Math.random() * 256), encoded = reportBase64([0x41, nonce, ...reportRc4([nonce], [...plaintext])]);
  return JSON.stringify({ magic: 538969122, version: 1, dataType: 8, strData: encoded, tspFromClient: Date.now(), ulr: 0 });
}
export async function fetchDynamicMsToken(ttwid, fetchImpl = fetch) {
  if (msTokenCache.value && msTokenCache.expires > Date.now()) return msTokenCache.value;
  try {
    const response = await fetchImpl('https://mssdk.bytedance.com/web/common?ms_appid=6383', { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8', accept: '*/*', origin: 'https://www.douyin.com', referer: 'https://www.douyin.com/', cookie: ttwid ? `ttwid=${ttwid}` : '', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36' }, body: buildMsTokenReport(), signal: AbortSignal.timeout(12000) });
    const token = response.headers.get('x-ms-token') || (response.headers.get('set-cookie') || '').match(/(?:^|,\s*)msToken=([^;]+)/)?.[1] || '';
    if (token) { msTokenCache = { value: token, expires: Date.now() + 10 * 60 * 1000 }; return token; }
  } catch { /* fall back to the cookie/random token below */ }
  return '';
}

function findUserObject(value, depth = 0) {
  if (!value || depth > 4 || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findUserObject(item, depth + 1); if (found) return found; }
    return null;
  }
  const uid = value.uid ?? value.user_id ?? value.userId ?? value.id;
  if (/^\d{1,30}$/.test(String(uid || '').trim())) return value;
  for (const key of ['user', 'user_info', 'userInfo', 'data', 'aweme_detail', 'profile']) {
    const found = findUserObject(value[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function identityFromUser(user, secUid) {
  if (!user) return null;
  const uid = String(user.uid || user.user_id || user.userId || user.id || '').trim();
  if (!/^\d{1,30}$/.test(uid)) return null;
  const name = String(user.nickname || user.nick_name || user.name || '').trim().slice(0, 100);
  const avatar = firstAvatarUrl(user.avatar_168x168 || user.avatar_thumb || user.avatar_medium || user.avatar_larger || user.avatar_url || user.avatar);
  const douyinId = String(user.unique_id || user.uniqueId || user.douyin_id || user.douyinId || user.short_id || user.shortId || '').trim().slice(0, 100);
  return douyinId ? { uid, secUid, name, avatar, douyinId } : { uid, secUid, name, avatar };
}

function identityFromPageHtml(html, secUid) {
  const source = String(html || '');
  if (!source) return null;
  const candidates = [source, source.replaceAll('\\\\"', '"'), source.replaceAll('\\"', '"')];
  for (const candidate of candidates) {
    const uidMatch = candidate.match(/(?:"|\\b)(?:uid|user_id|userId)(?:"|\\b)\s*[:=]\s*"?(\d{1,30})/);
    if (!uidMatch) continue;
    const nameMatch = candidate.match(/(?:"nickname"|"nick_name"|"name")\s*:\s*"([^"\\]{1,100})"/);
    const avatarMatch = candidate.match(/https?:\/\/[^"\s]+(?:douyinpic|byteimg|douyincdn)[^"\s]*/);
    const douyinMatch = candidate.match(/(?:unique_id|uniqueId|douyin_id|douyinId|short_id|shortId)\s*["']?\s*[:=]\s*["']([^"']{1,100})["']/);
    return douyinMatch?.[1]
      ? { uid: uidMatch[1], secUid, name: nameMatch?.[1] || '', avatar: avatarMatch?.[0] || '', douyinId: douyinMatch[1] }
      : { uid: uidMatch[1], secUid, name: nameMatch?.[1] || '', avatar: avatarMatch?.[0] || '' };
  }
  return null;
}

// Reports only non-sensitive shape information (status, which fields exist, avatar host).
function profileDiagnostic(status, payload, parsed) {
  const user = findUserObject(payload);
  const avatarKeys = user ? ['avatar_168x168', 'avatar_thumb', 'avatar_medium', 'avatar_larger', 'avatar_url', 'avatar'].filter(key => user[key] !== undefined && user[key] !== null) : [];
  const rawUrl = user ? JSON.stringify(user.avatar_168x168 || user.avatar_thumb || user.avatar_medium || user.avatar_larger || user.avatar || '').match(/https?:\\?\/\\?\/([a-z0-9.-]+)/i) : null;
  return {
    status, apiStatusCode: Number(payload?.status_code ?? -1), hasUser: Boolean(user), hasName: Boolean(user?.nickname),
    avatarKeys, rawAvatarHost: rawUrl?.[1]?.replace(/^[a-z]*\d+-/, '*-') || '', parsedAvatar: Boolean(parsed?.avatar),
  };
}

// Web endpoints silently answer HTTP 200 with an empty body when `webid` is a
// random number. The real device id is returned by /query/user as `id`; resolve
// it once per login and reuse it. Misses are cached briefly so a refused
// bootstrap request is not repeated for every peer.
const DEVICE_WEBID_TTL_MS = 6 * 60 * 60_000, DEVICE_WEBID_MISS_TTL_MS = 5 * 60_000;
const deviceWebIdCache = new Map();
async function resolveDeviceWebId(cookies, fetchImpl) {
  const cookieHeader = Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ');
  if (!cookieHeader) return '';
  const key = `${cookies.ttwid || ''}|${cookies.s_v_web_id || ''}|${cookies.UIFID || ''}`;
  const hit = deviceWebIdCache.get(key);
  if (hit?.pending) return hit.pending;
  if (hit && hit.expires > Date.now()) return hit.value;
  const pending = (async () => {
    let value = '';
    try {
      const verifyFp = cookies.s_v_web_id || '';
      const query = new URLSearchParams({
        device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web', update_version_code: '170400', pc_client_type: '1',
        pc_libra_divert: 'Windows', support_h265: '1', support_dash: '1', cpu_core_num: '8', version_code: '170400', version_name: '17.4.0',
        cookie_enabled: 'true', screen_width: '1440', screen_height: '1000', browser_language: 'zh-CN', browser_platform: 'Win32',
        browser_name: 'Chrome', browser_version: '131.0.0.0', browser_online: 'true', engine_name: 'Blink', engine_version: '131.0.0.0',
        os_name: 'Windows', os_version: '10', device_memory: '8', platform: 'PC', downlink: '10', effective_type: '4g', round_trip_time: '0',
        publish_video_strategy_type: '2', webid: String(Math.floor(1e18 + Math.random() * 9e18)),
      });
      if (cookies.UIFID) query.set('uifid', cookies.UIFID);
      query.set('msToken', ((cookies.ttwid || fetchImpl === fetch || fetchImpl?.isDouyinJuheProxyFetch)
        ? await fetchDynamicMsToken(cookies.ttwid, fetchImpl) : '') || cookies.msToken || cookies.ms_token || randomMsToken());
      if (verifyFp) { query.set('verifyFp', verifyFp); query.set('fp', verifyFp); }
      query.set('a_bogus', generateABogus(query.toString()));
      const headers = {
        accept: 'application/json, text/plain, */*', cookie: cookieHeader, referer: 'https://www.douyin.com/discover',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
      };
      if (cookies.UIFID) headers.uifid = cookies.UIFID;
      const response = await fetchImpl(`https://www.douyin.com/aweme/v1/web/query/user/?${query}`, { headers, signal: AbortSignal.timeout(12000) });
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        const id = String(payload?.id ?? '').trim();
        if (/^\d{8,30}$/.test(id)) value = id;
      }
    } catch { /* fall back to the previous webid strategy */ }
    deviceWebIdCache.set(key, { value, expires: Date.now() + (value ? DEVICE_WEBID_TTL_MS : DEVICE_WEBID_MISS_TTL_MS) });
    return value;
  })();
  deviceWebIdCache.set(key, { value: '', expires: 0, pending });
  return pending;
}

export async function fetchDouyinUserIdentity({ cookie, browserState = '', secUid, fetchImpl = fetch, allowPageFallback = true, strict = false, onDiagnostic = null }) {
  const identity = String(secUid || '').trim();
  if (!identity || identity.length > 256 || !/^[A-Za-z0-9._-]+$/.test(identity)) return null;
  const cookies = parseCookieHeader(cookie);
  // A Creator capture may contain a newer Web-only cookie in the browser
  // snapshot even when the compact header predates it. Merge only cookie
  // records from the same server-provided state; never inspect page content.
  if (typeof browserState === 'string' && browserState) {
    try {
      const state = JSON.parse(browserState);
      for (const item of Array.isArray(state?.cookies) ? state.cookies : []) {
        const name = String(item?.name || '').trim(), value = String(item?.value || '');
        const domain = String(item?.domain || '').replace(/^\./, '').toLowerCase();
        if (name && value && (domain === 'douyin.com' || domain.endsWith('.douyin.com'))) cookies[name] = value;
      }
    } catch { /* malformed state is handled by material validation */ }
  }
  const verifyFp = cookies.s_v_web_id || '';
  // Same gate as the dynamic msToken: only the real network paths bootstrap
  // the device id, so injected test fetchers see exactly one request.
  const canBootstrap = Boolean(cookies.ttwid || fetchImpl === fetch || fetchImpl?.isDouyinJuheProxyFetch);
  const deviceWebId = canBootstrap ? await resolveDeviceWebId(cookies, fetchImpl) : '';
  const webid = deviceWebId || (/^\d{8,30}$/.test(verifyFp) ? verifyFp : String(Math.floor(1e18 + Math.random() * 9e18)));
  // Field set and order follow a real Chrome capture of profile/other
  // (verifyFp/fp come after msToken and a_bogus is signed over the rest).
  const query = new URLSearchParams({
    device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web', publish_video_strategy_type: '2',
    source: 'channel_pc_web', sec_user_id: identity, personal_center_strategy: '1',
    profile_other_record_enable: '1', land_to: '1', update_version_code: '170400',
    pc_client_type: '1', pc_libra_divert: 'Windows', support_h265: '1', support_dash: '1', cpu_core_num: '8',
    version_code: '170400', version_name: '17.4.0', cookie_enabled: 'true',
    screen_width: '1440', screen_height: '1000', browser_language: 'zh-CN', browser_platform: 'Win32',
    browser_name: 'Chrome', browser_version: '131.0.0.0', browser_online: 'true', engine_name: 'Blink',
    engine_version: '131.0.0.0', os_name: 'Windows', os_version: '10', device_memory: '8',
    platform: 'PC', downlink: '10', effective_type: '4g', round_trip_time: '0', webid,
  });
  if (cookies.UIFID) query.set('uifid', cookies.UIFID);
  if (verifyFp) { query.set('verifyFp', verifyFp); query.set('fp', verifyFp); }
  query.set('msToken', (canBootstrap ? await fetchDynamicMsToken(cookies.ttwid, fetchImpl) : '')
    || cookies.msToken || cookies.ms_token || randomMsToken());
  query.set('a_bogus', generateABogus(query.toString()));
  const referer = `https://www.douyin.com/user/${encodeURIComponent(identity)}`;
  const headers = { cookie: String(cookie || ''), referer, 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' };
  if (cookies.UIFID) headers.uifid = cookies.UIFID;
  let profileStatus = 0;
  try {
    const response = await fetchImpl(`https://www.douyin.com/aweme/v1/web/user/profile/other/?${query}`, { headers, signal: AbortSignal.timeout(12000) });
    profileStatus = Number(response.status) || 0;
    if (!response.ok) {
      if (onDiagnostic) {
        // Keep only a whitelist of non-sensitive response headers and a short
        // body prefix so a gateway refusal (e.g. HTTP 444) can be explained.
        const rejection = { headers: {}, bodyPrefix: '' };
        try {
          for (const name of ['server', 'content-type', 'content-length', 'via', 'x-tt-logid', 'x-tt-trace-id', 'x-bd-upstream-id', 'x-tt-trace-host', 'x-tt-trace-tag', 'x-tt-env', 'x-ware-tt-forbid']) {
            const value = response.headers?.get?.(name);
            if (value) rejection.headers[name] = String(value).slice(0, 120);
          }
          rejection.bodyPrefix = (await response.text()).slice(0, 200).replace(/[\u0000-\u001f\u007f]+/g, ' ');
        } catch { /* body is optional */ }
        try { onDiagnostic({ status: profileStatus, hasUser: false, hasName: false, avatarKeys: [], rawAvatarHost: '', parsedAvatar: false, rejection }); } catch { /* diagnostics must not affect lookups */ }
      }
      if (strict) {
        const webCookieHint = verifyFp ? '' : '；登录材料缺少 Web 身份 Cookie（s_v_web_id）';
        throw new CreatorIdentityResolutionError(`Creator 资料接口拒绝请求（HTTP ${profileStatus || '未知'}）${webCookieHint}`, { status: profileStatus, code: 'creator_profile_upstream_rejected' });
      }
      return null;
    }
    if (response.ok) {
      const payload = await response.json();
      const parsed = identityFromUser(findUserObject(payload), identity);
      try { onDiagnostic?.(profileDiagnostic(profileStatus, payload, parsed)); } catch { /* diagnostics must not affect lookups */ }
      if (parsed) return parsed;
    }
  } catch (error) {
    if (strict) {
      if (error instanceof CreatorIdentityResolutionError) throw error;
      throw new CreatorIdentityResolutionError(`Creator 资料接口请求失败：${String(error?.message || '网络错误').slice(0, 160)}`, { status: profileStatus, code: 'creator_profile_request_failed' });
    }
    /* transient upstream failure */
  }
  if (!allowPageFallback) {
    return null;
  }
  try {
    const response = await fetchImpl(referer, { headers, signal: AbortSignal.timeout(12000) });
    if (response.ok) return identityFromPageHtml(await response.text(), identity);
  } catch (error) {
    if (strict) throw new CreatorIdentityResolutionError(`Creator 资料页请求失败：${String(error?.message || '网络错误').slice(0, 160)}`, { status: profileStatus, code: 'creator_profile_page_failed' });
    /* transient upstream failure */
  }
  return null;
}

/**
 * Resolve a Creator Web target through the server-side profile API only.
 * Creator browser state is a sending credential, not a reason to launch a
 * browser or load a target profile page on the API server.
 */
export async function fetchCreatorUserIdentity({ cookie, browserState = '', secUid, fetchImpl = fetch }) {
  return fetchDouyinUserIdentity({ cookie, browserState, secUid, fetchImpl, allowPageFallback: false, strict: true });
}
import { generateABogus } from './douyin-web-sign.js';
