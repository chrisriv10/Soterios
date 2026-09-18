import { AdTrackerProtection } from './contracts';

// Static ruleset IDs registered in the generated manifest. These strings are
// part of the packaged contract: build-extension.mjs, this controller, and
// tests assert them, so renaming requires updating all three.
export const AD_RULESET_ID = 'soterios-ads';
export const TRACKER_RULESET_ID = 'soterios-trackers';

// Session-rule ID namespace reserved for Soterios exact-host site
// exceptions. Only IDs inside this range are ever removed or replaced;
// unrelated session rules are left untouched.
export const SITE_EXCEPTION_ID_BASE = 100000;
export const SITE_EXCEPTION_RULES_PER_HOST = 2;
export const MAX_SITE_EXCEPTIONS = 500;
const SITE_EXCEPTION_ID_END = SITE_EXCEPTION_ID_BASE + MAX_SITE_EXCEPTIONS * SITE_EXCEPTION_RULES_PER_HOST;

// The exception must outrank every Soterios static rule it can override.
// Static priorities observed in the generated rulesets top out at
// allow+important; a dedicated test asserts this constant stays above the
// real static maximum. Never rely on same-priority action ordering.
export const SITE_EXCEPTION_PRIORITY = 10000;

const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export interface AdblockState {
  available: boolean;
  enabled: boolean;
  blockAds: boolean;
  blockTrackers: boolean;
  adsActive: boolean;
  trackersActive: boolean;
  enabledRulesets: string[];
}

export interface AdblockSyncResult {
  ok: boolean;
  enabledRulesets: string[];
  error?: string;
}

type DeclarativeNetRequestApi = Pick<typeof chrome.declarativeNetRequest, 'getEnabledRulesets' | 'updateEnabledRulesets'>;

type SessionRulesApi = {
  getSessionRules: () => Promise<Array<{ id?: unknown; condition?: { urlFilter?: unknown } | null }>>;
  updateSessionRules: (options: { removeRuleIds?: number[]; addRules?: unknown[] }) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Exact-host normalization. Exceptions key on the exact normalized hostname:
// subdomains never fold together (no registrableDomain(), no eTLD+1, no
// requestDomains semantics). Only http/https hostnames normalize; everything
// else is rejected so the caller marks the site ineligible.
export function normalizeExceptionHostname(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let host = input.trim().toLowerCase();
  if (!host) return null;
  // A hostname never contains URL structure; such input is a caller error
  // (use exceptionHostnameFromUrl for URLs) and must not parse further.
  if (/[\s/?#@]/.test(host)) return null;
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host) return null;
  if (/[^\x00-\x7F]/.test(host)) {
    // Internationalized hostname: fold to ASCII through standards-based URL
    // parsing, built from parts (never a pasted URL string). ASCII hosts
    // skip this entirely and validate below.
    try {
      host = new URL(['http:', '', host].join('/')).hostname;
    } catch (_) {
      return null;
    }
  }
  if (host.startsWith('[')) {
    // IPv6 literal in URL.hostname bracket form.
    if (!/^\[[0-9a-f:]+\]$/i.test(host)) return null;
    return host.toLowerCase();
  }
  if (!host || !HOSTNAME_PATTERN.test(host)) return null;
  return host.toLowerCase();
}

// Normalize the hostname of an http(s) URL for exception purposes, or null
// for browser-internal, non-web, missing, or malformed URLs. Ports are
// intentionally not part of the key: DNR `|scheme://host^` separator matching
// covers every port of the exact host, so exceptions stay host-scoped.
export function exceptionHostnameFromUrl(urlValue: unknown): string | null {
  if (typeof urlValue !== 'string' || !urlValue) return null;
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch (_) {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return normalizeExceptionHostname(url.hostname);
}

// ---------------------------------------------------------------------------
// Session exception rules. One exact-host exception becomes two deterministic
// urlFilter rules (http + https), main_frame only, allowAllRequests. Exact
// left-anchored `|scheme://host^` patterns match only that host (never
// subdomains — unlike `||host^` or requestDomains, which do).
export interface SiteExceptionRule {
  id: number;
  priority: number;
  action: { type: 'allowAllRequests' };
  condition: { urlFilter: string; resourceTypes: ['main_frame'] };
}

export function siteExceptionRuleFilters(hostname: string): [string, string] {
  // Exact left-anchored match for the host across all ports and paths.
  // Built from parts (never a pasted URL) so the only variable input is the
  // already-normalized hostname.
  return (['http', 'https'] as const).map(
    (scheme) => `|${scheme}://${hostname}^`
  ) as [string, string];
}

export function siteExceptionRulesFor(hostname: string, index: number): SiteExceptionRule[] {
  const [httpFilter, httpsFilter] = siteExceptionRuleFilters(hostname);
  return [
    {
      id: SITE_EXCEPTION_ID_BASE + index * SITE_EXCEPTION_RULES_PER_HOST,
      priority: SITE_EXCEPTION_PRIORITY,
      action: { type: 'allowAllRequests' },
      condition: { urlFilter: httpFilter, resourceTypes: ['main_frame'] },
    },
    {
      id: SITE_EXCEPTION_ID_BASE + index * SITE_EXCEPTION_RULES_PER_HOST + 1,
      priority: SITE_EXCEPTION_PRIORITY,
      action: { type: 'allowAllRequests' },
      condition: { urlFilter: httpsFilter, resourceTypes: ['main_frame'] },
    },
  ];
}

function isSiteExceptionId(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id)
    && id >= SITE_EXCEPTION_ID_BASE && id < SITE_EXCEPTION_ID_END;
}

// Deterministic rules for every persisted exception: hostnames sorted so
// settings ordering never changes output. Throws past the cap instead of
// silently discarding entries (the SET path validates first, so this is a
// defensive invariant, not a user flow).
export function desiredSiteExceptionRules(
  disabledSites: Record<string, { createdAt: string }> | null | undefined
): SiteExceptionRule[] {
  const hosts = Object.keys(disabledSites || {}).sort();
  if (hosts.length > MAX_SITE_EXCEPTIONS) {
    throw new Error(`Too many site exceptions (maximum ${MAX_SITE_EXCEPTIONS}).`);
  }
  const rules: SiteExceptionRule[] = [];
  hosts.forEach((hostname, index) => {
    if (normalizeExceptionHostname(hostname) !== hostname) {
      throw new Error(`Stored site exception is not a normalized hostname: ${hostname}.`);
    }
    rules.push(...siteExceptionRulesFor(hostname, index));
  });
  return rules;
}

// Pure settings mutation for exactly one exception. Returns the updated
// settings (sharing every untouched branch) or a clean error. Never touches
// phishing/credential/provider/host-permission state by construction: only
// adTrackerProtection.disabledSites is rebuilt.
export function setSiteException(
  settings: AdblockSettingsView | null | undefined,
  rawHostname: unknown,
  disabled: boolean,
  createdAt: string = new Date().toISOString()
): { settings: AdblockSettingsView; hostname: string } | { error: string } {
  const hostname = normalizeExceptionHostname(rawHostname);
  if (!hostname) return { error: 'Invalid hostname for a site exception.' };
  const current = settings?.adTrackerProtection?.disabledSites;
  const sites: Record<string, { createdAt: string }> =
    current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
  if (disabled) {
    if (!sites[hostname] && Object.keys(sites).length >= MAX_SITE_EXCEPTIONS) {
      return { error: `Site exception limit reached (maximum ${MAX_SITE_EXCEPTIONS}).` };
    }
    if (!sites[hostname]) sites[hostname] = { createdAt };
  } else if (sites[hostname]) {
    delete sites[hostname];
  }
  const protection = settings?.adTrackerProtection || {};
  return {
    hostname,
    settings: {
      ...settings,
      adTrackerProtection: {
        enabled: protection.enabled === true,
        blockAds: protection.blockAds !== false,
        blockTrackers: protection.blockTrackers !== false,
        disabledSites: sites,
      },
    },
  };
}

// Structural view of the settings every helper in this module accepts. Both
// the full SettingsV2 and partial shapes satisfy it (no index signature, so
// interfaces remain assignable).
export interface AdblockSettingsView {
  adTrackerProtection?: {
    enabled?: boolean;
    blockAds?: boolean;
    blockTrackers?: boolean;
    disabledSites?: Record<string, { createdAt: string }> | null;
  } | null;
}

function readFlags(settings: AdblockSettingsView | null | undefined): { enabled: boolean; blockAds: boolean; blockTrackers: boolean } {
  const value = settings?.adTrackerProtection || {};
  return {
    enabled: value.enabled === true,
    blockAds: value.blockAds !== false,
    blockTrackers: value.blockTrackers !== false,
  };
}

// Pure mapping from settings to the exact static rulesets that must be on.
// No Chrome API access; fully unit-testable.
export function desiredRulesets(settings: AdblockSettingsView | null | undefined): string[] {
  const flags = readFlags(settings);
  if (!flags.enabled) return [];
  const ids: string[] = [];
  if (flags.blockAds) ids.push(AD_RULESET_ID);
  if (flags.blockTrackers) ids.push(TRACKER_RULESET_ID);
  return ids;
}

export interface SiteExceptionSyncResult {
  ok: boolean;
  activeHosts: string[];
  error?: string;
}

// Reconcile exact-host exception session rules with persisted intent. Only
// rules inside the reserved Soterios ID range are ever removed or replaced;
// unrelated session rules are left untouched. Never throws.
export async function syncSiteExceptions(
  settings: AdblockSettingsView | null | undefined,
  apiOverride?: SessionRulesApi | null
): Promise<SiteExceptionSyncResult> {
  const api = resolveSessionApi(apiOverride === undefined ? null : apiOverride);
  if (!api) return { ok: false, activeHosts: [], error: 'Declarative Net Request is unavailable.' };
  const flags = readFlags(settings);
  try {
    const live = await api.getSessionRules();
    const owned = (Array.isArray(live) ? live : []).filter((rule) => isSiteExceptionId(rule?.id));
    const ownedFilters = new Map<number, string>();
    for (const rule of owned) {
      const filter = (rule.condition && typeof rule.condition.urlFilter === 'string') ? rule.condition.urlFilter : null;
      if (filter) ownedFilters.set(rule.id as number, filter);
    }
    let desired: SiteExceptionRule[] = [];
    if (flags.enabled) {
      desired = desiredSiteExceptionRules(settings?.adTrackerProtection?.disabledSites);
    }
    const desiredById = new Map(desired.map((rule) => [rule.id, rule.condition.urlFilter]));
    const removeRuleIds = [...ownedFilters.keys()].filter(
      (id) => desiredById.get(id) !== ownedFilters.get(id)
    );
    const liveIds = new Set(ownedFilters.keys());
    const addRules = desired.filter((rule) => !liveIds.has(rule.id) || removeRuleIds.includes(rule.id));
    if (removeRuleIds.length || addRules.length) {
      await api.updateSessionRules({ removeRuleIds, addRules });
    }
    const hosts = flags.enabled ? Object.keys(settings?.adTrackerProtection?.disabledSites || {}).sort() : [];
    return { ok: true, activeHosts: hosts };
  } catch (error) {
    return { ok: false, activeHosts: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function resolveSessionApi(override: SessionRulesApi | null): SessionRulesApi | null {
  if (override) return override;
  try {
    const api = (globalThis as { chrome?: typeof chrome }).chrome?.declarativeNetRequest;
    if (api && typeof api.getSessionRules === 'function' && typeof api.updateSessionRules === 'function') {
      return api as unknown as SessionRulesApi;
    }
  } catch (_) {
    // No DNR surface: caller reports unavailable.
  }
  return null;
}

export interface AdblockReconcileReport {
  ok: boolean;
  staticOk: boolean;
  exceptionsOk: boolean;
  enabledRulesets: string[];
  exceptionHosts: string[];
  error?: string;
}

// Single background-owned reconciliation path: static rulesets, then exact-
// host exception session rules, then authoritative state. Partial failures
// are explicit: ok requires both halves to succeed. There is a single DNR
// API object in production, so one override covers both halves in tests.
export async function reconcileAdblock(
  settings: AdblockSettingsView | null | undefined,
  apiOverride?: DeclarativeNetRequestApi & SessionRulesApi | null
): Promise<AdblockReconcileReport> {
  let staticResult: AdblockSyncResult;
  let exceptionResult: SiteExceptionSyncResult;
  try {
    staticResult = await syncAdblockRulesets(settings, apiOverride);
  } catch (error) {
    staticResult = { ok: false, enabledRulesets: [], error: error instanceof Error ? error.message : String(error) };
  }
  try {
    exceptionResult = await syncSiteExceptions(settings, apiOverride as SessionRulesApi | null | undefined);
  } catch (error) {
    exceptionResult = { ok: false, activeHosts: [], error: error instanceof Error ? error.message : String(error) };
  }
  const errors = [staticResult.error, exceptionResult.error].filter(Boolean);
  const report: AdblockReconcileReport = {
    ok: staticResult.ok && exceptionResult.ok,
    staticOk: staticResult.ok,
    exceptionsOk: exceptionResult.ok,
    enabledRulesets: staticResult.enabledRulesets,
    exceptionHosts: exceptionResult.activeHosts,
  };
  if (!report.ok) report.error = errors.join('; ') || 'Adblock synchronization failed.';
  return report;
}

export interface AdblockSiteState {
  eligible: boolean;
  hostname: string | null;
  disabledByUser: boolean;
  exceptionActive: boolean;
  protectionActive: boolean;
  applyWarning: boolean;
}

// Narrow per-site state for the popup toggle. The hostname comes from the
// sender tab URL (revalidated here); renderer input never selects hosts.
export async function getAdblockSiteState(
  tabUrl: unknown,
  settings: AdblockSettingsView | null | undefined,
  incognito: boolean,
  apiOverride?: DeclarativeNetRequestApi & SessionRulesApi | null
): Promise<AdblockSiteState> {
  const hostname = exceptionHostnameFromUrl(tabUrl);
  const snapshot = await getAdblockState(settings, apiOverride);
  const flagsOn = snapshot.enabled && (snapshot.blockAds || snapshot.blockTrackers);
  const base = {
    hostname,
    disabledByUser: false,
    exceptionActive: false,
    protectionActive: false,
    applyWarning: false,
  };
  if (!hostname || !snapshot.available || !flagsOn || incognito === true) {
    return { eligible: false, ...base };
  }
  const disabledByUser = Object.prototype.hasOwnProperty.call(
    settings?.adTrackerProtection?.disabledSites || {}, hostname
  );
  let liveFilters: string[] = [];
  let verified = false;
  try {
    const api = resolveSessionApi(apiOverride === undefined ? null : apiOverride);
    if (api) {
      const rules = await api.getSessionRules();
      liveFilters = (Array.isArray(rules) ? rules : [])
        .filter((rule) => isSiteExceptionId(rule?.id))
        .map((rule) => (rule.condition && typeof rule.condition.urlFilter === 'string' ? rule.condition.urlFilter : null))
        .filter((filter): filter is string => typeof filter === 'string');
      verified = true;
    }
  } catch (_) {
    verified = false;
  }
  if (!verified) {
    return { eligible: true, hostname, disabledByUser, exceptionActive: false, protectionActive: false, applyWarning: true };
  }
  const [httpFilter, httpsFilter] = siteExceptionRuleFilters(hostname);
  const exceptionActive = liveFilters.includes(httpFilter) && liveFilters.includes(httpsFilter);
  const runtime = adblockRuntimeStatus({ ...snapshot, enabledRulesets: snapshot.enabledRulesets });
  const protectionActive = runtime === 'active' && !exceptionActive;
  return {
    eligible: true,
    hostname,
    disabledByUser,
    exceptionActive,
    protectionActive,
    applyWarning: disabledByUser !== exceptionActive,
  };
}

function resolveApi(override?: DeclarativeNetRequestApi | null): DeclarativeNetRequestApi | null {
  if (override) return override;
  try {
    const api = (globalThis as { chrome?: typeof chrome }).chrome?.declarativeNetRequest;
    if (api && typeof api.getEnabledRulesets === 'function' && typeof api.updateEnabledRulesets === 'function') {
      return api;
    }
  } catch (_) {
    // No DNR surface (older browser, restricted context): caller reports unavailable.
  }
  return null;
}

// Reconcile enabled static rulesets with settings. Writes only when the
// current set differs. Never throws: failures resolve to { ok: false } so
// service-worker startup cannot crash.
export async function syncAdblockRulesets(
  settings: AdblockSettingsView | null | undefined,
  apiOverride?: DeclarativeNetRequestApi | null
): Promise<AdblockSyncResult> {
  const api = resolveApi(apiOverride === undefined ? null : apiOverride);
  if (!api) return { ok: false, enabledRulesets: [], error: 'Declarative Net Request is unavailable.' };
  const wanted = desiredRulesets(settings);
  try {
    const current = await api.getEnabledRulesets();
    const wantedSet = new Set(wanted);
    const currentSet = new Set(Array.isArray(current) ? current : []);
    const enableRulesetIds = wanted.filter((id) => !currentSet.has(id));
    // Disable only Soterios ad/tracker rulesets; never touch other rulesets.
    const disableRulesetIds = [AD_RULESET_ID, TRACKER_RULESET_ID].filter((id) => !wantedSet.has(id) && currentSet.has(id));
    if (enableRulesetIds.length || disableRulesetIds.length) {
      await api.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
    }
    return { ok: true, enabledRulesets: wanted };
  } catch (error) {
    return { ok: false, enabledRulesets: [], error: error instanceof Error ? error.message : String(error) };
  }
}

// Normalize a persisted disabledSites map: keys re-normalized to exact
// hostnames (sorted for determinism), malformed keys dropped, entries
// without a usable timestamp given a stable epoch fallback.
export function normalizeDisabledSites(value: unknown): Record<string, { createdAt: string }> {
  const sites: Record<string, { createdAt: string }> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return sites;
  // Normalize first, then insert in hostname order: equivalent stored maps
  // (differing only in case, trailing dots, or key order) canonicalize to
  // identical key sequences regardless of input ordering.
  const normalized: Array<[string, unknown]> = [];
  for (const key of Object.keys(value)) {
    const hostname = normalizeExceptionHostname(key);
    if (hostname) normalized.push([hostname, (value as Record<string, unknown>)[key]]);
  }
  normalized.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [hostname, entry] of normalized) {
    if (hostname in sites) continue;
    const createdAt = entry && typeof entry === 'object'
      ? (entry as Record<string, unknown>).createdAt
      : null;
    sites[hostname] = { createdAt: typeof createdAt === 'string' && createdAt ? createdAt : new Date(0).toISOString() };
  }
  return sites;
}

// Narrow patch application for UPDATE_SETTINGS. Only the three supported
// booleans are accepted; unknown fields, wrong types, and arbitrary ruleset
// IDs or DNR operations are ignored. Missing keys keep current values,
// including the existing disabledSites map (site exceptions change only
// through SET_ADBLOCK_SITE_EXCEPTION).
export function applyAdTrackerPatch(
  current: AdTrackerProtection,
  patch: unknown
): AdTrackerProtection {
  const next: AdTrackerProtection = {
    enabled: current.enabled,
    blockAds: current.blockAds,
    blockTrackers: current.blockTrackers,
    disabledSites: current.disabledSites,
  };
  if (!patch || typeof patch !== 'object') return next;
  const candidate = patch as Record<string, unknown>;
  for (const key of ['enabled', 'blockAds', 'blockTrackers'] as const) {
    if (typeof candidate[key] === 'boolean') next[key] = candidate[key];
  }
  return next;
}

// Runtime protection status, derived from desired settings AND live DNR
// state — never from preference alone. 'active'/'on' wording is reserved
// for states where actual protection is confirmed running.
export type AdblockRuntimeStatus = 'active' | 'off' | 'inactive' | 'attention' | 'unavailable';

export function adblockRuntimeStatus(state: AdblockState | null | undefined): AdblockRuntimeStatus {
  if (!state || !state.available) return 'unavailable';
  const desired = new Set(desiredRulesets({
    adTrackerProtection: { enabled: state.enabled, blockAds: state.blockAds, blockTrackers: state.blockTrackers },
  }));
  const live: Set<string> = new Set(
    (Array.isArray(state.enabledRulesets) ? state.enabledRulesets : [])
      .filter((id) => id === AD_RULESET_ID || id === TRACKER_RULESET_ID)
  );
  if (desired.size !== live.size || [...desired].some((id) => !live.has(id))) return 'attention';
  if (desired.size > 0) return 'active';
  if (state.enabled === true) return 'inactive';
  return 'off';
}

// Pure view-model shared by popup and options so both render identical
// states. Preferences are preserved as-is; only the status pill and control
// enablement reflect the desired-vs-actual comparison.
export interface AdblockViewState {
  status: AdblockRuntimeStatus;
  controlsDisabled: boolean;
  globalChecked: boolean;
  adsChecked: boolean;
  trackersChecked: boolean;
  showApplyWarning: boolean;
}

export function adblockViewState(state: AdblockState | null | undefined): AdblockViewState {
  const status = adblockRuntimeStatus(state);
  const globalChecked = state?.enabled === true;
  const blockAds = state?.blockAds === true;
  const blockTrackers = state?.blockTrackers === true;
  if (status === 'unavailable') {
    return { status, controlsDisabled: true, globalChecked: false, adsChecked: false, trackersChecked: false, showApplyWarning: false };
  }
  if (status === 'off') {
    return { status, controlsDisabled: true, globalChecked, adsChecked: blockAds, trackersChecked: blockTrackers, showApplyWarning: false };
  }
  return {
    status,
    controlsDisabled: false,
    globalChecked,
    adsChecked: blockAds,
    trackersChecked: blockTrackers,
    showApplyWarning: status === 'attention',
  };
}

export function adblockStatusPresentation(status: AdblockRuntimeStatus): { label: string; className: string } {
  if (status === 'active') return { label: 'On', className: 'healthy' };
  if (status === 'off') return { label: 'Off', className: 'unknown' };
  if (status === 'inactive') return { label: 'Inactive', className: 'unknown' };
  if (status === 'attention') return { label: 'Needs attention', className: 'warn' };
  return { label: 'Unavailable', className: 'degraded' };
}

// Narrow state snapshot for popup/options. adsActive/trackersActive report
// the live ruleset state so the UI can distinguish intent from reality.
export async function getAdblockState(
  settings: AdblockSettingsView | null | undefined,
  apiOverride?: DeclarativeNetRequestApi | null
): Promise<AdblockState> {
  const flags = readFlags(settings);
  const api = resolveApi(apiOverride === undefined ? null : apiOverride);
  if (!api) {
    return { available: false, enabled: flags.enabled, blockAds: flags.blockAds, blockTrackers: flags.blockTrackers, adsActive: false, trackersActive: false, enabledRulesets: [] };
  }
  try {
    const enabled = await api.getEnabledRulesets();
    const live = new Set(Array.isArray(enabled) ? enabled : []);
    return {
      available: true,
      enabled: flags.enabled,
      blockAds: flags.blockAds,
      blockTrackers: flags.blockTrackers,
      adsActive: live.has(AD_RULESET_ID),
      trackersActive: live.has(TRACKER_RULESET_ID),
      enabledRulesets: [...live],
    };
  } catch (_) {
    return { available: false, enabled: flags.enabled, blockAds: flags.blockAds, blockTrackers: flags.blockTrackers, adsActive: false, trackersActive: false, enabledRulesets: [] };
  }
}
