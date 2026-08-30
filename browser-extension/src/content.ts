import { RuntimeRequest, RuntimeResponse } from './contracts';

declare global { interface Window { __soteriosProtectionV2?: { teardown(): void } } }

if (window.__soteriosProtectionV2) {
  window.__soteriosProtectionV2.teardown();
}

const controller = new AbortController();
const observers: MutationObserver[] = [];
const observedRoots = new WeakSet<Document | ShadowRoot>();
const fieldButtons = new Map<HTMLInputElement, HTMLButtonElement>();
const lastCheckedValue = new WeakMap<HTMLInputElement, string>();
const checkedForms = new WeakMap<HTMLFormElement, string>();
let enabled = true;
let lastUrl = location.href;
let lastSiteNoticeKey = '';

const host = document.createElement('div');
host.id = 'soterios-protection-root';
host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;';
(document.documentElement || document.body).appendChild(host);
const shadow = host.attachShadow({ mode: 'closed' });

const style = document.createElement('style');
style.textContent = `
  :host{all:initial;color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  *{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  .field-button{position:fixed;width:28px;height:28px;padding:0;border:1px solid #7a91a8;border-radius:9px;background:#102131;color:#eaf4ff;box-shadow:0 5px 18px #0005;display:flex;align-items:center;justify-content:center;line-height:0;pointer-events:auto;cursor:pointer;font:700 13px/1 system-ui}
  .field-button img{width:18px;height:18px;display:block;margin:0;object-fit:contain;object-position:center;pointer-events:none}
  .field-button:hover{background:#18354d}.field-button:focus-visible,.action:focus-visible{outline:3px solid #63b3ed;outline-offset:2px}
  .field-button[data-state="warning"]{border-color:#e9b949;color:#ffe19a}.field-button[data-state="danger"]{border-color:#ff7878;color:#ffb4b4}.field-button[data-state="clear"]{border-color:#62c9a5;color:#a4f1d7}
  .notice{position:fixed;right:18px;bottom:18px;width:min(380px,calc(100vw - 36px));padding:16px;border:1px solid #39536b;border-radius:15px;background:#0d1a27;color:#ecf4fb;box-shadow:0 18px 50px #0008;pointer-events:auto;animation:enter .18s ease-out}
  .notice.warning{border-color:#a17922}.notice.danger{border-color:#ad4545}.notice h2{margin:0 0 7px;font-size:15px}.notice p{margin:0;color:#bfd0df;font-size:13px;line-height:1.45}.notice .meta{margin-top:9px;font-size:12px;color:#90a8bc}.notice .close{position:absolute;right:9px;top:8px;border:0;background:transparent;color:#c9d8e5;font-size:18px;cursor:pointer}
  .interstitial{position:fixed;inset:0;width:100vw;height:100vh;background:linear-gradient(145deg,#100f16 0%,#21151b 100%);color:#fff;display:grid;place-items:center;pointer-events:auto}
  .panel{width:min(580px,calc(100vw - 32px));border:1px solid #6f3b44;border-radius:22px;background:#1b151b;padding:28px;box-shadow:0 26px 90px #000a}.mark{width:48px;height:48px;border-radius:15px;background:#55232c;color:#ffbdc5;display:grid;place-items:center;font-size:25px;font-weight:800}.panel h1{font-size:25px;margin:18px 0 9px}.panel p{color:#d7c7ca;line-height:1.55}.reason{padding:11px 13px;border-radius:11px;background:#291b20;color:#f1d9dc;font-size:13px}.actions{display:flex;gap:10px;margin-top:22px;flex-wrap:wrap}.action{border:1px solid #76505a;border-radius:10px;padding:10px 15px;background:#291b20;color:#fff;font:650 14px system-ui;cursor:pointer}.action.primary{background:#d14b5e;border-color:#d14b5e;color:#16090b}
  @keyframes enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;
shadow.appendChild(style);

function requestId(): string { return `content_${crypto.randomUUID().replace(/-/g, '')}`; }

async function send<T>(type: string, payload: unknown = {}): Promise<T> {
  const request: RuntimeRequest = { protocol: 2, requestId: requestId(), type, payload };
  const result = await chrome.runtime.sendMessage(request) as RuntimeResponse<T>;
  if (!result?.ok) throw new Error(result?.error?.message || 'Soterios could not complete the request.');
  return result.payload as T;
}

function reasonText(code: string): string {
  const reasons: Record<string, string> = {
    SIGNED_FEED_PHISHING: 'This address matches a signed, high-confidence phishing indicator.',
    SIGNED_FEED_MALWARE: 'This address matches a signed, high-confidence malware indicator.',
    IP_LITERAL_HOST: 'This address uses a numeric IP instead of a domain name.',
    DECEPTIVE_USERINFO: 'The address contains user information that can disguise its real destination.',
    PUNYCODE_HOST: 'This internationalized domain spelling may resemble another name.',
    BRAND_IMPERSONATION: 'The domain appears to imitate a well-known brand.',
    INSECURE_CREDENTIAL_PATH: 'A sign-in-like page is being served without HTTPS.',
    CROSS_SITE_CREDENTIAL_FORM: 'This password form submits to a different registrable site.',
    INSECURE_FORM_DESTINATION: 'This password form sends data to an unencrypted destination.',
    UNUSUAL_FORM_SCHEME: 'This password form submits through an unusual URL scheme.',
    GOOGLE_MALWARE: 'Google Safe Browsing reported malware at this address.',
    GOOGLE_SOCIAL_ENGINEERING: 'Google Safe Browsing reported social engineering at this address.',
    GOOGLE_UNWANTED_SOFTWARE: 'Google Safe Browsing reported unwanted software at this address.',
    FEED_STALE: 'The local threat feed is stale, so Soterios cannot provide a current clean verdict.',
    FEED_UPDATE_FAILED: 'The latest threat-feed update failed, so Soterios cannot provide a current clean verdict.',
    FEED_PERMISSION_REQUIRED: 'Threat-feed permission is missing, so Soterios cannot provide a current clean verdict.',
    ONLINE_SETUP_REQUIRED: 'Online protection choices have not been confirmed.'
  };
  return reasons[code] || code.replaceAll('_', ' ').toLowerCase();
}

function dismissNotices(): void {
  shadow.querySelectorAll('.notice,.interstitial').forEach((element) => element.remove());
}

function showNotice(title: string, message: string, severity: 'info' | 'warning' | 'danger' = 'info', detail = ''): void {
  shadow.querySelector('.notice')?.remove();
  const notice = document.createElement('section');
  notice.className = `notice ${severity}`;
  notice.setAttribute('role', severity === 'danger' ? 'alert' : 'status');
  const heading = document.createElement('h2'); heading.textContent = title;
  const copy = document.createElement('p'); copy.textContent = message;
  const close = document.createElement('button'); close.className = 'close'; close.type = 'button'; close.setAttribute('aria-label', 'Dismiss'); close.textContent = '×';
  close.addEventListener('click', () => notice.remove());
  notice.append(heading, copy);
  if (detail) { const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = detail; notice.appendChild(meta); }
  notice.appendChild(close);
  shadow.appendChild(notice);
}

function siteNoticeKey(urlValue: string, verdict: string, reasons: string[]): string {
  try {
    const url = new URL(urlValue);
    const path = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}${path}|${verdict}|${[...reasons].sort().join(',')}`;
  } catch (_) {
    return `${urlValue}|${verdict}|${[...reasons].sort().join(',')}`;
  }
}

function showSiteNotice(urlValue: string, verdict: string, reasons: string[]): void {
  const key = siteNoticeKey(urlValue, verdict, reasons);
  if (key === lastSiteNoticeKey) return;
  lastSiteNoticeKey = key;
  showNotice(
    'Soterios found something to review',
    reasons.map(reasonText).join(' '),
    verdict === 'danger' ? 'danger' : 'warning',
    'Heuristic advisories never block the page.'
  );
}

function showInterstitial(reasons: string[]): void {
  if (window.top !== window || shadow.querySelector('.interstitial')) return;
  const layer = document.createElement('section'); layer.className = 'interstitial'; layer.setAttribute('role', 'alertdialog'); layer.setAttribute('aria-modal', 'true'); layer.setAttribute('aria-labelledby', 'soterios-warning-title');
  const panel = document.createElement('div'); panel.className = 'panel';
  const mark = document.createElement('div'); mark.className = 'mark'; mark.textContent = '!'; mark.setAttribute('aria-hidden', 'true');
  const heading = document.createElement('h1'); heading.id = 'soterios-warning-title'; heading.textContent = 'Soterios blocked interaction with this page';
  const intro = document.createElement('p'); intro.textContent = 'This page matches the signed Soterios threat feed. Avoid entering credentials or continuing unless you understand the risk.';
  const reason = document.createElement('div'); reason.className = 'reason'; reason.textContent = reasons.map(reasonText).join(' ');
  const actions = document.createElement('div'); actions.className = 'actions';
  const back = document.createElement('button'); back.className = 'action primary'; back.type = 'button'; back.textContent = 'Go back';
  const proceed = document.createElement('button'); proceed.className = 'action'; proceed.type = 'button'; proceed.textContent = 'Continue once';
  back.addEventListener('click', () => { if (history.length > 1) history.back(); else location.replace('about:blank'); });
  proceed.addEventListener('click', async () => { try { await send('CONTINUE_ONCE'); layer.remove(); } catch (error) { showNotice('Could not continue', String(error), 'warning'); } });
  actions.append(back, proceed); panel.append(mark, heading, intro, reason, actions); layer.appendChild(panel); shadow.appendChild(layer); back.focus();
}

function buttonPosition(field: HTMLInputElement, button: HTMLButtonElement): void {
  const rect = field.getBoundingClientRect();
  if (!enabled || rect.width < 20 || rect.height < 16 || rect.bottom < 0 || rect.top > innerHeight) {
    button.hidden = true; return;
  }
  button.hidden = false;
  button.style.left = `${Math.max(4, Math.min(innerWidth - 32, rect.right - 33))}px`;
  button.style.top = `${Math.max(4, Math.min(innerHeight - 32, rect.top + (rect.height - 28) / 2))}px`;
}

function setFieldGlyph(button: HTMLButtonElement, glyph: 'S' | '…' | '!' | '✓' | '?'): void {
  button.replaceChildren();
  if (glyph === 'S') {
    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('icons/icon32.png');
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);
  } else {
    button.textContent = glyph;
  }
}

async function checkField(field: HTMLInputElement): Promise<void> {
  const password = field.value;
  if (!enabled || !password || lastCheckedValue.get(field) === password) return;
  lastCheckedValue.set(field, password);
  const button = fieldButtons.get(field);
  if (button) { button.dataset.state = 'checking'; setFieldGlyph(button, '…'); button.setAttribute('aria-label', 'Soterios is checking this completed password'); }
  try {
    const [check, reuse] = await Promise.all([
      send<{ strength: { label: string }; hibp: { found: boolean; count: number } | null; serviceState: string }>('CHECK_PASSWORD', { password }),
      send<{ reused: boolean; domains: string[] }>('CHECK_REUSE', { password })
    ]);
    if (check.hibp?.found) {
      if (button) { button.dataset.state = 'danger'; setFieldGlyph(button, '!'); }
      showNotice('Password found in breach corpus', `This password was seen ${check.hibp.count.toLocaleString()} times in the breach corpus. Change it anywhere you use it.`, 'danger', `Offline strength: ${check.strength.label}`);
    } else if (reuse.reused) {
      if (button) { button.dataset.state = 'warning'; setFieldGlyph(button, '!'); }
      showNotice('Password reuse detected', `This password was previously used on ${reuse.domains.join(', ')}. Use a unique password for each site.`, 'warning', `Offline strength: ${check.strength.label}`);
    } else {
      if (button) { button.dataset.state = 'clear'; setFieldGlyph(button, '✓'); }
      const corpusText = check.hibp ? 'No match was found in the configured breach corpus.' : 'The online breach service is suspended.';
      showNotice('Password check complete', `${corpusText} This is not a guarantee that the password is safe.`, 'info', `Offline strength: ${check.strength.label}`);
    }
  } catch (error) {
    if (button) { button.dataset.state = 'warning'; setFieldGlyph(button, '?'); }
    showNotice('Password check unavailable', error instanceof Error ? error.message : String(error), 'warning');
  }
}

function addField(field: HTMLInputElement): void {
  if (fieldButtons.has(field)) return;
  const button = document.createElement('button');
  button.className = 'field-button'; button.type = 'button'; setFieldGlyph(button, 'S');
  button.setAttribute('aria-label', 'Check this completed password with Soterios');
  button.addEventListener('click', () => void checkField(field), { signal: controller.signal });
  field.addEventListener('blur', () => void checkField(field), { signal: controller.signal });
  fieldButtons.set(field, button); shadow.appendChild(button); buttonPosition(field, button);
  if (field.form) void checkForm(field.form);
}

async function checkForm(form: HTMLFormElement): Promise<void> {
  const action = form.action || location.href;
  if (checkedForms.get(form) === action) return;
  checkedForms.set(form, action);
  try {
    const result = await send<{ reasons: string[] }>('CHECK_FORM_DESTINATION', { action });
    if (result.reasons.length) showNotice('Review this password form', result.reasons.map(reasonText).join(' '), 'warning', 'This is a non-blocking local heuristic advisory.');
  } catch (_) {}
}

function scanRoot(root: Document | ShadowRoot): void {
  root.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(addField);
  root.querySelectorAll<HTMLElement>('*').forEach((element) => { if (element.shadowRoot) observeRoot(element.shadowRoot); });
}

function observeRoot(root: Document | ShadowRoot): void {
  if (observedRoots.has(root)) return;
  observedRoots.add(root);
  scanRoot(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof HTMLInputElement && record.target.type === 'password') addField(record.target);
      if (record.type === 'attributes' && record.target instanceof HTMLFormElement) void checkForm(record.target);
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches('input[type="password"]')) addField(node as HTMLInputElement);
        node.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(addField);
        if ((node as HTMLElement).shadowRoot) observeRoot((node as HTMLElement).shadowRoot!);
        node.querySelectorAll<HTMLElement>('*').forEach((element) => { if (element.shadowRoot) observeRoot(element.shadowRoot); });
      });
    }
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'action'] }); observers.push(observer);
}

function repositionAll(): void {
  for (const [field, button] of fieldButtons) {
    if (!field.isConnected) { button.remove(); fieldButtons.delete(field); continue; }
    buttonPosition(field, button);
  }
}

async function checkCurrentSite(): Promise<void> {
  try {
    const state = await send<{ enabled: boolean; paused: boolean; bypassed: boolean }>('GET_CONTENT_STATE');
    enabled = state.enabled && !state.paused;
    if (!enabled) { dismissNotices(); repositionAll(); return; }
    const result = await send<{ verdict: { verdict: string; source: string; reasons: string[] }; paused: boolean }>('CHECK_SITE');
    if (result.paused) return;
    if (result.verdict.verdict === 'danger' && result.verdict.source === 'feed' && !state.bypassed) {
      showInterstitial(result.verdict.reasons);
    } else if (result.verdict.verdict === 'warning' || (result.verdict.verdict === 'danger' && result.verdict.source !== 'feed')) {
      showSiteNotice(location.href, result.verdict.verdict, result.verdict.reasons);
    } else if (result.verdict.verdict === 'unknown' && result.verdict.reasons.includes('FEED_STALE')) {
      showNotice('Protection is degraded', reasonText('FEED_STALE'), 'warning');
    }
  } catch (_) {}
}

observeRoot(document);
addEventListener('scroll', repositionAll, { passive: true, signal: controller.signal });
addEventListener('resize', repositionAll, { passive: true, signal: controller.signal });
addEventListener('pageshow', (event: PageTransitionEvent) => { if (event.persisted) void checkCurrentSite(); }, { signal: controller.signal });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void checkCurrentSite(); }, { signal: controller.signal });
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'SETTINGS_CHANGED') void checkCurrentSite();
  if (message?.type === 'THEME_CHANGED') return;
});
const navigationTimer = setInterval(() => {
  if (location.href !== lastUrl) { lastUrl = location.href; lastSiteNoticeKey = ''; dismissNotices(); void checkCurrentSite(); }
  repositionAll();
}, 1000);
void checkCurrentSite();

window.__soteriosProtectionV2 = {
  teardown() {
    enabled = false; controller.abort(); clearInterval(navigationTimer);
    observers.forEach((observer) => observer.disconnect()); fieldButtons.clear(); host.remove();
    delete window.__soteriosProtectionV2;
  }
};
