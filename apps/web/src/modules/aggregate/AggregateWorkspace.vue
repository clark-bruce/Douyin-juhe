<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ChatDotRound, Delete, Link, MagicStick, Picture, Plus, Refresh, Search, Star, Tickets } from '@element-plus/icons-vue';
import { apiBlob, apiRequest } from '../../lib/api.js';
import { createRealtime } from '../../lib/realtime.js';
import { createConversationRefreshScheduler } from './conversation-refresh.js';
import { coverCdnUrl } from '../cards/cover-cdn.js';
import CardPromoteDialog from '../cards/CardPromoteDialog.vue';
import { COVER_PRESETS, encodeHidden } from '../../lib/text-cipher.js';

const props = defineProps({ accounts: { type: Array, default: () => [] }, focus: { type: Object, default: null } });
let pendingFocus = null;
const activeAccount = ref(''), activeConversation = ref(''), filter = ref('all'), query = ref(''), composer = ref(''), channel = ref('default');
const newChat = ref(false), target = ref(''), targetTitle = ref(''), notice = ref(''), error = ref(''), conversations = ref([]), messages = ref([]);
const groupChatsHidden = ref(false);
const encryptOn = ref(false), ENCRYPT_MAX_BYTES = 500;
const loading = ref(false), sending = ref(false), realtimeStatus = ref('offline'), messageList = ref(null), imageInput = ref(null);
const emojiOpen = ref(false), quickPhraseOpen = ref(false), cardOpen = ref(false), cardsLoading = ref(false), cards = ref([]), selectedCard = ref(null), imagePreview = ref(''), imagePayload = ref(null), uploadProgress = ref(0), uploadStage = ref('');
const posterUrls = ref({}), imageUrls = ref({});
const quickPhrases = ref(['您好，我马上处理。', '请稍等，我正在为您核实。', '感谢您的反馈。']);
const emojis = [
  { name: '嗨', glyph: '👋', url: 'https://p3-sign.douyinpic.com/obj/im-resource/1652427775960-ts-373039313837373530383930373438333137322e706e67' },
  { name: '比心', glyph: '🫶', url: 'https://p26-sign.douyinpic.com/obj/im-resource/1700709715333-ts-e6af94e5bf832e706e67' },
  { name: '续火花', glyph: '🔥', url: 'https://p26-sign.douyinpic.com/obj/im-resource/1687263281313-ts-e7bbade781abe88ab12e706e67' },
  { name: '微笑', glyph: '🙂', text: '🙂' }, { name: '大笑', glyph: '😄', text: '😄' },
  { name: '爱心', glyph: '❤️', text: '❤️' }, { name: '点赞', glyph: '👍', text: '👍' },
  { name: '庆祝', glyph: '🎉', text: '🎉' }, { name: '惊讶', glyph: '😮', text: '😮' },
  { name: '哭泣', glyph: '😢', text: '😢' }, { name: '生气', glyph: '😡', text: '😡' },
  { name: 'OK', glyph: '👌', text: '👌' }
];
let realtime, syncTimer, disposed = false, conversationRefreshScheduler;
const posterLoads = new Map();
const imageLoads = new Map();
let conversationLoadSeq = 0;
let errorTimer;
const unreadClearedAt = new Map();
const conversationsByAccount = new Map();
const groupChatPreferenceKey = accountId => `douyinjuhe.aggregate.hide-group-chats:${accountId}`;

// 仅超管会收到多个租户的账号；此时显示租户下拉，并在账号上标注所属租户。
const isSuperAdmin = (() => { try { return JSON.parse(localStorage.getItem('douyinjuhe.session') || 'null')?.user?.role === 'admin'; } catch { return false; } })();
const tenantFilter = ref('all');
const tenantName = item => item?.ownerName || String(item?.ownerId || '').slice(0, 8) || '未知租户';
const tenantOptions = computed(() => {
  const seen = new Map();
  for (const item of props.accounts) if (item.ownerId && !seen.has(item.ownerId)) seen.set(item.ownerId, tenantName(item));
  return [...seen].map(([value, label]) => ({ value, label: `${label}（${props.accounts.filter(item => item.ownerId === value).length}）` }));
});
const shownAccounts = computed(() => isSuperAdmin && tenantFilter.value !== 'all' ? props.accounts.filter(item => item.ownerId === tenantFilter.value) : props.accounts);
const account = computed(() => props.accounts.find(item => item.id === activeAccount.value));
const slotLocked = computed(() => Boolean(account.value) && account.value.slotActive === false);
const creatorAccount = computed(() => account.value?.loginMode === 'creator');
const active = computed(() => conversations.value.find(item => item.id === activeConversation.value));
const displayName = value => String(value || '抖音聚合').trim() || '抖音聚合';
const initials = value => displayName(value).slice(0, 2);
const accountName = item => displayName(item?.nickname || item?.name || item?.douyinId || item?.uid);
const accountStatusText = item => item?.status === 'online' ? '在线' : item?.status === 'reauth' ? '需重登' : item?.status === 'offline' ? '离线' : '未登录';
const conversationName = item => displayName(item?.title || item?.peer_id);
const conversationPreview = item => item?.last_message || '暂无消息';
const emojiGlyph = name => emojis.find(item => item.name === name)?.glyph || '🙂';
const videoLink = item => item.media?.link || item.media?.url || '';
const avatarFailed = event => { event.currentTarget.hidden = true; };
const emojiFailed = ref(new Set());
// 表情图片加载失败时才回退到文字字符，避免大图与字符同时显示。
// 表情地址依次尝试：原始签名地址 → 去掉 -sign 的同路径域名 → 文字字符。
const emojiStage = ref({});
const emojiAltUrl = url => String(url || '').replace(/^(https:\/\/p[\w-]*?)-sign(\.douyinpic\.com\/)/, '$1$2');
const mediaFailed = (event, item) => {
  if (item.media?.kind === 'emoji') {
    const url = String(item.media.url || '');
    if (!(emojiStage.value[item.id] > 0) && emojiAltUrl(url) !== url) { emojiStage.value = { ...emojiStage.value, [item.id]: 1 }; return; }
    avatarFailed(event); emojiFailed.value.add(item.id); return;
  }
  avatarFailed(event);
};
const posterFailed = event => {
  const image = event.currentTarget;
  image.hidden = true;
  image.parentElement?.classList.add('poster-failed');
};
const posterUrl = item => posterUrls.value[item.id] || '';
function releasePosterUrls() {
  Object.values(posterUrls.value).forEach(value => URL.revokeObjectURL(value));
  posterUrls.value = {};
}
function releaseImageUrls() {
  Object.values(imageUrls.value).forEach(value => { if (String(value).startsWith('blob:')) URL.revokeObjectURL(value); });
  imageUrls.value = {};
}
async function syncPosterUrls(items) {
  const desired = new Map(items.filter(item => item.media?.posterProxy).map(item => [item.id, item.media.posterProxy]));
  const retained = { ...posterUrls.value };
  for (const [id, value] of Object.entries(retained)) {
    if (desired.has(id)) continue;
    URL.revokeObjectURL(value);
    delete retained[id];
  }
  posterUrls.value = retained;
  await Promise.all([...desired].map(async ([id, proxy]) => {
    if (posterUrls.value[id] || posterLoads.get(id) === proxy) return;
    posterLoads.set(id, proxy);
    try {
      const blob = await apiBlob(proxy);
      const current = messages.value.find(item => item.id === id);
      if (disposed || posterLoads.get(id) !== proxy || current?.media?.posterProxy !== proxy) return;
      const previous = posterUrls.value[id];
      if (previous) URL.revokeObjectURL(previous);
      posterUrls.value = { ...posterUrls.value, [id]: URL.createObjectURL(blob) };
    } catch { /* Keep the text fallback when a remote poster is unavailable. */ }
    finally { if (posterLoads.get(id) === proxy) posterLoads.delete(id); }
  }));
}
async function syncImageUrls(items) {
  const desired = new Map(items.filter(item => item.media?.kind === 'image' && item.id).map(item => [item.id, `/api/v1/media/image/${encodeURIComponent(item.id)}`]));
  const retained = { ...imageUrls.value };
  for (const [id, value] of Object.entries(retained)) {
    if (desired.has(id)) continue;
    if (String(value).startsWith('blob:')) URL.revokeObjectURL(value);
    delete retained[id];
  }
  imageUrls.value = retained;
  // 本机节点链路在多张大图同时回传时会损坏帧并断线，所以图片最多两张并行拉取。
  const queue = [...desired];
  const worker = async () => { while (queue.length) await loadOne(queue.shift()); };
  const loadOne = async ([id, proxy]) => {
    if (String(imageUrls.value[id] || '').startsWith('blob:') || imageLoads.get(id) === proxy) return;
    imageLoads.set(id, proxy);
    try {
      let blob = await apiBlob(proxy);
      // 抖音聊天的图片可能是 HEIC，浏览器（非 Safari）无法直接显示，转成 JPEG。
      if (/hei[cf]/i.test(blob.type)) {
        const { default: heic2any } = await import('heic2any');
        const converted = await heic2any({ blob, toType: 'image/jpeg', quality: 0.9 });
        blob = Array.isArray(converted) ? converted[0] : converted;
      }
      const current = messages.value.find(item => item.id === id);
      if (disposed || imageLoads.get(id) !== proxy || !current || current.media?.kind !== 'image') return;
      const previous = imageUrls.value[id];
      if (String(previous || '').startsWith('blob:')) URL.revokeObjectURL(previous);
      imageUrls.value = { ...imageUrls.value, [id]: URL.createObjectURL(blob) };
    } catch { /* The original URL remains as a best-effort fallback. */ }
    finally { if (imageLoads.get(id) === proxy) imageLoads.delete(id); }
  };
  await Promise.all([worker(), worker()]);
}
const messageSenderName = item => item.direction === 'outbound' ? accountName(account.value) : (item.sender_name || `群成员 ${String(item.sender_uid || '').slice(-6) || '未知'}`);
const messageSenderAvatar = item => item.direction === 'outbound' ? (account.value?.avatar || '') : (item.sender_avatar || '');
const messageMediaUrl = item => item.media?.kind === 'image' && item.id
  ? imageUrls.value[item.id] || item.media.url || ''
  : item.media?.kind === 'emoji' ? (emojiStage.value[item.id] > 0 ? emojiAltUrl(item.media.url) : item.media.url || '') : item.media?.url || '';
const messageStatus = item => ({ pending_upstream: '待上游发送', sending: '正在发送', delivery_uncertain: `发送结果待核对：${item.status_reason || '请先核对平台后再决定是否重发'}`, sent: item.status_reason ? `已发送 · ${item.status_reason}` : '已发送', accepted: '已发送', received: '已接收', failed: item.status_reason ? `发送失败：${item.status_reason}` : '发送失败' })[item.status] || item.status || '未知状态';
const visibleConversations = computed(() => conversations.value.filter(item => item.account === activeAccount.value
  && (!groupChatsHidden.value || item.type !== 'group')
  && (filter.value === 'all' || item.type === filter.value)
  && `${item.title} ${item.last_message} ${item.peer_id}`.toLowerCase().includes(query.value.trim().toLowerCase())));
const unread = computed(() => conversations.value
  .filter(item => item.account === activeAccount.value && (!groupChatsHidden.value || item.type !== 'group'))
  .reduce((sum, item) => sum + (Number(item.unread) || 0), 0));
const connectionLabel = computed(() => ({ online: '实时已连接', connecting: '实时连接中', reconnecting: '实时重连中', offline: '实时未连接' })[realtimeStatus.value]);

async function loadConversations() {
  loading.value = true;
  const accountId = activeAccount.value;
  const requestId = ++conversationLoadSeq;
  const requestedAt = Date.now();
  try {
    const suffix = accountId ? `?account=${encodeURIComponent(accountId)}` : '';
    const rows = await apiRequest(`conversations${suffix}`);
    // A poll that started before "全部已读" may finish afterwards. Ignore its
    // stale unread badges instead of briefly restoring every old red dot.
    if (requestId !== conversationLoadSeq || accountId !== activeAccount.value) return;
    const clearedAt = unreadClearedAt.get(accountId) || 0;
    const nextRows = clearedAt > requestedAt
      ? rows.map(row => ({ ...row, unread: 0 }))
      : rows;
    conversationsByAccount.set(accountId, nextRows);
    conversations.value = nextRows;
    if (activeConversation.value && !conversations.value.some(item => item.id === activeConversation.value)) { activeConversation.value = ''; messages.value = []; }
    applyFocus();
  } catch (cause) { if (requestId === conversationLoadSeq && accountId === activeAccount.value) error.value = cause.message; }
  finally { if (requestId === conversationLoadSeq) loading.value = false; }
}
function loadGroupChatPreference(accountId) {
  if (!accountId) { groupChatsHidden.value = false; return; }
  groupChatsHidden.value = localStorage.getItem(groupChatPreferenceKey(accountId)) === '1';
}
function toggleGroupChatVisibility(value) {
  const accountId = activeAccount.value;
  if (!accountId) return;
  const previous = groupChatsHidden.value;
  groupChatsHidden.value = Boolean(value);
  try {
    localStorage.setItem(groupChatPreferenceKey(accountId), groupChatsHidden.value ? '1' : '0');
    if (groupChatsHidden.value && active.value?.type === 'group') { activeConversation.value = ''; messages.value = []; }
  } catch (cause) {
    groupChatsHidden.value = previous;
    error.value = cause.message || '群聊屏蔽状态保存失败';
  }
}
async function syncActive() {
  clearTimeout(syncTimer);
  if (!activeAccount.value) { conversations.value = []; return; }
  const accountId = activeAccount.value;
  error.value = '';
  await loadConversations();
  if (accountId !== activeAccount.value) return;
  try {
    await apiRequest('conversations/sync', { method: 'POST', body: { account: accountId } });
    let attempts = 0;
    const poll = async () => {
      if (++attempts > 5 || accountId !== activeAccount.value) return;
      await loadConversations();
      // Keep the UI responsive while the server completes its bounded upstream
      // fetch; realtime events still provide the immediate path when available.
      if (attempts < 5) syncTimer = setTimeout(poll, attempts * 500);
    };
    syncTimer = setTimeout(poll, 500);
  } catch (cause) { error.value = cause.message; }
}
// 转人工弹窗点击后：切到对应账号并选中该会话（会话列表加载完成后才能选中）。
function applyFocus() {
  if (!pendingFocus || pendingFocus.accountId !== activeAccount.value) return;
  const row = conversations.value.find(item => item.id === pendingFocus.conversationId);
  if (!row) return;
  pendingFocus = null;
  if (activeConversation.value !== row.id) void selectConversation(row);
}
async function selectConversation(row) {
  error.value = '';
  activeConversation.value = row.id; messages.value = []; cancelImage();
  try {
    // Show the server-cached recent messages immediately; history=1 triggers
    // an account-wide upstream sync and made every conversation switch slow.
    const history = await apiRequest(`conversations/${row.id}/messages?limit=120`);
    if (activeConversation.value !== row.id) return;
    messages.value = history;
    await scrollBottom();
    row.unread = 0;
    apiRequest(`conversations/${row.id}`, { method: 'PATCH', body: { read: true } }).catch(cause => { error.value = cause.message; });
  } catch (cause) { error.value = cause.message; }
}
async function scrollBottom() { await nextTick(); if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight; }
async function startChat() {
  if (!activeAccount.value) { error.value = '请先选择账号。'; return; }
  if (!target.value.trim()) { error.value = creatorAccount.value ? '请输入对方 sec_uid。' : '请输入 secuid 或抖音号。'; return; }
  try {
    const value = target.value.trim();
    const resolvedTarget = creatorAccount.value
      ? { sec_uid: value }
      : /^\d+$/.test(value) ? { uid: value } : value.startsWith('MS4wLjAB') ? { sec_uid: value } : { douyin_id: value };
    const row = await apiRequest('conversations', { method: 'POST', body: { account: activeAccount.value, type: 'private', target: resolvedTarget, title: targetTitle.value || value } });
    newChat.value = false; target.value = ''; targetTitle.value = ''; await loadConversations(); await selectConversation(row);
  } catch (cause) { error.value = cause.message; }
}
async function postMessage(body, timeoutMs = 10000) {
  if (!active.value || sending.value) return null;
  sending.value = true; error.value = ''; notice.value = '';
  try {
    const selectedChannel = creatorAccount.value ? 'creator_web' : (body.channel || channel.value);
    const message = await apiRequest(`conversations/${active.value.id}/messages`, { method: 'POST', body: { ...body, channel: selectedChannel, requestId: crypto.randomUUID() }, timeoutMs });
    // Realtime refreshes may have inserted the pending row while the POST was in flight; apply the final status instead of dropping it.
    const existingIndex = messages.value.findIndex(item => item.id === message.id);
    if (existingIndex >= 0) messages.value.splice(existingIndex, 1, message);
    else messages.value.push(message);
    await loadConversations(); await scrollBottom();
    if (message.status === 'failed' || message.status === 'delivery_uncertain') error.value = message.status_reason || '消息发送失败。';
    else notice.value = message.status === 'sent' ? (message.status_reason ? `消息已发送。${message.status_reason}` : '消息已发送。') : '消息已进入发送队列。';
    return message;
  } catch (cause) { error.value = cause.message; return null; } finally { sending.value = false; }
}
async function loadCoverImage(source) {
  if (!source || !(source.startsWith('/') || source.startsWith('data:image/') || source.startsWith(window.location.origin))) return null;
  try {
    const response = await fetch(source);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    // The server validates the real image format; only guard the size here.
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) return null;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    let width = 0, height = 0;
    try { const bitmap = await createImageBitmap(new Blob([bytes])); width = bitmap.width; height = bitmap.height; bitmap.close?.(); } catch { /* dimensions are optional */ }
    return { data: btoa(binary), width, height };
  } catch (cause) { console.warn('card cover read failed', cause); return null; }
}
async function send() {
  if (selectedCard.value) {
    const picked = selectedCard.value, origin = window.location.origin;
    // 无直达链接的卡片（二维码/企微/QQ/QQ群）跳转到公开落地页；封面需为 http(s) 绝对地址，data URL 无法下发。
    const cover = picked.ext?.cover || (Array.isArray(picked.images) ? picked.images[0] : '') || '';
    // 预设封面直接使用字节系 CDN 地址（手机端可加载）；自定义封面才回退到本站地址并由服务端上传。
    const cdnCover = coverCdnUrl(cover);
    const coverUrl = cdnCover || (cover.startsWith('/') ? `${origin}${cover}` : /^https?:\/\//i.test(cover) ? cover : '');
    // 手机端不加载自签名站点的封面：把封面读成 base64，由服务端通过账号的 ImageX 会话上传为抖音 CDN 地址。
    const coverImage = cdnCover ? null : await loadCoverImage(cover);
    // 企微/公众号文章直接使用用户配置的链接；二维码、QQ、QQ群没有 http(s) 地址，才回退到落地页。
    const direct = [picked.link, picked.ext?.jumpType === 'wecom' ? picked.ext?.wecomUrl : '', picked.ext?.jumpType === 'article' ? picked.ext?.articleUrl : '', picked.ext?.jumpType === 'qq' ? picked.ext?.qqUrl : '', picked.ext?.jumpType === 'qqgroup' ? picked.ext?.qqGroup : ''].map(item => String(item || '').trim()).find(item => /^https?:\/\//i.test(item));
    if (!direct) { error.value = '该卡片没有可用的跳转链接，请先在“卡片管理”中改为企业微信、QQ、QQ群或公众号文章，并填写以 http(s):// 开头的链接。'; return; }
    const message = await postMessage({ type: 'card', card: { title: picked.title || picked.name, description: picked.description || '', link: direct, coverUrl, ...(coverImage ? { coverImage } : {}) }, channel: 'default' });
    if (message) selectedCard.value = null;
    return;
  }
  let content = composer.value.trim();
  if (!content) return;
  if (encryptOn.value) {
    // 点击发送时才加密：输入内容作为可见的发送内容，随机取一组表情作秘密消息，以零宽字符分散嵌入发送内容。
    const secret = COVER_PRESETS[Math.floor(Math.random() * COVER_PRESETS.length)];
    if (new TextEncoder().encode(secret).length > ENCRYPT_MAX_BYTES) { error.value = `加密表情不能超过 ${ENCRYPT_MAX_BYTES} 字节。`; return; }
    content = encodeHidden(content, secret, { mode: 'scatter' });
  }
  // Creator Web launches a headless browser and may need several seconds to
  // load the target page before the upstream send receipt arrives.
  const message = await postMessage({ type: 'text', content }, creatorAccount.value ? 90000 : 10000);
  if (message) composer.value = '';
}
async function sendEmoji(emoji) {
  if (!active.value) { emojiOpen.value = false; error.value = '请先选择一个会话，再发送表情。'; return; }
  if (sending.value) return;
  emojiOpen.value = false;
  if (emoji.text) { await postMessage({ type: 'text', content: emoji.text, channel: 'default' }); return; }
  await postMessage({ type: 'emoji', emoji: { name: emoji.name }, channel: 'default' });
}
function openEmoji() {
  if (sending.value) return;
  if (!active.value) { error.value = '请先选择一个会话，再使用表情。'; return; }
  emojiOpen.value = !emojiOpen.value;
}
async function loadQuickPhrases(accountId = activeAccount.value) {
  const defaults = ['您好，我马上处理。', '请稍等，我正在为您核实。', '感谢您的反馈。'];
  if (!accountId) { quickPhrases.value = defaults; return; }
  try {
    // 快捷话术属于租户：直接读取组件管理里的 quick_reply；没有时再回退到旧的按账号话术。
    const components = await apiRequest('components');
    const fromComponents = (Array.isArray(components) ? components : [])
      .filter(item => item.type === 'quick_reply' && typeof item.payload?.text === 'string' && item.payload.text.trim())
      .map(item => item.payload.text.trim());
    if (accountId !== activeAccount.value) return;
    if (fromComponents.length) { quickPhrases.value = [...new Set(fromComponents)]; return; }
  } catch { /* 组件读取失败时继续使用旧话术 */ }
  try {
    const result = await apiRequest(`quick-phrases?account=${encodeURIComponent(accountId)}`);
    if (Array.isArray(result?.phrases) && result.phrases.length) { quickPhrases.value = result.phrases; return; }
    // Migrate the old browser-wide draft once, then keep all future data per account.
    const saved = JSON.parse(localStorage.getItem('douyinjuhe.quick-phrases') || 'null');
    if (Array.isArray(saved) && saved.every(item => typeof item === 'string') && saved.filter(Boolean).length) {
      const migrated = [...new Set(saved.map(item => item.trim()).filter(Boolean))].slice(0, 30);
      await apiRequest('quick-phrases', { method: 'PUT', body: { account: accountId, phrases: migrated } });
      localStorage.removeItem('douyinjuhe.quick-phrases');
      quickPhrases.value = migrated;
      return;
    }
    quickPhrases.value = defaults;
  } catch { quickPhrases.value = defaults; }
}
async function toggleQuickPhrases() {
  quickPhraseOpen.value = !quickPhraseOpen.value;
  if (quickPhraseOpen.value) await loadQuickPhrases();
}
function insertQuickPhrase(value) {
  if (!active.value) { quickPhraseOpen.value = false; error.value = '请先选择一个会话，再使用快捷话术。'; return; }
  composer.value = value;
  quickPhraseOpen.value = false;
}
async function openCards() {
  if (sending.value) return;
  if (!active.value) { error.value = '请先选择一个会话，再使用卡片。'; return; }
  if (cardOpen.value) { cardOpen.value = false; return; }
  // 先展开弹层，再在后台刷新，保证发送的是最新保存的链接；列表请求慢或重试时按钮不会像没反应。
  cardOpen.value = true;
  cardsLoading.value = true;
  try { cards.value = await apiRequest('cards'); }
  catch (cause) { cardOpen.value = false; error.value = cause.message; }
  finally { cardsLoading.value = false; }
}
const promoteCard = ref(null), promoteOpen = ref(false);
function insertCard(card) {
  cardOpen.value = false;
  const ext = card.ext || {};
  const hasLink = [card.link, ext.wecomUrl, ext.articleUrl, ext.qqUrl, ext.qqGroup].some(item => /^https?:\/\//i.test(String(item || '').trim()));
  if (!hasLink) { error.value = '该卡片没有可用的跳转链接，请先在“统一卡片”中改为企业微信、QQ、QQ群或公众号文章，并填写以 http(s):// 开头的链接。'; return; }
  promoteCard.value = card;
  promoteOpen.value = true;
}
function chooseImage() {
  if (sending.value) return;
  if (!active.value) { error.value = '请先选择一个会话，再选择图片。'; return; }
  imageInput.value?.click();
}
function readFile(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file); }); }
function imageSize(url) { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error('图片无法解析')); image.src = url; }); }
async function onImageSelected(event) {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) { error.value = '仅支持 JPEG、PNG、GIF、WebP 图片。'; return; }
  if (file.size <= 0 || file.size > 8 * 1024 * 1024) { error.value = '图片大小必须在 8 MB 以内。'; return; }
  try {
    const dataUrl = await readFile(file), dimensions = await imageSize(dataUrl);
    imagePreview.value = dataUrl;
    imagePayload.value = { data: dataUrl.slice(dataUrl.indexOf(',') + 1), width: dimensions.width, height: dimensions.height, name: file.name };
  } catch (cause) { error.value = cause.message; }
}
function cancelCard() { selectedCard.value = null; error.value = ''; notice.value = ''; }
function cancelImage() { imagePayload.value = null; imagePreview.value = ''; uploadProgress.value = 0; uploadStage.value = ''; }
async function sendImage() {
  if (!imagePayload.value) return;
  uploadProgress.value = 15; uploadStage.value = '正在校验图片';
  const localPreview = imagePreview.value;
  uploadProgress.value = 35; uploadStage.value = '正在上传图片';
  const pending = setInterval(() => { if (uploadProgress.value < 88) uploadProgress.value += 3; }, 500);
  const message = await postMessage({ type: 'image', image: imagePayload.value, channel: 'default' }, 150000);
  clearInterval(pending);
  if (message) {
    uploadProgress.value = 100; uploadStage.value = '发送完成';
    const stored = messages.value.find(item => item.id === message.id);
    if (stored?.media && !stored.media.url) stored.media.url = localPreview;
    setTimeout(cancelImage, 500);
  } else { uploadProgress.value = 0; uploadStage.value = ''; }
}
async function clearUnread() {
  const accountId = activeAccount.value;
  if (!accountId) return;
  try {
    await apiRequest('conversations/read', { method: 'PATCH', body: { account: accountId } });
    unreadClearedAt.set(accountId, Date.now());
    if (accountId === activeAccount.value) conversations.value.forEach(row => { if (row.account === accountId) row.unread = 0; });
  } catch (cause) { error.value = cause.message; }
}
async function pin() { if (!active.value) return; try { const result = await apiRequest(`conversations/${active.value.id}`, { method: 'PATCH', body: { pinned: !active.value.pinned } }); active.value.pinned = result.pinned; await loadConversations(); } catch (cause) { error.value = cause.message; } }
async function removeConversation() { if (!active.value) return; try { await apiRequest(`conversations/${active.value.id}`, { method: 'DELETE' }); activeConversation.value = ''; messages.value = []; await loadConversations(); notice.value = '会话及本地消息记录已删除。'; } catch (cause) { error.value = cause.message; } }
async function refreshFromRealtime({ refreshActiveMessages, conversationId }) {
  await loadConversations();
  if (!refreshActiveMessages || !activeConversation.value || conversationId && conversationId !== activeConversation.value) return;
  const shouldFollow = messageList.value && messageList.value.scrollHeight - messageList.value.scrollTop - messageList.value.clientHeight < 80;
  try {
    messages.value = await apiRequest(`conversations/${activeConversation.value}/messages?limit=120`);
    if (shouldFollow) await scrollBottom();
  } catch (cause) { error.value = cause.message; }
}
function onRealtime(message) { conversationRefreshScheduler?.schedule(message, activeConversation.value); }
watch(() => props.accounts, value => { if (!activeAccount.value && value.length) activeAccount.value = value[0].id; }, { immediate: true });
watch(tenantFilter, () => {
  if (shownAccounts.value.length && !shownAccounts.value.some(item => item.id === activeAccount.value)) activeAccount.value = shownAccounts.value[0].id;
});
watch(activeAccount, value => {
  activeConversation.value = '';
  messages.value = [];
  conversations.value = value ? (conversationsByAccount.get(value) || []) : [];
  loadGroupChatPreference(value);
  loadQuickPhrases(value);
  applyFocus();
  syncActive();
}, { immediate: true });
watch(() => props.focus, focus => {
  if (!focus?.conversationId) return;
  pendingFocus = { accountId: focus.accountId, conversationId: focus.conversationId };
  if (focus.accountId && focus.accountId !== activeAccount.value) activeAccount.value = focus.accountId;
  else { applyFocus(); if (pendingFocus) void loadConversations(); }
}, { immediate: true });
watch(error, value => {
  clearTimeout(errorTimer);
  if (value) errorTimer = setTimeout(() => { if (error.value === value) error.value = ''; }, 6000);
});
watch(() => props.accounts.map(item => item.id), ids => realtime?.updateAccounts(ids), { deep: true });
watch(() => messages.value.map(item => `${item.id}:${item.media?.posterProxy || ''}:${item.media?.kind || ''}`).join('|'), () => { void syncPosterUrls(messages.value); void syncImageUrls(messages.value); });
onMounted(() => {
  conversationRefreshScheduler = createConversationRefreshScheduler({ getActiveAccount: () => activeAccount.value, onRefresh: refreshFromRealtime });
  realtime = createRealtime({ onStatus: status => { realtimeStatus.value = status; }, onEvent: onRealtime });
  realtime.updateAccounts(props.accounts.map(item => item.id));
});
onUnmounted(() => { disposed = true; clearTimeout(syncTimer); clearTimeout(errorTimer); conversationRefreshScheduler?.dispose(); realtime?.close(); releasePosterUrls(); releaseImageUrls(); });
</script>

<template>
  <section class="aggregate-page">
    <header class="aggregate-toolbar"><div><h1>聚合聊天</h1><small>{{ connectionLabel }} · {{ unread }} 条未读</small></div><div><el-button :icon="Refresh" :loading="loading" :disabled="!activeAccount||slotLocked" @click="syncActive">刷新账号数据</el-button><el-button type="primary" :icon="Plus" :disabled="!activeAccount||slotLocked" @click="newChat=true">发起聊天</el-button></div></header>
    <el-alert v-if="error" :title="error" type="error" show-icon closable @close="error=''"/><el-alert v-else-if="notice" :title="notice" type="success" show-icon closable @close="notice=''"/>
    <div class="chat-layout">
      <aside class="accounts-pane"><div class="pane-heading"><div><span class="pane-kicker">WORKSPACE</span><b>账号列表</b></div><el-button link :disabled="!activeAccount" @click="clearUnread">全部已读</el-button></div><el-select v-if="isSuperAdmin" v-model="tenantFilter" class="tenant-filter" aria-label="按租户筛选账号"><el-option value="all" label="全部租户"/><el-option v-for="option in tenantOptions" :key="option.value" :value="option.value" :label="option.label"/></el-select><div class="account-list"><button v-for="item in shownAccounts" :key="item.id" :class="{active:item.id===activeAccount}" @click="activeAccount=item.id"><span class="round-avatar"><span>{{initials(accountName(item))}}</span><img v-if="item.avatar" :src="item.avatar" :alt="accountName(item)" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="avatarFailed"/></span><span><b>{{accountName(item)}}</b><small :title="item.statusReason||undefined">{{accountStatusText(item)}}<template v-if="isSuperAdmin"> · {{tenantName(item)}}</template></small></span></button><el-empty v-if="!shownAccounts.length" description="还没有可用账号" :image-size="60"/></div></aside>
       <aside class="conversation-pane"><div class="pane-heading conversation-heading"><div><span class="pane-kicker">INBOX</span><b>会话</b></div><el-input v-model="query" :prefix-icon="Search" placeholder="搜索" clearable/></div><el-radio-group v-model="filter" size="small"><el-radio-button value="all">全部</el-radio-button><el-radio-button value="private">私聊</el-radio-button><el-radio-button value="group">群聊</el-radio-button></el-radio-group><div class="conversation-preferences"><span>屏蔽当前账号群聊</span><el-switch :model-value="groupChatsHidden" :disabled="!activeAccount" aria-label="屏蔽当前账号群聊" @change="toggleGroupChatVisibility"/></div><div class="conversation-list"><button v-for="item in visibleConversations" :key="item.id" :class="{active:item.id===activeConversation}" @click="selectConversation(item)"><span class="round-avatar"><span>{{initials(conversationName(item))}}</span><img v-if="item.peer_avatar" :src="item.peer_avatar" :alt="conversationName(item)" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="avatarFailed"/></span><span><b>{{conversationName(item)}} <i>{{item.type==='group'?'群聊':'私聊'}}</i><i v-if="item.pinned">置顶</i></b><small>{{conversationPreview(item)}}</small></span><em v-if="item.unread">{{item.unread>99?'99+':item.unread}}</em></button><el-empty v-if="!visibleConversations.length" :description="activeAccount?'当前账号暂无会话':'请先选择账号'" :image-size="60"/></div></aside>
      <main class="message-pane" :class="{locked:slotLocked}" :aria-disabled="slotLocked || undefined" :title="slotLocked?'该账号未绑定有效坑位，请到账号管理中激活后使用':undefined">
        <div class="message-heading"><div><strong>{{active?.title||'请选择会话'}}</strong><small>{{account?`当前账号：${accountName(account)}`:'未选择发送账号'}}</small></div><div><el-button link :icon="Star" :disabled="!active" @click="pin">{{active?.pinned?'取消置顶':'置顶会话'}}</el-button><el-popconfirm title="删除会话及本地消息记录？" @confirm="removeConversation"><template #reference><el-button link type="danger" :icon="Delete" :disabled="!active">删除会话</el-button></template></el-popconfirm></div></div>
         <div ref="messageList" class="messages"><template v-if="messages.length"><article v-for="item in messages" :key="item.id" :class="['message',item.direction]"><span v-if="active?.type==='group'" class="round-avatar message-avatar"><span>{{initials(messageSenderName(item))}}</span><img v-if="messageSenderAvatar(item)" :src="messageSenderAvatar(item)" :alt="messageSenderName(item)" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="avatarFailed"/></span><div class="message-body"><b v-if="active?.type==='group'" class="sender-name">{{messageSenderName(item)}}</b><template v-if="item.media?.kind==='video'"><a v-if="item.media.url" class="media-message video" :href="videoLink(item)" target="_blank" rel="noreferrer"><video :src="item.media.url" :poster="posterUrl(item) || undefined" controls preload="metadata" playsinline/></a><a v-else-if="item.media.posterProxy" class="media-message video" :href="videoLink(item) || undefined" target="_blank" rel="noreferrer"><img v-if="posterUrl(item)" :src="posterUrl(item)" alt="视频封面" loading="lazy" decoding="async" @error="posterFailed"/><span class="video-label">{{posterUrl(item)?'打开视频':'视频封面加载中'}}</span></a><p v-else>{{item.content}}</p></template><template v-else-if="item.media?.kind==='live'"><a v-if="item.media.link || item.media.url" class="media-message live-message" :href="videoLink(item)" target="_blank" rel="noreferrer"><img v-if="item.media.poster" :src="item.media.poster" alt="直播封面" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="avatarFailed"/><span class="video-label">{{item.media.name || '直播分享'}}{{item.media.title ? `：${item.media.title}` : ''}} · 打开直播</span></a><p v-else>{{item.content}}</p></template><a v-else-if="item.media?.kind==='card'" class="media-message card" :href="item.media.link || undefined" target="_blank" rel="noreferrer"><img v-if="item.media.coverUrl" :src="item.media.coverUrl" alt="卡片封面" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="avatarFailed"/><span class="card-text"><span class="card-title">{{item.media.title || item.content}}</span><span class="card-source"><el-icon class="card-link-icon" aria-hidden="true"><Link/></el-icon>{{item.media.description || '点击查看'}}</span></span></a><a v-else-if="messageMediaUrl(item) || item.media?.kind==='emoji'" class="media-message" :class="item.media.kind" :href="messageMediaUrl(item) || undefined" target="_blank" rel="noreferrer"><img v-if="messageMediaUrl(item)" :src="messageMediaUrl(item)" :alt="item.media.kind==='emoji'?(item.media.name||'表情'):'图片'" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="mediaFailed($event,item)"/><span v-if="item.media.kind==='emoji' && (!messageMediaUrl(item) || emojiFailed.has(item.id))" class="emoji-fallback" aria-label="表情">{{emojiGlyph(item.media.name)}}</span></a><p v-else>{{item.content}}</p><small>{{new Date(item.created).toLocaleString()}} · {{messageStatus(item)}}</small></div></article></template><el-empty v-else :description="active?'当前会话暂无消息':activeAccount?'请选择会话':'请先选择账号'" :image-size="72"/></div>
        <div v-if="imagePayload" class="image-draft"><img :src="imagePreview" alt="待发送图片"/><div><b>{{imagePayload.name}}</b><el-progress v-if="uploadStage" :percentage="uploadProgress" :status="uploadProgress===100?'success':undefined"/><small>{{uploadStage||'图片已就绪'}}</small></div><el-button :icon="Delete" circle title="移除图片" :disabled="sending" @click="cancelImage"/><el-button type="primary" :loading="sending" @click="sendImage">发送图片</el-button></div>
        <div class="composer-tools" role="toolbar" aria-label="消息工具">
           <el-popover v-model:visible="emojiOpen" trigger="manual" placement="top-start" :width="250">
            <template #reference><el-button text class="composer-tool" :class="{active:emojiOpen}" :icon="ChatDotRound" :disabled="sending" @click="openEmoji">表情</el-button></template>
            <div class="emoji-picker"><button v-for="emoji in emojis" :key="emoji.name" :title="emoji.name" @click="sendEmoji(emoji)"><span class="emoji-glyph" aria-hidden="true">{{emoji.glyph}}</span><span>{{emoji.name}}</span></button></div>
           </el-popover>
           <el-popover v-model:visible="quickPhraseOpen" trigger="manual" placement="top-start" :width="280">
             <template #reference><el-button text class="composer-tool" :class="{active:quickPhraseOpen}" :icon="MagicStick" :disabled="sending" @click="toggleQuickPhrases">快捷话术</el-button></template>
             <div class="shortcut-picker"><button v-for="phrase in quickPhrases" :key="phrase" type="button" @click="insertQuickPhrase(phrase)">{{phrase}}</button><small>快捷话术来自“组件管理”，属于当前租户，所有账号共用。</small></div>
           </el-popover>
           <el-popover v-model:visible="cardOpen" trigger="manual" placement="top-start" :width="300">
             <template #reference><el-button text class="composer-tool" :class="{active:cardOpen}" :icon="Tickets" :disabled="sending" @click="openCards">卡片</el-button></template>
             <div class="shortcut-picker"><button v-for="card in cards" :key="card.id" type="button" @click="insertCard(card)"><b>{{card.name}}</b><small>{{card.title}}</small></button><small v-if="cardsLoading">{{ cards.length ? '正在刷新卡片…' : '正在加载卡片…' }}</small><el-empty v-if="!cards.length && !cardsLoading" description="暂无可用卡片" :image-size="45"/></div>
           </el-popover>
           <el-button text class="composer-tool" :icon="Picture" :disabled="sending" @click="chooseImage">图片</el-button>
          <input ref="imageInput" class="file-input" type="file" accept="image/jpeg,image/png,image/gif,image/webp" @change="onImageSelected"/>
          <label class="encrypt-switch" :class="{on:encryptOn}" title="开启后，发送时自动随机取一组表情，以零宽字符嵌入消息中（表情不超过 500 字节）"><el-switch v-model="encryptOn" size="small" :disabled="sending||!!selectedCard" aria-label="开启加密发送"/><span>加密</span></label>
        </div>
        <div class="composer"><div v-if="selectedCard" class="card-draft"><el-alert :title="`卡片：${selectedCard.title || selectedCard.name}`" description="将按原生卡片发送；如需更换请重新选择卡片。" type="info" :closable="false"/><el-button :icon="Delete" circle title="移除卡片" aria-label="移除卡片" :disabled="sending" @click="cancelCard"/></div><el-input v-else v-model="composer" type="textarea" :rows="3" :disabled="!active||sending||!!imagePayload" placeholder="输入消息内容，按 Enter 发送，Shift + Enter 换行" @keydown.enter.exact.prevent="send"/><div class="send-row"><el-select v-model="channel" aria-label="发送通道" :disabled="creatorAccount||!!selectedCard"><el-option v-if="creatorAccount" label="创作者中心网页版" value="creator_web"/><el-option v-else label="默认通道" value="default"/><el-option v-if="!creatorAccount" label="通道20(v20)" value="v20"/></el-select><el-button type="primary" :loading="sending" :disabled="!active||(!composer.trim()&&!selectedCard)||!!imagePayload" @click="send">发送</el-button></div></div>
      </main>
    </div>
    <el-dialog v-model="newChat" title="发起聊天" width="min(520px,94vw)"><el-form label-position="top"><el-form-item :label="creatorAccount?'对方 sec_uid':'对方数字 UID 或抖音号'" required><el-input v-model="target" :placeholder="creatorAccount?'请输入对方 sec_uid（不能使用数字 UID 或抖音号）':'请输入数字 UID、抖音号（抖音聊天不支持直接使用 sec_uid）'"/></el-form-item><el-form-item label="会话名称"><el-input v-model="targetTitle" placeholder="可选，默认使用对方标识"/></el-form-item><el-form-item v-if="!creatorAccount" label="发送通道"><el-select v-model="channel"><el-option label="默认通道" value="default"/><el-option label="通道20(v20)" value="v20"/></el-select></el-form-item><el-alert v-else title="创作者中心支持私聊文本、表情和图片；发送在服务器端使用独立的 Creator 登录状态。" type="info" :closable="false"/></el-form><el-alert v-if="error" :title="error" :closable="false"/><template #footer><el-button @click="newChat=false">取消</el-button><el-button type="primary" @click="startChat">打开会话</el-button></template></el-dialog>
    <CardPromoteDialog v-model="promoteOpen" :card="promoteCard"/>
  </section>
</template>

<style scoped>
.aggregate-page{display:flex;flex-direction:column;gap:12px;min-width:0;height:calc(100vh - 118px);min-height:520px;overflow:hidden}.aggregate-toolbar{display:flex;align-items:center;justify-content:space-between;flex:0 0 auto}.aggregate-toolbar h1{margin:0;font-size:20px}.aggregate-toolbar small,.message-heading small{display:block;color:#8896aa;margin-top:4px}.aggregate-toolbar>div:last-child{display:flex;gap:10px}.chat-layout{display:grid;grid-template-columns:240px 300px minmax(0,1fr);background:#fff;border-radius:8px;flex:1;min-height:0;overflow:hidden}.accounts-pane,.conversation-pane{border-right:1px solid #edf0f5;padding:14px;min-width:0;min-height:0;display:flex;flex-direction:column;gap:12px}.pane-title,.message-heading{display:flex;justify-content:space-between;align-items:center}.account-list,.conversation-list{overflow:auto;overscroll-behavior:contain;flex:1;min-height:0}.account-list button,.conversation-list button{width:100%;display:flex;align-items:center;gap:10px;border:0;background:transparent;padding:10px;border-radius:8px;text-align:left}.account-list button.active,.conversation-list button.active{background:#eaf2ff;color:#245fe5}.account-list b,.account-list small,.conversation-list b,.conversation-list small{display:block}.account-list small,.conversation-list small{color:#8b98aa;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.conversation-list button>span:nth-child(2){min-width:0;flex:1}.conversation-list i{font-style:normal;font-size:10px;color:#3474df;margin-left:4px}.conversation-list em{font-style:normal;background:#f04444;color:#fff;border-radius:12px;min-width:21px;padding:2px 6px;text-align:center;font-size:11px}.round-avatar{position:relative;width:36px;height:36px;border-radius:50%;background:#edf3fc;display:grid;place-items:center;overflow:hidden;flex:0 0 auto;color:#3d73d9;font-size:12px;font-weight:700}.round-avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#edf3fc}.conversation-pane .el-radio-group{width:100%}.conversation-pane :deep(.el-radio-button){flex:1}.conversation-pane :deep(.el-radio-button__inner){width:100%}.message-pane{min-width:0;min-height:0;overflow:hidden;display:grid;grid-template-rows:auto minmax(180px,1fr) auto auto auto}.message-heading{padding:14px 16px;border-bottom:1px solid #edf0f5;min-width:0}.message-heading>div:first-child{min-width:0}.message-heading strong,.message-heading small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.messages{display:flex;flex-direction:column;gap:12px;min-height:0;overflow:auto;overscroll-behavior:contain;padding:18px;background:#f7f9fc}.messages .el-empty{margin:auto}.message{display:flex;align-items:flex-start;gap:8px;max-width:78%;align-self:flex-start}.message.outbound{align-self:flex-end;flex-direction:row-reverse}.message-avatar{width:32px;height:32px;font-size:11px}.message-body{min-width:0}.sender-name{display:block;margin:0 2px 4px;color:#65748a;font-size:12px;font-weight:500}.message.outbound .sender-name{text-align:right}.message p{display:inline-block;margin:0;background:#fff;padding:10px 13px;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere;text-align:left}.message.outbound p{background:#dcecff}.message small{display:block;color:#8793a6;margin-top:4px;font-size:11px}.message.outbound small{text-align:right}.media-message{display:block;width:max-content;max-width:min(320px,100%);border-radius:8px;overflow:hidden;background:#eef2f7}.media-message img{display:block;max-width:100%;max-height:320px;object-fit:contain}.media-message.emoji{background:transparent}.media-message.emoji img{width:100px;height:100px}.image-draft{display:grid;grid-template-columns:64px minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid #edf0f5;background:#f9fbfe}.image-draft>img{width:64px;height:52px;object-fit:cover;border-radius:6px}.image-draft b,.image-draft small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.image-draft small{color:#8793a6;margin-top:3px}.image-draft :deep(.el-progress){margin-top:5px}.composer-tools{padding:8px 12px;border-top:1px solid #edf0f5;display:flex;gap:4px;flex-wrap:wrap}.composer{padding:0 14px 14px;min-width:0}.send-row{display:flex;justify-content:flex-end;gap:10px;margin-top:8px}.send-row .el-select{width:150px}.el-dialog .el-select{width:100%}.file-input{display:none}.emoji-picker{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.emoji-picker button{border:1px solid #edf0f5;background:#fff;border-radius:6px;padding:6px;cursor:pointer;color:#526176}.emoji-picker button:hover{border-color:#3474df;background:#f5f8ff}.emoji-picker img{display:block;width:52px;height:52px;object-fit:contain;margin:auto}.emoji-picker span{display:block;font-size:12px;margin-top:3px}@media(max-width:1000px){.chat-layout{grid-template-columns:210px 250px minmax(0,1fr)}}@media(max-width:760px){.aggregate-page{height:auto;min-height:0;overflow:visible}.aggregate-toolbar{align-items:start;gap:10px;flex-wrap:wrap}.chat-layout{grid-template-columns:minmax(0,1fr);overflow:visible;min-height:0}.accounts-pane,.conversation-pane{border-right:0;border-bottom:1px solid #edf0f5;height:250px}.message-pane{height:620px;overflow:hidden}.message{max-width:92%}.image-draft{grid-template-columns:52px minmax(0,1fr) auto}.image-draft>img{width:52px;height:46px}.image-draft .el-button:last-child{grid-column:2/4}.media-message{max-width:min(260px,100%)}}
.shortcut-picker{display:grid;gap:7px;max-height:260px;overflow:auto}.shortcut-picker button{border:1px solid #edf0f5;background:#fff;border-radius:6px;padding:8px 10px;text-align:left;cursor:pointer;color:#526176}.shortcut-picker button:hover{border-color:#3474df;background:#f5f8ff}.shortcut-picker button small,.shortcut-picker>small{display:block;color:#8a96a8;margin-top:3px;font-size:11px}.shortcut-picker .el-empty{margin:0}
.media-message.video.poster-failed{min-height:96px;min-width:220px;display:flex;align-items:center;justify-content:center;padding:16px;background:#eef2f7;color:#65748a}.media-message.video.poster-failed .video-label{margin:0}.video-label{display:block;padding:7px 9px;color:#65748a;font-size:12px;background:#eef2f7}
.chat-layout{border:1px solid var(--hz-line);border-radius:8px}
.aggregate-toolbar small,.message-heading small{color:var(--hz-muted)}
.card-draft{display:flex;align-items:center;gap:8px}.card-draft .el-alert{flex:1;min-width:0}
.accounts-pane,.conversation-pane,.message-heading,.image-draft,.composer-tools{border-color:var(--hz-line)}
.account-list button.active,.conversation-list button.active{background:var(--hz-primary-soft);color:var(--hz-primary)}
.account-list small,.conversation-list small,.message small{color:var(--hz-muted)}
.conversation-list i{color:var(--hz-primary)}
.round-avatar{background:var(--hz-primary-soft);color:var(--hz-primary)}
.round-avatar img{background:var(--hz-primary-soft)}
.messages{background:var(--hz-bg)}
.message p{border:1px solid var(--hz-line)}
.message.outbound p{background:var(--hz-primary-soft);border-color:#d2e4e2}
.media-message,.media-message.video.poster-failed{background:#f0f0ed}
.emoji-picker button{border-color:var(--hz-line);color:var(--hz-text)}
.emoji-picker button:hover{border-color:#9bbcbc;background:var(--hz-primary-soft)}
.pane-heading{min-height:42px;padding:2px 0 10px;border-bottom:1px solid var(--hz-line);gap:10px}
.pane-heading>div{min-width:0;display:flex;flex-direction:column;gap:3px}
.pane-heading b{font-size:14px;color:var(--hz-text);line-height:1.2}
.pane-kicker{font-size:9px;letter-spacing:.12em;color:#9b968e;font-weight:700}
.conversation-heading .el-input{width:150px}
.account-list,.conversation-list{padding-top:3px}
.account-list button,.conversation-list button{border:1px solid transparent;transition:background .16s ease,border-color .16s ease}
.account-list button:hover,.conversation-list button:hover{background:#fafaf8;border-color:var(--hz-line)}
.account-list button.active,.conversation-list button.active{border-color:#cfe1df}
.conversation-pane .el-radio-group{padding:2px 0 10px;border-bottom:1px solid var(--hz-line)}
 .conversation-preferences{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 2px 8px;color:var(--hz-muted);font-size:11px;border-bottom:1px solid var(--hz-line)}
.conversation-pane :deep(.el-radio-button__inner){border-color:var(--hz-line);color:var(--hz-muted);background:#fff}
.conversation-pane :deep(.el-radio-button:first-child .el-radio-button__inner){border-radius:5px 0 0 5px}
.conversation-pane :deep(.el-radio-button:last-child .el-radio-button__inner){border-radius:0 5px 5px 0}
.conversation-pane :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner){color:#fff;background:var(--hz-primary);border-color:var(--hz-primary);box-shadow:-1px 0 0 0 var(--hz-primary)}
.composer-tools{min-height:49px;padding:7px 12px;background:#fbfbf9;align-items:center;gap:2px}
.composer-tool{height:34px!important;min-width:76px;padding:0 11px!important;border:1px solid transparent!important;border-radius:6px!important;color:var(--hz-muted)!important;gap:6px;font-size:12px!important}
.composer-tools .composer-tool:nth-of-type(-n+3){border-right:1px solid var(--hz-line)!important;border-radius:6px 0 0 6px!important;margin-right:3px}
.composer-tool:hover,.composer-tool.active{color:var(--hz-primary)!important;background:var(--hz-primary-soft)!important;border-color:#cfe1df!important}
.composer-tool .el-icon{font-size:15px}
.encrypt-switch{display:inline-flex;align-items:center;gap:6px;margin-left:8px;padding:0 10px;height:34px;font-size:12px;color:var(--hz-muted);cursor:pointer;border-radius:6px}
.encrypt-switch.on{color:var(--hz-primary);background:var(--hz-primary-soft)}
.composer-tools .el-popover{display:flex}
.composer-tools .file-input{order:3}
@media(max-width:760px){.conversation-heading{align-items:flex-end}.conversation-heading .el-input{width:calc(100vw - 178px);max-width:180px}.composer-tool{min-width:72px;padding:0 8px!important}}
.chat-layout{grid-template-columns:228px 328px minmax(0,1fr);box-shadow:0 6px 18px rgba(36,35,33,.045)}
.accounts-pane{background:#fbfbf9;padding:16px 12px 10px}
.conversation-pane{background:#fff;padding:16px 12px 10px}
.accounts-pane,.conversation-pane{gap:10px}
.account-list,.conversation-list{margin:0 -2px;padding:7px 2px 4px;scrollbar-width:thin;scrollbar-color:#d2d0ca transparent}
.account-list::-webkit-scrollbar,.conversation-list::-webkit-scrollbar,.messages::-webkit-scrollbar{width:7px}
.account-list::-webkit-scrollbar-thumb,.conversation-list::-webkit-scrollbar-thumb,.messages::-webkit-scrollbar-thumb{background:#d2d0ca;border-radius:8px}
.account-list button,.conversation-list button{min-height:58px;padding:9px 10px;border-radius:8px;gap:11px}
.account-list button.active{position:relative;background:#e4efee;box-shadow:inset 3px 0 var(--hz-primary)}
.account-list b,.conversation-list b{font-size:13px;line-height:1.35;color:var(--hz-text);font-weight:650}
.account-list small{font-size:11px;line-height:1.2}
.account-list small::before{content:"";display:inline-block;width:6px;height:6px;margin:0 5px 1px 0;border-radius:50%;background:#b9b5ae}
.account-list button.active small::before{background:#4d9b7b}
.conversation-list button{min-height:68px;align-items:flex-start;padding:10px}
.conversation-list button + button{border-top-color:transparent}
.conversation-list button>span:nth-child(2){padding-top:1px}
.conversation-list small{font-size:11px;line-height:1.35;margin-top:5px}
.conversation-list i{display:inline-block;padding:2px 5px;border:1px solid #d6e6e3;border-radius:4px;font-size:9px;line-height:1;color:var(--hz-primary);vertical-align:1px}
.conversation-list em{align-self:flex-start;margin-top:1px;box-shadow:0 1px 2px rgba(176,82,77,.18)}
.round-avatar{width:38px;height:38px;box-shadow:0 0 0 1px rgba(47,111,114,.08)}
.message-pane{background:#fff}.message-pane.locked{opacity:.5;filter:grayscale(1);pointer-events:none;user-select:none}
.message-heading{padding:16px 18px;background:#fff;box-shadow:0 1px 0 rgba(227,225,220,.7)}
.message-heading strong{display:block;font-size:15px;line-height:1.35;color:var(--hz-text)}
.message-heading small{font-size:11px}
.message-heading>div:last-child{display:flex;align-items:center;gap:3px}
.messages{padding:22px 24px;background:#f6f6f3;scrollbar-width:thin;scrollbar-color:#d2d0ca transparent}
.message{max-width:min(78%,620px)}
.message p{line-height:1.55;box-shadow:0 1px 1px rgba(36,35,33,.025)}
.composer{padding:0 16px 16px;background:#fff}
.composer-tools{padding:8px 14px;background:#fff}
.composer :deep(.el-textarea__inner){min-height:74px!important;padding:12px 13px;line-height:1.5;background:#fbfbf9}
.send-row{margin-top:9px}
@media(max-width:1000px){.chat-layout{grid-template-columns:210px 285px minmax(0,1fr)}}
@media(max-width:760px){.chat-layout{grid-template-columns:minmax(0,1fr);box-shadow:none}.accounts-pane,.conversation-pane{padding:14px 11px 9px}.message-heading{padding:14px}.messages{padding:16px}.composer{padding:0 12px 12px}.message{max-width:92%}}
.pane-heading b{display:flex;align-items:center;gap:7px}
.pane-heading b::after{content:"";display:block;width:5px;height:5px;border-radius:50%;background:#c7c3bc}
.account-list button + button{border-top:1px solid #efede9;border-top-left-radius:0;border-top-right-radius:0}
.account-list button.active + button{border-top-color:transparent}
.conversation-list button.active{box-shadow:inset 3px 0 var(--hz-primary),0 1px 2px rgba(36,35,33,.03)}
.conversation-list button.active .round-avatar{box-shadow:0 0 0 2px #cfe1df}
.message-heading{min-height:65px}
.message-heading>div:first-child{padding-left:2px}
.message-heading>div:first-child::before{content:none}
.composer{border-top:1px solid var(--hz-line);padding-top:11px}
.composer .el-textarea__inner{border-color:#dedbd5!important}
.send-row .el-select{min-width:150px}
.send-row .el-button{min-width:62px}
.media-message.card{display:flex;align-items:stretch;gap:12px;padding:12px;width:min(300px,100%);max-width:min(300px,100%);color:inherit;text-decoration:none;background:#f3f3f1}
.media-message.card img{width:72px;height:72px;flex:none;object-fit:cover;border-radius:6px}
.card-text{display:flex;flex:1;flex-direction:column;justify-content:space-between;gap:10px;min-width:0}
.card-title{font-size:15px;font-weight:600;line-height:1.4;overflow-wrap:anywhere}
.card-source{display:flex;align-items:center;gap:4px;padding-top:6px;border-top:1px solid #e3e3df;font-size:12px;color:#8a8f98;overflow-wrap:anywhere}
.card-link-icon{flex:none}
.tenant-filter{width:100%}
</style>
