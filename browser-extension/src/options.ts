import { ProviderDescriptor, ProviderId, SettingsV2, THEME_KEYS, ThemeKey } from './contracts';
import { PROVIDERS } from './providers';
import { applyTheme, downloadJson, formatContact, send, setText } from './ui';

let settings: SettingsV2;
let currentTheme: ThemeKey = 'system';

const themeColors: Record<ThemeKey, [string, string]> = {
  system: ['#f5f7fb', '#1d4ed8'], dark: ['#0b0e14', '#58a6ff'], light: ['#f5f7fb', '#2563eb'],
  sunset: ['#1c1214', '#f97316'], violet: ['#140f1f', '#8b5cf6'], crimson: ['#020202', '#dc2626'],
  terminal: ['#010201', '#16a34a'],
  ocean: ['#07131f', '#2dd4bf'], emerald: ['#0a1f17', '#32e06f'], midnight: ['#0a0e1a', '#38bdf8'],
  bumblebee: ['#0c0b08', '#facc15'], monochrome: ['#0a0a0a', '#e5e5e5'], rose: ['#1a1216', '#f472b6'], aurora: ['#0b1220', '#7dd3fc'],
  sand: ['#f6ecd8', '#c2571b'], cyber: ['#05030a', '#ff00ff'], mint: ['#08120a', '#86efac']
};

function showProviderMessage(message: string, warning = false): void {
  const element = document.getElementById('provider-message')!; element.hidden = false; element.textContent = message; element.className = `notice${warning ? ' warning' : ''}`;
}

function renderProviders(providers: ProviderDescriptor[]): void {
  for (const provider of providers) {
    const health = document.getElementById(`health-${provider.id}`)!; health.textContent = provider.health.replace('_', ' '); health.className = `status ${provider.health}`;
    setText(`contact-${provider.id}`, formatContact(provider.lastContact));
    (document.getElementById(`provider-${provider.id}`) as HTMLInputElement).checked = provider.enabled;
  }
}

function renderSites(): void {
  const container = document.getElementById('sites-list')!; container.replaceChildren();
  const entries = Object.entries(settings.sites).filter(([, rule]) => rule.pausedUntil === null || Date.parse(rule.pausedUntil) > Date.now());
  if (!entries.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'No paused sites.'; container.appendChild(empty); return; }
  for (const [domain, rule] of entries) {
    const row = document.createElement('div'); row.className = 'row history-item';
    const copy = document.createElement('div'); const title = document.createElement('h3'); title.textContent = domain; const note = document.createElement('div'); note.className = 'history-meta'; note.textContent = rule.pausedUntil ? `Paused until ${new Date(rule.pausedUntil).toLocaleString()}` : 'Paused indefinitely'; copy.append(title, note);
    const resume = document.createElement('button'); resume.className = 'button small'; resume.textContent = 'Resume'; resume.addEventListener('click', async () => { await send('RESUME_SITE', { domain }); delete settings.sites[domain]; renderSites(); });
    row.append(copy, resume); container.appendChild(row);
  }
}

function renderThemes(): void {
  const grid = document.getElementById('theme-grid')!; grid.replaceChildren();
  for (const theme of THEME_KEYS) {
    const label = document.createElement('label'); label.className = 'theme-choice';
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'theme'; input.value = theme; input.checked = theme === currentTheme;
    const tile = document.createElement('span'); tile.className = 'theme-tile'; const swatch = document.createElement('span'); swatch.className = 'theme-swatch'; swatch.style.setProperty('--tile-bg', themeColors[theme][0]); swatch.style.setProperty('--tile-accent', themeColors[theme][1]); const name = document.createElement('span'); name.textContent = theme === 'system' ? 'System (recommended)' : theme.replaceAll('-', ' '); tile.append(swatch, name); label.append(input, tile);
    input.addEventListener('change', async () => { currentTheme = theme; applyTheme(theme); await chrome.storage.sync.set({ displaySettingsV2: { theme, compactPopup: false } }); });
    grid.appendChild(label);
  }
}

async function update(patch: unknown): Promise<void> {
  const result = await send<{ settings: SettingsV2; providers: ProviderDescriptor[] }>('UPDATE_SETTINGS', patch); settings = result.settings; renderProviders(result.providers);
}

async function refresh(): Promise<void> {
  const state = await send<{ settings: SettingsV2; display: { theme: ThemeKey } }>('GET_SETTINGS'); settings = state.settings; currentTheme = state.display.theme; applyTheme(currentTheme);
  (document.getElementById('credential-protection') as HTMLInputElement).checked = settings.credentialProtection;
  (document.getElementById('online-global') as HTMLInputElement).checked = settings.onlineServices.enabled;
  (document.getElementById('history-enabled') as HTMLInputElement).checked = settings.history.enabled;
  (document.getElementById('desktop-sharing') as HTMLInputElement).checked = settings.desktop.sharingEnabled;
  const hasContinuous = await chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] });
  setText('continuous-note', hasContinuous ? 'Enabled for HTTP and HTTPS sites.' : 'On-demand mode; no persistent site access.');
  (document.getElementById('grant-continuous') as HTMLButtonElement).hidden = hasContinuous; (document.getElementById('revoke-continuous') as HTMLButtonElement).hidden = !hasContinuous;
  renderProviders(await send<ProviderDescriptor[]>('GET_PROVIDER_DESCRIPTORS')); renderSites(); renderThemes();
  if (!settings.onboarding.confirmedAt) showProviderMessage('Online requests remain suspended until you confirm the first-run disclosure.', true);
}

document.getElementById('credential-protection')!.addEventListener('change', (event) => void update({ credentialProtection: (event.target as HTMLInputElement).checked }));
document.getElementById('online-global')!.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  const enabled = input.checked;
  const origins = enabled
    ? (Object.keys(PROVIDERS) as ProviderId[]).filter((id) => settings.onlineServices[id]).flatMap((id) => [...PROVIDERS[id].origins])
    : [];
  try {
    const permissionRequest = origins.length
      ? chrome.permissions.request({ origins })
      : Promise.resolve(true);
    void permissionRequest.then(async () => {
      await update({ onlineServices: { enabled } });
      showProviderMessage(enabled ? 'Online services follow the individual provider switches.' : 'All online protection services are off. In-flight requests were cancelled and provider permissions removed.');
    }).catch((error) => {
      input.checked = false;
      showProviderMessage(error instanceof Error ? error.message : String(error), true);
    });
  } catch (error) {
    input.checked = false;
    showProviderMessage(error instanceof Error ? error.message : String(error), true);
  }
});
for (const id of Object.keys(PROVIDERS) as ProviderId[]) {
  document.getElementById(`provider-${id}`)!.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    const enabled = input.checked;
    try {
      const permissionRequest = enabled
        ? chrome.permissions.request({ origins: [...PROVIDERS[id].origins] })
        : Promise.resolve(true);
      void permissionRequest.then(async () => {
        await update({ onlineServices: { [id]: enabled } });
      }).catch((error) => {
        input.checked = false;
        showProviderMessage(error instanceof Error ? error.message : String(error), true);
      });
    } catch (error) {
      input.checked = false;
      showProviderMessage(error instanceof Error ? error.message : String(error), true);
    }
  });
}
document.getElementById('grant-continuous')!.addEventListener('click', () => {
  try {
    // Keep the permission request in this click handler so Chromium preserves
    // the user's gesture and shows the one-time all-sites permission prompt.
    const permissionRequest = chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] });
    void permissionRequest.then(async (granted) => {
      await send('REQUEST_CONTINUOUS_ACCESS', { granted });
      await refresh();
    }).catch((error) => {
      showProviderMessage(error instanceof Error ? error.message : String(error), true);
    });
  } catch (error) {
    showProviderMessage(error instanceof Error ? error.message : String(error), true);
  }
});
document.getElementById('revoke-continuous')!.addEventListener('click', async () => { await send('REVOKE_CONTINUOUS_ACCESS'); await refresh(); });
document.getElementById('history-enabled')!.addEventListener('change', (event) => void update({ history: { enabled: (event.target as HTMLInputElement).checked } }));
document.getElementById('save-google-key')!.addEventListener('click', async () => { const input = document.getElementById('google-key') as HTMLInputElement; try { await send('SET_GOOGLE_KEY', { key: input.value }); input.value = ''; showProviderMessage('Google Safe Browsing key saved in trusted local extension storage.'); } catch (error) { showProviderMessage(error instanceof Error ? error.message : String(error), true); } });
document.getElementById('desktop-sharing')!.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  const permissionRequest = input.checked
    ? chrome.permissions.request({ permissions: ['nativeMessaging'] })
    : chrome.permissions.remove({ permissions: ['nativeMessaging'] }).then(() => true);
  void permissionRequest.then(async (granted) => {
    if (input.checked && !granted) { input.checked = false; return; }
    await update({ desktop: { sharingEnabled: input.checked } });
    setText('desktop-message', input.checked ? 'Minimal findings can be forwarded over the local named-pipe bridge.' : 'Desktop integration is optional and currently disabled.');
  }).catch((error) => {
    input.checked = false;
    showProviderMessage(error instanceof Error ? error.message : String(error), true);
  });
});
document.getElementById('export-history')!.addEventListener('click', async () => downloadJson('soterios-findings.json', await send('EXPORT_HISTORY')));
document.getElementById('clear-history')!.addEventListener('click', async () => { if (confirm('Delete all local Soterios finding history?')) { await send('CLEAR_HISTORY'); showProviderMessage('Local finding history deleted.'); } });
void refresh();
