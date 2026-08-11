'use strict';

const PROVIDERS = {
  // Built-in provider server lists were removed: provider hostnames change
  // often and stale entries produce dead connections. Users paste the IKEv2
  // server hostname shown in their provider's setup guide / account page instead.
  protonvpn: {
    name: 'ProtonVPN',
    protocol: 'IKEv2',
    usernameFormat: '{username}',
    servers: [],
  },

  nordvpn: {
    name: 'NordVPN',
    protocol: 'IKEv2',
    usernameFormat: '{username}',
    servers: [],
  },
  ivpn: {
    name: 'IVPN',
    protocol: 'IKEv2',
    usernameFormat: '{username}',
    servers: [],
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

function getEapConfigXml() {
  return `
<EapHostConfig xmlns="http://www.microsoft.com/provisioning/EapHostConfig">
    <EapMethod>
        <Type xmlns="http://www.microsoft.com/provisioning/EapCommon">26</Type>
        <VendorId xmlns="http://www.microsoft.com/provisioning/EapCommon">0</VendorId>
        <VendorType xmlns="http://www.microsoft.com/provisioning/EapCommon">0</VendorType>
        <AuthorId xmlns="http://www.microsoft.com/provisioning/EapCommon">0</AuthorId>
    </EapMethod>
    <Config xmlns="http://www.microsoft.com/provisioning/EapHostConfig">
        <Eap xmlns="http://www.microsoft.com/provisioning/BaseEapConnectionPropertiesV1">
            <Type>26</Type>
            <EapType xmlns="http://www.microsoft.com/provisioning/MsChapV2ConnectionPropertiesV1">
                <UseWinLogonCredentials>false</UseWinLogonCredentials>
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