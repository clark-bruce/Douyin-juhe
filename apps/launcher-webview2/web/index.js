const status = document.querySelector('.notice[role="status"]');
const checkButton = document.querySelector('#check-connection');
const details = document.querySelector('#connection-details');
const updateButton = document.querySelector('#launcher-update');
// 内部版本号带 -webview2 后缀，界面上只显示数字版本。
const shownVersion = value => String(value || '').replace(/-webview2.*$/i, '');
async function check() {
  checkButton.disabled = true;
  status.textContent = '正在检测服务连接…';
  details.textContent = '';
  try {
    const result = await window.douyinjuhe.checkConnection();
    status.textContent = result.ok ? '网页服务已连接；本地账号可独立添加，绑定工作台后可接收网页任务。' : '网页服务未连接；仍可在本机添加和查看账号。';
    details.textContent = result.ok ? '服务连接正常。' : (result.message || '请确认服务已启动');
  } catch { status.textContent = '连接检测失败，请重试。'; }
  finally { checkButton.disabled = false; }
}
checkButton.addEventListener('click', check);
updateButton.addEventListener('click', async () => {
  updateButton.disabled = true;
  status.textContent = '正在检查更新…';
  try {
    const result = await window.douyinjuhe.checkUpdate();
    if (result.error) throw new Error(result.error);
    if (!result.updateAvailable) {
      status.textContent = `已是最新版本（${shownVersion(result.currentVersion)}）。`;
      return;
    }
    if (!window.confirm(`发现新版本 ${shownVersion(result.latestVersion)}，下载并重启登录器吗？`)) {
      status.textContent = `发现新版本 ${shownVersion(result.latestVersion)}，可稍后再次更新。`;
      return;
    }
    status.textContent = '正在下载并校验更新，完成后将自动重启…';
    const installed = await window.douyinjuhe.installUpdate();
    if (installed.error) throw new Error(installed.error);
  } catch (error) {
    status.textContent = `更新检查失败：${error.message || '请稍后重试'}`;
  } finally { updateButton.disabled = false; }
});
check();
