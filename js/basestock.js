// Phase 2b: Base Stock upload wizard. Pure logic first (testable), UI below.
const BS_REQUIRED = ['item_code', 'inventory_status', 'item_description', 'item_qnty', 'item_quality', 'item_sno'];
const bsNorm = s => String(s ?? '').trim().toLowerCase().replace(/[\s.]+/g, '_');
const bsStr = v => String(v ?? '').trim();

// raw = array of row objects from SheetJS (first sheet, header row = keys)
function bsValidate(raw) {
  const out = { total: 0, valid: [], errors: [], dupSerial: 0, blankCode: 0, badQty: 0, ser: 0, non: 0, names: [], missing: [], warnings: [] };
  if (!raw.length) { out.missing = ['(no data rows found)']; return out; }
  const map = {}; Object.keys(raw[0]).forEach(k => { map[bsNorm(k)] = k; });
  out.missing = BS_REQUIRED.filter(h => !map[h]);
  if (out.missing.length) return out;
  if (!map.item_uom) out.warnings.push('Column Item_UoM not found - UoM will be blank.');
  const seen = new Set(), names = new Set();
  raw.forEach((r, i) => {
    const row = i + 2, v = k => (map[k] ? r[map[k]] : '');
    if (Object.values(r).every(x => bsStr(x) === '')) return;           // fully empty row: ignore silently
    out.total++;
    const sn = bsStr(v('item_sno')).toUpperCase() || null, code = bsStr(v('item_code')), qraw = v('item_qnty');
    const sub = bsStr(v('substore_name')); if (sub) names.add(sub);
    const err = issue => { out.errors.push({ row, issue, code, sno: sn || '' }); };
    if (!code) { out.blankCode++; return err('Blank Item_Code'); }
    const q = typeof qraw === 'number' ? qraw : Number(bsStr(qraw).replace(/,/g, ''));
    if (bsStr(qraw) === '' || !isFinite(q) || q < 0) { out.badQty++; return err('Invalid Item_Qnty'); }
    if (sn) { if (seen.has(sn)) { out.dupSerial++; return err('Duplicate serial number'); } seen.add(sn); out.ser++; if (q !== 1) out.warnings.push(`Row ${row}: serialized item with quantity ${q}`); }
    else out.non++;
    out.valid.push({ item_code: code, inventory_status: bsStr(v('inventory_status')) || null, item_description: bsStr(v('item_description')) || null,
      item_uom: bsStr(v('item_uom')) || null, item_qnty: Math.round(q * 100) / 100, item_quality: bsStr(v('item_quality')) || null, item_sno: sn });
  });
  out.names = [...names]; return out;
}
function bsNameCheck(names, store, all) {
  const n = s => s.trim().toLowerCase(), mine = new Set([store.code, store.report_name].filter(Boolean).map(n));
  if (!names.length) return { level: 'none' };
  if (names.length > 1) return { level: 'multi', names };
  if (mine.has(n(names[0]))) return { level: 'ok' };
  const other = all.find(s => s.id !== store.id && [s.code, s.report_name].filter(Boolean).map(n).includes(n(names[0])));
  return other ? { level: 'other', name: names[0], other } : { level: 'diff', name: names[0] };
}
// Excel exports often have an empty 'Info' sheet first: use the sheet that has the required headers (else the one with most rows).
function bsPickRows(X, wb) {
  let best = [], bestScore = -1;
  wb.SheetNames.forEach(n => {
    const rows = X.utils.sheet_to_json(wb.Sheets[n], { defval: '' });
    const heads = rows.length ? new Set(Object.keys(rows[0]).map(bsNorm)) : new Set();
    const score = BS_REQUIRED.filter(h => heads.has(h)).length * 1e6 + rows.length;
    if (score > bestScore) { bestScore = score; best = rows; }
  });
  return best;
}
if (typeof module !== 'undefined') module.exports = { bsValidate, bsNameCheck, bsPickRows };

/* ---------------- UI ---------------- */
if (typeof PAGES !== 'undefined') PAGES.basestock = async el => {
  const hq = new URLSearchParams((location.hash.split('?')[1]) || '');
  const [cy, allStores] = await Promise.all([sb.from('audit_cycles').select('id,name,status').in('status', ['DRAFT', 'ACTIVE']).order('created_at', { ascending: false }), getStores()]);
  if (cy.error) throw cy.error;
  const st = { cycle: hq.get('c') || '', store: hq.get('s') || '', acs: [], res: null, file: null, ok: false };
  const sById = id => allStores.find(s => s.id === id);
  el.innerHTML = `${cy.data.length ? '' : '<div class="alert warn">There is no active audit cycle yet. Create one in <a href="#/cycles">Audit Cycles</a> first.</div>'}<div class="card sec"><div class="step">1</div><b>Select audit cycle</b><select id="cyc"><option value="">Select cycle…</option>${cy.data.map(c => `<option value="${c.id}" ${c.id === st.cycle ? 'selected' : ''}>${esc(c.name)} (${c.status})</option>`).join('')}</select>
      <div class="step">2</div><b>Select store</b><select id="sto" disabled><option value="">Select store…</option></select><div id="sinfo"></div></div>
    <div class="card sec" id="s3" hidden><div class="step">3</div><b>Upload stock report (.xlsx / .xls)</b><input id="file" type="file" accept=".xlsx,.xls"><p class="muted">Only these columns are read: Item_Code, Inventory_Status, Item_Description, Item_UoM, Item_Qnty, Item_Quality, Item_SNo. Everything else is ignored.</p></div>
    <div id="s4"></div>`;
  const $ = id => el.querySelector('#' + id);

  async function loadCycle() {
    st.res = null; $('s4').innerHTML = ''; $('s3').hidden = true; $('sinfo').innerHTML = '';
    const sel = $('sto'); sel.disabled = !st.cycle; sel.innerHTML = '<option value="">Select store…</option>';
    if (!st.cycle) return;
    const { data, error } = await sb.from('audit_cycle_stores').select('store_id,active_upload_id,frozen_at').eq('audit_cycle_id', st.cycle); if (error) throw error;
    st.acs = data;
    const act = allStores.filter(s => s.active).sort((x, y) => (x.circles?.code || '').localeCompare(y.circles?.code || '') || x.code.localeCompare(y.code));
    const fz = new Set(data.filter(x => x.active_upload_id).map(x => x.store_id));
    sel.innerHTML += act.map(s => `<option value="${s.id}" ${s.id === st.store ? 'selected' : ''}>${esc(s.circles?.code || '')} · ${esc(s.name)} (${esc(s.code)})${fz.has(s.id) ? '  ✓ frozen' : ''}</option>`).join('');
    if (!act.some(s => s.id === st.store)) st.store = '';
    pickStore();
  }
  function pickStore() {
    st.res = null; $('s4').innerHTML = ''; const s = sById(st.store), a = st.acs.find(x => x.store_id === st.store);
    $('s3').hidden = !s; if (!s) return $('sinfo').innerHTML = '';
    $('file').value = '';
    $('sinfo').innerHTML = `<div class="kv"><div><span>Selected store</span><b>${esc(s.name)}</b></div><div><span>Store code</span><b>${esc(s.code)}</b></div><div><span>Circle</span><b>${esc(s.circles?.code || '')}</b></div>
      <div><span>Base stock</span><b>${a && a.active_upload_id ? '✓ Frozen' : 'Not uploaded'}</b></div></div>` +
      (a && a.active_upload_id ? '<div class="alert info">Base stock is already frozen for this store. You can upload a revised version only until its audit starts.</div>' : '');
  }
  $('cyc').onchange = e => { st.cycle = e.target.value; st.store = ''; loadCycle().catch(x => toast(rpcMsg(x), 'err')); };
  $('sto').onchange = e => { st.store = e.target.value; pickStore(); };
  if (st.cycle) await loadCycle();

  // ----- step 3 -> 4: parse, validate, store-name check -----
  $('file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return; st.file = f; st.res = null; const store = sById(st.store);
    $('s4').innerHTML = '<div class="boot">Reading file…</div>';
    try {
      if (!/\.(xlsx|xls)$/i.test(f.name)) throw new Error('Please upload an .xlsx or .xls file.');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const res = bsValidate(bsPickRows(XLSX, wb));
      if (res.missing.length) { $('s4').innerHTML = `<div class="alert err"><b>This file cannot be used.</b> Missing required column(s): ${res.missing.map(esc).join(', ')}.</div>`; return; }
      const chk = bsNameCheck(res.names, store, allStores);
      if (chk.level !== 'none' && chk.level !== 'ok') {
        const d = await askMismatch(chk, store); logWarn(chk, store, d, f.name);
        if (d === 'cancel') { $('file').value = ''; $('s4').innerHTML = ''; return; }
        if (d === 'save') { const { error } = await sb.rpc('set_store_report_name', { p_store: store.id, p_name: chk.name }); if (error) toast(rpcMsg(error), 'err'); else { store.report_name = chk.name; toast('Report name saved for this store.', 'ok'); } }
      }
      st.res = res; renderSummary(store);
    } catch (err) { $('s4').innerHTML = `<div class="alert err">${esc(err.message && err.message.startsWith('Please') ? err.message : 'Could not read this file. Make sure it is a valid Excel stock report.')}</div>`; console.error(err); }
  };
  const logWarn = (chk, store, decision, file) => sb.rpc('log_upload_event', { p_type: 'BASE_UPLOAD_WARNING', p_store: store.id, p_cycle: st.cycle, p_upload: null, p_meta: { file, level: chk.level, file_names: chk.names || [chk.name], decision } }).then(() => {}, () => {});

  function askMismatch(chk, store) {
    return new Promise(resolve => {
      const strong = chk.level !== 'diff'; let done = false; const fin = v => { done = true; resolve(v); };
      const msg = chk.level === 'multi' ? `This file contains <b>${chk.names.length} different store names</b> (${chk.names.slice(0, 5).map(esc).join(', ')}). It may be a combined report.`
        : chk.level === 'other' ? `This file says <b>${esc(chk.name)}</b>, which belongs to <b>${esc(chk.other.name)}</b> (${esc(chk.other.code)}), not the store you selected.`
        : `This file says <b>${esc(chk.name)}</b>, but you selected <b>${esc(store.name)}</b> (${esc(store.code)}).`;
      const o = openModal(strong ? '⚠ Check the store' : 'Store name differs', `<p>${msg}</p><p>All rows will be saved to <b>${esc(store.name)}</b> only, whatever the file says.</p>
        ${strong ? `<label class="chk"><input type="checkbox" id="m_ok"> I confirm this file belongs to ${esc(store.name)}</label>` : ''}`,
        [{ label: 'Cancel', fn: () => fin('cancel') }, ...(chk.level === 'diff' ? [{ label: `Save "${chk.name}" as this store's report name`, fn: () => fin('save') }] : []),
         { label: 'Continue without saving', cls: 'primary', fn: () => fin('continue') }]);
      const go = o.querySelector('.ma .primary'); if (strong) { go.disabled = true; o.querySelector('#m_ok').onchange = e => (go.disabled = !e.target.checked); }
      o.addEventListener('remove', () => { if (!done) fin('cancel'); });
    });
  }

  function renderSummary(store) {
    const r = st.res, cyc = cy.data.find(c => c.id === st.cycle);
    const k = (l, v, c = '') => `<div class="${c}"><span>${l}</span><b>${v}</b></div>`;
    $('s4').innerHTML = `<div class="card sec"><div class="step">4</div><b>Validation result</b>
      <div class="kv">${k('Selected store', esc(store.name))}${k('Circle', esc(store.circles?.code || ''))}${k('Audit cycle', esc(cyc.name))}${k('Rows in file', r.total.toLocaleString())}${k('Valid rows', r.valid.length.toLocaleString(), 'g')}
        ${k('Serialized items', r.ser.toLocaleString())}${k('Non-serialized rows', r.non.toLocaleString())}${k('Errors', r.errors.length, r.errors.length ? 'r' : '')}${k('Duplicate serials', r.dupSerial, r.dupSerial ? 'r' : '')}${k('Blank Item Code', r.blankCode, r.blankCode ? 'r' : '')}${k('Invalid quantity', r.badQty, r.badQty ? 'r' : '')}</div>
      ${r.warnings.slice(0, 5).map(w => `<div class="alert warn">${esc(w)}</div>`).join('')}
      ${r.errors.length ? `<details open><summary>${r.errors.length} row(s) with errors (they will NOT be imported)</summary>${tbl(['Excel row', 'Issue', 'Item code', 'Serial'], r.errors.slice(0, 200).map(x => `<tr><td>${x.row}</td><td>${esc(x.issue)}</td><td>${esc(x.code)}</td><td>${esc(x.sno)}</td></tr>`).join(''))}${r.errors.length > 200 ? '<p class="muted">Showing the first 200.</p>' : ''}</details>
        <label class="chk"><input type="checkbox" id="okerr"> I understand ${r.errors.length} invalid row(s) will not be imported.</label>` : ''}
      <div class="step">5</div><b>Confirm &amp; freeze</b><div id="prog"></div>
      <button class="btn primary" id="go" ${r.valid.length && !r.errors.length ? '' : 'disabled'}>FREEZE BASE STOCK</button></div>`;
    const go = $('go'); if ($('okerr')) $('okerr').onchange = e => (go.disabled = !(e.target.checked && r.valid.length));
    go.onclick = () => openModal('Freeze base stock?', `<p>${r.valid.length.toLocaleString()} rows will be saved for <b>${esc(store.name)}</b> in <b>${esc(cyc.name)}</b> and frozen.</p><p class="muted">Store users never see this data. Once their audit starts, it cannot be replaced.</p>`,
      [cancelBtn, { label: 'Freeze', cls: 'primary', fn: () => { setTimeout(() => run(store).catch(e => { $('prog').innerHTML = `<div class="alert err">${esc(rpcMsg(e))}</div>`; }), 0); } }]);
  }

  async function run(store) {
    const r = st.res, f = st.file, c = st.cycle, p = $('prog'), go = $('go'); go.disabled = true;
    const say = t => (p.innerHTML = `<div class="alert info">${esc(t)}</div>`);
    let uid = null;
    try {
      say('Preparing…');
      const old = await sb.from('base_stock_uploads').select('id').eq('audit_cycle_id', c).eq('store_id', store.id).eq('status', 'DRAFT');
      for (const d of old.data || []) { await sb.from('base_stock').delete().eq('upload_id', d.id); await sb.from('base_stock_uploads').delete().eq('id', d.id); }
      const vr = await sb.from('base_stock_uploads').select('version').eq('audit_cycle_id', c).eq('store_id', store.id).order('version', { ascending: false }).limit(1);
      const ins = await sb.from('base_stock_uploads').insert({ audit_cycle_id: c, store_id: store.id, version: ((vr.data && vr.data[0]?.version) || 0) + 1, source_file_name: f.name }).select('id').single();
      if (ins.error) throw ins.error; uid = ins.data.id;
      for (let i = 0; i < r.valid.length; i += 500) {
        say(`Saving rows ${Math.min(i + 500, r.valid.length).toLocaleString()} / ${r.valid.length.toLocaleString()}…`);
        const { error } = await sb.from('base_stock').insert(r.valid.slice(i, i + 500).map(x => ({ ...x, upload_id: uid, audit_cycle_id: c, store_id: store.id })));
        if (error) throw error;
      }
      say('Saving original file…');
      const path = `${c}/${store.id}/${uid}.${f.name.split('.').pop().toLowerCase()}`;
      const up = await sb.storage.from('base-stock-files').upload(path, f, { upsert: true });
      if (up.error) toast('Rows saved, but the original file backup failed.', 'err');
      await sb.from('base_stock_uploads').update({ source_file_path: up.error ? null : path, rows_uploaded: r.total, rows_valid: r.valid.length, serialized_count: r.ser, non_serialized_count: r.non,
        error_summary: { errors: r.errors.length, duplicate_serials: r.dupSerial, blank_codes: r.blankCode, invalid_qty: r.badQty } }).eq('id', uid);
      await sb.rpc('log_upload_event', { p_type: 'BASE_UPLOADED', p_store: store.id, p_cycle: c, p_upload: uid, p_meta: { file: f.name, rows: r.total, valid: r.valid.length, errors: r.errors.length } });
      say('Freezing…');
      const fz = await sb.rpc('freeze_base_stock', { p_upload_id: uid }); if (fz.error) throw fz.error;
    } catch (e) {
      if (uid) { await sb.from('base_stock').delete().eq('upload_id', uid); await sb.from('base_stock_uploads').delete().eq('id', uid); }   // never leave a half-written draft
      go.disabled = false; throw e;
    }
    const okHtml = `<div class="card sec"><div class="alert ok"><b>✓ Base Stock Frozen</b> for ${esc(store.name)}: ${r.valid.length.toLocaleString()} rows (${r.ser.toLocaleString()} serialized, ${r.non} non-serialized).</div></div>`;
    st.store = store.id; await loadCycle(); $('s4').innerHTML = okHtml;
  }
};
