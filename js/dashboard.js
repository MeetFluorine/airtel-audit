// Admin / circle head: Dashboard, Store Audit (all stores), Store Detail (drill-down). Data comes from staff-scoped server functions.
const pct = v => v == null ? '—' : Number(v).toFixed(1) + '%';
const rateCls = r => r == null ? '' : r >= 90 ? 'ok' : r >= 75 ? 'warn' : 'bad';
const healthOf = r => r == null ? null : r >= 90 ? ['Healthy', 'ok'] : r >= 75 ? ['Warning', 'warn'] : ['Critical', 'bad'];
const HEALTH = { HEALTHY: 'ok', WARNING: 'warn', CRITICAL: 'bad', PENDING: '' };
const EVT = { AUDIT_STARTED: 'started the audit', AUDIT_SUBMITTED: 'audit submitted', AUDIT_REOPENED: 'audit reopened', BASE_FROZEN: 'base stock frozen', BASE_UPLOADED: 'base stock uploaded', CYCLE_CLOSED: 'cycle closed',
  SERIAL_DUPLICATE: 'duplicate scan', SERIAL_NOT_FOUND: 'serial not in store base', UNLISTED_SERIAL_ADDED: 'unlisted serial added', NON_SERIAL_ADDED: 'non-serialized added', ENTRY_REMOVED: 'entry removed',
  ENTRY_EDITED: 'entry edited', PREVIEW_OPENED: 'preview opened', AUDIT_LOCKED: 'audit locked', VALIDATION_FAILED: 'upload validation failed' };
const STATUS_LBL = { COMPLETED: ['Completed', 'ok'], IN_PROGRESS: ['In Progress', 'info'], NOT_STARTED: ['Not Started', 'warn'] };
const ago = d => { const m = Math.max(0, Math.round((Date.now() - new Date(d)) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' hour' + (Math.round(m / 60) === 1 ? '' : 's') + ' ago' : Math.round(m / 1440) + ' day' + (Math.round(m / 1440) === 1 ? '' : 's') + ' ago'; };
const pager = (count, page, PS) => `<div class="bar"><span class="muted">${fn(count)} row(s)</span><div class="row"><button class="btn sm" data-pg="-1" ${page ? '' : 'disabled'}>Previous</button><button class="btn sm" data-pg="1" ${(page + 1) * PS < count ? '' : 'disabled'}>Next</button></div></div>`;
const noCycle = el => { el.innerHTML = `<div class="card startcard"><span class="big">${ic('cal', 44, 1.5)}</span><h2>No audit cycle selected</h2><p class="muted">${S.profile.role === 'ADMIN' ? 'Create one with “+ New” in the Audit Cycle box on the left, then upload each store\'s base stock.' : 'Ask an administrator to create an audit cycle.'}</p></div>`; };
const numPager = (total, page, PS) => { const n = Math.max(1, Math.ceil(total / PS)); const from = total ? page * PS + 1 : 0, to = Math.min(total, (page + 1) * PS);
  return `<div class="bar"><span class="muted">Showing ${from}–${to} of ${total}</span><div class="pg"><button data-np="${page - 1}" ${page ? '' : 'disabled'}>‹</button>${Array.from({ length: Math.min(n, 5) }, (_, i) => { const p = Math.min(Math.max(page - 2, 0), Math.max(n - 5, 0)) + i; return `<button data-np="${p}" class="${p === page ? 'on' : ''}">${p + 1}</button>`; }).join('')}<button data-np="${page + 1}" ${page + 1 < n ? '' : 'disabled'}>›</button></div></div>`; };

function donut(parts, label, sub, size = 140, sw = 16) {
  const total = parts.reduce((a, p) => a + p.v, 0), R = 60 - sw / 2 - 2, C = 2 * Math.PI * R; let off = 0;
  const segs = parts.filter(p => p.v > 0).map(p => { const len = total ? C * p.v / total : 0; const s = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${p.color}" stroke-width="${sw}" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`; off += len; return s; }).join('');
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="${esc(sub)}"><circle cx="60" cy="60" r="${R}" fill="none" stroke="#EEF3F1" stroke-width="${sw}"/>${segs}<text x="60" y="${String(label).length > 5 ? 59 : 60}" text-anchor="middle" font-size="${String(label).length > 6 ? 14 : String(label).length > 4 ? 17 : 22}" font-weight="800" fill="#0B2A1F">${esc(label)}</text><text x="60" y="75" text-anchor="middle" font-size="8.5" fill="#6B7B75">${esc(sub)}</text></svg>`;
}
function donutArgs(a) { return a; }   // (kept for readability)

function trendSvg(tr) {
  const W = 600, H = 230, L = 38, Rr = 40, T = 12, B = 30, pw = W - L - Rr, ph = H - T - B, n = Math.max(tr.length, 1), stores = Math.max(1, ...tr.map(x => Number(x.stores) || 0)), bw = Math.min(40, pw / n * .5);
  const x = i => L + pw / n * (i + .5), y = v => T + ph - ph * v / stores, yp = v => T + ph - ph * v / 100;
  let g = ''; for (let k = 0; k <= 4; k++) { const yy = T + ph * k / 4; g += `<line x1="${L}" x2="${W - Rr}" y1="${yy}" y2="${yy}" stroke="#EEF3F1"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#6B7B75">${Math.round(stores * (1 - k / 4))}</text><text x="${W - Rr + 6}" y="${yy + 4}" font-size="10" fill="#6B7B75">${100 - k * 25}%</text>`; }
  const bars = tr.map((r, i) => { const c = Number(r.completed), p = Number(r.in_progress), ns = Math.max(0, Number(r.stores) - c - p); let yy = y(0), out = '';
    [[c, '#16A34A'], [p, '#2563EB'], [ns, '#F5B301']].forEach(([v, col]) => { const h = ph * v / stores; yy -= h; if (v > 0) out += `<rect x="${x(i) - bw / 2}" y="${yy}" width="${bw}" height="${h}" fill="${col}" opacity=".9" rx="2"/>`; });
    return `<g><title>${esc(r.name)}: ${c} completed, ${p} in progress, ${ns} not started</title>${out}</g>` + `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="10" fill="#6B7B75">${esc(String(r.name).slice(0, 9))}</text>`; }).join('');
  const pts = tr.map((r, i) => Number(r.expected) > 0 ? [x(i), yp(100 * Number(r.matched) / Number(r.expected))] : null).filter(Boolean);
  const line = pts.length ? `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#F5B301" stroke-width="2.4"/>${pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3.6" fill="#fff" stroke="#F5B301" stroke-width="2"/>`).join('')}` : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Audit trend">${g}${bars}${line}</svg>`;
}
const delta = (cur, prev, lowerIsBetter) => { if (prev == null) return ''; cur = Number(cur); prev = Number(prev); if (!prev) return cur ? `<span class="up">↑ new</span> vs last cycle` : '<span class="muted">same as last cycle</span>';
  const d = (cur - prev) / prev * 100, good = lowerIsBetter ? d <= 0 : d >= 0; return `<span class="${good ? 'dn' : 'up'}">${d <= 0 ? '↓' : '↑'} ${Math.abs(d).toFixed(1)}%</span> vs last cycle`; };

PAGES.dashboard = async el => isStaff() ? adminDash(el) : storeDash(el);

/* ================= ADMIN / STAFF DASHBOARD (redesign) =================
   Only this function and css/admin-dashboard.css make up the new Dashboard. Same data functions as before (dash_overview, dash_stores, dash_trend). */
Object.assign(ICON, {
  bars: '<path d="M4 20h16"/><rect x="5.5" y="11" width="3.4" height="7" rx="1"/><rect x="10.3" y="6" width="3.4" height="12" rx="1"/><rect x="15.1" y="9" width="3.4" height="9" rx="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  warnc: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
  rate: '<path d="M4 18 9 12l4 3 7-8"/><path d="M4 20h16"/>'
});
function adSpark(vals, color, gid) {
  const W = 150, H = 46, v = vals.length < 2 ? [vals[0] || 0, vals[0] || 0] : vals, mn = Math.min(...v), mx = Math.max(...v), rg = mx - mn;
  const pts = v.map((y, i) => [W * i / (v.length - 1), rg ? H - 8 - (H - 18) * (y - mn) / rg : H * .55]);
  let d = `M${pts[0][0]},${pts[0][1]}`; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], mxp = (a[0] + b[0]) / 2; d += ` C${mxp},${a[1]} ${mxp},${b[1]} ${b[0]},${b[1]}`; }
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${W},${H} L0,${H} Z" fill="url(#${gid})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}
function adDonut(parts, total, size = 156) {
  const R = 46, sw = 17, C = 2 * Math.PI * R; let off = 0;
  const segs = parts.filter(p => p.v > 0).map(p => { const len = C * p.v / total, s = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${p.color}" stroke-width="${sw}" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`; off += len; return s; }).join('');
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="Stock condition"><circle cx="60" cy="60" r="${R}" fill="none" stroke="#EEF3F1" stroke-width="${sw}"/>${segs}
    <text x="60" y="${total > 99999 ? 58 : 59}" text-anchor="middle" font-size="${String(fn(total)).length > 7 ? 13 : 15}" font-weight="800" fill="#0B2A1F">${fn(total)}</text><text x="60" y="73" text-anchor="middle" font-size="7.6" fill="#6B7B75">Total Units</text></svg>`;
}
function adAuditTrend(tr) {
  const W = 640, H = 250, L = 40, R = 46, T = 12, B = 34, pw = W - L - R, ph = H - T - B, n = Math.max(tr.length, 1), stores = Math.max(1, ...tr.map(x => Number(x.stores) || 0)), slot = pw / n, bw = Math.min(40, slot * .46);
  const x = i => L + slot * (i + .5), y = v => T + ph - ph * v / stores, yp = v => T + ph - ph * v / 100;
  let g = ''; for (let k = 0; k <= 4; k++) { const yy = T + ph * k / 4; g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="#EDF1F0"/><text x="${L - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#6B7B75">${Math.round(stores * (1 - k / 4))}</text><text x="${W - R + 8}" y="${yy + 4}" font-size="11" fill="#6B7B75">${100 - k * 25}%</text>`; }
  const bars = tr.map((r, i) => { const c = Number(r.completed), p = Number(r.in_progress), ns = Math.max(0, Number(r.stores) - c - p); let yy = y(0), out = '';
    [[c, '#16A34A'], [p, '#2F6FED'], [ns, '#F8B814']].forEach(([v, col]) => { const h = ph * v / stores; yy -= h; if (v > 0) out += `<rect x="${x(i) - bw / 2}" y="${yy}" width="${bw}" height="${h}" fill="${col}"/>`; });
    return `<g><title>${esc(r.name)}: ${c} completed, ${p} in progress, ${ns} not started</title>${out}</g>` + `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#44564F">${esc(String(r.name).slice(0, 10))}</text>`; }).join('');
  const pts = tr.map((r, i) => [x(i), yp(Number(r.expected) > 0 ? 100 * Number(r.matched) / Number(r.expected) : 0), Number(r.expected) > 0 ? 100 * Number(r.matched) / Number(r.expected) : 0, r.name]);
  const line = pts.length ? `<polyline points="${pts.map(p => p[0] + ',' + p[1]).join(' ')}" fill="none" stroke="#F4511E" stroke-width="2"/>${pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#fff" stroke="#F4511E" stroke-width="2"><title>${esc(p[3])}: ${p[2].toFixed(1)}% match</title></circle>`).join('')}` : '';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Audit trend">${g}${bars}${line}</svg>`;
}
function adRateTrend(tr) {
  const W = 560, H = 214, L = 42, R = 14, T = 12, B = 30, pw = W - L - R, ph = H - T - B, n = Math.max(tr.length, 1), slot = pw / n, x = i => L + slot * (i + .5), y = v => T + ph - ph * v / 100;
  let g = ''; for (let k = 0; k <= 4; k++) { const yy = T + ph * k / 4; g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="#EDF1F0"/><text x="${L - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#6B7B75">${100 - k * 25}%</text>`; }
  const pts = tr.map((r, i) => { const v = Number(r.expected) > 0 ? 100 * Number(r.matched) / Number(r.expected) : 0; return [x(i), y(v), v, r.name]; });
  const xl = tr.map((r, i) => `<text x="${x(i)}" y="${H - 9}" text-anchor="middle" font-size="11" fill="#44564F">${esc(String(r.name).slice(0, 10))}</text>`).join('');
  const line = pts.length ? `<polyline points="${pts.map(p => p[0] + ',' + p[1]).join(' ')}" fill="none" stroke="#16A34A" stroke-width="2"/>${pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#fff" stroke="#16A34A" stroke-width="2"><title>${esc(p[3])}: ${p[2].toFixed(1)}%</title></circle>`).join('')}` : '';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Match rate trend"><line x1="${L}" x2="${L}" y1="${T}" y2="${T + ph}" stroke="#D3DEDA"/>${g}${xl}${line}</svg>`;
}
let adSearchCleanup = null;
function adRemoveSearch() { const e = document.getElementById('dsh-tbs'); if (e) e.remove(); if (adSearchCleanup) { adSearchCleanup(); adSearchCleanup = null; } }
if (!window.__adHashWired) { window.__adHashWired = true; window.addEventListener('hashchange', () => { const h = location.hash.replace(/^#\/?/, '').split('?')[0]; if (h && h !== 'dashboard') adRemoveSearch(); }); }

async function adminDash(el) {
  if (!S.cycleId) { adRemoveSearch(); return noCycle(el); }
  const cid = S.cycleId, AD = { metric: 'short', range: 6, f: null, trend: [], kpiTrend: [], note: false, breakdown: null }, num = v => Number(v) || 0, share = (v, tot) => tot ? 100 * v / tot : 0;
  const [o, s] = await Promise.all([sb.rpc('dash_overview', { p_cycle: cid }), sb.rpc('dash_stores', { p_cycle: cid })]);
  try { const b = await sb.rpc('dash_shortage_breakdown', { p_cycle: cid }); if (!b.error) AD.breakdown = b.data; } catch (e) { /* 24 not run yet: legend shows the total only */ }
  if (o.error) throw o.error; if (s.error) throw s.error;
  const rowsAll = s.data, circleOf = Object.fromEntries(rowsAll.map(r => [r.store_id, r.circle]));
  const heads = [...o.data.heads].sort((a, b) => num(b.stores) - num(a.stores) || String(a.label).localeCompare(b.label)).slice(0, 5);

  /* ---- trend data (all circles, or only the selected circles when filtered; cached) ---- */
  const cache = {};
  async function getTrend(n, circles) {
    const key = n + '|' + (circles ? circles.join('~') : '*'); if (cache[key]) return cache[key];
    let r = circles ? await sb.rpc('dash_trend_circles', { p_cycle: cid, p_limit: n, p_circles: circles }) : await sb.rpc('dash_trend', { p_cycle: cid, p_limit: n });
    if (r.error && circles) { AD.note = true; return getTrend(n, null); }      // filter function not installed yet: show the all-circle trend
    if (r.error) throw r.error;
    return cache[key] = r.data;
  }
  async function loadTrends() { const c = AD.f ? AD.f.circles : null; AD.note = false; [AD.kpiTrend, AD.trend] = await Promise.all([getTrend(6, c), getTrend(AD.range, c)]); }
  async function loadBreakdown() { const c = AD.f ? AD.f.circles : null;
    try { const b = await sb.rpc('dash_shortage_breakdown', { p_cycle: cid, p_circles: c }); AD.breakdown = b.error ? null : b.data; }
    catch (e) { AD.breakdown = null; } }
  await loadTrends();

  const r1 = v => Math.round(v * 10) / 10, p1 = v => r1(v).toFixed(1);
  const pal = [['#E8EAED', '#44525F'], ['#EAE5FF', '#5B3FD9'], ['#FCE3E3', '#C42B2B'], ['#DDEBFF', '#1D5FD8'], ['#FFEFC2', '#B7791F']];
  const init = n => { const w = String(n || '?').replace(/[^A-Za-z\s]/g, ' ').trim().split(/\s+/).filter(Boolean); return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); };
  const METRIC = { short: ['Shortage Units', '#F0383B'], excess: ['Excess Units', '#F59E0B'], pending: ['Pending Stores', '#2F6FED'] };
  const AP = { AUDIT_SUBMITTED: 'ok', AUDIT_STARTED: 'bl', BASE_FROZEN: 'yl', AUDIT_REOPENED: 'rd' };
  const tile = i => `<span class="hic">${ic(i, 26, 1.8)}</span>`;
  const sc = () => el.closest('.page2');

  function render() {
    const set = AD.f ? new Set(AD.f.circles) : null, rows = set ? rowsAll.filter(r => set.has(r.circle)) : rowsAll, done = rows.filter(r => r.audit_status === 'COMPLETED');
    const sum = k => done.reduce((a, r) => a + num(r[k]), 0);
    const T = { stores: rows.length, completed: done.length, in_progress: rows.filter(r => r.audit_status === 'IN_PROGRESS').length, expected: sum('expected'), matched: sum('matched'), short: sum('short'), excess: sum('excess') };
    T.not_started = T.stores - T.completed - T.in_progress; T.match_rate = T.expected > 0 ? 100 * T.matched / T.expected : null;
    const trend = AD.kpiTrend, prev = trend.length > 1 ? trend[trend.length - 2] : null, pS = prev ? num(prev.stores) : 0;

    /* KPI cards */
    const cur = { c: share(T.completed, T.stores), p: share(T.in_progress, T.stores), n: share(T.not_started, T.stores) };
    const old = prev ? { c: share(num(prev.completed), pS), p: share(num(prev.in_progress), pS), n: share(Math.max(0, pS - num(prev.completed) - num(prev.in_progress)), pS) } : { c: 0, p: 0, n: 100 };
    const dBadge = (d, total) => { const r = r1(d); return r > 0 ? `<span class="bdg up">↑ ${total ? '' : '+'}${r}%</span>` : r < 0 ? `<span class="bdg dn">↓ ${r}%</span>` : total ? '<span class="bdg up">↑ 0%</span>' : '<span class="bdg fl">− 0%</span>'; };
    const series = k => trend.map(x => k === 's' ? num(x.stores) : k === 'c' ? num(x.completed) : k === 'p' ? num(x.in_progress) : Math.max(0, num(x.stores) - num(x.completed) - num(x.in_progress)));
    const kc = (cls, tileStyle, icon, label, val, pctTxt, pctCol, sub, badge, k, col, tab) => `<div class="dsh-k ${cls}" role="button" tabindex="0" data-kpi="${tab}" title="View ${label === 'Total Stores' ? 'all' : label.toLowerCase()} stores"><span class="ico" style="${tileStyle}">${ic(icon, 24, 2)}</span><div><div class="lb">${label}</div><div class="nm"><b>${fn(val)}</b>${pctTxt ? `<span style="color:${pctCol}">${pctTxt}</span>` : ''}</div>${sub ? `<div class="sb2">${sub}</div>` : ''}</div>${badge}${adSpark(series(k), col, 'dshg-' + k)}</div>`;
    const kpis = kc('blue', 'background:#DCE8FF;color:#2F6FED', 'store', 'Total Stores', T.stores, '', '', '', dBadge(pS ? 100 * (T.stores - pS) / pS : 0, true), 's', '#2F6FED', 'ALL')
      + kc('green', 'background:#16A34A;color:#fff', 'check', 'Completed', T.completed, p1(cur.c) + '%', '#16A34A', `${fn(T.completed)} / ${fn(T.stores)} stores`, dBadge(cur.c - old.c), 'c', '#16A34A', 'COMPLETED')
      + kc('blue', 'background:#DCE8FF;color:#2F6FED', 'sync', 'In Progress', T.in_progress, p1(cur.p) + '%', '#2F6FED', `${fn(T.in_progress)} / ${fn(T.stores)} stores`, dBadge(cur.p - old.p), 'p', '#2F6FED', 'IN_PROGRESS')
      + kc('amber', 'background:#FFE7B0;color:#F59E0B', 'alert', 'Not Started', T.not_started, p1(cur.n) + '%', '#F59E0B', `${fn(T.not_started)} / ${fn(T.stores)} stores`, dBadge(cur.n - old.n), 'n', '#F8B814', 'NOT_STARTED');

    /* circle heads (always all heads, the selected one is highlighted) */
    const headCards = heads.map((h, i) => { const st = num(h.stores), dn = num(h.completed), pend = st - dn, pc = v => st ? Math.round(100 * v / st) : 0, cs = h.circles || [], pl = pal[i % pal.length], on = AD.f && AD.f.type === 'head' && AD.f.key === h.key;
      return `<div class="dsh-h ${on ? 'sel' : ''}" role="button" tabindex="0" data-head="${i}" aria-pressed="${on}" title="${on ? 'Click to clear the filter' : 'Show the dashboard for ' + esc(h.label)}"><div class="hd"><span class="av" style="background:${pl[0]};color:${pl[1]}">${esc(init(h.label))}</span><div class="nm"><b title="${esc(h.label)}">${esc(h.label)}</b></div></div>
        <div class="chips">${cs.slice(0, 4).map(c => `<span title="${esc(c)}">${esc(c)}</span>`).join('')}${cs.length > 4 ? `<span>+${cs.length - 4}</span>` : ''}</div>
        <div class="st"><div><small>Total Stores</small><b>${st}</b></div><div><small>Completed</small><b class="g">${dn} (${pc(dn)}%)</b></div><div><small>Pending</small><b class="r">${pend} (${pc(pend)}%)</b></div></div></div>`; }).join('');

    /* circle heads manage a few circles, so they get one card per circle (all circles, the selected one is highlighted) */
    const isHead = !isAdmin(), cstat = {};
    rowsAll.forEach(r => { const c = cstat[r.circle] = cstat[r.circle] || { name: r.circle, stores: 0, done: 0 }; c.stores++; if (r.audit_status === 'COMPLETED') c.done++; });
    const circCards = Object.values(cstat).sort((a, b) => String(a.name).localeCompare(b.name)).map((c, i) => { const pend = c.stores - c.done, pc = v => c.stores ? Math.round(100 * v / c.stores) : 0, pl = pal[i % pal.length], on = AD.f && AD.f.type === 'circle' && AD.f.key === c.name;
      return `<div class="dsh-h dsh-c ${on ? 'sel' : ''}" role="button" tabindex="0" data-circ="${esc(c.name)}" aria-pressed="${on}" title="${on ? 'Click to clear the filter' : 'Show the dashboard for ' + esc(c.name)}"><div class="hd"><span class="av" style="background:${pl[0]};color:${pl[1]}">${esc(String(c.name).slice(0, 2).toUpperCase())}</span><div class="nm"><b title="${esc(c.name)}">${esc(c.name)}</b></div></div>
        <div class="st"><div><small>Total Stores</small><b>${c.stores}</b></div><div><small>Completed</small><b class="g">${c.done} (${pc(c.done)}%)</b></div><div><small>Pending</small><b class="r">${pend} (${pc(pend)}%)</b></div></div></div>`; }).join('');

    /* top circles */
    const cmap = {}; rows.forEach(r => { const c = cmap[r.circle] = cmap[r.circle] || { name: r.circle, stores: 0, done: 0, short: 0, excess: 0 }; c.stores++; if (r.audit_status === 'COMPLETED') { c.done++; c.short += num(r.short); c.excess += num(r.excess); } });
    const [mLabel, mCol] = METRIC[AD.metric], val = c => AD.metric === 'pending' ? c.stores - c.done : c[AD.metric];
    const top = Object.values(cmap).sort((a, b) => val(b) - val(a) || b.stores - a.stores || String(a.name).localeCompare(b.name)).slice(0, 5), mx = Math.max(1, ...top.map(val));
    const bars = top.length ? top.map(c => `<div class="dsh-bar" role="button" tabindex="0" data-circ="${esc(c.name)}" title="Show only ${esc(c.name)}"><span class="nm">${esc(c.name)}</span><div class="tr"><i style="width:${val(c) ? Math.max(2, 100 * val(c) / mx) : 0}%;background:${mCol}"></i></div><b class="vl" style="color:${mCol}">${fn(val(c))}</b></div>`).join('') : '<div class="dsh-empty">No circles to show.</div>';

    /* stock condition (shortage split into in-transit / serialized / non-serialized) */
    const others = Math.max(0, T.expected - T.matched - T.short), stockTot = T.matched + T.short + T.excess + others;
    const bd = AD.breakdown, bdn = v => Math.max(0, Math.round(Number(v) || 0));
    const shTransit = bd ? bdn(bd.short_transit) : 0, shSer = bd ? bdn(bd.ser_short) : 0, shNon = bd ? bdn(bd.non_short) : 0;
    const donutParts = bd
      ? [{ v: T.matched, color: '#16A34A' }, { v: shTransit, color: '#FCA5A5' }, { v: shSer, color: '#E5484D' }, { v: shNon, color: '#F59E0B' }, { v: T.excess, color: '#F8B814' }, { v: others, color: '#7D8A99' }]
      : [{ v: T.matched, color: '#16A34A' }, { v: T.short, color: '#F0383B' }, { v: T.excess, color: '#F8B814' }, { v: others, color: '#7D8A99' }];
    const legRow = (label, val, color, tint, legend, tip) => {
      const attrs = legend ? ` class="tint lk" role="button" tabindex="0" data-legend="${legend}" title="Rank circles by ${label.toLowerCase()} units"` : ` class="tint"${tip ? ` title="${tip}"` : ''}`;
      return `<div${attrs} style="--tint:${tint};--pill:${color}"><i style="background:${color}"></i><span>${label}</span><b>${fn(val)}</b><span class="p">${stockTot ? (100 * val / stockTot).toFixed(1) : '0.0'}%</span></div>`;
    };
    const legSub = (label, val, color) => `<div class="sub" title="${T.short ? (100 * val / T.short).toFixed(1) : '0.0'}% of total shortage"><i style="background:${color}"></i><span>${label}</span><b>${fn(val)}</b><span class="p">${T.short ? (100 * val / T.short).toFixed(1) : '0.0'}%</span></div>`;
    const shortSubs = bd ? `<div class="tree">${legSub('In transit', shTransit, '#FCA5A5')}${legSub('Serialized', shSer, '#E5484D')}${legSub('Non-serialized', shNon, '#F59E0B')}</div>` : '';
    const stockLeg = legRow('Available', T.matched, '#16A34A', '#E7F6ED', '')
      + legRow('Short', T.short, '#E5484D', '#FDECEC', 'short')
      + shortSubs
      + legRow('Excess', T.excess, '#F8B814', '#FEF6DE', 'excess')
      + legRow('Others', others, '#7D8A99', '#F1F4F6', '', 'Expected units that are neither matched nor short');
    const bdHint = !bd && isAdmin() ? `<div class="alert warn" style="margin:0 4px 10px"><b>Database update needed.</b> The shortage split (in-transit / serialized / non-serialized) is hidden because the database is on the older version. Run <code>database/24_stock_shortage_breakdown.sql</code> in the Supabase SQL editor, then refresh.</div>` : '';

    /* tables */
    const crit = done.filter(r => r.match_rate != null && r.match_rate < 75).sort((a, b) => a.match_rate - b.match_rate || num(b.short) - num(a.short)).slice(0, 5);
    const critRows = crit.length ? crit.map(r => `<tr class="go" data-go="#/storedetail?s=${r.store_id}" title="${esc(r.code)}"><td><a class="sn" href="#/storedetail?s=${r.store_id}">${esc(r.name)}</a></td><td>${esc(r.circle)}</td><td class="neg">${pct(r.match_rate)}</td><td class="neg">${fn(r.short)}</td><td>${fn(r.excess)}</td></tr>`).join('') : '<tr><td colspan="5" class="none">No critical stores.</td></tr>';
    const act = o.data.activity.filter(a => !set || set.has(circleOf[a.store_id])).slice(0, 5);
    const actRows = act.map(a => `<tr class="go" data-go="#/storedetail?s=${a.store_id}"><td><a class="sn" href="#/storedetail?s=${a.store_id}">${esc(a.store_code || '—')}</a></td><td>${esc(circleOf[a.store_id] || '-')}</td><td><span class="ap ${AP[a.event_type] || 'gr'}">${EVT[a.event_type] || esc(a.event_type)}</span></td><td class="tm">${ago(a.created_at)}</td></tr>`).join('') || '<tr><td colspan="4" class="none">No activity yet.</td></tr>';

    const now = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\b(am|pm)\b/, m => m.toUpperCase());
    const chip = AD.f ? `<div class="dsh-fchip"><span>Showing</span><b title="${esc(AD.f.label)}">${esc(AD.f.label)}</b><i>${fn(T.stores)} store${T.stores === 1 ? '' : 's'}</i><button type="button" data-clear aria-label="Clear filter">✕ Clear</button></div>` : '<span></span>';
    const y = sc() ? sc().scrollTop : 0;
    el.innerHTML = `<div class="dsh">
    <div class="dsh-upd">${chip}<div class="r"><span>Last Updated : ${esc(now)}</span><button id="dsh-ref" type="button">${ic('sync', 15, 2)} Refresh</button></div></div>
    <div class="dsh-kpis">${kpis}</div>
    ${isHead ? `<section class="dsh-card"><div class="dsh-head">${tile('users')}<div class="ht"><b>Circle Summary</b><small>Select a circle to filter the dashboard</small></div></div>
      ${circCards ? `<div class="dsh-heads auto">${circCards}</div>` : '<div class="dsh-empty">No circles to show.</div>'}</section>`
    : `<section class="dsh-card"><div class="dsh-head">${tile('user')}<div class="ht"><b>Circle Head Summary</b><small>Select a circle head to filter the dashboard</small></div><div class="hr"><a class="dsh-btn" href="#/users">View All Circle Heads ${ic('arrow', 15, 2)}</a></div></div>
      ${headCards ? `<div class="dsh-heads">${headCards}</div>` : '<div class="dsh-empty">No circle heads or circles to show.</div>'}</section>`}
    <div class="dsh-r2">
      <section class="dsh-card"><div class="dsh-head">${tile('users')}<div class="ht"><b>Top 5 Circles</b></div><div class="hr"><select id="dsh-metric" aria-label="Rank circles by">${Object.entries(METRIC).map(([k, v]) => `<option value="${k}" ${k === AD.metric ? 'selected' : ''}>By ${v[0]}</option>`).join('')}</select></div></div><div class="dsh-bars">${bars}</div></section>
      <section class="dsh-card"><div class="dsh-head">${tile('box')}<div class="ht"><b>Stock Condition</b></div></div>
        ${bdHint}
        <div class="dsh-stock">${adDonut(donutParts, stockTot, 132)}<div class="dsh-leg">${stockLeg}</div></div></section>
    </div>
    <div class="dsh-r3">
      <section class="dsh-card"><div class="dsh-head">${tile('bars')}<div class="ht"><b>Audit Trend</b>${AD.note ? '<small class="warn">Trend shows all circles (run database/13_dashboard_filter.sql to filter it)</small>' : ''}</div><div class="hr"><select id="dsh-range" aria-label="Number of cycles">${[3, 6, 12].map(n => `<option value="${n}" ${n === AD.range ? 'selected' : ''}>Last ${n} Cycles</option>`).join('')}</select></div></div>
        <div class="dsh-lgd"><span><i style="background:#16A34A"></i>Completed</span><span><i style="background:#2F6FED"></i>In Progress</span><span><i style="background:#F8B814"></i>Not Started</span><span><i class="ln"></i>&nbsp;&nbsp;Match Rate %</span></div><div class="dsh-chart">${adAuditTrend(AD.trend)}</div></section>
      <section class="dsh-card"><div class="dsh-head"><span class="hic" style="color:#E5484D">${ic('rate', 26, 1.8)}</span><div class="ht"><b>Match Rate Trend</b></div><div class="hr"><div class="dsh-ovr"><span class="t">${ic('target', 18, 2)}</span><div><small>Overall Match Rate</small><b>${T.match_rate == null ? '—' : pct(T.match_rate)}</b></div></div></div></div><div class="dsh-chart">${adRateTrend(AD.trend)}</div></section>
    </div>
    <div class="dsh-r4">
      <section class="dsh-card"><div class="dsh-head"><span class="hic" style="color:#E5484D">${ic('warnc', 26, 1.8)}</span><div class="ht"><b>Critical Stores</b></div><div class="hr"><a class="dsh-vall bl" href="#/storeaudit" data-crit>View All ${ic('arrow', 14, 2)}</a></div></div>
        <div class="dsh-tw"><table class="dsh-t"><thead><tr><th>Store Name</th><th>Circle</th><th>Match Rate</th><th>Short Units</th><th>Excess Units</th></tr></thead><tbody>${critRows}</tbody></table></div></section>
      <section class="dsh-card"><div class="dsh-head"><span class="hic" style="color:#E5484D">${ic('clock', 26, 1.8)}</span><div class="ht"><b>Recently Updated Stores</b></div><div class="hr"><a class="dsh-vall" href="#/logs">View All ${ic('arrow', 14, 2)}</a></div></div>
        <div class="dsh-tw"><table class="dsh-t"><thead><tr><th>Store Name</th><th>Circle</th><th>Action</th><th>Time</th></tr></thead><tbody>${actRows}</tbody></table></div></section>
    </div></div>`;
    if (sc()) sc().scrollTop = y;
    AD.shown = { rows, set };
  }

  /* ---- filter + interactions ---- */
  async function setFilter(f) {
    el.classList.add('dsh-busy'); AD.f = f;
    try { await loadTrends(); } catch (e) { toast(rpcMsg(e), 'err'); }
    await loadBreakdown();
    render(); el.classList.remove('dsh-busy');
  }
  const same = (a, b) => a && b && a.type === b.type && a.key === b.key;
  const go = (tab) => { const set = AD.f && AD.f.circles.length === 1 ? AD.f.circles[0] : ''; window.__auditPreset = { tab, circle: set }; location.hash = '#/storeaudit'; };
  el.onclick = e => {
    const t = e.target;
    if (t.closest('#dsh-ref')) { t.closest('#dsh-ref').classList.add('spin'); PAGES.dashboard(el).catch(x => { el.innerHTML = '<div class="alert err">Could not load this page. ' + esc(friendlyError(x)) + '</div>'; }); return; }
    if (t.closest('[data-clear]')) return setFilter(null);
    if (t.closest('[data-crit]')) { window.__auditPreset = { tab: 'CRIT', circle: AD.f && AD.f.circles.length === 1 ? AD.f.circles[0] : '' }; return; }
    if (t.closest('a')) return;
    const h = t.closest('[data-head]'); if (h) { const hd = heads[+h.dataset.head], f = { type: 'head', key: hd.key, label: hd.label, circles: hd.circles || [] }; return setFilter(same(AD.f, f) ? null : f); }
    const c = t.closest('[data-circ]'); if (c) { const f = { type: 'circle', key: c.dataset.circ, label: c.dataset.circ + ' circle', circles: [c.dataset.circ] }; return setFilter(same(AD.f, f) ? null : f); }
    const k = t.closest('[data-kpi]'); if (k) return go(k.dataset.kpi);
    const l = t.closest('[data-legend]'); if (l) { AD.metric = l.dataset.legend; return render(); }
    const r = t.closest('tr[data-go]'); if (r) location.hash = r.dataset.go;
  };
  el.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) { e.preventDefault(); e.target.click(); } };
  el.onchange = async e => {
    if (e.target.id === 'dsh-metric') { AD.metric = e.target.value; render(); }
    if (e.target.id === 'dsh-range') { AD.range = Number(e.target.value); el.classList.add('dsh-busy'); try { await loadTrends(); } catch (x) { toast(rpcMsg(x), 'err'); } render(); el.classList.remove('dsh-busy'); }
  };
  render();

  /* ---- top-bar search (lives in the header; removed again when you leave the Dashboard) ---- */
  adRemoveSearch();
  const tbr = document.querySelector('.tb-r');
  if (tbr) {
    const box = document.createElement('div'); box.className = 'dsh-search'; box.id = 'dsh-tbs';
    box.innerHTML = `<div class="inp2">${ic('search', 18, 2)}<input id="dsh-q" type="search" placeholder="Search stores, circles, or store codes..." autocomplete="off" aria-label="Search stores, circles, or store codes"></div><div class="res" id="dsh-res" hidden></div>`;
    tbr.insertBefore(box, tbr.firstChild);
    const inp = box.querySelector('#dsh-q'), res = box.querySelector('#dsh-res');
    const find = () => { const q = inp.value.trim().toLowerCase(); if (!q) { res.hidden = true; return; }
      const hit = rowsAll.filter(r => (r.name + ' ' + r.code + ' ' + r.circle).toLowerCase().includes(q)).slice(0, 8);
      res.innerHTML = hit.length ? hit.map(r => `<a href="#/storedetail?s=${r.store_id}"><b>${esc(r.name)}</b><small>${esc(r.code)} · ${esc(r.circle)}</small></a>`).join('') : '<div class="none">No stores match.</div>'; res.hidden = false; };
    inp.oninput = find; inp.onfocus = find;
    inp.onkeydown = e => { if (e.key === 'Escape') { res.hidden = true; inp.blur(); } if (e.key === 'Enter') { const a = res.querySelector('a'); if (a) { location.hash = a.getAttribute('href'); res.hidden = true; inp.value = ''; } } };
    res.onclick = () => { res.hidden = true; inp.value = ''; };
    const away = e => { if (!box.contains(e.target)) res.hidden = true; }; document.addEventListener('click', away); adSearchCleanup = () => document.removeEventListener('click', away);
  }
}

/* ================= STORE AUDIT (all stores) ================= */
PAGES.storeaudit = async el => {
  if (!S.cycleId) return noCycle(el);
  const cid = S.cycleId, { data: rows, error } = await sb.rpc('dash_stores', { p_cycle: cid }); if (error) throw error;
  const F = { circle: '', status: '', rate: '', variance: '', q: '', tab: 'ALL', page: 0 }; const PS = 10; if (window.__auditPreset) { Object.assign(F, window.__auditPreset); window.__auditPreset = null; }
  const circleIdOf = Object.fromEntries(rows.map(r => [r.circle, r.circle_id]));
  const crit = r => r.audit_status === 'COMPLETED' && r.match_rate != null && r.match_rate < 75;
  const overdue = r => r.audit_status !== 'COMPLETED' && S.cycleDeadline && Date.now() > new Date(S.cycleDeadline).getTime();
  const list = () => rows.filter(r => (!F.circle || r.circle === F.circle) && (!F.status || r.audit_status === F.status) && (!F.q || (r.name + ' ' + r.code + ' ' + r.circle).toLowerCase().includes(F.q))
    && (!F.rate || (r.match_rate != null && (F.rate === 'crit' ? r.match_rate < 75 : F.rate === 'warn' ? r.match_rate >= 75 && r.match_rate < 90 : r.match_rate >= 90)))
    && (!F.variance || (F.variance === 'short' ? Number(r.short) > 0 : Number(r.excess) > 0))
    && (F.tab === 'ALL' || (F.tab === 'CRIT' ? crit(r) : F.tab === 'OVERDUE' ? overdue(r) : r.audit_status === F.tab)));
  const cnt = k => k === 'ALL' ? rows.length : k === 'CRIT' ? rows.filter(crit).length : k === 'OVERDUE' ? rows.filter(overdue).length : rows.filter(r => r.audit_status === k).length;
  const sel = (id, label, opts, cur) => `<div><label>${label}</label><select id="${id}">${opts.map(o => `<option value="${o[0]}" ${o[0] === cur ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>`;
  function table() {
    const l = list(), pageRows = l.slice(F.page * PS, F.page * PS + PS);
    return tbl(['Store Name', 'Circle', 'Status', 'Match Rate', 'Physical Found', 'Short', 'Excess', 'Last Updated', 'Action'], pageRows.map(r => { const s = crit(r) ? ['Critical', 'bad'] : STATUS_LBL[r.audit_status];
      return `<tr><td><b>${esc(r.name)}</b><br><span class="muted">${esc(r.code)}</span></td><td>${esc(r.circle)}</td><td>${badge(s[0], s[1])}${overdue(r) ? ' ' + badge('Overdue', 'bad') : ''}</td><td>${r.match_rate == null ? '—' : `<b class="${r.match_rate < 75 ? 'neg' : ''}">${pct(r.match_rate)}</b>`}</td><td>${r.physical == null ? '—' : fn(r.physical)}</td>
        <td class="${Number(r.short) ? 'neg' : ''}">${r.short == null ? '—' : fn(r.short)}</td><td class="${Number(r.excess) ? 'pos' : ''}">${r.excess == null ? '—' : fn(r.excess)}</td><td class="nw">${r.last_updated ? fdt(r.last_updated) : '—'}</td><td><a class="eyeb" href="#/storedetail?s=${r.store_id}" title="Open store">${ic('eye', 17)}</a></td></tr>`; }).join('')) + numPager(l.length, F.page, PS);
  }
  el.innerHTML = `<div class="filters"><span style="flex:1"></span><button class="btn yel" id="exp">${ic('dl', 16)} Export</button></div>
    <div class="card" style="padding:16px"><div class="filters">${sel('f_ci', 'Circle', [['', 'All Circles'], ...[...new Set(rows.map(r => r.circle))].sort().map(c => [c, c])], F.circle)}${sel('f_st', 'Store Status', [['', 'All Status'], ['COMPLETED', 'Completed'], ['IN_PROGRESS', 'In Progress'], ['NOT_STARTED', 'Not Started']], F.status)}
      ${sel('f_ra', 'Match Rate', [['', 'All'], ['crit', 'Critical (< 75%)'], ['warn', 'Warning (75–90%)'], ['ok', 'Healthy (≥ 90%)']], F.rate)}${sel('f_va', 'Variance', [['', 'All'], ['short', 'Has short units'], ['excess', 'Has excess units']], F.variance)}
      <div style="flex:1;min-width:240px"><label>Search</label><div class="inp">${ic('search', 18)}<input id="f_q" placeholder="Search store name or circle... (Enter on an item code or serial to find it)"></div></div></div>
      <div class="tabs seg" id="tabs" style="margin-bottom:12px">${[['ALL', 'All Stores'], ['COMPLETED', 'Completed'], ['IN_PROGRESS', 'In Progress'], ['NOT_STARTED', 'Not Started'], ...(S.cycleDeadline ? [['OVERDUE', 'Overdue']] : []), ['CRIT', 'Critical']].map(t => `<button class="tab ${t[0] === F.tab ? 'on' : ''} ${['CRIT', 'OVERDUE'].includes(t[0]) ? 'red' : ''}" data-tab="${t[0]}">${t[1]} (${cnt(t[0])})</button>`).join('')}</div>
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
    const x = e.target.closest('#exp'); if (x) busy(x, () => downloadReport('store_summary', cid, F.circle ? circleIdOf[F.circle] || null : null, null, false)).catch(err => toast(rpcMsg(err), 'err')); };
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
      <div class="row">${locked ? `<a class="btn" href="#/result?sess=${L.id}">${ic('clip', 16)} Full reconciliation</a><button class="btn danger-o" id="reopen">${ic('alert', 15)} Reopen audit</button>` : ''}<a class="btn" href="#/basestock?s=${sid}">${ic('box', 15)} ${base ? 'Revise base stock' : 'Upload base stock'}</a>
        <button class="btn yel" id="dlr" ${locked ? '' : 'disabled'}>${ic('dl', 16)} Download Report</button></div></div>
    <div class="tabs seg" id="tabs" style="margin-bottom:14px">${[['overview', 'Overview'], ['variance', 'Variance Details'], ['serial', 'Serialized Items'], ['nonserial', 'Non-Serialized Items'], ['history', 'Audit History']].map(t => `<button class="tab ${t[0] === tab ? 'on' : ''}" data-tab="${t[0]}">${t[1]}</button>`).join('')}</div><div id="tabbody"></div>`;
  const body = el.querySelector('#tabbody'), reload = () => PAGES.storedetail(el), needLocked = '<div class="card" style="padding:20px"><p class="muted" style="margin:0">Available once the store submits its audit.</p></div>';
  const tl = (i, bg, fg) => `<span class="tile" style="background:${bg};color:${fg}">${ic(i, 18)}</span>`;

  async function show() {
    el.querySelectorAll('#tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab)); body.innerHTML = '<div class="boot">Loading…</div>';
    if (tab === 'overview') {
      let vb = { ser_short: 0, ser_excess: 0, non_short: 0, non_excess: 0 }, issues = [], units = 0, pend = null, trs = 0;
      if (locked) { const [a, b, rsm] = await Promise.all([sb.rpc('store_variance_breakdown', { p_session: L.id }), sb.from('reconciliation_results').select('item_code,inventory_status,item_quality,item_description,is_serialized,expected_qty,physical_qty,short_qty,result').eq('session_id', L.id).neq('result', 'MATCH').order('short_qty', { ascending: false }).limit(5), sb.rpc('result_summary', { p_session: L.id })]); vb = a.data || vb; issues = b.data || []; trs = Number((rsm.data && rsm.data.short_transit) || 0); }
      else if (L) {
        let u = null;
        try { const r = await sb.rpc('session_counted_units', { p_session: L.id }); if (r.error) throw r.error; u = r.data; } catch (e) { u = null; /* 23_perf.sql not run yet: fall back */ }
        if (u) units = Number(u.serial_scans || 0) + Number(u.non_serial_qty || 0);
        else { const [c1, c2] = await Promise.all([sb.from('audit_serial_scans').select('id', { count: 'exact', head: true }).eq('session_id', L.id), sb.from('audit_non_serial_entries').select('physical_qty').eq('session_id', L.id)]); units = (c1.count || 0) + (c2.data || []).reduce((a, x) => a + Number(x.physical_qty), 0); }
      }
      const exp = Number(base?.expected_units || 0), prog = locked ? 100 : exp ? Math.min(100, Math.round(100 * units / exp)) : 0, mx = Math.max(1, vb.ser_short, vb.ser_excess, vb.non_short, vb.non_excess);
      const kc = (l, i, bg, fg, v, cls = '') => `<div class="card kcard ${cls}"><div class="kt">${tl(i, bg, fg)}${l}</div><div class="kv1"><b>${v}</b></div></div>`;
      const vr = (l, v, col) => `<div class="vbar"><span>${l}</span><div class="tr"><i style="width:${100 * v / mx}%;background:${col}"></i></div><b>${fn(v)}</b></div>`;
      body.innerHTML = `<div class="kgrid4" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">${kc('Match Rate', 'target', '#FFE0E0', '#E5484D', rate == null ? '—' : pct(rate), rate != null && rate < 75 ? 'tint-r' : rate != null && rate >= 90 ? 'tint-g' : '')}${kc('Base Items', 'box', '#E5EDFF', '#2563EB', fn(exp), 'tint-b')}${kc('Physical Found', 'check', '#E6F7EC', '#16A34A', fn(locked ? L.physical_units : units), 'tint-g')}${kc('Short', 'alert', '#FFE0E0', '#E5484D', locked ? fn(L.short_units) + (Number(L.short_units) ? `<span class="shsplit">In transit ${fn(trs)} · Other ${fn(Number(L.short_units) - trs)}</span>` : '') : '—', 'tint-r')}${kc('Excess', 'zap', '#FFF1CC', '#C58A00', locked ? fn(L.excess_units) : '—', 'tint-y')}</div>
        <div class="dgrid2"><div class="card" style="padding:18px"><div class="cardhead">${tl('bars', '#E5EDFF', '#2563EB')}<b>Variance by Type</b></div>${locked ? vr('Serialized Short', vb.ser_short, '#E5484D') + vr('Non-Serialized Short', vb.non_short, '#F59E0B') + vr('Serialized Excess', vb.ser_excess, '#2563EB') + vr('Non-Serialized Excess', vb.non_excess, '#14B8A6') : '<p class="muted">Shown after the audit is submitted.</p>'}</div>
          <div class="card" style="padding:18px"><div class="cardhead">${tl('clock', '#E5EDFF', '#2563EB')}<b>Audit Progress</b>${L ? badge(locked ? 'Completed' : 'In Progress', locked ? 'ok' : 'info') : badge('Not started')}</div><div class="muted">${L ? (locked ? 'Submitted on ' + fdt(L.submitted_at) : 'Started on ' + fdt(L.started_at)) : 'The store has not started its audit.'}</div>
            <div class="hbar" style="height:10px"><i style="flex:${prog};background:#16A34A"></i><i style="flex:${100 - prog};background:#E5E7EB"></i></div><div class="muted">${locked ? 'Version ' + L.version + ' · base ' + fn(exp) + ' units' : 'Counted so far: ' + fn(units) + ' of ' + fn(exp) + ' base units (' + prog + '%)'}</div>
            <a class="btn" style="margin-top:12px" href="#/logs?store=${sid}">${ic('file', 16)} View Audit Log</a></div></div>
        <div class="card" style="padding:18px;margin-top:14px"><div class="cardhead">${tl('alert', '#FFE0E0', '#E5484D')}<b>Recent Issues</b></div>${tbl(['Item Code', 'Inventory status', 'Quality', 'Description', 'Type', 'Expected', 'Physical', 'Variance', 'Status'], issues.map(r => { const v = Number(r.physical_qty) - Number(r.expected_qty), sev = r.result === 'SHORT' && Number(r.expected_qty) > 0 && Number(r.short_qty) / Number(r.expected_qty) >= .5;
          return `<tr><td><b>${esc(r.item_code)}</b></td><td>${esc(r.inventory_status || '—')}</td><td>${esc(r.item_quality || '—')}</td><td>${esc(r.item_description || '')}</td><td>${r.result === 'SHORT' ? 'Short' : 'Excess'}</td><td>${fn(r.expected_qty)}</td><td>${fn(r.physical_qty)}</td><td class="${v < 0 ? 'neg' : 'pos'}">${v > 0 ? '+' : ''}${fn(v)}</td><td>${badge(r.result === 'SHORT' ? (sev ? 'Critical' : 'High') : 'Excess', r.result === 'SHORT' ? 'bad' : 'warn')}</td></tr>`; }).join(''))}</div>`;
    } else if (tab === 'variance' || tab === 'serial' || tab === 'nonserial') { if (!locked) { body.innerHTML = needLocked; return; } await variance(tab); }
    else if (tab === 'history') {
      const ev = await sb.from('audit_events').select('event_type,created_at,user_id,metadata').eq('audit_cycle_id', cid).eq('store_id', sid).neq('event_type', 'SERIAL_SCANNED').order('created_at', { ascending: false }).limit(30);
      const uids = [...new Set((ev.data || []).map(e => e.user_id).filter(Boolean))].filter(i => !names[i]); if (uids.length) ((await sb.from('profiles').select('id,full_name').in('id', uids)).data || []).forEach(x => (names[x.id] = x.full_name));
      body.innerHTML = `<div class="card" style="padding:18px"><b>Versions</b>${sess.map(v => `<div class="hist"><b>Version ${v.version}</b>${v.status === 'REOPENED' ? ' ' + badge('Superseded') : ''}${v.reopened_at ? `<br>Reopened: ${fdt(v.reopened_at)} by ${esc(who(v.reopened_by))}<br>Reason: “${esc(v.reopen_reason)}”` : ''}<br>${v.submitted_at ? 'Submitted: ' + fdt(v.submitted_at) + ' by ' + esc(who(v.submitted_by)) : 'In progress (not yet submitted)'}</div>`).join('') || '<div class="muted">No audit yet.</div>'}</div>
        <div class="card" style="padding:18px;margin-top:14px"><b>Recent events</b>${(ev.data || []).map(e => `<div class="act"><span class="muted">${fdt(e.created_at)}</span><span>${EVT[e.event_type] || esc(e.event_type)}${e.metadata && e.metadata.serial ? ' · ' + esc(e.metadata.serial) : ''}${e.metadata && e.metadata.item_code ? ' · ' + esc(e.metadata.item_code) : ''} <span class="muted">${esc(who(e.user_id))}</span></span></div>`).join('') || '<div class="muted">No events.</div>'}</div>`;
    }
  }
  const VC = [{ k: 'item_code', l: 'Item code', t: 'list' }, { k: 'inventory_status', l: 'Inventory status', t: 'list' }, { k: 'item_quality', l: 'Quality', t: 'list' }, { k: 'item_description', l: 'Description', t: 'text' },
    { k: 'item_uom', l: 'UoM', t: 'list' }, { k: 'is_serialized', l: 'Type', t: 'list', vals: ['true', 'false'], lab: { true: 'Serialized', false: 'Non-Serialized' } }, { k: 'item_sno', l: 'Serial', t: 'text' },
    { k: 'expected_qty', l: 'Expected', t: 'num' }, { k: 'physical_qty', l: 'Physical', t: 'num' }, { k: 'variance', l: 'Variance', t: 'num' }, { k: 'matched_qty', l: 'Matched', t: 'num' },
    { k: 'short_qty', l: 'Short', t: 'num' }, { k: 'excess_qty', l: 'Excess', t: 'num' }, { k: 'result', l: 'Status', t: 'list', vals: ['SHORT', 'EXCESS'] }];
  async function variance(kind) {
    let f = 'ALL', page = 0;
    const fvR = await sb.rpc('result_filter_values', { p_session: L.id });          // distinct values for the tick-lists (database/19)
    const fetchFV = async c => { const col = c.col || c.k; const r = await sb.from('reconciliation_results').select(col).eq('session_id', L.id); return r.error || !r.data ? null : r.data.map(x => x[col]); };   // on-demand fallback: keeps the tick-list UI even when the RPC has no values
    const CF = colFilters(VC, fvR && !fvR.error ? fvR.data : null, () => { page = 0; draw().catch(e => toast(rpcMsg(e), 'err')); }, fetchFV);
    async function draw() {
      let qb = sb.from('reconciliation_results').select('item_code,inventory_status,item_description,item_uom,item_quality,item_sno,expected_qty,physical_qty,matched_qty,short_qty,excess_qty,result,is_unlisted,is_serialized', { count: 'exact' }).eq('session_id', L.id);
      if (kind === 'serial') qb = qb.eq('is_serialized', true); if (kind === 'nonserial') qb = qb.eq('is_serialized', false); qb = f === 'ALL' ? qb.neq('result', 'MATCH') : qb.eq('result', f);
      qb = CF.apply(qb);
      const { data, error, count } = await qb.order('result').order('item_code').order('item_sno').range(page * PS, page * PS + PS - 1); if (error) throw error;
      let xs = {}; const ex = data.filter(r => r.result === 'EXCESS' && r.item_sno).map(r => r.item_sno);
      if (kind !== 'nonserial' && ex.length) { const r = await sb.rpc('serial_cross_store', { p_cycle: cid, p_store: sid, p_serials: ex }); xs = r.data || {}; }
      const ft = `<div class="tabs seg" style="margin-bottom:12px">${[['ALL', 'All variances'], ['SHORT', 'Short'], ['EXCESS', 'Excess']].map(t => `<button class="tab ${f === t[0] ? 'on' : ''}" data-f="${t[0]}">${t[1]}</button>`).join('')}</div>`;
      const rs = r => badge(r.result === 'SHORT' ? 'Short' : 'Excess', r.result === 'SHORT' ? 'bad' : 'warn');
      let head, rb;
      if (kind === 'nonserial') { head = ['item_code', 'inventory_status', 'item_description', 'item_uom', 'item_quality', 'expected_qty', 'physical_qty', 'matched_qty', 'short_qty', 'excess_qty', 'result'].map(k => CF.th(k, k === 'item_description' ? 'Description' : undefined));
        rb = data.map(r => `<tr><td><b>${esc(r.item_code)}</b></td><td>${esc(r.inventory_status || '')}</td><td>${esc(r.item_description || '')}</td><td>${esc(r.item_uom || '')}</td><td>${esc(r.item_quality || '')}</td><td>${fn(r.expected_qty)}</td><td>${fn(r.physical_qty)}</td><td>${fn(r.matched_qty)}</td><td class="neg">${fn(r.short_qty)}</td><td class="pos">${fn(r.excess_qty)}</td><td>${rs(r)}${r.is_unlisted ? ' ' + badge('Not in base', 'bad') : ''}</td></tr>`).join(''); }
      else { head = [CF.th('item_code'), CF.th('inventory_status'), CF.th('item_quality'), CF.th('item_description', 'Description'), ...(kind === 'variance' ? [CF.th('is_serialized', 'Type')] : []), CF.th('item_sno', 'System serial'), CF.th('item_sno', 'Physical serial'),
          CF.th('expected_qty'), CF.th('physical_qty'), CF.th('variance'), CF.th('result'), 'Expected store', 'Current store'];
        rb = data.map(r => { const v = Number(r.physical_qty) - Number(r.expected_qty); return `<tr><td><b>${esc(r.item_code)}</b></td><td>${esc(r.inventory_status || '—')}</td><td>${esc(r.item_quality || '—')}</td><td>${esc(r.item_description || '')}</td>${kind === 'variance' ? `<td>${r.is_serialized ? 'Serialized' : 'Non-Serialized'}</td>` : ''}<td>${r.is_serialized && r.result === 'SHORT' ? esc(r.item_sno) : '—'}</td><td>${r.is_serialized && r.result === 'EXCESS' ? esc(r.item_sno) : '—'}</td>
          <td>${fn(r.expected_qty)}</td><td>${fn(r.physical_qty)}</td><td class="${v < 0 ? 'neg' : 'pos'}">${v > 0 ? '+' : ''}${fn(v)}</td><td>${rs(r)}${r.is_unlisted ? ' ' + badge('Unlisted', 'bad') : ''}</td><td>${r.is_serialized && r.result === 'EXCESS' ? esc(xs[r.item_sno] || 'Not in any store base') : '—'}</td><td>${esc(store.code)}</td></tr>`; }).join(''); }
      body.innerHTML = ft + '<div class="fchips" id="vchips" hidden></div>' + tbl(head, rb) + (data.length ? '' : '<div class="muted" style="padding:16px">No rows match the selected filters.</div>') + pager(count, page, PS);
      CF.chips(body.querySelector('#vchips')); body.onclick = e => { CF.handle(e); };
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
