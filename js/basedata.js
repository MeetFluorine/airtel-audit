// Store-level base data setup: a STORE USER uploads and freezes the base stock of THEIR OWN store for an open audit cycle.
// Re-uses the validation from basestock.js. Every write goes through server functions (store_base_*) that take the store from the login;
// store users still cannot read base stock rows. Only the first upload is allowed: later revisions stay with Admin / Circle Head.
PAGES.basedata = async el => {
  if (isStaff()) { location.hash = '#/basestock'; return; }
  const { data: info, error } = await sb.rpc('store_open_cycles'); if (error) throw error;
  const cycles = info.cycles || [], storeId = info.store_id, me = S.store || {};
  if (!cycles.length) {
    el.innerHTML = `<div class="card startcard"><span class="big">${ic('cal', 44, 1.5)}</span><h2>No audit cycle is open</h2><p class="muted">Base data can only be set up for an open audit cycle. Ask your administrator to create one.</p></div>`; return;
  }
  const st = { cycle: cycles[0].id, res: null, file: null };
  const cur = () => cycles.find(c => c.id === st.cycle);
  el.innerHTML = `<div class="card sec"><div class="step">1</div><b>Audit cycle</b><select id="bd-cyc">${cycles.map(c => `<option value="${c.id}">${esc(c.name)}${c.base_frozen ? '  ✓ base data uploaded' : ''}</option>`).join('')}</select>
      <div class="kv"><div><span>Your store</span><b>${esc(me.name || '')}</b></div><div><span>Store code</span><b>${esc(me.code || '')}</b></div><div><span>Circle</span><b>${esc(me.circles?.code || '')}</b></div><div><span>Base data</span><b id="bd-state"></b></div></div><div id="bd-note"></div></div>
    <div class="card sec" id="bd-s2" hidden><div class="step">2</div><b>Upload your store's stock report (.xlsx / .xls)</b><input id="bd-file" type="file" accept=".xlsx,.xls">
      <p class="muted">Only these columns are read: Item_Code, Inventory_Status, Item_Description, Item_UoM, Item_Qnty, Item_Quality, Item_SNo. Everything else is ignored. This is the stock your audit will be compared against, so use the correct system report for <b>${esc(me.code || 'your store')}</b>.</p></div>
    <div id="bd-s3"></div>`;
  const $ = id => el.querySelector('#' + id);

  function paint() {
    const c = cur(); st.res = null; $('bd-s3').innerHTML = ''; $('bd-file').value = '';
    $('bd-state').textContent = c.base_frozen ? '✓ Uploaded' : 'Not uploaded';
    $('bd-s2').hidden = c.base_frozen;
    $('bd-note').innerHTML = c.base_frozen
      ? `<div class="alert ok">Base data for <b>${esc(c.name)}</b> was uploaded${c.frozen_at ? ' on ' + esc(fdt(c.frozen_at)) : ''}. ${c.audit_started ? 'Your audit has started.' : 'You can start your audit now.'} To change the base data, ask your Circle Head or Admin.</div>${c.audit_started ? '' : `<p><a class="btn yel" href="#/audit">Go to Start Audit</a></p>`}`
      : '<div class="alert info">Base data has not been uploaded for your store in this cycle yet. Upload it below, then you can start your audit. Once uploaded it is frozen: only your Circle Head or Admin can change it.</div>';
  }
  $('bd-cyc').onchange = e => { st.cycle = e.target.value; paint(); };
  paint();

  // confirm a store-name difference (store users cannot save report names, so this is confirm-or-cancel only)
  const confirmName = (names, mine) => new Promise(resolve => {
    let done = false; const fin = v => { done = true; resolve(v); };
    const o = openModal('Check the store', `<p>This file says <b>${esc(names[0])}</b>, but your store is <b>${esc(mine.name || mine.code)}</b> (${esc(mine.code)}).</p>
      <p>All rows will be saved to <b>${esc(mine.name || mine.code)}</b> only, whatever the file says.</p><label class="chk"><input type="checkbox" id="m_ok"> I confirm this file belongs to my store</label>`,
      [{ label: 'Cancel', fn: () => fin(false) }, { label: 'Continue', cls: 'primary', fn: () => fin(true) }]);
    const go = o.querySelector('.ma .primary'); go.disabled = true; o.querySelector('#m_ok').onchange = e => (go.disabled = !e.target.checked);
    o.addEventListener('remove', () => { if (!done) fin(false); });
  });
  const logEv = (type, meta) => sb.rpc('log_upload_event', { p_type: type, p_store: storeId, p_cycle: st.cycle, p_upload: null, p_meta: meta }).then(() => {}, () => {});

  $('bd-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return; st.file = f; st.res = null; $('bd-s3').innerHTML = universeLoader();
    try {
      if (!/\.(xlsx|xls)$/i.test(f.name)) throw new Error('Please upload an .xlsx or .xls file.');
      await loadXlsx();
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const res = bsValidate(bsPickRows(XLSX, wb));
      if (res.missing.length || res.errors.length) logEv('VALIDATION_FAILED', { file: f.name, missing: res.missing, errors: res.errors.length, duplicate_serials: res.dupSerial, blank_codes: res.blankCode, invalid_qty: res.badQty });
      if (res.missing.length) { $('bd-s3').innerHTML = `<div class="alert err"><b>This file cannot be used.</b> Missing required column(s): ${res.missing.map(esc).join(', ')}.</div>`; return; }
      const chk = bsNameCheck(res.names, { id: storeId, code: me.code || '', report_name: me.name || '' }, []);
      if (chk.level === 'multi') { logEv('BASE_UPLOAD_WARNING', { file: f.name, level: 'multi', file_names: chk.names, decision: 'blocked' });
        $('bd-s3').innerHTML = `<div class="alert err"><b>This file has ${chk.names.length} different store names</b> (${chk.names.slice(0, 5).map(esc).join(', ')}). It looks like a combined report. Please upload only your own store's stock report.</div>`; $('bd-file').value = ''; return; }
      if (chk.level === 'diff') { const ok = await confirmName([chk.name], me); logEv('BASE_UPLOAD_WARNING', { file: f.name, level: 'diff', file_names: [chk.name], decision: ok ? 'continue' : 'cancel' });
        if (!ok) { $('bd-file').value = ''; $('bd-s3').innerHTML = ''; return; } }
      st.res = res; summary();
    } catch (err) { $('bd-s3').innerHTML = `<div class="alert err">${esc(err.message && err.message.startsWith('Please') ? err.message : 'Could not read this file. Make sure it is a valid Excel stock report.')}</div>`; console.error(err); }
  };

  function summary() {
    const r = st.res, c = cur(), k = (l, v, cl = '') => `<div class="${cl}"><span>${l}</span><b>${v}</b></div>`, bad = r.errors.length > 0;
    $('bd-s3').innerHTML = `<div class="card sec"><div class="step">3</div><b>Validation result</b>
      <div class="kv">${k('Audit cycle', esc(c.name))}${k('Rows in file', r.total.toLocaleString())}${r.skipped ? k('Raj_SS_Temp removed', r.skipped.toLocaleString()) : ''}${k('Valid rows', r.valid.length.toLocaleString(), 'g')}${k('Serialized items', r.ser.toLocaleString())}${k('Non-serialized rows', r.non.toLocaleString())}
        ${k('Errors', r.errors.length, bad ? 'r' : '')}${k('Duplicate serials', r.dupSerial, r.dupSerial ? 'r' : '')}${k('Blank Item Code', r.blankCode, r.blankCode ? 'r' : '')}${k('Invalid quantity', r.badQty, r.badQty ? 'r' : '')}</div>
      ${r.warnings.slice(0, 5).map(w => `<div class="alert warn">${esc(w)}</div>`).join('')}
      ${bad ? `<div class="alert err"><b>Fix these rows in your file and upload it again.</b> Base data cannot be saved while it has errors.</div><details open><summary>${r.errors.length} row(s) with errors</summary>${tbl(['Excel row', 'Issue', 'Item code', 'Serial'], r.errors.slice(0, 200).map(x => `<tr><td>${x.row}</td><td>${esc(x.issue)}</td><td>${esc(x.code)}</td><td>${esc(x.sno)}</td></tr>`).join(''))}${r.errors.length > 200 ? '<p class="muted">Showing the first 200.</p>' : ''}</details>` : ''}
      <div class="step">4</div><b>Confirm &amp; save</b><div id="bd-prog"></div>
      <button class="btn primary" id="bd-go" ${r.valid.length && !bad ? '' : 'disabled'}>SAVE BASE DATA</button></div>`;
    $('bd-go').onclick = () => openModal('Save base data?', `<p>${r.valid.length.toLocaleString()} rows will be saved for <b>${esc(me.name || me.code)}</b> in <b>${esc(c.name)}</b> and frozen.</p><p class="muted">You will not be able to replace it yourself afterwards. Only your Circle Head or Admin can change it.</p>`,
      [cancelBtn, { label: 'Save', cls: 'primary', fn: () => { setTimeout(() => run().catch(e => { $('bd-prog').innerHTML = `<div class="alert err">${esc(rpcMsg(e))}</div>`; }), 0); } }]);
  }

  async function run() {
    const r = st.res, f = st.file, c = st.cycle, p = $('bd-prog'), go = $('bd-go'); go.disabled = true;
    const say = t => (p.innerHTML = `<div class="alert info">${esc(t)}</div>`); let uid = null;
    try {
      say('Preparing…');
      const b = await sb.rpc('store_base_begin', { p_cycle: c, p_file: f.name }); if (b.error) throw b.error; uid = b.data;
      for (let i = 0; i < r.valid.length; i += 500) {
        say(`Saving rows ${Math.min(i + 500, r.valid.length).toLocaleString()} / ${r.valid.length.toLocaleString()}…`);
        const x = await sb.rpc('store_base_rows', { p_upload: uid, p_rows: r.valid.slice(i, i + 500) }); if (x.error) throw x.error;
      }
      say('Saving original file…');
      const path = `${c}/${storeId}/${uid}.${f.name.split('.').pop().toLowerCase()}`;
      const up = await sb.storage.from('base-stock-files').upload(path, f, { upsert: true });
      if (up.error) toast('Rows saved, but the original file backup failed.', 'err');
      say('Saving…');
      const fin = await sb.rpc('store_base_finish', { p_upload: uid, p_path: up.error ? '' : path, p_rows_uploaded: r.total,
        p_errors: { errors: r.errors.length, duplicate_serials: r.dupSerial, blank_codes: r.blankCode, invalid_qty: r.badQty } }); if (fin.error) throw fin.error;
    } catch (e) {
      if (uid) await sb.rpc('store_base_discard', { p_upload: uid }).then(() => {}, () => {});     // never leave a half-written draft
      go.disabled = false; throw e;
    }
    const x = cycles.find(z => z.id === c); x.base_frozen = true; x.frozen_at = new Date().toISOString();
    $('bd-cyc').innerHTML = cycles.map(z => `<option value="${z.id}" ${z.id === c ? 'selected' : ''}>${esc(z.name)}${z.base_frozen ? '  ✓ base data uploaded' : ''}</option>`).join('');
    paint();
    $('bd-s3').innerHTML = `<div class="card sec"><div class="alert ok"><b>✓ Base data saved</b> for ${esc(me.name || me.code)}: ${r.valid.length.toLocaleString()} rows (${r.ser.toLocaleString()} serialized, ${r.non} non-serialized).</div>
      <p><a class="btn yel" href="#/audit">Go to Start Audit</a></p></div>`;
    if (typeof fillTop === 'function') fillTop();
  }
};
