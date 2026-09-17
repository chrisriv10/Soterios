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

// Narrow state snapshot for future popup/options integration.
export async function getAdblockState(
  settings: { adTrackerProtection?: Partial<AdTrackerProtection> | null },
  apiOverride?: DeclarativeNetRequestApi | null
): Promise<AdblockState> {
  const flags = readFlags(settings);
  const api = resolveApi(apiOverride === undefined ? null : apiOverride);
  if (!api) {
    return { available: false, enabled: flags.enabled, blockAds: flags.blockAds, blockTrackers: flags.blockTrackers, enabledRulesets: [] };
  }
  try {
    const enabled = await api.getEnabledRulesets();
    return {
      available: true,
      enabled: flags.enabled,
      blockAds: flags.blockAds,
      blockTrackers: flags.blockTrackers,
      enabledRulesets: Array.isArray(enabled) ? [...enabled] : [],
    };
  } catch (_) {
    return { available: false, enabled: flags.enabled, blockAds: flags.blockAds, blockTrackers: flags.blockTrackers, enabledRulesets: [] };
  }
}
