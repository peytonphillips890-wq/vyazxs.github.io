CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  discord_id TEXT UNIQUE,
  discord_username TEXT NOT NULL DEFAULT '',
  discord_avatar_url TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  banner_url TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
  is_ceo INTEGER NOT NULL DEFAULT 0 CHECK (is_ceo IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  permissions TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  play_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'In development',
  featured INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Digital',
  price TEXT NOT NULL DEFAULT '',
  purchase_url TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  featured INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  badge TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS custom_pages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  banner_url TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'unpublished' CHECK (visibility IN ('public', 'private', 'unpublished')),
  sections TEXT NOT NULL DEFAULT '[]',
  theme TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS navigation_items (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('builtin', 'custom', 'external')),
  target TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  audience TEXT NOT NULL DEFAULT 'public' CHECK (audience IN ('public', 'signed_in', 'permission')),
  required_permission TEXT NOT NULL DEFAULT '',
  new_tab INTEGER NOT NULL DEFAULT 0 CHECK (new_tab IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS custom_pages_visibility_order ON custom_pages (visibility, updated_at);
CREATE INDEX IF NOT EXISTS navigation_items_order ON navigation_items (sort_order);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS moderation (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS visitor_analytics (
  day TEXT NOT NULL,
  page TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('view', 'departure')),
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, page, event)
);
