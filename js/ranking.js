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
// Season bonus counts (migration 36): 🎯 One-Shot cycles, 🧹 Clean Sweep cycles.
const rkBonusChips = s => { const o = Number((s && s.oneshot) || 0), c = Number((s && s.cleansweep) || 0);
  return (o || c) ? `<span class="rk-bonus">${o ? `<span title="One-Shot cycles this season — submitted with zero shortage, never reopened">🎯×${o}</span>` : ''}${c ? `<span title="Clean Sweep cycles this season — shortage fully explained and accepted, closed at zero">🧹×${c}</span>` : ''}</span>` : ''; };
const rkHow = () => `<details class="rk-how"><summary>How points & levels work</summary>
  <p><b>Seasons.</b> Ranking runs in 3-month seasons (calendar quarters: Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec). Only audit cycles of the season count, so every season starts fresh and a finished season's result never changes.</p>
  <p><b>Points.</b> For every cycle of the season your store <b>completes</b> you earn <b>20 points for taking part</b> plus <b>your match rate</b> (up to 100 points). A cycle you do not complete earns 0.</p>
  <p><b>Bonus awards.</b> A completed cycle can earn one extra award. <b>🎯 One-Shot (+10)</b> — you submitted with <b>zero genuine shortage</b> and your audit was <b>never reopened</b>. <b>🧹 Clean Sweep (+5)</b> — shortage was found, but you explained <b>all</b> of it with remarks, management accepted every one, and the cycle closed at <b>zero genuine shortage</b> (and the audit was never reopened). A cycle earns only one award, so the most a single cycle can give is <b>130 points</b>. The 🎯 / 🧹 counts next to the points show how many times the store has earned each award this season.</p>
  <p><b>In-transit shortage is shown separately.</b> Your audit result still shows every short item as it is. For the ranking, shortage on items whose Inventory_Status is In Transit (already moved out of the store) is displayed on its own and does not lower your match rate: the match rate used for points is your matched stock measured against the shortage of all <b>other</b> statuses (the "genuine" shortage). Genuine shortage is what affects your performance.</p>
  <p><b>Match rate and shortage show your latest audit.</b> Every cycle is audited against a fresh base-data upload, so your ranking position is your latest completed cycle of the season — its match rate, shortage and in-transit figures are the ones shown. A serial still missing in the next cycle is the same one missing device, so it counts once; an item you find later stops counting; a non-serialized item counts at its latest short quantity. Points still add up across every cycle you complete.</p>
  <p><b>Levels.</b> Points alone are not enough — a level also needs quality: Bronze ≥ 50% of the season's cycles completed, match ≥ 85%, genuine shortage ≤ 8% · Silver ≥ 65%, ≥ 90%, ≤ 5% · Gold ≥ 80%, ≥ 97%, ≤ 2% · Platinum ≥ 90%, ≥ 98%, ≤ 1.5% · Diamond 100%, ≥ 99%, ≤ 0.5% · Champion 100%, match above 99%, ≤ 0.05% and every audit submitted within its deadline. The points target on the level card is a live benchmark — the lowest points held by any store at the next level this season (estimated from the level criteria when no store holds that level yet). The level itself is always decided by the targets.</p>
  <p><b>Shortage revision.</b> If part of your genuine shortage happened for a process reason — issued to an FE, an S2S transfer, a cancelled S2W, a dummy serial, an IT error — add a remark against it on your result page. Once management reviews and accepts it, that quantity stops counting as your shortage: your points, match rate and level update immediately. The original audited numbers are always kept alongside.</p>
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
  // Rosette medal (owner mockup): scalloped badge + ribbons, centre glyph by level.
  const glyphFor = L => L === 'Champion'
    ? '<path d="M16.8 27.2 15.7 19.8l4.2 2.8 4.1-5.2 4.1 5.2 4.2-2.8-1.1 7.4z M17 29.4h14" stroke="#fff" stroke-width="1.7" fill="#fff" stroke-linejoin="round"/>'
    : (L === 'Diamond' || L === 'Platinum')
    ? '<path d="M19.5 19.5h19L24 31z M19.5 19.5 22 15h14l2.5 4.5 M22 15l3.2 12 M36 15l-3.2 12" stroke="#fff" stroke-width="1.6" fill="none" stroke-linejoin="round"/>'
    : '<path d="M24 16.2l2.3 4.9 5.4.7-3.9 3.7 1 5.3L24 28.2l-4.8 2.6 1-5.3-3.9-3.7 5.4-.7z" fill="#fff"/>';
  const rkRosette = (color, L, size) => { const pts = []; for (let i = 0; i < 24; i++) { const r = i % 2 ? 16.8 : 20.5, a = Math.PI * i / 12 - Math.PI / 2; pts.push((24 + r * Math.cos(a)).toFixed(1) + ',' + (21 + r * Math.sin(a)).toFixed(1)); }
    return `<svg width="${size}" height="${Math.round(size * 52 / 48)}" viewBox="0 0 48 52" aria-hidden="true"><path d="M15.5 34 11.5 49l7.8-4.4L24 49.5l4.7-4.9L36.5 49 32.5 34z" fill="${color}" opacity=".45"/><polygon points="${pts.join(' ')}" fill="${color}"/><circle cx="24" cy="21" r="13" fill="${color}" stroke="#ffffff59" stroke-width="1.4"/>${glyphFor(L)}</svg>`; };
  // Points benchmark for the next level: the lowest points held by any store at that
  // level this season (server: level_points). If no store holds it yet, estimate the
  // target from the level criteria: cycles held x (20 + the gate's match %).
  const lp = d.level_points || {};
  let bench = null;
  if (next) bench = lp[next] != null ? { target: Number(lp[next]), est: false } : { target: Math.round(d.cycles_held * (20 + RK_GATES[next].match)), est: true };
  const bPct = bench && bench.target > 0 ? Math.min(100, Math.round(1000 * Number(d.points || 0) / bench.target) / 10) : 0;
  const bLeft = bench ? bench.target - Number(d.points || 0) : 0;
  const benchMeta = !bench || bench.target <= 0
    ? `<span><b>${rkPts(d.points)}</b> <span class="muted">points this season</span> ${rkBonusChips(d)}</span><span></span>`
    : `<span><b>${rkPts(d.points)}</b> <span class="muted">/ ${rkPts(bench.target)}${bench.est ? ' (estimated target)' : ''}</span> ${rkBonusChips(d)}</span><span class="rk-lneed${bLeft > 0 ? '' : ' ok'}">${bLeft > 0 ? rkPts(bLeft) + ' points needed' : 'Benchmark reached ✓'}</span>`;
  const lvlCard = next ? `<div class="card rk-lvl">${rkRosette(lc, lvl, 62)}<div class="rk-lm"><div class="rk-lrow"><div><small>Your Level</small><div class="rk-lname" style="color:${lc}">${lvl}</div></div>
      <span class="rk-nchip">${rkRosette('#9AA7B1', next, 20)} Next Level: ${next}</span></div>
      <div class="bar2 rk-lbar"><i style="width:${bPct}%"></i></div>
      <div class="rk-lmeta">${benchMeta}</div></div></div>`
    : `<div class="card rk-lvl">${rkRosette(lc, lvl, 62)}<div class="rk-lm"><div class="rk-lrow"><div><small>Your Level</small><div class="rk-lname" style="color:${lc}">${lvl}</div></div>
      <span class="rk-nchip">🏆 Highest Tier</span></div>
      <div class="bar2 rk-lbar"><i style="width:100%"></i></div>
      <div class="rk-lmeta"><span><b>${rkPts(d.points)}</b> <span class="muted">points this season</span> ${rkBonusChips(d)}</span><span class="rk-lneed ok">Highest level reached</span></div></div></div>`;
  const icoCrown = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3.5 17 2.4 8.5 7.5 12 12 5.8 16.5 12l5.1-3.5L20.5 17z"/><path d="M4 20.5h16"/></svg>';
  const icoBars = '<svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3.5" y="12.5" width="4.6" height="7.5" rx="1.2"/><rect x="9.7" y="8" width="4.6" height="12" rx="1.2"/><rect x="15.9" y="3.5" width="4.6" height="16.5" rx="1.2"/></svg>';
  const rankCard = (cls, icon, label, n, sub) => `<div class="card rk-rc2 ${cls}"><div class="rk-rrow"><span class="rk-ric">${icon}</span><small class="rk-rl2">${label}</small></div><div class="rk-n">${none ? '—' : '#' + n}</div><div class="rk-sub">${none ? 'Complete your first audit to get ranked' : sub}</div></div>`;
  const C = 2 * Math.PI * 26, off = C * (1 - (d.cycles_held ? d.cycles_done / d.cycles_held : 0));
  const donut = `<svg class="rk-donut" width="72" height="72" viewBox="0 0 72 72"><circle cx="36" cy="36" r="26" fill="none" stroke="#E4EDE9" stroke-width="7"/><circle cx="36" cy="36" r="26" fill="none" stroke="#16A34A" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 36 36)"/><text x="36" y="34" text-anchor="middle" class="rk-dn">${d.cycles_done} / ${d.cycles_held}</text><text x="36" y="48" text-anchor="middle" class="rk-ds">Cycles</text></svg>`;
  // KPI row (icon tile + label + value; shortage types stay separate, in units).
  const kIco = (inner, col) => `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const kpi = (cls, icon, label, val, vstyle) => `<div class="card rk-kpi2"><span class="rk-ric ${cls}">${icon}</span><div><small>${label}</small><div class="rk-kv2"${vstyle ? ` style="${vstyle}"` : ''}>${val}</div></div></div>`;
  const kpis = `<div class="rk-kpis">
    ${kpi('t', kIco('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15.5l2 2 4-4"/>', '#0E7490'), 'Cycles Completed', `${d.cycles_done} / ${d.cycles_held}`)}
    ${kpi('rose', kIco('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="#E11D48"/>', '#E11D48'), 'Match Rate', rkPct2(d.match_rate))}
    ${kpi('peach', kIco('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 16.8v.2"/>', '#EA580C'), 'Genuine Shortage', rkPts(d.short_other) + ' <small class="rk-un">units</small>', 'color:#EA580C')}
    ${kpi('b', kIco('<path d="M2.5 6h12v11h-12zM14.5 10h4l3 3.5V17h-7z"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>', '#2563EB'), 'In Transit', rkPts(d.short_transit) + ' <small class="rk-un">units</small>')}</div>`;
  // Level journey: every level, current highlighted, next emphasized.
  const journey = `<div class="card rk-journey"><div class="rk-jt"><b>Level Journey</b><span class="muted">This season</span></div><div class="rk-jrow">${RK_LEVELS.map((L, i) => {
    const st = i < li ? 'done' : i === li ? 'cur' : i === li + 1 ? 'next' : 'todo', col = RK_LVL[L];
    return `${i ? '<span class="rk-jarr">→</span>' : ''}<span class="rk-jchip ${st}" ${st === 'cur' || st === 'next' ? `style="--jc:${col}"` : ''}>${rkMedal(L, 12)} ${L}${st === 'cur' ? ' ✓' : ''}${st === 'next' ? '<em>Next</em>' : ''}</span>`; }).join('')}</div></div>`;
  // Next-level card (mockup): grey rosette + title/points line, gate rings on the right.
  const ring = (pct, ok, center) => { const r = 19, cc = 2 * Math.PI * r, f = pct == null ? cc : cc * Math.max(0, Math.min(100, pct)) / 100;
    return `<svg width="46" height="46" viewBox="0 0 46 46"><circle cx="23" cy="23" r="${r}" fill="none" stroke="#E7EEEA" stroke-width="4"/><circle cx="23" cy="23" r="${r}" fill="none" stroke="${ok === false ? '#F59E0B' : '#16A34A'}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${cc.toFixed(1)}" stroke-dashoffset="${(cc - f).toFixed(1)}" transform="rotate(-90 23 23)"/><text x="23" y="27.5" text-anchor="middle" class="rk-ring-t" fill="${ok === false ? '#EA580C' : '#12805C'}">${center}</text></svg>`; };
  const seg = (ringHtml, val, valOk, label, req, reqOk) => `<div class="rk-seg">${ringHtml}<div><div class="rk-sv" ${valOk == null ? '' : `style="color:${valOk ? '#12805C' : '#C2410C'}"`}>${val}</div><div class="rk-sl">${label}</div><div class="rk-sr ${reqOk ? 'ok' : 'no'}">${req}</div></div></div>`;
  let nextCard;
  if (!next) nextCard = `<div class="card rk-next">${rkRosette(lc, 'Champion', 52)}<div class="rk-nm"><b>🏆 Champion — Highest Tier</b><span>You hold the highest level this season. Defend it next season.</span></div></div>`;
  else { const g = RK_GATES[next];
    const cOk = d.cycles_held > 0 && comp >= g.comp, mOk = d.match_rate != null && (g.matchGt ? d.match_rate > g.match : d.match_rate >= g.match), sOk = cpct != null && cpct <= g.short;
    const sub = bench && bench.target > 0 && bLeft > 0 ? `You need ${rkPts(bLeft)} more points to reach ${next}.` : bench && bench.target > 0 ? `Points benchmark reached — meet the targets on the right to reach ${next}.` : `Meet the targets on the right to reach ${next}.`;
    nextCard = `<div class="card rk-next">${rkRosette('#9AA7B1', next, 52)}<div class="rk-nm"><b>Next Level: ${next}</b><span>${sub}</span></div>
      <div class="rk-segs">${seg(ring(comp, cOk, comp + '%'), comp + '%', null, 'Cycle Completion', `≥ ${g.comp}% required`, cOk)}
      ${seg(ring(100, mOk, mOk ? '✓' : '!'), rkPct2(d.match_rate), mOk, 'Match Rate', `${g.matchGt ? '&gt;' : '≥'} ${g.match}% required`, mOk)}
      ${seg(ring(100, sOk, sOk ? '✓' : '!'), rkPct(cpct), sOk, 'Genuine Shortage', `≤ ${g.short}% required`, sOk)}
      ${g.ontime ? seg(ring(100, !d.late_count, !d.late_count ? '✓' : '!'), d.late_count ? d.late_count + ' late' : 'All on time', !d.late_count, 'On-time Submission', 'Every audit within its deadline', !d.late_count) : ''}</div></div>`; }
  const nCyc = d.cycles.length;
  el.innerHTML = `<div class="pagehead"><div><h1>My Ranking</h1><p class="muted" style="margin:4px 0 0">${esc(d.store)} · ${esc(d.circle)} Circle</p></div>
    <div class="rk-stag"><span class="livepill"><i></i>Live Season</span><span class="rk-stxt">${cur.label} | ${d.cycles_held} cycle${d.cycles_held === 1 ? '' : 's'}</span></div></div>
    <div class="rk-top4">${lvlCard}
    ${rankCard('rc-c', icoCrown, 'Circle Rank', d.circle_rank, esc(d.circle) + ' Circle · of ' + d.circle_total)}
    ${rankCard('rc-i', icoBars, 'India Rank', d.pan_rank, 'All stores · of ' + d.pan_total)}
    <div class="card rk-pc">${donut}<div><small>Season Progress</small><div class="rk-pn">${comp}% completed</div><div class="bar2 rk-pbar"><i style="width:${comp}%"></i></div><div class="rk-sub">${d.cycles_held ? (d.cycles_held - d.cycles_done) + ' cycle' + (d.cycles_held - d.cycles_done === 1 ? '' : 's') + ' remaining' : 'No cycles yet this season'}</div></div></div></div>
    ${kpis}${journey}
    <div class="card rk-perf"><b>Season Performance</b><div class="rk-twrap">${nCyc ? tbl(['Audit Cycle', 'Status', 'Cycle', 'Match Rate', 'Genuine Shortage', 'In Transit', 'Points'], d.cycles.map((c, ix) => `<tr><td>${esc(c.name)}${c.status === 'ACTIVE' ? ' ' + badge('Open', 'info') : ''}</td><td>${c.done ? badge('Completed', 'ok') : badge('Not completed', 'bad')}</td>
      <td>${nCyc - ix} / ${nCyc}</td><td>${c.match_rate == null ? '—' : c.match_rate + '%'}</td><td>${c.done ? rkPts(c.short_other) : '—'}</td><td>${c.done ? rkPts(c.short_transit) : '—'}</td><td><b>${rkPts(c.points)}</b>${c.bonus === 10 ? ' <span class="rk-btag os">🎯 One-Shot +10</span>' : c.bonus === 5 ? ' <span class="rk-btag cs">🧹 Clean Sweep +5</span>' : ''}</td></tr>`).join('')) : '<p class="muted">No audit cycle yet this season.</p>'}</div></div>${nextCard}${rkHow()}`;
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
  // Per-store status in the CURRENTLY LOADED cycle (sidebar AUDIT CYCLE,
  // S.cycleId) — the four summary cards below read this, not the season
  // totals. curStatsOk stays false when there is no loaded cycle or the
  // session query fails, and the cards then fall back to the old season
  // math instead of breaking the page. A store with a LOCKED session counts
  // as completed even if it also has an IN_PROGRESS (reopened) version —
  // the same "done" rule _store_rank uses.
  let curLocked = new Set(), curProg = new Set(), curStatsOk = false;
  const loadCurCycleStats = async () => {
    curLocked = new Set(); curProg = new Set(); curStatsOk = false;
    if (!S.cycleId) return;
    try {
      const { data, error } = await sb.from('audit_sessions').select('store_id,status').eq('audit_cycle_id', S.cycleId);
      if (error) throw error;
      (data || []).forEach(r => {
        if (r.status === 'LOCKED') curLocked.add(r.store_id);
        else if (r.status === 'IN_PROGRESS') curProg.add(r.store_id);
      });
      curProg.forEach(id => { if (curLocked.has(id)) curProg.delete(id); });
      curStatsOk = true;
    } catch (e) { curLocked = new Set(); curProg = new Set(); curStatsOk = false; }
  };
  apply();
  await loadCurCycleStats();
  const load = async () => { const r = await sb.rpc('rank_staff', rkWin(seasons[si])); if (r.error) throw r.error; d = r.data; apply(); await loadCurCycleStats(); };
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
    <div class="rpc3-store"><b>${esc(s.code)}</b><span>${rkLvlChip(s.level)}</span></div>
    <div class="rpc3-pts"><b>${rkPts(s.points)}</b><span>Points</span>${rkBonusChips(s) ? `<div>${rkBonusChips(s)}</div>` : ''}</div></div>
    <div class="rpc3-stats"><div><span>India Rank</span><b>#${s.pan_rank}</b></div><div><span>Circle Rank</span><b>#${s.circle_rank}</b></div><div><span>Cycles</span><b>${s.cycles_done}/${s.cycles_held}</b></div><div><span>Match Rate</span><b>${rkPct2(s.match_rate)}</b></div><div><span>Short %</span><b>${rkPct(rkCpct(s))}</b></div></div>
    <div class="rpc3-qty"><span class="q-tr">${TI.truck} In Transit <b>${rkPts(s.short_transit)}</b></span><span class="q-wn">${TI.warn} Genuine Shortage <b>${rkPts(s.short_other)}</b> units</span></div></div>`;
  const podium = () => top3.length ? `<section class="rkpod3"><div class="rp2-head"><span class="rp2-ticon">${ic('trophy', 20)}</span><div class="rp2-tt"><b>Top 3 Stores (India) <small>— ${esc(seasons[si].label)}</small></b></div><button type="button" class="rp2-link" id="rk-full">View full ranking &nbsp;&rarr;</button></div><div class="rp3-row">${top3.map((s, i) => topCard3(s, i + 1)).join('')}</div></section>` : '';
  const SC = [
    { k: 'pan_rank', w: 6, l: 'India Rank', t: 'num', get: s => s.pan_rank, cell: s => ranked(s) ? `<b>${s.pan_rank}</b>` : '—' },
    { k: 'circle_rank', w: 6, l: 'Circle Rank', t: 'num', get: s => s.circle_rank, cell: s => ranked(s) ? `<b${s.circle_rank <= 3 ? ' class="rk-red"' : ''}>${s.circle_rank}</b>` : '—' },
    { k: 'store', w: 16, l: 'Store', t: 'text', get: s => s.code + ' ' + s.name, cell: s => `<b>${esc(s.code)}</b>` },
    { k: 'circle', w: 6, l: 'Circle', t: 'text', get: s => s.circle, cell: s => esc(s.circle) },
    { k: 'level', w: 10, l: 'Level', t: 'text', get: s => s.level || 'Unranked', cell: s => rkLvlChip(s.level) },
    { k: 'points', w: 7, l: 'Points', t: 'num', get: s => s.points, cell: s => `<b>${rkPts(s.points)}</b>${rkBonusChips(s) ? `<div>${rkBonusChips(s)}</div>` : ''}` },
    { k: 'cycles_done', w: 7, l: 'Cycles', t: 'num', get: s => s.cycles_done, cell: s => `${s.cycles_done} / ${s.cycles_held}` },
    { k: 'match_rate', w: 9, l: 'Match Rate', t: 'num', get: s => s.match_rate, cell: s => rkPct2(s.match_rate) },
    { k: 'short_transit', w: 8, l: 'In Transit', t: 'num', get: s => s.short_transit, cell: s => rkPts(s.short_transit) },
    { k: 'short_other', w: 7, l: 'Short', t: 'num', get: s => s.short_other, cell: s => rkPts(s.short_other) },
    { k: 'counted_short_pct', w: 8, l: 'Short%', t: 'num', get: s => rkCpct(s), cell: s => rkPct(rkCpct(s)) },
    { k: 'go', w: 10, l: 'Action', ns: true, t: 'text', get: () => '', cell: s => `<a class="rk-view" href="#/storedetail?s=${s.id}&from=ranking">${ic('eye', 14)} View</a>` }];
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
    const data = lastRows.map(s => ({ 'Rank in India': ranked(s) ? s.pan_rank : '—', 'Rank in circle': ranked(s) ? s.circle_rank : '—', 'Store code': s.code, 'Store name': s.name, 'Circle': s.circle, 'Level': s.level || 'Unranked', 'Points': Number(s.points || 0), 'One-Shot cycles': Number(s.oneshot || 0), 'Clean Sweep cycles': Number(s.cleansweep || 0), 'Cycles': `${s.cycles_done} of ${s.cycles_held}`, 'Match rate %': s.match_rate == null ? '' : Number(s.match_rate), 'Short (all)': Number(s.short || 0), 'In transit': Number(s.short_transit || 0), 'Other status': Number(s.short_other || 0), 'Genuine shortage %': rkCpct(s) == null ? '' : Number(rkCpct(s)) }));
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
    return `<div class="rk-pager"><span class="muted">Showing ${from} &ndash; ${to} of ${total} stores</span><div class="rk-pg-right"><label class="rk-ps">Rows per page <select id="rk-ps">${[10, 20, 50].map(n => `<option value="${n}" ${n === F.ps ? 'selected' : ''}>${n}</option>`).join('')}</select></label><div class="pg"><button type="button" data-pg="${F.page - 1}" ${F.page <= 1 ? 'disabled' : ''}>&lsaquo;</button>${btns}<button type="button" data-pg="${F.page + 1}" ${F.page >= pages ? 'disabled' : ''}>&rsaquo;</button></div></div></div>`;
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
      // Summary cards: the CURRENTLY LOADED cycle only. The old season math
      // (cycles_done vs cycles_held) kept describing the previous completed
      // cycle, because _store_rank only counts an ACTIVE cycle once a store
      // locks it — so while a new cycle was open, every store that finished
      // the last one still showed as "Completed" here.
      const useCur = !!(S.cycleId && curStatsOk);
      const nT = stores.length;
      const nC = useCur ? stores.filter(s => curLocked.has(s.id)).length : stores.filter(s => s.cycles_held > 0 && s.cycles_done >= s.cycles_held).length;
      const nP = useCur ? stores.filter(s => curProg.has(s.id)).length : stores.filter(s => s.cycles_done > 0 && s.cycles_done < s.cycles_held).length;
      const nN = useCur ? nT - nC - nP : stores.filter(s => !s.cycles_done).length;
      const pctOf = n => nT ? (Math.round(1000 * n / nT) / 10) + '%' : '—';
      const stat = (cls, icon, label, val, sub, barPct) => `<div class="card rk-stat"><span class="rk-ric ${cls}">${icon}</span><div class="rk-sm"><small>${label}</small><div class="rk-sv">${val}</div>${sub ? `<div class="rk-ssub">${sub}</div>` : ''}${barPct != null ? `<div class="bar2 rk-sbar ${cls}"><i style="width:${barPct}%"></i></div>` : ''}</div></div>`;
      const stats = `<div class="rk-stats">${stat('b', ic('store', 19), 'Total Stores', nT.toLocaleString('en-IN'), 'Stores', null)}
        ${stat('g', '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" opacity=".18"/><path d="M8.5 12.5l2.4 2.4L15.7 9.6"/></svg>', 'Completed', pctOf(nC), `${nC} / ${nT} stores`, nT ? 100 * nC / nT : 0)}
        ${stat('a', '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/></svg>', 'In Progress', pctOf(nP), `${nP} / ${nT} stores`, nT ? 100 * nP / nT : 0)}
        ${stat('gr', '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>', 'Not Started', pctOf(nN), `${nN} / ${nT} stores`, nT ? 100 * nN / nT : 0)}</div>`;
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
