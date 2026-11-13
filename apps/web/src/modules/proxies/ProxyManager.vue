<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import { apiRequest } from '../../lib/api.js';

const rows = ref([]);
const search = ref('');
const editor = ref(false);
const batchEditor = ref(false);
const error = ref('');
const notice = ref('');
const loading = ref(false);
const saving = ref(false);
const form = reactive({ id: '', name: '', protocol: 'http', port: 7890, host: '127.0.0.1', username: '', password: '', passwordPresent: false, enabled: true, expiresAt: null });
const batch = reactive({ format: 'auto', protocol: 'http', prefix: '代理', enabled: true, content: '' });
const formats = [
  ['auto', '自动识别'], ['url', 'URL'], ['host-port', 'host:port'],
  ['pipe', 'host|port|user|pass'], ['host-port-user-pass', 'host:port:user:pass'], ['user-pass-host-port', 'user:pass@host:port'],
  ['user-pass-host-port-colon', 'user:pass:host:port'], ['csv', 'host,port,user,pass']
];
const filtered = computed(() => rows.value.filter(row => `${row.id} ${row.name} ${row.protocol} ${row.host}:${row.port}`.toLowerCase().includes(search.value.trim().toLowerCase())));
const expiring = computed(() => rows.value.filter(row => row.expiresSoon));

function openEditor(row) {
  Object.assign(form, { id: '', name: '', protocol: 'http', port: 7890, host: '127.0.0.1', username: '', password: '', passwordPresent: false, enabled: true, expiresAt: null }, row || {});
  error.value = '';
  editor.value = true;
}
async function load() {
  loading.value = true;
  try { rows.value = await apiRequest('proxies'); }
  catch (cause) { notice.value = cause.message; rows.value = []; }
  finally { loading.value = false; }
}
async function save() {
  if (!form.name.trim() || !form.host.trim() || !Number.isInteger(Number(form.port)) || form.port < 1 || form.port > 65535) {
    error.value = '请填写名称、主机和有效端口。'; return;
  }
  saving.value = true; error.value = '';
  try {
    const body = { name: form.name, protocol: form.protocol, host: form.host, port: Number(form.port), username: form.username, enabled: form.enabled, expiresAt: form.expiresAt || null, ...(form.password ? { password: form.password } : {}) };
    await apiRequest(form.id ? `proxies/${form.id}` : 'proxies', { method: form.id ? 'PATCH' : 'POST', body });
    editor.value = false; await load(); notice.value = form.id ? '代理已更新。' : '代理已创建。';
  } catch (cause) { error.value = cause.message; }
  finally { saving.value = false; }
}
function parseProxy(line, format) {
  const selected = format === 'auto'
    ? (/^[a-z]+:\/\//i.test(line) ? 'url' : line.includes('|') ? 'pipe' : line.includes('@') ? 'user-pass-host-port' : line.includes(',') ? 'csv' : line.split(':').length === 2 ? 'host-port' : 'host-port-user-pass')
    : format;
  let host = '', port = '', username = '', password = '', protocol = batch.protocol;
  if (selected === 'url') {
    const url = new URL(line);
    protocol = url.protocol.replace(':', ''); host = url.hostname; port = url.port;
    username = decodeURIComponent(url.username); password = decodeURIComponent(url.password);
  } else if (selected === 'user-pass-host-port') {
    const [credentials, address] = line.split('@');
    if (!credentials || !address) throw new Error();
    [username, password] = credentials.split(':'); [host, port] = address.split(':');
  } else {
    const separator = selected === 'csv' ? ',' : selected === 'pipe' ? '|' : ':';
    const parts = line.split(separator).map(value => value.trim());
    if (selected === 'host-port') [host, port] = parts;
    else if (selected === 'host-port-user-pass' || selected === 'csv' || selected === 'pipe') [host, port, username = '', password = ''] = parts;
    else if (selected === 'user-pass-host-port-colon') [username, password, host, port] = parts;
  }
  const numericPort = Number(port);
  if (!host || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535 || !['http', 'https', 'socks5'].includes(protocol)) throw new Error();
  return { host, port: numericPort, username: username || '', password: password || '', protocol };
}
async function addBatch() {
  const lines = batch.content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) { error.value = '请输入至少一条代理内容。'; return; }
  let parsed;
  try { parsed = lines.map(line => parseProxy(line, batch.format)); }
  catch { error.value = '代理内容中存在无法识别的地址或端口，请检查排版格式。'; return; }
  saving.value = true; error.value = '';
  try {
    await Promise.all(parsed.map((proxy, index) => apiRequest('proxies', { method: 'POST', body: { name: `${batch.prefix || '代理'}${index + 1}`, ...proxy, enabled: batch.enabled } })));
    batchEditor.value = false; batch.content = ''; await load(); notice.value = `已新增 ${lines.length} 条代理。`;
  } catch (cause) { error.value = `${cause.message} 已成功提交的条目不会重复回滚，请刷新核对。`; }
  finally { saving.value = false; }
}
async function testProxy(row) { row.testing = true; try { const result = await apiRequest(`proxies/${row.id}/test`, { method: 'POST' }); row.reachable = result.reachable; row.checkedAt = result.checkedAt; row.latencyMs = result.latencyMs; notice.value = `代理连通，延迟 ${result.latencyMs} ms。`; } catch (cause) { row.reachable = 'unreachable'; notice.value = cause.message; } finally { row.testing = false; } }
async function remove(id) { try { await apiRequest(`proxies/${id}`, { method: 'DELETE' }); await load(); notice.value = '代理已删除。'; } catch (cause) { notice.value = cause.message; } }
async function toggle(row) { try { await apiRequest(`proxies/${row.id}`, { method: 'PATCH', body: { enabled: row.enabled } }); } catch (cause) { row.enabled = !row.enabled; notice.value = cause.message; } }
onMounted(() => { window.addEventListener('douyinjuhe-session', load); load(); });
onUnmounted(() => window.removeEventListener('douyinjuhe-session', load));
</script>

<template>
  <section class="manager-page">
    <div class="manager-toolbar">
      <el-input v-model="search" :prefix-icon="Search" placeholder="搜索代理" clearable/>
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      <el-button type="primary" :icon="Plus" @click="openEditor()">新增代理</el-button>
      <el-button @click="error='';batchEditor=true">批量新增</el-button>
    </div>
    <div class="manager-panel">
      <el-alert v-if="notice" :title="notice" type="info" show-icon @close="notice=''"/>
      <el-alert v-if="expiring.length" :title="`${expiring.length} 条代理将在 3 天内到期，请及时更新日期或更换代理。`" type="warning" show-icon :closable="false"/>
      <el-table v-loading="loading" :data="filtered" empty-text="暂无代理">
        <el-table-column prop="id" label="ID" min-width="180"/>
        <el-table-column prop="name" label="名称" min-width="130"/>
        <el-table-column prop="protocol" label="协议" width="100"/>
        <el-table-column label="地址" min-width="180"><template #default="{row}">{{ row.host }}{{ row.port ? `:${row.port}` : '' }}</template></el-table-column>
        <el-table-column label="启用" width="90"><template #default="{row}"><el-switch v-model="row.enabled" @change="toggle(row)"/></template></el-table-column>
        <el-table-column label="到期" width="170"><template #default="{row}"><el-tag v-if="row.expired" type="danger" size="small">已到期</el-tag><el-tag v-else-if="row.expiresSoon" type="warning" size="small">3日内到期</el-tag><span v-else>{{ row.expiresAt ? new Date(row.expiresAt).toLocaleString() : '长期有效' }}</span></template></el-table-column>
        <el-table-column label="连通" width="130"><template #default="{row}">{{ row.reachable==='unchecked'?'未检测':row.reachable==='reachable'?'可用':'不可用' }}<small v-if="row.latencyMs"> · {{ row.latencyMs }} ms</small></template></el-table-column>
        <el-table-column label="操作" width="220"><template #default="{row}"><el-button link type="success" :loading="row.testing" :disabled="!row.enabled" @click="testProxy(row)">测试</el-button><el-button link type="primary" @click="openEditor(row)">编辑</el-button><el-popconfirm title="确定删除这条代理？" @confirm="remove(row.id)"><template #reference><el-button link type="danger">删除</el-button></template></el-popconfirm></template></el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="editor" :title="form.id?'编辑代理':'新增代理'" width="min(560px,94vw)">
      <el-form label-position="top">
        <el-form-item label="名称" required><el-input v-model="form.name" maxlength="100"/></el-form-item>
        <div class="form-grid"><el-form-item label="协议"><el-select v-model="form.protocol"><el-option label="http" value="http"/><el-option label="https" value="https"/><el-option label="socks5" value="socks5"/></el-select></el-form-item><el-form-item label="端口"><el-input-number v-model="form.port" :min="1" :max="65535" controls-position="right"/></el-form-item></div>
        <el-form-item label="主机" required><el-input v-model="form.host"/></el-form-item>
        <div class="form-grid"><el-form-item label="用户名"><el-input v-model="form.username" autocomplete="off"/></el-form-item><el-form-item :label="form.id&&form.passwordPresent?'密码（留空保持原密码）':'密码'"><el-input v-model="form.password" type="password" autocomplete="new-password" show-password/></el-form-item></div>
        <el-form-item label="代理到期时间"><el-date-picker v-model="form.expiresAt" type="datetime" value-format="x" placeholder="不设置则长期有效" clearable style="width:100%"/><small>到期前 3 天会提示；到期后不能绑定、测试或走上游请求。</small></el-form-item>
        <el-form-item label="状态"><el-switch v-model="form.enabled" active-text="启用"/></el-form-item>
      </el-form>
      <el-alert v-if="error" :title="error" type="error" :closable="false"/>
      <template #footer><el-button @click="editor=false">取消</el-button><el-button type="primary" :loading="saving" @click="save">{{ form.id?'保存':'创建代理' }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="batchEditor" title="批量新增代理" width="min(620px,94vw)">
      <el-form label-position="top">
        <div class="form-grid"><el-form-item label="排版格式"><el-select v-model="batch.format"><el-option v-for="item in formats" :key="item[0]" :label="item[1]" :value="item[0]"/></el-select></el-form-item><el-form-item label="默认协议"><el-select v-model="batch.protocol"><el-option label="http" value="http"/><el-option label="https" value="https"/><el-option label="socks5" value="socks5"/></el-select></el-form-item></div>
        <el-form-item label="名称前缀"><el-input v-model="batch.prefix" maxlength="50"/></el-form-item>
        <el-form-item label="状态"><el-switch v-model="batch.enabled" active-text="启用"/></el-form-item>
        <el-form-item label="代理内容" required><el-input v-model="batch.content" type="textarea" :rows="8" placeholder="每行一条；字段用 | 分隔，例如 IP|端口|用户名|密码"/></el-form-item>
      </el-form>
      <el-alert v-if="error" :title="error" type="error" :closable="false"/>
      <template #footer><el-button @click="batchEditor=false">取消</el-button><el-button type="primary" :loading="saving" @click="addBatch">确认新增</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.manager-toolbar{display:flex;justify-content:flex-end;gap:10px;margin-bottom:22px;flex-wrap:wrap}.manager-toolbar .el-input{width:280px}.manager-panel{background:#fff;border-radius:20px;padding:20px;min-height:calc(100vh - 235px)}.manager-panel .el-alert{margin-bottom:14px}.manager-panel :deep(.el-table__empty-block){min-height:390px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.el-select,.el-input-number{width:100%}@media(max-width:650px){.manager-toolbar .el-input{width:100%}.manager-panel{padding:12px}.form-grid{grid-template-columns:1fr}}
</style>
