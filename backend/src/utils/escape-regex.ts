/** Escape user input before embedding in a RegExp (V2-20). */
export function escapeRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
