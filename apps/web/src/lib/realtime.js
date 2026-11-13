import { currentSession } from './api.js';

export function createRealtime({ onEvent, onStatus }) {
  let socket = null, timer = null, stopped = false, attempt = 0, accountIds = [];
  const status = value => onStatus?.(value);
  function subscribe() { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'subscribe', accountIds })); }
  function connect() {
    clearTimeout(timer);
    const token = currentSession()?.token;
    if (stopped || !token) { status('offline'); return; }
    status(attempt ? 'reconnecting' : 'connecting');
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/api/v1/realtime`);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'authenticate', token })));
    socket.addEventListener('message', event => {
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'authenticated') { attempt = 0; status('online'); subscribe(); }
      if (message.type === 'event') onEvent?.(message);
    });
    socket.addEventListener('close', () => { socket = null; if (stopped) return; status('reconnecting'); const delay = Math.min(15000, 1000 * 2 ** Math.min(attempt++, 4)); timer = setTimeout(connect, delay); });
    socket.addEventListener('error', () => socket?.close());
  }
  connect();
  return {
    updateAccounts(ids) { accountIds = [...new Set(ids)]; subscribe(); },
    reconnect() { if (socket) { socket.close(); socket = null; } attempt = 0; connect(); },
    close() { stopped = true; clearTimeout(timer); socket?.close(); socket = null; status('offline'); }
  };
}
