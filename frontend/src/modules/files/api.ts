import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';
import { useAuthStore } from '@/stores/auth-store';

export type FileRecord = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  category: 'photo' | 'document' | 'report' | 'other';
  caption: string;
  visibility: 'internal' | 'customer';
  customerId: string | null;
  propertyId: string | null;
  inspectionId: string | null;
  leadId: string | null;
  appointmentId: string | null;
  projectId: string | null;
  downloadPath: string;
  uploadedBy: string;
  createdAt: string;
};

export const fileKeys = {
  all: ['files'] as const,
  list: (filters: string) => ['files', 'list', filters] as const,
};

export function useFiles(params: Record<string, string | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  const filters = qs.toString();
  return useQuery({
    queryKey: fileKeys.list(filters),
    queryFn: () =>
      apiFetch<{ data: FileRecord[]; meta: { total: number } }>(`/files?${filters}`),
  });
}

export function useUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: FileRecord }>('/files', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: fileKeys.all }),
  });
}

export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export async function downloadFile(fileId: string): Promise<void> {
  const API_URL = import.meta.env.VITE_API_URL as string;
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${API_URL}/files/${fileId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = res.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') ?? 'download';
  a.click();
  URL.revokeObjectURL(url);
}
