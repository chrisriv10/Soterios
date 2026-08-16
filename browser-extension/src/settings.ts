import {
  DISCLOSURE_VERSION, DisplaySettings, HISTORY_RETENTION_DAYS, SETTINGS_VERSION,
  SettingsV2, isThemeKey
} from './contracts';

export const SETTINGS_KEY = 'settingsV2';
export const DISPLAY_KEY = 'displaySettingsV2';
export const PROVIDER_STATE_KEY = 'providerStateV2';
export const PROVIDER_SECRETS_KEY = 'providerSecretsV2';
export const HMAC_SECRET_KEY = 'reuseHmacSecretV2';

export const DEFAULT_SETTINGS: SettingsV2 = {
  version: SETTINGS_VERSION,
  onboarding: {
    disclosureVersion: DISCLOSURE_VERSION,
    confirmedAt: null,
    reuseResetNoticePending: false
  },
  continuousAccess: false,
  credentialProtection: true,
  onlineServices: {
    enabled: true,
    hibp: true,
    feed: true,
    googleSafeBrowsing: false
  },
  history: { enabled: true, retentionDays: HISTORY_RETENTION_DAYS },
  desktop: { sharingEnabled: false },
  sites: {}
};

export const DEFAULT_DISPLAY: DisplaySettings = { theme: 'system', compactPopup: false };

export interface MigrationResult {
  settings: SettingsV2;
  display: DisplaySettings;
  googleKey: string;
  deleteLocalKeys: string[];
  deleteSyncKeys: string[];
}

function cloneDefaults(): SettingsV2 {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as SettingsV2;
}

export function migrateSettings(local: Record<string, unknown>, sync: Record<string, unknown>): MigrationResult {
  const current = local[SETTINGS_KEY] as Partial<SettingsV2> | undefined;
  const settings = cloneDefaults();
  if (current?.version === SETTINGS_VERSION) {
    Object.assign(settings, current);
    settings.onboarding = { ...DEFAULT_SETTINGS.onboarding, ...(current.onboarding || {}) };
    settings.onlineServices = { ...DEFAULT_SETTINGS.onlineServices, ...(current.onlineServices || {}) };
    settings.history = { ...DEFAULT_SETTINGS.history, ...(current.history || {}), retentionDays: HISTORY_RETENTION_DAYS };
    settings.desktop = { ...DEFAULT_SETTINGS.desktop, ...(current.desktop || {}) };
    settings.sites = current.sites && typeof current.sites === 'object' ? current.sites : {};
  } else {
    const privacyMode = local.privacyMode ?? sync.privacyMode;
    const hibpEnabled = local.hibpEnabled ?? sync.hibpEnabled;
    const safeBrowsingEnabled = local.safeBrowsingEnabled ?? sync.safeBrowsingEnabled;
    settings.onlineServices.enabled = privacyMode !== true;
    settings.onlineServices.hibp = hibpEnabled !== false;
    settings.onlineServices.feed = true;
    settings.onlineServices.googleSafeBrowsing = safeBrowsingEnabled === true;
    settings.credentialProtection = local.enabled !== false && sync.enabled !== false;
    settings.onboarding.reuseResetNoticePending = Boolean(local.reuseMap || local.passwordHashes);
  }

  const priorDisplay = sync[DISPLAY_KEY] as Partial<DisplaySettings> | undefined;
  const legacyTheme = priorDisplay?.theme ?? sync.theme ?? local.theme;
  const display: DisplaySettings = {
    theme: isThemeKey(legacyTheme) ? legacyTheme : DEFAULT_DISPLAY.theme,
    compactPopup: priorDisplay?.compactPopup === true
  };
  const googleKey = String((local[PROVIDER_SECRETS_KEY] as { googleSafeBrowsingKey?: string } | undefined)?.googleSafeBrowsingKey
    || local.safeBrowsingApiKey || sync.safeBrowsingApiKey || '');

  return {
    settings,
    display,
    googleKey,
    deleteLocalKeys: ['reuseMap', 'passwordHashes', 'passwordHashMap', 'safeBrowsingApiKey'],
    deleteSyncKeys: ['safeBrowsingApiKey', 'privacyMode', 'hibpEnabled', 'safeBrowsingEnabled', 'enabled', 'theme']
  };
}

export async function initializeStorage(): Promise<{ settings: SettingsV2; display: DisplaySettings }> {
  if (chrome.storage.local.setAccessLevel) {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  }
  const [local, sync] = await Promise.all([chrome.storage.local.get(null), chrome.storage.sync.get(null)]);
  const migrated = migrateSettings(local, sync);
  await Promise.all([
    chrome.storage.local.set({
      [SETTINGS_KEY]: migrated.settings,
      [PROVIDER_SECRETS_KEY]: { googleSafeBrowsingKey: migrated.googleKey }
    }),
    chrome.storage.sync.set({ [DISPLAY_KEY]: migrated.display })
  ]);
  if (migrated.deleteLocalKeys.length) await chrome.storage.local.remove(migrated.deleteLocalKeys);
  if (migrated.deleteSyncKeys.length) await chrome.storage.sync.remove(migrated.deleteSyncKeys);
  return { settings: migrated.settings, display: migrated.display };
}

export async function getSettings(): Promise<SettingsV2> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return migrateSettings(stored, {}).settings;
}

export async function setSettings(settings: SettingsV2): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getDisplaySettings(): Promise<DisplaySettings> {
  const stored = await chrome.storage.sync.get(DISPLAY_KEY);
  const value = stored[DISPLAY_KEY] as Partial<DisplaySettings> | undefined;
  return {
    theme: isThemeKey(value?.theme) ? value.theme : 'system',
    compactPopup: value?.compactPopup === true
  };
}

export function onlineProtectionReady(settings: SettingsV2): boolean {
  return Boolean(settings.onboarding.confirmedAt && settings.onlineServices.enabled);
}

export function providerEnabled(settings: SettingsV2, provider: 'hibp' | 'feed' | 'googleSafeBrowsing'): boolean {
  return onlineProtectionReady(settings) && settings.onlineServices[provider];
}
