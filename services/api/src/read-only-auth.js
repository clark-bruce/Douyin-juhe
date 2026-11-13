import { createHmac, randomBytes, timingSafeEqual, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function signature(payload, key) {
  return createHmac('sha256', key).update(payload).digest();
}

export function createReadOnlyAuth({ lookupUser, signingKey = randomBytes(32), now = Date.now }) {
  async function login(username, password) {
    if (typeof username !== 'string' || username.length > 128 || typeof password !== 'string' || password.length > 128) {
      const error = new Error('账号或密码错误'); error.status = 401; throw error;
    }
    const user = await lookupUser(username);
    const salt = user?.salt || 'douyinjuhe-invalid-user';
    const actual = await scrypt(password, salt, 64);
    const expected = /^[a-f\d]{128}$/i.test(user?.password || '') ? Buffer.from(user.password, 'hex') : Buffer.alloc(64);
    if (!user || user.disabled || !timingSafeEqual(actual, expected)) {
      const error = new Error('账号或密码错误'); error.status = 401; throw error;
    }
    const payload = Buffer.from(JSON.stringify({ sub: user.id, name: user.name, exp: now() + SESSION_TTL_MS })).toString('base64url');
    const token = `${payload}.${signature(payload, signingKey).toString('base64url')}`;
    return { token, user: { id: user.id, name: user.name }, expiresAt: now() + SESSION_TTL_MS };
  }

  function verify(token) {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !/^[A-Za-z\d_-]+$/.test(parts[0]) || !/^[A-Za-z\d_-]+$/.test(parts[1])) return null;
    const expected = signature(parts[0], signingKey);
    let actual;
    try { actual = Buffer.from(parts[1], 'base64url'); } catch { return null; }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
      const value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      if (typeof value.sub !== 'string' || !Number.isSafeInteger(value.exp) || value.exp <= now()) return null;
      return { id: value.sub, name: String(value.name || '') };
    } catch { return null; }
  }

  return { login, verify, ttlMs: SESSION_TTL_MS };
}
