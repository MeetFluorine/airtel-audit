const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, type = 'info') {
  const d = document.createElement('div');
  d.className = 't ' + type; d.textContent = msg;
  document.getElementById('toast').appendChild(d);
  setTimeout(() => d.remove(), 4500);
}

// Never show raw database/auth errors to users.
function friendlyError(e) {
  console.error(e);
  const m = ((e && e.message) || '').toLowerCase();
  if (m.includes('invalid login')) return 'Incorrect email or password.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'An account with this email already exists. Log in or reset your password.';
  if (m.includes('password should be')) return 'Password must be at least 8 characters.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Please wait a minute and try again.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Network connection interrupted. Please check your internet and try again.';
  if (m.includes('jwt') || m.includes('expired')) return 'Your session has expired. Please log in again.';
  if (e && e.code === '23505') return 'That code or name already exists.';
  if (e && e.code === '42501') return 'You do not have permission to perform this action.';
  return 'Something went wrong. Please try again.';
}

async function busy(btn, fn) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Please wait…';
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}

/* ---------- shared helpers (used by admin.js / basestock.js) ---------- */
const PAGES = {};
const isAdmin = () => S.profile.role === 'ADMIN';
const badge = (t, c = '') => `<span class="bd ${c}">${esc(t)}</span>`;
const fdate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
// Our own server messages (raise exception ...) are safe to show; everything else is mapped.
const fdt = d => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const rpcMsg = e => (e && ['42501', 'P0001', 'P0002'].includes(e.code) && e.message) ? e.message : friendlyError(e);

async function getStores() {
  const { data, error } = await sb.from('stores').select('id,code,name,report_name,active,circle_id,locator,store_type,circles(code,name)').order('code');
  if (error) throw error; return data;
}
async function getCircles() {
  const { data, error } = await sb.from('circles').select('id,code,name').order('code');
  if (error) throw error; return data;
}
function storeOpts(stores, sel, filter) {
  const g = {};
  stores.filter(s => (s.active || s.id === sel) && (!filter || filter(s))).forEach(s => { const c = s.circles?.code || '—'; (g[c] = g[c] || []).push(s); });
  return Object.keys(g).sort().map(c => `<optgroup label="${esc(c)}">${g[c].map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)} (${esc(s.code)})</option>`).join('')}</optgroup>`).join('');
}
// checkbox list grouped by circle, with a select-all per circle
function storePicker(stores) {
  const g = {};
  stores.filter(s => s.active).forEach(s => { const c = s.circles?.code || '—'; (g[c] = g[c] || []).push(s); });
  return '<div class="picker">' + Object.keys(g).sort().map(c => `<div class="pg-c"><label class="chk"><input type="checkbox" data-circle="${esc(c)}"> <b>${esc(c)}</b> (${g[c].length})</label>
    <div class="pg-s">${g[c].map(s => `<label class="chk"><input type="checkbox" class="sp" data-c="${esc(c)}" value="${s.id}"> ${esc(s.name)} <span class="muted">${esc(s.code)}</span></label>`).join('')}</div></div>`).join('') + '</div>';
}
const pickedIds = o => [...o.querySelectorAll('.sp:checked')].map(i => i.value);
document.addEventListener('change', e => {
  const t = e.target; if (t.dataset && t.dataset.circle) document.querySelectorAll(`.sp[data-c="${CSS.escape(t.dataset.circle)}"]`).forEach(i => (i.checked = t.checked));
});

function openModal(title, bodyHtml, actions = []) {
  closeModal();
  const o = document.createElement('div'); o.id = 'modal'; o.className = 'ov';
  o.innerHTML = `<div class="mdl"><h3>${esc(title)}</h3><div class="mb">${bodyHtml}</div><div class="ma"></div></div>`;
  const ma = o.querySelector('.ma');
  actions.forEach(a => {
    const b = document.createElement('button'); b.className = 'btn ' + (a.cls || ''); b.textContent = a.label;
    b.onclick = () => busy(b, async () => { try { const r = a.fn ? await a.fn(o) : undefined; if (r !== false) closeModal(); } catch (e) { toast(rpcMsg(e), 'err'); } });
    ma.appendChild(b);
  });
  document.body.appendChild(o); return o;
}
function closeModal() { const m = document.getElementById('modal'); if (m) { m.dispatchEvent(new Event('remove')); m.remove(); } }
const cancelBtn = { label: 'Cancel' };

// Long text cells (descriptions etc.) wrap inside a capped width; short cells stay on one line, so tables fit their card instead of stretching the page.
(function () {
  let queued = false;
  const run = () => { queued = false; document.querySelectorAll('.tbl td:not([data-w])').forEach(td => { td.dataset.w = '1'; if (td.textContent.trim().length > 28) td.classList.add('wrap'); }); };
  new MutationObserver(() => { if (!queued) { queued = true; (window.requestAnimationFrame || setTimeout)(run); } }).observe(document.documentElement, { childList: true, subtree: true });
})();


/* "Type DELETE to confirm" dialog used for permanent account deletion (My Account and the Users page). */
function askDeleteAccount({ title, lead, bullets, run }) {
  const o = openModal(title, `<p>${lead}</p><ul class="dz-list">${bullets.map(b => `<li>${b}</li>`).join('')}</ul><label for="dz-in">Type <b>DELETE</b> to confirm</label><input id="dz-in" autocomplete="off" placeholder="DELETE">`,
    [cancelBtn, { label: 'Delete permanently', cls: 'danger', fn: async () => { await run(document.getElementById('dz-in').value.trim()); } }]);
  const go = o.querySelector('.ma .btn.danger'), inp = o.querySelector('#dz-in'); go.disabled = true;
  inp.oninput = () => { go.disabled = inp.value.trim().toUpperCase() !== 'DELETE'; }; inp.focus(); return o;
}

/* Lazy-load the Excel library (~880KB) only when it is actually needed
   (base file upload, report export) instead of on every page load. */
let __xlsxP = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  if (!__xlsxP) __xlsxP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = res;
    s.onerror = () => { __xlsxP = null; rej(new Error('Could not load the Excel library. Check your connection and try again.')); };
    document.head.appendChild(s);
  });
  return __xlsxP;
}

/* Lazy-load ExcelJS the same way — only the Shortage Remarks download
   needs it, because SheetJS cannot write cell styles (header fill, status
   colours, frozen panes) and that report must match its approved mockup. */
let __exceljsP = null;
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve();
  if (!__exceljsP) __exceljsP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    s.onload = res;
    s.onerror = () => { __exceljsP = null; rej(new Error('Could not load the Excel library. Check your connection and try again.')); };
    document.head.appendChild(s);
  });
  return __exceljsP;
}

/* Universal loading screen: the Shadowfax "orbit" animation. Replaces page
   content while data loads (sidebar + topbar stay visible). Same component on
   every page - universal wording only ("Loading..."), never page-specific. */
function universeLoader() {
  const chip = (n, x, y, d) => `<span class="uic" style="--x:${x};--y:${y};--d:${d}s">${ic(n, 17, 2)}</span>`;
  return `<div class="uload" role="status" aria-label="Loading">
  <div class="ustage">
    <svg class="ur" viewBox="0 0 340 240" aria-hidden="true">
      <ellipse class="uring" cx="170" cy="120" rx="150" ry="80"/>
      <ellipse class="uring" cx="170" cy="120" rx="108" ry="108"/>
      <ellipse class="uring" cx="170" cy="120" rx="162" ry="56"/>
      <circle class="upt" r="3.4" opacity=".9"><animateMotion dur="12s" repeatCount="indefinite" path="M20,120 a150,80 0 1,0 300,0 a150,80 0 1,0 -300,0"/></circle>
      <circle class="upt" r="2.6" opacity=".55"><animateMotion dur="18s" begin="-7s" repeatCount="indefinite" path="M20,120 a150,80 0 1,0 300,0 a150,80 0 1,0 -300,0"/></circle>
      <circle class="upt" r="3" opacity=".75"><animateMotion dur="9s" begin="-3s" repeatCount="indefinite" path="M62,120 a108,108 0 1,0 216,0 a108,108 0 1,0 -216,0"/></circle>
      <circle class="upt" r="2.4" opacity=".5"><animateMotion dur="14s" begin="-5s" repeatCount="indefinite" path="M8,120 a162,56 0 1,0 324,0 a162,56 0 1,0 -324,0"/></circle>
      <circle class="upt" r="2.2" opacity=".65"><animateMotion dur="21s" begin="-12s" repeatCount="indefinite" path="M8,120 a162,56 0 1,0 324,0 a162,56 0 1,0 -324,0"/></circle>
    </svg>
    <div class="ucore">${LOGO(38)}</div>
    ${chip('bars', '9%', '39%', 0)}
    ${chip('gear', '18%', '50%', .8)}
    ${chip('db', '82%', '50%', 1.6)}
    ${chip('file', '86%', '69%', 2.4)}
    ${chip('clip', '34%', '72%', 3.2)}
    ${chip('pie', '66%', '28%', 4)}
  </div>
  <div class="ubar"><i></i></div>
  <div class="utxt">Loading...</div>
</div>`;
}
