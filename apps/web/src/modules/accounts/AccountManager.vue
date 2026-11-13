<script setup>
import { computed, onMounted, ref } from 'vue';
import { Download, Plus, Refresh, Search, CopyDocument, CircleCheck, Edit, Delete } from '@element-plus/icons-vue';
import AccountEditor from './AccountEditor.vue';
import { apiRequest } from '../../lib/api.js';
const props = defineProps({ rows: { type: Array, default: () => [] }, error: { type: String, default: '' }, checking: { type: Boolean, default: false }, checkNotice: { type: String, default: '' } });
const emit = defineEmits(['refresh', 'check', 'remove']);
const editor = ref(false);
const editorMode = ref('create');
const selectedAccount = ref(null);
const keyword = ref('');
// 下载文件名固定为 douyinjuhe-版本号.exe，版本号取自更新清单；读取失败时退回 douyinjuhe.exe。
const launcherVersion = ref('');
const launcherDownloadName = computed(() => launcherVersion.value ? `douyinjuhe-${launcherVersion.value}.exe` : 'douyinjuhe.exe');
onMounted(async () => {
  try {
    const response = await fetch('/downloads/launcher/webview2-latest.json', { cache: 'no-store' });
    const manifest = response.ok ? await response.json() : null;
    const version = String(manifest?.version || '').replace(/-webview2.*$/i, '');
    if (/^\d+(\.\d+){1,3}$/.test(version)) launcherVersion.value = version;
  } catch { /* 读取失败时使用默认文件名 */ }
});
const applied = ref('');
const statusFilter = ref('all');
const slotFilter = ref('all');
const sourceFilter = ref('all');
const sortBy = ref('newest');
const tenantFilter = ref('all');
// 仅超管会收到多个租户的账号；普通租户看不到租户筛选和租户列。
const isSuperAdmin = (() => { try { return JSON.parse(localStorage.getItem('douyinjuhe.session') || 'null')?.user?.role === 'admin'; } catch { return false; } })();
const tenantOptions = computed(() => {
  const seen = new Map();
  for (const row of props.rows) if (row.ownerId && !seen.has(row.ownerId)) seen.set(row.ownerId, row.ownerName || row.ownerId.slice(0, 8));
  return [...seen].map(([value, label]) => ({ value, label: `${label}（${props.rows.filter(row => row.ownerId === value).length}）` }));
});
const notice = ref('');
const activationOpen = ref(false);
const activationAccount = ref(null);
const activationSlots = ref([]);
const activationSlot = ref('');
const activationError = ref('');
const activationBusy = ref(false);
const statusOptions = [['all', '全部状态'], ['normal', '正常'], ['reauth', '需重登'], ['unactivated', '未激活'], ['expired', '已过期'], ['offline', '掉线'], ['abnormal', '异常'], ['unchecked', '未检测']];
const slotOptions = [['all', '全部坑位'], ['bound', '已绑定'], ['unbound', '未绑定'], ['unavailable', '不可用']];
const sourceOptions = [['all', '全部来源'], ['douyin_chat', '抖音聊天'], ['creator', '创作者中心']];
const sortOptions = [['newest', '新账号优先'], ['oldest', '旧账号优先'], ['updated', '最近更新'], ['status', '按状态'], ['source', '按来源'], ['slot', '按坑位']];
// 不设代理、由服务器直连的账号统一显示“直连”，不暴露服务器 IP；代理/本机节点显示实际出口。
function ipLabel(row) {
  const mode = row.networkMode || (row.proxyId ? 'custom' : 'direct');
  if (mode === 'direct') return '直连';
  return row.currentIp || '未读取';
}
function source(row) { return row.loginMode === 'creator' ? '创作者中心' : '抖音聊天'; }
function sourceKey(row) { return row.loginMode === 'creator' ? 'creator' : 'douyin_chat'; }
const minuteText = value => {
  const date = new Date(Number(value)), pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
function slotExpired(row) {
  if (!row.slot) return false;
  return row.slotExpires != null ? Number(row.slotExpires) <= Date.now() : row.slotActive === false;
}
function slotLabel(row) {
  if (row.slotAvailable === false || row.slotStatus === 'unavailable') return '不可用';
  if (slotExpired(row)) return '已过期';
  if (row.slot && row.slotExpires != null) return `${row.slotType === 'month' ? '月卡坑位' : '日卡坑位'} · ${minuteText(row.slotExpires)}`;
  return row.slotName || (row.slot ? '已绑定' : '未绑定');
}
function slotTip(row) {
  if (!row.slot || row.slotExpires == null) return '';
  return `${row.slotType === 'month' ? '月卡坑位' : '日卡坑位'}，${slotExpired(row) ? '已于' : '到期时间：'}${minuteText(row.slotExpires)}${slotExpired(row) ? '过期' : ''}`;
}
function slotTagType(row) {
  if (slotExpired(row) || row.slotAvailable === false || row.slotStatus === 'unavailable') return 'danger';
  return row.slot ? 'success' : 'warning';
}
function statusKey(row) {
  const value = String(row.status || '').toLowerCase();
  if (value === 'reauth' || /需重登|unexpected session length|unexepcted session length/i.test(String(row.statusReason || ''))) return 'reauth';
  if (['online', 'normal', 'active'].includes(value)) return 'normal';
  if (['unverified', 'unactivated'].includes(value)) return 'unactivated';
  if (['expired', 'expire'].includes(value)) return 'expired';
  if (['error', 'abnormal', 'failed'].includes(value)) return 'abnormal';
  if (['pending', 'unknown', 'unchecked'].includes(value) || !value) return 'unchecked';
  if (value === 'offline' && row.unactivated === true) return 'unactivated';
  if (value === 'offline') return 'offline';
  return row.available === false ? 'unactivated' : 'unchecked';
}
function statusLabel(row) {
  if (row.status === 'pending') return { text: '登录中', type: 'warning' };
  const labels = {
    normal: { text: '正常', type: 'success' },
    reauth: { text: '需重登', type: 'danger' },
    unactivated: { text: '未激活', type: 'warning' },
    expired: { text: '已过期', type: 'danger' },
    offline: { text: '掉线', type: 'info' },
    abnormal: { text: '异常', type: 'danger' },
    unchecked: { text: '未检测', type: 'info' },
  };
  return labels[statusKey(row)] || labels.unchecked;
}
function slotKey(row) {
  if (row.slotAvailable === false || row.slotStatus === 'unavailable' || slotExpired(row)) return 'unavailable';
  return row.slot ? 'bound' : 'unbound';
}
function sortValue(row, field) {
  if (field === 'status') return statusKey(row);
  if (field === 'source') return source(row);
  if (field === 'slot') return slotLabel(row);
  return '';
}
const filtered = computed(() => {
  const query = applied.value.toLowerCase();
  const rows = props.rows.filter(row => {
    const text = `${row.name || ''} ${row.nickname || ''} ${row.proxyName || ''} ${row.proxy || ''} ${row.uid || ''} ${row.douyinId || ''}`.toLowerCase();
    return (!query || text.includes(query)) &&
      (tenantFilter.value === 'all' || row.ownerId === tenantFilter.value) &&
      (statusFilter.value === 'all' || statusKey(row) === statusFilter.value) &&
      (slotFilter.value === 'all' || slotKey(row) === slotFilter.value) &&
      (sourceFilter.value === 'all' || sourceKey(row) === sourceFilter.value);
  });
  return rows.sort((left, right) => {
    if (['status', 'source', 'slot'].includes(sortBy.value)) return sortValue(left, sortBy.value).localeCompare(sortValue(right, sortBy.value), 'zh-CN');
    const leftTime = Number(left[sortBy.value === 'updated' ? 'updated' : 'created'] || 0);
    const rightTime = Number(right[sortBy.value === 'updated' ? 'updated' : 'created'] || 0);
    return (sortBy.value === 'oldest' ? 1 : -1) * (leftTime - rightTime);
  });
});
function search() { applied.value = keyword.value.trim(); }
function openCreate() { selectedAccount.value = null; editorMode.value = 'create'; editor.value = true; }
function openEdit(row) { selectedAccount.value = row; editorMode.value = 'edit'; editor.value = true; }
function created() { editor.value = false; emit('refresh'); notice.value = '账号已保存到抖音聚合；平台登录状态需由登录器真实回执确认。'; }
function saved() { editor.value = false; emit('refresh'); notice.value = '账号资料已更新。'; }
async function openActivation(row) {
  activationAccount.value = row;
  activationSlot.value = row.slot || '';
  activationError.value = '';
  activationOpen.value = true;
  try {
    const rows = await apiRequest('slots');
    activationSlots.value = rows.filter(slot => slot.status === 'available' || slot.id === row.slot);
    if (!activationSlot.value && activationSlots.value.length === 1) activationSlot.value = activationSlots.value[0].id;
    if (!activationSlots.value.length) activationError.value = '暂无可用坑位，请先在“坑位管理”中兑换坑位。';
  } catch (cause) { activationSlots.value = []; activationError.value = cause.message; }
}
async function activateAccount() {
  if (!activationAccount.value || !activationSlot.value) { activationError.value = '请选择一个有效坑位。'; return; }
  activationBusy.value = true; activationError.value = '';
  try {
    await apiRequest(`accounts/${activationAccount.value.id}/activate`, { method: 'POST', body: { slot: activationSlot.value } });
    activationOpen.value = false;
    await emit('refresh');
    notice.value = '账号已激活，坑位绑定已生效。';
  } catch (cause) { activationError.value = cause.message; }
  finally { activationBusy.value = false; }
}
</script>

<template>
  <section class="account-page" aria-label="账号管理">
    <div class="account-toolbar">
      <el-button :icon="Download" tag="a" href="/downloads/launcher/DouyinJuheLauncher-WebView2-latest.exe" :download="launcherDownloadName">下载登录器</el-button>
      <div class="search-group"><el-input v-model="keyword" :prefix-icon="Search" clearable placeholder="搜索名称 / 昵称 / 代理" @keyup.enter="search"/><el-button @click="search">搜索</el-button></div>
      <el-button :icon="Refresh" @click="emit('refresh')">刷新</el-button>
      <el-button :loading="checking" :disabled="checking" @click="emit('check')">{{ checking ? '检测中…' : '一键检测' }}</el-button>
      <el-button type="primary" :icon="Plus" @click="openCreate">新增账号</el-button>
    </div>
    <div class="account-filters" aria-label="账号筛选">
      <el-select v-if="isSuperAdmin" v-model="tenantFilter" aria-label="所属租户" class="filter-select tenant-select"><el-option value="all" label="全部租户"/><el-option v-for="item in tenantOptions" :key="item.value" :value="item.value" :label="item.label"/></el-select>
      <el-select v-model="statusFilter" aria-label="账号状态" class="filter-select"><el-option v-for="([value,label]) in statusOptions" :key="value" :value="value" :label="label"/></el-select>
      <el-select v-model="slotFilter" aria-label="账号坑位" class="filter-select"><el-option v-for="([value,label]) in slotOptions" :key="value" :value="value" :label="label"/></el-select>
      <el-select v-model="sourceFilter" aria-label="账号来源" class="filter-select"><el-option v-for="([value,label]) in sourceOptions" :key="value" :value="value" :label="label"/></el-select>
      <el-select v-model="sortBy" aria-label="账号排序" class="filter-select"><el-option v-for="([value,label]) in sortOptions" :key="value" :value="value" :label="label"/></el-select>
      <span class="filter-count">共 {{ filtered.length }} 个账号</span>
    </div>
    <section class="account-panel">
      <el-alert v-if="error" :title="error" type="error" :closable="false"/>
      <el-alert v-if="checkNotice" :title="checkNotice" type="success" show-icon :closable="false"/>
      <el-alert v-if="notice" :title="notice" type="info" show-icon @close="notice=''"/>
      <el-table :data="filtered" empty-text="暂无账号" class="cloud-account-table">
        <el-table-column label="头像" width="76" fixed="left"><template #default="{row}"><span class="account-avatar"><img v-if="row.avatar" :src="row.avatar" alt="" referrerpolicy="no-referrer"/><template v-else>{{ (row.nickname || row.name || '合').slice(0,1) }}</template></span></template></el-table-column>
        <el-table-column label="昵称" min-width="190"><template #default="{row}"><strong>{{ row.nickname || row.name || '未命名账号' }}</strong><small v-if="row.nickname && row.name">{{ row.name }}</small></template></el-table-column>
        <el-table-column v-if="isSuperAdmin" label="所属租户" min-width="130"><template #default="{row}"><el-tag size="small" effect="plain">{{ row.ownerName || (row.ownerId || '').slice(0, 8) || '—' }}</el-tag></template></el-table-column>
        <el-table-column label="抖音号" min-width="145"><template #default="{row}">{{ row.douyinId || row.uid || '—' }}</template></el-table-column>
        <el-table-column label="当前 IP" width="150"><template #default="{row}"><span class="account-ip">{{ ipLabel(row) }}</span></template></el-table-column>
        <el-table-column label="来源" width="120"><template #default="{row}"><el-tag size="small" :type="row.loginMode==='creator'?'warning':'success'">{{ source(row) }}</el-tag><small v-if="row.proxyName" class="proxy-label">代理：{{ row.proxyName }}</small></template></el-table-column>
        <el-table-column label="坑位" min-width="170"><template #default="{row}"><el-tooltip :disabled="!slotTip(row)" :content="slotTip(row)" placement="top"><el-tag size="small" :type="slotTagType(row)">{{ slotLabel(row) }}</el-tag></el-tooltip></template></el-table-column>
        <el-table-column label="状态" width="150"><template #default="{row}"><el-tooltip v-if="row.statusReason || row.checkedAt" :content="`${row.statusReason || '已检测'}${row.checkedAt ? ` · ${new Date(row.checkedAt).toLocaleString()}` : ''}`" placement="top"><el-tag size="small" :type="statusLabel(row).type">{{ statusLabel(row).text }}</el-tag></el-tooltip><el-tag v-else size="small" :type="statusLabel(row).type">{{ statusLabel(row).text }}</el-tag><small v-if="row.networkMode==='local_node' && row.nodeOnline===false" class="node-offline">登录器离线，暂停收发</small></template></el-table-column>
        <el-table-column label="操作" min-width="270" fixed="right"><template #default="{row}">
          <el-button link type="primary" :icon="CopyDocument" :disabled="!row.uid && !row.cookie">复制ck</el-button>
          <el-button link type="success" :icon="CircleCheck" @click="openActivation(row)">{{ row.slot ? '重新激活' : '一键激活' }}</el-button>
          <el-button link type="primary" :icon="Edit" @click="openEdit(row)">编辑</el-button>
          <el-popconfirm title="确定删除这个账号？" @confirm="emit('remove',row.id)"><template #reference><el-button link type="danger" :icon="Delete">删除</el-button></template></el-popconfirm>
        </template></el-table-column>
      </el-table>
    </section>
    <AccountEditor v-if="editor" :key="`${editorMode}:${selectedAccount?.id || 'new'}`" :mode="editorMode" :account="selectedAccount" @close="editor=false" @created="created" @saved="saved"/>
    <el-dialog v-model="activationOpen" title="激活账号" width="min(520px, 94vw)" destroy-on-close>
      <p class="activation-account">账号：<strong>{{ activationAccount?.nickname || activationAccount?.name || '未命名账号' }}</strong></p>
      <el-alert v-if="activationError" :title="activationError" type="warning" :closable="false"/>
      <el-form label-position="top" style="margin-top:16px">
        <el-form-item label="选择坑位" required>
          <el-select v-model="activationSlot" placeholder="请选择未占用坑位" :disabled="!activationSlots.length">
            <el-option v-for="slot in activationSlots" :key="slot.id" :label="`${slot.type === 'day' ? '日卡' : '月卡'} · ${new Date(slot.expires).toLocaleString()}${slot.id === activationAccount?.slot ? ' · 当前' : ''}`" :value="slot.id"/>
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="activationOpen=false">取消</el-button><el-button type="primary" :loading="activationBusy" :disabled="!activationSlots.length" @click="activateAccount">确认激活</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.account-toolbar{display:flex;justify-content:flex-start;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}.search-group{display:flex;min-width:360px;margin-right:auto}.search-group .el-input{width:280px}.account-filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}.filter-select{width:136px}.tenant-select{width:176px}.filter-count{color:#7d8792;font-size:12px;margin-left:auto}.account-panel{background:#fff;border:1px solid #e1e5ea;border-radius:4px;padding:14px;min-height:calc(100vh - 220px);overflow:hidden}.account-panel .el-alert{margin-bottom:12px}.account-panel :deep(.el-table__empty-block){min-height:440px}.account-panel :deep(.cloud-account-table .el-table__cell){padding:10px 0}.account-panel :deep(.cloud-account-table small){display:block;color:#8a919b;font-size:11px;margin-top:3px}.account-avatar{display:grid;place-items:center;width:34px;height:34px;border-radius:4px;overflow:hidden;background:#eef1f4;color:#586575;font-weight:650}.account-avatar img{width:100%;height:100%;object-fit:cover}@media(max-width:700px){.account-toolbar{justify-content:stretch}.search-group{min-width:0;width:100%;margin-right:0}.search-group .el-input{width:auto;flex:1}.account-filters{gap:8px}.filter-select{width:calc(50% - 4px)}.filter-count{width:100%;margin-left:0}.account-panel{padding:10px}}
.account-panel :deep(.cloud-account-table small.node-offline){color:#c0562f}.activation-account{color:#718099;line-height:1.7}.el-select{width:100%}
</style>
