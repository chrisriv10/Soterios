import {
  ProtectionEvent, ProtectionVerdict, RuntimeRequest, SettingsV2, failure,
  isRuntimeRequest, response
} from './contracts';
import { analyzePassword, checkAndRememberReuse, checkHibpPassword, generateCredential } from './credential';
import { registrableDomain } from './domains';
import { checkFeed, feedStatus } from './feed';
import { clearHistory, getHistory, recordFinding } from './history';
import { inspectCredentialDestination, inspectUrl } from './heuristics';
import {
  PROVIDERS, beginProviderRequest, cancelAllProviders, cancelProvider, checkGoogleUrl,
  finishProviderRequest, noteProviderContact, providerDescriptors,
  revokeProviderPermission, scheduledFeedUpdate, setGoogleKey
} from './providers';
import {
  DEFAULT_SETTINGS, DISPLAY_KEY, SETTINGS_KEY, getDisplaySettings, getSettings,
  initializeStorage, providerEnabled, setSettings
} from './settings';

const CONTENT_SCRIPT_ID = 'soterios-protection-v2';
const CONTENT_ORIGINS = ['http://*/*', 'https://*/*'];
const FEED_ALARM = 'soterios-feed-update-v2';
const RETENTION_ALARM = 'soterios-history-retention-v2';
const NATIVE_HOST = 'com.soterios.credential_safety';
const DESKTOP_NOTICE_COOLDOWN_MS = 10 * 60 * 1000;
const desktopNoticeTimes = new Map<string, number>();

let ready = initialize();

async function initialize(): Promise<void> {
  const { settings } = await initializeStorage();
  await chrome.alarms.create(FEED_ALARM, { periodInMinutes: 6 * 60 });
  await chrome.alarms.create(RETENTION_ALARM, { periodInMinutes: 24 * 60 });
  const hasSiteAccess = await chrome.permissions.contains({ origins: CONTENT_ORIGINS });
  if (settings.continuousAccess && hasSiteAccess) {
    await syncContentScriptRegistration(true);
  } else if (settings.continuousAccess && settings.onboarding.confirmedAt && !hasSiteAccess) {
    settings.continuousAccess = false;
    await setSettings(settings);
    await syncContentScriptRegistration(false);
  }
}

async function syncContentScriptRegistration(enabled: boolean): Promise<void> {
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const registered = existing.some((entry) => entry.id === CONTENT_SCRIPT_ID);
  if (enabled && !registered) {
    await chrome.scripting.registerContentScripts([{
      id: CONTENT_SCRIPT_ID,
      matches: CONTENT_ORIGINS,
      js: ['content.js'],
      allFrames: true,
      runAt: 'document_idle',
      persistAcrossSessions: true
    }]);
  } else if (!enabled && registered) {
    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  }
}

function randomRequestId(prefix = 'evt'): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function senderAllowed(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  if (!sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:' || url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) { return false; }
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function senderUrl(sender: chrome.runtime.MessageSender): Promise<{ url: string; incognito: boolean }> {
  if (sender.tab?.url) return { url: sender.tab.url, incognito: Boolean(sender.tab.incognito) };
  const tab = await activeTab();
  return { url: tab?.url || '', incognito: Boolean(tab?.incognito) };
}

function sitePauseState(settings: SettingsV2, domain: string): 'active' | 'paused' {
  const rule = settings.sites[domain];
  if (!rule) return 'active';
  if (rule.pausedUntil === null) return 'paused';
  return Date.parse(rule.pausedUntil) > Date.now() ? 'paused' : 'active';
}

async function makeVerdict(urlValue: string, settings: SettingsV2, includeGoogle: boolean): Promise<ProtectionVerdict> {
  const now = new Date().toISOString();
  let url: URL;
  try { url = new URL(urlValue); } catch (_) {
    return { verdict: 'unknown', confidence: 'none', source: 'local', reasons: ['UNSUPPORTED_PAGE'], checkedAt: now, expiresAt: null, feedVersion: null };
  }
  const domain = registrableDomain(url.hostname);
  if (sitePauseState(settings, domain) === 'paused') {
    return { verdict: 'unknown', confidence: 'none', source: 'local', reasons: ['SITE_PAUSED'], checkedAt: now, expiresAt: settings.sites[domain]?.pausedUntil || null, feedVersion: null };
  }

  const status = await feedStatus();
  const feedMatch = await checkFeed(urlValue);
  if (feedMatch) {
    return {
      verdict: 'danger', confidence: 'high', source: 'feed',
      reasons: [feedMatch.category === 'phishing' ? 'SIGNED_FEED_PHISHING' : 'SIGNED_FEED_MALWARE'],
      checkedAt: now, expiresAt: status.expiresAt, feedVersion: feedMatch.version
    };
  }
  const heuristicFindings = inspectUrl(urlValue);
  let googleReasons: string[] = [];
  if (includeGoogle && providerEnabled(settings, 'googleSafeBrowsing')) {
    const permitted = await chrome.permissions.contains({ origins: [...PROVIDERS.googleSafeBrowsing.origins] });
    if (permitted) {
      try { googleReasons = (await checkGoogleUrl(urlValue)).map((type) => `GOOGLE_${type}`); }
      catch (_) { googleReasons = ['GOOGLE_CHECK_FAILED']; }
    }
  }
  if (googleReasons.some((reason) => reason !== 'GOOGLE_CHECK_FAILED')) {
    return { verdict: 'danger', confidence: 'high', source: 'googleSafeBrowsing', reasons: googleReasons, checkedAt: now, expiresAt: null, feedVersion: status.version };
  }
  if (heuristicFindings.length) {
    return { verdict: 'warning', confidence: 'medium', source: 'local', reasons: heuristicFindings.map(({ code }) => code), checkedAt: now, expiresAt: null, feedVersion: status.version };
  }
  if (settings.onboarding.confirmedAt && settings.onlineServices.enabled && settings.onlineServices.feed) {
    const feedProvider = (await providerDescriptors(settings)).find((provider) => provider.id === 'feed');
    if (feedProvider?.health === 'error' || feedProvider?.health === 'permission_required') {
      return { verdict: 'unknown', confidence: 'none', source: 'feed', reasons: [feedProvider.health === 'error' ? 'FEED_UPDATE_FAILED' : 'FEED_PERMISSION_REQUIRED'], checkedAt: now, expiresAt: status.expiresAt, feedVersion: status.version };
    }
  }
  if (status.stale || (settings.onlineServices.feed && !settings.onboarding.confirmedAt)) {
    return { verdict: 'unknown', confidence: 'none', source: 'feed', reasons: [status.stale ? 'FEED_STALE' : 'ONLINE_SETUP_REQUIRED'], checkedAt: now, expiresAt: status.expiresAt, feedVersion: status.version };
  }
  if (googleReasons.includes('GOOGLE_CHECK_FAILED')) {
    return { verdict: 'unknown', confidence: 'none', source: 'combined', reasons: googleReasons, checkedAt: now, expiresAt: status.expiresAt, feedVersion: status.version };
  }
  return { verdict: 'clear', confidence: 'medium', source: 'combined', reasons: [], checkedAt: now, expiresAt: status.expiresAt, feedVersion: status.version };
}

function eventFromVerdict(verdict: ProtectionVerdict, domain: string): ProtectionEvent | null {
  if (verdict.verdict !== 'warning' && verdict.verdict !== 'danger') return null;
  return {
    id: randomRequestId(), timestamp: new Date().toISOString(),
    category: verdict.verdict === 'danger' ? 'phishing' : 'site_advisory',
    severity: verdict.verdict, domain, reasonCodes: verdict.reasons, resolution: 'open'
  };
}

async function notifyDesktop(event: ProtectionEvent, settings: SettingsV2): Promise<void> {
  if (!settings.desktop.sharingEnabled) return;
  const permitted = await chrome.permissions.contains({ permissions: ['nativeMessaging'] });
  if (!permitted) return;
  const key = `${event.category}|${event.severity}|${event.domain}|${[...event.reasonCodes].sort().join(',')}`;
  const now = Date.now();
  for (const [priorKey, timestamp] of desktopNoticeTimes) {
    if (now - timestamp >= DESKTOP_NOTICE_COOLDOWN_MS) desktopNoticeTimes.delete(priorKey);
  }
  if (desktopNoticeTimes.has(key)) return;
  try {
    await chrome.runtime.sendNativeMessage(NATIVE_HOST, {
      protocol: 2, requestId: randomRequestId('native'), type: 'REPORT_FINDING',
      payload: {
        category: event.category, severity: event.severity, domain: event.domain,
        ...(event.prevalenceCount ? { prevalenceCount: event.prevalenceCount } : {})
      }
    });
    desktopNoticeTimes.set(key, now);
  } catch (_) {}
}

async function updateSettingsFromPayload(payload: unknown): Promise<SettingsV2> {
  if (!payload || typeof payload !== 'object') throw new Error('Settings payload is required.');
  const prior = await getSettings();
  const patch = payload as Record<string, unknown>;
  const next: SettingsV2 = JSON.parse(JSON.stringify(prior));
  if (typeof patch.credentialProtection === 'boolean') next.credentialProtection = patch.credentialProtection;
  if (typeof patch.continuousAccess === 'boolean') next.continuousAccess = patch.continuousAccess;
  if (patch.onlineServices && typeof patch.onlineServices === 'object') {
    for (const key of ['enabled', 'hibp', 'feed', 'googleSafeBrowsing'] as const) {
      const value = (patch.onlineServices as Record<string, unknown>)[key];
      if (typeof value === 'boolean') next.onlineServices[key] = value;
    }
  }
  if (patch.history && typeof patch.history === 'object' && typeof (patch.history as Record<string, unknown>).enabled === 'boolean') {
    next.history.enabled = (patch.history as { enabled: boolean }).enabled;
  }
  if (patch.desktop && typeof patch.desktop === 'object' && typeof (patch.desktop as Record<string, unknown>).sharingEnabled === 'boolean') {
    next.desktop.sharingEnabled = (patch.desktop as { sharingEnabled: boolean }).sharingEnabled;
  }

  // Persist the network gate before cancelling/removing permissions so alarms
  // and restarted workers observe the disabled state immediately.
  await setSettings(next);
  if (!next.onlineServices.enabled) {
    cancelAllProviders();
    await Promise.allSettled((Object.keys(PROVIDERS) as Array<keyof typeof PROVIDERS>).map(revokeProviderPermission));
  } else {
    for (const id of Object.keys(PROVIDERS) as Array<keyof typeof PROVIDERS>) {
      if (!next.onlineServices[id]) {
        cancelProvider(id);
        await revokeProviderPermission(id).catch(() => false);
      }
    }
  }
  return next;
}

async function handleRequest(request: RuntimeRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const settings = await getSettings();
  switch (request.type) {
    case 'GET_SETTINGS':
      return { settings, display: await getDisplaySettings() };
    case 'GET_PROVIDER_DESCRIPTORS':
      return providerDescriptors(settings);
    case 'GET_STATE': {
      const location = await senderUrl(sender);
      const domain = (() => { try { return registrableDomain(new URL(location.url).hostname); } catch (_) { return ''; } })();
      const verdict = location.url ? await makeVerdict(location.url, settings, true) : null;
      const providers = await providerDescriptors(settings);
      const feed = await feedStatus();
      let desktop = 'not_enabled';
      if (settings.desktop.sharingEnabled) {
        const permission = await chrome.permissions.contains({ permissions: ['nativeMessaging'] });
        desktop = permission ? 'configured' : 'permission_required';
      }
      return { settings, display: await getDisplaySettings(), domain, verdict, providers, feed, desktop };
    }
    case 'UPDATE_SETTINGS':
      return { settings: await updateSettingsFromPayload(request.payload), providers: await providerDescriptors(await getSettings()) };
    case 'CONFIRM_ONBOARDING': {
      const payload = (request.payload || {}) as { hibp?: boolean; feed?: boolean; googleSafeBrowsing?: boolean; continuousAccess?: boolean };
      const next = await updateSettingsFromPayload({ onlineServices: {
        enabled: true, hibp: payload.hibp !== false, feed: payload.feed !== false,
        googleSafeBrowsing: payload.googleSafeBrowsing === true
      }, ...(typeof payload.continuousAccess === 'boolean' ? { continuousAccess: payload.continuousAccess } : {}) });
      if (typeof payload.continuousAccess === 'boolean') {
        const granted = payload.continuousAccess && await chrome.permissions.contains({ origins: CONTENT_ORIGINS });
        next.continuousAccess = granted;
        await setSettings(next);
        await syncContentScriptRegistration(granted);
      }
      next.onboarding.confirmedAt = new Date().toISOString();
      next.onboarding.disclosureVersion = 2;
      next.onboarding.reuseResetNoticePending = false;
      await setSettings(next);
      if (providerEnabled(next, 'feed')) void scheduledFeedUpdate(next);
      return { settings: next, providers: await providerDescriptors(next) };
    }
    case 'REQUEST_CONTINUOUS_ACCESS': {
      const requested = (request.payload as { granted?: unknown } | undefined)?.granted === true;
      const granted = requested && await chrome.permissions.contains({ origins: CONTENT_ORIGINS });
      const next = await getSettings();
      next.continuousAccess = granted;
      await setSettings(next);
      await syncContentScriptRegistration(granted);
      return { granted };
    }
    case 'REVOKE_CONTINUOUS_ACCESS': {
      await syncContentScriptRegistration(false);
      const removed = await chrome.permissions.remove({ origins: CONTENT_ORIGINS });
      const next = await getSettings();
      next.continuousAccess = false;
      await setSettings(next);
      return { removed };
    }
    case 'RUN_ON_DEMAND': {
      const tab = await activeTab();
      if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw Object.assign(new Error('Open an HTTP or HTTPS page first.'), { code: 'NOT_FOUND' });
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] });
      return { injected: true };
    }
    case 'ANALYZE_PASSWORD': {
      const password = String((request.payload as { password?: string })?.password || '');
      if (password.length > 1024) throw new Error('Password input is too long.');
      return analyzePassword(password);
    }
    case 'GENERATE_PASSWORD':
      return { value: generateCredential((request.payload || {}) as Parameters<typeof generateCredential>[0]) };
    case 'CHECK_PASSWORD': {
      const password = String((request.payload as { password?: string })?.password || '');
      if (!password || password.length > 1024) throw new Error('Enter a password of 1–1024 characters.');
      const strength = analyzePassword(password);
      if (!providerEnabled(settings, 'hibp')) return { strength, hibp: null, serviceState: 'suspended' };
      const permitted = await chrome.permissions.contains({ origins: [...PROVIDERS.hibp.origins] });
      if (!permitted) return { strength, hibp: null, serviceState: 'permission_required' };
      const controller = beginProviderRequest('hibp');
      try {
        const hibp = await checkHibpPassword(password, controller.signal);
        await noteProviderContact('hibp');
        if (hibp.found) {
          const location = await senderUrl(sender);
          const domain = (() => { try { return registrableDomain(new URL(location.url).hostname); } catch (_) { return ''; } })();
          const event: ProtectionEvent = {
            id: randomRequestId(), timestamp: new Date().toISOString(), category: 'credential_breach',
            severity: 'danger', domain, reasonCodes: ['HIBP_PASSWORD_MATCH'], resolution: 'open', prevalenceCount: hibp.count
          };
          await recordFinding(event, location.incognito, settings.history.enabled);
          await notifyDesktop(event, settings);
        }
        return { strength, hibp, serviceState: 'ready' };
      } catch (error) {
        if (!controller.signal.aborted) await noteProviderContact('hibp', error instanceof Error ? error.message : String(error));
        throw error;
      } finally { finishProviderRequest('hibp', controller); }
    }
    case 'CHECK_REUSE': {
      const password = String((request.payload as { password?: string })?.password || '');
      const location = await senderUrl(sender);
      if (!password || password.length > 1024 || !location.url) throw new Error('A password and site context are required.');
      if (location.incognito) return { reused: false, domains: [], incognito: true };
      const hostname = new URL(location.url).hostname;
      const result = await checkAndRememberReuse(password, hostname);
      if (result.reused) {
        const event: ProtectionEvent = { id: randomRequestId(), timestamp: new Date().toISOString(), category: 'credential_reuse', severity: 'warning', domain: registrableDomain(hostname), reasonCodes: ['PASSWORD_REUSED_ACROSS_SITES'], resolution: 'open' };
        await recordFinding(event, location.incognito, settings.history.enabled);
        await notifyDesktop(event, settings);
      }
      return result;
    }
    case 'CHECK_SITE': {
      const location = await senderUrl(sender);
      const verdict = await makeVerdict(location.url, settings, true);
      const domain = (() => { try { return registrableDomain(new URL(location.url).hostname); } catch (_) { return ''; } })();
      const event = eventFromVerdict(verdict, domain);
      if (event) {
        await recordFinding(event, location.incognito, settings.history.enabled);
        await notifyDesktop(event, settings);
      }
      return { verdict, domain, paused: sitePauseState(settings, domain) === 'paused' };
    }
    case 'CHECK_FORM_DESTINATION': {
      const location = await senderUrl(sender);
      const action = String((request.payload as { action?: string })?.action || '');
      if (action.length > 2048) throw new Error('Form destination is too long.');
      const findings = inspectCredentialDestination(location.url, action);
      const domain = (() => { try { return registrableDomain(new URL(location.url).hostname); } catch (_) { return ''; } })();
      if (findings.length) {
        const event: ProtectionEvent = { id: randomRequestId(), timestamp: new Date().toISOString(), category: 'site_advisory', severity: 'warning', domain, reasonCodes: findings.map(({ code }) => code), resolution: 'open' };
        await recordFinding(event, location.incognito, settings.history.enabled); await notifyDesktop(event, settings);
      }
      return { reasons: findings.map(({ code }) => code) };
    }
    case 'GET_CONTENT_STATE': {
      const location = await senderUrl(sender);
      const domain = (() => { try { return registrableDomain(new URL(location.url).hostname); } catch (_) { return ''; } })();
      const bypassKey = `bypass:${sender.tab?.id || 0}:${domain}`;
      const bypass = await chrome.storage.session.get(bypassKey);
      const bypassValue = bypass[bypassKey] as { expiresAt?: string } | undefined;
      const bypassed = Boolean(bypassValue?.expiresAt && Date.parse(bypassValue.expiresAt) > Date.now());
      if (bypassValue && !bypassed) await chrome.storage.session.remove(bypassKey);
      return { enabled: settings.credentialProtection, paused: sitePauseState(settings, domain) === 'paused', bypassed, onboardingConfirmed: Boolean(settings.onboarding.confirmedAt) };
    }
    case 'PAUSE_SITE': {
      const location = await senderUrl(sender);
      const domain = registrableDomain(new URL(location.url).hostname);
      const duration = (request.payload as { duration?: string })?.duration;
      settings.sites[domain] = { pausedUntil: duration === 'hour' ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null, createdAt: new Date().toISOString() };
      await setSettings(settings);
      return { domain, rule: settings.sites[domain] };
    }
    case 'RESUME_SITE': {
      const payloadDomain = String((request.payload as { domain?: string })?.domain || '');
      const location = await senderUrl(sender);
      const domain = payloadDomain && sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`) ? registrableDomain(payloadDomain) : registrableDomain(new URL(location.url).hostname);
      delete settings.sites[domain];
      await setSettings(settings);
      return { domain };
    }
    case 'CONTINUE_ONCE': {
      const location = await senderUrl(sender);
      const domain = registrableDomain(new URL(location.url).hostname);
      await chrome.storage.session.set({ [`bypass:${sender.tab?.id || 0}:${domain}`]: { createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() } });
      return { domain };
    }
    case 'GET_HISTORY':
    case 'EXPORT_HISTORY':
      return { events: await getHistory(), exportedAt: new Date().toISOString(), schema: 2 };
    case 'CLEAR_HISTORY':
      await clearHistory(); return { cleared: true };
    case 'SET_GOOGLE_KEY':
      await setGoogleKey(String((request.payload as { key?: string })?.key || '')); return { saved: true };
    case 'REPORT_FINDING':
      throw Object.assign(new Error('Content scripts cannot submit arbitrary findings.'), { code: 'INVALID_SENDER' });
    default:
      throw Object.assign(new Error('Unsupported request type.'), { code: 'INVALID_MESSAGE' });
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  void (async () => {
    if (!isRuntimeRequest(message)) return failure('invalid_request', 'INVALID_MESSAGE', 'The runtime message is invalid.');
    if (!senderAllowed(sender)) return failure(message.requestId, 'INVALID_SENDER', 'The message sender is not trusted.');
    try {
      await ready;
      return response(message.requestId, await handleRequest(message, sender));
    } catch (error) {
      const candidate = error as { code?: string; message?: string };
      const known = ['INVALID_MESSAGE', 'INVALID_SENDER', 'NOT_READY', 'PERMISSION_REQUIRED', 'SERVICE_DISABLED', 'TIMEOUT', 'RATE_LIMITED', 'PROVIDER_ERROR', 'NOT_FOUND', 'INTERNAL_ERROR'].includes(candidate.code || '');
      return failure(message.requestId, (known ? candidate.code : 'INTERNAL_ERROR') as any, candidate.message || 'The request failed.');
    }
  })().then(sendResponse);
  return true;
});

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await ready;
    const settings = await getSettings();
    if (details.reason === 'install' || !settings.onboarding.confirmedAt) {
      await chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
    }
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void (async () => {
    await ready;
    if (alarm.name === FEED_ALARM) await scheduledFeedUpdate(await getSettings());
    if (alarm.name === RETENTION_ALARM) await getHistory();
  })();
});

chrome.permissions.onRemoved.addListener((permissions) => {
  if (!permissions.origins?.some((origin) => CONTENT_ORIGINS.includes(origin))) return;
  void (async () => {
    const hasAllSites = await chrome.permissions.contains({ origins: CONTENT_ORIGINS });
    if (!hasAllSites) {
      const settings = await getSettings();
      settings.continuousAccess = false;
      await setSettings(settings);
      await syncContentScriptRegistration(false);
    }
  })();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  void chrome.storage.session.get(null).then((stored) => {
    const keys = Object.keys(stored).filter((key) => key.startsWith(`bypass:${tabId}:`));
    if (keys.length) return chrome.storage.session.remove(keys);
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[DISPLAY_KEY]) {
    void chrome.tabs.query({}).then((tabs) => Promise.allSettled(tabs.filter((tab) => tab.id).map((tab) => chrome.tabs.sendMessage(tab.id!, { protocol: 2, requestId: randomRequestId('theme'), type: 'THEME_CHANGED', payload: changes[DISPLAY_KEY].newValue }))));
  }
  if (area === 'local' && changes[SETTINGS_KEY]) {
    const nextSettings = changes[SETTINGS_KEY].newValue as SettingsV2 | undefined;
    if (!nextSettings?.onlineServices.enabled) cancelAllProviders();
    void chrome.tabs.query({}).then((tabs) => Promise.allSettled(tabs.filter((tab) => tab.id).map((tab) => chrome.tabs.sendMessage(tab.id!, { type: 'SETTINGS_CHANGED' }))));
  }
});
