<script setup>
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import qrcode from '../../lib/qrcode.js';
import CardTutorialDialog from './CardTutorialDialog.vue';

const props = defineProps({ modelValue: Boolean, card: { type: Object, default: null } });
const emit = defineEmits(['update:modelValue']);
const tutorialOpen = ref(false);

// 与统一卡片页的推广逻辑一致：企业微信、公众号文章、QQ 群等直接使用用户配置的 http(s) 链接。
const link = computed(() => {
  const row = props.card;
  if (!row) return '';
  const ext = row.ext || {};
  const type = ext.jumpType || 'qrcode';
  const pick = type === 'wecom' ? ext.wecomUrl : type === 'article' ? (ext.articleUrl || row.link) : type === 'qq' ? ext.qqUrl : type === 'qqgroup' ? ext.qqGroup : '';
  const value = String(pick || '').trim();
  return /^https?:\/\//i.test(value) ? value : '';
});
const src = computed(() => {
  if (!link.value) return '';
  const qr = qrcode(0, 'M'); qr.addData(link.value); qr.make(); return qr.createDataURL(6, 8);
});
async function copyLink() {
  try { await navigator.clipboard.writeText(link.value); ElMessage.success('链接已复制。'); }
  catch { ElMessage.error('复制失败，请手动复制。'); }
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="推广" width="min(720px,96vw)" append-to-body @update:model-value="emit('update:modelValue', $event)">
    <ol class="wz-guide">
      <li><div class="wz-guide-top"><i>1</i><span>使用苹果手机打开抖音 App 扫码</span></div><div class="wz-guide-qr"><img v-if="src" class="qr" :src="src" alt="推广二维码"/></div></li>
      <li><div class="wz-guide-top"><i>2</i><span>点击右上角分享按钮</span></div><img src="/card-assets/steps/step-2.jpg" alt="点击右上角分享按钮"/></li>
      <li><div class="wz-guide-top"><i>3</i><span>分享给好友、群聊</span></div><img src="/card-assets/steps/step-3.jpg" alt="分享给好友、群聊"/></li>
    </ol>
    <p class="wz-warn">注：必须使用<b>苹果手机</b>【<b>抖音极速版30.3.0及以前的版本</b>】扫码分享，安卓手机扫码无效。若分享的卡片未展示封面、标题及描述，请检查抖音版本是否为3.0及以前的版本。<a class="wz-tutorial" href="#" @click.prevent="tutorialOpen = true">（教程）</a></p>
    <template #footer><el-button type="primary" :disabled="!link" @click="copyLink">复制链接</el-button></template>
  </el-dialog>
  <CardTutorialDialog v-model="tutorialOpen"/>
</template>

<style>
.wz-guide{display:flex;gap:16px;list-style:none;padding:0;margin:0 0 16px;justify-content:space-between;align-items:flex-start}
.wz-guide li{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:10px}
.wz-guide-top{display:flex;align-items:center;gap:6px;font-size:13px;color:#303133;white-space:nowrap}
.wz-guide i{flex:none;width:22px;height:22px;border-radius:50%;background:#ffa207;color:#fff;font-style:normal;text-align:center;line-height:22px;font-size:12px}
.wz-guide img{display:block;width:100%;max-width:200px;height:auto;border-radius:6px;border:1px solid #ebeef5}
.wz-guide-qr{box-sizing:border-box;width:100%;max-width:200px;aspect-ratio:800/1018;display:flex;align-items:center;justify-content:center;border:1px solid #ebeef5;border-radius:6px;background:#fff}
.wz-guide img.qr{border:0;width:88%;max-width:none}
.wz-warn{border:1px dashed #ffa207;border-radius:8px;padding:10px 14px;color:#606266;font-size:12px;line-height:1.7;text-align:left}
.wz-warn b{color:#f56c6c;font-weight:600}
.wz-tutorial{color:#409eff;text-decoration:none;margin-left:4px;cursor:pointer}
.wz-tutorial:hover{text-decoration:underline}
</style>
