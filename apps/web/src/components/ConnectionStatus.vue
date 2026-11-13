<script setup>
import { ref, onMounted } from 'vue';
import { checkConnection } from '@douyinjuhe/api-client';
const status = ref('尚未检测服务');
const busy = ref(false);
const instanceId = ref('');
async function check() {
  busy.value = true;
  instanceId.value = '';
  try { const health = await checkConnection(); instanceId.value = health.instanceId; status.value = '服务已连接'; }
  catch { status.value = '服务未连接'; }
  finally { busy.value = false; }
}
onMounted(check);
</script>
<template><span><button class="connection-status" :disabled="busy" @click="check" title="重新检测服务连接">{{ busy ? '正在连接服务…' : status }}</button><details v-if="instanceId" class="connection-details"><summary>连接详情</summary><span>服务实例：{{ instanceId }}</span></details></span></template>
<style scoped>.connection-status{border:0;background:none;color:#8796ab;font-size:11px;padding:0;margin-top:4px;text-align:left}.connection-details{font-size:10px;color:#8796ab;position:relative}.connection-details summary{cursor:pointer}.connection-details[open]>span{position:absolute;top:18px;left:0;z-index:40;background:white;padding:12px;box-shadow:0 4px 15px #27355020;white-space:nowrap;border-radius:6px}</style>
