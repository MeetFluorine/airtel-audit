// Phase 3: store dashboard, scanner (serialized + non-serialized), preview. Submit/lock arrives in Phase 4.
// Every write goes through server functions that derive the store from the login; no expected quantity is ever sent to this page.
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
const fn = n => Number(n || 0).toLocaleString('en-IN');
const isNet = e => !!e && (!navigator.onLine || /fetch|network|load failed|timeout/i.test(e.message || ''));
const hhmm = () => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
function beep(ok) { try { const A = window.AudioContext || window.webkitAudioContext; if (!A) return; const c = beep.c || (beep.c = new A()), o = c.createOscillator(), g = c.createGain();
  o.frequency.value = ok ? 880 : 220; g.gain.value = .07; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + (ok ? .08 : .25)); } catch (e) {} }

/* ---- send queue: every action is saved locally first, then sent in order; retried when the connection returns ---- */
const Q = {
  sid: null, items: [], ui: null, busy: false, timer: null, cancelAsk: null,
  key() { return 'sfx_q_' + this.sid; },
  init(sid) {
    if (this.sid !== sid) { this.sid = sid; try { this.items = JSON.parse(localStorage.getItem(this.key()) || '[]'); } catch (e) { this.items = []; } }
    if (!this.timer) { this.timer = setInterval(() => this.items.length && this.pump(), 5000); window.addEventListener('online', () => this.pump()); }
  },
  save() { try { localStorage.setItem(this.key(), JSON.stringify(this.items)); } catch (e) {} },
  push(it, front) { front ? this.items.unshift(it) : this.items.push(it); this.save(); if (this.ui) this.ui.status(); this.pump(); },
  leave() { this.ui = null; if (this.cancelAsk) this.cancelAsk(); },
  async pump() {
    if (this.busy || !this.ui) return; this.busy = true;
    try {
      while (this.items.length && this.ui) {
        const it = this.items[0], { data, error } = await sb.rpc(it.rpc, it.args);
        if (error && isNet(error)) { if (this.ui) this.ui.online(false); break; }
        if (this.ui) this.ui.online(true);
        this.items.shift(); this.save();
        if (this.ui) await this.ui.done(it, data, error);
      }
    } finally { this.busy = false; if (this.ui) this.ui.status(); }
  }
};
window.addEventListener('hashchange', () => { if (!/^#\/audit(\?(?!.*view=preview)|$)/.test(location.hash)) Q.leave(); });

const kpis = m => `<div class="kv kpi"><div class="g"><span>Match rate</span><b>${m.match_rate == null ? '—' : Number(m.match_rate).toFixed(1) + '%'}</b></div><div><span>Total expected</span><b>${fn(m.expected)}</b></div><div><span>Total found</span><b>${fn(m.physical)}</b></div>
  <div class="${Number(m.short) ? 'r' : ''}"><span>Short</span><b>${fn(m.short)}</b></div><div class="${Number(m.excess) ? 'a' : ''}"><span>Excess</span><b>${fn(m.excess)}</b></div></div>`;

/* ---- dashboard ---- */
PAGES.dashboard = async el => {
  const p = S.profile;
  if (p.role !== 'STORE_USER') { el.innerHTML = `<div class="card"><h2>Welcome, ${esc(p.full_name)}</h2><p class="muted">You are signed in as ${ROLE_LABEL[p.role]}.</p><p class="muted">Admin dashboards arrive in Phase 5.</p></div>`; return; }
  const { data: c, error } = await sb.rpc('my_audit_context'); if (error) throw error;
  const s = c.session, cn = c.counts || {};
  const label = !c.cycle ? 'NO AUDIT OPEN' : !s ? 'NOT STARTED' : s.status === 'IN_PROGRESS' ? 'IN PROGRESS' : 'COMPLETED · LOCKED';
  const cls = !c.cycle ? '' : !s ? 'warn' : s.status === 'IN_PROGRESS' ? 'info' : 'ok';
  let sum = null;
  if (s && s.status === 'LOCKED') { const r = await sb.rpc('result_summary', { p_session: s.id }); sum = r.data; }
  el.innerHTML = `<div class="bar"><div><h2 style="margin:0">Welcome back, ${esc(p.full_name)}</h2><span class="muted">Your store audit status</span></div>${badge(label, cls)}</div>
    <div class="kv"><div><span>Store</span><b>${esc(c.store.name)}</b></div><div><span>Store code</span><b>${esc(c.store.code)}</b></div><div><span>Circle</span><b>${esc(c.store.circle)}</b></div><div><span>Audit cycle</span><b>${c.cycle ? esc(c.cycle.name) : '—'}</b></div></div>
    ${sum ? kpis(sum) : ''}
    ${s && s.status === 'IN_PROGRESS' ? `<div class="kv"><div><span>Serialized scanned</span><b>${fn(cn.serial)}</b></div><div><span>Non-serialized entries</span><b>${fn(cn.entries)}</b></div><div><span>Total physical units</span><b>${fn(cn.units)}</b></div></div>` : ''}
    <div class="card cta">${!c.cycle ? '<h2>No audit is open for your store yet</h2><p class="muted">Your administrator needs to open a cycle and upload your store\'s base stock.</p>'
      : s && s.status === 'LOCKED' ? '<h2>Your audit has been submitted</h2><p class="muted">It is locked and can only be reopened by an administrator.</p><a class="btn primary" href="#/result">View detailed result</a>'
      : `<h2>Ready to ${s ? 'continue' : 'start'} your store audit?</h2><p class="muted">Scan your serialized items and enter non-serialized quantities.</p><a class="btn primary" href="#/audit">${s ? 'Continue audit' : 'Start audit'}</a>`}</div>`;
};

/* ---- audit entry point ---- */
PAGES.audit = async el => {
  Q.leave();
  if (S.profile.role !== 'STORE_USER') { el.innerHTML = '<div class="card"><h2>Store users only</h2><p class="muted">Audits are performed by the store team.</p></div>'; return; }
  let { data: c, error } = await sb.rpc('my_audit_context'); if (error) throw error;
  if (!c.cycle) { el.innerHTML = '<div class="card"><h2>No audit is open for your store yet</h2><p class="muted">Your administrator needs to upload your store\'s base stock first.</p></div>'; return; }
  if (!c.session) {
    el.innerHTML = `<div class="card cta"><h2>Start the ${esc(c.cycle.name)} audit for ${esc(c.store.name)}?</h2><p class="muted">You will scan serial numbers and count non-serialized items. Quantities are not shown while you count.</p><button class="btn primary" id="go">Start audit</button></div>`;
    el.querySelector('#go').onclick = e => busy(e.target, async () => { const r = await sb.rpc('start_audit'); if (r.error) throw r.error; return PAGES.audit(el); }).catch(x => toast(rpcMsg(x), 'err')); return;
  }
  if (c.session.status !== 'IN_PROGRESS') { el.innerHTML = '<div class="card"><h2>Audit submitted</h2><p class="muted">This audit is locked and can no longer be changed.</p></div>'; return; }
  return /view=preview/.test(location.hash) ? preview(el, c) : scanner(el, c);
};

/* ---- scanner ---- */
function scanner(el, c) {
  const sid = c.session.id; Q.init(sid);
  const st = { counts: c.counts || { serial: 0, entries: 0, units: 0 }, recent: [], net: navigator.onLine, pick: null, opts: [] };
  el.innerHTML = `${c.session.reopen_reason ? `<div class="alert warn"><b>Your audit was reopened by an administrator</b> (${fdt(c.session.reopened_at)}): ${esc(c.session.reopen_reason)}. Your earlier counts are kept; add what was missed and submit again.</div>` : ''}<div class="aud"><div class="aud-main">
    <div class="tabs big"><button class="tab on" data-t="ser">Serialized Scan</button><button class="tab" data-t="non">Non-Serialized Entry</button></div>
    <div id="p-ser" class="card"><label for="scan">Scan serial number</label><input id="scan" class="scan-in" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Scan or type serial number, then Enter">
      <div id="res" class="resp idle">Ready to scan</div>
      <div id="unl" class="resp err" hidden><div class="rt">Serial not found in your store base stock</div><div class="muted" id="unl-s"></div>
        <label for="uc">Please enter Item Code</label><input id="uc" autocomplete="off" placeholder="Item Code"><div class="ma"><button class="btn" id="unl-skip">Skip</button><button class="btn primary" id="unl-add">Add as Physical Stock</button></div></div></div>
    <div id="p-non" class="card" hidden><label for="ic">Item Code</label><input id="ic" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Start typing the item code, then pick from the list">
      <div id="opts"></div><label for="qty">Physical quantity</label><div class="qty"><button class="btn" id="qm">−</button><input id="qty" type="number" min="0" step="any" value="1" inputmode="decimal"><button class="btn" id="qp">+</button></div>
      <button class="btn primary" id="addn" disabled>Add to audit</button><div id="nres" class="resp idle">Counts are blind: the system quantity is never shown.</div></div></div>
    <aside class="aud-side"><div class="card"><div class="bar"><b>Audit progress</b><span id="net"></span></div>
      <div class="kv"><div><span>Serialized</span><b id="c-ser">0</b></div><div><span>Non-serialized</span><b id="c-ent">0</b></div><div><span>Total units</span><b id="c-units">0</b></div></div>
      <div class="sync" id="sync"></div><a class="btn primary" href="#/audit?view=preview">Preview &amp; complete audit</a></div>
      <div class="card"><b>Recent scans</b><div id="recent" class="recent muted">Nothing yet</div></div></aside></div>`;
  const $ = id => el.querySelector('#' + id), scan = $('scan');
  const showRes = (id, kind, title, body) => { const r = $(id); r.className = 'resp ' + kind; r.innerHTML = `<div class="rt">${title}</div>${body || ''}`; };
  const rg = rows => '<div class="rg">' + rows.filter(r => r[1]).map(r => `<span>${r[0]}</span><b>${esc(r[1])}</b>`).join('') + '</div>';
  function paint() {
    $('c-ser').textContent = fn(st.counts.serial); $('c-ent').textContent = fn(st.counts.entries); $('c-units').textContent = fn(st.counts.units);
    const pend = Q.items.length, synced = Number(st.counts.serial) + Number(st.counts.entries);
    $('sync').innerHTML = `Scanned: <b>${fn(synced + pend)}</b> · Synced: <b>${fn(synced)}</b> · Pending: <b>${fn(pend)}</b>`;
    $('net').innerHTML = !st.net ? badge('Offline', 'bad') : pend ? badge('Syncing', 'warn') : badge('Synced', 'ok');
    $('recent').innerHTML = st.recent.length ? st.recent.map(r => `<div class="rc"><span>${r.t}</span><span>${esc(r.code || '')}</span><span>${esc(r.sn || '')}</span>${badge(r.s, r.k)}</div>`).join('') : 'Nothing yet';
  }
  const recent = (code, sn, s, k) => { st.recent.unshift({ t: hhmm().slice(0, 5), code, sn, s, k }); st.recent = st.recent.slice(0, 8); };
  const focusScan = () => { if ($('unl').hidden && !$('p-ser').hidden) scan.focus(); };
  function askCode(serial) {
    return new Promise(resolve => {
      $('unl-s').textContent = 'Serial: ' + serial; $('uc').value = ''; $('unl').hidden = false; scan.disabled = true; $('uc').focus();
      const fin = v => { $('unl').hidden = true; scan.disabled = false; Q.cancelAsk = null; resolve(v); focusScan(); };
      Q.cancelAsk = () => fin(null);
      const add = () => { const v = $('uc').value.trim(); if (!v) return toast('Please enter the Item Code for this physical serial.', 'err'); fin(v); };
      $('unl-add').onclick = add; $('unl-skip').onclick = () => fin(null); $('uc').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
    });
  }
  Q.ui = {
    status: paint, online: b => { if (st.net !== b) { st.net = b; paint(); if (!b) toast('Network connection interrupted. Your scan has been queued.', 'err'); } },
    async done(it, d, err) {
      if (err) { showRes(it.kind === 'non' ? 'nres' : 'res', 'err', 'Could not save', esc(rpcMsg(err))); recent(it.label, '', 'Error', 'bad'); beep(false); paint(); return focusScan(); }
      if (d.counts) st.counts = d.counts;
      const s = d.status;
      if (s === 'MATCHED') { showRes('res', 'ok', '✓ MATCHED', rg([['Item Code', d.item_code], ['Description', d.item_description], ['Inventory Status', d.inventory_status], ['UoM', d.item_uom], ['Quality', d.item_quality], ['Serial', d.serial]])); recent(d.item_code, d.serial, 'Matched', 'ok'); beep(true); }
      else if (s === 'DUPLICATE') { showRes('res', 'warn', '⚠ Already Scanned', `<div class="rg"><span>Serial</span><b>${esc(d.serial)}</b></div><div class="muted">Previously scanned in this audit.</div>`); recent('', d.serial, 'Duplicate', 'warn'); beep(false); }
      else if (s === 'UNLISTED_ADDED') { showRes('res', 'err', 'Added as physical stock', rg([['Item Code', d.item_code], ['Serial', d.serial]]) + '<div class="muted">Not in your store base stock.</div>'); recent(d.item_code, d.serial, 'Unlisted', 'bad'); beep(false); }
      else if (s === 'NOT_FOUND') {
        showRes('res', 'err', 'Serial not found in your store base stock', rg([['Serial', d.serial]])); beep(false); paint();
        const code = await askCode(d.serial);
        if (code) Q.push({ kind: 'scan', rpc: 'add_unlisted_serial', args: { p_session: sid, p_serial: d.serial, p_item_code: code, p_event: uid() }, label: d.serial }, true); else recent('', d.serial, 'Skipped', '');
      }
      else if (s === 'ADDED') { showRes('nres', d.in_base ? 'ok' : 'warn', '✓ Added to audit', rg([['Item Code', d.item_code], ['Added', fn(d.added)], ['Your count for this line', fn(d.entry_total)]]) + (d.in_base ? '' : '<div class="muted">Not in your store base stock: it will be recorded as excess.</div>')); recent(d.item_code, '+' + fn(d.added), 'Added', 'ok'); beep(true); }
      paint(); focusScan();
    }
  };
  // serialized
  scan.onkeydown = e => { if (e.key !== 'Enter') return; e.preventDefault(); const v = scan.value.trim(); scan.value = ''; if (!v) return; Q.push({ kind: 'scan', rpc: 'scan_serial', args: { p_session: sid, p_serial: v, p_event: uid() }, label: v }); scan.focus(); };
  // tabs
  el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { el.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b)); $('p-ser').hidden = b.dataset.t !== 'ser'; $('p-non').hidden = b.dataset.t !== 'non'; (b.dataset.t === 'ser' ? scan : $('ic')).focus(); });
  // non-serialized
  const hl = (txt, v) => { const i = String(txt).toUpperCase().indexOf(v); return i < 0 || !v ? esc(txt) : esc(txt.slice(0, i)) + '<mark>' + esc(txt.slice(i, i + v.length)) + '</mark>' + esc(txt.slice(i + v.length)); };
  const optLabel = (o, v) => `<b>${hl(o.item_code, v)}</b> ${esc([o.inventory_status, o.item_quality].filter(Boolean).join(' · '))}<br><span class="muted">${esc(o.item_description || '')} ${o.item_uom ? '(' + esc(o.item_uom) + ')' : ''}</span>`;
  let seq = 0, tmr = null;
  const choose = o => { st.pick = o; $('addn').disabled = false; $('opts').querySelectorAll('.opt').forEach(l => l.classList.toggle('sel', st.opts[+l.dataset.i] === o)); };
  async function look() {
    const code = $('ic').value.trim(), v = code.toUpperCase(), my = ++seq; st.pick = null; st.opts = []; $('addn').disabled = true;
    if (code.length < 2) { $('opts').innerHTML = code ? '<div class="muted">Keep typing…</div>' : ''; return; }
    const { data, error } = await sb.rpc('lookup_item', { p_session: sid, p_code: code });
    if (my !== seq) return;                                   // a newer keystroke already replaced this search
    if (error) { $('opts').innerHTML = `<div class="alert err">${esc(isNet(error) ? 'Network connection interrupted. Try again when you are back online.' : rpcMsg(error))}</div>`; return; }
    if (data.serialized_only) { $('opts').innerHTML = '<div class="alert warn">This item is serialized. Please scan its serial numbers on the Serialized Scan tab.</div>'; return; }
    if (!data.options.length) {
      st.opts = [{ item_code: v, inventory_status: '', item_quality: '' }];
      $('opts').innerHTML = `<div class="alert warn">No match in your store base stock. If you count it, it will be recorded as excess.</div><label class="opt" data-i="0"><input type="radio" name="o"> <b>${esc(v)}</b> <span class="muted">(not in base stock)</span></label>`;
    } else {
      st.opts = data.options;
      $('opts').innerHTML = `<div class="muted">${data.options.length} matching item${data.options.length === 1 ? '' : 's'} - tap one:</div>` + data.options.map((o, i) => `<label class="opt" data-i="${i}"><input type="radio" name="o"> ${optLabel(o, v)}</label>`).join('');
    }
    $('opts').querySelectorAll('.opt').forEach(l => l.onclick = () => { choose(st.opts[+l.dataset.i]); $('qty').focus(); $('qty').select(); });
    if (st.opts.length === 1 && data.options.length) choose(st.opts[0]);
  }
  $('ic').oninput = () => { clearTimeout(tmr); tmr = setTimeout(look, 200); };
  $('ic').onkeydown = e => { if (e.key !== 'Enter') return; e.preventDefault(); clearTimeout(tmr); if (st.pick) { $('qty').focus(); $('qty').select(); } else look(); };
  $('qm').onclick = () => { $('qty').value = Math.max(0, Number($('qty').value || 0) - 1); }; $('qp').onclick = () => { $('qty').value = Number($('qty').value || 0) + 1; };
  $('addn').onclick = () => {
    const q = Number($('qty').value); if (!st.pick) return; if (!(q > 0)) return toast('Please enter a quantity greater than zero.', 'err');
    Q.push({ kind: 'non', rpc: 'add_non_serial', args: { p_session: sid, p_code: st.pick.item_code, p_status: st.pick.inventory_status || '', p_quality: st.pick.item_quality || '', p_qty: q, p_event: uid() }, label: st.pick.item_code });
    $('ic').value = ''; $('opts').innerHTML = ''; $('qty').value = 1; st.pick = null; $('addn').disabled = true; $('ic').focus();
  };
  paint(); scan.focus(); Q.pump();
}

/* ---- preview ---- */
function preview(el, c) {
  const sid = c.session.id, PS = 50; let type = 'ALL', q = '', page = 0, timer = null, last = null;
  sb.rpc('log_preview', { p_session: sid }).then(() => {}, () => {});
  async function load() {
    const { data, error } = await sb.rpc('session_preview', { p_session: sid, p_type: type, p_search: q || null, p_offset: page * PS, p_limit: PS });
    if (error) { el.innerHTML = `<div class="alert err">${esc(rpcMsg(error))}</div>`; return; }
    last = data; draw();
  }
  function draw() {
    const d = last, cn = d.counts, pend = Q.items.length;
    const rows = d.rows.map((r, i) => `<tr><td>${page * PS + i + 1}</td><td><b>${esc(r.item_code)}</b></td><td>${esc(r.inventory_status || '')}</td><td>${esc(r.item_description || '')}</td><td>${esc(r.item_uom || '')}</td><td>${fn(r.qty)}</td><td>${esc(r.item_quality || '')}</td>
      <td>${esc(r.item_sno || '—')}${r.is_unlisted ? ' ' + badge('Unlisted', 'bad') : ''}</td><td>${r.kind === 'serial' ? 'Serialized' : 'Non-Serialized'}</td>
      <td class="nw">${r.kind === 'nonserial' ? `<button class="btn sm" data-a="edit" data-id="${r.id}" data-q="${r.qty}">Edit</button> ` : ''}<button class="btn sm danger-o" data-a="rm" data-k="${r.kind}" data-id="${r.id}" data-n="${esc(r.item_sno || r.item_code)}">Remove</button></td></tr>`).join('');
    el.innerHTML = `<div class="bar"><div><h2 style="margin:0">Preview</h2><span class="muted">Everything you have scanned or entered. Quantities shown are your own counts.</span></div>
      <div class="row"><a class="btn" href="#/audit">← Back to audit</a><button class="btn primary" id="done" style="width:auto;margin:0" ${pend ? 'disabled' : ''}>Complete audit</button></div></div>
      ${pend ? `<div class="alert warn">${pend} entr${pend === 1 ? 'y is' : 'ies are'} still waiting to sync. Go back to the audit screen so they can sync before you complete.</div>` : ''}
      <div class="bar"><div class="tabs">${[['ALL', 'All items', cn.serial + cn.entries], ['SERIAL', 'Serialized', cn.serial], ['NONSERIAL', 'Non-Serialized', cn.entries]].map(t => `<button class="tab ${type === t[0] ? 'on' : ''}" data-ty="${t[0]}">${t[1]} (${fn(t[2])})</button>`).join('')}</div>
        <input id="q" class="srch" placeholder="Search item code, description or serial…" value="${esc(q)}"></div>
      ${tbl(['#', 'Item_Code', 'Inventory_Status', 'Item_Description', 'UoM', 'Qty', 'Quality', 'Serial', 'Type', ''], rows)}
      <div class="bar"><span class="muted">${fn(d.total)} row(s)</span><div class="row"><button class="btn sm" data-pg="-1" ${page ? '' : 'disabled'}>Previous</button><button class="btn sm" data-pg="1" ${(page + 1) * PS < d.total ? '' : 'disabled'}>Next</button></div></div>`;
    el.querySelector('#q').oninput = e => { clearTimeout(timer); const v = e.target.value.trim(); timer = setTimeout(() => { q = v; page = 0; load(); }, 300); };
    el.querySelector('#done').onclick = complete;
  }
  function complete() {
    const cn = last.counts;
    const o = openModal('Complete & Lock Audit?', `<p>After submission, this audit cannot be modified by the store user. Only an authorized administrator can reopen it.</p>
      <div class="kv"><div><span>Serialized scans</span><b>${fn(cn.serial)}</b></div><div><span>Non-serialized entries</span><b>${fn(cn.entries)}</b></div><div><span>Total physical units</span><b>${fn(cn.units)}</b></div></div>
      <label class="chk"><input type="checkbox" id="m_ok"> I confirm the physical stock count is complete.</label>`,
      [cancelBtn, { label: 'SUBMIT & LOCK AUDIT', cls: 'primary', fn: async () => {
        if (Q.items.length) { toast('Some entries are still syncing. Please wait and try again.', 'err'); return false; }
        const { error } = await sb.rpc('submit_audit', { p_session: sid }); if (error) throw error;
        try { localStorage.removeItem('sfx_q_' + sid); } catch (e) {} Q.items = [];
        toast('Audit submitted and locked.', 'ok'); location.hash = '#/result'; } }]);
    const go = o.querySelector('.ma .primary'); go.disabled = true; o.querySelector('#m_ok').onchange = e => (go.disabled = !e.target.checked);
  }
  el.onclick = async e => {
    const t = e.target.closest('[data-ty]'); if (t) { type = t.dataset.ty; page = 0; return load(); }
    const pg = e.target.closest('[data-pg]'); if (pg) { page += Number(pg.dataset.pg); return load(); }
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'rm') openModal('Remove this entry?', `<p>Remove <b>${esc(b.dataset.n)}</b> from your audit? This is recorded in the audit log.</p>`, [cancelBtn,
      { label: 'Remove', cls: 'danger', fn: async () => { const { error } = await sb.rpc('remove_entry', { p_kind: b.dataset.k, p_id: b.dataset.id }); if (error) throw error; toast('Entry removed.', 'ok'); load(); } }]);
    if (b.dataset.a === 'edit') openModal('Edit quantity', `<label>Physical quantity</label><input id="m_q" type="number" min="0" step="any" value="${esc(b.dataset.q)}">`, [cancelBtn,
      { label: 'Save', cls: 'primary', fn: async () => { const v = Number(document.getElementById('m_q').value); if (!(v > 0)) { toast('Please enter a quantity greater than zero.', 'err'); return false; }
        const { error } = await sb.rpc('edit_non_serial', { p_id: b.dataset.id, p_qty: v }); if (error) throw error; toast('Quantity updated.', 'ok'); load(); } }]);
  };
  load();
}

/* ---- result (store user: own result only; admin / circle head: opened from Audit Cycles). No export, by design. ---- */
PAGES.result = async el => {
  const p = S.profile, hq = new URLSearchParams(location.hash.split('?')[1] || ''); let sid = hq.get('sess');
  if (p.role === 'STORE_USER') {
    const { data: c, error } = await sb.rpc('my_audit_context'); if (error) throw error;
    if (!c.session || c.session.status !== 'LOCKED') {
      el.innerHTML = `<div class="card"><h2>${c.session ? 'Your audit is in progress' : 'No result yet'}</h2><p class="muted">Your result appears here after you submit your audit.${c.session && c.session.reopen_reason ? ' An administrator reopened it: ' + esc(c.session.reopen_reason) : ''}</p>${c.session ? '<a class="btn primary" href="#/audit">Continue audit</a>' : ''}</div>`; return; }
    sid = c.session.id;
  }
  if (!sid) { el.innerHTML = '<div class="card"><h2>No audit selected</h2><p class="muted">Open a result from Audit Cycles.</p></div>'; return; }
  return resultView(el, sid, false);
};

async function resultView(el, sid, embedded) {
  const p = S.profile;
  const [si, sm] = await Promise.all([sb.from('audit_sessions').select('id,version,status,submitted_at,stores(code,name),audit_cycles(name)').eq('id', sid).maybeSingle(), sb.rpc('result_summary', { p_session: sid })]);
  if (si.error || !si.data) throw si.error || new Error('Result not found');
  if (sm.error) throw sm.error;
  const ss = si.data, m = sm.data; let tab = 'ALL', q = '', page = 0, timer = null; const PS = 50;
  el.innerHTML = `<div class="bar"><div><h2 style="margin:0">Audit Result · ${esc(ss.audit_cycles?.name || '')}</h2><span class="muted">${esc(ss.stores?.name || '')} (${esc(ss.stores?.code || '')}) · Version ${ss.version} · Submitted ${fdt(ss.submitted_at)} · 🔒 Audit locked</span></div>
      <div class="row">${p.role !== 'STORE_USER' ? '<a class="btn sm" href="#/cycles">← Audit cycles</a>' : ''}${badge(ss.status === 'LOCKED' ? 'COMPLETED' : 'SUPERSEDED VERSION', ss.status === 'LOCKED' ? 'ok' : 'warn')}</div></div>
    ${kpis(m)}<div class="bar"><div class="tabs">${[['ALL', 'All', m.rows_all], ['MATCH', 'Matched', m.rows_match], ['SHORT', 'Short', m.rows_short], ['EXCESS', 'Excess', m.rows_excess]].map(t => `<button class="tab" data-ty="${t[0]}">${t[1]} (${fn(t[2])})</button>`).join('')}</div>
      <input id="q" class="srch" placeholder="Search item code, description or serial…"></div><div id="rt"></div>`;
  if (embedded) el.querySelector('.bar').remove();
  const mark = () => el.querySelectorAll('[data-ty]').forEach(b => b.classList.toggle('on', b.dataset.ty === tab));
  async function load() {
    mark(); const rt = el.querySelector('#rt'); rt.innerHTML = '<div class="boot">Loading…</div>';
    let qb = sb.from('reconciliation_results').select('item_code,inventory_status,item_description,item_uom,expected_qty,physical_qty,item_quality,item_sno,result,is_unlisted', { count: 'exact' }).eq('session_id', sid);
    if (tab !== 'ALL') qb = qb.eq('result', tab);
    const t = q.replace(/[,()%*\\]/g, ' ').trim(); if (t) qb = qb.or(`item_code.ilike.*${t}*,item_sno.ilike.*${t}*,item_description.ilike.*${t}*`);
    const { data, error, count } = await qb.order('item_code').order('item_sno').range(page * PS, page * PS + PS - 1);
    if (error) { rt.innerHTML = `<div class="alert err">${esc(friendlyError(error))}</div>`; return; }
    rt.innerHTML = tbl(['#', 'Item_Code', 'Inventory_Status', 'Item_Description', 'UoM', 'Expected Qty', 'Physical Qty', 'Variance', 'Item_Quality', 'Item_SNo', 'Result'], data.map((r, i) => { const v = Number(r.physical_qty) - Number(r.expected_qty);
      return `<tr><td>${page * PS + i + 1}</td><td><b>${esc(r.item_code)}</b></td><td>${esc(r.inventory_status || '')}</td><td>${esc(r.item_description || '')}</td><td>${esc(r.item_uom || '')}</td><td>${fn(r.expected_qty)}</td><td>${fn(r.physical_qty)}</td>
        <td class="${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}">${v > 0 ? '+' : ''}${fn(v)}</td><td>${esc(r.item_quality || '')}</td><td>${esc(r.item_sno || '—')}</td><td>${badge(r.result === 'MATCH' ? 'Matched' : r.result === 'SHORT' ? 'Short' : 'Excess', r.result === 'MATCH' ? 'ok' : r.result === 'SHORT' ? 'bad' : 'warn')}${r.is_unlisted ? ' ' + badge('Unlisted', 'bad') : ''}</td></tr>`; }).join('')) +
      `<div class="bar"><span class="muted">${fn(count)} row(s)</span><div class="row"><button class="btn sm" data-pg="-1" ${page ? '' : 'disabled'}>Previous</button><button class="btn sm" data-pg="1" ${(page + 1) * PS < count ? '' : 'disabled'}>Next</button></div></div>`;
  }
  el.onclick = e => { const t = e.target.closest('[data-ty]'); if (t) { tab = t.dataset.ty; page = 0; return load(); } const g = e.target.closest('[data-pg]'); if (g) { page += Number(g.dataset.pg); load(); } };
  el.querySelector('#q').oninput = e => { clearTimeout(timer); const v = e.target.value; timer = setTimeout(() => { q = v; page = 0; load(); }, 300); };
  await load();
}
