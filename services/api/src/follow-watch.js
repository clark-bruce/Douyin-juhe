// 新粉丝检测（网页版粉丝列表）与用户关系读取（imdesktop）。
// 只读：不会发起关注或取关。接口形态来自对抖音聊天 1.1.33 桌面端的只读核对。
import { fetchDynamicMsToken, mergeBrowserStateCookies, randomMsToken } from './douyin-web-sync.js';
import { generateABogus } from './douyin-web-sign.js';

const ORIGIN = 'https://imdesktop.douyin.com';
const MAX_BODY = 2 * 1024 * 1024;
const BASE_PARAMS = {
  aid: '339757', version_name: '1.1.33', version_code: '1.1.33', device_platform: 'win32', os_version: '10.0.19045',
  browser_language: 'zh-CN', browser_platform: 'Win32', browser_online: 'true', cookie_enabled: 'true',
};

export class FollowWatchError extends Error {
  constructor(message, { stage = 'request', statusCode = null, verify = false } = {}) {
    super(message);
    this.name = 'FollowWatchError';
    this.stage = stage;
    this.statusCode = statusCode;
    this.verify = verify;
  }
}

async function getJson(path, params, cookie, fetchImpl, method = 'GET') {
  let response;
  try {
    response = await fetchImpl(`${ORIGIN}${path}?${new URLSearchParams({ ...BASE_PARAMS, ...params })}`, {
      method,
      headers: { cookie: String(cookie || ''), accept: 'application/json, text/plain, */*', 'user-agent': 'DouyinChat/1.1.33', 'x-tt-token': '' },
      ...(method === 'POST' ? { body: '' } : {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new FollowWatchError('连接抖音聊天服务失败', { stage: 'network' });
  }
  if (response.headers?.get?.('x-tt-verify-passport-decision')) throw new FollowWatchError('抖音要求二次身份验证', { stage: 'verify', verify: true });
  if (!response.ok) throw new FollowWatchError(`抖音聊天服务 HTTP ${response.status}`, { stage: 'http', statusCode: response.status });
  const raw = Buffer.from(await response.arrayBuffer());
  if (!raw.length || raw.length > MAX_BODY) throw new FollowWatchError('抖音聊天服务响应大小无效', { stage: 'parse' });
  let json;
  try { json = JSON.parse(raw.toString('utf8')); } catch { throw new FollowWatchError('抖音聊天服务返回了非 JSON 响应', { stage: 'parse' }); }
  if (json?.verifyData) throw new FollowWatchError('抖音要求二次身份验证', { stage: 'verify', verify: true });
  if (Number(json?.status_code ?? 0) !== 0) {
    throw new FollowWatchError(`抖音聊天服务拒绝请求（${json.status_code}）${String(json.status_msg || '').slice(0, 80)}`, { stage: 'business', statusCode: Number(json.status_code) });
  }
  return json;
}

/**
 * 读取本账号的粉丝列表（网页版 /aweme/v1/web/user/follower/list/，只读）。
 * max_time 必须是当前秒级时间戳（传 0 会返回空列表）；翻页用上一页返回的 min_time 作为下一页 max_time。
 * 实测每页只返回约 5 个粉丝（count 参数不生效），所以需要翻页：
 *  - 首次基线：不传 isKnown，翻满 maxPages 页（页间延迟 pageDelayMs）；
 *  - 日常轮询：传 isKnown(uid)，翻到出现已知粉丝即停，最多 maxPages 页。
 * 返回按接口顺序（新粉丝在前）的 { uid, secUid, nickname }。
 */
const DEFAULT_WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function fetchFollowers({ cookie, browserState = '', uid, secUid, userAgent = '', fetchImpl = fetch, maxPages = 1, pageSize = 20, isKnown = null, pageDelayMs = 800 } = {}) {
  const userId = String(uid || '').trim(), target = String(secUid || '').trim();
  // 请求头、query 里的浏览器版本和 a_bogus 签名必须使用同一个 UA（优先用账号自己浏览器的 UA）。
  const ua = /^[\x20-\x7e]{20,512}$/.test(String(userAgent || '')) ? String(userAgent) : DEFAULT_WEB_UA;
  const browserVersion = ua.match(/Chrome\/([\d.]+)/)?.[1] || '131.0.0.0';
  const browserName = /Edg\//.test(ua) ? 'Edge' : 'Chrome';
  if (!/^\d{1,30}$/.test(userId) || !/^MS4wLjAB[\w-]{10,200}$/.test(target)) throw new FollowWatchError('本账号标识无效', { stage: 'build' });
  const cookies = mergeBrowserStateCookies(cookie, browserState);
  const cookieHeader = Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ');
  if (!cookieHeader) throw new FollowWatchError('登录凭证缺失', { stage: 'build' });
  const verifyFp = String(cookies.s_v_web_id || cookies.verifyFp || cookies.verify_fp || '').trim();
  const webid = /^\d{8,30}$/.test(verifyFp) ? verifyFp : String(Math.floor(1e18 + Math.random() * 9e18));
  const followers = [];
  let maxTime = Math.floor(Date.now() / 1000);
  for (let page = 0; page < maxPages; page++) {
    const query = new URLSearchParams({
      device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web', user_id: userId, sec_user_id: target,
      offset: '0', min_time: '0', max_time: String(maxTime), count: String(pageSize), source_type: '1',
      gps_access: '0', address_book_access: '0', update_version_code: '170400', pc_client_type: '1', pc_libra_divert: 'Windows',
      support_h265: '1', support_dash: '1', cpu_core_num: '8', version_code: '170400', version_name: '17.4.0',
      cookie_enabled: 'true', screen_width: '1920', screen_height: '1080', browser_language: 'zh-CN', browser_platform: 'Win32', browser_name: browserName, browser_version: browserVersion,
      browser_online: 'true', engine_name: 'Blink', engine_version: browserVersion, os_name: 'Windows', os_version: '10',
      device_memory: '8', platform: 'PC', downlink: '10', effective_type: '4g', round_trip_time: '0', webid,
      msToken: ((cookies.ttwid || fetchImpl === fetch || fetchImpl?.isDouyinJuheProxyFetch) ? await fetchDynamicMsToken(cookies.ttwid, fetchImpl) : '') || cookies.msToken || cookies.ms_token || randomMsToken(),
    });
    const uifid = String(cookies.UIFID || '').trim();
    if (uifid) query.set('uifid', uifid);
    if (verifyFp) { query.set('verifyFp', verifyFp); query.set('fp', verifyFp); }
    query.set('a_bogus', generateABogus(query.toString(), '', ua));
    let response;
    try {
      response = await fetchImpl(`https://www.douyin.com/aweme/v1/web/user/follower/list/?${query}`, {
        headers: {
          accept: 'application/json, text/plain, */*', cookie: cookieHeader, referer: `https://www.douyin.com/user/${target}`, origin: 'https://www.douyin.com',
          'user-agent': ua, ...(uifid ? { uifid } : {}),
        },
        signal: AbortSignal.timeout(15000),
      });
    } catch { throw new FollowWatchError('连接抖音粉丝接口失败', { stage: 'network' }); }
    if (response.headers?.get?.('x-tt-verify-passport-decision') || response.headers?.get?.('x-vc-bdturing-parameters')) throw new FollowWatchError('抖音要求二次身份验证', { stage: 'verify', verify: true });
    if (!response.ok) throw new FollowWatchError(`抖音粉丝接口 HTTP ${response.status}`, { stage: 'http', statusCode: response.status });
    const raw = Buffer.from(await response.arrayBuffer());
    if (!raw.length || raw.length > MAX_BODY) throw new FollowWatchError('抖音粉丝接口响应大小无效', { stage: 'parse' });
    let json;
    try { json = JSON.parse(raw.toString('utf8')); } catch { throw new FollowWatchError('抖音粉丝接口返回了非 JSON 响应', { stage: 'parse' }); }
    if (json?.verifyData) throw new FollowWatchError('抖音要求二次身份验证', { stage: 'verify', verify: true });
    if (Number(json?.status_code ?? 0) !== 0) throw new FollowWatchError(`抖音粉丝接口拒绝请求（${json.status_code}）${String(json.status_msg || '').slice(0, 80)}`, { stage: 'business', statusCode: Number(json.status_code) });
    if (!Array.isArray(json.followers)) throw new FollowWatchError('抖音粉丝接口未返回粉丝列表', { stage: 'parse' });
    for (const item of json.followers) {
      const id = String(item?.uid || '');
      if (!/^\d{1,30}$/.test(id)) continue;
      followers.push({ uid: id, secUid: String(item.sec_uid || ''), nickname: String(item.nickname || '').slice(0, 100) });
    }
    const next = Number(json.min_time);
    if (Number(json.has_more) !== 1 || !Number.isFinite(next) || next <= 0 || next >= maxTime) break;
    // 列表按新到旧排列：本页出现已知粉丝，说明更早的都已处理过，无需继续翻页。
    if (isKnown && json.followers.some(item => isKnown(String(item?.uid || '')))) break;
    maxTime = next;
    if (page + 1 < maxPages && pageDelayMs > 0) await new Promise(resolve => setTimeout(resolve, pageDelayMs));
  }
  return followers;
}

/** 读取当前账号与对方的关系：followStatus 是“我是否关注对方”，followerStatus 是“对方是否关注我”。 */
export async function fetchRelation({ cookie, secUid, fetchImpl = fetch } = {}) {
  const target = String(secUid || '').trim();
  if (!/^MS4wLjAB[\w-]{10,200}$/.test(target)) throw new FollowWatchError('对方标识无效', { stage: 'build' });
  const json = await getJson('/aweme/v1/web/user/profile/other/', { sec_user_id: target, source: 'together' }, cookie, fetchImpl);
  const user = json?.user;
  if (!user || typeof user !== 'object') throw new FollowWatchError('未读取到对方资料', { stage: 'parse' });
  return {
    followStatus: Number(user.follow_status ?? -1), followerStatus: Number(user.follower_status ?? -1),
    isPrivate: Number(user.secret || 0) === 1, isBlock: Boolean(user.is_block),
  };
}

/** 关注指定用户（桌面端 imdesktop 接口，请求体为空，参数在 query）。成功返回 { followStatus }；二次验证抛 verify 错误。 */
export async function followUser({ cookie, uid, secUid, fetchImpl = fetch } = {}) {
  const userId = String(uid || '').trim(), target = String(secUid || '').trim();
  if (!/^\d{1,30}$/.test(userId) || !/^MS4wLjAB[\w-]{10,200}$/.test(target)) throw new FollowWatchError('对方标识无效', { stage: 'build' });
  const json = await getJson('/aweme/v1/web/commit/follow/user/', { user_id: userId, secUid: target, type: '1', tag: 'frienddetail', verifyFp: '' }, cookie, fetchImpl, 'POST');
  return { followStatus: Number(json.follow_status ?? -1) };
}

/**
 * 回关判定：对方已关注我、我尚未关注对方，且不是拉黑关系。
 * trustNotice：创作者登录态下 follower_status 恒为 0（实测），不能用来判断对方是否关注；
 * 此时以“粉丝列表里出现新粉丝”为准，只检查拉黑与是否已关注对方。
 */
export function classifyRelation(relation, { trustNotice = false } = {}) {
  if (relation.isBlock) return { status: 'skipped', reason: '存在拉黑关系' };
  if (relation.followStatus !== 0) return { status: 'skipped', reason: relation.followStatus === 1 || relation.followStatus === 2 ? '已关注对方' : '关注状态未知' };
  if (!trustNotice && relation.followerStatus !== 1) return { status: 'skipped', reason: '对方当前未关注本账号' };
  return { status: 'pending', reason: '' };
}
