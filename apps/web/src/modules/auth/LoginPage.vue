<script setup>
import { ref } from 'vue';
const emit = defineEmits(['authenticated']);
const name = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function login() {
  if (!name.value.trim() || !password.value) { error.value = '请输入租户用户名和密码。'; return; }
  loading.value = true; error.value = '';
  try {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.value.trim(), password: password.value }),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '登录失败');
    localStorage.setItem('douyinjuhe.session', JSON.stringify({ token: result.token, user: result.user }));
    password.value = '';
    emit('authenticated', result);
  } catch (cause) { error.value = cause.name === 'TimeoutError' ? '登录请求超时，请稍后重试。' : cause.message; }
  finally { loading.value = false; }
}
</script>

<template>
  <main class="login-page" aria-label="抖音聚合登录">
    <section class="login-panel">
      <div class="login-brand"><img class="brand-logo" src="/logo.svg" alt="" width="36" height="36"><strong>抖音聚合</strong></div>
      <h1>登录抖音聚合工作台</h1>
      <p class="subtitle">使用管理员创建的租户账号登录</p>
      <el-form label-position="top" @submit.prevent="login">
        <el-form-item label="租户用户名"><el-input v-model="name" maxlength="32" autocomplete="username" placeholder="请输入租户用户名"/></el-form-item>
        <el-form-item label="密码"><el-input v-model="password" type="password" show-password maxlength="128" autocomplete="current-password" placeholder="请输入密码" @keyup.enter="login"/></el-form-item>
        <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon/>
        <el-button class="login-button" type="primary" :loading="loading" native-type="submit">登录</el-button>
      </el-form>
      <p class="hint">没有租户账号？请联系管理员创建。</p>
    </section>
  </main>
</template>

<style scoped>
.login-page{min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--hz-bg)}.login-panel{width:min(420px,100%);padding:34px 36px 29px;background:#fff;border:1px solid var(--hz-line);border-radius:8px;box-shadow:0 14px 38px rgba(36,35,33,.08)}.login-brand{display:flex;align-items:center;justify-content:flex-start;gap:9px;font-size:21px;color:var(--hz-text);margin-bottom:27px}.login-brand .brand-logo{width:36px;height:36px}.brand-mark{display:grid;place-items:center;width:36px;height:36px;border:1px solid #9bbcbc;border-radius:7px;color:var(--hz-primary);background:var(--hz-primary-soft);font-size:21px}.login-panel h1{text-align:left;font-size:20px;margin:0}.subtitle{text-align:left;color:var(--hz-muted);font-size:12px;margin:8px 0 24px}.login-button{width:100%;margin-top:16px}.hint{text-align:left;color:#96928b;font-size:11px;margin:18px 0 0;padding-top:14px;border-top:1px solid #efede9}@media(max-width:480px){.login-page{padding:14px}.login-panel{padding:26px 22px 22px}}
</style>
