/** Largest JSON body the import endpoints accept (preview, and confirm which adds a small wrapper). */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
/** Extra room the confirm request has for its {"payload": …, "preview_token": …} wrapper. */
export const COMMIT_WRAPPER_BYTES = 4096;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}
