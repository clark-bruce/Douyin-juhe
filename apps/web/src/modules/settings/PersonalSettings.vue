<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { apiRequest } from '../../lib/api.js';
const tab = ref('profile');
const notice = ref('');
const session = (() => { try { return JSON.parse(localStorage.getItem('douyinjuhe.session') || 'null'); } catch { return null; } })();
const loginName = session?.user?.name || '--';
const form = reactive({ nickname: session?.user?.name || '', bio: '', email: '', language: 'zh-CN', birthday: '', gender: 'unknown', avatar: '' });
const password = reactive({ old: '', value: '', confirm: '' });
const passwordBusy = ref(false);
const completion = computed(() => 25 + [form.nickname, form.bio, form.email, form.avatar].filter(Boolean).length * 12.5);
const profileBusy = ref(false), profileLoading = ref(false);
const profileFields = ['nickname', 'bio', 'email', 'language', 'birthday', 'gender', 'avatar'];
const avatarInput = ref(null);
// 选图后在浏览器端居中裁成 256×256 的 JPEG，再随资料一起保存，避免上传大图。
function pickAvatar() { avatarInput.value?.click(); }
function removeAvatar() { form.avatar = ''; }
async function onAvatarChosen(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) { notice.value = '头像仅支持 JPG、PNG、WEBP、GIF 图片。'; return; }
  if (file.size > 8 * 1024 * 1024) { notice.value = '头像图片不能超过 8MB。'; return; }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('图片无法读取')); img.src = url; });
    const size = Math.min(image.naturalWidth, image.naturalHeight), canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, 256, 256);
    context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, 256, 256);
    form.avatar = canvas.toDataURL('image/jpeg', 0.85);
    notice.value = '头像已选择，点击“保存资料”后生效。';
  } catch (cause) { notice.value = cause.message; }
  finally { URL.revokeObjectURL(url); }
}
async function loadProfile() {
  profileLoading.value = true;
  try {
    const data = await apiRequest('auth/profile');
    for (const key of profileFields) if (data[key] !== undefined && data[key] !== null) form[key] = data[key];
  } catch (cause) { notice.value = cause.message; }
  finally { profileLoading.value = false; }
}
async function saveProfile() {
  profileBusy.value = true;
  try {
    const body = Object.fromEntries(profileFields.map(key => [key, form[key] ?? '']));
    const saved = await apiRequest('auth/profile', { method: 'PUT', body });
    for (const key of profileFields) if (saved[key] !== undefined) form[key] = saved[key];
    notice.value = '个人资料已保存。';
    window.dispatchEvent(new Event('douyinjuhe-profile'));
  } catch (cause) { notice.value = cause.message; }
  finally { profileBusy.value = false; }
}
onMounted(loadProfile);
async function savePassword() {
  if (!password.old) { notice.value = '请输入当前密码。'; return; }
  if (!password.value || password.value !== password.confirm) { notice.value = '请填写一致的新密码和确认密码。'; return; }
  passwordBusy.value = true;
  try {
    await apiRequest('auth/password', { method: 'POST', body: { oldPassword: password.old, newPassword: password.value } });
    password.old = ''; password.value = ''; password.confirm = '';
    notice.value = '密码已修改，其他设备需要重新登录。';
  } catch (cause) { notice.value = cause.message; }
  finally { passwordBusy.value = false; }
}
async function logout() {
  const current = (() => { try { return JSON.parse(localStorage.getItem('douyinjuhe.session') || 'null'); } catch { return null; } })();
  try {
    if (current?.token) await fetch('/api/v1/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${current.token}` }, body: '{}' });
  } finally {
    localStorage.removeItem('douyinjuhe.session');
    window.dispatchEvent(new Event('douyinjuhe-session'));
  }
}
</script>

<template>
  <section class="settings-page" aria-label="个人设置">
    <div class="settings-title"><div><h1>个人设置</h1><p>维护你的公开资料、登录安全和基础偏好设置。</p></div><el-tag size="small" type="warning">{{ password.value?'待保存密码':'密码已设置' }}</el-tag></div>
    <el-alert v-if="notice" :title="notice" type="info" show-icon @close="notice=''"/>
    <div class="settings-layout">
      <aside class="profile-summary"><button type="button" class="portrait" aria-label="更换头像" @click="pickAvatar"><img v-if="form.avatar" :src="form.avatar" alt="头像"><span v-else>{{ (form.nickname || '合').slice(0,1) }}</span><em>更换</em></button><input ref="avatarInput" class="avatar-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" @change="onAvatarChosen"><el-button v-if="form.avatar" link size="small" @click="removeAvatar">移除头像</el-button><strong>{{ form.nickname || '未设置昵称' }}</strong><el-progress :percentage="completion" :show-text="false"/><small>资料完整度 {{ completion }}%</small><dl><div><dt>手机号</dt><dd>--</dd></div><div><dt>邮箱</dt><dd>{{ form.email || '未设置' }}</dd></div><div><dt>语言</dt><dd>简体中文</dd></div><div><dt>安全状态</dt><dd class="safe">待设置</dd></div></dl><section><b>个人简介</b><p>{{ form.bio || '还没有填写简介。' }}</p></section></aside>
      <div class="settings-content"><div class="tabs"><button :class="{active:tab==='profile'}" @click="tab='profile'">基础资料</button><button :class="{active:tab==='security'}" @click="tab='security'">账号安全</button></div>
        <section class="settings-panel" v-if="tab==='profile'"><h3>公开信息</h3><el-form label-position="top"><div class="grid"><el-form-item label="昵称"><el-input v-model="form.nickname"/></el-form-item><el-form-item label="登录 ID"><el-input :model-value="loginName" disabled/></el-form-item></div><el-form-item label="简介"><el-input v-model="form.bio" type="textarea" maxlength="255" show-word-limit placeholder="介绍一下你自己"/></el-form-item><h3>地区与偏好</h3><div class="grid"><el-form-item label="邮箱"><el-input v-model="form.email" placeholder="请输入邮箱地址"/></el-form-item><el-form-item label="语言"><el-select v-model="form.language"><el-option label="简体中文" value="zh-CN"/></el-select></el-form-item><el-form-item label="生日"><el-date-picker v-model="form.birthday" type="date" placeholder="请选择生日" value-format="YYYY-MM-DD"/></el-form-item><el-form-item label="性别"><el-select v-model="form.gender"><el-option label="未知" value="unknown"/><el-option label="男" value="male"/><el-option label="女" value="female"/></el-select></el-form-item></div><div class="save-row"><el-button type="primary" :loading="profileBusy" :disabled="profileLoading" @click="saveProfile">保存资料</el-button></div></el-form></section>
        <section class="settings-panel security" v-else><h3>登录与凭证保护</h3><p>修改密码需要校验当前密码，新密码需 6–128 位。</p><el-form label-position="top"><el-form-item label="手机号"><el-input model-value="未绑定手机号" disabled/></el-form-item><el-form-item label="当前密码"><el-input v-model="password.old" type="password" show-password autocomplete="current-password"/></el-form-item><div class="grid"><el-form-item label="新密码"><el-input v-model="password.value" type="password" show-password autocomplete="new-password"/></el-form-item><el-form-item label="确认密码"><el-input v-model="password.confirm" type="password" show-password autocomplete="new-password"/></el-form-item></div><div class="save-row"><el-button type="primary" :loading="passwordBusy" @click="savePassword">设置密码</el-button></div></el-form><div class="logout-row"><div><strong>退出当前租户</strong><small>退出后需要重新输入租户账号和密码，登录器连接不会被删除。</small></div><el-button type="danger" plain @click="logout">退出登录</el-button></div></section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings-page{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;min-width:0}.settings-title{display:flex;align-items:center;justify-content:space-between}.settings-title h1{margin:0;font-size:22px}.settings-title p{margin:4px 0 0;color:#73839b;font-size:12px}.settings-layout{display:grid;grid-template-columns:260px minmax(0,1fr);gap:14px;min-width:0}.profile-summary,.settings-panel,.tabs{background:#fff;border-radius:16px;box-shadow:0 4px 12px #35497905;min-width:0}.profile-summary{padding:20px 16px;text-align:center;min-height:710px}.portrait{position:relative;width:82px;height:82px;border-radius:50%;margin:0 auto 14px;background:#c3c9d3;color:#fff;display:grid;place-items:center;font-size:30px;border:0;padding:0;overflow:hidden;cursor:pointer}.portrait img{width:100%;height:100%;object-fit:cover}.portrait em{position:absolute;left:0;right:0;bottom:0;height:24px;line-height:24px;font-size:12px;font-style:normal;background:#0009;opacity:0;transition:opacity .15s}.portrait:hover em,.portrait:focus-visible em{opacity:1}.avatar-file{display:none}.profile-summary>strong{display:block;font-size:17px;margin-bottom:7px}.profile-summary>small{display:block;margin:4px 0 14px;color:#62738a}.profile-summary dl{margin:0;display:grid;gap:6px}.profile-summary dl>div{display:flex;justify-content:space-between;padding:9px 10px;border:1px solid #edf0f4;border-radius:9px;font-size:12px}.profile-summary dt{color:#687991}.profile-summary dd{margin:0;font-weight:600}.profile-summary .safe{color:#23a55a}.profile-summary section{text-align:left;border:1px solid #edf0f4;border-radius:9px;padding:10px;margin-top:8px;font-size:12px}.profile-summary section p{margin:5px 0 0;color:#687991}.settings-content{min-width:0}.tabs{display:grid;grid-template-columns:1fr 1fr;background:#e2e8f1;padding:4px;margin-bottom:14px}.tabs button{height:38px;border:0;background:transparent;color:#66778f;border-radius:9px;font-weight:600}.tabs button.active{background:#fff;color:#245cea;box-shadow:0 3px 8px #35497912}.settings-panel{padding:20px}.settings-panel h3{font-size:14px;margin:0 0 12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px;min-width:0}.el-select,.el-date-editor{width:100%}.save-row{display:flex;justify-content:flex-end}.security>p{font-size:13px;color:#718198;margin-bottom:20px}@media(max-width:850px){.settings-layout{grid-template-columns:minmax(0,1fr)}.profile-summary{min-height:auto}.profile-summary dl{grid-template-columns:1fr 1fr}}@media(max-width:650px){.grid,.profile-summary dl{grid-template-columns:minmax(0,1fr)}.settings-title{align-items:flex-start;gap:10px}}
.logout-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:28px;padding-top:20px;border-top:1px solid #edf0f4}.logout-row strong,.logout-row small{display:block}.logout-row small{margin-top:5px;color:#718198;font-size:12px}@media(max-width:650px){.logout-row{align-items:flex-start;flex-direction:column}.logout-row .el-button{align-self:flex-end}}
</style>
