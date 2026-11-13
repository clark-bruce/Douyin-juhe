(() => {
  const rows = document.querySelector('[data-account-rows]');
  const count = document.querySelector('[data-account-count]');
  if (!rows || !count || !window.douyinjuhe?.localAccounts) return;

  let accounts = [];
  let revision = 0;
  let tenantLoggedIn = false;
  const error = document.querySelector('#accounts-error');
  const button = document.querySelector('#refresh-accounts');
  const text = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  // 直连账号显示“直连”；代理、本机节点显示实际出口，读不到时才显示“未读取”。
  const ipLabel = account => {
    const mode = account.networkMode || (account.proxyId ? 'custom' : 'direct');
    return mode === 'direct' ? '直连' : (account.currentIp || '未读取');
  };
  const channelLabel = account =>account.loginMode === 'creator' ? '创作者中心' : account.loginMode === 'douyin_chat' ? '抖音聊天' : (account.source || (account.remoteOnly ? '服务器' : '登录器'));

  const walletLabel = document.querySelector('#launcher-wallet');
  let wallet = null;
  // 精确到分钟，例如 2026/10/16 18:30。
  const dateText = value => {
    const date = new Date(value), pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const walletAccount = account => wallet?.accounts?.find(item => item.id === account.remoteId) || null;
  // 过期坑位仍然返回，由渲染处显示“已过期”，而不是回退成坑位 ID。
  const boundSlot = account => {
    const remote = walletAccount(account);
    return remote ? wallet.slots.find(item => item.id === remote.slot && ['bound', 'expired'].includes(item.status) && item.boundAccount === remote.id) : null;
  };
  const slotCell = account => {
    const slot = boundSlot(account);
    if (!slot) return `<span class="account-tag warning">${wallet ? '未绑定' : '读取中'}</span>`;
    const expires = text(dateText(slot.expires));
    const kind = slot.type === 'month' ? '月卡坑位' : '日卡坑位';
    if (slot.status === 'expired' || Number(slot.expires) <= Date.now()) return `<span class="account-tag danger" title="${kind}，到期时间：${expires}">已过期</span>`;
    return `<span class="account-tag source" title="到期：${expires}">${kind} · ${expires}</span>`;
  };
  function renderWallet() {
    if (walletLabel) walletLabel.textContent = wallet ? `正式 ${wallet.balance.formal}　测试 ${wallet.balance.test}` : '正式 —　测试 —';
  }
  async function loadWallet() {
    if (!window.douyinjuhe.nodeWallet || !tenantLoggedIn) { wallet = null; renderWallet(); return; }
    try {
      const result = await window.douyinjuhe.nodeWallet();
      wallet = result && !result.error && result.balance && Array.isArray(result.slots) && Array.isArray(result.accounts) ? result : null;
    } catch { wallet = null; }
    renderWallet();
    render();
  }

  // 内容没变就不重绘，避免定时刷新时头像和按钮闪烁。
  let lastHtml = '';
  function paint(html) {
    if (html === lastHtml) return;
    lastHtml = html;
    rows.innerHTML = html;
  }

  function render() {
    count.textContent = `账号数量：${accounts.length}`;
    if (!accounts.length) {
      paint('<tr><td colspan="8">暂无已连接账号</td></tr>');
      return;
    }
    paint(accounts.map(account => {
      const needsRelogin = account.status === 'reauth' || /需重登|unexpected session length|unexepcted session length/i.test(String(account.statusReason || ''));
      const reloginButton = `<button type="button" class="link ${needsRelogin ? 'danger' : ''}" data-relogin-id="${text(account.id)}">重登</button>`;
      const copyButton = account.remoteOnly
        ? `<button type="button" class="link" disabled title="该账号当前没有保存在本机的身份材料">复制ck</button>`
        : `<button type="button" class="link" data-copy-id="${text(account.id)}">复制ck</button>`;
      const actions = `${reloginButton}${copyButton}<button type="button" class="link success" data-activate-id="${text(account.id)}" ${walletAccount(account)?.active ? 'disabled title="已绑定有效坑位并激活"' : 'title="自动选择最早到期的空闲坑位并激活"'}>一键激活</button><button type="button" class="link danger" data-delete-id="${text(account.id)}">删除</button>`;
      return `
      <tr>
        <td>${account.avatar ? `<img class="account-photo" src="${text(account.avatar)}" alt="" referrerpolicy="no-referrer">` : '<span aria-label="暂无头像" title="暂无头像">—</span>'}</td>
        <td>${text(account.nickname || account.name) || '未获取昵称'}${account.note ? `<small>${text(account.note)}</small>` : ''}</td>
        <td>${text(account.douyinId) || '未获取'}</td>
        <td><span class="account-tag source">${text(channelLabel(account))}</span></td>
        <td>${slotCell(account)}</td>
        <td>${text(ipLabel(account))}</td>
        <td title="${text(account.statusReason || '')}"><span class="account-tag ${account.status === 'reauth' || /需重登|unexpected session length|unexepcted session length/i.test(String(account.statusReason || '')) ? 'danger' : account.status === 'online' ? 'source' : 'warning'}">${account.status === 'reauth' || /需重登|unexpected session length|unexepcted session length/i.test(String(account.statusReason || '')) ? '需重登' : account.status === 'online' ? '在线' : walletAccount(account)?.active ? '已激活' : account.remoteOnly ? '服务器已同步' : '未激活'}</span></td>
        <td><span class="account-actions">${actions}</span></td>
      </tr>`;
    }).join(''));
  }

  function clearForLogout() {
    revision++;
    tenantLoggedIn = false;
    accounts = [];
    error.textContent = '';
    count.textContent = '账号数量：0';
    paint('<tr><td colspan="8">登录抖音聚合租户账号后读取服务器账号列表</td></tr>');
    wallet = null;
    renderWallet();
  }

  async function refresh({ profiles = false } = {}) {
    const current = ++revision;
    // 只有手动点击“刷新列表”才禁用按钮；后台定时刷新不让按钮闪烁。
    if (profiles) button.disabled = true;
    try {
      const result = profiles && window.douyinjuhe.refreshLocalAccountProfiles
        ? await window.douyinjuhe.refreshLocalAccountProfiles()
        : await window.douyinjuhe.localAccounts();
      if (current !== revision) return;
      if (result?.error) throw new Error(result.error);
      if (result?.loggedIn === false) {
        tenantLoggedIn = false;
        accounts = [];
        error.textContent = '';
        count.textContent = '账号数量：0';
        paint('<tr><td colspan="8">登录抖音聚合租户账号后读取服务器账号列表</td></tr>');
        return;
      }
      tenantLoggedIn = true;
      accounts = Array.isArray(result.accounts) ? result.accounts : [];
      error.textContent = result?.serverSynced === false
        ? (result.serverError || '服务器账号资料暂时无法读取，请检查连接后重新读取。')
        : '';
      render();
      loadWallet();
    } catch { if (current === revision) error.textContent = '本地账号列表读取失败，请点击“刷新列表”重试。'; }
    finally { button.disabled = false; }
  }

  window.douyinjuhe.onLocalAccountUpdated?.(account => {
    if (!tenantLoggedIn || !account?.uid) return;
    revision++;
    accounts = [account, ...accounts.filter(row => row.uid !== account.uid)];
    render();
  });
  window.addEventListener('douyinjuhe:local-account-updated', event => {
    const account = event.detail;
    if (!tenantLoggedIn || !account?.uid) return;
    revision++;
    accounts = [account, ...accounts.filter(row => row.uid !== account.uid)];
    render();
  });
  button.addEventListener('click', () => refresh({ profiles: true }));
  window.addEventListener('douyinjuhe:node-connected', () => refresh());
  window.addEventListener('douyinjuhe:node-disconnected', clearForLogout);
  window.addEventListener('focus', () => refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 15000);
  rows.addEventListener('click', async event => {
    const copy = event.target.closest('[data-copy-id]');
    const remove = event.target.closest('[data-delete-id]');
    const relogin = event.target.closest('[data-relogin-id]');
    const activate = event.target.closest('[data-activate-id]');
    if (!copy && !remove && !relogin && !activate) return;
    event.target.disabled = true;
    try {
      if (relogin) {
        const account = accounts.find(row => String(row.id) === String(relogin.dataset.reloginId));
        if (account) window.dispatchEvent(new CustomEvent('douyinjuhe:relogin-account', { detail: account }));
      } else if (activate) {
        const account = accounts.find(row => String(row.id) === String(activate.dataset.activateId));
        if (!account?.remoteId) throw new Error('账号尚未同步到服务器，请先刷新列表或重新登录该账号。');
        const result = await window.douyinjuhe.bindAccountSlot({ remoteId: account.remoteId });
        if (result?.error) throw new Error(result.error);
        error.textContent = '已绑定空闲坑位并激活。';
        await refresh();
        await loadWallet();
      } else if (copy) {
        const result = await window.douyinjuhe.copyLocalAccountCookie(copy.dataset.copyId);
        if (result.error) throw new Error(result.error);
        error.textContent = 'CK 已复制到剪贴板，60 秒后若未被替换将自动清除。';
      } else if (confirm('确定删除这个本地账号？此操作不会注销抖音聊天账号。')) {
        const account = accounts.find(row => String(row.id) === String(remove.dataset.deleteId));
        const result = window.douyinjuhe.deleteAccount
          ? await window.douyinjuhe.deleteAccount(account || { id: remove.dataset.deleteId })
          : await window.douyinjuhe.deleteLocalAccount(remove.dataset.deleteId);
        if (result.error) throw new Error(result.error);
        accounts = result.accounts || [];
        error.textContent = '';
        render();
      }
    } catch (cause) { error.textContent = cause.message || '账号操作失败。'; }
    finally { if (event.target.isConnected) event.target.disabled = false; }
  });
  refresh();
})();
