// 本机一键启动：缺依赖就安装，缺网页构建产物就构建，然后启动后端。
// 后端同时托管网页，全部在 http://127.0.0.1:18182。
// 用法：npm start（或双击 start.bat）
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`需要 Node.js 22.5 或更高版本，当前是 ${process.versions.node}`);
  process.exit(1);
}
const run = (command, why) => {
  console.log(`${why}：${command}`);
  const result = spawnSync(command, { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) { console.error(`${why}失败`); process.exit(1); }
};
if (!existsSync(`${root}node_modules/ws`) || !existsSync(`${root}node_modules/vite`)) run('npm ci --no-audit --no-fund', '安装依赖');
if (!existsSync(`${root}apps/web/dist/index.html`)) run('npm run build:web', '构建网页');

// 管理后台入口密钥：未显式配置时在数据目录生成一个并复用，启动时打印完整后台地址。
const dataDir = resolve(process.env.DOUYINJUHE_DATA_DIR || `${root}data`);
const entryFile = join(dataDir, 'admin-entry.key');
if (!process.env.DOUYINJUHE_ADMIN_ENTRY) {
  mkdirSync(dataDir, { recursive: true });
  let key = existsSync(entryFile) ? readFileSync(entryFile, 'utf8').trim() : '';
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
    key = randomBytes(18).toString('base64url');
    writeFileSync(entryFile, `${key}\n`, { mode: 0o600 });
  }
  process.env.DOUYINJUHE_ADMIN_ENTRY = key;
}
const port = Number(process.env.DOUYINJUHE_API_PORT || 18182);
await import('../services/api/src/index.js');
console.log(`网页：      http://127.0.0.1:${port}/`);
console.log(`管理后台：  http://127.0.0.1:${port}/#admin-${process.env.DOUYINJUHE_ADMIN_ENTRY}`);
