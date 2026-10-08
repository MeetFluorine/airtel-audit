const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, type = 'info') {
  const d = document.createElement('div');
  d.className = 't ' + type; d.textContent = msg;
  document.getElementById('toast').appendChild(d);
  setTimeout(() => d.remove(), 4500);
}

// Never show raw database/auth errors to users.
function friendlyError(e) {
  console.error(e);
  const m = ((e && e.message) || '').toLowerCase();
  if (m.includes('invalid login')) return 'Incorrect email or password.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'An account with this email already exists. Log in or reset your password.';
  if (m.includes('password should be')) return 'Password must be at least 8 characters.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Please wait a minute and try again.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Network connection interrupted. Please check your internet and try again.';
  if (m.includes('jwt') || m.includes('expired')) return 'Your session has expired. Please log in again.';
  if (e && e.code === '42501') return 'You do not have permission to perform this action.';
  return 'Something went wrong. Please try again.';
}

async function busy(btn, fn) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Please wait…';
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}
