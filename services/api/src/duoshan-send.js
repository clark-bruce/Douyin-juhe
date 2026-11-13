import { randomInt, randomUUID } from 'node:crypto';

const API_URL = 'https://imapi3-normal.zijieapi.com/v1/message/send';
const MAX_RESPONSE = 4 * 1024 * 1024;
const SDK_VERSION = '1.1.33';
const BUILD_NUMBER = '1.1.33(420753164)';

export class DuoshanSendError extends Error {
  constructor(message, { stage = 'send', retrySafe = false, statusCode = null, rawCheckCode = null } = {}) {
    super(message);
    this.name = 'DuoshanSendError';
    this.stage = stage;
    this.retrySafe = retrySafe;
    this.statusCode = statusCode;
    this.rawCheckCode = rawCheckCode;
  }
}

function varint(value) {
  let input = BigInt(value), output = [];
  if (input < 0n) throw new DuoshanSendError('发送参数不能为负数', { stage: 'build' });
  do {
    let byte = Number(input & 0x7fn);
    input >>= 7n;
    if (input) byte |= 0x80;
    output.push(byte);
  } while (input);
  return Buffer.from(output);
}

const fieldVarint = (number, value) => Buffer.concat([varint(BigInt(number) << 3n), varint(value)]);
const fieldBytes = (number, value) => {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([varint((BigInt(number) << 3n) | 2n), varint(body.length), body]);
};
const fieldString = (number, value) => fieldBytes(number, Buffer.from(String(value), 'utf8'));
const mapEntry = (key, value) => Buffer.concat([fieldString(1, key), fieldString(2, value)]);
const fieldMap = (number, values) => Object.entries(values || {}).map(([key, value]) => fieldBytes(number, mapEntry(key, value)));
const fieldExt = (number, key, value) => fieldBytes(number, mapEntry(key, value));

function readVarint(buffer, start) {
  let value = 0n, shift = 0n, offset = start;
  while (offset < buffer.length && shift < 70n) {
    const byte = buffer[offset++];
    value |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [value, offset];
    shift += 7n;
  }
  throw new DuoshanSendError('上游回执不完整', { stage: 'confirm' });
}

function parseFields(buffer) {
  const fields = [];
  for (let offset = 0; offset < buffer.length;) {
    const [key, next] = readVarint(buffer, offset);
    offset = next;
    const number = Number(key >> 3n), wire = Number(key & 7n);
    if (!number) throw new DuoshanSendError('上游回执字段无效', { stage: 'confirm' });
    let value;
    if (wire === 0) [value, offset] = readVarint(buffer, offset);
    else if (wire === 1) {
      if (offset + 8 > buffer.length) throw new DuoshanSendError('上游回执不完整', { stage: 'confirm' });
      value = buffer.subarray(offset, offset + 8); offset += 8;
    } else if (wire === 2) {
      const [length, begin] = readVarint(buffer, offset);
      const end = begin + Number(length);
      if (end > buffer.length) throw new DuoshanSendError('上游回执不完整', { stage: 'confirm' });
      value = buffer.subarray(begin, end); offset = end;
    } else if (wire === 5) {
      if (offset + 4 > buffer.length) throw new DuoshanSendError('上游回执不完整', { stage: 'confirm' });
      value = buffer.subarray(offset, offset + 4); offset += 4;
    } else throw new DuoshanSendError('上游回执线型无效', { stage: 'confirm' });
    fields.push({ number, wire, value });
  }
  return fields;
}

export function buildDuoshanMessageRequest({
  senderUid, targetUid = '', conversationId, conversationShortId = 0,
  ticket = '', content, messageType = 7, clientMessageId = randomUUID(), sequenceId = randomInt(100000, 1000000), cardIdentity = null,
  conversationType = 1
}) {
  // conversationType：1 单聊（会话 ID 为 0:1:uid:uid），2 群聊（会话 ID 为纯数字）。
  const convType = Number(conversationType);
  if (![1, 2].includes(convType)) throw new DuoshanSendError('抖音聊天会话类型无效', { stage: 'build' });
  const uid = String(senderUid || '').trim();
  const conversation = String(conversationId || '').trim();
  const type = Number(messageType);
  const encodedContent = typeof content === 'string' ? content : JSON.stringify(content || {});
  if (!/^\d{1,30}$/.test(uid) || !conversation || ![5, 7, 27, 60].includes(type) || !encodedContent.trim() || Buffer.byteLength(encodedContent) > 128 * 1024) {
    throw new DuoshanSendError('发送参数不完整', { stage: 'build' });
  }
  if (type === 60) {
    if (!cardIdentity || typeof cardIdentity !== 'object' || !String(cardIdentity.identityDeviceId || '').trim() || !String(cardIdentity.identityToken || '').trim()) {
      throw new DuoshanSendError('抖音聊天卡片身份材料不完整，请重新读取账号身份', { stage: 'identity' });
    }
  }
  const target = String(targetUid || '').trim();
  const participants = conversation.split(':');
  if (convType === 2) {
    if (!/^\d{1,30}$/.test(conversation)) throw new DuoshanSendError('抖音聊天群聊会话 ID 无效', { stage: 'conversation' });
  } else if (participants.length !== 4 || participants[0] !== '0' || participants[1] !== '1' || !participants.slice(2).includes(uid) ||
      (target && (!/^\d{1,30}$/.test(target) || target === uid || !participants.slice(2).includes(target)))) {
    throw new DuoshanSendError('抖音聊天单聊会话与发送身份不匹配', { stage: 'conversation' });
  }
  const messageId = String(clientMessageId || '').trim();
  if (!/^[\w-]{1,100}$/.test(messageId)) throw new DuoshanSendError('消息标识无效', { stage: 'build' });
  const shortId = BigInt(String(conversationShortId || '0'));
  const body = Buffer.concat([
    fieldString(1, conversation), fieldVarint(2, convType), fieldVarint(3, shortId),
    fieldString(4, encodedContent), fieldVarint(6, type),
    ...(type === 60 ? [
      fieldExt(5, 's:client_message_id', messageId), fieldExt(5, 'awe:from:commerce', '1'),
      fieldExt(5, 'im_callback_status_code', '0'), fieldExt(5, 'a:plv', '2'),
      fieldExt(5, 's:ticket_mode', '0'), fieldExt(5, 'chat_scene', 'normal'), fieldExt(5, 'a:msg_scene', '1'),
      fieldExt(5, 'a:relation_type', '0:0'), fieldExt(5, 's:mode', '0'), fieldExt(5, 'a:enter_method', 'click_message'),
      fieldExt(5, 's:is_stranger', 'false'), fieldExt(5, 'a:sync2dx', '1'), fieldExt(5, 's:refer', '3'),
      fieldExt(5, 'source_aid', '6383'), fieldExt(5, 'a:access', 'web_sdk'), fieldExt(5, 's:biz_aid', '6383'),
      fieldExt(5, 'im_client_send_msg_time', String(Date.now())),
      fieldExt(12, 's:reverse_creator_im_ex', '0'), fieldExt(12, 'a:from_role_ids', ''),
      fieldExt(12, 's:im_creator_chat_opt_exp', '0'), fieldExt(12, 's:send_ignore_ticket', 'true'),
      fieldExt(12, 's:im_chat_priv_opt_exp', '1'), fieldExt(12, 'a:to_role_ids', '[]')
    ] : []),
    ...(String(ticket || '').trim() ? [fieldString(7, String(ticket).trim())] : []),
    fieldString(8, messageId)
  ]);
  const request = type === 60
    ? Buffer.concat([
      fieldVarint(1, 100), fieldVarint(2, sequenceId), fieldString(3, SDK_VERSION), fieldString(4, ''),
      fieldVarint(5, 3), fieldVarint(6, 0), fieldString(7, BUILD_NUMBER), fieldBytes(8, fieldBytes(100, body)),
      fieldString(9, String(cardIdentity.identityDeviceId)), fieldString(11, 'douyin_pc'),
      ...fieldMap(15, {
        session_aid: '6383', session_did: String(cardIdentity.identityDeviceId), app_name: 'douyin_pc', priority_region: 'cn',
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        cookie_enabled: 'true', browser_language: 'zh-CN', browser_platform: 'Win32', browser_name: 'Chrome',
        browser_version: '131.0.0.0', browser_online: 'true', screen_width: '1440', screen_height: '900',
        referer: 'https://www.douyin.com/', timezone_name: 'Asia/Shanghai', deviceId: String(cardIdentity.identityDeviceId),
        webid: String(cardIdentity.identityDeviceId), fp: String(cardIdentity.verifyFp || ''), is_retry: '0',
        identity_security_token: JSON.stringify({ token: String(cardIdentity.identityToken) }),
        identity_security_device_id: String(cardIdentity.identityDeviceId), identity_security_aid: '6383'
      }),
      fieldVarint(18, 1), fieldString(21, 'douyin_web'), fieldString(22, 'web_sdk')
    ])
    : Buffer.concat([
      fieldVarint(1, 100), fieldVarint(2, sequenceId), fieldString(3, SDK_VERSION), fieldString(4, ''),
      fieldVarint(5, 0), fieldVarint(6, 1), fieldString(7, BUILD_NUMBER), fieldBytes(8, fieldBytes(100, body)),
      fieldString(9, uid), fieldString(11, 'windows'), fieldString(12, 'x64'), fieldString(13, '10.0.19045'),
      fieldString(14, SDK_VERSION), fieldVarint(18, 1), fieldString(21, 'douyin_im_pc'), fieldString(22, 'cpp_sdk')
    ]);
  return { request, clientMessageId: messageId };
}

export function buildDuoshanCardContent({ title, desc = '', linkUrl = '', coverUrl = '' }) {
  const cardTitle = String(title || '').trim().slice(0, 200);
  const description = String(desc || '').trim().slice(0, 500);
  const link = String(linkUrl || '').trim().slice(0, 2000);
  const cover = String(coverUrl || '').trim().slice(0, 2000);
  if (!cardTitle || !link || !/^https?:\/\//i.test(link)) throw new DuoshanSendError('卡片标题或跳转链接无效', { stage: 'build' });
  if (cover && !/^https?:\/\//i.test(cover)) throw new DuoshanSendError('卡片封面地址无效', { stage: 'build' });
  const icon = { url_key: null, data_size: 0, height: 0, width: 0, player_access_key: null, url_list: cover ? [cover] : [], file_hash: null, file_cs: null, uri: null };
  // The card protocol carries client_msg_id in the protobuf wrapper and
  // extra_kvs_5. It is intentionally absent from content_json.
  return { sub_type: 1, push_detail: cardTitle, aweType: 6001, title: cardTitle, package_name: 'com.ss.android.ugc.aweme', source_title: description || '点击查看', icon, client_key: 'awikua6yvbqai0ht', source_icon: icon, desc: description, open_url: link, type: 0, instruction_type: 0, item_type_local: -1, createdAt: 0, is_card: true, msgHint: '' };
}

export function buildDuoshanTextRequest(options) {
  const text = String(options.text || '');
  if (!text.trim()) throw new DuoshanSendError('发送参数不完整', { stage: 'build' });
  return buildDuoshanMessageRequest({ ...options, messageType: 7, content: { text, aweType: 700 } });
}

export function parseDuoshanSendResponse(raw, clientMessageId, { allowMissingServerMessageId = false } = {}) {
  const buffer = Buffer.from(raw);
  if (!buffer.length || buffer.length > MAX_RESPONSE) throw new DuoshanSendError('上游回执大小无效', { stage: 'confirm' });
  const result = { statusCode: null, error: '', serverMessageId: '', businessStatus: null, rawCheckCode: null, rawFeedback: '', decision: '' };
  let root;
  try { root = parseFields(buffer); }
  catch (error) { if (error instanceof DuoshanSendError) throw error; throw new DuoshanSendError('上游回执无法解析', { stage: 'confirm' }); }
  for (const field of root) {
    if (field.number === 3 && field.wire === 0) result.statusCode = Number(field.value);
    if (field.number === 4 && field.wire === 2) result.error = field.value.toString('utf8').slice(0, 160);
  }
  const text = buffer.toString('utf8');
  const jsonStarts = ['{"status_code"', '{"decision"', '{"error_code"', '{"code"'];
  const jsonStart = jsonStarts.map(marker => text.indexOf(marker)).filter(index => index >= 0).sort((a, b) => a - b)[0] ?? -1;
  if (jsonStart >= 0) {
    try {
      const candidate = JSON.parse(text.slice(jsonStart, text.lastIndexOf('}') + 1));
      result.businessStatus = candidate?.status_code ?? null;
      result.rawCheckCode = candidate?.raw_check_code ?? null;
      result.decision = String(candidate?.decision || candidate?.data?.decision || '').trim();
      const feedback = candidate?.status_msg || candidate?.status_message || candidate?.error_desc
        || candidate?.error_message || candidate?.message || candidate?.data?.message || '';
      if (feedback) result.rawFeedback = String(feedback).replace(/[\r\n\t]+/g, ' ').slice(0, 300);
    } catch { /* optional embedded risk-control JSON */ }
  }
  const walk = (blob, depth = 0) => {
    if (depth > 8 || !blob.length || result.serverMessageId) return;
    let fields;
    try { fields = parseFields(blob); } catch { return; }
    const matchesClient = fields.some(field => field.number === 4 && field.wire === 2 && field.value.toString('utf8') === clientMessageId);
    if (matchesClient) {
      const server = fields.find(field => field.number === 1 && (field.wire === 0 || field.wire === 2));
      if (server?.wire === 0) result.serverMessageId = String(server.value);
      if (server?.wire === 2 && /^\d+$/.test(server.value.toString('utf8'))) result.serverMessageId = server.value.toString('utf8');
    }
    for (const field of fields) if (field.wire === 2) walk(field.value, depth + 1);
  };
  walk(buffer);
  if (result.decision && !/^(?:ok|success|accept(?:ed)?)$/i.test(result.decision)) {
    const detail = result.rawFeedback ? `：${result.rawFeedback}` : '';
    throw new DuoshanSendError(`抖音原始反馈（${result.decision}）${detail}`, {
      stage: 'business', statusCode: Number.isFinite(Number(result.businessStatus)) ? Number(result.businessStatus) : null,
      rawCheckCode: result.rawCheckCode,
    });
  }
  if (result.businessStatus !== null && Number(result.businessStatus) !== 0) {
    const check = result.rawCheckCode === null ? '' : `，校验码 ${result.rawCheckCode}`;
    const detail = result.rawFeedback ? `：${result.rawFeedback}` : '';
    throw new DuoshanSendError(`上游业务拒绝（${result.businessStatus}${check}）${detail}`, {
      stage: 'business', statusCode: Number(result.businessStatus), rawCheckCode: result.rawCheckCode
    });
  }
  if (result.statusCode !== 0) {
    const detail = result.error || result.rawFeedback;
    throw new DuoshanSendError(`上游发送失败（${result.statusCode ?? '无状态'}${detail ? `：${detail}` : ''}）`, { stage: 'business', statusCode: result.statusCode });
  }
  if (!result.serverMessageId && allowMissingServerMessageId && result.statusCode === 0 && (result.businessStatus === null || result.businessStatus === 0) && (!result.decision || /^(?:ok|success|accept(?:ed)?)$/i.test(result.decision))) {
    return { clientMessageId, serverMessageId: clientMessageId, statusCode: 0, warning: '上游已接受卡片，但未返回服务端消息号' };
  }
  if (!result.serverMessageId) {
    const details = [
      result.statusCode === null ? '' : `status_code=${result.statusCode}`,
      result.businessStatus === null ? '' : `business_status=${result.businessStatus}`,
      result.decision ? `decision=${result.decision}` : '',
      result.rawCheckCode === null ? '' : `raw_check_code=${result.rawCheckCode}`,
      result.error ? `error=${result.error}` : '',
      result.rawFeedback ? `feedback=${result.rawFeedback}` : ''
    ].filter(Boolean).join(', ');
    throw new DuoshanSendError(`上游未返回消息确认号${details ? `（${details}）` : ''}`, {
      stage: 'confirm', statusCode: result.statusCode, rawCheckCode: result.rawCheckCode
    });
  }
  return { clientMessageId, serverMessageId: result.serverMessageId, statusCode: 0 };
}

export async function sendDuoshanMessage(options, { fetchImpl = fetch } = {}) {
  const clientMessageId = String(options.clientMessageId || randomUUID());
  const submit = async conversationShortId => {
    const built = buildDuoshanMessageRequest({ ...options, conversationShortId, clientMessageId });
    let response;
    try {
      const endpoint = Number(options.messageType) === 60 ? 'https://imapi.douyin.com/v1/message/send' : API_URL;
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/x-protobuf', 'content-type': 'application/x-protobuf',
          cookie: String(options.cookie || ''), 'user-agent': 'DouyinChat/1.1.33', 'x-tt-token': ''
        },
        body: built.request,
        signal: AbortSignal.timeout(20000)
      });
    } catch {
      throw new DuoshanSendError('连接抖音聊天发送服务失败', { stage: 'network', retrySafe: true });
    }
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_RESPONSE) throw new DuoshanSendError('上游回执过大', { stage: 'network' });
    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.length > MAX_RESPONSE) throw new DuoshanSendError('上游回执过大', { stage: 'network' });
    if (!response.ok) throw new DuoshanSendError(`抖音聊天发送服务 HTTP ${response.status}`, { stage: 'http', retrySafe: response.status >= 500, statusCode: response.status });
    return parseDuoshanSendResponse(raw, built.clientMessageId, { allowMissingServerMessageId: Number(options.messageType) === 60 });
  };
  const requestedShortId = String(options.conversationShortId || '0');
  try { return await submit(requestedShortId); }
  catch (error) {
    if (requestedShortId !== '0' && [7100, 8611].includes(error?.statusCode) && Number(error?.rawCheckCode) === 2) return submit('0');
    throw error;
  }
}


export async function sendDuoshanText(options, dependencies) {
  const text = String(options.text || '');
  if (!text.trim()) throw new DuoshanSendError('发送参数不完整', { stage: 'build' });
  return sendDuoshanMessage({ ...options, messageType: 7, content: { text, aweType: 700 } }, dependencies);
}
