const state = {
  data: null,
  games: [],
  products: [],
  announcements: [],
  staff: [],
  customPage: null,
  adminTab: 'overview',
  adminSearch: ''
};
const logo = 'https://imglink.cc/cdn/w_9tyzCBOe.png';
const githubPages = location.hostname.endsWith('.github.io');
const apiBaseUrl = githubPages ? 'https://crazystudios-github-io.onrender.com' : location.origin;
const apiUrl = path => new URL(path, apiBaseUrl).toString();
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const initials = value => String(value || 'CS').split(/[\s_-]+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
const can = permission => Boolean(state.data?.user?.isCeo || state.data?.user?.permissions?.includes(permission));

async function api(url, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(apiUrl(url), {
    ...options,
    credentials: 'include',
    headers: { ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    body: options.body && typeof options.body !== 'string' && !isFormData ? JSON.stringify(options.body) : options.body
  });
  const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
  if (!response.ok) {
    const method = (options.method || 'GET').toUpperCase();
    const requestPath = new URL(url, apiBaseUrl).pathname;
    throw new Error(result.error || `${method} ${requestPath} failed (${response.status}).`);
  }
  return result;
}

function toast(message, error = false) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.toggle('error', error);
  node.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('visible'), 3600);
}

function openModal(html) {
  $('#modal').innerHTML = html;
  $('#modal-backdrop').classList.remove('hidden');
  $('#modal').querySelector('[autofocus]')?.focus();
}

function closeModal() {
  $('#modal-backdrop').classList.add('hidden');
  $('#modal').replaceChildren();
}

function gameCard(game, compact = false) {
  return `<article class="game-card ${compact ? 'compact' : ''}">
    <div class="game-image ${game.image_url ? '' : 'image-placeholder'}">
      ${game.image_url ? `<img loading="lazy" src="${escapeHtml(game.image_url)}" alt="${escapeHtml(game.title)}">` : `<img src="${logo}" alt="">`}
      <span class="game-status">${escapeHtml(game.status || 'In development')}</span>
      ${game.featured ? '<span class="featured-label">✳ FEATURED</span>' : ''}
    </div>
    <div class="game-card-content"><div><h3>${escapeHtml(game.title)}</h3><p>${escapeHtml(game.description)}</p></div>
      ${game.play_url ? `<a class="icon-link" href="${escapeHtml(game.play_url)}" target="_blank" rel="noreferrer" aria-label="Play ${escapeHtml(game.title)}">↗</a>` : '<span class="coming-soon">IN DEVELOPMENT</span>'}
    </div>
  </article>`;
}

function announcementCard(item) {
  return `<article class="announcement-card ${item.featured ? 'featured' : ''}">
    <div class="announcement-meta"><span>${new Date(item.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span>${item.featured ? '<b>✳ FEATURED</b>' : ''}</div>
    <h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p><div class="announcement-author"><span class="avatar initials">${escapeHtml(initials(item.author))}</span><span>FROM THE STUDIO<br><b>${escapeHtml(item.author)}</b></span></div>
  </article>`;
}

function productCard(product) {
  return `<article class="product-card"><div class="product-image ${product.image_url ? '' : 'image-placeholder'}">
    ${product.image_url ? `<img loading="lazy" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.title)}">` : `<img src="${logo}" alt="">`}
    ${product.featured ? '<span class="featured-label">✳ FEATURED</span>' : ''}
  </div><div class="product-info"><span class="product-category">${escapeHtml(product.category)}</span><h3>${escapeHtml(product.title)}</h3><p>${escapeHtml(product.description)}</p>
    <div class="product-buy"><b>${escapeHtml(product.price || 'See details')}</b>${product.purchase_url ? `<a class="button button-outline button-small" href="${escapeHtml(product.purchase_url)}" target="_blank" rel="noreferrer">Get it <span>↗</span></a>` : '<span class="coming-soon">NOT AVAILABLE YET</span>'}</div>
  </div></article>`;
}

function staffCard(member) {
  return `<article class="staff-card"><div class="staff-avatar">${member.image_url ? `<img loading="lazy" src="${escapeHtml(member.image_url)}" alt="${escapeHtml(member.name)}">` : `<span>${escapeHtml(initials(member.name))}</span>`}</div>
    <div class="staff-info"><div class="staff-position">${escapeHtml(member.position)}${member.badge ? ` <span class="staff-badge">${escapeHtml(member.badge)}</span>` : ''}</div><h3>${escapeHtml(member.name)}</h3><p>${escapeHtml(member.bio)}</p></div></article>`;
}

function assetUrl(value) {
  return value?.startsWith('/uploads/') ? new URL(value, apiBaseUrl).toString() : value || '';
}

function videoEmbedUrl(value) {
  try {
    const url = new URL(value);
    if (['youtu.be', 'www.youtu.be'].includes(url.hostname)) return `https://www.youtube-nocookie.com/embed/${url.pathname.slice(1)}`;
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(url.hostname)) {
      const id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.split('/').pop();
      return `https://www.youtube-nocookie.com/embed/${id}`;
    }
    if (['vimeo.com', 'www.vimeo.com'].includes(url.hostname)) return `https://player.vimeo.com/video/${url.pathname.slice(1)}`;
  } catch {}
  return '';
}

function customPageLink(label, url, className = 'button button-primary') {
  if (!label || !url) return '';
  const external = /^https?:\/\//i.test(url);
  return `<a class="${className}" href="${escapeHtml(url)}" ${external ? 'target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(label)}${external ? ' ↗' : ''}</a>`;
}

function customPageSection(section) {
  const title = section.title ? `<h2>${escapeHtml(section.title)}</h2>` : '';
  const text = section.text ? `<p>${escapeHtml(section.text)}</p>` : '';
  const image = section.imageUrl
    ? `<img class="custom-section-image" loading="lazy" src="${escapeHtml(assetUrl(section.imageUrl))}" alt="${escapeHtml(section.title)}">` : '';
  const action = customPageLink(section.linkLabel, section.linkUrl);
  const items = section.items || [];
  const itemCards = items.map(item => `<article class="custom-content-card">
    ${item.imageUrl ? `<img loading="lazy" src="${escapeHtml(assetUrl(item.imageUrl))}" alt="${escapeHtml(item.title)}">` : ''}
    <div><h3>${escapeHtml(item.title || 'Untitled')}</h3>${item.text ? `<p>${escapeHtml(item.text)}</p>` : ''}
    ${customPageLink(item.linkLabel, item.linkUrl, 'custom-content-link')}</div>
  </article>`).join('');
  const dynamic = {
    games: state.games.length ? `<div class="game-grid">${state.games.map(game => gameCard(game, true)).join('')}</div>` : emptyState('—', 'Games are on the way.', 'Studio games will appear here.'),
    team: state.staff.length ? `<div class="staff-grid">${state.staff.map(staffCard).join('')}</div>` : emptyState('—', 'Meet the team soon.', 'Team profiles will appear here.'),
    news: state.announcements.length ? `<div class="announcement-grid">${state.announcements.map(announcementCard).join('')}</div>` : emptyState('—', 'No news yet.', 'Studio updates will appear here.'),
    shop: state.products.length ? `<div class="product-grid">${state.products.map(productCard).join('')}</div>` : emptyState('—', 'The shop is getting ready.', 'Studio products will appear here.'),
    discord: `<div class="custom-discord-card"><p>${escapeHtml(state.data.site?.discordDescription || 'Join the Crazy Studios community.')}</p>${customPageLink(section.linkLabel || 'Join our Discord', section.linkUrl || state.data.site?.discordInvite)}</div>`
  };
  let content = '';
  if (['games', 'team', 'news', 'shop', 'discord'].includes(section.type)) content = dynamic[section.type];
  else if (section.type === 'gallery') content = `<div class="custom-gallery">${items.map(item => item.imageUrl
    ? `<figure><img loading="lazy" src="${escapeHtml(assetUrl(item.imageUrl))}" alt="${escapeHtml(item.title)}"><figcaption>${escapeHtml(item.title)}</figcaption></figure>`
    : '').join('')}</div>`;
  else if (section.type === 'features') content = `<div class="custom-feature-grid">${itemCards}</div>`;
  else if (section.type === 'video') {
    const embedUrl = videoEmbedUrl(section.videoUrl);
    content = embedUrl ? `<div class="custom-video"><iframe src="${escapeHtml(embedUrl)}" title="${escapeHtml(section.title || 'Studio video')}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>` : '';
  }
  else if (section.type === 'faq') content = `<div class="custom-faq">${items.map(item => `<details><summary>${escapeHtml(item.title)}</summary><p>${escapeHtml(item.text)}</p></details>`).join('')}</div>`;
  else if (section.type === 'about') content = `<div class="custom-about">${image}${text}</div>`;
  else if (section.type === 'text') content = `<div class="custom-prose">${image}${text}</div>`;
  else if (section.type === 'hero' || section.type === 'cta') {
    return `<section class="custom-section custom-section-${section.type}" ${section.type === 'hero' && section.imageUrl ? `style="--hero-image:url('${escapeHtml(assetUrl(section.imageUrl))}')"` : ''}>
      <div class="custom-section-inner">${title}${text}${action}</div></section>`;
  } else content = `<div class="custom-prose">${image}${text}</div>`;
  const dynamicType = ['games', 'team', 'news', 'shop', 'discord'].includes(section.type);
  const structuredType = ['gallery', 'features', 'faq', 'about', 'text'].includes(section.type);
  return `<section class="custom-section custom-section-${escapeHtml(section.type)}"><div class="custom-section-inner">${title}${dynamicType || !structuredType ? text : ''}${content}${section.type !== 'discord' ? action : ''}</div></section>`;
}

function customPageMarkup(page) {
  const banner = page.bannerUrl
    ? `<div class="custom-page-banner"><img src="${escapeHtml(assetUrl(page.bannerUrl))}" alt=""></div>` : '';
  return `${banner}<header class="custom-page-heading"><span class="eyebrow">CRAZY STUDIOS · CUSTOM PAGE</span><h1>${escapeHtml(page.title)}</h1>${page.description ? `<p>${escapeHtml(page.description)}</p>` : ''}</header>
    ${(page.sections || []).map(customPageSection).join('') || emptyState('—', 'This page is ready for content.', 'The page builder can add sections at any time.')}`;
}

async function openCustomPage(slug) {
  const section = $('#page-custom');
  $$('.page').forEach(page => page.classList.toggle('active', page === section));
  $('#main-nav').classList.remove('mobile-open');
  history.replaceState(null, '', `#custom/${encodeURIComponent(slug)}`);
  section.innerHTML = '<div class="loading-state">Loading page…</div>';
  try {
    const { page } = await api(`/api/pages/${encodeURIComponent(slug)}`);
    section.innerHTML = customPageMarkup(page);
    section.style.setProperty('--custom-background', page.theme.backgroundColor);
    section.style.setProperty('--custom-text', page.theme.textColor);
    section.style.setProperty('--custom-accent', page.theme.accentColor);
    section.style.setProperty('--custom-spacing', `${page.theme.sectionSpacing}px`);
    section.style.setProperty('--custom-font', `"${page.theme.fontFamily}", sans-serif`);
    state.customPage = page;
    renderMainNavigation();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    section.innerHTML = emptyState('!', 'Page unavailable.', error.message);
    state.customPage = null;
  }
}

function render() {
  state.games = state.data.games || [];
  state.products = state.data.products || [];
  state.announcements = state.data.announcements || [];
  state.staff = state.data.staff || [];
  renderMainNavigation();
  const gamesMarkup = state.games.map(game => gameCard(game)).join('');
  $('#games-grid').innerHTML = gamesMarkup || emptyState('✳', 'The next world is loading.', 'We’re building something good. Check back soon.');
  $('#home-games').innerHTML = state.games.slice(0, 2).map(game => gameCard(game, true)).join('') || emptyState('✳', 'Something fun is in the works.', 'Our first game reveal is coming soon.');
  $('#shop-grid').innerHTML = state.products.map(productCard).join('') || emptyState('◈', 'Nothing in the shop. Yet.', 'Our store is taking a breather until the studio has something worth sharing.');
  $('#announcements-grid').innerHTML = state.announcements.map(announcementCard).join('') || emptyState('↗', 'No announcements just yet.', 'When the studio has news, you’ll find it here.');
  $('#home-news').innerHTML = state.announcements.slice(0, 2).map(announcementCard).join('') || emptyState('↗', 'Quiet at the studio.', 'News and announcements will show up here when they’re ready.');
  $('#staff-grid').innerHTML = state.staff.map(staffCard).join('') || emptyState('✳', 'Good things take a team.', 'Studio team introductions are coming soon.');
  const filters = [...new Set(state.games.map(game => game.status).filter(Boolean))];
  $('#game-filters').innerHTML = `<button class="filter-chip selected" data-filter="all">Everything <span>${state.games.length}</span></button>` + filters.map(filter => `<button class="filter-chip" data-filter="${escapeHtml(filter)}">${escapeHtml(filter)}</button>`).join('');
  $('#discord-description').textContent = state.data.site?.discordDescription || 'Join the conversation and meet the community.';
  const invite = state.data.site?.discordInvite;
  $('#discord-link').href = invite || '#';
  $('#discord-link').classList.toggle('disabled', !invite);
  $('#discord-link').onclick = invite ? null : event => { event.preventDefault(); toast('The Discord invite has not been configured yet.', true); };
  document.documentElement.style.setProperty('--accent', state.data.site?.accent || '#a3ff3f');
  $('#signin-button').classList.toggle('hidden', Boolean(state.data.user));
  $('#account-button').classList.toggle('hidden', !state.data.user);
  if (state.data.user) {
    $('#account-avatar').src = state.data.user.avatarUrl || logo;
    $('#account-avatar').alt = `${state.data.user.displayName || state.data.user.username} profile`;
  }
}

function renderMainNavigation() {
  const items = state.data.navigation || [];
  const currentHash = location.hash.slice(1);
  const activeBuiltin = currentHash.startsWith('custom/') ? '' : currentHash;
  const navigation = items.map(item => {
    const active = item.targetType === 'custom'
      ? currentHash === `custom/${item.target}`
      : item.targetType === 'builtin' && item.target === activeBuiltin;
    if (item.targetType === 'external') {
      return `<a class="nav-link" href="${escapeHtml(item.href)}" ${item.newTab ? 'target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(item.label)}</a>`;
    }
    if (item.targetType === 'custom') {
      return `<a class="nav-link ${active ? 'active' : ''}" href="${escapeHtml(item.href)}" data-custom-page="${escapeHtml(item.target)}">${escapeHtml(item.label)}</a>`;
    }
    return `<button class="nav-link ${active ? 'active' : ''}" data-page="${escapeHtml(item.target)}">${escapeHtml(item.label)}</button>`;
  }).join('');
  const customPagesButton = can('manage_pages')
    ? `<button class="nav-link custom-pages-link" data-open-custom-pages>CUSTOM PAGES</button>` : '';
  $('#main-nav').innerHTML = `${navigation}${customPagesButton}`;
}

function emptyState(icon, title, copy) {
  return `<div class="empty-state"><span class="empty-icon">${icon}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(copy)}</p></div>`;
}

function navigate(page) {
  const valid = ['home', 'games', 'shop', 'announcements', 'staff', 'discord'];
  const target = valid.includes(page) ? page : 'home';
  $$('.page').forEach(section => section.classList.toggle('active', section.id === `page-${target}`));
  $$('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.page === target));
  history.replaceState(null, '', `#${target}`);
  $('#main-nav').classList.remove('mobile-open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function navigateFromHash() {
  const route = location.hash.slice(1);
  if (route.startsWith('custom/')) {
    try { openCustomPage(decodeURIComponent(route.slice('custom/'.length))); }
    catch { openCustomPage(route.slice('custom/'.length)); }
  } else {
    navigate(route || 'home');
  }
}

function showSignIn() {
  openModal(`<button class="modal-close" data-close aria-label="Close">×</button><div class="modal-brand"><img src="${logo}" alt=""></div>
    <div class="eyebrow">WELCOME TO THE STUDIO</div><h2 id="modal-title">Find your people.</h2><p class="modal-copy">Connect your Discord account and step into the Crazy Studios community.</p>
    <a class="button button-primary full-button" href="${escapeHtml(apiUrl('/api/auth/discord'))}">Continue with Discord <span>↗</span></a>
    <button class="subtle-link" id="ceo-login-open">Studio admin sign in</button>`);
  $('#ceo-login-open').onclick = showCeoLogin;
}

function showCeoLogin() {
  openModal(`<button class="modal-close" data-close aria-label="Close">×</button><div class="eyebrow">RESTRICTED ACCESS</div><h2 id="modal-title">Studio admin.</h2><p class="modal-copy">Sign in with the CEO credentials configured for this deployment.</p>
    <form id="ceo-form" class="form-stack"><label>Username<input name="username" autocomplete="username" required autofocus></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="button button-primary full-button">Sign in securely <span>↗</span></button></form>
    <p class="form-footnote">Credentials are checked on the secure server and are never stored in the website.</p>`);
  $('#ceo-form').onsubmit = async event => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try { await api('/api/auth/ceo', { method: 'POST', body: form }); await load(); closeModal(); toast('Welcome back.'); }
    catch (error) { toast(error.message, true); }
  };
}

function showAccount() {
  const user = state.data.user;
  const admin = user.isCeo || ['manage_games', 'manage_shop', 'manage_announcements', 'manage_staff', 'manage_users', 'manage_permissions', 'manage_pages', 'manage_navigation', 'manage_discord'].some(can);
  openModal(`<button class="modal-close" data-close aria-label="Close">×</button><div class="account-card">
    <img class="account-large-avatar" src="${escapeHtml(user.avatarUrl || logo)}" alt=""><div><div class="eyebrow">YOUR CRAZY STUDIOS ACCOUNT</div><h2 id="modal-title">${escapeHtml(user.displayName || user.username)}</h2><p class="muted-text">@${escapeHtml(user.username)}${user.discordUsername ? ` · Discord ${escapeHtml(user.discordUsername)}` : ''}</p></div></div>
    <div class="account-actions"><button class="button button-outline full-button" id="edit-profile">Customize your profile</button>
    ${admin ? '<button class="button button-primary full-button" id="open-admin">Open studio control room <span>↗</span></button>' : ''}
    <button class="button button-outline full-button" id="view-profile">View public profile</button>
    ${state.data.roleOptions?.length ? `<div class="role-claim"><label for="role-select">Choose a community role</label><div class="inline-form"><select id="role-select">${state.data.roleOptions.map(role => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.label)}</option>`).join('')}</select><button class="button button-outline" id="claim-role">Add role</button></div></div>` : ''}
    <button class="subtle-link" id="signout-button">Sign out</button></div>`);
  $('#edit-profile').onclick = showProfileEditor;
  $('#open-admin')?.addEventListener('click', showAdmin);
  $('#view-profile').onclick = async () => {
    try {
      const profile = await api(`/api/profile/${user.id}`);
      openModal(`<button class="modal-close" data-close aria-label="Close">×</button><div class="public-profile-banner" style="${profile.bannerUrl ? `background-image:url('${escapeHtml(profile.bannerUrl)}')` : ''}"></div>
        <div class="public-profile-head"><img src="${escapeHtml(profile.avatarUrl || logo)}" alt=""><div><div class="eyebrow">CRAZY STUDIOS COMMUNITY</div><h2 id="modal-title">${escapeHtml(profile.displayName || profile.username)}</h2><p class="muted-text">@${escapeHtml(profile.username)}${profile.discordUsername ? ` · Discord ${escapeHtml(profile.discordUsername)}` : ''}</p></div></div>
        <p class="profile-bio">${escapeHtml(profile.bio || 'A member of the Crazy Studios community.')}</p><p class="profile-joined">HERE SINCE ${new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>`);
    } catch (error) { toast(error.message, true); }
  };
  $('#signout-button').onclick = async () => { try { await api('/api/auth/logout', { method: 'POST' }); await load(); closeModal(); toast('You’re signed out.'); } catch (error) { toast(error.message, true); } };
  $('#claim-role')?.addEventListener('click', async () => {
    try { const result = await api('/api/discord/role', { method: 'POST', body: { roleId: $('#role-select').value } }); toast(result.message); }
    catch (error) { toast(error.message, true); }
  });
}

function showProfileEditor() {
  const user = state.data.user;
  openModal(`<button class="modal-close" data-close aria-label="Close">×</button><div class="eyebrow">MAKE IT YOURS</div><h2 id="modal-title">Your profile.</h2><p class="modal-copy">Your username, photo, banner, and bio are yours to shape.</p>
    <form id="profile-form" class="form-stack">
      <label>Username <input name="username" maxlength="24" value="${escapeHtml(user.username)}" required></label>
      <label>Display name <input name="displayName" maxlength="40" value="${escapeHtml(user.displayName || '')}"></label>
      <label>Profile picture URL <input name="avatarUrl" type="url" value="${escapeHtml(user.avatarUrl || '')}" placeholder="https://..."></label>
      <label>Banner image URL <input name="bannerUrl" type="url" value="${escapeHtml(user.bannerUrl || '')}" placeholder="https://..."></label>
      <label>About you <textarea name="bio" maxlength="240" rows="3" placeholder="A little about yourself...">${escapeHtml(user.bio || '')}</textarea></label>
      <button class="button button-primary full-button">Save profile <span>↗</span></button>
    </form>`);
  $('#profile-form').onsubmit = async event => {
    event.preventDefault();
    try { await api('/api/profile', { method: 'PATCH', body: Object.fromEntries(new FormData(event.currentTarget)) }); await load(); showAccount(); toast('Your profile is updated.'); }
    catch (error) { toast(error.message, true); }
  };
}

const managers = {
  games: { title: 'Games', permission: 'manage_games', fields: [['title', 'Game title'], ['description', 'Short description'], ['image_url', 'Thumbnail URL'], ['play_url', 'Roblox game URL'], ['status', 'Status'], ['featured', 'Feature this game', 'checkbox']] },
  products: { title: 'Shop', permission: 'manage_shop', fields: [['title', 'Product name'], ['description', 'Description'], ['image_url', 'Product image URL'], ['category', 'Category'], ['price', 'Price'], ['purchase_url', 'Purchase link'], ['featured', 'Feature this product', 'checkbox']] },
  announcements: { title: 'News', permission: 'manage_announcements', fields: [['title', 'Headline'], ['body', 'Announcement'], ['author', 'Author name'], ['featured', 'Pin as featured', 'checkbox']] },
  staff: { title: 'Team', permission: 'manage_staff', fields: [['name', 'Name'], ['position', 'Role / position'], ['image_url', 'Profile image URL'], ['bio', 'Short bio'], ['badge', 'Badge']] }
};

function canOpenAdminTab(tab) {
  if (tab === 'overview') return true;
  if (managers[tab]) return can(managers[tab].permission);
  if (tab === 'users') return can('manage_users') || can('manage_permissions');
  if (tab === 'roles') return can('manage_permissions');
  if (tab === 'pages') return can('manage_pages');
  if (tab === 'navigation') return can('manage_navigation');
  if (tab === 'settings') return can('manage_pages') || can('manage_discord');
  return false;
}

function showAdmin(tab = 'overview') {
  if (!canOpenAdminTab(tab)) tab = 'overview';
  state.adminTab = tab;
  state.adminSearch = '';
  const nav = [
    ['overview', 'Overview', true],
    ...Object.entries(managers).map(([key, manager]) => [key, manager.title, can(manager.permission)]),
    ['users', 'People', can('manage_users') || can('manage_permissions')],
    ['roles', 'Permissions', can('manage_permissions')],
    ['pages', 'Custom pages', can('manage_pages')],
    ['navigation', 'Navigation', can('manage_navigation')],
    ['settings', 'Settings', can('manage_pages') || can('manage_discord')]
  ].filter(([, , visible]) => visible)
    .map(([key, label]) => `<button class="admin-side-link ${key === tab ? 'selected' : ''}" data-admin-tab="${key}">${escapeHtml(label)}</button>`)
    .join('');
  openModal(`<div id="admin-shell" class="admin-dashboard">
    <aside class="admin-sidebar">
      <a class="admin-brand" href="#home"><img src="${logo}" alt=""><span>CRAZY <b>STUDIOS</b><small>STUDIO CONTROL</small></span></a>
      <nav class="admin-side-nav" aria-label="Studio management">${nav}</nav>
      <div class="admin-sidebar-footer"><span class="admin-status-dot"></span> Signed in as ${escapeHtml(state.data.user.displayName || state.data.user.username)}</div>
    </aside>
    <section class="admin-workspace">
      <header class="admin-header"><div><span class="admin-kicker">WORKSPACE</span><h2 id="modal-title">Studio dashboard</h2></div>
        <div class="admin-header-actions"><label class="admin-search"><span>⌕</span><input id="admin-search" type="search" placeholder="Search this section…" autocomplete="off"></label>
        <button class="admin-close" data-close aria-label="Close dashboard">Close <span>×</span></button></div>
      </header>
      <div id="admin-content" class="admin-content"></div>
    </section>
  </div>`);
  $$('#admin-shell [data-admin-tab]').forEach(button => button.onclick = () => showAdmin(button.dataset.adminTab));
  $('#admin-search').addEventListener('input', event => {
    state.adminSearch = event.target.value.trim().toLowerCase();
    renderAdminTab(state.adminTab);
  });
  renderAdminTab(tab);
}

function renderAdminTab(tab) {
  if (tab === 'overview') return renderAdminDashboard();
  if (tab === 'users') return renderAdminUsers();
  if (tab === 'roles') return renderAdminRoles();
  if (tab === 'pages') return renderAdminPages();
  if (tab === 'navigation') return renderAdminNavigation();
  if (tab === 'settings') return renderAdminSettings();
  renderAdminCollection(tab);
}

async function renderAdminDashboard() {
  $('#admin-content').innerHTML = '<div class="admin-loading"><span></span><span></span><span></span></div>';
  try {
    const { stats, recentActivity } = await api('/api/admin/dashboard');
    $('#admin-content').innerHTML = `<section class="dashboard-welcome"><div><span class="admin-kicker">CRAZY STUDIOS · LIVE WORKSPACE</span><h1>Good to see you, ${escapeHtml(state.data.user.displayName || state.data.user.username)}.</h1><p>Your studio at a glance. Pick up where the creative work happens.</p></div><span class="dashboard-mark">CS<span>✳</span></span></section>
      <section class="dashboard-stats" aria-label="Studio statistics">
        ${[['Users', stats.users, 'People'], ['Games', stats.games, 'Games'], ['Shop items', stats.products, 'products'], ['Published news', stats.announcements, 'announcements'], ['Custom pages', stats.pages, 'pages'], ['Live pages', stats.publishedPages, 'pages']].map(([label, count, tab]) => `<button class="dashboard-stat" data-admin-tab="${tab === 'People' ? 'users' : tab}"><span>${escapeHtml(label)}</span><strong>${Number(count).toLocaleString()}</strong><small>Open ${escapeHtml(label.toLowerCase())} <b>↗</b></small></button>`).join('')}
      </section>
      <section class="dashboard-lower"><div class="dashboard-panel"><div class="dashboard-panel-heading"><div><span class="admin-kicker">GET THINGS MOVING</span><h2>Quick actions</h2></div></div>
        <div class="quick-actions">${[['games', '＋ Add a game'], ['products', '＋ Add a shop item'], ['announcements', '＋ Write news'], ['pages', '＋ Build a page'], ['navigation', '↗ Edit navigation']].filter(([tab]) => canOpenAdminTab(tab)).map(([tab, label]) => `<button class="quick-action" data-admin-tab="${tab}">${escapeHtml(label)}<span>↗</span></button>`).join('')}</div>
      </div><div class="dashboard-panel"><div class="dashboard-panel-heading"><div><span class="admin-kicker">THE LATEST</span><h2>Recent activity</h2></div></div>
        <div class="activity-list">${recentActivity.map(activity => `<div class="activity-row"><span class="activity-marker"></span><div><b>${escapeHtml((activity.action || 'updated').replaceAll('.', ' '))}</b><small>${escapeHtml(activity.actor || 'Studio')} · ${new Date(`${activity.created_at.replace(' ', 'T')}Z`).toLocaleString()}</small></div></div>`).join('') || '<p class="admin-empty">Your studio activity will show up here.</p>'}</div>
      </div></section>`;
    $$('#admin-content [data-admin-tab]').forEach(button => button.onclick = () => showAdmin(button.dataset.adminTab));
  } catch (error) {
    $('#admin-content').innerHTML = `<p class="admin-error">${escapeHtml(error.message)}</p>`;
  }
}

function editorForm(manager, item = {}) {
  return `<form class="admin-form" data-collection-form="${state.adminTab}" data-id="${escapeHtml(item.id || '')}">
    ${manager.fields.map(([name, label, type]) => type === 'checkbox'
      ? `<label class="checkbox-label"><input type="checkbox" name="${name}" ${item[name] ? 'checked' : ''}> ${label}</label>`
      : `<label>${label}<${name === 'body' || name === 'description' ? 'textarea rows="3"' : 'input'} name="${name}" ${name === 'image_url' || name === 'play_url' || name === 'purchase_url' ? 'type="url"' : ''} value="${name === 'body' || name === 'description' ? '' : escapeHtml(item[name] || '')}" placeholder="${label}" ${name === 'body' || name === 'description' ? '>' + escapeHtml(item[name] || '') + '</textarea>' : '>'}</label>`).join('')}
    <div class="form-buttons"><button class="button button-primary">${item.id ? 'Save changes' : 'Publish'} <span>↗</span></button><button type="button" class="button button-outline" data-cancel-edit>Cancel</button></div>
  </form>`;
}

function adminRows(collection, manager) {
  const search = state.adminSearch;
  return (state.data[collection] || []).filter(item => `${item.title || item.name} ${item.description || item.body || ''} ${item.status || item.position || item.price || item.author || ''}`.toLowerCase().includes(search)).map(item => `<div class="admin-row"><div class="admin-row-copy"><b>${escapeHtml(item.title || item.name)}</b><span>${escapeHtml(item.status || item.position || item.price || item.author || '')}</span></div>
    <div class="admin-row-actions"><button class="small-action" data-edit="${escapeHtml(item.id)}" data-collection="${collection}">Edit</button><button class="small-action danger" data-delete="${escapeHtml(item.id)}" data-collection="${collection}">Remove</button></div></div>`).join('') || '<p class="empty-admin">No items yet. Add the first one below.</p>';
}

function renderAdminCollection(collection) {
  const manager = managers[collection];
  if (!manager || !can(manager.permission)) return showAdmin();
  $('#admin-content').innerHTML = `<div class="admin-list">${adminRows(collection, manager)}</div><button id="new-item" class="button button-outline full-button">＋ Add ${manager.title.toLowerCase()} item</button><div id="admin-editor"></div>`;
  $('#new-item').onclick = () => { $('#admin-editor').innerHTML = editorForm(manager); wireCollectionForm(); };
  $$('[data-edit]').forEach(button => button.onclick = () => {
    const item = (state.data[collection] || []).find(value => value.id === button.dataset.edit);
    $('#admin-editor').innerHTML = editorForm(manager, item);
    wireCollectionForm();
  });
  $$('[data-delete]').forEach(button => button.onclick = async () => {
    if (!confirm('Remove this item? This cannot be undone.')) return;
    try { await api(`/api/admin/${collection}/${button.dataset.delete}`, { method: 'DELETE' }); await load(); showAdmin(collection); toast('Item removed.'); }
    catch (error) { toast(error.message, true); }
  });
}

function wireCollectionForm() {
  $('[data-cancel-edit]')?.addEventListener('click', () => { $('#admin-editor').replaceChildren(); });
  $('[data-collection-form]')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form));
    form.querySelectorAll('input[type="checkbox"]').forEach(input => payload[input.name] = input.checked);
    try {
      const url = `/api/admin/${form.dataset.collection}${form.dataset.id ? `/${form.dataset.id}` : ''}`;
      await api(url, { method: form.dataset.id ? 'PUT' : 'POST', body: payload });
      await load(); showAdmin(form.dataset.collection); toast('Changes published.');
    } catch (error) { toast(error.message, true); }
  });
}

async function renderAdminUsers() {
  $('#admin-content').innerHTML = '<div class="loading-state">Loading registered accounts…</div>';
  try {
    const users = await api('/api/admin/users');
    $('#admin-content').innerHTML = users.filter(user => `${user.display_name} ${user.username} ${user.discord_username} ${user.status} ${(user.roles || []).map(role => role.name).join(' ')}`.toLowerCase().includes(state.adminSearch)).map(user => `<div class="admin-row user-row"><div class="admin-row-copy"><b>${escapeHtml(user.display_name || user.username)}</b><span>@${escapeHtml(user.username)} · ${escapeHtml(user.discord_username || 'No Discord')} · ${escapeHtml(user.status)}${user.roles?.length ? ` · Roles: ${user.roles.map(role => escapeHtml(role.name)).join(', ')}` : ''}</span></div>${user.is_ceo ? '<span class="staff-badge">CEO</span>' : `${can('manage_permissions') ? `<button class="small-action" data-access="${escapeHtml(user.id)}">Access</button>` : ''}${user.status === 'active' && can('ban_users') ? `<button class="small-action danger" data-moderate="${escapeHtml(user.id)}" data-action="ban">Ban</button>` : ''}${user.status === 'banned' && can('unban_users') ? `<button class="small-action" data-moderate="${escapeHtml(user.id)}" data-action="unban">Unban</button>` : ''}`}</div>`).join('') || '<p class="empty-admin">No registered users match your search.</p>';
    $$('[data-moderate]').forEach(button => button.onclick = async () => {
      const note = prompt('Optional moderation note:') || '';
      try { await api(`/api/admin/users/${button.dataset.moderate}/moderation`, { method: 'POST', body: { action: button.dataset.action, note } }); renderAdminUsers(); toast('Account status updated.'); }
      catch (error) { toast(error.message, true); }
    });
    $$('[data-access]').forEach(button => button.onclick = async () => {
      try {
        const access = await api(`/api/admin/users/${button.dataset.access}/permissions`);
        $('#admin-content .user-access-form')?.remove();
        $('#admin-content').insertAdjacentHTML('beforeend', `<form class="admin-form user-access-form" data-user-id="${escapeHtml(button.dataset.access)}">
          <h3>Custom access</h3><div class="permission-grid">${access.permissions.map(permission => {
            const override = access.overrides.find(value => value.permission === permission);
            return `<label>${escapeHtml(permission.replaceAll('_', ' '))}<select name="${escapeHtml(permission)}"><option value="" ${!override ? 'selected' : ''}>Inherit</option><option value="true" ${override?.allowed === true ? 'selected' : ''}>Allow</option><option value="false" ${override?.allowed === false ? 'selected' : ''}>Deny</option></select></label>`;
          }).join('')}</div>
          <div class="role-list">${access.roles.map(role => `<span class="assigned-role">${escapeHtml(role.name)} <button type="button" class="small-action danger" data-unassign="${escapeHtml(role.id)}">×</button></span>`).join('')}</div>
          <div class="form-buttons"><button class="button button-primary">Save individual overrides</button><button type="button" class="button button-outline" data-cancel-edit>Cancel</button></div></form>`);
        const form = $('#admin-content .user-access-form');
        form.onsubmit = async event => {
          event.preventDefault();
          const overrides = [...form.querySelectorAll('select')].map(select => ({
            permission: select.name,
            allowed: select.value === '' ? null : select.value === 'true'
          }));
          try { await api(`/api/admin/users/${form.dataset.userId}/permissions`, { method: 'PUT', body: overrides }); renderAdminUsers(); toast('Individual permissions saved.'); }
          catch (error) { toast(error.message, true); }
        };
        form.querySelectorAll('[data-unassign]').forEach(remove => remove.onclick = async () => {
          try { await api(`/api/admin/users/${form.dataset.userId}/roles/${remove.dataset.unassign}`, { method: 'DELETE' }); renderAdminUsers(); toast('Role removed.'); }
          catch (error) { toast(error.message, true); }
        });
        form.querySelector('[data-cancel-edit]').onclick = () => form.remove();
      } catch (error) { toast(error.message, true); }
    });
  } catch (error) { $('#admin-content').innerHTML = `<p class="error-copy">${escapeHtml(error.message)}</p>`; }
}

async function renderAdminRoles() {
  $('#admin-content').innerHTML = '<div class="loading-state">Loading roles…</div>';
  try {
    const { roles, permissions } = await api('/api/admin/roles');
    $('#admin-content').innerHTML = `<h3>Permission groups</h3>${roles.filter(role => `${role.name} ${role.description} ${role.permissions.join(' ')}`.toLowerCase().includes(state.adminSearch)).map(role => `<div class="admin-row"><div class="admin-row-copy"><b>${escapeHtml(role.name)}</b><span>${role.permissions.map(escapeHtml).join(' · ') || 'No permissions'}</span></div><button class="small-action" data-edit-role="${escapeHtml(role.id)}">Edit</button><button class="small-action danger" data-delete-role="${escapeHtml(role.id)}">Delete</button></div>`).join('') || '<p class="empty-admin">No matching permission groups.</p>'}
      <form id="role-form" class="admin-form role-form"><h3>Create a role</h3><label>Role name<input name="name" required maxlength="32"></label><label>Description<input name="description" maxlength="160"></label><div class="permission-grid">${permissions.map(permission => `<label class="checkbox-label"><input type="checkbox" name="permissions" value="${escapeHtml(permission)}"> ${escapeHtml(permission.replaceAll('_', ' '))}</label>`).join('')}</div><button class="button button-primary">Create role <span>↗</span></button></form>
      <div class="role-assign"><h3>Assign a role</h3><form id="assign-role" class="inline-form"><select name="userId" required><option value="">Choose a user</option></select><select name="roleId" required><option value="">Choose a role</option>${roles.map(role => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.name)}</option>`).join('')}</select><button class="button button-outline">Assign</button></form></div>`;
    const users = await api('/api/admin/users');
    $('#assign-role [name="userId"]').innerHTML = '<option value="">Choose a user</option>' + users.filter(user => !user.is_ceo).map(user => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.display_name || user.username)}</option>`).join('');
    $('#role-form').onsubmit = async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const payload = { name: form.get('name'), description: form.get('description'), permissions: form.getAll('permissions') };
      try { await api('/api/admin/roles', { method: 'POST', body: payload }); renderAdminRoles(); toast('Permission group created.'); }
      catch (error) { toast(error.message, true); }
    };
    $('#assign-role').onsubmit = async event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      try { await api(`/api/admin/users/${values.userId}/roles`, { method: 'POST', body: { roleId: values.roleId } }); renderAdminRoles(); toast('Role assigned.'); }
      catch (error) { toast(error.message, true); }
    };
    $$('[data-edit-role]').forEach(button => button.onclick = () => {
      const role = roles.find(value => value.id === button.dataset.editRole);
      const form = $('#role-form');
      form.elements.namedItem('name').value = role.name;
      form.elements.namedItem('description').value = role.description;
      form.querySelectorAll('[name="permissions"]').forEach(input => input.checked = role.permissions.includes(input.value));
      form.dataset.editId = role.id; form.querySelector('button').textContent = 'Save role';
    });
    $('#role-form').onsubmit = async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const payload = { name: form.get('name'), description: form.get('description'), permissions: form.getAll('permissions') };
      try { await api(`/api/admin/roles${event.currentTarget.dataset.editId ? `/${event.currentTarget.dataset.editId}` : ''}`, { method: event.currentTarget.dataset.editId ? 'PUT' : 'POST', body: payload }); renderAdminRoles(); toast('Role saved.'); }
      catch (error) { toast(error.message, true); }
    };
    $$('[data-delete-role]').forEach(button => button.onclick = async () => {
      if (!confirm('Delete this role?')) return;
      try { await api(`/api/admin/roles/${button.dataset.deleteRole}`, { method: 'DELETE' }); renderAdminRoles(); toast('Role deleted.'); }
      catch (error) { toast(error.message, true); }
    });
  } catch (error) { $('#admin-content').innerHTML = `<p class="error-copy">${escapeHtml(error.message)}</p>`; }
}

const pageSectionLabels = {
  hero: 'Hero banner',
  about: 'About section',
  games: 'Game showcase',
  gallery: 'Image gallery',
  team: 'Staff / team',
  news: 'News feed',
  shop: 'Shop showcase',
  discord: 'Discord community',
  text: 'Custom text',
  features: 'Feature cards',
  video: 'Video',
  cta: 'Call to action',
  faq: 'FAQ'
};

async function renderAdminPages() {
  $('#admin-content').innerHTML = '<div class="admin-loading"><span></span><span></span><span></span></div>';
  try {
    const pages = await api('/api/admin/pages');
    state.customPages = pages;
    renderAdminPageList();
  } catch (error) {
    $('#admin-content').innerHTML = `<p class="admin-error">${escapeHtml(error.message)}</p>`;
  }
}

function renderAdminPageList() {
  const search = state.adminSearch;
  const pages = (state.customPages || []).filter(page => `${page.title} ${page.slug} ${page.description} ${page.visibility}`.toLowerCase().includes(search));
  $('#admin-content').innerHTML = `<section class="admin-section-heading"><div><span class="admin-kicker">NO-CODE WEBSITE BUILDER</span><h1>Custom pages</h1><p>Create and publish studio pages with a visual editor. Drafts are saved to the studio database automatically.</p></div><button id="create-custom-page" class="button button-primary">＋ New page</button></section>
    <div class="page-library-summary"><span>${pages.length} ${pages.length === 1 ? 'page' : 'pages'}</span><span>Changes persist in the studio database</span></div>
    <div class="page-library">${pages.map(page => `<article class="page-library-card" data-page-card="${escapeHtml(page.id)}">
      <div class="page-library-image">${page.thumbnailUrl ? `<img loading="lazy" src="${escapeHtml(assetUrl(page.thumbnailUrl))}" alt="">` : '<span>CS</span>'}<span class="visibility-pill ${escapeHtml(page.visibility)}">${escapeHtml(page.visibility)}</span></div>
      <div class="page-library-copy"><h2>${escapeHtml(page.title)}</h2><p>/${escapeHtml(page.slug)}</p><small>${escapeHtml(page.description || 'No description')} · Updated ${new Date(page.updatedAt.replace(' ', 'T') + (page.updatedAt.includes('Z') ? '' : 'Z')).toLocaleDateString()}</small>
        <div class="page-card-actions"><button class="small-action" data-page-edit="${escapeHtml(page.id)}">Edit</button><button class="small-action" data-page-preview="${escapeHtml(page.id)}">Preview</button><button class="small-action" data-page-duplicate="${escapeHtml(page.id)}">Duplicate</button><button class="small-action danger" data-page-delete="${escapeHtml(page.id)}">Delete</button></div>
      </div>
    </article>`).join('') || `<div class="admin-empty-panel"><span class="empty-icon">✳</span><h2>${search ? 'No matching pages.' : 'Your next big idea starts here.'}</h2><p>${search ? 'Try a different search.' : 'Build a landing page, studio update, or showcase without writing code.'}</p>${search ? '' : '<button class="button button-outline" id="create-first-page">Create your first page</button>'}</div>`}</div>`;
  $('#create-custom-page')?.addEventListener('click', createCustomPage);
  $('#create-first-page')?.addEventListener('click', createCustomPage);
  $$('[data-page-edit]').forEach(button => button.onclick = () => {
    const page = state.customPages.find(item => item.id === button.dataset.pageEdit);
    if (page) showCustomPageEditor(page);
  });
  $$('[data-page-preview]').forEach(button => button.onclick = () => {
    const page = state.customPages.find(item => item.id === button.dataset.pagePreview);
    if (page) showCustomPageEditor(page, true);
  });
  $$('[data-page-duplicate]').forEach(button => button.onclick = async () => {
    try {
      const { page } = await api(`/api/admin/pages/${button.dataset.pageDuplicate}/duplicate`, { method: 'POST', body: {} });
      state.customPages.unshift(page);
      showCustomPageEditor(page);
      toast('Page duplicated as an unpublished draft.');
    } catch (error) { toast(error.message, true); }
  });
  $$('[data-page-delete]').forEach(button => button.onclick = async () => {
    if (!confirm('Delete this custom page and remove its navigation links? This cannot be undone.')) return;
    try {
      await api(`/api/admin/pages/${button.dataset.pageDelete}`, { method: 'DELETE' });
      state.customPages = state.customPages.filter(page => page.id !== button.dataset.pageDelete);
      renderAdminPageList();
      toast('Page deleted.');
    } catch (error) { toast(error.message, true); }
  });
}

async function createCustomPage() {
  const page = {
    title: 'Untitled page',
    slug: `new-page-${Date.now().toString(36)}`,
    description: '',
    bannerUrl: '',
    thumbnailUrl: '',
    visibility: 'unpublished',
    sections: [],
    theme: { backgroundColor: '#080808', textColor: '#f4f4f4', accentColor: '#c8c8c8', fontFamily: 'DM Sans', sectionSpacing: 72 }
  };
  try {
    const result = await api('/api/admin/pages', { method: 'POST', body: page });
    state.customPages = [result.page, ...(state.customPages || [])];
    showCustomPageEditor(result.page);
  } catch (error) { toast(error.message, true); }
}

function showCustomPageEditor(page, previewOnly = false) {
  state.pageDraft = JSON.parse(JSON.stringify(page));
  state.pageVisibilityChoice = page.visibility;
  state.pageSaveQueue = Promise.resolve();
  renderPageEditor(previewOnly);
}

function pageUploadField(label, value, inputAttributes, uploadAttributes) {
  return `<label class="builder-field">${escapeHtml(label)}<div class="builder-upload-row"><input ${inputAttributes} value="${escapeHtml(value || '')}" placeholder="https://…"><label class="upload-button">Upload<input type="file" accept="image/png,image/jpeg,image/webp" ${uploadAttributes}></label></div></label>`;
}

function renderPageEditor() {
  const page = state.pageDraft;
  const sections = page.sections.map((section, index) => {
    const editableItems = ['gallery', 'features', 'faq'].includes(section.type);
    const sectionId = escapeHtml(section.id);
    return `<article class="builder-section-card" draggable="true" data-editor-section="${sectionId}">
      <header class="builder-section-header"><span class="drag-handle" title="Drag to reorder">⠿</span><b>${escapeHtml(pageSectionLabels[section.type])}</b><span class="section-order">${index + 1}</span><div class="builder-section-actions"><button type="button" class="small-action" data-section-up="${sectionId}" aria-label="Move section up">↑</button><button type="button" class="small-action" data-section-down="${sectionId}" aria-label="Move section down">↓</button><button type="button" class="small-action" data-section-duplicate="${sectionId}" aria-label="Duplicate section">⧉</button><button type="button" class="small-action danger" data-section-delete="${sectionId}" aria-label="Delete section">×</button></div></header>
      <div class="builder-section-fields">
        <label class="builder-field">Section title<input data-section-id="${sectionId}" data-section-field="title" value="${escapeHtml(section.title)}" maxlength="120" placeholder="Section title"></label>
        <label class="builder-field">Text / description<textarea data-section-id="${sectionId}" data-section-field="text" rows="3" maxlength="4000" placeholder="Write the words visitors should see…">${escapeHtml(section.text)}</textarea></label>
        ${pageUploadField('Image URL', section.imageUrl, `data-section-id="${sectionId}" data-section-field="imageUrl"`, `data-section-upload="${sectionId}"`)}
        ${section.type === 'video' ? `<label class="builder-field">YouTube or Vimeo URL<input data-section-id="${sectionId}" data-section-field="videoUrl" type="url" value="${escapeHtml(section.videoUrl)}" maxlength="500" placeholder="https://youtu.be/…"></label>` : ''}
        <div class="builder-field-pair"><label class="builder-field">Button label<input data-section-id="${sectionId}" data-section-field="linkLabel" value="${escapeHtml(section.linkLabel)}" maxlength="60"></label><label class="builder-field">Button link<input data-section-id="${sectionId}" data-section-field="linkUrl" value="${escapeHtml(section.linkUrl)}" maxlength="500" placeholder="https://… or #games"></label></div>
        ${editableItems ? `<div class="builder-items"><div class="builder-items-heading"><b>${section.type === 'faq' ? 'Questions' : section.type === 'gallery' ? 'Gallery images' : 'Feature cards'}</b><button type="button" class="small-action" data-item-add="${sectionId}">＋ Add item</button></div>
          ${(section.items || []).map((item, itemIndex) => `<div class="builder-item-card"><div class="builder-item-heading"><span>Item ${itemIndex + 1}</span><button type="button" class="small-action danger" data-item-delete="${sectionId}" data-item-index="${itemIndex}">Remove</button></div>
            <label class="builder-field">${section.type === 'faq' ? 'Question' : 'Title'}<input data-section-id="${sectionId}" data-item-index="${itemIndex}" data-section-field="title" value="${escapeHtml(item.title)}" maxlength="120"></label>
            ${section.type !== 'gallery' ? `<label class="builder-field">${section.type === 'faq' ? 'Answer' : 'Description'}<textarea data-section-id="${sectionId}" data-item-index="${itemIndex}" data-section-field="text" rows="2" maxlength="1200">${escapeHtml(item.text)}</textarea></label>` : ''}
            ${section.type !== 'faq' ? pageUploadField('Image URL', item.imageUrl, `data-section-id="${sectionId}" data-item-index="${itemIndex}" data-section-field="imageUrl"`, `data-item-upload="${sectionId}" data-item-index="${itemIndex}"`) : ''}
            ${section.type === 'features' ? `<div class="builder-field-pair"><label class="builder-field">Link label<input data-section-id="${sectionId}" data-item-index="${itemIndex}" data-section-field="linkLabel" value="${escapeHtml(item.linkLabel)}"></label><label class="builder-field">Link URL<input data-section-id="${sectionId}" data-item-index="${itemIndex}" data-section-field="linkUrl" value="${escapeHtml(item.linkUrl)}"></label></div>` : ''}
          </div>`).join('')}
        </div>` : ''}
      </div>
    </article>`;
  }).join('');
  $('#admin-content').innerHTML = `<div class="builder-toolbar"><button class="text-button" id="back-to-pages">← All pages</button><div class="builder-toolbar-title"><strong>${escapeHtml(page.title || 'Untitled page')}</strong><span id="page-save-status">Saved</span></div>
      <div class="builder-toolbar-actions"><select id="page-visibility" aria-label="Page visibility"><option value="unpublished" ${state.pageVisibilityChoice === 'unpublished' ? 'selected' : ''}>Unpublished</option><option value="public" ${state.pageVisibilityChoice === 'public' ? 'selected' : ''}>Public</option><option value="private" ${state.pageVisibilityChoice === 'private' ? 'selected' : ''}>Private · members</option></select>
      <button class="button button-quiet" id="page-preview-open">Preview</button><button class="button button-outline" id="page-save-draft">Save draft</button><button class="button button-primary" id="page-apply-visibility">Apply visibility</button></div></div>
    <div class="page-builder-layout">
      <div class="page-builder-controls">
        <section class="builder-panel"><span class="admin-kicker">PAGE DETAILS</span><h2>Make it yours</h2>
          <label class="builder-field">Page title<input data-page-field="title" value="${escapeHtml(page.title)}" maxlength="100" required></label>
          <label class="builder-field">URL slug<div class="slug-input"><span>/</span><input data-page-field="slug" value="${escapeHtml(page.slug)}" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxlength="64" required></div></label>
          <label class="builder-field">Short description<textarea data-page-field="description" rows="2" maxlength="300">${escapeHtml(page.description)}</textarea></label>
          ${pageUploadField('Banner image', page.bannerUrl, 'data-page-field="bannerUrl"', 'data-page-upload="bannerUrl"')}
          ${pageUploadField('Thumbnail', page.thumbnailUrl, 'data-page-field="thumbnailUrl"', 'data-page-upload="thumbnailUrl"')}
        </section>
        <section class="builder-panel"><span class="admin-kicker">VISUAL STYLE</span><h2>Page appearance</h2>
          <div class="theme-color-row"><label>Background<input type="color" data-theme-field="backgroundColor" value="${escapeHtml(page.theme.backgroundColor)}"></label><label>Text<input type="color" data-theme-field="textColor" value="${escapeHtml(page.theme.textColor)}"></label><label>Accent<input type="color" data-theme-field="accentColor" value="${escapeHtml(page.theme.accentColor)}"></label></div>
          <div class="builder-field-pair"><label class="builder-field">Font<select data-theme-field="fontFamily">${['DM Sans', 'Space Grotesk', 'Arial'].map(font => `<option ${page.theme.fontFamily === font ? 'selected' : ''}>${font}</option>`).join('')}</select></label>
            <label class="builder-field">Section spacing <span id="spacing-label">${page.theme.sectionSpacing}px</span><input type="range" min="24" max="120" step="4" data-theme-field="sectionSpacing" value="${page.theme.sectionSpacing}"></label></div>
        </section>
        <section class="builder-panel"><div class="builder-sections-heading"><div><span class="admin-kicker">DRAG TO REORDER</span><h2>Page sections</h2></div><span>${page.sections.length}/40</span></div>
          <div id="page-section-list">${sections || '<p class="admin-empty">Add a section to start building your page.</p>'}</div>
          <div class="add-section-row"><select id="section-type">${Object.entries(pageSectionLabels).map(([type, label]) => `<option value="${type}">${label}</option>`).join('')}</select><button class="button button-outline" id="add-page-section">＋ Add section</button></div>
        </section>
      </div>
      <aside class="page-preview-column"><div class="page-preview-heading"><span class="admin-kicker">LIVE PREVIEW</span><span class="preview-dot">●</span></div><div id="page-preview" class="page-preview"></div></aside>
    </div>`;
  wirePageEditor();
  renderPagePreview();
}

function renderPagePreview() {
  const preview = $('#page-preview');
  if (!preview || !state.pageDraft) return;
  preview.innerHTML = customPageMarkup(state.pageDraft);
  const theme = state.pageDraft.theme;
  preview.style.setProperty('--custom-background', theme.backgroundColor);
  preview.style.setProperty('--custom-text', theme.textColor);
  preview.style.setProperty('--custom-accent', theme.accentColor);
  preview.style.setProperty('--custom-spacing', `${theme.sectionSpacing}px`);
  preview.style.setProperty('--custom-font', `"${theme.fontFamily}", sans-serif`);
}

function wirePageEditor() {
  const root = $('#admin-content');
  $('#back-to-pages').onclick = () => { state.pageDraft = null; renderAdminPages(); };
  $('#page-visibility').onchange = event => { state.pageVisibilityChoice = event.target.value; };
  root.addEventListener('input', updatePageDraftFromInput);
  root.addEventListener('change', updatePageDraftFromInput);
  $('#add-page-section').onclick = () => {
    if (state.pageDraft.sections.length >= 40) return toast('A page can have up to 40 sections.', true);
    const type = $('#section-type').value;
    state.pageDraft.sections.push({ id: crypto.randomUUID(), type, title: '', text: '', imageUrl: '', videoUrl: '', linkLabel: '', linkUrl: '', items: [] });
    renderPageEditor();
    schedulePageAutosave();
  };
  $('#page-section-list').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const id = button.dataset.sectionDelete || button.dataset.sectionDuplicate || button.dataset.sectionUp || button.dataset.sectionDown || button.dataset.itemAdd || button.dataset.itemDelete;
    if (!id) return;
    const sectionIndex = state.pageDraft.sections.findIndex(section => section.id === id);
    if (button.dataset.sectionDelete) {
      if (!confirm('Remove this section from the page?')) return;
      state.pageDraft.sections.splice(sectionIndex, 1);
    } else if (button.dataset.sectionDuplicate) {
      const duplicate = JSON.parse(JSON.stringify(state.pageDraft.sections[sectionIndex]));
      duplicate.id = crypto.randomUUID();
      state.pageDraft.sections.splice(sectionIndex + 1, 0, duplicate);
    } else if (button.dataset.sectionUp && sectionIndex > 0) {
      [state.pageDraft.sections[sectionIndex - 1], state.pageDraft.sections[sectionIndex]] = [state.pageDraft.sections[sectionIndex], state.pageDraft.sections[sectionIndex - 1]];
    } else if (button.dataset.sectionDown && sectionIndex < state.pageDraft.sections.length - 1) {
      [state.pageDraft.sections[sectionIndex + 1], state.pageDraft.sections[sectionIndex]] = [state.pageDraft.sections[sectionIndex], state.pageDraft.sections[sectionIndex + 1]];
    } else if (button.dataset.itemAdd) {
      state.pageDraft.sections[sectionIndex].items.push({ title: '', text: '', imageUrl: '', linkLabel: '', linkUrl: '' });
    } else if (button.dataset.itemDelete) {
      if (!confirm('Remove this item?')) return;
      state.pageDraft.sections[sectionIndex].items.splice(Number(button.dataset.itemIndex), 1);
    }
    renderPageEditor();
    schedulePageAutosave();
  });
  $('#page-section-list').querySelectorAll('[data-editor-section]').forEach(card => {
    card.addEventListener('dragstart', event => {
      event.dataTransfer.setData('text/plain', card.dataset.editorSection);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', event => event.preventDefault());
    card.addEventListener('drop', event => {
      event.preventDefault();
      const draggedId = event.dataTransfer.getData('text/plain');
      const from = state.pageDraft.sections.findIndex(section => section.id === draggedId);
      const to = state.pageDraft.sections.findIndex(section => section.id === card.dataset.editorSection);
      if (from < 0 || to < 0 || from === to) return;
      const [moved] = state.pageDraft.sections.splice(from, 1);
      state.pageDraft.sections.splice(to, 0, moved);
      renderPageEditor();
      schedulePageAutosave();
    });
  });
  root.addEventListener('change', async event => {
    const input = event.target.closest('[data-page-upload], [data-section-upload], [data-item-upload]');
    if (input?.files?.[0]) await uploadPageImage(input);
  });
  $('#page-save-draft').onclick = async () => {
    state.pageVisibilityChoice = 'unpublished';
    $('#page-visibility').value = 'unpublished';
    state.pageDraft.visibility = 'unpublished';
    await persistPageDraft(true);
  };
  $('#page-apply-visibility').onclick = async () => {
    state.pageDraft.visibility = state.pageVisibilityChoice;
    await persistPageDraft(true);
  };
  $('#page-preview-open').onclick = async () => {
    const previewWindow = window.open('about:blank', '_blank');
    if (await persistPageDraft(false) && previewWindow) {
      previewWindow.location = `${location.origin}${location.pathname}#custom/${encodeURIComponent(state.pageDraft.slug)}`;
    } else if (!previewWindow) {
      toast('Allow pop-ups to open the saved page preview.', true);
    }
  };
}

function updatePageDraftFromInput(event) {
  const input = event.target;
  if (input.matches('[data-page-field]')) {
    state.pageDraft[input.dataset.pageField] = input.value;
    if (input.dataset.pageField === 'title') $('.builder-toolbar-title strong').textContent = input.value || 'Untitled page';
  } else if (input.matches('[data-theme-field]')) {
    const field = input.dataset.themeField;
    state.pageDraft.theme[field] = field === 'sectionSpacing' ? Number(input.value) : input.value;
    if (field === 'sectionSpacing') $('#spacing-label').textContent = `${input.value}px`;
  } else if (input.matches('[data-section-id][data-section-field]')) {
    const section = state.pageDraft.sections.find(item => item.id === input.dataset.sectionId);
    if (!section) return;
    if (input.dataset.itemIndex !== undefined) {
      section.items[Number(input.dataset.itemIndex)][input.dataset.sectionField] = input.value;
    } else {
      section[input.dataset.sectionField] = input.value;
    }
  } else {
    return;
  }
  renderPagePreview();
  schedulePageAutosave();
}

function schedulePageAutosave() {
  clearTimeout(state.pageSaveTimer);
  $('#page-save-status').textContent = 'Unsaved changes';
  state.pageSaveTimer = setTimeout(() => persistPageDraft(false), 850);
}

async function persistPageDraft(showSuccess) {
  clearTimeout(state.pageSaveTimer);
  const page = JSON.parse(JSON.stringify(state.pageDraft));
  $('#page-save-status').textContent = 'Saving…';
  let saved = false;
  const save = async () => {
    const { id, title, slug, description, bannerUrl, thumbnailUrl, visibility, sections, theme } = page;
    const response = await api(`/api/admin/pages/${id}`, {
      method: 'PUT',
      body: { title, slug, description, bannerUrl, thumbnailUrl, visibility, sections, theme }
    });
    if (state.pageDraft?.id === page.id) {
      state.pageDraft.updatedAt = response.page.updatedAt;
      $('#page-save-status').textContent = `Saved · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }
    saved = true;
    if (showSuccess) toast(page.visibility === 'unpublished' ? 'Draft saved.' : 'Page visibility updated.');
  };
  state.pageSaveQueue = state.pageSaveQueue.then(save).catch(error => {
    if (state.pageDraft?.id === page.id) $('#page-save-status').textContent = `Save failed: ${error.message}`;
    if (showSuccess) toast(error.message, true);
  });
  await state.pageSaveQueue;
  return saved;
}

async function uploadPageImage(input) {
  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) return toast('Images must be 5 MB or smaller.', true);
  const form = new FormData();
  form.append('file', file);
  input.disabled = true;
  try {
    const { url } = await api('/api/admin/uploads', { method: 'POST', body: form });
    if (input.matches('[data-page-upload]')) {
      state.pageDraft[input.dataset.pageUpload] = url;
    } else if (input.matches('[data-section-upload]')) {
      state.pageDraft.sections.find(section => section.id === input.dataset.sectionUpload).imageUrl = url;
    } else {
      const section = state.pageDraft.sections.find(item => item.id === input.dataset.itemUpload);
      section.items[Number(input.dataset.itemIndex)].imageUrl = url;
    }
    renderPageEditor();
    renderPagePreview();
    schedulePageAutosave();
    toast('Image uploaded.');
  } catch (error) { toast(error.message, true); }
  finally { input.disabled = false; }
}

async function renderAdminNavigation() {
  $('#admin-content').innerHTML = '<div class="admin-loading"><span></span><span></span><span></span></div>';
  try {
    const result = await api('/api/admin/navigation');
    state.navigationDraft = result.items;
    state.navigationPages = result.pages;
    renderNavigationEditor();
  } catch (error) {
    $('#admin-content').innerHTML = `<p class="admin-error">${escapeHtml(error.message)}</p>`;
  }
}

function renderNavigationEditor() {
  const search = state.adminSearch;
  const items = state.navigationDraft;
  const permissionOptions = (state.data.permissionOptions || []).map(permission => `<option value="${escapeHtml(permission)}">${escapeHtml(permission.replaceAll('_', ' '))}</option>`).join('');
  const builtinOptions = [['home', 'Home'], ['games', 'Games'], ['shop', 'Shop'], ['announcements', 'News'], ['staff', 'Studio'], ['discord', 'Community']];
  $('#admin-content').innerHTML = `<section class="admin-section-heading"><div><span class="admin-kicker">SITE-WIDE CONTROLS</span><h1>Navigation</h1><p>Rename, reorder, hide, or restrict tabs across the main Crazy Studios website navigation.</p></div><div class="nav-editor-actions"><button class="button button-outline" id="add-navigation-link">＋ Add link</button><button class="button button-primary" id="save-navigation">Save navigation</button></div></section>
    <div class="page-library-summary"><span>${items.filter(item => `${item.label} ${item.target} ${item.targetType} ${item.audience}`.toLowerCase().includes(search)).length} matching items</span><span>Changes update the public site navigation</span></div>
    <div id="navigation-list">${items.map((item, index) => {
      const isBuiltin = item.targetType === 'builtin';
      const matchesSearch = `${item.label} ${item.target} ${item.targetType} ${item.audience}`.toLowerCase().includes(search);
      const targetControl = isBuiltin
        ? `<div class="nav-destination-readonly"><span>BUILT-IN DESTINATION</span><b>${escapeHtml(builtinOptions.find(([value]) => value === item.target)?.[1] || item.target)}</b></div>`
        : item.targetType === 'custom'
          ? `<label class="builder-field">Custom page<select name="target" required>${state.navigationPages.map(page => `<option value="${escapeHtml(page.id)}" ${page.id === item.target ? 'selected' : ''}>${escapeHtml(page.title)} · ${escapeHtml(page.visibility)}</option>`).join('') || '<option value="">Create a page first</option>'}</select></label>`
          : `<label class="builder-field">External URL<input name="target" type="url" required value="${escapeHtml(item.target)}" placeholder="https://example.com"></label>`;
      return `<article class="navigation-item" draggable="true" data-nav-item="${escapeHtml(item.id)}" ${matchesSearch ? '' : 'hidden'}>
        <header class="navigation-item-heading"><span class="drag-handle">⠿</span><b>${escapeHtml(isBuiltin ? 'Main website tab' : 'Custom link')}</b><div class="builder-section-actions"><button type="button" class="small-action" data-nav-up="${escapeHtml(item.id)}" aria-label="Move navigation up">↑</button><button type="button" class="small-action" data-nav-down="${escapeHtml(item.id)}" aria-label="Move navigation down">↓</button>${isBuiltin ? '' : `<button type="button" class="small-action danger" data-nav-remove="${escapeHtml(item.id)}" aria-label="Remove navigation link">×</button>`}</div></header>
        <div class="navigation-item-fields">
          <label class="builder-field">Tab name<input name="label" required maxlength="64" value="${escapeHtml(item.label)}"></label>
          ${isBuiltin ? '<input type="hidden" name="targetType" value="builtin">' : `<label class="builder-field">Link type<select name="targetType"><option value="custom" ${item.targetType === 'custom' ? 'selected' : ''}>Custom page</option><option value="external" ${item.targetType === 'external' ? 'selected' : ''}>External URL</option></select></label>`}
          <div class="navigation-destination" data-destination="${escapeHtml(item.targetType)}">${targetControl}</div>
          <label class="builder-field">Who can see it<select name="audience"><option value="public" ${item.audience === 'public' ? 'selected' : ''}>Everyone</option><option value="signed_in" ${item.audience === 'signed_in' ? 'selected' : ''}>Signed-in members</option><option value="permission" ${item.audience === 'permission' ? 'selected' : ''}>Permission required</option></select></label>
          <label class="builder-field nav-permission-field" ${item.audience === 'permission' ? '' : 'hidden'}>Required permission<select name="requiredPermission"><option value="">Choose permission</option>${permissionOptions.replace(`value="${escapeHtml(item.requiredPermission)}"`, `value="${escapeHtml(item.requiredPermission)}" selected`)}</select></label>
          <label class="nav-toggle"><input type="checkbox" name="visible" ${item.visible ? 'checked' : ''}> Show this tab</label>
          <label class="nav-toggle"><input type="checkbox" name="newTab" ${item.newTab ? 'checked' : ''}> Open in a new tab</label>
        </div>
      </article>`;
    }).join('') || '<p class="admin-empty">No navigation items match your search.</p>'}</div>`;
  $('#add-navigation-link').onclick = () => {
    state.navigationDraft.push({
      id: crypto.randomUUID(), label: 'New link', targetType: 'external', target: '',
      visible: true, audience: 'public', requiredPermission: '', newTab: true, sortOrder: state.navigationDraft.length
    });
    state.adminSearch = '';
    $('#admin-search').value = '';
    renderNavigationEditor();
  };
  $('#save-navigation').onclick = saveNavigation;
  $$('#navigation-list .navigation-item').forEach(row => {
    row.querySelector('[name="targetType"]')?.addEventListener('change', () => {
      state.adminSearch = '';
      $('#admin-search').value = '';
      state.navigationDraft = collectNavigationItems();
      const item = state.navigationDraft.find(entry => entry.id === row.dataset.navItem);
      if (item) {
        item.targetType = row.querySelector('[name="targetType"]').value;
        item.target = item.targetType === 'custom' ? state.navigationPages[0]?.id || '' : '';
      }
      renderNavigationEditor();
    });
    row.querySelector('[name="audience"]').addEventListener('change', event => {
      row.querySelector('.nav-permission-field').hidden = event.target.value !== 'permission';
    });
    row.querySelector('[data-nav-remove]')?.addEventListener('click', () => {
      if (!confirm('Remove this custom navigation link?')) return;
      state.navigationDraft = collectNavigationItems().filter(item => item.id !== row.dataset.navItem);
      renderNavigationEditor();
    });
    row.querySelector('[data-nav-up]')?.addEventListener('click', () => moveNavigationItem(row.dataset.navItem, -1));
    row.querySelector('[data-nav-down]')?.addEventListener('click', () => moveNavigationItem(row.dataset.navItem, 1));
    row.addEventListener('dragstart', event => event.dataTransfer.setData('text/plain', row.dataset.navItem));
    row.addEventListener('dragover', event => event.preventDefault());
    row.addEventListener('drop', event => {
      event.preventDefault();
      const from = state.navigationDraft.findIndex(item => item.id === event.dataTransfer.getData('text/plain'));
      const to = state.navigationDraft.findIndex(item => item.id === row.dataset.navItem);
      if (from < 0 || to < 0 || from === to) return;
      const [moved] = state.navigationDraft.splice(from, 1);
      state.navigationDraft.splice(to, 0, moved);
      renderNavigationEditor();
    });
  });
}

function collectNavigationItems() {
  return [...$('#navigation-list').querySelectorAll('.navigation-item')].map((row, sortOrder) => ({
    id: row.dataset.navItem,
    label: row.querySelector('[name="label"]').value,
    targetType: row.querySelector('[name="targetType"]').value,
    target: row.querySelector('.navigation-destination [name="target"]')?.value
      || (row.querySelector('[name="targetType"]').value === 'builtin' ? row.dataset.navItem : ''),
    visible: row.querySelector('[name="visible"]').checked,
    audience: row.querySelector('[name="audience"]').value,
    requiredPermission: row.querySelector('[name="requiredPermission"]').value,
    newTab: row.querySelector('[name="newTab"]').checked,
    sortOrder
  }));
}

function moveNavigationItem(id, offset) {
  state.navigationDraft = collectNavigationItems();
  const index = state.navigationDraft.findIndex(item => item.id === id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= state.navigationDraft.length) return;
  [state.navigationDraft[index], state.navigationDraft[target]] = [state.navigationDraft[target], state.navigationDraft[index]];
  renderNavigationEditor();
}

async function saveNavigation() {
  const items = collectNavigationItems();
  try {
    await api('/api/admin/navigation', { method: 'PUT', body: items });
    state.navigationDraft = items;
    await load();
    renderNavigationEditor();
    toast('Website navigation saved.');
  } catch (error) { toast(error.message, true); }
}

function renderAdminSettings() {
  const site = state.data.site || {};
  const roles = state.data.roleOptions || [];
  $('#admin-content').innerHTML = `${can('manage_pages') ? `<form id="site-settings" class="admin-form"><h3>Website appearance</h3><label>Accent color<input type="color" name="accent" value="${escapeHtml(site.accent || '#a3ff3f')}"></label><label>Discord invite URL<input type="url" name="discordInvite" value="${escapeHtml(site.discordInvite || '')}" placeholder="https://discord.gg/..."></label><label>Community description<input name="discordDescription" maxlength="180" value="${escapeHtml(site.discordDescription || '')}"></label><button class="button button-primary">Save website settings</button></form>` : ''}
    ${can('manage_discord') ? `<form id="discord-roles" class="admin-form"><h3>Self-service Discord roles</h3><p class="modal-copy">Only role IDs you configure here can be requested by members. The bot must be in your server and have permission to manage each selected role.</p><div id="role-option-list">${roles.map((role, index) => roleOptionRow(role, index)).join('')}</div><button type="button" id="add-role-option" class="button button-outline">＋ Add role option</button><button class="button button-primary">Save role options</button></form>` : ''}`;
  $('#site-settings')?.addEventListener('submit', async event => {
    event.preventDefault();
    try { await api('/api/admin/settings/site', { method: 'PUT', body: Object.fromEntries(new FormData(event.currentTarget)) }); await load(); showAdmin('settings'); toast('Website settings saved.'); }
    catch (error) { toast(error.message, true); }
  });
  $('#add-role-option')?.addEventListener('click', () => {
    $('#role-option-list').insertAdjacentHTML('beforeend', roleOptionRow({}, $('#role-option-list').children.length));
    wireRoleRemove();
  });
  $('#discord-roles')?.addEventListener('submit', async event => {
    event.preventDefault();
    const options = [...$('#role-option-list').querySelectorAll('.role-option')].map(row => ({ id: row.querySelector('[name="roleId"]').value, label: row.querySelector('[name="label"]').value }));
    try { await api('/api/admin/settings/roles', { method: 'PUT', body: options }); await load(); showAdmin('settings'); toast('Discord role settings saved.'); }
    catch (error) { toast(error.message, true); }
  });
  wireRoleRemove();
}

function roleOptionRow(role, index) {
  return `<div class="role-option"><label>Discord role ID<input name="roleId" inputmode="numeric" value="${escapeHtml(role.id || '')}" placeholder="Role ID" required></label><label>Member-facing name<input name="label" value="${escapeHtml(role.label || '')}" placeholder="Community member" required></label><button type="button" class="small-action danger" data-remove-role>Remove</button></div>`;
}

function wireRoleRemove() {
  $$('[data-remove-role]').forEach(button => button.onclick = () => button.closest('.role-option').remove());
}

async function load() {
  state.data = await api('/api/bootstrap');
  render();
}

$('#main-nav').addEventListener('click', event => {
  const button = event.target.closest('[data-page]');
  if (button) navigate(button.dataset.page);
});
document.addEventListener('click', event => {
  const customPageLink = event.target.closest('[data-custom-page]');
  if (customPageLink) {
    event.preventDefault();
    openCustomPage(customPageLink.dataset.customPage);
  }
  if (event.target.closest('[data-open-custom-pages]')) showAdmin('pages');
  const go = event.target.closest('[data-go]');
  if (go) navigate(go.dataset.go);
  if (event.target.closest('[data-close]') || event.target === $('#modal-backdrop')) closeModal();
});
$('#signin-button').onclick = showSignIn;
$('#account-button').onclick = showAccount;
$('#menu-button').onclick = () => $('#main-nav').classList.toggle('mobile-open');
$('#game-search').addEventListener('input', event => {
  const query = event.target.value.trim().toLowerCase();
  const filter = $('.filter-chip.selected')?.dataset.filter || 'all';
  $('#games-grid').innerHTML = state.games.filter(game => (filter === 'all' || game.status === filter) && `${game.title} ${game.description}`.toLowerCase().includes(query)).map(game => gameCard(game)).join('') || emptyState('⌕', 'No worlds found.', 'Try another search or status filter.');
});
$('#game-filters').addEventListener('click', event => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  $$('.filter-chip').forEach(chip => chip.classList.toggle('selected', chip === button));
  $('#game-search').dispatchEvent(new Event('input'));
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
window.addEventListener('hashchange', navigateFromHash);
$('#year').textContent = new Date().getFullYear();
const initialRoute = location.hash.slice(1) || 'home';
if (initialRoute.startsWith('custom/')) {
  $('#page-custom').classList.add('active');
  $$('.page:not(#page-custom)').forEach(page => page.classList.remove('active'));
} else {
  navigate(initialRoute);
}
load().then(() => {
  if (initialRoute.startsWith('custom/')) navigateFromHash();
  if (state.data.welcomeDm === 'sent') toast('You’re signed in. Your welcome image was sent by Discord DM.');
  else if (state.data.welcomeDm === 'failed') toast('You’re signed in, but Discord could not deliver your welcome DM.', true);
  else if (state.data.welcomeDm === 'not-configured') toast('You’re signed in. Welcome DMs are not configured on this deployment.');
}).catch(error => {
  console.error(error);
  toast('The site could not connect to its backend. Please try again later.', true);
});
