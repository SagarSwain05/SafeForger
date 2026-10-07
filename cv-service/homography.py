"""
SafeForge Homography Engine
Maps camera pixel coordinates → plant layout coordinates (Leaflet CRS.Simple units).

Pipeline:
  frame → detection → worker feet point (x_px, y_px) → H (3×3) → (X_plant, Y_plant) → zone

The plant zones are read from the backend's plant-layout.json so the edge agent,
the backend and the dashboard map all share one coordinate system.
Calibrate a camera with calibration.py or the dashboard's Spatial Calibration page.
"""
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

logger = logging.getLogger("homography")

DEFAULT_LAYOUT = Path(__file__).resolve().parent.parent / "backend" / "src" / "data" / "plant-layout.json"


def load_layout(path: Optional[str] = None) -> dict:
    p = Path(path) if path else DEFAULT_LAYOUT
    with open(p) as f:
        return json.load(f)


class HomographyEngine:
    """Perspective transform from camera pixel space to plant layout space, one matrix per camera."""

    PLANT_WIDTH = 1180
    PLANT_HEIGHT = 640

    def __init__(self, config: dict, layout: Optional[dict] = None):
        self.cfg = config.get("homography", {})
        self.layout = layout or load_layout(config.get("layout_path"))
        self.zones = {z["id"]: z for z in self.layout["zones"]}
        self.cameras = {c["id"]: c for c in self.layout.get("cameras", [])}
        self.calibrations: Dict[str, np.ndarray] = {}
        for cam_id, data in self.cfg.get("camera_calibrations", {}).items():
            if data and "matrix" in data:
                self.calibrations[cam_id] = np.array(data["matrix"], dtype=np.float64)
                logger.info("Loaded homography matrix for %s", cam_id)

    def set_matrix(self, camera_id: str, matrix: List[List[float]]):
        self.calibrations[camera_id] = np.array(matrix, dtype=np.float64)

    def calibrate(self, camera_id: str, src_points: List[List[float]], dst_points: List[List[float]]):
        """Compute H from ≥4 point pairs (camera pixels → plant coordinates)."""
        import cv2
        H, _ = cv2.findHomography(np.float32(src_points), np.float32(dst_points), 0)
        if H is not None:
            self.calibrations[camera_id] = H
        return H

    def transform(self, camera_id: str, pixel_point: List[float], frame_wh=None, zone_hint: Optional[str] = None) -> List[float]:
        """
        Pixel → plant coordinates. Uncalibrated cameras fall back to a linear
        mapping of the frame onto the camera's own zone rectangle, so workers
        still land in the right zone on the map.
        """
        H = self.calibrations.get(camera_id)
        if H is not None:
            v = H @ np.array([pixel_point[0], pixel_point[1], 1.0])
            x, y = float(v[0] / v[2]), float(v[1] / v[2])
        else:
            zone = self.zones.get(zone_hint or self.cameras.get(camera_id, {}).get("zone", ""))
            if zone is None or not frame_wh:
                return [self.PLANT_WIDTH / 2, self.PLANT_HEIGHT / 2]
            fw, fh = frame_wh
            x = zone["x"] + (pixel_point[0] / max(1, fw)) * zone["w"]
            y = zone["y"] + (pixel_point[1] / max(1, fh)) * zone["h"]
        x = max(0.0, min(self.PLANT_WIDTH, x))
        y = max(0.0, min(self.PLANT_HEIGHT, y))
        return [round(x, 1), round(y, 1)]

    def get_zone(self, plant_coords: Optional[List[float]]) -> Optional[str]:
        if plant_coords is None:
            return None
        x, y = plant_coords
        for zid, z in self.zones.items():
            if z["x"] <= x <= z["x"] + z["w"] and z["y"] <= y <= z["y"] + z["h"]:
                return zid
        return None

    def map_workers(self, camera_id: str, result: dict, zone_hint: Optional[str] = None) -> dict:
        """Add plant_coords + zone_id to every worker (feet point = bottom-centre of bbox)."""
        frame_wh = (result["frame"]["w"], result["frame"]["h"])
        for w in result.get("workers", []):
            x1, y1, x2, y2 = w["bbox"]
            coords = self.transform(camera_id, [(x1 + x2) / 2, y2], frame_wh, zone_hint)
            w["plant_coords"] = coords
            w["zone_id"] = self.get_zone(coords) or zone_hint
        result["zones_occupied"] = sorted({w["zone_id"] for w in result.get("workers", []) if w.get("zone_id")})
        return result
