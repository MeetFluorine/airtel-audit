// My Profile (store users) / My Account (admin, circle head): details + change password.
PAGES.profile = async el => {
  const p = S.profile, staff = isStaff();
  const circle = staff ? (p.role === 'ADMIN' ? 'All circles' : (S.circles.map(c => c.code).join(', ') || '—')) : (S.store && S.store.circles ? S.store.circles.code : '—');
  const row = (l, id, v, ro = true) => `<label for="${id}">${l}</label><input id="${id}" value="${esc(v || '')}" ${ro ? 'disabled' : ''}>`;
  const info = `<div class="card" style="padding:22px"><div class="profgrid"><div class="prof-l"><span class="avatar lg">${esc(initials(p.full_name))}</span><h3>${esc(p.full_name)}</h3><span class="muted">${ROLE_LABEL[p.role]}</span></div>
    <form id="pf"><div class="formgrid">${row('Full Name', 'f_name', p.full_name, false)}${row('Employee ID', 'f_emp', p.employee_id)}${row('Email', 'f_mail', p.email)}${row('Mobile Number', 'f_mob', p.mobile, false)}
    ${staff ? row('Role', 'f_role', ROLE_LABEL[p.role]) : row('Assigned Store', 'f_store', S.store ? S.store.code : '—')}${row(staff ? 'Assigned Circle' : 'Circle', 'f_circ', circle)}</div>
    <button class="btn yel" type="submit" style="margin-top:18px;padding:12px 26px">Update Profile</button></form></div></div>`;
  const pw = `<div class="card" style="padding:22px"><h3 style="margin:0 0 14px">Change Password</h3><form id="pw"><div class="fld"><label>Current Password</label><div class="inp">${ic('key', 18)}<input id="p_cur" type="password" placeholder="Current password" autocomplete="current-password"></div></div>
    <div class="fld"><label>New Password</label><div class="inp">${ic('key', 18)}<input id="p_new" type="password" placeholder="New password (min 8 characters)" autocomplete="new-password"></div></div>
    <div class="fld"><label>Confirm New Password</label><div class="inp">${ic('key', 18)}<input id="p_cnf" type="password" placeholder="Confirm new password" autocomplete="new-password"></div></div>
    <button class="btn yel" type="submit" style="width:100%;padding:13px">Update Password</button></form></div>`;
  el.innerHTML = staff ? `<div class="acctgrid">${info}${pw}</div>` : `<div class="pagehead"><div><h1>My Profile</h1><p>View and manage your profile information.</p></div></div>${info}<div style="height:16px"></div>${pw}`;
  const g = id => el.querySelector('#' + id).value;
  el.querySelector('#pf').onsubmit = e => { e.preventDefault(); busy(e.target.querySelector('button'), async () => {
    const { error } = await sb.rpc('update_my_profile', { p_name: g('f_name').trim(), p_mobile: g('f_mob').trim() }); if (error) throw error; toast('Profile updated.', 'ok'); await loadProfile(); S.shellUser = null; route(); }).catch(x => toast(rpcMsg(x), 'err')); };
  el.querySelector('#pw').onsubmit = e => { e.preventDefault(); busy(e.target.querySelector('button'), async () => {
    if (g('p_new').length < 8) { toast('Password must be at least 8 characters.', 'err'); return; } if (g('p_new') !== g('p_cnf')) { toast('The new passwords do not match.', 'err'); return; }
    const chk = await sb.auth.signInWithPassword({ email: p.email, password: g('p_cur') }); if (chk.error) { toast('Current password is incorrect.', 'err'); return; }
    const { error } = await sb.auth.updateUser({ password: g('p_new') }); if (error) throw error; toast('Password updated.', 'ok'); el.querySelector('#pw').reset(); }).catch(x => toast(rpcMsg(x), 'err')); };
};
