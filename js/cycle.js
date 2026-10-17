// Audit cycle controls in the sidebar: pick + Load an existing cycle, create a new one (name only), CLOSE one (admin, any time), delete one PERMANENTLY.
async function loadCycles() {
  let q = await sb.from('audit_cycles').select('id,name,status,created_at,deadline_at').order('created_at', { ascending: false });
  if (q.error && /deadline_at/.test(q.error.message || ''))  // migration 22 not run yet: carry on without deadlines
    q = await sb.from('audit_cycles').select('id,name,status,created_at').order('created_at', { ascending: false });
  if (q.error) throw q.error;
  const data = q.data;
  S.cycles = data || [];
  let id = sessionStorage.getItem('sfx_cycle');
  if (!S.cycles.some(c => c.id === id)) id = (S.cycles.find(c => c.status === 'ACTIVE') || S.cycles[0] || {}).id || null;
  applyCycle(id);
}
function applyCycle(id) {
  S.cycleId = id; const c = S.cycles.find(x => x.id === id); S.cycleName = c ? c.name : ''; S.cycleDeadline = c ? c.deadline_at : null; S.progress = null;
  if (id) sessionStorage.setItem('sfx_cycle', id); else sessionStorage.removeItem('sfx_cycle');
}
// Days left until the cycle deadline (3 days from creation). Negative = overdue.
function deadlineDays() { return S.cycleDeadline == null ? null : Math.ceil((new Date(S.cycleDeadline) - Date.now()) / 864e5); }
function deadlineChip() {
  const d = deadlineDays(); if (d == null) return '';
  const dstr = new Date(S.cycleDeadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  if (d < 0) return `<div class="conn" style="color:#ff6b6b;font-weight:700">Overdue by ${-d} day${-d === 1 ? '' : 's'}</div>`;
  if (d === 0) return `<div class="conn" style="color:#ffb020;font-weight:700">Due today (${dstr})</div>`;
  return `<div class="conn">Due ${dstr} · ${d} day${d === 1 ? '' : 's'} left</div>`;
}
function cycleWidgetHtml() {
  const admin = S.profile.role === 'ADMIN', has = S.cycles.length > 0;
  return `<div class="cyc"><div class="lbl">AUDIT CYCLE</div>
    ${has ? `<select id="cyc-sel">${S.cycles.map(c => `<option value="${c.id}" ${c.id === S.cycleId ? 'selected' : ''}>${esc(c.name)}${c.status === 'ACTIVE' ? '' : ' (closed)'}</option>`).join('')}</select>` : '<div style="font-size:13px;color:#B7D4C6">No audit cycle yet.</div>'}
    <div class="two" ${admin ? '' : 'style="grid-template-columns:1fr"'}>${has ? '<button class="btn" id="cyc-load">Load</button>' : ''}${admin ? `<button class="btn new" id="cyc-new">+ New</button>` : ''}</div>
    ${admin && has ? '<div class="rowb"><button class="btn clo" id="cyc-close">Close cycle</button><button class="btn del" id="cyc-del">Delete cycle</button></div>' : ''}
    ${S.cycleId ? `<div class="conn">Connected to “${esc(S.cycleName)}”</div>${deadlineChip()}<div class="prog"><span>Audit progress</span><b id="cp-pct">…</b></div><div class="bar2"><i id="cp-bar" style="width:0%"></i></div><small id="cp-txt">Loading…</small>` : ''}</div>`;
}
async function refreshProgress() {
  if (!S.cycleId) return;
  const { data } = await sb.rpc('cycle_progress', { p_cycle: S.cycleId });
  const pct = data && data.total ? Math.round(100 * data.completed / data.total) : 0; S.progress = data;
  const a = document.getElementById('cp-pct'), b = document.getElementById('cp-bar'), c = document.getElementById('cp-txt');
  if (a) a.textContent = pct + '%'; if (b) b.style.width = pct + '%';
  if (c) c.textContent = data ? `${data.completed} / ${data.total} stores completed${data.overdue ? ` · ${data.overdue} overdue` : ''}` : '';
}
async function purgeCycleFiles(cycleId) {   // original Excel backups of the cycle's base stock
  try {
    const bucket = sb.storage.from('base-stock-files'), top = await bucket.list(cycleId, { limit: 1000 }), paths = [];
    for (const f of top.data || []) { if (f.id) paths.push(`${cycleId}/${f.name}`); else { const sub = await bucket.list(`${cycleId}/${f.name}`, { limit: 1000 }); (sub.data || []).forEach(x => paths.push(`${cycleId}/${f.name}/${x.name}`)); } }
    for (let i = 0; i < paths.length; i += 100) await bucket.remove(paths.slice(i, i + 100));
  } catch (e) { console.warn('Could not remove some backup files', e); }
}
function wireCycle() {
  const $ = id => document.getElementById(id);
  if ($('cyc-load')) $('cyc-load').onclick = () => { applyCycle($('cyc-sel').value); S.shellUser = null; route(); };
  if ($('cyc-new')) $('cyc-new').onclick = () => openModal('Create new audit cycle', `<p class="muted">Every store takes part. The new cycle becomes the current cycle for all store users, and the previous cycle is closed (its data stays until you delete it).</p>
      <p class="muted">Stores get <b>3 days</b> from creation to complete their audits — the deadline is set automatically.</p>
      <label>Cycle name</label><input id="m_cname" placeholder="e.g. OCT-2026" autocomplete="off">`, [cancelBtn,
      { label: 'Create cycle', cls: 'primary', fn: async () => { const n = document.getElementById('m_cname').value.trim(); if (n.length < 2) { toast('Please enter a cycle name.', 'err'); return false; }
        const { data, error } = await sb.rpc('admin_create_cycle', { p_name: n }); if (error) throw error; await loadCycles(); applyCycle(data); toast('Cycle created.', 'ok'); S.shellUser = null; route(); } }]);
  // Close: admin can end any open cycle at any time (no need to create a new one). Data stays; store users can no longer audit in it.
  const syncClose = () => { const b = $('cyc-close'), sel = $('cyc-sel'); if (!b || !sel) return; const c = S.cycles.find(x => x.id === sel.value), open = !!c && c.status === 'ACTIVE';
    b.disabled = !open; b.title = open ? 'Close this audit cycle' : 'This cycle is already closed'; };
  if ($('cyc-sel')) { $('cyc-sel').addEventListener('change', syncClose); syncClose(); }
  if ($('cyc-close')) $('cyc-close').onclick = () => { const id = $('cyc-sel').value, c = S.cycles.find(x => x.id === id); if (!c) return;
    if (c.status !== 'ACTIVE') { toast('This cycle is already closed.', 'err'); return; }
    const o = openModal('Close this audit cycle?', `<p>You are about to close <b>${esc(c.name)}</b>.</p>
      <p>Store users will no longer be able to start or continue audits in it. Audits already submitted, and all base stock, results and logs, stay exactly as they are and remain viewable.</p>
      <p class="muted">A closed cycle cannot be reopened from the app. Creating a new cycle later does not affect it.</p><label class="chk"><input type="checkbox" id="m_ok"> I understand store users can no longer audit in this cycle.</label>`,
      [cancelBtn, { label: 'Close cycle', cls: 'danger', fn: async () => { const { data, error } = await sb.rpc('admin_close_cycle', { p_cycle: id }); if (error) throw error;
        await loadCycles(); applyCycle(id);
        toast(data && data.audits_in_progress ? `Closed ${data.name}. ${data.audits_in_progress} store audit(s) were still in progress.` : `Closed ${(data && data.name) || c.name}.`, 'ok'); S.shellUser = null; route(); } }]);
    const go = o.querySelector('.ma .danger'); go.disabled = true; o.querySelector('#m_ok').onchange = e => (go.disabled = !e.target.checked); };
  if ($('cyc-del')) $('cyc-del').onclick = () => { const id = $('cyc-sel').value, c = S.cycles.find(x => x.id === id); if (!c) return;
    const o = openModal('Delete audit cycle permanently?', `<p>This permanently deletes <b>${esc(c.name)}</b> and <b>all of its data</b>: base stock for every store, all audits, scanned items, entries and results.</p>
      <p class="muted">There is no archive and it cannot be undone. The audit log keeps a record that the cycle was deleted.</p><label class="chk"><input type="checkbox" id="m_ok"> I understand this cannot be undone.</label>`,
      [cancelBtn, { label: 'Delete permanently', cls: 'danger', fn: async () => { await purgeCycleFiles(id); const { data, error } = await sb.rpc('admin_purge_cycle', { p_cycle: id }); if (error) throw error;
        await loadCycles(); toast(`Deleted ${data.name}: ${data.audits} audit(s), ${data.base_rows} base rows, ${data.result_rows} result rows.`, 'ok'); S.shellUser = null; route(); } }]);
    const go = o.querySelector('.ma .danger'); go.disabled = true; o.querySelector('#m_ok').onchange = e => (go.disabled = !e.target.checked); };
  refreshProgress();
}
