import { createPrivateKey, createPublicKey, randomUUID, sign } from 'node:crypto';
import { buildEmojiContent, uploadDuoshanImage } from './duoshan-media.js';

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function readVarint(buffer, start) {
  let value = 0n, shift = 0n, offset = start;
  while (offset < buffer.length && shift < 70n) {
    const byte = buffer[offset++];
    value |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [value, offset];
    shift += 7n;
  }
  throw new Error('Creator 回执 varint 不完整');
}

function skipValue(buffer, offset, wire) {
  if (wire === 0) return readVarint(buffer, offset)[1];
  if (wire === 1) {
    if (offset + 8 > buffer.length) throw new Error('Creator 回执不完整');
    return offset + 8;
  }
  if (wire === 2) {
    const [length, begin] = readVarint(buffer, offset), end = begin + Number(length);
    if (end > buffer.length) throw new Error('Creator 回执长度无效');
    return end;
  }
  if (wire === 5) {
    if (offset + 4 > buffer.length) throw new Error('Creator 回执不完整');
    return offset + 4;
  }
  throw new Error(`Creator 回执 wire 类型无效（${wire}）`);
}

function readGroup(buffer, start) {
  const contentStart = start;
  let offset = start, depth = 1;
  while (offset < buffer.length) {
    const keyStart = offset;
    const [key, next] = readVarint(buffer, offset); offset = next;
    const wire = Number(key & 7n);
    if (wire === 3) { depth++; continue; }
    if (wire === 4) {
      depth--;
      if (!depth) return [buffer.subarray(contentStart, keyStart), offset];
      continue;
    }
    offset = skipValue(buffer, offset, wire);
  }
  throw new Error('Creator 回执分组不完整');
}

function fields(buffer) {
  const result = [];
  for (let offset = 0; offset < buffer.length;) {
    const [key, next] = readVarint(buffer, offset); offset = next;
    const number = Number(key >> 3n), wire = Number(key & 7n);
    if (!number) throw new Error('Creator 回执字段无效');
    let value;
    if (wire === 0) [value, offset] = readVarint(buffer, offset);
    else if (wire === 2) {
      const [length, begin] = readVarint(buffer, offset), end = begin + Number(length);
      if (end > buffer.length) throw new Error('Creator 回执长度无效');
      value = buffer.subarray(begin, end); offset = end;
    } else if (wire === 1) { if (offset + 8 > buffer.length) throw new Error('Creator 回执不完整'); value = buffer.subarray(offset, offset + 8); offset += 8; }
    else if (wire === 5) { if (offset + 4 > buffer.length) throw new Error('Creator 回执不完整'); value = buffer.subarray(offset, offset + 4); offset += 4; }
    else if (wire === 3) [value, offset] = readGroup(buffer, offset);
    else throw new Error('Creator 回执 wire 类型无效');
    result.push({ number, wire: wire === 3 ? 2 : wire, value });
  }
  return result;
}
const first = (items, number, wire) => items.find(item => item.number === number && (wire === undefined || item.wire === wire));
const text = item => item?.wire === 2 ? item.value.toString('utf8') : '';
const number = item => item?.wire === 0 ? Number(item.value) : null;

function parseCreatorJsonSendResponse(raw, clientMessageId) {
  const source = raw.toString('utf8').trim();
  if (!source.startsWith('{')) return null;
  let parsed;
  try { parsed = JSON.parse(source); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const upstreamFeedback = value => {
    const allowed = ['decision', 'status_code', 'statusCode', 'check_code', 'checkCode', 'status_msg', 'error_desc', 'error_code', 'error_message', 'message', 'code'];
    const result = {};
    for (const key of allowed) {
      const candidate = value?.[key];
      if (['string', 'number', 'boolean'].includes(typeof candidate)) result[key] = String(candidate).slice(0, 160);
    }
    if (value?.data && typeof value.data === 'object' && !Array.isArray(value.data)) {
      const nested = {};
      for (const key of allowed) {
        const candidate = value.data[key];
        if (['string', 'number', 'boolean'].includes(typeof candidate)) nested[key] = String(candidate).slice(0, 160);
      }
      if (Object.keys(nested).length) result.data = nested;
    }
    return JSON.stringify(result).slice(0, 600);
  };
  const decision = String(parsed.decision || parsed.data?.decision || '').trim();
  if (decision) throw new Error(`Creator 上游拒绝（${decision.slice(0, 80)}）；抖音原始反馈：${upstreamFeedback(parsed)}`);
  const status = parsed.status_code ?? parsed.statusCode ?? parsed.data?.status_code;
  const checkCode = parsed.check_code ?? parsed.checkCode ?? parsed.data?.check_code;
  const detail = String(parsed.status_msg || parsed.error_desc || parsed.message || parsed.data?.message || '').slice(0, 160);
  if (status !== undefined && Number(status) !== 0 && Number(status) !== 7284) {
    throw new Error(`Creator 上游拒绝（${status}）${detail ? `：${detail}` : ''}`);
  }
  if (checkCode !== undefined && Number(checkCode) !== 0) {
    throw new Error(`Creator 上游校验失败（${checkCode}）${detail ? `：${detail}` : ''}`);
  }
  const warning = Number(status) === 7284 ? '已发送；对方可能因隐私设置无法回复' : '';
  const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
  const serverMessageId = String(parsed.server_message_id || parsed.serverMessageId || parsed.message_id || parsed.messageId
    || data.server_message_id || data.serverMessageId || data.message_id || data.messageId || '');
  if (!serverMessageId && !warning) {
    const error = new Error('Creator JSON 回执缺少 server_message_id，发送结果待确认');
    error.deliveryUncertain = true;
    throw error;
  }
  return { serverMessageId, clientMessageId: String(parsed.client_message_id || parsed.clientMessageId || clientMessageId), warning };
}

function parseCreatorProtobufSendResponse(raw, clientMessageId) {
  if (!raw.length || raw.length > MAX_RESPONSE_BYTES) throw new Error('Creator 回执大小无效');
  const outer = fields(raw), outerBody = first(outer, 6, 2)?.value || Buffer.alloc(0);
  const body = fields(outerBody), sendBody = first(body, 100, 2)?.value || Buffer.alloc(0);
  const send = fields(sendBody);
  const outerStatus = number(first(outer, 3, 0));
  const status = number(first(send, 3, 0));
  const checkCode = number(first(send, 5, 0));
  const numericServerId = number(first(send, 1, 0));
  const serverMessageId = String(numericServerId ?? (text(first(send, 1, 2)) || ''));
  const responseClientId = text(first(send, 4, 2));
  const detail = text(first(send, 6, 2)) || text(first(send, 2, 2));
  const rawText = raw.toString('utf8');
  let jsonStatus = null;
  const start = rawText.indexOf('{"status_code"');
  if (start >= 0) {
    try { jsonStatus = JSON.parse(rawText.slice(start, rawText.lastIndexOf('}') + 1)); } catch {}
  }
  const finalStatus = jsonStatus?.status_code ?? status;
  const finalCheckCode = jsonStatus?.check_code ?? checkCode;
  // 7284 is an accepted Creator send with a privacy notice attached. The
  // message is already delivered (the notice only says the recipient may not
  // reply), so it must not be converted into a failed outbox item.
  const warning = Number(finalStatus) === 7284
    ? '已发送；对方可能因隐私设置无法回复'
    : '';
  const outerDetail = text(first(outer, 4, 2)) || text(first(outer, 5, 2));
  if (outerStatus !== null && outerStatus !== 0) throw new Error(`Creator 上游外层拒绝（${outerStatus}）${outerDetail ? `：${outerDetail.slice(0, 240)}` : ''}`);
  if (finalStatus !== null && Number(finalStatus) !== 0 && Number(finalStatus) !== 7284) {
    // Douyin reuses the 7905 membership template for both direct and group
    // conversations. A direct conversation can therefore return the Chinese
    // text “你已不在群聊内”; do not imply that the local route was a group.
    if (Number(finalStatus) === 7905 && /你已不在群聊内/.test(detail)) {
      throw new Error('Creator 上游拒绝（7905）：上游判定当前会话成员关系无效（原始提示：你已不在群聊内；本地会话仍为私聊）');
    }
    throw new Error(`Creator 上游拒绝（${finalStatus}）${detail ? `：${detail.slice(0, 120)}` : ''}`);
  }
  if (finalCheckCode !== null && Number(finalCheckCode) !== 0) throw new Error(`Creator 上游校验失败（${finalCheckCode}）${detail ? `：${detail.slice(0, 120)}` : ''}`);
  if (!serverMessageId && !warning) throw new Error('Creator 回执缺少 server_message_id');
  // The web page owns the upstream client-message id; it is not the local
  // queue id passed by the API. Presence of a server id is the confirmation.
  return { serverMessageId, clientMessageId: responseClientId || clientMessageId, warning };
}


function walkHttpResponseComplete(raw, clientMessageId = '') {
  if (!raw || !raw.length || raw.length > 1048576) throw new Error('Creator 回执大小无效');
  let status = null, error = '', clientId = '', serverId = '';
  
  function walkJson(value) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [key, item] of Object.entries(value)) {
        const name = String(key || '').toLowerCase();
        if (['status_code','statuscode','code','check_code'].includes(name) && Number.isFinite(item)) {
          if (status === null || Number(item) !== 0) status = Number(item);
        }
        if (['status_msg','message','msg','error_msg','check_message','tips'].includes(name) && item) {
          if (!error) error = String(item);
        }
        if (['client_msg_id','client_message_id'].includes(name) && item) clientId = String(item);
        if (['server_msg_id','server_message_id','message_id','msg_id'].includes(name) && item) serverId = String(item);
        walkJson(item);
      }
    } else if (Array.isArray(value)) value.forEach(walkJson);
  }
  
  function readVarint(buffer, offset) {
    let value = 0n, shift = 0n;
    while (offset < buffer.length) {
      const byte = buffer[offset];
      value |= BigInt(byte & 0x7f) << shift;
      offset++;
      if (!(byte & 0x80)) break;
      shift += 7n;
    }
    return [value, offset];
  }
  
  function walk(blob, depth = 0) {
    if (depth > 10 || !blob || !Buffer.isBuffer(blob) || !blob.length) return;
    try {
      const text = blob.toString('utf8');
      if (text.trim().startsWith('{') || text.trim().startsWith('[')) walkJson(JSON.parse(text));
    } catch {}
    
    try {
      const fields = [];
      let offset = 0;
      while (offset < blob.length) {
        const [key, keyEnd] = readVarint(blob, offset);
        offset = keyEnd;
        const wire = Number(key & 7n), fieldNumber = Number(key >> 3n);
        let value, nextOffset = offset;
        
        if (wire === 0) {
          const [v, vEnd] = readVarint(blob, offset);
          value = Number(v);
          nextOffset = vEnd;
        } else if (wire === 2) {
          const [len, lenEnd] = readVarint(blob, offset);
          nextOffset = lenEnd;
          const lenNum = Number(len);
          if (nextOffset + lenNum > blob.length) break;
          value = blob.subarray(nextOffset, nextOffset + lenNum);
          nextOffset += lenNum;
        } else break;
        
        fields.push({ field: fieldNumber, wire, value });
        offset = nextOffset;
      }
      
      if (depth === 0) {
        for (const f of fields) {
          if (f.field === 3 && f.wire === 0 && typeof f.value === 'number') status = f.value;
        }
      }
      
      for (const f of fields) {
        if (f.wire === 2 && Buffer.isBuffer(f.value)) {
          try {
            const tv = f.value.toString('utf8');
            if (tv === clientMessageId) clientId = tv;
            else if (tv && tv.length < 500 && !tv.startsWith('\x00')) {
              if (tv.toUpperCase() === 'OK') status = 0;
              else if (!error && ['limit','risk','verify','error','failed','陌生人','风控'].some(t => tv.toLowerCase().includes(t))) error = tv;
            }
          } catch {}
          walk(f.value, depth + 1);
        }
      }
      
      const matching = fields.filter(f => f.field === 4 && f.wire === 2 && Buffer.isBuffer(f.value));
      if (matching.length > 0 && Buffer.isBuffer(matching[0].value) && matching[0].value.toString('utf8') === clientMessageId) {
        for (const f of fields) {
          if (f.field === 1 && f.wire === 0 && typeof f.value === 'number') serverId = String(f.value);
          else if (f.field === 1 && f.wire === 2 && Buffer.isBuffer(f.value)) {
            const candidate = f.value.toString('utf8').trim();
            if (/^\d+$/.test(candidate)) serverId = candidate;
          } else if (f.field === 3 && f.wire === 0 && typeof f.value === 'number') status = f.value;
          else if (f.field === 6 && f.wire === 2 && Buffer.isBuffer(f.value) && !error) error = f.value.toString('utf8');
        }
      }
    } catch {}
  }
  
  walk(raw);
  if (clientId && clientId !== clientMessageId) clientId = '';
  return { status, error, clientId, serverId };
}


export function parseCreatorSendResponse(raw, clientMessageId = '') {
  const result = walkHttpResponseComplete(raw, clientMessageId);
  
  if (result.status !== null && Number(result.status) !== 0 && Number(result.status) !== 7284) {
    if (Number(result.status) === 7905 && /你已不在群聊内/.test(result.error)) {
      throw new Error('Creator 上游拒绝（7905）：上游判定当前会话成员关系无效');
    }
    throw new Error(`Creator 上游拒绝（${result.status}）${result.error ? `: ${result.error.slice(0, 120)}` : ''}`);
  }

  const warning = Number(result.status) === 7284 ? '已发送；对方可能因隐私设置无法回复' : '';

  if (!result.serverId && !warning) {
    // HTTP 200 但没有服务端消息 ID：无法确认是否送达，不能当作失败后重发。
    throw Object.assign(new Error('Creator 回执缺少 server_message_id，发送结果待确认'), { deliveryUncertain: true });
  }

  return {
    serverMessageId: result.serverId,
    clientMessageId: result.clientId || clientMessageId,
    warning,
  };
}

function normalizeSameSite(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[-_]/g, '');
  if (normalized === 'strict') return 'Strict';
  if (normalized === 'lax') return 'Lax';
  if (normalized === 'none' || normalized === 'norestriction') return 'None';
  return undefined;
}

export function normalizeCreatorStorageState(state) {
  if (!state || !Array.isArray(state.cookies) || !Array.isArray(state.origins)) throw new Error('Creator 浏览器状态格式无效');
  const cookies = state.cookies.map(cookie => {
    if (!cookie || typeof cookie !== 'object') return cookie;
    const normalized = { ...cookie };
    const sameSite = normalizeSameSite(normalized.sameSite);
    if (sameSite) normalized.sameSite = sameSite;
    else delete normalized.sameSite;
    if (normalized.expires === undefined && normalized.expirationDate !== undefined) normalized.expires = Number(normalized.expirationDate);
    delete normalized.expirationDate;
    return normalized;
  });
  return { ...state, cookies };
}

function stateObject(material) {
  if (!material || typeof material.browserState !== 'string') throw new Error('Creator 浏览器状态不存在');
  let state;
  try { state = JSON.parse(material.browserState); } catch { throw new Error('Creator 浏览器状态无法解析'); }
  return normalizeCreatorStorageState(state);
}

function varint(value) {
  let input = BigInt(value);
  if (input < 0n) throw new Error('Creator 请求字段不能为负数');
  const bytes = [];
  do {
    let byte = Number(input & 0x7fn);
    input >>= 7n;
    if (input) byte |= 0x80;
    bytes.push(byte);
  } while (input);
  return Buffer.from(bytes);
}

function fieldVarint(fieldNumber, value) {
  return Buffer.concat([varint(BigInt(fieldNumber) << 3n), varint(value)]);
}

function fieldBytes(fieldNumber, value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([varint((BigInt(fieldNumber) << 3n) | 2n), varint(body.length), body]);
}

function fieldString(fieldNumber, value) {
  return fieldBytes(fieldNumber, Buffer.from(String(value), 'utf8'));
}

function mapEntry(key, value) {
  return Buffer.concat([fieldString(1, key), fieldString(2, value)]);
}

function fieldMap(fieldNumber, values) {
  return Object.entries(values || {}).map(([key, value]) => fieldBytes(fieldNumber, mapEntry(key, value)));
}

function fieldExt(fieldNumber, key, value) {
  return fieldBytes(fieldNumber, mapEntry(key, value));
}

function loadCreatorPrivateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Creator 签名私钥缺失');
  if (raw.includes('-----BEGIN')) return createPrivateKey(raw);
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error('Creator 签名私钥格式无效');
  // SEC1 ECPrivateKey for NIST P-256, matching the mature Creator implementation.
  const body = Buffer.concat([
    Buffer.from('0201000420', 'hex'), Buffer.from(raw, 'hex'),
    Buffer.from('a00a06082a8648ce3d030107', 'hex'),
  ]);
  const length = body.length;
  const prefix = length < 128 ? Buffer.from([0x30, length]) : Buffer.from([0x30, 0x81, length]);
  return createPrivateKey({ key: Buffer.concat([prefix, body]), format: 'der', type: 'sec1' });
}

function publicKeyHeader(privateKey) {
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
  const decode = value => {
    const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized + '='.repeat((4 - normalized.length % 4) % 4), 'base64');
  };
  return Buffer.concat([Buffer.from([0x04]), decode(jwk.x), decode(jwk.y)]).toString('base64');
}

function signBase64(privateKey, value) {
  return sign('sha256', Buffer.from(value, 'utf8'), privateKey).toString('base64');
}

function creatorStorageMaterial(material) {
  const state = stateObject(material);
  let webProtect = '', cryptSdk = '';
  const origins = [...state.origins].sort((left, right) =>
    String(left?.origin || '') === 'https://creator.douyin.com' ? -1 :
      String(right?.origin || '') === 'https://creator.douyin.com' ? 1 : 0);
  for (const origin of origins) {
    if (!origin) continue;
    // Chromium can move the security SDK entries to sessionStorage during a
    // fresh QR login. Accept both stores; older launchers still upload only
    // localStorage, so this remains backward compatible.
    for (const storage of [origin.localStorage, origin.sessionStorage]) {
      if (!Array.isArray(storage)) continue;
      const values = Object.fromEntries(storage
        .filter(item => item && typeof item === 'object')
        .map(item => [String(item.name || ''), String(item.value || '')]));
      webProtect ||= values['security-sdk/s_sdk_sign_data_key/web_protect'];
      cryptSdk ||= values['security-sdk/s_sdk_crypt_sdk'];
    }
  }
  if (!webProtect || !cryptSdk) throw new Error('Creator 浏览器状态缺少签名材料');
  try {
    const webOuter = JSON.parse(webProtect), keyOuter = JSON.parse(cryptSdk);
    const web = JSON.parse(webOuter.data), keys = JSON.parse(keyOuter.data);
    const result = {
      ticket: String(web.ticket || ''), tsSign: String(web.ts_sign || ''),
      clientCert: String(web.client_cert || ''), privateKey: String(keys.ec_privateKey || keys.private_key || ''),
    };
    if (!result.ticket || !result.tsSign || !result.clientCert || !result.privateKey) throw new Error('字段为空');
    return result;
  } catch (error) {
    throw new Error(`Creator 签名材料无法解析: ${error?.message || error}`);
  }
}

function creatorCookie(material, state) {
  if (String(material?.cookie || '').trim()) return String(material.cookie).trim();
  return state.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}

function cookieValue(state, name) {
  const item = (state?.cookies || []).find(cookie => String(cookie?.name || '') === name);
  return String(item?.value || '').trim();
}

function fakeWebId() {
  let value = '';
  for (let index = 0; index < 19; index += 1) value += Math.floor(Math.random() * 10);
  return value;
}

// conversationType：1 单聊（会话 ID 为 0:1:uid:uid），2 群聊（会话 ID 为纯数字）。
export function buildCreatorDirectRequest({ material, conversationId, conversationShortId, ticket, content, messageType = 7, clientMessageId = randomUUID(), conversationType = 1 }) {
  const conversation = String(conversationId || '').trim();
  const type = Number(messageType);
  const convType = Number(conversationType);
  if (![1, 2].includes(convType)) throw new Error('Creator 会话类型无效');
  if (convType === 2 && !/^\d{1,30}$/.test(conversation)) throw new Error('Creator 群聊会话 ID 无效');
  if (convType === 1 && !/^0:1:\d{1,30}:\d{1,30}$/.test(conversation)) throw new Error('Creator 私聊会话 ID 无效');
  const shortIdText = String(conversationShortId ?? '').trim();
  let shortId;
  try { shortId = BigInt(shortIdText); } catch { shortId = 0n; }
  if (!conversation || shortId <= 0n || !/^\d+$/.test(shortIdText) || !String(ticket || '').trim()) throw new Error('Creator 会话材料不完整');
  if (![5, 7, 27].includes(type)) throw new Error('Creator 消息类型不支持');
  const contentJson = typeof content === 'string' ? content : JSON.stringify(content || {});
  if (!contentJson.trim()) throw new Error('Creator 消息内容不能为空');
  const auth = creatorStorageMaterial(material);
  const privateKey = loadCreatorPrivateKey(auth.privateKey);
  const requestSign = signBase64(privateKey, `content=${contentJson}&conversation_id=${conversation}&conversation_short_id=${shortIdText}`);
  const now = String(Date.now());
  const body = Buffer.concat([
    fieldString(1, conversation), fieldVarint(2, convType), fieldVarint(3, shortId), fieldString(4, contentJson),
    fieldExt(5, 's:client_message_id', clientMessageId), fieldExt(5, 's:stime', now), fieldExt(5, 's:mentioned_users', ''),
    fieldVarint(6, type), fieldString(7, ticket), fieldString(8, clientMessageId),
  ]);
  const fp = cookieValue(stateObject(material), 's_v_web_id');
  const headers = {
    session_aid: '6383', session_did: '0', app_name: 'douyin_pc', priority_region: 'cn',
    cookie_enabled: 'true', browser_language: 'zh-CN', browser_platform: 'Win32', browser_name: 'Chrome',
    browser_version: '131.0.0.0', browser_online: 'true', screen_width: '1440', screen_height: '1000',
    referer: '', timezone_name: 'Etc/GMT-8', deviceId: '0', webid: fakeWebId(), 'is-retry': '0',
    ...(fp ? { fp } : {}),
  };
  const request = Buffer.concat([
    fieldVarint(1, 100), fieldVarint(2, Math.floor(Math.random() * 1000) + 10000), fieldString(3, '1.1.3'),
    fieldString(4, auth.ticket), fieldVarint(5, 3), fieldString(7, '5fa6ff1:Detached: 5fa6ff1111fd53aafc4c753505d3c93daad74d27'),
    fieldBytes(8, fieldBytes(100, body)), fieldString(9, '0'), fieldString(11, 'douyin_pc'), ...fieldMap(15, {
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36', ...headers,
    }), fieldVarint(18, 4),
    fieldString(21, 'douyin_web'), fieldString(22, 'web_sdk'), fieldString(23, auth.tsSign),
    fieldString(24, Buffer.from(auth.clientCert, 'utf8').toString('base64')), fieldString(25, requestSign),
  ]);
  return { request, clientMessageId, auth, privateKey, publicKey: publicKeyHeader(privateKey), state: stateObject(material), content: contentJson };
}

export function buildCreatorDirectTextRequest({ material, conversationId, conversationShortId, ticket, text: message, clientMessageId = randomUUID(), conversationType = 1 }) {
  const value = String(message || '').trim();
  if (!value) throw new Error('Creator 消息不能为空');
  return buildCreatorDirectRequest({ material, conversationId, conversationShortId, ticket, messageType: 7, clientMessageId, conversationType,
    content: { mention_users: [], aweType: 700, richTextInfos: [], text: value } });
}

export function creatorDirectHeaders({ path = '/v1/message/send', auth, privateKey }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const clientData = Buffer.from(JSON.stringify({
    ts_sign: auth.tsSign, req_content: 'ticket,path,timestamp',
    req_sign: signBase64(privateKey, `ticket=${auth.ticket}&path=${path}&timestamp=${timestamp}`), timestamp,
  }), 'utf8').toString('base64url');
  return {
    accept: 'application/x-protobuf', 'content-type': 'application/x-protobuf', referer: 'https://www.douyin.com/',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
    'cache-control': 'no-cache', pragma: 'no-cache', priority: 'u=1, i',
    'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"', 'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"', 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    'bd-ticket-guard-client-data': clientData, 'bd-ticket-guard-iteration-version': '1',
    'bd-ticket-guard-ree-public-key': publicKeyHeader(privateKey), 'bd-ticket-guard-version': '2', 'bd-ticket-guard-web-version': '1',
  };
}

export function creatorSignedHeaders(material, path) {
  if (!material || typeof material.browserState !== 'string') return {};
  try {
    const state = stateObject(material);
    const auth = creatorStorageMaterial(material);
    const privateKey = loadCreatorPrivateKey(auth.privateKey);
    const headers = creatorDirectHeaders({ path, auth, privateKey });
    headers.cookie = creatorCookie(material, state);
    return headers;
  } catch {
    // Older launchers may have uploaded only cookies. Keep the legacy sync
    // request usable until the next login captures the signing stores.
    return {};
  }
}

export function buildCreatorConversationCreateRequest({ material, senderUid, targetUid, clientRequestId = randomUUID() }) {
  const sender = String(senderUid || '').trim();
  const target = String(targetUid || '').trim();
  if (!/^\d{1,30}$/.test(sender) || !/^\d{1,30}$/.test(target) || sender === target) throw new Error('Creator 建会话 UID 无效');
  const auth = creatorStorageMaterial(material);
  const privateKey = loadCreatorPrivateKey(auth.privateKey);
  const requestSign = signBase64(privateKey, `avatar_url=&idempotent_id=&name=&participants=${target},${sender}`);
  const body = Buffer.concat([
    fieldVarint(1, 1), fieldVarint(2, BigInt(target)), fieldVarint(2, BigInt(sender)),
  ]);
  const fp = cookieValue(stateObject(material), 's_v_web_id');
  const headers = {
    session_aid: '6383', session_did: '0', app_name: 'douyin_pc', priority_region: 'cn',
    cookie_enabled: 'true', browser_language: 'zh-CN', browser_platform: 'Win32', browser_name: 'Chrome',
    browser_version: '131.0.0.0', browser_online: 'true', screen_width: '1440', screen_height: '1000',
    referer: '', timezone_name: 'Etc/GMT-8', deviceId: '0', webid: fakeWebId(), 'is-retry': '0',
    ...(fp ? { fp } : {}),
  };
  const request = Buffer.concat([
    fieldVarint(1, 609), fieldVarint(2, Math.floor(Math.random() * 900000) + 100000), fieldString(3, '1.1.3'),
    fieldString(4, auth.ticket), fieldVarint(5, 3), fieldString(7, '5fa6ff1:Detached: 5fa6ff1111fd53aafc4c753505d3c93daad74d27'),
    fieldBytes(8, fieldBytes(609, body)), fieldString(9, '0'), fieldString(11, 'douyin_pc'), ...fieldMap(15, {
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36', ...headers,
    }), fieldVarint(18, 4), fieldString(21, 'douyin_web'), fieldString(22, 'web_sdk'),
    fieldString(23, auth.tsSign), fieldString(24, Buffer.from(auth.clientCert, 'utf8').toString('base64')), fieldString(25, requestSign),
  ]);
  return { request, auth, privateKey, state: stateObject(material), clientRequestId };
}

export function parseCreatorConversationCreateResponse(raw) {
  if (!raw?.length || raw.length > MAX_RESPONSE_BYTES) throw new Error('Creator 建会话回执大小无效');
  const outer = fields(Buffer.from(raw));
  const outerStatus = number(first(outer, 3, 0));
  const outerDetail = text(first(outer, 4, 2)) || text(first(outer, 5, 2));
  if (outerStatus !== null && outerStatus !== 0) throw new Error(`Creator 建会话上游外层拒绝（${outerStatus}）${outerDetail ? `：${outerDetail.slice(0, 240)}` : ''}`);
  const body = fields(first(outer, 6, 2)?.value || Buffer.alloc(0));
  const create = fields(first(body, 609, 2)?.value || Buffer.alloc(0));
  const status = number(first(create, 5, 0));
  const checkCode = number(first(create, 2, 0));
  const detail = text(first(create, 3, 2)) || text(first(create, 4, 2));
  if ((status !== null && status !== 0) || (checkCode !== null && checkCode !== 0)) throw new Error(`Creator 建会话上游拒绝（${status ?? checkCode}）${detail ? `：${detail.slice(0, 120)}` : ''}`);
  const info = fields(first(create, 1, 2)?.value || Buffer.alloc(0));
  const conversationId = text(first(info, 1, 2));
  // Keep the 64-bit conversation ID exact; Number can round a valid ID.
  const shortId = first(info, 2, 0)?.value ?? 0n;
  const conversationType = number(first(info, 3, 0)) ?? 1;
  const ticket = text(first(info, 4, 2));
  if (!conversationId || shortId <= 0n || !ticket) throw new Error('Creator 建会话成功回执缺少会话三元组');
  return { conversationId, conversationShortId: String(shortId), conversationType, ticket };
}

export async function createCreatorConversation({ material, senderUid, targetUid, timeoutMs = 30000, fetchImpl = fetch, clientRequestId } = {}) {
  const built = buildCreatorConversationCreateRequest({ material, senderUid, targetUid, clientRequestId });
  const headers = creatorDirectHeaders({ path: '/v2/conversation/create', auth: built.auth, privateKey: built.privateKey });
  headers.cookie = creatorCookie(material, built.state);
  const response = await fetchImpl('https://imapi.douyin.com/v2/conversation/create', {
    method: 'POST', headers, body: built.request, signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Creator 建会话接口 HTTP ${response.status}`);
  return parseCreatorConversationCreateResponse(Buffer.from(await response.arrayBuffer()));
}

export async function sendCreatorDirectText({ material, conversationId, conversationShortId, ticket, text: message, timeoutMs = 30000, fetchImpl = fetch, conversationType = 1 }) {
  const built = buildCreatorDirectTextRequest({ material, conversationId, conversationShortId, ticket, text: message, conversationType });
  return sendCreatorDirectRequest(built, material, timeoutMs, fetchImpl);
}

async function sendCreatorDirectRequest(built, material, timeoutMs, fetchImpl = fetch) {
  const headers = creatorDirectHeaders({ auth: built.auth, privateKey: built.privateKey });
  headers.cookie = creatorCookie(material, built.state);
  let response, raw;
  try {
    response = await fetchImpl('https://imapi.douyin.com/v1/message/send', {
      method: 'POST', headers, body: built.request, signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) raw = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    // 请求可能已到达上游：超时/中断后结果未知，不能记为失败后被重发。
    if (!error?.nodeOffline && ['TimeoutError', 'AbortError'].includes(error?.name)) {
      throw Object.assign(new Error('Creator Direct 发送超时，发送结果待确认；请先核对平台后再决定是否重发'), { deliveryUncertain: true });
    }
    throw error;
  }
  if (!response.ok) throw new Error(`Creator Direct 发送接口 HTTP ${response.status}`);
  return parseCreatorSendResponse(raw, built.clientMessageId);
}

export async function sendCreatorDirectMedia({ material, conversationId, conversationShortId, ticket, content, messageType, timeoutMs = 150000, fetchImpl = fetch, conversationType = 1 }) {
  const built = buildCreatorDirectRequest({ material, conversationId, conversationShortId, ticket, content, messageType, conversationType });
  return sendCreatorDirectRequest(built, material, timeoutMs, fetchImpl);
}

export { buildEmojiContent, uploadDuoshanImage };

// Kept for callers created before the protocol split; the implementation is direct HTTP/protobuf.
export const sendCreatorWebText = sendCreatorDirectText;
