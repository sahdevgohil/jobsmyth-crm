import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCents } from '@/lib/money';
import {
  openProposalPreview,
  useAcceptProposal,
  useProposal,
  useRejectProposal,
  useSendProposal,
  useSignatureRequest,
} from '@/modules/proposals/api';
import { useAuthStore } from '@/stores/auth-store';
import { ApiError } from '@/types/api';

export function ProposalDetailPage(): React.ReactElement {
  const { id = '' } = useParams();
  const token = useAuthStore((s) => s.accessToken);
  const proposal = useProposal(id);
  const send = useSendProposal(id);
  const accept = useAcceptProposal(id);
  const reject = useRejectProposal(id);
  const signature = useSignatureRequest(id);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (proposal.isLoading) return <LoadingState />;
  if (proposal.isError || !proposal.data) {
    return (
      <ErrorState
        message={proposal.error instanceof ApiError ? proposal.error.message : 'Not found.'}
        onRetry={() => void proposal.refetch()}
      />
    );
  }
  const p = proposal.data.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={p.number}
        description={`Status ${p.status} · version ${p.version}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/app/proposals">Back</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={`/app/estimates/${p.estimateId}`}>Source estimate</Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void openProposalPreview(id, token).catch((err) =>
                  setError(err instanceof Error ? err.message : 'Preview failed'),
                )
              }
            >
              Printable preview
            </Button>
          </div>
        }
      />

      <div className="rounded-xl border border-border bg-card p-4 text-sm space-y-2">
        <p>Total: {formatCents(p.totalCents)} (snapshot from estimate)</p>
        <p>
          Signature: {p.signature.status}
          {p.signature.errorMessage ? ` — ${p.signature.errorMessage}` : ''}
        </p>
        <p>
          Last email delivery: {p.lastEmailDelivery.status || 'none'}
          {p.lastEmailDelivery.message ? ` — ${p.lastEmailDelivery.message}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          Email/SMS and e-sign providers are not live until credentials are configured. Internal
          accept/reject still works.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(p.status === 'draft' || p.status === 'sent') && (
          <Button
            type="button"
            disabled={send.isPending}
            onClick={() =>
              void send
                .mutateAsync()
                .then((res) =>
                  setMsg(
                    `Marked sent. Email delivery: ${res.meta.emailDelivery} (not claimed as delivered).`,
                  ),
                )
                .catch((err) => setError(err instanceof ApiError ? err.message : 'Send failed'))
            }
          >
            Send proposal
          </Button>
        )}
        {['draft', 'sent', 'viewed'].includes(p.status) ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={accept.isPending}
              onClick={() =>
                void accept
                  .mutateAsync()
                  .then(() => setMsg('Proposal accepted (internal).'))
                  .catch((err) => setError(err instanceof ApiError ? err.message : 'Accept failed'))
              }
            >
              Accept
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={reject.isPending}
              onClick={() =>
                void reject
                  .mutateAsync()
                  .then(() => setMsg('Proposal rejected.'))
                  .catch((err) => setError(err instanceof ApiError ? err.message : 'Reject failed'))
              }
            >
              Reject
            </Button>
          </>
        ) : null}
      </div>

      <form
        className="space-y-3 rounded-xl border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          void signature
            .mutateAsync({ recipientEmail: email })
            .then((res) =>
              setMsg(
                `Signature request recorded as ${res.data.signature.status}. No legally binding signature was created.`,
              ),
            )
            .catch((err) =>
              setError(err instanceof ApiError ? err.message : 'Signature request failed'),
            );
        }}
      >
        <h2 className="font-medium">Electronic signature request</h2>
        <div className="space-y-2">
          <Label htmlFor="sigEmail">Recipient email</Label>
          <Input
            id="sigEmail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <Button type="submit" variant="outline" disabled={signature.isPending}>
          Request e-sign (provider boundary)
        </Button>
      </form>

      {p.status === 'accepted' ? (
        <Button asChild>
          <Link
            to={`/app/projects/new?proposalId=${p.id}&customerId=${p.customerId}&propertyId=${p.propertyId}`}
          >
            Create project from proposal
          </Link>
        </Button>
      ) : null}

      {msg ? <p className="text-sm text-brand">{msg}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
