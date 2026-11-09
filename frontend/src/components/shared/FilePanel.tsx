import { Download, Eye, FileText, Image as ImageIcon, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { downloadFile, fileToBase64, useFiles, useUploadFile, type FileRecord } from '@/modules/files/api';
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, validateUpload } from '@/lib/uploads';
import { useAuthStore } from '@/stores/auth-store';
import { ApiError } from '@/types/api';

function size(bytes: number): string {
  return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

async function openPreview(file: FileRecord): Promise<void> {
  const API_URL = import.meta.env.VITE_API_URL as string;
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${API_URL}/files/${file.id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Preview failed');
  const url = URL.createObjectURL(new Blob([await res.blob()], { type: file.mimeType }));
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Upload + list + preview + download for files linked to one record. Files are fetched through the
 * authenticated API only; storage paths are never exposed.
 */
export function FilePanel({
  link,
  category = 'document',
  canUpload,
  allowCustomerVisibility = false,
}: {
  link: Partial<Record<'customerId' | 'propertyId' | 'inspectionId' | 'projectId', string>>;
  category?: 'photo' | 'document';
  canUpload: boolean;
  allowCustomerVisibility?: boolean;
}): React.ReactElement {
  const params: Record<string, string> = { pageSize: '50' };
  Object.entries(link).forEach(([k, v]) => {
    if (v) params[k] = v;
  });
  const files = useFiles(params);
  const upload = useUploadFile();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<'internal' | 'customer'>('internal');

  async function onPick(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = validateUpload(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      await upload.mutateAsync({
        filename: file.name,
        mimeType: file.type,
        category: file.type.startsWith('image/') ? 'photo' : category,
        contentBase64: await fileToBase64(file),
        caption: caption || undefined,
        visibility,
        ...link,
      });
      setCaption('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.');
    }
  }

  const rows = files.data?.data ?? [];
  return (
    <div className="space-y-4">
      {canUpload ? (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="min-w-48 flex-1">
            <label htmlFor="file-caption" className="mb-1 block text-xs font-medium text-muted-foreground">Caption (optional)</label>
            <input id="file-caption" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={500} className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" />
          </div>
          {allowCustomerVisibility ? (
            <div>
              <label htmlFor="file-visibility" className="mb-1 block text-xs font-medium text-muted-foreground">Visible to</label>
              <select id="file-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as 'internal' | 'customer')} className="h-10 rounded-md border border-border bg-card px-3 text-sm">
                <option value="internal">Staff only</option>
                <option value="customer">Customer (portal)</option>
              </select>
            </div>
          ) : null}
          <input ref={input} type="file" accept={ALLOWED_UPLOAD_TYPES.join(',')} className="sr-only" aria-label="Choose file" onChange={(e) => void onPick(e)} />
          <Button type="button" disabled={upload.isPending} onClick={() => input.current?.click()}>
            <Upload className="h-4 w-4" aria-hidden /> {upload.isPending ? 'Uploading…' : 'Upload file'}
          </Button>
          <p className="w-full text-xs text-muted-foreground">JPG, PNG, WebP, PDF or TXT · up to {MAX_UPLOAD_BYTES / 1_000_000} MB.</p>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {files.isLoading ? <LoadingState /> : null}
      {files.isError ? <ErrorState message="Could not load files." onRetry={() => void files.refetch()} /> : null}
      {files.data && rows.length === 0 ? <EmptyState title="No files yet" description="Uploaded photos and documents appear here." /> : null}
      {rows.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card shadow-sm">
          {rows.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-3">
              {f.mimeType.startsWith('image/') ? <ImageIcon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden /> : <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.originalFilename}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {f.caption ? `${f.caption} · ` : ''}{size(f.sizeBytes)} · {new Date(f.createdAt).toLocaleDateString('en-US')}
                </p>
              </div>
              <StatusBadge status={f.visibility === 'customer' ? 'customer visible' : 'internal'} tone={f.visibility === 'customer' ? 'info' : 'neutral'} />
              <Button type="button" variant="outline" size="sm" aria-label={`Preview ${f.originalFilename}`} onClick={() => void openPreview(f).catch(() => setError('Preview failed.'))}>
                <Eye className="h-4 w-4" aria-hidden />
              </Button>
              <Button type="button" variant="outline" size="sm" aria-label={`Download ${f.originalFilename}`} onClick={() => void downloadFile(f.id).catch(() => setError('Download failed.'))}>
                <Download className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
