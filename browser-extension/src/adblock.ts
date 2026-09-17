import { AdTrackerProtection } from './contracts';

// Static ruleset IDs registered in the generated manifest. These strings are
// part of the packaged contract: build-extension.mjs, this controller, and
// tests assert them, so renaming requires updating all three.
export const AD_RULESET_ID = 'soterios-ads';
export const TRACKER_RULESET_ID = 'soterios-trackers';

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

function readFlags(settings: { adTrackerProtection?: Partial<AdTrackerProtection> | null }): Required<AdTrackerProtection> {
  const value = settings?.adTrackerProtection || {};
  return {
    enabled: value.enabled === true,
    blockAds: value.blockAds !== false,
    blockTrackers: value.blockTrackers !== false,
  };
}

// Pure mapping from settings to the exact static rulesets that must be on.
// No Chrome API access; fully unit-testable.
export function desiredRulesets(settings: { adTrackerProtection?: Partial<AdTrackerProtection> | null }): string[] {
  const flags = readFlags(settings);
  if (!flags.enabled) return [];
  const ids: string[] = [];
  if (flags.blockAds) ids.push(AD_RULESET_ID);
  if (flags.blockTrackers) ids.push(TRACKER_RULESET_ID);
  return ids;
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
  settings: { adTrackerProtection?: Partial<AdTrackerProtection> | null },
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

// Narrow patch application for UPDATE_SETTINGS. Only the three supported
// booleans are accepted; unknown fields, wrong types, and arbitrary ruleset
// IDs or DNR operations are ignored. Missing keys keep current values.
export function applyAdTrackerPatch(
  current: AdTrackerProtection,
  patch: unknown
): AdTrackerProtection {
  const next: AdTrackerProtection = {
    enabled: current.enabled,
    blockAds: current.blockAds,
    blockTrackers: current.blockTrackers,
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
  settings: { adTrackerProtection?: Partial<AdTrackerProtection> | null },
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
