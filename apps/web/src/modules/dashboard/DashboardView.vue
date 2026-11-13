<script setup>
import { computed, onMounted, ref } from 'vue';
import { ChatDotRound, Coin, Monitor, Refresh, Setting, Tickets, User } from '@element-plus/icons-vue';
import { apiRequest } from '../../lib/api.js';

defineProps({ accounts: { type: Array, default: () => [] } });
const loading = ref(false), error = ref(''), dashboard = ref({ generatedAt: 0, stats: { accountsTotal: 0, onlineAccounts: 0, conversationsTotal: 0, unreadConversations: 0, messagesToday: 0, inboundToday: 0, outboundToday: 0, tasksToday: 0, tasksCompleted: 0, tasksFailed: 0, cardsCreatedToday: 0, cardViews: 0, formalPoints: 0, testPoints: 0 }, accounts: [], tasks: [], cards: [] });
const summary = computed(() => dashboard.value.stats);
const statCards = computed(() => [
  ['账号总数', summary.value.accountsTotal, User, `在线 ${summary.value.onlineAccounts}`],
  ['会话总数', summary.value.conversationsTotal, ChatDotRound, `未读 ${summary.value.unreadConversations}`],
  ['今日消息', summary.value.messagesToday, Tickets, `收 ${summary.value.inboundToday} · 发 ${summary.value.outboundToday}`],
  ['今日任务执行', summary.value.tasksToday, Setting, `成功 ${summary.value.tasksCompleted} · 失败 ${summary.value.tasksFailed}`],
  ['今日新卡片', summary.value.cardsCreatedToday, Monitor, `累计浏览 ${summary.value.cardViews}`],
  ['我的积分', summary.value.formalPoints, Coin, `测试积分 ${summary.value.testPoints}`]
]);
const stateLabel = state => ({ online: '在线', offline: '离线', reauth: '需重登', unverified: '待验证', unactivated: '未激活', expired: '已过期', abnormal: '异常', unchecked: '未检测', pending: '处理中', failed: '失败', completed: '已完成', cancelled: '已取消', running: '执行中', queued: '排队中', draft: '草稿' }[state] || state || '未知');
const taskLabel = type => ({ inspect_client: '检查登录器', add_account: '添加账号', sync_duoshan: '同步抖音聊天' }[type] || type || '未知任务');
const time = value => value ? new Date(value).toLocaleString() : '--';
const load = async () => { loading.value = true; error.value = ''; try { dashboard.value = await apiRequest('dashboard'); } catch (cause) { error.value = cause.message; } finally { loading.value = false; } };
onMounted(load);
</script>

<template>
  <section class="dashboard" aria-label="数据概览">
    <header><div><h1>数据概览</h1><small v-if="dashboard.generatedAt">服务器统计 · {{ time(dashboard.generatedAt) }}</small></div><el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button></header>
    <el-alert v-if="error" :title="error" type="error" show-icon closable @close="error=''"/>
    <div class="stats"><article v-for="([name,value,icon,note],index) in statCards" :key="name" class="stat"><span :class="['stat-icon','color-'+index]"><el-icon><component :is="icon"/></el-icon></span><div><strong>{{ value }}</strong><p>{{ name }}</p><small>{{ note }}</small></div></article></div>
    <div class="panels">
      <section class="panel"><div class="panel-heading"><strong>账号状态</strong><span>{{ summary.accountsTotal }} 个账号</span></div><el-table v-loading="loading" :data="dashboard.accounts" empty-text="暂无账号"><el-table-column label="账号" min-width="130"><template #default="{row}">{{ row.nickname || row.name || row.uid || '未命名账号' }}</template></el-table-column><el-table-column label="状态" width="82"><template #default="{row}"><el-tag size="small" :type="row.status==='online'?'success':row.status==='unverified'?'warning':'info'">{{ stateLabel(row.status) }}</el-tag></template></el-table-column><el-table-column label="最近检查" width="145"><template #default="{row}">{{ time(row.checkedAt) }}</template></el-table-column></el-table><div class="trend"><span>在线账号</span><b>{{ summary.onlineAccounts }} / {{ summary.accountsTotal }}</b></div></section>
      <section class="panel"><div class="panel-heading"><strong>最近任务执行</strong><span>最近 {{ dashboard.tasks.length }} 条</span></div><el-table v-loading="loading" :data="dashboard.tasks" empty-text="暂无任务执行记录"><el-table-column label="任务" min-width="110"><template #default="{row}">{{ taskLabel(row.type) }}</template></el-table-column><el-table-column label="状态" width="86"><template #default="{row}">{{ stateLabel(row.state) }}</template></el-table-column><el-table-column label="时间" width="145"><template #default="{row}">{{ time(row.created) }}</template></el-table-column></el-table><div class="trend"><span>今日完成率</span><b>{{ summary.tasksToday ? Math.round(summary.tasksCompleted / summary.tasksToday * 100) : 0 }}%</b></div></section>
      <section class="panel"><div class="panel-heading"><strong>卡片浏览</strong><span>累计浏览 {{ summary.cardViews }}</span></div><el-table v-loading="loading" :data="dashboard.cards" empty-text="暂无卡片"><el-table-column prop="name" label="卡片" min-width="130"/><el-table-column prop="views" label="浏览" width="70"/><el-table-column label="创建时间" width="145"><template #default="{row}">{{ time(row.created) }}</template></el-table-column></el-table><div class="trend"><span>今日新建卡片</span><b>{{ summary.cardsCreatedToday }}</b></div></section>
    </div>
  </section>
</template>

<style scoped>
.dashboard{display:grid;gap:16px;min-width:0}
.dashboard>header{display:flex;align-items:flex-end;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid var(--hz-line)}
.dashboard h1{font-size:18px;margin:0;font-weight:650;color:var(--hz-text)}
.dashboard header small{display:block;color:var(--hz-muted);margin-top:5px;font-size:11px}
.stats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:0;background:#fff;border:1px solid var(--hz-line);border-radius:7px;overflow:hidden}
.stat{background:#fff;border:0;border-right:1px solid var(--hz-line);border-radius:0;padding:15px 14px;display:flex;align-items:center;gap:11px;min-height:82px;box-shadow:none}
.stat:last-child{border-right:0}
.stat strong{font-size:20px;font-weight:650;color:var(--hz-text)}
.stat p{margin:5px 0 3px;font-size:12px;color:var(--hz-muted)}
.stat small{font-size:10px;color:#9a968f;white-space:nowrap}
.stat-icon,.color-1,.color-2,.color-3,.color-4,.color-5{width:30px;height:30px;border-radius:5px;background:var(--hz-surface-muted);color:var(--hz-primary);display:grid;place-items:center;font-size:15px}
.panels{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.panel{background:#fff;border:1px solid var(--hz-line);border-radius:7px;overflow:hidden;box-shadow:none}
.panel-heading{padding:12px 14px;display:flex;justify-content:space-between;font-size:13px;border-bottom:1px solid #efede9;color:var(--hz-text)}
.panel-heading span{font-size:11px;color:var(--hz-muted)}
.panel .el-table{height:205px;font-size:12px}
.trend{padding:9px 14px;color:#9a968f;font-size:11px;border-top:1px solid #efede9;display:flex;justify-content:space-between}
.trend b{color:#57534d;font-size:12px;font-weight:600}
@media(max-width:1200px){.stats{grid-template-columns:repeat(3,minmax(0,1fr))}.stat:nth-child(3){border-right:0}.stat:nth-child(n+4){border-top:1px solid #e8ebef}}
@media(max-width:1000px){.panels{grid-template-columns:1fr}}
@media(max-width:650px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.stat:nth-child(3){border-right:1px solid #e8ebef}.stat:nth-child(even){border-right:0}.stat:nth-child(n+3){border-top:1px solid #e8ebef}.dashboard>header{align-items:flex-start}}
</style>
