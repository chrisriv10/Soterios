import { isIpLiteral, registrableDomain } from './domains';

const BRANDS = [
  { name: 'paypal', domains: ['paypal.com'] },
  { name: 'microsoft', domains: ['microsoft.com', 'live.com', 'office.com'] },
  { name: 'google', domains: ['google.com', 'gmail.com'] },
  { name: 'apple', domains: ['apple.com', 'icloud.com'] },
  { name: 'amazon', domains: ['amazon.com'] },
  { name: 'github', domains: ['github.com'] }
];

export interface HeuristicFinding { code: string; message: string; }

export function inspectUrl(urlValue: string): HeuristicFinding[] {
  let url: URL;
  try { url = new URL(urlValue); } catch (_) { return []; }
  const findings: HeuristicFinding[] = [];
  const hostname = url.hostname.toLowerCase();
  const domain = registrableDomain(hostname);
  if (isIpLiteral(hostname)) findings.push({ code: 'IP_LITERAL_HOST', message: 'This address uses a numeric IP instead of a domain name.' });
  if (url.username || url.password) findings.push({ code: 'DECEPTIVE_USERINFO', message: 'The address contains user information that can disguise the real destination.' });
  if (hostname.startsWith('xn--') || hostname.includes('.xn--')) findings.push({ code: 'PUNYCODE_HOST', message: 'This domain uses an internationalized spelling that may resemble another name.' });
  for (const brand of BRANDS) {
    if (!hostname.includes(brand.name)) continue;
    if (!brand.domains.some((allowed) => domain === allowed || hostname.endsWith(`.${allowed}`))) {
      findings.push({ code: 'BRAND_IMPERSONATION', message: `The domain contains “${brand.name}” but is not an official ${brand.name} domain.` });
      break;
    }
  }
  if (url.protocol === 'http:' && /login|signin|account|verify|secure/i.test(url.pathname)) {
    findings.push({ code: 'INSECURE_CREDENTIAL_PATH', message: 'A sign-in-like page is being served without HTTPS.' });
  }
  return findings;
}

export function inspectCredentialDestination(pageUrl: string, actionUrl: string): HeuristicFinding[] {
  try {
    const page = new URL(pageUrl);
    const action = new URL(actionUrl, page);
    if (!/^https?:$/.test(action.protocol)) return [{ code: 'UNUSUAL_FORM_SCHEME', message: 'The sign-in form submits through an unusual URL scheme.' }];
    const pageDomain = registrableDomain(page.hostname);
    const actionDomain = registrableDomain(action.hostname);
    if (pageDomain && actionDomain && pageDomain !== actionDomain) {
      return [{ code: 'CROSS_SITE_CREDENTIAL_FORM', message: `This password form submits to a different site (${actionDomain}).` }];
    }
    if (page.protocol === 'https:' && action.protocol === 'http:') {
      return [{ code: 'INSECURE_FORM_DESTINATION', message: 'This password form sends data from HTTPS to an unencrypted destination.' }];
    }
  } catch (_) {}
  return [];
}
