// ============================================================
// AquaGuard — Auth Handler
// Handles sign in, sign up, password reset, and role-based routing
// ============================================================

const SUPABASE_URL = 'https://vtsqsqpkatarmfsntjoi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0c3FzcXBrYXRhcm1mc250am9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MjEzMzYsImV4cCI6MjEwNTI5NzMzNn0.cQrDvMbfcA7_OPScc13LAt1OwKEEkSNubLl8_nbDNVQ';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ------------------------------------------------------------
// DOM References
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// UI Helpers
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// Role Resolution
// Normalizes role casing so 'Admin', 'admin', 'ADMIN', ' Admin '
// all resolve to the same thing. Falls back to is_admin() RPC if
// RLS blocks direct reads of the profiles table.
// ------------------------------------------------------------
async function fetchUserRole(client, userId) {
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    console.error('Could not read your profile row:', profileError);
  } else if (!profile) {
    console.warn(
      'No profiles row could be read for your account. ' +
      'Run sql/fix_admin_routing.sql in the Supabase SQL Editor.'
    );
  }

  const role = String(profile?.role ?? '').trim().toLowerCase();
  if (role) return role;

  // Fallback: SECURITY DEFINER function that bypasses RLS
  const { data: isAdmin, error: rpcError } = await client.rpc('is_admin');
  if (rpcError) {
    console.warn('is_admin() fallback unavailable:', rpcError.message);
    return null;
  }
  return isAdmin ? 'admin' : null;
}

// ------------------------------------------------------------
// Role-Based Redirect
// Admin  → admin console
// WSP    → dashboard
// Others → dashboard
// Paths are resolved relative to the current page, so this works
// whether you're on /index.html, /logins/index.html, etc.
// ------------------------------------------------------------
async function goToDashboard() {
  try {
    const { data } = await supabaseClient.auth.getSession();
    const userId = data.session?.user.id;

    if (userId) {
      const role = await fetchUserRole(supabaseClient, userId);

      if (role === 'admin') {
        window.location.href = '../dashboard/admin.html';
        return;
      } else if (role === 'wsp') {
        window.location.href = '../dashboard/dashboard.html';
        return;
      }
    }
  } catch (err) {
    console.error('Role check failed, defaulting to dashboard:', err);
  }

  // Default fallback — homeowner / unauthenticated role
  window.location.href = '../dashboard/dashboard.html';
}

// ------------------------------------------------------------
// Tab Switching
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// Event Listeners — Tabs & Password Toggles
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// SIGN IN
// ------------------------------------------------------------
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

  await goToDashboard();
});

// ------------------------------------------------------------
// SIGN UP
// ------------------------------------------------------------
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

  // Create the profile row ourselves (don't rely on a trigger).
  // The `ignoreDuplicates: true` flag guarantees we never overwrite
  // an existing admin's role if they re-signup with the same email.
  const { error: profileError } = await supabaseClient
    .from('profiles')
    .upsert(
      {
        id: data.user.id,
        name: fullName,
        phone: phone || null,
        role: role === 'WSP' ? 'WSP' : 'HomeOwner'
      },
      { onConflict: 'id', ignoreDuplicates: true }
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
    await goToDashboard();
    return;
  }

  showStatus('Account created. Check your email to confirm your account, then sign in.', 'success');
  switchTab('signin');
});

// ------------------------------------------------------------
// FORGOT PASSWORD
// ------------------------------------------------------------
forms.forgot.addEventListener('submit', async (event) => {
  event.preventDefault();
  showStatus('', 'hidden');
  setFormLoading(forms.forgot, true);

  const email = document.querySelector('#forgot-email').value.trim();

  // Step 1: does an account with this email exist?
  const { data: exists, error: lookupError } = await supabaseClient.rpc(
    'email_exists',
    { p_email: email }
  );

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

  // Step 2: account exists — send the reset link
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: new URL('/logins/reset-password.html', window.location.origin).href
  });

  setFormLoading(forms.forgot, false);

  if (error) {
    console.error('Password reset request failed:', error);

    if (error.status === 429 || /rate limit/i.test(error.message)) {
      showStatus('Too many reset emails requested. Please wait a while and try again.', 'error');
    } else if (/error sending/i.test(error.message)) {
      showStatus('Could not send the email right now. Please try again in a few minutes.', 'error');
    } else {
      showStatus(error.message, 'error');
    }
    return;
  }

  showStatus('Reset link sent. Check your email and follow the link to set a new password.', 'success');
});

// ------------------------------------------------------------
// Window resize — re-fit the form container
// ------------------------------------------------------------
window.addEventListener('resize', () => {
  const activeForm = document.querySelector('.auth-form.active');
  if (activeForm) formsWindow.style.height = `${activeForm.scrollHeight}px`;
});

// ------------------------------------------------------------
// Initial state — restore tab from URL hash
// ------------------------------------------------------------
switchTab(window.location.hash.slice(1), false);

if (new URLSearchParams(window.location.search).get('reset') === 'success') {
  history.replaceState(null, '', window.location.pathname);
  showStatus('Password updated. Sign in with your new password.', 'success');
}

// ------------------------------------------------------------
// Handle email confirmation redirect
// If Supabase auto-created a session from a confirmation link,
// sign them out and land them on the sign-in tab cleanly.
// ------------------------------------------------------------
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

  history.replaceState(null, '', window.location.pathname);

  switchTab('signin', false);
  showStatus('Email confirmed! Please sign in to continue.', 'success');
})();