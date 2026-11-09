export type SignatureProviderId = 'dropbox_sign' | 'docusign';

export type SignatureProviderStatus = {
  id: SignatureProviderId;
  status: 'not_configured';
  message: string;
};

export function getSignatureProvidersStatus(): SignatureProviderStatus[] {
  return [
    {
      id: 'dropbox_sign',
      status: 'not_configured',
      message: 'Dropbox Sign credentials are not configured.',
    },
    {
      id: 'docusign',
      status: 'not_configured',
      message: 'DocuSign credentials are not configured.',
    },
  ];
}

/** Live e-sign send is blocked until a provider is configured. */
export async function createSignatureRequest(_input: {
  proposalId: string;
  recipientEmail: string;
  recipientName?: string;
}): Promise<{
  status: 'not_configured';
  provider: 'none';
  message: string;
}> {
  return {
    status: 'not_configured',
    provider: 'none',
    message:
      'Electronic signature providers are not configured. Internal proposal acceptance remains available.',
  };
}
