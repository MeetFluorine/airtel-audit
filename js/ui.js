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
  const { data, error } = await sb.from('stores').select('id,code,name,report_name,active,circle_id,circles(code,name)').order('code');
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
