// ════════════════════════════════════════════════════════════════════════════
// appconfig.js — Joolry Daily App
// ─────────────────────────────────────────────────────────────────────────
// SIRF YAHAN GAS_URL CHANGE KARO — index.html ya app.js mein kuch nahi
// ════════════════════════════════════════════════════════════════════════════

window.APP_CONFIG = {

  // ── GAS Web App URL ────────────────────────────────────────────────────
  // Har nayi deployment ke baad sirf yahan update karo
  // TODO: Deploy new GAS and paste URL here
  GAS_URL: '',   // not used any more — browser talks to /api/rpc only

  // ── App Info ────────────────────────────────────────────────────────────
  APP_NAME:    'Joolry Daily',
  APP_VERSION: '1.0',
  APP_COMPANY: 'Joolry',

  // ── Session ─────────────────────────────────────────────────────────────
  SESSION_KEY:     'joolry_session_v1',
  SESSION_HOURS:   168,   // 7 days; can still override via AppConfig sheet

  // ── API Timeouts ─────────────────────────────────────────────────────────
  DEFAULT_TIMEOUT: 30000,   // 30s
  LONG_TIMEOUT:    60000,   // 60s for analytics / checklist generate

  // ── Polling ─────────────────────────────────────────────────────────────
  POLL_INTERVAL:   30000,   // 30s badge / uptime poll

};

// Convenience shortcut — app.js uses window.GAS_URL
window.GAS_URL = window.APP_CONFIG.GAS_URL;


// Firebase client (Phase 2 live version) — Project settings → Web app se bharo
window.FIREBASE_WEB = {
  apiKey: 'PASTE_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'PASTE',
  appId: 'PASTE'
};




