const state = { data: null, games: [], products: [], announcements: [], staff: [], adminTab: 'games' };
const logo = 'https://imglink.cc/cdn/w_9tyzCBOe.png';
const githubPages = location.hostname.endsWith('.github.io');
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const initials = value => String(value || 'CS').split(/[\s_-]+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
const can = permission => Boolean(state.data?.user?.isCeo || state.data?.user?.permissions?.includes(permission));

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });
  const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
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

function render() {
  state.games = state.data.games || [];
  state.products = state.data.products || [];
  state.announcements = state.data.announcements || [];
  state.staff = state.data.staff || [];
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

function showSignIn() {
  openModal(`<button class="modal-close" data-close aria-label="Close">×</button><div class="modal-brand"><img src="${logo}" alt=""></div>
    <div class="eyebrow">WELCOME TO THE STUDIO</div><h2 id="modal-title">Find your people.</h2><p class="modal-copy">Connect your Discord account and step into the Crazy Studios community.</p>
    <a class="button button-primary full-button" href="/api/auth/discord">Continue with Discord <span>↗</span></a>
    <button class="subtle-link" id="ceo-login-open">Studio admin sign in</button>`);
  $('#ceo-login-open').onclick = showCeoLogin;
}

function showCeoLogin() {
  openModal(`<button class="modal-close" data-close aria-label="Close">×</button><div class="eyebrow">RESTRICTED ACCESS</div><h2 id="modal-title">Studio admin.</h2><p class="modal-copy">Sign in with the CEO credentials configured for this deployment.</p>
    <form id="ceo-form" class="form-stack"><label>Username<input name="username" value="Vyazxs" autocomplete="username" required autofocus></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="button button-primary full-button">Sign in securely <span>↗</span></button></form>
    <p class="form-footnote">Credentials are checked on the secure server and are never stored in the website.</p>`);
  $('#ceo-form').onsubmit = async event => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try { await api('/api/auth/ceo', { method: 'POST', body: form }); await load(); closeModal(); toast('Welcome back, Vyazxs.'); }
    catch (error) { toast(error.message, true); }
  };
}

function showAccount() {
  const user = state.data.user;
  const admin = user.isCeo || ['manage_games', 'manage_shop', 'manage_announcements', 'manage_staff', 'manage_users', 'manage_permissions', 'manage_pages', 'manage_discord'].some(can);
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

function showAdmin(tab = 'games') {
  const available = Object.entries(managers).filter(([, manager]) => can(manager.permission));
  if (!managers[tab] || !can(managers[tab].permission)) {
    tab = available[0]?.[0] || (can('manage_users') ? 'users' : can('manage_permissions') ? 'roles' : 'settings');
  }
  state.adminTab = tab;
  const tabs = available.map(([key, manager]) => `<button class="admin-tab ${key === tab ? 'selected' : ''}" data-admin-tab="${key}">${manager.title}</button>`).join('');
  openModal(`<button class="modal-close" data-close aria-label="Close">×</button><div class="eyebrow">CRAZY STUDIOS · CONTROL ROOM</div><h2 id="modal-title">Studio management.</h2>
    <div class="admin-tabs">${tabs}${can('manage_users') ? '<button class="admin-tab" data-admin-tab="users">People</button>' : ''}${can('manage_permissions') ? '<button class="admin-tab" data-admin-tab="roles">Permissions</button>' : ''}${can('manage_pages') || can('manage_discord') ? '<button class="admin-tab" data-admin-tab="settings">Settings</button>' : ''}</div>
    <div id="admin-content"></div>`);
  $$('.admin-tab').forEach(button => button.onclick = () => showAdmin(button.dataset.adminTab));
  if (tab === 'users') return renderAdminUsers();
  if (tab === 'roles') return renderAdminRoles();
  if (tab === 'settings') return renderAdminSettings();
  renderAdminCollection(tab);
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
  return (state.data[collection] || []).map(item => `<div class="admin-row"><div class="admin-row-copy"><b>${escapeHtml(item.title || item.name)}</b><span>${escapeHtml(item.status || item.position || item.price || item.author || '')}</span></div>
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
    $('#admin-content').innerHTML = users.map(user => `<div class="admin-row user-row"><div class="admin-row-copy"><b>${escapeHtml(user.display_name || user.username)}</b><span>@${escapeHtml(user.username)} · ${escapeHtml(user.discord_username || 'No Discord')} · ${escapeHtml(user.status)}${user.roles?.length ? ` · Roles: ${user.roles.map(role => escapeHtml(role.name)).join(', ')}` : ''}</span></div>${user.is_ceo ? '<span class="staff-badge">CEO</span>' : `${can('manage_permissions') ? `<button class="small-action" data-access="${escapeHtml(user.id)}">Access</button>` : ''}${user.status === 'active' && can('ban_users') ? `<button class="small-action danger" data-moderate="${escapeHtml(user.id)}" data-action="ban">Ban</button>` : ''}${user.status === 'banned' && can('unban_users') ? `<button class="small-action" data-moderate="${escapeHtml(user.id)}" data-action="unban">Unban</button>` : ''}`}</div>`).join('') || '<p class="empty-admin">No registered users yet.</p>';
    $$('[data-moderate]').forEach(button => button.onclick = async () => {
      const note = prompt('Optional moderation note:') || '';
      try { await api(`/api/admin/users/${button.dataset.moderate}/moderation`, { method: 'POST', body: { action: button.dataset.action, note } }); renderAdminUsers(); toast('Account status updated.'); }
      catch (error) { toast(error.message, true); }
    });
    $$('[data-access]').forEach(button => button.onclick = async () => {
      try {
        const access = await api(`/api/admin/users/${button.dataset.access}/permissions`);
        $('#admin-content').insertAdjacentHTML('beforeend', `<form class="admin-form user-access-form" data-user-id="${escapeHtml(button.dataset.access)}">
          <h3>Custom access</h3><div class="permission-grid">${access.permissions.map(permission => {
            const override = access.overrides.find(value => value.permission === permission);
            return `<label>${escapeHtml(permission.replaceAll('_', ' '))}<select name="${escapeHtml(permission)}"><option value="" ${!override ? 'selected' : ''}>Inherit</option><option value="true" ${override?.allowed === true ? 'selected' : ''}>Allow</option><option value="false" ${override?.allowed === false ? 'selected' : ''}>Deny</option></select></label>`;
          }).join('')}</div>
          <div class="role-list">${access.roles.map(role => `<span class="assigned-role">${escapeHtml(role.name)} <button type="button" class="small-action danger" data-unassign="${escapeHtml(role.id)}">×</button></span>`).join('')}</div>
          <div class="form-buttons"><button class="button button-primary">Save individual overrides</button><button type="button" class="button button-outline" data-cancel-edit>Cancel</button></div></form>`);
        const form = $('.user-access-form');
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
    $('#admin-content').innerHTML = `<h3>Permission groups</h3>${roles.map(role => `<div class="admin-row"><div class="admin-row-copy"><b>${escapeHtml(role.name)}</b><span>${role.permissions.map(escapeHtml).join(' · ') || 'No permissions'}</span></div><button class="small-action" data-edit-role="${escapeHtml(role.id)}">Edit</button><button class="small-action danger" data-delete-role="${escapeHtml(role.id)}">Delete</button></div>`).join('') || '<p class="empty-admin">No custom roles created yet.</p>'}
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
      try { await api(`/api/admin/users/${values.userId}/roles`, { method: 'POST', body: { roleId: values.roleId } }); toast('Role assigned.'); }
      catch (error) { toast(error.message, true); }
    };
    $$('[data-edit-role]').forEach(button => button.onclick = () => {
      const role = roles.find(value => value.id === button.dataset.editRole);
      const form = $('#role-form');
      form.name.value = role.name; form.description.value = role.description;
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
  if (githubPages) {
    state.data = {
      user: null, games: [], products: [], announcements: [], staff: [],
      site: { accent: '#a3ff3f', discordInvite: '', discordDescription: 'Join the conversation and meet the community.' },
      roleOptions: []
    };
    render();
    return;
  }
  state.data = await api('/api/bootstrap');
  render();
}

$('#main-nav').addEventListener('click', event => {
  const button = event.target.closest('[data-page]');
  if (button) navigate(button.dataset.page);
});
document.addEventListener('click', event => {
  const go = event.target.closest('[data-go]');
  if (go) navigate(go.dataset.go);
  if (event.target.closest('[data-close]') || event.target === $('#modal-backdrop')) closeModal();
});
$('#signin-button').onclick = () => githubPages
  ? toast('Discord sign-in needs the Crazy Studios backend, which GitHub Pages cannot run.', true)
  : showSignIn();
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
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
$('#year').textContent = new Date().getFullYear();
navigate(location.hash.slice(1) || 'home');
load().then(() => {
  if (state.data.welcomeDm === 'sent') toast('You’re signed in. Your welcome image was sent by Discord DM.');
  else if (state.data.welcomeDm === 'failed') toast('You’re signed in, but Discord could not deliver your welcome DM.', true);
  else if (state.data.welcomeDm === 'not-configured') toast('You’re signed in. Welcome DMs are not configured on this deployment.');
}).catch(error => {
  console.error(error);
  toast('The site could not connect to its backend. Please try again later.', true);
});
