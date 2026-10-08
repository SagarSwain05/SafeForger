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
  vision?: Record<string, any>;
  alerts?: any[];
}

const PLANT_W = 1180;
const PLANT_H = 640;

const STATUS_COLOR: Record<string, string> = {
  SAFE: '#16a34a', NORMAL: '#16a34a', LOW: '#22c55e',
  WARNING: '#d97706', ELEVATED: '#ea580c', HIGH: '#ef4444', CRITICAL: '#e11d48',
};

function getRiskColor(score: number): string {
  if (score >= 75) return '#e11d48'; // critical
  if (score >= 50) return '#ef4444'; // high
  if (score >= 25) return '#ea580c'; // warning
  if (score >= 10) return '#d97706'; // normal/low
  return '#16a34a'; // safe
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
  vision = {},
  alerts = [],
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
    cv: any[];
  }>({
    zones: {},
    workers: {},
    sensors: {},
    cameras: {},
    permits: {},
    heat: [],
    cv: [],
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
    const bgContainer = L.rectangle(bounds, { fillOpacity: 1, weight: 2, interactive: false }).addTo(map);
    // SVG attributes can't read CSS variables — resolve theme colours now and on every toggle
    const applyTheme = () => {
      const cs = getComputedStyle(document.documentElement);
      bgContainer.setStyle({ fillColor: cs.getPropertyValue('--map-bg').trim() || '#050914', color: cs.getPropertyValue('--map-border').trim() || '#1e293b' });
    };
    applyTheme();
    window.addEventListener('sf-theme', applyTheme);

    // Draw grid lines
    for (let x = 80; x < PLANT_W; x += 80) {
      L.polyline([[0, x], [PLANT_H, x]], { color: 'rgba(56,100,200,0.08)', weight: 1, interactive: false }).addTo(map);
    }
    for (let y = 80; y < PLANT_H; y += 80) {
      L.polyline([[y, 0], [y, PLANT_W]], { color: 'rgba(56,100,200,0.08)', weight: 1, interactive: false }).addTo(map);
    }

    return () => {
      window.removeEventListener('sf-theme', applyTheme);
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
            html: `<div style="text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; color: var(--text-primary);">${zone.id}</div>`,
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
        fillColor: '#0ea5e9',
        fillOpacity: 0.8,
        color: '#ffffff',
        weight: 1,
      }).addTo(map);

      // Tooltip/popup info
      marker.bindTooltip(
        `<div style="font-family: 'Inter', sans-serif; font-size: 11px; padding: 4px; background: #080f1e; border: 1px solid var(--border-subtle); border-radius: 4px; color: #fff;">
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
      const color = reading && reading.online !== false && reading.value !== null ? STATUS_COLOR[reading.status] ?? '#16a34a' : '#64748b';

      const tip = `<div style="font-family: 'Inter', sans-serif; font-size: 11px; padding: 6px; background: #080f1e; color: #fff; border-radius: 4px;">
            <strong>${s.id} (${s.type})</strong>${s.label ? ' · ' + s.label : ''}<br/>
            Value: <span style="font-family: monospace; color: ${color}">${reading && reading.value !== null && reading.value !== undefined ? Number(reading.value).toFixed(1) + ' ' + reading.unit + (reading.online === false ? ' (offline)' : '') : 'no data'}</span>
           </div>`;
      if (layers.sensors[s.id]) {
        layers.sensors[s.id].setStyle({
          fillColor: color,
          color: color,
        });
        layers.sensors[s.id].setTooltipContent(tip);
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
            <strong>${s.id} (${s.type})</strong>${s.label ? ' · ' + s.label : ''}<br/>
            Value: <span style="font-family: monospace; color: ${color}">${reading && reading.value !== null && reading.value !== undefined ? Number(reading.value).toFixed(1) + ' ' + reading.unit + (reading.online === false ? ' (offline)' : '') : 'no data'}</span>
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
            html: `<div style="width: 14px; height: 14px; background: var(--bg-panel); border: 1.5px solid #16a34a; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; color: #16a34a;">📷</div>`,
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
          fillColor: '#16a34a',
          fillOpacity: 0.04,
          color: '#16a34a',
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

      const pColor = permit.type === 'HOT_WORK' ? '#ff4444' : permit.type === 'CONFINED_SPACE' ? '#ff8844' : '#ca8a04';

      const poly = L.rectangle([[bottom, left], [top, right]], {
        fillColor: 'transparent',
        color: pColor,
        weight: 2,
        dashArray: '6,4',
        interactive: false,
      }).addTo(map);

      layers.permits[permit.id] = poly;
    });

    // 6. CCTV VISION — camera status colour, fire/smoke markers, CV-detected workers
    layers.cv.forEach((m: any) => m.remove());
    layers.cv = [];
    layout.cameras.forEach((cam: any) => {
      const d = vision[cam.zone];
      const live = d && d.camera_id === cam.id;
      const status = !live ? '#64748b' : d.fire_detected ? '#f97316' : d.smoke_detected ? '#a3a3a3' : d.ppe_violations ? '#ef4444' : '#16a34a';
      const m = L.circleMarker([PLANT_H - cam.y, cam.x], { radius: 11, color: status, weight: 2, fill: false, interactive: false }).addTo(map);
      layers.cv.push(m);
      if (live && (d.fire_detected || d.smoke_detected)) {
        const icon = L.marker([PLANT_H - cam.y - 22, cam.x], {
          icon: L.divIcon({
            className: 'cv-hazard',
            html: `<div class="pulse-critical" style="font-size:20px;line-height:24px;width:26px;height:26px;text-align:center;border-radius:50%;background:rgba(249,115,22,0.25)">${d.fire_detected ? '🔥' : '💨'}</div>`,
            iconSize: [26, 26], iconAnchor: [13, 13],
          }),
        }).addTo(map);
        icon.bindTooltip(`${cam.id}: ${d.fire_detected ? 'FIRE' : 'SMOKE'} detected in ${cam.zone}`);
        layers.cv.push(icon);
      }
      if (live) {
        (d.mapped_positions || []).slice(0, 30).forEach((p: any) => {
          if (!p.plant_coords) return;
          const pm = L.circleMarker([PLANT_H - p.plant_coords[1], p.plant_coords[0]], {
            radius: 4, fillColor: p.compliant === false ? '#ef4444' : '#22c55e', fillOpacity: 0.9, color: '#000', weight: 1,
          }).addTo(map);
          pm.bindTooltip(`CCTV person ${p.person_id}${p.missing?.length ? ' — missing ' + p.missing.join(', ') : ''}`);
          layers.cv.push(pm);
        });
      }
    });
    // Open alert pins at their location
    alerts.filter((a: any) => a.status !== 'RESOLVED' && a.location && ['FIRE', 'SMOKE', 'PPE_VIOLATION'].includes(a.type)).slice(0, 15).forEach((a: any) => {
      const pin = L.circleMarker([PLANT_H - a.location.y, a.location.x], {
        radius: 16, color: a.severity === 'CRITICAL' ? '#e11d48' : '#ea580c', weight: 2, dashArray: '4,3', fill: false,
      }).addTo(map);
      pin.bindTooltip(`${a.title} (${a.status})`);
      layers.cv.push(pin);
    });

  }, [sensors, workers, permits, selectedZone, zoneRiskScores, layout, vision, alerts]);

  return (
    <div
      ref={mapContainerRef}
      style={{
        width: '100%',
        height: '520px',
        borderRadius: '10px',
        border: '1px solid var(--border-subtle)',
        background: 'var(--map-bg)',
      }}
    />
  );
}
