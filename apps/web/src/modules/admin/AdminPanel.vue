<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Lock, Refresh, Tickets, User, Coin, Monitor, CopyDocument, UserFilled, Download, Cpu, Connection, Bell, ChatDotRound } from '@element-plus/icons-vue';

const session = ref(null), loading = ref(false), error = ref(''), notice = ref(''), tab = ref('overview');
// 模板里没有渲染 notice，统一用顶部消息条提示；弹出后清空，保证连续相同提示也能再次触发。
watch(notice, value => { if (value) { ElMessage.success(value); notice.value = ''; } });
const setupChecked = ref(false), setupRequired = ref(false);
const loginForm = ref({ username: '', password: '' });
const bootstrapForm = ref({ username: '', password: '' });
const overview = ref({ totals: {}, cards: {}, points: {}, generatedAt: 0 }), tenants = ref([]), cards = ref([]), cardBatches = ref([]), redemptionFailures = ref([]), ledger = ref([]), auditRows = ref([]), admins = ref([]);
const form = ref({ kind: 'formal', amount: 1, quantity: 1, expiresDays: 0, note: '' }), issued = ref([]);
const cardFilters = ref({ kind: '', status: '', batchId: '', issuer: '', range: null });
const auditFilters = ref({ actor: '', range: null }), ledgerFilters = ref({ owner: '', range: null });
const auditActors = ref([]);
// 日期选择器返回当天 00:00 的毫秒时间戳；结束日要延伸到当天 23:59:59.999。
function applyRange(params, range) { if (Array.isArray(range) && range.length === 2) { params.set('from', String(Number(range[0]))); params.set('to', String(Number(range[1]) + 86399999)); } }
const queryString = params => params.toString() ? `?${params}` : '';
function cardQuery() {
  const params = new URLSearchParams(), value = cardFilters.value;
  if (value.kind) params.set('kind', value.kind);
  if (value.status) params.set('status', value.status);
  if (value.batchId) params.set('batchId', value.batchId);
  if (value.issuer) params.set('issuer', value.issuer);
  applyRange(params, value.range);
  return queryString(params);
}
function auditQuery() { const params = new URLSearchParams(); if (auditFilters.value.actor) params.set('actor', auditFilters.value.actor); applyRange(params, auditFilters.value.range); return queryString(params); }
function ledgerQuery() { const params = new URLSearchParams(); if (ledgerFilters.value.owner) params.set('owner', ledgerFilters.value.owner); applyRange(params, ledgerFilters.value.range); return queryString(params); }
const adjustment = ref({ open: false, tenant: null, kind: 'formal', delta: 1, reason: '' });
const revocation = ref({ open: false, card: null, reason: '' });
const tenantState = ref({ open: false, tenant: null });
const tenantEditor = ref({ open: false, name: '', password: '' });
const tenantRoleEditor = ref({ open: false, tenant: null, role: 'normal' });
const tenantPassword = ref({ open: false, tenant: null, password: '' });
const adminEditor = ref({ open: false, mode: 'create', id: '', username: '', password: '', role: 'operator', disabled: false });
const aiProvider = ref({ provider: 'openai', model: '', enabled: false, configured: false, apiKey: '', clearKey: false, scopeMode: 'standard', refusalText: '', defaultRefusalText: '', scopeRules: { standard: '', strict: '' }, defaultScopeRules: { standard: '', strict: '' }, updatedAt: 0 });
const aiTest = ref({ loading: false, result: null });
const announcements = ref([]), feedbackRows = ref([]);
const announceForm = ref({ title: '', body: '' });
const replyEditor = ref({ open: false, row: null, reply: '' });
const feedbackStatusText = value => value === 'closed' ? '已处理' : '待处理';
const ruleEditors = [
  { key: 'standard', title: '标准', placeholder: '{拒答话术}', hint: '拼接在租户提示词和知识库之后，作为系统规则发给模型。必须包含 {拒答话术}，发送时会替换为上面设置的拒答话术。' },
  { key: 'strict', title: '严格', placeholder: '{商家业务资料}', hint: '先用它让模型只回答“是/否”判断是否属于业务范围；回答“否”直接发拒答话术。{商家业务资料} 不是漏写，它是占位符：发送时系统会自动替换成该租户填写的提示词和知识库，所以这里只需保留这一行（必须包含）。' }
];
const isDefaultRule = key => aiProvider.value.scopeRules[key].trim() === aiProvider.value.defaultScopeRules[key].trim();
function resetRule(key) { aiProvider.value.scopeRules[key] = aiProvider.value.defaultScopeRules[key]; }
const scopeOptions = [
  { value: 'standard', title: '标准（推荐）', desc: '在提示词中加入范围规则，AI 只回答与租户业务相关的问题，无关问题礼貌拒答。无额外延迟。' },
  { value: 'strict', title: '严格', desc: '每条回复前先用一次轻量调用判定问题是否相关，无关则直接发送拒答话术。约增加 1–3 秒延迟。' },
  { value: 'off', title: '关闭', desc: '不做范围限制，完全按租户自己的提示词回复。' }
];
const roleText = value => ({ superadmin: '超级管理员', operator: '运营管理员', auditor: '审计员' }[value] || value);
const tenantRoleText = value => ({ admin: '超管', vip: '满级', normal: '普通' }[value] || value);
const statusText = value => ({ available: '未兑换', redeemed: '已兑换', expired: '已过期', revoked: '已作废' }[value] || value);
const actionText = value => ({ 'admin.bootstrap': '初始化管理员', 'admin.create': '新增管理员', 'admin.update': '更新管理员', 'point-card.issue': '签发卡密', 'point-card.revoke': '作废卡密', 'points.adjust': '调整积分', 'tenant.create': '新增租户', 'tenant.disable': '停用租户', 'tenant.enable': '恢复租户', 'tenant.update_role': '修改租户身份','announcement.publish': '发布公告', 'announcement.delete': '撤回公告', 'feedback.update': '处理反馈', 'ai-provider.update': '更新AI模型', 'ai-provider.test': '测试AI连通', 'tenant.password_reset': '重置租户密码', 'payment-product.create': '新增支付商品', 'payment-product.update': '更新支付商品', 'node.multi_ip': '节点多IP告警' }[value] || value);
const time = value => value ? new Date(value).toLocaleString() : '永不过期';
const auditDetail = row => row.action === 'points.adjust' ? `${row.detail.kind === 'formal' ? '正式' : '测试'}积分 ${row.detail.delta > 0 ? '+' : ''}${row.detail.delta}，余额 ${row.detail.balance}，${row.detail.reason}` : row.action === 'point-card.issue' ? `${row.detail.kind === 'formal' ? '正式' : '测试'}积分，${row.detail.quantity} 张，每张 ${row.detail.amount}` : row.detail.reason || row.detail.username || row.detail.name || '-';
const loggedIn = computed(() => Boolean(session.value?.token && session.value.expiresAt > Date.now()));
const canOperate = computed(() => ['superadmin', 'operator'].includes(session.value?.admin?.role));
const canManageAdmins = computed(() => session.value?.admin?.role === 'superadmin');
const navGroups = computed(() => [
  { title: '', items: [{ name: 'overview', label: '总览', icon: Monitor }] },
  { title: '租户与积分', items: [{ name: 'tenants', label: '租户', icon: User }, { name: 'cards', label: '卡密', icon: Tickets }, { name: 'ledger', label: '积分流水', icon: Coin }, { name: 'risk', label: '兑换风控', icon: Lock }] },
  { title: '运营', items: [{ name: 'announcements', label: '通知发布', icon: Bell }, { name: 'feedback', label: '用户反馈', icon: ChatDotRound, badge: feedbackRows.value.filter(item => item.status === 'open').length }] },
  { title: '系统', items: [{ name: 'audit', label: '操作审计', icon: Lock }, ...(canManageAdmins.value ? [{ name: 'admins', label: '管理员账号', icon: UserFilled }, { name: 'ai', label: 'AI模型', icon: Cpu }] : [])] }
]);
const tabTitle = computed(() => navGroups.value.flatMap(group => group.items).find(item => item.name === tab.value)?.label || '');

function saved() { try { return JSON.parse(sessionStorage.getItem('douyinjuhe.admin') || 'null'); } catch { return null; } }
function save(value) { session.value = value; if (value) sessionStorage.setItem('douyinjuhe.admin', JSON.stringify(value)); else sessionStorage.removeItem('douyinjuhe.admin'); }
async function request(path, { method = 'GET', body, anonymous = false } = {}) {
  const headers = { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) };
  if (!anonymous && session.value?.token) headers.Authorization = `Bearer ${session.value.token}`;
  const entryKey = sessionStorage.getItem('douyinjuhe.adminEntry');
  if (entryKey) headers['X-Admin-Entry'] = entryKey;
  let response;
  try { response = await fetch(`/api/v1/admin/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) }); }
  catch (cause) { throw new Error(cause.name === 'TimeoutError' ? '请求超时，请稍后重试。' : '无法连接抖音聚合服务。'); }
  let result = {}; try { result = await response.json(); } catch { /* HTTP status carries the error */ }
  if (!response.ok) throw Object.assign(new Error(result.error || `请求失败（${response.status}）`), { status: response.status });
  return result;
}
async function checkSetup() {
  try { setupRequired.value = (await request('status', { anonymous: true })).setupRequired; }
  catch (cause) { error.value = cause.message; }
  finally { setupChecked.value = true; }
}
async function bootstrap() {
  const value = bootstrapForm.value;
  if (!value.username.trim() || !value.password) { error.value = '请填写管理员用户名和密码。'; return; }
  loading.value = true; error.value = '';
  try {
    save(await request('bootstrap', { method: 'POST', body: value, anonymous: true }));
    bootstrapForm.value = { username: '', password: '' }; setupRequired.value = false;
    await loadAll(); notice.value = '超级管理员账号已创建。';
  } catch (cause) { error.value = cause.message; }
  finally { loading.value = false; }
}
async function login() {
  const value = loginForm.value;
  if (!value.username.trim() || !value.password) { error.value = '请输入管理员用户名和密码。'; return; }
  loading.value = true; error.value = '';
  try { save(await request('login', { method: 'POST', body: value, anonymous: true })); loginForm.value.password = ''; await loadAll(); notice.value = '管理员会话已建立。'; }
  catch (cause) { error.value = cause.message; }
  finally { loading.value = false; }
}
async function logout() { try { if (session.value?.token) await request('logout', { method: 'POST', body: {} }); } catch { /* local session still gets cleared */ } save(null); }
async function loadAll() {
  loading.value = true; error.value = '';
  try {
    const requests = [request('overview'), request('tenants'), request(`point-cards${cardQuery()}`), request('point-card-batches'), request('point-redemption-failures'), request(`ledger${ledgerQuery()}`), request(`audit${auditQuery()}`)];
    if (canManageAdmins.value) requests.push(request('users'));
    if (canManageAdmins.value) requests.push(request('ai-provider'));
    const [summary, tenantRows, cardRows, batchRows, failureRows, entries, audits, adminRows = [], aiSettings] = await Promise.all(requests);
    auditActors.value = [...new Set([...auditActors.value, ...audits.map(row => row.actor_name).filter(Boolean)])];
    overview.value = summary; tenants.value = tenantRows; cards.value = cardRows; cardBatches.value = batchRows; redemptionFailures.value = failureRows; ledger.value = entries; auditRows.value = audits; admins.value = adminRows;
    if (aiSettings) aiProvider.value = { ...aiProvider.value, ...aiSettings, apiKey: '', clearKey: false };
    [announcements.value, feedbackRows.value] = await Promise.all([request('announcements'), request('feedback')]);
  } catch (cause) { if (cause.status === 401) save(null); error.value = cause.message; }
  finally { loading.value = false; }
}
async function issue() { loading.value = true; error.value = ''; issued.value = []; try { const expires = Number(form.value.expiresDays) > 0 ? Date.now() + Number(form.value.expiresDays) * 86400000 : null; const result = await request('point-cards', { method: 'POST', body: { kind: form.value.kind, amount: Number(form.value.amount), quantity: Number(form.value.quantity), expires, note: form.value.note.trim() } }); issued.value = result.cards; form.value.note = ''; await loadAll(); notice.value = `已签发 ${result.cards.length} 张积分卡，批次 ${result.batch.id.slice(0, 8)}。`; tab.value = 'cards'; } catch (cause) { error.value = cause.message; } finally { loading.value = false; } }
async function copyKeys() { await navigator.clipboard?.writeText(issued.value.map(card => card.key).join('\n')); notice.value = '卡密已复制到剪贴板。'; }
async function copyCardKey(key) { try { await navigator.clipboard.writeText(key); notice.value = '卡密已复制到剪贴板。'; } catch { error.value = '复制失败，请手动选中卡密复制。'; } }
function downloadIssuedCsv() {
  if (!issued.value.length) return;
  const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = [['卡密', '类型', '额度', '过期时间', '批次ID'], ...issued.value.map(card => [card.key, card.kind === 'formal' ? '正式' : '测试', card.amount, time(card.expires), card.batchId])];
  const blob = new Blob([`\uFEFF${lines.map(row => row.map(escape).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = `douyinjuhe-point-cards-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
}
function resetCardFilters() { cardFilters.value = { kind: '', status: '', batchId: '', issuer: '', range: null }; loadAll(); }
function resetAuditFilters() { auditFilters.value = { actor: '', range: null }; loadAll(); }
function resetLedgerFilters() { ledgerFilters.value = { owner: '', range: null }; loadAll(); }
// 超管租户固定排在租户列表最前面，其余保持服务端顺序。
const sortedTenants = computed(() => [...tenants.value].sort((a, b) => (b.role === 'admin') - (a.role === 'admin')));
const issuerOptions = computed(() => [...new Set([...cardBatches.value.map(batch => batch.issued_by_name), ...auditActors.value].filter(Boolean))]);
const targetText = value => ({ tenant: '租户', 'point-card': '积分卡', 'point-card-batch': '积分卡批次', admin: '管理员账号', announcement: '通知公告', feedback: '用户反馈', 'ai-provider': 'AI模型', 'payment-product': '支付商品', node: '登录器节点' }[value] || value);
function openTenantState(row) { tenantState.value = { open: true, tenant: row }; }
function openTenantEditor() { tenantEditor.value = { open: true, name: '', password: '' }; }
async function submitTenant() {
  const value = tenantEditor.value;
  if (!/^[\p{L}\p{N}_-]{3,32}$/u.test(value.name.trim())) { error.value = '租户用户名需3–32位，只能包含中文、字母、数字、下划线或短横线。'; return; }
  if (value.password.length < 1 || value.password.length > 128) { error.value = '租户密码需1–128位。'; return; }
  loading.value = true; error.value = '';
  try { await request('tenants', { method: 'POST', body: { name: value.name.trim(), password: value.password } }); value.open = false; await loadAll(); notice.value = `租户“${value.name.trim()}”已创建。`; } catch (cause) { error.value = cause.message; }
  finally { loading.value = false; }
}
async function toggleTenant() { const row = tenantState.value.tenant; loading.value = true; error.value = ''; try { await request(`tenants/${row.id}`, { method: 'PATCH', body: { disabled: !row.disabled } }); tenantState.value.open = false; await loadAll(); notice.value = row.disabled ? `已恢复租户”${row.name}”。` : `已停用租户”${row.name}”。`; } catch (cause) { error.value = cause.message; } finally { loading.value = false; } }
function openTenantPassword(row) { tenantPassword.value = { open: true, tenant: row, password: '' }; }
async function submitTenantPassword() {
  const value = tenantPassword.value;
  if (value.password.length < 6 || value.password.length > 128) { error.value = '新密码需6–128位。'; return; }
  loading.value = true; error.value = '';
  try { await request(`tenants/${value.tenant.id}/password`, { method: 'POST', body: { password: value.password } }); value.open = false; notice.value = `租户“${value.tenant.name}”密码已重置，该租户需要重新登录。`; value.password = ''; } catch (cause) { error.value = cause.message; }
  finally { loading.value = false; }
}
function openTenantRoleEditor(row) { tenantRoleEditor.value = { open: true, tenant: row, role: row.role || 'normal' }; }
async function submitTenantRole() { const value = tenantRoleEditor.value; loading.value = true; error.value = ''; try { await request(`tenants/${value.tenant.id}`, { method: 'PATCH', body: { role: value.role } }); tenantRoleEditor.value.open = false; await loadAll(); notice.value = `已更新租户”${value.tenant.name}”的角色。`; } catch (cause) { error.value = cause.message; } finally { loading.value = false; } }
function openAdjustment(row) { adjustment.value = { open: true, tenant: row, kind: 'formal', delta: 1, reason: '' }; }
async function submitAdjustment() { const value = adjustment.value; loading.value = true; error.value = ''; try { await request(`tenants/${value.tenant.id}/points`, { method: 'POST', body: { kind: value.kind, delta: Number(value.delta), reason: value.reason } }); value.open = false; await loadAll(); notice.value = `已调整租户“${value.tenant.name}”的积分。`; } catch (cause) { error.value = cause.message; } finally { loading.value = false; } }
function openRevocation(row) { revocation.value = { open: true, card: row, reason: '' }; }
async function submitRevocation() { const value = revocation.value; loading.value = true; error.value = ''; try { await request(`point-cards/${value.card.id}/revoke`, { method: 'POST', body: { reason: value.reason } }); value.open = false; await loadAll(); notice.value = '积分卡已作废。'; } catch (cause) { error.value = cause.message; } finally { loading.value = false; } }
function createAdmin() { adminEditor.value = { open: true, mode: 'create', id: '', username: '', password: '', role: 'operator', disabled: false }; }
function editAdmin(row) { adminEditor.value = { open: true, mode: 'edit', id: row.id, username: row.username, password: '', role: row.role, disabled: row.disabled }; }
async function submitAdmin() {
  const value = adminEditor.value, creating = value.mode === 'create';
  const body = creating ? { username: value.username, password: value.password, role: value.role } : { disabled: value.disabled };
  loading.value = true; error.value = '';
  try {
    await request(creating ? 'users' : `users/${value.id}`, { method: creating ? 'POST' : 'PATCH', body });
    adminEditor.value.open = false;
    if (!creating && value.id === session.value.admin.id && value.disabled) { save(null); notice.value = '当前管理员凭据已更新，请重新登录。'; return; }
    await loadAll(); notice.value = creating ? '管理员账号已创建。' : '管理员账号已更新。';
  } catch (cause) { error.value = cause.message; }
  finally { loading.value = false; }
}
async function publishAnnouncement() {
  const value = announceForm.value;
  if (!value.title.trim() || !value.body.trim()) { error.value = '请填写公告标题和内容。'; return; }
  loading.value = true; error.value = '';
  try { await request('announcements', { method: 'POST', body: { title: value.title.trim(), body: value.body.trim() } }); announceForm.value = { title: '', body: '' }; await loadAll(); notice.value = '公告已发布，租户点开“通知”即可看到。'; }
  catch (cause) { error.value = cause.message; }
  finally { loading.value = false; }
}
async function removeAnnouncement(row) {
  loading.value = true; error.value = '';
  try { await request(`announcements/${row.id}`, { method: 'DELETE' }); await loadAll(); notice.value = '公告已撤回。'; }
  catch (cause) { error.value = cause.message; }
  finally { loading.value = false; }
}
function openReply(row) { replyEditor.value = { open: true, row, reply: row.reply || '' }; }
async function submitReply() {
  const value = replyEditor.value;
  if (!value.reply.trim()) { error.value = '请填写回复内容。'; return; }
  loading.value = true; error.value = '';
  try { await request(`feedback/${value.row.id}`, { method: 'PATCH', body: { reply: value.reply.trim() } }); value.open = false; await loadAll(); notice.value = '回复已发送，反馈标记为已处理。'; }
  catch (cause) { error.value = cause.message; }
  finally { loading.value = false; }
}
async function closeFeedback(row) {
  loading.value = true; error.value = '';
  try { await request(`feedback/${row.id}`, { method: 'PATCH', body: { status: 'closed' } }); await loadAll(); notice.value = '反馈已标记为已处理。'; }
  catch (cause) { error.value = cause.message; }
  finally { loading.value = false; }
}
async function testAIProvider() {
  const value = aiProvider.value;
  if (!value.model.trim()) { error.value = '请填写模型名称。'; return; }
  if (!value.apiKey && !value.configured) { error.value = '请先填写 API Key。'; return; }
  aiTest.value = { loading: true, result: null }; error.value = '';
  try {
    const result = await request('ai-provider/test', { method: 'POST', body: { provider: value.provider, model: value.model.trim(), ...(value.apiKey ? { apiKey: value.apiKey } : {}) } });
    aiTest.value = { loading: false, result };
  } catch (cause) { aiTest.value = { loading: false, result: null }; error.value = cause.message; }
}
async function saveAIProvider() {
  const value = aiProvider.value;
  if (!value.model.trim()) { error.value = '请填写模型名称。'; return; }
  loading.value = true; error.value = '';
  try {
    const saved = await request('ai-provider', { method: 'PUT', body: { provider: value.provider, model: value.model.trim(), enabled: value.enabled, scopeMode: value.scopeMode, refusalText: value.refusalText.trim(), scopeRuleStandard: value.scopeRules.standard, scopeRuleStrict: value.scopeRules.strict, ...(value.apiKey ? { apiKey: value.apiKey } : {}), ...(value.clearKey ? { clearKey: true } : {}) } });
    aiProvider.value = { ...aiProvider.value, ...saved, apiKey: '', clearKey: false };
    notice.value = 'AI 模型配置已保存；密钥不会再次显示。';
  } catch (cause) { error.value = cause.message; }
  finally { loading.value = false; }
}
onMounted(async () => { session.value = saved(); await checkSetup(); if (loggedIn.value) await loadAll(); else if (session.value) save(null); });
</script>

<template>
  <section class="admin-page" aria-label="管理员后台">
    <div v-if="!setupChecked" class="admin-login" v-loading="true" aria-label="正在读取管理员状态"></div>
    <div v-else-if="!loggedIn" class="admin-login">
      <div class="admin-login-icon"><el-icon><Lock/></el-icon></div>
      <h2>{{ setupRequired ? '初始化管理员' : '管理员后台' }}</h2>
      <template v-if="setupRequired">
        <el-input v-model="bootstrapForm.username" maxlength="32" placeholder="管理员用户名" autocomplete="username"/>
        <el-input v-model="bootstrapForm.password" type="password" show-password placeholder="管理员密码" autocomplete="new-password" @keyup.enter="bootstrap"/>
        <el-button type="primary" :loading="loading" @click="bootstrap">创建超级管理员</el-button>
      </template>
      <template v-else>
        <el-input v-model="loginForm.username" maxlength="32" placeholder="管理员用户名" autocomplete="username"/>
        <el-input v-model="loginForm.password" type="password" show-password placeholder="管理员密码" autocomplete="current-password" @keyup.enter="login"/>
        <el-button type="primary" :loading="loading" @click="login">登录后台</el-button>
      </template>
      <el-alert v-if="error" :title="error" type="error" :closable="false"/>
    </div>
    <div v-else class="admin-shell">
      <aside class="admin-side" aria-label="后台导航">
        <div class="admin-brand"><img src="/logo.svg" alt="" width="28" height="28"><strong>抖音聚合管理后台</strong></div>
        <nav class="admin-nav">
          <template v-for="group in navGroups" :key="group.title || 'root'">
            <div v-if="group.title" class="admin-nav-title">{{ group.title }}</div>
            <button v-for="item in group.items" :key="item.name" type="button" :class="['admin-nav-item', { active: tab === item.name }]" :aria-current="tab === item.name ? 'page' : undefined" @click="tab = item.name">
              <el-icon><component :is="item.icon"/></el-icon><span>{{ item.label }}</span><el-badge v-if="item.badge" :value="item.badge" class="admin-nav-badge"/>
            </button>
          </template>
        </nav>
        <div class="admin-side-foot"><div class="admin-user"><b>{{ session.admin.username }}</b><small>{{ roleText(session.admin.role) }}</small></div><el-button size="small" @click="logout">退出后台</el-button></div>
      </aside>
      <div class="admin-main">
      <div class="admin-heading">
        <h2>{{ tabTitle }}</h2>
        <div><el-button :icon="Refresh" :loading="loading" @click="loadAll">刷新</el-button></div>
      </div>
      <el-alert v-if="error" :title="error" type="error" show-icon @close="error=''"/>
      <el-tabs v-model="tab" class="admin-tabs">
        <el-tab-pane name="overview"><template #label><el-icon><Monitor/></el-icon> 总览</template>
          <div class="stat-grid"><article><el-icon><User/></el-icon><small>租户</small><b>{{overview.totals.tenants || 0}}</b></article><article><el-icon><Tickets/></el-icon><small>业务账号</small><b>{{overview.totals.accounts || 0}}</b></article><article><el-icon><Monitor/></el-icon><small>在线账号</small><b>{{overview.totals.onlineAccounts || 0}}</b></article><article><el-icon><Coin/></el-icon><small>正式积分</small><b>{{overview.points.formal || 0}}</b></article></div>
          <div class="summary-row"><div><span>登录器节点</span><strong>{{overview.totals.nodes || 0}}</strong></div><div><span>已兑换卡</span><strong>{{overview.cards.redeemed || 0}}</strong></div><div><span>测试积分</span><strong>{{overview.points.test || 0}}</strong></div></div>
        </el-tab-pane>
        <el-tab-pane name="tenants"><template #label><el-icon><User/></el-icon> 租户</template>
          <div v-if="canOperate" class="table-toolbar"><el-button type="primary" @click="openTenantEditor">新增租户</el-button></div>
          <el-table :data="sortedTenants" v-loading="loading" empty-text="暂无租户"><el-table-column prop="name" label="租户" min-width="150"/><el-table-column label="租户ID" width="110"><template #default="{row}"><span :title="row.id">{{row.id.slice(0, 8)}}</span></template></el-table-column><el-table-column label="创建时间" width="170"><template #default="{row}">{{row.created ? time(row.created) : '-'}}</template></el-table-column><el-table-column label="身份" width="90"><template #default="{row}"><el-tag :type="row.role==='admin'?'danger':row.role==='vip'?'warning':'info'">{{tenantRoleText(row.role||'normal')}}</el-tag></template></el-table-column><el-table-column prop="accounts" label="账号" width="80"/><el-table-column prop="nodes" label="节点" width="80"/><el-table-column prop="formal" label="正式积分" width="100"/><el-table-column prop="test" label="测试积分" width="100"/><el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="row.disabled?'danger':'success'">{{row.disabled?'已停用':'正常'}}</el-tag></template></el-table-column><el-table-column v-if="canOperate" label="操作" width="280" fixed="right"><template #default="{row}"><template v-if="row.role!=='admin'"><el-button link type="primary" @click="openTenantRoleEditor(row)">编辑身份</el-button><el-button link type="primary" @click="openAdjustment(row)">调积分</el-button><el-button link type="warning" @click="openTenantPassword(row)">重置密码</el-button><el-button link :type="row.disabled?'success':'danger'" @click="openTenantState(row)">{{row.disabled?'恢复':'停用'}}</el-button></template></template></el-table-column></el-table>
        </el-tab-pane>
        <el-tab-pane name="cards"><template #label><el-icon><Tickets/></el-icon> 卡密</template>
          <div v-if="canOperate" class="issue-panel"><el-radio-group v-model="form.kind"><el-radio-button value="formal">正式积分</el-radio-button><el-radio-button value="test">测试积分</el-radio-button></el-radio-group><label class="issue-field"><span>单张额度</span><el-input-number v-model="form.amount" :min="1" :max="100000" aria-label="单张额度"/></label><label class="issue-field"><span>签发数量</span><el-input-number v-model="form.quantity" :min="1" :max="100" aria-label="签发数量"/></label><label class="issue-field"><span>有效天数（0=永不过期）</span><el-input-number v-model="form.expiresDays" :min="0" :max="3650" aria-label="有效天数"/></label><el-input v-model="form.note" maxlength="255" placeholder="批次备注（可选）" class="batch-note"/><el-button type="primary" :loading="loading" @click="issue">签发卡密</el-button></div>
          <div v-if="issued.length" class="issued"><div class="issued-heading"><strong>本次签发结果（明文仅在这里显示）</strong><span><el-button :icon="CopyDocument" @click="copyKeys">复制卡密</el-button><el-button :icon="Download" type="primary" plain @click="downloadIssuedCsv">下载 CSV</el-button></span></div><pre>{{issued.map(card => `${card.key}\t${card.kind}\t${card.amount}\t${time(card.expires)}`).join('\n')}}</pre></div>
          <div class="card-filter"><el-select v-model="cardFilters.kind" clearable placeholder="全部类型" @change="loadAll"><el-option label="正式积分" value="formal"/><el-option label="测试积分" value="test"/></el-select><el-select v-model="cardFilters.status" clearable placeholder="全部状态" @change="loadAll"><el-option label="未兑换" value="available"/><el-option label="已兑换" value="redeemed"/><el-option label="已过期" value="expired"/><el-option label="已作废" value="revoked"/></el-select><el-select v-model="cardFilters.batchId" clearable filterable placeholder="全部批次" @change="loadAll"><el-option v-for="batch in cardBatches" :key="batch.id" :value="batch.id" :label="`${batch.id.slice(0, 8)} · ${batch.note || '无备注'} · ${batch.card_count}张`"/></el-select><el-select v-model="cardFilters.issuer" clearable filterable placeholder="全部签发账号" @change="loadAll"><el-option v-for="name in issuerOptions" :key="name" :value="name" :label="name"/></el-select><el-date-picker v-model="cardFilters.range" type="daterange" range-separator="至" start-placeholder="签发开始日期" end-placeholder="签发结束日期" @change="loadAll"/><el-button @click="resetCardFilters">重置筛选</el-button></div>
          <el-table :data="cards" v-loading="loading" empty-text="暂无卡密"><el-table-column prop="kind" label="类型" width="90"><template #default="{row}">{{row.kind==='formal'?'正式':'测试'}}</template></el-table-column><el-table-column prop="amount" label="额度" width="80"/><el-table-column label="卡密" min-width="300"><template #default="{row}"><template v-if="row.key"><code class="card-key">{{row.key}}</code><el-button link type="primary" :icon="CopyDocument" @click="copyCardKey(row.key)">复制</el-button></template><span v-else class="card-key-missing" :title="canOperate?'该卡密签发时未保存密文，无法恢复':'审计员不可查看卡密'">-</span></template></el-table-column><el-table-column prop="batch_id" label="批次" width="105"><template #default="{row}">{{row.batch_id?row.batch_id.slice(0, 8):'-'}}</template></el-table-column><el-table-column prop="status" label="状态" width="90"><template #default="{row}">{{statusText(row.status)}}</template></el-table-column><el-table-column prop="created" label="签发时间" width="180"><template #default="{row}">{{time(row.created)}}</template></el-table-column><el-table-column prop="expires" label="过期时间" width="180"><template #default="{row}">{{time(row.expires)}}</template></el-table-column><el-table-column prop="batch_note" label="批次备注" min-width="140"/><el-table-column label="签发账号" min-width="120"><template #default="{row}">{{row.issued_by_name||'-'}}</template></el-table-column><el-table-column prop="redeemed_name" label="兑换租户" min-width="130"/><el-table-column v-if="canOperate" label="操作" width="90" fixed="right"><template #default="{row}"><el-button v-if="row.status==='available'" link type="danger" @click="openRevocation(row)">作废</el-button><span v-else>-</span></template></el-table-column></el-table>
        </el-tab-pane>
        <el-tab-pane name="announcements"><template #label><el-icon><Bell/></el-icon> 通知发布</template>
          <div v-if="canOperate" class="announce-form"><el-input v-model="announceForm.title" maxlength="80" show-word-limit placeholder="公告标题"/><el-input v-model="announceForm.body" type="textarea" :rows="4" maxlength="2000" show-word-limit placeholder="公告内容，租户点开左下角“通知”可见"/><div><el-button type="primary" :loading="loading" :disabled="!announceForm.title.trim()||!announceForm.body.trim()" @click="publishAnnouncement">发布通知</el-button></div></div>
          <el-table :data="announcements" v-loading="loading" empty-text="暂无已发布的通知"><el-table-column prop="title" label="标题" min-width="180"/><el-table-column prop="body" label="内容" min-width="320" show-overflow-tooltip/><el-table-column prop="createdBy" label="发布人" width="120"/><el-table-column label="发布时间" width="180"><template #default="{row}">{{time(row.created)}}</template></el-table-column><el-table-column v-if="canOperate" label="操作" width="90" fixed="right"><template #default="{row}"><el-popconfirm title="撤回后租户将不再看到这条通知，确定？" @confirm="removeAnnouncement(row)"><template #reference><el-button link type="danger">撤回</el-button></template></el-popconfirm></template></el-table-column></el-table>
        </el-tab-pane>
        <el-tab-pane name="feedback"><template #label><el-icon><ChatDotRound/></el-icon> 用户反馈<el-badge v-if="feedbackRows.filter(item => item.status === 'open').length" :value="feedbackRows.filter(item => item.status === 'open').length" class="feedback-badge"/></template>
          <el-table :data="feedbackRows" v-loading="loading" empty-text="暂无用户反馈"><el-table-column prop="tenant" label="租户" width="130"/><el-table-column prop="content" label="反馈内容" min-width="280" show-overflow-tooltip/><el-table-column prop="contact" label="联系方式" width="140"><template #default="{row}">{{row.contact || '-'}}</template></el-table-column><el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="row.status==='closed'?'success':'warning'">{{feedbackStatusText(row.status)}}</el-tag></template></el-table-column><el-table-column prop="reply" label="已回复内容" min-width="200" show-overflow-tooltip><template #default="{row}">{{row.reply || '-'}}</template></el-table-column><el-table-column label="提交时间" width="180"><template #default="{row}">{{time(row.created)}}</template></el-table-column><el-table-column v-if="canOperate" label="操作" width="150" fixed="right"><template #default="{row}"><el-button link type="primary" @click="openReply(row)">回复</el-button><el-button v-if="row.status==='open'" link type="success" @click="closeFeedback(row)">标记已处理</el-button></template></el-table-column></el-table>
        </el-tab-pane>
        <el-tab-pane name="ledger"><template #label><el-icon><Coin/></el-icon> 积分流水</template><div class="card-filter"><el-select v-model="ledgerFilters.owner" clearable filterable placeholder="全部租户" @change="loadAll"><el-option v-for="item in tenants" :key="item.id" :value="item.id" :label="item.name"/></el-select><el-date-picker v-model="ledgerFilters.range" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" @change="loadAll"/><el-button @click="resetLedgerFilters">重置筛选</el-button></div><el-table :data="ledger" v-loading="loading" empty-text="暂无流水"><el-table-column prop="tenant" label="租户" min-width="150"/><el-table-column prop="kind" label="类型" width="100"><template #default="{row}">{{row.kind==='formal'?'正式':'测试'}}</template></el-table-column><el-table-column prop="delta" label="变动" width="90"/><el-table-column prop="balance" label="余额" width="90"/><el-table-column prop="reason" label="说明" min-width="180"/><el-table-column prop="created" label="时间" width="180"><template #default="{row}">{{time(row.created)}}</template></el-table-column></el-table></el-tab-pane>
        <el-tab-pane name="audit"><template #label><el-icon><Lock/></el-icon> 操作审计</template><div class="card-filter"><el-select v-model="auditFilters.actor" clearable filterable placeholder="全部操作人" @change="loadAll"><el-option v-for="name in auditActors" :key="name" :value="name" :label="name"/></el-select><el-date-picker v-model="auditFilters.range" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" @change="loadAll"/><el-button @click="resetAuditFilters">重置筛选</el-button></div><el-table :data="auditRows" v-loading="loading" empty-text="暂无管理操作"><el-table-column prop="actor_name" label="操作人" width="130"/><el-table-column label="操作" width="130"><template #default="{row}">{{actionText(row.action)}}</template></el-table-column><el-table-column label="对象" width="120"><template #default="{row}">{{targetText(row.target_type)}}</template></el-table-column><el-table-column label="详情" min-width="260"><template #default="{row}">{{auditDetail(row)}}</template></el-table-column><el-table-column label="时间" width="180"><template #default="{row}">{{time(row.created)}}</template></el-table-column></el-table></el-tab-pane>
        <el-tab-pane name="risk"><template #label><el-icon><Lock/></el-icon> 兑换风控</template><el-table :data="redemptionFailures" v-loading="loading" empty-text="暂无兑换失败记录"><el-table-column prop="tenant" label="租户" min-width="140"/><el-table-column prop="reason" label="失败原因" min-width="260"/><el-table-column prop="source" label="来源" min-width="130"/><el-table-column label="时间" width="180"><template #default="{row}">{{time(row.created)}}</template></el-table-column></el-table></el-tab-pane>
        <el-tab-pane v-if="canManageAdmins" name="admins"><template #label><el-icon><UserFilled/></el-icon> 管理员账号</template>
          <div class="table-toolbar"><el-button type="primary" @click="createAdmin">新增管理员</el-button></div>
          <el-table :data="admins" v-loading="loading" empty-text="暂无管理员"><el-table-column prop="username" label="用户名" min-width="150"/><el-table-column label="角色" width="130"><template #default="{row}">{{roleText(row.role)}}</template></el-table-column><el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="row.disabled?'danger':'success'">{{row.disabled?'已停用':'正常'}}</el-tag></template></el-table-column><el-table-column label="最近登录" min-width="180"><template #default="{row}">{{row.lastLogin?time(row.lastLogin):'从未登录'}}</template></el-table-column><el-table-column label="操作" width="90" fixed="right"><template #default="{row}"><el-button link type="primary" @click="editAdmin(row)">编辑</el-button></template></el-table-column></el-table>
        </el-tab-pane>
        <el-tab-pane v-if="canManageAdmins" name="ai"><template #label><el-icon><Cpu/></el-icon> AI模型</template>
          <div class="ai-layout">
          <div class="ai-provider-form">
            <el-alert title="模型服务和 API Key 由超级管理员统一配置；租户只能设置自己的提示词、知识库和消息记忆。密钥加密存储，读取时不返回明文。" type="info" :closable="false" show-icon/>
            <el-form label-position="top" class="ai-form">
              <section class="ai-card">
                <header><div><h3>模型连接</h3><p>全部租户共用同一个模型服务</p></div><el-switch v-model="aiProvider.enabled" active-text="已启用" inactive-text="已停用"/></header>
                <div class="ai-grid">
                  <el-form-item label="模型服务商"><el-select v-model="aiProvider.provider"><el-option label="OpenAI" value="openai"/><el-option label="DeepSeek" value="deepseek"/><el-option label="通义千问" value="qwen"/><el-option label="豆包" value="doubao"/></el-select></el-form-item>
                  <el-form-item label="模型名称"><el-input v-model="aiProvider.model" maxlength="160" placeholder="填写服务商提供的模型 ID"/></el-form-item>
                </div>
                <el-form-item label="API Key"><el-input v-model="aiProvider.apiKey" type="password" show-password autocomplete="new-password" placeholder="留空保留已保存的密钥"/></el-form-item>
                <div class="ai-provider-status"><el-tag :type="aiProvider.configured ? 'success' : 'info'">{{ aiProvider.configured ? '密钥已配置' : '尚未配置密钥' }}</el-tag><el-checkbox v-model="aiProvider.clearKey">清除已保存密钥</el-checkbox><el-button :icon="Connection" :loading="aiTest.loading" @click="testAIProvider">测试连通</el-button></div>
                <el-alert v-if="aiTest.result" class="ai-test-result" :type="aiTest.result.ok ? 'success' : 'error'" :closable="false" show-icon :title="aiTest.result.ok ? `连接正常，耗时 ${aiTest.result.latencyMs} ms` : aiTest.result.message" :description="aiTest.result.ok ? `模型回复：${aiTest.result.reply || '（空）'}` : `耗时 ${aiTest.result.latencyMs} ms`"/>
              </section>
              <section class="ai-card">
                <header><div><h3>回答范围限制</h3><p>仅管理员可设置，租户不可见也无法修改</p></div></header>
                <div class="scope-options" role="radiogroup" aria-label="回答范围限制">
                  <button v-for="item in scopeOptions" :key="item.value" type="button" role="radio" :aria-checked="aiProvider.scopeMode === item.value" :class="['scope-option', { active: aiProvider.scopeMode === item.value }]" @click="aiProvider.scopeMode = item.value"><strong>{{ item.title }}</strong><span>{{ item.desc }}</span></button>
                </div>
                <el-form-item v-if="aiProvider.scopeMode !== 'off'" label="拒答话术" class="refusal-field"><el-input v-model="aiProvider.refusalText" maxlength="200" show-word-limit :placeholder="aiProvider.defaultRefusalText || '留空使用默认话术'"/></el-form-item>
                <small class="scope-hint">基于提示词的限制无法保证 100% 拦截；对拦截要求高时选择“严格”。</small>
              </section>
              <div class="ai-actions"><el-button type="primary" :loading="loading" @click="saveAIProvider">保存模型配置</el-button></div>
            </el-form>
          </div>
          <aside class="ai-rules-panel" aria-label="回答范围限制规则">
            <header><h3>范围限制规则</h3><p>各档位实际发送给模型的系统规则，可编辑；修改后点左下角“保存模型配置”生效</p></header>
            <section v-for="item in ruleEditors" :key="item.key" :class="['rule-box', { active: aiProvider.scopeMode === item.key }]">
              <div class="rule-title" role="radio" tabindex="0" :aria-checked="aiProvider.scopeMode === item.key" :title="`点击切换为“${item.title}”档`" @click="aiProvider.scopeMode = item.key" @keydown.enter.prevent="aiProvider.scopeMode = item.key" @keydown.space.prevent="aiProvider.scopeMode = item.key"><strong>{{ item.title }}</strong><el-tag v-if="aiProvider.scopeMode === item.key" size="small" type="success">当前使用</el-tag><el-tag v-else size="small" type="info">点击切换为此档</el-tag><el-tag v-if="!isDefaultRule(item.key)" size="small" type="warning">已自定义</el-tag><el-button class="rule-reset" link type="primary" :disabled="isDefaultRule(item.key)" @click.stop="resetRule(item.key)">恢复默认</el-button></div>
              <el-input v-model="aiProvider.scopeRules[item.key]" type="textarea" :rows="item.key === 'standard' ? 8 : 9" maxlength="4000" show-word-limit resize="vertical" class="rule-input" :aria-label="`${item.title}档规则`"/>
              <small class="scope-hint">{{ item.hint }}</small>
            </section>
            <small class="scope-hint">“关闭”档不附加任何规则，完全按租户自己的提示词回复。规则只影响新的回复，不影响租户端设置。</small>
          </aside>
          </div>
        </el-tab-pane>
      </el-tabs>
      <el-dialog v-model="adjustment.open" title="调整租户积分" width="min(500px,94vw)"><el-form label-position="top"><el-form-item label="租户"><el-input :model-value="adjustment.tenant?.name" disabled/></el-form-item><el-form-item label="积分类型"><el-radio-group v-model="adjustment.kind"><el-radio-button value="formal">正式积分</el-radio-button><el-radio-button value="test">测试积分</el-radio-button></el-radio-group></el-form-item><el-form-item label="调整数量"><el-input-number v-model="adjustment.delta" :min="-100000" :max="100000" aria-label="调整数量"/></el-form-item><el-form-item label="调整原因"><el-input v-model="adjustment.reason" maxlength="200" show-word-limit/></el-form-item></el-form><template #footer><el-button @click="adjustment.open=false">取消</el-button><el-button type="primary" :loading="loading" :disabled="!adjustment.reason.trim()||adjustment.delta===0" @click="submitAdjustment">确认调整</el-button></template></el-dialog>
      <el-dialog v-model="tenantEditor.open" title="新增租户" width="min(500px,94vw)"><el-form label-position="top"><el-form-item label="租户用户名" required><el-input v-model="tenantEditor.name" maxlength="32" autocomplete="off" placeholder="3–32位中文、字母、数字、下划线或短横线"/></el-form-item><el-form-item label="初始密码" required><el-input v-model="tenantEditor.password" type="password" show-password maxlength="128" autocomplete="new-password" placeholder="1–128位"/></el-form-item></el-form><template #footer><el-button @click="tenantEditor.open=false">取消</el-button><el-button type="primary" :loading="loading" :disabled="!tenantEditor.name.trim()||!tenantEditor.password" @click="submitTenant">创建租户</el-button></template></el-dialog>
      <el-dialog v-model="tenantPassword.open" title="重置租户密码" width="min(500px,94vw)"><p>租户：{{tenantPassword.tenant?.name}}。重置后该租户所有已登录设备会立即失效，需要使用新密码重新登录。</p><el-form label-position="top"><el-form-item label="新密码" required><el-input v-model="tenantPassword.password" type="password" show-password maxlength="128" autocomplete="new-password" placeholder="6–128位"/></el-form-item></el-form><template #footer><el-button @click="tenantPassword.open=false">取消</el-button><el-button type="primary" :loading="loading" :disabled="!tenantPassword.password" @click="submitTenantPassword">确认重置</el-button></template></el-dialog>
      <el-dialog v-model="tenantState.open":title="tenantState.tenant?.disabled?'恢复租户':'停用租户'" width="min(500px,94vw)"><p>{{tenantState.tenant?.disabled?'恢复后租户可以重新登录。':'停用后租户现有会话将立即失效。'}}</p><template #footer><el-button @click="tenantState.open=false">取消</el-button><el-button :type="tenantState.tenant?.disabled?'success':'danger'" :loading="loading" @click="toggleTenant">{{tenantState.tenant?.disabled?'确认恢复':'确认停用'}}</el-button></template></el-dialog>
      <el-dialog v-model="tenantRoleEditor.open" title="编辑租户身份" width="min(500px,94vw)"><el-form label-position="top"><el-form-item label="租户"><el-input :model-value="tenantRoleEditor.tenant?.name" disabled/></el-form-item><el-form-item label="身份"><el-radio-group v-model="tenantRoleEditor.role"><el-radio value="normal">普通</el-radio><el-radio value="vip">满级（免积分）</el-radio></el-radio-group></el-form-item></el-form><template #footer><el-button @click="tenantRoleEditor.open=false">取消</el-button><el-button type="primary" :loading="loading" @click="submitTenantRole">保存</el-button></template></el-dialog>
      <el-dialog v-model="replyEditor.open" title="回复用户反馈" width="min(560px,94vw)"><p class="reply-origin">{{replyEditor.row?.tenant}}：{{replyEditor.row?.content}}</p><el-input v-model="replyEditor.reply" type="textarea" :rows="5" maxlength="2000" show-word-limit placeholder="回复内容，租户在“帮助”里可以看到"/><template #footer><el-button @click="replyEditor.open=false">取消</el-button><el-button type="primary" :loading="loading" :disabled="!replyEditor.reply.trim()" @click="submitReply">发送回复</el-button></template></el-dialog>
      <el-dialog v-model="revocation.open" title="作废积分卡" width="min(500px,94vw)"><el-form label-position="top"><el-form-item label="作废原因"><el-input v-model="revocation.reason" maxlength="200" show-word-limit/></el-form-item></el-form><template #footer><el-button @click="revocation.open=false">取消</el-button><el-button type="danger" :loading="loading" :disabled="!revocation.reason.trim()" @click="submitRevocation">确认作废</el-button></template></el-dialog>
      <el-dialog v-model="adminEditor.open" :title="adminEditor.mode==='create'?'新增管理员':'编辑管理员'" width="min(520px,94vw)"><el-form label-position="top"><el-form-item label="用户名"><el-input v-model="adminEditor.username" maxlength="32" :disabled="adminEditor.mode==='edit'" autocomplete="off"/></el-form-item><el-form-item label="角色"><el-select v-model="adminEditor.role" :disabled="adminEditor.mode==='edit'"><el-option label="超级管理员" value="superadmin"/><el-option label="运营管理员" value="operator"/><el-option label="审计员" value="auditor"/></el-select></el-form-item><el-form-item v-if="adminEditor.mode==='create'" label="密码"><el-input v-model="adminEditor.password" type="password" show-password placeholder="管理员密码" autocomplete="new-password"/></el-form-item><el-form-item v-if="adminEditor.mode==='edit'" label="账号状态"><el-switch v-model="adminEditor.disabled" active-text="停用" inactive-text="启用"/></el-form-item></el-form><template #footer><el-button @click="adminEditor.open=false">取消</el-button><el-button type="primary" :loading="loading" :disabled="adminEditor.mode==='create'&&(!adminEditor.username.trim()||!adminEditor.password)" @click="submitAdmin">保存</el-button></template></el-dialog>
      </div>
    </div>
  </section>
</template>

<style scoped>
.admin-page{display:grid;grid-auto-rows:max-content;align-content:start;min-width:0;width:100%;background:var(--hz-bg);min-height:100vh;padding:0}
.admin-login{width:min(440px,100%);min-height:300px;margin:50px auto;padding:28px;background:var(--hz-surface);border:1px solid var(--hz-line);border-radius:7px;box-shadow:0 1px 2px rgba(36,35,33,.025);display:grid;gap:14px;text-align:center;align-content:center}
.admin-login-icon{margin:0 auto 4px;width:48px;height:48px;border-radius:7px;display:grid;place-items:center;background:var(--hz-primary-soft);color:var(--hz-primary);font-size:22px}
.admin-login h2{margin:0 0 4px;font-size:20px;font-weight:700;color:var(--hz-text)}
.admin-login p{margin:0;color:var(--hz-muted);font-size:13px}
.admin-shell{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100vh;min-width:0}
.admin-side{display:flex;flex-direction:column;background:var(--hz-sidebar);border-right:1px solid var(--hz-line);padding:16px 12px;gap:6px;min-width:0}
.admin-brand{display:flex;align-items:center;gap:9px;padding:4px 8px 14px;color:var(--hz-text)}
.admin-brand strong{font-size:15px;font-weight:700}
.admin-nav{display:flex;flex-direction:column;gap:2px;flex:1;min-height:0;overflow-y:auto}
.admin-nav-title{margin:14px 10px 4px;font-size:11px;font-weight:600;letter-spacing:.3px;color:var(--hz-sidebar-muted)}
.admin-nav-item{display:flex;align-items:center;gap:9px;width:100%;padding:9px 10px;border:0;border-radius:7px;background:transparent;color:var(--hz-sidebar-text);font:inherit;font-size:13px;font-weight:520;text-align:left;cursor:pointer}
.admin-nav-item:hover{background:rgba(0,0,0,.045)}
.admin-nav-item.active{background:var(--hz-primary-soft);color:var(--hz-primary);font-weight:600}
.admin-nav-item:focus-visible{outline:2px solid var(--hz-primary);outline-offset:1px}
.admin-nav-item .el-icon{font-size:16px}
.admin-nav-badge{margin-left:auto}
.admin-side-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 6px 2px;border-top:1px solid var(--hz-line)}
.admin-user{display:grid;min-width:0}.admin-user b{font-size:13px;color:var(--hz-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.admin-user small{color:var(--hz-muted);font-size:11px}
.admin-main{display:grid;grid-auto-rows:max-content;align-content:start;gap:12px;padding:16px 20px;min-width:0}
@media(max-width:820px){.admin-shell{grid-template-columns:1fr}.admin-side{flex-direction:row;flex-wrap:wrap;align-items:center;border-right:0;border-bottom:1px solid var(--hz-line)}.admin-nav{flex-direction:row;flex-wrap:wrap;overflow:visible;flex-basis:100%;order:3}.admin-nav-title{display:none}.admin-nav-item{width:auto}.admin-side-foot{border-top:0;padding:0;margin-left:auto}}
.admin-heading{display:flex;justify-content:space-between;align-items:center;gap:14px;min-width:0;padding:0;margin:0}
.admin-heading h2{margin:0;font-size:18px;font-weight:700;color:var(--hz-text);line-height:1.2}
.admin-heading p{margin:0 0 0 10px;color:var(--hz-muted);font-size:12px;line-height:1.2}
.admin-tabs{background:var(--hz-surface);padding:16px 18px;border:1px solid var(--hz-line);border-radius:7px;box-shadow:0 1px 2px rgba(36,35,33,.025);min-width:0;width:100%;overflow:hidden}
.admin-tabs :deep(.el-tabs__header){display:none}
.admin-tabs :deep(.el-tabs__content),.admin-tabs :deep(.el-tab-pane){min-width:0;max-width:100%}
.admin-tabs :deep(.el-tabs__item){font-weight:520;font-size:13px}
.stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}
.stat-grid article{padding:15px 14px;background:var(--hz-surface);border:1px solid var(--hz-line);border-radius:7px;display:grid;gap:8px;min-width:0;box-shadow:0 1px 2px rgba(36,35,33,.025)}
.stat-grid article .el-icon{font-size:19px;color:var(--hz-primary);background:var(--hz-primary-soft);width:38px;height:38px;border-radius:7px;display:grid;place-items:center}
.stat-grid small{color:var(--hz-muted);font-size:11px;font-weight:520;text-transform:uppercase;letter-spacing:0.2px}
.stat-grid b{font-size:24px;color:var(--hz-text);font-weight:700}
.summary-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.summary-row div{padding:14px;border:1px solid var(--hz-line);border-radius:7px;display:flex;justify-content:space-between;align-items:center;gap:12px;min-width:0;background:var(--hz-surface);box-shadow:0 1px 2px rgba(36,35,33,.025)}
.summary-row span{color:var(--hz-muted);font-size:12px;font-weight:520}
.summary-row strong{color:var(--hz-text);font-size:17px;font-weight:700}
.issue-panel,.table-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.issue-panel{align-items:flex-end}
.issue-panel .el-input-number{width:130px}
.issue-field{display:inline-flex;flex-direction:column;align-items:center;gap:4px;font-size:13px;color:#606266;white-space:nowrap}
.card-key{font:12px/1.5 'SF Mono',Consolas,monospace;color:var(--hz-text);margin-right:6px;user-select:all;word-break:break-all}
.card-key-missing{color:var(--hz-muted)}
.announce-form{display:grid;gap:8px;max-width:640px;margin-bottom:14px}
.feedback-badge{margin-left:4px}
.reply-origin{margin:0 0 12px;padding:10px 12px;background:var(--hz-surface-muted);border-radius:6px;color:var(--hz-muted);font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-all}
.issued{background:var(--hz-surface-muted);border:1px solid var(--hz-line);border-radius:7px;padding:14px;margin-bottom:12px}
.issued-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.issued-heading strong{font-size:13px;color:var(--hz-text);font-weight:600}
.issued pre{white-space:pre-wrap;word-break:break-all;font:12px/1.65 'SF Mono',Consolas,monospace;margin:0;color:var(--hz-text);background:var(--hz-surface);padding:12px;border-radius:6px;border:1px solid var(--hz-line)}
.admin-tabs :deep(.el-tab-pane){padding-top:0}
.admin-tabs :deep(.el-table){border-radius:7px;overflow:hidden}
.admin-tabs .el-select{width:100%}
.card-filter{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:14px 0}
.card-filter .el-select{width:180px}.card-filter .el-date-editor{width:280px}
.batch-table{margin:4px 0 14px}
.issue-panel .batch-note{width:190px}
.ai-layout{display:grid;grid-template-columns:minmax(0,760px) minmax(320px,1fr);gap:16px;align-items:start}
.ai-provider-form{min-width:0;display:grid;gap:14px}
.ai-rules-panel{background:var(--hz-surface);border:1px solid var(--hz-line);border-radius:7px;padding:18px 20px;min-width:0;display:grid;gap:12px;box-shadow:0 1px 2px rgba(36,35,33,.025)}
.ai-rules-panel h3{margin:0;font-size:15px;color:var(--hz-text);font-weight:700}
.ai-rules-panel header p{margin:4px 0 0;color:var(--hz-muted);font-size:12px}
.rule-box{border:1px solid var(--hz-line);border-radius:7px;padding:12px 14px;min-width:0;background:var(--hz-surface)}
.rule-box.active{border-color:var(--hz-primary);background:var(--hz-primary-soft);box-shadow:0 0 0 1px var(--hz-primary) inset}
.rule-title{display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer}
.rule-title:focus-visible{outline:2px solid rgba(47,111,114,.38);outline-offset:2px;border-radius:4px}
.rule-title strong{font-size:14px;color:var(--hz-text);font-weight:600}
.rule-reset{margin-left:auto}
.rule-input :deep(textarea){font:12px/1.7 'SF Mono',Consolas,'Microsoft YaHei',monospace;color:var(--hz-text)}
.rule-box .scope-hint{margin-top:8px}
.ai-provider-form .el-select{width:100%}
.ai-form{display:grid;gap:14px}
.ai-card{background:var(--hz-surface);border:1px solid var(--hz-line);border-radius:7px;padding:18px 20px;min-width:0;box-shadow:0 1px 2px rgba(36,35,33,.025)}
.ai-card>header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.ai-card h3{margin:0;font-size:15px;color:var(--hz-text);font-weight:700}
.ai-card header p{margin:4px 0 0;color:var(--hz-muted);font-size:12px}
.ai-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
.ai-provider-status{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.ai-test-result{margin-top:12px}
.scope-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:4px 0}
.scope-option{display:grid;gap:6px;align-content:start;text-align:left;padding:12px 14px;background:var(--hz-surface);border:1px solid var(--hz-line);border-radius:7px;cursor:pointer;font:inherit;color:inherit;transition:all .16s}
.scope-option:hover{border-color:var(--hz-primary);box-shadow:0 1px 2px rgba(36,35,33,.025)}
.scope-option:focus-visible{outline:2px solid rgba(47,111,114,.38);outline-offset:2px}
.scope-option.active{border-color:var(--hz-primary);background:var(--hz-primary-soft);box-shadow:0 0 0 1px var(--hz-primary) inset}
.scope-option strong{font-size:14px;color:var(--hz-text);font-weight:600}
.scope-option span{font-size:12px;line-height:1.6;color:var(--hz-muted)}
.refusal-field{margin:12px 0 0}
.scope-hint{display:block;margin-top:10px;color:var(--hz-muted);font-size:12px}
.ai-actions{display:flex;justify-content:flex-end}
@media(max-width:900px){.admin-heading{align-items:flex-start;flex-direction:column}.stat-grid,.summary-row{grid-template-columns:repeat(2,minmax(0,1fr))}.admin-tabs{padding:14px}.issue-panel .el-input-number{width:120px}.ai-grid,.scope-options,.ai-layout{grid-template-columns:1fr}}
@media(max-width:650px){.admin-page{padding:14px 11px}.stat-grid,.summary-row{grid-template-columns:1fr}.issue-panel>*{width:100%!important}.admin-login{margin:30px auto;padding:22px}.card-filter .el-select,.issue-panel .batch-note{width:100%}.issued-heading{align-items:flex-start;flex-wrap:wrap}.ai-card{padding:16px 18px}}
</style>
