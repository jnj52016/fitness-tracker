const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, scrypt, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { mkdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { initialData, validateData } = require('./dist/model.js');
const derive = promisify(scrypt);
const PREFIX = '/fitness-tracker/api';
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
function createApp(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const origin = options.origin || process.env.APP_ORIGIN;
  if (production && (!origin || !origin.startsWith('https://'))) throw new Error('生产环境必须配置 HTTPS APP_ORIGIN');
  const filename = options.database || process.env.DATABASE_PATH || path.join(__dirname, 'data/fitness.sqlite');
  if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);`);
  const limits = new Map();
  let activeHashes = 0;
  const dummySalt = randomBytes(16).toString('hex');
  const cookie = (token, age) => `fitness_session=${token}; HttpOnly; SameSite=Strict; Path=${PREFIX}; Max-Age=${age}${production ? '; Secure' : ''}`;
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) fail(415, '请使用 JSON 请求');
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 5 * 1024 * 1024) fail(413, '数据不能超过 5 MB'); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { fail(400, 'JSON 格式不正确'); }
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, value, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith(PREFIX + '/')) {
        if (!['GET', 'HEAD'].includes(req.method)) return send(405, { message: '不支持此方法' });
        if (url.pathname === '/fitness-tracker') { res.writeHead(302, { Location: '/fitness-tracker/' }); return res.end(); }
        const relative = url.pathname === '/fitness-tracker/' ? 'index.html' : url.pathname.slice('/fitness-tracker/'.length);
        if (!url.pathname.startsWith('/fitness-tracker/') || (!/^assets\/[\w.-]+$/.test(relative) && relative !== 'index.html')) return send(404, { message: '页面不存在' });
        try {
          const content = readFileSync(path.join(__dirname, '../web/dist', relative));
          res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(relative)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': relative === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
          return res.end(req.method === 'HEAD' ? undefined : content);
        } catch { return send(404, { message: '请先构建前端' }); }
      }
      if (!['GET', 'POST', 'PUT'].includes(req.method)) fail(405, '不支持此方法');
      if (req.method !== 'GET') {
        const allowed = origin || `http://${req.headers.host}`;
        if (req.headers.origin !== allowed) fail(403, '请求来源不受信任');
      }
      const route = url.pathname.slice(PREFIX.length);
      if (route === '/health' && req.method === 'GET') return send(200, { status: 'ok' });
      if (['/register', '/login'].includes(route) && req.method === 'POST') {
        const now = Date.now();
        for (const [key, entry] of limits) if (entry.until <= now) limits.delete(key);
        const key = req.socket.remoteAddress;
        const entry = limits.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
        if (limits.size >= 10000 && !limits.has(key)) fail(429, '请求过多，请稍后重试');
        limits.set(key, entry);
        if (++entry.count > 30 || activeHashes >= 8) fail(429, '登录尝试过多，请稍后再试');
        const input = await body(req);
        if (!input || typeof input.username !== 'string' || !/^[a-zA-Z0-9_]{3,32}$/.test(input.username) || typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 128) fail(400, '用户名需为 3–32 位字母、数字或下划线，密码需为 8–128 位');
        const username = input.username.toLowerCase();
        let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        const salt = route === '/register' ? randomBytes(16).toString('hex') : user?.salt || dummySalt;
        let hash;
        activeHashes++;
        try { hash = await derive(input.password, salt, 64); } finally { activeHashes--; }
        if (route === '/register') {
          try { db.prepare('INSERT INTO users (username, salt, password, data) VALUES (?, ?, ?, ?)').run(username, salt, hash.toString('hex'), JSON.stringify(initialData())); }
          catch (error) { if (String(error.message).includes('UNIQUE')) fail(409, '该用户名已被使用'); throw error; }
          user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        } else if (!user || !timingSafeEqual(hash, Buffer.from(user.password, 'hex'))) fail(401, '用户名或密码不正确');
        const token = randomBytes(32).toString('hex');
        db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now);
        db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), user.id, now + 30 * 86400000);
        return send(200, { id: user.id, username: user.username }, { 'Set-Cookie': cookie(token, 30 * 86400) });
      }
      const token = /(?:^|;\s*)fitness_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      const user = token && db.prepare('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE token = ? AND expires > ?').get(digest(token), Date.now());
      if (!user) fail(401, '登录已失效，请重新登录');
      if (route === '/me' && req.method === 'GET') return send(200, { id: user.id, username: user.username });
      if (route === '/logout' && req.method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE token = ?').run(digest(token));
        return send(200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
      }
      if (route === '/data') {
        if (req.headers['x-user-id'] !== String(user.id)) fail(401, '账号已切换，请重新登录');
        if (req.method === 'GET') return send(200, validateData(JSON.parse(user.data)));
        if (req.method === 'PUT') {
          const input = await body(req);
          if (!input || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= Number.MAX_SAFE_INTEGER) fail(400, '数据版本不正确');
          if (input.data?.version !== 2) fail(409, '应用版本已更新，请刷新页面后重试');
          let data;
          try { data = validateData({ ...input.data, revision: input.expectedRevision + 1 }); } catch (error) { fail(400, error.message); }
          const result = db.prepare('UPDATE users SET data = ?, revision = ? WHERE id = ? AND revision = ?').run(JSON.stringify(data), data.revision, user.id, input.expectedRevision);
          if (!result.changes) fail(409, '数据已在其他设备更新，请重新加载后重试');
          return send(200, data);
        }
      }
      fail(404, '接口不存在');
    } catch (error) {
      if (!error.status) console.error(error);
      if (!res.headersSent) send(error.status || 500, { message: error.status ? error.message : '服务器暂时不可用，请稍后重试' });
      else res.end();
    }
  });
  server.requestTimeout = 30000;
  server.on('close', () => db.close());
  return server;
}
if (require.main === module) {
  const server = createApp();
  server.listen(Number(process.env.PORT || 3001), process.env.HOST || '127.0.0.1', () => console.log('练就：http://localhost:' + (process.env.PORT || 3001) + '/fitness-tracker/'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
module.exports = { createApp };
