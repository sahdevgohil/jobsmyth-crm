import { Camera } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/lib/permissions';
import { ApiError } from '@/types/api';
import { PHOTO_CATEGORIES, PHOTO_LABEL, fetchBlobUrl, readAsBase64, usePhotos, useWorkspaceMutations, type Photo, type PhotoCategory } from './workspaceApi';

function Thumb({ photo }: { photo: Photo }): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let u: string | null = null;
    void fetchBlobUrl(photo.downloadPath).then((x) => { if (alive) { u = x; setUrl(x); } else URL.revokeObjectURL(x); }).catch(() => undefined);
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [photo.downloadPath]);
  return url ? <img src={url} alt={photo.notes || PHOTO_LABEL[photo.category]} className="h-28 w-full rounded-md border border-border object-cover" /> : <div className="h-28 w-full rounded-md bg-muted" aria-hidden />;
}

/** Field photographs taken or uploaded by staff. Google aerial imagery is shown elsewhere and never counted here. */
export function PhotoSection({ measurementId, editable }: { measurementId: string; editable: boolean }): React.ReactElement {
  const photos = usePhotos(measurementId);
  const mut = useWorkspaceMutations(measurementId);
  const canVerify = useHasPermission('measurements:verify');
  const [category, setCategory] = useState<PhotoCategory>('front_elevation');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    // Location is optional: a denied or slow request never blocks the upload.
    const gps = await new Promise<{ lat: number; lng: number } | undefined>((resolve) => {
      if (!('geolocation' in navigator)) return resolve(undefined);
      navigator.geolocation.getCurrentPosition((p) => resolve({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }), () => resolve(undefined), { timeout: 2500, maximumAge: 60_000 });
    });
    for (const f of files) {
      try {
        await mut.uploadPhoto.mutateAsync({ filename: f.name, mimeType: f.type || 'image/jpeg', contentBase64: await readAsBase64(f), category, notes: notes || undefined, capturedAt: new Date(f.lastModified || Date.now()).toISOString(), gps });
        setMsg({ ok: true, text: `${f.name} uploaded.` });
      } catch (err) {
        setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Upload failed.' });
      }
    }
    setNotes('');
  }

  const list = photos.data ?? [];
  return (
    <section aria-label="Field photos" className="space-y-3">
      <h2 className="text-base font-semibold">Field photographs</h2>
      <p className="text-xs text-muted-foreground">Photos taken on site by your team. The Google aerial image is aerial imagery, not an inspection photo, and is not listed here.</p>
      {editable ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
          <label className="text-sm">Category
            <select className="mt-1 block h-11 rounded-md border border-border bg-card px-2" value={category} onChange={(e) => setCategory(e.target.value as PhotoCategory)}>
              {PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{PHOTO_LABEL[c]}</option>)}
            </select>
          </label>
          <label className="text-sm">Notes (optional)
            <input aria-label="Photo notes" className="mt-1 block h-11 w-56 rounded-md border border-border bg-card px-3" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple className="sr-only" aria-label="Choose photos" onChange={(e) => void pick(e)} />
          <Button type="button" className="h-11" disabled={mut.uploadPhoto.isPending} onClick={() => input.current?.click()}><Camera className="h-5 w-5" aria-hidden /> Take or add photos</Button>
        </div>
      ) : null}
      {msg ? <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-sm text-success' : 'text-sm text-danger'}>{msg.text}</p> : null}
      <div className="space-y-4">
        {PHOTO_CATEGORIES.map((c) => {
          const inCat = list.filter((p) => p.category === c);
          return (
            <div key={c}>
              <h3 className="mb-1 text-sm font-medium">{PHOTO_LABEL[c]}{inCat.length ? ` (${inCat.length})` : ''}</h3>
              {inCat.length === 0 ? <p className="text-xs text-muted-foreground">Not provided</p> : (
                <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {inCat.map((p) => (
                    <li key={p.id} className="space-y-1 rounded-md border border-border bg-card p-2">
                      <Thumb photo={p} />
                      <p className="truncate text-xs">{p.notes || p.filename}</p>
                      <p className="text-[11px] text-muted-foreground">{p.capturedAt ? new Date(p.capturedAt).toLocaleString('en-US') : 'time unknown'}{p.gps ? ` · GPS ${p.gps.lat}, ${p.gps.lng}` : ''}</p>
                      <div className="flex items-center justify-between gap-1">
                        <span className={p.verified ? 'text-xs text-success' : 'text-xs text-muted-foreground'}>{p.verified ? 'Verified' : 'Unverified'}</span>
                        {editable && canVerify ? <Button type="button" size="sm" variant="outline" onClick={() => void mut.patchPhoto.mutateAsync({ fileId: p.id, verified: !p.verified })}>{p.verified ? 'Unverify' : 'Verify'}</Button> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
