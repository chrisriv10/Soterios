import { HISTORY_RETENTION_DAYS, ProtectionEvent } from './contracts';

export const HISTORY_KEY = 'protectionHistoryV2';
const MAX_EVENTS = 500;

export function pruneHistory(events: ProtectionEvent[], now = Date.now()): ProtectionEvent[] {
  const cutoff = now - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return events
    .filter((event) => Number.isFinite(Date.parse(event.timestamp)) && Date.parse(event.timestamp) >= cutoff)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, MAX_EVENTS);
}

export async function getHistory(): Promise<ProtectionEvent[]> {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const events = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
  const pruned = pruneHistory(events);
  if (pruned.length !== events.length) await chrome.storage.local.set({ [HISTORY_KEY]: pruned });
  return pruned;
}

export async function recordFinding(event: ProtectionEvent, incognito: boolean, enabled = true): Promise<void> {
  if (incognito || !enabled || !event.reasonCodes.length) return;
  const history = await getHistory();
  const duplicate = history.find((prior) => prior.domain === event.domain
    && prior.category === event.category
    && prior.reasonCodes.join('|') === event.reasonCodes.join('|')
    && Date.parse(event.timestamp) - Date.parse(prior.timestamp) < 10 * 60 * 1000);
  if (duplicate) return;
  await chrome.storage.local.set({ [HISTORY_KEY]: pruneHistory([event, ...history]) });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(HISTORY_KEY);
}
