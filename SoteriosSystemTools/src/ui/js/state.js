// Minimal shared state for cross-page data (e.g. the Dashboard's health
// score wants to know about the last scan run on the Scanner page, and the
// last password strength checked on the Passwords page). This is just an
// in-memory object — nothing persists across app restarts.

window.AppState = {
  lastScanSummary: null, // { totalScanned, clean, suspicious, matches, errors }
  lastPasswordScore: null // number 0-100
};
