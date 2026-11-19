# Crazy Studios

A responsive Crazy Studios website with an Express/SQLite backend, Discord OAuth sign-in, a Discord bot integration, and server-enforced management permissions.

## Run locally

Requirements: Node.js 22.5+ and npm.

```sh
npm install
cp .env.example .env
```

Generate a bcrypt hash for the CEO password, then set the resulting hash in `.env`:

```sh
node -e "require('bcryptjs').hash('your-password', 12).then(console.log)"
```

Set a random `SESSION_SECRET` of at least 32 characters. Configure the Discord OAuth application and callback URL (`http://localhost:3000/auth/discord/callback`) in the Discord Developer Portal, then set its client secret in `.env`.

```sh
npm start
```

The site is available at `http://localhost:3000`. SQLite data and sessions are created in `data/`; keep this directory private and backed up.

## Discord setup

- Add the OAuth callback URL from `DISCORD_REDIRECT_URI` to your Discord application's redirect URLs. OAuth requests only ask for the `identify` scope.
- Install the configured bot in server `1572061028391325737`. Set its token only as `DISCORD_BOT_TOKEN` on the server.
- To send welcome messages, the bot must be able to create a DM and send attachments. Sign-in remains successful if the DM fails; the site reports delivery status.
- For self-service role assignment, the bot needs the Manage Roles permission and its highest role must be above each role you make available. In Studio Settings, configure the exact server role IDs members may request. The server only assigns configured roles and reports Discord API failures.
- Keep OAuth secrets and the bot token out of frontend files and Git. Rotate them immediately if exposed.
- To receive moderation/content change alerts and daily opt-in analytics summaries in a Discord channel, create a channel webhook and set `DISCORD_ALERT_WEBHOOK_URL` only in the Express host's environment. This is a channel webhook, not a visitor DM; never put it in GitHub Pages or frontend code.

## Optional visitor analytics and alerts

Visitors see an analytics notice and must explicitly allow or decline. Only after opt-in does the browser send broad page-category views and a departure event; SQLite retains daily aggregate counts only, without account IDs, visitor IDs, URLs, or IP addresses. A “Privacy choices” control in the footer lets visitors change their choice. Discord receives only daily aggregate visitor summaries, never per-visitor notifications or DMs.

The same webhook receives debounced alerts for audited studio changes, including content edits/deletions and moderation actions. Alerts include the staff account name, action, and target record ID, but no visitor activity. Without `DISCORD_ALERT_WEBHOOK_URL`, analytics still works locally and no Discord alert is sent. Configure the webhook on the backend host (Render for the production API), not GitHub Pages.

## Deployment

Deploy this repository as a Node 22.5+ web service on a host that supports persistent storage. Configure the environment variables from `.env.example`, set `NODE_ENV=production`, and use the exact public URL for `BASE_URL` and `DISCORD_REDIRECT_URI`. Provide a persistent disk for the `data/` directory: SQLite sessions and application data are not suitable for an ephemeral filesystem.

GitHub Pages hosts the static frontend, while the Express API runs on Render. The frontend calls the Render API at `https://crazystudios-github-io.onrender.com`; configure `FRONTEND_URL` on Render as `https://peytonphillips890-wq.github.io/vyazxs.github.io/` so Discord sign-in returns to the Pages site. The API allows credentialed requests only from that configured frontend origin. Because Pages and Render are different sites, production session cookies use `SameSite=None; Secure`. Do not place server secrets in GitHub Pages settings that are exposed to client code.

## What's implemented

- Custom responsive studio site, functional section navigation, game search/status filters, configurable accent and Discord invite.
- Discord OAuth account creation, secure HTTP-only sessions, profile customization (username, display name, avatar/banner image URLs, and bio), public profile view, and clear welcome-DM delivery reporting.
- CEO password login using an environment-provided bcrypt hash. No default password is installed.
- Server-side permission checks, custom permission groups, user role assignment/removal, per-user allow/deny/inherit overrides, moderation, input validation, audit records, rate limiting, and SQLite persistence.
- Authorized CRUD for games, products, announcements, and staff. Shop and announcements start empty. A product's “Get it” action appears only when staff configure a real purchase URL; otherwise it is clearly unavailable.
- A responsive, charcoal-themed studio control room with overview statistics, activity, searchable management lists, and top-level Custom Pages access for authorized editors.
- A persistent custom page CMS: draft autosave, publish/private visibility, editable theme and sections (including galleries, cards, FAQs, dynamic studio content, and YouTube/Vimeo videos), preview, duplicate, delete, image uploads, and managed site navigation.
- Custom pages and navigation are stored in SQLite. Public pages are visible to everyone, private pages to signed-in active members, and unpublished pages to page managers only. Page edits, publishing, uploads, and navigation changes require their respective server-side permissions.

## Persistent uploads and page content

Custom-page image uploads are limited to PNG, JPEG, and WebP files up to 5 MB. SQLite content, sessions, and uploaded files are stored under `DATA_DIRECTORY` (default `data/`); use a persistent disk and include this directory in backups when deploying. The static GitHub Pages frontend requests custom page content and uploads from the Render API, so keep `FRONTEND_URL` configured to the Pages origin. Product purchase links can point to an existing checkout provider. Configure HTTPS in production; the session cookie is marked secure when `NODE_ENV=production`.
