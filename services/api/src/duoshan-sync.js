import { formatDouyinMessageContent } from './douyin-web-sync.js';

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_HISTORY_RESPONSES = 50;

export class DuoshanProtoError extends Error {}

function readVarint(buffer, start) {
  let value = 0n, shift = 0n, offset = start;
  while (offset < buffer.length && shift < 70n) {
    const byte = buffer[offset++];
    value |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [value, offset];
    shift += 7n;
  }
  throw new DuoshanProtoError('Protobuf varint truncated');
}

function skipGroup(buffer, start, groupNumber, context) {
  let offset = start;
  while (offset < buffer.length) {
    const [key, next] = readVarint(buffer, offset);
    offset = next;
    const number = Number(key >> 3n), wire = Number(key & 7n);
    if (!number) throw new DuoshanProtoError(`${context}: invalid group field number`);
    if (wire === 4) {
      if (number !== groupNumber) throw new DuoshanProtoError(`${context}: mismatched group end`);
      return offset;
    }
    if (wire === 3) {
      offset = skipGroup(buffer, offset, number, context);
    } else if (wire === 0) {
      [, offset] = readVarint(buffer, offset);
    } else if (wire === 1) {
      if (offset + 8 > buffer.length) throw new DuoshanProtoError(`${context}: group fixed64 truncated`);
      offset += 8;
    } else if (wire === 2) {
      const [length, bodyOffset] = readVarint(buffer, offset);
      if (length > BigInt(buffer.length) || bodyOffset + Number(length) > buffer.length) throw new DuoshanProtoError(`${context}: group field truncated`);
      offset = bodyOffset + Number(length);
    } else if (wire === 5) {
      if (offset + 4 > buffer.length) throw new DuoshanProtoError(`${context}: group fixed32 truncated`);
      offset += 4;
    } else {
      throw new DuoshanProtoError(`${context}: unsupported group wire type ${wire}`);
    }
  }
  throw new DuoshanProtoError(`${context}: group end truncated`);
}

function fields(buffer, context) {
  const result = new Map();
  let offset = 0;
  while (offset < buffer.length) {
    const [key, next] = readVarint(buffer, offset);
    offset = next;
    const number = Number(key >> 3n), wire = Number(key & 7n);
    if (!number) throw new DuoshanProtoError(`${context}: invalid field number`);
    let value;
    if (wire === 3) {
      // A few 1.1.x PC responses still carry deprecated protobuf group
      // extensions. They are not part of the conversation fields we need,
      // but must be skipped as a complete nested value instead of rejecting
      // the entire response.
      offset = skipGroup(buffer, offset, number, context);
      continue;
    }
    if (wire === 4) throw new DuoshanProtoError(`${context}: unexpected group end`);
    if (wire === 0) [value, offset] = readVarint(buffer, offset);
    else if (wire === 1) {
      if (offset + 8 > buffer.length) throw new DuoshanProtoError(`${context}: fixed64 truncated`);
      value = buffer.subarray(offset, offset + 8); offset += 8;
    } else if (wire === 2) {
      const [length, bodyOffset] = readVarint(buffer, offset);
      if (length > BigInt(buffer.length) || bodyOffset + Number(length) > buffer.length) throw new DuoshanProtoError(`${context}: field truncated`);
      offset = bodyOffset; value = buffer.subarray(offset, offset + Number(length)); offset += Number(length);
    } else if (wire === 5) {
      if (offset + 4 > buffer.length) throw new DuoshanProtoError(`${context}: fixed32 truncated`);
      value = buffer.subarray(offset, offset + 4); offset += 4;
    } else throw new DuoshanProtoError(`${context}: unsupported wire type ${wire}`);
    const values = result.get(number) || [];
    values.push({ wire, value }); result.set(number, values);
  }
  return result;
}

function first(map, number, wire, fallback) {
  const values = map.get(number);
  if (values?.length > 1) throw new DuoshanProtoError(`Field ${number} is repeated unexpectedly`);
  const item = values?.[0];
  if (!item) return fallback;
  if (item.wire !== wire) throw new DuoshanProtoError(`Field ${number} has unexpected wire type`);
  return item.value;
}

function knownFields(map, allowed, context) {
  for (const number of map.keys()) if (!allowed.has(number)) throw new DuoshanProtoError(`${context}: unknown field ${number}`);
}

function allBytes(map, number) {
  return (map.get(number) || []).map(item => {
    if (item.wire !== 2) throw new DuoshanProtoError(`Field ${number} has unexpected wire type`);
    return item.value;
  });
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
function stringValue(value, context) {
  if (!value) return '';
  try { return utf8.decode(value); }
  catch { throw new DuoshanProtoError(`${context}: invalid UTF-8`); }
}

function decodeBase64(value, context) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_RESPONSE_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new DuoshanProtoError(`${context}: invalid base64`);
  }
  const raw = Buffer.from(value, 'base64');
  if (!raw.length || raw.length > MAX_RESPONSE_BYTES) throw new DuoshanProtoError(`${context}: response size is invalid`);
  const canonical = raw.toString('base64').replace(/=+$/, '');
  if (canonical !== value.replace(/=+$/, '')) throw new DuoshanProtoError(`${context}: non-canonical base64`);
  return raw;
}

function mapStrings(entries, context) {
  const output = {};
  for (const raw of entries) {
    const item = fields(raw, context);
    const key = stringValue(first(item, 1, 2, Buffer.alloc(0)), context);
    const value = stringValue(first(item, 2, 2, Buffer.alloc(0)), context);
    if (key) output[key] = value;
  }
  return output;
}

function parseParticipant(raw) {
  const data = fields(raw, 'Participant');
  return {
    uid: String(first(data, 1, 0, 0n)),
    secUid: stringValue(first(data, 5, 2, Buffer.alloc(0)), 'Participant.sec_uid')
  };
}

function urlFromValue(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return '';
  if (Buffer.isBuffer(value)) {
    const text = value.toString('utf8');
    const match = text.match(/https?:\/\/[^\s\u0000\"']+/i);
    if (match) return urlFromValue(match[0], depth + 1);
    try { const nested = fields(value, 'ConversationInfo.avatar'); for (const items of nested.values()) for (const item of items) { const found = urlFromValue(item.value, depth + 1); if (found) return found; } } catch { /* opaque avatar descriptor */ }
    return '';
  }
  if (typeof value === 'string') {
    if (!/^https?:\/\//i.test(value)) return '';
    try { const url = new URL(value); return /(?:douyinpic\.com|byteimg\.com|douyincdn\.com|bytedance\.com)$/i.test(url.hostname) || /\.(?:douyinpic|byteimg|douyincdn)\.com$/i.test(url.hostname) ? url.href : ''; } catch { return ''; }
  }
  if (Array.isArray(value)) for (const item of value) { const found = urlFromValue(item, depth + 1); if (found) return found; }
  if (typeof value === 'object') for (const item of Object.values(value)) { const found = urlFromValue(item, depth + 1); if (found) return found; }
  return '';
}

function parseParticipantsPage(raw) {
  if (!raw) return [];
  const data = fields(raw, 'ParticipantsPage');
  return allBytes(data, 1).map(parseParticipant);
}

function parseConversation(raw, accountUid) {
  const data = fields(raw, 'ConversationInfo');
  // Two PC 1.1.x descriptor revisions are seen in the wild.  The newer one
  // puts participants/ext/ticket at 3/9/10; the older one uses the native
  // response layout 6/50 with short_id/type/ticket at 2/3/4.  Accept both
  // layouts without falling back to Web or client protocols.
  knownFields(data, new Set([...Array.from({ length: 17 }, (_, index) => index + 1), 50]), 'ConversationInfo');
  const protocolId = stringValue(first(data, 1, 2), 'ConversationInfo.conversation_id');
  if (!protocolId || protocolId.length > 300) throw new DuoshanProtoError('ConversationInfo.conversation_id is invalid');
  const legacy = data.get(3)?.[0]?.wire === 0 || data.get(6)?.[0]?.wire === 2 && data.get(50)?.[0]?.wire === 2;
  const protocolType = Number(first(data, legacy ? 3 : 2, 0, 0n));
  const participants = legacy
    ? allBytes(data, 6).flatMap(rawPage => parseParticipantsPage(rawPage))
    : parseParticipantsPage(first(data, 3, 2));
  const other = participants.find(item => item.uid && item.uid !== accountUid) || participants.find(item => item.uid);
  const core = legacy ? first(data, 50, 2, Buffer.alloc(0)) : Buffer.alloc(0);
  const coreFields = core.length ? fields(core, 'ConversationInfo.core') : new Map();
  const ext = mapStrings(legacy ? allBytes(coreFields, 11) : allBytes(data, 9), 'ConversationInfo.ext');
  const type = protocolType === 2 ? 'group' : 'private';
  const peerId = type === 'private' ? (other?.secUid || other?.uid || protocolId) : protocolId;
  const coreName = legacy ? stringValue(first(coreFields, 5, 2, Buffer.alloc(0)), 'ConversationInfo.core.name') : '';
  const coreAvatar = legacy ? urlFromValue(coreFields.get(7)?.map(item => item.value) || []) : '';
  const title = ['name', 'conversation_name', 'a:s_name', 'nick_name'].map(key => ext[key]).find(Boolean) || coreName || other?.uid || protocolId;
  return {
    protocolId,
    protocolType,
    type,
    peerId: String(peerId).slice(0, 200),
    title: String(title).slice(0, 100),
    ticket: stringValue(first(data, legacy ? 4 : 10, 2, Buffer.alloc(0)), 'ConversationInfo.ticket').slice(0, 2000),
    shortId: String(first(data, legacy ? 2 : 11, 0, 0n)),
    avatar: coreAvatar,
    unread: Math.min(Number(first(data, 16, 0, 0n)), 2147483647)
  };
}

function displayContent(raw, messageType) {
  const content = stringValue(raw, 'MessageBody.content');
  const formatted = formatDouyinMessageContent(content, messageType);
  if (formatted) return formatted;
  return ({ 5: '[表情]', 7: '[文本消息]', 8: '[分享视频]', 17: '[语音]', 27: '[图片]', 60: '[分享卡片]' })[Number(messageType)] || null;
}

function mediaContent(raw, messageType) {
  let data;
  try { data = JSON.parse(stringValue(raw, 'MessageBody.content')); } catch { return null; }
  if (!data || typeof data !== 'object' || ![5, 27].includes(Number(messageType))) return null;
  const urlFrom = (value, depth = 0) => {
    if (depth > 8 || value === null || value === undefined) return '';
    if (typeof value === 'string') {
      if (!/^https:\/\//i.test(value)) return '';
      try { const url = new URL(value), host = url.hostname.toLowerCase(); return ['douyinpic.com', 'byteimg.com', 'douyincdn.com', 'bytedance.com'].some(domain => host === domain || host.endsWith(`.${domain}`)) ? url.href : ''; } catch { return ''; }
    }
    if (Array.isArray(value)) { for (const item of value) { const found = urlFrom(item, depth + 1); if (found) return found; } return ''; }
    if (typeof value === 'object') for (const nested of Object.values(value)) { const found = urlFrom(nested, depth + 1); if (found) return found; }
    return '';
  };
  const skeyFrom = (value, depth = 0) => {
    if (depth > 8 || !value || typeof value !== 'object') return '';
    if (typeof value.skey === 'string' && /^[\da-f]{64}$/i.test(value.skey.trim())) return value.skey.trim();
    for (const nested of Object.values(value)) { const found = skeyFrom(nested, depth + 1); if (found) return found; }
    return '';
  };
  return Number(messageType) === 5
    ? { kind: 'emoji', url: urlFrom(data), name: String(data.display_name || '').slice(0, 100), width: Number(data.width || data.url?.width || 0) || 0, height: Number(data.height || data.url?.height || 0) || 0 }
    : { kind: 'image', url: urlFrom(data), skey: skeyFrom(data), width: Number(data.cover_width || data.width || 0) || 0, height: Number(data.cover_height || data.height || 0) || 0 };
}

function timestamp(value) {
  if (!value) return 0;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) throw new DuoshanProtoError('MessageBody.create_time is invalid');
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

function parseMessage(raw, accountUid, expectedConversationId = '') {
  const data = fields(raw, 'MessageBody');
  knownFields(data, new Set(Array.from({ length: 19 }, (_, index) => index + 1)), 'MessageBody');
  const conversationId = stringValue(first(data, 1, 2, Buffer.from(expectedConversationId)), 'MessageBody.conversation_id');
  const serverMessageId = String(first(data, 3, 0, 0n));
  if (!conversationId || serverMessageId === '0') throw new DuoshanProtoError('MessageBody identity is incomplete');
  const sender = String(first(data, 7, 0, 0n));
  const messageType = Number(first(data, 6, 0, 0n));
  const content = displayContent(first(data, 8, 2, Buffer.alloc(0)), messageType);
  const media = mediaContent(first(data, 8, 2, Buffer.alloc(0)), messageType);
  if (content === null && media === null) return null;
  return {
    conversationId,
    serverMessageId,
    sender,
    direction: sender && sender === accountUid ? 'outbound' : 'inbound',
    messageType,
    content,
    media,
    created: timestamp(first(data, 10, 0, 0n))
  };
}

function responseBody(raw, expectedCommand) {
  const response = fields(raw, 'Response');
  knownFields(response, new Set(Array.from({ length: 12 }, (_, index) => index + 1)), 'Response');
  const command = Number(first(response, 1, 0, 0n));
  if (command !== expectedCommand) throw new DuoshanProtoError(`Unexpected response command ${command}`);
  const status = Number(first(response, 3, 0, 0n));
  if (status !== 0) {
    const description = stringValue(first(response, 4, 2, Buffer.alloc(0)), 'Response.error_desc').slice(0, 200);
    throw new DuoshanProtoError(`Upstream command ${command} failed (${status})${description ? `: ${description}` : ''}`);
  }
  const container = fields(first(response, 6, 2), 'ResponseBody');
  knownFields(container, new Set([expectedCommand]), 'ResponseBody');
  const bodies = allBytes(container, expectedCommand);
  if (bodies.length !== 1) throw new DuoshanProtoError(`Response body for command ${expectedCommand} is missing or repeated`);
  return bodies[0];
}

function parseConversationList(raw, accountUid) {
  const data = fields(responseBody(raw, 300), 'ConversationsListResponseBody');
  knownFields(data, new Set([1, 2, 3]), 'ConversationsListResponseBody');
  return {
    conversations: allBytes(data, 1).map(item => parseConversation(item, accountUid)),
    nextCursor: String(first(data, 2, 0, 0n)),
    hasMore: first(data, 3, 0, 0n) !== 0n
  };
}

function parseHistory(raw, accountUid, expectedConversationId) {
  const data = fields(responseBody(raw, 301), 'MessagesInConversationResponseBody');
  knownFields(data, new Set([1, 2, 3]), 'MessagesInConversationResponseBody');
  const messages = allBytes(data, 1).map(item => parseMessage(item, accountUid, expectedConversationId)).filter(Boolean);
  if (messages.some(item => item.conversationId !== expectedConversationId)) throw new DuoshanProtoError('History response contains another conversation');
  return {
    conversationId: expectedConversationId,
    messages,
    nextCursor: String(first(data, 2, 0, 0n)),
    hasMore: first(data, 3, 0, 0n) !== 0n
  };
}

export function parseDuoshanSyncPayload(payload, accountUid) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof accountUid !== 'string' || !/^\d{1,30}$/.test(accountUid)) {
    throw new DuoshanProtoError('Sync payload or account UID is invalid');
  }
  if (!payload.list || typeof payload.list !== 'object' || payload.list.command !== 300) throw new DuoshanProtoError('Conversation-list response is missing');
  if (!Array.isArray(payload.histories) || payload.histories.length > MAX_HISTORY_RESPONSES) throw new DuoshanProtoError('History response count is invalid');
  const list = parseConversationList(decodeBase64(payload.list.data, 'Conversation list'), accountUid);
  const known = new Set(list.conversations.map(item => item.protocolId));
  const seen = new Set();
  const histories = payload.histories.map((item, index) => {
    if (!item || typeof item !== 'object' || item.command !== 301 || typeof item.conversationId !== 'string' || !known.has(item.conversationId) || seen.has(item.conversationId)) {
      throw new DuoshanProtoError(`History response ${index} is invalid`);
    }
    seen.add(item.conversationId);
    return parseHistory(decodeBase64(item.data, `History ${index}`), accountUid, item.conversationId);
  });
  return { ...list, histories };
}
