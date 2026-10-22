'use strict';

/* Vision In Neighborhoods: the whole front end. Talks to /api with the session cookie. */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = { 'x-requested-with': 'fetch' };
  if (body !== undefined && !raw) headers['content-type'] = 'application/json';
  if (raw) headers['content-type'] = 'image/jpeg';
  const res = await fetch(`/api${path}`, { method, headers, credentials: 'same-origin', body: raw || (body === undefined ? undefined : JSON.stringify(body)) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Something went wrong (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

let me = null;
let catalog = { roles: [], checklist: [], scores: [] };
let areas = [];
let areaFilter = null;
let query = '';
let filters = { budget: false, parking: false };
let houses = [];
const settings = Object.assign({ theme: 'system' }, store.get('vin-settings') || {});
const roleName = (id) => (catalog.roles.find((r) => r.id === id) || { label: id }).label;
const hasRole = (...ids) => Boolean(me && me.profile.roles.some((r) => ids.includes(r)));

function toast(text) {
  const d = document.createElement('div');
  d.className = 'toast';
  d.setAttribute('role', 'status');
  d.textContent = text;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2800);
}

/* ---------- panels ---------- */
let lastFocus = null;
function openPanel(html) {
  lastFocus = document.activeElement;
  $('panel').innerHTML = html;
  $('scrim').hidden = false;
  const first = $('panel').querySelector('input,select,textarea,button:not(.x)');
  (first || $('panel').querySelector('button')).focus();
}
function closePanel() {
  $('scrim').hidden = true;
  if (lastFocus) lastFocus.focus();
}
$('scrim').addEventListener('click', (e) => { if (e.target === $('scrim') || e.target.closest('.x')) closePanel(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('scrim').hidden) closePanel(); });
const panelTop = (title) => `<div class="top"><h2 id="panelTitle">${esc(title)}</h2><button class="x" type="button" aria-label="Close">×</button></div>`;

async function busy(button, fn) {
  button.disabled = true;
  try { await fn(); } catch (err) { toast(err.message); } finally { button.disabled = false; }
}

/* ---------- house pictures ---------- */
const PALETTE = [['#c96f4a', '#f2e3cf'], ['#4f6d8a', '#e8e1d4'], ['#6f8a5a', '#efe6d6'], ['#8a5a6f', '#f0e4dc'], ['#b48a3c', '#efe9dc'], ['#3f7a78', '#e6ece6'], ['#7a4f3f', '#efe2d2'], ['#5b5f8a', '#e7e6ee']];
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function houseSVG(h) {
  const n = hash(h.id);
  const [wall, trim] = PALETTE[n % PALETTE.length];
  const v = n % 3;
  const win = (x, y) => `<rect x="${x}" y="${y}" width="34" height="38" rx="2" fill="#fbe9b7" stroke="${trim}" stroke-width="4"/>`;
  return `<svg viewBox="0 0 400 300" role="img" aria-label="Illustration of the house" preserveAspectRatio="xMidYMid slice">
  <defs><linearGradient id="s${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--sky2)"/><stop offset="1" stop-color="var(--sky1)"/></linearGradient></defs>
  <rect width="400" height="300" fill="url(#s${n})"/>
  <circle cx="${60 + v * 110}" cy="70" r="26" fill="#fff4d6" opacity=".8"/>
  <ellipse cx="${v === 1 ? 340 : 60}" cy="215" rx="58" ry="62" fill="#4d7a4a"/>
  <rect x="${v === 1 ? 334 : 54}" y="230" width="12" height="40" fill="#5b4430"/>
  <rect x="0" y="262" width="400" height="38" fill="#7e9a63"/>
  <rect x="${v === 1 ? 40 : 110}" y="${v === 2 ? 150 : 120}" width="${v === 2 ? 240 : 200}" height="${v === 2 ? 115 : 145}" fill="${wall}"/>
  <polygon points="${v === 1 ? 25 : 95},${v === 2 ? 152 : 122} ${v === 1 ? 140 : 210},${v === 2 ? 95 : 55} ${v === 1 ? 255 : 325},${v === 2 ? 152 : 122}" fill="var(--roof)"/>
  ${v === 2 ? '' : win(v === 1 ? 62 : 132, 150) + win(v === 1 ? 184 : 254, 150)}
  ${win(v === 1 ? 62 : 132, v === 2 ? 180 : 210)}
  <rect x="${v === 1 ? 122 : 192}" y="${v === 2 ? 195 : 205}" width="34" height="${v === 2 ? 70 : 60}" fill="${trim}"/>
  ${v === 2 ? win(v === 1 ? 184 : 274, 180) : win(v === 1 ? 184 : 254, 210)}
  <rect x="0" y="266" width="400" height="6" fill="#c9c2b2"/></svg>`;
}
const photoOf = (h, url) => (url ? `<img src="${esc(url)}" alt="Photo of ${esc(h.address)}">` : houseSVG(h));
const scoreBadge = (h) => (Object.keys(h.scores || {}).length ? h.overall.toFixed(1) : 'New');
const money = (n) => `$${Math.round(n).toLocaleString('en-CA')}`;

/* ---------- home ---------- */
function card(h) {
  const l = h.listing;
  const price = l ? `<p class="price"><b>${money(l.price.monthlyTotal ?? l.price.rentPerRoom)}</b>/room a month${l.price.utilitiesIncluded ? ' incl. utilities' : ''}</p>` : '<p class="meta">No active listing</p>';
  const tags = [];
  if (h.walkMinutes != null) tags.push(`${h.walkMinutes} min walk to campus`);
  if (h.verifiedReviews) tags.push(`${h.verifiedReviews} verified review${h.verifiedReviews > 1 ? 's' : ''}`);
  if (h.opinions) tags.push(`${h.opinions} opinion${h.opinions > 1 ? 's' : ''}`);
  if (l && l.price.status === 'stale') tags.push(`price checked ${l.price.lastChecked}`);
  return `<article class="card" role="button" tabindex="0" data-id="${esc(h.id)}" aria-label="${esc(h.address)}, open">
   <div class="photo">${photoOf(h, l && l.photo)}<span class="score" title="Your match score">${scoreBadge(h)}</span>${h.isSample ? '<span class="sample">Sample</span>' : ''}</div>
   <div class="body"><h3>${esc(h.address)}</h3><p class="meta">${esc([h.houseType, l && `${l.bedrooms} bed`, h.neighbourhood].filter(Boolean).join(' · '))}</p>
   ${price}<div class="tags">${tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div></div></article>`;
}

async function loadHouses() {
  const params = new URLSearchParams();
  if (areaFilter) params.set('area', areaFilter);
  if (query) params.set('q', query);
  if (filters.budget && me && me.profile.budget) params.set('budget', me.profile.budget);
  if (filters.parking) params.set('parking', '1');
  try {
    const data = await api(`/houses?${params}`);
    houses = data.houses;
    renderGrid();
  } catch (err) {
    $('grid').innerHTML = `<p class="empty">Couldn't load houses: ${esc(err.message)}</p>`;
  }
}

function renderGrid() {
  $('resultsTitle').textContent = query ? `Results for "${query}"` : areaFilter ? `Top rated in ${areaFilter}` : (me ? 'Check before you sign, ranked for you' : 'Check before you sign');
  $('count').textContent = `${houses.length} ${houses.length === 1 ? 'house' : 'houses'}`;
  $('grid').innerHTML = houses.length ? houses.map(card).join('')
    : '<p class="empty">No houses match yet. Know one? Add a listing and it gets rated.</p>';
}

function renderChips() {
  $('areas').innerHTML = areas.map((a) => `<button type="button" class="chip" aria-pressed="${areaFilter === a}" data-a="${esc(a)}">${esc(a)}</button>`).join('');
  const f = [];
  if (me && me.profile.budget) f.push(`<button type="button" class="chip" data-f="budget" aria-pressed="${filters.budget}">Under ${money(me.profile.budget)}</button>`);
  f.push(`<button type="button" class="chip" data-f="parking" aria-pressed="${filters.parking}">Has parking</button>`);
  $('filters').innerHTML = f.join('');
}
$('areas').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  areaFilter = areaFilter === b.dataset.a ? null : b.dataset.a;
  renderChips();
  loadHouses();
});
$('filters').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  filters[b.dataset.f] = !filters[b.dataset.f];
  renderChips();
  loadHouses();
});
$('searchForm').addEventListener('submit', (e) => { e.preventDefault(); query = $('q').value.trim(); loadHouses(); });
$('q').addEventListener('search', () => { if (!$('q').value) { query = ''; loadHouses(); } });
$('grid').addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) openHouse(c.dataset.id); });
$('grid').addEventListener('keydown', (e) => {
  const c = e.target.closest('.card');
  if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openHouse(c.dataset.id); }
});
$('home').addEventListener('click', () => { areaFilter = null; query = ''; $('q').value = ''; renderChips(); loadHouses(); window.scrollTo(0, 0); });

/* ---------- account menu ---------- */
function renderMe() {
  const p = me && me.profile;
  $('avatar').textContent = p && p.displayName ? p.displayName.trim().charAt(0).toUpperCase() : (me ? me.email.charAt(0).toUpperCase() : '?');
  const items = me
    ? [['profile', 'Profile'], ['list', 'Add a listing'], ...(me.isAdmin ? [['admin', 'Check leases']] : []), ['settings', 'Settings'], ['signout', 'Sign out']]
    : [['signin', 'Sign in or create profile'], ['list', 'Add a listing'], ['settings', 'Settings']];
  $('menu').innerHTML = `<div class="who">${me ? `<b>${esc(p.displayName || 'Your account')}</b>${esc(me.email)}` : '<b>Not signed in</b>Sign in to rate houses and save your priorities'}</div>`
    + items.map(([k, l]) => `<button type="button" role="menuitem" data-m="${k}">${l}</button>`).join('');
}
function closeMenu() { $('menu').hidden = true; $('avatar').setAttribute('aria-expanded', 'false'); }
$('avatar').addEventListener('click', () => {
  const open = $('menu').hidden;
  $('menu').hidden = !open;
  $('avatar').setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => { if (!e.target.closest('.me')) closeMenu(); });
$('menu').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  closeMenu();
  const m = b.dataset.m;
  if (m === 'signin') openSignIn();
  if (m === 'profile') openProfile();
  if (m === 'list') openList();
  if (m === 'admin') openAdmin();
  if (m === 'settings') openSettings();
  if (m === 'signout') {
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    me = null;
    renderMe(); renderChips(); loadHouses();
    toast('Signed out');
  }
});
$('listBtn').addEventListener('click', () => openList());

function needSignIn(then) {
  if (me) return true;
  openSignIn(then);
  return false;
}

/* ---------- sign in ---------- */
function openSignIn(then) {
  openPanel(`${panelTop('Sign in')}
   <p class="fine">Any email works. We'll send you a 6-digit code, no password needed.</p>
   <form id="sf"><label for="sEmail">Email<input id="sEmail" type="email" required autocomplete="email"></label>
   <button class="primary" type="submit">Send my code</button></form>`);
  $('sf').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('sEmail').value.trim();
    busy(e.submitter || $('sf').querySelector('button'), async () => {
      const sent = await api('/auth/otp/request', { method: 'POST', body: { email } });
      openPanel(`${panelTop('Check your email')}
       <p>We sent a code to <b>${esc(email)}</b>. It expires in ${sent.expiresInMinutes} minutes.</p>
       <form id="cf"><label for="cCode">6-digit code<input id="cCode" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" maxlength="6" required value="${esc(sent.devCode || '')}"></label>
       <button class="primary" type="submit">Sign in</button></form>`);
      $('cf').addEventListener('submit', (ev) => {
        ev.preventDefault();
        busy($('cf').querySelector('button'), async () => {
          await api('/auth/otp/verify', { method: 'POST', body: { email, code: $('cCode').value.trim() } });
          await loadMe();
          if (!me.profile.complete) return openProfileForm(then);
          closePanel();
          toast('Signed in');
          loadHouses();
          if (then) then();
        });
      });
    });
  });
}

async function loadMe() {
  try { me = await api('/me'); } catch { me = null; }
  renderMe();
  renderChips();
}

/* ---------- profile ---------- */
function openProfile() {
  const p = me.profile;
  openPanel(`${panelTop(p.displayName || 'Your profile')}
   <dl class="kv"><dt>Email</dt><dd>${esc(me.email)}</dd>
   <dt>Roles</dt><dd>${esc(p.roles.map(roleName).join(', ') || 'None yet')}</dd>
   <dt>School</dt><dd>${esc(p.school || '—')}</dd>
   <dt>Budget</dt><dd>${p.budget ? `${money(p.budget)} a room` : '—'}</dd>
   <dt>Move-in</dt><dd>${esc(p.moveIn || '—')}</dd>
   <dt>Parking</dt><dd>${p.needsParking ? 'Needed' : 'Not needed'}</dd>
   <dt>Priorities</dt><dd>${catalog.scores.map((s) => `${s.label} ${p.sliders[s.id]}`).join(' · ')}</dd></dl>
   <button class="primary" type="button" id="editP">Edit profile</button>
   <button class="linkbtn" type="button" id="delAcc">Delete account</button>`);
  $('editP').addEventListener('click', () => openProfileForm());
  $('delAcc').addEventListener('click', () => {
    openPanel(`${panelTop('Delete your account?')}<p>This removes your profile, opinions and reviews. It can't be undone.</p>
     <div class="actions"><button class="primary" type="button" id="delYes">Delete my account</button><button class="secondary" type="button" id="delNo">Keep it</button></div>`);
    $('delNo').addEventListener('click', openProfile);
    $('delYes').addEventListener('click', (e) => busy(e.target, async () => {
      await api('/me', { method: 'DELETE' });
      me = null; renderMe(); renderChips(); closePanel(); loadHouses(); toast('Account deleted');
    }));
  });
}

function openProfileForm(then) {
  const p = me.profile;
  openPanel(`${panelTop(p.complete ? 'Edit profile' : 'Create your profile')}
  <form id="pf">
   <label for="fName">Name<input id="fName" type="text" required maxlength="60" value="${esc(p.displayName)}"></label>
   <fieldset style="border:0;padding:0;margin:0"><legend style="font-weight:600;font-size:14px;margin-bottom:6px">I am a <small class="fine">(pick all that fit)</small></legend>
   <div class="roles">${catalog.roles.map((r) => `<label class="check"><input type="checkbox" name="role" value="${r.id}" ${p.roles.includes(r.id) ? 'checked' : ''}> ${esc(r.label)}</label>`).join('')}</div></fieldset>
   <label for="fSchool">School<select id="fSchool">${['', 'McMaster', 'Mohawk College', 'Redeemer', 'Other'].map((s) => `<option value="${s}" ${s === p.school ? 'selected' : ''}>${s || 'Not a student'}</option>`).join('')}</select></label>
   <label for="fBudget">Max rent per room ($ a month)<input id="fBudget" type="number" min="100" max="5000" step="25" value="${p.budget ?? ''}"></label>
   <label for="fMove">Move-in<input id="fMove" type="month" value="${esc(p.moveIn)}"></label>
   <label class="check"><input id="fPark" type="checkbox" ${p.needsParking ? 'checked' : ''}> I need parking</label>
   <div><p style="font-weight:600;font-size:14px;margin-bottom:8px">What matters to you <small class="fine">(0 = don't care, 5 = a lot)</small></p>
   ${catalog.scores.map((s) => `<div class="slider"><span>${s.label}</span><input id="p_${s.id}" type="range" min="0" max="5" value="${p.sliders[s.id]}" aria-label="${s.label} importance"><output id="o_${s.id}">${p.sliders[s.id]}</output></div>`).join('')}</div>
   <button class="primary" type="submit">Save profile</button>
  </form>`);
  catalog.scores.forEach((s) => $(`p_${s.id}`).addEventListener('input', (e) => { $(`o_${s.id}`).textContent = e.target.value; }));
  $('pf').addEventListener('submit', (e) => {
    e.preventDefault();
    const roles = [...document.querySelectorAll('input[name=role]:checked')].map((i) => i.value);
    if (!roles.length) return toast('Pick at least one role');
    busy($('pf').querySelector('button[type=submit]'), async () => {
      me = await api('/me/profile', {
        method: 'PATCH',
        body: {
          displayName: $('fName').value, roles, school: $('fSchool').value,
          budget: $('fBudget').value ? Number($('fBudget').value) : null, moveIn: $('fMove').value, needsParking: $('fPark').checked,
          sliders: Object.fromEntries(catalog.scores.map((s) => [s.id, Number($(`p_${s.id}`).value)])),
        },
      });
      renderMe(); renderChips(); closePanel(); toast('Profile saved'); loadHouses();
      if (then) then();
    });
  });
}

/* ---------- settings ---------- */
function applyTheme() {
  if (settings.theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', settings.theme);
}
function openSettings() {
  openPanel(`${panelTop('Settings')}
   <div class="row"><span>Appearance</span><div class="seg" role="group" aria-label="Appearance">${[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${settings.theme === v}">${l}</button>`).join('')}</div></div>`);
  $('panel').querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    settings.theme = b.dataset.v;
    store.set('vin-settings', settings);
    applyTheme();
    b.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
}

/* ---------- a house ---------- */
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const STATUS_TEXT = { current: 'checked this week', stale: 'not re-checked this week', may_be_rented: 'may already be rented', history_only: 'old price' };

async function openHouse(id, tab = 'overview') {
  let h;
  try { h = await api(`/houses/${id}`); } catch (err) { return toast(err.message); }
  const active = h.listings.filter((l) => l.active);
  const l = active[0];
  const tabBtn = (k, label) => `<button type="button" data-tab="${k}" aria-pressed="${tab === k}">${label}</button>`;
  const scoreNames = Object.fromEntries(catalog.scores.map((s) => [s.id, s.label]));
  const sample = h.isSample ? '<p class="fine"><b>Sample house.</b> Not a real listing; it shows how a house page works.</p>' : '';

  const overview = `${sample}
    ${l ? `<p class="price"><b>${money(l.price.rentPerRoom)}</b>/room a month · ${l.bedrooms} bedrooms</p>
      <p>${l.price.utilitiesIncluded ? 'Utilities included.' : `Plus utilities: ${esc(l.price.utilitiesLabel)}.`}
      ${l.price.monthlyTotal ? ` About <b>${money(l.price.monthlyTotal)}</b> a month all in.` : ''}</p>
      <p class="fine">Price ${STATUS_TEXT[l.price.status]} (${esc(l.price.lastChecked)}).</p>
      ${l.description ? `<p>${esc(l.description)}</p>` : ''}
      ${l.photos.length > 1 ? `<div class="thumbs">${l.photos.map((p) => `<img src="${esc(p)}" alt="">`).join('')}</div>` : ''}
      ${l.url ? `<p class="fine">Listed on ${esc(l.sourceName)}. <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">View the original listing</a> for photos and to contact the landlord.</p>`
        : `<p class="fine">${l.source === 'landlord' ? `Posted here by the landlord${l.ownerVerified ? ' (ownership verified)' : ''}.` : esc(l.sourceName || '')}</p>`}`
      : '<p class="fine">No active listing right now. The ratings still apply to the house.</p>'}
    <dl class="kv">${h.walkMinutes != null ? `<dt>To campus</dt><dd>about ${h.walkMinutes} min walk</dd>` : ''}
      <dt>Parking</dt><dd>${h.parkingSpots == null ? 'Unknown' : `${h.parkingSpots} spot${h.parkingSpots === 1 ? '' : 's'}`}</dd>
      <dt>Area</dt><dd>${esc(h.neighbourhood)}</dd></dl>
    <div class="actions"><button class="primary" type="button" id="toReview">Lived here? Write a verified review</button>
    <button class="secondary" type="button" id="toOpinion">Warn or reassure the next tenant</button></div>`;

  const scoreRows = catalog.scores.map((s) => {
    const sc = h.scores[s.id];
    if (!sc) return `<div class="scoreRow"><b>${s.label}</b><span class="fine">Not enough data yet</span><span></span></div>`;
    const shown = sc.range ? `${sc.range[0].toFixed(1)}–${sc.range[1].toFixed(1)}` : sc.value.toFixed(1);
    return `<div class="scoreRow"><b>${s.label}</b><div class="meter" aria-hidden="true"><i style="width:${sc.value * 10}%"></i></div>
      <span class="v">${shown}</span><span class="n"><span class="lvl ${sc.level}">${sc.level} confidence</span> ${esc(sc.note)}</span></div>`;
  }).join('');
  const checklist = h.reviews.count
    ? `<h3 style="font-size:18px">Inside checklist <small class="fine">from ${h.reviews.count} verified tenant${h.reviews.count > 1 ? 's' : ''}</small></h3>
       ${h.reviews.items.filter((i) => i.average != null).map((i) => `<div class="rate"><span>${esc(i.label)}</span><span class="price">${i.average.toFixed(1)} / 5</span></div>`).join('')}
       ${h.reviews.comments.map((c) => `<div class="op"><div class="h"><span class="badge v">Verified tenant · ${c.year}</span></div><p>${esc(c.body)}</p></div>`).join('')}`
    : '<p class="fine">No verified tenant reviews yet, so the Inside score is a prediction from public records.</p>';
  const scores = `<div>${scoreRows}</div>
    <p class="fine">Scores go from 0 to 10. Low-confidence scores show a range. Your match ${Object.keys(h.scores).length ? '' : 'appears once there is data and '}uses the priorities in your profile${h.rescoredAt ? `; last updated ${new Date(h.rescoredAt).toLocaleDateString('en-CA')}` : ''}.</p>
    ${checklist}`;

  const community = `<p class="fine">${h.opinions.length} opinion${h.opinions.length === 1 ? '' : 's'}. Anyone can share one; only lease-verified tenants change the Inside score.</p>
    <button class="primary" type="button" id="toOpinion2">Warn or reassure the next tenant</button>
    ${h.opinions.map((o) => `<div class="op"><div class="h"><span><span class="badge ${o.verified ? 'v' : ''}">${esc(roleName(o.role))}${o.verified ? ' · verified tenant' : ''}</span></span><span>${o.year}</span></div>
      <span class="s" aria-label="${o.stars} out of 5">${stars(o.stars)}</span><p>${esc(o.body)}</p>
      ${o.reply ? `<p class="reply"><b>Landlord replied:</b> ${esc(o.reply)}</p>` : ''}
      <div class="actions">${h.canReply && !o.reply ? `<button class="linkbtn" type="button" data-reply="${o.id}">Reply as landlord</button>` : ''}
      ${o.mine ? '' : `<button class="linkbtn" type="button" data-report="${o.id}">Report</button>`}</div></div>`).join('') || '<p class="fine">No opinions yet. Be the first.</p>'}`;

  openPanel(`${panelTop(h.address)}
   <div class="big"><div class="photo">${photoOf(h, l && l.photos[0])}<span class="score">${Object.keys(h.scores).length ? scoreNames.inside && h.scores.inside ? 'Rated' : 'Rated' : 'New'}</span></div></div>
   <div class="seg" role="group" aria-label="House sections">${tabBtn('overview', 'Overview')}${tabBtn('scores', 'Scores')}${tabBtn('community', `Community (${h.opinions.length})`)}</div>
   ${tab === 'overview' ? overview : tab === 'scores' ? scores : community}`);
  const fromList = houses.find((x) => x.id === h.id);
  $('panel').querySelector('.big .score').textContent = fromList && Object.keys(fromList.scores).length ? `Your match ${fromList.overall.toFixed(1)}` : (Object.keys(h.scores).length ? 'Rated' : 'New');
  $('panel').querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => openHouse(id, b.dataset.tab)));
  const back = () => openHouse(id, tab);
  $('toReview')?.addEventListener('click', () => { if (h.isSample) return toast('This is a sample house'); needSignIn(() => openReview(h)) && openReview(h); });
  for (const b of ['toOpinion', 'toOpinion2']) $(b)?.addEventListener('click', () => { if (h.isSample) return toast('This is a sample house'); needSignIn(() => openOpinion(h)) && openOpinion(h); });
  $('panel').querySelectorAll('[data-reply]').forEach((b) => b.addEventListener('click', () => openReply(b.dataset.reply, back)));
  $('panel').querySelectorAll('[data-report]').forEach((b) => b.addEventListener('click', () => { if (me) openReport(b.dataset.report, back); else openSignIn(); }));
}

function openOpinion(h) {
  let rating = 0;
  const roles = ['former', 'tenant', 'viewed', 'neighbour', 'parent', 'looking'];
  const mine = roles.find((r) => me.profile.roles.includes(r)) || 'former';
  openPanel(`${panelTop(`Your opinion on ${h.address}`)}
   <form id="of">
    <label for="oRole">How do you know this house?<select id="oRole">${roles.map((r) => `<option value="${r}" ${r === mine ? 'selected' : ''}>${esc(roleName(r))}</option>`).join('')}</select></label>
    <div><p style="font-weight:600;font-size:14px;margin-bottom:6px">Overall</p><div class="stars" id="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" aria-label="${n} stars">★</button>`).join('')}</div></div>
    <label for="oText">What should the next person know?<textarea id="oText" required maxlength="2000" placeholder="Heat, mould, noise, landlord, anything you wish you'd known"></textarea></label>
    <p class="fine">Shown with your role and the year, not your name. Lived here? A verified review counts toward the Inside score.</p>
    <button class="primary" type="submit">Post opinion</button>
   </form>`);
  $('stars').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    rating = Number(b.dataset.n);
    $('stars').querySelectorAll('button').forEach((x) => x.classList.toggle('on', Number(x.dataset.n) <= rating));
  });
  $('of').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!rating) return toast('Pick a star rating');
    busy($('of').querySelector('button[type=submit]'), async () => {
      await api(`/houses/${h.id}/opinions`, { method: 'POST', body: { role: $('oRole').value, stars: rating, body: $('oText').value } });
      toast('Opinion posted');
      loadHouses();
      openHouse(h.id, 'community');
    });
  });
}

/* Files: images are re-encoded to JPEG (which also drops GPS data); PDFs go as they are. */
function readAsBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
async function toJpeg(file, maxSide = 1600, quality = 0.85) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}
async function proofFrom(input) {
  const file = input.files[0];
  if (!file) return null;
  if (file.type === 'application/pdf') {
    if (file.size > 3 * 1024 * 1024) throw new Error('PDF must be under 3 MB');
    return { mime: 'application/pdf', data: await readAsBase64(file) };
  }
  return { mime: 'image/jpeg', data: await readAsBase64(await toJpeg(file)) };
}

function openReview(h) {
  const months = new Date().toISOString().slice(0, 7);
  openPanel(`${panelTop(`Review ${h.address}`)}
   <p class="fine">Rate what living there was really like. Your review counts toward the Inside score once we've checked your lease page or rent receipt. We look once, then delete the file.</p>
   <form id="rf">
    <div class="ratings">${catalog.checklist.map((c) => `<div class="rate"><span id="lbl_${c.id}">${esc(c.label)}</span>
      <div class="seg" role="radiogroup" aria-labelledby="lbl_${c.id}" data-item="${c.id}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="false" aria-pressed="false" data-n="${n}">${n}</button>`).join('')}</div></div>`).join('')}</div>
    <p class="fine">1 = terrible, 5 = great.</p>
    <label for="rUntil">When did you move out (or when does your lease end)?<input id="rUntil" type="month" required max="${months.slice(0, 4) * 1 + 1}-12"></label>
    <label for="rUtil">Utilities you paid per month, your share <small>Optional. Helps the next person know the real cost.</small><input id="rUtil" type="number" min="0" max="1000"></label>
    <label for="rCommute">Your real door-to-class time in minutes <small>Optional</small><input id="rCommute" type="number" min="1" max="180"></label>
    <label for="rBody">Anything else? <small>Optional</small><textarea id="rBody" maxlength="2000"></textarea></label>
    <label for="rLease">Lease page or rent receipt <small>Photo or PDF, under 3 MB. It needs to show this address.</small><input id="rLease" type="file" accept="image/*,application/pdf" required></label>
    <button class="primary" type="submit">Send review</button>
   </form>`);
  const ratings = {};
  $('rf').querySelectorAll('.seg[data-item]').forEach((seg) => seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    ratings[seg.dataset.item] = Number(b.dataset.n);
    seg.querySelectorAll('button').forEach((x) => { x.setAttribute('aria-pressed', String(x === b)); x.setAttribute('aria-checked', String(x === b)); });
  }));
  $('rf').addEventListener('submit', (e) => {
    e.preventDefault();
    const missing = catalog.checklist.find((c) => !ratings[c.id]);
    if (missing) return toast(`Rate "${missing.label}"`);
    busy($('rf').querySelector('button[type=submit]'), async () => {
      const proof = await proofFrom($('rLease'));
      await api(`/houses/${h.id}/reviews`, {
        method: 'POST',
        body: {
          ratings, livedUntil: $('rUntil').value, utilitiesPerMonth: $('rUtil').value ? Number($('rUtil').value) : null,
          commuteMinutes: $('rCommute').value ? Number($('rCommute').value) : null, body: $('rBody').value, proof,
        },
      });
      closePanel();
      toast("Thanks! Your review counts once we've checked the lease");
    });
  });
}

function openReply(opinionId, back) {
  openPanel(`${panelTop('Reply as the landlord')}<form id="yf"><label for="yText">Your public reply<textarea id="yText" required maxlength="1000"></textarea></label>
    <p class="fine">Replies are public and can't be edited. Stick to facts and what you've fixed.</p><button class="primary" type="submit">Post reply</button></form>`);
  $('yf').addEventListener('submit', (e) => {
    e.preventDefault();
    busy($('yf').querySelector('button'), async () => {
      await api(`/opinions/${opinionId}/reply`, { method: 'POST', body: { body: $('yText').value } });
      toast('Reply posted');
      back();
    });
  });
}

function openReport(opinionId, back) {
  openPanel(`${panelTop('Report this opinion')}<form id="xf"><label for="xText">What's wrong with it?<textarea id="xText" required maxlength="500" placeholder="Personal attack, not about this house, false..."></textarea></label>
    <button class="primary" type="submit">Report</button></form>`);
  $('xf').addEventListener('submit', (e) => {
    e.preventDefault();
    busy($('xf').querySelector('button'), async () => {
      await api(`/opinions/${opinionId}/report`, { method: 'POST', body: { reason: $('xText').value } });
      toast('Reported. Thanks for keeping it fair');
      back();
    });
  });
}

/* ---------- add a listing ---------- */
function openList(mode) {
  if (!me) return openSignIn(() => openList(mode));
  const landlord = hasRole('landlord', 'manager');
  mode = mode || (landlord ? 'own' : 'link');
  const areaOptions = areas.map((a) => `<option>${esc(a)}</option>`).join('');
  const common = `
    <label for="lAddr">Street address <small>With the house number, like 12 Emerson St</small><input id="lAddr" type="text" required maxlength="120" autocomplete="street-address"></label>
    <label for="lArea">Area<select id="lArea">${areaOptions}</select></label>
    <label for="lType">Type <small>Optional, like 5-bed semi</small><input id="lType" type="text" maxlength="60"></label>
    <label for="lBeds">Bedrooms<input id="lBeds" type="number" min="1" max="15" required></label>
    <label for="lRent">Rent per room ($ a month)<input id="lRent" type="number" min="100" max="5000" step="5" required></label>
    <label class="check"><input id="lUtil" type="checkbox"> Utilities included</label>`;
  const link = `<label for="lUrl">Link to the listing <small>Kijiji, Facebook Marketplace, Rentals.ca, Places4Students or any site</small><input id="lUrl" type="url" required placeholder="https://"></label>${common}
    <p class="fine">We save the address, price and link, and send people to the original post for photos.</p>`;
  const own = landlord ? `${common}
    <label for="lLandlord">Landlord or company name <small>Optional</small><input id="lLandlord" type="text" maxlength="120"></label>
    <label for="lDesc">Description<textarea id="lDesc" maxlength="2000" placeholder="What's included, laundry, parking, when it's available"></textarea></label>
    <label for="lPhotos">Photos <small>Up to 8. Include the bathroom and kitchen.</small><input id="lPhotos" type="file" accept="image/*" multiple></label>
    <div class="thumbs" id="lThumbs"></div>
    <label for="lProof">Proof you own or manage it <small>Optional: a property tax bill or management agreement. Gets a "verified owner" label. Checked once, then deleted.</small><input id="lProof" type="file" accept="image/*,application/pdf"></label>
    <p class="fine">Students and past tenants can rate and comment on your house. You can reply publicly, but you can't remove opinions.</p>`
    : `<p>To post your own property, add <b>Landlord</b> or <b>Property manager</b> to your profile roles.</p><button class="secondary" type="button" id="toRoles">Edit my roles</button>`;
  openPanel(`${panelTop('Add a listing')}
   <div class="seg" role="group" aria-label="Kind of listing"><button type="button" data-mode="link" aria-pressed="${mode === 'link'}">Paste a link</button><button type="button" data-mode="own" aria-pressed="${mode === 'own'}">My own property</button></div>
   <form id="lf">${mode === 'link' ? link : own}${mode === 'link' || landlord ? '<button class="primary" type="submit">Add listing</button>' : ''}</form>`);
  $('panel').querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => openList(b.dataset.mode)));
  $('toRoles')?.addEventListener('click', () => openProfileForm(() => openList('own')));
  let photos = [];
  $('lPhotos')?.addEventListener('change', async (e) => {
    $('lThumbs').innerHTML = '';
    photos = [...e.target.files].slice(0, 8);
    for (const f of photos) $('lThumbs').insertAdjacentHTML('beforeend', `<img src="${URL.createObjectURL(f)}" alt="">`);
  });
  $('lf').addEventListener('submit', (e) => {
    e.preventDefault();
    busy($('lf').querySelector('button[type=submit]'), async () => {
      const body = {
        address: $('lAddr').value, neighbourhood: $('lArea').value, houseType: $('lType').value,
        bedrooms: Number($('lBeds').value), rentPerRoom: Number($('lRent').value), utilitiesIncluded: $('lUtil').checked,
      };
      if (mode === 'link') body.url = $('lUrl').value;
      else {
        body.landlordName = $('lLandlord').value;
        body.description = $('lDesc').value;
        body.photos = [];
        for (const f of photos) {
          const up = await api('/photos', { method: 'POST', raw: await toJpeg(f) });
          body.photos.push(up.url);
        }
        const proof = await proofFrom($('lProof'));
        if (proof) body.proof = proof;
      }
      const res = await api('/houses', { method: 'POST', body });
      toast('Listing added. Scores update in a minute');
      await loadHouses();
      openHouse(res.houseId);
    });
  });
}

/* ---------- admin: check leases ---------- */
async function openAdmin() {
  let queue;
  try { queue = await api('/admin/proofs'); } catch (err) { return toast(err.message); }
  const names = Object.fromEntries(catalog.checklist.map((c) => [c.id, c.label]));
  openPanel(`${panelTop('Check leases and ownership')}
   <p class="fine">${queue.length} waiting. Open the file, check that it shows this address (and, for a lease, the right year). The file is deleted as soon as you decide.</p>
   ${queue.map((p) => `<div class="proof"><b>${p.kind === 'lease' ? 'Lease for a review' : 'Ownership proof'} · ${esc(p.address || '')}</b>
     <span class="fine">${esc(p.email || 'deleted account')} · sent ${new Date(p.createdAt).toLocaleDateString('en-CA')}${p.livedYear ? ` · lived there until ${p.livedYear}` : ''}</span>
     ${p.ratings ? `<span class="fine">${Object.entries(p.ratings).map(([k, v]) => `${esc(names[k] || k)} ${v}`).join(' · ')}</span>` : ''}
     ${p.reviewBody ? `<p>${esc(p.reviewBody)}</p>` : ''}
     <div class="actions"><a class="chip" href="/api/admin/proofs/${p.id}/file" target="_blank" rel="noopener">Open file</a>
     <button class="primary" type="button" data-ok="${p.id}">Approve</button><button class="secondary" type="button" data-no="${p.id}">Reject</button></div></div>`).join('') || '<p>Nothing to check.</p>'}`);
  const decide = (id, decision, btn) => busy(btn, async () => {
    await api(`/admin/proofs/${id}`, { method: 'POST', body: { decision } });
    toast(decision === 'approve' ? 'Approved, file deleted' : 'Rejected, file deleted');
    openAdmin();
  });
  $('panel').querySelectorAll('[data-ok]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.ok, 'approve', b)));
  $('panel').querySelectorAll('[data-no]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.no, 'reject', b)));
}

/* ---------- start ---------- */
(async function start() {
  applyTheme();
  try { catalog = await api('/catalog'); } catch { /* shown by loadHouses below */ }
  try { areas = await api('/neighbourhoods'); } catch { areas = []; }
  await loadMe();
  await loadHouses();
})();
