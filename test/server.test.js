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

test('CEO login creates a session and allows authorized game management', async () => {
  const login = await fetch(`${baseUrl}/api/auth/ceo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Vyazxs', password: 'test-password-only' })
  });
  assert.equal(login.status, 200);
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

test('content validation rejects unsafe outbound URLs', async () => {
  const response = await fetch(`${baseUrl}/api/admin/games`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Unsafe', description: 'Must not publish', play_url: 'javascript:alert(1)' })
  });
  assert.equal(response.status, 400);
});
