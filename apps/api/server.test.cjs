const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createApp } = require('./server.cjs');
const { initialData } = require('./dist/model.js');
test('HTTP 注册、登录、隔离、冲突、非法请求、注销、重启持久化', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fitness-api-'));
  const database = path.join(dir, 'test.sqlite');
  let server, base;
  async function start() {
    server = createApp({ database, origin: 'http://localhost:5173' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}/fitness-tracker/api`;
  }
  async function close() { await new Promise(resolve => server.close(resolve)); }
  async function call(route, method = 'GET', data, session = {}, origin = 'http://localhost:5173') {
    const response = await fetch(base + route, { method, headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: session.cookie || '', 'X-User-Id': String(session.id || '') }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') };
  }
  const credentials = { username: 'alice', password: 'correct-password' };
  try {
    await start();
    assert.equal((await call('/data')).status, 401);
    assert.equal((await call('/register', 'POST', credentials, {}, 'https://evil.example')).status, 403);
    assert.equal((await call('/register', 'POST', { username: 'a', password: 'short' })).status, 400);
    const registration = await call('/register', 'POST', credentials);
    assert.equal(registration.status, 200);
    assert.match(registration.cookie, /HttpOnly/); assert.match(registration.cookie, /SameSite=Strict/);
    const alice = { id: registration.body.id, cookie: registration.cookie.split(';')[0] };
    assert.equal((await call('/register', 'POST', { ...credentials, username: 'ALICE' })).status, 409);
    assert.equal((await call('/login', 'POST', { ...credentials, password: 'wrong-password' })).status, 401);
    const bobRegistration = await call('/register', 'POST', { username: 'bob', password: 'another-password' });
    const bob = { id: bobRegistration.body.id, cookie: bobRegistration.cookie.split(';')[0] };
    const data = initialData(); data.chosen = true; data.configs[0] = [{ id: '0-0-0', sets: 4 }]; data.counts['0-0-0'] = 1;
    const saved = await call('/data', 'PUT', { data, expectedRevision: 0 }, alice);
    assert.equal(saved.status, 200); assert.equal(saved.body.revision, 1);
    assert.equal((await call('/data', 'GET', undefined, bob)).body.chosen, false);
    assert.equal((await call('/data', 'GET', undefined, { ...bob, id: alice.id })).status, 401);
    assert.equal((await call('/data', 'PUT', { data, expectedRevision: 0 }, alice)).status, 409);
    const concurrent = await Promise.all([call('/data', 'PUT', { data, expectedRevision: 1 }, alice), call('/data', 'PUT', { data, expectedRevision: 1 }, alice)]);
    assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
    assert.equal((await call('/data', 'PUT', { data: { ...data, current: 8 }, expectedRevision: 2 }, alice)).status, 400);
    assert.equal((await call('/data', 'GET', undefined, alice)).body.revision, 2);
    assert.equal((await call('/logout', 'POST', {}, alice)).status, 200);
    assert.equal((await call('/data', 'GET', undefined, alice)).status, 401);
    const login = await call('/login', 'POST', credentials);
    assert.equal(login.status, 200);
    const next = { id: login.body.id, cookie: login.cookie.split(';')[0] };
    await close(); await start();
    assert.equal((await call('/me', 'GET', undefined, next)).body.username, 'alice');
    assert.equal((await call('/data', 'GET', undefined, next)).body.counts['0-0-0'], 1);
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(database);
    const row = db.prepare('SELECT password, salt FROM users WHERE username = ?').get('alice');
    assert.notEqual(row.password, credentials.password); assert.equal(row.password.length, 128);
    db.prepare('UPDATE sessions SET expires = 0').run(); db.close();
    assert.equal((await call('/me', 'GET', undefined, next)).status, 401);
  } finally { if (server?.listening) await close(); rmSync(dir, { recursive: true, force: true }); }
});
test('生产环境要求 HTTPS，并使用 Secure Cookie；认证限流', async () => {
  assert.throws(() => createApp({ production: true, origin: 'http://example.com' }), /HTTPS/);
  const server = createApp({ database: ':memory:', production: true, origin: 'https://example.com' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/fitness-tracker/api/register`;
    const options = { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tester', password: 'safe-password' }) };
    const response = await fetch(url, options); await response.json();
    assert.match(response.headers.get('set-cookie'), /Secure/);
    for (let i = 0; i < 29; i++) { const r = await fetch(url, { ...options, body: '{}' }); await r.json(); }
    const limited = await fetch(url, options); await limited.json(); assert.equal(limited.status, 429);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('API 保留轮换配置与方案历史，拒绝旧版客户端覆盖', async () => {
  const server = createApp({ database: ':memory:', origin: 'http://localhost:5173' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/fitness-tracker/api`;
    const headers = { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' };
    const registration = await fetch(base + '/register', { method: 'POST', headers, body: JSON.stringify({ username: 'rotation', password: 'rotation-password' }) });
    const user = await registration.json(); headers.Cookie = registration.headers.get('set-cookie').split(';')[0]; headers['X-User-Id'] = String(user.id);
    const data = initialData(); data.legB = [{ id: '2-1-0', sets: 5 }]; data.legNext = 'B'; data.frequency.chest = 'alternate'; data.current = 2;
    const { countSet, finishSession } = require('./dist/model.js'); countSet(data, '2-1-0', 1); finishSession(data);
    let response = await fetch(base + '/data', { method: 'PUT', headers, body: JSON.stringify({ data, expectedRevision: 0 }) });
    assert.equal(response.status, 200); await response.json();
    const saved = await (await fetch(base + '/data', { headers })).json();
    assert.equal(saved.legB[0].sets, 5); assert.equal(saved.legNext, 'A'); assert.equal(saved.history[0].legVariant, 'B'); assert.equal(saved.frequency.chest, 'alternate');
    response = await fetch(base + '/data', { method: 'PUT', headers, body: JSON.stringify({ data: { ...data, version: 1 }, expectedRevision: 1 }) });
    assert.equal(response.status, 409); await response.json();
    assert.equal((await (await fetch(base + '/data', { headers })).json()).revision, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
