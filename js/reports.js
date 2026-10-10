// Phase 6: Reports (Excel export) and Audit Logs. Staff only; data comes from scoped server functions, so a Circle Head only ever receives their own circles.
const REPORTS = {
  variance: { title: 'Consolidated Variance', desc: 'Short and excess records across stores (exceptions only by default)', variance: true,
    head: ['Audit Cycle', 'Circle', 'Store', 'Item Code', 'Inventory Status', 'Item Description', 'UOM', 'Quality', 'System Serial', 'Physical Serial', 'Expected Qty', 'Physical Qty', 'Matched Qty', 'Short Qty', 'Excess Qty', 'Variance Type', 'Audit Date', 'Submitted By'] },
  store_summary: { title: 'Store Summary', desc: 'One row per store: expected, physical, short, excess, match rate',
    head: ['Audit Cycle', 'Circle', 'Store Code', 'Store Name', 'Expected Units', 'Physical Units', 'Matched Units', 'Short Units', 'Excess Units', 'Match Rate %', 'Audit Status', 'Version', 'Last Updated', 'Submitted By'] },
  circle_summary: { title: 'Circle Summary', desc: 'One row per circle with its circle head and health status',
    head: ['Audit Cycle', 'Circle', 'Circle Head', 'Stores', 'Completed', 'In Progress', 'Not Started', 'Expected Units', 'Physical Units', 'Matched Units', 'Short Units', 'Excess Units', 'Match Rate %', 'Status'] },
  serial: { title: 'Serialized Variance', desc: 'Missing and unlisted serial numbers', variance: true, get head() { return REPORTS.variance.head; } },
  nonserial: { title: 'Non-Serialized Variance', desc: 'Short and excess quantities by item', variance: true, get head() { return REPORTS.variance.head; } },
  history: { title: 'Audit History', desc: 'Every audit version, including reopens and reasons',
    head: ['Audit Cycle', 'Circle', 'Store', 'Version', 'Status', 'Started By', 'Started At', 'Submitted By', 'Submitted At', 'Reopened By', 'Reopened At', 'Reopen Reason'] }
};
const LOG_LBL = Object.assign({}, EVT, { LOGIN: 'logged in', USER_APPROVED: 'user approved', USER_REJECTED: 'user rejected', USER_STORE_CHANGED: 'user store changed', REPORT_EXPORTED: 'report exported',
  STORE_REPORT_NAME_SET: 'store report name set', BASE_UPLOAD_WARNING: 'base upload warning', CYCLE_DELETED: 'cycle deleted' });
const slug = s => String(s || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
const staffOnly = el => { if (S.profile.role === 'STORE_USER') { el.innerHTML = '<div class="card"><h2>Not available</h2></div>'; return true; } return false; };

/* ================= REPORTS ================= */
PAGES.reports = async el => {
  if (staffOnly(el)) return;
  const [cyc, circles, stores] = await Promise.all([sb.from('audit_cycles').select('id,name,status').order('created_at', { ascending: false }), getCircles(), getStores()]);
  if (cyc.error) throw cyc.error;
  if (!cyc.data.length) { el.innerHTML = '<div class="card"><h2>No audit cycle yet</h2><p class="muted">Reports appear once a cycle has audits.</p></div>'; return; }
  const st = { rep: 'variance', cycle: sessionStorage.getItem('sfx_cycle') || '', circle: '', store: '', inc: false, page: 0 }; const PS = 50;
  if (!cyc.data.some(c => c.id === st.cycle)) st.cycle = (cyc.data.find(c => c.status === 'ACTIVE') || cyc.data[0]).id;
  const cname = () => (cyc.data.find(c => c.id === st.cycle) || {}).name || '';
  el.innerHTML = `<div class="reptiles" id="tiles"></div><div class="card sec"><div class="row">
      <div><label>Audit cycle</label><select id="f_cy">${cyc.data.map(c => `<option value="${c.id}" ${c.id === st.cycle ? 'selected' : ''}>${esc(c.name)} (${c.status})</option>`).join('')}</select></div>
      <div><label>Circle</label><select id="f_ci"><option value="">All my circles</option>${circles.map(c => `<option value="${c.id}">${esc(c.code)}</option>`).join('')}</select></div>
      <div><label>Store</label><select id="f_st"></select></div></div>
      <div class="row" style="margin-top:10px"><label class="chk" id="incw"><input type="checkbox" id="f_inc"> Also include matched records (full reconciliation, can be large)</label><span style="flex:1"></span><span id="dlmsg" class="muted"></span><button class="btn primary-o" id="dl" style="width:auto">Download Excel</button></div>
      <p class="muted" id="repnote"></p></div><div id="prev"></div>`;
  const $ = id => el.querySelector('#' + id);
  function tiles() { $('tiles').innerHTML = Object.entries(REPORTS).map(([k, r]) => `<button class="rtile ${k === st.rep ? 'on' : ''}" data-rep="${k}"><b>${r.title}</b><span>${r.desc}</span></button>`).join(''); }
  function storeSel() { const l = stores.filter(s => !st.circle || s.circle_id === st.circle); $('f_st').innerHTML = '<option value="">All stores</option>' + l.map(s => `<option value="${s.id}" ${s.id === st.store ? 'selected' : ''}>${esc(s.circles?.code || '')} · ${esc(s.name)} (${esc(s.code)})</option>`).join(''); }
  const args = (off, lim, exp) => ({ p_report: st.rep, p_cycle: st.cycle, p_circle: st.circle || null, p_store: st.store || null, p_include_matched: !!(REPORTS[st.rep].variance && st.inc), p_offset: off, p_limit: lim, p_export: !!exp });
  async function preview() {
    const R = REPORTS[st.rep]; $('incw').hidden = !R.variance;
    $('repnote').textContent = R.variance ? (st.inc ? 'Full reconciliation: matched records are included.' : 'Exceptions only: matched records are left out.') + ' Uses each store\'s latest submitted version.' : '';
    $('prev').innerHTML = '<div class="boot">Loading preview…</div>';
    const { data, error } = await sb.rpc('report_rows', args(st.page * PS, PS, false));
    if (error) { $('prev').innerHTML = `<div class="alert err">${esc(rpcMsg(error))}</div>`; return; }
    $('prev').innerHTML = `<div class="bar"><b>Preview: ${R.title}</b><span class="muted">${fn(data.total)} row(s)</span></div>` + tbl(R.head, data.rows.map(r => '<tr>' + R.head.map(h => `<td>${r[h] == null ? '' : esc(r[h])}</td>`).join('') + '</tr>').join(''))
      + `<div class="bar"><span class="muted">Showing ${data.rows.length ? st.page * PS + 1 : 0}–${st.page * PS + data.rows.length}</span><div class="row"><button class="btn sm" data-pg="-1" ${st.page ? '' : 'disabled'}>Previous</button><button class="btn sm" data-pg="1" ${(st.page + 1) * PS < data.total ? '' : 'disabled'}>Next</button></div></div>`;
  }
  async function download() {
    const R = REPORTS[st.rep], msg = $('dlmsg'), PSZ = 2000; let off = 0, all = [], total = 0;
    for (;;) {
      const { data, error } = await sb.rpc('report_rows', args(off, PSZ, off === 0)); if (error) throw error;
      total = data.total; all = all.concat(data.rows); msg.textContent = `Fetching ${fn(all.length)} / ${fn(total)}…`; off += PSZ;
      if (off >= total || !data.rows.length) break; if (all.length >= 200000) { toast('Stopped at 200,000 rows. Narrow the filters to export the rest.', 'err'); break; }
    }
    msg.textContent = '';
    if (!all.length) { toast('There is nothing to export for these filters.', 'err'); return; }
    const ws = XLSX.utils.json_to_sheet(all, { header: R.head });
    ws['!cols'] = R.head.map(h => ({ wch: Math.min(42, Math.max(h.length + 2, ...all.slice(0, 200).map(r => String(r[h] == null ? '' : r[h]).length + 2))) }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, R.title.slice(0, 31));
    const d = new Date(), ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    XLSX.writeFile(wb, `Shadowfax_Airtel_${slug(R.title)}_${slug(cname())}_${ymd}.xlsx`); toast(`Downloaded ${fn(all.length)} row(s).`, 'ok');
  }
  el.onclick = e => { const t = e.target.closest('[data-rep]'); if (t) { st.rep = t.dataset.rep; st.page = 0; tiles(); return preview(); }
    const g = e.target.closest('[data-pg]'); if (g) { st.page += Number(g.dataset.pg); preview(); }
    const d = e.target.closest('#dl'); if (d) busy(d, download).catch(x => { $('dlmsg').textContent = ''; toast(rpcMsg(x), 'err'); }); };
  el.onchange = e => { const t = e.target; if (t.id === 'f_cy') { st.cycle = t.value; sessionStorage.setItem('sfx_cycle', st.cycle); } else if (t.id === 'f_ci') { st.circle = t.value; st.store = ''; storeSel(); }
    else if (t.id === 'f_st') st.store = t.value; else if (t.id === 'f_inc') st.inc = t.checked; else return; st.page = 0; preview(); };
  tiles(); storeSel(); await preview();
};

/* ================= AUDIT LOGS ================= */
PAGES.logs = async el => {
  if (staffOnly(el)) return;
  const [cyc, stores] = await Promise.all([sb.from('audit_cycles').select('id,name').order('created_at', { ascending: false }), getStores()]);
  const F = { from: '', to: '', type: '', cycle: '', store: '', q: '' }; let page = 0; const PS = 50;
  const types = Object.keys(LOG_LBL).sort();
  el.innerHTML = `<div class="card sec"><div class="row"><div><label>From</label><input type="date" id="l_from"></div><div><label>To</label><input type="date" id="l_to"></div>
      <div><label>Action</label><select id="l_type"><option value="">All actions</option>${types.map(t => `<option value="${t}">${esc(LOG_LBL[t])}</option>`).join('')}</select></div>
      <div><label>Audit cycle</label><select id="l_cy"><option value="">All cycles</option>${(cyc.data || []).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div><label>Store</label><select id="l_st"><option value="">All stores</option>${stores.map(s => `<option value="${s.id}">${esc(s.code)}</option>`).join('')}</select></div>
      <div><label>Search user, store or detail</label><input id="l_q" placeholder="e.g. a serial number"></div><button class="btn" id="l_go" style="width:auto">Apply</button></div></div><div id="lg"></div>`;
  const $ = id => el.querySelector('#' + id);
  const meta = m => Object.entries(m || {}).slice(0, 4).map(([k, v]) => `${esc(k)}: ${esc(typeof v === 'object' ? JSON.stringify(v) : v)}`).join(' · ');
  async function load() {
    $('lg').innerHTML = '<div class="boot">Loading…</div>';
    const { data, error } = await sb.rpc('audit_log', { p_from: F.from || null, p_to: F.to || null, p_type: F.type || null, p_store: F.store || null, p_cycle: F.cycle || null, p_q: F.q || null, p_offset: page * PS, p_limit: PS });
    if (error) { $('lg').innerHTML = `<div class="alert err">${esc(rpcMsg(error))}</div>`; return; }
    $('lg').innerHTML = tbl(['Time', 'User', 'Store', 'Cycle', 'Action', 'Details'], data.rows.map(r => `<tr><td class="nw">${fdt(r.created_at)}</td><td>${esc(r.user_name || '—')}<br><span class="muted">${esc((r.role || '').replace('_', ' '))}</span></td><td>${esc(r.store_code || '—')}</td>
      <td>${esc(r.cycle_name || '—')}</td><td>${badge(LOG_LBL[r.event_type] || r.event_type, /FAIL|DUPLICATE|NOT_FOUND|UNLISTED|REOPEN|REMOVED|EDITED/.test(r.event_type) ? 'warn' : '')}</td><td class="muted">${meta(r.metadata)}</td></tr>`).join('')) + pager(data.total, page, PS);
    el.querySelectorAll('#lg [data-pg]').forEach(b => b.onclick = () => { page += Number(b.dataset.pg); load(); });
  }
  const apply = () => { F.from = $('l_from').value; F.to = $('l_to').value; F.type = $('l_type').value; F.cycle = $('l_cy').value; F.store = $('l_st').value; F.q = $('l_q').value.trim(); page = 0; load().catch(x => toast(rpcMsg(x), 'err')); };
  $('l_go').onclick = apply; el.onkeydown = e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') apply(); }; el.onchange = e => { if (e.target.tagName === 'SELECT') apply(); };
  await load();
};
