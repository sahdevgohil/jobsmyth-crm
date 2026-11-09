/** Must match the backend allowlist (ALLOWED_FILE_MIME_TYPES) and the default FILE_MAX_BYTES (8 MB). The server re-validates both. */
export const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain'];
export const MAX_UPLOAD_BYTES = 8_000_000;

export function validateUpload(file: { type: string; size: number }): string | null {
  if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) return 'Unsupported file type. Use JPG, PNG, WebP, PDF or TXT.';
  if (file.size === 0) return 'The file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) return `File is too large (max ${(MAX_UPLOAD_BYTES / 1_000_000).toFixed(0)} MB).`;
  return null;
}
