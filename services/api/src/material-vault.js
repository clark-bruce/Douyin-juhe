import { createCipheriv, createDecipheriv, createHash, createPublicKey, generateKeyPairSync, privateDecrypt, randomBytes, constants } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Creator browser_state contains signed localStorage values and is larger than
// a duoshan cookie-only envelope. Keep the same validation rules, with room for
// one bounded Creator state snapshot.
const MAX_ENVELOPE_BYTES = 320 * 1024;
const sha256Hex = value => createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
const cookieValue = (cookie, name) => {
  const match = String(cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`, 'i'));
  return match ? match[1] : '';
};
const b64 = (value, name, max) => {
  if (typeof value !== 'string' || !value || value.length > max || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(`${name}格式无效`);
  return Buffer.from(value, 'base64');
};

function loadOrCreatePrivateKey(database) {
  if (process.env.DOUYINJUHE_MATERIAL_PRIVATE_KEY_B64) {
    return Buffer.from(process.env.DOUYINJUHE_MATERIAL_PRIVATE_KEY_B64, 'base64').toString('utf8');
  }
  if (database === ':memory:') {
    return generateKeyPairSync('rsa', { modulusLength: 3072 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  }
  const filename = resolve(`${database}.material-private.pem`);
  if (existsSync(filename)) return readFileSync(filename, 'utf8');
  mkdirSync(dirname(filename), { recursive: true });
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 3072 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  writeFileSync(filename, privateKey, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return privateKey;
}

export function createMaterialVault(database) {
  const privateKey = loadOrCreatePrivateKey(database);
  const exportedPublicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  const secretKey = createHash('sha256').update(privateKey).digest();
  return {
    publicKey: exportedPublicKey,
    open(encoded) {
      const serialized = b64(encoded, '服务器身份信封', Math.ceil(MAX_ENVELOPE_BYTES * 4 / 3) + 8);
      if (serialized.length > MAX_ENVELOPE_BYTES) throw new Error('服务器身份信封过大');
      let envelope;
      try { envelope = JSON.parse(serialized.toString('utf8')); } catch { throw new Error('服务器身份信封无效'); }
      if (envelope?.v !== 1 || envelope?.alg !== 'RSA-OAEP-256+A256GCM') throw new Error('服务器身份信封版本无效');
      const encryptedKey = b64(envelope.key, '信封密钥', 2048);
      const iv = b64(envelope.iv, '信封 IV', 64);
      const tag = b64(envelope.tag, '信封标签', 64);
      const ciphertext = b64(envelope.data, '信封数据', Math.ceil(MAX_ENVELOPE_BYTES * 4 / 3) + 8);
      if (iv.length !== 12 || tag.length !== 16) throw new Error('服务器身份信封参数无效');
      const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, encryptedKey);
      try {
        if (key.length !== 32) throw new Error('服务器身份信封密钥无效');
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        const material = JSON.parse(plaintext.toString('utf8'));
        if (!material || typeof material !== 'object' || !/^\d{1,30}$/.test(String(material.uid || '')) ||
            typeof material.cookie !== 'string' || material.cookie.length > 65536 || !/(?:^|;\s*)sessionid=[^;\s]+/.test(material.cookie)) {
          throw new Error('服务器身份内容无效');
        }
        const result = { uid: String(material.uid), cookie: material.cookie, cookieNames: Array.isArray(material.cookieNames) ? material.cookieNames.slice(0, 100) : [], version: String(material.version || '').slice(0, 64) };
        if (typeof material.sec_uid === 'string' && /^MS4wLjAB[\w-]{10,200}$/.test(material.sec_uid)) result.sec_uid = material.sec_uid;
        const directInput = material.webImIdentity;
        if (directInput !== undefined) {
          if (!directInput || typeof directInput !== 'object' || Array.isArray(directInput)) throw new Error('Web IM 发送身份材料无效');
          const webImIdentity = {};
          for (const [key, max] of [['transport', 32], ['deviceId', 128], ['device_id', 128], ['identityDeviceId', 128], ['identity_device_id', 128], ['accessKey', 256], ['access_key', 256], ['identitySecurityToken', 4096], ['identity_security_token', 4096], ['verifyFp', 256], ['verify_fp', 256]]) {
            if (directInput[key] === undefined || directInput[key] === null || directInput[key] === '') continue;
            if (typeof directInput[key] !== 'string' || directInput[key].length > max) throw new Error('Web IM 发送身份字段无效');
            webImIdentity[key] = directInput[key];
          }
          if (webImIdentity.transport && !['imapi_http'].includes(webImIdentity.transport)) throw new Error('Web IM 发送传输方式无效');
          result.webImIdentity = webImIdentity;
        }
        if (material.cardIdentity !== undefined) {
          const identity = material.cardIdentity;
          if (!identity || typeof identity !== 'object' || Array.isArray(identity)) throw new Error('卡片身份材料无效');
          const cardIdentity = {};
          for (const [key, max] of [['webId', 64], ['identityDeviceId', 128], ['identityUserId', 64], ['verifyFp', 256], ['identityToken', 4096]]) {
            if (identity[key] === undefined || identity[key] === null || identity[key] === '') continue;
            if (typeof identity[key] !== 'string' || identity[key].length > max) throw new Error('卡片身份字段无效');
            cardIdentity[key] = identity[key];
          }
          if (cardIdentity.webId && !/^\d{8,30}$/.test(cardIdentity.webId)) throw new Error('卡片 Web ID 无效');
          if (cardIdentity.identityUserId && !/^\d{1,30}$/.test(cardIdentity.identityUserId)) throw new Error('卡片身份用户 ID 无效');
          result.cardIdentity = cardIdentity;
        }
        if (material.kind === 'creator_web') {
          if (typeof material.browserState !== 'string' || !material.browserState || material.browserState.length > 100000) throw new Error('创作者浏览器状态无效');
          try {
            const state = JSON.parse(material.browserState);
            if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) throw new Error();
            result.kind = 'creator_web'; result.browserState = material.browserState;
            result.profile = material.profile && typeof material.profile === 'object' ? {
              nickname: String(material.profile.nickname || '').slice(0, 100), douyinId: String(material.profile.douyinId || '').slice(0, 64), avatar: String(material.profile.avatar || '').slice(0, 2048),
            } : {};
            // Optional reference-launcher fields remain inside the encrypted
            // account envelope. Older captures need not supply them.
            for (const [name, max] of [
              ['creator_user_agent', 512], ['web_uid', 40], ['sec_uid', 128],
              ['creator_uid', 40], ['creator_sec_uid', 128], ['creator_unique_id', 64],
              ['msToken', 4096], ['dtrait', 16384], ['private_key', 16384],
              ['ticket', 4096], ['ts_sign', 8192], ['client_cert', 16384],
            ]) {
              if (material[name] === undefined) continue;
              if (typeof material[name] !== 'string' || material[name].length > max) throw new Error('创作者身份字段无效');
              if (name === 'creator_user_agent' && /[\r\n]/.test(material[name])) throw new Error('创作者浏览器 UA 无效');
              if (['web_uid', 'creator_uid'].includes(name) && material[name] && !/^\d{1,30}$/.test(material[name])) throw new Error('创作者身份 UID 无效');
              if (name === 'creator_uid' && material[name] && material[name] !== result.uid) throw new Error('创作者身份 UID 不匹配');
              result[name] = material[name];
            }
            if (material.profileBinding !== undefined) {
              const binding = material.profileBinding;
              if (!binding || typeof binding !== 'object' || String(binding.creatorUid || '') !== result.uid ||
                  !/^uid:\d{1,30}$/.test(String(binding.profileKey || '')) ||
                  !/^[a-f0-9]{64}$/i.test(String(binding.cookieFingerprint || '')) ||
                  !/^[a-f0-9]{64}$/i.test(String(binding.browserStateFingerprint || ''))) throw new Error('Creator Profile 绑定信息无效');
              // The binding is a digest of the exact material captured by the
              // launcher.  Checking it server-side prevents a stale Profile
              // fingerprint from being accepted with a newly uploaded cookie
              // or browser state.
              if (String(binding.cookieFingerprint).toLowerCase() !== sha256Hex(material.cookie) ||
                  String(binding.browserStateFingerprint).toLowerCase() !== sha256Hex(material.browserState)) {
                throw new Error('Creator Profile 与身份材料不匹配');
              }
              const sessionValueHashes = binding.sessionValueHashes && typeof binding.sessionValueHashes === 'object' ? binding.sessionValueHashes : {};
              const safeSessionValueHashes = {};
              for (const [name, value] of Object.entries(sessionValueHashes).slice(0, 12)) {
                if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || !/^[a-f0-9]{64}$/i.test(String(value))) throw new Error('Creator Profile 会话绑定信息无效');
                const current = cookieValue(material.cookie, name);
                if (!current || sha256Hex(current) !== String(value).toLowerCase()) throw new Error('Creator Profile 会话材料不匹配');
                safeSessionValueHashes[name] = String(value).toLowerCase();
              }
              result.profileBinding = {
                creatorUid: result.uid, profileKey: String(binding.profileKey),
                cookieFingerprint: String(binding.cookieFingerprint).toLowerCase(),
                browserStateFingerprint: String(binding.browserStateFingerprint).toLowerCase(),
                sessionValueHashes: safeSessionValueHashes, userAgent: String(binding.userAgent || '').slice(0, 300),
                source: String(binding.source || '').slice(0, 64), updatedAt: Number(binding.updatedAt || 0),
              };
            }
          } catch { throw new Error('创作者浏览器状态格式无效'); }
        }
        return result;
      } finally { key.fill(0); }
    },
    sealSecret(value) {
      if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 4096) throw new Error('AI 密钥无效');
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secretKey, iv);
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.from(JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') })).toString('base64');
    },
    openSecret(encoded) {
      if (typeof encoded !== 'string' || encoded.length > 8192 || !/^[A-Za-z0-9+/=]+$/.test(encoded)) throw new Error('AI 密钥密文无效');
      let envelope;
      try { envelope = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); } catch { throw new Error('AI 密钥密文无效'); }
      if (envelope?.v !== 1) throw new Error('AI 密钥密文版本无效');
      const iv = Buffer.from(envelope.iv || '', 'base64'), tag = Buffer.from(envelope.tag || '', 'base64'), data = Buffer.from(envelope.data || '', 'base64');
      if (iv.length !== 12 || tag.length !== 16 || data.length > 4096) throw new Error('AI 密钥密文参数无效');
      const decipher = createDecipheriv('aes-256-gcm', secretKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    }
  };
}
