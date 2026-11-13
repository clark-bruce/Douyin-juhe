import { randomInt, randomUUID } from 'node:crypto';
import {
  bytesWire,
  buildRequest,
  fieldBytes,
  fieldString,
  fieldVarint,
  firstWire,
  post,
  safeText,
  wireFields,
} from './duoshan-fetch.js';

const CREATE_COMMAND = 609;
const CREATE_ENDPOINT = '/v2/conversation/create';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export class DuoshanConversationError extends Error {
  constructor(message, { stage = 'create', statusCode = null } = {}) {
    super(message);
    this.name = 'DuoshanConversationError';
    this.stage = stage;
    this.statusCode = statusCode;
  }
}

function numericUid(value, name) {
  const uid = String(value ?? '').trim();
  if (!/^\d{1,30}$/.test(uid)) throw new DuoshanConversationError(`${name}无效`, { stage: 'build' });
  return uid;
}

/** Build im_proto.CreateConversationV2RequestBody (RequestBody field 609). */
export function buildDuoshanCreateConversationBody({ senderUid, targetUid, idempotentId = randomUUID() } = {}) {
  const sender = numericUid(senderUid, '发送账号 UID');
  const target = numericUid(targetUid, '目标 UID');
  if (sender === target) throw new DuoshanConversationError('不能创建自己的私聊会话', { stage: 'build' });
  const idempotency = String(idempotentId || '').trim();
  if (!/^[\w-]{8,100}$/.test(idempotency)) throw new DuoshanConversationError('幂等标识无效', { stage: 'build' });
  // CreateConversationV2RequestBody:
  // conversation_type=1, participants=2 (repeated int64), persistent=3,
  // idempotent_id=4. Keep the sender first, matching the PC SDK.
  return Buffer.concat([
    fieldVarint(1, 1),
    fieldVarint(2, BigInt(sender)),
    fieldVarint(2, BigInt(target)),
    fieldVarint(3, 1),
    fieldString(4, idempotency),
  ]);
}

export function buildDuoshanCreateConversationRequest({ senderUid, targetUid, sequenceId, idempotentId } = {}) {
  const body = buildDuoshanCreateConversationBody({ senderUid, targetUid, idempotentId });
  // CreateConversationV2 uses the minimal im_proto.Request shape from the PC
  // SDK.  The send adapter has a legacy/full envelope (token, refer, inbox,
  // build fields before body); that envelope is accepted by /v1/message/send
  // but is rejected by /v2/conversation/create as INVALID_REQUEST.  Keep the
  // two request contracts separate and include device_id after the body,
  // matching the PC SDK CreateConversationV2 request shape.
  const seq = sequenceId === undefined ? randomInt(100000, 900000) : sequenceId;
  return Buffer.concat([
    fieldVarint(1, CREATE_COMMAND),
    fieldVarint(2, seq),
    fieldString(3, '1.1.33'),
    fieldBytes(8, fieldBytes(CREATE_COMMAND, body)),
    fieldString(9, String(senderUid)),
    fieldString(10, 'official'),
    fieldString(11, 'windows'),
    fieldString(12, 'x64'),
    fieldString(13, '10.0.19045'),
    fieldString(14, '1.1.33'),
    fieldVarint(18, 1),
    fieldString(21, 'douyin_im_pc'),
    fieldString(22, 'cpp_sdk'),
  ]);
}

function parseConversationInfo(raw) {
  if (!raw) return null;
  const fields = wireFields(raw);
  const conversationId = safeText(firstWire(fields, 1));
  const shortValue = firstWire(fields, 2)?.value;
  const conversationType = Number(firstWire(fields, 3)?.value ?? 0);
  const ticket = safeText(firstWire(fields, 4));
  const inboxType = Number(firstWire(fields, 9)?.value ?? 0);
  if (!conversationId || !shortValue || !ticket) return null;
  const shortId = String(shortValue);
  if (!/^\d{1,30}$/.test(shortId) || Number(shortValue) <= 0) return null;
  return { conversationId, conversationShortId: shortId, conversationType, ticket, inboxType };
}

/** Parse im_proto.Response -> CreateConversationV2ResponseBody. */
export function parseDuoshanCreateConversationResponse(raw) {
  const buffer = Buffer.from(raw || '');
  if (!buffer.length || buffer.length > MAX_RESPONSE_BYTES) {
    throw new DuoshanConversationError('抖音聊天创建会话回执大小无效', { stage: 'confirm' });
  }
  let outer;
  try { outer = wireFields(buffer); } catch { throw new DuoshanConversationError('抖音聊天创建会话回执无法解析', { stage: 'confirm' }); }
  const statusCode = Number(firstWire(outer, 3)?.value ?? 0);
  if (statusCode !== 0) {
    const detail = safeText(firstWire(outer, 4));
    throw new DuoshanConversationError(detail || `抖音聊天创建会话失败（${statusCode}）`, { stage: 'upstream', statusCode });
  }
  const responseBody = firstWire(outer, 6)?.value;
  if (!responseBody) throw new DuoshanConversationError('抖音聊天创建会话回执缺少响应体', { stage: 'confirm' });
  const body = wireFields(responseBody);
  const commandBody = firstWire(body, CREATE_COMMAND)?.value;
  if (!commandBody) throw new DuoshanConversationError('抖音聊天创建会话响应字段缺失', { stage: 'confirm' });
  const result = wireFields(commandBody);
  const status = Number(firstWire(result, 5)?.value ?? 0);
  const checkCode = firstWire(result, 2)?.value;
  const checkMessage = safeText(firstWire(result, 3));
  if (status !== 0 || (checkCode !== undefined && Number(checkCode) !== 0)) {
    throw new DuoshanConversationError(checkMessage || '抖音聊天创建会话被上游拒绝', { stage: 'upstream', statusCode: status || Number(checkCode) });
  }
  const conversation = parseConversationInfo(firstWire(result, 1)?.value);
  if (!conversation) throw new DuoshanConversationError('抖音聊天创建会话返回材料不完整', { stage: 'confirm' });
  return conversation;
}

export async function createDuoshanConversation({ senderUid, targetUid, cookie, fetchImpl = fetch, idempotentId, sequenceId } = {}) {
  const sender = numericUid(senderUid, '发送账号 UID');
  if (typeof cookie !== 'string' || !/(?:^|;\s*)sessionid=[^;\s]+/.test(cookie)) {
    throw new DuoshanConversationError('抖音聊天身份材料无效', { stage: 'auth' });
  }
  const request = buildDuoshanCreateConversationRequest({ senderUid: sender, targetUid, idempotentId, sequenceId });
  try {
    const response = await post(CREATE_ENDPOINT, cookie, request, fetchImpl);
    return parseDuoshanCreateConversationResponse(response);
  } catch (error) {
    if (error instanceof DuoshanConversationError) throw error;
    throw new DuoshanConversationError(error?.message || '抖音聊天创建会话失败', { stage: 'network' });
  }
}
