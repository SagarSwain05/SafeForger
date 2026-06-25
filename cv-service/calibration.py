"""
SafeForger Camera Calibration Tool
===================================
Interactive tool to generate homography matrices by clicking corresponding
point pairs between the camera view and the plant layout diagram.

Usage:
  python calibration.py --camera CAM-01 --source 0

Instructions:
  1. Left window: Live camera feed. Click 4+ known points (e.g., corners of a machine, floor markings).
  2. Right window: Plant layout diagram. Click the same points in plant coordinates.
  3. Press 'C' to compute and save the homography matrix.
  4. Press 'R' to reset and re-pick points.
  5. Press 'Q' to quit.

The computed matrix is saved to config.json under homography.camera_calibrations.
"""
import cv2
import json
import numpy as np
import logging
import argparse
from pathlib import Path

logger = logging.getLogger("calibration")
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

# Plant layout preview image dimensions
LAYOUT_W, LAYOUT_H = 1180, 640

POINT_COLORS = [
    (0, 255, 100), (0, 100, 255), (255, 100, 0), (255, 0, 200),
    (0, 220, 220), (200, 200, 0), (255, 128, 0), (128, 0, 255),
]


def draw_plant_layout(width=LAYOUT_W, height=LAYOUT_H) -> np.ndarray:
    """Generate a simple plant layout image as calibration reference."""
    img = np.zeros((height, width, 3), dtype=np.uint8)
    img[:] = (8, 15, 32)

    zones = [
        ("Z-01", 280, 130, 150, 160, "CDU", (60, 20, 20)),
        ("Z-02", 460, 130, 120, 160, "HCU", (30, 40, 60)),
        ("Z-03", 610, 110, 170, 180, "Tank Farm", (20, 50, 30)),
        ("Z-04", 810, 130, 110, 150, "Utility", (30, 30, 50)),
        ("Z-05", 950, 110, 130, 160, "Control", (20, 40, 50)),
        ("Z-06", 280, 285, 110, 125, "Flare", (50, 20, 20)),
        ("Z-07", 420, 290, 140, 125, "Pumps", (30, 20, 50)),
        ("Z-08", 590, 290, 140, 125, "HX Bay", (20, 40, 40)),
        ("Z-09", 765, 290, 140, 125, "Compressor", (30, 40, 20)),
        ("Z-10", 940, 285, 150, 130, "Maintenance", (35, 35, 20)),
        ("Z-11", 280, 420, 130, 120, "CS-01", (50, 30, 10)),
        ("Z-12", 440, 420, 130, 120, "CS-02", (50, 30, 10)),
        ("Z-13", 600, 430, 135, 110, "Loading", (20, 35, 40)),
        ("Z-14", 765, 425, 140, 115, "Cooling", (20, 30, 50)),
        ("Z-15", 930, 415, 145, 125, "Assembly", (20, 50, 20)),
    ]
    for zone_id, x, y, w, h, label, color in zones:
        cv2.rectangle(img, (x, y), (x+w, y+h), color, -1)
        cv2.rectangle(img, (x, y), (x+w, y+h), (100, 140, 200), 1)
        cv2.putText(img, zone_id, (x+5, y+16), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 210, 255), 1)
        cv2.putText(img, label, (x+5, y+30), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (130, 140, 160), 1)

    # Grid lines
    for gx in range(0, width, 60):
        cv2.line(img, (gx, 0), (gx, height), (15, 25, 45), 1)
    for gy in range(0, height, 60):
        cv2.line(img, (0, gy), (width, gy), (15, 25, 45), 1)

    cv2.putText(img, "SafeForger Plant Layout — Click calibration points here", (20, height-15),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (100, 140, 200), 1)
    return img


class CalibrationTool:
    def __init__(self, camera_id: str, config_path: str, source):
        self.camera_id = camera_id
        self.config_path = config_path
        self.source = source
        self.src_points = []   # Camera pixel points
        self.dst_points = []   # Plant layout points
        self.H = None
        self.layout_img = draw_plant_layout()
        self.cap = None

    def _camera_click(self, event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN and len(self.src_points) < 8:
            if len(self.src_points) == len(self.dst_points):
                self.src_points.append([x, y])
                n = len(self.src_points)
                color = POINT_COLORS[(n-1) % len(POINT_COLORS)]
                logger.info(f"Camera point {n}: ({x}, {y}). Now click matching point on plant layout.")

    def _layout_click(self, event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN and len(self.dst_points) < len(self.src_points):
            self.dst_points.append([x, y])
            n = len(self.dst_points)
            color = POINT_COLORS[(n-1) % len(POINT_COLORS)]
            logger.info(f"Layout point {n}: ({x}, {y}). {max(0, 4-n)} more pairs needed for minimum calibration.")

    def _draw_points(self, img, points, point_type="src") -> np.ndarray:
        out = img.copy()
        for i, (x, y) in enumerate(points):
            color = POINT_COLORS[i % len(POINT_COLORS)]
            cv2.circle(out, (int(x), int(y)), 8, color, -1)
            cv2.circle(out, (int(x), int(y)), 10, (255, 255, 255), 1)
            cv2.putText(out, str(i+1), (int(x)+12, int(y)+5),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
        # Instructions
        total = len(self.src_points)
        matched = len(self.dst_points)
        msg = f"Points: {total} src / {matched} dst | Need 4+ pairs | C=Compute R=Reset Q=Quit"
        cv2.putText(out, msg, (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 220, 255), 1)
        return out

    def compute_homography(self) -> bool:
        if len(self.src_points) < 4 or len(self.dst_points) < 4:
            logger.warning(f"Need at least 4 point pairs. Have {min(len(self.src_points), len(self.dst_points))}.")
            return False
        n = min(len(self.src_points), len(self.dst_points))
        src = np.float32(self.src_points[:n])
        dst = np.float32(self.dst_points[:n])
        self.H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
        if self.H is None:
            logger.error("Homography computation failed — check point pairs")
            return False
        inliers = mask.ravel().sum()
        logger.info(f"Homography computed! Inliers: {inliers}/{n}")
        self._save_to_config()
        return True

    def _save_to_config(self):
        """Persist H matrix to config.json."""
        with open(self.config_path, "r") as f:
            cfg = json.load(f)
        cfg.setdefault("homography", {}).setdefault("camera_calibrations", {})[self.camera_id] = {
            "matrix": self.H.tolist(),
            "src_points": self.src_points,
            "dst_points": self.dst_points,
            "calibrated_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ", __import__("time").gmtime()),
        }
        with open(self.config_path, "w") as f:
            json.dump(cfg, f, indent=2)
        logger.info(f"Homography saved to {self.config_path} for camera {self.camera_id}")

    def run(self):
        cam_win = f"Camera View — {self.camera_id} (click points)"
        layout_win = "Plant Layout (click matching points)"

        cv2.namedWindow(cam_win, cv2.WINDOW_NORMAL)
        cv2.namedWindow(layout_win, cv2.WINDOW_NORMAL)
        cv2.setMouseCallback(cam_win, self._camera_click)
        cv2.setMouseCallback(layout_win, self._layout_click)
        cv2.resizeWindow(layout_win, LAYOUT_W // 2, LAYOUT_H // 2)

        source = int(self.source) if str(self.source).isdigit() else self.source
        self.cap = cv2.VideoCapture(source)

        logger.info(f"\n{'='*60}")
        logger.info("CALIBRATION MODE")
        logger.info("1. Click a known point in the CAMERA VIEW window")
        logger.info("2. Click the same point in the PLANT LAYOUT window")
        logger.info("3. Repeat for at least 4 point pairs")
        logger.info("4. Press 'C' to compute and save homography")
        logger.info(f"{'='*60}\n")

        while True:
            ret, frame = self.cap.read()
            if not ret:
                frame = np.zeros((480, 640, 3), dtype=np.uint8)
                cv2.putText(frame, "No camera feed", (180, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (100, 100, 100), 2)

            cam_display = self._draw_points(frame, self.src_points, "src")
            layout_display = self._draw_points(self.layout_img, self.dst_points, "dst")

            # Show reprojection if H computed
            if self.H is not None and len(self.src_points) >= 4:
                for i, pt in enumerate(self.src_points[:len(self.dst_points)]):
                    projected = cv2.perspectiveTransform(
                        np.array([[[pt[0], pt[1]]]], dtype=np.float32), self.H
                    )[0][0]
                    cv2.circle(layout_display, (int(projected[0]), int(projected[1])), 5, (0, 255, 255), 2)

            cv2.imshow(cam_win, cam_display)
            cv2.imshow(layout_win, layout_display)

            key = cv2.waitKey(30) & 0xFF
            if key == ord('q'):
                break
            elif key == ord('c') or key == ord('C'):
                if self.compute_homography():
                    logger.info("✓ Homography saved! Press Q to exit.")
            elif key == ord('r') or key == ord('R'):
                self.src_points = []
                self.dst_points = []
                self.H = None
                logger.info("Points reset. Start calibration over.")

        if self.cap:
            self.cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SafeForger Camera Calibration Tool")
    parser.add_argument("--camera", type=str, default="CAM-01")
    parser.add_argument("--source", default=0)
    parser.add_argument("--config", type=str, default="config.json")
    args = parser.parse_args()
    tool = CalibrationTool(args.camera, args.config, args.source)
    tool.run()
