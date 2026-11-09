import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';
import { useAuthStore } from '@/stores/auth-store';
import { measurementKeys } from './api';
import type { Measurement } from './types';

export const EDGE_TYPES = ['ridge', 'hip', 'valley', 'eave', 'rake', 'wall_flashing', 'step_flashing', 'curb_flashing', 'transition', 'parapet', 'unspecified'] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];
export const EDGE_LABEL: Record<EdgeType, string> = {
  ridge: 'Ridge', hip: 'Hip', valley: 'Valley', eave: 'Eave', rake: 'Rake', wall_flashing: 'Wall flashing', step_flashing: 'Step flashing', curb_flashing: 'Curb flashing',
  transition: 'Transition', parapet: 'Parapet wall', unspecified: 'Unspecified',
};

export type RoofEdge = {
  id: string; type: EdgeType; lengthFt: number | null; planLengthFt: number; facetIds: string[]; source: 'derived' | 'manual'; confidence: 'medium' | 'low';
  verification: 'unverified' | 'needs_verification' | 'verified'; included: boolean; note: string; history: Array<{ at: string; field: string; from: unknown; to: unknown; reason: string; userId: string }>;
};
export type RoofFacet = { id: string; segmentId: string; areaSqFt: number; pitchLabel: string; pitchDegrees: number; azimuthDegrees: number; flat: boolean; agreement: number | null; confidence: 'medium' | 'low'; structureId: string };
export type Geometry = {
  status: 'ok' | 'partial' | 'unavailable'; reason: string | null; facets: RoofFacet[]; edges: RoofEdge[]; warnings: string[];
  structures: Array<{ id: string; kind: string; footprintAreaSqFt: number; roofAreaMeasured: boolean; note: string }>;
  imagery: { widthPx: number; heightPx: number; date: string | null; quality: string | null; fileId: string | null; retainedUntil: string | null } | null;
};

export type RoofSummary = {
  totalAreaSqFt: number; squares: number; pitchedAreaSqFt: number; flatAreaSqFt: number; facetCount: number; predominantPitch: string;
  pitchBreakdown: Array<{ pitch: string; segmentCount: number; areaSqFt: number; percent: number; flat: boolean }>;
  structures: Array<{ id: string; kind: string; label: string; footprintAreaSqFt: number; roofAreaSqFt: number | null; pitchedAreaSqFt: number | null; flatAreaSqFt: number | null; facetCount: number | null; roofAreaMeasured: boolean; note: string }>;
};

export type DiagramSet = { status: string; approximate: boolean; reason: string | null; svgs: Partial<Record<'outline' | 'facets' | 'area' | 'pitch' | 'edges', string>>; aerialOverlay: string | null; imagery: Geometry['imagery']; warnings: string[] };

export type WasteRow = { percent: number; baseAreaSqFt: number; wasteAreaSqFt: number; finalAreaSqFt: number; baseSquares: number; finalSquares: number };
export type ProductRow = { id: string | null; brand: string; name: string; packageUnit: string; coveragePerPackage: number; specConfirmed: boolean; generic: boolean; packages: Record<string, number | null> };
export type MaterialFamily = { family: string; label: string; basisLabel: string; unit: 'sqft' | 'ft' | 'each'; basis: Record<string, number | null>; status: 'ready' | 'unverified' | 'missing' | 'no_product'; blocking: string[]; notes: string[]; products: ProductRow[] };
export type Materials = {
  wastePercent: number;
  flatWastePercent: number;
  recommended: { pitched: number; flat: number };
  pitchedAreaSqFt: number;
  flatAreaSqFt: number;
  wasteTables: { pitched: WasteRow[]; flat: WasteRow[] };
  wasteColumns: number[];
  families: MaterialFamily[];
  productsConfigured: boolean;
};

export const PHOTO_CATEGORIES = ['aerial_overview', 'front_elevation', 'rear_elevation', 'left_elevation', 'right_elevation', 'roof_slope', 'damage_closeup', 'penetration', 'gutter', 'flashing', 'interior_damage', 'other'] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];
export const PHOTO_LABEL: Record<PhotoCategory, string> = {
  aerial_overview: 'Aerial overview (uploaded)', front_elevation: 'Front elevation', rear_elevation: 'Rear elevation', left_elevation: 'Left elevation', right_elevation: 'Right elevation',
  roof_slope: 'Roof slopes', damage_closeup: 'Damage close-ups', penetration: 'Penetrations', gutter: 'Gutters', flashing: 'Flashing', interior_damage: 'Interior damage', other: 'Other',
};
export type Photo = { id: string; filename: string; mimeType: string; category: PhotoCategory; relatedItem: string; notes: string; capturedAt: string | null; gps: { lat: number; lng: number } | null; verified: boolean; createdAt: string; downloadPath: string };

const j = (b: unknown): string => JSON.stringify(b);
const b = (id: string): string => `/measurements/solar/${id}`;
const get = <T,>(path: string): Promise<T> => apiFetch<{ data: T }>(path).then((r) => r.data);

export const wsKeys = (id: string) => ({ summary: ['ws', id, 'summary'], diagrams: ['ws', id, 'diagrams'], geometry: ['ws', id, 'geometry'], materials: ['ws', id, 'materials'], photos: ['ws', id, 'photos'], all: ['ws', id] });

export const useSummary = (id: string) => useQuery({ queryKey: wsKeys(id).summary, queryFn: () => get<RoofSummary>(`${b(id)}/summary`) });
export const useDiagrams = (id: string) => useQuery({ queryKey: wsKeys(id).diagrams, queryFn: () => get<DiagramSet>(`${b(id)}/diagrams`) });
export const useGeometry = (id: string) => useQuery({ queryKey: wsKeys(id).geometry, queryFn: () => get<Geometry | null>(`${b(id)}/geometry`) });
export const useMaterials = (id: string) => useQuery({ queryKey: wsKeys(id).materials, queryFn: () => get<Materials>(`${b(id)}/materials`) });
export const usePhotos = (id: string) => useQuery({ queryKey: wsKeys(id).photos, queryFn: () => get<Photo[]>(`${b(id)}/photos`) });

export function useWorkspaceMutations(id: string) {
  const qc = useQueryClient();
  const refresh = async (): Promise<void> => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['ws', id] }), qc.invalidateQueries({ queryKey: measurementKeys.all }), qc.invalidateQueries({ queryKey: ['solar'] })]);
  };
  const call = <T,>(method: string, path: string, body?: unknown) => apiFetch<{ data: T }>(`${b(id)}${path}`, { method, ...(body === undefined ? {} : { body: j(body) }) }).then((r) => r.data);
  return {
    patchEdge: useMutation({ mutationFn: (v: { edgeId: string; type?: EdgeType; lengthFt?: number | null; included?: boolean; verification?: RoofEdge['verification']; note?: string; reason: string }) => { const { edgeId, ...rest } = v; return call<Measurement>('PATCH', `/edges/${edgeId}`, rest); }, onSuccess: refresh }),
    addEdge: useMutation({ mutationFn: (v: { type: EdgeType; lengthFt: number; note?: string; reason: string }) => call<Measurement>('POST', '/edges', v), onSuccess: refresh }),
    verifyEdges: useMutation({ mutationFn: (v: { ids?: string[]; reason: string }) => call<Measurement>('POST', '/edges/verify', v), onSuccess: refresh }),
    setWaste: useMutation({ mutationFn: (body: { percent?: number; flatPercent?: number }) => call<Measurement>('PATCH', '/waste', body), onSuccess: refresh }),
    refreshImagery: useMutation({ mutationFn: () => call<Measurement>('POST', '/geometry/refresh'), onSuccess: refresh }),
    uploadPhoto: useMutation({ mutationFn: (v: { filename: string; mimeType: string; contentBase64: string; category: PhotoCategory; notes?: string; relatedItem?: string; capturedAt?: string; gps?: { lat: number; lng: number } }) => call<Photo>('POST', '/photos', v), onSuccess: refresh }),
    patchPhoto: useMutation({ mutationFn: (v: { fileId: string; category?: PhotoCategory; notes?: string; relatedItem?: string; verified?: boolean }) => { const { fileId, ...rest } = v; return call<Photo>('PATCH', `/photos/${fileId}`, rest); }, onSuccess: refresh }),
  };
}

/** Fetches a protected image as an object URL (the browser cannot send the bearer token from an <img> tag). */
export async function fetchBlobUrl(path: string): Promise<string> {
  const base = import.meta.env.VITE_API_URL as string;
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' });
  if (!res.ok) throw new Error(res.status === 410 ? 'The stored aerial image has expired.' : 'Image not available.');
  return URL.createObjectURL(await res.blob());
}

export const readAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
