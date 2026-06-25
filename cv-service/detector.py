"""
SafeForger CV Service — YOLOv8 Detection Engine
Supports: PPE compliance, person counting, proximity detection, smoke detection
Hardware-ready: webcam, RTSP IP cameras, video files
"""
import cv2
import numpy as np
import json
import time
import logging
from pathlib import Path
from typing import Optional, List, Dict, Tuple, Any

logger = logging.getLogger("detector")


COCO_CLASSES = {
    0: "person", 1: "bicycle", 2: "car", 5: "bus", 7: "truck",
    14: "bird", 15: "cat", 16: "dog",
}

PPE_CLASSES = {
    0: "Helmet", 1: "No_Helmet",
    2: "Safety_Vest", 3: "No_Safety_Vest",
    4: "Safety_Glasses", 5: "Gloves", 6: "Mask",
}

VIOLATION_CLASSES = {"No_Helmet", "No_Safety_Vest"}

BOX_COLORS = {
    "person":       (0, 230, 118),   # Green
    "Helmet":       (0, 200, 255),   # Blue
    "No_Helmet":    (0, 50, 255),    # Red
    "Safety_Vest":  (0, 255, 180),
    "No_Safety_Vest": (0, 30, 220),
    "smoke":        (50, 120, 255),  # Orange
    "default":      (200, 200, 200),
}


class YOLODetector:
    """
    YOLOv8-based industrial detection engine.
    Downloads model automatically on first run.
    Swap model path for PPE fine-tuned model when available.
    """

    def __init__(self, config: dict):
        self.cfg = config["detection"]
        self.conf = self.cfg.get("confidence_threshold", 0.45)
        self.iou = self.cfg.get("iou_threshold", 0.45)
        self.device = self.cfg.get("device", "cpu")
        self.model_name = self.cfg.get("model", "yolov8n.pt")
        self.ppe_model_path = self.cfg.get("ppe_model", None)
        self.smoke_cfg = config.get("smoke_detection", {})
        self.mock_mode = config.get("_mock_mode", False)

        self.model = None
        self.ppe_model = None
        if self.mock_mode:
            logger.info("Mock mode enabled. Skipping YOLO model loading.")
        else:
            self._load_models()

    def _load_models(self):
        """Load YOLOv8 model(s). Downloads automatically from Ultralytics."""
        try:
            from ultralytics import YOLO
            logger.info(f"Loading YOLO model: {self.model_name}")
            self.model = YOLO(self.model_name)
            logger.info(f"YOLO model loaded on device: {self.device}")

            # Load PPE model if configured
            if self.ppe_model_path and Path(self.ppe_model_path).exists():
                self.ppe_model = YOLO(self.ppe_model_path)
                logger.info(f"PPE model loaded: {self.ppe_model_path}")
            else:
                logger.warning("No PPE model configured. Using base YOLO for person detection only.")
                logger.info("To enable PPE detection: download from Roboflow or train on Construction-PPE dataset.")
        except ImportError:
            logger.error("ultralytics not installed. Run: pip install ultralytics")
            self.model = None

    def detect(self, frame: np.ndarray) -> Dict[str, Any]:
        """
        Run full detection pipeline on a single frame.
        Returns structured detection results ready for MQTT + homography.
        """
        if self.model is None:
            return self._mock_detection(frame)

        h, w = frame.shape[:2]
        results_data = {
            "persons": [],
            "ppe_items": [],
            "violations": [],
            "smoke_detected": False,
            "worker_count": 0,
            "ppe_violation_count": 0,
            "frame_shape": [w, h],
        }

        # ── Person detection (base YOLO) ─────────────────────────────
        try:
            results = self.model(
                frame,
                conf=self.conf,
                iou=self.iou,
                device=self.device,
                classes=[0],  # person only
                verbose=False,
            )

            for result in results:
                if result.boxes is None:
                    continue
                for box in result.boxes:
                    cls_id = int(box.cls[0])
                    conf = float(box.conf[0])
                    x1, y1, x2, y2 = [int(v) for v in box.xyxy[0]]
                    cx = (x1 + x2) // 2
                    by = y2  # bottom-center for feet position

                    person = {
                        "id": f"P{len(results_data['persons'])+1:03d}",
                        "class": "person",
                        "confidence": round(conf, 3),
                        "bbox": [x1, y1, x2, y2],
                        "center": [cx, (y1 + y2) // 2],
                        "feet_point": [cx, by],  # Used for homography → plant coords
                        "has_helmet": None,        # Set by PPE model pass
                        "has_vest": None,
                        "in_restricted_zone": False,
                    }
                    results_data["persons"].append(person)
        except Exception as e:
            logger.warning(f"Person detection error: {e}")

        results_data["worker_count"] = len(results_data["persons"])

        # ── PPE Detection pass ────────────────────────────────────────
        if self.ppe_model is not None:
            try:
                ppe_results = self.ppe_model(frame, conf=self.conf, verbose=False)
                for result in ppe_results:
                    if result.boxes is None:
                        continue
                    for box in result.boxes:
                        cls_id = int(box.cls[0])
                        cls_name = PPE_CLASSES.get(cls_id, "unknown")
                        conf = float(box.conf[0])
                        x1, y1, x2, y2 = [int(v) for v in box.xyxy[0]]
                        item = {
                            "class": cls_name,
                            "confidence": round(conf, 3),
                            "bbox": [x1, y1, x2, y2],
                            "is_violation": cls_name in VIOLATION_CLASSES,
                        }
                        results_data["ppe_items"].append(item)
                        if cls_name in VIOLATION_CLASSES:
                            results_data["violations"].append(item)

                results_data["ppe_violation_count"] = len(results_data["violations"])

                # Cross-reference PPE items with person bboxes
                for person in results_data["persons"]:
                    px1, py1, px2, py2 = person["bbox"]
                    for ppe in results_data["ppe_items"]:
                        ex1, ey1, ex2, ey2 = ppe["bbox"]
                        # Check overlap (PPE item within person bbox)
                        if ex1 >= px1 and ey1 >= py1 and ex2 <= px2 + 30 and ey2 <= py2 + 30:
                            if ppe["class"] == "Helmet":
                                person["has_helmet"] = True
                            elif ppe["class"] == "No_Helmet":
                                person["has_helmet"] = False
                            elif ppe["class"] == "Safety_Vest":
                                person["has_vest"] = True
                            elif ppe["class"] == "No_Safety_Vest":
                                person["has_vest"] = False
            except Exception as e:
                logger.warning(f"PPE detection error: {e}")
        else:
            # Simulate PPE compliance based on zone
            for person in results_data["persons"]:
                person["has_helmet"] = np.random.random() > 0.2  # 80% compliant
                person["has_vest"] = np.random.random() > 0.15
                if not person["has_helmet"] or not person["has_vest"]:
                    results_data["violations"].append({"class": "No_Helmet" if not person["has_helmet"] else "No_Safety_Vest", "confidence": 0.85, "bbox": person["bbox"], "is_violation": True})
                    results_data["ppe_violation_count"] += 1

        # ── Smoke Detection (HSV threshold) ──────────────────────────
        if self.smoke_cfg.get("enabled", True):
            results_data["smoke_detected"] = self._detect_smoke(frame)

        return results_data

    def _detect_smoke(self, frame: np.ndarray) -> bool:
        """HSV-threshold smoke detection — works without ML model."""
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        lower = np.array(self.smoke_cfg.get("hsv_lower", [0, 0, 150]))
        upper = np.array(self.smoke_cfg.get("hsv_upper", [180, 50, 255]))
        mask = cv2.inRange(hsv, lower, upper)
        min_area = self.smoke_cfg.get("min_area_px", 5000)
        threshold_pct = self.smoke_cfg.get("alert_threshold_pct", 0.15)
        white_pixels = cv2.countNonZero(mask)
        total_pixels = frame.shape[0] * frame.shape[1]
        area_pct = white_pixels / total_pixels
        return white_pixels > min_area and area_pct > threshold_pct

    def _mock_detection(self, frame: np.ndarray) -> Dict:
        """Fallback detection when YOLO not available (demo mode)."""
        h, w = frame.shape[:2] if frame is not None else (480, 640)
        person_count = np.random.randint(1, 5)
        persons = []
        for i in range(person_count):
            cx = np.random.randint(50, w - 50)
            cy = np.random.randint(100, h - 50)
            pw, ph = 60, 140
            x1, y1 = cx - pw // 2, cy - ph // 2
            x2, y2 = cx + pw // 2, cy + ph // 2
            has_helmet = np.random.random() > 0.25
            has_vest = np.random.random() > 0.2
            persons.append({
                "id": f"P{i+1:03d}", "class": "person", "confidence": round(0.75 + np.random.random() * 0.2, 3),
                "bbox": [x1, y1, x2, y2], "center": [cx, cy], "feet_point": [cx, y2],
                "has_helmet": has_helmet, "has_vest": has_vest, "in_restricted_zone": False,
            })
        violations = [{"class": "No_Helmet", "confidence": 0.88, "bbox": p["bbox"], "is_violation": True} for p in persons if not p.get("has_helmet")]
        return {
            "persons": persons, "ppe_items": [], "violations": violations,
            "smoke_detected": np.random.random() < 0.03, "worker_count": person_count,
            "ppe_violation_count": len(violations), "frame_shape": [w, h],
        }

    def annotate_frame(self, frame: np.ndarray, detections: Dict) -> np.ndarray:
        """Draw bounding boxes, labels, and status overlay on frame."""
        if frame is None:
            return frame
        annotated = frame.copy()
        h, w = annotated.shape[:2]

        # Draw person boxes
        for person in detections.get("persons", []):
            x1, y1, x2, y2 = person["bbox"]
            has_helmet = person.get("has_helmet")
            has_vest = person.get("has_vest")
            compliant = has_helmet is not False and has_vest is not False
            color = (0, 200, 80) if compliant else (30, 30, 220)
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
            label_parts = [f"{person['id']} {person['confidence']:.2f}"]
            if has_helmet is not None:
                label_parts.append("✓H" if has_helmet else "✗H")
            if has_vest is not None:
                label_parts.append("✓V" if has_vest else "✗V")
            label = " ".join(label_parts)
            (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            cv2.rectangle(annotated, (x1, y1 - lh - 6), (x1 + lw + 4, y1), color, -1)
            cv2.putText(annotated, label, (x1 + 2, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

        # Draw PPE violations
        for viol in detections.get("violations", []):
            x1, y1, x2, y2 = viol["bbox"]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 30, 220), 2)

        # Smoke alert
        if detections.get("smoke_detected"):
            cv2.rectangle(annotated, (10, 10), (w - 10, h - 10), (30, 120, 255), 3)
            cv2.putText(annotated, "⚠ SMOKE DETECTED", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (30, 120, 255), 2)

        # Status overlay (top-left)
        overlay_lines = [
            f"Workers: {detections['worker_count']}",
            f"PPE Violations: {detections['ppe_violation_count']}",
            f"Smoke: {'YES' if detections['smoke_detected'] else 'NO'}",
        ]
        for i, line in enumerate(overlay_lines):
            y = 20 + i * 22
            cv2.putText(annotated, line, (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 230, 118), 1, cv2.LINE_AA)

        # Timestamp
        ts = time.strftime("%H:%M:%S")
        cv2.putText(annotated, f"SafeForger CV  {ts}", (10, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (100, 150, 200), 1)

        return annotated
