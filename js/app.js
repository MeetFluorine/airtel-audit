// Phase 2a: auth, role-based shell, router. Pages marked "later" arrive in 2b-6.
const NAV_STORE = [['dashboard', 'Dashboard'], ['audit', 'Start / Continue Audit'], ['result', 'My Result'], ['profile', 'My Profile']];
const NAV_STAFF = [['dashboard', 'Dashboard'], ['cycles', 'Audit Cycles'], ['stores', 'Stores'], ['users', 'Users'],
                   ['basestock', 'Base Stock'], ['reports', 'Reports'], ['logs', 'Audit Logs'], ['profile', 'My Account']];
const NAV = { STORE_USER: NAV_STORE, ADMIN: NAV_STAFF, CIRCLE_HEAD: NAV_STAFF };   // UI only: RLS is the real guard
const LATER = { reports: 'Phase 6', logs: 'Phase 6' };
const ROLE_LABEL = { ADMIN: 'Administrator', CIRCLE_HEAD: 'Circle Head', STORE_USER: 'Store User' };

const S = { session: null, profile: null, store: null, circles: [], recovery: false };
const root = () => document.getElementById('app');

/* ---------- data ---------- */
async function loadProfile() {
  S.profile = null; S.store = null; S.circles = [];
  const uid = S.session.user.id;
  const { data, error } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error || !data) return;
  S.profile = data;
  if (data.status !== 'APPROVED') return;
  if (data.role === 'STORE_USER') {
    const r = await sb.from('user_store_assignments').select('stores(code,name,circles(code,name))').eq('user_id', uid).maybeSingle();
    S.store = r.data ? r.data.stores : null;
  } else if (data.role === 'CIRCLE_HEAD') {
    const r = await sb.from('circle_head_assignments').select('circles(code,name)').eq('user_id', uid);
    S.circles = (r.data || []).map(x => x.circles);
  }
}

async function boot() {
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  if (S.session) {
    await loadProfile();
    if (S.profile && !sessionStorage.getItem('sfx_login')) { sessionStorage.setItem('sfx_login', '1'); sb.rpc('log_login').then(() => {}, () => {}); }
  } else { S.profile = null; }
  route();
}

sb.auth.onAuthStateChange((event) => {
  if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
  if (event === 'PASSWORD_RECOVERY') S.recovery = true;
  if (event === 'SIGNED_OUT') sessionStorage.removeItem('sfx_login');
  setTimeout(boot, 0);   // never await supabase calls inside this callback
});
window.addEventListener('hashchange', route);

/* ---------- views ---------- */
const brand = () => `<div class="brand"><span class="sfx">shadowfax</span><span class="proj">Airtel</span></div><div class="sub">Store Audit Tracker</div>`;
const authCard = inner => `<div class="auth"><div class="card auth-card">${brand()}${inner}</div></div>`;
const field = (id, label, type = 'text', extra = '') => `<label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}" ${extra}>`;

function loginView() {
  return authCard(`<h2>Log in</h2><form id="f">${field('email', 'Email', 'email', 'required autocomplete="username"')}
    ${field('password', 'Password', 'password', 'required autocomplete="current-password"')}
    <button class="btn primary" type="submit">Log in</button></form>
    <div class="links"><a href="#/forgot">Forgot password?</a><a href="#/signup">Request store access</a></div>`);
}
function forgotView() {
  return authCard(`<h2>Reset password</h2><p class="muted">We will email you a reset link.</p><form id="f">${field('email', 'Email', 'email', 'required')}
    <button class="btn primary" type="submit">Send reset link</button></form><div class="links"><a href="#/login">Back to log in</a></div>`);
}
function resetView() {
  return authCard(`<h2>Set a new password</h2><form id="f">${field('password', 'New password (min 8 characters)', 'password', 'required minlength="8" autocomplete="new-password"')}
    <button class="btn primary" type="submit">Save password</button></form>`);
}
async function signupView() {
  const { data, error } = await sb.rpc('public_store_list');
  const groups = {};
  (data || []).forEach(s => (groups[s.circle_code] = groups[s.circle_code] || []).push(s));
  const opts = Object.keys(groups).sort().map(c => `<optgroup label="${esc(c)}">${groups[c].map(s => `<option value="${s.id}">${esc(s.name)} (${esc(s.code)})</option>`).join('')}</optgroup>`).join('');
  return authCard(`<h2>Request store access</h2><p class="muted">An administrator must approve your request. Your store cannot be changed by you after approval.</p>
    ${error ? '<div class="alert err">Could not load the store list. Please refresh.</div>' : ''}
    <form id="f">${field('full_name', 'Full name', 'text', 'required')}${field('employee_id', 'Employee ID', 'text', 'required')}
    ${field('email', 'Email', 'email', 'required autocomplete="username"')}${field('mobile', 'Mobile (10 digits)', 'tel', 'required pattern="[0-9]{10}" inputmode="numeric"')}
    <label for="store_id">Store</label><select id="store_id" required><option value="">Select your store…</option>${opts}</select>
    ${field('password', 'Password (min 8 characters)', 'password', 'required minlength="8" autocomplete="new-password"')}
    <button class="btn primary" type="submit">Submit request</button></form><div class="links"><a href="#/login">Back to log in</a></div>`);
}
function holdView(rejected) {
  const p = S.profile;
  const body = !p ? `<h2>Account not ready</h2><p class="muted">We could not load your profile. Please try again.</p>`
    : rejected ? `<h2>Request not approved</h2><p class="muted">Your access request was not approved${p.reject_reason ? ': ' + esc(p.reject_reason) : ''}. Please contact your administrator.</p>`
    : `<h2>Waiting for approval</h2><p class="muted">Hi ${esc(p.full_name)}, your request has been sent. An administrator will approve your access to your store. You can close this page and log in again later.</p>`;
  return authCard(`${body}<button class="btn" id="out">Log out</button>${!p ? '<button class="btn" id="retry">Retry</button>' : ''}`);
}

function shell(page) {
  const p = S.profile, items = NAV[p.role] || NAV_STORE;
  const cur = (items.some(i => i[0] === page) || page === 'result' || page === 'storedetail') ? page : 'dashboard'; S.cur = cur;
  const chip = p.role === 'STORE_USER' && S.store ? `${esc(S.store.name)} · ${esc(S.store.circles?.code || '')}`
    : p.role === 'CIRCLE_HEAD' ? esc(S.circles.map(c => c.code).join(', ') || 'No circles assigned') : 'All circles';
  const title = (items.find(i => i[0] === cur) || [cur, cur === 'storedetail' ? 'Store Detail' : 'Audit Result'])[1];
  return `<div class="shell"><aside class="side">${brand()}<nav>${items.map(([k, l]) => `<a href="#/${k}" class="${k === (cur === 'storedetail' ? 'dashboard' : cur) ? 'on' : ''}">${l}</a>`).join('')}</nav></aside>
    <div class="main"><header class="top"><h1>${title}</h1><div class="who"><span class="chip">${chip}</span>
      <span class="uname">${esc(p.full_name)}<small>${ROLE_LABEL[p.role]}</small></span><button class="btn sm" id="out">Log out</button></div></header>
    <main class="page">${pageBody(cur)}</main></div></div>`;
}

function pageBody(page) {
  const p = S.profile;
  if (PAGES[page]) return '<div id="pg"><div class="boot">Loading…</div></div>';
  if (page === 'dashboard') return `<div class="card"><h2>Welcome, ${esc(p.full_name)}</h2>
    <p class="muted">${p.role === 'STORE_USER' ? (S.store ? `Store: <b>${esc(S.store.name)}</b> (${esc(S.store.code)}), circle ${esc(S.store.circles?.code || '')}.` : 'No store is assigned to your account yet. Please contact your administrator.')
      : `You are signed in as ${ROLE_LABEL[p.role]}.`}</p><p class="muted">Dashboards and audit tools are added in the next phases.</p></div>`;
  if (page === 'profile') return `<div class="card narrow"><form id="pf">${field('full_name', 'Full name', 'text', `required value="${esc(p.full_name)}"`)}
    ${field('mobile', 'Mobile', 'tel', `value="${esc(p.mobile || '')}"`)}
    <label>Email</label><input value="${esc(p.email || '')}" disabled><label>Employee ID</label><input value="${esc(p.employee_id || '')}" disabled>
    <label>Role</label><input value="${ROLE_LABEL[p.role]}" disabled>${p.role === 'STORE_USER' ? `<label>Store</label><input value="${esc(S.store ? S.store.name + ' (' + S.store.code + ')' : '—')}" disabled>` : ''}
    <button class="btn primary" type="submit">Save changes</button></form></div>`;
  return `<div class="card"><h2>Coming soon</h2><p class="muted">This page is built in ${LATER[page] || 'a later phase'}.</p></div>`;
}

/* ---------- router & wiring ---------- */
async function route() {
  const h = (location.hash || '').replace(/^#\//, '').split('?')[0];
  let html, wire = () => {};
  if (S.recovery) { html = resetView(); wire = wireReset; }
  else if (!S.session) {
    const v = ['login', 'signup', 'forgot'].includes(h) ? h : 'login';
    if (v === 'signup') { root().innerHTML = '<div class="boot">Loading…</div>'; html = await signupView(); wire = wireSignup; }
    else if (v === 'forgot') { html = forgotView(); wire = wireForgot; } else { html = loginView(); wire = wireLogin; }
  }
  else if (!S.profile) html = holdView(false);
  else if (S.profile.status === 'PENDING') html = holdView(false);
  else if (S.profile.status === 'REJECTED') html = holdView(true);
  else { html = shell(h); wire = wireShell; }
  root().innerHTML = html;
  wire();
  const out = document.getElementById('out'); if (out) out.onclick = logout;
  const retry = document.getElementById('retry'); if (retry) retry.onclick = boot;
}

const logout = async () => { await sb.auth.signOut(); location.hash = '#/login'; };
const val = id => document.getElementById(id).value.trim();
function submit(fn) { const f = document.getElementById('f'); f.onsubmit = e => { e.preventDefault(); busy(f.querySelector('button[type=submit]'), () => fn()).catch(err => toast(friendlyError(err), 'err')); }; }

function wireLogin() {
  submit(async () => {
    const { error } = await sb.auth.signInWithPassword({ email: val('email'), password: document.getElementById('password').value });
    if (error) throw error;
  });
}
function wireForgot() {
  submit(async () => {
    const { error } = await sb.auth.resetPasswordForEmail(val('email'), { redirectTo: location.origin + location.pathname });
    if (error) throw error;
    toast('If that email is registered, a reset link has been sent.', 'ok');
  });
}
function wireReset() {
  submit(async () => {
    const { error } = await sb.auth.updateUser({ password: document.getElementById('password').value });
    if (error) throw error;
    S.recovery = false; toast('Password updated.', 'ok'); location.hash = '#/dashboard'; boot();
  });
}
function wireSignup() {
  submit(async () => {
    if (!val('store_id')) { toast('Please select your store.', 'err'); return; }
    const { data, error } = await sb.auth.signUp({
      email: val('email'), password: document.getElementById('password').value,
      options: { data: { full_name: val('full_name'), employee_id: val('employee_id'), mobile: val('mobile'), store_id: val('store_id') } }
    });
    if (error) throw error;
    if (!data.session) toast('Account created. Please confirm your email, then log in.', 'ok');
  });
}
function wireShell() {
  const pg = document.getElementById('pg');
  if (pg && PAGES[S.cur]) PAGES[S.cur](pg).catch(e => { console.error(e); pg.innerHTML = '<div class="alert err">Could not load this page. ' + esc(friendlyError(e)) + '</div>'; });
  const f = document.getElementById('pf');
  if (!f) return;
  f.onsubmit = e => {
    e.preventDefault();
    busy(f.querySelector('button'), async () => {
      const { error } = await sb.rpc('update_my_profile', { p_name: val('full_name'), p_mobile: val('mobile') });
      if (error) throw error;
      toast('Profile updated.', 'ok'); await boot();
    }).catch(err => toast(friendlyError(err), 'err'));
  };
}

window.addEventListener('load', boot);   // after ALL page scripts (admin.js, basestock.js) are loaded
