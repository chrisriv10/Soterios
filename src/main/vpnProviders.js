'use strict';

const PROVIDERS = {
  protonvpn: {
    name: 'ProtonVPN',
    protocol: 'IKEv2',
    usernameFormat: '{username}',
    servers: [
      { id: 'us-free-1', name: 'USA - Free #1', host: 'us-free-1.protonvpn.net' },
      { id: 'us-free-2', name: 'USA - Free #2', host: 'us-free-2.protonvpn.net' },
      { id: 'nl-free-1', name: 'Netherlands - Free #1', host: 'nl-free-1.protonvpn.net' },
      { id: 'nl-free-2', name: 'Netherlands - Free #2', host: 'nl-free-2.protonvpn.net' },
      { id: 'jp-free-1', name: 'Japan - Free #1', host: 'jp-free-1.protonvpn.net' },
      { id: 'jp-free-2', name: 'Japan - Free #2', host: 'jp-free-2.protonvpn.net' },
      { id: 'us-plus-1', name: 'USA - Plus #1', host: 'us-plus-1.protonvpn.net' },
      { id: 'us-plus-2', name: 'USA - Plus #2', host: 'us-plus-2.protonvpn.net' },
      { id: 'nl-plus-1', name: 'Netherlands - Plus #1', host: 'nl-plus-1.protonvpn.net' },
      { id: 'nl-plus-2', name: 'Netherlands - Plus #2', host: 'nl-plus-2.protonvpn.net' },
      { id: 'ch-plus-1', name: 'Switzerland - Plus #1', host: 'ch-plus-1.protonvpn.net' },
      { id: 'ch-plus-2', name: 'Switzerland - Plus #2', host: 'ch-plus-2.protonvpn.net' },
      { id: 'de-plus-1', name: 'Germany - Plus #1', host: 'de-plus-1.protonvpn.net' },
      { id: 'de-plus-2', name: 'Germany - Plus #2', host: 'de-plus-2.protonvpn.net' },
      { id: 'uk-plus-1', name: 'United Kingdom - Plus #1', host: 'uk-plus-1.protonvpn.net' },
      { id: 'ca-plus-1', name: 'Canada - Plus #1', host: 'ca-plus-1.protonvpn.net' },
      { id: 'au-plus-1', name: 'Australia - Plus #1', host: 'au-plus-1.protonvpn.net' },
      { id: 'jp-plus-1', name: 'Japan - Plus #1', host: 'jp-plus-1.protonvpn.net' },
      { id: 'sg-plus-1', name: 'Singapore - Plus #1', host: 'sg-plus-1.protonvpn.net' },
      { id: 'hk-plus-1', name: 'Hong Kong - Plus #1', host: 'hk-plus-1.protonvpn.net' },
    ],
  },
  mullvad: {
    name: 'Mullvad',
    protocol: 'IKEv2',
    usernameFormat: '{account}',
    servers: [
      { id: 'se-got-1', name: 'Sweden - Gothenburg', host: 'se-got-wg-001.mullvad.net' },
      { id: 'se-sto-1', name: 'Sweden - Stockholm', host: 'se-sto-wg-001.mullvad.net' },
      { id: 'us-nyc-1', name: 'USA - New York', host: 'us-nyc-wg-001.mullvad.net' },
      { id: 'us-lax-1', name: 'USA - Los Angeles', host: 'us-lax-wg-001.mullvad.net' },
      { id: 'us-mia-1', name: 'USA - Miami', host: 'us-mia-wg-001.mullvad.net' },
      { id: 'us-ord-1', name: 'USA - Chicago', host: 'us-ord-wg-001.mullvad.net' },
      { id: 'us-sea-1', name: 'USA - Seattle', host: 'us-sea-wg-001.mullvad.net' },
      { id: 'us-den-1', name: 'USA - Denver', host: 'us-den-wg-001.mullvad.net' },
      { id: 'us-atl-1', name: 'USA - Atlanta', host: 'us-atl-wg-001.mullvad.net' },
      { id: 'us-dfw-1', name: 'USA - Dallas', host: 'us-dfw-wg-001.mullvad.net' },
      { id: 'ca-yul-1', name: 'Canada - Montreal', host: 'ca-yul-wg-001.mullvad.net' },
      { id: 'ca-yvr-1', name: 'Canada - Vancouver', host: 'ca-yvr-wg-001.mullvad.net' },
      { id: 'nl-ams-1', name: 'Netherlands - Amsterdam', host: 'nl-ams-wg-001.mullvad.net' },
      { id: 'de-fra-1', name: 'Germany - Frankfurt', host: 'de-fra-wg-001.mullvad.net' },
      { id: 'de-muc-1', name: 'Germany - Munich', host: 'de-muc-wg-001.mullvad.net' },
      { id: 'ch-zrh-1', name: 'Switzerland - Zurich', host: 'ch-zrh-wg-001.mullvad.net' },
      { id: 'uk-lon-1', name: 'United Kingdom - London', host: 'uk-lon-wg-001.mullvad.net' },
      { id: 'fr-par-1', name: 'France - Paris', host: 'fr-par-wg-001.mullvad.net' },
      { id: 'jp-nrt-1', name: 'Japan - Tokyo', host: 'jp-nrt-wg-001.mullvad.net' },
      { id: 'sg-sin-1', name: 'Singapore', host: 'sg-sin-wg-001.mullvad.net' },
      { id: 'hk-hkg-1', name: 'Hong Kong', host: 'hk-hkg-wg-001.mullvad.net' },
      { id: 'au-syd-1', name: 'Australia - Sydney', host: 'au-syd-wg-001.mullvad.net' },
      { id: 'br-gru-1', name: 'Brazil - Sao Paulo', host: 'br-gru-wg-001.mullvad.net' },
    ],
  },
  nordvpn: {
    name: 'NordVPN',
    protocol: 'IKEv2',
    usernameFormat: '{username}',
    servers: [
      { id: 'us-nyc-1', name: 'USA - New York', host: 'us1088.nordvpn.com' },
      { id: 'us-lax-1', name: 'USA - Los Angeles', host: 'us1234.nordvpn.com' },
      { id: 'us-chi-1', name: 'USA - Chicago', host: 'us1456.nordvpn.com' },
      { id: 'us-mia-1', name: 'USA - Miami', host: 'us1678.nordvpn.com' },
      { id: 'us-sea-1', name: 'USA - Seattle', host: 'us1890.nordvpn.com' },
      { id: 'ca-tor-1', name: 'Canada - Toronto', host: 'ca345.nordvpn.com' },
      { id: 'ca-mon-1', name: 'Canada - Montreal', host: 'ca567.nordvpn.com' },
      { id: 'uk-lon-1', name: 'United Kingdom - London', host: 'uk456.nordvpn.com' },
      { id: 'de-fra-1', name: 'Germany - Frankfurt', host: 'de678.nordvpn.com' },
      { id: 'de-ber-1', name: 'Germany - Berlin', host: 'de789.nordvpn.com' },
      { id: 'nl-ams-1', name: 'Netherlands - Amsterdam', host: 'nl234.nordvpn.com' },
      { id: 'fr-par-1', name: 'France - Paris', host: 'fr345.nordvpn.com' },
      { id: 'ch-zur-1', name: 'Switzerland - Zurich', host: 'ch456.nordvpn.com' },
      { id: 'se-sto-1', name: 'Sweden - Stockholm', host: 'se567.nordvpn.com' },
      { id: 'no-osl-1', name: 'Norway - Oslo', host: 'no678.nordvpn.com' },
      { id: 'dk-cph-1', name: 'Denmark - Copenhagen', host: 'dk789.nordvpn.com' },
      { id: 'fi-hel-1', name: 'Finland - Helsinki', host: 'fi890.nordvpn.com' },
      { id: 'jp-tyo-1', name: 'Japan - Tokyo', host: 'jp123.nordvpn.com' },
      { id: 'sg-sin-1', name: 'Singapore', host: 'sg234.nordvpn.com' },
      { id: 'hk-hkg-1', name: 'Hong Kong', host: 'hk345.nordvpn.com' },
      { id: 'au-syd-1', name: 'Australia - Sydney', host: 'au456.nordvpn.com' },
      { id: 'br-gru-1', name: 'Brazil - Sao Paulo', host: 'br567.nordvpn.com' },
      { id: 'za-jnb-1', name: 'South Africa - Johannesburg', host: 'za678.nordvpn.com' },
    ],
  },
  ivpn: {
    name: 'IVPN',
    protocol: 'IKEv2',
    usernameFormat: '{username}',
    servers: [
      { id: 'us-nyc-1', name: 'USA - New York', host: 'us-nyc.ivpn.net' },
      { id: 'us-mia-1', name: 'USA - Miami', host: 'us-mia.ivpn.net' },
      { id: 'us-lax-1', name: 'USA - Los Angeles', host: 'us-lax.ivpn.net' },
      { id: 'us-ord-1', name: 'USA - Chicago', host: 'us-ord.ivpn.net' },
      { id: 'ca-tor-1', name: 'Canada - Toronto', host: 'ca-tor.ivpn.net' },
      { id: 'uk-lon-1', name: 'United Kingdom - London', host: 'uk-lon.ivpn.net' },
      { id: 'nl-ams-1', name: 'Netherlands - Amsterdam', host: 'nl-ams.ivpn.net' },
      { id: 'de-fra-1', name: 'Germany - Frankfurt', host: 'de-fra.ivpn.net' },
      { id: 'ch-zur-1', name: 'Switzerland - Zurich', host: 'ch-zur.ivpn.net' },
      { id: 'se-sto-1', name: 'Sweden - Stockholm', host: 'se-sto.ivpn.net' },
      { id: 'jp-tyo-1', name: 'Japan - Tokyo', host: 'jp-tyo.ivpn.net' },
      { id: 'sg-sin-1', name: 'Singapore', host: 'sg-sin.ivpn.net' },
      { id: 'hk-hkg-1', name: 'Hong Kong', host: 'hk-hkg.ivpn.net' },
      { id: 'au-syd-1', name: 'Australia - Sydney', host: 'au-syd.ivpn.net' },
    ],
  },
  custom: {
    name: 'Custom IKEv2',
    protocol: 'IKEv2',
    usernameFormat: '{username}',
    servers: [],
  },
};

function getProvider(id) {
  return PROVIDERS[id] || null;
}

function getAllProviders() {
  return Object.entries(PROVIDERS).map(([id, data]) => ({ id, ...data }));
}

function getServerForProvider(providerId, serverId) {
  const provider = PROVIDERS[providerId];
  if (!provider) return null;
  return provider.servers.find((s) => s.id === serverId) || null;
}

function getEapConfigXml(username, password) {
  const escapedUser = String(username || '')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&apos;');
  const escapedPass = String(password || '')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&apos;');

  return `
<EapHostConfig xmlns="http://www.microsoft.com/provisioning/EapHostConfig">
  <EapMethod>
    <Type xmlns="http://www.microsoft.com/provisioning/EapCommon">25</Type>
    <VendorId xmlns="http://www.microsoft.com/provisioning/EapCommon">0</VendorId>
    <VendorType xmlns="http://www.microsoft.com/provisioning/EapCommon">0</VendorType>
    <AuthorId xmlns="http://www.microsoft.com/provisioning/EapCommon">0</AuthorId>
  </EapMethod>
  <Config xmlns="http://www.microsoft.com/provisioning/EapHostConfig">
    <Eap xmlns="http://www.microsoft.com/provisioning/BaseEapConnectionPropertiesV1">
      <Type>25</Type>
      <EapType xmlns="http://www.microsoft.com/provisioning/EapTlsConnectionPropertiesV1">
        <Username>${escapedUser}</Username>
        <Password>${escapedPass}</Password>
        <UserDomain />
        <ValidateServerCertificate>false</ValidateServerCertificate>
        <ServerNames />
        <TrustedRootCA />
        <UseDifferentUsername>false</UseDifferentUsername>
        <EnableFastReconnect>true</EnableFastReconnect>
        <EnableCryptoBinding>false</EnableCryptoBinding>
        <EnableIdentityPrivacy>false</EnableIdentityPrivacy>
      </EapType>
    </Eap>
  </Config>
</EapHostConfig>`.trim();
}

module.exports = {
  PROVIDERS,
  getProvider,
  getAllProviders,
  getServerForProvider,
  getEapConfigXml,
};