<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { apiRequest } from '../../lib/api.js';
import qrcode from '../../lib/qrcode.js';
import CardTutorialDialog from './CardTutorialDialog.vue';
const tutorialOpen = ref(false);

const jumpTypes = [['qrcode', '跳转二维码（暂未推出）'],['wecom', '跳转企业微信'], ['qq', '跳转QQ（暂未接入）'], ['qqgroup', '跳转QQ群'], ['article', '跳转公众号文章']];
const tabs = [['all', '全部'], ['qrcode', '二维码（暂未推出）'], ['wecom', '企业微信'], ['qq', 'QQ（暂未接入）'], ['qqgroup', 'QQ群'], ['article', '公众号文章']];
const covers = Array.from({ length: 28 }, (_, i) => `/card-assets/covers/${String(i + 1).padStart(2, '0')}.png`);
// 与外站展现页面背景一致：h1.png、1~10.jpg、bg1~bg12.jpg（共 23 张）
const posters = ['/card-assets/tg/h1.png', ...Array.from({ length: 10 }, (_, i) => `/card-assets/tg/${i + 1}.jpg`), ...Array.from({ length: 12 }, (_, i) => `/card-assets/tg/bg${i + 1}.jpg`)];
const MAX_QR = 5;

const rows = ref([]), loading = ref(false), notice = ref(''), saving = ref(false);
const tab = ref('all'), filters = reactive({ id: '', title: '', note: '' }), selected = ref([]);
const view = ref('list'), step = ref(1), moreCovers = ref(false), previewMode = ref('display');
const promote = reactive({ open: false, row: null, src: '' });
const cardStyleDialog = ref(false), qrEdit = reactive({ open: false, index: -1, image: '', name: '', weight: 100, limit: 99999, auto: 'off', range: [], note: '' });
const blank = () => ({
  id: '', shareType: 'card', cover: covers[0], title: '', description: '', note: '',
  jumpType: 'wecom', qrs: [], qrSwitch: 'loop', qrLimit: 'total', wecomUrl: '', qqUrl: '', qqGroup: '', articleUrl: '',
  pageName: '传奇小助理', pageTip: '', enabled: true, expireAt: 0,
  titleToggle: true, avatar: '', poster: posters[0], qrToggle: true, qrTip: '长按识别上方二维码，加我为好友。'
});
const form = reactive(blank());

const typeOf = row => row.ext?.jumpType || 'qrcode';
const visible = computed(() => rows.value.filter(row => {
  if (tab.value !== 'all' && typeOf(row) !== tab.value) return false;
  if (filters.id && !row.id.includes(filters.id.trim())) return false;
  if (filters.title && !(row.title || '').includes(filters.title.trim())) return false;
  if (filters.note && !(row.note || '').includes(filters.note.trim())) return false;
  return true;
}));
const allSelected = computed({
  get: () => visible.value.length > 0 && visible.value.every(row => selected.value.includes(row.id)),
  set: value => { selected.value = value ? visible.value.map(row => row.id) : []; }
});
const stats = computed(() => ({ total: rows.value.length, enabled: rows.value.filter(row => row.ext?.enabled !== false).length }));
const dateText = value => { if (!value) return '--'; const d = new Date(value), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
// 推广二维码/复制链接：企业微信、公众号文章、QQ(http链接)直接使用用户配置的链接，不经过我们的域名；仅二维码类卡片需要落地页。
const directLink = row => {
  const ext = row.ext || {};
  const type = ext.jumpType || 'qrcode';
  const pick = type === 'wecom' ? ext.wecomUrl : type === 'article' ? (ext.articleUrl || row.link) : type === 'qq' ? ext.qqUrl : type === 'qqgroup' ? ext.qqGroup : '';
  const value = String(pick || '').trim();
  return /^https?:\/\//i.test(value) ? value : '';
};
const cardLink = row => directLink(row);

async function load() {
  loading.value = true;
  try { rows.value = await apiRequest('cards'); }
  catch (cause) { notice.value = cause.message; rows.value = []; }
  finally { loading.value = false; }
}
function resetFilters() { filters.id = ''; filters.title = ''; filters.note = ''; tab.value = 'all'; }
function openEditor(row) {
  Object.assign(form, blank());
  if (row) Object.assign(form, { ...row.ext, id: row.id, title: row.title, description: row.description, note: row.note, wecomUrl: row.ext?.wecomUrl || '', articleUrl: row.ext?.articleUrl || (row.mode === 'link' ? row.link : '') }, { qrs: (row.ext?.qrs || []).map(item => ({ ...item })), pageName: row.ext?.pageName || blank().pageName, poster: posters.includes(row.ext?.poster) ? row.ext.poster : posters[0] });
  step.value = 1; moreCovers.value = false; previewMode.value = 'display'; view.value = 'edit';
}
function toMode() { return form.jumpType === 'wecom' ? 'wecom' : form.jumpType === 'article' ? 'link' : 'image'; }
function validateStyle() {
  if (!form.title.trim()) return '请填写卡片标题。';
  if (!form.description.trim()) return '请填写卡片描述。';
  return '';
}
function nextStep() {
  const problem = validateStyle();
  if (problem) { ElMessage.warning(problem); return; }
  step.value = 2;
}
function validate() {
  const styleProblem = validateStyle();
  if (styleProblem) return styleProblem;
  if (form.jumpType === 'qrcode') return '跳转二维码功能暂未推出，无法提交。';
  if (form.jumpType === 'wecom' && !form.wecomUrl.trim()) return '请填写企业微信获客链接。';
  if (form.jumpType === 'qq' && !form.qqUrl.trim()) return '请填写QQ链接。';
  if (form.jumpType === 'qqgroup' && !/^https?:\/\//i.test(form.qqGroup.trim())) return '请填写以 http(s):// 开头的QQ群链接。';
  if (form.jumpType === 'article') { try { if (!['http:', 'https:'].includes(new URL(form.articleUrl.trim()).protocol)) throw new Error(); } catch { return '请填写有效的公众号文章链接。'; } }
  return '';
}
async function submit() {
  const problem = validate();
  if (problem) { ElMessage.warning(problem); return; }
  saving.value = true;
  const { id, title, description, note, ...rest } = form;
  const current = rows.value.find(row => row.id === id);
  const body = {
    mode: toMode(), style: 'normal', poll: 'send-random', name: title.trim().slice(0, 100), title: title.trim(), description: description.trim(), note: note.trim(),
    link: form.jumpType === 'article' ? form.articleUrl.trim() : '', images: [form.cover.startsWith('data:') ? 'custom-cover' : form.cover],
    ext: { ...rest, qrs: form.qrs, expireAt: current?.ext?.expireAt || 0 }
  };
  try {
    await apiRequest(id ? `cards/${id}` : 'cards', { method: id ? 'PATCH' : 'POST', body });
    view.value = 'list'; await load(); notice.value = id ? '卡片已更新。' : '卡片已创建。';
  } catch (cause) { ElMessage.error(cause.message); }
  finally { saving.value = false; }
}
async function toggle(row, value) {
  try { await apiRequest(`cards/${row.id}`, { method: 'PATCH', body: { ext: { ...row.ext, enabled: value } } }); row.ext = { ...row.ext, enabled: value }; }
  catch (cause) { ElMessage.error(cause.message); await load(); }
}
async function remove(ids) {
  try { for (const id of ids) await apiRequest(`cards/${id}`, { method: 'DELETE' }); selected.value = []; await load(); notice.value = '卡片已删除。'; }
  catch (cause) { ElMessage.error(cause.message); }
}

// 图片压缩后以 data URL 存入 ext（接口对 ext 总大小有限制）
function shrinkImage(file, max, type) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g)$/.test(file.type)) { reject(new Error('仅支持 jpg/png 图片。')); return; }
    if (file.size > 2 * 1024 * 1024) { reject(new Error('图片需小于 2MB。')); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height)), canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url); resolve(canvas.toDataURL(type, 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败。')); };
    img.src = url;
  });
}
async function uploadCover(event) {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  try { form.cover = await shrinkImage(file, 240, 'image/jpeg'); } catch (cause) { ElMessage.error(cause.message); }
}
async function uploadAvatar(event) {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  try { form.avatar = await shrinkImage(file, 160, 'image/jpeg'); } catch (cause) { ElMessage.error(cause.message); }
}
async function uploadQr(event) {
  const files = [...(event.target.files || [])]; event.target.value = '';
  for (const file of files) {
    if (form.qrs.length >= MAX_QR) { ElMessage.warning(`最多添加 ${MAX_QR} 张二维码。`); break; }
    try { form.qrs.push({ name: file.name, image: await shrinkImage(file, 420, 'image/png'), weight: 100, limit: 99999, show: true }); }
    catch (cause) { ElMessage.error(cause.message); }
  }
}
const qrSel = ref([]);
function removeQrs(indexes) { form.qrs = form.qrs.filter((_, i) => !indexes.includes(i)); qrSel.value = []; }
function editQr(index) {
  const item = form.qrs[index];
  Object.assign(qrEdit, { open: true, index, image: item.image, name: item.name, weight: item.weight, limit: item.limit, auto: item.auto || 'off', range: item.range ? [...item.range] : [], note: item.note || '' });
}
async function replaceQr(event) {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  try { qrEdit.image = await shrinkImage(file, 420, 'image/png'); if (!qrEdit.name.trim()) qrEdit.name = file.name; } catch (cause) { ElMessage.error(cause.message); }
}
function saveQr() {
  const item = form.qrs[qrEdit.index];
  if (!qrEdit.name.trim()) { ElMessage.warning('请填写二维码名称。'); return; }
  if (qrEdit.auto === 'time' && qrEdit.range.length !== 2) { ElMessage.warning('请选择上下线时间段。'); return; }
  if (item) Object.assign(item, {
    image: qrEdit.image, name: qrEdit.name.trim(), weight: Math.max(1, Number(qrEdit.weight) || 1), limit: Math.max(1, Number(qrEdit.limit) || 1),
    auto: qrEdit.auto, range: qrEdit.auto === 'time' ? [...qrEdit.range] : [], note: qrEdit.note.trim()
  });  qrEdit.open = false;
}
// 选择历史上传记录：汇总账号下已有卡片里上传过的二维码
const history = reactive({ open: false, keyword: '', items: [], sel: [], page: 1 });
const HISTORY_SIZE = 5;
const historyShown = computed(() => history.items.filter(item => !history.keyword.trim() || item.name.includes(history.keyword.trim())));
const historyPage = computed(() => historyShown.value.slice((history.page - 1) * HISTORY_SIZE, history.page * HISTORY_SIZE));
function openHistory() {
  const seen = new Set(), items = [];
  for (const row of rows.value) for (const qr of row.ext?.qrs || []) {
    if (!qr.image || seen.has(qr.image)) continue;
    seen.add(qr.image); items.push({ ...qr, key: items.length });
  }
  Object.assign(history, { open: true, keyword: '', items, sel: [], page: 1 });
}
function removeHistory(keys) { history.items = history.items.filter(item => !keys.includes(item.key)); history.sel = []; }
function confirmHistory() {
  const room = MAX_QR - form.qrs.length;
  const picked = history.items.filter(item => history.sel.includes(item.key));
  if (picked.length > room) ElMessage.warning(`最多添加 ${MAX_QR} 张二维码，仅添加前 ${Math.max(room, 0)} 张。`);
  for (const { key, ...qr } of picked.slice(0, Math.max(room, 0))) form.qrs.push({ ...qr, show: true });
  history.open = false;
}
function makeQr(text) { const qr = qrcode(0, 'M'); qr.addData(text); qr.make(); return qr.createDataURL(6, 8); }
async function openPromote(row) {
  // 每次打开前重新拉取，二维码始终对应当前已保存的链接，不依赖列表缓存。
  await load();
  const fresh = rows.value.find(item => item.id === row.id) || row;
  const link = cardLink(fresh);
  if (!link) { ElMessage.warning('该卡片没有可用的跳转链接，请先在“修改”中改为企业微信、QQ、QQ群或公众号文章，并填写以 http(s):// 开头的链接。'); return; }
  Object.assign(promote, { open: true, row: fresh, src: makeQr(link) });
}
async function copyLink() {
  try { await navigator.clipboard.writeText(cardLink(promote.row)); ElMessage.success('链接已复制。'); }
  catch { ElMessage.error('复制失败，请手动复制。'); }
}
// 右侧预览：与微转宝一致；二维码类型按表单里第一张"展示"中的二维码实时渲染
const showTg = computed(() => form.jumpType === 'qrcode' && previewMode.value !== 'effect');
const tgItem = computed(() => form.qrs.find(item => item.show !== false));
const tgQr = computed(() => tgItem.value?.image || '');
// 预览昵称取自展示中第一张二维码的名称；没有二维码时才用 pageName
const tgName = computed({
  get: () => tgItem.value ? tgItem.value.name : form.pageName,
  set: value => { if (tgItem.value) tgItem.value.name = value; else form.pageName = value; }
});
const jumpPv = computed(() => {
  const t = form.jumpType;
  if (t === 'qq') return { title: '正在跳转到QQ...', value: form.qqUrl.trim() && `QQ：${form.qqUrl.trim()}`, sub: '如未自动打开QQ请点击下方按钮', foot: '如无法打开QQ，请复制链接到浏览器打开', color: '#09f' };
  if (t === 'qqgroup') return { title: '正在跳转到QQ...', value: form.qqGroup.trim() && `QQ群：${form.qqGroup.trim()}`, sub: '如未自动打开QQ请点击下方按钮', foot: '如无法打开QQ群，请复制链接到浏览器打开', color: '#09f' };
  if (t === 'article') return { title: '正在跳转到公众号文章...', value: '', sub: '如未自动打开文章请点击下方按钮', foot: '如无法打开文章，请复制链接到浏览器打开', color: '#3cb035' };
  return { title: '正在跳转到微信...', value: '', sub: '如未自动打开微信请点击下方按钮', foot: '如无法打开微信，请复制链接到浏览器打开', color: '#3cb035' };
});
const jumpHint = { wecom: '企业微信获客链接', qq: 'QQ链接', qqgroup: 'QQ群链接', article: '公众号文章链接' };
let timer = 0;
onMounted(() => { load(); timer = window.setInterval(() => { if (view.value === 'list' && !promote.open) load(); }, 60000); });
onUnmounted(() => window.clearInterval(timer));
</script>

<template>
  <section class="wz-card">
    <template v-if="view==='list'">
      <div class="wz-notice">（仅限跳转二维码、企微、QQ、QQ群、公众号文章）。平台无限期自查违法违规账号及发送内容，一经发现将关停功能并保留证据移交公安机关。</div>
      <div class="wz-stats">您当前累计创建：<b>抖音卡片：{{ stats.total }} / 50</b><span>已启用：{{ stats.enabled }}</span></div>
      <el-alert v-if="notice" :title="notice" type="info" show-icon closable @close="notice=''"/>
      <div class="wz-tabs"><button v-for="[key,label] in tabs" :key="key" type="button" :class="{on:tab===key}" @click="tab=key">{{ label }}</button></div>
      <div class="wz-toolbar">
        <el-checkbox v-model="allSelected">全选</el-checkbox>
        <el-input v-model="filters.id" placeholder="卡片ID" clearable/>
        <el-input v-model="filters.title" placeholder="卡片标题" clearable/>
        <el-input v-model="filters.note" placeholder="备注" clearable/>
        <button type="button" class="wz-btn green">查询</button>
        <button type="button" class="wz-btn ghost" @click="resetFilters">重置</button>
        <el-popconfirm v-if="selected.length" :title="`确定删除选中的 ${selected.length} 张卡片？`" @confirm="remove(selected)"><template #reference><button type="button" class="wz-btn red">批量删除</button></template></el-popconfirm>
        <span class="wz-spacer"/>
        <button type="button" class="wz-btn orange" @click="openEditor()">创建</button>
      </div>
      <div v-loading="loading" class="wz-list">
        <div v-if="!visible.length" class="wz-empty">暂无卡片，点击右上角“创建”</div>
        <article v-for="row in visible" :key="row.id" class="wz-row">
          <div class="wz-row-head">
            <el-checkbox :model-value="selected.includes(row.id)" @change="value => selected = value ? [...selected, row.id] : selected.filter(id => id !== row.id)">{{ row.id.slice(0, 16) }}</el-checkbox>
            <span class="wz-spacer"/>
            <span>到期时间 {{ row.ext?.expireAt ? dateText(row.ext.expireAt) : '永久' }}</span>
            <span>创建时间 {{ dateText(row.created) }}</span>
            <el-switch :model-value="row.ext?.enabled !== false" @change="value => toggle(row, value)"/>
            <el-popconfirm title="确定删除这张卡片？" @confirm="remove([row.id])"><template #reference><button type="button" class="wz-del" aria-label="删除">删</button></template></el-popconfirm>
          </div>
          <div class="wz-row-body">
            <img class="wz-cover" :src="row.ext?.cover || covers[0]" alt="封面"/>
            <div class="wz-info"><strong>{{ row.title }}</strong><small>{{ row.description || '—' }}</small><small v-if="row.note" class="muted">备注：{{ row.note }}</small></div>
            <dl class="wz-data"><div><dt>PV:</dt><dd>{{ row.views || '--' }}</dd></div><div><dt>UV:</dt><dd>--</dd></div><div><dt>长按识别:</dt><dd>--</dd></div><div><dt>转化率:</dt><dd>--</dd></div><div><dt>手机号:</dt><dd>--</dd></div></dl>
            <div class="wz-ops"><button type="button" class="wz-btn blue" @click="openEditor(row)">修改</button><button type="button" class="wz-btn blue" @click="openPromote(row)">推广</button></div>
          </div>
        </article>
      </div>
    </template>
    <div v-else class="wz-editor">
      <div class="wz-edit-main">
        <div class="wz-edit-head"><button type="button" class="wz-back" @click="view='list'">‹ 返回</button><h3>抖音卡片</h3></div>
        <ol class="wz-steps"><li :class="{on:step>=1}"><i>1</i>抖音私信卡片样式</li><li class="line"/><li :class="{on:step>=2}"><i>2</i>配置跳转链接</li></ol>
        <div v-show="step===1" class="wz-step">
          <div class="wz-field"><label>分享类型</label><el-radio-group v-model="form.shareType"><el-radio value="card">卡片</el-radio></el-radio-group></div>
          <div class="wz-field top"><label>卡片封面</label>
            <div class="wz-covers">
              <img v-for="(src,i) in (moreCovers ? covers : covers.slice(0,9))" :key="src" :src="src" :class="{on:form.cover===src}" :alt="`封面${i+1}`" @click="form.cover=src"/>
              <label class="wz-upload-cover">+<input type="file" accept="image/png,image/jpeg" @change="uploadCover"/></label>
              <button type="button" class="wz-link" @click="moreCovers=!moreCovers">{{ moreCovers ? '收起' : '展开更多' }}</button>
            </div>
          </div>
          <div class="wz-field"><label class="req">卡片标题</label><el-input v-model="form.title" maxlength="30" show-word-limit placeholder="请输入卡片标题"/></div>
          <div class="wz-field"><label class="req">卡片描述</label><el-input v-model="form.description" maxlength="60" show-word-limit placeholder="请输入卡片描述"/></div>
          <div class="wz-field"><label>备注</label><el-input v-model="form.note" maxlength="255" placeholder="仅自己可见"/></div>
          <div class="wz-actions"><button type="button" class="wz-btn orange round" @click="nextStep">下一步</button></div>
        </div>
        <div v-show="step===2" class="wz-step">
          <div class="wz-field"><label>跳转管理</label><el-radio-group v-model="form.jumpType"><el-radio v-for="[key,label] in jumpTypes" :key="key" :value="key">{{ label }}</el-radio></el-radio-group></div>
          <div v-if="form.jumpType==='qrcode'" class="wz-qr-box">
            <div class="wz-qr-tip"><button type="button" class="wz-link" :disabled="!qrSel.length" @click="removeQrs(qrSel)">批量删除</button></div>
            <table class="wz-qr-table">
              <thead><tr><th/><th>序号</th><th>权重</th><th>名称</th><th>图片</th><th>访问上限</th><th>展示</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-if="!form.qrs.length"><td colspan="8" class="wz-empty">暂无二维码</td></tr>
                <tr v-for="(item,i) in form.qrs" :key="i">
                  <td><el-checkbox :model-value="qrSel.includes(i)" @change="value => qrSel = value ? [...qrSel, i] : qrSel.filter(n => n !== i)"/></td>
                  <td>{{ i + 1 }}</td><td>{{ item.weight }}</td><td>{{ item.name }}</td><td><img :src="item.image" alt="二维码" class="wz-qr-thumb"/></td><td>{{ item.limit }}</td>
                  <td><el-switch v-model="item.show"/></td>
                  <td><button type="button" class="wz-link" @click="editQr(i)">编辑</button><button type="button" class="wz-link danger" @click="removeQrs([i])">删除</button></td>
                </tr>
              </tbody>
            </table>
            <label class="wz-dropzone">拖至此处 点击上传<input type="file" multiple accept="image/png,image/jpeg" @change="uploadQr"/></label>
            <p class="wz-hint">jpg/png 二维码图片需小于2Mb <button type="button" class="wz-link" @click="openHistory">选择历史上传记录</button></p>
            <div class="wz-field"><label>二维码切换方式</label><el-radio-group v-model="form.qrSwitch" class="wz-seg"><el-radio-button value="loop">循环切换</el-radio-button><el-radio-button value="order">顺序切换</el-radio-button><el-radio-button value="random">随机切换</el-radio-button></el-radio-group></div>
            <div class="wz-field"><label>二维码访问上限</label><el-radio-group v-model="form.qrLimit" class="wz-seg"><el-radio-button value="total">累计限制</el-radio-button><el-radio-button value="daily">每日限制</el-radio-button></el-radio-group></div>
            <h4>配置页面样式</h4>
            <div class="wz-field"><label>页面样式</label><button type="button" class="wz-btn ghost" @click="cardStyleDialog=true">微信名片样式修改</button></div>
          </div>
          <div v-else class="wz-field"><label>{{ jumpHint[form.jumpType] }}</label>
            <el-input v-if="form.jumpType==='wecom'" v-model="form.wecomUrl" placeholder="https://work.weixin.qq.com/ca/..."/>
            <el-input v-else-if="form.jumpType==='qq'" v-model="form.qqUrl" placeholder="请输入QQ号或QQ链接"/>
            <el-input v-else-if="form.jumpType==='qqgroup'" v-model="form.qqGroup" placeholder="https://qm.qq.com/q/..."/>
            <el-input v-else v-model="form.articleUrl" placeholder="https://mp.weixin.qq.com/s/..."/>
          </div>
          <div class="wz-actions"><button type="button" class="wz-btn orange round" @click="step=1">上一步</button><button type="button" class="wz-btn orange round" :disabled="saving" @click="submit">提交</button></div>
        </div>
      </div>
      <aside class="wz-preview">
        <template v-if="step===1">
          <h4>抖音卡片预览</h4>
          <div class="wz-phone">
            <div class="wz-phone-chat">
              <div class="wz-chat-box"><img :src="form.cover" alt="封面"/><div class="wz-chat-right"><div class="wz-chat-title">{{ form.title || '卡片标题' }}</div><div class="wz-chat-desc">{{ form.description || '描述' }}</div></div></div>
              <span class="wz-chat-sender" aria-hidden="true"></span>
            </div>
          </div>
        </template>
        <template v-else>
          <h4>页面样式预览</h4>
          <div class="wz-pv-tabs">
            <button type="button" :class="{on:!showTg}" @click="previewMode='effect'">跳转页效果</button>
            <button v-if="form.jumpType==='qrcode'" type="button" :class="{on:showTg}" @click="previewMode='display'">展现页面</button>
          </div>
          <div class="wz-pv-frame">
            <div class="wz-pv-wrap">
              <div v-if="showTg" class="wz-tg" :style="{backgroundImage:`url(${form.poster})`}">
                <div class="wz-tg-box"><div class="wz-tg-box1">
                  <div class="wz-tg-head">
                    <img class="wz-tg-avatar" :src="form.avatar || '/card-assets/wzb/head.png'" alt="头像"/>
                    <div class="wz-tg-name"><div class="wz-tg-name1">{{ tgName }}</div><div v-if="form.pageTip" class="wz-tg-name2">{{ form.pageTip }}</div></div>
                  </div>
                  <img v-if="tgQr" class="wz-tg-qr" :src="tgQr" alt="二维码"/>
                  <div v-else class="wz-tg-qr wz-tg-qr-empty">二维码</div>
                  <div class="wz-tg-footer"><div v-if="form.qrToggle" class="wz-tg-tag">{{ form.qrTip }}</div></div>
                </div></div>
              </div>
              <div v-else class="wz-jump">
                <div class="wz-safe"><img src="/card-assets/wzb/icon1.png" alt=""/><p>本链接已经过SSL安全加密，请放心点击</p></div>
                <div class="wz-jump-icon"><img v-if="form.jumpType==='qq'||form.jumpType==='qqgroup'" class="qq" src="/card-assets/wzb/qq.png" alt="QQ"/><img v-else src="/card-assets/wzb/icon2.png" alt="微信"/></div>
                <div class="wz-t1 mt30">{{ jumpPv.title }}</div>
                <div v-if="jumpPv.value" class="wz-t11">{{ jumpPv.value }}</div>
                <div class="wz-t2">{{ jumpPv.sub }}</div>
                <div class="wz-b1" :style="{background:jumpPv.color}"><p>点击前往打开</p></div>
                <div class="wz-t1 mt100">{{ jumpPv.foot }}</div>
              </div>
            </div>
          </div>
        </template>
      </aside>
    </div>
    <el-dialog v-model="promote.open" title="推广" width="min(720px,96vw)" append-to-body>
      <ol class="wz-guide">
        <li><div class="wz-guide-top"><i>1</i><span>使用苹果手机打开抖音 App 扫码</span></div><div class="wz-guide-qr"><img v-if="promote.src" class="qr" :src="promote.src" alt="推广二维码"/></div></li>
        <li><div class="wz-guide-top"><i>2</i><span>点击右上角分享按钮</span></div><img src="/card-assets/steps/step-2.jpg" alt="点击右上角分享按钮"/></li>
        <li><div class="wz-guide-top"><i>3</i><span>分享给好友、群聊</span></div><img src="/card-assets/steps/step-3.jpg" alt="分享给好友、群聊"/></li>
      </ol>
      <p class="wz-warn">注：必须使用<b>苹果手机</b>【<b>抖音极速版30.3.0及以前的版本</b>】扫码分享，安卓手机扫码无效。若分享的卡片未展示封面、标题及描述，请检查抖音版本是否为3.0及以前的版本。<a class="wz-tutorial" href="#" @click.prevent="tutorialOpen = true">（教程）</a></p>
      <template #footer><button type="button" class="wz-btn blue" @click="copyLink">复制链接</button></template>
    </el-dialog>
    <CardTutorialDialog v-model="tutorialOpen"/>
    <el-dialog v-model="qrEdit.open" title="编辑二维码" width="min(420px,96vw)" append-to-body>
      <div class="wz-qe-img"><img v-if="qrEdit.image" :src="qrEdit.image" alt="二维码"/></div>
      <label class="wz-dropzone">拖至此处 点击上传<input type="file" accept="image/png,image/jpeg" @change="replaceQr"/></label>
      <p class="wz-hint">jpg/png 二维码图片需小于2Mb</p>
      <el-form label-width="110px">
        <el-form-item label="名称"><el-input v-model="qrEdit.name" maxlength="50" placeholder="请输入名称"/></el-form-item>
        <el-form-item label="访问上限人数"><el-input-number v-model="qrEdit.limit" :min="1" :max="9999999" controls-position="right"/></el-form-item>
        <el-form-item>
          <template #label>权重<el-tooltip content="权重越大，被展示的概率越高" placement="top"><span class="wz-q">?</span></el-tooltip></template>
          <el-input-number v-model="qrEdit.weight" :min="1" :max="100000" controls-position="right"/>
        </el-form-item>
        <el-form-item label="自动上下线"><el-radio-group v-model="qrEdit.auto"><el-radio value="off">关闭</el-radio><el-radio value="time">按时间段控制</el-radio></el-radio-group></el-form-item>
        <el-form-item v-if="qrEdit.auto==='time'" label="时间段"><el-date-picker v-model="qrEdit.range" type="datetimerange" value-format="YYYY-MM-DD HH:mm:ss" range-separator="至" start-placeholder="上线时间" end-placeholder="下线时间"/></el-form-item>
        <el-form-item label="备注"><el-input v-model="qrEdit.note" type="textarea" :rows="3" maxlength="255" placeholder="请输入备注"/></el-form-item>
      </el-form>
      <template #footer><el-button type="primary" @click="saveQr">确定</el-button><el-button @click="qrEdit.open=false">返回</el-button></template>
    </el-dialog>
    <el-drawer v-model="history.open" title="选择二维码" size="min(720px,96vw)" append-to-body>
      <div class="wz-toolbar">
        <el-input v-model="history.keyword" placeholder="客服名称" clearable @input="history.page=1"/>
        <button type="button" class="wz-btn green" @click="history.page=1">查询</button>
        <button type="button" class="wz-btn ghost" @click="history.keyword='';history.page=1">重置</button>
        <button type="button" class="wz-btn red" :disabled="!history.sel.length" @click="removeHistory(history.sel)">批量删除</button>
      </div>
      <table class="wz-qr-table">
        <thead><tr><th/><th>序号</th><th>权重</th><th>名称</th><th>图片</th><th>访问上限</th><th>长按识别人数</th><th>展示</th></tr></thead>
        <tbody>
          <tr v-if="!historyPage.length"><td colspan="8" class="wz-empty">暂无历史上传记录</td></tr>
          <tr v-for="(item,i) in historyPage" :key="item.key">
            <td><el-checkbox :model-value="history.sel.includes(item.key)" @change="value => history.sel = value ? [...history.sel, item.key] : history.sel.filter(n => n !== item.key)"/></td>
            <td>{{ (history.page - 1) * HISTORY_SIZE + i + 1 }}</td><td>{{ item.weight }}</td><td>{{ item.name }}</td><td><img :src="item.image" alt="二维码" class="wz-qr-thumb"/></td><td>{{ item.limit }}</td><td>0</td><td><span class="wz-on">开启</span></td>
          </tr>
        </tbody>
      </table>
      <el-pagination v-model:current-page="history.page" :page-size="HISTORY_SIZE" :total="historyShown.length" layout="total, prev, pager, next"/>
      <template #footer><el-button type="primary" @click="confirmHistory">确定</el-button><el-button @click="history.open=false">返回</el-button></template>
    </el-drawer>
    <el-dialog v-model="cardStyleDialog" title="配置展现页面样式" width="min(880px,96vw)" append-to-body>
      <div class="wz-style-config">
        <div class="wz-style-form">
          <div class="wz-field"><label>标题自选：</label><el-switch v-model="form.titleToggle"/></div>
          <div class="wz-field"><label>推广头像：</label><label class="wz-upload-icon"><img v-if="form.avatar" :src="form.avatar" alt="头像"/><span v-else>📷</span><input type="file" accept="image/png,image/jpeg" @change="uploadAvatar"/></label><span class="wz-upload-hint">支持jpg/png。建议尺寸80*80，且不超过1Mb</span></div>
          <div class="wz-field"><label>推广标题：</label><el-input v-model="tgName" maxlength="50" placeholder="取自展示中二维码的名称"/></div>
          <div class="wz-field"><label>推广副标题：</label><el-input v-model="form.pageTip" maxlength="14" show-word-limit placeholder="请输入推广副标题，限14个字"/></div>
          <div class="wz-field top"><label>背景图：</label>
            <div class="wz-poster-grid">
              <img v-for="(src,i) in posters" :key="src" :src="src" :class="{on:form.poster===src}" :alt="`背景${i+1}`" @click="form.poster=src"/>
            </div>
          </div>
          <div class="wz-field"><label>扫码引导提示：</label><el-switch v-model="form.qrToggle"/></div>
          <div class="wz-field"><label>引导提示语：</label><el-input v-model="form.qrTip" placeholder="长按识别上方二维码，加我为好友。"/></div>
        </div>
        <aside class="wz-style-preview">
          <h4>展示模式</h4>
          <div class="wz-pv-frame">
            <div class="wz-pv-wrap">
              <div class="wz-tg" :style="{backgroundImage:`url(${form.poster})`}">
                <div class="wz-tg-box"><div class="wz-tg-box1">
                  <div class="wz-tg-head">
                    <img class="wz-tg-avatar" :src="form.avatar || '/card-assets/wzb/head.png'" alt="头像"/>
                    <div class="wz-tg-name"><div class="wz-tg-name1">{{ tgName }}</div><div v-if="form.pageTip" class="wz-tg-name2">{{ form.pageTip }}</div></div>
                  </div>
                  <img v-if="tgQr" class="wz-tg-qr" :src="tgQr" alt="二维码"/>
                  <div v-else class="wz-tg-qr wz-tg-qr-empty">二维码</div>
                  <div class="wz-tg-footer"><div v-if="form.qrToggle" class="wz-tg-tag">{{ form.qrTip }}</div></div>
                </div></div>
              </div>
            </div>
          </div>
        </aside>
      </div>
      <template #footer><el-button @click="cardStyleDialog=false">返回</el-button><el-button type="primary" @click="cardStyleDialog=false">确定</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.wz-card{min-width:0;color:#303133;font-size:13px}
.wz-notice{background:#fff0f0;color:#e5484d;border:1px solid #fdd;border-radius:4px;padding:10px 14px;margin-bottom:10px;line-height:1.6}
.wz-stats{background:#fff;border-radius:4px;padding:10px 14px;margin-bottom:10px;color:#e5484d;font-size:12px}
.wz-stats b{margin-right:14px}.wz-stats span{color:#606266}
.wz-card :deep(.el-alert){margin-bottom:10px}
.wz-tabs{display:flex;gap:26px;background:#fff;padding:0 20px;border-bottom:1px solid #eee}
.wz-tabs button{border:0;background:none;padding:14px 2px;font-size:14px;color:#606266;cursor:pointer;border-bottom:2px solid transparent}
.wz-tabs button.on{color:#ffa207;border-bottom-color:#ffa207}
.wz-toolbar{display:flex;align-items:center;gap:10px;background:#fff;padding:12px 20px;flex-wrap:wrap}
.wz-toolbar .el-input{width:150px}.wz-spacer{flex:1}
.wz-btn{border:1px solid transparent;border-radius:9px;padding:7px 18px;font-size:13px;cursor:pointer;color:#fff;line-height:1.2}
.wz-btn.green{background:#14d397}.wz-btn.orange{background:#ffa207}.wz-btn.blue{background:#409eff}.wz-btn.red{background:#f56c6c}
.wz-btn.ghost{background:#fff;color:#606266;border-color:#dcdfe6}.wz-btn.round{border-radius:20px;padding:8px 28px}
.wz-btn:disabled{opacity:.6;cursor:not-allowed}
.wz-list{background:#f5f6f8;padding:12px 20px;min-height:260px}
.wz-empty{text-align:center;color:#909399;padding:60px 0}
.wz-row{background:#fff;border-radius:6px;margin-bottom:12px;padding:10px 16px}
.wz-row-head{display:flex;align-items:center;gap:18px;color:#606266;font-size:12px}
.wz-del{border:0;background:none;color:#f56c6c;cursor:pointer}
.wz-row-body{display:flex;align-items:center;gap:18px;padding-top:8px}
.wz-cover{width:76px;height:76px;border-radius:6px;object-fit:cover;flex:none}
.wz-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.wz-info strong{font-size:14px}.wz-info small{color:#909399}.wz-info .muted{color:#b0b4bc}
.wz-data{display:grid;grid-template-columns:repeat(3,auto);gap:6px 28px;margin:0;color:#606266}
.wz-data div{display:flex;gap:6px}.wz-data dt,.wz-data dd{margin:0}
.wz-ops{display:flex;gap:10px}
.wz-editor{display:flex;gap:12px;align-items:flex-start}
.wz-edit-main{flex:1;min-width:0;background:#fff;padding:18px 24px 28px}
.wz-edit-head{display:flex;align-items:center;justify-content:center;position:relative;margin-bottom:12px}
.wz-edit-head h3{margin:0;font-size:16px}
.wz-back{position:absolute;left:0;border:0;background:none;color:#606266;cursor:pointer}
.wz-steps{display:flex;align-items:center;justify-content:center;list-style:none;padding:0;margin:14px 0 22px;color:#909399}
.wz-steps li{display:flex;align-items:center;gap:8px}
.wz-steps i{width:20px;height:20px;border-radius:50%;background:#c0c4cc;color:#fff;font-style:normal;text-align:center;line-height:20px;font-size:12px}
.wz-steps li.on{color:#ffa207}.wz-steps li.on i{background:#ffa207}
.wz-steps li.line{width:120px;height:1px;background:#ffa207;margin:0 12px}
.wz-field{display:flex;align-items:center;gap:14px;margin-bottom:16px}
.wz-field.top{align-items:flex-start}
.wz-field>label{min-width:84px;flex:none;text-align:right;color:#606266;white-space:nowrap}
.wz-field>label.req::before{content:'*';color:#f56c6c;margin-right:4px}
.wz-field>.el-input{max-width:520px}
.wz-covers{display:flex;flex-wrap:wrap;gap:8px;align-items:center;max-width:560px}
.wz-covers img{width:52px;height:52px;border-radius:6px;object-fit:cover;cursor:pointer;border:2px solid transparent}
.wz-covers img.on{border-color:#ffa207}
.wz-upload-cover{width:52px;height:52px;border:1px dashed #c0c4cc;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:22px;color:#909399;cursor:pointer}
.wz-upload-cover input,.wz-dropzone input{display:none}
.wz-link{border:0;background:none;color:#409eff;cursor:pointer;padding:0 6px;font-size:12px}
.wz-link.danger{color:#f56c6c}.wz-link:disabled{color:#c0c4cc;cursor:not-allowed}
.wz-actions{display:flex;justify-content:center;gap:24px;margin-top:26px}
.wz-qr-box{background:#f8f8f8;padding:14px 16px;border-radius:4px;margin-bottom:12px}
.wz-qr-tip{background:#f0f0f0;padding:8px 12px;margin-bottom:10px;color:#606266;font-size:12px}
.wz-qr-table{width:100%;border-collapse:collapse;background:#fff;text-align:center;margin-bottom:10px}
.wz-qr-table th,.wz-qr-table td{border:1px solid #ebeef5;padding:8px 6px;font-size:12px}
.wz-qr-table th{background:#fafafa;font-weight:600}
.wz-qr-thumb{width:56px;height:56px;object-fit:contain;vertical-align:middle}
.wz-dropzone{display:flex;align-items:center;justify-content:center;height:40px;border:1px dashed #c0c4cc;background:#fff;color:#909399;cursor:pointer;border-radius:4px}
.wz-hint{margin:6px 0 12px;font-size:12px;color:#909399}
.wz-qe-img{display:flex;justify-content:center;margin-bottom:10px}
.wz-qe-img img{width:180px;height:180px;object-fit:contain;border:1px solid #ebeef5}
.wz-q{display:inline-block;width:14px;height:14px;margin-left:4px;border-radius:50%;background:#c0c4cc;color:#fff;font-size:11px;line-height:14px;text-align:center;cursor:help}
.wz-on{color:#14d397}
.wz-seg{flex-wrap:nowrap}
.wz-qr-box h4{margin:16px 0 10px;padding-left:8px;border-left:3px solid #ffa207;font-size:14px}
.wz-preview{width:320px;flex:none;background:#fff;padding:14px 16px}
.wz-pv-tabs{display:flex;justify-content:center;gap:10px;margin:0 0 12px}
.wz-pv-tabs button{width:100px;height:30px;border:1px solid #d9d9d9;border-radius:4px;background:#fff;color:#000;font-size:14px;cursor:pointer}
.wz-pv-tabs button.on{color:#409eff;border-color:#409eff}
.wz-pv-frame{position:relative;width:280px;height:560px;margin:0 auto;padding:8px;box-sizing:border-box;background:url(/card-assets/wzb/phone-bg400.png) no-repeat 0 0/100% 100%}
.wz-pv-wrap{width:264px;height:544px;padding:0 4px;box-sizing:border-box}
.wz-safe{display:flex;align-items:center;justify-content:center;width:256px;height:32px;padding:2px 0;box-sizing:border-box;background:#e3fad0;border-radius:32px 32px 0 0}
.wz-safe img{width:20px;height:20px}
.wz-safe p{margin:0;color:#72bf45;font-size:11px;line-height:28px}
.wz-jump{width:256px;height:405px}
.wz-jump-icon{display:flex;align-items:center;justify-content:center;height:54px;margin-top:50px}
.wz-jump-icon img{width:64px;height:64px}.wz-jump-icon img.qq{width:100px;height:54px;object-fit:contain}
.wz-t1,.wz-t2,.wz-t11{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.wz-t1{color:#aaa;font-size:11px}.wz-t1.mt30{margin-top:30px}.wz-t1.mt100{margin-top:100px}
.wz-t2{color:#767676;font-size:11px;margin-top:12px}
.wz-t11{font-size:14px;color:#000;margin-top:4px;word-break:break-all}
.wz-b1{display:flex;align-items:center;justify-content:center;width:162px;height:32px;margin:50px auto;border-radius:999px;color:#fff}
.wz-b1 p{margin:0;font-size:13px;line-height:28px}
.wz-tg{display:flex;align-items:center;justify-content:center;width:256px;height:544px;border-radius:33px;background:no-repeat 0 0/100% 100%}
.wz-tg-box{display:flex;flex-direction:column;align-items:center;width:207px;min-height:301px;box-sizing:border-box;background:#fff;border:1px solid #dfdfdf;border-radius:18px;box-shadow:0 0 10px rgba(0,0,0,.075)}
.wz-tg-box1{display:flex;flex-direction:column;align-items:center;justify-content:center;width:162px;padding:12.8px 0;box-sizing:border-box}
.wz-tg-head{display:flex;align-items:center;width:100%;margin:16px 0}
.wz-tg-avatar{width:36px;height:36px;margin-right:8px;border-radius:6px;object-fit:cover}
.wz-tg-name{display:flex;flex-direction:column;min-width:0;width:112px}
.wz-tg-name1{margin:1px 0;font-size:12px;font-weight:600;color:#000;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.wz-tg-name2{font-size:10px;color:#999;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.wz-tg-qr{width:162px;height:162px;margin:0 0 13px;object-fit:contain}
.wz-tg-qr-empty{display:flex;align-items:center;justify-content:center;background:#f0f0f0;color:#999;font-size:12px}
.wz-tg-footer{display:flex;justify-content:center;width:144px;min-height:12px;margin:2px 0 16px}
.wz-tg-tag{font-size:9px;color:#909090;text-align:center;white-space:break-spaces}
.wz-preview h4{margin:0 0 14px;padding-left:8px;border-left:3px solid #ffa207;font-size:14px}
.wz-phone{width:250px;height:507px;margin:0 auto;background:url(/card-assets/phone-bg.png?v=2) center/100% 100% no-repeat;position:relative;overflow:hidden}
.wz-phone-chat{position:absolute;left:16px;right:16px;top:70px;bottom:24px;display:flex;align-items:flex-start;text-align:left}
.wz-chat-box{display:flex;width:178px;height:52px;margin-right:8px;background:#f7f7f7;border-radius:11px;overflow:hidden}
.wz-chat-box img{width:52px;height:52px;flex:none;border-radius:5px;object-fit:cover;display:block}
.wz-chat-right{display:flex;flex-direction:column;justify-content:center;padding-left:10px;min-width:0}
.wz-chat-title{width:140px;margin:2px 0;font-size:12px;color:#3a3a3a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wz-chat-desc{margin:1px 0;font-size:10px;color:#777;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px}
.wz-chat-sender{flex:none;width:22px;height:22px;border-radius:50%;background:#d8dde6}
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
@media(max-width:900px){.wz-editor{flex-direction:column}.wz-preview{width:100%}.wz-row-body{flex-wrap:wrap}}
.wz-style-config{display:flex;gap:20px;align-items:flex-start}
.wz-style-form{flex:1;min-width:0}
.wz-style-preview{width:320px;flex:none}
.wz-style-preview h4{margin:0 0 12px;font-size:14px;color:#606266}
.wz-upload-icon{display:inline-flex;width:52px;height:52px;border:1px solid #dcdfe6;border-radius:6px;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;font-size:24px}
.wz-upload-icon img{width:100%;height:100%;object-fit:cover}
.wz-upload-icon input{display:none}
.wz-upload-hint{color:#909399;font-size:12px}
.wz-poster-grid{display:grid;grid-template-columns:repeat(8,52px);gap:8px}
.wz-poster-grid img{width:52px;height:52px;border-radius:6px;object-fit:cover;cursor:pointer;border:2px solid transparent}
.wz-poster-grid img.on{border-color:#ffa207}
.wz-phone-full{width:260px;height:520px;margin:0 auto;background:#1a1a1a;border-radius:28px;padding:12px;box-shadow:0 4px 12px rgba(0,0,0,.15)}
.wz-phone-inner{width:100%;height:100%;background:#fff;border-radius:18px;overflow:hidden;display:flex;flex-direction:column}
.wz-wechat-card{flex:1;display:flex;flex-direction:column;align-items:center;padding:40px 20px 20px;background:#f5f5f5}
.wz-wechat-avatar{width:64px;height:64px;border-radius:8px;object-fit:cover;margin-bottom:12px}
.wz-avatar-placeholder{display:flex;align-items:center;justify-content:center;background:#e5e5e5;font-size:32px}
.wz-wechat-name{font-size:16px;font-weight:600;color:#1a1a1a;margin-bottom:16px}
.wz-poster-wrap{width:100%;max-width:240px;aspect-ratio:1;background:#fff;border-radius:8px;display:flex;align-items:center;justify-content:center;background-size:cover;background-position:center;margin-bottom:16px}
.wz-qr-placeholder{width:120px;height:120px;background:#f0f0f0;border:2px dashed #ccc;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#999;font-size:12px}
.wz-wechat-tip{font-size:12px;color:#8a8a8a;text-align:center;line-height:1.5}
.wz-preview-tabs{display:flex;gap:8px;margin:12px auto 12px;width:260px}
.wz-preview-tabs button{flex:1;padding:8px;border:1px solid #dcdfe6;background:#fff;border-radius:4px;font-size:13px;cursor:pointer;color:#606266}
.wz-preview-tabs button.on{background:#409eff;color:#fff;border-color:#409eff}
.wz-jump-page{flex:1;display:flex;flex-direction:column;align-items:center;padding:40px 20px;text-align:center;position:relative}
.wz-jump-badge{position:absolute;top:12px;left:50%;transform:translateX(-50%);background:#e8f5e9;color:#4caf50;font-size:11px;padding:4px 12px;border-radius:12px;white-space:nowrap}
.wz-jump-icon{font-size:64px;margin:60px 0 20px}
.wz-jump-icon.qq{display:flex;align-items:center;gap:8px;font-size:48px}
.wz-jump-status{font-size:16px;color:#303133;margin-bottom:12px}
.wz-jump-hint{font-size:13px;color:#909399;margin-bottom:24px}
.wz-jump-btn{background:#07c160;color:#fff;border:none;padding:12px 40px;border-radius:24px;font-size:14px;cursor:pointer;margin-bottom:80px}
.wz-jump-btn.qq{background:#12b7f5}
.wz-jump-footer{position:absolute;bottom:20px;left:20px;right:20px;font-size:11px;color:#c0c4cc}
@media(max-width:900px){.wz-style-config{flex-direction:column}.wz-style-preview{width:100%}}
</style>

