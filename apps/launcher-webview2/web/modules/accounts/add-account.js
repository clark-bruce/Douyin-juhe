// Local account capture works independently of optional workbench tasks.
(() => {
  const style = document.createElement('style');
  style.textContent = `
    .account-dialog{width:min(660px,94vw);max-height:90vh;overflow:auto;border:0;border-radius:12px;padding:24px;color:#283954}
    .account-dialog::backdrop{background:rgba(20,32,52,.42)}
    .account-dialog h2{margin:0 0 22px;font-size:20px}
    .account-dialog fieldset{border:0;padding:0;margin:20px 0}
    .account-dialog legend,.account-dialog .field-label{display:block;margin-bottom:10px;font-weight:500}
    .account-dialog .choices{display:flex;flex-wrap:wrap;gap:12px 18px}
    .account-dialog label{cursor:pointer}
    .account-dialog input:not([type=radio]),.account-dialog select{width:100%;font:inherit;padding:9px;border:1px solid #dfe5ee;border-radius:6px}
    .account-dialog input[type=radio]{accent-color:#409eff}
    .account-dialog .network-fields{background:#f7f9fc;padding:14px;border-radius:6px}
    .account-dialog .network-fields[hidden]{display:none}
    .account-dialog .network-fields label{display:block;margin-bottom:12px}
    .account-dialog p{font-size:13px;line-height:1.7;color:#718099}
    .account-dialog ol{font-size:13px;line-height:1.9;padding-left:22px;color:#718099}
    .account-dialog footer{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
    .account-dialog .client-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#f7f9fc;padding:14px;border-radius:6px;margin:12px 0}
    .account-dialog .client-tools[hidden]{display:none}
    .account-dialog .proxy-batch{margin-top:10px;padding-top:10px;border-top:1px solid #e6ebf2}
    .account-dialog .proxy-batch[hidden]{display:none}
    .account-dialog .proxy-batch textarea{width:100%;min-height:90px;box-sizing:border-box;font:inherit;padding:9px;border:1px solid #dfe5ee;border-radius:6px;resize:vertical}
    .account-dialog .account-progress{margin:12px 0 4px;padding:12px 14px;background:#f7f9fc;border-radius:6px}
    .account-dialog .account-progress[hidden]{display:none}
    .account-dialog .account-progress-track{height:8px;background:#dfe7f2;border-radius:99px;overflow:hidden}
    .account-dialog .account-progress-bar{height:100%;width:0;background:linear-gradient(90deg,#409eff,#67c23a);border-radius:99px;transition:width .25s ease}
    .account-dialog .account-progress-meta{display:flex;justify-content:space-between;gap:12px;margin-top:8px;font-size:12px;color:#718099}
  `;
  document.head.append(style);
  const dialog = document.createElement('dialog');
  dialog.className = 'account-dialog';
  dialog.setAttribute('aria-labelledby', 'add-account-title');
  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="add-account-title">添加抖音账号</h2>
      <label class="field-label" for="account-note">账号备注</label>
      <input id="account-note" name="note" maxlength="128" placeholder="选填，不填则使用抖音昵称" autocomplete="off">
      <fieldset><legend>登录方式</legend><div class="choices">
        <label><input type="radio" name="loginMode" value="creator" checked> 创作者</label>
        <label><input type="radio" name="loginMode" value="douyin_chat"> 抖音聊天</label>
      </div></fieldset>
      <fieldset><legend>网络方式</legend><div class="choices">
        <label><input type="radio" name="networkMode" value="direct" checked> 不使用代理</label>
        <label><input type="radio" name="networkMode" value="custom"> 自定义代理</label>
        <label><input type="radio" name="networkMode" value="local_node"> 本机节点</label>
      </div></fieldset>
      <div class="network-fields" data-custom hidden>
        <label>协议<select name="proxyProtocol"><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option></select></label>
        <label>代理地址<input name="proxyAddress" placeholder="IP 或域名:端口，不含用户名和密码" autocomplete="off"></label>
        <label>用户名<input name="proxyUsername" autocomplete="off"></label>
        <label>密码<input name="proxyPassword" type="password" autocomplete="new-password"></label>
        <label>代理到期时间<input name="proxyExpiresAt" type="datetime-local"></label>
        <button type="button" data-proxy-batch>批量新增</button>
        <div class="proxy-batch" data-proxy-batch-panel hidden><label>批量代理内容<textarea name="proxyBatch" placeholder="每行一条：IP:端口|用户名|密码"></textarea></label><p>批量代理仅用于本次配置预览；提交账号时按服务器代理库格式保存。</p></div>
        <p>字段与服务器代理库一致；到期前 3 天提醒，过期后不会分配给账号。</p>
      </div>
      <p data-network-info></p>
      <div class="notice" role="status" data-login-info></div>
      <div class="client-tools" data-chat-tools hidden><span data-chat-status>正在检测抖音聊天…</span><button type="button" data-chat-install hidden>下载并安装</button><button type="button" class="primary" data-chat-new hidden>添加新账号</button><button type="button" data-chat-capture hidden>重新读取</button></div>
      <div class="client-tools" data-creator-tools hidden><span data-creator-status>创作者中心尚未登录</span><button type="button" class="primary" data-creator-new>添加新账号</button><button type="button" data-creator-capture>重新读取</button></div>
      <div class="account-progress" data-progress-area hidden><div class="account-progress-track"><div class="account-progress-bar" data-progress-bar></div></div><div class="account-progress-meta"><span data-progress-label>准备中</span><span data-progress-percent>0%</span></div></div>
      <details><summary data-steps-summary>登录步骤（尚未开始）</summary><ol>
        <li data-step="installed">检查当前登录方式</li>
        <li data-step="login">完成登录</li>
        <li data-step="captured">读取身份并上传服务器</li>
        <li data-step="synced">同步到网页账号</li>
      </ol><p>账号资料以服务器为准；本机只缓存加密身份材料以供协议调用。</p></details>
      <footer><button type="button" data-close>关闭</button><button type="button" class="primary" data-finish hidden disabled>完成网页任务</button></footer>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const loginMessages = {
    creator: '请在创作者中心完成登录；登录器只读取身份材料，不保存会话消息。',
    douyin_chat: '请打开抖音聊天并完成登录；登录器会自动采集身份并加入本机账号列表。',
  };
  const networkMessages = {
    direct: '直连，不使用代理；登录、会话和发送由云端服务直接完成。',
    custom: '请填写代理地址（IP:端口）和认证信息；也可以批量新增。',
    local_node: '登录、会话和发送由当前电脑执行；登录器需保持在线。'
  };
  let chatTimer;
  let creatorTimer;
  let activeTask = null;
  let reloginAccount = null;
  let selectedProxyId = '';
  let captureInFlight = false;
  let creatorCaptureInFlight = false;
  let captureComplete = false;
  let generation = 0;
  let watchDeadline = 0;
  let installInFlight = false;
  let installProgressTimer;
  let timeoutInFlight = false;
  let uploaded = false;
  let preparedForNewAccount = false;
  // Automatic polling may perform one native controlled close after the
  // current login has produced a fresh, stable UID profile. Manual reading
  // remains available as the explicit fallback.
  let localAccountCount = 0;
  let stepPhase = 'start';
  const finishButton = dialog.querySelector('[data-finish]');
  const info = dialog.querySelector('[data-login-info]');
  const captureButton = dialog.querySelector('[data-chat-capture]');
  const chatSelected = () => form.elements.loginMode.value === 'douyin_chat';
  const creatorSelected = () => form.elements.loginMode.value === 'creator';
  const networkOptions = () => ({
    networkMode: form.elements.networkMode.value,
    proxyId: form.elements.networkMode.value === 'custom' && !form.elements.proxyAddress.value.trim() ? selectedProxyId || reloginAccount?.proxyId || '' : '',
    proxyProtocol: form.elements.proxyProtocol.value,
    proxyAddress: form.elements.proxyAddress.value.trim(),
    proxyUsername: form.elements.proxyUsername.value,
    proxyPassword: form.elements.proxyPassword.value,
    proxyExpiresAt: form.elements.proxyExpiresAt.value || null,
  });
  const creatorLoginOptions = () => ({
    ...networkOptions(),
    accountId: reloginAccount?.id || activeTask?.payload?.accountId || '',
    expectedUid: reloginAccount?.uid || activeTask?.payload?.expectedUid || ''
  });
  const proxyBatchButton = dialog.querySelector('[data-proxy-batch]');
  const stepLabels = {
    start: '尚未开始', checking: '正在检查客户端', ready: '客户端已就绪', preparing: '正在准备新账号', login: '等待登录完成',
    capturing: '正在采集登录身份', captured: '登录身份已采集', complete: '已完成'
  };
  const progressMap = {
    start: [0, '尚未开始'], checking: [10, '正在检查抖音聊天'], downloading: [25, '正在下载官方安装包'],
    verifying: [45, '正在校验安装包'], installing: [65, '正在安装抖音聊天'], preparing: [70, '正在准备新账号'],
    launching: [78, '正在启动抖音聊天'], login: [85, '等待完成登录'], capturing: [92, '正在读取登录身份'],
    captured: [97, '身份已读取'], complete: [100, '已完成'], error: [0, '处理失败']
  };
  const creatorProgressMap = {
    start: [0, '尚未开始'], checking: [10, '正在检查创作者中心状态'], login: [35, '等待完成创作者中心登录'],
    capturing: [70, '正在读取创作者中心身份'], captured: [88, '身份已读取，正在同步网页账号'],
    complete: [100, '创作者账号已同步'], error: [0, '创作者账号同步失败']
  };
  function setFlowLabels() {
    const creator = creatorSelected();
    const labels = creator
      ? { installed: '打开创作者中心', login: '完成创作者中心登录', captured: '读取创作者身份并加入列表', synced: '同步到网页账号' }
      : { installed: '检查抖音聊天安装状态', login: '打开抖音聊天并完成登录', captured: '采集身份并上传服务器', synced: '确认服务器账号资料' };
    for (const [name, text] of Object.entries(labels)) {
      const item = dialog.querySelector(`[data-step="${name}"]`);
      if (item) item.textContent = text;
    }
  }
  function setProgress(phase) {
    const map = creatorSelected() ? creatorProgressMap : progressMap;
    const [percent, label] = map[phase] || map.start;
    const area = dialog.querySelector('[data-progress-area]');
    // Selecting a login mode is not an operation.  Keep the progress area
    // hidden until the user starts opening/capturing a client identity.
    if (area) area.hidden = phase === 'start' || !(chatSelected() || creatorSelected());
    const bar = dialog.querySelector('[data-progress-bar]');
    const text = dialog.querySelector('[data-progress-label]');
    const value = dialog.querySelector('[data-progress-percent]');
    if (bar) bar.style.width = `${percent}%`;
    if (text) text.textContent = label;
    if (value) value.textContent = `${percent}%`;
  }
  function setStepPhase(phase) {
    stepPhase = phase;
    setFlowLabels();
    setProgress(phase);
    const summary = dialog.querySelector('[data-steps-summary]');
    if (summary) summary.textContent = `登录步骤（${stepLabels[phase] || stepLabels.start}）`;
    const order = { installed: creatorSelected() ? ['checking', 'login', 'capturing', 'captured', 'complete'].includes(phase) : ['ready', 'preparing', 'login', 'capturing', 'captured', 'complete'].includes(phase),
      login: ['login', 'capturing', 'captured', 'complete'].includes(phase),
      captured: ['captured', 'complete'].includes(phase), synced: phase === 'complete' };
    for (const [name, done] of Object.entries(order)) {
      const item = dialog.querySelector(`[data-step="${name}"]`);
      if (item) item.textContent = `${done ? '✓ ' : ''}${item.textContent.replace(/^✓ /, '')}`;
    }
  }
  const stopWatch = () => { clearTimeout(chatTimer); chatTimer = undefined; watchDeadline = 0; };
  async function expireLoginWait() {
    if (timeoutInFlight || !dialog.open) return;
    timeoutInFlight = true;
    stopWatch();
    setProgress('error');
    info.textContent = '等待登录已超过 5 分钟，正在取消网页任务…';
    try {
      if (activeTask) {
        const result = await window.douyinjuhe.completeAccountTask({ id: activeTask.id, status: 'cancelled' });
        if (result?.error) throw new Error(result.error);
        activeTask = null;
      }
      info.textContent = '登录等待已超时，网页任务已取消；可以关闭后重新添加账号。';
    } catch (error) {
      info.textContent = `登录等待已超时，但任务取消失败：${error.message || '请重试'}`;
    } finally { timeoutInFlight = false; }
  }
  function scheduleCapture() {
    clearTimeout(chatTimer);
    if (!dialog.open || !chatSelected() || captureComplete || !watchDeadline) return;
    if (Date.now() >= watchDeadline) { expireLoginWait(); return; }
    // Automatic polling must never restart or terminate the client.  The
    // user may still be in the QR/login flow; a controlled restart is only
    // allowed after an explicit "重新读取" click.
    chatTimer = setTimeout(() => captureIdentity({ manual: false }), 1000);
  }
  function scheduleCreatorCapture() {
    clearTimeout(creatorTimer);
    if (!dialog.open || !creatorSelected() || captureComplete) return;
    creatorTimer = setTimeout(() => captureCreatorIdentity({ auto: true }), 3000);
  }
  async function captureCreatorIdentity({ auto = false } = {}) {
    if (!dialog.open || !creatorSelected() || captureComplete || creatorCaptureInFlight) return;
    creatorCaptureInFlight = true;
    const current = generation;
    const task = activeTask;
    try {
      const state = await window.douyinjuhe.creatorLoginState();
      if (!state?.open) {
        if (current === generation && dialog.open) {
          setStepPhase('start');
          info.textContent = '创作者中心尚未打开；请点击“添加新账号”后登录。';
        }
        return;
      }
      setStepPhase('capturing');
      info.textContent = '正在读取创作者中心登录状态…';
      const accountId = reloginAccount?.id || task?.payload?.accountId || '';
      const expectedUid = reloginAccount?.uid || task?.payload?.expectedUid || '';
      const result = await window.douyinjuhe.captureCreator({ accountId, expectedUid, taskId: task?.id || '', note: form.elements.note.value });
      if (current !== generation || !dialog.open) return;
      if (result.error) throw Object.assign(new Error(result.error), { retryable: true });
      captureComplete = true; uploaded = result.uploaded; stopWatch();
      if (result.localAccount) window.dispatchEvent(new CustomEvent('douyinjuhe:local-account-updated', { detail: result.localAccount }));
      info.textContent = uploaded
        ? '创作者账号已加入本地列表并同步网页。'
        : '创作者账号已加入本地列表，但尚未同步网页。' + (result.uploadError || '');
      // 97% used to look like a successful finish while the server account
      // was still missing.  Keep the local capture step visible, but expose
      // the failed server upload instead of leaving the flow ambiguous.
      setStepPhase(uploaded ? (task ? 'captured' : 'complete') : 'error');
    if (task && uploaded) {
        const receipt = await window.douyinjuhe.completeAccountTask({ id: task.id, status: 'unverified' });
        if (receipt.error) { info.textContent += '网页任务回执提交失败，可重试。'; finishButton.hidden = false; finishButton.disabled = false; }
        else { activeTask = null; info.textContent += '已同步网页任务。'; setStepPhase('complete'); }
      }
    } catch (error) {
      if (current === generation && dialog.open) {
        if (auto) {
          const message = error.message || '读取创作者登录状态失败';
          const stillWaiting = /尚未登录|缺少 sessionid|资料未返回有效 UID|登录窗口未打开/.test(message);
          info.textContent = stillWaiting
            ? '等待创作者中心登录完成，登录后会自动读取…'
            : `创作者登录读取失败：${message}；3 秒后重试`;
          setStepPhase(stillWaiting ? 'login' : 'error');
        } else {
          info.textContent = error.message || '尚未检测到创作者中心登录状态。';
          setProgress('error');
        }
      }
    } finally {
      creatorCaptureInFlight = false;
      if (auto && current === generation) scheduleCreatorCapture();
    }
  }
  async function refreshChat() {
    const current = generation;
    const status = dialog.querySelector('[data-chat-status]');
    const button = dialog.querySelector('[data-chat-install]');
    const capture = dialog.querySelector('[data-chat-capture]');
    const addNew = dialog.querySelector('[data-chat-new]');
    try {
      const [result, local] = await Promise.all([window.douyinjuhe.douyinChatState(), window.douyinjuhe.localAccounts()]);
      if (current !== generation || !dialog.open) return;
      localAccountCount = Array.isArray(local?.accounts) ? local.accounts.length : 0;
      if (result.error) throw new Error(result.error);
      const busy = ['downloading', 'verifying', 'installing', 'preparing'].includes(result.phase);
      status.textContent = result.installed ? `已安装抖音聊天 ${result.version}` : (result.message || '未检测到抖音聊天客户端');
      button.hidden = result.installed;
      button.disabled = busy;
      button.textContent = busy ? '处理中…' : '下载并安装';
      addNew.hidden = !result.installed;
      addNew.disabled = busy;
      capture.hidden = !result.installed;
      capture.disabled = busy || captureInFlight || captureComplete;
    } catch { if (current === generation) { status.textContent = '客户端检测失败'; button.hidden = true; setProgress('error'); } }
  }
  async function refreshCreator() {
    if (!creatorSelected() || !dialog.open) return;
    try {
      const result = await window.douyinjuhe.creatorLoginState();
      if (result.error) throw new Error(result.error);
      const status = dialog.querySelector('[data-creator-status]');
      status.textContent = result.message || (result.open ? '创作者中心已打开，请完成登录' : '创作者中心尚未登录');
      if (result.phase === 'captured') { setStepPhase('captured'); return; }
      scheduleCreatorCapture();
    } catch (error) { dialog.querySelector('[data-creator-status]').textContent = error.message || '创作者状态读取失败'; }
  }
  async function captureIdentity({ manual = false } = {}) {
    if (!dialog.open || !chatSelected() || captureComplete) return;
    if (captureInFlight) { scheduleCapture(); return; }
    const current = generation;
    const task = activeTask;
    captureInFlight = true; captureButton.disabled = true;
    info.textContent = '正在读取本机登录身份…';
    // Automatic probes are readiness checks. Keep the UI at the login phase
    // until a complete UID/material result exists; otherwise every failed
    // probe makes the progress bar oscillate between 85% and 92%.
    if (manual) setStepPhase('capturing');
    try {
      const result = await window.douyinjuhe.captureDouyinChat({ accountId: task?.payload?.accountId || '',
        taskId: task?.id || '', note: form.elements.note.value,
        automatic: !manual,
        // The native side decides: it tries one read a second after the login
        // marker appears, and closes the client only after the ten-second
        // settle window. Manual reads remain the explicit fallback.
        allowClientRestart: true });
      if (current !== generation || !dialog.open) return;
      if (result.error) throw Object.assign(new Error(result.error), { retryable: result.retryable });
      captureComplete = true;
      preparedForNewAccount = false;
      uploaded = result.uploaded;
      stopWatch();
      if (result.localAccount) window.dispatchEvent(new CustomEvent('douyinjuhe:local-account-updated', { detail: result.localAccount }));
      info.textContent = '账号已加入本地列表，未绑定坑位、未激活；平台在线状态尚未验证。';
      // A standalone add is complete once the encrypted local account is saved.
      // Keep 97% only when a web task still needs material upload or receipt.
      setStepPhase(task ? 'captured' : 'complete');
      if (result.uploadError) info.textContent += result.uploadError;
      if (task && uploaded) {
        const receipt = await window.douyinjuhe.completeAccountTask({ id: task.id, status: 'unverified' });
        if (current !== generation || !dialog.open) return;
        if (receipt.error) {
          info.textContent += '网页任务回执提交失败，可点击“完成网页任务”重试。';
          finishButton.hidden = false; finishButton.disabled = false;
        } else { activeTask = null; info.textContent += '已同步网页任务。'; setStepPhase('complete'); }
      }
    } catch (error) {
      if (current === generation && dialog.open) {
        info.textContent = !manual
          ? '等待抖音聊天登录完成，身份稳定后将自动读取。'
          : (error.message || '尚未检测到已登录的抖音聊天账号。');
        // A failed automatic probe is expected while the user is still
        // scanning or while Chromium has the cookie database locked. Keep
        // polling and leave the login window alive; manual reads remain
        // terminal so their error is actionable.
        const retryable = error.retryable || !manual;
        if (!retryable) stopWatch();
        setProgress(retryable ? 'login' : 'error');
      }
    } finally {
      captureInFlight = false;
      if (current === generation) captureButton.disabled = captureComplete;
      scheduleCapture();
    }
  }
  function update() {
    const values = new FormData(form);
    dialog.querySelector('[data-login-info]').textContent = loginMessages[values.get('loginMode')];
    dialog.querySelector('[data-network-info]').textContent = networkMessages[values.get('networkMode')];
    dialog.querySelector('[data-custom]').hidden = values.get('networkMode') !== 'custom';
    if (values.get('networkMode') !== 'custom') dialog.querySelector('[data-proxy-batch-panel]').hidden = true;
    if (values.get('networkMode') === 'local_node' && dialog.open && window.douyinjuhe.localNodeState) {
      window.douyinjuhe.localNodeState().then(result => {
        if (form.elements.networkMode.value !== 'local_node') return;
        dialog.querySelector('[data-network-info]').textContent = result?.ip
          ? `本机公网出口：${result.ip}；登录器需保持在线`
          : '本机节点尚未连接，连接后显示公网出口；登录器需保持在线。';
      }).catch(() => {});
    }
    const selected = chatSelected();
    dialog.querySelector('[data-chat-tools]').hidden = !selected;
    dialog.querySelector('[data-creator-tools]').hidden = !creatorSelected();
    setFlowLabels();
    if (selected && dialog.open) refreshChat();
    if (creatorSelected() && dialog.open) refreshCreator();
  }
  form.addEventListener('change', event => {
    if (event.target.name === 'loginMode') {
      generation++; stopWatch(); clearTimeout(creatorTimer); captureComplete = false; preparedForNewAccount = false; reloginAccount = null; selectedProxyId = ''; stepPhase = 'start'; setStepPhase('start'); finishButton.hidden = true; uploaded = false; update();
    } else if (event.target.name === 'networkMode') { if (event.target.value !== 'custom') selectedProxyId = ''; update(); }
  });
  proxyBatchButton.addEventListener('click', () => {
    const panel = dialog.querySelector('[data-proxy-batch-panel]');
    panel.hidden = !panel.hidden;
  });
  form.addEventListener('submit', event => event.preventDefault());
  async function cancelTask() {
    const current = ++generation;
    stopWatch();
    try {
      if (activeTask) {
        const result = await window.douyinjuhe.completeAccountTask({ id: activeTask.id, status: captureComplete && uploaded ? 'unverified' : 'cancelled' });
        if (result.error) throw new Error(result.error);
      }
      if (current === generation) dialog.close();
    } catch (error) { if (current === generation) info.textContent = error.message; }
  }
  dialog.querySelector('[data-close]').addEventListener('click', cancelTask);
  dialog.addEventListener('cancel', event => { event.preventDefault(); cancelTask(); });
  dialog.querySelector('[data-chat-install]').addEventListener('click', async () => {
    if (!confirm('将从抖音官方 CDN 下载已校验的抖音聊天 1.1.33，并请求管理员权限静默安装。是否继续？')) return;
    if (installInFlight) return;
    const current = generation;
    const button = dialog.querySelector('[data-chat-install]');
    installInFlight = true;
    button.disabled = true;
    setProgress('downloading');
    clearInterval(installProgressTimer);
    installProgressTimer = setInterval(() => { refreshChat().catch(() => {}); }, 500);
    try {
      const result = await window.douyinjuhe.installDouyinChat();
      if (current !== generation || !dialog.open) return;
      if (result.error) {
        dialog.querySelector('[data-chat-status]').textContent = result.error;
        setProgress('error');
        return;
      }
      await refreshChat();
      if (result.installed) {
        // Match the cloud flow: once the official package has finished
        // installing, open the client immediately so the user can scan/login
        // without having to click a second button.
        dialog.querySelector('[data-chat-status]').textContent = '抖音聊天已安装，正在打开…';
        await launchAndWatch();
      }
    } catch { if (current === generation) info.textContent = '安装请求失败，请重试。'; }
    finally { clearInterval(installProgressTimer); installProgressTimer = undefined; installInFlight = false; button.disabled = false; }
  });
  async function launchAndWatch() {
    const current = generation;
    setProgress('launching');
    try {
      const result = await window.douyinjuhe.launchDouyinChat(networkOptions());
      if (result?.proxyId) selectedProxyId = result.proxyId;
      if (current !== generation || !dialog.open) return;
      if (result.error) { info.textContent = result.error; return; }
      info.textContent = result.message || '抖音聊天已启动，请完成登录。';
      setStepPhase('login');
      captureComplete = false; preparedForNewAccount = false; watchDeadline = Date.now() + 5 * 60 * 1000;
      scheduleCapture();
    } catch (error) { if (current === generation) { info.textContent = error?.message ? `抖音聊天启动失败：${error.message}` : '抖音聊天启动失败，请重试。'; setProgress('error'); } }
  }
  dialog.querySelector('[data-chat-new]').addEventListener('click', async () => {
    if (localAccountCount > 0 && !confirm('将关闭抖音聊天并清理当前客户端登录状态，以便登录新账号；登录完成后会短暂重启一次以读取身份。抖音聚合中已保存的账号不会删除。是否继续？')) return;
    const current = generation;
    const button = dialog.querySelector('[data-chat-new]');
    button.disabled = true;
    captureComplete = false;
    stopWatch();
    setStepPhase('preparing');
    info.textContent = '正在关闭抖音聊天并清理登录状态…';
    try {
      const result = await Promise.race([
        window.douyinjuhe.prepareDouyinChatLogin(networkOptions()),
        new Promise((_, reject) => setTimeout(() => reject(new Error('准备新账号超时，请完全退出抖音聊天后重试。')), 15000))
      ]);
      if (result?.proxyId) selectedProxyId = result.proxyId;
      if (current !== generation || !dialog.open) return;
      if (result.error) throw new Error(result.error);
      preparedForNewAccount = true;
          info.textContent = result.message || '已准备新的抖音聊天登录状态，请登录新账号。';
      setStepPhase('login');
      watchDeadline = Date.now() + 5 * 60 * 1000;
      scheduleCapture();
      await refreshChat();
    } catch (error) {
      if (current === generation) { info.textContent = error.message || '新账号登录准备失败，请重试。'; setProgress('error'); }
    } finally { if (current === generation) button.disabled = false; }
  });
  dialog.querySelector('[data-chat-capture]').addEventListener('click', async () => {
    await captureIdentity({ manual: true });
  });
  dialog.querySelector('[data-creator-capture]').addEventListener('click', captureCreatorIdentity);
  dialog.querySelector('[data-creator-new]').addEventListener('click', async () => {
    const button = dialog.querySelector('[data-creator-new]');
    if (creatorCaptureInFlight) return;
    button.disabled = true;
    try {
      const result = await window.douyinjuhe.newCreatorLogin(creatorLoginOptions());
      if (result?.error) throw new Error(result.error);
      generation++;
      captureComplete = false;
      uploaded = false;
      setStepPhase('login');
      info.textContent = '已打开全新的创作者中心登录窗口，请登录新账号后点击“重新读取”。';
      dialog.querySelector('[data-creator-status]').textContent = '请登录要添加的新创作者账号';
      scheduleCreatorCapture();
    } catch (error) { info.textContent = error.message || '新创作者账号窗口打开失败'; setProgress('error'); }
    finally { button.disabled = false; }
  });
  dialog.querySelector('[data-finish]').addEventListener('click', async () => {
    if (!activeTask || !uploaded) return;
    const button = dialog.querySelector('[data-finish]');
    button.disabled = true;
    try {
      const result = await window.douyinjuhe.completeAccountTask({ id: activeTask.id, status: 'unverified' });
      if (result.error) throw new Error(result.error);
      dialog.querySelector('[data-login-info]').textContent = '账号资料已同步到服务器，本机仅缓存加密身份材料；平台在线状态尚未验证。';
      activeTask = null;
      button.hidden = true;
      setStepPhase('complete');
    } catch (error) { dialog.querySelector('[data-login-info]').textContent = error.message; button.disabled = false; }
  });
  dialog.addEventListener('close', () => { generation++; stopWatch(); clearTimeout(creatorTimer); creatorTimer = undefined; clearInterval(installProgressTimer); installProgressTimer = undefined; timeoutInFlight = false; activeTask = null; reloginAccount = null; captureComplete = false; creatorCaptureInFlight = false; preparedForNewAccount = false; localAccountCount = 0; stepPhase = 'start'; uploaded = false; finishButton.hidden = true; finishButton.disabled = true; form.reset(); dialog.querySelector('details').open = false; setStepPhase('start'); update(); });
  document.querySelector('#add-account').addEventListener('click', async () => {
    try {
      const state = await window.douyinjuhe.nodeState();
      if (!state?.loggedIn) {
        document.querySelector('#node-error').textContent = '请先登录抖音聚合租户账号，再添加账号。';
        return;
      }
      document.querySelector('#node-error').textContent = '';
      if (!dialog.open) { generation++; dialog.showModal(); update(); }
    } catch (error) { document.querySelector('#node-error').textContent = error.message || '无法确认当前租户登录状态。'; }
  });
  window.addEventListener('douyinjuhe:relogin-account', async event => {
    const account = event.detail;
    if (!account || !dialog) return;
    generation++; stopWatch(); activeTask = null; reloginAccount = account; selectedProxyId = account.proxyId || ''; captureComplete = false; uploaded = false; preparedForNewAccount = false; finishButton.hidden = true; finishButton.disabled = true;
    const mode = account.loginMode === 'creator' ? 'creator' : 'douyin_chat';
    const modeInput = dialog.querySelector(`[name="loginMode"][value="${mode}"]`);
    if (modeInput) modeInput.checked = true;
    const networkMode = account.networkMode || (account.proxyId ? 'custom' : 'direct');
    const networkInput = dialog.querySelector(`[name="networkMode"][value="${networkMode}"]`);
    if (networkInput) networkInput.checked = true;
    form.elements.note.value = account.note || account.nickname || account.name || '';
    if (!dialog.open) dialog.showModal();
    update(); setStepPhase('login');
    info.textContent = '该账号登录态已失效，请重新登录后点击“重新读取”。';
    if (mode === 'creator') {
      try {
        const result = await window.douyinjuhe.newCreatorLogin(creatorLoginOptions());
        if (result?.error) throw new Error(result.error);
        dialog.querySelector('[data-creator-status]').textContent = '已打开新的创作者中心登录窗口，请完成登录。';
      } catch (error) { info.textContent = error.message || '创作者中心重登窗口打开失败'; setProgress('error'); }
    } else {
      try {
        const result = await window.douyinjuhe.launchDouyinChat(networkOptions());
        if (result?.proxyId) selectedProxyId = result.proxyId;
        if (result?.error) throw new Error(result.error);
        dialog.querySelector('[data-chat-status]').textContent = '抖音聊天已打开，请重新登录后点击“重新读取”。';
        watchDeadline = Date.now() + 5 * 60 * 1000; scheduleCapture();
      } catch (error) { info.textContent = error.message || '抖音聊天打开失败'; setProgress('error'); }
    }
  });
  if (window.douyinjuhe.onAccountTask) {
    window.douyinjuhe.onAccountTask(async task => {
      if (!task || task.type !== 'add_account') return;
      generation++; stopWatch();
      activeTask = task;
      captureComplete = false;
      finishButton.hidden = true;
      finishButton.disabled = true;
      const accountId = task.payload?.accountId || '';
      const note = dialog.querySelector('#account-note');
      if (!dialog.open) dialog.showModal();
      const douyinChat = dialog.querySelector('[value="douyin_chat"]');
      if (task.payload?.loginMode === 'douyin_chat') douyinChat.checked = true;
      update();
      note.value = accountId ? `登录任务 ${accountId.slice(0, 8)}` : '登录任务';
      dialog.querySelector('details').open = true;
      dialog.querySelector('[data-login-info]').textContent = '收到新增账号任务。登录完成后将自动采集抖音聊天身份。';
      if (task.payload?.loginMode === 'douyin_chat') {
        await launchAndWatch();
      } else if (task.payload?.loginMode === 'creator') {
        try { await window.douyinjuhe.openCreatorLogin(creatorLoginOptions()); setStepPhase('login'); } catch (error) { info.textContent = error.message || '创作者中心打开失败'; }
      }
      dialog.querySelector('[data-close]').focus();
    });
  }
})();
