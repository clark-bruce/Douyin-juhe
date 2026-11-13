import { randomInt } from 'node:crypto';
import { parseDuoshanSyncPayload, DuoshanProtoError } from './duoshan-sync.js';
import { extractDouyinMessageMedia, formatDouyinMessageContent } from './douyin-web-sync.js';

// The server-side sync path is deliberately kept separate from the launcher.
// It only consumes the encrypted Duoshan PC cookie after material-vault has
// opened it; no Web/Creator/client credentials are accepted here.
const API_ORIGIN = 'https://imapi3-normal.zijieapi.com';
const USER_AGENT = 'DouyinChat/1.1.33';
const SDK_VERSION = '1.1.33';
const BUILD_NUMBER = '1.1.33(420753164)';
const REQUEST_BODY = { conversations: 300, history: 301 };
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

// Duoshan PC 1.1.33 的账号级初始化请求。300/301 是另一套旧网关形态，
// 当前服务端对它会返回只有头部的空响应；会话列表和最近消息必须走 2043。
const PC_INIT_REQUEST_B64 = 'CPsPEJJOGgUwLjEuOCIAKAMwAToYMGQ1MDkzNTpmZWF0L3BjLWltLWdyb3VwQg7afwsImozqlKnKlQMQAUoBMFoJZG91eWluX3BjcgYzNjAwMDB6EwoLc2Vzc2lvbl9haWQSBDYzODN6EAoLc2Vzc2lvbl9kaWQSATB6FQoIYXBwX25hbWUSCWRvdXlpbl9wY3oVCg9wcmlvcml0eV9yZWdpb24SAmNuen0KCnVzZXJfYWdlbnQSb01vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS8xNDQuMC4wLjAgU2FmYXJpLzUzNy4zNnoWCg5jb29raWVfZW5hYmxlZBIEdHJ1ZXoZChBicm93c2VyX2xhbmd1YWdlEgV6aC1DTnoZChBicm93c2VyX3BsYXRmb3JtEgVXaW4zMnoXCgxicm93c2VyX25hbWUSB01vemlsbGF6egoPYnJvd3Nlcl92ZXJzaW9uEmc1LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzE0NC4wLjAuMCBTYWZhcmkvNTM3LjM2ehYKDmJyb3dzZXJfb25saW5lEgR0cnVlehQKDHNjcmVlbl93aWR0aBIEMTI4MHoUCg1zY3JlZW5faGVpZ2h0EgM3MjB6IgoHcmVmZXJlchIXaHR0cHM6Ly93d3cuZG91eWluLmNvbS96HgoNdGltZXpvbmVfbmFtZRINQXNpYS9TaGFuZ2hhaXoNCghkZXZpY2VJZBIBMHoNCghpcy1yZXRyeRIBMJABAaoBCmRvdXlpbl93ZWKyAQd3ZWJfc2Rr';

function readWire(data, start = 0) {
  let value = 0n, shift = 0n, offset = start;
  while (offset < data.length && shift < 70n) {
    const byte = data[offset++]; value |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [value, offset]; shift += 7n;
  }
  throw new Error('Duoshan protobuf varint truncated');
}

function skipWireGroup(data, start, number) {
  let offset = start;
  while (offset < data.length) {
    const [key, next] = readWire(data, offset); offset = next;
    const field = Number(key >> 3n), wire = Number(key & 7n);
    if (wire === 4) { if (field !== number) throw new Error('Duoshan protobuf group mismatch'); return offset; }
    if (wire === 3) offset = skipWireGroup(data, offset, field);
    else if (wire === 0) [, offset] = readWire(data, offset);
    else if (wire === 1) offset += 8;
    else if (wire === 2) { const [length, body] = readWire(data, offset); offset = body + Number(length); }
    else if (wire === 5) offset += 4;
    else throw new Error(`Duoshan protobuf wire ${wire} unsupported`);
  }
  throw new Error('Duoshan protobuf group truncated');
}

export function wireFields(data) {
  const result = new Map();
  for (let offset = 0; offset < data.length;) {
    const [key, next] = readWire(data, offset); offset = next;
    const number = Number(key >> 3n), wire = Number(key & 7n);
    let value;
    if (wire === 0) [value, offset] = readWire(data, offset);
    else if (wire === 1) { value = data.subarray(offset, offset + 8); offset += 8; }
    else if (wire === 2) { const [length, body] = readWire(data, offset); offset = body; value = data.subarray(offset, offset + Number(length)); offset += Number(length); }
    else if (wire === 3) { offset = skipWireGroup(data, offset, number); continue; }
    else if (wire === 4) throw new Error('Duoshan protobuf unexpected group end');
    else if (wire === 5) { value = data.subarray(offset, offset + 4); offset += 4; }
    else throw new Error(`Duoshan protobuf wire ${wire} unsupported`);
    const values = result.get(number) || []; values.push({ wire, value }); result.set(number, values);
  }
  return result;
}

export const firstWire = (map, number) => map.get(number)?.[0];
export const bytesWire = (map, number) => (map.get(number) || []).filter(item => item.wire === 2).map(item => item.value);
const wireEntries = map => [...map.entries()].flatMap(([number, items]) => items.map(item => ({ number, ...item })));
const textWire = (item) => Buffer.isBuffer(item?.value) ? item.value.toString('utf8') : String(item?.value ?? '');
export const safeText = (item) => textWire(item).replace(/[\u0000-\u001f]/g, '').slice(0, 5000);

function stringMap(entries) {
  const result = {};
  for (const raw of entries) {
    let fields;
    try { fields = wireFields(raw); } catch { continue; }
    const key = safeText(firstWire(fields, 1));
    const value = safeText(firstWire(fields, 2));
    if (key && value) result[key] = value;
  }
  return result;
}

function findUrl(value, depth = 0) {
  if (depth > 6 || value === undefined) return '';
  if (Buffer.isBuffer(value)) {
    const text = value.toString('utf8'); const match = text.match(/https?:\/\/[^\s"']+/i);
    if (match) return findUrl(match[0], depth + 1);
    try { for (const items of wireFields(value).values()) for (const item of items) { const url = findUrl(item.value, depth + 1); if (url) return url; } } catch {}
    return '';
  }
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
    try { const url = new URL(value); const host = url.hostname.toLowerCase(); if (['douyinpic.com', 'byteimg.com', 'douyincdn.com', 'bytedance.com'].some(x => host === x || host.endsWith(`.${x}`))) return url.href; } catch {}
  }
  if (Array.isArray(value)) {
    for (const item of value) { const url = findUrl(item, depth + 1); if (url) return url; }
  } else if (value && typeof value === 'object') {
    for (const key of ['url_list', 'origin_url_list', 'large_url_list', 'medium_url_list', 'thumb_url_list', 'still_url_list', 'download_url_list', 'url', 'uri', 'resource_url', 'avatar', 'avatar_thumb', 'avatar_medium', 'avatar_larger']) {
      if (key in value) { const url = findUrl(value[key], depth + 1); if (url) return url; }
    }
    for (const nested of Object.values(value)) { const url = findUrl(nested, depth + 1); if (url) return url; }
  }
  return '';
}

function parsePcConversation(raw, accountUid) {
  const data = wireFields(raw), protocolId = safeText(firstWire(data, 1));
  const shortId = String(firstWire(data, 2)?.value ?? '0'), protocolType = Number(firstWire(data, 3)?.value ?? 0);
  if (!protocolId) return null;
  const core = firstWire(data, 50)?.value; const coreFields = core ? wireFields(core) : new Map();
  // 1.1.33 has two metadata locations: legacy core fields and the newer
  // string-extension map. Both are present for some private conversations;
  // keeping only the group name made private rows fall back to numeric UIDs.
  const ext = stringMap([...bytesWire(data, 9), ...bytesWire(coreFields, 11)]);
  const coreName = safeText(firstWire(coreFields, 5));
  const title = ext.name || ext.conversation_name || ext['a:s_name'] || ext.nick_name || coreName || (isGroupPlaceholder(protocolType) ? protocolId : '');
  const avatar = findUrl(coreFields.get(7)?.map(item => item.value) || []);
  const members = bytesWire(data, 6).flatMap(page => bytesWire(wireFields(page), 1)).map(member => {
    const fields = wireFields(member); return {
      uid: String(firstWire(fields, 1)?.value ?? ''),
      secUid: safeText(firstWire(fields, 5)),
      name: safeText(firstWire(fields, 2)) || safeText(firstWire(fields, 3)),
      avatar: findUrl([...fields.values()].flat().map(item => item.value)),
    };
  });
  const isGroup = protocolType === 2;
  const other = members.find(item => item.uid && item.uid !== accountUid) || members.find(item => item.uid);
  const accountProfile = members.find(item => item.uid === accountUid) || null;
  const type = isGroup ? 'group' : 'private';
  const badgeCount = Number(firstWire(data, 10)?.value ?? 0);
  return { protocolId, protocolType, type, peerId: isGroup ? protocolId : (other?.uid || protocolId), peerSecUid: isGroup ? '' : (other?.secUid || ''), peerName: isGroup ? '' : (other?.name || ''), title, shortId, ticket: safeText(firstWire(data, 4)), avatar: avatar || (isGroup ? '' : (other?.avatar || '')), unread: Number.isSafeInteger(badgeCount) ? Math.max(0, Math.min(badgeCount, 2147483647)) : 0, accountProfile: accountProfile ? { uid: accountProfile.uid, name: /^\d+$/.test(accountProfile.name || '') ? '' : (accountProfile.name || ''), avatar: accountProfile.avatar || '', secUid: accountProfile.secUid || '' } : null };
}

function isGroupPlaceholder(protocolType) { return Number(protocolType) === 2; }

function parsePcMessage(raw, accountUid, expectedConversationId) {
  const data = wireFields(raw), conversationId = safeText(firstWire(data, 1)) || expectedConversationId;
  const serverMessageId = String(firstWire(data, 3)?.value ?? ''); if (!serverMessageId) return null;
  const messageType = Number(firstWire(data, 6)?.value ?? 0), sender = String(firstWire(data, 7)?.value ?? '');
  const rawContent = safeText(firstWire(data, 8));
  let decoded = null;
  try { decoded = JSON.parse(rawContent); } catch { /* plain text is valid content */ }
  const media = extractDouyinMessageMedia(decoded, messageType);
  const formatted = formatDouyinMessageContent(rawContent, messageType);
  // Do not persist opaque system events as fake chat messages. A media
  // payload remains renderable even when its textual formatter is empty.
  if (formatted === null && !media) return null;
  const content = formatted || ({ 5: '[表情]', 8: '[分享视频]', 17: '[语音]', 27: '[图片]', 60: '[分享卡片]' })[messageType] || '[消息]';
  const senderSecUid = safeText(firstWire(data, 14));
  const diagnostic = [...data.entries()].map(([number, items]) => ({ number, items: items.map(item => ({ wire: item.wire, text: item.wire === 2 ? item.value.toString('utf8').slice(0, 2000) : '', hex: item.wire === 2 ? item.value.toString('hex').slice(0, 500) : String(item.value) })) }));
  const timestamp = Number(firstWire(data, 10)?.value ?? 0); return { conversationId, serverMessageId, sender, senderSecUid, direction: sender === accountUid ? 'outbound' : 'inbound', messageType, content: String(content).slice(0, 5000), media, created: timestamp < 1e12 ? timestamp * 1000 : timestamp, rawContent, diagnostic };
}

function parsePcResponse(raw) {
  const outer = wireFields(raw), status = Number(firstWire(outer, 3)?.value ?? 0); if (status !== 0) throw new Error(`Duoshan upstream status ${status}: ${safeText(firstWire(outer, 4))}`);
  const container = firstWire(outer, 6)?.value; if (!container) throw new Error('Duoshan response body missing');
  const command = wireFields(container).get(2043)?.[0]?.value; if (!command) throw new Error('Duoshan init body missing');
  const body = wireFields(command);
  const cursor = firstWire(body, 3);
  return {
    body,
    hasMore: Number(firstWire(body, 2)?.value ?? 0) !== 0,
    nextCursor: cursor && (cursor.wire === 0 || cursor.wire === 2)
      ? { wire: cursor.wire, value: cursor.wire === 0 ? String(cursor.value) : safeText(cursor) }
      : null
  };
}

export async function fetchDuoshanPcInitSync({ uid, cookie, maxConversations = 100, historyLimit = 100, maxPages = 8, fetchImpl = fetch } = {}) {
  const accountUid = String(uid || '').trim(); if (!/^\d{1,30}$/.test(accountUid)) throw new Error('Duoshan UID is invalid');
  if (typeof cookie !== 'string' || !/(?:^|;\s*)sessionid=[^;\s]+/.test(cookie)) throw new Error('Duoshan cookie is invalid');
  const max = Number(maxConversations), limit = Number(historyLimit), pages = Number(maxPages);
  if (!Number.isSafeInteger(max) || max < 1 || max > 300) throw new Error('Duoshan conversation limit is invalid');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Duoshan history limit is invalid');
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > 20) throw new Error('Duoshan init page limit is invalid');
  const conversations = [], histories = [], conversationMap = new Map(), historyMap = new Map();
  const seenCursors = new Set();
  let cursor = null, hasMore = false, nextCursor = null;
  for (let page = 0; page < pages && conversations.length < max; page++) {
    const response = await post('/v1/message/get_message_by_init', cookie, buildPcInitRequest(cursor), fetchImpl);
    const parsed = parsePcResponse(response), entries = bytesWire(parsed.body, 1);
    for (const entry of entries) {
      const fields = wireFields(entry), conversation = parsePcConversation(firstWire(fields, 1)?.value, accountUid); if (!conversation) continue;
      const existing = conversationMap.get(conversation.protocolId);
      if (existing) {
        if (!existing.avatar && conversation.avatar) existing.avatar = conversation.avatar;
        if (!existing.title && conversation.title) existing.title = conversation.title;
      } else if (conversations.length < max) {
        conversationMap.set(conversation.protocolId, conversation); conversations.push(conversation);
      }
      const target = conversationMap.get(conversation.protocolId);
      if (!target) continue;
      const messages = bytesWire(fields, 2).slice(0, limit).map(raw => parsePcMessage(raw, accountUid, conversation.protocolId)).filter(Boolean);
      let history = historyMap.get(conversation.protocolId);
      if (!history) { history = { conversationId: conversation.protocolId, messages: [], nextCursor: '0', hasMore: false }; historyMap.set(conversation.protocolId, history); histories.push(history); }
      const knownMessages = new Set(history.messages.map(item => item.serverMessageId));
      for (const message of messages) if (!knownMessages.has(message.serverMessageId)) { knownMessages.add(message.serverMessageId); history.messages.push(message); }
    }
    hasMore = parsed.hasMore; nextCursor = parsed.nextCursor;
    const cursorKey = nextCursor ? `${nextCursor.wire}:${nextCursor.value}` : '';
    if (!hasMore || !cursorKey || seenCursors.has(cursorKey)) break;
    seenCursors.add(cursorKey); cursor = nextCursor;
  }
  const accountProfile = conversations.map(item => item.accountProfile).find(item => item && (item.name || item.avatar || item.secUid)) || null;
  for (const item of conversations) delete item.accountProfile;
  return { conversations, histories, accountProfile, nextCursor: nextCursor ? String(nextCursor.value) : '0', hasMore };
}

export function varint(value) {
  let input = BigInt(value);
  if (input < 0n) throw new Error('Duoshan protobuf value cannot be negative');
  const out = [];
  do {
    let byte = Number(input & 0x7fn);
    input >>= 7n;
    if (input) byte |= 0x80;
    out.push(byte);
  } while (input);
  return Buffer.from(out);
}

export function fieldVarint(number, value) {
  return Buffer.concat([varint(BigInt(number) << 3n), varint(value)]);
}

export function fieldBytes(number, value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([varint((BigInt(number) << 3n) | 2n), varint(body.length), body]);
}

export function fieldString(number, value) {
  return fieldBytes(number, Buffer.from(String(value), 'utf8'));
}

// 2043 uses the same page envelope as the Duoshan PC 1.1.33 client.  The
// first request must omit the cursor and set reset=0; continuation requests
// carry the server cursor and set reset=1.  Keeping this in the PC adapter is
// important: reusing a persisted cursor from an older protocol can make the
// server return only the old page forever.
function buildPcInitRequest(cursor = null) {
  const outer = wireFields(Buffer.from(PC_INIT_REQUEST_B64, 'base64'));
  const bodyRaw = firstWire(outer, 8)?.value;
  if (!bodyRaw) throw new Error('Duoshan init request body missing');
  const body = wireFields(bodyRaw);
  const commandRaw = body.get(2043)?.[0]?.value;
  if (!commandRaw) throw new Error('Duoshan init command missing');
  let command = wireEntries(wireFields(commandRaw));
  const cursorWire = cursor && typeof cursor === 'object' ? Number(cursor.wire) : 2;
  const cursorValue = cursor && typeof cursor === 'object' ? cursor.value : cursor;
  if (cursor !== null && cursorWire !== 0 && cursorWire !== 2) throw new Error('Duoshan init cursor wire type is invalid');
  const withoutCursor = command.filter(item => item.number !== 1 && item.number !== 2);
  if (cursor !== null) {
    const value = cursorWire === 0 ? boundedCursor(cursorValue, 'init cursor') : Buffer.from(String(cursorValue ?? ''), 'utf8');
    withoutCursor.push({ number: 1, wire: cursorWire, value });
    withoutCursor.push({ number: 2, wire: 0, value: 1n });
  } else {
    withoutCursor.push({ number: 2, wire: 0, value: 0n });
  }
  withoutCursor.sort((a, b) => a.number - b.number);
  const nextBody = wireEntries(body).filter(item => item.number !== 2043);
  nextBody.push({ number: 2043, wire: 2, value: encodeWireFields(withoutCursor) });
  nextBody.sort((a, b) => a.number - b.number);
  const nextOuter = wireEntries(outer).filter(item => item.number !== 2 && item.number !== 8);
  nextOuter.push({ number: 2, wire: 0, value: BigInt(Date.now() % 2_000_000_000) });
  nextOuter.push({ number: 8, wire: 2, value: encodeWireFields(nextBody) });
  nextOuter.sort((a, b) => a.number - b.number);
  return encodeWireFields(nextOuter);
}

function encodeWireField(item) {
  if (!item || item.number === undefined || item.wire === undefined) throw new Error(`Duoshan init field is malformed: ${JSON.stringify(item)}`);
  const key = varint((BigInt(item.number) << 3n) | BigInt(item.wire));
  if (item.wire === 0) { if (item.value === undefined) throw new Error(`Duoshan init varint field ${item.number} is missing`); return Buffer.concat([key, varint(item.value)]); }
  if (item.wire === 1 || item.wire === 5) return Buffer.concat([key, item.value]);
  if (item.wire === 2) return Buffer.concat([key, varint(item.value.length), item.value]);
  throw new Error(`Duoshan init wire ${item.wire} unsupported`);
}

const encodeWireFields = fields => Buffer.concat(fields.map(encodeWireField));

function boundedCursor(value, name = 'cursor') {
  const text = String(value ?? '0');
  if (!/^\d{1,30}$/.test(text)) throw new Error(`${name} is invalid`);
  const number = BigInt(text);
  if (number > 9_223_372_036_854_775_807n) throw new Error(`${name} is too large`);
  return number;
}

export function buildRequest({ uid, command, bodyField, body, sequenceId = randomInt(100000, 900000) }) {
  // Keep this envelope byte-compatible with the 1.1.33 PC SDK. The desktop
  // client includes the empty token, refer, inbox and build fields, but does
  // not put the account UID in device_id; UID is carried by the cookie.
  const inner = fieldBytes(bodyField, body);
  return Buffer.concat([
    fieldVarint(1, command), fieldVarint(2, sequenceId),
    fieldString(3, SDK_VERSION), fieldString(4, ''), fieldVarint(5, 0),
    fieldVarint(6, 1), fieldString(7, BUILD_NUMBER), fieldBytes(8, inner),
    fieldString(10, 'official'), fieldString(11, 'windows'),
    fieldString(12, 'x64'), fieldString(13, '10.0.19045'), fieldString(14, SDK_VERSION),
    fieldVarint(18, 1), fieldString(21, 'douyin_im_pc'), fieldString(22, 'cpp_sdk')
  ]);
}

export function buildConversationListRequest({ uid, cursor = 0, sequenceId } = {}) {
  const accountUid = String(uid || '').trim();
  if (!/^\d{1,30}$/.test(accountUid)) throw new Error('Duoshan UID is invalid');
  const body = fieldVarint(1, boundedCursor(cursor));
  return buildRequest({ uid: accountUid, command: 300, bodyField: REQUEST_BODY.conversations, body, sequenceId });
}

export function buildConversationHistoryRequest({ uid, conversationId, cursor = 0, limit = 50, sequenceId } = {}) {
  const accountUid = String(uid || '').trim();
  const id = String(conversationId || '').trim();
  if (!/^\d{1,30}$/.test(accountUid) || !id || id.length > 300) throw new Error('Duoshan history identity is invalid');
  const count = Number(limit);
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error('Duoshan history limit is invalid');
  // MessagesInConversationRequestBody: conversation_id=1, cursor=2, limit=3.
  const body = Buffer.concat([fieldString(1, id), fieldVarint(2, boundedCursor(cursor)), fieldVarint(3, count)]);
  return buildRequest({ uid: accountUid, command: 301, bodyField: REQUEST_BODY.history, body, sequenceId });
}

export async function post(path, cookie, body, fetchImpl) {
  const response = await fetchImpl(`${API_ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/x-protobuf',
      'content-type': 'application/x-protobuf',
      cookie,
      'user-agent': USER_AGENT,
      'x-tt-token': ''
    },
    body,
    signal: AbortSignal.timeout(20000)
  });
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error('Duoshan response is too large');
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.length > MAX_RESPONSE_BYTES) throw new Error('Duoshan response is too large');
  if (!response.ok) throw new Error(`Duoshan upstream HTTP ${response.status}`);
  return raw;
}

function rawResponse(command, data) {
  return { command, data: Buffer.from(data).toString('base64') };
}

/** Fetch cmd=300 plus bounded cmd=301 pages and return the API upload shape. */
export async function fetchDuoshanSync({
  uid, cookie, cursor = 0, maxConversations = 20, historyLimit = 50,
  historyCursors = {}, fetchImpl = fetch
} = {}) {
  const accountUid = String(uid || '').trim();
  if (!/^\d{1,30}$/.test(accountUid)) throw new Error('Duoshan UID is invalid');
  if (typeof cookie !== 'string' || !/(?:^|;\s*)sessionid=[^;\s]+/.test(cookie)) throw new Error('Duoshan cookie is invalid');
  const max = Number(maxConversations);
  const limit = Number(historyLimit);
  if (!Number.isSafeInteger(max) || max < 1 || max > 100) throw new Error('Duoshan conversation limit is invalid');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Duoshan history limit is invalid');

  const listRaw = await post('/v1/conversation/get_list', cookie,
    buildConversationListRequest({ uid: accountUid, cursor }), fetchImpl);
  const list = rawResponse(300, listRaw);
  let parsed;
  try { parsed = parseDuoshanSyncPayload({ list, histories: [] }, accountUid); }
  catch (error) { if (error instanceof DuoshanProtoError) throw new Error(`Duoshan conversation list parse failed: ${error.message}`); throw error; }

  const histories = [];
  for (const item of parsed.conversations.slice(0, max)) {
    const previous = historyCursors && typeof historyCursors === 'object' ? historyCursors[item.protocolId] : 0;
    try {
      const raw = await post('/v1/message/get_by_conversation', cookie,
        buildConversationHistoryRequest({ uid: accountUid, conversationId: item.protocolId, cursor: previous || 0, limit }), fetchImpl);
      histories.push({ command: 301, conversationId: item.protocolId, data: raw.toString('base64') });
    } catch (error) {
      // A single expired/removed conversation must not hide the rest of the
      // account. The server ingester records the successful pages only.
      if (histories.length === 0 && parsed.conversations.length === 1) throw error;
    }
  }
  return { list, histories };
}
