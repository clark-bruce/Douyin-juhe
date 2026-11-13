<script setup>
import { computed, defineAsyncComponent, ref, watch, onMounted, onUnmounted } from 'vue';
import ConnectionStatus from './components/ConnectionStatus.vue';
import LoginPage from './modules/auth/LoginPage.vue';
import DashboardView from './modules/dashboard/DashboardView.vue';
// 其余页面按需加载，首屏只下载控制台与登录页所需代码。
const ReplyManager = defineAsyncComponent(() => import('./modules/automation/ReplyManager.vue'));
const AccountManager = defineAsyncComponent(() => import('./modules/accounts/AccountManager.vue'));
const NodePanel = defineAsyncComponent(() => import('./modules/nodes/NodePanel.vue'));
const ComponentManager = defineAsyncComponent(() => import('./modules/components/ComponentManager.vue'));
const ProxyManager = defineAsyncComponent(() => import('./modules/proxies/ProxyManager.vue'));
const CardManager = defineAsyncComponent(() => import('./modules/cards/CardManager.vue'));
const TemplateManager = defineAsyncComponent(() => import('./modules/automation/TemplateManager.vue'));
const TaskManager = defineAsyncComponent(() => import('./modules/automation/TaskManager.vue'));
const PointsPage = defineAsyncComponent(() => import('./modules/billing/PointsPage.vue'));
const SlotManager = defineAsyncComponent(() => import('./modules/billing/SlotManager.vue'));
const PersonalSettings = defineAsyncComponent(() => import('./modules/settings/PersonalSettings.vue'));
const AggregateWorkspace = defineAsyncComponent(() => import('./modules/aggregate/AggregateWorkspace.vue'));
const SystemSettings = defineAsyncComponent(() => import('./modules/settings/SystemSettings.vue'));
const AISettings = defineAsyncComponent(() => import('./modules/settings/AISettings.vue'));
const AdminPanel = defineAsyncComponent(() => import('./modules/admin/AdminPanel.vue'));
const AutomationSettings = defineAsyncComponent(() => import('./modules/automation/AutomationSettings.vue'));
import { createRealtime } from './lib/realtime.js';
import { apiRequest } from './lib/api.js';
import { QuestionFilled, Bell, ArrowLeft, ArrowRight } from '@element-plus/icons-vue';
import { modules, subpages, schemas } from './navigation/registry.js';
// 管理后台入口：网址 hash 必须携带服务端配置的密钥（#admin-<密钥>），裸 #admin 不再生效。
// hash 不会发送给服务器；密钥只在本标签页的 sessionStorage 中保留，并随管理接口以 X-Admin-Entry 头发送。
const adminEntryKey = typeof window !== 'undefined' ? (window.location.hash.match(/^#admin-([A-Za-z0-9_-]{16,128})$/) || [])[1] || '' : '';
if (adminEntryKey) sessionStorage.setItem('douyinjuhe.adminEntry', adminEntryKey);
const page = ref(adminEntryKey ? '管理员后台' : '控制台');
const authenticated = ref(Boolean(session()?.token));
const expanded = ref(false);
const collapsed = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 650px)').matches);
const search = ref('');
const editor = ref('');
const advanced = ref(false);
const accounts = ref([]);
const accountError = ref('');
const accountChecking = ref(false);
const accountCheckNotice = ref('');
const billingSummary = ref({ formal: null, test: null, slots: null });
const profileAvatar = ref('');
const notificationSettings = ref({ popup: true, browser: false, sound: false });
const handoffQueue = ref([]);
const currentHandoff = ref(null);
const aggregateFocus = ref(null);
let accountRealtime;
let handoffTimer;
// 侧栏“通知”（管理员发布的公告）与“帮助”（用户反馈）
const noticeOpen = ref(false);
const helpOpen = ref(false);
const announcements = ref([]);
const announcementsSeen = ref(Number(localStorage.getItem('douyinjuhe.announcementsSeen') || 0));
const unreadAnnouncements = computed(() => announcements.value.filter(item => item.created > announcementsSeen.value).length);
const feedbackList = ref([]);
const feedbackForm = ref({ content: '', contact: '' });
const feedbackBusy = ref(false);
const feedbackError = ref('');
const feedbackNotice = ref('');
const fmtTime = value => value ? new Date(value).toLocaleString() : '';
async function loadAnnouncements() {
  if (!session()?.token) { announcements.value = []; return; }
  try { announcements.value = await apiRequest('announcements'); } catch { /* 公告暂时读不到时保持上次内容 */ }
}
let announcementsTimer;
function onVisibilityChanged() { if (document.visibilityState === 'visible') void loadAnnouncements(); }
async function openNotices() {
  noticeOpen.value = true;
  await loadAnnouncements();
  const newest = announcements.value.reduce((max, item) => Math.max(max, item.created), 0);
  if (newest) { announcementsSeen.value = newest; localStorage.setItem('douyinjuhe.announcementsSeen', String(newest)); }
}
async function openHelp() {
  helpOpen.value = true; feedbackError.value = ''; feedbackNotice.value = '';
  try { feedbackList.value = await apiRequest('feedback'); } catch (cause) { feedbackError.value = cause.message; }
}
async function submitFeedback() {
  const value = feedbackForm.value;
  if (!value.content.trim()) { feedbackError.value = '请填写要反馈的问题。'; return; }
  feedbackBusy.value = true; feedbackError.value = ''; feedbackNotice.value = '';
  try {
    await apiRequest('feedback', { method: 'POST', body: { content: value.content.trim(), contact: value.contact.trim() } });
    feedbackForm.value = { content: '', contact: value.contact };
    feedbackNotice.value = '反馈已提交，处理后会在这里回复你。';
    feedbackList.value = await apiRequest('feedback');
  } catch (cause) { feedbackError.value = cause.message; }
  finally { feedbackBusy.value = false; }
}
const isNarrowScreen = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 650px)').matches);
const columns = computed(() => schemas[page.value] || []);
function navigate(name) {
  if (name === '自动回复') {
    if (collapsed.value) { collapsed.value = false; expanded.value = true; }
    else expanded.value = !expanded.value;
  } else if (name === '高级') advanced.value = !advanced.value;
  else {
    page.value = name; search.value = ''; editor.value = '';
    if (isNarrowScreen.value) collapsed.value = true;
  }
}
function session() { try { return JSON.parse(localStorage.getItem('douyinjuhe.session') || 'null'); } catch { return null; } }
function onAuthenticated() { authenticated.value = true; if (typeof window !== 'undefined') window.dispatchEvent(new Event('douyinjuhe-session')); }
async function loadAccounts() {
  const current = session();
  if (!current?.token) { accounts.value = []; return; }
  try {
    const response = await fetch('/api/v1/accounts', { headers: { Authorization: `Bearer ${current.token}` }, signal: AbortSignal.timeout(8000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '账号加载失败');
    accounts.value = result; accountError.value = '';
  } catch (error) { accountError.value = error.message; }
}
async function loadBillingSummary() {
  const current = session();
  if (!current?.token) { billingSummary.value = { formal: null, test: null, slots: null }; return; }
  try {
    const [points, slots] = await Promise.all([apiRequest('points'), apiRequest('slots')]);
    billingSummary.value = { formal: points.balance.formal, test: points.balance.test, slots: slots.length };
  } catch { /* 页面专页会显示具体错误，顶部摘要保持上次可见值 */ }
}
async function loadProfileAvatar() {
  if (!session()?.token) { profileAvatar.value = ''; return; }
  try { profileAvatar.value = (await apiRequest('auth/profile')).avatar || ''; }
  catch { /* 头像读取失败时保持当前显示 */ }
}
async function loadNotificationSettings() {
  if (!session()?.token) { notificationSettings.value = { popup: true, browser: false, sound: false }; return; }
  try { const result = await apiRequest('settings/notifications'); notificationSettings.value = result.notifications; }
  catch { /* Keep defaults if preferences are temporarily unavailable. */ }
}
function playIncomingTone() {
  if (typeof window === 'undefined') return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass(), oscillator = context.createOscillator(), gain = context.createGain();
  oscillator.type = 'sine'; oscillator.frequency.value = 740;
  gain.gain.setValueAtTime(0.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.1, context.currentTime + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
  oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.24); oscillator.onended = () => context.close();
}
function showNextHandoff() {
  if (handoffQueue.value.length === 0) { currentHandoff.value = null; return; }
  currentHandoff.value = handoffQueue.value.shift();
}
function dismissHandoff() {
  currentHandoff.value = null;
  clearTimeout(handoffTimer);
  if (handoffQueue.value.length > 0) {
    handoffTimer = setTimeout(showNextHandoff, 300);
  }
}
function handleHandoffClick() {
  if (currentHandoff.value) {
    const { conversationId, accountId } = currentHandoff.value;
    aggregateFocus.value = { conversationId, accountId, nonce: Date.now() };
    navigate('聚合');
    dismissHandoff();
  }
}
function onNotificationSettingsChanged(event) { notificationSettings.value = { ...notificationSettings.value, ...event.detail }; }
function notifyIncomingMessage(event) {
  // 新消息通知已废弃，改由转人工提醒接管弹窗
}
function notifyHandoffRequested(event) {
  if (event.event !== 'handoff.requested') return;
  const { conversation, contactProvided } = event.payload || {};
  if (!conversation) return;
  const account = accounts.value.find(item => item.id === conversation.account);
  const title = conversation.title || account?.nickname || account?.name || '用户';
  const message = contactProvided ? `${title} 已留下联系方式，请及时处理` : `${title} 需要转人工服务`;
  handoffQueue.value.push({ conversationId: conversation.id, accountId: conversation.account, title: message });
  if (!currentHandoff.value) showNextHandoff();
  if (notificationSettings.value.sound) playIncomingTone();
}
async function removeAccount(id) {
  const current = session(); if (!current?.token) return;
  const response = await fetch(`/api/v1/accounts/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${current.token}` } });
  if (response.ok) await loadAccounts(); else accountError.value = '删除账号失败';
}
async function checkAccounts() {
  const current = session(); if (!current?.token) return;
  if (accountChecking.value) return;
  accountChecking.value = true;
  accountError.value = '';
  accountCheckNotice.value = '';
  try {
    const response = await fetch('/api/v1/accounts/check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${current.token}` }, body: JSON.stringify({}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '账号检测失败');
    await loadAccounts();
    accountCheckNotice.value = `账号检测完成，共检查 ${Array.isArray(result.accounts) ? result.accounts.length : 0} 个账号。`;
  } catch (error) { accountError.value = error.message; }
  finally { accountChecking.value = false; }
}
function onAccountRealtime(message) {
  notifyIncomingMessage(message);
  notifyHandoffRequested(message);
  if (message.event === 'message.created') return;
  const accountId = message.payload?.accountId;
  if (!accountId) return;
  if (message.event === 'account.deleted') {
    accounts.value = accounts.value.filter(account => account.id !== accountId);
    return;
  }
  if (message.event === 'account.updated') {
    const index = accounts.value.findIndex(account => account.id === accountId);
    if (index >= 0) accounts.value[index] = { ...accounts.value[index], ...message.payload };
    else loadAccounts();
    return;
  }
  if (message.event !== 'account.session') return;
  const index = accounts.value.findIndex(account => account.id === accountId);
  if (index >= 0) accounts.value[index] = { ...accounts.value[index], status: message.payload.status, checkedAt: message.payload.checkedAt || Date.now(), statusReason: message.payload.statusReason || '' };
}
function connectAccountRealtime() {
  accountRealtime?.close();
  accountRealtime = createRealtime({ onEvent: onAccountRealtime });
  accountRealtime.updateAccounts(accounts.value.map(account => account.id));
}
watch(accounts, value => accountRealtime?.updateAccounts(value.map(account => account.id)), { deep: true });
function onSessionChanged() { authenticated.value = Boolean(session()?.token); if (authenticated.value) { loadAccounts(); loadBillingSummary(); loadProfileAvatar(); loadNotificationSettings(); loadAnnouncements(); connectAccountRealtime(); } else { profileAvatar.value = ''; accounts.value = []; announcements.value = []; notificationSettings.value = { popup: true, browser: false, sound: false }; dismissHandoff(); accountRealtime?.close(); } }
function onBillingChanged() { loadBillingSummary(); }
onMounted(() => { announcementsTimer = setInterval(loadAnnouncements, 60000); document.addEventListener('visibilitychange', onVisibilityChanged); window.addEventListener('douyinjuhe-session', onSessionChanged); window.addEventListener('douyinjuhe-billing', onBillingChanged); window.addEventListener('douyinjuhe-profile', loadProfileAvatar); window.addEventListener('douyinjuhe-notification-settings', onNotificationSettingsChanged); if (page.value !== '管理员后台' && authenticated.value) Promise.all([loadAccounts(), loadBillingSummary(), loadProfileAvatar(), loadNotificationSettings(), loadAnnouncements()]).finally(connectAccountRealtime); });
onUnmounted(() => { clearInterval(announcementsTimer); document.removeEventListener('visibilitychange', onVisibilityChanged); accountRealtime?.close(); clearTimeout(handoffTimer); window.removeEventListener('douyinjuhe-session', onSessionChanged); window.removeEventListener('douyinjuhe-billing', onBillingChanged); window.removeEventListener('douyinjuhe-profile', loadProfileAvatar); window.removeEventListener('douyinjuhe-notification-settings', onNotificationSettingsChanged); });
</script>

<template>
  <AdminPanel v-if="page==='管理员后台'"/>
  <LoginPage v-else-if="!authenticated" @authenticated="onAuthenticated"/>
  <div v-else class="workspace" :class="{ collapsed, 'nav-expanded': !collapsed }">
    <div v-if="!collapsed && isNarrowScreen" class="sidebar-backdrop" @click="collapsed = true"></div>
    <button v-if="currentHandoff" class="handoff-notice" type="button" aria-live="polite" @click="handleHandoffClick">
      <strong>{{ currentHandoff.title }}</strong>
      <small>点击查看会话</small>
    </button>
    <aside v-if="page!=='管理员后台'" class="sidebar" aria-label="侧边栏">
      <button class="collapse" :aria-label="collapsed?'展开侧边栏':'折叠侧边栏'" :aria-expanded="!collapsed" @click="collapsed = !collapsed"><el-icon><ArrowRight v-if="collapsed"/><ArrowLeft v-else/></el-icon><span v-if="!collapsed">折叠侧边栏</span></button>
      <nav>
        <template v-for="[name, icon] in modules" :key="name">
          <button :class="['nav-item', { selected: page === name }]" :title="name" :aria-label="name" :aria-expanded="name==='自动回复'?expanded && !collapsed:undefined" @click="navigate(name)"><span class="icon-tile"><el-icon><component :is="icon"/></el-icon></span><span v-if="!collapsed">{{ name }}</span><el-icon v-if="name==='自动回复' && !collapsed" class="chevron" :style="{transform:expanded?'rotate(90deg)':''}"><ArrowRight/></el-icon></button>
          <div v-if="name === '自动回复' && expanded && !collapsed" class="subnav"><template v-for="sub in subpages" :key="sub"><button :class="{selected:page===sub}" @click="navigate(sub)">{{ sub }}</button><div v-if="sub==='高级' && advanced" class="advanced-nav"><button v-for="child in ['任务模板','任务管理']" :key="child" :class="{selected:page===child}" @click="navigate(child)">{{ child }}</button></div></template></div>
        </template>
      </nav>
      <div class="tools"><button type="button" class="tool-item" aria-label="帮助与反馈" @click="openHelp"><el-icon><QuestionFilled/></el-icon><span v-if="!collapsed">帮助</span></button><button type="button" class="tool-item" aria-label="通知" @click="openNotices"><el-icon><Bell/></el-icon><span v-if="!collapsed">通知</span><em v-if="unreadAnnouncements" class="tool-badge">{{ unreadAnnouncements }}</em></button></div>
    </aside>
    <el-dialog v-model="noticeOpen" title="通知" width="min(560px, 94vw)" append-to-body>
      <el-empty v-if="!announcements.length" description="暂无通知" :image-size="70"/>
      <article v-for="item in announcements" :key="item.id" class="announce-item"><strong>{{ item.title }}</strong><p>{{ item.body }}</p><small>{{ fmtTime(item.created) }}</small></article>
    </el-dialog>
    <el-dialog v-model="helpOpen" title="帮助与反馈" width="min(600px, 94vw)" append-to-body>
      <p class="help-tip">遇到问题或有建议，请在这里提交，处理后管理员会在下方回复。</p>
      <el-form label-position="top" @submit.prevent="submitFeedback">
        <el-form-item label="问题描述" required><el-input v-model="feedbackForm.content" type="textarea" :rows="4" maxlength="2000" show-word-limit placeholder="请描述遇到的问题，或想要的功能"/></el-form-item>
        <el-form-item label="联系方式（可选）"><el-input v-model="feedbackForm.contact" maxlength="100" placeholder="微信 / 手机 / QQ，方便管理员联系你"/></el-form-item>
        <el-alert v-if="feedbackError" :title="feedbackError" type="error" show-icon :closable="false"/>
        <el-alert v-if="feedbackNotice" :title="feedbackNotice" type="success" show-icon :closable="false"/>
        <el-button type="primary" :loading="feedbackBusy" :disabled="!feedbackForm.content.trim()" @click="submitFeedback">提交反馈</el-button>
      </el-form>
      <div v-if="feedbackList.length" class="feedback-history">
        <h4>我的反馈</h4>
        <article v-for="item in feedbackList" :key="item.id" class="feedback-item"><div class="feedback-head"><el-tag size="small" :type="item.status==='closed'?'success':'warning'">{{ item.status==='closed' ? '已处理' : '待处理' }}</el-tag><small>{{ fmtTime(item.created) }}</small></div><p>{{ item.content }}</p><p v-if="item.reply" class="feedback-reply"><b>管理员回复：</b>{{ item.reply }}</p></article>
      </div>
    </el-dialog>
    <section class="content">
      <header v-if="page!=='管理员后台'"><div class="brand"><img class="brand-logo" src="/logo.svg" alt="" width="31" height="31"><strong>抖音聚合</strong></div><div class="profile"><img class="avatar" :src="profileAvatar || '/logo.svg'" alt="" width="31" height="31"><div><strong>抖音聚合工作台</strong><small><ConnectionStatus/></small></div><div class="balances"><span>正式 {{billingSummary.formal ?? '—'}}</span><span>测试 {{billingSummary.test ?? '—'}}</span><span>席位 {{billingSummary.slots ?? '—'}}</span></div></div></header>
      <main>
        <div v-if="!['控制台','账号管理','私聊自动回复','群聊自动回复','聚合','设置','积分兑换','坑位管理','个人设置','系统设置','AI配置','管理员后台'].includes(page)" class="page-heading"><h1>{{ page }}</h1><el-button v-if="!['组件管理','代理','统一卡片','任务模板','任务管理'].includes(page)" disabled size="small">刷新</el-button></div>
        <DashboardView v-if="page==='控制台'" :accounts="accounts"/>
        <AccountManager v-else-if="page==='账号管理'" :rows="accounts" :error="accountError" :checking="accountChecking" :check-notice="accountCheckNotice" @refresh="loadAccounts" @check="checkAccounts" @remove="removeAccount"/>
        <ReplyManager v-else-if="['私聊自动回复','群聊自动回复'].includes(page)" :kind="page"/>
        <AggregateWorkspace v-else-if="page==='聚合'" :accounts="accounts" :focus="aggregateFocus"/>
        <SystemSettings v-else-if="page==='系统设置'"/>
        <AISettings v-else-if="page==='AI配置'"/>
        <AutomationSettings v-else-if="page==='设置'" :accounts="accounts"/>
        <NodePanel v-else-if="page==='登录器连接'"/>
        <ComponentManager v-else-if="page==='组件管理'"/>
        <ProxyManager v-else-if="page==='代理'"/>
        <CardManager v-else-if="page==='统一卡片'"/>
        <TemplateManager v-else-if="page==='任务模板'"/>
        <TaskManager v-else-if="page==='任务管理'"/>
        <PointsPage v-else-if="page==='积分兑换'"/>
        <SlotManager v-else-if="page==='坑位管理'"/>
        <PersonalSettings v-else-if="page==='个人设置'"/>
        <section v-else-if="columns.length" class="data-panel"><div class="toolbar"><el-input v-model="search" clearable :placeholder="page.includes('自动回复')?'搜索名称 / 账号 / 触发词':'搜索 ID / 名称'"/><el-button>刷新</el-button><div class="toolbar-actions"><template v-if="['私聊自动回复','群聊自动回复'].includes(page)"><el-button type="primary" @click="editor='rule'">新增{{ page }}</el-button></template></div></div><el-table :data="[]" empty-text="暂无数据"><el-table-column v-for="column in columns" :key="column" :label="column" min-width="100"/></el-table></section>
        <section v-else class="data-panel"><el-empty :description="`${page}功能尚未实现`"/></section>
        <footer>抖音聚合 · 多账号运营管理平台</footer>
      </main>
    </section>
  </div>
</template>
<style scoped>
.workspace.admin-mode{grid-template-columns:minmax(0,1fr)}.admin-mode main{min-height:100vh;padding:24px}
.toolbar-actions{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}.advanced-nav{padding-left:12px}.toolbar{flex-wrap:wrap}
.handoff-notice{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:999;background:var(--hz-surface);color:var(--hz-text);border:1px solid var(--hz-line);border-left:3px solid var(--hz-primary);border-radius:7px;padding:12px 18px;box-shadow:0 6px 20px rgba(36,35,33,.12);display:flex;flex-direction:column;gap:4px;cursor:pointer;transition:transform .2s,box-shadow .2s;max-width:420px;font:inherit;text-align:left}.handoff-notice:hover{transform:translateX(-50%) translateY(-2px);box-shadow:0 10px 26px rgba(36,35,33,.16)}.handoff-notice:focus-visible{outline:2px solid rgba(47,111,114,.38);outline-offset:2px}.handoff-notice strong{font-size:14px;font-weight:600;color:var(--hz-text)}.handoff-notice small{font-size:12px;color:var(--hz-muted)}
.sidebar{background:var(--hz-sidebar);border-right:1px solid var(--hz-line)}
.collapse{border-color:transparent;border-radius:6px;color:var(--hz-sidebar-muted)}.collapse:hover{background:rgba(255,255,255,.7);color:var(--hz-text)}
.nav-item{height:40px;border-radius:6px;color:var(--hz-sidebar-muted);font-size:13px;padding:5px 9px}.nav-item:hover{background:rgba(255,255,255,.78);color:var(--hz-text)}.nav-item.selected{color:var(--hz-primary);background:var(--hz-primary-soft);border-color:#d2e4e2}.nav-item.selected::before{left:-12px;width:2px;background:var(--hz-primary)}.icon-tile{height:28px;width:28px;border-radius:5px;color:currentColor}.nav-item.selected .icon-tile{color:var(--hz-primary)}.subnav{border-left:1px solid var(--hz-line-strong);margin:0 0 8px 23px}.subnav button{padding:8px 14px;color:var(--hz-sidebar-muted);font-size:12px}.subnav button:hover,.subnav .selected{color:var(--hz-primary);background:rgba(255,255,255,.7);border-radius:4px}.tools{border-top-color:var(--hz-line);padding-top:8px}.tools>div{height:36px;padding:0 9px;font-size:12px;color:var(--hz-sidebar-muted)}.content>header{height:66px;padding:10px 28px;border-bottom:1px solid var(--hz-line)}.brand{font-size:17px;letter-spacing:.1px}.brand-mark{width:31px;height:31px;border-radius:7px;border-color:#9bbcbc;color:var(--hz-primary);background:var(--hz-primary-soft);font-size:17px}.profile{padding:5px 0 5px 12px}.avatar{border-radius:7px;object-fit:cover}.balances span{border-radius:4px;border-color:var(--hz-line);background:var(--hz-surface-muted)}.data-panel,.panel{border:1px solid var(--hz-line);border-radius:7px;box-shadow:0 1px 2px rgba(36,35,33,.025)}.data-panel{padding:19px}.stat{border:1px solid var(--hz-line);border-radius:7px;box-shadow:0 1px 2px rgba(36,35,33,.025)}
.tools>.tool-item{position:relative;display:flex;align-items:center;gap:11px;width:100%;height:36px;padding:0 9px;border:0;border-radius:6px;background:transparent;font:inherit;font-size:12px;color:var(--hz-sidebar-muted);text-align:left;cursor:pointer}
.tools>.tool-item:hover{background:rgba(255,255,255,.78);color:var(--hz-text)}
.tool-badge{margin-left:auto;min-width:16px;height:16px;padding:0 5px;border-radius:8px;background:#d9534f;color:#fff;font-style:normal;font-size:10px;line-height:16px;text-align:center}
.announce-item{padding:12px 0;border-bottom:1px solid var(--hz-line)}.announce-item:last-child{border-bottom:0}
.announce-item strong{font-size:14px;color:var(--hz-text)}.announce-item p{margin:6px 0;font-size:13px;line-height:1.7;color:var(--hz-text);white-space:pre-wrap;word-break:break-word}.announce-item small{color:var(--hz-muted);font-size:11px}
.help-tip{margin:0 0 14px;color:var(--hz-muted);font-size:13px}
.feedback-history{margin-top:18px;padding-top:12px;border-top:1px solid var(--hz-line)}.feedback-history h4{margin:0 0 8px;font-size:13px;color:var(--hz-text)}
.feedback-item{padding:10px 12px;margin-bottom:8px;background:var(--hz-surface-muted);border-radius:6px}
.feedback-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}.feedback-head small{color:var(--hz-muted);font-size:11px}
.feedback-item p{margin:0;font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word}
.feedback-reply{margin-top:6px!important;padding-top:6px;border-top:1px dashed var(--hz-line-strong);color:var(--hz-primary)}
.sidebar-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:24;backdrop-filter:blur(2px)}
@media(max-width:650px){
  .workspace.nav-expanded .sidebar-backdrop{display:block}
  .workspace.admin-mode{grid-template-columns:minmax(0,1fr)}.admin-mode main{padding:12px}
  .workspace.nav-expanded .sidebar{position:fixed;left:0;top:0;width:236px;z-index:30;box-shadow:8px 0 30px #26364e20;padding:14px 12px}
  .workspace.nav-expanded .nav-item>span:not(.icon-tile),.workspace.nav-expanded .collapse span,.workspace.nav-expanded .tools span{display:inline}
  .workspace.nav-expanded .subnav{display:block}
}
</style>
