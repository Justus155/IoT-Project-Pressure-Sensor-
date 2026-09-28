const SUPABASE_URL = 'https://vtsqsqpkatarmfsntjoi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0c3FzcXBrYXRhcm1mc250am9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MjEzMzYsImV4cCI6MjEwNTI5NzMzNn0.cQrDvMbfcA7_OPScc13LAt1OwKEEkSNubLl8_nbDNVQ';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const form = document.querySelector('#reset-form');
const statusBanner = document.querySelector('#status-banner');

function showStatus(message, type) {
  statusBanner.textContent = message;
  statusBanner.className = `status-banner ${type}`;
}

function setFormLoading(isLoading) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = isLoading;
  button.querySelector('.btn-label').classList.toggle('hidden', isLoading);
  button.querySelector('.spinner').classList.toggle('hidden', !isLoading);
}

document.querySelectorAll('.toggle-pw').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.target);
    const isVisible = input.type === 'text';
    input.type = isVisible ? 'password' : 'text';
    button.textContent = isVisible ? 'show' : 'hide';
  });
});

(async function init() {
  const linkError = new URLSearchParams(window.location.hash.slice(1)).get('error')
    || new URLSearchParams(window.location.search).get('error');

  // getSession() waits for the client to finish reading the recovery token from the URL.
  const { data } = await supabaseClient.auth.getSession();

  if (linkError || !data.session) {
    showStatus('This reset link is invalid or has expired. Please request a new one from the log in page.', 'error');
    return;
  }

  history.replaceState(null, '', window.location.pathname);
  form.classList.remove('hidden');
})();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showStatus('', 'hidden');

  const password = document.querySelector('#reset-password').value;
  const confirmPassword = document.querySelector('#reset-confirm-password').value;

  if (password !== confirmPassword) {
    showStatus('Passwords do not match.', 'error');
    return;
  }

  setFormLoading(true);
  const { error } = await supabaseClient.auth.updateUser({ password });

  if (error) {
    setFormLoading(false);
    showStatus(error.message, 'error');
    return;
  }

  await supabaseClient.auth.signOut();
  window.location.href = 'index.html?reset=success#signin';
});
