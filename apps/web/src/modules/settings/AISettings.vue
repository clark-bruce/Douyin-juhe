<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { Cpu, MagicStick, Refresh } from '@element-plus/icons-vue';
import { apiRequest } from '../../lib/api.js';

const loading = ref(false), saving = ref(false), error = ref(''), notice = ref('');
const settings = reactive({ enabled: false, systemPrompt: '', knowledgeBase: '', contextMessages: 8, available: false });
async function load() {
  loading.value = true; error.value = '';
  try { Object.assign(settings, (await apiRequest('settings/ai')).ai); }
  catch (cause) { error.value = cause.message; }
  finally { loading.value = false; }
}
async function save() {
  saving.value = true; error.value = ''; notice.value = '';
  try {
    const result = await apiRequest('settings/ai', { method: 'PUT', body: { enabled: settings.enabled, systemPrompt: settings.systemPrompt, knowledgeBase: settings.knowledgeBase, contextMessages: settings.contextMessages } });
    Object.assign(settings, result.ai); notice.value = 'AI 自动回复设置已保存。';
  } catch (cause) { error.value = cause.message; }
  finally { saving.value = false; }
}

// 提示词生成助手：多轮对话历史保存在前端，每次请求整体带上。
const writer = reactive({ open: false, input: '', messages: [], busy: false, error: '' });
const MAX_MESSAGES = 12, MAX_INPUT = 1000;
const lastDraft = () => [...writer.messages].reverse().find(item => item.role === 'assistant')?.content || '';
function openWriter() { writer.open = true; writer.error = ''; }
function resetWriter() { Object.assign(writer, { input: '', messages: [], error: '' }); }
async function sendToWriter() {
  const text = writer.input.trim();
  if (!text || writer.busy) return;
  if (writer.messages.length + 1 > MAX_MESSAGES) { writer.error = '对话轮数已达上限，请点击“重新开始”或直接使用当前提示词。'; return; }
  const history = [...writer.messages, { role: 'user', content: text }];
  writer.busy = true; writer.error = '';
  try {
    const result = await apiRequest('settings/ai/generate-prompt', { method: 'POST', body: { messages: history }, timeoutMs: 70000 });
    writer.messages = [...history, { role: 'assistant', content: result.reply }];
    writer.input = '';
  } catch (cause) { writer.error = cause.message; }
  finally { writer.busy = false; }
}
function useDraft() {
  const draft = lastDraft();
  if (!draft) return;
  settings.systemPrompt = draft.slice(0, 6000);
  writer.open = false;
  notice.value = '提示词已填入输入框，请检查后点击“保存设置”。';
}
async function confirmUse() {
  if (settings.systemPrompt.trim()) {
    try { await ElMessageBox.confirm('当前提示词框里已有内容，使用后将被覆盖。', '覆盖提示词', { confirmButtonText: '覆盖', cancelButtonText: '取消', type: 'warning' }); }
    catch { return; }
  }
  useDraft();
}
onMounted(load);
</script>

<template>
  <section class="ai-settings" aria-label="AI配置">
    <header><div><h1>AI配置</h1><p>设置自动回复的语气、规则和消息记忆</p></div><div class="header-actions"><el-tag :type="settings.available ? 'success' : 'info'" effect="plain">{{ settings.available ? '模型已接入' : 'AI 暂未开通' }}</el-tag><el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button><el-button type="primary" :loading="saving" @click="save">保存设置</el-button></div></header>
    <el-alert v-if="error" :title="error" type="error" show-icon closable @close="error=''"/>
    <el-alert v-if="notice" :title="notice" type="success" show-icon closable @close="notice=''"/>
    <el-alert v-if="settings.enabled" title="AI 自动回复开启后，私聊由 AI 回复，“自动回复”里的私聊规则不会发送；群聊自动回复仍按规则发送，不受影响。如需使用私聊规则，请先关闭此开关。" type="warning" show-icon :closable="false"/>
    <section class="setting-section">
      <div class="section-title"><span><el-icon><Cpu/></el-icon></span><div><h2>自动回复</h2><p>自定义回复方式，并让 AI 记住近期对话内容，回复更连贯。</p></div><el-switch v-model="settings.enabled" :disabled="!settings.available" aria-label="启用 AI 自动回复"/></div>
      <el-form label-position="top">
        <el-form-item label="提示词"><el-input v-model="settings.systemPrompt" type="textarea" :rows="8" maxlength="6000" show-word-limit placeholder="例如：你是一名耐心的客服，回复简洁、友好，先解决用户的问题"/><div class="prompt-tools"><el-button :icon="MagicStick" :disabled="!settings.available" @click="openWriter">AI 帮我写</el-button><small>告诉 AI 你的行业和客服需求，对话几轮即可生成提示词。</small></div></el-form-item>
        <el-form-item label="知识库"><el-input v-model="settings.knowledgeBase" type="textarea" :rows="10" maxlength="20000" show-word-limit placeholder="填写产品信息、服务规则、常见问题和标准答案，AI 会根据这些内容回复"/><small>仅用于当前自动回复，为 AI 提供业务资料。</small></el-form-item>
        <el-form-item label="消息记忆"><el-input-number v-model="settings.contextMessages" :min="0" :max="20"/><small>读取最近的消息，帮助 AI 保持对话连续；设为 0 则不使用历史消息。</small></el-form-item>
      </el-form>
    </section>
    <el-dialog v-model="writer.open" title="AI 帮我写提示词" width="640px" append-to-body>
      <div class="writer-log" aria-live="polite">
        <p v-if="!writer.messages.length" class="writer-empty">例如：我做装修行业，需要一个接待咨询、引导客户留下联系方式的客服。</p>
        <div v-for="(item, index) in writer.messages" :key="index" :class="['writer-msg', item.role]"><b>{{ item.role === 'user' ? '我' : 'AI' }}</b><pre>{{ item.content }}</pre></div>
        <p v-if="writer.busy" class="writer-empty">正在生成，请稍候…</p>
      </div>
      <el-alert v-if="writer.error" :title="writer.error" type="error" show-icon :closable="false"/>
      <el-input v-model="writer.input" type="textarea" :rows="3" :maxlength="1000" show-word-limit :disabled="writer.busy" placeholder="描述你的行业和需求；生成后可以继续说“再简短一点”“加上报价规则”来微调" @keydown.ctrl.enter="sendToWriter"/>
      <template #footer>
        <el-button :disabled="writer.busy || !writer.messages.length" @click="resetWriter">重新开始</el-button>
        <el-button type="primary" plain :loading="writer.busy" :disabled="!writer.input.trim()" @click="sendToWriter">{{ writer.messages.length ? '发送微调' : '生成提示词' }}</el-button>
        <el-button type="success" :disabled="writer.busy || !writer.messages.some(item => item.role === 'assistant')" @click="confirmUse">使用这份提示词</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.ai-settings{display:grid;gap:14px;min-width:0}.ai-settings>header{display:flex;align-items:center;gap:12px}.ai-settings>header>div:first-child{margin-right:auto}.header-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.ai-settings h1{font-size:21px;margin:0}.ai-settings header p,.section-title p{margin:5px 0 0;color:#7d8ba0;font-size:12px}.setting-section{background:#fff;border-radius:8px;padding:20px;min-width:0}.section-title{display:flex;align-items:center;gap:12px;margin-bottom:18px}.section-title>span{width:40px;height:40px;border-radius:8px;background:#eaf2ff;color:#3475de;display:grid;place-items:center}.section-title>div{margin-right:auto}.section-title h2{font-size:16px;margin:0}.setting-section small{display:block;color:#8a97aa;font-size:12px;margin-top:6px}.prompt-tools{display:flex;align-items:center;gap:10px;margin-top:8px;width:100%}.prompt-tools small{margin:0}.writer-log{max-height:340px;overflow:auto;display:grid;gap:10px;margin-bottom:12px}.writer-empty{margin:0;color:#8a97aa;font-size:13px}.writer-msg{background:#f5f7fa;border-radius:8px;padding:10px 12px}.writer-msg.user{background:#eaf2ff}.writer-msg b{font-size:12px;color:#5b6b82}.writer-msg pre{margin:4px 0 0;white-space:pre-wrap;word-break:break-word;font:inherit;font-size:13px;line-height:1.6}@media(max-width:650px){.ai-settings>header{align-items:flex-start;flex-wrap:wrap}.ai-settings>header>div:first-child{width:100%}.header-actions{width:100%}.setting-section{padding:15px}}
</style>
