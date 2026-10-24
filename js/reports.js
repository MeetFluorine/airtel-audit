// Reports (Excel export) and Audit Logs. Staff only; data comes from scoped server functions, so a Circle Head only ever receives their own circles.
//
// MERGED REPORTS (Oct 2026 fixes): Store Summary lives inside Pan-India
// Overview (Version + Last Updated columns), Audit History lives inside
// Store Audit Status (Started By + reopen columns + Circle Head + Overdue
// Days), and Serialized / Non-Serialized / Circle Shortage live inside
// Consolidated Variance as Type + Show filters. The old server branches
// still exist in report_rows() but the UI no longer offers them.
const REPORTS = {
  variance: { title: 'Consolidated Variance', desc: 'Short and excess records across stores (exceptions only by default). Use the Type filter for Serialized / Non-Serialized only, and Show for short-only or excess-only — this replaces the old Serialized, Non-Serialized and Circle Shortage reports.', variance: true,
    head: ['Audit Cycle', 'Circle', 'Store', 'Item Code', 'Inventory Status', 'Item Description', 'UOM', 'Quality', 'System Serial', 'Physical Serial', 'Expected Qty', 'Physical Qty', 'Matched Qty', 'Short Qty', 'Excess Qty', 'Variance Type', 'Audit Date', 'Submitted By', 'Type', 'In Transit', 'Shortage Remark', 'Accepted Qty', 'Revised Genuine Qty'] },
  store_audit: { title: 'Store Audit Report', desc: 'One store, full reconciliation: overview + variance. Every line (matched, short, excess) split by Serialized / Non-Serialized, with an In-Transit flag', need: 'store',
    head: ['Audit Cycle', 'Circle', 'Store Code', 'Store Name', 'Item Code', 'Item Description', 'Inventory Status', 'UOM', 'Quality', 'Type', 'Serial No', 'Expected Qty', 'Physical Qty', 'Matched Qty', 'Short Qty', 'Excess Qty', 'Result', 'In Transit', 'Audit Date', 'Submitted By', 'Shortage Remark', 'Accepted Qty', 'Revised Genuine Qty', 'Row Note'] },
  pan_india: { title: 'Pan-India Audit Overview', desc: 'One row per store for the cycle: expected / physical / matched / short (in-transit, other, serialized, non-serialized splits) / excess / match rate. This replaces Store Summary (its Version and Last Updated columns are included). In-progress and not-started stores show — in the shortage splits instead of a misleading 0. The download ends with a GRAND TOTAL row; its match rate covers completed stores only.',
    head: ['Audit Cycle', 'Circle', 'Store Code', 'Store Name', 'Expected Units', 'Physical Units', 'Matched Units', 'Short Units', 'Short In Transit', 'Short Other', 'Short Serialized', 'Short Non-Serialized', 'Excess Units', 'Match Rate %', 'Audit Status', 'Submitted By', 'Version', 'Last Updated'] },
  store_status: { title: 'Store Audit Status', desc: 'Who completed the audit and who is pending: status, version, timestamps, deadline and overdue days per store. This replaces Audit History (its Started By and reopen columns are included). The download ends with a GRAND TOTAL row.',
    head: ['Audit Cycle', 'Circle', 'Store Code', 'Store Name', 'Audit Status', 'Version', 'Started At', 'Submitted At', 'Submitted By', 'Match Rate %', 'Deadline', 'Days Left', 'Started By', 'Reopened By', 'Reopened At', 'Reopen Reason', 'Circle Head', 'Overdue Days'] },
  circle_summary: { title: 'Circle Summary', desc: 'One row per circle with its circle head and health status. Health: Pending = no store completed yet · Healthy ≥ 90% match · Warning 75–90% · Critical < 75%. Expected / Physical / Matched count completed stores only. The download ends with a GRAND TOTAL row.',
    head: ['Audit Cycle', 'Circle', 'Circle Head', 'Stores', 'Completed', 'In Progress', 'Not Started', 'Expected Units', 'Physical Units', 'Matched Units', 'Short Units', 'Excess Units', 'Match Rate %', 'Status'] },
  users: { title: 'User Report (PAN India)', desc: 'Every user: contact, role, store / circles and approval status. Statuses are Active, Rejected or Pending Approval — there is no Inactive status. The Data Flag column marks rows with a missing, misplaced or incomplete field.',
    head: ['Full Name', 'Employee ID', 'Email', 'Mobile', 'Role', 'Status', 'Store Code', 'Circles', 'Registered On', 'Data Flag'] },
};
const GEN_GROUPS = [
  ['Store Reports', ['store_audit', 'store_status']],
  ['Overview Reports', ['pan_india', 'circle_summary']],
  ['Variance Reports', ['variance']],
  ['User Reports', ['users']],
];
const LOG_LBL = Object.assign({}, EVT, { LOGIN: 'Login', USER_APPROVED: 'User approved', USER_REJECTED: 'User rejected', USER_STORE_CHANGED: 'User store changed', REPORT_EXPORTED: 'Report exported',
  STORE_REPORT_NAME_SET: 'Store report name set', BASE_UPLOAD_WARNING: 'Base upload warning', CYCLE_DELETED: 'Cycle deleted', CYCLE_CLOSED: 'Cycle closed', USER_DELETED: 'User deleted' });
const slug = s => String(s || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
const staffOnly = el => { if (!isStaff()) { el.innerHTML = '<div class="card startcard"><h2>Not available</h2></div>'; return true; } return false; };

// SheetJS rejects sheet names containing / \ ? * [ ] : — the old User
// Report title ('User Report (Active / Inactive PAN India)') carried a
// '/', which is exactly why its download failed while its preview worked.
const sheetName = s => (String(s || '').replace(/[/\\?*\[\]:]/g, '').slice(0, 31) || 'Report');
// Display fixes shared by preview and download: Circle Summary health
// labels arrive UPPERCASE from the server; every other report already
// uses Title Case. Pan-India splits arrive null for in-progress and
// not-started stores (a 0 there would mislead); they render as '—'
// here so the Excel columns themselves stay numeric.
const HEALTH_LBL = { HEALTHY: 'Healthy', WARNING: 'Warning', CRITICAL: 'Critical', PENDING: 'Pending' };
const PAN_SPLITS = ['Short In Transit', 'Short Other', 'Short Serialized', 'Short Non-Serialized'];
function normRows(rep, rows) {
  if (rep === 'circle_summary') rows.forEach(r => { if (r['Status']) r['Status'] = HEALTH_LBL[r['Status']] || r['Status']; });
  if (rep === 'pan_india') rows.forEach(r => { if (r['Audit Status'] !== 'Completed') PAN_SPLITS.forEach(h => { if (r[h] == null) r[h] = '—'; }); });
  return rows;
}
// GRAND TOTAL row for the two summary downloads, computed here from the
// downloaded rows so the preview's paging never corrupts it. Pan-India's
// match rate covers completed stores only — in-progress stores have no
// matched figure yet, so folding them in would print a misleading 77%.
function totalsRow(rep, rows) {
  const num = v => typeof v === 'number' ? v : (v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : 0);
  const sum = h => rows.reduce((a, r) => a + num(r[h]), 0);
  if (rep === 'pan_india') {
    const done = rows.filter(r => r['Audit Status'] === 'Completed');
    const dExp = done.reduce((a, r) => a + num(r['Expected Units']), 0), dMat = done.reduce((a, r) => a + num(r['Matched Units']), 0);
    return { 'Audit Cycle': '', 'Circle': '', 'Store Code': 'GRAND TOTAL', 'Store Name': '', 'Expected Units': sum('Expected Units'), 'Physical Units': sum('Physical Units'), 'Matched Units': sum('Matched Units'), 'Short Units': sum('Short Units'), 'Short In Transit': sum('Short In Transit'), 'Short Other': sum('Short Other'), 'Short Serialized': sum('Short Serialized'), 'Short Non-Serialized': sum('Short Non-Serialized'), 'Excess Units': sum('Excess Units'), 'Match Rate %': dExp ? (Math.round(1000 * dMat / dExp) / 10) + ' (completed only)' : '', 'Audit Status': '', 'Submitted By': '', 'Version': '', 'Last Updated': '' };
  }
  if (rep === 'circle_summary') {
    const e = sum('Expected Units'), m = sum('Matched Units');
    return { 'Audit Cycle': '', 'Circle': 'GRAND TOTAL', 'Circle Head': '', 'Stores': sum('Stores'), 'Completed': sum('Completed'), 'In Progress': sum('In Progress'), 'Not Started': sum('Not Started'), 'Expected Units': e, 'Physical Units': sum('Physical Units'), 'Matched Units': m, 'Short Units': sum('Short Units'), 'Excess Units': sum('Excess Units'), 'Match Rate %': e ? Math.round(1000 * m / e) / 10 : '', 'Status': '' };
  }
  return null;
}

// Fetch every page of a report and save it as an .xlsx. The first page is flagged so the SERVER logs the export.
// extra (variance only): { type: '' | 'ser' | 'non', show: '' | 'SHORT' | 'EXCESS' } — the Type filter reuses the
// server's serial / nonserial branches, the Show filter the new p_variance_type parameter.
async function downloadReport(rep, cycleId, circleId, storeId, inc, msgEl, extra) {
  const R = REPORTS[rep], PSZ = 2000; let off = 0, all = [], total = 0;
  const srv = rep === 'variance' && extra ? (extra.type === 'ser' ? 'serial' : extra.type === 'non' ? 'nonserial' : 'variance') : rep;
  await loadXlsx();
  for (;;) {
    const { data, error } = await sb.rpc('report_rows', { p_report: srv, p_cycle: cycleId, p_circle: circleId || null, p_store: storeId || null, p_include_matched: !!(R.variance && inc), p_variance_type: (rep === 'variance' && extra && extra.show) || null, p_offset: off, p_limit: PSZ, p_export: off === 0 }); if (error) throw error;
    total = data.total; all = all.concat(normRows(rep, data.rows)); if (msgEl) msgEl.textContent = `Fetching ${fn(all.length)} / ${fn(total)}…`; off += PSZ;
    if (off >= total || !data.rows.length) break; if (all.length >= 200000) { toast('Stopped at 200,000 rows. Narrow the filters to export the rest.', 'err'); break; }
  }
  if (msgEl) msgEl.textContent = '';
  if (!all.length) { toast('There is nothing to export for these filters.', 'err'); return; }
  const n = all.length, t = totalsRow(rep, all); if (t) all.push(t);
  const ws = XLSX.utils.json_to_sheet(all, { header: R.head });
  ws['!cols'] = R.head.map(h => ({ wch: Math.min(42, Math.max(h.length + 2, ...all.slice(0, 200).map(r => String(r[h] == null ? '' : r[h]).length + 2))) }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheetName(R.title));
  const d = new Date(), ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'), cname = (S.cycles.find(c => c.id === cycleId) || {}).name || '';
  const suffix = rep === 'variance' && extra ? ((extra.type === 'ser' ? '_Serialized' : extra.type === 'non' ? '_Non-Serialized' : '') + (extra.show === 'SHORT' ? '_Short-only' : extra.show === 'EXCESS' ? '_Excess-only' : '')) : '';
  XLSX.writeFile(wb, `Shadowfax_Airtel_${slug(R.title)}${suffix}_${slug(cname)}_${ymd}.xlsx`); toast(`Downloaded ${fn(n)} row(s).`, 'ok');
}

// Export the filtered audit log to .xlsx (pages through audit_log the way downloadReport pages through report_rows).
// Page size 2000 like downloadReport: at 200 rows a 36,000-row export took ~3.5 minutes of sequential fetches.
async function downloadLogs(F, msgEl) {
  const PSZ = 2000; let off = 0, all = [], total = 0;
  await loadXlsx();
  for (;;) {
    const { data, error } = await sb.rpc('audit_log', { p_from: F.from || null, p_to: F.to || null, p_type: F.type || null, p_store: F.store || null, p_cycle: F.cycle || null, p_q: F.q || null, p_offset: off, p_limit: PSZ });
    if (error) throw error;
    total = data.total; all = all.concat(data.rows); if (msgEl) msgEl.textContent = `Fetching ${fn(all.length)} / ${fn(total)}…`; off += PSZ;
    if (off >= total || !data.rows.length) break; if (all.length >= 200000) { toast('Stopped at 200,000 rows. Narrow the filters to export the rest.', 'err'); break; }
  }
  if (msgEl) msgEl.textContent = '';
  if (!all.length) { toast('There is nothing to export for these filters.', 'err'); return; }
  const meta = m => Object.entries(m || {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
  const rows = all.map(r => ({ 'Date & Time': fdt(r.created_at), 'User': r.user_name || '—', 'Email': r.user_email || '', 'Role': (r.role || '').replace('_', ' '), 'Activity': LOG_LBL[r.event_type] || r.event_type, 'Store': r.store_code || '—', 'Cycle': r.cycle_name || '—', 'Details': meta(r.metadata) }));
  const head = Object.keys(rows[0]);
  const ws = XLSX.utils.json_to_sheet(rows, { header: head });
  ws['!cols'] = head.map(h => ({ wch: Math.min(42, Math.max(h.length + 2, ...rows.slice(0, 200).map(r => String(r[h] == null ? '' : r[h]).length + 2))) }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Audit Log');
  const d = new Date(), ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  XLSX.writeFile(wb, `Shadowfax_Airtel_Audit_Log_${ymd}.xlsx`); toast(`Downloaded ${fn(all.length)} row(s).`, 'ok');
}

/* ================= REPORTS ================= */
PAGES.reports = async el => {
  if (staffOnly(el)) return; if (!S.cycleId) return noCycle(el);
  const [circles, stores] = await Promise.all([getCircles(), getStores()]);
  const TABS = { audit: ['Audit Reports', ['store_audit']], variance: ['Variance Reports', ['variance']],
    overview: ['Overview Reports', ['pan_india', 'store_status', 'circle_summary']], users: ['User Reports', ['users']], activity: ['Audit Logs', null] };
  const st = { tab: 'audit', rep: 'store_audit', circle: '', store: '', inc: false, vtype: '', vshow: '', page: 0 }; const PS = 50, cid = S.cycleId;
  el.innerHTML = `<div class="bar" style="margin-bottom:12px"><span></span><button class="btn yel" id="genrep">${ic('plus', 16)} Generate Report</button></div>
    <div class="tabs seg" id="rtabs" style="margin-bottom:12px">${Object.entries(TABS).map(([k, v]) => `<button class="tab" data-tab="${k}">${v[0]}</button>`).join('')}</div><div id="panel"></div>`;
  const $ = id => el.querySelector('#' + id);
  const srvRep = () => st.rep === 'variance' ? (st.vtype === 'ser' ? 'serial' : st.vtype === 'non' ? 'nonserial' : 'variance') : st.rep;
  const args = (off, lim, exp) => ({ p_report: srvRep(), p_cycle: cid, p_circle: st.circle || null, p_store: st.store || null, p_include_matched: !!(REPORTS[st.rep].variance && st.inc), p_variance_type: (st.rep === 'variance' && st.vshow) || null, p_offset: off, p_limit: lim, p_export: !!exp });
  function storeOptions(sel, onlyCircle) { const l = stores.filter(s => !onlyCircle || s.circle_id === onlyCircle); return '<option value="">All stores</option>' + l.map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.circles?.code || '')} · ${esc(s.name)} (${esc(s.code)})</option>`).join(''); }

  // "Generate Report" modal: pick a report type, set its filters, download the Excel.
  function genModal() {
    const opts = GEN_GROUPS.map(([g, ks]) => `<optgroup label="${g}">${ks.map(k => `<option value="${k}">${REPORTS[k].title}</option>`).join('')}</optgroup>`).join('');
    const o = openModal('Generate Report', `
      <div class="fld"><label for="gr-type">Select Report Type</label><div class="inp"><select id="gr-type">${opts}</select></div></div>
      <p class="muted" id="gr-desc" style="margin:6px 0 12px"></p>
      <div class="row2"><div class="fld"><label for="gr-ci">Circle</label><div class="inp"><select id="gr-ci"><option value="">All my circles</option>${circles.map(c => `<option value="${c.id}">${esc(c.code)}</option>`).join('')}</select></div></div>
      <div class="fld"><label for="gr-st">Store</label><div class="inp"><select id="gr-st"></select></div></div></div>
      <label class="chk" id="gr-incw"><input type="checkbox" id="gr-inc"> Also include matched records</label>
      <div class="row2" id="gr-vw"><div class="fld"><label for="gr-vtype">Type</label><div class="inp"><select id="gr-vtype"><option value="">All types</option><option value="ser">Serialized only</option><option value="non">Non-Serialized only</option></select></div></div>
      <div class="fld"><label for="gr-vshow">Show</label><div class="inp"><select id="gr-vshow"><option value="">All exceptions</option><option value="SHORT">Short only</option><option value="EXCESS">Excess only</option></select></div></div></div>
      <div class="alert err" id="gr-err" hidden></div><div id="gr-msg" class="muted"></div>`,
      [{ label: 'Cancel' }, { label: 'Generate & Download', cls: 'yel', fn: async () => {
        const rep = o.querySelector('#gr-type').value, ci = o.querySelector('#gr-ci').value, sti = o.querySelector('#gr-st').value;
        const need = REPORTS[rep].need, errEl = o.querySelector('#gr-err');
        const bad = m => { errEl.textContent = m; errEl.hidden = false; };
        if (need === 'store' && !sti) { bad('Please select a store for the Store Audit Report.'); return false; }
        errEl.hidden = true;
        await downloadReport(rep, cid, ci || null, sti || null, o.querySelector('#gr-inc').checked, o.querySelector('#gr-msg'), { type: o.querySelector('#gr-vtype').value, show: o.querySelector('#gr-vshow').value });
      } }]);
    const q = s => o.querySelector(s);
    const sync = () => {
      const R = REPORTS[q('#gr-type').value];
      q('#gr-desc').textContent = R.desc;
      q('#gr-st').innerHTML = storeOptions(q('#gr-st').value, q('#gr-ci').value);
      q('#gr-incw').hidden = !R.variance;
      q('#gr-vw').hidden = !R.variance;
    };
    q('#gr-type').onchange = sync; q('#gr-ci').onchange = () => { q('#gr-st').innerHTML = storeOptions('', q('#gr-ci').value); };
    q('#gr-st').innerHTML = storeOptions('', '');
    sync();
  }
  $('genrep').onclick = genModal;
  async function panel() {
    el.querySelectorAll('#rtabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === st.tab));
    if (st.tab === 'activity') { await logsView($('panel'), ''); return; }
    const kids = TABS[st.tab][1]; if (!kids.includes(st.rep)) { st.rep = kids[0]; st.page = 0; }
    $('panel').innerHTML = `<div class="card" style="padding:16px;margin-bottom:14px"><div class="filters"><div><label>Audit cycle</label><div class="chip-i" style="padding:9px 12px">${ic('cal', 16)}<b style="font-size:14px">${esc(S.cycleName)}</b></div></div>
        <div><label>Circle</label><select id="f_ci"><option value="">All my circles</option>${circles.map(c => `<option value="${c.id}" ${c.id === st.circle ? 'selected' : ''}>${esc(c.code)}</option>`).join('')}</select></div><div><label>Store</label><select id="f_st">${storeOptions(st.store, st.circle)}</select></div>
        <label class="chk" id="incw" ${kids.some(k => REPORTS[k].variance) ? '' : 'hidden'}><input type="checkbox" id="f_inc" ${st.inc ? 'checked' : ''}> Also include matched records</label>
        <div id="vtypew" ${st.rep === 'variance' ? '' : 'hidden'}><label>Type</label><select id="f_vtype"><option value="">All types</option><option value="ser" ${st.vtype === 'ser' ? 'selected' : ''}>Serialized only</option><option value="non" ${st.vtype === 'non' ? 'selected' : ''}>Non-Serialized only</option></select></div>
        <div id="vshoww" ${st.rep === 'variance' ? '' : 'hidden'}><label>Show</label><select id="f_vshow"><option value="">All exceptions</option><option value="SHORT" ${st.vshow === 'SHORT' ? 'selected' : ''}>Short only</option><option value="EXCESS" ${st.vshow === 'EXCESS' ? 'selected' : ''}>Excess only</option></select></div></div><span id="dlmsg" class="muted"></span></div>
      <div class="card" style="padding:0">${kids.map(k => `<div class="reprow"><b><span class="tile">${ic('file', 18)}</span>${REPORTS[k].title}</b><span class="muted">${REPORTS[k].desc}</span><span>${badge('Ready', 'ok')}</span>
        <span class="row"><button class="btn sm ${k === st.rep ? 'on' : ''}" data-prev="${k}">Preview</button><button class="btn sm yel" data-dl="${k}">${ic('dl', 14)} Download</button></span></div>`).join('')}</div><div id="prev" style="margin-top:14px"></div>`;
    await preview();
  }
  async function preview() {
    const R = REPORTS[st.rep];
    const needMsg = R.need === 'store' && !st.store ? 'Select a store above to preview the Store Audit Report.'
      : R.need === 'circle' && !st.circle ? 'Select a circle above to preview the Circle Shortage Report.' : '';
    if (needMsg) { $('prev').innerHTML = `<div class="alert info">${needMsg}</div>`; return; }
    $('prev').innerHTML = universeLoader();
    const { data, error } = await sb.rpc('report_rows', args(st.page * PS, PS, false)); if (error) { $('prev').innerHTML = `<div class="alert err">${esc(rpcMsg(error))}</div>`; return; }
    normRows(st.rep, data.rows);
    $('prev').innerHTML = `<div class="bar"><b>Preview: ${R.title}</b><span class="muted">${fn(data.total)} row(s)${R.variance ? (st.inc ? ' · full reconciliation' : ' · exceptions only') : ''}</span></div>` + tbl(R.head, data.rows.map(r => '<tr>' + R.head.map(h => `<td>${r[h] == null ? '' : esc(r[h])}</td>`).join('') + '</tr>').join(''))
      + `<div class="bar"><span class="muted">Showing ${data.rows.length ? st.page * PS + 1 : 0}–${st.page * PS + data.rows.length}</span><div class="row"><button class="btn sm" data-pg="-1" ${st.page ? '' : 'disabled'}>Previous</button><button class="btn sm" data-pg="1" ${(st.page + 1) * PS < data.total ? '' : 'disabled'}>Next</button></div></div>`;
  }
  el.onclick = e => {
    const t = e.target.closest('#rtabs [data-tab]'); if (t) { st.tab = t.dataset.tab; st.page = 0; return panel(); }
    const pv = e.target.closest('[data-prev]'); if (pv) { st.rep = pv.dataset.prev; st.page = 0; return panel(); }
    const g = e.target.closest('[data-pg]'); if (g) { st.page += Number(g.dataset.pg); return preview(); }
    const d = e.target.closest('[data-dl]'); if (d) { st.rep = d.dataset.dl; busy(d, () => downloadReport(st.rep, cid, st.circle, st.store, st.inc, $('dlmsg'), { type: st.vtype, show: st.vshow })).catch(x => { if ($('dlmsg')) $('dlmsg').textContent = ''; toast(rpcMsg(x), 'err'); }); } };
  el.onchange = e => { const t = e.target; if (t.id === 'f_ci') { st.circle = t.value; st.store = ''; } else if (t.id === 'f_st') st.store = t.value; else if (t.id === 'f_inc') st.inc = t.checked; else if (t.id === 'f_vtype') st.vtype = t.value; else if (t.id === 'f_vshow') st.vshow = t.value; else return; st.page = 0; panel(); };
  await panel();
};

/* ================= AUDIT LOGS ================= */
async function logsView(el, presetStore) {
  const [cyc, stores] = await Promise.all([sb.from('audit_cycles').select('id,name').order('created_at', { ascending: false }), getStores()]);
  const F = { from: '', to: '', type: '', cycle: '', store: presetStore || '', q: '' }; let page = 0; const PS = 20;
  const types = Object.keys(LOG_LBL).sort((a, b) => LOG_LBL[a].localeCompare(LOG_LBL[b]));
  el.innerHTML = `<div class="card" style="padding:16px"><div class="filters"><div style="flex:1;min-width:200px"><label>User, store or detail</label><div class="inp">${ic('search', 18)}<input id="l_q" placeholder="e.g. a user name or serial number"></div></div>
      <div><label>Activity Type</label><select id="l_type"><option value="">All Activities</option>${types.map(t => `<option value="${t}">${esc(LOG_LBL[t])}</option>`).join('')}</select></div>
      <div><label>Store</label><select id="l_st"><option value="">All stores</option>${stores.map(s => `<option value="${s.id}" ${s.id === F.store ? 'selected' : ''}>${esc(s.code)}</option>`).join('')}</select></div>
      <div><label>Audit cycle</label><select id="l_cy"><option value="">All cycles</option>${(cyc.data || []).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div><label>From</label><div class="inp"><input type="date" id="l_from" style="padding:13px 2px"></div></div><div><label>To</label><div class="inp"><input type="date" id="l_to" style="padding:13px 2px"></div></div><button class="btn" id="l_reset">${ic('sync', 15)} Reset</button><button class="btn yel" id="l_exp">${ic('dl', 16)} Export</button><span id="lexmsg" class="muted"></span></div><div id="lg"></div></div>`;
  const $ = id => el.querySelector('#' + id);
  const meta = m => Object.entries(m || {}).slice(0, 4).map(([k, v]) => `${esc(k)}: ${esc(typeof v === 'object' ? JSON.stringify(v) : v)}`).join(' · ');
  async function load() {
    $('lg').innerHTML = universeLoader();
    const { data, error } = await sb.rpc('audit_log', { p_from: F.from || null, p_to: F.to || null, p_type: F.type || null, p_store: F.store || null, p_cycle: F.cycle || null, p_q: F.q || null, p_offset: page * PS, p_limit: PS });
    if (error) { $('lg').innerHTML = `<div class="alert err">${esc(rpcMsg(error))}</div>`; return; }
    $('lg').innerHTML = tbl(['Date & Time', 'User', 'Activity', 'Store', 'Cycle', 'Details'], data.rows.map(r => `<tr><td class="nw">${fdt(r.created_at)}</td><td><b>${esc(r.user_name || '—')}</b><br><span class="muted">${esc((r.role || '').replace('_', ' '))}</span></td>
      <td>${badge(LOG_LBL[r.event_type] || r.event_type, /FAIL|DUPLICATE|NOT_FOUND|UNLISTED|REOPEN|REMOVED|EDITED|DELETED/.test(r.event_type) ? 'warn' : '')}</td><td>${esc(r.store_code || '—')}</td><td>${esc(r.cycle_name || '—')}</td><td class="muted">${meta(r.metadata)}</td></tr>`).join('')) + numPager(data.total, page, PS);
    el.querySelectorAll('#lg [data-np]').forEach(b => b.onclick = () => { page = Number(b.dataset.np); load(); });
  }
  const apply = () => { F.from = $('l_from').value; F.to = $('l_to').value; F.type = $('l_type').value; F.cycle = $('l_cy').value; F.store = $('l_st').value; F.q = $('l_q').value.trim(); page = 0; load().catch(x => toast(rpcMsg(x), 'err')); };
  $('l_reset').onclick = () => { ['l_q', 'l_type', 'l_st', 'l_cy', 'l_from', 'l_to'].forEach(i => { $(i).value = ''; }); apply(); };
  $('l_exp').onclick = () => busy($('l_exp'), () => downloadLogs(F, $('lexmsg'))).catch(x => { if ($('lexmsg')) $('lexmsg').textContent = ''; toast(rpcMsg(x), 'err'); });
  el.onkeydown = e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') apply(); }; el.onchange = e => { if (e.target.tagName === 'SELECT' || e.target.type === 'date') apply(); };
  await load();
}
PAGES.logs = async el => { if (staffOnly(el)) return; await logsView(el, new URLSearchParams(location.hash.split('?')[1] || '').get('store') || ''); };
