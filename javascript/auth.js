const SUPABASE_URL = 'https://vtsqsqpkatarmfsntjoi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0c3FzcXBrYXRhcm1mc250am9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MjEzMzYsImV4cCI6MjEwNTI5NzMzNn0.cQrDvMbfcA7_OPScc13LAt1OwKEEkSNubLl8_nbDNVQ';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const tabButtons = document.querySelectorAll('.tab-btn');
const tabLinks = document.querySelectorAll('[data-tab-link]');
const formsTrack = document.querySelector('.forms-track');
const formsWindow = document.querySelector('.forms-window');
const forms = {
  signin: document.querySelector('#signin-form'),
  signup: document.querySelector('#signup-form')
};
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
  const selectedForm = forms[tabName] || forms.signin;
  const isSignUp = selectedForm === forms.signup;

  formsTrack.style.transform = isSignUp ? 'translateX(-50%)' : 'translateX(0)';
  formsWindow.style.height = `${selectedForm.scrollHeight}px`;

  Object.entries(forms).forEach(([name, form]) => {
    form.classList.toggle('active', name === (isSignUp ? 'signup' : 'signin'));
    form.setAttribute('aria-hidden', name === (isSignUp ? 'signup' : 'signin') ? 'false' : 'true');
  });

  tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === (isSignUp ? 'signup' : 'signin');
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });

  if (updateUrl) {
    history.replaceState(null, '', `#${isSignUp ? 'signup' : 'signin'}`);
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
      data: {
        full_name: fullName,
        phone,
        role
      }
    }
  });

  setFormLoading(forms.signup, false);

  if (error) {
    showStatus(error.message, 'error');
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

switchTab(window.location.hash === '#signup' ? 'signup' : 'signin', false);