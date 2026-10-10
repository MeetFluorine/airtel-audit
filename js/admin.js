// Phase 2b: Users, Stores, Audit Cycles. All permission checks are enforced by RLS/RPCs; the UI only hides what you can't use.
const one = x => Array.isArray(x) ? x[0] : x;
const tbl = (heads, body) => `<div class="tw"><table class="tbl"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${heads.length}" class="muted c">Nothing to show.</td></tr>`}</tbody></table></div>`;

function reopenModal(sessionId, storeName, done) {
  openModal('Reopen audit for ' + storeName + '?', `<p>The store will be able to add or remove items again. The current result is kept as history and a new version is started with the existing counts.</p>
    <label>Reason (required)</label><textarea id="m_reason" rows="3" placeholder="e.g. 3 cartons found after initial submission."></textarea>`, [cancelBtn,
    { label: 'REOPEN AUDIT', cls: 'danger', fn: async () => { const r = document.getElementById('m_reason').value.trim(); if (r.length < 5) { toast('Please enter a reason (at least 5 characters).', 'err'); return false; }
      const { error } = await sb.rpc('reopen_audit', { p_session: sessionId, p_reason: r }); if (error) throw error; toast('Audit reopened as a new version.', 'ok'); done(); } }]);
}

/* ================= USERS ================= */
PAGES.users = async el => {
  let stores = [], rows = [], filt = 'PENDING', q = '';
  const byId = () => Object.fromEntries(stores.map(s => [s.id, s]));
  async function load() {
    const [s, u, asg] = await Promise.all([getStores(),
      sb.from('profiles').select('id,full_name,employee_id,email,mobile,role,status,requested_store_id,reject_reason,created_at').order('created_at', { ascending: false }).limit(1000),
      sb.from('user_store_assignments').select('user_id,store_id')]);
    if (u.error) throw u.error; if (asg.error) throw asg.error;
    const amap = Object.fromEntries(asg.data.map(x => [x.user_id, x.store_id]));
    stores = s; rows = u.data.map(r => ({ ...r, user_store_assignments: amap[r.id] ? { store_id: amap[r.id] } : null })); draw();
  }
  function rowsHtml() {
    const sid = byId();
    const list = rows.filter(u => (filt === 'ALL' || u.status === filt) && (!q || [u.full_name, u.employee_id, u.email, u.mobile].join(' ').toLowerCase().includes(q)));
    return tbl(['Name', 'Employee ID', 'Email / Mobile', 'Requested store', 'Assigned store', 'Role', 'Status', ''], list.map(u => {
      const a = one(u.user_store_assignments), asg = a ? sid[a.store_id] : null, req = u.requested_store_id ? sid[u.requested_store_id] : null;
      const me = u.id === S.profile.id; let act = '';
      if (!me && u.role === 'STORE_USER') {
        if (u.status === 'PENDING') act = `<button class="btn sm primary-o" data-act="approve" data-id="${u.id}">Approve</button> <button class="btn sm" data-act="reject" data-id="${u.id}">Reject</button>`;
        else if (u.status === 'APPROVED') act = asg ? `<button class="btn sm" data-act="change" data-id="${u.id}">Change store</button>` : `<button class="btn sm primary-o" data-act="approve" data-id="${u.id}">Assign store</button>`;
        else act = `<button class="btn sm" data-act="approve" data-id="${u.id}">Approve</button>`;
      }
      if (!me && isAdmin()) act += ` <button class="btn sm" data-act="role" data-id="${u.id}">Role</button>`;
      return `<tr><td><b>${esc(u.full_name)}</b></td><td>${esc(u.employee_id || '—')}</td><td>${esc(u.email || '')}<br><span class="muted">${esc(u.mobile || '')}</span></td>
        <td>${req ? esc(req.name) + `<br><span class="muted">${esc(req.code)}</span>` : '—'}</td><td>${asg ? esc(asg.name) + `<br><span class="muted">${esc(asg.code)}</span>` : '—'}</td>
        <td>${u.role.replace('_', ' ')}</td><td>${badge(u.status, u.status === 'APPROVED' ? 'ok' : u.status === 'PENDING' ? 'warn' : 'bad')}</td><td class="nw">${act}</td></tr>`;
    }).join(''));
  }
  function draw() {
    const cnt = s => rows.filter(u => u.status === s).length;
    el.innerHTML = `<div class="bar"><div class="tabs">${['PENDING', 'APPROVED', 'REJECTED', 'ALL'].map(t => `<button class="tab ${t === filt ? 'on' : ''}" data-tab="${t}">${t[0] + t.slice(1).toLowerCase()}${t === 'ALL' ? '' : ' (' + cnt(t) + ')'}</button>`).join('')}</div>
      <input id="q" class="srch" placeholder="Search name, employee ID, email, mobile…" value="${esc(q)}"></div><div id="tw">${rowsHtml()}</div>`;
    el.querySelector('#q').oninput = e => { q = e.target.value.trim().toLowerCase(); el.querySelector('#tw').innerHTML = rowsHtml(); };
  }
  el.onclick = async e => {
    const t = e.target.closest('[data-tab]'); if (t) { filt = t.dataset.tab; return draw(); }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const u = rows.find(r => r.id === b.dataset.id), a = one(u.user_store_assignments), cur = a ? a.store_id : u.requested_store_id;
    const pick = `<label>Store</label><select id="m_store"><option value="">Select store…</option>${storeOpts(stores, cur)}</select>`;
    const need = () => { const v = document.getElementById('m_store').value; if (!v) { toast('Please select a store.', 'err'); return null; } return v; };
    if (b.dataset.act === 'approve') openModal(`Approve ${u.full_name}`, `<p class="muted">The user will be able to audit only this store.</p>${pick}`, [cancelBtn,
      { label: 'Approve', cls: 'primary', fn: async () => { const v = need(); if (!v) return false; const { error } = await sb.rpc('approve_user', { p_user: u.id, p_store: v }); if (error) throw error; toast('User approved.', 'ok'); load(); } }]);
    if (b.dataset.act === 'change') openModal(`Change store for ${u.full_name}`, pick, [cancelBtn,
      { label: 'Change store', cls: 'primary', fn: async () => { const v = need(); if (!v) return false; const { error } = await sb.rpc('change_user_store', { p_user: u.id, p_new_store: v }); if (error) throw error; toast('Store changed.', 'ok'); load(); } }]);
    if (b.dataset.act === 'reject') openModal(`Reject ${u.full_name}`, `<label>Reason (shown to the user)</label><textarea id="m_reason" rows="3"></textarea>`, [cancelBtn,
      { label: 'Reject', cls: 'danger', fn: async () => { const { error } = await sb.rpc('reject_user', { p_user: u.id, p_reason: document.getElementById('m_reason').value.trim() || null }); if (error) throw error; toast('Request rejected.', 'ok'); load(); } }]);
    if (b.dataset.act === 'role') {
      const [circles, cur2] = await Promise.all([getCircles(), sb.from('circle_head_assignments').select('circle_id').eq('user_id', u.id)]);
      const has = new Set((cur2.data || []).map(x => x.circle_id));
      const o = openModal(`Role for ${u.full_name}`, `<label>Role</label><select id="m_role">${['STORE_USER', 'CIRCLE_HEAD', 'ADMIN'].map(r => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select>
        <div id="m_ch" ${u.role === 'CIRCLE_HEAD' ? '' : 'hidden'}><label>Circles this Circle Head manages</label><div class="chips">${circles.map(c => `<label class="chk"><input type="checkbox" class="cc" value="${c.id}" ${has.has(c.id) ? 'checked' : ''}> ${esc(c.code)}</label>`).join('')}</div></div>
        <p class="muted">Admins can see everything. Changing a role removes a store assignment or circle list that no longer applies.</p>`, [cancelBtn,
        { label: 'Save role', cls: 'primary', fn: async m => {
          const role = m.querySelector('#m_role').value;
          let r = await sb.rpc('admin_set_role', { p_user: u.id, p_role: role }); if (r.error) throw r.error;
          if (role === 'CIRCLE_HEAD') {
            r = await sb.from('circle_head_assignments').delete().eq('user_id', u.id); if (r.error) throw r.error;
            const ids = [...m.querySelectorAll('.cc:checked')].map(i => i.value);
            if (ids.length) { r = await sb.from('circle_head_assignments').insert(ids.map(c => ({ user_id: u.id, circle_id: c }))); if (r.error) throw r.error; }
          }
          toast('Role updated.', 'ok'); load(); } }]);
      o.querySelector('#m_role').onchange = ev => (o.querySelector('#m_ch').hidden = ev.target.value !== 'CIRCLE_HEAD');
    }
  };
  await load();
};

/* ================= STORES ================= */
PAGES.stores = async el => {
  let stores = [], circles = [], q = '', cf = '';
  async function load() { [stores, circles] = await Promise.all([getStores(), getCircles()]); draw(); }
  const rowsHtml = () => {
    const l = stores.filter(s => (!cf || s.circle_id === cf) && (!q || [s.code, s.name, s.report_name || ''].join(' ').toLowerCase().includes(q)));
    return tbl(['Store code', 'Name', 'Circle', 'Report name', 'Status', ''], l.map(s => `<tr><td><b>${esc(s.code)}</b></td><td>${esc(s.name)}</td><td>${esc(s.circles?.code || '')}</td>
      <td>${s.report_name ? esc(s.report_name) : '<span class="muted">not set</span>'}</td><td>${badge(s.active ? 'Active' : 'Inactive', s.active ? 'ok' : 'bad')}</td>
      <td>${isAdmin() ? `<button class="btn sm" data-act="edit" data-id="${s.id}">Edit</button>` : ''}</td></tr>`).join(''));
  };
  function draw() {
    el.innerHTML = `${isAdmin() ? `<div class="card sec"><div class="bar"><b>Circles</b><button class="btn sm" data-act="addc">+ Add circle</button></div>
        <div class="chips">${circles.map(c => `<button class="chip2" data-act="editc" data-id="${c.id}" title="Edit name">${esc(c.code)} <span class="muted">${esc(c.name)}</span></button>`).join('')}</div></div>` : ''}
      <div class="bar"><div class="row"><input id="q" class="srch" placeholder="Search store…" value="${esc(q)}">
        <select id="cf"><option value="">All circles</option>${circles.map(c => `<option value="${c.id}" ${c.id === cf ? 'selected' : ''}>${esc(c.code)}</option>`).join('')}</select></div>
        ${isAdmin() ? '<button class="btn primary-o" data-act="add">+ Add store</button>' : ''}</div><div id="tw">${rowsHtml()}</div>`;
    el.querySelector('#q').oninput = e => { q = e.target.value.trim().toLowerCase(); el.querySelector('#tw').innerHTML = rowsHtml(); };
    el.querySelector('#cf').onchange = e => { cf = e.target.value; el.querySelector('#tw').innerHTML = rowsHtml(); };
  }
  const storeForm = s => `<label>Store code ${s ? '' : '(exactly as in your records)'}</label><input id="f_code" value="${esc(s?.code || '')}" ${s ? 'disabled' : ''}>
    <label>Display name</label><input id="f_name" value="${esc(s?.name || '')}"><label>Circle</label><select id="f_circle"><option value="">Select circle…</option>${circles.map(c => `<option value="${c.id}" ${s?.circle_id === c.id ? 'selected' : ''}>${esc(c.code)} - ${esc(c.name)}</option>`).join('')}</select>
    <label>Name in the stock report (optional)</label><input id="f_rep" value="${esc(s?.report_name || '')}" placeholder="Substore_Name as it appears in the Excel">
    ${s ? `<label class="chk"><input type="checkbox" id="f_act" ${s.active ? 'checked' : ''}> Active (shown in signup)</label>` : ''}`;
  const g = id => document.getElementById(id).value.trim();
  el.onclick = e => {
    const b = e.target.closest('[data-act]'); if (!b || !isAdmin()) return;
    const act = b.dataset.act, s = stores.find(x => x.id === b.dataset.id), c = circles.find(x => x.id === b.dataset.id);
    if (act === 'add' || act === 'edit') openModal(s ? 'Edit store' : 'Add store', storeForm(s), [cancelBtn, { label: 'Save', cls: 'primary', fn: async () => {
      if (!g('f_name') || !g('f_circle') || (!s && !g('f_code'))) { toast('Code, name and circle are required.', 'err'); return false; }
      const row = { name: g('f_name'), circle_id: g('f_circle'), report_name: g('f_rep') || null };
      const r = s ? await sb.from('stores').update({ ...row, active: document.getElementById('f_act').checked }).eq('id', s.id) : await sb.from('stores').insert({ ...row, code: g('f_code') });
      if (r.error) throw r.error; toast('Store saved.', 'ok'); load(); } }]);
    if (act === 'addc' || act === 'editc') openModal(c ? 'Edit circle' : 'Add circle', `<label>Circle code</label><input id="c_code" value="${esc(c?.code || '')}" ${c ? 'disabled' : ''}><label>Circle name</label><input id="c_name" value="${esc(c?.name || '')}">`,
      [cancelBtn, { label: 'Save', cls: 'primary', fn: async () => {
        if (!g('c_name') || (!c && !g('c_code'))) { toast('Code and name are required.', 'err'); return false; }
        const r = c ? await sb.from('circles').update({ name: g('c_name') }).eq('id', c.id) : await sb.from('circles').insert({ code: g('c_code').toUpperCase(), name: g('c_name') });
        if (r.error) throw r.error; toast('Circle saved.', 'ok'); load(); } }]);
  };
  await load();
};

/* ================= AUDIT CYCLES (name only - every active store takes part) ================= */
PAGES.cycles = async el => {
  const stores = (await getStores()).filter(s => s.active);
  const stBadge = s => badge(s, { ACTIVE: 'ok', DRAFT: 'warn', COMPLETED: 'info', ARCHIVED: '' }[s]);
  const askDelete = (id, name, done) => openModal('Delete audit cycle?', `<p>Delete <b>${esc(name)}</b> and all base stock uploaded for it?</p><p class="muted">This is only possible before any store has started its audit.</p>`,
    [cancelBtn, { label: 'Delete cycle', cls: 'danger', fn: async () => { const { error } = await sb.rpc('admin_delete_cycle', { p_cycle: id }); if (error) throw error; toast('Cycle deleted.', 'ok'); done(); } }]);

  async function list() {
    el.onclick = listClick;
    const { data, error } = await sb.from('audit_cycles').select('id,name,status,created_at,audit_cycle_stores(active_upload_id)').order('created_at', { ascending: false });
    if (error) throw error;
    el.innerHTML = (isAdmin() ? `<div class="card sec"><b>Create a new audit cycle</b><div class="row" style="margin-top:8px"><div><input id="n_name" placeholder="Cycle name, e.g. OCT-2026"></div>
        <button class="btn primary-o" data-act="new">Create cycle</button></div><p class="muted">Every active store takes part in every cycle. Next, upload each store's base stock from the Base Stock page.</p></div>` : '') +
      tbl(['Cycle', 'Created', 'Status', 'Base stock frozen', ''], data.map(c => { const fz = (c.audit_cycle_stores || []).filter(x => x.active_upload_id).length;
        return `<tr><td><b>${esc(c.name)}</b></td><td>${fdate(c.created_at)}</td><td>${stBadge(c.status)}</td><td>${fz} / ${stores.length} stores</td>
          <td class="nw"><button class="btn sm" data-act="open" data-id="${c.id}">Open</button>${isAdmin() ? ` <button class="btn sm danger-o" data-act="del" data-id="${c.id}" data-name="${esc(c.name)}">Delete</button>` : ''}</td></tr>`; }).join(''));
  }
  async function detail(id) {
    const [c, a, ss] = await Promise.all([sb.from('audit_cycles').select('id,name,status').eq('id', id).single(), sb.from('audit_cycle_stores').select('store_id,active_upload_id,frozen_at').eq('audit_cycle_id', id),
      sb.from('audit_sessions').select('id,store_id,version,status,submitted_at,reopened_at,reopen_reason').eq('audit_cycle_id', id).order('version')]);
    if (c.error) throw c.error; if (a.error) throw a.error; if (ss.error) throw ss.error;
    const cy = c.data, fz = Object.fromEntries(a.data.filter(x => x.active_upload_id).map(x => [x.store_id, x]));
    const by = {}; ss.data.forEach(x => (by[x.store_id] = by[x.store_id] || []).push(x));
    const latest = sid => (by[sid] || []).slice(-1)[0] || null;
    el.innerHTML = `<div class="bar"><button class="btn sm" data-act="back">← All cycles</button><div>${stBadge(cy.status)} <b>${esc(cy.name)}</b> <span class="muted">${Object.keys(fz).length} / ${stores.length} stores frozen</span></div></div>
      ${isAdmin() ? `<div class="card sec"><div class="row"><div><label>Status</label><select id="st">${['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'].map(s => `<option ${s === cy.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <button class="btn sm" data-act="setst">Update status</button><button class="btn sm danger-o" data-act="delc">Delete cycle</button></div>
        <p class="muted">Store users see a cycle once it is ACTIVE and their store's base stock is frozen.</p></div>` : ''}` +
      tbl(['Store', 'Circle', 'Base stock', 'Audit', ''], stores.map(s => { const L = latest(s.id);
        const au = !L ? badge('Not started') : L.status === 'IN_PROGRESS' ? badge('In progress · v' + L.version, 'info') : badge('Locked · v' + L.version + ' · ' + fdate(L.submitted_at), 'ok');
        return `<tr><td><b>${esc(s.name)}</b> <span class="muted">${esc(s.code)}</span></td><td>${esc(s.circles?.code || '')}</td>
          <td>${fz[s.id] ? badge('✓ Frozen', 'ok') + ' <span class="muted">' + fdate(fz[s.id].frozen_at) + '</span>' : badge('Not uploaded', 'warn')}</td><td>${au}</td>
          <td class="nw"><a class="btn sm" href="#/basestock?c=${cy.id}&s=${s.id}">${fz[s.id] ? 'Revise base' : 'Upload base'}</a>
            ${L && L.status === 'LOCKED' ? ` <a class="btn sm" href="#/result?sess=${L.id}">View result</a> <button class="btn sm danger-o" data-act="reopen" data-id="${L.id}" data-n="${esc(s.name)}">Reopen</button>` : ''}
            ${by[s.id] ? ` <button class="btn sm" data-act="hist" data-s="${s.id}" data-n="${esc(s.name)}">History</button>` : ''}</td></tr>`; }).join(''));
    el.onclick = async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'back') return list();
      if (b.dataset.act === 'delc') return askDelete(id, cy.name, list);
      if (b.dataset.act === 'setst') { const { error } = await sb.from('audit_cycles').update({ status: el.querySelector('#st').value }).eq('id', id); if (error) return toast(rpcMsg(error), 'err'); toast('Status updated.', 'ok'); detail(id); }
      if (b.dataset.act === 'reopen') reopenModal(b.dataset.id, b.dataset.n, () => detail(id));
      if (b.dataset.act === 'hist') openModal('Audit history · ' + b.dataset.n, (by[b.dataset.s] || []).map(v => `<div class="hist"><b>Version ${v.version}</b>
        ${v.reopened_at ? `<br>Reopened: ${fdt(v.reopened_at)}<br>Reason: “${esc(v.reopen_reason)}”` : ''}<br>${v.submitted_at ? 'Submitted: ' + fdt(v.submitted_at) : 'In progress (not yet submitted)'}</div>`).join(''), [{ label: 'Close' }]);
    };
  }
  function listClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return; const act = b.dataset.act;
    if (act === 'open') return detail(b.dataset.id);
    if (act === 'del') return askDelete(b.dataset.id, b.dataset.name, list);
    if (act === 'new') {
      const name = el.querySelector('#n_name').value.trim(); if (!name) return toast('Please enter a cycle name.', 'err');
      busy(b, async () => { const { data, error } = await sb.from('audit_cycles').insert({ name, status: 'ACTIVE' }).select('id').single(); if (error) throw error; toast('Cycle created.', 'ok'); await detail(data.id); }).catch(x => toast(rpcMsg(x), 'err'));
    }
  }
  await list();
};
