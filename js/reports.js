// Reports (Excel export) and Audit Logs. Staff only; data comes from scoped server functions, so a Circle Head only ever receives their own circles.
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
const LOG_LBL = Object.assign({}, EVT, { LOGIN: 'Login', USER_APPROVED: 'User approved', USER_REJECTED: 'User rejected', USER_STORE_CHANGED: 'User store changed', REPORT_EXPORTED: 'Report exported',
  STORE_REPORT_NAME_SET: 'Store report name set', BASE_UPLOAD_WARNING: 'Base upload warning', CYCLE_DELETED: 'Cycle deleted' });
const slug = s => String(s || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
const staffOnly = el => { if (!isStaff()) { el.innerHTML = '<div class="card startcard"><h2>Not available</h2></div>'; return true; } return false; };

// Fetch every page of a report and save it as an .xlsx. The first page is flagged so the SERVER logs the export.
async function downloadReport(rep, cycleId, circleId, storeId, inc, msgEl) {
  const R = REPORTS[rep], PSZ = 2000; let off = 0, all = [], total = 0;
  for (;;) {
    const { data, error } = await sb.rpc('report_rows', { p_report: rep, p_cycle: cycleId, p_circle: circleId || null, p_store: storeId || null, p_include_matched: !!(R.variance && inc), p_offset: off, p_limit: PSZ, p_export: off === 0 }); if (error) throw error;
    total = data.total; all = all.concat(data.rows); if (msgEl) msgEl.textContent = `Fetching ${fn(all.length)} / ${fn(total)}…`; off += PSZ;
    if (off >= total || !data.rows.length) break; if (all.length >= 200000) { toast('Stopped at 200,000 rows. Narrow the filters to export the rest.', 'err'); break; }
  }
  if (msgEl) msgEl.textContent = '';
  if (!all.length) { toast('There is nothing to export for these filters.', 'err'); return; }
  const ws = XLSX.utils.json_to_sheet(all, { header: R.head });
  ws['!cols'] = R.head.map(h => ({ wch: Math.min(42, Math.max(h.length + 2, ...all.slice(0, 200).map(r => String(r[h] == null ? '' : r[h]).length + 2))) }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, R.title.slice(0, 31));
  const d = new Date(), ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'), cname = (S.cycles.find(c => c.id === cycleId) || {}).name || '';
  XLSX.writeFile(wb, `Shadowfax_Airtel_${slug(R.title)}_${slug(cname)}_${ymd}.xlsx`); toast(`Downloaded ${fn(all.length)} row(s).`, 'ok');
}

/* ================= REPORTS ================= */
PAGES.reports = async el => {
  if (staffOnly(el)) return; if (!S.cycleId) return noCycle(el);
  const [circles, stores] = await Promise.all([getCircles(), getStores()]);
  const TABS = { audit: ['Audit Reports', ['store_summary', 'history']], variance: ['Variance Reports', ['variance', 'serial', 'nonserial']], perf: ['Store Performance', ['circle_summary', 'store_summary']], activity: ['User Activity', null] };
  const st = { tab: 'audit', rep: 'store_summary', circle: '', store: '', inc: false, page: 0 }; const PS = 50, cid = S.cycleId;
  el.innerHTML = `<div class="tabs seg" id="rtabs" style="margin-bottom:12px">${Object.entries(TABS).map(([k, v]) => `<button class="tab" data-tab="${k}">${v[0]}</button>`).join('')}</div><div id="panel"></div>`;
  const $ = id => el.querySelector('#' + id);
  const args = (off, lim, exp) => ({ p_report: st.rep, p_cycle: cid, p_circle: st.circle || null, p_store: st.store || null, p_include_matched: !!(REPORTS[st.rep].variance && st.inc), p_offset: off, p_limit: lim, p_export: !!exp });
  function storeOptions() { const l = stores.filter(s => !st.circle || s.circle_id === st.circle); return '<option value="">All stores</option>' + l.map(s => `<option value="${s.id}" ${s.id === st.store ? 'selected' : ''}>${esc(s.circles?.code || '')} · ${esc(s.name)} (${esc(s.code)})</option>`).join(''); }
  async function panel() {
    el.querySelectorAll('#rtabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === st.tab));
    if (st.tab === 'activity') { await logsView($('panel'), ''); return; }
    const kids = TABS[st.tab][1]; if (!kids.includes(st.rep)) { st.rep = kids[0]; st.page = 0; }
    $('panel').innerHTML = `<div class="card" style="padding:16px;margin-bottom:14px"><div class="filters"><div><label>Audit cycle</label><div class="chip-i" style="padding:9px 12px">${ic('cal', 16)}<b style="font-size:14px">${esc(S.cycleName)}</b></div></div>
        <div><label>Circle</label><select id="f_ci"><option value="">All my circles</option>${circles.map(c => `<option value="${c.id}" ${c.id === st.circle ? 'selected' : ''}>${esc(c.code)}</option>`).join('')}</select></div><div><label>Store</label><select id="f_st">${storeOptions()}</select></div>
        <label class="chk" id="incw" ${kids.some(k => REPORTS[k].variance) ? '' : 'hidden'}><input type="checkbox" id="f_inc" ${st.inc ? 'checked' : ''}> Also include matched records</label></div><span id="dlmsg" class="muted"></span></div>
      <div class="card" style="padding:0">${kids.map(k => `<div class="reprow"><b><span class="tile">${ic('file', 18)}</span>${REPORTS[k].title}</b><span class="muted">${REPORTS[k].desc}</span><span>${badge('Ready', 'ok')}</span>
        <span class="row"><button class="btn sm ${k === st.rep ? 'on' : ''}" data-prev="${k}">Preview</button><button class="btn sm yel" data-dl="${k}">${ic('dl', 14)} Download</button></span></div>`).join('')}</div><div id="prev" style="margin-top:14px"></div>`;
    await preview();
  }
  async function preview() {
    const R = REPORTS[st.rep]; $('prev').innerHTML = '<div class="boot">Loading preview…</div>';
    const { data, error } = await sb.rpc('report_rows', args(st.page * PS, PS, false)); if (error) { $('prev').innerHTML = `<div class="alert err">${esc(rpcMsg(error))}</div>`; return; }
    $('prev').innerHTML = `<div class="bar"><b>Preview: ${R.title}</b><span class="muted">${fn(data.total)} row(s)${R.variance ? (st.inc ? ' · full reconciliation' : ' · exceptions only') : ''}</span></div>` + tbl(R.head, data.rows.map(r => '<tr>' + R.head.map(h => `<td>${r[h] == null ? '' : esc(r[h])}</td>`).join('') + '</tr>').join(''))
      + `<div class="bar"><span class="muted">Showing ${data.rows.length ? st.page * PS + 1 : 0}–${st.page * PS + data.rows.length}</span><div class="row"><button class="btn sm" data-pg="-1" ${st.page ? '' : 'disabled'}>Previous</button><button class="btn sm" data-pg="1" ${(st.page + 1) * PS < data.total ? '' : 'disabled'}>Next</button></div></div>`;
  }
  el.onclick = e => {
    const t = e.target.closest('#rtabs [data-tab]'); if (t) { st.tab = t.dataset.tab; st.page = 0; return panel(); }
    const pv = e.target.closest('[data-prev]'); if (pv) { st.rep = pv.dataset.prev; st.page = 0; return panel(); }
    const g = e.target.closest('[data-pg]'); if (g) { st.page += Number(g.dataset.pg); return preview(); }
    const d = e.target.closest('[data-dl]'); if (d) { st.rep = d.dataset.dl; busy(d, () => downloadReport(st.rep, cid, st.circle, st.store, st.inc, $('dlmsg'))).catch(x => { if ($('dlmsg')) $('dlmsg').textContent = ''; toast(rpcMsg(x), 'err'); }); } };
  el.onchange = e => { const t = e.target; if (t.id === 'f_ci') { st.circle = t.value; st.store = ''; } else if (t.id === 'f_st') st.store = t.value; else if (t.id === 'f_inc') st.inc = t.checked; else return; st.page = 0; panel(); };
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
      <div><label>From</label><input type="date" id="l_from"></div><div><label>To</label><input type="date" id="l_to"></div><button class="btn" id="l_reset">Reset</button></div><div id="lg"></div></div>`;
  const $ = id => el.querySelector('#' + id);
  const meta = m => Object.entries(m || {}).slice(0, 4).map(([k, v]) => `${esc(k)}: ${esc(typeof v === 'object' ? JSON.stringify(v) : v)}`).join(' · ');
  async function load() {
    $('lg').innerHTML = '<div class="boot">Loading…</div>';
    const { data, error } = await sb.rpc('audit_log', { p_from: F.from || null, p_to: F.to || null, p_type: F.type || null, p_store: F.store || null, p_cycle: F.cycle || null, p_q: F.q || null, p_offset: page * PS, p_limit: PS });
    if (error) { $('lg').innerHTML = `<div class="alert err">${esc(rpcMsg(error))}</div>`; return; }
    $('lg').innerHTML = tbl(['Date & Time', 'User', 'Activity', 'Store', 'Cycle', 'Details'], data.rows.map(r => `<tr><td class="nw">${fdt(r.created_at)}</td><td><b>${esc(r.user_name || '—')}</b><br><span class="muted">${esc((r.role || '').replace('_', ' '))}</span></td>
      <td>${badge(LOG_LBL[r.event_type] || r.event_type, /FAIL|DUPLICATE|NOT_FOUND|UNLISTED|REOPEN|REMOVED|EDITED|DELETED/.test(r.event_type) ? 'warn' : '')}</td><td>${esc(r.store_code || '—')}</td><td>${esc(r.cycle_name || '—')}</td><td class="muted">${meta(r.metadata)}</td></tr>`).join('')) + numPager(data.total, page, PS);
    el.querySelectorAll('#lg [data-np]').forEach(b => b.onclick = () => { page = Number(b.dataset.np); load(); });
  }
  const apply = () => { F.from = $('l_from').value; F.to = $('l_to').value; F.type = $('l_type').value; F.cycle = $('l_cy').value; F.store = $('l_st').value; F.q = $('l_q').value.trim(); page = 0; load().catch(x => toast(rpcMsg(x), 'err')); };
  $('l_reset').onclick = () => { ['l_q', 'l_type', 'l_st', 'l_cy', 'l_from', 'l_to'].forEach(i => { $(i).value = ''; }); apply(); };
  el.onkeydown = e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') apply(); }; el.onchange = e => { if (e.target.tagName === 'SELECT' || e.target.type === 'date') apply(); };
  await load();
}
PAGES.logs = async el => { if (staffOnly(el)) return; await logsView(el, new URLSearchParams(location.hash.split('?')[1] || '').get('store') || ''); };
