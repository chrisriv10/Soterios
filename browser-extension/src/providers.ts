import { ProviderDescriptor, ProviderId, SettingsV2 } from './contracts';
import { FEED_ORIGIN, updateFeed } from './feed';
import { PROVIDER_SECRETS_KEY, PROVIDER_STATE_KEY, providerEnabled } from './settings';

export const PROVIDERS = {
  hibp: {
    id: 'hibp', name: 'Have I Been Pwned — Pwned Passwords',
    origins: ['https://api.pwnedpasswords.com/*'],
    purpose: 'Checks whether a completed password appears in the Pwned Passwords corpus using k-anonymity.',
    dataSent: ['First 5 hexadecimal characters of a one-time SHA-1 password hash', 'No account name or visited site']
  },
  feed: {
    id: 'feed', name: 'Soterios signed threat feed', origins: [`${FEED_ORIGIN}/*`],
    purpose: 'Downloads fixed-schedule, signed phishing and malware indicator shards.',
    dataSent: ['Feed version and ordinary HTTP request metadata', 'No visited URL or domain']
  },
  googleSafeBrowsing: {
    id: 'googleSafeBrowsing', name: 'Google Safe Browsing (bring your own key)',
    origins: ['https://safebrowsing.googleapis.com/*'],
    purpose: 'Checks a URL against Google Safe Browsing when explicitly enabled with your API key.',
    dataSent: ['The URL being checked', 'Your Google API key']
  }
} as const;

type ContactState = Partial<Record<ProviderId, { lastContact: string | null; lastError: string | null }>>;
const controllers = new Map<ProviderId, Set<AbortController>>();

export function beginProviderRequest(provider: ProviderId): AbortController {
  const controller = new AbortController();
  const set = controllers.get(provider) || new Set<AbortController>();
  set.add(controller);
  controllers.set(provider, set);
  controller.signal.addEventListener('abort', () => set.delete(controller), { once: true });
  return controller;
}

export function finishProviderRequest(provider: ProviderId, controller: AbortController): void {
  controllers.get(provider)?.delete(controller);
}

export function cancelProvider(provider: ProviderId): void {
  for (const controller of controllers.get(provider) || []) controller.abort('provider disabled');
  controllers.delete(provider);
}

export function cancelAllProviders(): void {
  (Object.keys(PROVIDERS) as ProviderId[]).forEach(cancelProvider);
}

export async function noteProviderContact(provider: ProviderId, error: string | null = null): Promise<void> {
  const stored = await chrome.storage.local.get(PROVIDER_STATE_KEY);
  const state = (stored[PROVIDER_STATE_KEY] || {}) as ContactState;
  state[provider] = { lastContact: new Date().toISOString(), lastError: error };
  await chrome.storage.local.set({ [PROVIDER_STATE_KEY]: state });
}

export async function providerDescriptors(settings: SettingsV2): Promise<ProviderDescriptor[]> {
  const stored = await chrome.storage.local.get(PROVIDER_STATE_KEY);
  const state = (stored[PROVIDER_STATE_KEY] || {}) as ContactState;
  return Promise.all((Object.keys(PROVIDERS) as ProviderId[]).map(async (id) => {
    const provider = PROVIDERS[id];
    const permission = await chrome.permissions.contains({ origins: [...provider.origins] });
    const enabled = settings.onlineServices[id];
    let health: ProviderDescriptor['health'] = 'suspended';
    if (providerEnabled(settings, id)) health = permission ? (state[id]?.lastError ? 'error' : state[id]?.lastContact ? 'healthy' : 'ready') : 'permission_required';
    return { ...provider, origins: [...provider.origins], dataSent: [...provider.dataSent], enabled, permission, lastContact: state[id]?.lastContact || null, health };
  }));
}

export async function requestProviderPermission(provider: ProviderId): Promise<boolean> {
  return chrome.permissions.request({ origins: [...PROVIDERS[provider].origins] });
}

export async function revokeProviderPermission(provider: ProviderId): Promise<boolean> {
  cancelProvider(provider);
  return chrome.permissions.remove({ origins: [...PROVIDERS[provider].origins] });
}

export async function scheduledFeedUpdate(settings: SettingsV2): Promise<void> {
  if (!providerEnabled(settings, 'feed')) return;
  const hasPermission = await chrome.permissions.contains({ origins: [...PROVIDERS.feed.origins] });
  if (!hasPermission) return;
  const controller = beginProviderRequest('feed');
  try {
    await updateFeed(controller.signal);
    await noteProviderContact('feed');
  } catch (error) {
    if (!controller.signal.aborted) await noteProviderContact('feed', error instanceof Error ? error.message : String(error));
  } finally { finishProviderRequest('feed', controller); }
}

export async function getGoogleKey(): Promise<string> {
  const stored = await chrome.storage.local.get(PROVIDER_SECRETS_KEY);
  const secrets = stored[PROVIDER_SECRETS_KEY] as { googleSafeBrowsingKey?: string } | undefined;
  return String(secrets?.googleSafeBrowsingKey || '');
}

export async function setGoogleKey(value: string): Promise<void> {
  const key = value.trim();
  if (key.length > 256 || (key && !/^[A-Za-z0-9_-]+$/.test(key))) throw new Error('The API key format is invalid.');
  await chrome.storage.local.set({ [PROVIDER_SECRETS_KEY]: { googleSafeBrowsingKey: key } });
}

export async function checkGoogleUrl(url: string, signal?: AbortSignal): Promise<string[]> {
  const key = await getGoogleKey();
  if (!key) throw new Error('A Google Safe Browsing API key is required.');
  const controller = beginProviderRequest('googleSafeBrowsing');
  const forwardAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', forwardAbort, { once: true });
  const timeout = setTimeout(() => controller.abort('timeout'), 8000);
  try {
    const response = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'soterios', clientVersion: '2.0.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'],
          platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'], threatEntries: [{ url }]
        }
      }),
      cache: 'no-store', signal: controller.signal
    });
    if (!response.ok) throw new Error(`Google Safe Browsing returned HTTP ${response.status}`);
    const body = await response.json() as { matches?: Array<{ threatType?: string }> };
    await noteProviderContact('googleSafeBrowsing');
    return Array.isArray(body.matches) ? body.matches.map((match) => String(match.threatType || 'UNKNOWN')).slice(0, 10) : [];
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', forwardAbort);
    finishProviderRequest('googleSafeBrowsing', controller);
  }
}
