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

## Deployment

Deploy this repository as a Node 22.5+ web service on a host that supports persistent storage. Configure the environment variables from `.env.example`, set `NODE_ENV=production`, and use the exact public URL for `BASE_URL` and `DISCORD_REDIRECT_URI`. Provide a persistent disk for the `data/` directory: SQLite sessions and application data are not suitable for an ephemeral filesystem.

GitHub Pages can host only the static frontend; it cannot run this backend, OAuth callback, SQLite database, or Discord bot requests. The included Pages workflow publishes `public/` as a static preview, where account sign-in and backend management are intentionally unavailable. Deploy the app as a single Node service (which also serves `public/`) or host the frontend separately and configure a same-origin API/reverse proxy. Do not place server secrets in GitHub Pages settings that are exposed to client code.

## What's implemented

- Custom responsive studio site, functional section navigation, game search/status filters, configurable accent and Discord invite.
- Discord OAuth account creation, secure HTTP-only sessions, profile customization (username, display name, avatar/banner image URLs, and bio), public profile view, and clear welcome-DM delivery reporting.
- CEO password login using an environment-provided bcrypt hash. No default password is installed.
- Server-side permission checks, custom permission groups, user role assignment/removal, per-user allow/deny/inherit overrides, moderation, input validation, audit records, rate limiting, and SQLite persistence.
- Authorized CRUD for games, products, announcements, and staff. Shop and announcements start empty. A product's “Get it” action appears only when staff configure a real purchase URL; otherwise it is clearly unavailable.

## Deployment scope

The initial implementation deliberately does not pretend to provide payment processing/order history, image-file uploads, TOTP two-factor authentication, scheduling, arbitrary page builders/navigation reordering, or a full custom badge catalog. Product purchase links can point to an existing checkout provider. Profile and content images use HTTPS URLs. Add these services and workflows before advertising them as available. Configure HTTPS in production; the session cookie is marked secure when `NODE_ENV=production`.
