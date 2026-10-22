/* Shortage Review (database/32): staff review the remarks stores added against genuine shortage.
   Accepting a quantity stops it counting as genuine shortage - dashboard, result page and ranking update live.
   Pending remarks change nothing; the audited numbers are never overwritten. */
PAGES.review = async el => {
  if (!isStaff()) { el.innerHTML = '<div class="alert err">This page is for Admin and Circle Head users.</div>'; return; }
  if (!S.cycleId) return noCycle(el);
  const admin = isAdmin();
  el.innerHTML = universeLoader();
  const [qR, cR] = await Promise.all([sb.rpc('review_queue', { p_cycle: S.cycleId }), sb.rpc('remark_categories_list')]);
  if (qR.error) { el.innerHTML = `<div class="alert warn"><b>Database update needed.</b> The shortage revision tables are not installed yet. Run <code>database/32_shortage_revision.sql</code> in the Supabase SQL editor, then refresh.</div>`; return; }
  let stores = (qR.data && qR.data.stores) || [];
  let cats = !cR.error && Array.isArray(cR.data) ? cR.data : [];
  const open = new Set(), entOpen = new Set(), entCache = {};
  const gkey = (sid, cid) => sid + '|' + (cid || 'none');
  const statusChip = s => s.entries === 0 ? '<span class="rchip cat">No remarks</span>' : s.pending_entries > 0 ? `<span class="rchip pen">${s.pending_entries} pending</span>` : '<span class="rchip acc">Reviewed ✓</span>';

  function entriesHtml(sid, cid) {
    const list = (entCache[gkey(sid, cid)] || []).filter(e => (e.category_id || null) === (cid || null));
    if (!list.length) return '<div class="muted" style="padding:6px 2px">No entries in this group.</div>';
    return `<table class="tbl rv-ent"><thead><tr><th>Item</th><th>SN / Qty</th><th>Reference</th><th>Note</th><th>Status</th><th>Accepted</th><th></th></tr></thead><tbody>${list.map(e => `<tr>
      <td><b>${esc(e.item_code)}</b><div class="muted">${esc(e.inventory_status || '')}${e.item_quality ? ' · ' + esc(e.item_quality) : ''}</div></td>
      <td>${e.item_sno ? esc(e.item_sno) : 'Qty ' + fn(e.qty)}</td>
      <td>${esc(e.reference || '—')}</td><td>${esc(e.remark || '—')}</td>
      <td>${e.status === 'REVIEWED' ? (Number(e.accepted_qty) > 0 ? '<span class="rchip acc">Accepted</span>' : '<span class="rchip rej">Not accepted</span>') : '<span class="rchip pen">Pending</span>'}</td>
      <td class="rv-acc"><input type="number" min="0" step="any" max="${e.qty}" value="${e.accepted_qty != null ? e.accepted_qty : e.qty}" data-eacc="${e.id}"></td>
      <td><button type="button" class="btn sm yel" data-esave="${e.id}">Save</button></td></tr>`).join('')}</tbody></table>`;
  }

  function render() {
    const T = stores.reduce((a, s) => ({ rep: a.rep + Number(s.reported || 0), acc: a.acc + Number(s.accepted || 0), pen: a.pen + Number(s.pending_entries || 0) }), { rep: 0, acc: 0, pen: 0 });
    const cards = stores.length ? stores.map(s => `<div class="card rv-store">
      <button type="button" class="rv-head" data-open="${s.session_id}"><span class="rv-code">${esc(s.code)}</span><span class="muted">${esc(s.circle)} Circle</span>${statusChip(s)}
        <span class="rv-nums"><span>Reported <b class="r">${fn(s.reported)}</b></span><span>Claimed <b>${fn(s.claimed)}</b></span><span>Accepted <b class="g">${fn(s.accepted)}</b></span><span>Revised <b>${fn(s.revised)}</b></span></span></button>
      ${open.has(s.session_id) ? `<div class="rv-body">${s.groups.length ? `<table class="tbl"><thead><tr><th>Remark</th><th>Entries</th><th>Claimed</th><th>Accepted</th><th></th><th></th></tr></thead><tbody>${s.groups.map(g => `<tr>
          <td><b>${esc(g.category)}</b>${g.pending ? ` <span class="rchip pen">${g.pending} pending</span>` : ''}</td><td>${g.entries}</td><td>${fn(g.claimed)}</td>
          <td class="rv-acc"><input type="number" min="0" step="any" max="${g.claimed}" value="${g.pending === g.entries ? g.claimed : g.accepted}" data-gacc="${s.session_id}|${g.category_id || ''}"></td>
          <td><button type="button" class="btn sm yel" data-gsave="${s.session_id}" data-cat="${g.category_id || ''}">Save</button></td>
          <td><button type="button" class="btn sm" data-entries="${s.session_id}" data-cat="${g.category_id || ''}">${entOpen.has(gkey(s.session_id, g.category_id)) ? 'Hide entries' : 'View entries'}</button></td></tr>
          ${entOpen.has(gkey(s.session_id, g.category_id)) ? `<tr><td colspan="6">${entriesHtml(s.session_id, g.category_id)}</td></tr>` : ''}`).join('')}</tbody></table>
        <p class="muted" style="font-size:12px;margin:10px 0 0">Set the accepted quantity per remark and Save — the rest stays as genuine shortage. Use View entries to accept item by item.</p>` : '<p class="muted" style="padding:8px 2px">No remarks from this store yet — its genuine shortage stands as reported.</p>'}</div>` : ''}
    </div>`).join('') : '<div class="card" style="padding:18px"><p class="muted" style="margin:0">No store has genuine shortage in this cycle yet.</p></div>';
    const catCard = admin ? `<div class="card" style="padding:16px;margin-top:16px"><div class="cardhead"><b>Remark categories</b><span class="muted">Stores pick from this list when explaining a shortage. Deactivated categories stay on old remarks but cannot be picked again.</span></div>
      <table class="tbl"><thead><tr><th>Category</th><th>Reference label</th><th>Ref. required</th><th>Order</th><th>Active</th><th></th></tr></thead><tbody>
      ${cats.map(c => `<tr><td><input class="c-name" data-cid="${c.id}" value="${esc(c.name)}" style="width:100%;min-width:130px"></td>
        <td><input class="c-ref" data-cid="${c.id}" value="${esc(c.ref_label)}" style="width:100%;min-width:150px"></td>
        <td><input type="checkbox" class="c-req" data-cid="${c.id}" ${c.ref_required ? 'checked' : ''}></td>
        <td><input type="number" class="c-sort" data-cid="${c.id}" value="${c.sort}" style="width:64px"></td>
        <td><input type="checkbox" class="c-act" data-cid="${c.id}" ${c.active ? 'checked' : ''}></td>
        <td><button type="button" class="btn sm" data-csave="${c.id}">Save</button></td></tr>`).join('')}
      <tr><td><input id="nc-name" placeholder="New category name" style="width:100%;min-width:130px"></td>
        <td><input id="nc-ref" placeholder="Reference label (e.g. Order no.)" style="width:100%;min-width:150px"></td>
        <td><input type="checkbox" id="nc-req"></td><td></td><td></td>
        <td><button type="button" class="btn sm yel" id="nc-add">Add</button></td></tr></tbody></table></div>` : '';
    el.innerHTML = `<div class="card revstrip"><span class="rvt">${ic('clip', 16)} ${esc(S.cycleName || 'This cycle')}</span><span>Stores <b>${stores.length}</b></span><span>Reported genuine <b class="r">${fn(T.rep)}</b></span><span>Accepted <b class="g">${fn(T.acc)}</b></span><span>Revised genuine <b>${fn(Math.max(0, T.rep - T.acc))}</b></span>${T.pen ? `<span class="rvp">${T.pen} remark${T.pen === 1 ? '' : 's'} awaiting review</span>` : ''}</div>`
      + `<div style="display:grid;gap:12px">${cards}</div>` + catCard;
    wire();
  }

  async function refresh() {
    const q2 = await sb.rpc('review_queue', { p_cycle: S.cycleId });
    if (!q2.error) stores = (q2.data && q2.data.stores) || [];
    Object.keys(entCache).forEach(k => delete entCache[k]); entOpen.clear();
    render();
  }

  function wire() {
    el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const id = b.dataset.open; if (open.has(id)) open.delete(id); else open.add(id); render(); });
    el.querySelectorAll('[data-gsave]').forEach(b => b.onclick = async () => {
      const sid = b.dataset.gsave, cat = b.dataset.cat || null;
      const inp = el.querySelector(`[data-gacc="${sid}|${cat || ''}"]`);
      const val = inp ? Number(inp.value) : 0;
      b.disabled = true;
      const { error } = await sb.rpc('review_remark_group', { p_session: sid, p_category: cat, p_accepted_total: isNaN(val) ? 0 : val });
      b.disabled = false;
      if (error) { toast(rpcMsg(error), 'err'); return; }
      toast('Revision saved — shortage and ranking updated.', 'ok'); refresh();
    });
    el.querySelectorAll('[data-entries]').forEach(b => b.onclick = async () => {
      const sid = b.dataset.entries, cat = b.dataset.cat || null, k = gkey(sid, cat);
      if (entOpen.has(k)) { entOpen.delete(k); render(); return; }
      b.disabled = true; b.textContent = 'Loading…';
      const { data, error } = await sb.rpc('review_entries', { p_session: sid });
      if (error) { b.disabled = false; toast(rpcMsg(error), 'err'); return; }
      entCache[k] = (data && data.entries) || []; entOpen.add(k); render();
    });
    el.querySelectorAll('[data-esave]').forEach(b => b.onclick = async () => {
      const inp = el.querySelector(`[data-eacc="${b.dataset.esave}"]`);
      const val = inp ? Number(inp.value) : 0;
      b.disabled = true;
      const { error } = await sb.rpc('review_remark_entry', { p_remark: b.dataset.esave, p_accepted_qty: isNaN(val) ? 0 : val });
      b.disabled = false;
      if (error) { toast(rpcMsg(error), 'err'); return; }
      toast('Saved — shortage and ranking updated.', 'ok'); refresh();
    });
    const add = el.querySelector('#nc-add');
    if (add) add.onclick = async () => {
      const name = el.querySelector('#nc-name').value.trim(), ref = el.querySelector('#nc-ref').value.trim(), req = el.querySelector('#nc-req').checked;
      if (!name) { toast('Category name is required.', 'err'); return; }
      add.disabled = true;
      const { error } = await sb.rpc('admin_remark_category_save', { p_id: null, p_name: name, p_ref_label: ref, p_ref_required: req, p_sort: (cats.length + 1) * 10, p_active: true });
      add.disabled = false;
      if (error) { toast(rpcMsg(error), 'err'); return; }
      const c2 = await sb.rpc('remark_categories_list'); if (!c2.error) cats = c2.data || [];
      toast('Category added.', 'ok'); render();
    };
    el.querySelectorAll('[data-csave]').forEach(b => b.onclick = async () => {
      const id = b.dataset.csave;
      const name = el.querySelector(`.c-name[data-cid="${id}"]`).value.trim(), ref = el.querySelector(`.c-ref[data-cid="${id}"]`).value.trim();
      const req = el.querySelector(`.c-req[data-cid="${id}"]`).checked, act = el.querySelector(`.c-act[data-cid="${id}"]`).checked;
      const sort = Number(el.querySelector(`.c-sort[data-cid="${id}"]`).value) || 0;
      b.disabled = true;
      const { error } = await sb.rpc('admin_remark_category_save', { p_id: id, p_name: name, p_ref_label: ref, p_ref_required: req, p_sort: sort, p_active: act });
      b.disabled = false;
      if (error) { toast(rpcMsg(error), 'err'); return; }
      const c2 = await sb.rpc('remark_categories_list'); if (!c2.error) cats = c2.data || [];
      toast('Category saved.', 'ok'); render();
    });
  }
  render();
};
