import { useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useCreatePipelineStage,
  usePipelineStages,
  useUpdatePipelineStage,
} from '@/modules/leads/api';
import { ApiError } from '@/types/api';

export function PipelineStagesPage(): React.ReactElement {
  const stages = usePipelineStages();
  const createStage = useCreatePipelineStage();
  const updateStage = useUpdatePipelineStage();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<'open' | 'won' | 'lost'>('open');

  if (stages.isLoading) return <LoadingState />;
  if (stages.isError) {
    return (
      <ErrorState
        message={
          stages.error instanceof ApiError ? stages.error.message : 'Failed to load stages.'
        }
        onRetry={() => void stages.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lead pipeline stages"
        description="Create or deactivate stages without a deployment. Rename/reorder via API; UI rename/reorder deferred."
      />
      <form
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void createStage.mutateAsync({ name, category }).then(() => setName(''));
        }}
      >
        <div className="space-y-2">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label>Category</Label>
          <select
            className="flex h-10 rounded-md border border-border bg-card px-3 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value as 'open' | 'won' | 'lost')}
          >
            <option value="open">open</option>
            <option value="won">won</option>
            <option value="lost">lost</option>
          </select>
        </div>
        <Button type="submit">Add stage</Button>
      </form>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {(stages.data?.data ?? []).map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <div>
              <p className="font-medium">
                {s.order}. {s.name}{' '}
                <span className="text-muted-foreground">({s.category})</span>
              </p>
              {!s.isActive ? <p className="text-xs text-muted-foreground">Inactive</p> : null}
            </div>
            {s.isActive ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void updateStage.mutateAsync({ id: s.id, isActive: false })}
              >
                Deactivate
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
