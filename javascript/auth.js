const SUPABASE_URL = 'https://vtsqsqpkatarmfsntjoi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0c3FzcXBrYXRhcm1mc250am9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MjEzMzYsImV4cCI6MjEwNTI5NzMzNn0.cQrDvMbfcA7_OPScc13LAt1OwKEEkSNubLl8_nbDNVQ';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const tabButtons = document.querySelectorAll('.tab-btn');
const tabLinks = document.querySelectorAll('[data-tab-link]');
const formsTrack = document.querySelector('.forms-track');
const formsWindow = document.querySelector('.forms-window');
const forms = {
  signin: document.querySelector('#signin-form'),
  signup: document.querySelector('#signup-form'),
  forgot: document.querySelector('#forgot-form')
};
const formOrder = ['signin', 'signup', 'forgot'];
const statusBanner = document.querySelector('#status-banner');

function showStatus(message, type) {
  statusBanner.textContent = message;
  statusBanner.className = `status-banner ${type}`;
}

function setFormLoading(form, isLoading) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = isLoading;
  button.querySelector('.btn-label').classList.toggle('hidden', isLoading);
  button.querySelector('.spinner').classList.toggle('hidden', !isLoading);
}

function goToDashboard() {
  window.location.href = '../dashboard/dashboard.html';
}

function switchTab(tabName, updateUrl = true) {
  const activeName = formOrder.includes(tabName) ? tabName : 'signin';
  const selectedForm = forms[activeName];
  const offset = (formOrder.indexOf(activeName) * 100) / formOrder.length;

  formsTrack.style.transform = `translateX(-${offset}%)`;
  formsWindow.style.height = `${selectedForm.scrollHeight}px`;

  Object.entries(forms).forEach(([name, form]) => {
    form.classList.toggle('active', name === activeName);
    form.setAttribute('aria-hidden', name === activeName ? 'false' : 'true');
  });

  // The forgot form has no tab of its own, so keep "Log In" highlighted.
  const activeTab = activeName === 'signup' ? 'signup' : 'signin';
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === activeTab;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });

  if (updateUrl) {
    history.replaceState(null, '', `#${activeName}`);
  }
}

tabButtons.forEach((button) => {
  button.setAttribute('role', 'tab');
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

tabLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    switchTab(link.dataset.tabLink);
  });
});

document.querySelectorAll('.toggle-pw').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.target);
    const isVisible = input.type === 'text';
    input.type = isVisible ? 'password' : 'text';
    button.textContent = isVisible ? 'show' : 'hide';
  });
});

forms.signin.addEventListener('submit', async (event) => {
  event.preventDefault();
  showStatus('', 'hidden');
  setFormLoading(forms.signin, true);

  const email = document.querySelector('#signin-email').value.trim();
  const password = document.querySelector('#signin-password').value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  setFormLoading(forms.signin, false);

  if (error) {
    showStatus(error.message, 'error');
    return;
  }

  goToDashboard();
});

forms.signup.addEventListener('submit', async (event) => {
  event.preventDefault();
  showStatus('', 'hidden');
  setFormLoading(forms.signup, true);

  const password = document.querySelector('#signup-password').value;
  const confirmPassword = document.querySelector('#signup-confirm-password').value;

  if (password !== confirmPassword) {
    setFormLoading(forms.signup, false);
    showStatus('Passwords do not match.', 'error');
    return;
  }

  const email = document.querySelector('#signup-email').value.trim();
  const fullName = document.querySelector('#signup-name').value.trim();
  const phone = document.querySelector('#signup-phone').value.trim();
  const role = document.querySelector('#signup-role').value;

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      // Explicitly pin the confirmation link to this exact page,
      // regardless of what "Site URL" is set to in the Supabase
      // dashboard. window.location here is index.html itself, since
      // that's where the sign-up form lives.
      emailRedirectTo: window.location.origin + window.location.pathname,
      data: {
        name: fullName,
        full_name: fullName,
        phone,
        role
      }
    }
  });

  if (error) {
    setFormLoading(forms.signup, false);
    showStatus(error.message, 'error');
    return;
  }

  // Create the profile row ourselves instead of relying on a database
  // trigger. This runs client-side, so any failure here shows up
  // directly in the browser console (F12) instead of being buried in
  // Postgres logs behind a generic "Database error saving new user".
  const { error: profileError } = await supabaseClient
    .from('profiles')
    .upsert(
      {
        id: data.user.id,
        name: fullName,
        phone: phone || null,
        role: role === 'WSP' ? 'WSP' : role === 'Admin' ? 'Admin' : 'HomeOwner'
      },
      { onConflict: 'id' }
    );

  setFormLoading(forms.signup, false);

  if (profileError) {
    console.error('Profile creation failed:', profileError);
    showStatus(
      'Account created, but saving your profile failed. Open the browser console (F12) for details.',
      'error'
    );
    return;
  }

  if (data.session) {
    goToDashboard();
    return;
  }

  showStatus('Account created. Check your email to confirm your account, then sign in.', 'success');
  switchTab('signin');
});

window.addEventListener('resize', () => {
  const activeForm = document.querySelector('.auth-form.active');
  if (activeForm) formsWindow.style.height = `${activeForm.scrollHeight}px`;
});

forms.forgot.addEventListener('submit', async (event) => {
  event.preventDefault();
  showStatus('', 'hidden');
  setFormLoading(forms.forgot, true);

  const email = document.querySelector('#forgot-email').value.trim();
  const { data: exists, error: lookupError } = await supabaseClient.rpc('email_exists', { p_email: email });

  if (lookupError) {
    setFormLoading(forms.forgot, false);
    console.error('Email lookup failed:', lookupError);
    showStatus('Could not verify that email right now. Please try again.', 'error');
    return;
  }

  if (!exists) {
    setFormLoading(forms.forgot, false);
    showStatus('No account exists with that email address.', 'error');
    return;
  }

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: new URL('reset-password.html', window.location.href).href
  });

  setFormLoading(forms.forgot, false);

  if (error) {
    showStatus(error.message, 'error');
    return;
  }

  showStatus('Reset link sent. Check your email and follow the link to set a new password.', 'success');
});

switchTab(window.location.hash.slice(1), false);

if (new URLSearchParams(window.location.search).get('reset') === 'success') {
  history.replaceState(null, '', window.location.pathname);
  showStatus('Password updated. Sign in with your new password.', 'success');
}

// ============================================================
// Handle landing here via an email confirmation link.
// Supabase automatically creates a session when the confirmation
// link is clicked — but we want the person to land on the sign-in
// FORM, not be silently logged straight into the dashboard. So: if
// the URL shows clear signs of being a confirmation redirect, sign
// them back out, clean up the URL, and show a message instead.
// ============================================================
(async function handleEmailConfirmationRedirect() {
  const searchParams = new URLSearchParams(window.location.search);
  const hash = window.location.hash;

  const looksLikeConfirmation =
    hash.includes('type=signup') ||
    hash.includes('access_token') ||
    searchParams.get('type') === 'signup' ||
    searchParams.has('code');

  if (!looksLikeConfirmation) return;

  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    await supabaseClient.auth.signOut();
  }

  // Strip the confirmation tokens out of the address bar so a
  // refresh doesn't re-trigger this, and so the URL looks clean.
  history.replaceState(null, '', window.location.pathname);

  switchTab('signin', false);
  showStatus('Email confirmed! Please sign in to continue.', 'success');
})();