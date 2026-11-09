export type QboStatus = {
  provider: 'quickbooks_online';
  status: 'not_configured';
  message: string;
};

export function getQuickBooksStatus(): QboStatus {
  return {
    provider: 'quickbooks_online',
    status: 'not_configured',
    message:
      'QuickBooks Online credentials are not configured. Internal invoices and payments work without live sync.',
  };
}

/** Never claims a successful sync when credentials are missing. */
export async function syncInvoiceToQuickBooks(_invoiceId: string): Promise<{
  status: 'not_configured';
  message: string;
}> {
  const s = getQuickBooksStatus();
  return { status: s.status, message: s.message };
}
