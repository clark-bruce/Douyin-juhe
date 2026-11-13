import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(derive);
const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

export function createBusiness(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT UNIQUE,salt TEXT,password TEXT);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,owner TEXT,expires INTEGER);
    CREATE TABLE IF NOT EXISTS pairs(code TEXT PRIMARY KEY,owner TEXT,expires INTEGER);
    CREATE TABLE IF NOT EXISTS nodes(id TEXT PRIMARY KEY,owner TEXT,name TEXT,token TEXT UNIQUE,expires INTEGER,seen INTEGER);
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,owner TEXT,node TEXT,state TEXT,lease TEXT,until INTEGER,result TEXT,created INTEGER,request TEXT,UNIQUE(owner,request));
    CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,owner TEXT,name TEXT NOT NULL,nickname TEXT DEFAULT '',proxy TEXT DEFAULT '',ws INTEGER DEFAULT 0,listening INTEGER DEFAULT 0,status TEXT DEFAULT 'offline',slot TEXT DEFAULT '',available INTEGER DEFAULT 1,created INTEGER NOT NULL,updated INTEGER NOT NULL);`);
  const attempts = new Map();
  try { db.exec('ALTER TABLE tasks ADD COLUMN payload TEXT'); } catch { /* existing schema already migrated */ }
  try { db.exec("ALTER TABLE tasks ADD COLUMN requestType TEXT NOT NULL DEFAULT 'inspect_client'"); } catch { /* existing schema already migrated */ }
  async function route(req, res) {
    const path = req.url;
    if (!path.startsWith('/api/v1/')) return false;
    const known = /^\/api\/v1\/(auth\/(register|login|me|logout)|pairs|nodes(?:\/[\w-]+)?|accounts(?:\/[\w-]+)?|tasks|node\/(poll|renew|complete))$/;
    if (!known.test(path)) return false;
    const respond = (value, status = 200) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    try {
      if (req.headers.origin && !['http://127.0.0.1:18181', 'http://localhost:18181'].includes(req.headers.origin)) fail(403, '来源不允许');
      let body = {};
      if (['POST', 'PATCH'].includes(req.method)) {
        if (!String(req.headers['content-type']).startsWith('application/json')) fail(415, '需要 JSON');
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 8192) fail(413, '请求过大'); }
        try { body = JSON.parse(raw || '{}'); } catch { fail(400, 'JSON 无效'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '参数无效');
      }
      const now = Date.now();
      if (req.method === 'POST' && ['/api/v1/auth/register', '/api/v1/auth/login'].includes(path)) {
        const key = req.socket.remoteAddress;
        const bucket = attempts.get(key);
        if (bucket && now - bucket.start < 60000 && bucket.count >= 15) fail(429, '尝试过于频繁，请稍后重试');
        attempts.set(key, bucket && now - bucket.start < 60000 ? { ...bucket, count: bucket.count + 1 } : { start: now, count: 1 });
        const { name, password } = body;
        if (typeof name !== 'string' || !/^[\p{L}\p{N}_-]{3,32}$/u.test(name) || typeof password !== 'string' || password.length < 12 || password.length > 128) fail(400, '用户名需3–32位，密码需12–128位');
        let user = db.prepare('SELECT * FROM users WHERE name=?').get(name);
        if (path.endsWith('/register')) {
          if (user) fail(409, '用户名已存在');
          const salt = secret();
          const passwordHash = (await scrypt(password, salt, 64)).toString('hex');
          user = { id: randomUUID(), name, salt, password: passwordHash };
          try { db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(user.id, name, salt, passwordHash); } catch { fail(409, '用户名已存在'); }
        } else {
          const actual = await scrypt(password, user?.salt || 'invalid-user', 64);
          if (!user || !timingSafeEqual(actual, Buffer.from(user.password, 'hex'))) fail(401, '账号或密码错误');
        }
        const token = secret();
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token), user.id, now + 12 * 3600000);
        respond({ token, user: { id: user.id, name: user.name } }); return true;
      }
      // A pair code grants only one device binding, never a user session.
      if (path === '/api/v1/nodes' && req.method === 'POST') {
        if (typeof body.code !== 'string' || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80) fail(400, '绑定信息无效');
        const pair = db.prepare('SELECT * FROM pairs WHERE code=? AND expires>?').get(hash(body.code), now);
        if (!pair) fail(401, '绑定码无效或已过期');
        const token = secret(), id = randomUUID();
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('DELETE FROM pairs WHERE code=?').run(hash(body.code));
          db.prepare('INSERT INTO nodes VALUES(?,?,?,?,?,?)').run(id, pair.owner, body.name.trim(), hash(token), now + 30 * 86400000, now);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        respond({ id, token }); return true;
      }
      const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
      if (path.startsWith('/api/v1/node/')) {
        if (req.method !== 'POST') fail(405, '方法不允许');
        const node = db.prepare('SELECT * FROM nodes WHERE token=? AND expires>?').get(hash(token), now);
        if (!node) fail(401, '设备未绑定或授权已撤销');
        db.prepare('UPDATE nodes SET seen=? WHERE id=?').run(now, node.id);
        if (path.endsWith('/poll')) {
          const task = db.prepare("SELECT * FROM tasks WHERE node=? AND owner=? AND (state='queued' OR (state='running' AND until<?)) ORDER BY created LIMIT 1").get(node.id, node.owner, now);
          if (!task) { respond({ task: null }); return true; }
          const lease = secret();
          db.prepare("UPDATE tasks SET state='running',lease=?,until=? WHERE id=?").run(hash(lease), now + 30000, task.id);
          respond({ task: { id: task.id, type: task.requestType || 'inspect_client', payload: task.payload ? JSON.parse(task.payload) : null, lease } }); return true;
        }
        const task = db.prepare('SELECT * FROM tasks WHERE id=? AND node=? AND owner=?').get(String(body.id), node.id, node.owner);
        if (!task) fail(404, '任务不存在');
        if (task.lease !== hash(String(body.lease))) fail(409, '任务租约已失效');
        if (path.endsWith('/renew')) {
          if (task.state !== 'running' || task.until < now) fail(409, '任务租约已失效');
          db.prepare("UPDATE tasks SET until=? WHERE id=? AND node=? AND owner=?").run(now + 30000, task.id, node.id, node.owner);
          respond({ ok: true, until: now + 30000 }); return true;
        }
        if (task.state === 'done') { respond({ ok: true }); return true; }
        if (task.state !== 'running') fail(409, '任务已经取消');
        if (task.until < now) fail(409, '任务租约已过期');
        if (task.requestType === 'add_account') {
          if (!['unverified', 'cancelled'].includes(body.result?.status)) fail(400, '尚未接入平台验证，不能确认账号在线');
          const result = { status: body.result.status, nickname: '', checkedAt: now };
          const taskPayload = task.payload ? JSON.parse(task.payload) : null;
          if (taskPayload?.accountId) db.prepare('UPDATE accounts SET status=?,nickname=CASE WHEN ? <> \'\' THEN ? ELSE nickname END,updated=? WHERE id=? AND owner=?').run(result.status, result.nickname, result.nickname, now, taskPayload.accountId, node.owner);
          db.prepare("UPDATE tasks SET state='done',result=? WHERE id=?").run(JSON.stringify(result), task.id);
          respond({ ok: true }); return true;
        }
        if (typeof body.result?.installed !== 'boolean') fail(400, '检查结果无效');
        const result = { installed: body.result.installed, checkedAt: now };
        db.prepare("UPDATE tasks SET state='done',result=? WHERE id=?").run(JSON.stringify(result), task.id);
        respond({ ok: true }); return true;
      }
      const session = db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(hash(token), now);
      if (!session) fail(401, '请先登录抖音聚合');
      const owner = session.owner;
      if (path === '/api/v1/auth/me' && req.method === 'GET') respond(db.prepare('SELECT id,name FROM users WHERE id=?').get(owner));
      else if (path === '/api/v1/auth/logout' && req.method === 'POST') { db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token)); respond({ ok: true }); }
      else if (path === '/api/v1/pairs' && req.method === 'POST') {
        const code = secret();
        db.prepare('DELETE FROM pairs WHERE owner=? OR expires<?').run(owner, now);
        db.prepare('INSERT INTO pairs VALUES(?,?,?)').run(hash(code), owner, now + 300000);
        respond({ code, expiresAt: now + 300000 });
      } else if (path === '/api/v1/nodes' && req.method === 'GET') {
        respond(db.prepare('SELECT id,name,seen,expires FROM nodes WHERE owner=?').all(owner).map(n => ({ ...n, online: n.seen > now - 15000 && n.expires > now })));
      } else if (path.startsWith('/api/v1/nodes/') && req.method === 'DELETE') {
        const id = path.split('/').pop();
        const removed = db.prepare('DELETE FROM nodes WHERE id=? AND owner=?').run(id, owner);
        if (!removed.changes) fail(404, '设备不存在');
        db.prepare("UPDATE tasks SET state='cancelled' WHERE node=? AND owner=? AND state IN ('queued','running')").run(id, owner);
        respond({ ok: true });
      } else if (path === '/api/v1/accounts' && req.method === 'GET') {
        const rows = db.prepare('SELECT id,name,nickname,proxy,ws,listening,status,slot,available,created,updated FROM accounts WHERE owner=? ORDER BY created DESC').all(owner);
        respond(rows.map(account => ({ ...account, ws: Boolean(account.ws), listening: Boolean(account.listening), available: Boolean(account.available) })));
      } else if (path === '/api/v1/accounts' && req.method === 'POST') {
        if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) fail(400, '账号名称无效');
        const created = Date.now();
        const id = randomUUID();
        const nickname = typeof body.nickname === 'string' ? body.nickname.trim().slice(0, 100) : '';
        const proxy = typeof body.proxy === 'string' ? body.proxy.trim().slice(0, 255) : '';
        db.prepare('INSERT INTO accounts(id,owner,name,nickname,proxy,created,updated) VALUES(?,?,?,?,?,?,?)').run(id, owner, body.name.trim(), nickname, proxy, created, created);
        let task = null;
        if (body.nodeId !== undefined) {
          const node = db.prepare('SELECT id FROM nodes WHERE id=? AND owner=? AND expires>?').get(String(body.nodeId), owner, now);
          if (!node) fail(404, '设备不存在');
          const requestId = typeof body.requestId === 'string' && /^[\\w-]{16,80}$/.test(body.requestId) ? body.requestId : randomUUID();
          task = { id: randomUUID(), node: node.id, requestId };
          db.prepare("INSERT INTO tasks(id,owner,node,state,lease,until,result,created,request,payload,requestType) VALUES(?,?,?,'queued',NULL,0,NULL,?,?,?,?)").run(task.id, owner, node.id, created, requestId, JSON.stringify({ accountId: id, loginMode: body.loginMode || 'creator', networkMode: body.networkMode || 'direct' }), 'add_account');
        }
        if (task) db.prepare("UPDATE accounts SET status='pending',updated=? WHERE id=? AND owner=?").run(created, id, owner);
        respond({ id, name: body.name.trim(), nickname, proxy, ws: false, listening: false, status: task ? 'pending' : 'offline', slot: '', available: true, taskId: task?.id || null, created, updated: created }, 201);
      } else if (path.startsWith('/api/v1/accounts/') && ['PATCH', 'DELETE'].includes(req.method)) {
        const id = path.split('/').pop();
        if (!db.prepare('SELECT id FROM accounts WHERE id=? AND owner=?').get(id, owner)) fail(404, '账号不存在');
        if (req.method === 'DELETE') { db.prepare('DELETE FROM accounts WHERE id=? AND owner=?').run(id, owner); respond({ ok: true }); }
        else {
          const fields = [], values = [];
          for (const [column, key, max] of [['name','name',100],['nickname','nickname',100],['proxy','proxy',255],['slot','slot',80],['status','status',32]]) {
            if (body[key] !== undefined) { if (typeof body[key] !== 'string' || (key === 'name' && !body[key].trim()) || body[key].length > max) fail(400, '账号参数无效'); fields.push(`${column}=?`); values.push(body[key].trim()); }
          }
          for (const [column, key] of [['ws','ws'],['listening','listening'],['available','available']]) if (body[key] !== undefined) { if (typeof body[key] !== 'boolean') fail(400, '账号参数无效'); fields.push(`${column}=?`); values.push(body[key] ? 1 : 0); }
          if (!fields.length) fail(400, '没有可更新字段');
          fields.push('updated=?'); values.push(Date.now(), id, owner);
          db.prepare(`UPDATE accounts SET ${fields.join(',')} WHERE id=? AND owner=?`).run(...values);
          respond({ ok: true });
        }
      } else if (path === '/api/v1/tasks' && req.method === 'GET') {
        respond(db.prepare('SELECT id,node,state,result,created FROM tasks WHERE owner=? ORDER BY created DESC LIMIT 50').all(owner).map(t => ({ ...t, result: t.result ? JSON.parse(t.result) : null })));
      } else if (path === '/api/v1/tasks' && req.method === 'POST') {
        if (!['inspect_client', 'add_account'].includes(body.type) || typeof body.requestId !== 'string' || !/^[\w-]{16,80}$/.test(body.requestId)) fail(400, '任务参数无效');
        const node = db.prepare('SELECT id FROM nodes WHERE id=? AND owner=? AND expires>?').get(String(body.nodeId), owner, now);
        if (!node) fail(404, '设备不存在');
        const existing = db.prepare('SELECT id,node FROM tasks WHERE owner=? AND request=?').get(owner, body.requestId);
        if (existing) { if (existing.node !== node.id) fail(409, '重复请求内容不同'); respond({ id: existing.id }); return true; }
        const active = db.prepare("SELECT id FROM tasks WHERE node=? AND owner=? AND state IN ('queued','running')").get(node.id, owner);
        if (active) { respond({ id: active.id }); return true; }
        const id = randomUUID();
        if (body.type === 'add_account') {
          if (typeof body.accountId !== 'string' || !db.prepare('SELECT id FROM accounts WHERE id=? AND owner=?').get(body.accountId, owner)) fail(404, '账号不存在');
        }
        db.prepare("INSERT INTO tasks(id,owner,node,state,lease,until,result,created,request,payload,requestType) VALUES(?,?,?,'queued',NULL,0,NULL,?,?,?,?)").run(id, owner, node.id, now, body.requestId, body.type === 'add_account' ? JSON.stringify({ accountId: body.accountId, loginMode: body.loginMode || 'creator', networkMode: body.networkMode || 'direct' }) : null, body.type);
        respond({ id });
      } else fail(405, '方法不允许');
    } catch (error) { respond({ error: error.status ? error.message : '服务处理失败' }, error.status || 500); }
    return true;
  }
  return { route, close: () => db.close() };
}


