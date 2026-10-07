'use client';
import { createContext, useContext, useEffect, useState, useRef, ReactNode, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001').replace(/\/$/, '');
const WS_URL = (process.env.NEXT_PUBLIC_WS_URL || API_URL).replace(/\/$/, '');

/** fetch wrapper for the backend API with a timeout and JSON handling. */
export async function api<T = any>(path: string, init: RequestInit & { json?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const { json, timeoutMs = 20000, ...rest } = init;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}/api${path}`, {
      ...rest,
      signal: ctrl.signal,
      headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers || {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status, body });
    return body as T;
  } finally {
    clearTimeout(t);
  }
}

export interface Alert {
  id: string; key: string; type: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string; message: string; zone: string | null; zoneName: string | null; cameraId: string | null;
  location: { x: number; y: number; source: string } | null; source: string;
  evidence?: string | null; hasEvidence: boolean; evidenceAt: string | null;
  details: any; regulations: string[]; recommendedActions: string[];
  recipients: { name: string; role: string; reason: string }[];
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'; active: boolean; occurrences: number;
  createdAt: string; detectedAt: string; lastSeenAt: string;
  acknowledgedAt: string | null; acknowledgedBy: string | null; resolvedAt: string | null; resolvedBy: string | null;
  deliveries: { channel: string; status: string; at: string; to?: string[]; error?: string }[];
}

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
  everConnected: boolean;
  sensors: any[];
  workers: any[];
  permits: any[];
  riskData: any;
  emergencyState: any;
  shiftInfo: any;
  scada: any;
  scenario: string;
  cvDetections: Record<string, any>;
  alerts: Alert[];
  alertStats: any;
  latestAlert: Alert | null;
  refreshAlerts: () => void;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null, connected: false, everConnected: false, sensors: [], workers: [], permits: [], riskData: null,
  emergencyState: null, shiftInfo: null, scada: null, scenario: 'NORMAL', cvDetections: {}, alerts: [], alertStats: null,
  latestAlert: null, refreshAlerts: () => {},
});

export function SocketProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [sensors, setSensors] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [permits, setPermits] = useState<any[]>([]);
  const [riskData, setRiskData] = useState<any>(null);
  const [emergencyState, setEmergencyState] = useState<any>(null);
  const [shiftInfo, setShiftInfo] = useState<any>(null);
  const [scada, setScada] = useState<any>(null);
  const [scenario, setScenario] = useState('NORMAL');
  const [cvDetections, setCvDetections] = useState<Record<string, any>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertStats, setAlertStats] = useState<any>(null);
  const [latestAlert, setLatestAlert] = useState<Alert | null>(null);

  const refreshAlerts = useCallback(() => {
    api<Alert[]>('/alerts?limit=100').then(setAlerts).catch(() => {});
  }, []);

  useEffect(() => {
    const s = io(WS_URL, { transports: ['websocket', 'polling'], reconnectionDelayMax: 5000 });
    socketRef.current = s;
    setSocket(s);

    s.on('connect', () => { setConnected(true); setEverConnected(true); });
    s.on('disconnect', () => setConnected(false));
    s.on('sensors:initial', setSensors);
    s.on('sensors:update', setSensors);
    s.on('workers:initial', setWorkers);
    s.on('workers:update', setWorkers);
    s.on('permits:initial', setPermits);
    s.on('permits:updated', setPermits);
    s.on('risk:update', setRiskData);
    s.on('emergency:state', setEmergencyState);
    s.on('emergency:reset', setEmergencyState);
    s.on('shift:info', setShiftInfo);
    s.on('scada:initial', setScada);
    s.on('scada:update', setScada);
    s.on('scenario:changed', (d: any) => setScenario(d?.scenario || 'NORMAL'));
    s.on('cv:initial', (d: any) => setCvDetections(d || {}));
    s.on('cv:detection', (d: any) => { if (d?.zone) setCvDetections(prev => ({ ...prev, [d.zone]: d })); });
    s.on('cv:stale', ({ zone }: any) => setCvDetections(prev => { const n = { ...prev }; delete n[zone]; return n; }));
    s.on('alerts:initial', (list: Alert[]) => setAlerts(list || []));
    s.on('alerts:stats', setAlertStats);
    s.on('alert:new', (a: Alert) => {
      setAlerts(prev => [a, ...prev.filter(x => x.id !== a.id)].slice(0, 200));
      setLatestAlert(a);
    });
    s.on('alert:update', (a: Alert) => {
      setAlerts(prev => {
        const i = prev.findIndex(x => x.id === a.id);
        if (i === -1) return [a, ...prev].slice(0, 200);
        const merged = { ...prev[i], ...a, evidence: a.evidence ?? (a.evidenceAt === prev[i].evidenceAt ? prev[i].evidence : undefined) };
        const next = prev.slice();
        next[i] = merged;
        return next;
      });
    });

    return () => { s.disconnect(); };
  }, []);

  return (
    <SocketContext.Provider value={{
      socket, connected, everConnected, sensors, workers, permits, riskData, emergencyState, shiftInfo,
      scada, scenario, cvDetections, alerts, alertStats, latestAlert, refreshAlerts,
    }}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
export { API_URL, WS_URL };
