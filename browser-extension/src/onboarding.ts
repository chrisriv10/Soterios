import { ProviderDescriptor, SettingsV2 } from './contracts';
import { PROVIDERS } from './providers';
import { applyTheme, send, setText } from './ui';
async function load(): Promise<void> { const state = await send<{ settings: SettingsV2; display: { theme: any } }>('GET_SETTINGS'); applyTheme(state.display.theme); (document.getElementById('choice-hibp') as HTMLInputElement).checked = state.settings.onlineServices.hibp; (document.getElementById('choice-feed') as HTMLInputElement).checked = state.settings.onlineServices.feed; (document.getElementById('choice-google') as HTMLInputElement).checked = state.settings.onlineServices.googleSafeBrowsing; (document.getElementById('choice-continuous') as HTMLInputElement).checked = state.settings.continuousAccess; document.getElementById('upgrade-notice')!.hidden = !state.settings.onboarding.reuseResetNoticePending; if (state.settings.onboarding.confirmedAt) setText('confirm-status', `Choices last confirmed ${new Date(state.settings.onboarding.confirmedAt).toLocaleString()}.`); }
document.getElementById('confirm')!.addEventListener('click', async () => { const button = document.getElementById('confirm') as HTMLButtonElement; button.disabled = true; const choices = { hibp: (document.getElementById('choice-hibp') as HTMLInputElement).checked, feed: (document.getElementById('choice-feed') as HTMLInputElement).checked, googleSafeBrowsing: (document.getElementById('choice-google') as HTMLInputElement).checked }; setText('confirm-status', 'Saving choices and requesting selected provider permissions…'); try { const origins = (Object.keys(choices) as Array<keyof typeof choices>).filter((id) => choices[id]).flatMap((id) => [...PROVIDERS[id].origins]); if (origins.length) await chrome.permissions.request({ origins }); await send<{ settings: SettingsV2; providers: ProviderDescriptor[] }>('CONFIRM_ONBOARDING', choices); if ((document.getElementById('choice-continuous') as HTMLInputElement).checked) await send('REQUEST_CONTINUOUS_ACCESS'); setText('confirm-status', 'Choices confirmed. Online services now follow these settings.'); button.textContent = 'Choices confirmed'; } catch (error) { setText('confirm-status', error instanceof Error ? error.message : String(error)); button.disabled = false; } }); void load();
const settingsButton = document.createElement('a');
settingsButton.className = 'button';
settingsButton.href = 'options.html';
settingsButton.target = '_blank';
settingsButton.textContent = 'Open settings';
document.querySelector('.appbar')?.append(settingsButton);

const desktopCard = document.createElement('section');
desktopCard.className = 'step card onboarding-step';
desktopCard.innerHTML = '<h2>Desktop integration</h2><p class="subtle">Optionally share minimal finding summaries with the Soterios desktop app through the local bridge.</p><label class="switch"><input id="choice-desktop" type="checkbox" role="switch"><span class="switch-track"></span><span class="switch-copy"><span class="switch-title">Share findings with desktop</span><span class="switch-note">You can change this later in Settings.</span></span></label>';
document.querySelector('.confirm-bar')?.before(desktopCard);
void send<{ settings: SettingsV2 }>('GET_SETTINGS').then((state) => {
  const input = document.getElementById('choice-desktop') as HTMLInputElement | null;
  if (input) input.checked = state.settings.desktop.sharingEnabled;
});
document.getElementById('choice-desktop')?.addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;
  if (input.checked) {
    const granted = await chrome.permissions.request({ permissions: ['nativeMessaging'] });
    if (!granted) { input.checked = false; return; }
  } else {
    await chrome.permissions.remove({ permissions: ['nativeMessaging'] });
  }
  await send('UPDATE_SETTINGS', { desktop: { sharingEnabled: input.checked } });
});
