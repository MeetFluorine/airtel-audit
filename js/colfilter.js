// Click-to-filter column headers (funnel button -> tick values / type text / set a range), shared by the store result page
// and the Admin / Circle Head store view. Usage:
//   const CF = colFilters([{ k: 'item_code', l: 'Item_Code', t: 'list' }, ...], valuesFromRpc, () => reloadTable());
//   header cell: CF.th('item_code')      query: qb = CF.apply(qb)      chips: CF.chips(boxEl)      clicks: if (CF.handle(e)) return;
// column: k = key, l = label, t = 'list' | 'text' | 'num', col = database column if different from k, vals = fixed list of values, lab = value labels.
// A 'list' column without any values (database/19 not installed) quietly becomes a "contains" box. 'variance' = physical - expected.
function colFilters(cols, fv, onChange) {
  const F = {}, byK = k => cols.find(c => c.k === k), RL = { MATCH: 'Matched', SHORT: 'Short', EXCESS: 'Excess' };
  const vals = c => c.vals || (c.k === 'result' ? ['MATCH', 'SHORT', 'EXCESS'] : (fv && Array.isArray(fv[c.k]) ? fv[c.k] : null));
  const type = c => c.t === 'list' && !vals(c) ? 'text' : c.t;
  const vlabel = (c, v) => v === '' ? '(Blank)' : c.lab && c.lab[v] != null ? c.lab[v] : c.k === 'result' ? (RL[v] || v) : v;
  const FUN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>';
  const quote = v => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const th = (k, label) => { const c = byK(k); return `<span class="thf">${label || esc(c.l)}<button type="button" class="cf ${F[k] ? 'on' : ''}" data-cf="${k}" aria-label="Filter ${esc(c.l)}" title="Filter ${esc(c.l)}">${FUN}</button></span>`; };

  function apply(qb) {
    for (const [k, f] of Object.entries(F)) {
      const c = byK(k), col = c.col || c.k;
      if (f.in) { const vs = f.in.filter(v => v !== ''), blank = f.in.includes('');
        if (blank) qb = qb.or((vs.length ? `${col}.in.(${vs.map(quote).join(',')}),` : '') + `${col}.is.null,${col}.eq.`); else qb = qb.in(col, vs); }
      else if (f.like) qb = qb.ilike(col, '%' + f.like.replace(/[%\\]/g, ' ') + '%');
      else if (k === 'variance') {            // variance = excess - short on every row, so it maps onto those two columns
        if (f.min != null) qb = f.min > 0 ? qb.gte('excess_qty', f.min) : qb.lte('short_qty', -f.min);
        if (f.max != null) qb = f.max >= 0 ? qb.lte('excess_qty', f.max) : qb.gte('short_qty', -f.max);
      } else { if (f.min != null) qb = qb.gte(col, f.min); if (f.max != null) qb = qb.lte(col, f.max); }
    }
    return qb;
  }
  const desc = (k, f) => { const c = byK(k); if (f.in) return `${c.l}: ${f.in.slice(0, 2).map(v => vlabel(c, v)).join(', ')}${f.in.length > 2 ? ' +' + (f.in.length - 2) : ''}`;
    if (f.like) return `${c.l} contains “${f.like}”`; return `${c.l}: ${f.min != null ? f.min : '…'} to ${f.max != null ? f.max : '…'}`; };
  function chips(box) {
    if (!box) return; const keys = Object.keys(F); box.hidden = !keys.length; if (!keys.length) { box.innerHTML = ''; return; }
    box.innerHTML = keys.map(k => `<span class="fchip">${esc(desc(k, F[k]))}<button type="button" data-rm="${k}" aria-label="Remove filter">×</button></span>`).join('') + '<button type="button" class="btn sm" data-rm="*">Clear all filters</button>';
  }
  let popOff = null;
  function close() { const p = document.getElementById('cfpop'); if (p) p.remove(); if (popOff) { popOff(); popOff = null; } }
  function open(k, btn) {
    close(); const c = byK(k), t = type(c), cur = F[k] || {}, vs = t === 'list' ? vals(c) : [], sel = new Set(cur.in || []);
    const pop = document.createElement('div'); pop.className = 'cfpop'; pop.id = 'cfpop'; pop.dataset.col = k;
    pop.innerHTML = `<div class="cft">${esc(c.l)}</div>` + (t === 'list' ? `<input class="cfs" placeholder="Search values…" autocomplete="off"><div class="cfa"><button type="button" data-a="all">Select all</button><button type="button" data-a="none">Clear</button></div>
        <div class="cfl">${vs.map((v, i) => `<label class="chk" data-s="${esc(vlabel(c, v).toLowerCase())}"><input type="checkbox" data-i="${i}" ${sel.has(v) ? 'checked' : ''}> <span>${esc(vlabel(c, v))}</span></label>`).join('') || '<div class="muted">No values</div>'}</div>`
      : t === 'text' ? `<input class="cfi" placeholder="Contains…" autocomplete="off" value="${esc(cur.like || '')}">`
      : `<div class="cfn"><div><label>From</label><input type="number" step="any" class="cfmin" value="${cur.min ?? ''}"></div><div><label>To</label><input type="number" step="any" class="cfmax" value="${cur.max ?? ''}"></div></div>${k === 'variance' ? '<p class="muted" style="margin:6px 0 0;font-size:12px">Use negative numbers for shortage (e.g. To = -1 shows shorts).</p>' : ''}`)
      + '<div class="cfb"><button type="button" class="btn sm" data-a="reset">Reset</button><button type="button" class="btn sm yel" data-a="apply">Apply</button></div>';
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect(); pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 290)) + 'px'; pop.style.top = Math.min(r.bottom + 6, window.innerHeight - 120) + 'px';
    const done = go => { if (go) {
        if (t === 'list') { const picked = [...pop.querySelectorAll('input[data-i]:checked')].map(x => vs[+x.dataset.i]); if (picked.length && picked.length < vs.length) F[k] = { in: picked }; else delete F[k]; }
        else if (t === 'text') { const v = pop.querySelector('.cfi').value.trim(); if (v) F[k] = { like: v }; else delete F[k]; }
        else { const a = pop.querySelector('.cfmin').value, b = pop.querySelector('.cfmax').value; if (a === '' && b === '') delete F[k]; else F[k] = { min: a === '' ? null : Number(a), max: b === '' ? null : Number(b) }; }
      } else delete F[k]; close(); onChange(); };
    pop.onclick = e => { const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'apply') return done(true); if (a.dataset.a === 'reset') return done(false);
      pop.querySelectorAll('input[data-i]').forEach(x => { if (!x.closest('label').hidden) x.checked = a.dataset.a === 'all'; }); };
    const s = pop.querySelector('.cfs'); if (s) s.oninput = () => { const q = s.value.trim().toLowerCase(); pop.querySelectorAll('.cfl label').forEach(l => (l.hidden = !!q && !l.dataset.s.includes(q))); };
    pop.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') done(true); });
    const out = e => { if (!pop.contains(e.target) && !e.target.closest('[data-cf]')) close(); }, key = e => { if (e.key === 'Escape') close(); };
    setTimeout(() => document.addEventListener('mousedown', out), 0); document.addEventListener('keydown', key); popOff = () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', key); };
    (pop.querySelector('.cfs') || pop.querySelector('.cfi') || pop.querySelector('.cfmin') || pop).focus();
  }
  window.addEventListener('hashchange', close);
  // delegated click handler: returns true when the click was a filter button / chip
  function handle(e) {
    const cf = e.target.closest('[data-cf]');
    if (cf) { const o = document.getElementById('cfpop'); if (o && o.dataset.col === cf.dataset.cf) close(); else open(cf.dataset.cf, cf); return true; }
    const rm = e.target.closest('[data-rm]');
    if (rm) { if (rm.dataset.rm === '*') Object.keys(F).forEach(k => delete F[k]); else delete F[rm.dataset.rm]; onChange(); return true; }
    return false;
  }
  return { F, th, apply, chips, handle, close };
}
