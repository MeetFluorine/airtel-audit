// Ranking: store user = own circle / India rank; circle head = his stores' ranks; admin = all stores, all circles, top store per circle.
// All numbers come from the server functions rank_my_store() / rank_staff() (database/18_ranking.sql); nothing is calculated here except display.
const rkPts = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const rkPct = v => v == null ? '—' : Number(v).toFixed(3).replace(/\.?0+$/, '') + '%';
const rkStaleBanner = '<div class="alert warn" style="margin-bottom:12px"><b>Database update needed.</b> The shortage figures are blank because the ranking function in your database is the older version. Run <code>database/18_ranking.sql</code> in the Supabase SQL editor (then <code>20_short_split_revise_base.sql</code> if you have not), and refresh this page.</div>';
const rkCpct = o => o.counted_short_pct !== undefined ? o.counted_short_pct : o.short_pct;      // older database versions only send short_pct
const rkPill = (n, ranked = true) => ranked ? `<span class="rk ${n <= 3 ? 'r' + n : ''}">${n}</span>` : '<span class="rk">—</span>';
const rkHow = () => `<details class="rk-how"><summary>How points and ranks work</summary>
  <p>For every audit cycle your store <b>completes</b> you earn <b>20 points for taking part</b> plus <b>your match rate</b> (up to 100 points). A cycle you do not complete earns 0.</p>
  <p><b>In-transit shortage is kept separate.</b> Your audit result still shows every short item as it is. For the ranking, shortage on items whose Inventory_Status is In Transit (already moved out of the store) is shown on its own and is <b>not counted against you</b>: the match rate used for points is your matched stock against the shortage of all <b>other</b> statuses.</p>
  <p>Your rank is based on total points. If stores have the same points, the one with the <b>lower shortage %</b> (other-status shortage compared with the total expected quantity) ranks higher. Ranks run 1, 2, 3 without gaps: if two stores share rank 1, the next store is rank 2. Circles are ranked on the <b>average points per store</b>, so big and small circles compare fairly.</p></details>`;

PAGES.ranking = async el => {
  if (isStaff()) return rankStaff(el);
  const { data: d, error } = await sb.rpc('rank_my_store'); if (error) throw error;
  if (!d || !d.ranked) { el.innerHTML = '<div class="card startcard"><h2>Ranking not available yet</h2><p class="muted">Your store is not part of the ranking.</p></div>'; return; }
  const none = !d.cycles_done, big = (t, n, tot, sub) => `<div class="card rk-big"><small>${t}</small><div class="rk-n">${none ? '—' : '#' + n}</div><div class="rk-of">${none ? 'Complete your first audit to get ranked' : ''}</div><div class="rk-sub">${sub}</div></div>`;
  el.innerHTML = `${'counted_short_pct' in d ? '' : rkStaleBanner}<div class="pagehead"><div><h1>My Ranking</h1><p class="muted" style="margin:4px 0 0">${esc(d.store)} · ${esc(d.circle)} Circle</p></div></div>
    <div class="rk-grid">${big('Rank in your circle', d.circle_rank, d.circle_total, esc(d.circle) + ' Circle')}${big('Rank in India', d.pan_rank, d.pan_total, 'All stores')}</div>
    <div class="kv kpi"><div class="g"><span>Total points</span><b>${rkPts(d.points)}</b></div><div><span>Cycles completed</span><b>${d.cycles_done} of ${d.cycles_held}</b></div><div><span>Short in transit <small>(not counted)</small></span><b>${rkPts(d.short_transit)}</b></div><div class="${d.short_other > 0 ? 'a' : ''}"><span>Short, other status <small>(counted)</small></span><b>${rkPts(d.short_other)}</b></div><div class="${rkCpct(d) > 0 ? 'a' : ''}"><span>Counted shortage %</span><b>${rkPct(rkCpct(d))}</b></div></div>
    <div class="card" style="padding:18px;margin-top:6px"><b>Points by audit cycle</b>${d.cycles.length ? tbl(['Audit cycle', 'Status', 'Short (all)', 'In transit', 'Other status', 'Match rate (for points)', 'Points'], d.cycles.map(c => `<tr><td>${esc(c.name)}${c.status === 'ACTIVE' ? ' ' + badge('Open', 'info') : ''}</td><td>${c.done ? badge('Completed', 'ok') : badge('Not completed', 'bad')}</td>
      <td>${c.done ? rkPts(c.short) : '—'}</td><td>${c.done ? rkPts(c.short_transit) : '—'}</td><td>${c.done ? rkPts(c.short_other) : '—'}</td><td>${c.match_rate == null ? '—' : c.match_rate + '%'}</td><td><b>${rkPts(c.points)}</b></td></tr>`).join('')) : '<p class="muted">No audit cycle yet.</p>'}</div>${rkHow()}`;
};

// ---- small inline icons for the top-store card ----
const rkSvg = (inner, fill) => `<svg viewBox="0 0 24 24" width="30" height="30" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${inner}</svg>`;
const RK_ICON = {
  building: rkSvg('<path d="M5 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17"/><path d="M15 9h3a1 1 0 0 1 1 1v11"/><path d="M3 21h18"/><path d="M9 7h2M9 11h2M9 15h2"/>'),
  trophy: rkSvg('<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),
  bars: rkSvg('<rect x="3" y="13" width="5" height="8" rx="1.3"/><rect x="9.5" y="8" width="5" height="13" rx="1.3"/><rect x="16" y="3" width="5" height="18" rx="1.3"/>', true),
  crown: rkSvg('<path d="M2.5 8l4.7 4.2L12 4l4.8 8.2L21.5 8l-2 11h-15z"/><rect x="4.5" y="20" width="15" height="2" rx="1"/>', true),
};
const rkTopCard = (c, s) => `<div class="tcard">
  <div class="tc-circle"><span class="tc-ic">${RK_ICON.building}</span><b>${esc(c.circle)} Circle</b></div>
  <div class="tc-store"><span class="tc-sic">${ic('store', 36, 1.6)}</span><div><b>${esc(c.top_store)}</b><span>${s ? esc(s.name) : ''}</span></div></div>
  <div class="tc-pts"><span class="tc-trophy">${RK_ICON.trophy}</span><div><small>Earned Points</small><b>${rkPts(c.top_points)} pts</b></div></div>
  <div class="tc-ranks"><div class="tc-r blue"><span>${RK_ICON.bars}</span><div><small>India Rank</small><b>${s ? '#' + s.pan_rank : '—'}</b></div></div>
    <div class="tc-r amber"><span>${RK_ICON.crown}</span><div><small>Circle Rank</small><b>${s ? '#' + s.circle_rank : '#1'}</b></div></div></div></div>`;

// ---- a table over already-loaded rows: click a heading to sort (A to Z / Z to A, low to high / high to low). No filters. ----
// cols: [{ k, l, t: 'num' | 'text', w: column width in %, get: row => value, cell: row => html }]; S = { sort: null | { k, dir } } is kept between redraws.
// Percentage widths + wrapping text: the table always fits the page width, so there is no sideways scrolling.
function rkGrid(cols, rows, S, emptyMsg) {
  let out = rows.slice();
  if (S.sort) { const c = cols.find(x => x.k === S.sort.k), dir = S.sort.dir === 'desc' ? -1 : 1;
    out = out.map((r, i) => [r, i]).sort((A, B) => { const x = c.get(A[0]), y = c.get(B[0]), nx = x == null || x === '', ny = y == null || y === '';
      if (nx || ny) return nx && ny ? A[1] - B[1] : nx ? 1 : -1;                 // blanks always last
      const d = c.t === 'num' ? Number(x) - Number(y) : String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true });
      return d * dir || A[1] - B[1]; }).map(p => p[0]); }
  const arrow = c => !S.sort || S.sort.k !== c.k ? '⇅' : S.sort.dir === 'asc' ? '↑' : '↓';
  const tip = c => c.t === 'num' ? 'Sort low to high, then high to low' : 'Sort A to Z, then Z to A';
  return `<div class="tw rkw"><table class="tbl rkt"><colgroup>${cols.map(c => `<col style="width:${c.w}%">`).join('')}</colgroup>
    <thead><tr>${cols.map(c => `<th><span class="srt ${S.sort && S.sort.k === c.k ? 'on' : ''}" data-sort="${c.k}" title="${tip(c)}">${esc(c.l)}<i>${arrow(c)}</i></span></th>`).join('')}</tr></thead>
    <tbody>${out.map(r => `<tr>${cols.map(c => `<td>${c.cell(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` + (out.length ? '' : `<p class="muted" style="padding:6px 4px">${emptyMsg}</p>`);
}
const rkSortClick = (e, S, redraw) => { const h = e.target.closest('[data-sort]'); if (!h) return false; const k = h.dataset.sort;
  S.sort = !S.sort || S.sort.k !== k ? { k, dir: 'asc' } : S.sort.dir === 'asc' ? { k, dir: 'desc' } : null; redraw(); return true; };

async function rankStaff(el) {
  const { data: d, error } = await sb.rpc('rank_staff'); if (error) throw error;
  const admin = d.role === 'ADMIN', stores = d.stores || [], circles = d.circles || [];
  const tabs = admin ? [['stores', 'Stores (India)'], ['circles', 'Circles'], ['top', 'Top store of each circle']] : [['stores', 'Stores'], ['circles', circles.length > 1 ? 'My circles' : 'My circle']];
  const F = { tab: 'stores', q: '', c: '' }, ranked = s => s.cycles_done > 0, cs = [...new Set(stores.map(s => s.circle))].sort();
  const SC = [
    { k: 'circle_rank', w: 8, l: 'Rank in circle', t: 'num', get: s => s.circle_rank, cell: s => rkPill(s.circle_rank, ranked(s)) },
    { k: 'pan_rank', w: 8, l: 'Rank in India', t: 'num', get: s => s.pan_rank, cell: s => rkPill(s.pan_rank, ranked(s)) },
    { k: 'store', w: 19, l: 'Store', t: 'text', get: s => s.code + ' ' + s.name, cell: s => `<b>${esc(s.code)}</b><div class="muted" style="font-size:12px">${esc(s.name)}</div>` },
    { k: 'circle', w: 7, l: 'Circle', t: 'text', get: s => s.circle, cell: s => esc(s.circle) },
    { k: 'points', w: 8, l: 'Points', t: 'num', get: s => s.points, cell: s => `<b>${rkPts(s.points)}</b>` },
    { k: 'cycles_done', w: 8, l: 'Cycles done', t: 'num', get: s => s.cycles_done, cell: s => `${s.cycles_done} of ${s.cycles_held}` },
    { k: 'short', w: 9, l: 'Short (all)', t: 'num', get: s => s.short, cell: s => rkPts(s.short) },
    { k: 'short_transit', w: 9, l: 'In transit', t: 'num', get: s => s.short_transit, cell: s => rkPts(s.short_transit) },
    { k: 'short_other', w: 9, l: 'Other status', t: 'num', get: s => s.short_other, cell: s => rkPts(s.short_other) },
    { k: 'counted_short_pct', w: 15, l: 'Counted shortage %', t: 'num', get: s => rkCpct(s), cell: s => rkPct(rkCpct(s)) }];
  const CC = [
    { k: 'circle_rank', w: 9, l: 'Circle rank', t: 'num', get: c => c.circle_rank, cell: c => rkPill(c.circle_rank, c.cycles_done > 0) },
    { k: 'circle', w: 10, l: 'Circle', t: 'text', get: c => c.circle, cell: c => `<b>${esc(c.circle)}</b>` },
    { k: 'stores', w: 7, l: 'Stores', t: 'num', get: c => c.stores, cell: c => c.stores },
    { k: 'avg_points', w: 11, l: 'Avg points / store', t: 'num', get: c => c.avg_points, cell: c => `<b>${rkPts(c.avg_points)}</b>` },
    { k: 'participation_pct', w: 11, l: 'Participation', t: 'num', get: c => c.participation_pct, cell: c => c.participation_pct == null ? '—' : c.participation_pct + '%' },
    { k: 'short_transit', w: 12, l: 'Short in transit', t: 'num', get: c => c.short_transit, cell: c => rkPts(c.short_transit) },
    { k: 'short_other', w: 12, l: 'Short other status', t: 'num', get: c => c.short_other, cell: c => rkPts(c.short_other) },
    { k: 'counted_short_pct', w: 13, l: 'Counted shortage %', t: 'num', get: c => rkCpct(c), cell: c => rkPct(rkCpct(c)) },
    { k: 'top_store', w: 15, l: 'Top store', t: 'text', get: c => c.top_store, cell: c => c.top_store ? esc(c.top_store) + ' <span class="muted">(' + rkPts(c.top_points) + ' pts)</span>' : '—' }];
  const SS = { sort: null }, CS = { sort: null };       // sort + filters survive tab switches
  el.innerHTML = `${stores.length && !('counted_short_pct' in stores[0]) ? rkStaleBanner : ''}<div class="tabs seg" id="rk-tabs" style="margin-bottom:12px">${tabs.map(t => `<button class="tab ${t[0] === F.tab ? 'on' : ''}" data-t="${t[0]}">${t[1]}</button>`).join('')}</div><div id="rk-body"></div>`;
  const body = el.querySelector('#rk-body');
  const draw = () => {
    el.querySelectorAll('#rk-tabs .tab').forEach(b => b.classList.toggle('on', b.dataset.t === F.tab));
    if (F.tab === 'circles') {
      body.innerHTML = `<div class="card" style="padding:16px">${circles.length ? rkGrid(CC, circles, CS, 'No circles.') : '<p class="muted">No circles.</p>'}</div>${rkHow()}`;
      body.onclick = e => rkSortClick(e, CS, draw);
    } else if (F.tab === 'top') {
      // the card of the store with the best all-India rank comes first (ties: circle name A to Z)
      const top = circles.filter(c => c.top_store).map(c => ({ c, s: stores.find(x => x.code === c.top_store) }))
        .sort((a, b) => (a.s ? a.s.pan_rank : 1e9) - (b.s ? b.s.pan_rank : 1e9) || (a.s ? a.s.circle_rank : 0) - (b.s ? b.s.circle_rank : 0) || a.c.circle.localeCompare(b.c.circle));
      body.onclick = null;
      body.innerHTML = top.length ? `<div class="rk-top">${top.map(x => rkTopCard(x.c, x.s)).join('')}</div>${rkHow()}`
        : '<div class="card startcard"><h2>No top stores yet</h2><p class="muted">Stores appear here once they complete an audit.</p></div>';
    } else {
      const q = F.q.trim().toLowerCase();
      let rows = stores.filter(s => (!F.c || s.circle === F.c) && (!q || (s.code + ' ' + s.name).toLowerCase().includes(q)));
      if (!admin) rows = rows.slice().sort((a, b) => a.circle.localeCompare(b.circle) || a.circle_rank - b.circle_rank || a.code.localeCompare(b.code));
      body.innerHTML = `<div class="filters"><div><label>Circle</label><select id="rk-c"><option value="">All circles</option>${cs.map(c => `<option ${c === F.c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div style="flex:1;min-width:180px"><label>Search store</label><input id="rk-q" placeholder="Store code or name" value="${esc(F.q)}"></div></div>
        <div class="card" style="padding:16px">${rkGrid(SC, rows, SS, 'No stores match.')}</div>${rkHow()}`;
      body.onclick = e => rkSortClick(e, SS, draw);
      const c = body.querySelector('#rk-c'), qi = body.querySelector('#rk-q');
      c.onchange = e => { F.c = e.target.value; draw(); };
      qi.oninput = e => { F.q = e.target.value; const p = e.target.selectionStart; draw(); const n = body.querySelector('#rk-q'); n.focus(); n.setSelectionRange(p, p); };
    }
  };
  el.querySelector('#rk-tabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { F.tab = b.dataset.t; draw(); } };
  draw();
}
