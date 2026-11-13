(() => {
  document.body.classList.add('booting');
  const form = document.querySelector('#node-bind');
  const loginForm = document.querySelector('#node-login');
  const logout = document.querySelector('#launcher-logout');
  const userLabel = document.querySelector('#launcher-user');
  const error = document.querySelector('#node-error');
  let previousBound = null;
  async function refresh() {
    try {
      const state = await window.douyinjuhe.nodeState();
      document.querySelector('#node-status').textContent = state.error || state.message;
      loginForm.hidden = Boolean(state.bound);
      document.body.classList.toggle('logged-out', !state.bound);
      logout.hidden = !state.bound;
      userLabel.textContent = state.bound ? (state.user?.name || '已登录') : '未登录';
      form.hidden = true;
      if (previousBound !== state.bound) {
        previousBound = state.bound;
        window.dispatchEvent(new CustomEvent(state.bound ? 'douyinjuhe:node-connected' : 'douyinjuhe:node-disconnected'));
      }
    } catch { document.querySelector('#node-status').textContent = '设备状态不可用'; }
  }
  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = loginForm.querySelector('button');
    button.disabled = true; error.textContent = '';
    try {
      const result = await window.douyinjuhe.loginNode({
        name: document.querySelector('#tenant-name').value,
        password: document.querySelector('#tenant-password').value,
      });
      if (result.error) error.textContent = result.error;
      else { document.querySelector('#tenant-password').value = ''; await refresh(); window.dispatchEvent(new Event('douyinjuhe:node-connected')); }
    } catch (cause) { error.textContent = cause?.message || '登录失败，请检查账号密码和服务连接。'; }
    finally { button.disabled = false; }
  });
  logout.addEventListener('click', async () => {
    logout.disabled = true; error.textContent = '';
    try { const result = await window.douyinjuhe.logoutNode(); if (result?.error) error.textContent = result.error; }
    catch (cause) { error.textContent = cause?.message || '退出登录失败，请重试。'; }
    finally { logout.disabled = false; await refresh(); }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true; error.textContent = '';
    try {
      const result = await window.douyinjuhe.bindNode(document.querySelector('#pair-code').value);
      if (result.error) error.textContent = result.error;
      else document.querySelector('#pair-code').value = '';
      await refresh();
    } catch { error.textContent = '绑定失败，请检查连接后重试'; }
    finally { button.disabled = false; }
  });
  refresh().finally(() => document.body.classList.remove('booting'));
  setInterval(refresh, 15000);
})();
