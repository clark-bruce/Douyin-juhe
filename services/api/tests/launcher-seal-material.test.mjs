// 离线测试：登录器辅助程序 seal_material.exe（由 tools/build-launcher.ps1 从源码打包）
// 产出的信封能被后端同样的算法（RSA-OAEP-256 + AES-256-GCM）解开。使用临时生成的密钥和假材料。
// 未构建登录器时自动跳过。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, privateDecrypt, createDecipheriv, constants } from 'node:crypto';

const helper = fileURLToPath(new URL('../../../build/launcher/payload/launcher-webview2/native/bin/seal_material.exe', import.meta.url));

test('seal_material.exe 的信封可用私钥解开', { skip: !existsSync(helper) && '登录器尚未构建' }, () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const material = { kind: 'creator_web', uid: '111', cookie: 'sessionid=fake', note: '中文' };
  // 辅助程序按系统默认编码读取标准输入，这里把非 ASCII 字符写成 \uXXXX，避免测试结果依赖本机代码页。
  const input = JSON.stringify({ publicKey: publicKey.export({ type: 'spki', format: 'pem' }), material })
    .replace(/[^\x00-\x7f]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  const run = spawnSync(helper, [], { input, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const envelope = JSON.parse(Buffer.from(run.stdout.trim(), 'base64').toString('utf8'));
  assert.equal(envelope.alg, 'RSA-OAEP-256+A256GCM');
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(envelope.key, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
  assert.deepEqual(JSON.parse(plain), material);
});
