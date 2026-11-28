(function attachHelpFeedback(root) {
  const FEEDBACK_URL = 'https://chrisriv10.github.io/Soterios/feedback/';
  const SECTIONS = Object.freeze({
    bug: 'bug-reports',
    feature: 'feature-requests',
    general: 'general-feedback',
    security: 'security',
    documentation: 'documentation'
  });
  const VERSION_PATTERN = /^(?:v)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

  function buildUrl(category, appVersion) {
    const section = SECTIONS[category];
    if (!section) throw new TypeError('Unsupported feedback category.');

    const destination = new URL(FEEDBACK_URL);
    if (typeof appVersion === 'string' && VERSION_PATTERN.test(appVersion)) {
      destination.searchParams.set('appVersion', appVersion);
    }
    destination.hash = section;
    return destination.toString();
  }

  const api = Object.freeze({ buildUrl });
  if (root) root.SoteriosHelpFeedback = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
