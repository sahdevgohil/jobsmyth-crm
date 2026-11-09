import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { dollarsToCents, formatCents } from '@/lib/money';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { openInvoicePreview, useInvoice, useInvoicePayments, useRecordPayment, useSendInvoice } from '@/modules/invoices/api';
import { useAuthStore } from '@/stores/auth-store';
import { ApiError } from '@/types/api';

export function InvoiceDetailPage(): React.ReactElement {
  const { id = '' } = useParams();
  const invoice = useInvoice(id);
  const send = useSendInvoice(id);
  const pay = useRecordPayment(id);
  const payments = useInvoicePayments(id);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('check');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (invoice.isLoading) return <LoadingState />;
  if (invoice.isError || !invoice.data) {
    return (
      <ErrorState
        message={invoice.error instanceof ApiError ? invoice.error.message : 'Not found.'}
        onRetry={() => void invoice.refetch()}
      />
    );
  }
  const inv = invoice.data.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={inv.number}
        description={`Invoice date ${inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('en-US') : '—'} · Due ${inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-US') : '—'}`}
        actions={
          <>
            <StatusBadge status={inv.status} />
            <Button variant="outline" onClick={() => void openInvoicePreview(inv.id, useAuthStore.getState().accessToken)}>
              Print / PDF
            </Button>
            <Button asChild variant="outline">
              <Link to="/app/invoices">Back</Link>
            </Button>
          </>
        }
      />
      {inv.lineItems && inv.lineItems.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-2">Description</th><th className="px-4 py-2 text-right">Qty</th><th className="px-4 py-2 text-right">Unit</th><th className="px-4 py-2 text-right">Amount</th></tr>
            </thead>
            <tbody className="divide-y divide-border tabular-nums">
              {inv.lineItems.map((l, i) => (
                <tr key={i}><td className="px-4 py-2">{l.description}</td><td className="px-4 py-2 text-right">{l.quantity} {l.unit}</td><td className="px-4 py-2 text-right">{formatCents(l.unitCostCents)}</td><td className="px-4 py-2 text-right">{formatCents(l.amountCents)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="ml-auto w-full max-w-xs space-y-1 rounded-lg border border-border bg-card p-4 text-sm shadow-sm tabular-nums">
        <p className="flex justify-between"><span className="text-muted-foreground">Subtotal</span>{formatCents(inv.subtotalCents)}</p>
        <p className="flex justify-between"><span className="text-muted-foreground">Discount</span>{formatCents(inv.discountCents)}</p>
        <p className="flex justify-between"><span className="text-muted-foreground">Tax</span>{formatCents(inv.taxCents)}</p>
        <p className="flex justify-between font-semibold"><span>Total</span>{formatCents(inv.totalCents)}</p>
        <p className="flex justify-between"><span className="text-muted-foreground">Paid</span>{formatCents(inv.amountPaidCents)}</p>
        <p className="flex justify-between border-t border-border pt-1 font-semibold"><span>Balance due</span>{formatCents(inv.balanceCents)}</p>
      </div>
      {(payments.data?.data ?? []).length > 0 ? (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">Payment history</h2>
          <ul className="divide-y divide-border text-sm tabular-nums">
            {(payments.data?.data ?? []).map((p) => (
              <li key={p.id} className="flex justify-between py-1.5">
                <span>{new Date(p.paymentDate).toLocaleDateString('en-US')} · {p.method.replace(/_/g, ' ')}</span>
                <span>{formatCents(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {inv.status === 'draft' ? (
        <Button
          type="button"
          disabled={send.isPending}
          onClick={() =>
            void send
              .mutateAsync()
              .then((res) =>
                setMsg(
                  `Sent. Email: ${res.meta.emailDelivery}; QBO: ${res.meta.qbo} (not claimed live).`,
                ),
              )
              .catch((err) => setError(err instanceof ApiError ? err.message : 'Send failed'))
          }
        >
          Send invoice
        </Button>
      ) : null}

      {inv.status !== 'draft' && inv.status !== 'void' && inv.balanceCents > 0 ? (
        <form
          className="space-y-3 rounded-xl border border-border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            void pay
              .mutateAsync({
                amountCents: dollarsToCents(amount),
                method,
                source: 'manual',
              })
              .then(() => {
                setMsg('Manual payment recorded.');
                setAmount('');
              })
              .catch((err) =>
                setError(err instanceof ApiError ? err.message : 'Payment failed'),
              );
          }}
        >
          <h2 className="font-medium">Record payment (manual)</h2>
          <p className="text-xs text-muted-foreground">
            Manual records are not provider-verified transactions.
          </p>
          <div className="space-y-2">
            <Label htmlFor="pay-amount">Amount (USD)</Label>
            <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pay-method">Method</Label>
            <Input id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)} required />
          </div>
          <Button type="submit" disabled={pay.isPending}>
            Record payment
          </Button>
        </form>
      ) : null}

      {msg ? <p className="text-sm text-brand">{msg}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
