<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import { apiRequest } from '../../lib/api.js';
import { COVER_PRESETS, decodeHidden, encodeHidden, inspectHidden } from '../../lib/text-cipher.js';
const kinds = [
  { id: 'quick_reply', title: '快捷话术', column: '话术内容' },
  { id: 'encrypted_text', title: '加密文本', column: '文本内容' }
];
const active = ref('quick_reply'), search = ref(''), page = ref(1), size = ref(10);
const drafts = ref([]), open = ref(false), preview = ref(null), error = ref(''), notice = ref(''), loading = ref(false), saving = ref(false);
const blankForm = () => ({ id: '', text: '', cover: '', secret: '', mode: 'scatter', position: 'end', index: 0 });
const form = reactive(blankForm());
const decodeInput = ref(''), decodeResult = ref(''), decodeError = ref(''), copied = ref('');
const kind = computed(() => kinds.find(item => item.id === active.value));
function content(row) {
  if (row.kind === 'encrypted_text') { const info = inspectHidden(row.text); return info.hiddenBits ? `${info.visible}（已隐藏 ${info.hiddenBits} 位）` : info.visible; }
  return row.text;
}
const cipherPreview = computed(() => {
  if (active.value !== 'encrypted_text' || !form.secret.trim()) return '';
  try { return encodeHidden(form.cover, form.secret, form); } catch { return ''; }
});
const filtered = computed(() => drafts.value.filter(row => row.kind === active.value && content(row).toLowerCase().includes(search.value.trim().toLowerCase())));
const rows = computed(() => filtered.value.slice((page.value - 1) * size.value, page.value * size.value));
watch([active, search, size], () => { page.value = 1; notice.value = ''; });
function edit(row) {
  Object.assign(form, blankForm(), row || {});
  if (row?.kind === 'encrypted_text') { const info = inspectHidden(row.text); Object.assign(form, { cover: info.visible, secret: info.secret }); }
  error.value = ''; open.value = true;
}
function decodeNow() {
  decodeError.value = ''; decodeResult.value = '';
  if (!decodeInput.value) return;
  try { decodeResult.value = decodeHidden(decodeInput.value); } catch (cause) { decodeError.value = cause.message; }
}
async function copyText(value, key) {
  try { await navigator.clipboard.writeText(value); copied.value = key; setTimeout(() => { if (copied.value === key) copied.value = ''; }, 1500); }
  catch { notice.value = '复制失败，请手动选中内容复制。'; }
}
async function load() {
  loading.value = true; notice.value = '';
  try { drafts.value = (await apiRequest('components')).map(row => ({ ...row.payload, id: row.id, kind: row.type, updated: new Date(row.updated).toLocaleString() })); }
  catch (cause) { notice.value = cause.message; drafts.value = []; }
  finally { loading.value = false; }
}
async function saveDraft() {
  const encrypted = active.value === 'encrypted_text';
  const required = encrypted ? ['cover', 'secret'] : ['text'];
  if (required.some(key => !form[key].trim())) { error.value = '请填写必填内容。'; return; }  if (encrypted && !cipherPreview.value) { error.value = '加密失败，请检查秘密消息。'; return; }
  if (encrypted && cipherPreview.value.length > 5000) { error.value = `生成结果 ${cipherPreview.value.length} 字符，超过 5000 上限。每个字节占 8 个字符（一个汉字约 24 个），请缩短秘密消息或载体。`; return; }
  const text = encrypted ? cipherPreview.value : form.text;
  const payload = { text };
  const name = encrypted ? (form.cover.trim() || '加密文本').slice(0, 100) : form.text.slice(0, 100);
  saving.value = true; error.value = '';
  try {
    await apiRequest(form.id ? `components/${form.id}` : 'components', { method: form.id ? 'PATCH' : 'POST', body: { type: active.value, name, payload } });
    const message = form.id ? '组件已更新。' : '组件已创建。'; open.value = false; await load(); notice.value = message;
  } catch (cause) { error.value = cause.message; }
  finally { saving.value = false; }
}
async function remove(id) {
  try { await apiRequest(`components/${id}`, { method: 'DELETE' }); notice.value = '组件已删除。'; await load(); }
  catch (cause) { notice.value = cause.message; }
}
onMounted(() => { window.addEventListener('douyinjuhe-session', load); load(); });
onUnmounted(() => window.removeEventListener('douyinjuhe-session', load));
</script>

<template>
  <section class="component-manager" aria-label="组件管理">
    <div class="component-toolbar">
      <el-input v-model="search" :prefix-icon="Search" :placeholder="`搜索${kind.title}`" :aria-label="`搜索${kind.title}`" clearable/>
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      <el-button type="primary" :icon="Plus" @click="edit()">新增{{ kind.title }}</el-button>
    </div>
    <div class="component-panel">
      <el-tabs v-model="active">
        <el-tab-pane v-for="item in kinds" :key="item.id" :name="item.id">
          <template #label><span class="tab-label">{{ item.title }}<small v-if="item.suffix" class="tab-suffix">{{ item.suffix }}</small><span class="count">{{ drafts.filter(row => row.kind === item.id).length }}</span></span></template>
        </el-tab-pane>
      </el-tabs>
      <el-alert v-if="notice" :title="notice" type="info" show-icon @close="notice=''"/>
      <div v-if="active==='encrypted_text'" class="decode-box">
        <el-input v-model="decodeInput" type="textarea" :rows="2" placeholder="粘贴收到的文本，解出隐藏的秘密消息" @input="decodeNow"/>
        <div v-if="decodeError" class="decode-error">{{ decodeError }}</div>
        <div v-else-if="decodeResult" class="decode-result">{{ decodeResult }}</div>
      </div>
      <el-table v-loading="loading" :data="rows" :empty-text="`暂无${kind.title}`" class="component-table">
        <el-table-column :label="kind.column" min-width="300"><template #default="{ row }"><span class="content-text">{{ content(row) }}</span></template></el-table-column>
        <el-table-column prop="updated" label="更新时间" width="180"/>
        <el-table-column label="操作" width="180"><template #default="{ row }">
          <el-button link type="primary" @click="preview=row">预览</el-button>
          <el-button link type="primary" @click="edit(row)">编辑</el-button>
          <el-popconfirm title="确定删除这条组件？" @confirm="remove(row.id)"><template #reference><el-button link type="danger">删除</el-button></template></el-popconfirm>
        </template></el-table-column>
      </el-table>
      <el-pagination v-if="filtered.length" v-model:current-page="page" v-model:page-size="size" :page-sizes="[10,20,50]" :total="filtered.length" layout="total, sizes, prev, pager, next"/>
    </div>
    <el-dialog v-model="open" :title="`${form.id?'编辑':'新增'}${kind.title}`" width="min(620px, 94vw)" destroy-on-close>
      <el-form label-position="top" @submit.prevent="saveDraft">
        <template v-if="active==='encrypted_text'">
          <el-form-item label="发送内容（别人直接看到的文字）" required>
            <el-input v-model="form.cover" type="textarea" :rows="3" maxlength="1000" show-word-limit placeholder="例如：今天天气不错，我们一起学习。"/>
          </el-form-item>
          <el-form-item label="秘密消息（表情，以零宽字符嵌入发送内容，建议不超过 500 字节）" required>
            <el-input v-model="form.secret" type="textarea" :rows="2" maxlength="500" show-word-limit placeholder="选择下方表情，或自行输入"/>
            <div class="cover-presets">
              <button type="button" @click="form.secret=COVER_PRESETS[Math.floor(Math.random()*COVER_PRESETS.length)]">随机</button>
              <button v-for="item in COVER_PRESETS" :key="item" type="button" @click="form.secret=item">{{ item }}</button>
            </div>
          </el-form-item>
          <el-form-item label="嵌入方式">
            <el-radio-group v-model="form.mode"><el-radio-button value="scatter">分散</el-radio-button><el-radio-button value="concentrated">集中</el-radio-button></el-radio-group>
            <el-radio-group v-if="form.mode==='concentrated'" v-model="form.position" class="position-group"><el-radio-button value="start">开头</el-radio-button><el-radio-button value="middle">中间</el-radio-button><el-radio-button value="end">末尾</el-radio-button></el-radio-group>
            <el-input-number v-if="form.mode==='concentrated' && form.position==='middle'" v-model="form.index" :min="0" :max="1000" controls-position="right" class="position-group"/>
          </el-form-item>
          <el-form-item label="生成结果（含不可见字符，保存的就是这段）">
            <div class="cipher-output">{{ cipherPreview || '—' }}</div>
            <el-button size="small" :disabled="!cipherPreview" @click="copyText(cipherPreview, 'result')">{{ copied==='result' ? '已复制' : '复制结果' }}</el-button>
            <span v-if="cipherPreview" class="draft-note" :style="cipherPreview.length > 500 ? 'color:#d97706' : ''">长度 {{ cipherPreview.length }} 字符{{ cipherPreview.length > 500 ? '，建议不高于 500 字符，过长可能被平台截断或过滤' : '' }}</span>
          </el-form-item>
        </template>
        <el-form-item v-else :label="kind.column" required><el-input v-model="form.text" type="textarea" :rows="7" maxlength="5000" show-word-limit :placeholder="`请输入${kind.column}`"/></el-form-item>
      </el-form>      <el-alert v-if="error" :title="error" type="error" :closable="false"/>
      <template #footer><el-button @click="open=false">取消</el-button><el-button type="primary" :loading="saving" @click="saveDraft">{{ form.id?'更新':'添加' }}组件</el-button></template>
    </el-dialog>
    <el-dialog :model-value="!!preview" title="内容预览" width="min(520px, 94vw)" @close="preview=null">
      <div v-if="preview" class="preview-card"><p>{{ preview.text }}</p></div>
      <template #footer><el-button @click="preview=null">关闭</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.component-toolbar{display:flex;justify-content:flex-end;gap:10px;margin-bottom:22px;flex-wrap:wrap}.component-toolbar .el-input{width:280px}.component-panel{background:#fff;border-radius:20px;padding:20px;min-height:calc(100vh - 235px);display:flex;flex-direction:column}.tab-label{display:flex;align-items:center;gap:9px;font-weight:600}.count{background:#f0f3f9;color:#7888a3;border-radius:12px;padding:2px 11px;font-size:12px}.is-active .count{background:#eaf0ff;color:#3479ff}.draft-note{font-size:12px;color:#8391a5;margin:12px 0}.component-table{flex:1;min-height:400px}.component-table :deep(.el-table__empty-block){min-height:350px}.content-text{white-space:pre-wrap;overflow-wrap:anywhere}.el-pagination{justify-content:flex-end;margin-top:20px}.el-form{margin-top:20px}.preview-card{background:#f2f6fc;padding:20px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere}.preview-card p{line-height:1.8}.component-panel :deep(.el-tabs__item){padding:0 22px}.component-panel :deep(.el-tabs__nav-wrap::after){height:1px}.cover-presets{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;max-height:96px;overflow:auto}.cover-presets button{border:1px solid #dcdfe6;background:#fff;border-radius:8px;padding:2px 8px;cursor:pointer;font-size:14px}.cover-presets button:hover{background:#f2f6fc;border-color:#9bbcbc}.position-group{margin-left:12px}.cipher-output{width:100%;min-height:44px;margin-bottom:8px;padding:8px 12px;background:#f2f6fc;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere}.decode-box{margin:14px 0;display:flex;flex-direction:column;gap:8px}.decode-result{padding:10px 12px;background:#eef8f2;border-radius:8px;color:#0f3b2c;white-space:pre-wrap;overflow-wrap:anywhere}.decode-error{color:#b91c1c;font-size:13px}@media(max-width:650px){.component-toolbar{justify-content:flex-start}.component-toolbar .el-input{width:100%}.component-panel{padding:12px}.component-panel :deep(.el-tabs__item){padding:0 12px}}
.tab-suffix{margin-left:4px;font-size:12px;color:#909399}
</style>
