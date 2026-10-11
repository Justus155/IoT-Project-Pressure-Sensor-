// javascript/settings.js
const client = window.createAquaGuardClient();
let currentUser = null;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function roleLabel(role) {
  const r = String(role ?? '').trim().toLowerCase();
  if (r === 'wsp') return 'Water Service Provider';
  if (r === 'admin') return 'Admin';
  return r ? 'Home Owner' : '—';
}

(async function init() {
  const { data: { user } } = await client.auth.getUser();
  if (!user) {
    window.location.href = '../logins/index.html';
    return;
  }
  currentUser = user;

  const { data: profile } = await client
    .from('profiles')
    .select('name, phone, role')
    .eq('id', user.id)
    .maybeSingle();

  document.getElementById('settings-email').value = user.email;
  document.getElementById('settings-name').value = profile?.name ?? '';
  document.getElementById('settings-phone').value = profile?.phone ?? '';
  document.getElementById('settings-role').value = roleLabel(profile?.role);

  document.getElementById('user-name').textContent = profile?.name || user.email;
  document.getElementById('user-role').textContent = roleLabel(profile?.role);
  document.getElementById('user-avatar').textContent = (profile?.name || user.email || '?')[0].toUpperCase();

  await loadDevices();
})();

async function loadDevices() {
  const { data, error } = await client
    .from('devices')
    .select('*')
    .eq('owner_id', currentUser.id);

  const list = document.getElementById('devices-list');
  if (error) {
    console.error(error);
    list.innerHTML = '<p class="muted">Couldn\'t load your devices. Please refresh.</p>';
    return;
  }
  if (!data || data.length === 0) {
    list.innerHTML = '<p class="muted">No devices paired yet. Use "Pair Device" to add one.</p>';
    return;
  }

  // Device fields are user/device-supplied, so escape before injecting.
  list.innerHTML = data.map((d) => `
    <div style="padding: 12px 0; border-bottom: 1px solid var(--border-light);">
      <strong>Pipe ${esc(d.pipe_number)}</strong> — Sensor ${esc(d.sensor_id)}<br />
      <span class="muted">${esc(d.location ?? 'No location')} · ${esc(d.status ?? '—')} · installed ${esc(d.install_date ?? '—')}</span>
    </div>
  `).join('');
}

document.getElementById('save-profile-btn').addEventListener('click', async () => {
  const btn = document.getElementById('save-profile-btn');
  const banner = document.getElementById('settings-banner');
  btn.disabled = true;
  btn.querySelector('.btn-label').classList.add('hidden');
  btn.querySelector('.spinner').classList.remove('hidden');

  const name = document.getElementById('settings-name').value.trim();
  const phone = document.getElementById('settings-phone').value.trim();

  const { error } = await client
    .from('profiles')
    .update({ name, phone: phone || null })
    .eq('id', currentUser.id);

  btn.disabled = false;
  btn.querySelector('.btn-label').classList.remove('hidden');
  btn.querySelector('.spinner').classList.add('hidden');

  if (error) {
    banner.textContent = error.message;
    banner.className = 'status-banner error';
  } else {
    banner.textContent = 'Profile updated.';
    banner.className = 'status-banner success';
    document.getElementById('user-name').textContent = name || currentUser.email;
    document.getElementById('user-avatar').textContent = (name || currentUser.email || '?')[0].toUpperCase();
  }
});

document.getElementById('signout-btn').addEventListener('click', async () => {
  await client.auth.signOut();
  window.location.href = '../logins/index.html';
});
