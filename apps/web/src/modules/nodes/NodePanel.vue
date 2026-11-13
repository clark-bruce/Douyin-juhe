<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
const token = ref(''), user = ref(null), name = ref(''), password = ref('');
const nodes = ref([]), error = ref(''), busy = ref(false);
let refreshing = false;
async function request(path, method = 'GET', body) {
  const response = await fetch('/api/v1/' + path, { method, headers: { 'Content-Type': 'application/json', ...(token.value ? { Authorization: `Bearer ${token.value}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && token.value) clear();
    throw new Error(result.error || '请求失败');
  }
  return result;
}
function clear() { token.value = ''; user.value = null; nodes.value = []; localStorage.removeItem('douyinjuhe.session'); window.dispatchEvent(new Event('douyinjuhe-session')); }
function resetViewState() { token.value = ''; user.value = null; nodes.value = []; error.value = ''; }
async function run(action) { busy.value = true; error.value = ''; try { await action(); } catch (e) { error.value = e.message; } finally { busy.value = false; } }
async function login(register = false) {
  await run(async () => {
    const result = await request('auth/' + (register ? 'register' : 'login'), 'POST', { name: name.value, password: password.value });
    token.value = result.token; user.value = result.user; password.value = ''; localStorage.setItem('douyinjuhe.session', JSON.stringify({ token: result.token, user: result.user })); window.dispatchEvent(new Event('douyinjuhe-session'));
    await refresh();
  });
}
async function refresh() {
  if (!token.value || refreshing) return;
  refreshing = true;
  const session = token.value;
  try {
    const newNodes = await request('nodes');
    if (session === token.value) { nodes.value = newNodes; error.value = ''; }
  } catch (e) { if (session === token.value) { error.value = e.message; nodes.value = nodes.value.map(n => ({ ...n, online: false })); } }
  finally { refreshing = false; }
}
async function revoke(id) { await run(async () => { await request('nodes/' + id, 'DELETE'); await refresh(); }); }
async function logout() { await run(async () => { await request('auth/logout', 'POST', {}); clear(); }); }
const timer = setInterval(refresh, 3000);
// Leaving this page must not log the tenant out. The shared tenant session is
// cleared only by the explicit logout action above.
onUnmounted(() => { clearInterval(timer); resetViewState(); });
onMounted(async () => {
  try {
    const saved = JSON.parse(localStorage.getItem('douyinjuhe.session') || 'null');
    if (saved?.token && saved?.user) { token.value = saved.token; user.value = saved.user; await refresh(); }
  } catch { clear(); }
});
</script>
<template>
  <section class="node-panel">
    <h2>登录器连接</h2>
    <p>在抖音聚合登录器中使用抖音聚合账号登录，即可在此查看设备状态。</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false"/>
    <form v-if="!user" @submit.prevent="login(false)" class="login-form">
      <label>抖音聚合用户名<el-input v-model="name" autocomplete="username" maxlength="32" placeholder="3–32位字母、汉字、数字、下划线或短横线"/></label>
      <label>密码<el-input v-model="password" type="password" autocomplete="current-password" maxlength="128" placeholder="12–128位" show-password/></label>
      <el-button native-type="submit" type="primary" :disabled="busy">登录</el-button>
      <el-button :disabled="busy" @click="login(true)">创建独立账号</el-button>
      <p>新账号拥有独立数据空间。页面刷新或离开本页后需要重新登录。</p>
    </form>
    <template v-else>
      <div class="actions"><strong>{{ user.name }}</strong><el-button :disabled="busy" @click="refresh">刷新</el-button><el-button :disabled="busy" @click="logout">退出登录</el-button></div>
      <el-table :data="nodes" empty-text="尚未绑定登录器">
        <el-table-column prop="name" label="设备"/>
        <el-table-column label="状态"><template #default="{row}">{{ row.online ? '在线' : '离线' }}</template></el-table-column>
        <el-table-column label="最后连接"><template #default="{row}">{{ new Date(row.seen).toLocaleString() }}</template></el-table-column>
        <el-table-column label="操作" min-width="150"><template #default="{row}"><el-popconfirm title="解除该登录器绑定并取消未完成任务？" @confirm="revoke(row.id)"><template #reference><el-button :disabled="busy">解除绑定</el-button></template></el-popconfirm></template></el-table-column>
      </el-table>
      <p>每3秒更新设备在线状态。</p>
    </template>
  </section>
</template>
<style scoped>
.node-panel{background:white;padding:24px;border-radius:12px}.node-panel h2{margin-top:0}.node-panel p{color:#718099;font-size:13px;line-height:1.7}.login-form{max-width:500px}.login-form label{display:block;margin:18px 0}.actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:20px 0}
</style>
