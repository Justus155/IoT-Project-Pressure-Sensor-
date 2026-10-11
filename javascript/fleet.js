// javascript/fleet.js
const client = window.createAquaGuardClient();

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

document.getElementById('signout-btn').addEventListener('click', async () => {
  await client.auth.signOut();
  window.location.href = '../logins/index.html';
});

document.getElementById('fleet-tbody').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-device-id]');
  if (btn) {
    window.location.href = `dashboard.html?device=${encodeURIComponent(btn.dataset.deviceId)}`;
  }
});

(async function init() {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return (window.location.href = '../logins/index.html');

  const { data: profile } = await client
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  const role = String(profile?.role ?? '').trim().toLowerCase();
  if (role === 'admin') return (window.location.href = 'admin.html');
  if (role !== 'wsp') return (window.location.href = 'dashboard.html');

  // Only pull the newest reading and open alerts per device instead of full history.
  const { data: devices, error } = await client
    .from('devices')
    .select(`
      *,
      sensor_readings ( value, timestamp ),
      alerts ( id, status )
    `)
    .eq('owner_id', user.id)
    .eq('alerts.status', 'open')
    .order('timestamp', { referencedTable: 'sensor_readings', ascending: false })
    .limit(1, { referencedTable: 'sensor_readings' })
    .order('pipe_number', { ascending: true });

  const tbody = document.getElementById('fleet-tbody');
  const count = document.getElementById('fleet-count');

  if (error || !devices) {
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="7" class="muted">Could not load devices.</td></tr>`;
    return;
  }

  count.textContent = `${devices.length} device${devices.length === 1 ? '' : 's'}`;

  if (devices.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">No devices paired yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = devices.map((d) => {
    const lastReading = (d.sensor_readings || [])[0];
    const lastValue = lastReading ? Number(lastReading.value) : NaN;
    const openAlerts = (d.alerts || []).length;

    return `
      <tr>
        <td><strong>${esc(d.pipe_number)}</strong></td>
        <td>${esc(d.sensor_id)}</td>
        <td>${esc(d.location ?? '—')}</td>
        <td><span class="badge ${d.status === 'active' ? 'online' : 'offline'}">${esc(d.status ?? '—')}</span></td>
        <td>${Number.isFinite(lastValue) ? `${lastValue.toFixed(1)} PSI` : '—'}</td>
        <td>${openAlerts > 0 ? `<span class="badge assigned">${openAlerts}</span>` : '0'}</td>
        <td class="td-actions">
          <button type="button" class="btn-ghost btn-small" data-device-id="${esc(d.id)}">View</button>
        </td>
      </tr>`;
  }).join('');
})();
