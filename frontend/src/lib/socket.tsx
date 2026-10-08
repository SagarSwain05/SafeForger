'use client';
import { createContext, useContext, useEffect, useState, useRef, ReactNode, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { api, WS_URL } from './api';
import { useAuth } from './auth';

export { api, API_URL, WS_URL } from './api';

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
  reconnect: () => void;
  connectError: string | null;
  lastEventAt: number | null;
  restarting: boolean;
  siteInfo: any;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null, connected: false, everConnected: false, sensors: [], workers: [], permits: [], riskData: null,
  emergencyState: null, shiftInfo: null, scada: null, scenario: 'NORMAL', cvDetections: {}, alerts: [], alertStats: null,
  latestAlert: null, refreshAlerts: () => {}, reconnect: () => {}, connectError: null, lastEventAt: null, restarting: false, siteInfo: null,
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
  const [connectError, setConnectError] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [siteInfo, setSiteInfo] = useState<any>(null);
  const { token, siteId } = useAuth();

  const refreshAlerts = useCallback(() => {
    api<Alert[]>('/alerts?limit=100').then(setAlerts).catch(() => {});
  }, []);

  useEffect(() => {
    if (!token || !siteId) return;
    // Fresh state per site
    setSensors([]); setWorkers([]); setPermits([]); setRiskData(null); setEmergencyState(null);
    setScada(null); setCvDetections({}); setAlerts([]); setAlertStats(null); setLatestAlert(null);
    const s = io(WS_URL, { transports: ['websocket', 'polling'], reconnectionDelayMax: 5000, auth: { token, siteId } });
    socketRef.current = s;
    setSocket(s);

    s.on('connect', () => { setConnected(true); setEverConnected(true); setConnectError(null); setRestarting(false); });
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', (err: Error) => setConnectError(err.message));
    s.on('system:restarting', () => setRestarting(true));
    s.on('site:info', setSiteInfo);
    s.onAny(() => setLastEventAt(Date.now()));
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
  }, [token, siteId]);

  const reconnect = useCallback(() => {
    const s = socketRef.current;
    if (!s) return;
    s.disconnect();
    s.connect();
  }, []);

  return (
    <SocketContext.Provider value={{
      socket, connected, everConnected, sensors, workers, permits, riskData, emergencyState, shiftInfo,
      scada, scenario, cvDetections, alerts, alertStats, latestAlert, refreshAlerts, reconnect, connectError, lastEventAt, restarting, siteInfo,
    }}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
