<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import RuleEditor from './RuleEditor.vue';
import { apiRequest } from '../../lib/api.js';
const props = defineProps({ kind: { type: String, required: true } });
const rows = ref([]), accounts = ref([]), keyword = ref(''), editor = ref(false), editing = ref(null), notice = ref(''), editorError = ref(''), loading = ref(false), saving = ref(false);
const group = computed(() => props.kind === '群聊自动回复');
const scope = computed(() => group.value ? 'group' : 'direct');
const accountNames = computed(() => Object.fromEntries(accounts.value.map(row => [row.id, row.nickname || row.name])));
const filtered = computed(() => rows.value.filter(row => row.scope === scope.value && `${row.name} ${accountNames.value[row.account] || ''} ${row.trigger} ${(row.keywords || []).join(' ')}`.includes(keyword.value.trim())));
// AI 配置开启（且提示词非空，与服务端判断一致）后，私聊由 AI 回复，私聊规则的内容不会发送；
// 此时私聊规则置灰，关闭 AI 后才可新增/编辑/启用。群聊规则不受影响。
const aiOn = ref(false);
const aiLocked = computed(() => !group.value && aiOn.value);
async function loadAIState() { try { const ai = (await apiRequest('settings/ai')).ai; aiOn.value = Boolean(ai?.enabled && String(ai.systemPrompt || '').trim()); } catch { /* 读取失败时不锁定，服务端仍按 AI 优先处理 */ } }
async function load() { loading.value = true; try { [rows.value, accounts.value] = await Promise.all([apiRequest('reply-rules'), apiRequest('accounts'), loadAIState()]); } catch (cause) { notice.value = cause.message; rows.value = []; accounts.value = []; } finally { loading.value = false; } }
function openEditor(row = null) { editing.value = row; editorError.value = ''; editor.value = true; }
async function save(payload) { saving.value = true; editorError.value = ''; try { const editingNow = editing.value; await apiRequest(editingNow ? `reply-rules/${editingNow.id}` : 'reply-rules', { method: editingNow ? 'PATCH' : 'POST', body: payload }); editor.value = false; await load(); notice.value = editingNow ? '自动回复已更新。' : '自动回复已创建。'; } catch (cause) { editorError.value = cause.message; } finally { saving.value = false; } }
async function toggle(row) { try { await apiRequest(`reply-rules/${row.id}`, { method: 'PATCH', body: { enabled: row.enabled } }); } catch (cause) { row.enabled = !row.enabled; notice.value = cause.message; } }
async function remove(row) { try { await apiRequest(`reply-rules/${row.id}`, { method: 'DELETE' }); await load(); notice.value = '自动回复已删除。'; } catch (cause) { notice.value = cause.message; } }
const typeNames = { text: '文本', emoji: '表情', card: '卡片', image: '图片' };
function componentSummary(components) { const counts = {}; for (const item of components) { const type = item.type || 'text'; counts[type] = (counts[type] || 0) + 1; } return Object.entries(counts).map(([type, count]) => `${count} 个${typeNames[type] || type}`).join('、') || '无'; }
watch(() => props.kind, load);
onMounted(() => { window.addEventListener('douyinjuhe-session', load); load(); });
onUnmounted(() => window.removeEventListener('douyinjuhe-session', load));
</script>
<template>
  <section class="reply-page" :aria-label="kind"><div class="reply-toolbar"><el-input v-model="keyword" :prefix-icon="Search" placeholder="搜索名称 / 账号 / 触发词" clearable/><el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button><el-button type="primary" :icon="Plus" :disabled="!accounts.length || aiLocked" @click="openEditor()">新增{{ kind }}</el-button></div>
    <section class="reply-panel"><el-alert v-if="aiLocked" title="AI 自动回复已开启：私聊由 AI 回复，此处的私聊规则暂不生效。如需使用规则回复，请先在“AI配置”中关闭 AI 自动回复。" type="warning" show-icon :closable="false"/><el-alert v-if="notice" :title="notice" type="info" show-icon @close="notice=''"/><el-alert v-if="!loading&&!accounts.length" title="当前租户没有可用账号，请先在账号管理中添加账号。" type="warning" show-icon :closable="false"/>
      <el-table v-loading="loading" :data="filtered" empty-text="暂无数据"><el-table-column prop="name" label="名称" min-width="140"/><el-table-column label="监听账号" min-width="130"><template #default="{row}">{{ accountNames[row.account] || '账号已删除' }}</template></el-table-column><el-table-column label="发送统计" width="110"><template #default="{row}">{{ row.sent }} 次</template></el-table-column><el-table-column label="触发类型" min-width="150"><template #default="{row}">{{ row.trigger==='keyword' ? '关键词：'+(row.keywords||[]).join('、') : row.trigger==='first' ? '首次私聊回复' : row.scope==='direct' ? '任意私聊文本消息' : '任意群聊文本消息' }}</template></el-table-column><el-table-column v-if="group" label="发送冷却" width="110"><template #default="{row}">{{ row.cooldown ? `${row.cooldown} 分钟` : '不限制' }}</template></el-table-column><el-table-column v-if="group" label="监听群聊" min-width="130"><template #default="{row}">{{ row.groups.length ? `${row.groups.length} 个群聊` : '全部群聊' }}</template></el-table-column><el-table-column label="发送通道" width="110"><template #default>默认通道</template></el-table-column><el-table-column label="回复组件" min-width="160"><template #default="{row}">{{ componentSummary(row.components) }}</template></el-table-column><el-table-column label="启用" width="80"><template #default="{row}"><el-switch v-model="row.enabled" :disabled="aiLocked" @change="toggle(row)"/></template></el-table-column><el-table-column v-if="!group" label="创建&更新日期" min-width="170"><template #default="{row}">{{ new Date(row.updated).toLocaleString() }}</template></el-table-column><el-table-column label="操作" width="130"><template #default="{row}"><el-button link type="primary" :disabled="aiLocked" @click="openEditor(row)">编辑</el-button><el-popconfirm title="确定删除这条自动回复？" @confirm="remove(row)"><template #reference><el-button link type="danger">删除</el-button></template></el-popconfirm></template></el-table-column></el-table>
    </section><RuleEditor v-if="editor" :kind="kind" :accounts="accounts" :initial="editing" :saving="saving" :error="editorError" @close="editor=false" @save="save"/></section>
</template>
<style scoped>.reply-page{min-width:0}.reply-toolbar{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-bottom:20px}.reply-toolbar .el-input{width:300px}.reply-panel{background:#fff;border-radius:18px;padding:20px;min-height:calc(100vh - 230px);overflow:hidden}.reply-panel .el-alert{margin-bottom:12px}.reply-panel :deep(.el-table__empty-block){min-height:440px}@media(max-width:650px){.reply-toolbar .el-input{width:100%}.reply-panel{padding:12px}}</style>
