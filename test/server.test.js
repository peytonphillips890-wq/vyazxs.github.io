const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
  for (const [collection, createPayload, editedField, editedValue] of [
    ['games', { title: 'Moon world', description: 'First adventure', status: 'In development', play_url: 'https://www.roblox.com/games/2' }, 'title', 'Updated world'],
    ['products', { title: 'Studio hoodie', description: 'First edition', category: 'Apparel', price: '$20' }, 'title', 'Updated hoodie'],
    ['announcements', { title: 'Studio update', body: 'We have news.', author: 'Crazy Studios' }, 'title', 'Updated update'],
    ['staff', { name: 'Studio creator', position: 'Developer', bio: 'Builds worlds.' }, 'name', 'Updated creator']
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
      body: JSON.stringify({ [editedField]: editedValue })
    });
    assert.equal(updated.status, 200);
    const bootstrap = await (await fetch(`${baseUrl}/api/bootstrap`, { headers: { Cookie: cookie } })).json();
    assert.equal(bootstrap[collection].find(item => item.id === id)[editedField], editedValue);

    const deleted = await fetch(`${baseUrl}/api/admin/${collection}/${id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie }
    });
    assert.equal(deleted.status, 200);
    const afterDelete = await (await fetch(`${baseUrl}/api/bootstrap`, { headers: { Cookie: cookie } })).json();
    assert.equal(afterDelete[collection].some(item => item.id === id), false);
  }
});

test('CEO can access people, permissions, and settings management APIs', async () => {
  const usersResponse = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: cookie } });
  assert.equal(usersResponse.status, 200);
  const users = await usersResponse.json();
  const ceo = users.find(user => user.is_ceo);
  assert.ok(ceo);

  const accessResponse = await fetch(`${baseUrl}/api/admin/users/${ceo.id}/permissions`, { headers: { Cookie: cookie } });
  assert.equal(accessResponse.status, 200);
  assert.ok((await accessResponse.json()).permissions.includes('manage_permissions'));

  const rolesResponse = await fetch(`${baseUrl}/api/admin/roles`, { headers: { Cookie: cookie } });
  assert.equal(rolesResponse.status, 200);
  const role = await fetch(`${baseUrl}/api/admin/roles`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test managers', description: 'Test role', permissions: ['manage_games'] })
  });
  assert.equal(role.status, 201);
  const { id } = await role.json();

  const updatedRole = await fetch(`${baseUrl}/api/admin/roles/${id}`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test managers updated', description: 'Updated role', permissions: ['manage_staff'] })
  });
  assert.equal(updatedRole.status, 200);

  const siteSettings = await fetch(`${baseUrl}/api/admin/settings/site`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accent: '#112233', discordInvite: 'https://discord.gg/example', discordDescription: 'Studio community' })
  });
  assert.equal(siteSettings.status, 200);

  const roleSettings = await fetch(`${baseUrl}/api/admin/settings/roles`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ id: '12345678901234567', label: 'Community member' }])
  });
  assert.equal(roleSettings.status, 200);

  const bootstrap = await (await fetch(`${baseUrl}/api/bootstrap`)).json();
  assert.equal(bootstrap.site.accent, '#112233');
  assert.equal(bootstrap.roleOptions[0].label, 'Community member');

  const deletedRole = await fetch(`${baseUrl}/api/admin/roles/${id}`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.equal(deletedRole.status, 200);
});

test('image uploads require page-management access and allow frontend embedding', async () => {
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/r3sAAAAASUVORK5CYII=', 'base64');
  const guestForm = new FormData();
  guestForm.append('file', new Blob([image], { type: 'image/png' }), 'pixel.png');
  const guest = await fetch(`${baseUrl}/api/admin/uploads`, { method: 'POST', body: guestForm });
  assert.equal(guest.status, 401);

  const form = new FormData();
  form.append('file', new Blob([image], { type: 'image/png' }), 'pixel.png');
  const upload = await fetch(`${baseUrl}/api/admin/uploads`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form
  });
  assert.equal(upload.status, 201);
  const { url } = await upload.json();
  const asset = await fetch(`${baseUrl}${url}`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal(asset.headers.get('content-type'), 'image/png');
});

test('custom pages persist through draft, publish, private, duplicate, and delete lifecycle', async () => {
  const pageResponse = await fetch(`${baseUrl}/api/admin/pages`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Studio showcase', slug: 'studio-showcase' })
  });
  assert.equal(pageResponse.status, 201);
  const { page } = await pageResponse.json();
  assert.equal(page.visibility, 'unpublished');

  const guestDraft = await fetch(`${baseUrl}/api/pages/studio-showcase`);
  assert.equal(guestDraft.status, 404);
  const adminDraft = await fetch(`${baseUrl}/api/pages/studio-showcase`, { headers: { Cookie: cookie } });
  assert.equal(adminDraft.status, 200);

  const edited = {
    title: 'Our studio',
    slug: page.slug,
    description: page.description,
    bannerUrl: page.bannerUrl,
    thumbnailUrl: page.thumbnailUrl,
    visibility: 'public',
    theme: page.theme,
    sections: [{
      id: crypto.randomUUID(),
      type: 'hero',
      title: 'Welcome to the studio',
      text: 'We make games.',
      imageUrl: '',
      linkLabel: 'Explore',
      linkUrl: '#games',
      items: []
    }, {
      id: crypto.randomUUID(),
      type: 'video',
      title: 'Studio trailer',
      text: '',
      imageUrl: '',
      videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
      linkLabel: '',
      linkUrl: '',
      items: []
    }]
  };
  const invalidVideo = await fetch(`${baseUrl}/api/admin/pages/${page.id}`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...edited,
      sections: [{ ...edited.sections[1], videoUrl: 'https://videos.example/clip' }]
    })
  });
  assert.equal(invalidVideo.status, 400);

  const update = await fetch(`${baseUrl}/api/admin/pages/${page.id}`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(edited)
  });
  assert.equal(update.status, 200, JSON.stringify(await update.json()));
  const publicPage = await fetch(`${baseUrl}/api/pages/studio-showcase`);
  assert.equal(publicPage.status, 200);
  const published = (await publicPage.json()).page;
  assert.equal(published.sections[0].title, 'Welcome to the studio');
  assert.equal(published.sections[1].videoUrl, 'https://youtu.be/dQw4w9WgXcQ');

  const privateUpdate = await fetch(`${baseUrl}/api/admin/pages/${page.id}`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...edited, visibility: 'private' })
  });
  assert.equal(privateUpdate.status, 200);
  assert.equal((await fetch(`${baseUrl}/api/pages/studio-showcase`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/pages/studio-showcase`, { headers: { Cookie: cookie } })).status, 200);

  const duplicate = await fetch(`${baseUrl}/api/admin/pages/${page.id}/duplicate`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(duplicate.status, 201);
  const { page: copy } = await duplicate.json();
  assert.equal(copy.visibility, 'unpublished');
  assert.equal(copy.sections[0].title, 'Welcome to the studio');

  const deleted = await fetch(`${baseUrl}/api/admin/pages/${copy.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.equal(deleted.status, 200);
  assert.equal((await fetch(`${baseUrl}/api/pages/${copy.slug}`, { headers: { Cookie: cookie } })).status, 404);
});

test('navigation management persists custom page links and rejects guests', async () => {
  const guest = await fetch(`${baseUrl}/api/admin/navigation`);
  assert.equal(guest.status, 401);

  const { page } = await (await fetch(`${baseUrl}/api/admin/pages`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Navigation target', slug: 'navigation-target', visibility: 'public' })
  })).json();
  const response = await fetch(`${baseUrl}/api/admin/navigation`, { headers: { Cookie: cookie } });
  const { items } = await response.json();
  items.push({
    id: crypto.randomUUID(),
    label: 'Studio showcase',
    targetType: 'custom',
    target: page.id,
    visible: true,
    audience: 'public',
    requiredPermission: '',
    newTab: false,
    sortOrder: items.length
  });

  const saved = await fetch(`${baseUrl}/api/admin/navigation`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(items)
  });
  assert.equal(saved.status, 200);
  const bootstrap = await (await fetch(`${baseUrl}/api/bootstrap`)).json();
  assert.ok(bootstrap.navigation.some(item => item.label === 'Studio showcase' && item.href === '#custom/navigation-target'));
});

test('content validation rejects unsafe outbound URLs', async () => {
  const response = await fetch(`${baseUrl}/api/admin/games`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Unsafe', description: 'Must not publish', play_url: 'javascript:alert(1)' })
  });
  assert.equal(response.status, 400);
});
