import { ProtectionEvent, ProtectionVerdict, ProviderDescriptor, SettingsV2 } from './contracts';
import { AdblockState, adblockStatusPresentation, adblockViewState } from './adblock';
import { applyTheme, formatContact, reasonLabel, send, setText } from './ui';

type PopupState = { settings: SettingsV2; display: { theme: any }; domain: string; verdict: ProtectionVerdict | null; providers: ProviderDescriptor[]; feed: { version: number; generatedAt: string; expiresAt: string; stale: boolean }; desktop: string };

function statusPresentation(verdict: ProtectionVerdict | null, confirmed: boolean) {
  if (!confirmed) return { label: 'Setup required', mark: '·', className: 'unknown' };
  if (!verdict || verdict.verdict === 'unknown') return { label: verdict?.reasons.includes('SITE_PAUSED') ? 'Paused' : 'Attention', mark: '?', className: 'warning' };
  if (verdict.verdict === 'danger') return { label: 'Known risk found', mark: '!', className: 'danger' };
  if (verdict.verdict === 'warning') return { label: 'Review advised', mark: '!', className: 'warning' };
  return { label: 'No known risks found', mark: '✓', className: 'clear' };
}
function renderState(state: PopupState): void {
  applyTheme(state.display.theme); setText('current-domain', state.domain || 'This browser page');
  const presentation = statusPresentation(state.verdict, Boolean(state.settings.onboarding.confirmedAt));
  setText('site-status', presentation.label); setText('state-mark', presentation.mark); setText('header-status', presentation.label);
  const header = document.getElementById('header-status')!; header.className = `status ${presentation.className}`;
  const reasons = state.verdict?.reasons || [];
  setText('site-reasons', reasons.length ? reasons.map(reasonLabel).join(' · ') : 'No known risks were found by the currently available protection signals. This is not a guarantee that a site is safe.');
  const feed = document.getElementById('feed-status')!; feed.textContent = state.feed.stale ? 'Stale' : `v${state.feed.version} · ${formatContact(state.feed.generatedAt)}`; feed.className = `status ${state.feed.stale ? 'degraded' : 'healthy'}`;
  const desktop = document.getElementById('desktop-status')!; desktop.textContent = state.desktop === 'configured' ? 'Configured' : state.desktop === 'permission_required' ? 'Permission needed' : 'Not enabled'; desktop.className = `status ${state.desktop === 'configured' ? 'healthy' : 'unknown'}`;
  const paused = reasons.includes('SITE_PAUSED'); (document.getElementById('resume-site') as HTMLButtonElement).hidden = !paused; (document.getElementById('pause-hour') as HTMLButtonElement).hidden = paused; (document.getElementById('pause-site') as HTMLButtonElement).hidden = paused;
}
async function loadState(): Promise<void> { try { renderState(await send<PopupState>('GET_STATE')); } catch (error) { setText('site-status', 'Unavailable'); setText('site-reasons', error instanceof Error ? error.message : String(error)); } }

let adblockBusy = false;

function renderAdblock(state: AdblockState | null): void {
  const view = adblockViewState(state);
  const presentation = adblockStatusPresentation(view.status);
  const pill = document.getElementById('adblock-status')!;
  pill.textContent = presentation.label;
  pill.className = `status ${presentation.className}`;
  const enabledInput = document.getElementById('adblock-enabled') as HTMLInputElement;
  const adsInput = document.getElementById('adblock-ads') as HTMLInputElement;
  const trackersInput = document.getElementById('adblock-trackers') as HTMLInputElement;
  enabledInput.checked = view.globalChecked;
  adsInput.checked = view.adsChecked;
  trackersInput.checked = view.trackersChecked;
  // The global toggle always stays operable except when DNR itself is
  // unavailable; child toggles follow the view model.
  enabledInput.disabled = view.status === 'unavailable';
  adsInput.disabled = view.controlsDisabled;
  trackersInput.disabled = view.controlsDisabled;
  const warning = document.getElementById('adblock-warning')!;
  warning.hidden = !view.showApplyWarning;
  if (view.showApplyWarning) warning.textContent = 'Settings and active blocking disagree. Blocking may be partially off.';
}

async function loadAdblock(): Promise<void> {
  try {
    renderAdblock(await send<AdblockState>('GET_ADBLOCK_STATE'));
  } catch (_) {
    renderAdblock(null);
  }
}

async function updateAdblock(patch: { enabled?: boolean; blockAds?: boolean; blockTrackers?: boolean }): Promise<void> {
  if (adblockBusy) return;
  adblockBusy = true;
  try {
    await send('UPDATE_SETTINGS', { adTrackerProtection: patch });
  } catch (_) {
    // Fall through to the authoritative refresh below so the UI reflects
    // actual state instead of the attempted change.
  } finally {
    await loadAdblock();
    adblockBusy = false;
  }
}
async function loadActivity(): Promise<void> {
  const { events } = await send<{ events: ProtectionEvent[] }>('GET_HISTORY'); const container = document.getElementById('recent-activity')!; container.replaceChildren();
  if (!events.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'No findings recorded.'; container.appendChild(empty); return; }
  for (const event of events.slice(0, 5)) { const item = document.createElement('article'); item.className = 'history-item'; const title = document.createElement('h3'); title.textContent = reasonLabel(event.reasonCodes[0] || event.category); const meta = document.createElement('div'); meta.className = 'history-meta'; meta.textContent = `${event.domain || 'Unknown site'} · ${new Date(event.timestamp).toLocaleString()}`; item.append(title, meta); container.appendChild(item); }
}
document.querySelectorAll<HTMLButtonElement>('.tab').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll<HTMLButtonElement>('.tab').forEach((candidate) => candidate.setAttribute('aria-selected', String(candidate === tab))); document.querySelectorAll<HTMLElement>('.view').forEach((view) => { view.hidden = view.id !== tab.dataset.view; }); if (tab.dataset.view === 'activity-view') void loadActivity(); }));
const passwordInput = document.getElementById('password-input') as HTMLInputElement;
passwordInput.addEventListener('input', async () => { const result = await send<{ score: number; label: string; suggestions: string[] }>('ANALYZE_PASSWORD', { password: passwordInput.value }); (document.getElementById('strength-meter') as HTMLElement).style.width = `${result.score * 25}%`; setText('strength-result', `${result.label}. ${result.suggestions.join(' ')}`); });
document.getElementById('check-password')!.addEventListener('click', async () => { const output = document.getElementById('hibp-result')!; output.hidden = false; output.textContent = 'Checking one completed password…'; try { const result = await send<{ hibp: { found: boolean; count: number } | null; serviceState: string }>('CHECK_PASSWORD', { password: passwordInput.value }); output.className = `notice ${result.hibp?.found ? 'danger' : ''}`; output.textContent = result.hibp?.found ? `Seen ${result.hibp.count.toLocaleString()} times in the breach corpus. Change it anywhere you use it.` : result.hibp ? 'No match found in the breach corpus. This does not guarantee the password is safe.' : `HIBP is ${result.serviceState.replace('_', ' ')}.`; } catch (error) { output.className = 'notice warning'; output.textContent = error instanceof Error ? error.message : String(error); } });
document.getElementById('generate')!.addEventListener('click', async () => { const mode = (document.getElementById('generator-mode') as HTMLSelectElement).value; const result = await send<{ value: string }>('GENERATE_PASSWORD', { mode, length: 20, words: 5 }); (document.getElementById('generated-value') as HTMLInputElement).value = result.value; });
document.getElementById('copy-generated')!.addEventListener('click', async () => { const field = document.getElementById('generated-value') as HTMLInputElement; if (field.value) await navigator.clipboard.writeText(field.value); setText('copy-generated', field.value ? 'Copied' : 'Generate first'); });
document.getElementById('on-demand')!.addEventListener('click', async () => { await send('RUN_ON_DEMAND'); window.close(); });
document.getElementById('pause-hour')!.addEventListener('click', async () => { await send('PAUSE_SITE', { duration: 'hour' }); await loadState(); }); document.getElementById('pause-site')!.addEventListener('click', async () => { await send('PAUSE_SITE', { duration: 'indefinite' }); await loadState(); }); document.getElementById('resume-site')!.addEventListener('click', async () => { await send('RESUME_SITE'); await loadState(); });
document.getElementById('open-history')!.addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('activity.html') })); void loadState();
(document.getElementById('adblock-enabled') as HTMLInputElement).addEventListener('change', (event) => void updateAdblock({ enabled: (event.target as HTMLInputElement).checked }));
(document.getElementById('adblock-ads') as HTMLInputElement).addEventListener('change', (event) => void updateAdblock({ blockAds: (event.target as HTMLInputElement).checked }));
(document.getElementById('adblock-trackers') as HTMLInputElement).addEventListener('change', (event) => void updateAdblock({ blockTrackers: (event.target as HTMLInputElement).checked }));
void loadAdblock();
const generatorHeading = document.querySelector('#tools-view .card:nth-child(2) h2');
if (generatorHeading) generatorHeading.textContent = 'Password/passphrase generator';
