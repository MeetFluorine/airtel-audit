// Ranking: store user = own circle / India rank; circle head = his stores' ranks; admin = all stores, all circles, top store per circle.
// All numbers come from the server functions rank_my_store() / rank_staff() (database/18_ranking.sql); nothing is calculated here except display.
const rkPts = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 });
const rkPct = v => v == null ? '—' : Number(v).toFixed(2).replace(/\.?0+$/, '') + '%';
const rkStaleBanner = '<div class="alert warn" style="margin-bottom:12px"><b>Database update needed.</b> The shortage figures are blank because the ranking function in your database is the older version. Run <code>database/18_ranking.sql</code> in the Supabase SQL editor (then <code>20_short_split_revise_base.sql</code> if you have not), and refresh this page.</div>';
const rkCpct = o => o.counted_short_pct !== undefined ? o.counted_short_pct : o.short_pct;      // older database versions only send short_pct
const rkPill = (n, ranked = true) => ranked ? `<span class="rk ${n <= 3 ? 'r' + n : ''}">${n}</span>` : '<span class="rk">—</span>';
const rkHow = () => `<details class="rk-how"><summary>How points and ranks work</summary>
  <p>For every audit cycle your store <b>completes</b> you earn <b>20 points for taking part</b> plus <b>your match rate</b> (up to 100 points). A cycle you do not complete earns 0.</p>
  <p><b>In-transit shortage is kept separate.</b> Your audit result still shows every short item as it is. For the ranking, shortage on items whose Inventory_Status is In Transit (already moved out of the store) is shown on its own and is <b>not counted against you</b>: the match rate used for points is your matched stock against the shortage of all <b>other</b> statuses.</p>
  <p>Your rank is based on total points. If two stores have the same points, the one with the <b>lower counted shortage %</b> ranks higher. Circles are ranked on the <b>average points per store</b>, so big and small circles compare fairly.</p></details>`;

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

async function rankStaff(el) {
  const { data: d, error } = await sb.rpc('rank_staff'); if (error) throw error;
  const admin = d.role === 'ADMIN', stores = d.stores || [], circles = d.circles || [];
  const tabs = admin ? [['stores', 'Stores (India)'], ['circles', 'Circles'], ['top', 'Top store of each circle']] : [['stores', 'Stores'], ['circles', circles.length > 1 ? 'My circles' : 'My circle']];
  const F = { tab: 'stores', q: '', c: '' }, ranked = s => s.cycles_done > 0;
  el.innerHTML = `${stores.length && !('counted_short_pct' in stores[0]) ? rkStaleBanner : ''}<div class="tabs seg" id="rk-tabs" style="margin-bottom:12px">${tabs.map(t => `<button class="tab ${t[0] === F.tab ? 'on' : ''}" data-t="${t[0]}">${t[1]}</button>`).join('')}</div><div id="rk-body"></div>`;
  const body = el.querySelector('#rk-body');
  const draw = () => {
    el.querySelectorAll('#rk-tabs .tab').forEach(b => b.classList.toggle('on', b.dataset.t === F.tab));
    if (F.tab === 'circles') {
      body.innerHTML = `<div class="card" style="padding:16px">${circles.length ? tbl(['Circle rank', 'Circle', 'Stores', 'Avg points / store', 'Participation', 'Short in transit', 'Short other status', 'Counted shortage %', 'Top store'], circles.map(c => `<tr><td>${rkPill(c.circle_rank, c.cycles_done > 0)}</td><td><b>${esc(c.circle)}</b></td><td>${c.stores}</td><td><b>${rkPts(c.avg_points)}</b></td>
        <td>${c.participation_pct == null ? '—' : c.participation_pct + '%'}</td><td>${rkPts(c.short_transit)}</td><td>${rkPts(c.short_other)}</td><td>${rkPct(rkCpct(c))}</td><td>${c.top_store ? esc(c.top_store) + ' <span class="muted">(' + rkPts(c.top_points) + ' pts)</span>' : '—'}</td></tr>`).join('')) : '<p class="muted">No circles.</p>'}</div>${rkHow()}`;
    } else if (F.tab === 'top') {
      const top = circles.filter(c => c.top_store);
      body.innerHTML = top.length ? `<div class="rk-top">${top.map(c => { const s = stores.find(x => x.code === c.top_store);
        return `<div class="card"><small>${esc(c.circle)} Circle · circle rank ${rkPill(c.circle_rank, true)}</small><b>${esc(c.top_store)}</b><span class="muted">${s ? esc(s.name) : ''}</span><div class="rk-tp">${rkPts(c.top_points)} pts</div><small>India rank ${s ? '#' + s.pan_rank : '—'}</small></div>`; }).join('')}</div>${rkHow()}`
        : '<div class="card startcard"><h2>No top stores yet</h2><p class="muted">Stores appear here once they complete an audit.</p></div>';
    } else {
      const cs = [...new Set(stores.map(s => s.circle))].sort(), q = F.q.trim().toLowerCase();
      let rows = stores.filter(s => (!F.c || s.circle === F.c) && (!q || (s.code + ' ' + s.name).toLowerCase().includes(q)));
      if (!admin) rows = rows.slice().sort((a, b) => a.circle.localeCompare(b.circle) || a.circle_rank - b.circle_rank || a.code.localeCompare(b.code));
      body.innerHTML = `<div class="filters"><div><label>Circle</label><select id="rk-c"><option value="">All circles</option>${cs.map(c => `<option ${c === F.c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div style="flex:1;min-width:180px"><label>Search store</label><input id="rk-q" placeholder="Store code or name" value="${esc(F.q)}"></div></div>
        <div class="card" style="padding:16px">${rows.length ? tbl(['Rank in circle', 'Rank in India', 'Store', 'Circle', 'Points', 'Cycles done', 'Short (all)', 'In transit', 'Other status', 'Counted shortage %'], rows.map(s => `<tr><td>${rkPill(s.circle_rank, ranked(s))}</td><td>${rkPill(s.pan_rank, ranked(s))}</td>
          <td><b>${esc(s.code)}</b><div class="muted" style="font-size:12px">${esc(s.name)}</div></td><td>${esc(s.circle)}</td><td><b>${rkPts(s.points)}</b></td><td>${s.cycles_done} of ${s.cycles_held}</td><td>${rkPts(s.short)}</td><td>${rkPts(s.short_transit)}</td><td>${rkPts(s.short_other)}</td><td>${rkPct(rkCpct(s))}</td></tr>`).join('')) : '<p class="muted">No stores match.</p>'}</div>${rkHow()}`;
      const c = body.querySelector('#rk-c'), qi = body.querySelector('#rk-q');
      c.onchange = e => { F.c = e.target.value; draw(); };
      qi.oninput = e => { F.q = e.target.value; const p = e.target.selectionStart; draw(); const n = body.querySelector('#rk-q'); n.focus(); n.setSelectionRange(p, p); };
    }
  };
  el.querySelector('#rk-tabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { F.tab = b.dataset.t; draw(); } };
  draw();
}
