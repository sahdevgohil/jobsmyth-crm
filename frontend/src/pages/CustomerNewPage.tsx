import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateCustomer } from '@/modules/customers/api';
import { ApiError } from '@/types/api';

export function CustomerNewPage(): React.ReactElement {
  const navigate = useNavigate();
  const createCustomer = useCreateCustomer();
  const [type, setType] = useState<'individual' | 'business'>('individual');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader title="New customer" />
      <form
        className="space-y-4 rounded-xl border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          void createCustomer
            .mutateAsync({
              type,
              firstName: firstName || undefined,
              lastName: lastName || undefined,
              companyName: companyName || undefined,
              phone: phone || undefined,
              email: email || undefined,
            })
            .then((res) => navigate(`/app/customers/${res.data.id}`))
            .catch((err: unknown) => {
              setError(err instanceof ApiError ? err.message : 'Create failed.');
            });
        }}
      >
        <div className="space-y-2">
          <Label>Type</Label>
          <select
            className="flex h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as 'individual' | 'business')}
          >
            <option value="individual">Individual</option>
            <option value="business">Business</option>
          </select>
        </div>
        {type === 'business' ? (
          <div className="space-y-2">
            <Label>Company</Label>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>First name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Last name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit">Save</Button>
      </form>
    </div>
  );
}
