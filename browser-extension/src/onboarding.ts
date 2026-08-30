import { ProviderDescriptor, SettingsV2 } from './contracts';
import { PROVIDERS } from './providers';
import { applyTheme, send, setText } from './ui';

const SITE_ORIGINS = ['http://*/*', 'https://*/*'] as const;

async function load(): Promise<void> {
  const state = await send<{ settings: SettingsV2; display: { theme: any } }>('GET_SETTINGS');
  applyTheme(state.display.theme);
  (document.getElementById('choice-hibp') as HTMLInputElement).checked = state.settings.onlineServices.hibp;
  (document.getElementById('choice-feed') as HTMLInputElement).checked = state.settings.onlineServices.feed;
  (document.getElementById('choice-google') as HTMLInputElement).checked = state.settings.onlineServices.googleSafeBrowsing;
  // Default new installations to continuous protection after one browser
  // permission prompt while preserving a confirmed on-demand choice.
  (document.getElementById('choice-continuous') as HTMLInputElement).checked =
    state.settings.continuousAccess || !state.settings.onboarding.confirmedAt;
  const continuousLabel = document.getElementById('choice-continuous')?.closest('label');
  const continuousIntro = continuousLabel?.closest('.step')?.querySelector('p.subtle');
  const continuousTitle = continuousLabel?.querySelector('.switch-title');
  const continuousNote = continuousLabel?.querySelector('.switch-note');
  if (continuousIntro) continuousIntro.textContent = 'Soterios can access HTTP and HTTPS sites to identify password fields and show warnings automatically. Granting access once prevents you from having to click “Protect this page” on every website. You can leave this off to use on-demand protection instead.';
  if (continuousTitle) continuousTitle.textContent = 'Protect sites automatically';
  if (continuousNote) continuousNote.textContent = 'Recommended; your browser will ask for permission once.';
  document.getElementById('upgrade-notice')!.hidden = !state.settings.onboarding.reuseResetNoticePending;
  if (state.settings.onboarding.confirmedAt) {
    setText('confirm-status', `Choices last confirmed ${new Date(state.settings.onboarding.confirmedAt).toLocaleString()}.`);
  }
}

document.getElementById('confirm')!.addEventListener('click', () => {
  const button = document.getElementById('confirm') as HTMLButtonElement;
  const continuous = document.getElementById('choice-continuous') as HTMLInputElement;
  if (button.disabled) return;
  const choices = {
    hibp: (document.getElementById('choice-hibp') as HTMLInputElement).checked,
    feed: (document.getElementById('choice-feed') as HTMLInputElement).checked,
    googleSafeBrowsing: (document.getElementById('choice-google') as HTMLInputElement).checked
  };
  setText('confirm-status', 'Saving choices and requesting selected permissions…');
  try {
    const providerOrigins = (Object.keys(choices) as Array<keyof typeof choices>)
      .filter((id) => choices[id])
      .flatMap((id) => [...PROVIDERS[id].origins]);
    const requestedOrigins = continuous.checked
      ? [...providerOrigins, ...SITE_ORIGINS]
      : providerOrigins;

    // Start the permission request synchronously while this trusted click is
    // still active. Chaining it from an async listener (or asking the worker
    // to start it after a message) can make Chromium reject the request as
    // not being user initiated.
    const permissionRequest = requestedOrigins.length
      ? chrome.permissions.request({ origins: requestedOrigins })
      : Promise.resolve(true);
    // Disable only after the API has been invoked. Some Chromium builds tie
    // the transient activation to the event's target while dispatching it.
    button.disabled = true;
    setText('confirm-status', 'Saving choices and requesting selected permissions…');

    void permissionRequest.then(async () => {
      const continuousGranted = continuous.checked
        && await chrome.permissions.contains({ origins: [...SITE_ORIGINS] });
      await send<{ settings: SettingsV2; providers: ProviderDescriptor[] }>('CONFIRM_ONBOARDING', {
        ...choices,
        continuousAccess: continuousGranted
      });
      setText('confirm-status', continuousGranted
        ? 'Choices confirmed. Protection now runs automatically on HTTP and HTTPS sites.'
        : 'Choices confirmed. Use “Protect this page” when you want on-demand protection.');
      button.textContent = 'Choices confirmed';
    }).catch((error) => {
      setText('confirm-status', error instanceof Error ? error.message : String(error));
      button.disabled = false;
    });
  } catch (error) {
    setText('confirm-status', error instanceof Error ? error.message : String(error));
    button.disabled = false;
  }
});

void load();
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
document.getElementById('choice-desktop')?.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  const permissionRequest = input.checked
    ? chrome.permissions.request({ permissions: ['nativeMessaging'] })
    : chrome.permissions.remove({ permissions: ['nativeMessaging'] }).then(() => true);
  void permissionRequest.then(async (granted) => {
    if (input.checked && !granted) { input.checked = false; return; }
    await send('UPDATE_SETTINGS', { desktop: { sharingEnabled: input.checked } });
  }).catch((error) => {
    input.checked = false;
    setText('confirm-status', error instanceof Error ? error.message : String(error));
  });
});
