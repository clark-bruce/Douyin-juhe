import { createApiServer } from './app.js';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const port = Number(process.env.DOUYINJUHE_API_PORT || 18182);
const host = process.env.DOUYINJUHE_API_HOST || '127.0.0.1';
const dataDir = resolve(process.env.DOUYINJUHE_DATA_DIR || fileURLToPath(new URL('../../../data/', import.meta.url)));
mkdirSync(dataDir, { recursive: true });
// 网页目录：显式配置优先；否则在存在构建产物时由后端直接托管，实现单进程部署。
const defaultWebRoot = fileURLToPath(new URL('../../../apps/web/dist/', import.meta.url));
const webRoot = process.env.DOUYINJUHE_WEB_ROOT || (existsSync(defaultWebRoot) ? defaultWebRoot : undefined);
const server = createApiServer({ database: `${dataDir}/douyinjuhe.sqlite`, webRoot });
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, host, () => console.log(`抖音聚合 API http://${host}:${port}${webRoot ? ' （含网页）' : ''}`));
// server.close() alone waits for keep-alive and WebSocket connections forever, so
// systemd had to SIGKILL the service after its stop timeout on every restart.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 3000).unref();
});
