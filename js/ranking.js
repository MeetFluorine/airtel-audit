// Ranking runs in SEASONS (3-month calendar quarters) with LEVELS. Store user = own level / ranks;
// circle head = his stores' ranks; admin = all stores, all circles, Top 3 India.
// All numbers come from the server functions rank_my_store(from,to) / rank_staff(from,to)
// (database/29_ranking_seasons_levels.sql); nothing is calculated here except display + season windows.
const rkPts = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const rkPct = v => v == null ? '—' : Number(v).toFixed(3).replace(/\.?0+$/, '') + '%';
const rkPct2 = v => v == null ? '—' : Number(v).toFixed(2).replace(/\.?0+$/, '') + '%';   // match rate: 2 decimals
const rkPct1 = v => v == null ? '—' : (Math.round(Number(v) * 10) / 10).toString().replace(/\.0$/, '') + '%';
const rkStaleBanner = '<div class="alert warn" style="margin-bottom:12px"><b>Database update needed.</b> Run <code>database/29_ranking_seasons_levels.sql</code> in the Supabase SQL editor (after <code>18_ranking.sql</code> if you have not run it), then refresh this page.</div>';
const rkCpct = o => o.counted_short_pct !== undefined ? o.counted_short_pct : o.short_pct;      // older database versions only send short_pct
const rkPill = (n, ranked = true) => ranked ? `<span class="rk ${n <= 3 ? 'r' + n : ''}">${n}</span>` : '<span class="rk">—</span>';

/* ---------- seasons: calendar quarters; a cycle belongs to the season it was created in ---------- */
const RK_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function rkSeasonOf(dt) { const d = new Date(dt), q = Math.floor(d.getMonth() / 3), y = d.getFullYear();
  return { key: y + 'Q' + (q + 1), y, q: q + 1, from: new Date(y, q * 3, 1), to: new Date(y, q * 3 + 3, 1) }; }
function rkSeasonLabel(s) { return `Q${s.q} ${s.y} (${RK_MON[s.from.getMonth()]} – ${RK_MON[s.from.getMonth() + 2]})`; }
function rkSeasons() { const map = new Map(), cur = rkSeasonOf(new Date());
  (S.cycles || []).forEach(c => { const s = rkSeasonOf(c.created_at); if (!map.has(s.key)) map.set(s.key, s); });
  if (!map.has(cur.key)) map.set(cur.key, cur);
  return [...map.values()].sort((a, b) => b.from - a.from).map(s => ({ ...s, label: rkSeasonLabel(s), live: s.key === cur.key })); }
const rkWin = s => ({ p_from: s.from.toISOString(), p_to: s.to.toISOString() });

/* ---------- levels (gates mirror public._store_level in migration 29) ---------- */
const RK_LEVELS = ['Unranked', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Champion'];
const RK_LVL = { Champion: '#7C3AED', Diamond: '#2563EB', Platinum: '#0E7490', Gold: '#B8860B', Silver: '#64748B', Bronze: '#B45309', Unranked: '#94A3B8' };
const RK_GATES = { Bronze: { comp: 50, match: 85, short: 8 }, Silver: { comp: 65, match: 90, short: 5 }, Gold: { comp: 80, match: 97, short: 2 },
  Platinum: { comp: 90, match: 98, short: 1.5 }, Diamond: { comp: 100, match: 99, short: 0.5 }, Champion: { comp: 100, match: 99, matchGt: true, short: 0.05, ontime: true } };
const rkMedal = (lvl, sz = 13) => lvl === 'Champion'
  ? `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2.8 7.2 7.2 10.8l4.8-6 4.8 6 4.4-3.6-2 10.8H4.8z"/><rect x="4.8" y="19" width="14.4" height="2" rx="1"/></svg>`
  : lvl === 'Diamond' || lvl === 'Platinum'
  ? `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 3h12l3.5 5.5L12 21 2.5 8.5z"/></svg>`
  : `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"/></svg>`;
const rkLvlChip = l => { l = l || 'Unranked'; const c = RK_LVL[l] || RK_LVL.Unranked;
  return `<span class="lvl" style="color:${c};background:${c}1f">${rkMedal(l)} ${l}</span>` };
const rkHow = () => `<details class="rk-how"><summary>How points & levels work</summary>
  <p><b>Seasons.</b> Ranking runs in 3-month seasons (calendar quarters: Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec). Only audit cycles of the season count, so every season starts fresh and a finished season's result never changes.</p>
  <p><b>Points.</b> For every cycle of the season your store <b>completes</b> you earn <b>20 points for taking part</b> plus <b>your match rate</b> (up to 100 points). A cycle you do not complete earns 0.</p>
  <p><b>In-transit shortage is shown separately.</b> Your audit result still shows every short item as it is. For the ranking, shortage on items whose Inventory_Status is In Transit (already moved out of the store) is displayed on its own and does not lower your match rate: the match rate used for points is your matched stock measured against the shortage of all <b>other</b> statuses (the "genuine" shortage). Genuine shortage is what affects your performance.</p>
  <p><b>Levels.</b> Points alone are not enough — a level also needs quality: Bronze ≥ 50% of the season's cycles completed, match ≥ 85%, genuine shortage ≤ 8% · Silver ≥ 65%, ≥ 90%, ≤ 5% · Gold ≥ 80%, ≥ 97%, ≤ 2% · Platinum ≥ 90%, ≥ 98%, ≤ 1.5% · Diamond 100%, ≥ 99%, ≤ 0.5% · Champion 100%, match above 99%, ≤ 0.05% and every audit submitted within its deadline.</p>
  <p><b>Ranks.</b> Your rank is based on total points of the season. If stores have the same points, the one with the <b>lower genuine shortage %</b> ranks higher. Ranks run 1, 2, 3 without gaps: if two stores share rank 1, the next store is rank 2. Circles are ranked on the <b>average points per store</b>, so big and small circles compare fairly.</p></details>`;

PAGES.ranking = async el => {
  if (isStaff()) return rankStaff(el);
  const seasons = rkSeasons(), cur = seasons.find(s => s.live) || seasons[0];
  const { data: d, error } = await sb.rpc('rank_my_store', rkWin(cur));
  if (error || !d || !('level' in d)) { el.innerHTML = rkStaleBanner + '<div class="card startcard"><h2>Ranking is being updated</h2><p class="muted">Please refresh in a minute. If this stays, the database update above is still pending.</p></div>'; return; }
  if (!d.ranked) { el.innerHTML = '<div class="card startcard"><h2>Ranking not available yet</h2><p class="muted">Your store is not part of the ranking.</p></div>'; return; }
  const lvl = d.level || 'Unranked', lc = RK_LVL[lvl], none = !d.cycles_done;
  const li = RK_LEVELS.indexOf(lvl), next = li >= 0 && li < RK_LEVELS.length - 1 ? RK_LEVELS[li + 1] : null;
  const comp = d.cycles_held ? Math.round(1000 * d.cycles_done / d.cycles_held) / 10 : 0;
  const cpct = rkCpct(d);
  // Gate progress toward the next level: how far each of the three targets is met (0-100%).
  let gp = null, met = 0;
  if (next) { const g = RK_GATES[next];
    const cR = d.cycles_held ? Math.min(1, comp / g.comp) : 0;
    const mR = d.match_rate == null ? 0 : Math.min(1, d.match_rate / g.match);
    const sR = cpct == null ? 0 : cpct <= 0 ? 1 : Math.min(1, g.short / cpct);
    met = (d.cycles_held > 0 && comp >= g.comp ? 1 : 0) + (d.match_rate != null && (g.matchGt ? d.match_rate > g.match : d.match_rate >= g.match) ? 1 : 0) + (cpct != null && cpct <= g.short ? 1 : 0);
    gp = Math.round(100 * (cR + mR + sR) / 3); }
  const medallion = `<span class="rk-medal" style="color:${lc};background:${lc}1f;border-color:${lc}55">${rkMedal(lvl, 30)}</span>`;
  const icoTrophy = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>';
  const icoTarget = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>';
  const rankCard = (cls, icon, label, n, tot, sub) => `<div class="card rk-rc ${cls}"><span class="rk-ric">${icon}</span><div><div class="rk-n">${none ? '—' : '#' + n}</div><small class="rk-rl">${label}</small><div class="rk-sub">${none ? 'Complete your first audit of the season to get ranked' : sub + (tot ? ` · of ${tot}` : '')}</div></div></div>`;
  const C = 2 * Math.PI * 26, off = C * (1 - (d.cycles_held ? d.cycles_done / d.cycles_held : 0));
  const donut = `<svg class="rk-donut" width="72" height="72" viewBox="0 0 72 72"><circle cx="36" cy="36" r="26" fill="none" stroke="#E4EDE9" stroke-width="7"/><circle cx="36" cy="36" r="26" fill="none" stroke="#16A34A" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 36 36)"/><text x="36" y="34" text-anchor="middle" class="rk-dn">${d.cycles_done} / ${d.cycles_held}</text><text x="36" y="48" text-anchor="middle" class="rk-ds">Cycles</text></svg>`;
  // Level card: current level, season points, target progress to the next level (or top-tier state).
  const lvlCard = next ? `<div class="card rk-lvl">${medallion}<div class="rk-lm"><small>Current Level</small><div class="rk-lname" style="color:${lc}">${lvl}</div>
      <div class="rk-lpts">${rkPts(d.points)} points this season</div>
      <div class="bar2 rk-lbar"><i style="width:${gp}%;background:${RK_LVL[next]}"></i></div>
      <div class="rk-lmeta"><span>${met} of 3 targets met for ${next}</span><span class="rk-lnext">Next: ${next} ${rkMedal(next, 12)}</span></div>
      <div class="rk-ltip">Reach ${next}: complete ≥ ${RK_GATES[next].comp}% of cycles · match ${RK_GATES[next].matchGt ? 'above' : '≥'} ${RK_GATES[next].match}% · genuine shortage ≤ ${RK_GATES[next].short}%${RK_GATES[next].ontime ? ' · submit every audit on time' : ''}</div></div></div>`
    : `<div class="card rk-lvl">${medallion}<div class="rk-lm"><small>Current Level</small><div class="rk-lname" style="color:${lc}">🏆 Champion — Highest Tier</div>
      <div class="rk-lpts">${rkPts(d.points)} points this season</div><div class="rk-ltip">You hold the highest level this season. Defend it next season.</div></div></div>`;
  // KPI row (icon + label + value; shortage types stay separate, in units).
  const kIco = (inner, col) => `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const kpi = (cls, icon, label, val) => `<div class="card rk-kpi2"><span class="rk-ric ${cls}">${icon}</span><div><small>${label}</small><div class="rk-kv2">${val}</div></div></div>`;
  const kpis = `<div class="rk-kpis">
    ${kpi('t', kIco('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15.5l2 2 4-4"/>', '#0E7490'), 'Cycles Completed', `${d.cycles_done} / ${d.cycles_held}`)}
    ${kpi('g', kIco('<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.4 2.4L15.7 9.6"/>', '#12805C'), 'Match Rate', rkPct2(d.match_rate))}
    ${kpi('a', kIco('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 16.8v.2"/>', '#DC2626'), 'Genuine Shortage', rkPts(d.short_other) + ' units')}
    ${kpi('b', kIco('<path d="M2.5 6h12v11h-12zM14.5 10h4l3 3.5V17h-7z"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>', '#2563EB'), 'In Transit', rkPts(d.short_transit) + ' units')}</div>`;
  // Level journey: every level, current highlighted, next emphasized.
  const journey = `<div class="card rk-journey"><div class="rk-jt"><b>Level Journey</b><span class="muted">This season</span></div><div class="rk-jrow">${RK_LEVELS.map((L, i) => {
    const st = i < li ? 'done' : i === li ? 'cur' : i === li + 1 ? 'next' : 'todo', col = RK_LVL[L];
    return `${i ? '<span class="rk-jarr">→</span>' : ''}<span class="rk-jchip ${st}" ${st === 'cur' || st === 'next' ? `style="--jc:${col}"` : ''}>${rkMedal(L, 12)} ${L}${st === 'cur' ? ' ✓' : ''}${st === 'next' ? '<em>Next</em>' : ''}</span>`; }).join('')}</div></div>`;
  // Next-level card: the three gates (plus on-time for Champion), each with current vs required.
  const gate = (label, nowTxt, ok, reqTxt) => `<div class="rk-gate"><span class="rk-gic ${ok ? 'ok' : 'no'}">${ok ? '✓' : '!'}</span><div class="rk-gm"><b>${nowTxt}</b><span>${label}</span></div><span class="rk-greq ${ok ? 'ok' : ''}">${reqTxt}</span></div>`;
  let nextCard;
  if (!next) nextCard = `<div class="card rk-next"><span class="rk-medal" style="color:${lc};background:${lc}1f;border-color:${lc}55">${rkMedal('Champion', 30)}</span><div class="rk-nm"><b>🏆 Champion — Highest Tier</b><span>You hold the highest level this season. Defend it next season.</span></div></div>`;
  else { const g = RK_GATES[next];
    nextCard = `<div class="card rk-next"><span class="rk-medal" style="color:${RK_LVL[next]};background:${RK_LVL[next]}1f;border-color:${RK_LVL[next]}55">${rkMedal(next, 30)}</span>
      <div class="rk-nm"><b>Next Level: ${next}</b><span>Complete more cycles and improve your performance to reach ${next}.</span></div>
      <div class="rk-gates">${gate('Cycle Completion', comp + '%', d.cycles_held > 0 && comp >= g.comp, `≥ ${g.comp}% required`)}
      ${gate('Match Rate', rkPct2(d.match_rate), d.match_rate != null && (g.matchGt ? d.match_rate > g.match : d.match_rate >= g.match), `${g.matchGt ? '&gt;' : '≥'} ${g.match}% required`)}
      ${gate('Genuine Shortage', rkPct(cpct), cpct != null && cpct <= g.short, `≤ ${g.short}% required`)}
      ${g.ontime ? gate('On-time Submission', d.late_count ? d.late_count + ' late' : 'All on time', !d.late_count, 'Every audit within its deadline') : ''}</div></div>`; }
  const nCyc = d.cycles.length;
  el.innerHTML = `<div class="pagehead"><div><h1>My Ranking</h1><p class="muted" style="margin:4px 0 0">${esc(d.store)} · ${esc(d.circle)} Circle</p></div>
    <div class="rk-stag"><span class="livepill"><i></i>Live Season</span><span class="rk-schip">${cur.label}</span></div></div>
    <div class="rk-top4">${lvlCard}
    ${rankCard('rc-c', icoTarget, 'Circle Rank', d.circle_rank, d.circle_total, esc(d.circle) + ' Circle')}
    ${rankCard('rc-i', icoTrophy, 'India Rank', d.pan_rank, d.pan_total, 'All stores')}
    <div class="card rk-pc">${donut}<div><small>Season Progress</small><div class="rk-pn">${comp}% completed</div><div class="bar2 rk-pbar"><i style="width:${comp}%"></i></div><div class="rk-sub">${d.cycles_held ? (d.cycles_held - d.cycles_done) + ' cycle' + (d.cycles_held - d.cycles_done === 1 ? '' : 's') + ' remaining' : 'No cycles yet this season'}</div></div></div></div>
    ${kpis}${journey}
    <div class="card rk-perf"><b>Season Performance</b><div class="rk-twrap">${nCyc ? tbl(['Audit Cycle', 'Status', 'Cycle', 'Match Rate', 'Genuine Shortage', 'In Transit', 'Points'], d.cycles.map((c, ix) => `<tr><td>${esc(c.name)}${c.status === 'ACTIVE' ? ' ' + badge('Open', 'info') : ''}</td><td>${c.done ? badge('Completed', 'ok') : badge('Not completed', 'bad')}</td>
      <td>${nCyc - ix} / ${nCyc}</td><td>${c.match_rate == null ? '—' : c.match_rate + '%'}</td><td>${c.done ? rkPts(c.short_other) : '—'}</td><td>${c.done ? rkPts(c.short_transit) : '—'}</td><td><b>${rkPts(c.points)}</b></td></tr>`).join('')) : '<p class="muted">No audit cycle yet this season.</p>'}</div></div>${nextCard}${rkHow()}`;
};

// ---- a table over already-loaded rows: click a heading to sort (A to Z / Z to A, low to high / high to low). No filters. ----
// cols: [{ k, l, t: 'num' | 'text', w: column width in %, get: row => value, cell: row => html }]; S = { sort: null | { k, dir } } is kept between redraws.
// Percentage widths + wrapping text: the table always fits the page width, so there is no sideways scrolling.
// Sort helper shared by the grid renderer and pagination (sort the full row set, then slice the page).
function rkSorted(cols, rows, S) {
  let out = rows.slice();
  if (S.sort) { const c = cols.find(x => x.k === S.sort.k); if (!c) return out; const dir = S.sort.dir === 'desc' ? -1 : 1;
    out = out.map((r, i) => [r, i]).sort((A, B) => { const x = c.get(A[0]), y = c.get(B[0]), nx = x == null || x === '', ny = y == null || y === '';
      if (nx || ny) return nx && ny ? A[1] - B[1] : nx ? 1 : -1;                 // blanks always last
      const d = c.t === 'num' ? Number(x) - Number(y) : String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true });
      return d * dir || A[1] - B[1]; }).map(p => p[0]); }
  return out;
}
function rkGrid(cols, rows, S, emptyMsg) {
  const out = rkSorted(cols, rows, S);
  const arrow = c => !S.sort || S.sort.k !== c.k ? '⇅' : S.sort.dir === 'asc' ? '↑' : '↓';
  const tip = c => c.t === 'num' ? 'Sort low to high, then high to low' : 'Sort A to Z, then Z to A';
  const head = c => { if (!c.l) return ''; if (c.ns) return esc(c.l);
    return `<span class="srt ${S.sort && S.sort.k === c.k ? 'on' : ''}" data-sort="${c.k}" title="${tip(c)}">${esc(c.l)}<i>${arrow(c)}</i></span>`; };
  return `<div class="tw rkw"><table class="tbl rkt"><colgroup>${cols.map(c => `<col style="width:${c.w}%">`).join('')}</colgroup>
    <thead><tr>${cols.map(c => `<th>${head(c)}</th>`).join('')}</tr></thead>
    <tbody>${out.map(r => `<tr>${cols.map(c => `<td>${c.cell(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` + (out.length ? '' : `<p class="muted" style="padding:6px 4px">${emptyMsg}</p>`);
}
// NOTE: must NOT return false here - a false return from an onclick handler cancels
// the default action, which broke the eye/detail links inside the table.
const rkSortClick = (e, S, redraw) => { const h = e.target.closest('[data-sort]'); if (!h) return; const k = h.dataset.sort;
  S.sort = !S.sort || S.sort.k !== k ? { k, dir: 'asc' } : S.sort.dir === 'asc' ? { k, dir: 'desc' } : null; redraw(); };

async function rankStaff(el) {
  const seasons = rkSeasons(); let si = Math.max(0, seasons.findIndex(s => s.live));
  const first = await sb.rpc('rank_staff', rkWin(seasons[si]));
  if (first.error || !first.data) { el.innerHTML = rkStaleBanner + '<div class="card startcard"><h2>Ranking is being updated</h2><p class="muted">Please refresh in a minute. If this stays, the database update above is still pending.</p></div>'; return; }
  let d = first.data; const admin = d.role === 'ADMIN';
  let stores = [], circles = [], cs = [], top3 = [];
  const apply = () => { stores = d.stores || []; circles = d.circles || []; cs = [...new Set(stores.map(s => s.circle))].sort();
    top3 = admin ? stores.filter(s => s.cycles_done > 0).sort((a, b) => a.pan_rank - b.pan_rank || String(a.code).localeCompare(String(b.code))).slice(0, 3) : []; };
  apply();
  const load = async () => { const r = await sb.rpc('rank_staff', rkWin(seasons[si])); if (r.error) throw r.error; d = r.data; apply(); };
  const tabs = admin ? [['stores', 'Stores (India)', 'store'], ['circles', 'Circles', 'grid'], ['top', 'Top store of each circle', 'trophy']]
    : [['stores', 'Stores', 'store'], ['circles', circles.length > 1 ? 'My circles' : 'My circle', 'grid']];
  const F = { tab: 'stores', q: '', c: '', page: 1, ps: 10 }, ranked = s => s.cycles_done > 0;
  // Pan-India Top 3 (admin only): wide cards with level chips + season stats (design module, Oct 2026)
  const crown = r => `<svg class="crown c${r}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2.8 7.2 7.2 10.8l4.8-6 4.8 6 4.4-3.6-2 10.8H4.8z"/><rect x="4.8" y="19" width="14.4" height="2" rx="1"/></svg>`;
  // Top-3 stat icons (metrics are icon + value only, no text labels - owner design)
  const ti = (inner, col) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${col || '#2563EB'}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const TI = { flag: `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21.5v-17" stroke="#64748B" stroke-width="2" stroke-linecap="round"/><rect x="4" y="4.5" width="17" height="4.6" fill="#F4901E"/><rect x="4" y="9.1" width="17" height="4.6" fill="#FFFFFF" stroke="#E2E8F0" stroke-width=".6"/><rect x="4" y="13.7" width="17" height="4.6" fill="#138808"/><circle cx="12.5" cy="11.4" r="1.5" fill="none" stroke="#2B4C9B" stroke-width="1"/></svg>`,
    users: ti('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16 15.2c2.3.2 3.9 1.6 4.4 4.3"/>', '#2563EB'),
    cal: ti('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15.5l2 2 4-4"/>', '#0E7490'),
    bars: ti('<path d="M4 20V12M10 20V5M16 20v-8M21 20H3"/>', '#2563EB'),
    warn: ti('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 16.8v.2"/>', '#DC2626'),
    truck: ti('<path d="M2.5 6h12v11h-12zM14.5 10h4l3 3.5V17h-7z"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>', '#2563EB') };
  const topCard3 = (s, r) => `<div class="rpc3 w${r}">${crown(r)}<div class="rpc3-main"><span class="rkmedal m${r}">${r}</span>
    <div class="rpc3-store"><b>${esc(s.code)}</b><span>${esc(s.name)} (${esc(s.circle)})</span><span>${rkLvlChip(s.level)}</span></div>
    <div class="rpc3-pts"><b>${rkPts(s.points)}</b><span>Points</span></div></div>
    <div class="rpc3-stats"><div title="India rank">${TI.flag}<b>#${s.pan_rank}</b></div><div title="Circle rank">${TI.users}<b>#${s.circle_rank}</b></div><div title="Cycles completed">${TI.cal}<b>${s.cycles_done}/${s.cycles_held}</b></div><div title="Match rate">${TI.bars}<b>${rkPct2(s.match_rate)}</b></div><div title="Genuine shortage %">${TI.warn}<b>${rkPct(rkCpct(s))}</b></div></div>
    <div class="rpc3-qty"><span class="q-tr">${TI.truck} In Transit <b>${rkPts(s.short_transit)}</b></span><span class="q-sep">|</span><span class="q-wn">${TI.warn} Genuine Shortage <b>${rkPts(s.short_other)}</b> units</span></div></div>`;
  const podium = () => top3.length ? `<section class="rkpod3"><div class="rp2-head"><span class="rp2-ticon">${ic('trophy', 20)}</span><div class="rp2-tt"><b>Top 3 Stores (India) <small>— ${esc(seasons[si].label)}</small></b></div><button type="button" class="rp2-link" id="rk-full">View full ranking &nbsp;&rarr;</button></div><div class="rp3-row">${top3.map((s, i) => topCard3(s, i + 1)).join('')}</div></section>` : '';
  const SC = [
    { k: 'pan_rank', w: 6, l: '# (India)', t: 'num', get: s => s.pan_rank, cell: s => ranked(s) ? `<b>${s.pan_rank}</b>` : '—' },
    { k: 'circle_rank', w: 6, l: '# (Circle)', t: 'num', get: s => s.circle_rank, cell: s => ranked(s) ? `<b${s.circle_rank <= 3 ? ' class="rk-red"' : ''}>${s.circle_rank}</b>` : '—' },
    { k: 'store', w: 17, l: 'Store', t: 'text', get: s => s.code + ' ' + s.name, cell: s => `<b>${esc(s.code)}</b><div class="muted" style="font-size:12px">${esc(s.name)}</div>` },
    { k: 'circle', w: 6, l: 'Circle', t: 'text', get: s => s.circle, cell: s => esc(s.circle) },
    { k: 'level', w: 10, l: 'Level', t: 'text', get: s => s.level || 'Unranked', cell: s => rkLvlChip(s.level) },
    { k: 'points', w: 7, l: 'Points', t: 'num', get: s => s.points, cell: s => `<b>${rkPts(s.points)}</b>` },
    { k: 'cycles_done', w: 9, l: 'Cycles', t: 'num', get: s => s.cycles_done, cell: s => `<div class="rk-cyc"><span>${s.cycles_done} / ${s.cycles_held}</span><span class="rk-cbar"><i style="width:${s.cycles_held ? 100 * s.cycles_done / s.cycles_held : 0}%"></i></span></div>` },
    { k: 'match_rate', w: 8, l: 'Match Rate', t: 'num', get: s => s.match_rate, cell: s => rkPct2(s.match_rate) },
    { k: 'short_transit', w: 8, l: 'In Transit', t: 'num', get: s => s.short_transit, cell: s => rkPts(s.short_transit) },
    { k: 'counted_short_pct', w: 10, l: 'Genuine Shortage %', t: 'num', get: s => rkCpct(s), cell: s => rkPct(rkCpct(s)) },
    { k: 'go', w: 13, l: 'Action', ns: true, t: 'text', get: () => '', cell: s => `<span class="rk-act"><a class="rk-view" href="#/storedetail?s=${s.id}&from=ranking">${ic('eye', 14)} View</a><span class="rk-dw"><button type="button" class="rk-dots" data-dot="${s.id}" title="More actions">&#8942;</button><span class="rk-dmenu" hidden><a href="#/storedetail?s=${s.id}&from=ranking">View audit detail</a></span></span></span>` }];
  const CC = [
    { k: 'circle_rank', w: 9, l: 'Circle rank', t: 'num', get: c => c.circle_rank, cell: c => rkPill(c.circle_rank, c.cycles_done > 0) },
    { k: 'circle', w: 10, l: 'Circle', t: 'text', get: c => c.circle, cell: c => `<b>${esc(c.circle)}</b>` },
    { k: 'stores', w: 7, l: 'Stores', t: 'num', get: c => c.stores, cell: c => c.stores },
    { k: 'avg_points', w: 11, l: 'Avg points / store', t: 'num', get: c => c.avg_points, cell: c => `<b>${rkPts(c.avg_points)}</b>` },
    { k: 'participation_pct', w: 11, l: 'Participation', t: 'num', get: c => c.participation_pct, cell: c => c.participation_pct == null ? '\u2014' : c.participation_pct + '%' },
    { k: 'short_transit', w: 12, l: 'Short in transit', t: 'num', get: c => c.short_transit, cell: c => rkPts(c.short_transit) },
    { k: 'short_other', w: 12, l: 'Short other status', t: 'num', get: c => c.short_other, cell: c => rkPts(c.short_other) },
    { k: 'counted_short_pct', w: 13, l: 'Counted shortage %', t: 'num', get: c => rkCpct(c), cell: c => rkPct(rkCpct(c)) },
    { k: 'top_store', w: 15, l: 'Top store', t: 'text', get: c => c.top_store, cell: c => c.top_store ? esc(c.top_store) + ' <span class="muted">(' + rkPts(c.top_points) + ' pts)</span>' : '\u2014' }];
  const SS = { sort: null }, CS = { sort: null };       // sort + filters survive tab switches
  let lastRows = [];
  const slug = s => String(s || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  async function exportRanking() {
    if (!lastRows.length) { toast('Nothing to export.', 'warn'); return; }
    try { await loadXlsx(); } catch (e) { toast(e.message || 'Could not load the Excel library.', 'err'); return; }
    const data = lastRows.map(s => ({ 'Rank in India': ranked(s) ? s.pan_rank : '—', 'Rank in circle': ranked(s) ? s.circle_rank : '—', 'Store code': s.code, 'Store name': s.name, 'Circle': s.circle, 'Level': s.level || 'Unranked', 'Points': Number(s.points || 0), 'Cycles': `${s.cycles_done} of ${s.cycles_held}`, 'Match rate %': s.match_rate == null ? '' : Number(s.match_rate), 'Short (all)': Number(s.short || 0), 'In transit': Number(s.short_transit || 0), 'Other status': Number(s.short_other || 0), 'Genuine shortage %': rkCpct(s) == null ? '' : Number(rkCpct(s)) }));
    const ws = XLSX.utils.json_to_sheet(data), wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ranking');
    const dd = new Date(), ymd = dd.getFullYear() + String(dd.getMonth() + 1).padStart(2, '0') + String(dd.getDate()).padStart(2, '0');
    XLSX.writeFile(wb, `Ranking_${slug(seasons[si].label)}_${ymd}.xlsx`);
    toast(`Downloaded ${lastRows.length} store(s).`, 'ok');
  }
// ---- small inline icons for the top-store card (original design, unchanged) ----
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
  el.innerHTML = `${stores.length && !('level' in stores[0]) ? rkStaleBanner : ''}<div class="pagehead rk-phead"><div><h1>Ranking</h1></div>
    <div class="rk-sctrl"><label for="rk-season">Season</label><select id="rk-season">${seasons.map((s, i) => `<option value="${i}" ${i === si ? 'selected' : ''}>${s.label}</option>`).join('')}</select><span id="rk-live"></span></div></div>
    <div class="tabs seg rk-tabs" id="rk-tabs" style="margin-bottom:12px">${tabs.map(t => `<button class="tab ${t[0] === F.tab ? 'on' : ''}" data-t="${t[0]}">${ic(t[2], 16)}<span>${t[1]}</span></button>`).join('')}</div><div id="rk-body"></div>`;
  const body = el.querySelector('#rk-body');
  el.querySelector('#rk-season').onchange = async e => { si = +e.target.value; F.page = 1; F.c = ''; F.q = ''; try { await load(); } catch (err) { toast(rpcMsg(err), 'err'); return; } draw(); };
  const pager = (total, pages) => {
    if (!total) return '';
    const from = (F.page - 1) * F.ps + 1, to = Math.min(total, F.page * F.ps);
    const p0 = Math.max(1, Math.min(F.page - 2, pages - 4)), p1 = Math.min(pages, p0 + 4);
    let btns = '';
    for (let p = p0; p <= p1; p++) btns += `<button type="button" class="${p === F.page ? 'on' : ''}" data-pg="${p}">${p}</button>`;
    return `<div class="rk-pager"><span class="muted">Showing ${from} &ndash; ${to} of ${total} stores</span><div class="rk-pg-right"><div class="pg"><button type="button" data-pg="${F.page - 1}" ${F.page <= 1 ? 'disabled' : ''}>&lsaquo;</button>${btns}<button type="button" data-pg="${F.page + 1}" ${F.page >= pages ? 'disabled' : ''}>&rsaquo;</button></div><label class="rk-ps"><select id="rk-ps">${[10, 25, 50].map(n => `<option value="${n}" ${n === F.ps ? 'selected' : ''}>${n}</option>`).join('')}</select> / page</label></div></div>`;
  };
  const draw = () => {
    el.querySelectorAll('#rk-tabs .tab').forEach(b => b.classList.toggle('on', b.dataset.t === F.tab));
    const lv = el.querySelector('#rk-live');
    if (lv) lv.innerHTML = seasons[si].live ? '<span class="livepill"><i></i>Live Season</span>' : '<span class="rk-ended">Season ended</span>';
    if (F.tab === 'circles') {
      body.innerHTML = `<div class="card" style="padding:16px">${circles.length ? rkGrid(CC, circles, CS, 'No circles.') : '<p class="muted">No circles.</p>'}</div>${rkHow()}`;
      body.onclick = e => rkSortClick(e, CS, draw);
    } else if (F.tab === 'top') {
      const top = circles.filter(c => c.top_store).map(c => ({ c, s: stores.find(x => x.code === c.top_store) }))
        .sort((a, b) => (a.s ? a.s.pan_rank : 1e9) - (b.s ? b.s.pan_rank : 1e9) || a.c.circle.localeCompare(b.c.circle));
      body.onclick = null;
      body.innerHTML = top.length ? `<div class="rk-top">${top.map(x => rkTopCard(x.c, x.s)).join('')}</div>${rkHow()}`
        : '<div class="card startcard"><h2>No top stores yet</h2><p class="muted">Stores appear here once they complete an audit.</p></div>';
    } else {
      const q = F.q.trim().toLowerCase();
      let rows = stores.filter(s => (!F.c || s.circle === F.c) && (!q || (s.code + ' ' + s.name).toLowerCase().includes(q)));
      if (!admin) rows = rows.slice().sort((a, b) => a.circle.localeCompare(b.circle) || a.circle_rank - b.circle_rank || a.code.localeCompare(b.code));
      rows = rkSorted(SC, rows, SS);
      lastRows = rows;
      // Season summary cards: where the visible stores stand this season.
      const nT = stores.length, nC = stores.filter(s => s.cycles_held > 0 && s.cycles_done >= s.cycles_held).length,
        nP = stores.filter(s => s.cycles_done > 0 && s.cycles_done < s.cycles_held).length, nN = stores.filter(s => !s.cycles_done).length;
      const pctOf = n => nT ? (Math.round(1000 * n / nT) / 10) + '%' : '—';
      const stat = (cls, icon, val, label, barPct) => `<div class="card rk-stat"><span class="rk-ric ${cls}">${icon}</span><div class="rk-sm"><div class="rk-sv">${val}</div><small>${label}</small>${barPct != null ? `<div class="bar2 rk-sbar ${cls}"><i style="width:${barPct}%"></i></div>` : ''}</div></div>`;
      const stats = `<div class="rk-stats">${stat('b', ic('store', 19), nT.toLocaleString('en-IN'), 'Total Stores', null)}
        ${stat('g', '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" opacity=".18"/><path d="M8.5 12.5l2.4 2.4L15.7 9.6"/></svg>', pctOf(nC), 'Completed', nT ? 100 * nC / nT : 0)}
        ${stat('a', '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/></svg>', pctOf(nP), 'In Progress', nT ? 100 * nP / nT : 0)}
        ${stat('gr', '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>', pctOf(nN), 'Not Started', nT ? 100 * nN / nT : 0)}</div>`;
      // With the Top 3 shown above and no filter/search/sort active, the table starts at rank 4 (design module).
      const excl = admin && top3.length > 0 && !F.c && !q && !SS.sort;
      const tRows = excl ? rows.filter(s => !top3.some(t => t.id === s.id)) : rows;
      const pages = Math.max(1, Math.ceil(tRows.length / F.ps));
      if (F.page > pages) F.page = pages;
      const pageRows = tRows.slice((F.page - 1) * F.ps, F.page * F.ps);
      body.innerHTML = `<div class="rk-frow"><div class="rk-fc"><label>Circle</label><select id="rk-c"><option value="">All circles</option>${cs.map(c => `<option ${c === F.c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="rk-fs"><label>Search store</label><div class="rk-swrap">${ic('search', 15)}<input id="rk-q" placeholder="Search store code or name..." value="${esc(F.q)}"></div></div>
        <div class="rk-fe"><label>&nbsp;</label><div class="rk-dd"><button type="button" class="btn" id="rk-exp">${ic('dl', 15)} Export</button><div class="rk-dmenu" id="rk-expmenu" hidden><button type="button" id="rk-expx">Excel (.xlsx)</button></div></div></div></div>
        ${stats}${podium()}<div class="rk-tt"><b>All Stores</b>${excl ? '<span class="muted">Top 3 shown above</span>' : ''}</div><div class="card" id="rk-table" style="padding:14px">${rkGrid(SC, pageRows, SS, 'No stores match.')}</div>${pager(tRows.length, pages)}${rkHow()}`;
      body.onclick = e => {
        const t = e.target;
        const pg = t.closest('[data-pg]');
        if (pg) { if (!pg.disabled) { F.page = +pg.dataset.pg; draw(); } return; }
        if (t.closest('#rk-expx')) { body.querySelector('#rk-expmenu').hidden = true; exportRanking(); return; }
        if (t.closest('#rk-exp')) { const m = body.querySelector('#rk-expmenu'); m.hidden = !m.hidden; return; }
        const dot = t.closest('[data-dot]');
        if (dot) { const m = dot.parentElement.querySelector('.rk-dmenu'), was = m.hidden; body.querySelectorAll('.rk-dmenu').forEach(x => x.hidden = true); m.hidden = !was; return; }
        body.querySelectorAll('.rk-dmenu').forEach(x => x.hidden = true);
        rkSortClick(e, SS, draw);
      };
      const c = body.querySelector('#rk-c'), qi = body.querySelector('#rk-q');
      c.onchange = e => { F.c = e.target.value; F.page = 1; draw(); };
      qi.oninput = e => { F.q = e.target.value; F.page = 1; const p = e.target.selectionStart; draw(); const n = body.querySelector('#rk-q'); n.focus(); n.setSelectionRange(p, p); };
      const psSel = body.querySelector('#rk-ps');
      if (psSel) psSel.onchange = e => { F.ps = +e.target.value; F.page = 1; draw(); };
      const vf = body.querySelector('#rk-full');
      if (vf) vf.onclick = () => { const tb = body.querySelector('#rk-table'); if (tb) tb.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    }
  };
  el.querySelector('#rk-tabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { F.tab = b.dataset.t; F.page = 1; draw(); } };
  draw();
}
