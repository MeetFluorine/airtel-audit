// App core: auth screens, loading screens, role-based shell (sidebar + topbar), router.
const ROLE_LABEL = { ADMIN: 'Administrator', CIRCLE_HEAD: 'Circle Head', STORE_USER: 'Store User' };
const NAV_STORE = [['dashboard', 'Dashboard', 'home'], ['basedata', 'Base Data', 'box'], ['audit', 'Start Audit', 'play'], ['result', 'My Result', 'clip'], ['ranking', 'Ranking', 'trend'], ['profile', 'My Profile', 'user']];
const NAV_STAFF = [{ k: 'dashboard', t: 'Dashboard', i: 'home' }, { k: 'ranking', t: 'Ranking', i: 'trend' },
  { g: 'mgmt', t: 'Management', i: 'grid', kids: [['stores', 'Stores'], ['users', 'Users']] },
  { g: 'ops', t: 'Operations', i: 'scan', kids: [['storeaudit', 'Store Audit'], ['basestock', 'Base Stock'], ['review', 'Shortage Review']] },
  { g: 'reports', t: 'Reports', i: 'file', kids: [['reports', 'Reports'], ['logs', 'Audit Logs']] },
  { k: 'profile', t: 'My Account', i: 'user' }];
const FLY = {   // sub-menus open in a flyout beside the sidebar (title, description, icon)
  reports: [['reports', 'Reports', 'Download audit reports and Excel exports', 'file'], ['logs', 'Audit Logs', 'Track activities and changes in the system', 'clip']],
  mgmt: [['stores', 'Stores', 'Manage stores, circles and store types', 'store'], ['users', 'Users', 'Approve users, roles and store assignments', 'users']],
  ops: [['storeaudit', 'Store Audit', 'Monitor store-wise progress and drill down', 'scan'], ['basestock', 'Base Stock', "Upload and freeze each store's base stock", 'box'], ['review', 'Shortage Review', 'Accept store remarks on genuine shortage', 'clip']] };
const GROUP_OF = { reports: 'reports', logs: 'reports', stores: 'mgmt', users: 'mgmt', storeaudit: 'ops', basestock: 'ops', storedetail: 'ops', result: 'ops', review: 'ops' };
const HEAD = { dashboard: ['Dashboard', ''], reports: ['Reports', 'Download audit reports, analytics and export data.'], logs: ['Audit Logs', 'Track all activities and changes in the system.'],
  stores: ['Stores', 'Manage all stores across circles.'], users: ['Users', 'Manage application users, roles and store assignments.'], storeaudit: ['Store Audit', 'Monitor store-wise audit progress, view variances and drill down to detailed records.'],
  basestock: ['Base Stock', "Upload and freeze each store's base stock for the current audit cycle."], review: ['Shortage Review', ''], storedetail: ['', ''], result: ['', ''], profile: ['My Account', 'View and manage your profile information.'],
  ranking: ['Ranking', 'Store and circle ranking based on audit results and participation.'] };

const S = { session: null, profile: null, store: null, circles: [], recovery: false, cycles: [], cycleId: null, cycleName: '', progress: null, openGroup: null, ctx: null, shellUser: null };
const root = () => document.getElementById('app');
const isStaff = () => S.profile && S.profile.role !== 'STORE_USER';

/* ---------- data ---------- */
async function loadProfile() {
  S.profile = null; S.store = null; S.circles = []; S.ctx = null;
  const uid = S.session.user.id;
  const { data, error } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error || !data) return;
  S.profile = data;
  if (data.status !== 'APPROVED') return;
  if (data.role === 'STORE_USER') {
    const r = await sb.from('user_store_assignments').select('stores(code,name,circles(code,name))').eq('user_id', uid).maybeSingle();
    S.store = r.data ? r.data.stores : null;
  } else {
    if (data.role === 'CIRCLE_HEAD') { const r = await sb.from('circle_head_assignments').select('circles(code,name)').eq('user_id', uid); S.circles = (r.data || []).map(x => x.circles); }
    if (typeof loadCycles === 'function') await loadCycles();
  }
}
async function boot() {
  if (localStorage.getItem('sfx_remember') === '0' && !sessionStorage.getItem('sfx_alive')) { await sb.auth.signOut(); }
  const { data } = await sb.auth.getSession(); S.session = data.session; if (!S.session) S.shellUser = null;
  if (S.session) {
    if (!S.profile) root().innerHTML = loadingView('verify');     // only on the very first load, never when moving between pages
    await loadProfile();
    if (S.profile && !sessionStorage.getItem('sfx_login')) { sessionStorage.setItem('sfx_login', '1'); sb.rpc('log_login').then(() => {}, () => {}); }
  } else S.profile = null;
  route();
}
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') { if (session && S.session) S.session = session; return; }
  // Switching back to this browser tab re-fires SIGNED_IN for the SAME user: keep the page and the data exactly as they are.
  if (event === 'SIGNED_IN' && session && S.session && S.profile && S.session.user.id === session.user.id) { S.session = session; return; }
  if (event === 'PASSWORD_RECOVERY') S.recovery = true;
  if (event === 'SIGNED_OUT') { sessionStorage.removeItem('sfx_login'); sessionStorage.removeItem('sfx_alive'); S.shellUser = null; }
  setTimeout(boot, 0);
});
window.addEventListener('hashchange', route);

/* ---------- loading screens ---------- */
function loadingView(kind) {
  const brand = `<div class="lb">${LOGO(40)}<div><b>Shadowfax</b><small>Airtel Store Audit Tracker</small></div></div>`;
  if (kind === 'workspace') return `<div class="ld dark">${brand}<div class="spin"></div><h3>Loading your workspace...</h3><p>Connecting to secure server and fetching your audit data.</p><div class="pbar"><i></i></div></div>`;
  if (kind === 'verify') return `<div class="ld">${brand}<div class="big y">${ic('filesearch', 52, 1.5)}</div><h3>Verifying your account...</h3><p>Please wait while we fetch your store details<br>and audit cycle information.</p><div class="pbar"><i></i></div></div>`;
  const t = new Date().toLocaleTimeString('en-IN', { hour12: false });
  return `<div class="ld">${brand}<div class="big">${ic('cloud', 56, 1.5)}</div><h3>Syncing your data...</h3><p>This may take a few seconds.<br>Please do not close the application.</p><div class="pbar"><i></i></div><div class="conn"><span>${ic('check', 16)} Connected to server</span><span>Live · synced ${t}</span></div></div>`;
}

/* ---------- auth screens ---------- */
const feat = (i, t, d) => `<div class="feat"><span class="tile">${ic(i, 22)}</span><div><b>${t}</b><span>${d}</span></div></div>`;
function authShell(kind, right, wide) {
  const left = kind === 'register'
    ? `<div class="brand2">${LOGO(40)}<div><b>Shadowfax</b><small>Airtel Store Audit Tracker</small></div></div><h2>Join the<em>Airtel Audit Network</em></h2><p class="desc">Create your account to start auditing and managing store inventory with ease.</p>
       ${feat('users', 'Quick Registration', 'Simple and secure onboarding')}${feat('check', 'Admin Approval', 'Your account will be reviewed and approved')}${feat('store', 'Access Your Assigned Store', 'Start auditing once approved')}`
    : `<div class="brand2">${LOGO(40)}<div><b>Shadowfax</b><small>Airtel Store Audit Tracker</small></div></div><h2>Powering<br>Airtel Stores<em>with Accuracy</em></h2><p class="tag">Simple. Accurate. Real-Time.</p><p class="desc">Shadowfax's inventory audit platform for a stronger, more connected Airtel network.</p>
       ${feat('trend', 'Real-Time Tracking', 'Monitor audit progress across all stores')}${feat('target', 'Greater Accuracy', 'Reduce discrepancies with digital audits')}${feat('zap', 'Faster Reconciliation', 'Save time and improve operational efficiency')}`;
  return `<div class="auth2"><div class="auth-l">${left}<div class="scene"></div></div><div class="auth-r"><div class="mhero"><b>Welcome</b><span>Sign in to continue</span></div><div class="auth-c ${wide ? 'wide' : ''}"><div class="top">${LOGO(42)}<div><b>Shadowfax</b><small>Airtel Store Audit Tracker</small></div></div>${right}</div></div></div>`;
}
const fld = (id, label, icon, type, ph, extra = '') => `<div class="fld"><label for="${id}">${label}</label><div class="inp">${ic(icon, 18)}<input id="${id}" name="${id}" type="${type}" placeholder="${ph}" ${extra}>${type === 'password' ? `<button type="button" class="eye" data-eye="${id}" aria-label="Show password">${ic('eyeoff', 18)}</button>` : ''}</div></div>`;
function loginView() {
  return authShell('login', `<h3>Welcome Back</h3><p class="sub">Login to continue to your account</p><form id="f">${fld('email', 'Email Address', 'mail', 'email', 'Enter your email', 'required autocomplete="username"')}
    ${fld('password', 'Password', 'key', 'password', 'Enter your password', 'required autocomplete="current-password"')}
    <div class="rm"><label><input type="checkbox" id="rm" checked> Remember me</label><a href="#/forgot">Forgot password?</a></div>
    <button class="btn go" type="submit">Login ${ic('arrow', 18)}</button></form><div class="or">OR</div>
    <button class="btn sso" type="button" disabled title="Single sign-on is not enabled for this workspace yet">${ic('store', 18)} Login with SSO</button><div class="foot">Don't have an account? <a href="#/signup">Register now</a></div>`);
}
function forgotView() { return authShell('login', `<h3>Reset password</h3><p class="sub">We will email you a reset link.</p><form id="f">${fld('email', 'Email Address', 'mail', 'email', 'Enter your email', 'required')}<button class="btn go" type="submit">Send reset link</button></form><div class="foot"><a href="#/login">Back to login</a></div>`); }
function resetView() { return authShell('login', `<h3>Set a new password</h3><p class="sub">Choose a password with at least 8 characters.</p><form id="f">${fld('password', 'New password', 'key', 'password', 'Create new password', 'required minlength="8" autocomplete="new-password"')}<button class="btn go" type="submit">Save password</button></form>`); }
const backTo = '<div class="foot" style="margin-top:6px"><a href="#/signup">‹ Choose a different account type</a></div>';
function signupChoiceView() {
  const card = (href, icon, tone, t, d) => `<a class="pcard" href="${href}"><span class="pic ${tone}">${ic(icon, 26, 1.8)}</span><div><b>${t}</b><small>${d}</small></div><span class="pgo">${ic('arrow', 20, 2)}</span></a>`;
  return authShell('register', `<h3>Create Your Account</h3><p class="sub">Choose how you will use Shadowfax.</p>
    <div class="pick">${card('#/signup/store', 'store', 'y', 'Store Level', 'For store teams. Audit the inventory of your own store.')}
    ${card('#/signup/management', 'users', 'g', 'Management Level', 'For Circle Heads and Admins. Manage circles, stores, users and audits.')}</div>
    <div class="foot">Already have an account? <a href="#/login">Login here</a></div>`);
}
async function signupView() {
  const { data, error } = await sb.rpc('public_store_list');
  const groups = {}; (data || []).forEach(s => (groups[s.circle_code] = groups[s.circle_code] || []).push(s));
  const opts = Object.keys(groups).sort().map(c => `<optgroup label="${esc(c)}">${groups[c].map(s => `<option value="${s.id}">${esc(s.name)} (${esc(s.code)})</option>`).join('')}</optgroup>`).join('');
  return authShell('register', `<h3>Store Level Sign Up</h3><p class="sub">Fill in your details to register. Your request will be reviewed by the admin.</p>${error ? '<div class="alert err">Could not load the store list. Please refresh.</div>' : ''}
    <form id="f">${fld('full_name', 'Full Name', 'user', 'text', 'Enter your full name', 'required')}${fld('employee_id', 'Employee ID', 'id', 'text', 'Enter employee ID', 'required')}
    <div class="row2">${fld('email', 'Email Address', 'mail', 'email', 'Enter your email', 'required autocomplete="username"')}${fld('mobile', 'Mobile Number', 'phone', 'tel', 'Enter mobile number', 'required pattern="[0-9]{10}" inputmode="numeric"')}</div>
    <div class="row2"><div class="fld"><label for="store_id">Select Store</label><div class="inp">${ic('store', 18)}<select id="store_id" required><option value="">Choose your store</option>${opts}</select></div></div>${fld('password', 'Password', 'key', 'password', 'Create password', 'required minlength="8" autocomplete="new-password"')}</div>
    <div class="infobox">${ic('info', 20)}<div><b>Your registration will be sent for admin approval.</b>You will be able to log in once your account is approved.</div></div>
    <button class="btn go" type="submit">Register ${ic('arrow', 18)}</button></form><div class="foot">Already have an account? <a href="#/login">Login here</a></div>${backTo}`, true);
}
async function signupMgmtView() {
  const { data, error } = await sb.rpc('public_store_list');
  const codes = [...new Set((data || []).map(s => s.circle_code))].sort();
  return authShell('register', `<h3>Management Level Sign Up</h3><p class="sub">For Circle Heads and Admins. An administrator reviews every request.</p>${error ? '<div class="alert err">Could not load the circle list. Please refresh.</div>' : ''}
    <form id="f">${fld('full_name', 'Full Name', 'user', 'text', 'Enter your full name', 'required')}${fld('employee_id', 'Employee ID', 'id', 'text', 'Enter employee ID', 'required')}
    <div class="row2">${fld('email', 'Email Address', 'mail', 'email', 'Enter your email', 'required autocomplete="username"')}${fld('mobile', 'Mobile Number', 'phone', 'tel', 'Enter mobile number', 'required pattern="[0-9]{10}" inputmode="numeric"')}</div>
    <div class="row2"><div class="fld"><label for="req_role">Access Requested</label><div class="inp">${ic('users', 18)}<select id="req_role" required><option value="CIRCLE_HEAD">Circle Head</option><option value="ADMIN">Admin</option></select></div></div>${fld('password', 'Password', 'key', 'password', 'Create password', 'required minlength="8" autocomplete="new-password"')}</div>
    <div class="fld" id="circ_box"><label>Circles you will manage</label><div class="cpick">${codes.map(c => `<label class="cp"><input type="checkbox" class="rc" value="${esc(c)}"><span>${esc(c)}</span></label>`).join('') || '<span class="muted">No circles available yet.</span>'}</div></div>
    <div class="infobox">${ic('info', 20)}<div><b>Your request will be sent to an administrator.</b>You can log in once it is approved. Admin access is only given after the administrator verifies who you are.</div></div>
    <button class="btn go" type="submit">Request access ${ic('arrow', 18)}</button></form><div class="foot">Already have an account? <a href="#/login">Login here</a></div>${backTo}`, true);
}
function holdView(rejected) {
  const p = S.profile;
  const body = !p ? `<h3>Account not ready</h3><p class="sub">We could not load your profile. Please try again.</p>`
    : rejected ? `<h3>Request not approved</h3><p class="sub">Your access request was not approved${p.reject_reason ? ': ' + esc(p.reject_reason) : ''}. Please contact your administrator.</p>`
    : p.requested_role ? `<h3>Waiting for approval</h3><p class="sub">Hi ${esc(p.full_name)}, your request for <b>${ROLE_LABEL[p.requested_role] === 'Administrator' ? 'Admin' : ROLE_LABEL[p.requested_role]}</b> access has been sent. An administrator will review it. You can close this page and log in again later.</p>`
    : `<h3>Waiting for approval</h3><p class="sub">Hi ${esc(p.full_name)}, your request has been sent. An administrator will approve your access to your store. You can close this page and log in again later.</p>`;
  return authShell('login', `${body}<button class="btn go" id="out" type="button">Log out</button>${!p ? '<div class="foot"><a href="#/login" id="retry">Retry</a></div>' : ''}`);
}

/* ---------- shell ---------- */
function resolvePage(h, staff) {
  const ok = staff ? ['dashboard', 'reports', 'logs', 'stores', 'users', 'storeaudit', 'basestock', 'storedetail', 'result', 'ranking', 'profile', 'review'] : ['dashboard', 'basedata', 'audit', 'result', 'ranking', 'profile'];
  return ok.includes(h) ? h : 'dashboard';
}
const userCard = (sub) => `<div class="usercard"><a class="avatar" href="#/profile" title="My profile">${esc(initials(S.profile.full_name))}</a><div class="un"><b>${esc(S.profile.full_name)}</b><small>${sub}</small><small>${ROLE_LABEL[S.profile.role]}</small></div><button class="lo" id="out" title="Log out">${ic('logout', 20)}</button></div>`;
function storeSidebar(cur) {
  return `<aside class="sb store"><div class="sb-brand">${LOGO(36)}<div><b>Shadowfax</b><small>Airtel Store Audit Tracker</small></div></div><nav class="nv">${NAV_STORE.map(([k, l, i]) => `<a href="#/${k}" class="${k === cur ? 'on' : ''}">${ic(i, 19)}${l}</a>`).join('')}</nav>${userCard(S.store ? esc(S.store.code) : '')}</aside>`;
}
function staffSidebar(cur) {
  const g = GROUP_OF[cur];
  const nav = NAV_STAFF.map(n => n.k ? `<a href="#/${n.k}" class="${n.k === cur ? 'on' : ''}">${ic(n.i, 19)}${n.t}</a>`
    : `<button class="grp ${n.g === g ? 'on' : ''}" data-grp="${n.g}" aria-haspopup="true">${ic(n.i, 19)}${n.t}${ic('chevr', 16)}</button>`).join('');
  return `<aside class="sb staff"><div class="sb-brand">${LOGO(36)}<div><b>Shadowfax</b><small>AUDIT TRACKER</small></div></div><nav class="nv">${nav}</nav>${cycleWidgetHtml()}${userCard(S.profile.role === 'ADMIN' ? '' : esc(S.circles.map(c => c.code).join(', ')))}</aside>`;
}
const bell = () => `<div style="position:relative"><button class="bellb" id="bell" aria-label="Notifications">${ic('bell', 20)}<span class="dot" id="beldot" hidden></span></button><div class="pop" id="pop" hidden></div></div>`;
function staffTop(cur) {
  const [t, s] = HEAD[cur] || ['', ''];
  return `<header class="tb"><button type="button" class="mnav" id="mnav" aria-label="Open menu">&#9776;</button><div class="tb-t">${t ? `<h1>${t}</h1>${s ? `<p>${s}</p>` : ''}` : ''}</div><div class="tb-r"><div class="chip-i cal"><span class="tile" style="background:#FDE8E8">${ic('cal', 18)}</span><div><small>Audit Cycle</small><b>${esc(S.cycleName || '—')}</b></div></div>${bell()}<a class="avatar" href="#/profile">${esc(initials(S.profile.full_name))}</a></div></header>`;
}
function storeTop() {
  const st = S.store;
  return `<header class="tb"><button type="button" class="mnav" id="mnav" aria-label="Open menu">&#9776;</button><div class="chip-i"><span class="tile">${ic('store', 18)}</span><div><b>${st ? esc(st.code) : '—'}</b><small>${st && st.circles ? esc(st.circles.name) + ' (' + esc(st.circles.code) + ')' : ''}</small></div></div>
    <div class="tb-r"><div class="cycwrap"><button type="button" class="chip-i cal cyc-btn" id="cyc-btn" aria-haspopup="true" aria-expanded="false" title="See previous audit cycles and their results"><span class="tile">${ic('cal', 18)}</span><div><small>Audit Cycle</small><b id="cyc-name">…</b></div><span class="chev">▾</span></button><div class="cyc-pop" id="cyc-pop" hidden></div></div>${bell()}<a class="avatar" href="#/profile">${esc(initials(S.profile.full_name))}</a></div></header>`;
}
const footerBand = () => `<footer class="app-footer-band"><span class="afb-l">${LOGO(24)}<span><span class="afb-name">Shadowfax</span><span class="afb-sub">AUDIT TRACKER</span></span></span><span class="afb-credit">Made by <b>Chandan Yadav</b> with <svg class="afb-heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg> · © 2026</span></footer>`;
function shell(page) {
  const staff = isStaff(), cur = resolvePage(page, staff); S.cur = cur;
  const mtabs = staff ? '' : `<nav class="mtabs" id="mtabs"><a href="#/dashboard" data-mt="dashboard"><span class="mt-ic">${ic('home', 20)}</span>Home</a><a href="#/audit" data-mt="audit"><span class="mt-ic">${ic('barcode', 20)}</span>Scan</a><a href="#/audit?tab=non" data-mt="entry"><span class="mt-ic">${ic('clip', 20)}</span>Entry</a><a href="#/result" data-mt="result"><span class="mt-ic">${ic('trend', 20)}</span>Result</a></nav>`;
  return `<div class="app${cur === 'ranking' ? ' no-top' : ''}">${staff ? staffSidebar(cur) : storeSidebar(cur)}<div class="fly" id="fly"></div><div class="scrim" id="scrim"></div><div class="main2">${staff ? staffTop(cur) : storeTop()}<main class="page2"><div id="pg">${universeLoader()}</div>${footerBand()}</main>${mtabs}</div></div>`;
}
function paintMtabs() {
  const m = document.getElementById('mtabs'); if (!m) return;
  const h = location.hash || '';
  const tab = S.cur === 'dashboard' ? 'dashboard' : S.cur === 'result' ? 'result' : S.cur === 'audit' ? (/tab=non/.test(h) ? 'entry' : 'audit') : '';
  m.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.mt === tab));
}
function setCycLabel(name) { const n = document.getElementById('cyc-name'); if (n) n.textContent = name || '—'; }
async function fillTop() {
  try {
    if (isStaff()) {
      const r = await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'); S.pending = r.count || 0;
      const d = document.getElementById('beldot'); if (d) d.hidden = !S.pending;
    } else {
      const { data } = await sb.rpc('my_audit_context'); S.ctx = data;
      /* the chip names the cycle being VIEWED: a previous cycle picked from the chip (#/result?cycle=…) wins; otherwise the latest (current) cycle */
      const want = /^#\/result/.test(location.hash || '') ? new URLSearchParams(location.hash.split('?')[1] || '').get('cycle') : null;
      if (want && want !== (data && data.cycle && data.cycle.id)) {
        const r = await sb.from('audit_cycles').select('name').eq('id', want).maybeSingle();
        setCycLabel(r.data ? r.data.name : (data && data.cycle ? data.cycle.name : null));
      } else setCycLabel(data && data.cycle ? data.cycle.name : null);
      const d = document.getElementById('beldot'); if (d) d.hidden = !(data && data.session && data.session.reopen_reason && data.session.status === 'IN_PROGRESS');
    }
  } catch (e) { /* topbar extras are optional */ }
}
function openFly(btn) {
  const fly = document.getElementById('fly'), sbEl = document.querySelector('.sb'); if (!fly || !FLY[btn.dataset.grp]) return;
  const r = btn.getBoundingClientRect(), sr = sbEl.getBoundingClientRect(), mobile = window.innerWidth <= 900;
  fly.innerHTML = FLY[btn.dataset.grp].map(([k, t, d, i]) => `<a href="#/${k}" class="${k === S.cur ? 'on' : ''}"><span class="ficon">${ic(i, 18)}</span><span><b>${t}</b><small>${d}</small></span></a>`).join('');
  fly.style.left = (mobile ? Math.max(8, r.left) : sr.right + 10) + 'px'; fly.style.top = (mobile ? r.bottom + 6 : Math.max(8, r.top - 6)) + 'px';
  fly.classList.add('open'); S.openGroup = btn.dataset.grp;
  document.querySelectorAll('[data-grp]').forEach(x => x.classList.toggle('open', x === btn));
}
function closeFly() { const f = document.getElementById('fly'); if (f) f.classList.remove('open'); S.openGroup = null; document.querySelectorAll('[data-grp]').forEach(x => x.classList.remove('open')); }
// Move between pages WITHOUT redrawing the sidebar / top bar: only the content changes (smooth, no flicker).
function updateShell(cur) {
  S.cur = cur; closeFly();
  const app0 = document.querySelector('.app'); if (app0) { app0.classList.remove('nav-open'); app0.classList.toggle('no-top', cur === 'ranking'); }
  paintMtabs();
  document.querySelectorAll('.sb .nv > a[href]').forEach(x => x.classList.toggle('on', x.getAttribute('href') === '#/' + cur));
  document.querySelectorAll('.sb .nv .grp').forEach(x => x.classList.toggle('on', x.dataset.grp === GROUP_OF[cur]));
  const t = document.querySelector('.tb-t'); if (t && isStaff()) { const [h, s] = HEAD[cur] || ['', '']; t.innerHTML = h ? `<h1>${h}</h1>${s ? `<p>${s}</p>` : ''}` : ''; }
  const p2 = document.querySelector('.page2'); if (p2) { p2.classList.remove('fixed'); p2.scrollTop = 0; }
  if (isStaff() && typeof refreshProgress === 'function') refreshProgress();     // keep the sidebar progress bar current
  const old = document.getElementById('pg'), pg = document.createElement('div'); pg.id = 'pg'; pg.className = 'fade'; pg.innerHTML = universeLoader(); old.replaceWith(pg);   // fresh element: no stale handlers
  if (PAGES[cur]) PAGES[cur](pg).catch(e => { console.error(e); pg.innerHTML = '<div class="alert err">Could not load this page. ' + esc(friendlyError(e)) + '</div>'; });
}
function wireShell() {
  const outBtn = document.getElementById('out'); if (outBtn) outBtn.onclick = logout;
  const app = document.querySelector('.app'), scrim = document.getElementById('scrim');
  const closeNav = () => app && app.classList.remove('nav-open');
  const mn = document.getElementById('mnav');
  if (mn) mn.onclick = e => { e.stopPropagation(); app.classList.toggle('nav-open'); };
  if (scrim) scrim.onclick = closeNav;
  document.querySelectorAll('.sb .nv a').forEach(a => a.addEventListener('click', closeNav));
  document.querySelectorAll('[data-grp]').forEach(b => b.onclick = e => { e.stopPropagation(); S.openGroup === b.dataset.grp ? closeFly() : openFly(b); });
  const fly = document.getElementById('fly'); if (fly) fly.onclick = e => { if (e.target.closest('a')) closeFly(); };
  if (S.flyOff) S.flyOff(); const out = () => closeFly(), esc2 = e => { if (e.key === 'Escape') closeFly(); };
  document.addEventListener('click', out); document.addEventListener('keydown', esc2); S.flyOff = () => { document.removeEventListener('click', out); document.removeEventListener('keydown', esc2); };
  const bl = document.getElementById('bell'), pop = document.getElementById('pop');
  if (bl) bl.onclick = e => { e.stopPropagation(); pop.hidden = !pop.hidden; if (pop.hidden) return;
    if (isStaff()) pop.innerHTML = S.pending ? `<a href="#/users">${ic('users', 16)} ${S.pending} user request${S.pending === 1 ? '' : 's'} waiting for approval</a>` : '<div class="muted" style="padding:8px">You are all caught up.</div>';
    else { const s = S.ctx && S.ctx.session; pop.innerHTML = s && s.reopen_reason && s.status === 'IN_PROGRESS' ? `<a href="#/audit">${ic('alert', 16)} Your audit was reopened: ${esc(s.reopen_reason)}</a>` : '<div class="muted" style="padding:8px">You are all caught up.</div>'; } };
  document.addEventListener('click', () => { if (pop) pop.hidden = true; }, { once: true });
  if (isStaff() && typeof wireCycle === 'function') wireCycle();
  const pg = document.getElementById('pg');
  if (pg && PAGES[S.cur]) PAGES[S.cur](pg).catch(e => { console.error(e); pg.innerHTML = '<div class="alert err">Could not load this page. ' + esc(friendlyError(e)) + '</div>'; });
  fillTop(); paintMtabs();
}

/* ---------- router ---------- */
async function route() {
  const h = (location.hash || '').replace(/^#\//, '').split('?')[0];
  let html, wire = () => {};
  if (S.recovery) { html = resetView(); wire = wireReset; }
  else if (!S.session) {
    const seg = h.split('/'), v = ['login', 'signup', 'forgot'].includes(seg[0]) ? seg[0] : 'login';
    if (v === 'signup' && seg[1] === 'store') { root().innerHTML = loadingView('workspace'); html = await signupView(); wire = wireSignup; }
    else if (v === 'signup' && seg[1] === 'management') { root().innerHTML = loadingView('workspace'); html = await signupMgmtView(); wire = wireSignupMgmt; }
    else if (v === 'signup') { html = signupChoiceView(); }
    else if (v === 'forgot') { html = forgotView(); wire = wireForgot; } else { html = loginView(); wire = wireLogin; }
  }
  else if (!S.profile || S.profile.status === 'PENDING') html = holdView(false);
  else if (S.profile.status === 'REJECTED') html = holdView(true);
  else {
    const cur = resolvePage(h, isStaff());
    if (S.shellUser === S.profile.id && document.getElementById('pg') && document.querySelector('.app')) { updateShell(cur); return; }
    S.shellUser = S.profile.id; html = shell(h); wire = wireShell;
  }
  root().innerHTML = html; wire();
  document.querySelectorAll('[data-eye]').forEach(b => b.onclick = () => { const i = document.getElementById(b.dataset.eye); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.innerHTML = ic(show ? 'eye' : 'eyeoff', 18); });
  const out = document.getElementById('out'); if (out && !S.profile) out.onclick = logout; else if (out && S.profile && S.profile.status !== 'APPROVED') out.onclick = logout;
  const retry = document.getElementById('retry'); if (retry) retry.onclick = e => { e.preventDefault(); boot(); };
}
const logout = async () => { await sb.auth.signOut(); location.hash = '#/login'; };
const val = id => document.getElementById(id).value.trim();
function submit(fn) { const f = document.getElementById('f'); f.onsubmit = e => { e.preventDefault(); busy(f.querySelector('button[type=submit]'), () => fn()).catch(err => toast(friendlyError(err), 'err')); }; }
function wireLogin() {
  submit(async () => {
    const rm = document.getElementById('rm').checked; localStorage.setItem('sfx_remember', rm ? '1' : '0'); sessionStorage.setItem('sfx_alive', '1');
    const { error } = await sb.auth.signInWithPassword({ email: val('email'), password: document.getElementById('password').value }); if (error) throw error;
  });
}
function wireForgot() { submit(async () => { const { error } = await sb.auth.resetPasswordForEmail(val('email'), { redirectTo: location.origin + location.pathname }); if (error) throw error; toast('If that email is registered, a reset link has been sent.', 'ok'); }); }
function wireReset() { submit(async () => { const { error } = await sb.auth.updateUser({ password: document.getElementById('password').value }); if (error) throw error; S.recovery = false; toast('Password updated.', 'ok'); location.hash = '#/dashboard'; boot(); }); }
function wireSignup() {
  submit(async () => {
    if (!val('store_id')) { toast('Please select your store.', 'err'); return; }
    const { data, error } = await sb.auth.signUp({ email: val('email'), password: document.getElementById('password').value, options: { data: { full_name: val('full_name'), employee_id: val('employee_id'), mobile: val('mobile'), store_id: val('store_id') } } });
    if (error) throw error; if (!data.session) toast('Account created. Please confirm your email, then log in.', 'ok');
  });
}
function wireSignupMgmt() {
  const role = document.getElementById('req_role'), box = document.getElementById('circ_box');
  role.onchange = () => { box.hidden = role.value !== 'CIRCLE_HEAD'; };
  submit(async () => {
    const circles = role.value === 'CIRCLE_HEAD' ? [...document.querySelectorAll('.rc:checked')].map(i => i.value) : [];
    if (role.value === 'CIRCLE_HEAD' && !circles.length) { toast('Please select at least one circle.', 'err'); return; }
    const { data, error } = await sb.auth.signUp({ email: val('email'), password: document.getElementById('password').value,
      options: { data: { full_name: val('full_name'), employee_id: val('employee_id'), mobile: val('mobile'), requested_role: role.value, requested_circles: circles } } });
    if (error) throw error; if (!data.session) toast('Account created. Please confirm your email, then log in.', 'ok');
  });
}
window.addEventListener('DOMContentLoaded', boot);   // boot as soon as the page parses - no waiting for images/fonts
