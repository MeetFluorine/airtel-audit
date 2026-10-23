/* Shortage Review module (database/32 + 34): four tabs in one workflow -
   Overview (stores with pending revision) | Remarks (admin-managed categories) |
   Validation Rules (the checklist) | Shortage Review (per-store remark review).
   Only ACCEPTED quantities stop counting as genuine shortage; ranking reads the
   same numbers live. Reviewed work leaves the working lists (spec: remaining only). */
PAGES.review = async el => {
  const admin = isAdmin();
  if (!S.cycleId) { noCycle(el); return; }
  let tab = 'overview', dbOk = true, cats = [], stores = [], sel = null, catQ = '', showRevGrp = false;
  const ovf = { q: '', circle: '', status: 'PENDING', page: 0, ps: 10 };
  const entCache = {}, entOpen = new Set(), fetchingEnt = new Set(), showRevEnt = new Set(), checked = new Set();
  const gkey = (sid, cid) => sid + '|' + (cid || 'none');
  const stOf = s => Number(s.pending_entries) > 0 ? 'PENDING' : Number(s.entries) > 0 ? 'REVIEWED' : 'NONE';
  const storeBy = sid => stores.find(s => s.session_id === sid);

  async function loadCats() { const r = await sb.rpc('remark_categories_list'); if (!r.error) cats = r.data || []; }
  async function loadQueue() { const r = await sb.rpc('review_queue', { p_cycle: S.cycleId }); if (r.error) { dbOk = false; stores = []; } else stores = (r.data && r.data.stores) || []; }
  await Promise.all([loadCats(), loadQueue()]);
  if (!dbOk) { el.innerHTML = '<div class="alert warn">Shortage revision is not switched on yet — run <b>database/32_shortage_revision.sql</b> in Supabase first, then reload this page.</div>'; return; }
  cats.sort((a, b) => (a.sort || 0) - (b.sort || 0));

  const statusChip = s => stOf(s) === 'PENDING' ? `<span class="rchip pen">${s.pending_entries} pending</span>` : stOf(s) === 'REVIEWED' ? '<span class="rchip acc">Reviewed ✓</span>' : '<span class="rchip cat">No remarks</span>';

  function entriesHtml(sid, cid) {
    const key = gkey(sid, cid), all = (entCache[key] || []).filter(e => (e.category_id || null) === (cid || null));
    const pend = all.filter(e => e.status !== 'REVIEWED');
    const showRev = showRevEnt.has(key) || !pend.length;
    const list = showRev ? all : pend;
    if (!entCache[key]) return '<div class="muted" style="padding:6px 2px">Loading entries…</div>';
    if (!list.length) return '<div class="muted" style="padding:6px 2px">No entries in this group.</div>';
    const rows = list.map(e => {
      const rv = e.status === 'REVIEWED';
      return `<tr>
      <td>${rv ? '' : `<input type="checkbox" data-eck="${e.id}" ${checked.has(e.id) ? 'checked' : ''}>`}</td>
      <td><b>${esc(e.item_code)}</b><div class="muted">${esc(e.inventory_status || '')}${e.item_quality ? ' · ' + esc(e.item_quality) : ''}</div></td>
      <td>${e.item_sno ? esc(e.item_sno) : 'Qty ' + fn(e.qty)}</td>
      <td>${esc(e.reference || '—')}</td><td>${esc(e.remark || '—')}</td>
      <td>${rv ? (Number(e.accepted_qty) > 0 ? '<span class="rchip acc">Accepted</span>' : '<span class="rchip rej">Not accepted</span>') : '<span class="rchip pen">Pending</span>'}</td>
      <td class="rv-acc">${rv ? fn(e.accepted_qty) : e.is_serialized ? `<span>${fn(e.qty)}</span>` : `<input type="number" min="0" step="any" max="${e.qty}" value="${e.accepted_qty != null ? e.accepted_qty : e.qty}" data-eacc="${e.id}" data-max="${e.qty}">`}</td>
      <td style="white-space:nowrap">${rv ? '' : `<button type="button" class="btn sm yel" data-esave="${e.id}" data-eqty="${e.qty}">Accept</button> <button type="button" class="btn sm rej" data-erej="${e.id}">Reject</button>`}</td></tr>`;
    }).join('');
    const nSel = pend.filter(e => checked.has(e.id)).length;
    return `<table class="tbl rv-ent"><thead><tr><th></th><th>Item</th><th>SN / Qty</th><th>Reference</th><th>Note</th><th>Status</th><th>Accepted</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div class="rv-bulk"><label class="chk"><input type="checkbox" data-selall="${key}"> Select all</label>
      <span class="muted">${nSel} selected</span>
      <button type="button" class="btn sm yel" data-bulk-acc="${sid}" data-cat="${cid || ''}" ${nSel ? '' : 'disabled'}>Accept Selected</button>
      <button type="button" class="btn sm rej" data-bulk-rej="${sid}" data-cat="${cid || ''}" ${nSel ? '' : 'disabled'}>Reject Selected</button>
      ${pend.length && all.length > pend.length ? `<label class="chk rv-showrev"><input type="checkbox" data-showrev="${key}" ${showRevEnt.has(key) ? 'checked' : ''}> Show reviewed entries (${all.length - pend.length})</label>` : ''}
    </div>`;
  }

  function overviewHtml() {
    const T = stores.reduce((a, s) => ({ short: a.short + Number(s.revised || 0) }), { short: 0 });
    const nPend = stores.filter(s => stOf(s) === 'PENDING').length, nRev = stores.filter(s => stOf(s) === 'REVIEWED').length;
    const circles = [...new Set(stores.map(s => s.circle))].sort();
    let list = stores.filter(s => (ovf.status === 'ALL' || stOf(s) === ovf.status) && (!ovf.circle || s.circle === ovf.circle)
      && (!ovf.q || (s.code + ' ' + (s.name || '')).toLowerCase().includes(ovf.q.toLowerCase())));
    const pages = Math.max(1, Math.ceil(list.length / ovf.ps)); if (ovf.page >= pages) ovf.page = pages - 1; if (ovf.page < 0) ovf.page = 0;
    const slice = list.slice(ovf.page * ovf.ps, ovf.page * ovf.ps + ovf.ps);
    const rows = slice.map((s, i) => `<tr>
      <td>${ovf.page * ovf.ps + i + 1}</td>
      <td><button type="button" class="rv-link" data-view="${s.session_id}"><b>${esc(s.code)}</b></button>${s.name ? `<div class="muted">${esc(s.name)}</div>` : ''}</td>
      <td>${esc(s.circle)}</td>
      <td>${Number(s.pending_entries) > 0 ? `<span class="rchip pen">${s.pending_entries} pending</span>` : '<span class="muted">0</span>'}</td>
      <td><b class="r">${fn(s.revised)}</b></td>
      <td>${s.last_activity ? esc(fdt(s.last_activity)) : '—'}</td>
      <td><button type="button" class="btn sm" data-view="${s.session_id}">View</button></td></tr>`).join('');
    return `<div class="rv-kpis">
      <div class="card rv-kpi"><span>Total Stores</span><b>${stores.length}</b></div>
      <div class="card rv-kpi"><span>Pending Revision</span><b class="a">${nPend}</b></div>
      <div class="card rv-kpi"><span>Total Shortage</span><b class="r">${fn(T.short)}</b></div>
      <div class="card rv-kpi"><span>Reviewed</span><b class="g">${nRev}</b></div>
    </div>
    <div class="card" style="padding:14px 16px">
      <div class="rv-frow">
        <input id="ov-q" type="search" placeholder="Search store code or name…" value="${esc(ovf.q)}" autocomplete="off">
        <label>Circle <select id="ov-circle"><option value="">All</option>${circles.map(c => `<option ${ovf.circle === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label>Status <select id="ov-status">${[['PENDING', 'Pending'], ['REVIEWED', 'Reviewed'], ['ALL', 'All']].map(([v, l]) => `<option value="${v}" ${ovf.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      ${slice.length ? `<table class="tbl"><thead><tr><th>#</th><th>Store</th><th>Circle</th><th>Pending Remarks</th><th>Shortage</th><th>Last Updated</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="rv-pager"><span class="muted">Showing ${list.length ? ovf.page * ovf.ps + 1 : 0} – ${Math.min(list.length, ovf.page * ovf.ps + ovf.ps)} of ${list.length} stores</span>
        <span class="rv-pager-r"><label>Rows per page <select id="ov-ps">${[10, 20, 50].map(n => `<option ${ovf.ps === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <button type="button" class="btn sm" data-ovpg="-1" ${ovf.page <= 0 ? 'disabled' : ''}>‹</button>
        <button type="button" class="btn sm" data-ovpg="1" ${ovf.page >= pages - 1 ? 'disabled' : ''}>›</button></span></div>`
      : `<p class="muted" style="margin:6px 0 2px">${ovf.status === 'PENDING' && !ovf.q && !ovf.circle ? 'All caught up — no store has remarks waiting for review in this cycle.' : 'No stores match these filters.'}</p>`}
    </div>`;
  }

  function remarksHtml() {
    const list = cats.filter(c => !catQ || (c.name + ' ' + (c.ref_label || '')).toLowerCase().includes(catQ.toLowerCase()));
    const dis = admin ? '' : 'disabled';
    const rows = list.map((c, i) => `<tr>
      <td>${i + 1}</td>
      <td><input class="c-name" data-cid="${c.id}" value="${esc(c.name)}" ${dis} style="width:100%;min-width:130px"></td>
      <td><input class="c-ref" data-cid="${c.id}" value="${esc(c.ref_label || '')}" ${dis} style="width:100%;min-width:150px"></td>
      <td><input type="checkbox" class="c-req" data-cid="${c.id}" ${c.ref_required ? 'checked' : ''} ${dis}></td>
      <td><label class="sw"><input type="checkbox" class="c-act" data-cid="${c.id}" ${c.active ? 'checked' : ''} ${dis}><span></span></label></td></tr>`).join('');
    return `<div class="card" style="padding:14px 16px">
      <div class="rv-frow"><b style="font-size:15px">Remark Categories</b>
        <input id="cat-q" type="search" placeholder="Search category or reference label…" value="${esc(catQ)}" autocomplete="off" style="margin-left:auto">
        ${admin ? '<button type="button" class="btn yel" data-cat-add>+ Add New Category</button>' : ''}
      </div>
      ${list.length ? `<table class="tbl"><thead><tr><th>#</th><th>Category</th><th>Reference Label</th><th>Ref. Required</th><th>Active</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p class="muted" style="margin:6px 0 2px">No categories match your search.</p>'}
      ${admin ? '<div class="rv-foot"><button type="button" class="btn" data-cat-cancel>Cancel</button><button type="button" class="btn yel" data-cat-save>Save Changes</button></div>' : ''}
    </div>`;
  }

  const RULES = [
    'Accepted quantity cannot be greater than claimed quantity.',
    'If a remark is rejected, the full quantity will be considered as genuine shortage.',
    'Partially accepted quantity must be greater than 0 and less than the claimed quantity.',
    'Reference is mandatory for selected remark categories.',
    'Document/image is mandatory for item type: Image.',
    'At least one remark is required if genuine shortage is greater than 0.',
    'Duplicate serial numbers are not allowed.',
    'Accepted quantity can be updated only for pending remarks.'
  ];
  const rulesHtml = () => `<div class="card" style="padding:8px 16px">${RULES.map((r, i) => `<div class="rv-rule"><span class="rv-rn">${i + 1}</span><p>${esc(r)}</p><span class="rchip acc">Active</span></div>`).join('')}</div>`;

  function reviewHtml() {
    if (!sel || !storeBy(sel)) {
      const opts = [...stores].sort((a, b) => (stOf(b) === 'PENDING') - (stOf(a) === 'PENDING') || String(a.code).localeCompare(b.code));
      return `<div class="card" style="padding:18px"><b style="font-size:15px">Select a store to review</b>
        <p class="muted" style="margin:6px 0 12px">Pick a store here, or choose one from the Overview list.</p>
        <div class="rv-frow"><select id="rv-pick-sel" style="min-width:280px">${opts.map(s => `<option value="${s.session_id}">${esc(s.code)} — ${stOf(s) === 'PENDING' ? s.pending_entries + ' pending' : stOf(s) === 'REVIEWED' ? 'Reviewed' : 'No remarks'}</option>`).join('') || '<option value="">No stores in this cycle</option>'}</select>
        <button type="button" class="btn yel" data-pick-go ${opts.length ? '' : 'disabled'}>Open Shortage Review</button></div></div>`;
    }
    const s = storeBy(sel);
    const pendG = s.groups.filter(g => Number(g.pending) > 0), revG = s.groups.filter(g => Number(g.pending) === 0);
    const grpRow = (g, ro) => `<tr>
          <td><b>${esc(g.category)}</b>${!ro && g.pending ? ` <span class="rchip pen">${g.pending} pending</span>` : ''}${ro ? ' <span class="rchip acc">Reviewed</span>' : ''}</td><td>${g.entries}</td><td>${fn(g.claimed)}</td>
          <td class="rv-acc">${ro ? fn(g.accepted) : `<input type="number" min="0" step="any" max="${g.claimed}" value="${g.pending === g.entries ? g.claimed : g.accepted}" data-gacc="${s.session_id}|${g.category_id || ''}" data-max="${g.claimed}">`}</td>
          <td style="white-space:nowrap">${ro ? '' : `<button type="button" class="btn sm yel" data-gsave="${s.session_id}" data-cat="${g.category_id || ''}">Accept</button> <button type="button" class="btn sm rej" data-grej="${s.session_id}" data-cat="${g.category_id || ''}">Reject</button>`}</td>
          <td><button type="button" class="btn sm" data-entries="${s.session_id}" data-cat="${g.category_id || ''}">${entOpen.has(gkey(s.session_id, g.category_id)) ? 'Hide entries' : 'View entries'}</button></td></tr>
          ${entOpen.has(gkey(s.session_id, g.category_id)) ? `<tr><td colspan="6">${entriesHtml(s.session_id, g.category_id)}</td></tr>` : ''}`;
    return `<div class="card rv-shead"><div class="rv-shead-l"><button type="button" class="btn sm" data-back>← Stores</button>
        <span><b class="rv-code">${esc(s.code)}</b> <span class="muted">${esc(s.circle)} Circle</span> ${statusChip(s)}</span></div>
      <div class="rv-nums"><span>Reported <b class="r">${fn(s.reported)}</b></span><span>Claimed <b>${fn(s.claimed)}</b></span><span>Accepted <b class="g">${fn(s.accepted)}</b></span><span>Revised Genuine <b>${fn(s.revised)}</b></span></div></div>
    <div class="card" style="padding:14px 16px">
      ${pendG.length ? `<table class="tbl"><thead><tr><th>Remark</th><th>Entries</th><th>Claimed</th><th>Accepted</th><th></th><th></th></tr></thead><tbody>${pendG.map(g => grpRow(g, false)).join('')}</tbody></table>`
        : '<p class="muted" style="margin:2px 0">All remarks reviewed for this store — its revised genuine shortage stands as shown above.</p>'}
      ${revG.length ? `<div style="margin-top:10px"><button type="button" class="rv-link" data-grp-rev>${showRevGrp ? 'Hide' : 'Show'} reviewed groups (${revG.length})</button>
        ${showRevGrp ? `<table class="tbl" style="margin-top:8px"><thead><tr><th>Remark</th><th>Entries</th><th>Claimed</th><th>Accepted</th><th></th><th></th></tr></thead><tbody>${revG.map(g => grpRow(g, true)).join('')}</tbody></table>` : ''}</div>` : ''}
    </div>`;
  }

  function render(focusId) {
    const tabs = [['overview', 'Overview'], ['remarks', 'Remarks'], ['rules', 'Validation Rules'], ['review', 'Shortage Review']];
    el.innerHTML = `<div class="tabs seg rv-tabs">${tabs.map(([k, l]) => `<button type="button" class="tab ${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div><div id="rv-body">`
      + (tab === 'overview' ? overviewHtml() : tab === 'remarks' ? remarksHtml() : tab === 'rules' ? rulesHtml() : reviewHtml()) + '</div>';
    syncGroupLabels();
    entOpen.forEach(key => { const [sid, cid] = key.split('|'); ensureEntries(sid, cid === 'none' ? null : cid); });
    if (focusId) { const n = document.getElementById(focusId); if (n) { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch (e) {} } }
  }
  function syncGroupLabels() {
    el.querySelectorAll('[data-gacc]').forEach(inp => {
      const tr = inp.closest('tr'), b = tr && tr.querySelector('[data-gsave]'); if (!b) return;
      const v = Number(inp.value), mx = Number(inp.dataset.max);
      b.disabled = !(v > 0); b.textContent = v >= mx ? 'Accept' : 'Partially accept';
    });
  }
  async function ensureEntries(sid, cid) {
    const key = gkey(sid, cid);
    if (entCache[key] || fetchingEnt.has(key)) return;
    fetchingEnt.add(key);
    const r = await sb.rpc('review_entries', { p_session: sid });
    fetchingEnt.delete(key);
    if (!r.error) { entCache[key] = (r.data && r.data.entries) || []; if (tab === 'review') render(); }
  }
  async function refresh(keepSel) {
    await loadQueue();
    if (!keepSel) checked.clear();
    if (sel && !storeBy(sel)) sel = null;
    render();
  }

  const findEntry = id => { for (const k of Object.keys(entCache)) { const e = entCache[k].find(x => x.id === id); if (e) return { e, key: k }; } return {}; };
  const clearSessionCache = sid => Object.keys(entCache).forEach(k => { if (k.startsWith(sid + '|')) delete entCache[k]; });

  async function saveGroup(sid, cid, val) {
    const { error } = await sb.rpc('review_remark_group', { p_session: sid, p_category: cid || null, p_accepted_total: val });
    if (error) { toast(rpcMsg(error), 'err'); return; }
    toast('Revision saved — shortage and ranking updated.', 'ok');
    clearSessionCache(sid); await refresh(true);
  }
  async function saveEntry(id, val) {
    const { key } = findEntry(id);
    const { error } = await sb.rpc('review_remark_entry', { p_remark: id, p_accepted_qty: val });
    if (error) { toast(rpcMsg(error), 'err'); return; }
    toast('Revision saved — shortage and ranking updated.', 'ok');
    if (key) delete entCache[key];
    await refresh(true);
  }
  async function bulk(sid, cid, reject) {
    const key = gkey(sid, cid), list = (entCache[key] || []).filter(e => e.status !== 'REVIEWED' && checked.has(e.id));
    if (!list.length) return;
    let fail = 0;
    for (const e of list) {
      const inp = el.querySelector(`[data-eacc="${e.id}"]`);
      const val = reject ? 0 : e.is_serialized ? Number(e.qty) : Number(inp ? inp.value : e.qty);
      const { error } = await sb.rpc('review_remark_entry', { p_remark: e.id, p_accepted_qty: val });
      if (error) fail++; else checked.delete(e.id);
    }
    toast(fail ? `${fail} entr${fail === 1 ? 'y' : 'ies'} could not be saved.` : `Revision saved for ${list.length} entries — shortage and ranking updated.`, fail ? 'err' : 'ok');
    delete entCache[key]; await refresh(true);
  }
  async function saveCategories() {
    let changed = 0;
    for (const c of cats) {
      const nm = el.querySelector(`.c-name[data-cid="${c.id}"]`); if (!nm) continue;   // row filtered out by search - leave it untouched
      const name = nm.value.trim(), ref = el.querySelector(`.c-ref[data-cid="${c.id}"]`).value.trim();
      const req = el.querySelector(`.c-req[data-cid="${c.id}"]`).checked, act = el.querySelector(`.c-act[data-cid="${c.id}"]`).checked;
      if (!name) { toast('Category name cannot be empty.', 'err'); return; }
      if (name === c.name && ref === (c.ref_label || '') && req === !!c.ref_required && act === !!c.active) continue;
      const { error } = await sb.rpc('admin_remark_category_save', { p_id: c.id, p_name: name, p_ref_label: ref, p_ref_required: req, p_sort: c.sort || 0, p_active: act });
      if (error) { toast(rpcMsg(error), 'err'); return; }
      changed++;
    }
    await loadCats(); cats.sort((a, b) => (a.sort || 0) - (b.sort || 0)); render();
    toast(changed ? 'Remark categories saved.' : 'No changes to save.', 'ok');
  }
  function addCategory() {
    const body = `<div class="fld"><label>Category Name *</label><input class="inp" id="ac-name" placeholder="e.g. Issued to FE"></div>
      <div class="fld"><label>Reference Label</label><input class="inp" id="ac-ref" placeholder="e.g. FE name / slip no."></div>
      <div class="fld"><label class="chk" style="font-weight:500"><input type="checkbox" id="ac-req"> Reference required</label></div>
      <div class="fld"><label class="chk" style="font-weight:500"><input type="checkbox" id="ac-act" checked> Active</label></div>`;
    openModal('Add New Category', body, [cancelBtn, { label: 'Add Category', cls: 'yel', fn: async o => {
      const name = o.querySelector('#ac-name').value.trim();
      if (!name) { toast('Please enter a category name.', 'err'); return false; }
      const sort = cats.reduce((m, c) => Math.max(m, c.sort || 0), 0) + 1;
      const { error } = await sb.rpc('admin_remark_category_save', { p_id: null, p_name: name, p_ref_label: o.querySelector('#ac-ref').value.trim(), p_ref_required: o.querySelector('#ac-req').checked, p_sort: sort, p_active: o.querySelector('#ac-act').checked });
      if (error) throw error;
      await loadCats(); cats.sort((a, b) => (a.sort || 0) - (b.sort || 0)); render();
      toast('Category added.', 'ok');
    } }]);
  }

  el.onclick = e => {
    const t = e.target;
    const tb = t.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; render(); return; }
    const vw = t.closest('[data-view]'); if (vw) { sel = vw.dataset.view; tab = 'review'; render(); return; }
    if (t.closest('[data-back]')) { tab = 'overview'; render(); return; }
    if (t.closest('[data-pick-go]')) { const s = el.querySelector('#rv-pick-sel'); if (s && s.value) { sel = s.value; render(); } return; }
    const pg = t.closest('[data-ovpg]'); if (pg) { ovf.page += Number(pg.dataset.ovpg); render(); return; }
    const gs = t.closest('[data-gsave]'); if (gs) { const inp = gs.closest('tr').querySelector('[data-gacc]'); saveGroup(gs.dataset.gsave, gs.dataset.cat || null, Number(inp ? inp.value : 0)); return; }
    const gr = t.closest('[data-grej]'); if (gr) { saveGroup(gr.dataset.grej, gr.dataset.cat || null, 0); return; }
    const en = t.closest('[data-entries]'); if (en) { const key = gkey(en.dataset.entries, en.dataset.cat || null);
      if (entOpen.has(key)) entOpen.delete(key); else { entOpen.add(key); ensureEntries(en.dataset.entries, en.dataset.cat || null); } render(); return; }
    const es = t.closest('[data-esave]'); if (es) { const { e: ent } = findEntry(es.dataset.esave); if (!ent) return;
      const inp = es.closest('tr').querySelector('[data-eacc]'); saveEntry(ent.id, ent.is_serialized ? Number(ent.qty) : Number(inp ? inp.value : ent.qty)); return; }
    const ej = t.closest('[data-erej]'); if (ej) { saveEntry(ej.dataset.erej, 0); return; }
    const ba = t.closest('[data-bulk-acc]'); if (ba) { bulk(ba.dataset.bulkAcc, ba.dataset.cat || null, false); return; }
    const br = t.closest('[data-bulk-rej]'); if (br) { bulk(br.dataset.bulkRej, br.dataset.cat || null, true); return; }
    if (t.closest('[data-grp-rev]')) { showRevGrp = !showRevGrp; render(); return; }
    if (t.closest('[data-cat-add]')) { addCategory(); return; }
    if (t.closest('[data-cat-save]')) { saveCategories(); return; }
    if (t.closest('[data-cat-cancel]')) { render(); return; }
  };
  el.onchange = e => {
    const t = e.target;
    if (t.id === 'ov-circle') { ovf.circle = t.value; ovf.page = 0; render(); return; }
    if (t.id === 'ov-status') { ovf.status = t.value; ovf.page = 0; render(); return; }
    if (t.id === 'ov-ps') { ovf.ps = Number(t.value); ovf.page = 0; render(); return; }
    if (t.dataset.eck) { if (t.checked) checked.add(t.dataset.eck); else checked.delete(t.dataset.eck); render(); return; }
    if (t.dataset.selall) { const key = t.dataset.selall, [sid, cid] = key.split('|');
      (entCache[key] || []).filter(x => x.status !== 'REVIEWED' && (x.category_id || null) === (cid === 'none' ? null : cid)).forEach(x => t.checked ? checked.add(x.id) : checked.delete(x.id)); render(); return; }
    if (t.dataset.showrev) { if (t.checked) showRevEnt.add(t.dataset.showrev); else showRevEnt.delete(t.dataset.showrev); render(); return; }
  };
  if (el.addEventListener) el.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'ov-q') { ovf.q = t.value; ovf.page = 0; render('ov-q'); return; }
    if (t.id === 'cat-q') { catQ = t.value; render('cat-q'); return; }
    if (t.dataset.gacc != null) syncGroupLabels();
  });

  render();
};
