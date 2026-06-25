'use client';
import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:5001';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001';

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
  sensors: any[];
  workers: any[];
  permits: any[];
  riskData: any;
  emergencyState: any;
  shiftInfo: any;
  cvDetections: Record<string, any>;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null, connected: false, sensors: [], workers: [],
  permits: [], riskData: null, emergencyState: null, shiftInfo: null,
  cvDetections: {}
});

export function SocketProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [sensors, setSensors] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [permits, setPermits] = useState<any[]>([]);
  const [riskData, setRiskData] = useState<any>(null);
  const [emergencyState, setEmergencyState] = useState<any>(null);
  const [shiftInfo, setShiftInfo] = useState<any>(null);
  const [cvDetections, setCvDetections] = useState<Record<string, any>>({});

  useEffect(() => {
    const socket = io(WS_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('sensors:initial', setSensors);
    socket.on('sensors:update', setSensors);
    socket.on('workers:initial', setWorkers);
    socket.on('workers:update', setWorkers);
    socket.on('permits:initial', setPermits);
    socket.on('permits:updated', setPermits);
    socket.on('risk:update', setRiskData);
    socket.on('emergency:state', setEmergencyState);
    socket.on('emergency:reset', setEmergencyState);
    socket.on('shift:info', setShiftInfo);
    
    // Live CV events
    socket.on('cv:initial', (initialData) => {
      setCvDetections(initialData || {});
    });
    socket.on('cv:detection', (detection) => {
      if (detection && detection.zone) {
        setCvDetections(prev => ({
          ...prev,
          [detection.zone]: detection
        }));
      }
    });

    return () => { socket.disconnect(); };
  }, []);

  return (
    <SocketContext.Provider value={{
      socket: socketRef.current, connected, sensors, workers,
      permits, riskData, emergencyState, shiftInfo, cvDetections
    }}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
export { API_URL, WS_URL };
