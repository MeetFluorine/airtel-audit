// Store user screens: dashboard, start audit, scanner (serialized + non-serialized), preview, complete & lock, result.
// Every write goes through server functions that derive the store from the login; no expected quantity reaches this page before submission.
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
const fn = n => Number(n || 0).toLocaleString('en-IN');
const isNet = e => !!e && (!navigator.onLine || /fetch|network|load failed|timeout/i.test(e.message || ''));
const hhmm = () => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
function beep(ok) { try { const A = window.AudioContext || window.webkitAudioContext; if (!A) return; const c = beep.c || (beep.c = new A()), o = c.createOscillator(), g = c.createGain();
  o.frequency.value = ok ? 880 : 220; g.gain.value = .07; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + (ok ? .08 : .25)); } catch (e) {} }
const livePill = () => `<span class="live ${navigator.onLine ? '' : 'off'}" id="live"><i></i><span>${navigator.onLine ? 'Live' : 'Offline'}</span></span>`;
const setLive = b => { const l = document.getElementById('live'); if (l) { l.classList.toggle('off', !b); l.lastChild.textContent = b ? 'Live' : 'Offline'; } };
window.addEventListener('online', () => setLive(true)); window.addEventListener('offline', () => setLive(false));

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
const tile = (i, bg, fg) => `<span class="tile" style="background:${bg};color:${fg}">${ic(i, 22)}</span>`;

/* ---- dashboard (store user) ---- */
async function storeDash(el) {
  const p = S.profile; const { data: c, error } = await sb.rpc('my_audit_context'); if (error) throw error;
  const s = c.session, cn = c.counts || {}, first = (p.full_name || '').split(' ')[0];
  let sum = null; if (s && s.status === 'LOCKED') { const r = await sb.rpc('result_summary', { p_session: s.id }); sum = r.data; }
  const cta = !c.cycle ? '<div class="alert warn" style="margin:0">No audit is open for your store yet. Set up your store\'s base data from <a href="#/basedata">Base Data</a> (or ask your administrator).</div>'
    : s && s.status === 'LOCKED' ? `<a class="btn yel xl" href="#/result">${ic('clip', 20)} View Result ${ic('arrow', 20)}</a>`
    : `<a class="btn yel xl" href="#/audit">${ic('play', 20)} ${s ? 'Continue Audit' : 'Start Audit'} ${ic('arrow', 20)}</a>`;
  // 3-day deadline banner (escalation: info -> warn -> overdue)
  let dlBanner = '';
  if (c.cycle && c.cycle.deadline_at && !(s && s.status === 'LOCKED')) {
    const days = Math.ceil((new Date(c.cycle.deadline_at) - Date.now()) / 864e5);
    const dstr = new Date(c.cycle.deadline_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    dlBanner = days < 0 ? `<div class="alert err" style="margin:0 0 12px"><b>Overdue by ${-days} day${-days === 1 ? '' : 's'}.</b> The deadline was ${dstr}. Please submit your audit immediately.</div>`
      : days <= 1 ? `<div class="alert warn" style="margin:0 0 12px"><b>${days === 0 ? 'Due today' : 'Due tomorrow'} (${dstr}).</b> Please complete and submit your audit.</div>`
      : `<div class="alert info" style="margin:0 0 12px">Audit deadline: <b>${dstr}</b> (${days} days left).</div>`;
  }
  el.innerHTML = `${dlBanner}<div class="hero2"><div><h1>${greet()}, ${esc(first)}! 👋</h1><p class="hp">Let's complete the physical stock audit<br>for your store.</p></div>
    <div class="card hero-card"><div class="trio"><div><span class="tile">${ic('store', 24)}</span><div><small>Store</small><b>${esc(c.store.code)}</b></div></div><div><div><small>Circle</small><b>${esc(c.store.circle)}</b></div></div><div><div><small>Audit Cycle</small><b>${c.cycle ? esc(c.cycle.name) : '—'}</b></div></div></div>${cta}</div></div>
    <div class="kcenter">${sum ? kpis(sum) : ''}${s && s.status === 'IN_PROGRESS' ? `<div class="kv kpi"><div><span>Serialized scanned</span><b>${fn(cn.serial)}</b></div><div><span>Non-serialized entries</span><b>${fn(cn.entries)}</b></div><div><span>Total physical units</span><b>${fn(cn.units)}</b></div></div>` : ''}</div>`;
}

/* ---- audit entry point ---- */
PAGES.audit = async el => {
  Q.leave();
  if (isStaff()) { el.innerHTML = '<div class="card" style="padding:24px"><h2>Store users only</h2><p class="muted">Audits are performed by the store team.</p></div>'; return; }
  const { data: c, error } = await sb.rpc('my_audit_context'); if (error) throw error;
  if (!c.cycle) { el.innerHTML = '<div class="card startcard"><h2>No audit is open for your store yet</h2><p class="muted">Your store\'s base data has to be set up first. <a href="#/basedata">Open Base Data</a> to upload it, or ask your administrator.</p></div>'; return; }
  if (!c.session) {
    el.innerHTML = `<div class="pagehead"><div><h1>Start Audit</h1></div></div><div class="card startcard sastart"><span class="sa-ic">${ic('filesearch', 44, 1.5)}</span>
      <h2>You are about to start<br>the physical stock audit<br>for <b>${esc(c.store.code)}</b>.</h2>
      <p class="muted">Please ensure you have the physical stock available before starting.</p>
      <div class="sa-checks"><div>${ic('check', 18)} Base stock is available</div><div>${ic('check', 18)} All material kept ready</div><div>${ic('check', 18)} Verify store details</div></div>
      <button class="btn yel xl" id="go" style="width:100%">Start Audit ${ic('arrow', 18)}</button><div><a class="sa-cancel" href="#/dashboard">Cancel</a></div></div>`;
    el.querySelector('#go').onclick = e => busy(e.currentTarget, async () => { const r = await sb.rpc('start_audit'); if (r.error) throw r.error; return PAGES.audit(el); }).catch(x => toast(rpcMsg(x), 'err')); return;
  }
  if (c.session.status !== 'IN_PROGRESS') { el.innerHTML = '<div class="card startcard"><span class="big">' + ic('lock', 44, 1.5) + '</span><h2>Audit submitted</h2><p class="muted">This audit is locked and can no longer be changed.</p><a class="btn yel" href="#/result">View result</a></div>'; return; }
  return /view=preview/.test(location.hash) ? preview(el, c) : scanner(el, c);
};

/* ---- scanner ---- */
function scanner(el, c) {
  const sid = c.session.id; Q.init(sid);
  const st = { counts: c.counts || { serial: 0, entries: 0, units: 0 }, recent: [], net: navigator.onLine, pick: null, opts: [], ck: null };
  el.innerHTML = `${c.session.reopen_reason ? `<div class="alert warn"><b>Your audit was reopened by an administrator</b> (${fdt(c.session.reopened_at)}): ${esc(c.session.reopen_reason)}. Your earlier counts are kept; add what was missed and submit again.</div>` : ''}
    <div class="scanhead"><div class="tabs seg"><button class="tab on" data-t="ser">Serialized Scan</button><button class="tab" data-t="non">Non-Serialized Entry</button></div>${livePill()}</div>
    <div class="aud"><div class="aud-main">
      <div id="p-ser" class="card" style="padding:20px"><div class="scan-title"><span class="tile">${ic('barcode', 22)}</span><div><b>Scan Serial Number</b><span>Use camera, barcode scanner or enter manually</span></div></div>
        <div class="scanwrap"><input id="scan" class="scan-in" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Scan or enter serial number..."><button class="sbtn cam" id="scam" type="button" aria-label="Scan with camera" title="Scan with camera">${ic('cam', 20)}</button><button class="sbtn" id="sfocus" type="button" aria-label="Focus scanner">${ic('scan', 20)}</button></div>
        <div id="camwrap" class="camwrap" hidden><div class="cambox"><div class="camhead"><b>Scan barcode</b><button type="button" id="camclose" aria-label="Close camera">&#10005;</button></div><div class="camview"><div id="camreader"></div><div class="camframe"></div><div class="campop" id="campop" hidden><div class="campop-card" id="campop-card"><b id="campop-t"></b><span id="campop-s"></span></div></div></div><div class="camfoot"><span id="cammsg">Point at barcodes &mdash; scanning continuously</span><button type="button" class="tbtn" id="camtorch" hidden>Torch</button></div></div></div>
        <div id="res" class="resp idle">Ready to scan</div><div style="margin-top:12px"><button class="btn" id="clr" style="width:100%;padding:12px">Clear</button></div>
        <div id="unl" class="resp err" hidden><div class="rt">Serial not found in your store base stock</div><div class="muted" id="unl-s"></div><label for="uc">Please enter Item Code</label><input id="uc" autocomplete="off" placeholder="Item Code"><div class="ma" style="margin-top:10px"><button class="btn" id="unl-skip">Skip</button><button class="btn yel" id="unl-add">Add as Physical Stock</button></div></div><div class="ck" id="ck-ser"></div></div>
      <div id="p-non" class="nsgrid" hidden>
        <div class="card" style="padding:18px"><b>Select / Enter Item Code</b><div class="inp" style="margin:10px 0">${ic('search', 18)}<input id="ic" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Search item code..."></div><div id="opts" class="itemlist"></div></div>
        <div class="card" style="padding:18px"><div class="cardhead"><b>Item Details</b><a href="#/audit?view=preview">View All ${ic('arrow', 14)}</a></div><div id="idet" class="muted">Select an item from the list.</div>
          <b style="display:block;margin:14px 0 8px">Enter Physical Quantity</b><div class="qty"><button id="qm" type="button">−</button><input id="qty" type="number" min="0" step="any" value="1" inputmode="decimal"><button id="qp" type="button">+</button></div>
          <button class="btn yel xl" id="addn" disabled style="margin-top:14px">Add to Entry List ${ic('arrow', 18)}</button><div id="nres" class="resp idle">Counts are blind: the system quantity is never shown.</div></div><div class="card ck ckwide" id="ck-non"></div></div></div>
    <aside class="aud-side"><div class="card" style="padding:16px"><div class="bar" style="margin-bottom:6px"><b>Audit progress</b><span id="net"></span></div>
        <div class="kv"><div><span>Serialized</span><b id="c-ser">0</b></div><div><span>Non-serialized</span><b id="c-ent">0</b></div><div><span>Total units</span><b id="c-units">0</b></div></div><div class="sync" id="sync"></div><div class="ckmini" id="ck-side"></div></div>
      <div class="card" style="padding:16px;margin-top:14px"><div class="cardhead"><b>Recent Scans</b><a href="#/audit?view=preview">View All ${ic('arrow', 14)}</a></div><div id="recent" class="muted">Nothing yet</div></div></aside></div>
    <div class="bar" style="margin-top:16px"><span></span><a class="btn yel" href="#/audit?view=preview" style="padding:13px 22px">Preview &amp; complete audit ${ic('arrow', 18)}</a></div>`;
  const $ = id => el.querySelector('#' + id), scan = $('scan');
  const showRes = (id, kind, title, body) => { const r = $(id); r.className = 'resp ' + kind; r.innerHTML = `<div class="rt">${title}</div>${body || ''}`; };
  const rg = rows => '<div class="rg">' + rows.filter(r => r[1]).map(r => `<span>${r[0]}</span><b>${esc(r[1])}</b>`).join('') + '</div>';
  function paint() {
    $('c-ser').textContent = fn(st.counts.serial); $('c-ent').textContent = fn(st.counts.entries); $('c-units').textContent = fn(st.counts.units);
    const pend = Q.items.length, synced = Number(st.counts.serial) + Number(st.counts.entries);
    $('sync').innerHTML = `Scanned: <b>${fn(synced + pend)}</b> · Synced: <b>${fn(synced)}</b> · Pending: <b>${fn(pend)}</b>`;
    paintCk(); paintSide();
    $('net').innerHTML = !st.net ? badge('Offline', 'bad') : pend ? badge('Syncing', 'warn') : badge('Synced', 'ok');
    $('recent').innerHTML = st.recent.length ? `<table class="rtab"><thead><tr><th>Time</th><th>Serial / Item</th><th>Status</th></tr></thead><tbody>${st.recent.map(r => `<tr><td>${r.t}</td><td>${esc(r.sn || r.code || '')}</td><td>${badge(r.s, r.k)}</td></tr>`).join('')}</tbody></table>` : 'Nothing yet';
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
    status: paint, online: b => { if (st.net !== b) { st.net = b; setLive(b); paint(); if (!b) toast('Network connection interrupted. Your scan has been queued.', 'err'); } },
    async done(it, d, err) {
      /* camera viewfinder: close it only when the user must type something (unlisted serial / error);
         otherwise show the result as a popup and keep scanning */
      if (camOpen) {
        if (err || !d || d.status === 'NOT_FOUND') stopCam();
        else camPopup(d);
      }
      if (err) { showRes(it.kind === 'non' ? 'nres' : 'res', 'err', 'Could not save', esc(rpcMsg(err))); recent(it.label, '', 'Error', 'bad'); beep(false); paint(); return focusScan(); }
      if (d.counts) st.counts = d.counts;
      const s = d.status;
      if (st.ck) {
        if (s === 'MATCHED') { st.ck.serial.found = Number(st.ck.serial.found) + 1; const it = st.ck.serial.items.find(x => x.item_code === d.item_code); if (it) it.scanned = Number(it.scanned) + 1; }
        else if (s === 'UNLISTED_ADDED') st.ck.serial.extra = Number(st.ck.serial.extra) + 1;
        else if (s === 'ADDED' || s === 'REPLAY') reloadCk();
      }
      if (s === 'MATCHED') { showRes('res', 'ok', `<span>${ic('check', 18)} Serial scanned successfully!</span>${badge('Matched', 'ok')}`, rg([['Item Code', d.item_code], ['Description', d.item_description], ['Inventory Status', d.inventory_status], ['UoM', d.item_uom], ['Quality', d.item_quality], ['Serial Number', d.serial]])); recent(d.item_code, d.serial, 'Matched', 'ok'); beep(true); }
      else if (s === 'DUPLICATE') { showRes('res', 'warn', '⚠ Already Scanned', `<div class="rg"><span>Serial</span><b>${esc(d.serial)}</b></div><div class="muted">Previously scanned in this audit.</div>`); recent('', d.serial, 'Duplicate', 'warn'); beep(false); }
      else if (s === 'UNLISTED_ADDED') { showRes('res', 'err', 'Added as physical stock', rg([['Item Code', d.item_code], ['Serial', d.serial]]) + '<div class="muted">Not in your store base stock.</div>'); recent(d.item_code, d.serial, 'Unlisted', 'bad'); beep(false); }
      else if (s === 'NOT_FOUND') {
        showRes('res', 'err', 'Serial not found in your store base stock', rg([['Serial', d.serial]])); beep(false); paint();
        const code = await askCode(d.serial);
        if (code) Q.push({ kind: 'scan', rpc: 'add_unlisted_serial', args: { p_session: sid, p_serial: d.serial, p_item_code: code, p_event: uid() }, label: d.serial }, true); else recent('', d.serial, 'Skipped', '');
      }
      else if (s === 'ADDED') { showRes('nres', d.in_base ? 'ok' : 'warn', `<span>${ic('check', 18)} Added to audit</span>`, rg([['Item Code', d.item_code], ['Added', fn(d.added)], ['Your count for this line', fn(d.entry_total)]]) + (d.in_base ? '' : '<div class="muted">Not in your store base stock: it will be recorded as excess.</div>')); recent(d.item_code, '+' + fn(d.added), 'Added', 'ok'); beep(true); }
      paint(); if (!camOpen) focusScan();
    }
  };
  scan.onkeydown = e => { if (e.key !== 'Enter') return; e.preventDefault(); const v = scan.value.trim(); scan.value = ''; if (!v) return; Q.push({ kind: 'scan', rpc: 'scan_serial', args: { p_session: sid, p_serial: v, p_event: uid() }, label: v }); if (!camOpen) scan.focus(); };
  $('sfocus').onclick = () => scan.focus(); $('clr').onclick = () => { $('res').className = 'resp idle'; $('res').textContent = 'Ready to scan'; scan.focus(); };
  /* ---- camera barcode scanner (html5-qrcode: works on Android + iOS, lazy-loaded) ---- */
  let __qrP = null, camScanner = null, camOpen = false, camCool = 0;
  function loadQrLib() {
    if (window.Html5Qrcode) return Promise.resolve();
    if (!__qrP) __qrP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';
      s.onload = res;
      s.onerror = () => { __qrP = null; rej(new Error('scanner load failed')); };
      document.head.appendChild(s);
    });
    return __qrP;
  }
  const stopCam = async () => {
    camOpen = false;
    if (camScanner) { try { await camScanner.stop(); } catch (e) {} try { camScanner.clear(); } catch (e) {} camScanner = null; }
    const w = $('camwrap'); if (w) w.hidden = true;
  };
  /* result popup inside the viewfinder: the camera keeps running, only the popup shows each match */
  function camPopup(d) {
    const s = d.status, card = $('campop-card');
    card.className = 'campop-card ' + (s === 'MATCHED' ? 'ok' : s === 'DUPLICATE' ? 'warn' : 'info');
    $('campop-t').textContent = s === 'MATCHED' ? '✓ Matched' : s === 'DUPLICATE' ? 'Already scanned' : s === 'UNLISTED_ADDED' ? 'Added as physical stock' : s;
    $('campop-s').textContent = 'Serial: ' + (d.serial || '');
    $('campop').hidden = false;
    clearTimeout(camPopup.t);
    camPopup.t = setTimeout(() => { const p = $('campop'); if (p) p.hidden = true; }, 2200);
  }
  async function startCam() {
    stopCam();
    try { await loadQrLib(); }
    catch (e) { toast('Could not load the barcode scanner. Check your connection and try again, or enter the serial manually.', 'err'); return; }
    $('cammsg').textContent = 'Point at barcodes — scanning continuously';
    $('camtorch').hidden = true;
    $('camwrap').hidden = false;
    /* let the modal lay out before the scanner measures it — starting too early = black video on some phones */
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    if ($('camwrap').hidden) return;
    window.addEventListener('hashchange', stopCam, { once: true });
    const onOk = text => {
      const v = String(text || '').trim();
      if (!v || Date.now() < camCool) return;
      camCool = Date.now() + 1500;
      $('cammsg').textContent = 'Scanned: ' + v;
      scan.value = v;
      scan.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      if (document.activeElement === scan) scan.blur();
      beep(true);
    };
    try {
      camScanner = new Html5Qrcode('camreader');
      await camScanner.start({ facingMode: 'environment' },
        { fps: 10, qrbox: { width: 260, height: 160 }, aspectRatio: 1.333,
          formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39, Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.DATA_MATRIX] },
        onOk, () => {});
    } catch (e) {
      stopCam();
      toast('Could not open the camera. Please allow camera access and try again, or enter the serial manually.', 'err');
      return;
    }
    camOpen = true;
    /* nudge the video to paint on phones that stay black until a tab switch */
    try {
      const video = document.querySelector('#camreader video');
      if (video) { video.setAttribute('playsinline', ''); video.muted = true; video.style.transform = 'translateZ(0)'; try { await video.play(); } catch (e) {} }
    } catch (e) {}
    try {
      const video = document.querySelector('#camreader video');
      const track = video && video.srcObject && video.srcObject.getVideoTracks()[0];
      const caps = track && track.getCapabilities ? track.getCapabilities() : {}, torchBtn = $('camtorch');
      if (caps.torch) {
        let torchOn = false;
        torchBtn.hidden = false;
        torchBtn.onclick = async () => { torchOn = !torchOn; try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); torchBtn.classList.toggle('on', torchOn); } catch (e) { torchOn = !torchOn; } };
      }
    } catch (e) { /* torch optional */ }
  }
  $('scam').onclick = startCam;
  $('camclose').onclick = stopCam;
  el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { el.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b)); $('p-ser').hidden = b.dataset.t !== 'ser'; $('p-non').hidden = b.dataset.t !== 'non'; (b.dataset.t === 'ser' ? scan : $('ic')).focus(); });
  if (/tab=non/.test(location.hash)) { const b = el.querySelector('[data-t="non"]'); if (b) b.click(); }
  // non-serialized: live type-ahead list
  const hl = (txt, v) => { const i = String(txt).toUpperCase().indexOf(v); return i < 0 || !v ? esc(txt) : esc(txt.slice(0, i)) + '<mark>' + esc(txt.slice(i, i + v.length)) + '</mark>' + esc(txt.slice(i + v.length)); };
  const optLabel = (o, v) => `<span class="tile">${ic('box', 18)}</span><span><b>${hl(o.item_code, v)}</b> <span class="muted">${esc([o.inventory_status, o.item_quality].filter(Boolean).join(' · '))}</span><br><span class="muted">${esc(o.item_description || '')} ${o.item_uom ? '(' + esc(o.item_uom) + ')' : ''}</span></span>`;
  const detail = o => { $('idet').className = ''; $('idet').innerHTML = `<div class="dl"><span>Item Code</span><b>${esc(o.item_code)}</b><span>Description</span><b>${esc(o.item_description || '—')}</b><span>UOM</span><b>${esc(o.item_uom || '—')}</b><span>Inventory Status</span><b>${esc(o.inventory_status || '—')}</b><span>Quality</span><b>${esc(o.item_quality || '—')}</b></div>`; };
  let seq = 0, tmr = null;
  const choose = o => { st.pick = o; $('addn').disabled = false; detail(o); $('opts').querySelectorAll('.opt').forEach(l => l.classList.toggle('sel', st.opts[+l.dataset.i] === o)); };
  async function look() {
    const code = $('ic').value.trim(), v = code.toUpperCase(), my = ++seq; st.pick = null; st.opts = []; $('addn').disabled = true; $('idet').className = 'muted'; $('idet').textContent = 'Select an item from the list.';
    if (code.length < 2) { $('opts').innerHTML = code ? '<div class="muted">Keep typing…</div>' : ''; return; }
    const { data, error } = await sb.rpc('lookup_item', { p_session: sid, p_code: code });
    if (my !== seq) return;
    if (error) { $('opts').innerHTML = `<div class="alert err">${esc(isNet(error) ? 'Network connection interrupted. Try again when you are back online.' : rpcMsg(error))}</div>`; return; }
    if (data.serialized_only) { $('opts').innerHTML = '<div class="alert warn">This item is serialized. Please scan its serial numbers on the Serialized Scan tab.</div>'; return; }
    if (!data.options.length) {
      st.opts = [{ item_code: v, inventory_status: '', item_quality: '' }];
      $('opts').innerHTML = `<div class="alert warn">No match in your store base stock. If you count it, it will be recorded as excess.</div><label class="opt" data-i="0"><input type="radio" name="o"><span class="tile">${ic('box', 18)}</span><span><b>${esc(v)}</b> <span class="muted">(not in base stock)</span></span></label>`;
    } else {
      st.opts = data.options;
      $('opts').innerHTML = `<div class="muted" style="margin-bottom:6px">${data.options.length} matching item${data.options.length === 1 ? '' : 's'} - tap one:</div>` + data.options.map((o, i) => `<label class="opt" data-i="${i}"><input type="radio" name="o">${optLabel(o, v)}</label>`).join('');
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
    $('ic').value = ''; $('opts').innerHTML = ''; $('qty').value = 1; st.pick = null; $('addn').disabled = true; $('idet').className = 'muted'; $('idet').textContent = 'Select an item from the list.'; $('ic').focus();
  };

  /* ---- checklist: how much has to be audited, what is done, what is left (counts and item codes only; no non-serialized quantities) ---- */
  const ckUi = { s: { open: false, f: 'PENDING', q: '' }, n: { open: false, f: 'PENDING', q: '' } };
  const ckbar = (v, t, col) => `<div class="ckbar"><i style="width:${t ? Math.min(100, 100 * v / t) : 0}%;background:${col}"></i></div>`;
  let ckT = null; const reloadCk = () => { clearTimeout(ckT); ckT = setTimeout(loadCk, 350); };
  async function loadCk() {
    const { data, error } = await sb.rpc('audit_checklist', { p_session: sid });
    if (error) { st.ck = false; ['ck-ser', 'ck-non'].forEach(i => { const n = $(i); if (n) n.hidden = true; }); paintSide(); return; }  // not installed / unavailable: the audit itself keeps working
    st.ck = data; paintCk(); paintSide();
  }
  function ckShell() {
    if (st.shell) return; st.shell = true;
    $('ck-ser').innerHTML = `<div id="ck-s-sum"></div><div id="ck-s-panel" hidden><div class="inp ckq">${ic('search', 16)}<input id="ck-s-q" placeholder="Search item code or description..." autocomplete="off"></div><div id="ck-s-rows"></div></div>`;
    $('ck-non').innerHTML = `<div id="ck-n-sum"></div><div id="ck-n-panel" hidden><div class="inp ckq">${ic('search', 16)}<input id="ck-n-q" placeholder="Search item code or description..." autocomplete="off"></div><div id="ck-n-rows"></div></div>`;
  }
  function paintCk() {
    const c = st.ck; if (c === false) return; ckShell();
    if (!c) { $('ck-s-sum').innerHTML = $('ck-n-sum').innerHTML = '<div class="muted">Loading checklist…</div>'; return; }
    const sr = c.serial, ex = Number(sr.expected), fd = Number(sr.found), nn = c.non, nt = Number(nn.total), nd = Number(nn.done);
    $('ck-s-sum').innerHTML = `<div class="ckh"><div><b>Serial numbers to scan</b><small>${ex ? 'Expected in your store\'s base stock' : 'No serialized items in your store\'s base stock'}</small></div><div class="ckn"><b>${fn(fd)}</b> of ${fn(ex)} scanned</div></div>${ckbar(fd, ex, '#16A34A')}
      <div class="cks"><span><b>${fn(Math.max(0, ex - fd))}</b> left to scan${Number(sr.extra) ? ` · <span class="ckx">${fn(sr.extra)} extra (not in base stock)</span>` : ''}</span>${sr.items.length ? `<button type="button" class="ckt" data-ck="s">${ckUi.s.open ? 'Hide' : 'Show'} item-wise list ${ckUi.s.open ? '▴' : '▾'}</button>` : ''}</div>`;
    $('ck-n-sum').innerHTML = `<div class="ckh"><div><b>Item codes to count</b><small>${nt ? 'Quantities stay blind: only the item codes are listed' : 'No non-serialized items in your store\'s base stock'}</small></div><div class="ckn"><b>${fn(nd)}</b> of ${fn(nt)} item codes done</div></div>${ckbar(nd, nt, '#2F6FED')}
      <div class="cks"><span><b>${fn(Math.max(0, nt - nd))}</b> left to count${Number(nn.extra) ? ` · <span class="ckx">${fn(nn.extra)} extra (not in base stock)</span>` : ''}</span>${nn.lines.length ? `<button type="button" class="ckt" data-ck="n">${ckUi.n.open ? 'Hide' : 'Show'} item-wise list ${ckUi.n.open ? '▴' : '▾'}</button>` : ''}</div>`;
    $('ck-s-panel').hidden = !ckUi.s.open; $('ck-n-panel').hidden = !ckUi.n.open; drawRows('s'); drawRows('n');
  }
  function paintSide() {
    const c = st.ck, n = $('ck-side'); if (!n) return;
    n.innerHTML = c ? `<div class="ckm"><span>Serialized scanned</span><b>${fn(c.serial.found)} of ${fn(c.serial.expected)}</b></div>${ckbar(Number(c.serial.found), Number(c.serial.expected), '#16A34A')}
      <div class="ckm"><span>Item codes done</span><b>${fn(c.non.done)} of ${fn(c.non.total)}</b></div>${ckbar(Number(c.non.done), Number(c.non.total), '#2F6FED')}` : '';
  }
  function drawRows(k) {
    const u = ckUi[k], c = st.ck, box = $('ck-' + k + '-rows'); if (!c || !u.open || !box) return;
    const ser = k === 's', list = ser ? c.serial.items : c.non.lines, q = u.q.trim().toUpperCase(), PAGE = 100;
    const isDone = r => ser ? Number(r.scanned) >= Number(r.expected) : !!r.done;
    const hit = list.map((r, i) => ({ r, i })).filter(x => !q || [x.r.item_code, x.r.item_description, x.r.inventory_status, x.r.item_quality].join(' ').toUpperCase().includes(q));
    const nDone = hit.filter(x => isDone(x.r)).length, nPend = hit.length - nDone;
    const rows = hit.filter(x => u.f === 'ALL' || (u.f === 'DONE') === isDone(x.r))
      .sort((a, b) => ser ? (Number(b.r.expected) - Number(b.r.scanned)) - (Number(a.r.expected) - Number(a.r.scanned)) || String(a.r.item_code).localeCompare(b.r.item_code) : isDone(a.r) - isDone(b.r) || a.i - b.i);
    const tabs = [['PENDING', 'Left', nPend], ['DONE', 'Done', nDone], ['ALL', 'All', hit.length]].map(t => `<button type="button" class="tab ${u.f === t[0] ? 'on' : ''}" data-cf="${t[0]}" data-k="${k}">${t[1]} (${fn(t[2])})</button>`).join('');
    const body = rows.slice(0, PAGE).map(x => { const r = x.r;
      if (ser) { const sc = Number(r.scanned), ex = Number(r.expected), left = Math.max(0, ex - sc);
        return `<tr><td><b>${esc(r.item_code)}</b><small>${esc(r.item_description || '')}</small></td><td class="ckc"><b>${fn(sc)}</b> / ${fn(ex)}${ckbar(sc, ex, '#16A34A')}</td><td>${left ? `<span class="ckleft">${fn(left)} left</span>` : badge('Done', 'ok')}</td></tr>`; }
      return `<tr class="${r.done ? '' : 'pick'}" ${r.done ? '' : `data-pick="${x.i}" title="Tap to count this item"`}><td><b>${esc(r.item_code)}</b> <small class="inl">${esc([r.inventory_status, r.item_quality].filter(Boolean).join(' · '))}</small><small>${esc(r.item_description || '')}${r.item_uom ? ' (' + esc(r.item_uom) + ')' : ''}</small></td><td>${r.done ? badge('Done', 'ok') : badge('Left', 'warn')}</td><td>${r.done ? '' : '<span class="ckgo">Count ›</span>'}</td></tr>`; }).join('');
    box.innerHTML = `<div class="cktabs">${tabs}</div>` + (body ? `<div class="ckscroll"><table class="ckt2"><thead><tr><th>Item code</th><th>${ser ? 'Scanned' : 'Status'}</th><th>${ser ? 'Left' : ''}</th></tr></thead><tbody>${body}</tbody></table></div>${rows.length > PAGE ? `<div class="muted ckmore">Showing the first ${PAGE} of ${fn(rows.length)}. Use the search box to narrow the list.</div>` : ''}`
      : `<div class="muted ckmore">${u.f === 'PENDING' ? (q ? 'Nothing left for this search.' : 'Nothing left — all done! 🎉') : 'Nothing to show.'}</div>`);
  }
  el.onclick = e => {
    const t = e.target.closest('[data-ck]'); if (t) { const u = ckUi[t.dataset.ck]; u.open = !u.open; return paintCk(); }
    const f = e.target.closest('[data-cf]'); if (f) { ckUi[f.dataset.k].f = f.dataset.cf; return drawRows(f.dataset.k); }
    const r = e.target.closest('[data-pick]'); if (r && st.ck) { const o = st.ck.non.lines[+r.dataset.pick]; if (!o) return;
      choose({ item_code: o.item_code, inventory_status: o.inventory_status, item_quality: o.item_quality, item_description: o.item_description, item_uom: o.item_uom });
      $('opts').innerHTML = ''; $('ic').value = ''; $('idet').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); $('qty').focus(); $('qty').select(); }
  };
  el.oninput = e => { if (e.target.id === 'ck-s-q') { ckUi.s.q = e.target.value; drawRows('s'); } else if (e.target.id === 'ck-n-q') { ckUi.n.q = e.target.value; drawRows('n'); } };
  loadCk();
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
      <td class="nw">${r.kind === 'nonserial' ? `<button class="eyeb" data-a="edit" data-id="${r.id}" data-q="${r.qty}" title="Edit quantity">${ic('edit', 16)}</button> ` : ''}<button class="eyeb" style="color:#D92D20" data-a="rm" data-k="${r.kind}" data-id="${r.id}" data-n="${esc(r.item_sno || r.item_code)}" title="Remove">${ic('trash', 16)}</button></td></tr>`).join('');
    el.innerHTML = `<div class="pagehead"><div><a class="btn sm" href="#/audit" style="margin-bottom:10px">${ic('back', 15)} Back</a><h1>Preview - ${esc(c.store.code)}</h1><p>Review all scanned and entered items before completing the audit.</p></div>${livePill()}</div>
      ${pend ? `<div class="alert warn">${pend} entr${pend === 1 ? 'y is' : 'ies are'} still waiting to sync. Go back to the audit screen so they can sync before you complete.</div>` : ''}
      <div class="bar"><div class="tabs seg">${[['ALL', 'All Items', cn.serial + cn.entries], ['SERIAL', 'Serialized', cn.serial], ['NONSERIAL', 'Non-Serialized', cn.entries]].map(t => `<button class="tab ${type === t[0] ? 'on' : ''}" data-ty="${t[0]}">${t[1]} (${fn(t[2])})</button>`).join('')}</div>
        <div class="inp" style="min-width:300px">${ic('search', 18)}<input id="q" placeholder="Search by item code, description or serial..." value="${esc(q)}"></div></div>
      ${tbl(['#', 'Item_Code', 'Inventory_Status', 'Item_Description', 'UoM', 'Qty', 'Quality', 'Serial Number', 'Type', 'Action'], rows)}
      <div class="bar"><span class="muted">${fn(d.total)} row(s)</span><div class="row"><button class="btn sm" data-pg="-1" ${page ? '' : 'disabled'}>Previous</button><button class="btn sm" data-pg="1" ${(page + 1) * PS < d.total ? '' : 'disabled'}>Next</button></div></div>
      <div class="bar" style="margin-top:8px"><a class="btn" href="#/audit" style="padding:13px 22px">${ic('back', 16)} Back to Audit</a><button class="btn yel" id="done" style="padding:13px 24px" ${pend ? 'disabled' : ''}>Complete Audit ${ic('arrow', 18)}</button></div>`;
    el.querySelector('#q').oninput = e => { clearTimeout(timer); const v = e.target.value.trim(); timer = setTimeout(() => { q = v; page = 0; load(); }, 300); };
    el.querySelector('#done').onclick = complete;
  }
  function complete() {
    const cn = last.counts;
    const o = openModal('', `<span class="lockic">${ic('lock', 40, 1.6)}</span><h3 style="font-size:22px">Complete &amp; Lock Audit?</h3><p class="muted">Once submitted, this audit will be locked.<br>You will not be able to add, remove or modify items.<br>Only an authorized administrator can reopen it.</p>
      <div class="kv" style="text-align:left"><div><span>Serialized scans</span><b>${fn(cn.serial)}</b></div><div><span>Non-serialized entries</span><b>${fn(cn.entries)}</b></div><div><span>Total physical units</span><b>${fn(cn.units)}</b></div></div>
      <label class="chk" style="justify-content:center"><input type="checkbox" id="m_ok"> I confirm that the physical stock count is complete.</label>`,
      [cancelBtn, { label: 'Submit & Lock Audit', cls: 'yel', fn: async () => {
        if (Q.items.length) { toast('Some entries are still syncing. Please wait and try again.', 'err'); return false; }
        const ov = document.createElement('div'); ov.className = 'syncov'; ov.innerHTML = loadingView('sync'); document.body.appendChild(ov);
        try { const { error } = await sb.rpc('submit_audit', { p_session: sid }); if (error) throw error; } finally { ov.remove(); }
        try { localStorage.removeItem('sfx_q_' + sid); } catch (e) {} Q.items = [];
        toast('Audit submitted and locked.', 'ok'); location.hash = '#/result'; } }]);
    o.querySelector('.mdl').classList.add('center'); const go = o.querySelector('.ma .yel'); go.disabled = true; o.querySelector('#m_ok').onchange = e => (go.disabled = !e.target.checked);
  }
  el.onclick = async e => {
    const t = e.target.closest('[data-ty]'); if (t) { type = t.dataset.ty; page = 0; return load(); }
    const pg = e.target.closest('[data-pg]'); if (pg) { page += Number(pg.dataset.pg); return load(); }
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'rm') openModal('Remove this entry?', `<p>Remove <b>${esc(b.dataset.n)}</b> from your audit? This is recorded in the audit log.</p>`, [cancelBtn,
      { label: 'Remove', cls: 'danger', fn: async () => { const { error } = await sb.rpc('remove_entry', { p_kind: b.dataset.k, p_id: b.dataset.id }); if (error) throw error; toast('Entry removed.', 'ok'); load(); } }]);
    if (b.dataset.a === 'edit') openModal('Edit quantity', `<label>Physical quantity</label><input id="m_q" type="number" min="0" step="any" value="${esc(b.dataset.q)}">`, [cancelBtn,
      { label: 'Save', cls: 'yel', fn: async () => { const v = Number(document.getElementById('m_q').value); if (!(v > 0)) { toast('Please enter a quantity greater than zero.', 'err'); return false; }
        const { error } = await sb.rpc('edit_non_serial', { p_id: b.dataset.id, p_qty: v }); if (error) throw error; toast('Quantity updated.', 'ok'); load(); } }]);
  };
  load();
}

/* ---- result (store user: own result only; admin / circle head: opened from Store Audit). No export, by design. ---- */
PAGES.result = async el => {
  const hq = new URLSearchParams(location.hash.split('?')[1] || ''); let sid = hq.get('sess');
  const cyc = hq.get('cycle');
  if (!isStaff() && cyc) {                                   // a previous cycle picked from the Audit Cycle chip
    const { data: rs, error } = await sb.from('audit_sessions').select('id').eq('audit_cycle_id', cyc).eq('status', 'LOCKED').order('version', { ascending: false }).limit(1);
    if (error) throw error;
    if (!rs.length) { el.innerHTML = '<div class="card startcard"><h2>No result for this cycle</h2><p class="muted">Your store has no submitted audit in the cycle you selected.</p><a class="btn yel" href="#/dashboard">Back to dashboard</a></div>'; return; }
    sid = rs[0].id;
  } else if (!isStaff()) {
    const { data: c, error } = await sb.rpc('my_audit_context'); if (error) throw error;
    if (!c.session || c.session.status !== 'LOCKED') {
      el.innerHTML = `<div class="card startcard"><h2>${c.session ? 'Your audit is in progress' : 'No result yet'}</h2><p class="muted">Your result appears here after you submit your audit.${c.session && c.session.reopen_reason ? ' An administrator reopened it: ' + esc(c.session.reopen_reason) : ''}</p>${c.session ? '<a class="btn yel" href="#/audit">Continue audit</a>' : ''}</div>`; return; }
    sid = c.session.id;
  }
  if (!sid) { el.innerHTML = '<div class="card startcard"><h2>No audit selected</h2><p class="muted">Open a result from Store Audit.</p></div>'; return; }
  return resultView(el, sid, false);
};
/* Store result page: download this session's variance (shortage + excess SN rows) as .xlsx.
   Columns: Type | Inv. Status | Item Code | Quality | Quantity | SN. Paged through in chunks. */
async function downloadVariance(sid, storeCode, cycleName, btn) {
  const PSZ = 1000; let off = 0, all = [];
  await loadXlsx();
  const label = btn ? btn.innerHTML : '';
  const slug = s => String(s || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  try {
    if (btn) { btn.disabled = true; btn.innerHTML = 'Fetching…'; }
    for (;;) {
      const { data, error } = await sb.from('reconciliation_results')
        .select('result,inventory_status,item_code,item_quality,short_qty,excess_qty,item_sno')
        .eq('session_id', sid).in('result', ['SHORT', 'EXCESS'])
        .order('result', { ascending: false }).order('item_code').order('item_sno')
        .range(off, off + PSZ - 1);
      if (error) throw error;
      all = all.concat(data); off += PSZ;
      if (btn) btn.innerHTML = `Fetching ${fn(all.length)}…`;
      if (data.length < PSZ) break;
    }
  } finally { if (btn) { btn.disabled = false; btn.innerHTML = label; } }
  if (!all.length) { toast('No shortage or excess rows in this audit.', 'err'); return; }
  const rows = all.map(r => ({
    'Type': r.result === 'SHORT' ? 'Short' : 'Excess',
    'Inv. Status': r.inventory_status || '—',
    'Item Code': r.item_code,
    'Quality': r.item_quality || '—',
    'Quantity': r.result === 'SHORT' ? Number(r.short_qty) : Number(r.excess_qty),
    'SN': r.item_sno || '—'
  }));
  const head = ['Type', 'Inv. Status', 'Item Code', 'Quality', 'Quantity', 'SN'];
  const ws = XLSX.utils.json_to_sheet(rows, { header: head });
  ws['!cols'] = head.map(h => ({ wch: Math.min(42, Math.max(h.length + 2, ...rows.slice(0, 500).map(r => String(r[h]).length + 2))) }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Variance Report');
  const d = new Date(), ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  XLSX.writeFile(wb, `Variance_Report_${slug(storeCode)}_${slug(cycleName)}_${ymd}.xlsx`);
  toast(`Downloaded ${fn(rows.length)} row(s).`, 'ok');
}
async function resultView(el, sid, embedded) {
  const staff = isStaff();
  const cnt = async (ser, res) => { let q = sb.from('reconciliation_results').select('id', { count: 'exact', head: true }).eq('session_id', sid).eq('is_serialized', ser); if (res) q = q.eq('result', res); return ((await q).count) || 0; };
  const [si, sm, nSerS, nNonS, vbR, fvR] = await Promise.all([sb.from('audit_sessions').select('id,version,status,submitted_at,store_id,audit_cycle_id,stores(code,name),audit_cycles(name)').eq('id', sid).maybeSingle(), sb.rpc('result_summary', { p_session: sid }), cnt(true, 'SHORT'), cnt(false, 'SHORT'), sb.rpc('store_variance_breakdown', { p_session: sid }), sb.rpc('result_filter_values', { p_session: sid })]);
  if (si.error || !si.data) throw si.error || new Error('Result not found');
  if (sm.error) throw sm.error;
  const ss = si.data, m = sm.data; let tab = 'SERSHORT', sub = 'ALL', q = '', page = 0, timer = null; const PS = 50;
  const subCache = {}; let rows = [];
  const fv = fvR && !fvR.error && fvR.data ? fvR.data : null;      // distinct values for the click-to-select filters (database/19)
  const fetchFV = async c => { const col = c.col || c.k; const r = await sb.from('reconciliation_results').select(col).eq('session_id', sid); return r.error || !r.data ? null : r.data.map(x => x[col]); };   // on-demand fallback: keeps the tick-list UI even when the RPC has no values
  /* remarks on short items (optional; the column is skipped if the remarks table is not installed yet) */
  const rkey = r => [r.item_code, r.inventory_status || '', r.item_quality || '', r.item_sno || ''].join('\u0001');
  let rmR = await sb.from('result_remarks').select('item_code,inventory_status,item_quality,item_sno,remark,category_id,reference,qty,status,accepted_qty').eq('store_id', ss.store_id).eq('audit_cycle_id', ss.audit_cycle_id);
  const revDb = !rmR.error;          // structured revision (database/32) present?
  if (rmR.error) rmR = await sb.from('result_remarks').select('item_code,inventory_status,item_quality,item_sno,remark').eq('store_id', ss.store_id).eq('audit_cycle_id', ss.audit_cycle_id);
  const rmkOk = !rmR.error, rmk = {}; if (rmkOk) rmR.data.forEach(r => { rmk[rkey(r)] = r; });
  const catR = await sb.rpc('remark_categories_list');
  const cats = revDb && !catR.error && Array.isArray(catR.data) ? catR.data : null, catById = {};
  if (cats) cats.forEach(c => { catById[c.id] = c; });
  const canEdit = rmkOk && !staff && ss.status === 'LOCKED';
  /* shortage-first tabs: the page opens on shortage lines only (few rows, fast, remarks right there);
     Excess / Matched / All Items query the database only when the user clicks them */
  const tabs = [['SERSHORT', 'Serialized Shortage', nSerS], ['NONSHORT', 'Non-Serialized Shortage', nNonS], ['EXCESS', 'Excess', m.rows_excess], ['MATCH', 'Matched', m.rows_match], ['ALL', 'All Items', m.rows_all]];
  tab = nSerS > 0 ? 'SERSHORT' : nNonS > 0 ? 'NONSHORT' : Number(m.rows_excess) > 0 ? 'EXCESS' : 'ALL';
  const matched = Number(m.matched), shortU = Number(m.short), excessU = Number(m.excess);
  const vb = Object.assign({ ser_short: 0, ser_excess: 0, non_short: 0, non_excess: 0 }, (vbR && vbR.data) || {});
  const rate = m.match_rate == null ? null : Number(m.match_rate);
  const trs = Number(m.short_transit || 0), shSub = m.short_transit == null || !shortU ? '' : `In transit ${fn(trs)} · Other ${fn(shortU - trs)}`;      // split only; the Short figure itself is unchanged
  /* shortage revision strip: reported genuine -> accepted (explained) -> revised genuine; pending shown separately and changes nothing yet */
  const genShort = Math.max(0, shortU - trs);
  const revList = revDb ? Object.values(rmk) : [];
  const revAcc = revList.reduce((a, e) => a + (e.status === 'REVIEWED' ? Number(e.accepted_qty) || 0 : 0), 0);
  const revPend = revList.filter(e => e.status !== 'REVIEWED').reduce((a, e) => a + (Number(e.qty) || 0), 0);
  const revStrip = revDb && (revAcc > 0 || revPend > 0) ? `<div class="card revstrip"><span class="rvt">${ic('clip', 16)} Shortage revision</span><span>Reported genuine <b>${fn(genShort)}</b></span><span class="rvarr">→</span><span>Explained (accepted) <b class="g">${fn(revAcc)}</b></span><span class="rvarr">→</span><span>Revised genuine shortage <b class="r">${fn(Math.max(0, genShort - revAcc))}</b></span>${revPend ? `<span class="rvp">${fn(revPend)} awaiting review</span>` : ''}</div>` : '';
  const stat = (cls, icon, label, val, sub = '') => `<div class="rst"><span class="ric ${cls}">${ic(icon, 26)}</span><div><small>${label}</small><b class="${cls}">${val}</b>${sub ? `<em>${sub}</em>` : ''}</div></div>`;
  const pill = (cls, icon, html) => `<span class="pl ${cls}">${ic(icon, 15)}<span>${html}</span></span>`;
  const pills = [pill('g', 'check', `<b>${fn(m.rows_match)}</b> matched lines`), pill('r', 'alert', `<b>${fn(m.rows_short)}</b> short lines`), pill('y', 'zap', `<b>${fn(m.rows_excess)}</b> excess lines`),
    vb.ser_short ? pill('b', 'barcode', `Serialized short <b>${fn(vb.ser_short)}</b>`) : '', vb.non_short ? pill('p', 'box', `Non-serialized short <b>${fn(vb.non_short)}</b>`) : '',
    vb.ser_excess ? pill('n', 'barcode', `Serialized excess <b>${fn(vb.ser_excess)}</b>`) : '', vb.non_excess ? pill('n', 'box', `Non-serialized excess <b>${fn(vb.non_excess)}</b>`) : ''].join('');
  el.innerHTML = `<div class="resfit">
    <div class="rhead"><div class="rh1">${staff ? `<a class="btn sm" href="#/storeaudit">${ic('back', 15)} Back</a>` : ''}<h1>Audit Result - ${esc(ss.stores?.code || '')}</h1>${badge(ss.status === 'LOCKED' ? 'Completed' : 'Superseded version', ss.status === 'LOCKED' ? 'ok' : 'warn')}
      <span class="rmeta">${esc(ss.audit_cycles?.name || '')} · Version ${ss.version} · Submitted ${fdt(ss.submitted_at)}</span></div><span class="rhact"><button type="button" class="btn sm yel" id="vdl" title="Download the shortage + excess SN rows for this audit cycle as Excel">${ic('dl', 15)} Variance report</button><span class="live">${ic('lock', 14)} Locked</span></span></div>
    <div class="card rsum2"><div class="rtop"><div class="rdon">${donut([{ v: matched, color: '#16A34A' }, { v: shortU, color: '#E5484D' }, { v: excessU, color: '#F5B301' }], rate == null ? '—' : rate.toFixed(1) + '%', 'Match Rate', 130, 12)}</div>
      <div class="rstats">${stat('', 'box', 'Expected', fn(m.expected))}${stat('g', 'check', 'Found', fn(m.physical))}${stat('r', 'alert', 'Short', fn(shortU), shSub)}${stat('y', 'trend', 'Excess', fn(excessU))}</div></div>
      <div class="rpills">${pills}</div></div>
    ${revStrip}
    <div class="rtool"><div class="tabs seg" id="rtabs">${tabs.map(t => `<button class="tab ${t[0] === 'SERSHORT' || t[0] === 'NONSHORT' ? 'red' : ''}" data-ty="${t[0]}">${t[1]} (${fn(t[2])})</button>`).join('')}</div>
      <div class="inp rsearch">${ic('search', 18)}<input id="q" placeholder="Search item code, description or serial..."></div></div>
    <div class="subtabs" id="rsub" hidden></div><div class="fchips" id="rchips" hidden></div><div id="rt"></div></div>`;

  /* ---- column filters (shared module js/colfilter.js): click the funnel in a column header ---- */
  const CF = colFilters([{ k: 'item_code', l: 'Item Code', t: 'list' }, { k: 'item_description', l: 'Description', t: 'text' }, { k: 'inventory_status', l: 'Status', t: 'list' }, { k: 'item_uom', l: 'UoM', t: 'list' },
    { k: 'expected_qty', l: 'Expected', t: 'num' }, { k: 'physical_qty', l: 'Physical', t: 'num' }, { k: 'variance', l: 'Variance', t: 'num' }, { k: 'item_quality', l: 'Quality', t: 'list' },
    { k: 'item_sno', l: 'Item SNo', t: 'text' }, { k: 'result', l: 'Result', t: 'list' }], fv, () => { page = 0; load(); }, fetchFV);
  const HEADS = ['item_code', 'item_description', 'inventory_status', 'item_uom', 'expected_qty', 'physical_qty', 'variance', 'item_quality', 'item_sno', 'result'];
  const WIDTHS = rmkOk ? [4, 9, 15, 9, 5, 7, 7, 7, 7, 11, 7, 12] : [4, 10, 19, 10, 6, 8, 8, 8, 7, 12, 8];     // % of the table width: it always fits, no sideways scrolling
  const ib = v => !v ? '—' : `<span class="ib ${/transit/i.test(v) ? 'b' : /^active$/i.test(v) ? 'g' : 'n'}">${esc(v)}</span>`;

  const split = () => false;      // the old Serialized/Non-Serialized sub-tabs are gone: the five tabs above are flat now
  async function subCounts() {
    if (subCache[tab]) return subCache[tab]; const ser = tab === 'SERIAL';
    const c = async r => ((await sb.from('reconciliation_results').select('id', { count: 'exact', head: true }).eq('session_id', sid).eq('is_serialized', ser).eq('result', r)).count) || 0;
    const [a, b, d] = await Promise.all([c('MATCH'), c('SHORT'), c('EXCESS')]); return subCache[tab] = { ALL: a + b + d, MATCH: a, SHORT: b, EXCESS: d };
  }
  async function drawSub() {
    const box = el.querySelector('#rsub'); box.hidden = !split(); if (!split()) return;
    const n = await subCounts();
    box.innerHTML = [['ALL', 'All'], ['MATCH', 'Matched'], ['SHORT', 'Short'], ['EXCESS', 'Excess']].map(([k, l]) => `<button type="button" class="${k === sub ? 'on' : ''} ${k}" data-sub="${k}">${l} (${fn(n[k])})</button>`).join('');
  }
  const mark = () => { el.querySelectorAll('#rtabs [data-ty]').forEach(b => b.classList.toggle('on', b.dataset.ty === tab)); drawSub(); CF.chips(el.querySelector('#rchips')); };
  async function load() {
    mark(); const rt = el.querySelector('#rt'); rt.innerHTML = universeLoader();
    let qb = sb.from('reconciliation_results').select('item_code,inventory_status,item_description,item_uom,expected_qty,physical_qty,item_quality,item_sno,result,is_unlisted,is_serialized,short_qty', { count: 'exact' }).eq('session_id', sid);
    if (tab === 'SERSHORT') qb = qb.eq('is_serialized', true).eq('result', 'SHORT');
    else if (tab === 'NONSHORT') qb = qb.eq('is_serialized', false).eq('result', 'SHORT');
    else if (tab === 'EXCESS') qb = qb.eq('result', 'EXCESS');
    else if (tab === 'MATCH') qb = qb.eq('result', 'MATCH');
    const t = q.replace(/[,()%*\\]/g, ' ').trim(); if (t) qb = qb.or(`item_code.ilike.*${t}*,item_sno.ilike.*${t}*,item_description.ilike.*${t}*`);
    qb = CF.apply(qb);
    const { data, error, count } = await qb.order('item_code').order('item_sno').range(page * PS, page * PS + PS - 1);
    if (error) { rt.innerHTML = `<div class="alert err">${esc(friendlyError(error))} <button type="button" class="btn sm" data-retry style="margin-left:8px">Retry</button></div>`; return; }
    rows = data;
    const rbox = (r, i) => { if (!rmkOk || r.result !== 'SHORT') return ''; const e = rmk[rkey(r)];
      if (revDb && cats) {           // structured revision UI (database/32)
        if (/transit/i.test(r.inventory_status || '')) return '<span class="muted" style="font-size:12px">In transit — already excluded</span>';
        const chips = [];
        if (e) {
          const cat = e.category_id ? catById[e.category_id] : null;
          chips.push(`<span class="rchip cat">${esc(cat ? cat.name : 'Remark')}</span>`);
          if (e.status === 'REVIEWED') { const a = Number(e.accepted_qty) || 0, cq = Number(e.qty) || Number(r.short_qty) || 0;
            chips.push(a <= 0 ? '<span class="rchip rej">Not accepted</span>' : a >= cq ? '<span class="rchip acc">Accepted</span>' : `<span class="rchip part">Accepted ${fn(a)} of ${fn(cq)}</span>`); }
          else chips.push('<span class="rchip pen">Pending review</span>');
          if (e.reference) chips.push(`<span class="rref">${esc(e.reference)}</span>`);
          if (e.remark) chips.push(`<div class="rmkr">${esc(e.remark)}</div>`);
        }
        const btn = canEdit && (!e || e.status !== 'REVIEWED') ? `<button type="button" class="btn sm ${e ? '' : 'yel'} radd" data-radd="${i}">${e ? 'Edit remark' : 'Add remark'}</button>` : '';
        const del = canEdit && e && e.status !== 'REVIEWED' ? `<button type="button" class="rlink" data-rdel="${i}">Remove</button>` : '';
        return `<div class="rwrap">${chips.join(' ')}${btn}${del}</div>`;
      }
      const v = e ? (e.remark || '') : '';           // legacy plain-text remarks (pre-32 database)
      return canEdit ? `<div class="rmkw"><input class="rmk" data-i="${i}" maxlength="500" placeholder="Add remarks (optional)" value="${esc(v)}" aria-label="Remarks for ${esc(r.item_code)}"><span class="rmks"></span></div>` : (v ? `<div class="rmkr">${esc(v)}</div>` : ''); };
    const SHORTL = { expected_qty: ['Expected', 'Exp.'], physical_qty: ['Physical', 'Phys.'], variance: ['Variance', 'Var.'] };      // the short form shows on narrower screens
    const heads = ['#', ...HEADS.map(k => CF.th(k, SHORTL[k] ? `<span class="lf">${SHORTL[k][0]}</span><span class="ls">${SHORTL[k][1]}</span>` : undefined)), ...(rmkOk ? ['Remarks'] : [])];
    const body = data.map((r, i) => { const v = Number(r.physical_qty) - Number(r.expected_qty), d = r.item_description || '';
      return `<tr class="${r.result === 'SHORT' ? 'rshort' : ''}"><td>${page * PS + i + 1}</td><td><b>${esc(r.item_code)}</b></td><td><span class="clamp" title="${esc(d)}">${esc(d)}</span></td><td>${ib(r.inventory_status)}</td><td>${esc(r.item_uom || '')}</td><td>${fn(r.expected_qty)}</td><td>${fn(r.physical_qty)}</td>
        <td class="${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}">${v > 0 ? '+' : ''}${fn(v)}</td><td>${esc(r.item_quality || '')}</td><td class="sno">${esc(r.item_sno || '—')}</td><td>${badge(r.result === 'MATCH' ? 'Matched' : r.result === 'SHORT' ? 'Short' : 'Excess', r.result === 'MATCH' ? 'ok' : r.result === 'SHORT' ? 'bad' : 'warn')}${r.is_unlisted ? ' ' + badge('Unlisted', 'bad') : ''}</td>${rmkOk ? `<td class="rmcell">${rbox(r, i) || '—'}</td>` : ''}</tr>`; }).join('');
    const pages = Math.max(1, Math.ceil(count / PS)), set = new Set([0, pages - 1, page - 1, page, page + 1]), shown = [...set].filter(x => x >= 0 && x < pages).sort((x, y) => x - y), nums = [];
    shown.forEach((x, i) => { if (i && x - shown[i - 1] > 1) nums.push('…'); nums.push(x); });
    rt.innerHTML = `<div class="tw"><table class="tbl rtbl"><colgroup>${WIDTHS.map(w => `<col style="width:${w}%">`).join('')}</colgroup><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
      ${data.length ? '' : '<div class="muted" style="padding:18px">No rows match the selected filters.</div>'}
      <div class="rfoot"><span class="muted">Showing ${count ? fn(page * PS + 1) : 0}–${fn(Math.min((page + 1) * PS, count))} of ${fn(count)} rows${count !== m.rows_all ? ` (Filtered from ${fn(m.rows_all)})` : ''}</span>
        <div class="pgn"><button type="button" class="pgb" data-pgn="${page - 1}" ${page ? '' : 'disabled'}>‹ Previous</button>${nums.map(x => x === '…' ? '<span class="pge">…</span>' : `<button type="button" class="pgb ${x === page ? 'on' : ''}" data-pgn="${x}">${x + 1}</button>`).join('')}<button type="button" class="pgb" data-pgn="${page + 1}" ${(page + 1) * PS < count ? '' : 'disabled'}>Next ›</button></div></div></div>`;
  }
  el.onclick = e => { if (CF.handle(e)) return;
    const rt3 = e.target.closest('[data-retry]'); if (rt3) { load(); return; }
    const ab = e.target.closest('[data-radd]'); if (ab) { openRemark(rows[+ab.dataset.radd]); return; }
    const db2 = e.target.closest('[data-rdel]'); if (db2) { delRemark(rows[+db2.dataset.rdel]); return; }
    const t = e.target.closest('#rtabs [data-ty]'); if (t) { tab = t.dataset.ty; sub = 'ALL'; page = 0; return load(); }
    const sb2 = e.target.closest('[data-sub]'); if (sb2) { sub = sb2.dataset.sub; page = 0; return load(); }
    const g = e.target.closest('[data-pgn]'); if (g && !g.disabled) { page = Number(g.dataset.pgn); load().then(() => el.querySelector('#rtabs').scrollIntoView({ block: 'start', behavior: 'smooth' })); } };
  el.onchange = async e => {
    const inp = e.target.closest('.rmk'); if (!inp) return; const r = rows[+inp.dataset.i], st = inp.parentElement.querySelector('.rmks'), val = inp.value.trim();
    if (!r || val === ((rmk[rkey(r)] || {}).remark || '')) return; st.textContent = 'Saving…'; st.className = 'rmks';
    const { error } = await sb.rpc('set_result_remark', { p_session: sid, p_item_code: r.item_code, p_status: r.inventory_status || '', p_quality: r.item_quality || '', p_sno: r.item_sno || '', p_remark: val });
    if (error) { st.textContent = 'Not saved'; st.className = 'rmks err'; toast(rpcMsg(error), 'err'); return; }
    if (val) rmk[rkey(r)] = Object.assign({}, rmk[rkey(r)], { remark: val }); else delete rmk[rkey(r)]; st.textContent = val ? 'Saved ✓' : 'Removed'; st.className = 'rmks ok'; setTimeout(() => { st.textContent = ''; }, 2500);
  };
  /* ---- structured shortage remark (database/32): category + quantity + reference, reviewed by management ---- */
  function openRemark(r) {
    if (!r) return; const e = rmk[rkey(r)]; const max = Number(r.short_qty) || 1;
    const body = `<div class="fld"><label>Item</label><div><b>${esc(r.item_code)}</b>${r.item_sno ? ` · SN ${esc(r.item_sno)}` : ''} · Short qty <b>${fn(max)}</b></div></div>
      <div class="fld"><label for="rk-cat">Remark category</label><div class="inp"><select id="rk-cat"><option value="">— Select —</option>${cats.filter(c => c.active).map(c => `<option value="${c.id}" ${e && e.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div></div>
      ${r.is_serialized ? '' : `<div class="fld"><label for="rk-qty">Quantity explained (max ${fn(max)})</label><div class="inp"><input id="rk-qty" type="number" min="0" step="any" max="${max}" value="${e && e.qty != null ? e.qty : max}"></div></div>`}
      <div class="fld" id="rk-refw"><label for="rk-ref" id="rk-refl">Reference</label><div class="inp"><input id="rk-ref" maxlength="200" value="${e ? esc(e.reference || '') : ''}"></div></div>
      <div class="fld"><label for="rk-note">Note (optional)</label><div class="inp"><input id="rk-note" maxlength="500" value="${e ? esc(e.remark || '') : ''}"></div></div>
      <p class="muted" style="font-size:12px;margin:2px 0 0">The shortage reduces only for the quantity management accepts after review.</p>`;
    const o = openModal('Shortage remark — ' + r.item_code, body, [cancelBtn, { label: 'Save remark', cls: 'yel', fn: async (ov) => {
      const cid = ov.querySelector('#rk-cat').value || null, ref = ov.querySelector('#rk-ref').value.trim(), note = ov.querySelector('#rk-note').value.trim();
      const qEl = ov.querySelector('#rk-qty'), qty = qEl ? Number(qEl.value) : max;
      const { error } = await sb.rpc('save_shortage_remark', { p_session: sid, p_item_code: r.item_code, p_status: r.inventory_status || '', p_quality: r.item_quality || '', p_sno: r.item_sno || '', p_category: cid, p_reference: ref, p_qty: isNaN(qty) ? max : qty, p_remark: note });
      if (error) { toast(rpcMsg(error), 'err'); return false; }
      rmk[rkey(r)] = { item_code: r.item_code, inventory_status: r.inventory_status || '', item_quality: r.item_quality || '', item_sno: r.item_sno || '', remark: note, category_id: cid, reference: ref || null, qty: isNaN(qty) ? max : qty, status: 'PENDING', accepted_qty: null };
      toast('Remark saved — sent for review.', 'ok'); load();
    } }]);
    const sel = o.querySelector('#rk-cat'), refW = o.querySelector('#rk-refw'), refL = o.querySelector('#rk-refl'), refI = o.querySelector('#rk-ref');
    const sync = () => { const c = cats.find(x => x.id === sel.value); if (!c) { refW.style.display = 'none'; return; } refW.style.display = ''; refL.textContent = c.ref_label + (c.ref_required ? ' *' : ' (optional)'); refI.placeholder = c.ref_label; };
    sel.onchange = sync; sync();
  }
  async function delRemark(r) {
    if (!r) return;
    const { error } = await sb.rpc('delete_shortage_remark', { p_session: sid, p_item_code: r.item_code, p_status: r.inventory_status || '', p_quality: r.item_quality || '', p_sno: r.item_sno || '' });
    if (error) { toast(rpcMsg(error), 'err'); return; }
    delete rmk[rkey(r)]; toast('Remark removed.', 'ok'); load();
  }
  el.querySelector('#q').oninput = e => { clearTimeout(timer); const v = e.target.value; timer = setTimeout(() => { q = v; page = 0; load(); }, 300); };
  el.querySelector('#vdl').onclick = e => downloadVariance(sid, (ss.stores && ss.stores.code) || 'store', (ss.audit_cycles && ss.audit_cycles.name) || 'cycle', e.currentTarget).catch(err => toast(friendlyError(err), 'err'));
  await load();
}

/* ---- store user: the Audit Cycle chip opens a list of cycles; pick one to see that cycle's result ---- */
if (!window.__cycHist) {
  window.__cycHist = true;
  document.addEventListener('click', async e => {
    const pop = document.getElementById('cyc-pop'), btn = e.target.closest('#cyc-btn');
    if (!pop) return;
    if (!btn) { if (!e.target.closest('#cyc-pop')) pop.hidden = true; return; }
    if (!pop.hidden) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
    pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); pop.innerHTML = '<div class="cyc-none">Loading cycles…</div>';
    const [c, ss] = await Promise.all([sb.from('audit_cycles').select('id,name,status,created_at').order('created_at', { ascending: false }), sb.from('audit_sessions').select('audit_cycle_id,status,submitted_at').order('version', { ascending: false })]);
    if (c.error || ss.error) { pop.innerHTML = '<div class="cyc-none">Could not load cycles.</div>'; return; }
    const by = {}; (ss.data || []).forEach(x => { const o = by[x.audit_cycle_id] = by[x.audit_cycle_id] || {}; if (x.status === 'LOCKED') o.locked = x; else if (x.status === 'IN_PROGRESS') o.prog = true; });
    const now = (S.ctx && S.ctx.cycle && S.ctx.cycle.id) || null, viewing = new URLSearchParams(location.hash.split('?')[1] || '').get('cycle');
    pop.innerHTML = `<div class="cyc-h">Audit cycles</div>` + (c.data.length ? c.data.map(x => { const o = by[x.id] || {}, act = x.id === now;
      const st = o.locked ? `<span class="cyc-s ok">Result • ${esc(fdt(o.locked.submitted_at))}</span>` : o.prog ? '<span class="cyc-s warn">In progress</span>' : '<span class="cyc-s">No audit</span>';
      const go = o.locked ? '#/result?cycle=' + x.id : act ? '#/dashboard' : '';
      return `<${go ? 'a href="' + go + '"' : 'div'} class="cyc-it ${go ? '' : 'off'} ${x.id === (viewing || now) ? 'on' : ''}"><span><b>${esc(x.name)}</b>${act ? '<em>Current</em>' : ''}</span>${st}</${go ? 'a' : 'div'}>`; }).join('') : '<div class="cyc-none">No cycles yet.</div>');
  });
  window.addEventListener('hashchange', () => { const pop = document.getElementById('cyc-pop'); if (pop) pop.hidden = true; });
}
