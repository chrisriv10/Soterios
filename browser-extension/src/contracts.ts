export const SETTINGS_VERSION = 2 as const;
export const DISCLOSURE_VERSION = 2 as const;
export const HISTORY_RETENTION_DAYS = 30 as const;
export const MAX_RUNTIME_MESSAGE_BYTES = 64 * 1024;

export const THEME_KEYS = [
  'system', 'dark', 'light', 'sunset', 'violet', 'crimson',
  'terminal', 'ocean', 'emerald', 'midnight', 'bumblebee',
  'monochrome', 'rose', 'aurora'
] as const;

export type ThemeKey = typeof THEME_KEYS[number];
export type ProviderId = 'hibp' | 'feed' | 'googleSafeBrowsing';
export type ProviderHealth = 'suspended' | 'ready' | 'healthy' | 'degraded' | 'permission_required' | 'error';

export interface SettingsV2 {
  version: 2;
  onboarding: {
    disclosureVersion: 2;
    confirmedAt: string | null;
    reuseResetNoticePending: boolean;
  };
  continuousAccess: boolean;
  credentialProtection: boolean;
  onlineServices: {
    enabled: boolean;
    hibp: boolean;
    feed: boolean;
    googleSafeBrowsing: boolean;
  };
  history: { enabled: boolean; retentionDays: 30 };
  desktop: { sharingEnabled: boolean };
  sites: Record<string, { pausedUntil: string | null; createdAt: string }>;
}

export interface DisplaySettings {
  theme: ThemeKey;
  compactPopup: boolean;
}

export interface ProviderDescriptor {
  id: ProviderId;
  name: string;
  origins: string[];
  purpose: string;
  dataSent: string[];
  enabled: boolean;
  permission: boolean;
  lastContact: string | null;
  health: ProviderHealth;
}

export interface ProtectionVerdict {
  verdict: 'unknown' | 'clear' | 'warning' | 'danger';
  confidence: 'none' | 'low' | 'medium' | 'high';
  source: 'local' | 'feed' | 'googleSafeBrowsing' | 'combined';
  reasons: string[];
  checkedAt: string;
  expiresAt: string | null;
  feedVersion: number | null;
}

export interface ProtectionEvent {
  id: string;
  timestamp: string;
  category: 'credential_breach' | 'credential_reuse' | 'phishing' | 'malware' | 'site_advisory';
  severity: 'info' | 'warning' | 'danger';
  domain: string;
  reasonCodes: string[];
  resolution: 'open' | 'dismissed' | 'continued' | 'left_site';
  prevalenceCount?: number;
}

export interface RuntimeRequest<T = unknown> {
  protocol: 2;
  requestId: string;
  type: string;
  payload: T;
}

export interface RuntimeResponse<T = unknown> {
  protocol: 2;
  requestId: string;
  ok: boolean;
  payload?: T;
  error?: { code: RuntimeErrorCode; message: string };
}

export type RuntimeErrorCode =
  | 'INVALID_MESSAGE' | 'INVALID_SENDER' | 'NOT_READY' | 'PERMISSION_REQUIRED'
  | 'SERVICE_DISABLED' | 'TIMEOUT' | 'RATE_LIMITED' | 'PROVIDER_ERROR'
  | 'NOT_FOUND' | 'INTERNAL_ERROR';

export interface NativeEnvelopeV2<T = unknown> {
  protocol: 2;
  requestId: string;
  type: 'HELLO' | 'PING' | 'GET_THEME' | 'REPORT_FINDING' | 'OPEN_APP';
  payload: T;
}

export const REQUEST_TYPES = new Set([
  'GET_STATE', 'GET_SETTINGS', 'UPDATE_SETTINGS', 'CONFIRM_ONBOARDING',
  'REQUEST_CONTINUOUS_ACCESS', 'REVOKE_CONTINUOUS_ACCESS', 'RUN_ON_DEMAND',
  'CHECK_PASSWORD', 'ANALYZE_PASSWORD', 'GENERATE_PASSWORD', 'CHECK_REUSE',
  'CHECK_SITE', 'CHECK_FORM_DESTINATION', 'PAUSE_SITE', 'RESUME_SITE', 'GET_HISTORY', 'CLEAR_HISTORY',
  'EXPORT_HISTORY', 'GET_PROVIDER_DESCRIPTORS', 'SET_GOOGLE_KEY',
  'REPORT_FINDING', 'CONTINUE_ONCE', 'GET_CONTENT_STATE'
]);

export function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === 'string' && (THEME_KEYS as readonly string[]).includes(value);
}

export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!value || typeof value !== 'object') return false;
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_RUNTIME_MESSAGE_BYTES) return false;
  } catch (_) {
    return false;
  }
  const candidate = value as Partial<RuntimeRequest>;
  return candidate.protocol === 2
    && typeof candidate.requestId === 'string'
    && /^[a-zA-Z0-9_-]{8,80}$/.test(candidate.requestId)
    && typeof candidate.type === 'string'
    && REQUEST_TYPES.has(candidate.type)
    && Object.prototype.hasOwnProperty.call(candidate, 'payload');
}

export function response<T>(requestId: string, payload: T): RuntimeResponse<T> {
  return { protocol: 2, requestId, ok: true, payload };
}

export function failure(requestId: string, code: RuntimeErrorCode, message: string): RuntimeResponse {
  return { protocol: 2, requestId, ok: false, error: { code, message } };
}
