// Phase 5: admin / circle head dashboard + store detail. All data comes from staff-scoped server functions (circle heads only ever receive their own circles).
const _storeDash = PAGES.dashboard;
const pct = v => v == null ? '—' : Number(v).toFixed(1) + '%';
const rateCls = r => r == null ? '' : r >= 90 ? 'ok' : r >= 75 ? 'warn' : 'bad';
const HEALTH = { HEALTHY: 'ok', WARNING: 'warn', CRITICAL: 'bad', PENDING: '' };
const EVT = { AUDIT_STARTED: 'started the audit', AUDIT_SUBMITTED: 'submitted the audit', AUDIT_REOPENED: 'audit reopened', BASE_FROZEN: 'base stock frozen', BASE_UPLOADED: 'base stock uploaded',
  SERIAL_DUPLICATE: 'duplicate scan', SERIAL_NOT_FOUND: 'serial not in store base', UNLISTED_SERIAL_ADDED: 'unlisted serial added', NON_SERIAL_ADDED: 'non-serialized added', ENTRY_REMOVED: 'entry removed',
  ENTRY_EDITED: 'entry edited', PREVIEW_OPENED: 'preview opened', AUDIT_LOCKED: 'audit locked', VALIDATION_FAILED: 'upload validation failed' };
const STATUS_LBL = { COMPLETED: ['Completed', 'ok'], IN_PROGRESS: ['In progress', 'warn'], NOT_STARTED: ['Not started', ''] };
const pager = (count, page, PS) => `<div class="bar"><span class="muted">${fn(count)} row(s)</span><div class="row"><button class="btn sm" data-pg="-1" ${page ? '' : 'disabled'}>Previous</button><button class="btn sm" data-pg="1" ${(page + 1) * PS < count ? '' : 'disabled'}>Next</button></div></div>`;

function donut(parts, total, label) {
  const R = 40, C = 2 * Math.PI * R; let off = 0;
  const segs = parts.filter(p => p.v > 0).map(p => { const len = total ? C * p.v / total : 0;
    const s = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${p.color}" stroke-width="16" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`; off += len; return s; }).join('');
  return `<svg viewBox="0 0 120 120" width="140" height="140" role="img" aria-label="${esc(label)}"><circle cx="60" cy="60" r="${R}" fill="none" stroke="#F3F4F6" stroke-width="16"/>${segs}
    <text x="60" y="60" text-anchor="middle" font-size="22" font-weight="800" fill="#111827">${total}</text><text x="60" y="76" text-anchor="middle" font-size="9" fill="#6B7280">${esc(label)}</text></svg>`;
}

PAGES.dashboard = async el => { if (S.profile.role === 'STORE_USER') return _storeDash(el); return adminDash(el); };

async function adminDash(el) {
  const { data: cycles, error } = await sb.from('audit_cycles').select('id,name,status').order('created_at', { ascending: false });
  if (error) throw error;
  if (!cycles.length) { el.innerHTML = '<div class="card"><h2>No audit cycle yet</h2><p class="muted">Create one in <a href="#/cycles">Audit Cycles</a>, then upload each store\'s base stock.</p></div>'; return; }
  let cid = sessionStorage.getItem('sfx_cycle'); if (!cycles.some(c => c.id === cid)) cid = (cycles.find(c => c.status === 'ACTIVE') || cycles[0]).id;
  const F = { circle: '', status: '', rate: '', q: '', sort: '' }; let ov = null, rows = [], found = null;
  el.innerHTML = `<div class="bar"><div class="row"><label class="inl">Audit cycle</label><select id="cy" style="width:auto">${cycles.map(c => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)} (${c.status})</option>`).join('')}</select></div><button class="btn sm" id="rf">Refresh</button></div><div id="dbody"></div>`;
  async function load() {
    sessionStorage.setItem('sfx_cycle', cid); found = null; el.querySelector('#dbody').innerHTML = '<div class="boot">Loading dashboard…</div>';
    const [o, s] = await Promise.all([sb.rpc('dash_overview', { p_cycle: cid }), sb.rpc('dash_stores', { p_cycle: cid })]);
    if (o.error) throw o.error; if (s.error) throw s.error; ov = o.data; rows = s.data; draw();
  }
  const kpi = (l, v, c = '') => `<div class="${c}"><span>${l}</span><b>${v}</b></div>`;
  function draw() {
    const T = ov.totals, I = ov.integrity, done = rows.filter(r => r.audit_status === 'COMPLETED');
    const hb = { h: done.filter(r => r.match_rate >= 90).length, w: done.filter(r => r.match_rate >= 75 && r.match_rate < 90).length, c: done.filter(r => r.match_rate < 75).length };
    const heads = ov.heads.map(h => `<div class="card hcard ${h.status === 'CRITICAL' ? 'crit' : ''}"><div class="bar"><b>${esc(h.label)}</b>${badge(h.status, HEALTH[h.status])}</div>
      <div class="muted">${h.circles.map(esc).join(' / ')}</div><div class="hnum">${pct(h.match_rate)}<small> match</small></div>
      <div class="hrow"><span>${h.completed}/${h.stores} stores</span><span class="neg">Short ${fn(h.short)}</span><span class="pos">Excess ${fn(h.excess)}</span></div></div>`).join('');
    const tile = (l, v, warn) => `<div class="${warn && Number(v) ? 'a' : ''}"><span>${l}</span><b>${fn(v)}</b></div>`;
    const act = ov.activity.map(a => `<div class="act"><span class="muted">${fdt(a.created_at)}</span><span><a href="#/storedetail?c=${cid}&s=${a.store_id}"><b>${esc(a.store_code || '')}</b></a> ${EVT[a.event_type] || esc(a.event_type)}${a.actor ? ' · ' + esc(a.actor) : ''}</span></div>`).join('') || '<div class="muted">No activity yet.</div>';
    el.querySelector('#dbody').innerHTML = `
      <div class="kv kpi">${kpi('Stores completed', `${T.completed} / ${T.stores}`, 'g')}${kpi('Overall match rate', pct(T.match_rate))}${kpi('Total expected units', fn(T.expected))}${kpi('Total physical units', fn(T.physical))}${kpi('Total short units', fn(T.short), Number(T.short) ? 'r' : '')}${kpi('Total excess units', fn(T.excess), Number(T.excess) ? 'a' : '')}</div>
      <p class="muted">Totals cover completed audits only. Base stock frozen for ${T.base_frozen} of ${T.stores} stores.</p>
      <h3>Circle head summary</h3><div class="heads">${heads || '<div class="muted">No circle heads or circles to show.</div>'}</div>
      <div class="dgrid"><div class="card"><b>Store status</b><div class="dflex">${donut([{ v: T.completed, color: '#16A34A' }, { v: T.in_progress, color: '#F59E0B' }, { v: T.not_started, color: '#D1D5DB' }], T.stores, 'stores')}
          <div class="legend"><div><i style="background:#16A34A"></i>Completed <b>${T.completed}</b></div><div><i style="background:#F59E0B"></i>In progress <b>${T.in_progress}</b></div><div><i style="background:#D1D5DB"></i>Not started <b>${T.not_started}</b></div></div></div>
          <div class="muted" style="margin-top:8px">Audit health (completed stores)</div><div class="hbar">${hb.h + hb.w + hb.c ? `<i style="flex:${hb.h};background:#16A34A"></i><i style="flex:${hb.w};background:#F59E0B"></i><i style="flex:${hb.c};background:#DC2626"></i>` : '<i style="flex:1;background:#E5E7EB"></i>'}</div>
          <div class="muted">Healthy ${hb.h} · Warning ${hb.w} · Critical ${hb.c}</div></div>
        <div class="card"><b>Audit integrity</b><div class="kv integ">${tile('Duplicate scan attempts', I.duplicates, 1)}${tile('Unlisted serials', I.unlisted, 1)}${tile('Excess units', T.excess, 1)}${tile('Short units', T.short, 1)}${tile('Reopened audits', I.reopened, 1)}${tile('Edited entries', I.edited, 1)}${tile('Failed validation attempts', I.failed_validation, 1)}</div>
          <div class="muted">Failed validation = serials not found in the store base + rejected base uploads.</div></div>
        <div class="card"><b>Recent activity</b><div class="acts">${act}</div></div></div>
      <h3>Find an item or serial</h3><div class="row"><div><input id="fq" placeholder="Serial or item code (min 3 characters)"></div><button class="btn" id="fgo">Search</button></div><div id="fres"></div>
      <h3>Store summary</h3><div class="bar"><div class="row"><input id="sq" class="srch" placeholder="Search store or circle…" value="${esc(F.q)}">
        <select id="sc"><option value="">All circles</option>${[...new Set(rows.map(r => r.circle))].sort().map(c => `<option ${c === F.circle ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="ss">${[['', 'All statuses'], ['COMPLETED', 'Completed'], ['IN_PROGRESS', 'In progress'], ['NOT_STARTED', 'Not started']].map(o => `<option value="${o[0]}" ${o[0] === F.status ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>
        <select id="sr">${[['', 'Any match rate'], ['crit', 'Critical stores (< 75%)'], ['warn', 'Warning (75–90%)'], ['ok', 'Healthy (≥ 90%)']].map(o => `<option value="${o[0]}" ${o[0] === F.rate ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>
        <select id="so">${[['', 'Sort: circle'], ['low', 'Lowest match first'], ['short', 'Most short first']].map(o => `<option value="${o[0]}" ${o[0] === F.sort ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div></div><div id="stw">${storeTable()}</div>`;
  }
  function storeTable() {
    let l = rows.filter(r => (!F.circle || r.circle === F.circle) && (!F.status || r.audit_status === F.status) && (!F.q || (r.name + ' ' + r.code + ' ' + r.circle).toLowerCase().includes(F.q)) &&
      (!F.rate || (r.match_rate != null && (F.rate === 'crit' ? r.match_rate < 75 : F.rate === 'warn' ? r.match_rate >= 75 && r.match_rate < 90 : r.match_rate >= 90))));
    if (F.sort === 'low') l = l.slice().sort((a, b) => (a.match_rate ?? 999) - (b.match_rate ?? 999)); if (F.sort === 'short') l = l.slice().sort((a, b) => Number(b.short || 0) - Number(a.short || 0));
    return tbl(['Store', 'Circle', 'Expected', 'Physical', 'Matched', 'Short', 'Excess', 'Match rate', 'Audit status', 'Last updated', ''], l.map(r => { const s = STATUS_LBL[r.audit_status];
      return `<tr><td><b>${esc(r.name)}</b><br><span class="muted">${esc(r.code)}</span></td><td>${esc(r.circle)}</td><td>${r.expected == null ? '—' : fn(r.expected)}</td><td>${r.physical == null ? '—' : fn(r.physical)}</td><td>${r.matched == null ? '—' : fn(r.matched)}</td>
        <td class="${Number(r.short) ? 'neg' : ''}">${r.short == null ? '—' : fn(r.short)}</td><td class="${Number(r.excess) ? 'pos' : ''}">${r.excess == null ? '—' : fn(r.excess)}</td><td>${r.match_rate == null ? '—' : badge(pct(r.match_rate), rateCls(r.match_rate))}</td>
        <td>${badge(s[0], s[1])}${r.audit_status === 'COMPLETED' ? ' <span class="muted">v' + r.version + '</span>' : ''}</td><td class="nw">${fdt(r.last_updated)}</td><td><a class="btn sm" href="#/storedetail?c=${cid}&s=${r.store_id}">Open</a></td></tr>`; }).join(''));
  }
  const refresh = () => { const w = el.querySelector('#stw'); if (w) w.innerHTML = storeTable(); };
  async function search() {
    const q = el.querySelector('#fq').value.trim(), out = el.querySelector('#fres'); if (q.length < 3) { out.innerHTML = '<div class="muted">Type at least 3 characters.</div>'; return; }
    out.innerHTML = '<div class="muted">Searching…</div>'; const { data, error } = await sb.rpc('dash_search', { p_cycle: cid, p_q: q });
    if (error) { out.innerHTML = `<div class="alert err">${esc(rpcMsg(error))}</div>`; return; }
    out.innerHTML = tbl(['Found in', 'Store', 'Item code', 'Serial', 'Description'], data.map(x => `<tr><td>${badge(x.source, x.source === 'Scanned' ? 'info' : '')}</td><td><a href="#/storedetail?c=${cid}&s=${x.store_id}">${esc(x.store_code)}</a></td><td>${esc(x.item_code)}</td><td>${esc(x.serial || '—')}</td><td>${esc(x.item_description || '')}</td></tr>`).join(''));
  }
  el.onchange = e => { const t = e.target;
    if (t.id === 'cy') { cid = t.value; load().catch(x => toast(rpcMsg(x), 'err')); } else if (t.id === 'sc') { F.circle = t.value; refresh(); } else if (t.id === 'ss') { F.status = t.value; refresh(); }
    else if (t.id === 'sr') { F.rate = t.value; refresh(); } else if (t.id === 'so') { F.sort = t.value; refresh(); } };
  el.oninput = e => { if (e.target.id === 'sq') { F.q = e.target.value.trim().toLowerCase(); refresh(); } };
  el.onclick = e => { if (e.target.closest('#rf')) load().catch(x => toast(rpcMsg(x), 'err')); if (e.target.closest('#fgo')) search(); };
  el.onkeydown = e => { if (e.key === 'Enter' && e.target.id === 'fq') search(); };
  await load();
}

/* ================= STORE DETAIL (admin / circle head) ================= */
PAGES.storedetail = async el => {
  if (S.profile.role === 'STORE_USER') { el.innerHTML = '<div class="card"><h2>Not available</h2></div>'; return; }
  const hq = new URLSearchParams(location.hash.split('?')[1] || ''), cid = hq.get('c'), sid = hq.get('s');
  const [st, cy, ss, up] = await Promise.all([sb.from('stores').select('id,code,name,report_name,circles(code,name)').eq('id', sid).maybeSingle(), sb.from('audit_cycles').select('id,name,status').eq('id', cid).maybeSingle(),
    sb.from('audit_sessions').select('id,version,status,started_by,started_at,submitted_by,submitted_at,reopened_by,reopened_at,reopen_reason,expected_units,physical_units,matched_units,short_units,excess_units').eq('audit_cycle_id', cid).eq('store_id', sid).order('version'),
    sb.from('base_stock_uploads').select('version,rows_valid,serialized_count,non_serialized_count,expected_units,frozen_at,source_file_name').eq('audit_cycle_id', cid).eq('store_id', sid).eq('status', 'FROZEN').maybeSingle()]);
  if (!st.data || !cy.data) { el.innerHTML = '<div class="card"><h2>Store not found</h2><p class="muted">It may be outside your circles.</p><a class="btn" href="#/dashboard">← Dashboard</a></div>'; return; }
  if (ss.error) throw ss.error;
  const store = st.data, cyc = cy.data, sess = ss.data, base = up.data, L = sess.filter(x => x.status !== 'REOPENED').slice(-1)[0] || null;
  const ids = [...new Set(sess.flatMap(x => [x.started_by, x.submitted_by, x.reopened_by]).filter(Boolean))];
  const names = ids.length ? Object.fromEntries(((await sb.from('profiles').select('id,full_name').in('id', ids)).data || []).map(p => [p.id, p.full_name])) : {};
  const who = id => id ? (names[id] || 'Administrator') : '—';
  let tab = 'overview'; const PS = 50;
  const auditBadge = !L ? badge('Not started') : L.status === 'LOCKED' ? badge('Completed · v' + L.version, 'ok') : badge('In progress · v' + L.version, 'warn');
  el.innerHTML = `<div class="bar"><div><a class="btn sm" href="#/dashboard">← Dashboard</a></div><div class="row">${L && L.status === 'LOCKED' ? `<button class="btn sm danger-o" id="reopen">Reopen audit</button>` : ''}<a class="btn sm" href="#/basestock?c=${cid}&s=${sid}">${base ? 'Revise base stock' : 'Upload base stock'}</a></div></div>
    <div class="card sec"><h2 style="margin:0">${esc(store.name)} <span class="muted">${esc(store.code)}</span></h2><div class="row" style="margin-top:6px">${badge(store.circles?.code || '', 'info')}<span class="muted">Cycle ${esc(cyc.name)}</span>${auditBadge}</div></div>
    <div class="tabs" id="tabs">${[['overview', 'Store overview'], ['progress', 'Audit progress'], ['recon', 'Reconciliation'], ['serial', 'Serialized variance'], ['nonserial', 'Non-serialized variance'], ['history', 'Audit history']].map(t => `<button class="tab ${t[0] === tab ? 'on' : ''}" data-tab="${t[0]}">${t[1]}</button>`).join('')}</div><div id="tabbody" style="margin-top:12px"></div>`;
  const body = el.querySelector('#tabbody'), reload = () => PAGES.storedetail(el);
  const locked = () => L && L.status === 'LOCKED';
  const needLocked = '<div class="card"><p class="muted">Available once the store submits its audit.</p></div>';

  async function show() {
    el.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab)); body.innerHTML = '<div class="boot">Loading…</div>';
    if (tab === 'overview') {
      const m = locked() ? { match_rate: L.expected_units > 0 ? Math.round(1000 * L.matched_units / L.expected_units) / 10 : null, expected: L.expected_units, physical: L.physical_units, short: L.short_units, excess: L.excess_units } : null;
      body.innerHTML = (m ? kpis(m) : '<div class="alert info">No completed audit yet for this store.</div>') + `<div class="dgrid2"><div class="card"><b>Base stock</b>${base ? `<div class="rg"><span>Status</span><b>✓ Frozen (v${base.version})</b><span>Frozen on</span><b>${fdt(base.frozen_at)}</b><span>Rows</span><b>${fn(base.rows_valid)}</b>
        <span>Serialized</span><b>${fn(base.serialized_count)}</b><span>Non-serialized rows</span><b>${fn(base.non_serialized_count)}</b><span>Expected units</span><b>${fn(base.expected_units)}</b><span>Source file</span><b>${esc(base.source_file_name || '—')}</b></div>` : '<p class="muted">Not uploaded yet.</p>'}</div>
        <div class="card"><b>Audit</b>${L ? `<div class="rg"><span>Version</span><b>${L.version}</b><span>Started</span><b>${fdt(L.started_at)} by ${esc(who(L.started_by))}</b><span>Submitted</span><b>${L.submitted_at ? fdt(L.submitted_at) + ' by ' + esc(who(L.submitted_by)) : '—'}</b></div>` : '<p class="muted">Not started.</p>'}</div></div>`;
    } else if (tab === 'progress') {
      if (!L) { body.innerHTML = '<div class="card"><p class="muted">The store has not started its audit.</p></div>'; return; }
      const [c1, c2, ev] = await Promise.all([sb.from('audit_serial_scans').select('id', { count: 'exact', head: true }).eq('session_id', L.id), sb.from('audit_non_serial_entries').select('physical_qty').eq('session_id', L.id),
        sb.from('audit_events').select('event_type,created_at,user_id,metadata').eq('audit_cycle_id', cid).eq('store_id', sid).neq('event_type', 'SERIAL_SCANNED').order('created_at', { ascending: false }).limit(30)]);
      const ser = c1.count || 0, ent = (c2.data || []).length, units = ser + (c2.data || []).reduce((a, x) => a + Number(x.physical_qty), 0), exp = Number(base?.expected_units || 0), p = exp ? Math.min(100, Math.round(100 * units / exp)) : null;
      const uids = [...new Set((ev.data || []).map(e => e.user_id).filter(Boolean))].filter(i => !names[i]);
      if (uids.length) ((await sb.from('profiles').select('id,full_name').in('id', uids)).data || []).forEach(x => (names[x.id] = x.full_name));
      body.innerHTML = `<div class="kv"><div><span>Serialized scanned</span><b>${fn(ser)}</b></div><div><span>Non-serialized entries</span><b>${fn(ent)}</b></div><div><span>Total physical units</span><b>${fn(units)}</b></div><div><span>Base expected units</span><b>${fn(exp)}</b></div></div>
        ${p == null ? '' : `<div class="muted">Counted so far vs base: ${p}%</div><div class="hbar"><i style="flex:${p};background:#E40000"></i><i style="flex:${100 - p};background:#E5E7EB"></i></div>`}
        <h3>Recent events</h3><div class="card">${(ev.data || []).map(e => `<div class="act"><span class="muted">${fdt(e.created_at)}</span><span>${EVT[e.event_type] || esc(e.event_type)}${e.metadata && e.metadata.serial ? ' · ' + esc(e.metadata.serial) : ''}${e.metadata && e.metadata.item_code ? ' · ' + esc(e.metadata.item_code) : ''} <span class="muted">${esc(who(e.user_id))}</span></span></div>`).join('') || '<span class="muted">No events.</span>'}</div>`;
    } else if (tab === 'recon') {
      if (!locked()) { body.innerHTML = needLocked; return; } body.innerHTML = ''; await resultView(body, L.id, true);
    } else if (tab === 'serial' || tab === 'nonserial') { if (!locked()) { body.innerHTML = needLocked; return; } await variance(tab === 'serial'); }
    else if (tab === 'history') {
      body.innerHTML = `<div class="card">${sess.map(v => `<div class="hist"><b>Version ${v.version}</b>${v.status === 'REOPENED' ? ' ' + badge('Superseded') : ''}${v.reopened_at ? `<br>Reopened: ${fdt(v.reopened_at)} by ${esc(who(v.reopened_by))}<br>Reason: “${esc(v.reopen_reason)}”` : ''}
        <br>${v.submitted_at ? 'Submitted: ' + fdt(v.submitted_at) + ' by ' + esc(who(v.submitted_by)) : 'In progress (not yet submitted)'}</div>`).join('') || '<span class="muted">No audit yet.</span>'}</div>`;
    }
  }
  async function variance(isSerial) {
    let f = 'ALL', page = 0;
    async function draw() {
      let qb = sb.from('reconciliation_results').select('item_code,inventory_status,item_description,item_uom,item_quality,item_sno,expected_qty,physical_qty,matched_qty,short_qty,excess_qty,result,is_unlisted', { count: 'exact' })
        .eq('session_id', L.id).eq('is_serialized', isSerial); qb = f === 'ALL' ? qb.neq('result', 'MATCH') : qb.eq('result', f);
      const { data, error, count } = await qb.order('result').order('item_code').order('item_sno').range(page * PS, page * PS + PS - 1); if (error) throw error;
      let xs = {}; const ex = data.filter(r => r.result === 'EXCESS' && r.item_sno).map(r => r.item_sno);
      if (isSerial && ex.length) { const r = await sb.rpc('serial_cross_store', { p_cycle: cid, p_store: sid, p_serials: ex }); xs = r.data || {}; }
      const tabs = `<div class="tabs">${[['ALL', 'All variances'], ['SHORT', 'Short'], ['EXCESS', 'Excess']].map(t => `<button class="tab ${f === t[0] ? 'on' : ''}" data-f="${t[0]}">${t[1]}</button>`).join('')}</div>`;
      const head = isSerial ? ['Item code', 'Description', 'System serial', 'Physical serial', 'Expected', 'Physical', 'Variance', 'Status', 'Expected store', 'Current store'] : ['Item code', 'Inventory status', 'Description', 'UoM', 'Quality', 'Expected', 'Physical', 'Matched', 'Short', 'Excess', 'Result'];
      const rb = data.map(r => { const v = Number(r.physical_qty) - Number(r.expected_qty), rs = badge(r.result === 'SHORT' ? 'Short' : 'Excess', r.result === 'SHORT' ? 'bad' : 'warn');
        return isSerial ? `<tr><td><b>${esc(r.item_code)}</b></td><td>${esc(r.item_description || '')}</td><td>${r.result === 'SHORT' ? esc(r.item_sno) : '—'}</td><td>${r.result === 'EXCESS' ? esc(r.item_sno) : '—'}</td><td>${fn(r.expected_qty)}</td><td>${fn(r.physical_qty)}</td>
          <td class="${v < 0 ? 'neg' : 'pos'}">${v > 0 ? '+' : ''}${fn(v)}</td><td>${rs}${r.is_unlisted ? ' ' + badge('Unlisted', 'bad') : ''}</td><td>${r.result === 'EXCESS' ? esc(xs[r.item_sno] || 'Not in any store base') : '—'}</td><td>${esc(store.code)}</td></tr>`
          : `<tr><td><b>${esc(r.item_code)}</b></td><td>${esc(r.inventory_status || '')}</td><td>${esc(r.item_description || '')}</td><td>${esc(r.item_uom || '')}</td><td>${esc(r.item_quality || '')}</td><td>${fn(r.expected_qty)}</td><td>${fn(r.physical_qty)}</td><td>${fn(r.matched_qty)}</td>
          <td class="neg">${fn(r.short_qty)}</td><td class="pos">${fn(r.excess_qty)}</td><td>${rs}${r.is_unlisted ? ' ' + badge('Not in base', 'bad') : ''}</td></tr>`; }).join('');
      body.innerHTML = tabs + tbl(head, rb) + pager(count, page, PS);
      body.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { f = b.dataset.f; page = 0; draw().catch(e => toast(rpcMsg(e), 'err')); });
      body.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { page += Number(b.dataset.pg); draw().catch(e => toast(rpcMsg(e), 'err')); });
    }
    await draw();
  }
  el.onclick = e => { const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; show().catch(x => { body.innerHTML = `<div class="alert err">${esc(rpcMsg(x))}</div>`; }); }
    if (e.target.closest('#reopen')) reopenModal(L.id, store.name, reload); };
  await show();
};
