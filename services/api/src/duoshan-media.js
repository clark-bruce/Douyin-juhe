import { createHash, createHmac, randomBytes } from 'node:crypto';

const AUTH_URL = 'https://creator.douyin.com/web/api/media/upload/auth/v5/';
const IMAGE_X_URL = 'https://imagex.bytedanceapi.com/';
const REFERER = 'https://creator.douyin.com/creator-micro/content/message';
const SERVICE_ID = 'jm8ajry58r';
const APP_ID = 2906;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PART_BYTES = 3 * 1024 * 1024;

export const DUOSHAN_EMOJIS = Object.freeze({
  '嗨': { uri: 'https://p3-sign.douyinpic.com/obj/im-resource/1652427775960-ts-373039313837373530383930373438333137322e706e67', imageType: 'gif', width: 100, height: 100 },
  '比心': { uri: 'https://p26-sign.douyinpic.com/obj/im-resource/1700709715333-ts-e6af94e5bf832e706e67', imageType: 'gif', width: 100, height: 100 },
  '续火花': { uri: 'https://p26-sign.douyinpic.com/obj/im-resource/1687263281313-ts-e7bbade781abe88ab12e706e67', imageType: 'gif', width: 100, height: 100 }
});

export function buildEmojiContent(name) {
  const emoji = DUOSHAN_EMOJIS[String(name || '')];
  if (!emoji) throw new DuoshanMediaError('不支持的表情', 'validate');
  return {
    aweType: 507, createdAt: 0, display_name: String(name), height: emoji.height, width: emoji.width,
    image_type: emoji.imageType, is_card: false, may_show_special_effect: false, msgHint: '', package_id: '',
    updateConversationTime: true, url: { height: emoji.height, uri: emoji.uri, url_list: [emoji.uri], width: emoji.width }
  };
}

export class DuoshanMediaError extends Error {
  constructor(message, stage = 'upload') {
    super(message);
    this.name = 'DuoshanMediaError';
    this.stage = stage;
  }
}

const sha256 = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const awsEncode = value => encodeURIComponent(String(value)).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
// AWS/ImageX canonicalization is bytewise ASCII ordering.  localeCompare is
// environment-dependent and puts lowercase keys in the wrong position.
const canonicalQuery = params => Object.entries(params).map(([key, value]) => [String(key), String(value)])
  .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`).join('&');

function signedRequest(method, baseUrl, params, headers, body, auth) {
  const parsed = new URL(baseUrl), now = new Date();
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, ''), date = amzDate.slice(0, 8);
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase().trim(), String(value).trim().replace(/\s+/g, ' ')]));
  normalized.host = parsed.host;
  normalized['x-amz-date'] = amzDate;
  normalized['x-amz-security-token'] = auth.SessionToken;
  const names = Object.keys(normalized).sort(), signedHeaders = names.join(';');
  const canonicalHeaders = names.map(name => `${name}:${normalized[name]}\n`).join('');
  const query = canonicalQuery(params);
  const canonical = [method.toUpperCase(), parsed.pathname || '/', query, canonicalHeaders, signedHeaders, sha256(body)].join('\n');
  const scope = `${date}/cn-north-1/imagex/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(Buffer.from(canonical))].join('\n');
  const dateKey = hmac(Buffer.from(`AWS4${auth.SecretAccessKey}`), date);
  const regionKey = hmac(dateKey, 'cn-north-1'), serviceKey = hmac(regionKey, 'imagex'), signingKey = hmac(serviceKey, 'aws4_request');
  return {
    url: `${baseUrl}?${query}`,
    headers: {
      ...headers,
      Host: parsed.host,
      'X-Amz-Date': amzDate,
      'X-Amz-Security-Token': auth.SessionToken,
      Authorization: `AWS4-HMAC-SHA256 Credential=${auth.AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${createHmac('sha256', signingKey).update(stringToSign).digest('hex')}`
    }
  };
}

async function responseJson(response, label) {
  let data = null;
  try { data = await response.json(); } catch { /* handled below */ }
  if (!response.ok || !data || typeof data !== 'object') throw new DuoshanMediaError(`${label}失败（HTTP ${response.status}）`);
  return data;
}

function uploadAuth(data) {
  const payload = data?.data && typeof data.data === 'object' ? data.data : data;
  let auth = payload?.auth || data?.auth || payload?.stsToken || data?.stsToken;
  if (typeof auth === 'string') { try { auth = JSON.parse(auth); } catch { throw new DuoshanMediaError('图片上传凭证无法解析', 'auth'); } }
  if (!auth || typeof auth !== 'object') throw new DuoshanMediaError('图片上传凭证缺失', 'auth');
  const normalized = {
    AccessKeyId: String(auth.AccessKeyId || auth.AccessKeyID || ''),
    SecretAccessKey: String(auth.SecretAccessKey || ''),
    SessionToken: String(auth.SessionToken || '')
  };
  if (Object.values(normalized).some(value => !value)) throw new DuoshanMediaError('图片上传凭证不完整', 'auth');
  return normalized;
}

async function fetchUploadAuth(cookie, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(AUTH_URL, {
      headers: { accept: 'application/json, text/plain, */*', cookie, origin: 'https://creator.douyin.com', referer: REFERER, 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(30000)
    });
  } catch { throw new DuoshanMediaError('连接图片上传凭证服务失败', 'auth'); }
  return uploadAuth(await responseJson(response, '获取图片上传凭证'));
}

function randomMarker() { return randomBytes(8).toString('base64url'); }

async function applyUpload(buffer, extension, uid, auth, fetchImpl) {
  const variants = [
    {}, { FileExtension: extension }, { app_id: APP_ID, user_id: uid }, { FileExtension: extension, app_id: APP_ID, user_id: uid }
  ];
  let lastError = '返回不完整';
  for (const variant of variants) {
    const query = { Action: 'ApplyImageUpload', Version: '2018-08-01', ServiceId: SERVICE_ID, FileSize: buffer.length, ...variant, s: randomMarker() };
    const request = signedRequest('GET', IMAGE_X_URL, query, { accept: 'application/json, text/plain, */*', origin: 'https://creator.douyin.com', referer: REFERER }, Buffer.alloc(0), auth);
    try {
      const response = await fetchImpl(request.url, { headers: request.headers, signal: AbortSignal.timeout(40000) });
      const data = await response.json();
      const result = data?.Result || data?.result || {}, address = result?.UploadAddress, store = address?.StoreInfos?.[0];
      const host = String(address?.UploadHosts?.[0] || ''), sessionKey = String(address?.SessionKey || '');
      if (response.ok && host && sessionKey && store?.StoreUri && store?.Auth) return { sessionKey, address, host, storeUri: String(store.StoreUri), storeAuth: String(store.Auth) };
      lastError = String(data?.ResponseMetadata?.Error?.Message || `HTTP ${response.status}`).slice(0, 160);
    } catch (error) { lastError = String(error?.message || error).slice(0, 160); }
  }
  throw new DuoshanMediaError(`申请图片上传失败：${lastError}`);
}

let crcTable;
function crc32(buffer) {
  crcTable ||= Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return ((value ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

async function uploadBytes(buffer, applied, uid, fetchImpl) {
  const domain = /^https?:\/\//i.test(applied.host) ? applied.host : `https://${applied.host}`;
  const endpoint = `${domain.replace(/\/$/, '')}/upload/v1/${applied.storeUri}`;
  const common = { Authorization: applied.storeAuth, 'X-Storage-U': encodeURIComponent(uid), ...Object.fromEntries(Object.entries(applied.address?.UploadHeader || {}).map(([key, value]) => [String(key), String(value)])) };
  if (buffer.length <= PART_BYTES) {
    const response = await fetchImpl(endpoint, { method: 'POST', headers: { ...common, 'Content-Type': 'application/octet-stream', 'Content-CRC32': crc32(buffer), 'Content-Length': String(buffer.length) }, body: buffer, signal: AbortSignal.timeout(120000) });
    const data = await responseJson(response, '上传图片数据');
    if (Number(data.code || 0) !== 2000) throw new DuoshanMediaError(`上传图片数据失败：${String(data.message || data.code || '').slice(0, 120)}`);
    return;
  }
  const init = await fetchImpl(`${endpoint}?uploadmode=part&phase=init`, { method: 'POST', headers: common, signal: AbortSignal.timeout(40000) });
  const initData = await responseJson(init, '初始化图片上传');
  const uploadId = String(initData?.data?.uploadid || initData?.uploadid || '');
  if (!uploadId) throw new DuoshanMediaError('初始化图片上传未返回标识');
  for (let offset = 0; offset < buffer.length; offset += PART_BYTES) {
    const chunk = buffer.subarray(offset, offset + PART_BYTES), part = Math.floor(offset / PART_BYTES) + 1;
    const url = `${endpoint}?uploadid=${encodeURIComponent(uploadId)}&part_number=${part}&phase=transfer&part_offset=${offset}`;
    const response = await fetchImpl(url, { method: 'POST', headers: { ...common, 'Content-Type': 'application/octet-stream', 'Content-Length': String(chunk.length) }, body: chunk, signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new DuoshanMediaError(`上传图片分片失败（HTTP ${response.status}）`);
  }
  const finish = await fetchImpl(`${endpoint}?uploadmode=part&phase=finish&uploadid=${encodeURIComponent(uploadId)}`, { method: 'POST', headers: { ...common, 'Content-Type': 'text/plain;charset=UTF-8', 'Content-Length': '0' }, signal: AbortSignal.timeout(40000) });
  const finishData = await responseJson(finish, '合并图片分片');
  if (![0, 2000].includes(Number(finishData.code || 0))) throw new DuoshanMediaError('合并图片分片失败');
}

const camelize = key => key.replace(/_([a-z])/g, (_, character) => character.toUpperCase());
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [camelize(key), normalize(nested)]));
}

async function commitUpload(buffer, mime, uid, auth, applied, fetchImpl) {
  const body = Buffer.from(JSON.stringify({ SessionKey: applied.sessionKey }));
  const query = { Action: 'CommitImageUpload', Version: '2018-08-01', ServiceId: SERVICE_ID, app_id: APP_ID, user_id: uid };
  const request = signedRequest('POST', IMAGE_X_URL, query, { accept: 'application/json, text/plain, */*', 'content-type': 'application/json', origin: 'https://creator.douyin.com', referer: REFERER }, body, auth);
  const response = await fetchImpl(request.url, { method: 'POST', headers: request.headers, body, signal: AbortSignal.timeout(40000) });
  const data = await responseJson(response, '提交图片上传');
  const result = normalize(data?.Result || data?.result || {});
  const remoteUrl = publicUrl(result);
  // Diagnostic: the commit result carried no https URL; log its shape (no cookies or tokens are part of this result).
  if (!remoteUrl) console.warn('[imagex-commit-no-url]', JSON.stringify(result).slice(0, 1200));
  return { ...result, uri: result.uri || result.imageUri || result.storeUri || result.key || applied.storeUri, resourceUrl: remoteUrl, mimeType: mime, imageSize: buffer.length, imageMd5: createHash('md5').update(buffer).digest('hex') };
}

export function detectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new DuoshanMediaError(`图片必须小于 ${MAX_IMAGE_BYTES / 1024 / 1024} MB`, 'validate');
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { mime: 'image/jpeg', extension: 'jpg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', extension: 'png' };
  if (['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return { mime: 'image/gif', extension: 'gif' };
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  throw new DuoshanMediaError('仅支持 JPEG、PNG、GIF、WebP 图片', 'validate');
}

function firstPlugin(uploaded) { return Array.isArray(uploaded.pluginResult) && uploaded.pluginResult[0] && typeof uploaded.pluginResult[0] === 'object' ? uploaded.pluginResult[0] : {}; }
export function buildImageContent(uploaded, { width = 0, height = 0 } = {}) {
  const plugin = firstPlugin(uploaded);
  const uri = String(uploaded.uri || uploaded.imageUri || uploaded.storeUri || plugin.imageUri || plugin.sourceUri || uploaded.key || '');
  if (!uri) throw new DuoshanMediaError('图片上传成功但未返回资源标识');
  const imageWidth = Number(uploaded.width || uploaded.imageWidth || plugin.imageWidth || plugin.width || width || 0);
  const imageHeight = Number(uploaded.height || uploaded.imageHeight || plugin.imageHeight || plugin.height || height || 0);
  const md5 = String(uploaded.imageMd5 || plugin.imageMd5 || uploaded.md5 || '');
  const size = Number(uploaded.imageSize || plugin.imageSize || uploaded.size || 0);
  const resourceOid = String(uploaded.resourceOid || (typeof uploaded.resourceUrl === 'string' ? uploaded.resourceUrl : '') || uploaded.imageUri || plugin.imageUri || plugin.sourceUri || uri);
  return {
    aweType: 2702, aweme_poi_id: '', check_pics: [], check_texts: [], client_key: '', cover_height: imageHeight, cover_width: imageWidth,
    create_timestamp: 0, create_type: 0, effect_info: { duet_layout: 0, duet_role: 0, duet_type: 0, effect_category: 0, effect_type: 0 },
    follow_batch: 0, from_gallery: 1, inline_pic: '', inline_sign: '', is_aigc: false, is_long_pic: 0, item_id: '', latitude: 0,
    longitude: 0, mass_msg: 0, md5, package_name: '', poi_address: '', poi_id: 0, poi_name: 0, post_type: 'comment', quote_message_id: '',
    ref_msg_info: { comment: '' }, resource_url: { data_size: size, large_url_list: [], long_url_list: [], md5, medium_url_list: [], oid: resourceOid, origin_url_list: [], skey: '', still_url_list: [], thumb_url_list: [] },
    source_icon: {}, source_title: '', use_origin_image: 0
  };
}

function publicUrl(value, depth = 0) {
  if (depth > 7 || value === null || value === undefined) return '';
  if (typeof value === 'string') return /^https:\/\//i.test(value) ? value : '';
  if (Array.isArray(value)) { for (const item of value) { const found = publicUrl(item, depth + 1); if (found) return found; } return ''; }
  if (typeof value === 'object') for (const key of ['urlList', 'originUrlList', 'largeUrlList', 'mediumUrlList', 'thumbUrlList', 'resourceUrl', 'url']) {
    const found = publicUrl(value[key], depth + 1); if (found) return found;
  }
  return '';
}

export async function uploadDuoshanImage({ cookie, uid, buffer, width = 0, height = 0 }, { fetchImpl = fetch } = {}) {
  const detected = detectImage(buffer), auth = await fetchUploadAuth(String(cookie || ''), fetchImpl);
  const applied = await applyUpload(buffer, detected.extension, String(uid || ''), auth, fetchImpl);
  await uploadBytes(buffer, applied, String(uid || ''), fetchImpl);
  const uploaded = await commitUpload(buffer, detected.mime, String(uid || ''), auth, applied, fetchImpl);
  return { payload: buildImageContent(uploaded, { width, height }), previewUrl: publicUrl(uploaded), mime: detected.mime, size: buffer.length };
}
