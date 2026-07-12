const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

const BACKEND_ORIGIN = "http://127.0.0.1:1234"

/**
 * Resolves a `/api/...` path to an absolute backend URL when running inside
 * the Tauri desktop shell (no dev-server proxy there), otherwise returns the
 * path unchanged so the Vite dev-server proxy / same-origin deployment keeps working.
 */
export function apiUrl(path: string): string {
  if (!path.startsWith("/")) return path
  return isTauri ? `${BACKEND_ORIGIN}${path}` : path
}
