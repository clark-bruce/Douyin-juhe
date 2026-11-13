import { generateABogus } from './douyin-web-sign.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36';

function cookieMap(cookie) {
  return Object.fromEntries(String(cookie || '').split(';').map(part => {
    const index = part.indexOf('=');
    return index > 0 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : ['', ''];
  }).filter(([name, value]) => name && value));
}

function randomMsToken() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  return Array.from({ length: 96 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function avatarFrom(value) {
  const urls = value?.url_list || value?.urlList || value?.urls;
  return Array.isArray(urls) ? String(urls[0] || '') : typeof urls === 'string' ? urls : String(value?.uri || value?.url || '');
}

function collectUsers(value, out = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) { for (const item of value) collectUsers(item, out, seen); return out; }
  const uid = String(value.uid || value.user_id || value.userId || '').trim();
  const douyinId = String(value.unique_id || value.uniqueId || value.douyin_id || value.douyinId || '').trim();
  const secUid = String(value.sec_uid || value.secUid || '').trim();
  if (/^\d{1,30}$/.test(uid) && (douyinId || secUid)) {
    out.push({ uid, douyinId, secUid, name: String(value.nickname || value.nick_name || value.name || '').trim().slice(0, 100), avatar: avatarFrom(value.avatar_larger || value.avatar || value.avatar_medium) });
  }
  for (const child of Object.values(value)) collectUsers(child, out, seen);
  return out;
}

export function parseDuoshanUserSearch(payload, query) {
  const input = String(query || '').trim().toLowerCase();
  const users = collectUsers(payload);
  const exact = users.find(item => [item.douyinId, item.uid].some(value => String(value || '').toLowerCase() === input));
  return exact || users[0] || null;
}

/** Resolve a Douyin ID to the numeric UID required by the Duoshan create RPC. */
export async function searchDuoshanUser({ query, cookie, fetchImpl = fetch } = {}) {
  const keyword = String(query || '').trim();
  if (!keyword || keyword.length > 64) return null;
  const cookies = cookieMap(cookie);
  const webId = cookies.s_v_web_id || String(Math.floor(1e18 + Math.random() * 9e18));
  const msToken = cookies.msToken || cookies.ms_token || randomMsToken();
  const browserVersion = '150.0.0.0';
  const params = new URLSearchParams({
    device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web', search_channel: 'aweme_user_web',
    search_filter_value: '{"douyin_user_fans":[""],"douyin_user_type":[""]}', keyword,
    search_source: 'switch_tab', query_correct_type: '1', is_filter_search: '1', offset: '0', count: '25',
    need_filter_settings: '1', list_type: 'single', update_version_code: '170400', pc_client_type: '1',
    version_code: '170400', version_name: '17.4.0', cookie_enabled: 'true', screen_width: '1440',
    screen_height: '1000', browser_language: 'zh-CN', browser_platform: 'Win32', browser_name: 'Chrome',
    browser_version: browserVersion, browser_online: 'true', engine_name: 'Blink', engine_version: browserVersion,
    os_name: 'Windows', os_version: '10', cpu_core_num: '8', device_memory: '8', platform: 'PC', downlink: '10',
    effective_type: '4g', round_trip_time: '100', webid: webId, msToken
  });
  params.set('verifyFp', cookies.s_v_web_id || '');
  params.set('fp', cookies.s_v_web_id || '');
  const headers = {
    cookie: String(cookie || ''),
    referer: `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=user`,
    origin: 'https://www.douyin.com',
    'user-agent': USER_AGENT,
    accept: 'application/json,text/plain,*/*',
  };
  params.set('a_bogus', generateABogus(params.toString()));

  // A sec_uid can be resolved without the search page.  This is the same
  // profile endpoint used by the mature system and returns the numeric UID
  // required by Duoshan's CreateConversation RPC.
  if (keyword.startsWith('MS4wLjAB')) {
    params.delete('search_channel'); params.delete('search_filter_value'); params.delete('keyword');
    params.delete('search_source'); params.delete('query_correct_type'); params.delete('is_filter_search');
    params.delete('offset'); params.delete('count'); params.delete('need_filter_settings'); params.delete('list_type');
    params.set('publish_video_strategy_type', '2');
    params.set('source', 'channel_pc_web'); params.set('sec_user_id', keyword); params.set('personal_center_strategy', '1');
    const profileUrl = `https://www.douyin.com/aweme/v1/web/user/profile/other/?${params}`;
    const profileResponse = await fetchImpl(profileUrl, { headers, signal: AbortSignal.timeout(12000) });
    const profileRaw = await profileResponse.text();
    if (!profileResponse.ok) throw new Error(`抖音用户解析失败（HTTP ${profileResponse.status}）`);
    let profile;
    try { profile = JSON.parse(profileRaw); }
    catch { throw new Error('抖音用户解析接口返回了非 JSON 响应，请稍后重试'); }
    if (Number(profile?.status_code || 0) !== 0) {
      throw new Error(`抖音用户解析失败（${profile.status_code || 'unknown'}）：${String(profile.status_msg || '用户标识无效').slice(0, 120)}`);
    }
    return parseDuoshanUserSearch(profile, keyword);
  }
  const response = await fetchImpl(`https://www.douyin.com/aweme/v1/web/discover/search/?${params}`, {
    headers,
    signal: AbortSignal.timeout(12000)
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`抖音号搜索失败（HTTP ${response.status}）`);
  let payload;
  try { payload = JSON.parse(raw); }
  catch { throw new Error('抖音号搜索接口未返回 JSON，当前抖音聊天登录态不含网页搜索凭据，请改用数字 UID 或有效 sec_uid'); }
  return parseDuoshanUserSearch(payload, keyword);
}
