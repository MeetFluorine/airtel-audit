// Admin / circle head: Stores and Users pages (+ shared helpers). Permissions are enforced by RLS / server functions; the UI only hides what you can't use.
const one = x => Array.isArray(x) ? x[0] : x;
const tbl = (heads, body) => `<div class="tw"><table class="tbl"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${heads.length}" class="muted c">Nothing to show.</td></tr>`}</tbody></table></div>`;
const sel2 = (id, label, opts, cur) => `<div><label>${label}</label><select id="${id}">${opts.map(o => `<option value="${o[0]}" ${o[0] === cur ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>`;

function reopenModal(sessionId, storeName, done) {
  openModal('Reopen audit for ' + storeName + '?', `<p>The store will be able to add or remove items again. The current result is kept as history and a new version is started with the existing counts.</p>
    <label>Reason (required)</label><textarea id="m_reason" rows="3" placeholder="e.g. 3 cartons found after initial submission."></textarea>`, [cancelBtn,
    { label: 'REOPEN AUDIT', cls: 'danger', fn: async () => { const r = document.getElementById('m_reason').value.trim(); if (r.length < 5) { toast('Please enter a reason (at least 5 characters).', 'err'); return false; }
      const { error } = await sb.rpc('reopen_audit', { p_session: sessionId, p_reason: r }); if (error) throw error; toast('Audit reopened as a new version.', 'ok'); done(); } }]);
}

/* ================= STORES ================= */
PAGES.stores = async el => {
  let stores = [], circles = [], asg = {}; const F = { circle: '', type: '', status: '', q: '', page: 0 }, PS = 10;
  async function load() {
    [stores, circles] = await Promise.all([getStores(), getCircles()]);
    const [a, p] = await Promise.all([sb.from('user_store_assignments').select('user_id,store_id'), sb.from('profiles').select('id,full_name').eq('role', 'STORE_USER')]);
    const nm = Object.fromEntries((p.data || []).map(x => [x.id, x.full_name])); asg = {};
    (a.data || []).forEach(x => { if (nm[x.user_id]) (asg[x.store_id] = asg[x.store_id] || []).push(nm[x.user_id]); }); draw();
  }
  const list = () => stores.filter(s => (!F.circle || s.circle_id === F.circle) && (!F.type || s.store_type === F.type) && (!F.status || (F.status === 'A') === !!s.active) && (!F.q || [s.code, s.name, s.locator || ''].join(' ').toLowerCase().includes(F.q)));
  function table() {
    const l = list();
    return tbl(['Store Name', 'Locator', 'Circle', 'Store Type', 'Status', 'Assigned User', 'Action'], l.slice(F.page * PS, F.page * PS + PS).map(s => `<tr><td><b>${esc(s.code)}</b><br><span class="muted">${esc(s.name)}</span></td><td>${esc(s.locator || '—')}</td><td>${esc(s.circles?.code || '')}</td><td>${esc(s.store_type || '—')}</td>
      <td>${badge(s.active ? 'Active' : 'Inactive', s.active ? 'ok' : 'bad')}</td><td>${esc((asg[s.id] || []).join(', ') || '—')}</td><td>${isAdmin() ? `<button class="eyeb" data-act="edit" data-id="${s.id}" title="Edit store">${ic('edit', 16)}</button>` : `<a class="eyeb" href="#/storedetail?s=${s.id}" title="View store">${ic('eye', 16)}</a>`}</td></tr>`).join('')) + numPager(l.length, F.page, PS);
  }
  function draw() {
    el.innerHTML = `<div class="filters" style="justify-content:flex-end">${isAdmin() ? `<button class="btn" data-act="circles">${ic('grid', 16)} Manage Circles</button><button class="btn yel" data-act="add">${ic('plus', 16)} Add Store</button>` : ''}</div>
      <div class="card" style="padding:16px"><div class="filters">${sel2('f_ci', 'Circle', [['', 'All Circles'], ...circles.map(c => [c.id, c.code])], F.circle)}${sel2('f_ty', 'Store Type', [['', 'All Types'], ['Exclusive', 'Exclusive'], ['Shared', 'Shared']], F.type)}${sel2('f_st', 'Status', [['', 'All Status'], ['A', 'Active'], ['I', 'Inactive']], F.status)}
        <div style="flex:1;min-width:220px"><label>Search</label><div class="inp">${ic('search', 18)}<input id="f_q" placeholder="Search store name or locator..." value="${esc(F.q)}"></div></div></div><div id="tbl">${table()}</div></div>`;
  }
  const redraw = () => { const w = el.querySelector('#tbl'); if (w) w.innerHTML = table(); };
  const g = id => document.getElementById(id).value.trim();
  const storeForm = s => `<label>Store code ${s ? '' : '(exactly as in your records)'}</label><input id="f_code" value="${esc(s?.code || '')}" ${s ? 'disabled' : ''}><label>Display name</label><input id="f_name" value="${esc(s?.name || '')}">
    <div class="row"><div><label>Locator</label><input id="f_loc" value="${esc(s?.locator || '')}" placeholder="e.g. SFX_JDP"></div><div><label>Store type</label><select id="f_typ"><option value="">—</option>${['Exclusive', 'Shared'].map(t => `<option ${s?.store_type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <label>Circle</label><select id="f_circle"><option value="">Select circle…</option>${circles.map(c => `<option value="${c.id}" ${s?.circle_id === c.id ? 'selected' : ''}>${esc(c.code)} - ${esc(c.name)}</option>`).join('')}</select>
    <label>Name in the stock report (optional)</label><input id="f_rep" value="${esc(s?.report_name || '')}" placeholder="Substore_Name as it appears in the Excel">${s ? `<label class="chk"><input type="checkbox" id="f_act" ${s.active ? 'checked' : ''}> Active (shown in signup)</label>` : ''}`;
  el.onchange = e => { const m = { f_ci: 'circle', f_ty: 'type', f_st: 'status' }[e.target.id]; if (m) { F[m] = e.target.value; F.page = 0; redraw(); } };
  el.oninput = e => { if (e.target.id === 'f_q') { F.q = e.target.value.trim().toLowerCase(); F.page = 0; redraw(); } };
  el.onclick = e => {
    const p = e.target.closest('[data-np]'); if (p) { F.page = Number(p.dataset.np); return redraw(); }
    const b = e.target.closest('[data-act]'); if (!b || !isAdmin()) return; const act = b.dataset.act, s = stores.find(x => x.id === b.dataset.id), c = circles.find(x => x.id === b.dataset.id);
    if (act === 'add' || act === 'edit') openModal(s ? 'Edit store' : 'Add store', storeForm(s), [cancelBtn, { label: 'Save', cls: 'yel', fn: async () => {
      if (!g('f_name') || !g('f_circle') || (!s && !g('f_code'))) { toast('Code, name and circle are required.', 'err'); return false; }
      const row = { name: g('f_name'), circle_id: g('f_circle'), report_name: g('f_rep') || null, locator: g('f_loc') || null, store_type: g('f_typ') || null };
      const r = s ? await sb.from('stores').update({ ...row, active: document.getElementById('f_act').checked }).eq('id', s.id) : await sb.from('stores').insert({ ...row, code: g('f_code') });
      if (r.error) throw r.error; toast('Store saved.', 'ok'); load(); } }]);
    if (act === 'circles') { const o = openModal('Circles', `<div class="chips">${circles.map(x => `<button class="chip2" data-cedit="${x.id}">${esc(x.code)} <span class="muted">${esc(x.name)}</span></button>`).join('')}</div><p class="muted">Tap a circle to rename it.</p>`, [{ label: 'Close' }, { label: '+ Add circle', cls: 'yel', fn: () => { setTimeout(() => circleForm(null), 0); } }]);
      o.onclick = ev => { const x = ev.target.closest('[data-cedit]'); if (x) { const c2 = circles.find(y => y.id === x.dataset.cedit); closeModal(); setTimeout(() => circleForm(c2), 0); } }; }
  };
  function circleForm(c) {
    openModal(c ? 'Edit circle' : 'Add circle', `<label>Circle code</label><input id="c_code" value="${esc(c?.code || '')}" ${c ? 'disabled' : ''}><label>Circle name</label><input id="c_name" value="${esc(c?.name || '')}">`, [cancelBtn, { label: 'Save', cls: 'yel', fn: async () => {
      if (!g('c_name') || (!c && !g('c_code'))) { toast('Code and name are required.', 'err'); return false; }
      const r = c ? await sb.from('circles').update({ name: g('c_name') }).eq('id', c.id) : await sb.from('circles').insert({ code: g('c_code').toUpperCase(), name: g('c_name') });
      if (r.error) throw r.error; toast('Circle saved.', 'ok'); load(); } }]);
  }
  await load();
};

/* ================= USERS ================= */
PAGES.users = async el => {
  let stores = [], circles = [], rows = [], cha = {}, asg = {}; const F = { role: '', status: '', circle: '', q: '', page: 0 }, PS = 10;
  const ST = { APPROVED: ['Active', 'ok'], PENDING: ['Pending', 'warn'], REJECTED: ['Rejected', 'bad'] };
  const byId = () => Object.fromEntries(stores.map(s => [s.id, s]));
  async function load() {
    const [s, c, u, a, h] = await Promise.all([getStores(), getCircles(),
      sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(1000),
      sb.from('user_store_assignments').select('user_id,store_id'), sb.from('circle_head_assignments').select('user_id,circle_id')]);
    if (u.error) throw u.error; stores = s; circles = c; rows = u.data; asg = Object.fromEntries((a.data || []).map(x => [x.user_id, x.store_id]));
    cha = {}; (h.data || []).forEach(x => (cha[x.user_id] = cha[x.user_id] || []).push(x.circle_id));
    if (!F.status && !F.touched) F.status = rows.some(r => r.status === 'PENDING') ? 'PENDING' : ''; draw();
  }
  const rq = u => !!u.requested_role && u.status !== 'APPROVED';            // a management (Circle Head / Admin) request that is not approved yet
  const effRole = u => rq(u) ? u.requested_role : u.role;
  const circleOf = u => { const sid = byId(); if (rq(u)) return u.requested_role === 'ADMIN' ? '—' : ((u.requested_circles || []).join(', ') || '—'); if (u.role === 'ADMIN') return 'All'; if (u.role === 'CIRCLE_HEAD') return (cha[u.id] || []).map(i => (circles.find(c => c.id === i) || {}).code).filter(Boolean).join(', ') || '—'; const st = sid[asg[u.id] || u.requested_store_id]; return st ? (st.circles?.code || '—') : '—'; };
  const list = () => { const sid = byId(); return rows.filter(u => (!F.role || effRole(u) === F.role) && (!F.status || u.status === F.status) && (!F.circle || (rq(u) ? (u.requested_circles || []).includes((circles.find(c => c.id === F.circle) || {}).code) : u.role === 'STORE_USER' ? (sid[asg[u.id] || u.requested_store_id] || {}).circle_id === F.circle : u.role === 'CIRCLE_HEAD' ? (cha[u.id] || []).includes(F.circle) : false))
    && (!F.q || [u.full_name, u.employee_id, u.email, u.mobile].join(' ').toLowerCase().includes(F.q))); };
  function table() {
    const sid = byId(), l = list();
    return tbl(['Full Name', 'Employee ID', 'Email', 'Role', 'Circle', 'Assigned Stores', 'Status', 'Action'], l.slice(F.page * PS, F.page * PS + PS).map(u => { const st = ST[u.status] || [u.status, ''], as = sid[asg[u.id]], req = u.requested_store_id ? sid[u.requested_store_id] : null, me = u.id === S.profile.id; let act = '';
      if (!me && rq(u)) { if (isAdmin()) act = `<button class="btn sm yel" data-act="mapprove" data-id="${u.id}">Approve</button>` + (u.status === 'PENDING' ? ` <button class="btn sm" data-act="reject" data-id="${u.id}">Reject</button>` : ''); }
      else if (!me && u.role === 'STORE_USER') {
        if (u.status === 'PENDING') act = `<button class="btn sm yel" data-act="approve" data-id="${u.id}">Approve</button> <button class="btn sm" data-act="reject" data-id="${u.id}">Reject</button>`;
        else if (u.status === 'APPROVED') act = as ? `<button class="btn sm" data-act="change" data-id="${u.id}">Change store</button>` : `<button class="btn sm yel" data-act="approve" data-id="${u.id}">Assign store</button>`;
        else act = `<button class="btn sm" data-act="approve" data-id="${u.id}">Approve</button>`; }
      if (!me && isAdmin() && !rq(u)) act += ` <button class="btn sm" data-act="role" data-id="${u.id}">Role</button>`;
      if (!me) act += ` <button class="btn sm danger-o" data-act="delete" data-id="${u.id}">Delete</button>`;
      return `<tr><td><b>${esc(u.full_name)}</b></td><td>${esc(u.employee_id || '—')}</td><td>${esc(u.email || '')}<br><span class="muted">${esc(u.mobile || '')}</span></td><td>${effRole(u).replace('_', ' ')}${rq(u) ? ' <span class="muted">(requested)</span>' : ''}</td><td>${esc(circleOf(u))}</td>
        <td>${as ? esc(as.code) : (req && u.status === 'PENDING' ? `<span class="muted">requested: ${esc(req.code)}</span>` : '—')}</td><td>${badge(st[0], st[1])}</td><td class="nw">${act}</td></tr>`; }).join('')) + numPager(l.length, F.page, PS);
  }
  function draw() {
    const pend = rows.filter(r => r.status === 'PENDING').length;
    el.innerHTML = `<div class="filters" style="justify-content:flex-end"><button class="btn yel" data-act="invite">${ic('plus', 16)} Add User</button></div>
      ${pend ? `<div class="alert warn">${pend} registration request${pend === 1 ? ' is' : 's are'} waiting for approval.</div>` : ''}
      <div class="card" style="padding:16px"><div class="filters">${sel2('f_ro', 'Role', [['', 'All Roles'], ['STORE_USER', 'Store User'], ['CIRCLE_HEAD', 'Circle Head'], ['ADMIN', 'Admin']], F.role)}${sel2('f_st', 'Status', [['', 'All Status'], ['PENDING', 'Pending'], ['APPROVED', 'Active'], ['REJECTED', 'Rejected']], F.status)}
        ${sel2('f_ci', 'Circle', [['', 'All Circles'], ...circles.map(c => [c.id, c.code])], F.circle)}<div style="flex:1;min-width:220px"><label>Search</label><div class="inp">${ic('search', 18)}<input id="f_q" placeholder="Search name, email or employee ID..." value="${esc(F.q)}"></div></div></div><div id="tbl">${table()}</div></div>`;
  }
  const redraw = () => { const w = el.querySelector('#tbl'); if (w) w.innerHTML = table(); };
  el.onchange = e => { const m = { f_ro: 'role', f_st: 'status', f_ci: 'circle' }[e.target.id]; if (m) { F[m] = e.target.value; F.touched = true; F.page = 0; redraw(); } };
  el.oninput = e => { if (e.target.id === 'f_q') { F.q = e.target.value.trim().toLowerCase(); F.page = 0; redraw(); } };
  el.onclick = async e => {
    const np = e.target.closest('[data-np]'); if (np) { F.page = Number(np.dataset.np); return redraw(); }
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'invite') { const link = location.origin + location.pathname + '#/signup';
      return openModal('Add a user', `<p>New users register themselves, then you approve them here and assign their store.</p><label>Registration link</label><div class="row"><div><input id="m_link" value="${esc(link)}" readonly></div><button class="btn" id="m_copy" type="button">Copy</button></div>
        <p class="muted">The link lets them choose <b>Store Level</b> or <b>Management Level</b> (Circle Head / Admin). Management requests are approved by an administrator on this page.</p>`, [{ label: 'Close' }]).querySelector('#m_copy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(link); toast('Link copied.', 'ok'); }; }
    const u = rows.find(r => r.id === b.dataset.id); if (!u) return; const cur = asg[u.id] || u.requested_store_id;
    if (b.dataset.act === 'delete') return askDeleteAccount({ title: `Delete ${u.full_name}?`, lead: `This permanently deletes the ${u.role.replace('_', ' ').toLowerCase()} account of <b>${esc(u.full_name)}</b>.`,
      bullets: ['Their login is removed. They cannot sign in again (they would have to register again).', 'Their name, email, mobile number and employee ID are erased and their store / circle assignment is removed.',
        'Audit records they created are kept, but show <b>Deleted user</b>.'],
      run: async txt => { const { error } = await sb.rpc('admin_delete_user', { p_user: u.id, p_confirm: txt }); if (error) throw error; toast('User deleted.', 'ok'); load(); } });
    if (b.dataset.act === 'mapprove') {
      const want = new Set(u.requested_circles || []), isA = u.requested_role === 'ADMIN';
      const o = openModal(`Approve ${u.full_name}`, `<label>Role</label><select id="m_role">${['CIRCLE_HEAD', 'ADMIN'].map(r => `<option value="${r}" ${r === u.requested_role ? 'selected' : ''}>${r.replace('_', ' ')}</option>`).join('')}</select>
        <div id="m_ch" ${isA ? 'hidden' : ''}><label>Circles this Circle Head manages</label><div class="chips">${circles.map(c => `<label class="chk"><input type="checkbox" class="cc" value="${c.id}" ${want.has(c.code) ? 'checked' : ''}> ${esc(c.code)}</label>`).join('')}</div></div>
        <div id="m_warn" class="alert warn" ${isA ? '' : 'hidden'} style="margin-top:12px">Admins can see and change everything, including users and audits. Approve only if you know this person.</div>`, [cancelBtn,
        { label: 'Approve', cls: 'yel', fn: async m => { const role = m.querySelector('#m_role').value, ids = [...m.querySelectorAll('.cc:checked')].map(i => i.value);
          if (role === 'CIRCLE_HEAD' && !ids.length) { toast('Select at least one circle.', 'err'); return false; }
          const { error } = await sb.rpc('admin_approve_management', { p_user: u.id, p_role: role, p_circles: role === 'CIRCLE_HEAD' ? ids : [] }); if (error) throw error; toast('User approved.', 'ok'); load(); } }]);
      return o.querySelector('#m_role').onchange = ev => { o.querySelector('#m_ch').hidden = ev.target.value !== 'CIRCLE_HEAD'; o.querySelector('#m_warn').hidden = ev.target.value !== 'ADMIN'; };
    }
    const pick = `<label>Store</label><select id="m_store"><option value="">Select store…</option>${storeOpts(stores, cur)}</select>`;
    const need = () => { const v = document.getElementById('m_store').value; if (!v) { toast('Please select a store.', 'err'); return null; } return v; };
    if (b.dataset.act === 'approve') openModal(`Approve ${u.full_name}`, `<p class="muted">The user will be able to audit only this store.</p>${pick}`, [cancelBtn,
      { label: 'Approve', cls: 'yel', fn: async () => { const v = need(); if (!v) return false; const { error } = await sb.rpc('approve_user', { p_user: u.id, p_store: v }); if (error) throw error; toast('User approved.', 'ok'); load(); } }]);
    if (b.dataset.act === 'change') openModal(`Change store for ${u.full_name}`, pick, [cancelBtn,
      { label: 'Change store', cls: 'yel', fn: async () => { const v = need(); if (!v) return false; const { error } = await sb.rpc('change_user_store', { p_user: u.id, p_new_store: v }); if (error) throw error; toast('Store changed.', 'ok'); load(); } }]);
    if (b.dataset.act === 'reject') openModal(`Reject ${u.full_name}`, `<label>Reason (shown to the user)</label><textarea id="m_reason" rows="3"></textarea>`, [cancelBtn,
      { label: 'Reject', cls: 'danger', fn: async () => { const { error } = await sb.rpc('reject_user', { p_user: u.id, p_reason: document.getElementById('m_reason').value.trim() || null }); if (error) throw error; toast('Request rejected.', 'ok'); load(); } }]);
    if (b.dataset.act === 'role') {
      const has = new Set(cha[u.id] || []);
      const o = openModal(`Role for ${u.full_name}`, `<label>Role</label><select id="m_role">${['STORE_USER', 'CIRCLE_HEAD', 'ADMIN'].map(r => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select>
        <div id="m_ch" ${u.role === 'CIRCLE_HEAD' ? '' : 'hidden'}><label>Circles this Circle Head manages</label><div class="chips">${circles.map(c => `<label class="chk"><input type="checkbox" class="cc" value="${c.id}" ${has.has(c.id) ? 'checked' : ''}> ${esc(c.code)}</label>`).join('')}</div></div>
        <p class="muted">Admins can see everything. Changing a role removes a store assignment or circle list that no longer applies.</p>`, [cancelBtn,
        { label: 'Save role', cls: 'yel', fn: async m => {
          const role = m.querySelector('#m_role').value; let r = await sb.rpc('admin_set_role', { p_user: u.id, p_role: role }); if (r.error) throw r.error;
          if (role === 'CIRCLE_HEAD') { r = await sb.from('circle_head_assignments').delete().eq('user_id', u.id); if (r.error) throw r.error;
            const ids = [...m.querySelectorAll('.cc:checked')].map(i => i.value); if (ids.length) { r = await sb.from('circle_head_assignments').insert(ids.map(c => ({ user_id: u.id, circle_id: c }))); if (r.error) throw r.error; } }
          toast('Role updated.', 'ok'); load(); } }]);
      o.querySelector('#m_role').onchange = ev => (o.querySelector('#m_ch').hidden = ev.target.value !== 'CIRCLE_HEAD');
    }
  };
  await load();
};
