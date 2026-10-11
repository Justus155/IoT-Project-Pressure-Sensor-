// javascript/config.js
// Single source of truth for Supabase credentials.
// Import this in every page instead of hardcoding keys.

window.AQUAGUARD_CONFIG = {
  SUPABASE_URL: 'https://vtsqsqpkatarmfsntjoi.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0c3FzcXBrYXRhcm1mc250am9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MjEzMzYsImV4cCI6MjEwNTI5NzMzNn0.cQrDvMbfcA7_OPScc13LAt1OwKEEkSNubLl8_nbDNVQ',
  APP_NAME: 'AquaGuard',
  ZONES: {
    NORMAL:   { min: 0,  max: 60,  label: 'Normal',   color: '#22c55e' },
    WARNING:  { min: 60, max: 85,  label: 'Warning',  color: '#facc15' },
    CRITICAL: { min: 85, max: 100, label: 'Critical', color: '#ef4444' }
  }
};

// Shared Supabase client factory
window.createAquaGuardClient = function () {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.AQUAGUARD_CONFIG;
  if (!window.supabase) {
    console.error('Supabase library not loaded — include the CDN script before config.js');
    return null;
  }
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
};
