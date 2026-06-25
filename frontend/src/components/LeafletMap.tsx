'use client';

import { useEffect, useRef, useState } from 'react';

// Leaflet can only be imported on the client side
let L: any;
if (typeof window !== 'undefined') {
  L = require('leaflet');
}

interface LeafletMapProps {
  sensors: any[];
  workers: any[];
  permits: any[];
  riskData: any;
  layout: any;
  selectedZone: string | null;
  onSelectZone: (zoneId: string | null) => void;
  zoneRiskScores: Record<string, number>;
}

const PLANT_W = 1180;
const PLANT_H = 640;

const STATUS_COLOR: Record<string, string> = {
  SAFE: '#00e676', NORMAL: '#00e676', LOW: '#69f0ae',
  WARNING: '#ffb300', ELEVATED: '#ff8f00', HIGH: '#ff5252', CRITICAL: '#ff1744',
};

function getRiskColor(score: number): string {
  if (score >= 75) return '#ff1744'; // critical
  if (score >= 50) return '#ff5252'; // high
  if (score >= 25) return '#ff8f00'; // warning
  if (score >= 10) return '#ffb300'; // normal/low
  return '#00e676'; // safe
}

export default function LeafletMap({
  sensors,
  workers,
  permits,
  riskData,
  layout,
  selectedZone,
  onSelectZone,
  zoneRiskScores,
}: LeafletMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layersRef = useRef<{
    zones: Record<string, any>;
    workers: Record<string, any>;
    sensors: Record<string, any>;
    cameras: Record<string, any>;
    permits: Record<string, any>;
    heat: any[];
  }>({
    zones: {},
    workers: {},
    sensors: {},
    cameras: {},
    permits: {},
    heat: [],
  });

  useEffect(() => {
    if (!mapContainerRef.current || !L || mapRef.current) return;

    // Create simple pixel-based coordinate system
    // We map [0,0] bottom-left to [PLANT_H, PLANT_W] top-right
    const map = L.map(mapContainerRef.current, {
      crs: L.CRS.Simple,
      minZoom: -1,
      maxZoom: 2,
      zoomControl: true,
      attributionControl: false,
    });

    // Plant bounds
    const bounds: [[number, number], [number, number]] = [
      [0, 0],
      [PLANT_H, PLANT_W],
    ];

    // Set view centered on plant bounds
    map.fitBounds(bounds);
    mapRef.current = map;

    // Add a dark canvas grid or layout background image if we want
    // Since we don't have a static image file, we draw a premium vector layout grid directly on map load.
    const bgContainer = L.rectangle(bounds, {
      fillColor: '#050914',
      fillOpacity: 1,
      color: '#1e293b',
      weight: 2,
      interactive: false,
    }).addTo(map);

    // Draw grid lines
    for (let x = 80; x < PLANT_W; x += 80) {
      L.polyline([[0, x], [PLANT_H, x]], { color: 'rgba(56, 100, 200, 0.04)', weight: 1, interactive: false }).addTo(map);
    }
    for (let y = 80; y < PLANT_H; y += 80) {
      L.polyline([[y, 0], [y, PLANT_W]], { color: 'rgba(56, 100, 200, 0.04)', weight: 1, interactive: false }).addTo(map);
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [layout]);

  // Sync / Draw Layers when data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !L || !layout) return;

    const layers = layersRef.current;

    // 1. ZONES POLYGONS
    layout.zones.forEach((zone: any) => {
      const riskScore = zoneRiskScores[zone.id] ?? 0;
      const color = getRiskColor(riskScore);
      const isSelected = selectedZone === zone.id;

      // In Leaflet CRS.Simple, Y is inverted (top-left SVG is [x, y], Leaflet [y, x] where Y starts from bottom)
      // SVG: top-left x, y, width w, height h
      // Leaflet coordinates: [[bottom, left], [top, right]]
      // bottom = PLANT_H - (y + h)
      // top = PLANT_H - y
      // left = x
      // right = x + w
      const bottom = PLANT_H - (zone.y + zone.h);
      const top = PLANT_H - zone.y;
      const left = zone.x;
      const right = zone.x + zone.w;

      const zoneBounds: [[number, number], [number, number]] = [
        [bottom, left],
        [top, right],
      ];

      if (layers.zones[zone.id]) {
        // Update existing polygon
        layers.zones[zone.id].setStyle({
          fillColor: color,
          fillOpacity: 0.12 + (riskScore / 100) * 0.45,
          color: isSelected ? '#ffffff' : color,
          weight: isSelected ? 2 : 1,
        });
      } else {
        // Create new polygon
        const poly = L.rectangle(zoneBounds, {
          fillColor: color,
          fillOpacity: 0.12 + (riskScore / 100) * 0.45,
          color: color,
          weight: 1,
          dashArray: '2,2',
        }).addTo(map);

        // Bind interactive popup/events
        poly.on('click', () => {
          onSelectZone(zone.id === selectedZone ? null : zone.id);
        });

        // Add zone name/id text label (divIcon marker)
        const labelLatLng = L.latLng(top - 18, left + zone.w / 2);
        L.marker(labelLatLng, {
          icon: L.divIcon({
            className: 'zone-label-marker',
            html: `<div style="text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; color: #e8f0ff; text-shadow: 0 1px 3px rgba(0,0,0,0.8);">${zone.id}</div>`,
            iconSize: [80, 20],
            iconAnchor: [40, 10],
          }),
          interactive: false,
        }).addTo(map);

        layers.zones[zone.id] = poly;
      }
    });

    // 2. WORKERS MARKERS
    // Clear old workers
    Object.values(layers.workers).forEach((m: any) => m.remove());
    layers.workers = {};

    workers.forEach((w: any) => {
      // Invert Y coordinate
      const lat = PLANT_H - w.y;
      const lng = w.x;

      const marker = L.circleMarker([lat, lng], {
        radius: 6,
        fillColor: '#00b0ff',
        fillOpacity: 0.8,
        color: '#ffffff',
        weight: 1,
      }).addTo(map);

      // Tooltip/popup info
      marker.bindTooltip(
        `<div style="font-family: 'Inter', sans-serif; font-size: 11px; padding: 4px; background: #080f1e; border: 1px solid rgba(56,100,200,0.3); border-radius: 4px; color: #fff;">
          <strong>${w.name}</strong><br/>
          <span style="color: #8ba0c4;">${w.role}</span>
         </div>`,
        { direction: 'top', className: 'custom-tooltip' }
      );

      layers.workers[w.id] = marker;
    });

    // 3. SENSORS MARKERS
    layout.sensors.forEach((s: any) => {
      const lat = PLANT_H - s.y;
      const lng = s.x;

      const reading = sensors.find((rs) => rs.id === s.id);
      const color = reading ? STATUS_COLOR[reading.status] ?? '#00e676' : '#4a6080';

      if (layers.sensors[s.id]) {
        layers.sensors[s.id].setStyle({
          fillColor: color,
          color: color,
        });
      } else {
        const marker = L.circleMarker([lat, lng], {
          radius: 8,
          fillColor: color,
          fillOpacity: 0.2,
          color: color,
          weight: 1.5,
        }).addTo(map);

        marker.bindTooltip(
          `<div style="font-family: 'Inter', sans-serif; font-size: 11px; padding: 6px; background: #080f1e; color: #fff; border-radius: 4px;">
            <strong>${s.id} (${s.type})</strong><br/>
            Value: <span style="font-family: monospace; color: ${color}">${reading ? reading.value.toFixed(1) + ' ' + reading.unit : 'N/A'}</span>
           </div>`
        );

        layers.sensors[s.id] = marker;
      }
    });

    // 4. CAMERAS + FOV OVERLAYS
    layout.cameras.forEach((cam: any) => {
      const lat = PLANT_H - cam.y;
      const lng = cam.x;

      if (!layers.cameras[cam.id]) {
        // Camera icon marker
        const camMarker = L.marker([lat, lng], {
          icon: L.divIcon({
            className: 'cam-marker-icon',
            html: `<div style="width: 14px; height: 14px; background: rgba(8,15,30,0.85); border: 1.5px solid #00e676; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; color: #00e676;">📷</div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
        }).addTo(map);

        // Styled FOV arc approximation (shaded polygon/cone)
        // Let's create a triangular polygon pointing in a typical direction (e.g. down-right or down-left)
        const angle = cam.id === 'CAM-01' ? 45 : cam.id === 'CAM-02' ? 135 : cam.id === 'CAM-03' ? 225 : 315;
        const rad = angle * (Math.PI / 180);
        const fovDistance = 90;
        const spread = 0.5; // arc spread in radians

        const p1: [number, number] = [lat, lng];
        const p2: [number, number] = [
          lat + fovDistance * Math.sin(rad - spread),
          lng + fovDistance * Math.cos(rad - spread),
        ];
        const p3: [number, number] = [
          lat + fovDistance * Math.sin(rad + spread),
          lng + fovDistance * Math.cos(rad + spread),
        ];

        const fovCone = L.polygon([p1, p2, p3], {
          fillColor: '#00e676',
          fillOpacity: 0.04,
          color: '#00e676',
          weight: 0.5,
          dashArray: '3,3',
          interactive: false,
        }).addTo(map);

        layers.cameras[cam.id] = { marker: camMarker, fov: fovCone };
      }
    });

    // 5. PERMITS (Dashed Outline)
    // Clear old permits
    Object.values(layers.permits).forEach((m: any) => m.remove());
    layers.permits = {};

    permits.filter(p => p.status === 'ACTIVE').forEach(permit => {
      const zone = layout.zones.find((z: any) => z.id === permit.zone);
      if (!zone) return;

      const bottom = PLANT_H - (zone.y + zone.h) + 4;
      const top = PLANT_H - zone.y - 4;
      const left = zone.x + 4;
      const right = zone.x + zone.w - 4;

      const pColor = permit.type === 'HOT_WORK' ? '#ff4444' : permit.type === 'CONFINED_SPACE' ? '#ff8844' : '#ffff44';

      const poly = L.rectangle([[bottom, left], [top, right]], {
        fillColor: 'transparent',
        color: pColor,
        weight: 2,
        dashArray: '6,4',
        interactive: false,
      }).addTo(map);

      layers.permits[permit.id] = poly;
    });

  }, [sensors, workers, permits, selectedZone, zoneRiskScores, layout]);

  return (
    <div
      ref={mapContainerRef}
      style={{
        width: '100%',
        height: '520px',
        borderRadius: '10px',
        border: '1px solid rgba(56, 100, 200, 0.15)',
        background: '#050914',
      }}
    />
  );
}
