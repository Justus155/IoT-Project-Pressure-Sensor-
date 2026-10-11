// ============================================================
// AquaGuard — Reset Password Handler
//
// Supabase sends reset emails with either:
//   • A `#access_token=...&type=recovery` hash (legacy)
//   • A `?code=...` query string (PKCE flow, current default)
//
// This script waits for the session to be established by
// supabase-js, then reveals the form. If no valid token exists,
// it shows an error and offers a link back to "Forgot password".
// ============================================================

(function () {
  const client = window.createAquaGuardClient();
  const form = document.getElementById('reset-form');
  const banner = document.getElementById('status-banner');
  const loading = document.getElementById('loading-state');
  const btn = document.getElementById('reset-btn');

  // ------------------------------------------------------------
  // UI helpers
  // ------------------------------------------------------------
  function showStatus(msg, type) {
    banner.textContent = msg;
    banner.className = `status-banner ${type}`;
  }

  function setLoading(isLoading) {
    btn.disabled = isLoading;
    btn.querySelector('.btn-label').classList.toggle('hidden', isLoading);
    btn.querySelector('.spinner').classList.toggle('hidden', !isLoading);
  }

  function showForm() {
    loading.classList.add('hidden');
    form.classList.remove('hidden');
    form.classList.add('active');
    // Strip recovery tokens from the address bar; supabase-js has already stored the session.
    history.replaceState(null, '', window.location.pathname);
  }

  function showError(message) {
    loading.classList.add('hidden');
    form.classList.add('hidden');
    showStatus(message, 'error');
  }

  // ------------------------------------------------------------
  // Password visibility toggles
  // ------------------------------------------------------------
  document.querySelectorAll('.toggle-pw').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.target);
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      button.textContent = visible ? 'show' : 'hide';
    });
  });

  // ------------------------------------------------------------
  // Wait for Supabase to process the recovery token.
  //
  // supabase-js parses the URL automatically and fires an
  // `onAuthStateChange` event with a session. We listen for that
  // (with a timeout fallback) before showing the form.
  // ------------------------------------------------------------
  function waitForSession() {
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      let listener = null;

      function finish(session) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        listener?.subscription.unsubscribe();
        resolve(session);
      }

      // 1. Listen for the event fired by token parsing
      ({ data: listener } = client.auth.onAuthStateChange((event, session) => {
        if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
          finish(session);
        }
      }));

      // 2. Check immediately — the session may already be set
      client.auth.getSession().then(({ data }) => {
        if (data?.session) finish(data.session);
      });

      // 3. Timeout — if nothing fires in 5 s, no valid token
      timer = setTimeout(() => finish(null), 5000);
    });
  }

  // ------------------------------------------------------------
  // Form submission
  // ------------------------------------------------------------
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showStatus('', 'hidden');

    const pw = document.getElementById('reset-password').value;
    const confirm = document.getElementById('reset-confirm-password').value;

    if (pw !== confirm) {
      showStatus('Passwords do not match.', 'error');
      return;
    }

    if (pw.length < 8) {
      showStatus('Password must be at least 8 characters.', 'error');
      return;
    }

    setLoading(true);
    const { error } = await client.auth.updateUser({ password: pw });

    if (error) {
      setLoading(false);
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

    showStatus('Password updated! Redirecting to sign in…', 'success');

    // Sign out so the user is forced to log in with the new password
    setTimeout(async () => {
      await client.auth.signOut();
      window.location.href = 'index.html?reset=success#signin';
    }, 1500);
  });

  // ------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------
  (async function boot() {
    const invalidMsg =
      'This reset link is invalid or has expired. Please request a new one from the sign-in page.';

    // Supabase reports expired/used links as error=... in the URL — no need to wait.
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const queryParams = new URLSearchParams(window.location.search);
    if (hashParams.get('error') || queryParams.get('error')) {
      showError(invalidMsg);
      return;
    }

    const session = await waitForSession();

    if (!session) {
      showError(invalidMsg);
      return;
    }

    showForm();
    document.getElementById('reset-password').focus();
  })();
})();