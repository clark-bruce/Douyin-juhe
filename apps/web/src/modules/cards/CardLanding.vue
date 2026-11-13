<script setup>
import { onMounted, ref } from 'vue';

const props = defineProps({ id: { type: String, required: true } });
const state = ref('loading'), card = ref(null), error = ref(''), copied = ref(false);

const safeUrl = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol) ? value : ''; } catch { return ''; } };
const qqHref = value => /^\d{5,12}$/.test(value) ? `https://wpa.qq.com/msgrd?v=3&uin=${value}&site=qq&menu=yes` : safeUrl(value);

async function load() {
  try {
    const response = await fetch(`/api/v1/public/cards/${encodeURIComponent(props.id)}`, { signal: AbortSignal.timeout(10000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { error.value = data.error || '链接已失效'; state.value = 'error'; return; }
    card.value = data; document.title = data.title || '抖音聚合'; state.value = 'ready';
    const url = data.jumpType === 'wecom' || data.jumpType === 'article' ? safeUrl(data.url) : '';
    if (url) window.location.replace(url);
  } catch { error.value = '网络异常，请稍后重试'; state.value = 'error'; }
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); copied.value = true; setTimeout(() => { copied.value = false; }, 1800); } catch { /* 手动复制 */ }
}
onMounted(load);
</script>

<template>
  <main class="landing">
    <p v-if="state==='loading'" class="msg">加载中…</p>
    <p v-else-if="state==='error'" class="msg">{{ error }}</p>
    <section v-else class="box">
      <h1>{{ card.pageName || card.title }}</h1>
      <template v-if="card.jumpType==='qrcode'">
        <img :src="card.qrImage" alt="二维码"/>
        <p class="tip">{{ card.pageTip }}</p>
      </template>
      <template v-else-if="card.jumpType==='wecom' || card.jumpType==='article'">
        <p class="tip">正在跳转…</p>
        <a v-if="safeUrl(card.url)" :href="safeUrl(card.url)">没有自动跳转？点此打开</a>
        <p v-else class="tip">跳转链接无效</p>
      </template>
      <template v-else-if="card.jumpType==='qq'">
        <p class="value">{{ card.value }}</p>
        <a v-if="qqHref(card.value)" :href="qqHref(card.value)">打开 QQ 会话</a>
        <button type="button" @click="copy(card.value)">{{ copied ? '已复制' : '复制 QQ' }}</button>
      </template>
      <template v-else>
        <p class="value">{{ card.value }}</p>
        <button type="button" @click="copy(card.value)">{{ copied ? '已复制' : '复制群号' }}</button>
        <p class="tip">复制后在 QQ 中搜索加入</p>
      </template>
    </section>
  </main>
</template>

<style scoped>
.landing{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f6f8;font-family:system-ui,-apple-system,'Microsoft YaHei',sans-serif;padding:16px;box-sizing:border-box}
.msg{color:#909399;font-size:15px}
.box{width:100%;max-width:360px;background:#fff;border-radius:12px;padding:22px 20px;text-align:center;box-shadow:0 2px 12px #0001}
h1{margin:0 0 12px;font-size:16px;text-align:left;color:#303133}
img{width:100%;display:block;margin:8px 0}
.tip{margin:8px 0 0;color:#909399;font-size:13px}
.value{font-size:22px;font-weight:600;margin:14px 0;color:#303133;word-break:break-all}
a,button{display:block;width:100%;box-sizing:border-box;margin-top:10px;padding:10px;border:0;border-radius:20px;background:#ffa207;color:#fff;font-size:14px;text-decoration:none;cursor:pointer}
</style>
