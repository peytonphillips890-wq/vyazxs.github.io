const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');

require('dotenv').config();

const root = path.join(__dirname, '..');
const dataDirectory = process.env.DATA_DIRECTORY || path.join(root, 'data');
fs.mkdirSync(dataDirectory, { recursive: true });

const required = ['SESSION_SECRET', 'CEO_USERNAME', 'CEO_PASSWORD_HASH'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}
if (process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');

const db = new DatabaseSync(path.join(dataDirectory, 'crazy-studios.sqlite'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires INTEGER NOT NULL
)`);
const app = express();
const configuredFrontendUrl = process.env.FRONTEND_URL;
const configuredFrontendOrigin = configuredFrontendUrl ? new URL(configuredFrontendUrl).origin : null;
class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    try {
      const row = db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?').get(sid);
      if (!row) return callback(null, null);
      if (row.expires <= Date.now()) {
        db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.sess));
    } catch (error) { callback(error); }
  }
  set(sid, value, callback = () => {}) {
    try {
      const expires = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000;
      db.prepare(`INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`)
        .run(sid, JSON.stringify(value), expires);
      callback(null);
    } catch (error) { callback(error); }
  }
  destroy(sid, callback = () => {}) {
    try { db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); callback(null); }
    catch (error) { callback(error); }
  }
  touch(sid, value, callback = () => {}) {
    try {
      const expires = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000;
      db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?').run(expires, sid);
      callback(null);
    } catch (error) { callback(error); }
  }
}
const sessionCleanup = setInterval(() => db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now()), 60 * 60 * 1000);
sessionCleanup.unref();
const permissions = [
  'manage_games', 'manage_shop', 'manage_announcements', 'manage_staff',
  'manage_users', 'ban_users', 'unban_users', 'assign_badges',
  'manage_discord', 'manage_pages', 'manage_navigation', 'manage_permissions'
];
const collections = {
  games: { permission: 'manage_games', table: 'games', fields: ['title', 'description', 'image_url', 'play_url', 'status', 'featured'], required: ['title', 'description'] },
  products: { permission: 'manage_shop', table: 'products', fields: ['title', 'description', 'image_url', 'category', 'price', 'purchase_url', 'featured'], required: ['title', 'description'] },
  announcements: { permission: 'manage_announcements', table: 'announcements', fields: ['title', 'body', 'author', 'featured'], required: ['title', 'body', 'author'] },
  staff: { permission: 'manage_staff', table: 'staff', fields: ['name', 'position', 'image_url', 'bio', 'badge'], required: ['name', 'position'] }
};

function seed() {
  const username = process.env.CEO_USERNAME;
  const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!existing) {
    db.prepare(`INSERT INTO users (id, username, display_name, is_ceo) VALUES (?, ?, ?, 1)`)
      .run('ceo', username, username);
  } else {
    db.prepare('UPDATE users SET is_ceo = 1 WHERE id = ?').run(existing.id);
  }
  const defaults = {
    site: JSON.stringify({ accent: '#a3ff3f', discordInvite: '', discordDescription: 'Join the conversation and meet the community.' }),
    roleOptions: '[]'
  };
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaults)) insert.run(key, value);
}
seed();

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'https:', 'data:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  }
}));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (!origin) return req.method === 'OPTIONS' ? res.sendStatus(204) : next();
  let requestOrigin;
  try { requestOrigin = `${req.protocol}://${req.get('host')}`; }
  catch { return res.status(403).json({ error: 'Request origin is not allowed.' }); }
  let parsedOrigin;
  try { parsedOrigin = new URL(origin).origin; }
  catch { return res.status(403).json({ error: 'Request origin is not allowed.' }); }
  if (parsedOrigin !== requestOrigin && parsedOrigin !== configuredFrontendOrigin) {
    return res.status(403).json({ error: 'Request origin is not allowed.' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(session({
  store: new SQLiteSessionStore(),
  name: 'crazy.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));
app.use(express.static(path.join(root, 'public')));
app.use('/api/admin', rateLimit({ windowMs: 15 * 60 * 1000, limit: 180, standardHeaders: true, legacyHeaders: false }));

function setting(key) {
  const value = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
  return value === undefined ? null : value;
}

function currentUser(req) {
  return req.session.userId ? db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId) : null;
}

function isCeo(user) {
  return Boolean(user?.is_ceo);
}

function hasPermission(user, permission) {
  if (isCeo(user)) return true;
  if (!user || !permissions.includes(permission)) return false;
  const override = db.prepare('SELECT allowed FROM user_permissions WHERE user_id = ? AND permission = ?')
    .get(user.id, permission);
  if (override) return Boolean(override.allowed);
  const roles = db.prepare(`SELECT r.permissions FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?`).all(user.id);
  return roles.some(role => {
    try { return JSON.parse(role.permissions).includes(permission); } catch { return false; }
  });
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id, username: user.username, displayName: user.display_name,
    avatarUrl: user.avatar_url, bannerUrl: user.banner_url, bio: user.bio,
    discordUsername: user.discord_username, createdAt: user.created_at,
    status: user.status, isCeo: isCeo(user),
    permissions: permissions.filter(permission => hasPermission(user, permission))
  };
}

function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user || user.status !== 'active') return res.status(401).json({ error: 'Sign in to continue.' });
  req.user = user;
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user || !hasPermission(req.user, permission)) return res.status(403).json({ error: 'You do not have permission to do that.' });
    next();
  };
}

function requireAnyPermission(...requested) {
  return (req, res, next) => {
    if (!req.user || !requested.some(permission => hasPermission(req.user, permission))) {
      return res.status(403).json({ error: 'You do not have permission to do that.' });
    }
    next();
  };
}

function validHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

function audit(user, action, target = '') {
  db.prepare('INSERT INTO audit_logs (id, actor_id, action, target_id) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), user.id, action, String(target));
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
app.post('/api/auth/ceo', authLimiter, async (req, res) => {
  const input = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) }).safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Enter your username and password.' });
  const matches = input.data.username.toLowerCase() === process.env.CEO_USERNAME.toLowerCase()
    && await bcrypt.compare(input.data.password, process.env.CEO_PASSWORD_HASH);
  if (!matches) return res.status(401).json({ error: 'The username or password is incorrect.' });
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(process.env.CEO_USERNAME);
  req.session.regenerate(error => {
    if (error) return res.status(500).json({ error: 'Could not create a secure session.' });
    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
  });
});

app.delete('/api/admin/roles/:id', requireUser, requirePermission('manage_permissions'), (req, res) => {
  const result = db.prepare('DELETE FROM roles WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Role not found.' });
  audit(req.user, 'role.deleted', req.params.id);
  res.json({ ok: true });
});

app.get('/api/auth/discord', (req, res) => {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !process.env.DISCORD_REDIRECT_URI) {
    return res.status(503).json({ error: 'Discord sign-in has not been configured by the site owner.' });
  }
  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauthState = state;
  const query = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    state
  });
  res.redirect(`https://discord.com/oauth2/authorize?${query}`);
});

app.delete('/api/admin/users/:id/roles/:roleId', requireUser, requirePermission('manage_permissions'), (req, res) => {
  const target = db.prepare('SELECT is_ceo FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.is_ceo) return res.status(403).json({ error: 'The CEO account always retains full control.' });
  db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(req.params.id, req.params.roleId);
  audit(req.user, 'user.role.removed', req.params.id);
  res.json({ ok: true });
});

async function discordRequest(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Discord request failed (${response.status}).`);
  return response.status === 204 ? null : response.json();
}

function avatarUrl(discordId, avatar) {
  return avatar ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png?size=256`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;
}

function welcomeSvg(username, avatar) {
  const safeName = String(username).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#101510"/><stop offset="1" stop-color="#25351b"/></linearGradient>
    <radialGradient id="glow"><stop stop-color="#a3ff3f" stop-opacity=".35"/><stop offset="1" stop-color="#a3ff3f" stop-opacity="0"/></radialGradient>
    <clipPath id="avatar"><circle cx="600" cy="228" r="82"/></clipPath></defs>
    <rect width="1200" height="630" fill="url(#bg)"/><circle cx="1040" cy="55" r="420" fill="url(#glow)"/>
    <rect x="34" y="34" width="1132" height="562" rx="28" fill="none" stroke="#a3ff3f" stroke-opacity=".32"/>
    <image href="${avatar}" x="518" y="146" width="164" height="164" clip-path="url(#avatar)"/>
    <circle cx="600" cy="228" r="87" fill="none" stroke="#a3ff3f" stroke-width="4"/>
    <text x="600" y="374" text-anchor="middle" fill="#a3ff3f" font-family="Arial,sans-serif" font-size="18" font-weight="700" letter-spacing="8">CRAZY STUDIOS</text>
    <text x="600" y="445" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="52" font-weight="700">WELCOME, ${safeName}</text>
    <text x="600" y="495" text-anchor="middle" fill="#b7c0b0" font-family="Arial,sans-serif" font-size="20">Your next adventure starts here.</text></svg>`;
}

async function sendWelcomeDm(user) {
  if (!process.env.DISCORD_BOT_TOKEN) return false;
  const channel = await discordRequest('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: user.discord_id })
  });
  const image = Buffer.from(welcomeSvg(user.discord_username, user.discord_avatar_url));
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content: `Welcome to Crazy Studios, ${user.discord_username}!` }));
  form.append('files[0]', new Blob([image], { type: 'image/svg+xml' }), 'welcome.svg');
  const response = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
    method: 'POST', headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }, body: form
  });
  if (!response.ok) throw new Error(`Discord welcome DM failed (${response.status}).`);
  return true;
}

app.get('/auth/discord/callback', authLimiter, async (req, res) => {
  if (!req.query.code || !req.query.state || req.query.state !== req.session.oauthState) {
    return res.status(400).send('Discord sign-in could not be verified. Please try again.');
  }
  delete req.session.oauthState;
  try {
    const body = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: String(req.query.code),
      redirect_uri: process.env.DISCORD_REDIRECT_URI
    });
    const token = await discordRequest('https://discord.com/api/v10/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
    });
    const discordUser = await discordRequest('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `${token.token_type} ${token.access_token}` }
    });
    const existing = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordUser.id);
    const user = existing
      ? (db.prepare('UPDATE users SET discord_username = ?, discord_avatar_url = ? WHERE id = ?').run(
        discordUser.username, avatarUrl(discordUser.id, discordUser.avatar), existing.id),
      db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id))
      : (() => {
        const id = crypto.randomUUID();
      const username = `${discordUser.username.slice(0, 15)}-${discordUser.id.slice(-8)}`;
      const avatar = avatarUrl(discordUser.id, discordUser.avatar);
      db.prepare(`INSERT INTO users (id, discord_id, discord_username, discord_avatar_url, avatar_url, username, display_name)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, discordUser.id, discordUser.username, avatar, avatar, username, discordUser.global_name || discordUser.username);
        return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      })();
    if (user.status === 'banned') return res.status(403).send('This account is currently unable to sign in.');
      await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = user.id;
    try {
      req.session.welcomeDm = await sendWelcomeDm(user) ? 'sent' : 'not-configured';
    } catch (error) {
      console.error('Welcome DM delivery failed:', error.message);
      req.session.welcomeDm = 'failed';
    }
    res.redirect(configuredFrontendUrl || '/');
  } catch (error) {
    console.error('Discord sign-in failed:', error.message);
    res.status(502).send('Discord sign-in failed. Please try again later.');
  }
});

app.post('/api/auth/logout', (req, res) => req.session.destroy(error => {
  if (error) return res.status(500).json({ error: 'Could not sign out.' });
  res.clearCookie('crazy.sid');
  res.json({ ok: true });
}));

app.get('/api/bootstrap', (req, res) => {
  const user = currentUser(req);
  const queryRows = (table, sql = `SELECT * FROM ${table}`) => db.prepare(sql).all();
  const staff = queryRows('staff');
  res.json({
    user: publicUser(user),
    games: queryRows('games'),
    products: queryRows('products'),
    announcements: queryRows('announcements', 'SELECT * FROM announcements ORDER BY featured DESC, published_at DESC'),
    staff,
    site: JSON.parse(setting('site') || '{}'),
    roleOptions: JSON.parse(setting('roleOptions') || '[]'),
    welcomeDm: req.session.welcomeDm || null
  });
  delete req.session.welcomeDm;
});

app.get('/api/profile/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND status = ?').get(req.params.id, 'active');
  if (!user) return res.status(404).json({ error: 'Profile not found.' });
  res.json({
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    bannerUrl: user.banner_url,
    bio: user.bio,
    discordUsername: user.discord_username,
    createdAt: user.created_at
  });
});

app.patch('/api/profile', requireUser, (req, res) => {
  const parsed = z.object({
    username: z.string().trim().min(2).max(24).regex(/^[\p{L}\p{N}_ -]+$/u),
    displayName: z.string().trim().max(40),
    avatarUrl: z.string().max(500).refine(value => value === '' || validHttpUrl(value)),
    bannerUrl: z.string().max(500).refine(value => value === '' || validHttpUrl(value)),
    bio: z.string().trim().max(240)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Check your profile details and image URLs.' });
  const usernameOwner = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(parsed.data.username, req.user.id);
  if (usernameOwner) return res.status(409).json({ error: 'That username is already in use.' });
  db.prepare(`UPDATE users SET username = ?, display_name = ?, avatar_url = ?, banner_url = ?, bio = ? WHERE id = ?`)
    .run(parsed.data.username, parsed.data.displayName, parsed.data.avatarUrl, parsed.data.bannerUrl, parsed.data.bio, req.user.id);
  res.json({ user: publicUser(currentUser(req)) });
});

app.post('/api/discord/role', requireUser, async (req, res) => {
  const parsed = z.object({ roleId: z.string().regex(/^\d{17,20}$/) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose a valid available community role.' });
  const options = JSON.parse(setting('roleOptions') || '[]');
  const selected = options.find(option => option.id === parsed.data.roleId);
  if (!selected || !process.env.DISCORD_BOT_TOKEN || !req.user.discord_id) return res.status(400).json({ error: 'That role is unavailable.' });
  try {
    await discordRequest(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${req.user.discord_id}/roles/${selected.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }
    });
    res.json({ ok: true, message: 'Your Discord role has been assigned.' });
  } catch (error) {
    console.error('Discord role assignment failed:', error.message);
    res.status(502).json({ error: 'The Discord role could not be assigned. Check that the bot is in the server and can manage that role.' });
  }
});

app.get('/api/admin/users', requireUser, requireAnyPermission('manage_users', 'manage_permissions'), (req, res) => {
  const users = db.prepare(`SELECT id, username, display_name, discord_username, avatar_url, status, created_at, is_ceo
    FROM users ORDER BY created_at DESC`).all();
  res.json(users.map(user => ({
    ...user,
    roles: db.prepare('SELECT r.id, r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?').all(user.id)
  })));
});

app.get('/api/admin/users/:id/permissions', requireUser, requirePermission('manage_permissions'), (req, res) => {
  const target = db.prepare('SELECT id, is_ceo FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  res.json({
    roles: db.prepare('SELECT r.id, r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?').all(target.id),
    overrides: db.prepare('SELECT permission, allowed FROM user_permissions WHERE user_id = ?').all(target.id)
      .map(row => ({ permission: row.permission, allowed: Boolean(row.allowed) })),
    permissions
  });
});

app.put('/api/admin/users/:id/permissions', requireUser, requirePermission('manage_permissions'), (req, res) => {
  const parsed = z.array(z.object({ permission: z.enum(permissions), allowed: z.union([z.boolean(), z.null()]) })).max(permissions.length).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Permission overrides are invalid.' });
  const target = db.prepare('SELECT id, is_ceo FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.is_ceo) return res.status(403).json({ error: 'The CEO account always retains full control.' });
  const save = db.prepare(`INSERT INTO user_permissions (user_id, permission, allowed) VALUES (?, ?, ?)
    ON CONFLICT(user_id, permission) DO UPDATE SET allowed = excluded.allowed`);
  const clear = db.prepare('DELETE FROM user_permissions WHERE user_id = ? AND permission = ?');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of parsed.data) {
      if (item.allowed === null) clear.run(target.id, item.permission);
      else save.run(target.id, item.permission, item.allowed ? 1 : 0);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  audit(req.user, 'user.permissions.updated', target.id);
  res.json({ ok: true });
});

app.get('/api/admin/roles', requireUser, requirePermission('manage_permissions'), (req, res) => {
  res.json({ roles: db.prepare('SELECT * FROM roles ORDER BY name').all().map(role => ({ ...role, permissions: JSON.parse(role.permissions) })), permissions });
});

app.post('/api/admin/roles', requireUser, requirePermission('manage_permissions'), (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(32), description: z.string().max(160), permissions: z.array(z.enum(permissions)).max(permissions.length) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Role details or permissions are invalid.' });
  const id = crypto.randomUUID();
  try {
    db.prepare('INSERT INTO roles (id, name, description, permissions) VALUES (?, ?, ?, ?)')
      .run(id, parsed.data.name, parsed.data.description, JSON.stringify([...new Set(parsed.data.permissions)]));
    audit(req.user, 'role.created', id);
    res.status(201).json({ id });
  } catch { res.status(409).json({ error: 'A role with that name already exists.' }); }
});

app.put('/api/admin/roles/:id', requireUser, requirePermission('manage_permissions'), (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(32), description: z.string().max(160), permissions: z.array(z.enum(permissions)).max(permissions.length) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Role details or permissions are invalid.' });
  try {
    const result = db.prepare('UPDATE roles SET name = ?, description = ?, permissions = ? WHERE id = ?')
      .run(parsed.data.name, parsed.data.description, JSON.stringify([...new Set(parsed.data.permissions)]), req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Role not found.' });
    audit(req.user, 'role.updated', req.params.id);
    res.json({ ok: true });
  } catch { res.status(409).json({ error: 'A role with that name already exists.' }); }
});

app.post('/api/admin/users/:id/roles', requireUser, requirePermission('manage_permissions'), (req, res) => {
  const parsed = z.object({ roleId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose a valid role.' });
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (isCeo(target)) return res.status(403).json({ error: 'The CEO account cannot lose its full-control access.' });
  db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(target.id, parsed.data.roleId);
  audit(req.user, 'user.role.assigned', target.id);
  res.json({ ok: true });
});

app.put('/api/admin/settings/roles', requireUser, requirePermission('manage_discord'), (req, res) => {
  const parsed = z.array(z.object({ id: z.string().regex(/^\d{17,20}$/), label: z.string().trim().min(2).max(40) })).max(10).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Role options are invalid.' });
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('roleOptions', JSON.stringify(parsed.data));
  audit(req.user, 'discord.role_options.updated');
  res.json({ ok: true });
});

app.put('/api/admin/settings/site', requireUser, requirePermission('manage_pages'), (req, res) => {
  const parsed = z.object({
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    discordInvite: z.string().max(300).refine(value => value === '' || validHttpUrl(value)),
    discordDescription: z.string().max(180)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Site settings are invalid.' });
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('site', JSON.stringify(parsed.data));
  audit(req.user, 'site.settings.updated');
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/moderation', requireUser, (req, res, next) => {
  const action = req.body?.action === 'ban' ? 'ban_users' : 'unban_users';
  return requirePermission(action)(req, res, next);
}, (req, res) => {
  const parsed = z.object({ action: z.enum(['ban', 'unban']), note: z.string().max(300).default('') }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Moderation details are invalid.' });
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (isCeo(target)) return res.status(403).json({ error: 'The CEO account cannot be moderated.' });
  const status = parsed.data.action === 'ban' ? 'banned' : 'active';
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, target.id);
  db.prepare('INSERT INTO moderation (id, user_id, actor_id, action, note) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), target.id, req.user.id, parsed.data.action, parsed.data.note);
  audit(req.user, `user.${parsed.data.action}`, target.id);
  res.json({ ok: true });
});

app.get('/api/admin/moderation', requireUser, requirePermission('manage_users'), (req, res) => {
  res.json(db.prepare(`SELECT m.*, u.username, a.username AS actor_name
    FROM moderation m JOIN users u ON u.id = m.user_id JOIN users a ON a.id = m.actor_id
    ORDER BY m.created_at DESC LIMIT 100`).all());
});

for (const [name, config] of Object.entries(collections)) {
  const fieldSchemas = Object.fromEntries(config.fields.map(field => [
    field,
    field === 'featured'
      ? z.boolean().optional()
      : ['image_url', 'play_url', 'purchase_url'].includes(field)
        ? z.string().trim().max(500).refine(value => value === '' || validHttpUrl(value)).optional()
        : config.required.includes(field)
          ? z.string().trim().min(1).max(field === 'description' || field === 'body' || field === 'bio' ? 1200 : 200)
          : z.string().trim().max(field === 'description' || field === 'body' || field === 'bio' ? 1200 : 200).optional()
  ]));
  const createSchema = z.object(fieldSchemas).strict();
  const updateSchema = z.object(Object.fromEntries(Object.entries(fieldSchemas).map(([field, schema]) => [
    field, config.required.includes(field) ? schema.optional() : schema
  ]))).strict();
  app.post(`/api/admin/${name}`, requireUser, requirePermission(config.permission), (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Item details are invalid.' });
    const fields = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined));
    const id = crypto.randomUUID();
    const insertFields = ['id', ...Object.keys(fields)];
    const insertValues = [id, ...Object.values(fields).map(value => value === true ? 1 : value === false ? 0 : value)];
    if (!fields.title && !fields.name) return res.status(400).json({ error: 'A title or name is required.' });
    const placeholders = insertFields.map(() => '?').join(', ');
    db.prepare(`INSERT INTO ${config.table} (${insertFields.join(', ')}) VALUES (${placeholders})`).run(...insertValues);
    audit(req.user, `${name}.created`, id);
    res.status(201).json({ id });
  });
  app.put(`/api/admin/${name}/:id`, requireUser, requirePermission(config.permission), (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Item details are invalid.' });
    const fields = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined));
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'No editable fields were provided.' });
    const values = Object.values(fields).map(value => value === true ? 1 : value === false ? 0 : value);
    const result = db.prepare(`UPDATE ${config.table} SET ${Object.keys(fields).map(field => `${field} = ?`).join(', ')} WHERE id = ?`).run(...values, req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Item not found.' });
    audit(req.user, `${name}.updated`, req.params.id);
    res.json({ ok: true });
  });
  app.delete(`/api/admin/${name}/:id`, requireUser, requirePermission(config.permission), (req, res) => {
    const result = db.prepare(`DELETE FROM ${config.table} WHERE id = ?`).run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Item not found.' });
    audit(req.user, `${name}.deleted`, req.params.id);
    res.json({ ok: true });
  });
}

app.use('/api', (error, req, res, next) => {
  console.error('API error:', error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Crazy Studios is running on port ${port}`));
