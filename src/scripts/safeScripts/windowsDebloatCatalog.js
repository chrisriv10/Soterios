'use strict';

// Soterios-owned Windows AppX debloat catalog.
//
// A deliberately small, explicit policy list: package family names Soterios
// has reviewed as safe to offer for current-user removal, plus explicit
// protected entries. Classification never relies on substring guessing; an
// installed package is removable only when it exactly matches a catalog
// entry AND passes live metadata checks (framework/resource/NonRemovable).
// Anything ambiguous is treated as protected.
//
// Reference material only (no code or lists copied at runtime):
// - Chris Titus Tech WinUtil (MIT)
// - Raphire Win11Debloat (MIT)
// - Microsoft AppX packaging documentation

const RECOMMENDATIONS = ['recommended', 'optional', 'protected'];

const ENTRIES = [
  {
    id: 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe',
    name: 'Microsoft Solitaire Collection',
    description: 'Preinstalled Solitaire game bundle.',
    category: 'games',
    recommendation: 'recommended',
    rationale: 'Optional Microsoft consumer game; remove only if unused.'
  },
  {
    id: 'Microsoft.WindowsFeedbackHub_8wekyb3d8bbwe',
    name: 'Feedback Hub',
    description: 'Sends feedback and diagnostics to Microsoft.',
    category: 'system-utilities',
    recommendation: 'recommended',
    rationale: 'Optional feedback channel; remove only if unused.'
  },
  {
    id: 'Microsoft.Getstarted_8wekyb3d8bbwe',
    name: 'Tips',
    description: 'Windows tips and guided tours.',
    category: 'system-utilities',
    recommendation: 'recommended',
    rationale: 'Included tips content; remove only if unused.'
  },
  {
    id: 'Microsoft.People_8wekyb3d8bbwe',
    name: 'People',
    description: 'Contacts aggregation app.',
    category: 'communication',
    recommendation: 'recommended',
    rationale: 'Contacts app with no system role; remove only if unused.'
  },
  {
    id: 'Microsoft.BingNews_8wekyb3d8bbwe',
    name: 'News',
    description: 'MSN news reader.',
    category: 'news',
    recommendation: 'recommended',
    rationale: 'Optional MSN news client; remove only if unused.'
  },
  {
    id: 'Microsoft.BingWeather_8wekyb3d8bbwe',
    name: 'Weather',
    description: 'MSN weather app.',
    category: 'news',
    recommendation: 'recommended',
    rationale: 'Optional MSN weather client; remove only if unused.'
  },
  {
    id: 'Microsoft.MicrosoftOfficeHub_8wekyb3d8bbwe',
    name: 'Office Hub',
    description: 'Microsoft 365 companion hub.',
    category: 'productivity',
    recommendation: 'recommended',
    rationale: 'Optional Microsoft 365 companion; remove only if unused.'
  },
  {
    id: 'Microsoft.SkypeApp_8wekyb3d8bbwe',
    name: 'Skype (legacy)',
    description: 'Legacy Skype consumer client.',
    category: 'communication',
    recommendation: 'recommended',
    rationale: 'Legacy calling client; remove only if unused.'
  },
  {
    id: 'Microsoft.ZuneMusic_8wekyb3d8bbwe',
    name: 'Windows Media Player',
    description: 'Windows Media Player music playback.',
    category: 'media',
    recommendation: 'optional',
    rationale: 'Hosts Windows Media Player music playback on modern Windows; remove only if you do not use Windows Media Player.'
  },
  {
    id: 'Microsoft.ZuneVideo_8wekyb3d8bbwe',
    name: 'Movies & TV',
    description: 'Movies & TV video playback.',
    category: 'media',
    recommendation: 'optional',
    rationale: 'Ships the Movies & TV experience; remove only if you do not use it.'
  },
  {
    id: 'Microsoft.YourPhone_8wekyb3d8bbwe',
    name: 'Phone Link',
    description: 'Links an Android/iPhone device to this PC.',
    category: 'communication',
    recommendation: 'optional',
    rationale: 'Legitimate functionality some users rely on; remove only if unused.'
  },
  {
    id: 'MSTeams_8wekyb3d8bbwe',
    name: 'Microsoft Teams',
    description: 'Teams client.',
    category: 'communication',
    recommendation: 'optional',
    rationale: 'Current Teams client; remove only if you do not use Teams.'
  },
  {
    id: 'Microsoft.Todos_8wekyb3d8bbwe',
    name: 'Microsoft To Do',
    description: 'Task-list application.',
    category: 'productivity',
    recommendation: 'optional',
    rationale: 'Useful task manager for many users; remove only if unused.'
  },
  {
    id: 'Microsoft.Whiteboard_8wekyb3d8bbwe',
    name: 'Microsoft Whiteboard',
    description: 'Collaborative whiteboard.',
    category: 'productivity',
    recommendation: 'optional',
    rationale: 'Collaboration tool some users rely on; remove only if unused.'
  },
  {
    id: 'Microsoft.WindowsStore_8wekyb3d8bbwe',
    name: 'Microsoft Store',
    description: 'Application store and AppX servicing frontend.',
    category: 'system',
    recommendation: 'protected',
    rationale: 'Removing the Store breaks app installation, updates, and AppX servicing.'
  },
  {
    id: 'Microsoft.SecHealthUI_8wekyb3d8bbwe',
    name: 'Windows Security',
    description: 'Windows Security dashboard UI.',
    category: 'system',
    recommendation: 'protected',
    rationale: 'Security UI must never be offered for removal.'
  }
];

// Family-name fragments that are always protected regardless of catalog
// presence: runtimes, frameworks, shell, and identity components. Matched
// case-insensitively against the package family name. Kept narrow on purpose;
// anything not listed here and not in the catalog is simply uncataloged
// (never offered), not implicitly removable.
const PROTECTED_FAMILY_PATTERNS = [
  'VCLibs',
  'UI.Xaml',
  'NET.Native',
  'WindowsAppSDK',
  'WindowsAppRuntime',
  'ShellExperienceHost',
  'StartMenuExperienceHost',
  'AAD.BrokerPlugin',
  'AccountsControl',
  'AsyncTextService',
  'BioEnrollment',
  'CredDialogHost',
  'ECApp',
  'LockApp',
  'CloudExperienceHost',
  'Win32WebViewHost',
  'Apprep.ChxApp',
  'ContentDeliveryManager'
];

function validateCatalog(entries = ENTRIES) {
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) {
      throw new Error('Debloat catalog entry is missing a package family id.');
    }
    if (seen.has(entry.id)) {
      throw new Error(`Debloat catalog has a duplicate id: ${entry.id}`);
    }
    seen.add(entry.id);
    if (!RECOMMENDATIONS.includes(entry.recommendation)) {
      throw new Error(`Debloat catalog entry ${entry.id} has an invalid recommendation.`);
    }
    for (const field of ['name', 'description', 'category', 'rationale']) {
      if (typeof entry[field] !== 'string' || !entry[field]) {
        throw new Error(`Debloat catalog entry ${entry.id} is missing ${field}.`);
      }
    }
  }
  return true;
}

function getCatalog() {
  return ENTRIES.map((entry) => ({ ...entry }));
}

function findEntry(familyName) {
  if (!familyName || typeof familyName !== 'string') return null;
  const wanted = familyName.trim().toLowerCase();
  return ENTRIES.find((entry) => entry.id.toLowerCase() === wanted) || null;
}

function isProtectedFamily(familyName) {
  if (!familyName || typeof familyName !== 'string') return true;
  const wanted = familyName.toLowerCase();
  return PROTECTED_FAMILY_PATTERNS.some((pattern) => wanted.includes(pattern.toLowerCase()));
}

module.exports = {
  RECOMMENDATIONS,
  PROTECTED_FAMILY_PATTERNS,
  validateCatalog,
  getCatalog,
  findEntry,
  isProtectedFamily
};
