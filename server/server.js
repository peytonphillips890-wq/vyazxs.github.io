const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const multer = require('multer');
const { z } = require('zod');

require('dotenv').config();

const root = path.join(__dirname, '..');
const dataDirectory = process.env.DATA_DIRECTORY || path.join(root, 'data');
const uploadsDirectory = path.join(dataDirectory, 'uploads');
fs.mkdirSync(dataDirectory, { recursive: true });
fs.mkdirSync(uploadsDirectory, { recursive: true });

const required = ['SESSION_SECRET', 'CEO_USERNAME', 'CEO_PASSWORD_HASH'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}
if (process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
if (process.env.DISCORD_ALERT_WEBHOOK_URL) {
  const alertWebhook = new URL(process.env.DISCORD_ALERT_WEBHOOK_URL);
  if (alertWebhook.protocol !== 'https:'
      || !['discord.com', 'discordapp.com'].includes(alertWebhook.hostname)
      || !/^\/api\/webhooks\/\d+\/[^/]+$/.test(alertWebhook.pathname)) {
    throw new Error('DISCORD_ALERT_WEBHOOK_URL must be a Discord HTTPS webhook URL.');
  }
}

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
const builtinNavigation = [
  ['home', 'Home'],
  ['games', 'Games'],
  ['shop', 'Shop'],
  ['announcements', 'News'],
  ['staff', 'Studio'],
  ['discord', 'Community']
];
const customSectionTypes = [
  'hero', 'about', 'games', 'gallery', 'team', 'news', 'shop',
  'discord', 'text', 'features', 'video', 'cta', 'faq'
];
const pageFonts = ['Space Grotesk', 'DM Sans', 'Arial'];
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
  const insertNavigation = db.prepare(`INSERT OR IGNORE INTO navigation_items
    (id, label, target_type, target, visible, sort_order) VALUES (?, ?, 'builtin', ?, 1, ?)`);
  builtinNavigation.forEach(([id, label], index) => insertNavigation.run(id, label, id, index));
}
seed();

app.set('trust proxy', 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'https:', 'data:'],
      frameSrc: ["'self'", 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
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
app.use('/uploads', express.static(uploadsDirectory, { fallthrough: false, maxAge: '1d', immutable: true }));
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

function validAssetUrl(value) {
  return value === '' || validHttpUrl(value) || /^\/uploads\/[a-f0-9-]+\.(?:png|jpe?g|webp)$/i.test(value);
}

function validPageLink(value) {
  return value === '' || validHttpUrl(value)
    || /^\/(?!\/)[a-zA-Z0-9/_-]*(?:\?[a-zA-Z0-9_=&%-]*)?$/.test(value)
    || /^#(?:[a-z0-9-]+|custom\/[a-z0-9-]+)$/i.test(value);
}

function validVideoUrl(value) {
  if (value === '') return true;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return false;
    if (['youtu.be', 'www.youtu.be'].includes(url.hostname)) return /^[\w-]{11}$/.test(url.pathname.slice(1));
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(url.hostname)) {
      return url.pathname === '/watch' ? /^[\w-]{11}$/.test(url.searchParams.get('v') || '')
        : /^\/embed\/[\w-]{11}$/.test(url.pathname);
    }
    return ['vimeo.com', 'www.vimeo.com'].includes(url.hostname) && /^\d{1,20}$/.test(url.pathname.slice(1));
  } catch { return false; }
}

const pageSectionItemSchema = z.object({
  title: z.string().trim().max(120).default(''),
  text: z.string().trim().max(1200).default(''),
  imageUrl: z.string().trim().max(500).refine(validAssetUrl).default(''),
  linkLabel: z.string().trim().max(60).default(''),
  linkUrl: z.string().trim().max(500).refine(validPageLink).default('')
}).strict();
const pageSectionSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(customSectionTypes),
  title: z.string().trim().max(120).default(''),
  text: z.string().trim().max(4000).default(''),
  imageUrl: z.string().trim().max(500).refine(validAssetUrl).default(''),
  videoUrl: z.string().trim().max(500).refine(validVideoUrl).default(''),
  linkLabel: z.string().trim().max(60).default(''),
  linkUrl: z.string().trim().max(500).refine(validPageLink).default(''),
  items: z.array(pageSectionItemSchema).max(12).default([])
}).strict();
const pageThemeSchema = z.object({
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#080808'),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#f4f4f4'),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#c8c8c8'),
  fontFamily: z.enum(pageFonts).default('DM Sans'),
  sectionSpacing: z.number().int().min(24).max(120).default(72)
}).strict();
const customPageSchema = z.object({
  title: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(2).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(300).default(''),
  bannerUrl: z.string().trim().max(500).refine(validAssetUrl).default(''),
  thumbnailUrl: z.string().trim().max(500).refine(validAssetUrl).default(''),
  visibility: z.enum(['public', 'private', 'unpublished']).default('unpublished'),
  sections: z.array(pageSectionSchema).max(40).default([]),
  theme: pageThemeSchema.default({
    backgroundColor: '#080808',
    textColor: '#f4f4f4',
    accentColor: '#c8c8c8',
    fontFamily: 'DM Sans',
    sectionSpacing: 72
  }),
}).strict();

function serializeCustomPage(page) {
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    description: page.description,
    bannerUrl: page.banner_url,
    thumbnailUrl: page.thumbnail_url,
    visibility: page.visibility,
    sections: JSON.parse(page.sections),
    theme: JSON.parse(page.theme),
    createdAt: page.created_at,
    updatedAt: page.updated_at,
    publishedAt: page.published_at
  };
}

function visibleNavigation(user) {
  const rows = db.prepare(`SELECT n.*, p.slug, p.visibility AS page_visibility
    FROM navigation_items n
    LEFT JOIN custom_pages p ON n.target_type = 'custom' AND p.id = n.target
    ORDER BY n.sort_order, n.label`).all();
  return rows.filter(item => {
    if (!item.visible) return false;
    if (item.audience === 'signed_in' && (!user || user.status !== 'active')) return false;
    if (item.audience === 'permission'
        && (!user || user.status !== 'active' || !hasPermission(user, item.required_permission))) return false;
    if (item.target_type === 'custom') {
      if (!item.slug || item.page_visibility === 'unpublished') return false;
      if (item.page_visibility === 'private' && (!user || user.status !== 'active')) return false;
    }
    return true;
  }).map(item => ({
    id: item.id,
    label: item.label,
    targetType: item.target_type,
    target: item.target_type === 'custom' ? item.slug : item.target,
    newTab: Boolean(item.new_tab),
    href: item.target_type === 'builtin' ? `#${item.target}`
      : item.target_type === 'custom' ? `#custom/${item.slug}` : item.target
  }));
}

function audit(user, action, target = '') {
  db.prepare('INSERT INTO audit_logs (id, actor_id, action, target_id) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), user.id, action, String(target));
  if (!process.env.DISCORD_ALERT_WEBHOOK_URL || action === 'page.image.uploaded') return;
  const key = `${action}:${target}`;
  const pending = pendingAuditAlerts.get(key);
  if (pending) clearTimeout(pending.timer);
  const alert = {
    action: action.replaceAll('.', ' '),
    target: String(target).slice(0, 100),
    actor: String(user.display_name || user.username).slice(0, 80)
  };
  const timer = setTimeout(() => {
    pendingAuditAlerts.delete(key);
    postDiscordWebhook({
      embeds: [{
        title: 'Crazy Studios · site update',
        description: `**${alert.actor}** · ${alert.action}${alert.target ? ` · \`${alert.target}\`` : ''}`,
        color: 10747647,
        timestamp: new Date().toISOString()
      }],
      allowed_mentions: { parse: [] }
    });
  }, 15000);
  timer.unref();
  pendingAuditAlerts.set(key, { timer });
}

const pendingAuditAlerts = new Map();

async function postDiscordWebhook(payload) {
  if (!process.env.DISCORD_ALERT_WEBHOOK_URL) return false;
  try {
    const response = await fetch(process.env.DISCORD_ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Discord webhook request failed (${response.status}).`);
    return true;
  } catch (error) {
    console.error('Discord alert delivery failed:', error.message);
    return false;
  }
}

function saveSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

async function sendDailyAnalyticsSummary() {
  if (!process.env.DISCORD_ALERT_WEBHOOK_URL) return;
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if ((setting('analyticsSummaryDate') || '') >= day) return;
  const rows = db.prepare(`SELECT page, event, count FROM visitor_analytics
    WHERE day = ? ORDER BY page, event`).all(day);
  if (!rows.length) {
    saveSetting('analyticsSummaryDate', day);
    return;
  }
  const views = rows.filter(row => row.event === 'view').reduce((total, row) => total + row.count, 0);
  const departures = rows.filter(row => row.event === 'departure').reduce((total, row) => total + row.count, 0);
  const fields = rows.map(row => ({
    name: `${row.page} · ${row.event === 'view' ? 'page views' : 'departures'}`,
    value: String(row.count),
    inline: true
  }));
  const sent = await postDiscordWebhook({
    embeds: [{
      title: `Opt-in visitor summary · ${day}`,
      description: `**${views}** page views · **${departures}** departures. These are aggregate counts; no visitor identities are recorded.`,
      color: 10747647,
      fields,
      timestamp: new Date().toISOString()
    }],
    allowed_mentions: { parse: [] }
  });
  if (sent) saveSetting('analyticsSummaryDate', day);
}

const analyticsSummaryTimer = setInterval(() => { sendDailyAnalyticsSummary(); }, 15 * 60 * 1000);
analyticsSummaryTimer.unref();
sendDailyAnalyticsSummary();

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

app.post('/api/analytics/events',
  rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }),
  express.text({ type: 'text/plain', limit: '1kb' }),
  (req, res) => {
  let eventBody = req.body;
  if (typeof eventBody === 'string') {
    try { eventBody = JSON.parse(eventBody); }
    catch { return res.status(400).json({ error: 'Analytics event is invalid.' }); }
  }
  const parsed = z.object({
    event: z.enum(['view', 'departure']),
    page: z.enum(['home', 'games', 'shop', 'announcements', 'staff', 'discord', 'custom', 'other'])
  }).strict().safeParse(eventBody);
  if (!parsed.success) return res.status(400).json({ error: 'Analytics event is invalid.' });
  const day = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO visitor_analytics (day, page, event, count) VALUES (?, ?, ?, 1)
    ON CONFLICT(day, page, event) DO UPDATE SET count = count + 1`)
    .run(day, parsed.data.page, parsed.data.event);
  res.sendStatus(204);
});

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
    permissionOptions: permissions,
    navigation: visibleNavigation(user),
    welcomeDm: req.session.welcomeDm || null
  });
  delete req.session.welcomeDm;
});

app.get('/api/pages/:slug', (req, res) => {
  const page = db.prepare('SELECT * FROM custom_pages WHERE slug = ? COLLATE NOCASE').get(req.params.slug);
  const user = currentUser(req);
  if (!page
      || (page.visibility === 'private' && (!user || user.status !== 'active'))
      || (page.visibility === 'unpublished'
        && (!user || user.status !== 'active' || !hasPermission(user, 'manage_pages')))) {
    return res.status(404).json({ error: 'Page not found.' });
  }
  res.json({ page: serializeCustomPage(page) });
});

app.get('/api/admin/dashboard', requireUser, requireAnyPermission(
  'manage_games', 'manage_shop', 'manage_announcements', 'manage_staff',
  'manage_users', 'manage_permissions', 'manage_pages', 'manage_navigation', 'manage_discord'
), (req, res) => {
  const count = table => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  const recentActivity = db.prepare(`SELECT a.id, a.action, a.target_id, a.created_at, u.username AS actor
    FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
    ORDER BY a.created_at DESC LIMIT 10`).all();
  res.json({
    stats: {
      users: count('users'),
      games: count('games'),
      products: count('products'),
      announcements: count('announcements'),
      pages: count('custom_pages'),
      publishedPages: db.prepare("SELECT COUNT(*) AS count FROM custom_pages WHERE visibility = 'public'").get().count
    },
    recentActivity
  });
});

app.get('/api/admin/pages', requireUser, requirePermission('manage_pages'), (req, res) => {
  const pages = db.prepare('SELECT * FROM custom_pages ORDER BY updated_at DESC, title COLLATE NOCASE').all();
  res.json(pages.map(serializeCustomPage));
});

app.post('/api/admin/pages', requireUser, requirePermission('manage_pages'), (req, res) => {
  const parsed = customPageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Page details are invalid.' });
  const page = parsed.data;
  const id = crypto.randomUUID();
  try {
    db.prepare(`INSERT INTO custom_pages
      (id, title, slug, description, banner_url, thumbnail_url, visibility, sections, theme, created_by, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'unpublished' THEN NULL ELSE datetime('now') END)`)
      .run(id, page.title, page.slug, page.description, page.bannerUrl, page.thumbnailUrl,
        page.visibility, JSON.stringify(page.sections), JSON.stringify(page.theme), req.user.id, page.visibility);
    audit(req.user, 'page.created', id);
    res.status(201).json({ page: serializeCustomPage(db.prepare('SELECT * FROM custom_pages WHERE id = ?').get(id)) });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That page URL is already in use.' });
    throw error;
  }
});

app.put('/api/admin/pages/:id', requireUser, requirePermission('manage_pages'), (req, res) => {
  const parsed = customPageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Page details are invalid.' });
  const existing = db.prepare('SELECT * FROM custom_pages WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Page not found.' });
  const page = parsed.data;
  try {
    db.prepare(`UPDATE custom_pages SET title = ?, slug = ?, description = ?, banner_url = ?, thumbnail_url = ?,
      visibility = ?, sections = ?, theme = ?, updated_at = datetime('now'),
      published_at = CASE WHEN ? = 'unpublished' THEN NULL
        WHEN published_at IS NULL THEN datetime('now') ELSE published_at END
      WHERE id = ?`)
      .run(page.title, page.slug, page.description, page.bannerUrl, page.thumbnailUrl,
        page.visibility, JSON.stringify(page.sections), JSON.stringify(page.theme), page.visibility, req.params.id);
    audit(req.user, page.visibility === 'unpublished' ? 'page.updated' : 'page.published', req.params.id);
    res.json({ page: serializeCustomPage(db.prepare('SELECT * FROM custom_pages WHERE id = ?').get(req.params.id)) });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That page URL is already in use.' });
    throw error;
  }
});

app.post('/api/admin/pages/:id/duplicate', requireUser, requirePermission('manage_pages'), (req, res) => {
  const original = db.prepare('SELECT * FROM custom_pages WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Page not found.' });
  const id = crypto.randomUUID();
  const baseSlug = original.slug.slice(0, 58).replace(/-+$/, '');
  let suffix = 1;
  let slug;
  do {
    const end = suffix === 1 ? '-copy' : `-copy-${suffix}`;
    slug = `${baseSlug.slice(0, 64 - end.length)}${end}`;
    suffix += 1;
  } while (db.prepare('SELECT 1 FROM custom_pages WHERE slug = ? COLLATE NOCASE').get(slug));
  db.prepare(`INSERT INTO custom_pages
    (id, title, slug, description, banner_url, thumbnail_url, visibility, sections, theme, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'unpublished', ?, ?, ?)`)
    .run(id, `Copy of ${original.title}`.slice(0, 100), slug, original.description, original.banner_url,
      original.thumbnail_url, original.sections, original.theme, req.user.id);
  audit(req.user, 'page.duplicated', id);
  res.status(201).json({ page: serializeCustomPage(db.prepare('SELECT * FROM custom_pages WHERE id = ?').get(id)) });
});

app.delete('/api/admin/pages/:id', requireUser, requirePermission('manage_pages'), (req, res) => {
  const page = db.prepare('SELECT id FROM custom_pages WHERE id = ?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Page not found.' });
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("DELETE FROM navigation_items WHERE target_type = 'custom' AND target = ?").run(page.id);
    db.prepare('DELETE FROM custom_pages WHERE id = ?').run(page.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  audit(req.user, 'page.deleted', page.id);
  res.json({ ok: true });
});

const imageTypes = new Map([
  ['image/png', { extension: '.png', signature: buffer => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
  ['image/jpeg', { extension: '.jpg', signature: buffer => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ['image/webp', { extension: '.webp', signature: buffer => buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' }]
]);
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: uploadsDirectory,
    filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}${imageTypes.get(file.mimetype)?.extension || ''}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => callback(
    imageTypes.has(file.mimetype) ? null : new Error('Upload a PNG, JPEG, or WebP image.'),
    imageTypes.has(file.mimetype)
  )
});

app.post('/api/admin/uploads', requireUser, requirePermission('manage_pages'), imageUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an image to upload.' });
  const data = fs.readFileSync(req.file.path);
  if (!imageTypes.get(req.file.mimetype).signature(data)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'The uploaded file is not a valid PNG, JPEG, or WebP image.' });
  }
  audit(req.user, 'page.image.uploaded', req.file.filename);
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

app.get('/api/admin/navigation', requireUser, requirePermission('manage_navigation'), (req, res) => {
  const items = db.prepare('SELECT * FROM navigation_items ORDER BY sort_order, label').all().map(item => ({
    id: item.id,
    label: item.label,
    targetType: item.target_type,
    target: item.target,
    visible: Boolean(item.visible),
    audience: item.audience,
    requiredPermission: item.required_permission,
    newTab: Boolean(item.new_tab),
    sortOrder: item.sort_order
  }));
  const pages = db.prepare('SELECT id, title, slug, visibility FROM custom_pages ORDER BY title COLLATE NOCASE').all();
  res.json({ items, pages });
});

const navigationItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  label: z.string().trim().min(1).max(64),
  targetType: z.enum(['builtin', 'custom', 'external']),
  target: z.string().trim().min(1).max(500),
  visible: z.boolean(),
  audience: z.enum(['public', 'signed_in', 'permission']),
  requiredPermission: z.union([z.enum(permissions), z.literal('')]).default(''),
  newTab: z.boolean(),
  sortOrder: z.number().int().min(0).max(10000)
}).strict();

app.put('/api/admin/navigation', requireUser, requirePermission('manage_navigation'), (req, res) => {
  const parsed = z.array(navigationItemSchema).max(50).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Navigation items are invalid.' });
  const items = parsed.data;
  const ids = new Set(items.map(item => item.id));
  if (ids.size !== items.length || builtinNavigation.some(([id]) => !ids.has(id))) {
    return res.status(400).json({ error: 'Keep every built-in navigation item and use unique item IDs.' });
  }
  for (const item of items) {
    if (item.audience === 'permission' && !item.requiredPermission) {
      return res.status(400).json({ error: 'Choose a permission for restricted navigation items.' });
    }
    if (item.targetType === 'builtin'
        && !builtinNavigation.some(([id]) => id === item.id && id === item.target)) {
      return res.status(400).json({ error: 'Built-in navigation destinations cannot be changed.' });
    }
    if (item.targetType === 'custom' && !db.prepare('SELECT 1 FROM custom_pages WHERE id = ?').get(item.target)) {
      return res.status(400).json({ error: 'Choose an existing custom page.' });
    }
    if (item.targetType === 'external' && !validHttpUrl(item.target)) {
      return res.status(400).json({ error: 'External navigation links must use HTTP or HTTPS.' });
    }
  }
  const save = db.prepare(`INSERT INTO navigation_items
    (id, label, target_type, target, visible, audience, required_permission, new_tab, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM navigation_items');
    for (const item of items) {
      save.run(item.id, item.label, item.targetType, item.target, item.visible ? 1 : 0,
        item.audience, item.requiredPermission, item.newTab ? 1 : 0, item.sortOrder);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  audit(req.user, 'navigation.updated');
  res.json({ ok: true });
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
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: status === 413 ? 'Images must be 5 MB or smaller.' : 'The image upload could not be processed.' });
  }
  if (error.message === 'Upload a PNG, JPEG, or WebP image.') {
    return res.status(400).json({ error: error.message });
  }
  console.error('API error:', error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Crazy Studios is running on port ${port}`));
