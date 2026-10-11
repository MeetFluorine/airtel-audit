// Admin / circle head: Dashboard, Store Audit (all stores), Store Detail (drill-down). Data comes from staff-scoped server functions.
const pct = v => v == null ? '—' : Number(v).toFixed(1) + '%';
const rateCls = r => r == null ? '' : r >= 90 ? 'ok' : r >= 75 ? 'warn' : 'bad';
const healthOf = r => r == null ? null : r >= 90 ? ['Healthy', 'ok'] : r >= 75 ? ['Warning', 'warn'] : ['Critical', 'bad'];
const HEALTH = { HEALTHY: 'ok', WARNING: 'warn', CRITICAL: 'bad', PENDING: '' };
const EVT = { AUDIT_STARTED: 'started the audit', AUDIT_SUBMITTED: 'audit submitted', AUDIT_REOPENED: 'audit reopened', BASE_FROZEN: 'base stock frozen', BASE_UPLOADED: 'base stock uploaded',
  SERIAL_DUPLICATE: 'duplicate scan', SERIAL_NOT_FOUND: 'serial not in store base', UNLISTED_SERIAL_ADDED: 'unlisted serial added', NON_SERIAL_ADDED: 'non-serialized added', ENTRY_REMOVED: 'entry removed',
  ENTRY_EDITED: 'entry edited', PREVIEW_OPENED: 'preview opened', AUDIT_LOCKED: 'audit locked', VALIDATION_FAILED: 'upload validation failed' };
const STATUS_LBL = { COMPLETED: ['Completed', 'ok'], IN_PROGRESS: ['In Progress', 'info'], NOT_STARTED: ['Not Started', 'warn'] };
const ago = d => { const m = Math.max(0, Math.round((Date.now() - new Date(d)) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' hour' + (Math.round(m / 60) === 1 ? '' : 's') + ' ago' : Math.round(m / 1440) + ' day' + (Math.round(m / 1440) === 1 ? '' : 's') + ' ago'; };
const pager = (count, page, PS) => `<div class="bar"><span class="muted">${fn(count)} row(s)</span><div class="row"><button class="btn sm" data-pg="-1" ${page ? '' : 'disabled'}>Previous</button><button class="btn sm" data-pg="1" ${(page + 1) * PS < count ? '' : 'disabled'}>Next</button></div></div>`;
const noCycle = el => { el.innerHTML = `<div class="card startcard"><span class="big">${ic('cal', 44, 1.5)}</span><h2>No audit cycle selected</h2><p class="muted">${S.profile.role === 'ADMIN' ? 'Create one with “+ New” in the Audit Cycle box on the left, then upload each store\'s base stock.' : 'Ask an administrator to create an audit cycle.'}</p></div>`; };
const numPager = (total, page, PS) => { const n = Math.max(1, Math.ceil(total / PS)); const from = total ? page * PS + 1 : 0, to = Math.min(total, (page + 1) * PS);
  return `<div class="bar"><span class="muted">Showing ${from}–${to} of ${total}</span><div class="pg"><button data-np="${page - 1}" ${page ? '' : 'disabled'}>‹</button>${Array.from({ length: Math.min(n, 5) }, (_, i) => { const p = Math.min(Math.max(page - 2, 0), Math.max(n - 5, 0)) + i; return `<button data-np="${p}" class="${p === page ? 'on' : ''}">${p + 1}</button>`; }).join('')}<button data-np="${page + 1}" ${page + 1 < n ? '' : 'disabled'}>›</button></div></div>`; };

function donut(parts, label, sub) {
  const total = parts.reduce((a, p) => a + p.v, 0), R = 40, C = 2 * Math.PI * R; let off = 0;
  const segs = parts.filter(p => p.v > 0).map(p => { const len = total ? C * p.v / total : 0; const s = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${p.color}" stroke-width="16" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`; off += len; return s; }).join('');
  return `<svg viewBox="0 0 120 120" width="140" height="140" role="img" aria-label="${esc(sub)}"><circle cx="60" cy="60" r="${R}" fill="none" stroke="#EEF3F1" stroke-width="16"/>${segs}<text x="60" y="60" text-anchor="middle" font-size="21" font-weight="800" fill="#0B2A1F">${esc(label)}</text><text x="60" y="76" text-anchor="middle" font-size="9" fill="#6B7B75">${esc(sub)}</text></svg>`;
}
function donutArgs(a) { return a; }   // (kept for readability)

function trendSvg(tr) {
  const W = 600, H = 230, L = 38, Rr = 40, T = 12, B = 30, pw = W - L - Rr, ph = H - T - B, n = Math.max(tr.length, 1), stores = Math.max(1, ...tr.map(x => Number(x.stores) || 0)), bw = Math.min(40, pw / n * .5);
  const x = i => L + pw / n * (i + .5), y = v => T + ph - ph * v / stores, yp = v => T + ph - ph * v / 100;
  let g = ''; for (let k = 0; k <= 4; k++) { const yy = T + ph * k / 4; g += `<line x1="${L}" x2="${W - Rr}" y1="${yy}" y2="${yy}" stroke="#EEF3F1"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#6B7B75">${Math.round(stores * (1 - k / 4))}</text><text x="${W - Rr + 6}" y="${yy + 4}" font-size="10" fill="#6B7B75">${100 - k * 25}%</text>`; }
  const bars = tr.map((r, i) => { const c = Number(r.completed), p = Number(r.in_progress), ns = Math.max(0, Number(r.stores) - c - p); let yy = y(0), out = '';
    [[c, '#16A34A'], [p, '#2563EB'], [ns, '#F5B301']].forEach(([v, col]) => { const h = ph * v / stores; yy -= h; if (v > 0) out += `<rect x="${x(i) - bw / 2}" y="${yy}" width="${bw}" height="${h}" fill="${col}" opacity=".9" rx="2"/>`; });
    return out + `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="10" fill="#6B7B75">${esc(String(r.name).slice(0, 9))}</text>`; }).join('');
  const pts = tr.map((r, i) => Number(r.expected) > 0 ? [x(i), yp(100 * Number(r.matched) / Number(r.expected))] : null).filter(Boolean);
  const line = pts.length ? `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#F5B301" stroke-width="2.4"/>${pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3.6" fill="#fff" stroke="#F5B301" stroke-width="2"/>`).join('')}` : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Audit trend">${g}${bars}${line}</svg>`;
}
const delta = (cur, prev, lowerIsBetter) => { if (prev == null) return ''; cur = Number(cur); prev = Number(prev); if (!prev) return cur ? `<span class="up">↑ new</span> vs last cycle` : '<span class="muted">same as last cycle</span>';
  const d = (cur - prev) / prev * 100, good = lowerIsBetter ? d <= 0 : d >= 0; return `<span class="${good ? 'dn' : 'up'}">${d <= 0 ? '↓' : '↑'} ${Math.abs(d).toFixed(1)}%</span> vs last cycle`; };

PAGES.dashboard = async el => isStaff() ? adminDash(el) : storeDash(el);

async function adminDash(el) {
  if (!S.cycleId) return noCycle(el);
  const cid = S.cycleId;
  const [o, s, t] = await Promise.all([sb.rpc('dash_overview', { p_cycle: cid }), sb.rpc('dash_stores', { p_cycle: cid }), sb.rpc('dash_trend', { p_cycle: cid, p_limit: 6 })]);
  if (o.error) throw o.error; if (s.error) throw s.error; if (t.error) throw t.error;
  const T = o.data.totals, I = o.data.integrity, trend = t.data, prev = trend.length > 1 ? trend[trend.length - 2] : null, done = s.data.filter(r => r.audit_status === 'COMPLETED');
  const hb = { h: done.filter(r => r.match_rate >= 90).length, w: done.filter(r => r.match_rate >= 75 && r.match_rate < 90).length, c: done.filter(r => r.match_rate < 75).length };
  const stp = k => T.stores ? (100 * T[k] / T.stores).toFixed(1) : '0.0';
  const tl = (i, bg, fg) => `<span class="tile" style="background:${bg};color:${fg}">${ic(i, 18)}</span>`;
  const sc = (label, icon, bg, fg, val, k, col) => `<div class="card kcard"><div class="kt">${tl(icon, bg, fg)}${label}</div><div class="kv1"><b>${val}</b>${k ? `<span style="color:${fg}">${stp(k)}%</span>` : ''}</div>${k ? `<div class="mini"><i style="width:${stp(k)}%;background:${col}"></i></div>` : ''}</div>`;
  const prevRate = prev && Number(prev.expected) > 0 ? 100 * Number(prev.matched) / Number(prev.expected) : null;
  const EV = { AUDIT_SUBMITTED: ['user', '#E8F8EE', '#16A34A'], AUDIT_STARTED: ['play', '#E8EFFF', '#2563EB'], AUDIT_REOPENED: ['alert', '#FDECEC', '#E5484D'], BASE_FROZEN: ['lock', '#FFF4CC', '#C58A00'] };
  const act = o.data.activity.map(a => { const e = EV[a.event_type] || ['info', '#EEF3F1', '#44564F']; return `<div class="actrow">${tl(e[0], e[1], e[2])}<span><a href="#/storedetail?s=${a.store_id}" style="color:#0F1F1A"><b>${esc(a.store_code || '')}</b></a> <span class="muted">${EVT[a.event_type] || esc(a.event_type)}</span></span><span class="when">${ago(a.created_at)}</span></div>`; }).join('') || '<div class="muted">No activity yet.</div>';
  const heads = o.data.heads.map(h => `<div class="card kcard ${h.status === 'CRITICAL' ? 'tint-r' : ''}"><div class="cardhead" style="margin:0"><b>${esc(h.label)}</b>${badge(h.status, HEALTH[h.status])}</div><span class="muted">${h.circles.map(esc).join(' / ')}</span><div class="kv1"><b>${pct(h.match_rate)}</b><span class="muted">match rate</span></div>
      <div class="hrow"><span>${h.completed}/${h.stores} stores</span><span class="neg">Short ${fn(h.short)}</span><span class="pos">Excess ${fn(h.excess)}</span></div></div>`).join('');
  const tile = (l, v) => `<div class="${Number(v) ? 'a' : ''}"><span>${l}</span><b>${fn(v)}</b></div>`;
  el.innerHTML = `<div class="kgrid4">${sc('Total Stores', 'grid', '#E6F7EC', '#16A34A', T.stores, null)}${sc('Completed', 'check', '#E6F7EC', '#16A34A', T.completed, 'completed', '#16A34A')}${sc('In Progress', 'sync', '#E5EDFF', '#2563EB', T.in_progress, 'in_progress', '#2563EB')}${sc('Not Started', 'alert', '#FFF1CC', '#C58A00', T.not_started, 'not_started', '#F5B301')}</div>
    <div class="kgrid3"><div class="card kcard tint-r"><div class="kt">${tl('alert', '#FFE0E0', '#E5484D')}Total Short Units</div><div class="kv1"><b>${fn(T.short)}</b></div><div class="cmp">${delta(T.short, prev ? prev.short : null, true)}</div></div>
      <div class="card kcard tint-r"><div class="kt">${tl('box', '#FFE0E0', '#E5484D')}Total Excess Units</div><div class="kv1"><b>${fn(T.excess)}</b></div><div class="cmp">${delta(T.excess, prev ? prev.excess : null, true)}</div></div>
      <div class="card kcard tint-b"><div class="kt">${tl('target', '#E0E8FF', '#2563EB')}Overall Match Rate</div><div class="kv1"><b>${pct(T.match_rate)}</b></div><div class="cmp muted">${prevRate == null ? 'No earlier cycle to compare' : 'vs ' + prevRate.toFixed(1) + '% last cycle'}</div></div></div>
    <div class="dash2"><div class="card trend"><h3>Audit Trend (Last 6 Cycles)</h3><div class="legend3"><span><i style="background:#16A34A"></i>Completed</span><span><i style="background:#2563EB"></i>In Progress</span><span><i style="background:#F5B301"></i>Not Started / Match Rate %</span></div>${trendSvg(trend)}</div>
      <div class="card trend"><div class="cardhead"><b>Recent Activity</b><a href="#/logs">View All →</a></div>${act}</div></div>
    <h3>Circle head summary</h3><div class="kgrid3">${heads || '<div class="muted">No circle heads or circles to show.</div>'}</div>
    <div class="dash2" style="grid-template-columns:1fr 1fr;margin-top:14px"><div class="card trend"><b>Store status</b><div class="dflex">${donut([{ v: T.completed, color: '#16A34A' }, { v: T.in_progress, color: '#2563EB' }, { v: T.not_started, color: '#E5E7EB' }], String(T.stores), 'stores')}
        <div class="legend"><div><i style="background:#16A34A"></i>Completed <b>${T.completed}</b></div><div><i style="background:#2563EB"></i>In progress <b>${T.in_progress}</b></div><div><i style="background:#E5E7EB"></i>Not started <b>${T.not_started}</b></div></div></div>
        <div class="muted" style="margin-top:8px">Audit health (completed stores)</div><div class="hbar">${hb.h + hb.w + hb.c ? `<i style="flex:${hb.h};background:#16A34A"></i><i style="flex:${hb.w};background:#F5B301"></i><i style="flex:${hb.c};background:#DC2626"></i>` : '<i style="flex:1;background:#E5E7EB"></i>'}</div><div class="muted">Healthy ${hb.h} · Warning ${hb.w} · Critical ${hb.c}</div><p class="muted" style="margin-bottom:0">Base stock frozen for ${T.base_frozen} of ${T.stores} stores.</p></div>
      <div class="card trend"><b>Audit integrity</b><div class="kv integ">${tile('Duplicate scan attempts', I.duplicates)}${tile('Unlisted serials', I.unlisted)}${tile('Excess units', T.excess)}${tile('Short units', T.short)}${tile('Reopened audits', I.reopened)}${tile('Edited entries', I.edited)}${tile('Failed validation attempts', I.failed_validation)}</div>
        <div class="muted">Failed validation = serials not found in the store base + rejected base uploads.</div></div></div>`;
}

/* ================= STORE AUDIT (all stores) ================= */
PAGES.storeaudit = async el => {
  if (!S.cycleId) return noCycle(el);
  const cid = S.cycleId, { data: rows, error } = await sb.rpc('dash_stores', { p_cycle: cid }); if (error) throw error;
  const F = { circle: '', status: '', rate: '', variance: '', q: '', tab: 'ALL', page: 0 }; const PS = 10;
  const crit = r => r.audit_status === 'COMPLETED' && r.match_rate != null && r.match_rate < 75;
  const list = () => rows.filter(r => (!F.circle || r.circle === F.circle) && (!F.status || r.audit_status === F.status) && (!F.q || (r.name + ' ' + r.code + ' ' + r.circle).toLowerCase().includes(F.q))
    && (!F.rate || (r.match_rate != null && (F.rate === 'crit' ? r.match_rate < 75 : F.rate === 'warn' ? r.match_rate >= 75 && r.match_rate < 90 : r.match_rate >= 90)))
    && (!F.variance || (F.variance === 'short' ? Number(r.short) > 0 : Number(r.excess) > 0))
    && (F.tab === 'ALL' || (F.tab === 'CRIT' ? crit(r) : r.audit_status === F.tab)));
  const cnt = k => k === 'ALL' ? rows.length : k === 'CRIT' ? rows.filter(crit).length : rows.filter(r => r.audit_status === k).length;
  const sel = (id, label, opts, cur) => `<div><label>${label}</label><select id="${id}">${opts.map(o => `<option value="${o[0]}" ${o[0] === cur ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>`;
  function table() {
    const l = list(), pageRows = l.slice(F.page * PS, F.page * PS + PS);
    return tbl(['Store Name', 'Circle', 'Status', 'Match Rate', 'Physical Found', 'Short', 'Excess', 'Last Updated', 'Action'], pageRows.map(r => { const s = crit(r) ? ['Critical', 'bad'] : STATUS_LBL[r.audit_status];
      return `<tr><td><b>${esc(r.name)}</b><br><span class="muted">${esc(r.code)}</span></td><td>${esc(r.circle)}</td><td>${badge(s[0], s[1])}</td><td>${r.match_rate == null ? '—' : `<b class="${r.match_rate < 75 ? 'neg' : ''}">${pct(r.match_rate)}</b>`}</td><td>${r.physical == null ? '—' : fn(r.physical)}</td>
        <td class="${Number(r.short) ? 'neg' : ''}">${r.short == null ? '—' : fn(r.short)}</td><td class="${Number(r.excess) ? 'pos' : ''}">${r.excess == null ? '—' : fn(r.excess)}</td><td class="nw">${r.last_updated ? fdt(r.last_updated) : '—'}</td><td><a class="eyeb" href="#/storedetail?s=${r.store_id}" title="Open store">${ic('eye', 17)}</a></td></tr>`; }).join('')) + numPager(l.length, F.page, PS);
  }
  el.innerHTML = `<div class="filters"><span style="flex:1"></span><button class="btn yel" id="exp">${ic('dl', 16)} Export</button></div>
    <div class="card" style="padding:16px"><div class="filters">${sel('f_ci', 'Circle', [['', 'All Circles'], ...[...new Set(rows.map(r => r.circle))].sort().map(c => [c, c])], F.circle)}${sel('f_st', 'Store Status', [['', 'All Status'], ['COMPLETED', 'Completed'], ['IN_PROGRESS', 'In Progress'], ['NOT_STARTED', 'Not Started']], F.status)}
      ${sel('f_ra', 'Match Rate', [['', 'All'], ['crit', 'Critical (< 75%)'], ['warn', 'Warning (75–90%)'], ['ok', 'Healthy (≥ 90%)']], F.rate)}${sel('f_va', 'Variance', [['', 'All'], ['short', 'Has short units'], ['excess', 'Has excess units']], F.variance)}
      <div style="flex:1;min-width:240px"><label>Search</label><div class="inp">${ic('search', 18)}<input id="f_q" placeholder="Search store name or circle... (Enter on an item code or serial to find it)"></div></div></div>
      <div class="tabs seg" id="tabs" style="margin-bottom:12px">${[['ALL', 'All Stores'], ['COMPLETED', 'Completed'], ['IN_PROGRESS', 'In Progress'], ['NOT_STARTED', 'Not Started'], ['CRIT', 'Critical']].map(t => `<button class="tab ${t[0] === F.tab ? 'on' : ''} ${t[0] === 'CRIT' ? 'red' : ''}" data-tab="${t[0]}">${t[1]} (${cnt(t[0])})</button>`).join('')}</div>
      <div id="found"></div><div id="tbl">${table()}</div></div>`;
  const redraw = () => { el.querySelector('#tbl').innerHTML = table(); el.querySelectorAll('#tabs [data-tab]').forEach(b => { b.classList.toggle('on', b.dataset.tab === F.tab); const t = b.textContent.replace(/\(\d+\)/, `(${cnt(b.dataset.tab)})`); b.textContent = t; }); };
  async function find() {
    const q = el.querySelector('#f_q').value.trim(), out = el.querySelector('#found'); if (q.length < 3) { out.innerHTML = ''; return; }
    const { data, error } = await sb.rpc('dash_search', { p_cycle: cid, p_q: q }); if (error) { out.innerHTML = `<div class="alert err">${esc(rpcMsg(error))}</div>`; return; }
    out.innerHTML = data.length ? `<b>Item / serial matches</b>` + tbl(['Found in', 'Store', 'Item code', 'Serial', 'Description'], data.map(x => `<tr><td>${badge(x.source, x.source === 'Scanned' ? 'info' : '')}</td><td><a href="#/storedetail?s=${x.store_id}">${esc(x.store_code)}</a></td><td>${esc(x.item_code)}</td><td>${esc(x.serial || '—')}</td><td>${esc(x.item_description || '')}</td></tr>`).join('')) : '<div class="muted" style="margin-bottom:10px">No item or serial matches.</div>';
  }
  el.onchange = e => { const m = { f_ci: 'circle', f_st: 'status', f_ra: 'rate', f_va: 'variance' }[e.target.id]; if (m) { F[m] = e.target.value; F.page = 0; redraw(); } };
  el.oninput = e => { if (e.target.id === 'f_q') { F.q = e.target.value.trim().toLowerCase(); F.page = 0; redraw(); } };
  el.onkeydown = e => { if (e.key === 'Enter' && e.target.id === 'f_q') find(); };
  el.onclick = e => { const t = e.target.closest('[data-tab]'); if (t) { F.tab = t.dataset.tab; F.page = 0; return redraw(); } const p = e.target.closest('[data-np]'); if (p) { F.page = Number(p.dataset.np); redraw(); }
    const x = e.target.closest('#exp'); if (x) busy(x, () => downloadReport('store_summary', cid, F.circle ? null : null, null, false)).catch(err => toast(rpcMsg(err), 'err')); };
};

/* ================= STORE DETAIL (drill-down) ================= */
PAGES.storedetail = async el => {
  if (!isStaff()) { el.innerHTML = '<div class="card startcard"><h2>Not available</h2></div>'; return; }
  const hq = new URLSearchParams(location.hash.split('?')[1] || ''), sid = hq.get('s'), cid = hq.get('c') || S.cycleId, cyc = S.cycles.find(c => c.id === cid) || { name: S.cycleName };
  const [st, ss, up] = await Promise.all([sb.from('stores').select('id,code,name,store_type,locator,circles(code,name)').eq('id', sid).maybeSingle(),
    sb.from('audit_sessions').select('id,version,status,started_by,started_at,submitted_by,submitted_at,reopened_by,reopened_at,reopen_reason,expected_units,physical_units,matched_units,short_units,excess_units').eq('audit_cycle_id', cid).eq('store_id', sid).order('version'),
    sb.from('base_stock_uploads').select('version,rows_valid,serialized_count,non_serialized_count,expected_units,frozen_at,source_file_name').eq('audit_cycle_id', cid).eq('store_id', sid).eq('status', 'FROZEN').maybeSingle()]);
  if (!st.data) { el.innerHTML = '<div class="card startcard"><h2>Store not found</h2><p class="muted">It may be outside your circles.</p><a class="btn" href="#/storeaudit">← Back to List</a></div>'; return; }
  if (ss.error) throw ss.error;
  const store = st.data, sess = ss.data, base = up.data, L = sess.filter(x => x.status !== 'REOPENED').slice(-1)[0] || null, locked = L && L.status === 'LOCKED';
  const ids = [...new Set(sess.flatMap(x => [x.started_by, x.submitted_by, x.reopened_by]).filter(Boolean))];
  const names = ids.length ? Object.fromEntries(((await sb.from('profiles').select('id,full_name').in('id', ids)).data || []).map(p => [p.id, p.full_name])) : {};
  const who = id => id ? (names[id] || 'Administrator') : '—';
  const rate = locked && L.expected_units > 0 ? Math.round(1000 * L.matched_units / L.expected_units) / 10 : null, hl = healthOf(rate);
  const stat = !L ? badge('Not started') : locked ? (hl ? badge(hl[0], hl[1]) : badge('Completed', 'ok')) : badge('In progress', 'info');
  let tab = 'overview'; const PS = 50;
  el.innerHTML = `<div class="sdhead"><div><a class="btn sm" href="#/storeaudit" style="margin-bottom:10px">${ic('back', 15)} Back to List</a><div style="display:flex;align-items:center;gap:12px"><h1 style="margin:0">${esc(store.code)}</h1>${stat}</div>
      <p class="muted" style="margin:4px 0 0">${esc(store.circles?.code || '')} Circle &nbsp;|&nbsp; ${esc(store.store_type || '—')} Store &nbsp;|&nbsp; Audit Cycle: ${esc(cyc.name)}</p></div>
      <div class="row">${locked ? `<a class="btn" href="#/result?sess=${L.id}">${ic('clip', 16)} Full reconciliation</a><button class="btn danger-o" id="reopen">Reopen audit</button>` : ''}<a class="btn" href="#/basestock?s=${sid}">${base ? 'Revise base stock' : 'Upload base stock'}</a>
        <button class="btn yel" id="dlr" ${locked ? '' : 'disabled'}>${ic('dl', 16)} Download Report</button></div></div>
    <div class="tabs seg" id="tabs" style="margin-bottom:14px">${[['overview', 'Overview'], ['variance', 'Variance Details'], ['serial', 'Serialized Items'], ['nonserial', 'Non-Serialized Items'], ['history', 'Audit History']].map(t => `<button class="tab ${t[0] === tab ? 'on' : ''}" data-tab="${t[0]}">${t[1]}</button>`).join('')}</div><div id="tabbody"></div>`;
  const body = el.querySelector('#tabbody'), reload = () => PAGES.storedetail(el), needLocked = '<div class="card" style="padding:20px"><p class="muted" style="margin:0">Available once the store submits its audit.</p></div>';
  const tl = (i, bg, fg) => `<span class="tile" style="background:${bg};color:${fg}">${ic(i, 18)}</span>`;

  async function show() {
    el.querySelectorAll('#tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab)); body.innerHTML = '<div class="boot">Loading…</div>';
    if (tab === 'overview') {
      let vb = { ser_short: 0, ser_excess: 0, non_short: 0, non_excess: 0 }, issues = [], units = 0, pend = null;
      if (locked) { const [a, b] = await Promise.all([sb.rpc('store_variance_breakdown', { p_session: L.id }), sb.from('reconciliation_results').select('item_code,item_description,is_serialized,expected_qty,physical_qty,short_qty,result').eq('session_id', L.id).neq('result', 'MATCH').order('short_qty', { ascending: false }).limit(5)]); vb = a.data || vb; issues = b.data || []; }
      else if (L) { const [c1, c2] = await Promise.all([sb.from('audit_serial_scans').select('id', { count: 'exact', head: true }).eq('session_id', L.id), sb.from('audit_non_serial_entries').select('physical_qty').eq('session_id', L.id)]); units = (c1.count || 0) + (c2.data || []).reduce((a, x) => a + Number(x.physical_qty), 0); }
      const exp = Number(base?.expected_units || 0), prog = locked ? 100 : exp ? Math.min(100, Math.round(100 * units / exp)) : 0, mx = Math.max(1, vb.ser_short, vb.ser_excess, vb.non_short, vb.non_excess);
      const kc = (l, i, bg, fg, v, cls = '') => `<div class="card kcard ${cls}"><div class="kt">${tl(i, bg, fg)}${l}</div><div class="kv1"><b>${v}</b></div></div>`;
      const vr = (l, v, col) => `<div class="vbar"><span>${l}</span><div class="tr"><i style="width:${100 * v / mx}%;background:${col}"></i></div><b>${fn(v)}</b></div>`;
      body.innerHTML = `<div class="kgrid4" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">${kc('Match Rate', 'target', '#FFE0E0', '#E5484D', rate == null ? '—' : pct(rate), rate != null && rate < 75 ? 'tint-r' : rate != null && rate >= 90 ? 'tint-g' : '')}${kc('Base Items', 'box', '#E5EDFF', '#2563EB', fn(exp), 'tint-b')}${kc('Physical Found', 'check', '#E6F7EC', '#16A34A', fn(locked ? L.physical_units : units), 'tint-g')}${kc('Short', 'alert', '#FFE0E0', '#E5484D', locked ? fn(L.short_units) : '—', 'tint-r')}${kc('Excess', 'zap', '#FFF1CC', '#C58A00', locked ? fn(L.excess_units) : '—', 'tint-y')}</div>
        <div class="dgrid2"><div class="card" style="padding:18px"><b>Variance by Type</b>${locked ? vr('Serialized Short', vb.ser_short, '#E5484D') + vr('Non-Serialized Short', vb.non_short, '#F59E0B') + vr('Serialized Excess', vb.ser_excess, '#2563EB') + vr('Non-Serialized Excess', vb.non_excess, '#14B8A6') : '<p class="muted">Shown after the audit is submitted.</p>'}</div>
          <div class="card" style="padding:18px"><div class="cardhead"><b>Audit Progress</b>${L ? badge(locked ? 'Completed' : 'In Progress', locked ? 'ok' : 'info') : badge('Not started')}</div><div class="muted">${L ? (locked ? 'Submitted on ' + fdt(L.submitted_at) : 'Started on ' + fdt(L.started_at)) : 'The store has not started its audit.'}</div>
            <div class="hbar" style="height:10px"><i style="flex:${prog};background:#16A34A"></i><i style="flex:${100 - prog};background:#E5E7EB"></i></div><div class="muted">${locked ? 'Version ' + L.version + ' · base ' + fn(exp) + ' units' : 'Counted so far: ' + fn(units) + ' of ' + fn(exp) + ' base units (' + prog + '%)'}</div>
            <a class="btn" style="margin-top:12px" href="#/logs?store=${sid}">${ic('file', 16)} View Audit Log</a></div></div>
        <div class="card" style="padding:18px;margin-top:14px"><b>Recent Issues</b>${tbl(['Item Code', 'Description', 'Type', 'Expected', 'Physical', 'Variance', 'Status'], issues.map(r => { const v = Number(r.physical_qty) - Number(r.expected_qty), sev = r.result === 'SHORT' && Number(r.expected_qty) > 0 && Number(r.short_qty) / Number(r.expected_qty) >= .5;
          return `<tr><td><b>${esc(r.item_code)}</b></td><td>${esc(r.item_description || '')}</td><td>${r.result === 'SHORT' ? 'Short' : 'Excess'}</td><td>${fn(r.expected_qty)}</td><td>${fn(r.physical_qty)}</td><td class="${v < 0 ? 'neg' : 'pos'}">${v > 0 ? '+' : ''}${fn(v)}</td><td>${badge(r.result === 'SHORT' ? (sev ? 'Critical' : 'High') : 'Excess', r.result === 'SHORT' ? 'bad' : 'warn')}</td></tr>`; }).join(''))}</div>`;
    } else if (tab === 'variance' || tab === 'serial' || tab === 'nonserial') { if (!locked) { body.innerHTML = needLocked; return; } await variance(tab); }
    else if (tab === 'history') {
      const ev = await sb.from('audit_events').select('event_type,created_at,user_id,metadata').eq('audit_cycle_id', cid).eq('store_id', sid).neq('event_type', 'SERIAL_SCANNED').order('created_at', { ascending: false }).limit(30);
      const uids = [...new Set((ev.data || []).map(e => e.user_id).filter(Boolean))].filter(i => !names[i]); if (uids.length) ((await sb.from('profiles').select('id,full_name').in('id', uids)).data || []).forEach(x => (names[x.id] = x.full_name));
      body.innerHTML = `<div class="card" style="padding:18px"><b>Versions</b>${sess.map(v => `<div class="hist"><b>Version ${v.version}</b>${v.status === 'REOPENED' ? ' ' + badge('Superseded') : ''}${v.reopened_at ? `<br>Reopened: ${fdt(v.reopened_at)} by ${esc(who(v.reopened_by))}<br>Reason: “${esc(v.reopen_reason)}”` : ''}<br>${v.submitted_at ? 'Submitted: ' + fdt(v.submitted_at) + ' by ' + esc(who(v.submitted_by)) : 'In progress (not yet submitted)'}</div>`).join('') || '<div class="muted">No audit yet.</div>'}</div>
        <div class="card" style="padding:18px;margin-top:14px"><b>Recent events</b>${(ev.data || []).map(e => `<div class="act"><span class="muted">${fdt(e.created_at)}</span><span>${EVT[e.event_type] || esc(e.event_type)}${e.metadata && e.metadata.serial ? ' · ' + esc(e.metadata.serial) : ''}${e.metadata && e.metadata.item_code ? ' · ' + esc(e.metadata.item_code) : ''} <span class="muted">${esc(who(e.user_id))}</span></span></div>`).join('') || '<div class="muted">No events.</div>'}</div>`;
    }
  }
  async function variance(kind) {
    let f = 'ALL', page = 0;
    async function draw() {
      let qb = sb.from('reconciliation_results').select('item_code,inventory_status,item_description,item_uom,item_quality,item_sno,expected_qty,physical_qty,matched_qty,short_qty,excess_qty,result,is_unlisted,is_serialized', { count: 'exact' }).eq('session_id', L.id);
      if (kind === 'serial') qb = qb.eq('is_serialized', true); if (kind === 'nonserial') qb = qb.eq('is_serialized', false); qb = f === 'ALL' ? qb.neq('result', 'MATCH') : qb.eq('result', f);
      const { data, error, count } = await qb.order('result').order('item_code').order('item_sno').range(page * PS, page * PS + PS - 1); if (error) throw error;
      let xs = {}; const ex = data.filter(r => r.result === 'EXCESS' && r.item_sno).map(r => r.item_sno);
      if (kind !== 'nonserial' && ex.length) { const r = await sb.rpc('serial_cross_store', { p_cycle: cid, p_store: sid, p_serials: ex }); xs = r.data || {}; }
      const ft = `<div class="tabs seg" style="margin-bottom:12px">${[['ALL', 'All variances'], ['SHORT', 'Short'], ['EXCESS', 'Excess']].map(t => `<button class="tab ${f === t[0] ? 'on' : ''}" data-f="${t[0]}">${t[1]}</button>`).join('')}</div>`;
      const rs = r => badge(r.result === 'SHORT' ? 'Short' : 'Excess', r.result === 'SHORT' ? 'bad' : 'warn');
      let head, rb;
      if (kind === 'nonserial') { head = ['Item code', 'Inventory status', 'Description', 'UoM', 'Quality', 'Expected', 'Physical', 'Matched', 'Short', 'Excess', 'Result'];
        rb = data.map(r => `<tr><td><b>${esc(r.item_code)}</b></td><td>${esc(r.inventory_status || '')}</td><td>${esc(r.item_description || '')}</td><td>${esc(r.item_uom || '')}</td><td>${esc(r.item_quality || '')}</td><td>${fn(r.expected_qty)}</td><td>${fn(r.physical_qty)}</td><td>${fn(r.matched_qty)}</td><td class="neg">${fn(r.short_qty)}</td><td class="pos">${fn(r.excess_qty)}</td><td>${rs(r)}${r.is_unlisted ? ' ' + badge('Not in base', 'bad') : ''}</td></tr>`).join(''); }
      else { head = ['Item code', 'Description', ...(kind === 'variance' ? ['Type'] : []), 'System serial', 'Physical serial', 'Expected', 'Physical', 'Variance', 'Status', 'Expected store', 'Current store'];
        rb = data.map(r => { const v = Number(r.physical_qty) - Number(r.expected_qty); return `<tr><td><b>${esc(r.item_code)}</b></td><td>${esc(r.item_description || '')}</td>${kind === 'variance' ? `<td>${r.is_serialized ? 'Serialized' : 'Non-Serialized'}</td>` : ''}<td>${r.is_serialized && r.result === 'SHORT' ? esc(r.item_sno) : '—'}</td><td>${r.is_serialized && r.result === 'EXCESS' ? esc(r.item_sno) : '—'}</td>
          <td>${fn(r.expected_qty)}</td><td>${fn(r.physical_qty)}</td><td class="${v < 0 ? 'neg' : 'pos'}">${v > 0 ? '+' : ''}${fn(v)}</td><td>${rs(r)}${r.is_unlisted ? ' ' + badge('Unlisted', 'bad') : ''}</td><td>${r.is_serialized && r.result === 'EXCESS' ? esc(xs[r.item_sno] || 'Not in any store base') : '—'}</td><td>${esc(store.code)}</td></tr>`; }).join(''); }
      body.innerHTML = ft + tbl(head, rb) + pager(count, page, PS);
      body.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { f = b.dataset.f; page = 0; draw().catch(e => toast(rpcMsg(e), 'err')); });
      body.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { page += Number(b.dataset.pg); draw().catch(e => toast(rpcMsg(e), 'err')); });
    }
    await draw();
  }
  el.onclick = e => { const t = e.target.closest('#tabs [data-tab]'); if (t) { tab = t.dataset.tab; show().catch(x => { body.innerHTML = `<div class="alert err">${esc(rpcMsg(x))}</div>`; }); }
    if (e.target.closest('#reopen')) reopenModal(L.id, store.name, reload);
    const d = e.target.closest('#dlr'); if (d && locked) busy(d, () => downloadReport('variance', cid, null, sid, false)).catch(x => toast(rpcMsg(x), 'err')); };
  await show();
};
