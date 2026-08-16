import { RuntimeRequest, RuntimeResponse, ThemeKey } from './contracts';

export function requestId(prefix = 'ui'): string { return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`; }

export async function send<T>(type: string, payload: unknown = {}): Promise<T> {
  const message: RuntimeRequest = { protocol: 2, requestId: requestId(), type, payload };
  const result = await chrome.runtime.sendMessage(message) as RuntimeResponse<T>;
  if (!result?.ok) throw new Error(result?.error?.message || 'The extension could not complete that request.');
  return result.payload as T;
}

export function applyTheme(theme: ThemeKey): void {
  document.documentElement.dataset.theme = theme;
}

export function formatContact(value: string | null): string {
  if (!value) return 'Never';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'Unknown';
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} hr ago`;
  return new Date(time).toLocaleDateString();
}

export function setText(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function reasonLabel(code: string): string {
  const labels: Record<string, string> = {
    SIGNED_FEED_PHISHING: 'Signed feed: phishing indicator', SIGNED_FEED_MALWARE: 'Signed feed: malware indicator',
    IP_LITERAL_HOST: 'Numeric IP address', DECEPTIVE_USERINFO: 'Disguised URL destination', PUNYCODE_HOST: 'Internationalized domain spelling',
    BRAND_IMPERSONATION: 'Possible brand impersonation', INSECURE_CREDENTIAL_PATH: 'Sign-in page without HTTPS',
    CROSS_SITE_CREDENTIAL_FORM: 'Password form submits to another site', INSECURE_FORM_DESTINATION: 'Password form submits without encryption', UNUSUAL_FORM_SCHEME: 'Password form uses an unusual scheme',
    FEED_STALE: 'Threat feed is stale', FEED_UPDATE_FAILED: 'Threat-feed update failed', FEED_PERMISSION_REQUIRED: 'Threat-feed permission is required', ONLINE_SETUP_REQUIRED: 'Online setup is not confirmed', SITE_PAUSED: 'Protection paused for this site',
    HIBP_PASSWORD_MATCH: 'Password found in breach corpus', PASSWORD_REUSED_ACROSS_SITES: 'Password reused across sites'
  };
  return labels[code] || code.replaceAll('_', ' ').toLowerCase();
}
