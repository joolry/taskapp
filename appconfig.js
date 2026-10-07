// ════════════════════════════════════════════════════════════════════════════
// appconfig.js — Joolry Daily App
// ─────────────────────────────────────────────────────────────────────────
// SIRF YAHAN GAS_URL CHANGE KARO — index.html ya app.js mein kuch nahi
// ════════════════════════════════════════════════════════════════════════════

window.APP_CONFIG = {

  // ── GAS Web App URL ────────────────────────────────────────────────────
  // Har nayi deployment ke baad sirf yahan update karo
  // TODO: Deploy new GAS and paste URL here
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwf7wqYzNXPRq4FVX93dH5tXDhpoXfRHAsFl422RHzKR639Rxsr8VFYbpLM-GwSlaqk/exec',

  // ── App Info ────────────────────────────────────────────────────────────
  APP_NAME:    'Joolry Daily',
  APP_VERSION: '1.0',
  APP_COMPANY: 'Joolry',

  // ── Session ─────────────────────────────────────────────────────────────
  SESSION_KEY:     'joolry_session_v1',
  SESSION_HOURS:   12,    // overridden by AppConfig from server

  // ── API Timeouts ─────────────────────────────────────────────────────────
  DEFAULT_TIMEOUT: 30000,   // 30s
  LONG_TIMEOUT:    60000,   // 60s for analytics / checklist generate

  // ── Polling ─────────────────────────────────────────────────────────────
  POLL_INTERVAL:   30000,   // 30s badge / uptime poll

};

// Convenience shortcut — app.js uses window.GAS_URL
window.GAS_URL = window.APP_CONFIG.GAS_URL;
