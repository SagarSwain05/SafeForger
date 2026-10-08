'use client';
import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, setApiSession, setUnauthorizedHandler } from './api';

export interface User { id: string; email: string; name: string; role: string; organization: string; phone: string; verified: boolean; isDemo: boolean }
export interface SiteDoc {
  id: string; name: string; company: string; sector: string; sectorLabel: string; kind: string;
  location: { city: string; state: string; country: string }; description: string;
  layout: { plant: any; zones: any[]; sensors: any[]; cameras: any[]; permitPPE: any };
  contacts: { name: string; role: string; email: string; phone: string }[];
  ingestKey?: string; canEdit: boolean; members?: string[];
}

interface AuthValue {
  ready: boolean;
  token: string | null;
  user: User | null;
  siteId: string | null;
  site: SiteDoc | null;
  signIn: (token: string, user: User) => void;
  signOut: () => void;
  selectSite: (id: string | null) => Promise<void>;
  refreshSite: () => Promise<void>;
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthValue>({
  ready: false, token: null, user: null, siteId: null, site: null,
  signIn: () => {}, signOut: () => {}, selectSite: async () => {}, refreshSite: async () => {}, setUser: () => {},
});

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* blocked */ } };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [site, setSite] = useState<SiteDoc | null>(null);

  const signOut = useCallback(() => {
    write('sf_token', null);
    setApiSession(null, null);
    setToken(null); setUser(null); setSite(null);
  }, []);

  const loadSite = useCallback(async (id: string | null) => {
    if (!id) { setSite(null); return; }
    try {
      const doc = await api<SiteDoc>(`/sites/${encodeURIComponent(id)}`);
      setSite(doc);
    } catch {
      write('sf_site', null);
      setSiteId(null); setSite(null);
      setApiSession(read('sf_token'), null);
    }
  }, []);

  // Restore the session on load
  useEffect(() => {
    setUnauthorizedHandler(() => signOut());
    const t = read('sf_token');
    const s = read('sf_site');
    if (!t) { setReady(true); return; }
    setApiSession(t, s);
    api<{ user: User }>('/auth/me', { timeoutMs: 75000 })
      .then(async ({ user }) => {
        setToken(t); setUser(user); setSiteId(s);
        await loadSite(s);
      })
      .catch((err) => { if (err?.status === 401) signOut(); else { setToken(t); setSiteId(s); loadSite(s); } })
      .finally(() => setReady(true));
  }, [signOut, loadSite]);

  const signIn = useCallback((t: string, u: User) => {
    write('sf_token', t);
    const s = read('sf_site');
    setApiSession(t, s);
    setToken(t); setUser(u); setSiteId(s);
    loadSite(s);
  }, [loadSite]);

  const selectSite = useCallback(async (id: string | null) => {
    write('sf_site', id);
    setApiSession(read('sf_token'), id);
    setSiteId(id);
    await loadSite(id);
  }, [loadSite]);

  return (
    <AuthContext.Provider value={{ ready, token, user, siteId, site, signIn, signOut, selectSite, refreshSite: () => loadSite(siteId), setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
