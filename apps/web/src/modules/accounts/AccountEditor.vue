<script setup>
import { computed, ref, onMounted, watch } from 'vue';
const props = defineProps({ account: { type: Object, default: null }, mode: { type: String, default: 'create' } });
const emit = defineEmits(['close', 'created', 'saved']);
const name = ref('');
const nickname = ref('');
const proxy = ref('');
const proxyId = ref('');
const proxies = ref([]);
const cookie = ref('');
const loginMode = ref('douyin_chat');
const nodeId = ref('');
const nodes = ref([]);
const error = ref('');
const busy = ref(false);
const editing = computed(() => props.mode === 'edit');
function hydrate() {
  name.value = props.account?.name || '';
  nickname.value = props.account?.nickname || '';
  proxy.value = props.account?.proxy || '';
  proxyId.value = props.account?.proxyId || '';
  loginMode.value = props.account?.loginMode || 'douyin_chat';
  nodeId.value = props.account?.nodeId || '';
}
async function create() {
  error.value = '';
  const session = JSON.parse(localStorage.getItem('douyinjuhe.session') || 'null');
  if (!session?.token) { error.value = '请先在“登录器连接”中登录抖音聚合'; return; }
  if (props.mode === 'create' && !nodeId.value) { error.value = '请先在“登录器连接”中绑定在线工作台，再创建账号任务。'; return; }
  busy.value = true;
  try {
    const body = { name: name.value, nickname: nickname.value, proxy: '', proxyId: proxyId.value || null, ...(!editing.value && nodes.value.length ? { nodeId: nodeId.value || null } : {}) };
    const endpoint = props.mode === 'create' ? '/api/v1/accounts' : `/api/v1/accounts/${props.account.id}`;
    const response = await fetch(endpoint, { method: props.mode === 'create' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || (props.mode === 'create' ? '创建账号失败' : '保存账号失败'));
    if (props.mode === 'create') emit('created', result); else emit('saved', result);
    emit('close');
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
onMounted(async () => {
  hydrate();
  try {
    const session = JSON.parse(localStorage.getItem('douyinjuhe.session') || 'null');
    if (!session?.token) return;
    const response = await fetch('/api/v1/nodes', { headers: { Authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(8000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '工作台加载失败');
    nodes.value = result;
    const online = result.find(item => item.online);
    if (online && props.mode === 'create' && !nodeId.value) nodeId.value = online.id;
  } catch (e) { error.value = e.message; }
  try {
    const session = JSON.parse(localStorage.getItem('douyinjuhe.session') || 'null');
    if (session?.token) {
      const response = await fetch('/api/v1/proxies', { headers: { Authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(8000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '代理库加载失败');
      proxies.value = result;
    }
  } catch (e) { if (!error.value) error.value = e.message; }
});
watch(() => props.account, hydrate);
</script>
<template>
  <el-dialog :model-value="true" :title="editing ? '编辑账号' : '新增账号'" width="min(600px, 94vw)" @close="emit('close')" destroy-on-close>
    <el-alert :title="loginMode==='creator' ? '登录器将打开创作者中心并采集独立登录状态。' : '登录器将启动抖音聊天并采集登录身份。'" type="info" :closable="false"/>
    <el-alert v-if="error" :title="error" type="error" :closable="false" style="margin-top:12px"/>
    <el-form label-position="top" style="margin-top:20px">
      <el-form-item label="登录方式"><el-radio-group v-model="loginMode" :disabled="editing"><el-radio value="douyin_chat">抖音聊天</el-radio><el-radio value="creator">创作者</el-radio></el-radio-group></el-form-item>
      <el-form-item v-if="!editing" label="工作台节点" required><el-select v-model="nodeId" placeholder="请选择已绑定的工作台" :disabled="!nodes.length"><el-option v-for="node in nodes" :key="node.id" :label="`${node.name} · ${node.online?'在线':'离线'}`" :value="node.id"/></el-select><small v-if="!nodes.length">请先到“登录器连接”生成绑定码，并在登录器中完成绑定。</small></el-form-item>
        <el-form-item label="坑位"><el-select placeholder="暂无可用坑位" disabled/><small>坑位绑定将在账号登录完成后接入。</small></el-form-item>
        <el-form-item label="名称" required><el-input v-model="name" placeholder="请输入账号名称" maxlength="100"/></el-form-item>
        <el-form-item label="账号显示昵称"><el-input v-model="nickname" placeholder="可选，仅用于本地识别" maxlength="100"/></el-form-item>
        <el-form-item label="代理"><el-select v-model="proxyId" clearable placeholder="不使用代理"><el-option v-for="item in proxies.filter(item => item.enabled && !item.expired)" :key="item.id" :label="`${item.name} · ${item.protocol}://${item.host}:${item.port}`" :value="item.id"/></el-select><small>代理由管理员在代理库维护；停用或到期代理不会被分配给新账号。</small></el-form-item>
        <el-form-item v-if="loginMode==='creator' && !editing" label="创作者登录状态"><el-input v-model="cookie" type="textarea" :rows="3" placeholder="由登录器打开创作者中心后自动采集，不需要手工粘贴" autocomplete="off" disabled/></el-form-item>
    </el-form>
    <template #footer><el-button @click="emit('close')">取消</el-button><el-button type="primary" :loading="busy" @click="create">{{ editing ? '保存修改' : '创建账号' }}</el-button></template>
  </el-dialog>
</template>
<style scoped>.el-select{width:100%}.el-form-item small{display:block;color:#8b98aa;line-height:1.6;margin-top:6px}</style>
