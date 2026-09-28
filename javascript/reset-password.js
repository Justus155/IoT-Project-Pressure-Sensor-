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

// ------------------------------------------------------------
// Decide whether to show the form or an "invalid link" message
// ------------------------------------------------------------
let formShown = false;

function showForm() {
  if (formShown) return;
  formShown = true;
  showStatus('', 'hidden');
  form.classList.remove('hidden');
  // Remove the recovery tokens from the address bar. The session has
  // already been stored by supabase-js at this point.
  history.replaceState(null, '', window.location.pathname);
}

function showInvalidLink() {
  if (formShown) return;
  showStatus(
    'This reset link is invalid or has expired. Go back to Log In and request a new one.',
    'error'
  );
}

// Fires when supabase-js reads a recovery token out of the URL.
supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY' && session) showForm();
});

(async function init() {
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const queryParams = new URLSearchParams(window.location.search);

  // Supabase reports expired/used links as error=... in the URL.
  if (hashParams.get('error') || queryParams.get('error')) {
    showInvalidLink();
    return;
  }

  // getSession() waits for the client to finish processing the URL.
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    showForm();
    return;
  }

  // Short grace period in case the recovery event lands just after.
  setTimeout(showInvalidLink, 1500);
})();

// ------------------------------------------------------------
// Submit new password
// ------------------------------------------------------------
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
    console.error('Password update failed:', error);

    if (/session/i.test(error.message)) {
      showStatus('Your reset session has expired. Go back to Log In and request a new link.', 'error');
    } else if (/different from the old password/i.test(error.message)) {
      showStatus('Choose a password you have not used before.', 'error');
    } else {
      showStatus(error.message, 'error');
    }
    return;
  }

  // End the temporary recovery session so they log in with the new password.
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html?reset=success#signin';
});