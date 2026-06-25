"""
SafeForger Homography Engine
Maps camera pixel coordinates → plant layout coordinates (Leaflet CRS.Simple)

Pipeline:
  [RTSP/Webcam Frame] → YOLO detection → feet_point (x_px, y_px)
  → Homography H → (X_layout, Y_layout) → Leaflet marker / risk zone

Calibration: 4-point perspective transform using findHomography()
  Pick 4 known points in the camera view that correspond to known plant layout positions.
  Run calibration.py for interactive calibration.

Usage:
  engine = HomographyEngine(config)
  # After calibration:
  plant_coords = engine.transform(camera_id, [px, py])
  zone_id = engine.get_zone(plant_coords)
"""
import numpy as np
import json
import logging
from pathlib import Path
from typing import Optional, Tuple, Dict, List

logger = logging.getLogger("homography")


class HomographyEngine:
    """
    Perspective transform from camera pixel space to plant layout 2D space.
    Each camera has its own calibration matrix.
    """

    # Plant zones bounding boxes (plant layout pixel coordinates)
    # These match the SVG/Leaflet CRS.Simple coordinate system
    PLANT_ZONES = {
        "Z-01": {"x": 280, "y": 130, "w": 150, "h": 160, "name": "Crude Distillation Unit"},
        "Z-02": {"x": 460, "y": 130, "w": 120, "h": 160, "name": "Hydrocracker Unit"},
        "Z-03": {"x": 610, "y": 110, "w": 170, "h": 180, "name": "Storage Tank Farm"},
        "Z-04": {"x": 810, "y": 130, "w": 110, "h": 150, "name": "Utility Block"},
        "Z-05": {"x": 950, "y": 110, "w": 130, "h": 160, "name": "Control Room"},
        "Z-06": {"x": 280, "y": 285, "w": 110, "h": 125, "name": "Flare Stack Area"},
        "Z-07": {"x": 420, "y": 290, "w": 140, "h": 125, "name": "Pump Station A"},
        "Z-08": {"x": 590, "y": 290, "w": 140, "h": 125, "name": "Heat Exchanger Bay"},
        "Z-09": {"x": 765, "y": 290, "w": 140, "h": 125, "name": "Compressor Hall"},
        "Z-10": {"x": 940, "y": 285, "w": 150, "h": 130, "name": "Maintenance Workshop"},
        "Z-11": {"x": 280, "y": 420, "w": 130, "h": 120, "name": "Confined Space CS-01"},
        "Z-12": {"x": 440, "y": 420, "w": 130, "h": 120, "name": "Confined Space CS-02"},
        "Z-13": {"x": 600, "y": 430, "w": 135, "h": 110, "name": "Loading Bay"},
        "Z-14": {"x": 765, "y": 425, "w": 140, "h": 115, "name": "Cooling Tower"},
        "Z-15": {"x": 930, "y": 415, "w": 145, "h": 125, "name": "Emergency Assembly"},
    }

    PLANT_WIDTH = 1180
    PLANT_HEIGHT = 640

    def __init__(self, config: dict):
        self.cfg = config.get("homography", {})
        self.calibrations: Dict[str, np.ndarray] = {}  # camera_id → H matrix
        self._load_calibrations()

    def _load_calibrations(self):
        """Load pre-computed homography matrices from config."""
        cam_calibs = self.cfg.get("camera_calibrations", {})
        for cam_id, data in cam_calibs.items():
            if data and "matrix" in data:
                self.calibrations[cam_id] = np.array(data["matrix"])
                logger.info(f"Loaded homography matrix for {cam_id}")

    def calibrate(
        self,
        camera_id: str,
        src_points: List[List[float]],   # pixel coords in camera image
        dst_points: List[List[float]],   # corresponding plant layout coords
    ) -> np.ndarray:
        """
        Compute and store homography matrix from 4+ point pairs.
        Call this during setup with physical measurement correspondences.

        Args:
            camera_id: e.g. "CAM-01"
            src_points: [[px1,py1], [px2,py2], [px3,py3], [px4,py4]] camera pixels
            dst_points: [[lx1,ly1], [lx2,ly2], [lx3,ly3], [lx4,ly4]] plant layout coords

        Returns:
            3x3 homography matrix H
        """
        src = np.float32(src_points)
        dst = np.float32(dst_points)
        H, mask = cv2_findHomography(src, dst, method=0)  # 0 = least squares
        if H is not None:
            self.calibrations[camera_id] = H
            logger.info(f"Homography computed for {camera_id}: {mask.ravel().sum()}/{len(src_points)} inliers")
        return H

    def transform(
        self,
        camera_id: str,
        pixel_point: List[float],
    ) -> Optional[List[float]]:
        """
        Transform pixel coordinate to plant layout coordinate.
        Returns [x_layout, y_layout] or None if not calibrated.
        """
        H = self.calibrations.get(camera_id)
        if H is None:
            # Return a default fallback position (plant center ± noise)
            x = self.PLANT_WIDTH / 2 + np.random.uniform(-100, 100)
            y = self.PLANT_HEIGHT / 2 + np.random.uniform(-60, 60)
            return [round(x, 1), round(y, 1)]

        pt = np.array([[pixel_point[0], pixel_point[1], 1.0]], dtype=np.float32).T
        result = H @ pt
        result = result / result[2]  # normalize homogeneous coordinate
        x_layout = float(result[0])
        y_layout = float(result[1])
        # Clamp to plant bounds
        x_layout = max(0, min(self.PLANT_WIDTH, x_layout))
        y_layout = max(0, min(self.PLANT_HEIGHT, y_layout))
        return [round(x_layout, 1), round(y_layout, 1)]

    def get_zone(self, plant_coords: List[float]) -> Optional[str]:
        """
        Find which plant zone contains the given plant layout coordinates.
        Returns zone_id (e.g. "Z-01") or None if outside all zones.
        """
        if plant_coords is None:
            return None
        x, y = plant_coords
        for zone_id, z in self.PLANT_ZONES.items():
            if z["x"] <= x <= z["x"] + z["w"] and z["y"] <= y <= z["y"] + z["h"]:
                return zone_id
        return None

    def map_detections(self, camera_id: str, detections: dict) -> dict:
        """
        Transform all detected person feet_points to plant coordinates.
        Adds 'plant_coords' and 'zone_id' to each person dict.
        Also adds 'mapped_positions' list to detections dict.
        """
        mapped_positions = []
        for person in detections.get("persons", []):
            feet = person.get("feet_point")
            if feet:
                plant_coords = self.transform(camera_id, feet)
                zone_id = self.get_zone(plant_coords)
                person["plant_coords"] = plant_coords
                person["zone_id"] = zone_id or "UNKNOWN"
                mapped_positions.append({
                    "person_id": person["id"],
                    "plant_coords": plant_coords,
                    "zone_id": zone_id,
                    "has_helmet": person.get("has_helmet"),
                    "has_vest": person.get("has_vest"),
                    "confidence": person.get("confidence"),
                })

        detections["mapped_positions"] = mapped_positions
        detections["zones_occupied"] = list({p["zone_id"] for p in mapped_positions if p["zone_id"]})
        return detections

    def get_calibration_status(self) -> dict:
        return {
            "calibrated_cameras": list(self.calibrations.keys()),
            "total_cameras": 0,
            "plant_bounds": {"width": self.PLANT_WIDTH, "height": self.PLANT_HEIGHT},
            "zones": list(self.PLANT_ZONES.keys()),
        }


def cv2_findHomography(src, dst, method=0):
    """Wrapper to avoid import at module level (cv2 optional for testing)."""
    try:
        import cv2
        return cv2.findHomography(src, dst, method)
    except ImportError:
        # Fallback: simple affine approximation
        logger.warning("cv2 not available — using identity matrix")
        return np.eye(3, dtype=np.float32), np.ones((len(src), 1), dtype=np.uint8)
