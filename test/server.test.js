const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const bcrypt = require('bcryptjs');

let server;
let baseUrl;
let cookie;
let dataDirectory;

before(async () => {
  dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'crazy-studios-test-'));
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  baseUrl = `http://127.0.0.1:${port}`;
  const hash = await bcrypt.hash('test-password-only', 4);
  server = spawn(process.execPath, ['server/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DATA_DIRECTORY: dataDirectory,
      SESSION_SECRET: 'test-session-secret-with-more-than-32-characters',
      FRONTEND_URL: 'https://peytonphillips890-wq.github.io/vyazxs.github.io/',
      CEO_USERNAME: 'Vyazxs',
      CEO_PASSWORD_HASH: hash
    },
    stdio: 'ignore'
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Test server exited with ${server.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/api/bootstrap`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start in time.');
});

after(async () => {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]);
  }
  if (dataDirectory) fs.rmSync(dataDirectory, { recursive: true, force: true });
});

test('shop and announcements start empty, and protected routes reject guests', async () => {
  const [bootstrapResponse, adminResponse] = await Promise.all([
    fetch(`${baseUrl}/api/bootstrap`),
    fetch(`${baseUrl}/api/admin/roles`)
  ]);
  const bootstrap = await bootstrapResponse.json();
  assert.deepEqual(bootstrap.products, []);
  assert.deepEqual(bootstrap.announcements, []);
  assert.equal(adminResponse.status, 401);
});

test('GitHub Pages origin can make credentialed API requests but other origins are rejected', async () => {
  const origin = 'https://peytonphillips890-wq.github.io';
  const preflight = await fetch(`${baseUrl}/api/admin/games`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');

  const bootstrap = await fetch(`${baseUrl}/api/bootstrap`, { headers: { Origin: origin } });
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.headers.get('access-control-allow-origin'), origin);

  const rejected = await fetch(`${baseUrl}/api/bootstrap`, { headers: { Origin: 'https://attacker.example' } });
  assert.equal(rejected.status, 403);
});

test('CEO login creates a session and allows authorized game management', async () => {
  const login = await fetch(`${baseUrl}/api/auth/ceo`, {
    method: 'POST',
    headers: {
      Origin: 'https://peytonphillips890-wq.github.io',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username: 'Vyazxs', password: 'test-password-only' })
  });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('access-control-allow-origin'), 'https://peytonphillips890-wq.github.io');
  assert.equal(login.headers.get('access-control-allow-credentials'), 'true');
  cookie = login.headers.get('set-cookie').split(';')[0];

  const created = await fetch(`${baseUrl}/api/admin/games`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Test world', description: 'First game', play_url: 'https://www.roblox.com/games/1' })
  });
  assert.equal(created.status, 201);
  const { games } = await (await fetch(`${baseUrl}/api/bootstrap`, { headers: { Cookie: cookie } })).json();
  assert.equal(games.length, 1);
  assert.equal(games[0].title, 'Test world');
});

test('CEO can create, edit, and delete games, shop products, and news posts', async () => {
  for (const [collection, createPayload, editedTitle] of [
    ['games', { title: 'Moon world', description: 'First adventure', status: 'In development', play_url: 'https://www.roblox.com/games/2' }, 'Updated world'],
    ['products', { title: 'Studio hoodie', description: 'First edition', category: 'Apparel', price: '$20' }, 'Updated hoodie'],
    ['announcements', { title: 'Studio update', body: 'We have news.', author: 'Crazy Studios' }, 'Updated update']
  ]) {
    const created = await fetch(`${baseUrl}/api/admin/${collection}`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(createPayload)
    });
    assert.equal(created.status, 201);
    const { id } = await created.json();

    const updated = await fetch(`${baseUrl}/api/admin/${collection}/${id}`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: editedTitle })
    });
    assert.equal(updated.status, 200);
    const bootstrap = await (await fetch(`${baseUrl}/api/bootstrap`, { headers: { Cookie: cookie } })).json();
    assert.equal(bootstrap[collection].find(item => item.id === id).title, editedTitle);

    const deleted = await fetch(`${baseUrl}/api/admin/${collection}/${id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie }
    });
    assert.equal(deleted.status, 200);
    const afterDelete = await (await fetch(`${baseUrl}/api/bootstrap`, { headers: { Cookie: cookie } })).json();
    assert.equal(afterDelete[collection].some(item => item.id === id), false);
  }
});

test('content validation rejects unsafe outbound URLs', async () => {
  const response = await fetch(`${baseUrl}/api/admin/games`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Unsafe', description: 'Must not publish', play_url: 'javascript:alert(1)' })
  });
  assert.equal(response.status, 400);
});
