// 离线测试：网页证书链路（creator-direct-send.js）的私聊/群聊请求构造与回执判定。
// 全部使用自生成的假材料和 mock fetch，不联网、不使用任何真实账号凭证。
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import {
  buildCreatorDirectRequest, buildCreatorDirectTextRequest,
  sendCreatorDirectText, sendCreatorDirectMedia,
} from '../src/creator-direct-send.js';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const privateHex = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url').toString('hex').padStart(64, '0');
const publicKey = createPublicKey(privateKey);
const material = {
  kind: 'creator_web', uid: '111', cookie: 'sessionid=fake',
  browserState: JSON.stringify({
    cookies: [{ name: 's_v_web_id', value: 'verify_fake', domain: '.douyin.com', path: '/' }],
    origins: [{ origin: 'https://creator.douyin.com', localStorage: [
      { name: 'security-sdk/s_sdk_sign_data_key/web_protect', value: JSON.stringify({ data: JSON.stringify({ ticket: 'T', ts_sign: 'TS', client_cert: 'CERT' }) }) },
      { name: 'security-sdk/s_sdk_crypt_sdk', value: JSON.stringify({ data: JSON.stringify({ ec_privateKey: privateHex }) }) },
    ] }],
  }),
};

function varint(buffer, offset) {
  let value = 0n, shift = 0n;
  for (;;) { const byte = buffer[offset++]; value |= BigInt(byte & 0x7f) << shift; if (!(byte & 0x80)) break; shift += 7n; }
  return [value, offset];
}
function decode(buffer) {
  const out = {};
  let offset = 0;
  while (offset < buffer.length) {
    let key; [key, offset] = varint(buffer, offset);
    const field = Number(key >> 3n), wire = Number(key & 7n);
    let value;
    if (wire === 0) [value, offset] = varint(buffer, offset);
    else if (wire === 2) { let len; [len, offset] = varint(buffer, offset); value = buffer.subarray(offset, offset + Number(len)); offset += Number(len); }
    else throw new Error(`wire ${wire}`);
    (out[field] ||= []).push(value);
  }
  return out;
}
function enc(value) { const bytes = []; let v = BigInt(value); do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; bytes.push(b); } while (v); return Buffer.from(bytes); }
const fVar = (n, v) => Buffer.concat([enc(n << 3), enc(v)]);
const fBytes = (n, v) => { const b = Buffer.from(v); return Buffer.concat([enc((n << 3) | 2), enc(b.length), b]); };
function sendBody(request) {
  const outer = decode(request);
  return { outer, body: decode(decode(outer[8][0])[100][0]) };
}
const response = (sendFields, ok = true, status = 200) => ({ ok, status, arrayBuffer: async () => { const b = fBytes(6, fBytes(100, sendFields)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } });
const clientIdOf = init => sendBody(Buffer.from(init.body)).body[8][0].toString();

const group = { material, conversationId: '7400000000000000001', conversationShortId: '7400000000000000001', ticket: 'gticket', conversationType: 2 };
const direct = { material, conversationId: '0:1:111:222', conversationShortId: '7300000000000000009', ticket: 'dticket' };

test('私聊文本：字段 2 = 1，签名可验', () => {
  const built = buildCreatorDirectTextRequest({ ...direct, text: '你好' });
  const { outer, body } = sendBody(built.request);
  assert.equal(outer[1][0], 100n);
  assert.equal(body[1][0].toString(), '0:1:111:222');
  assert.equal(body[2][0], 1n);
  assert.equal(body[3][0], 7300000000000000009n);
  assert.equal(body[6][0], 7n);
  assert.equal(body[7][0].toString(), 'dticket');
  const content = body[4][0].toString();
  assert.equal(JSON.parse(content).text, '你好');
  const signed = `content=${content}&conversation_id=0:1:111:222&conversation_short_id=7300000000000000009`;
  assert.ok(verify('sha256', Buffer.from(signed), publicKey, Buffer.from(outer[25][0].toString(), 'base64')));
});

test('群聊文本/表情/图片：字段 2 = 2，会话 ID 为纯数字', () => {
  for (const messageType of [7, 5, 27]) {
    const built = buildCreatorDirectRequest({ ...group, messageType, content: { text: 'x' } });
    const { outer, body } = sendBody(built.request);
    assert.equal(body[1][0].toString(), group.conversationId);
    assert.equal(body[2][0], 2n);
    assert.equal(body[3][0], 7400000000000000001n);
    assert.equal(body[6][0], BigInt(messageType));
    assert.equal(body[7][0].toString(), 'gticket');
    const signed = `content=${built.content}&conversation_id=${group.conversationId}&conversation_short_id=${group.conversationShortId}`;
    assert.ok(verify('sha256', Buffer.from(signed), publicKey, Buffer.from(outer[25][0].toString(), 'base64')));
  }
});

test('参数校验：卡片 60、会话类型与 ID 不匹配、缺 ticket 均拒绝', () => {
  assert.throws(() => buildCreatorDirectRequest({ ...direct, messageType: 60, content: { a: 1 } }), /消息类型不支持/);
  assert.throws(() => buildCreatorDirectRequest({ ...direct, conversationType: 2, content: { a: 1 } }), /群聊会话 ID 无效/);
  assert.throws(() => buildCreatorDirectRequest({ ...group, conversationType: 1, content: { a: 1 } }), /私聊会话 ID 无效/);
  assert.throws(() => buildCreatorDirectRequest({ ...group, conversationType: 3, content: { a: 1 } }), /会话类型无效/);
  assert.throws(() => buildCreatorDirectRequest({ ...group, ticket: '', content: { a: 1 } }), /会话材料不完整/);
});

test('成功回执 → 返回 serverMessageId；请求发往 imapi 且带签名头', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return response(Buffer.concat([fVar(1, 123456789), fBytes(4, clientIdOf(init))])); };
  const outcome = await sendCreatorDirectText({ ...group, text: '群消息', fetchImpl });
  assert.equal(outcome.serverMessageId, '123456789');
  assert.equal(seen.url, 'https://imapi.douyin.com/v1/message/send');
  assert.equal(seen.init.headers.cookie, 'sessionid=fake');
  assert.ok(seen.init.headers['bd-ticket-guard-client-data']);
  assert.equal(sendBody(Buffer.from(seen.init.body)).body[2][0], 2n);
});

test('多余参数（cacheKey/targetSecUid/senderUid）被忽略', async () => {
  const fetchImpl = async (url, init) => response(Buffer.concat([fVar(1, 42), fBytes(4, clientIdOf(init))]));
  const outcome = await sendCreatorDirectText({ ...direct, text: 'hi', fetchImpl, cacheKey: 'k', targetSecUid: 's', senderUid: '111' });
  assert.equal(outcome.serverMessageId, '42');
});

test('回执缺 server_message_id → deliveryUncertain', async () => {
  const fetchImpl = async (url, init) => response(fBytes(4, clientIdOf(init)));
  await assert.rejects(sendCreatorDirectMedia({ ...group, messageType: 5, content: { a: 1 }, fetchImpl }), error => error.deliveryUncertain === true);
});

test('超时 → deliveryUncertain；节点离线 → 原样抛出', async () => {
  const timeout = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };
  await assert.rejects(sendCreatorDirectText({ ...direct, text: 'hi', fetchImpl: timeout }), error => error.deliveryUncertain === true);
  const offline = async () => { throw Object.assign(new Error('offline'), { name: 'AbortError', nodeOffline: true }); };
  await assert.rejects(sendCreatorDirectText({ ...direct, text: 'hi', fetchImpl: offline }), error => error.nodeOffline === true && !error.deliveryUncertain);
});

test('HTTP 500 与上游拒绝 → 普通失败（非待确认）', async () => {
  await assert.rejects(sendCreatorDirectText({ ...direct, text: 'hi', fetchImpl: async () => response(Buffer.alloc(0), false, 500) }),
    error => /HTTP 500/.test(error.message) && !error.deliveryUncertain);
  const rejected = async (url, init) => response(Buffer.concat([fVar(3, 7905), fBytes(4, clientIdOf(init))]));
  await assert.rejects(sendCreatorDirectText({ ...group, text: 'hi', fetchImpl: rejected }),
    error => /7905/.test(error.message) && !error.deliveryUncertain);
});
