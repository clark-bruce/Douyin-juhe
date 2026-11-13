<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { Bell, Headset, Message, Refresh } from '@element-plus/icons-vue';
import { apiRequest } from '../../lib/api.js';

const notice = ref('');
const error = ref('');
const loading = ref(false);
const saving = ref(false);
const permission = ref(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
const settings = reactive({ popup: true, browser: false, sound: false });
const permissionLabel = computed(() => ({ granted: '已授权', denied: '已阻止，请在浏览器站点设置中允许', default: '尚未授权', unsupported: '当前环境不支持浏览器通知' })[permission.value] || '尚未授权');

async function load() {
  loading.value = true; error.value = '';
  try {
    const result = await apiRequest('settings/notifications');
    Object.assign(settings, result.notifications);
    if (typeof Notification !== 'undefined') permission.value = Notification.permission;
  } catch (cause) { error.value = cause.message; }
  finally { loading.value = false; }
}
async function save() {
  saving.value = true; error.value = ''; notice.value = '';
  try {
    const result = await apiRequest('settings/notifications', { method: 'PUT', body: { ...settings } });
    Object.assign(settings, result.notifications);
    window.dispatchEvent(new CustomEvent('douyinjuhe-notification-settings', { detail: result.notifications }));
    notice.value = '通知偏好已保存到租户账号。';
  } catch (cause) { error.value = cause.message; }
  finally { saving.value = false; }
}
async function authorize() {
  if (typeof Notification === 'undefined') { permission.value = 'unsupported'; return; }
  permission.value = await Notification.requestPermission();
  if (permission.value === 'granted') { settings.browser = true; notice.value = '浏览器通知已授权，记得保存设置。'; }
  else { settings.browser = false; error.value = permission.value === 'denied' ? '浏览器已阻止通知，请在站点权限中手动允许。' : '尚未授予浏览器通知权限。'; }
}
function playTone() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) { error.value = '当前浏览器不支持提示音。'; return; }
  const context = new AudioContextClass(), oscillator = context.createOscillator(), gain = context.createGain();
  oscillator.type = 'sine'; oscillator.frequency.value = 740; gain.gain.setValueAtTime(0.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
  oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.24); oscillator.onended = () => context.close();
}
function testSound() { error.value = ''; playTone(); }
function testNotification() {
  if (typeof Notification === 'undefined') { permission.value = 'unsupported'; error.value = '当前环境不支持浏览器通知。'; return; }
  permission.value = Notification.permission;
  if (permission.value !== 'granted') { error.value = '请先允许浏览器通知。'; return; }
  new Notification('抖音聚合通知测试', { body: '浏览器通知已正常工作。' });
}
onMounted(load);
</script>

<template>
  <section class="system-page" aria-label="系统设置">
    <header><div><h1>系统设置</h1><p>配置租户账号的聚合消息提醒。</p></div><el-button type="primary" :icon="Refresh" :loading="loading" @click="load">刷新</el-button><el-button type="primary" :loading="saving" @click="save">保存设置</el-button></header>
    <el-alert v-if="error" :title="error" type="error" show-icon closable @close="error=''"/>
    <el-alert v-if="notice" :title="notice" type="success" show-icon closable @close="notice=''"/>
    <div class="settings-grid">
      <section class="setting-section">
        <div class="section-title"><span><el-icon><Message/></el-icon></span><div><h2>聚合私信提醒</h2><p>收到新入站消息时显示提醒。</p></div></div>
        <div class="setting-row"><div><strong>页面消息浮层</strong><small>在网页右上角显示消息提醒，点击可跳转到聚合聊天。</small></div><el-switch v-model="settings.popup" aria-label="页面消息浮层"/></div>
        <div class="setting-row"><div><strong>浏览器通知</strong><small>允许系统桌面通知；权限需要在当前浏览器单独授权。</small></div><el-switch v-model="settings.browser" :disabled="permission !== 'granted'" aria-label="浏览器通知"/></div>
        <div class="permission-row"><span>浏览器权限：{{ permissionLabel }}</span><el-button v-if="permission !== 'granted'" :disabled="permission === 'unsupported'" @click="authorize">允许通知</el-button><el-button v-else @click="testNotification">测试通知</el-button></div>
      </section>
      <section class="setting-section">
        <div class="section-title"><span><el-icon><Headset/></el-icon></span><div><h2>通知提示音</h2><p>收到新入站消息时播放本机提示音。</p></div></div>
        <div class="setting-row"><div><strong>提示音</strong><small>提示音仅在当前浏览器页面运行时播放。</small></div><el-switch v-model="settings.sound" aria-label="通知提示音"/></div>
        <div class="sound-row"><el-button @click="testSound">试听提示音</el-button></div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.system-page{display:grid;gap:14px;min-width:0}.system-page>header{display:flex;align-items:center;gap:10px}.system-page>header>div{margin-right:auto}.system-page h1{font-size:21px;margin:0}.system-page header p,.section-title p{margin:5px 0 0;color:#7d8ba0;font-size:12px}.settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.setting-section{background:#fff;border-radius:12px;padding:20px;min-width:0}.section-title{display:flex;align-items:center;gap:12px;margin-bottom:16px}.section-title>span{width:40px;height:40px;border-radius:8px;background:#eaf2ff;color:#3475de;display:grid;place-items:center}.section-title h2{font-size:16px;margin:0}.setting-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 0;border-top:1px solid #edf0f5}.setting-row strong,.setting-row small{display:block}.setting-row small{color:#8a97aa;font-size:12px;margin-top:5px}.permission-row,.sound-row{display:flex;align-items:center;justify-content:space-between;margin-top:12px;color:#74839a;font-size:12px}.sound-row{justify-content:flex-start}@media(max-width:850px){.settings-grid{grid-template-columns:1fr}}@media(max-width:650px){.system-page>header{align-items:flex-start;flex-wrap:wrap}.system-page>header>div{width:100%}.setting-section{padding:15px}}
</style>
