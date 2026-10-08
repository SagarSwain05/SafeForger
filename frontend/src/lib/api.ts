// Backend API client. Plant-specific paths ('/alerts', '/risk', …) are automatically scoped to
// the selected site (/api/sites/:siteId/…); account and catalogue paths are global.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001').replace(/\/$/, '');
export const WS_URL = (process.env.NEXT_PUBLIC_WS_URL || API_URL).replace(/\/$/, '');

const GLOBAL_PREFIXES = ['/auth', '/system', '/sites', '/sectors', '/health'];
const session: { token: string | null; siteId: string | null } = { token: null, siteId: null };

export function setApiSession(token: string | null, siteId: string | null) {
  session.token = token;
  session.siteId = siteId;
}
export const getApiSession = () => ({ ...session });

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export function apiUrl(path: string) {
  const isGlobal = GLOBAL_PREFIXES.some(p => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`));
  if (isGlobal || !session.siteId) return `${API_URL}/api${path}`;
  return `${API_URL}/api/sites/${encodeURIComponent(session.siteId)}${path}`;
}

export class ApiError extends Error {
  status: number; body: any;
  constructor(message: string, status: number, body: any) { super(message); this.status = status; this.body = body; }
}

/** fetch wrapper with timeout, JSON handling, auth header and site scoping. */
export async function api<T = any>(path: string, init: RequestInit & { json?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const { json, timeoutMs = 20000, ...rest } = init;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl(path), {
      ...rest,
      signal: ctrl.signal,
      headers: {
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
        ...(rest.headers || {}),
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 && session.token && !path.startsWith('/auth/login')) onUnauthorized?.();
    if (!res.ok) throw new ApiError(body?.error || `HTTP ${res.status}`, res.status, body);
    return body as T;
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new ApiError('The server did not respond in time — it may be waking up', 0, null);
    if (err instanceof TypeError) throw new ApiError('Cannot reach the SafeForge server', 0, null);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/** Drop-in fetch() for existing code: site-scoped URL + auth header, returns the raw Response. */
export function apiFetch(path: string, init: RequestInit = {}) {
  return fetch(apiUrl(path), {
    ...init,
    headers: { ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}), ...(init.headers || {}) },
  });
}
