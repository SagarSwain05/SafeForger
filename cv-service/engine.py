"""
SafeForge Vision Engine — ONNX Runtime inference for PPE compliance + fire/smoke.

This is the reference implementation of the vision pipeline. The browser edge
(frontend/src/lib/vision) mirrors the same steps so both edges emit identical
detection payloads:

  frame → letterbox 640 → YOLOv8 (PPE, 19 classes) ─┐
                        → YOLOv8 (fire/smoke)        ├→ NMS → associate PPE items
                                                     ┘   to workers → per-worker
                                                         compliance vs zone rules

Models and the PPE taxonomy are described in ../models/manifest.json.
No PyTorch / Ultralytics needed at runtime — only onnxruntime + numpy + OpenCV.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import cv2
import numpy as np

logger = logging.getLogger("engine")

DEFAULT_MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


# ── Geometry helpers ─────────────────────────────────────────────────────────

def letterbox(img: np.ndarray, size: int = 640):
    """Resize keeping aspect ratio and pad to size×size (Ultralytics convention, pad=114)."""
    h, w = img.shape[:2]
    scale = min(size / w, size / h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    pad_x, pad_y = (size - nw) / 2, (size - nh) / 2
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    out = np.full((size, size, 3), 114, dtype=np.uint8)
    left, top = int(round(pad_x - 0.1)), int(round(pad_y - 0.1))
    out[top:top + nh, left:left + nw] = resized
    return out, scale, left, top


def iou(a: Sequence[float], b: Sequence[float]) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def nms(boxes: List[dict], iou_thr: float) -> List[dict]:
    """Class-wise greedy NMS over dicts with 'bbox', 'confidence', 'label'."""
    keep: List[dict] = []
    for det in sorted(boxes, key=lambda d: d["confidence"], reverse=True):
        if all(k["label"] != det["label"] or iou(k["bbox"], det["bbox"]) < iou_thr for k in keep):
            keep.append(det)
    return keep


def decode_yolov8(output: np.ndarray, labels: List[str], thresholds: Dict[str, float],
                  default_thr: float, scale: float, pad_x: int, pad_y: int,
                  img_w: int, img_h: int, iou_thr: float) -> List[dict]:
    """Decode a (1, 4+nc, N) YOLOv8 head into boxes in original-image pixels."""
    pred = output[0]                       # (4+nc, N)
    scores = pred[4:]                      # (nc, N)
    cls_ids = scores.argmax(axis=0)
    confs = scores[cls_ids, np.arange(scores.shape[1])]
    min_thr = min([default_thr, *thresholds.values()]) if thresholds else default_thr
    idx = np.where(confs >= min_thr)[0]
    dets = []
    for i in idx:
        label = labels[int(cls_ids[i])]
        conf = float(confs[i])
        if conf < thresholds.get(label, default_thr):
            continue
        cx, cy, bw, bh = pred[:4, i]
        x1 = (cx - bw / 2 - pad_x) / scale
        y1 = (cy - bh / 2 - pad_y) / scale
        x2 = (cx + bw / 2 - pad_x) / scale
        y2 = (cy + bh / 2 - pad_y) / scale
        dets.append({
            "label": label,
            "confidence": round(conf, 3),
            "bbox": [int(max(0, x1)), int(max(0, y1)), int(min(img_w, x2)), int(min(img_h, y2))],
        })
    return nms(dets, iou_thr)


def flame_color_ratio(frame_bgr: np.ndarray, bbox: Sequence[int]) -> float:
    """
    Fraction of pixels in bbox matching a flame colour rule (R>190, G>100, B<140, R>G>B).
    Used to confirm low-confidence fire boxes — close-up flames often score low on
    scene-level fire models, while hi-vis vests never reach the low-confidence gate.
    """
    x1, y1, x2, y2 = [int(v) for v in bbox]
    roi = frame_bgr[max(0, y1):y2, max(0, x1):x2]
    if roi.size == 0:
        return 0.0
    step = max(1, int(max(roi.shape[:2]) / 96))
    roi = roi[::step, ::step].astype(np.int16)
    b, g, r = roi[..., 0], roi[..., 1], roi[..., 2]
    mask = (r > 190) & (g > 100) & (b < 140) & (r > g) & (g > b)
    return float(mask.mean())


# ── PPE association ──────────────────────────────────────────────────────────

def _containment(item: Sequence[float], person: Sequence[float], margin: float = 0.12) -> float:
    """Fraction of the item box that lies inside the (slightly expanded) person box."""
    pw, ph = person[2] - person[0], person[3] - person[1]
    ex = [person[0] - pw * margin, person[1] - ph * margin, person[2] + pw * margin, person[3] + ph * margin]
    ix1, iy1 = max(item[0], ex[0]), max(item[1], ex[1])
    ix2, iy2 = min(item[2], ex[2]), min(item[3], ex[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    area = max(1.0, (item[2] - item[0]) * (item[3] - item[1]))
    return inter / area


def associate_ppe(detections: List[dict], manifest: dict, required: Sequence[str]) -> List[dict]:
    """
    Build per-worker PPE status from flat PPE detections.

    Each worker gets ppe[item] ∈ {"ok", "missing", "unknown"}. A worker is a
    violator only when a *required* item is explicitly detected as missing
    (e.g. "No-Helmet") — absence of evidence is reported as "unknown", which
    keeps false alarms down on partially occluded workers.
    """
    items = manifest["ppe_items"]
    present_to_item = {v["present"]: k for k, v in items.items()}
    absent_to_item = {v["absent"]: k for k, v in items.items()}
    person_label = manifest.get("person_label", "Worker")

    workers = [d for d in detections if d["label"] == person_label]
    ppe_dets = [d for d in detections if d["label"] in present_to_item or d["label"] in absent_to_item]

    people = [{
        "id": f"W{i + 1:02d}",
        "bbox": w["bbox"],
        "confidence": w["confidence"],
        "ppe": {k: "unknown" for k in items},
        "_scores": {},
    } for i, w in enumerate(workers)]

    for det in ppe_dets:
        best, best_score = None, 0.5
        for p in people:
            c = _containment(det["bbox"], p["bbox"])
            if c > best_score:
                best, best_score = p, c
        if best is None:
            # Violation seen without a matching person box (e.g. a bare head):
            # synthesise a worker around it so the violation is not lost.
            if det["label"] not in absent_to_item:
                continue
            x1, y1, x2, y2 = det["bbox"]
            w, h = x2 - x1, y2 - y1
            best = {
                "id": f"W{len(people) + 1:02d}",
                "bbox": [int(x1 - w * 0.6), int(y1 - h * 0.2), int(x2 + w * 0.6), int(y2 + h * 3.5)],
                "confidence": det["confidence"],
                "ppe": {k: "unknown" for k in items},
                "_scores": {},
                "inferred": True,
            }
            people.append(best)
        is_absent = det["label"] in absent_to_item
        item = absent_to_item[det["label"]] if is_absent else present_to_item[det["label"]]
        prev = best["_scores"].get(item, 0.0)
        if det["confidence"] >= prev:          # strongest evidence wins
            best["ppe"][item] = "missing" if is_absent else "ok"
            best["_scores"][item] = det["confidence"]

    for p in people:
        p.pop("_scores", None)
        p["missing"] = [k for k in required if p["ppe"].get(k) == "missing"]
        p["compliant"] = len(p["missing"]) == 0
    return people


# ── Engine ───────────────────────────────────────────────────────────────────

class VisionEngine:
    """Runs both ONNX models on a BGR frame and returns the SafeForge detection payload."""

    def __init__(self, models_dir: Optional[str] = None, providers: Optional[List[str]] = None):
        import onnxruntime as ort

        self.models_dir = Path(models_dir) if models_dir else DEFAULT_MODELS_DIR
        self.manifest = json.loads((self.models_dir / "manifest.json").read_text())
        self.size = int(self.manifest.get("input_size", 640))
        self.thr = self.manifest["thresholds"]
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        providers = providers or ["CPUExecutionProvider"]
        self.sessions = {}
        for key, spec in self.manifest["models"].items():
            path = self.models_dir / spec["file"]
            if not path.exists():
                raise FileNotFoundError(f"Model file missing: {path}")
            self.sessions[key] = ort.InferenceSession(str(path), sess_options=opts, providers=providers)
            logger.info("Loaded %s model (%s, %d labels)", key, spec["arch"], len(spec["labels"]))

        items = self.manifest["ppe_items"]
        self.ppe_thresholds = {self.manifest["person_label"]: self.thr["worker"]}
        for v in items.values():
            self.ppe_thresholds[v["present"]] = self.thr["ppe"]
            self.ppe_thresholds[v["absent"]] = self.thr["violation"]
        for label in self.manifest.get("context_labels", []):
            self.ppe_thresholds[label] = self.thr["context"]
        # Fire boxes are decoded down to fire_low, then gated in _verify_fire.
        self.fire_thresholds = {"fire": self.thr.get("fire_low", self.thr["fire"]), "smoke": self.thr["smoke"]}

    def _verify_fire(self, frame_bgr: np.ndarray, hazards: List[dict], ppe: List[dict]) -> List[dict]:
        # Hi-vis vests are fire-coloured; a "fire" box mostly inside a detected vest is a false positive.
        vests = [d["bbox"] for d in ppe if d["label"] == self.manifest["ppe_items"]["vest"]["present"]]
        out = []
        for d in hazards:
            if d["label"] == "fire" and any(_containment(d["bbox"], v, margin=0.05) > 0.4 for v in vests):
                continue
            if d["label"] == "fire" and d["confidence"] < self.thr["fire"]:
                ratio = flame_color_ratio(frame_bgr, d["bbox"])
                if ratio < self.thr.get("fire_color_ratio", 0.25):
                    continue
                d = {**d, "verified_by": "flame_color", "color_ratio": round(ratio, 3)}
            out.append(d)
        return out

    def _run(self, key: str, blob: np.ndarray) -> np.ndarray:
        sess = self.sessions[key]
        return sess.run(None, {sess.get_inputs()[0].name: blob})[0]

    def detect(self, frame_bgr: np.ndarray, required_ppe: Optional[Sequence[str]] = None) -> dict:
        t0 = time.perf_counter()
        h, w = frame_bgr.shape[:2]
        boxed, scale, px, py = letterbox(frame_bgr, self.size)
        blob = cv2.cvtColor(boxed, cv2.COLOR_BGR2RGB).transpose(2, 0, 1)[None].astype(np.float32) / 255.0

        ppe_raw = decode_yolov8(self._run("ppe", blob), self.manifest["models"]["ppe"]["labels"],
                                self.ppe_thresholds, self.thr["ppe"], scale, px, py, w, h, self.thr["iou"])
        hazard_raw = decode_yolov8(self._run("fire", blob), self.manifest["models"]["fire"]["labels"],
                                   self.fire_thresholds, self.thr["fire"], scale, px, py, w, h, self.thr["iou"])
        hazard_raw = self._verify_fire(frame_bgr, hazard_raw, ppe_raw)

        required = list(required_ppe or self.manifest.get("default_required_ppe", ["helmet", "vest"]))
        workers = associate_ppe(ppe_raw, self.manifest, required)
        context = [d for d in ppe_raw if d["label"] in self.manifest.get("context_labels", [])]
        fire = [d for d in hazard_raw if d["label"] == "fire"]
        smoke = [d for d in hazard_raw if d["label"] == "smoke"]
        violators = [p for p in workers if not p["compliant"]]

        return {
            "frame": {"w": w, "h": h},
            "inference_ms": round((time.perf_counter() - t0) * 1000, 1),
            "required_ppe": required,
            "workers": workers,
            "hazards": [{"type": d["label"], "bbox": d["bbox"], "confidence": d["confidence"]} for d in hazard_raw],
            "context": [{"type": d["label"], "bbox": d["bbox"], "confidence": d["confidence"]} for d in context],
            "worker_count": len(workers),
            "compliant_workers": len(workers) - len(violators),
            "ppe_violations": len(violators),
            "fire_detected": bool(fire),
            "smoke_detected": bool(smoke),
            "fire_confidence": max([d["confidence"] for d in fire], default=0.0),
            "smoke_confidence": max([d["confidence"] for d in smoke], default=0.0),
        }


# ── Temporal confirmation ───────────────────────────────────────────────────

class TemporalConfirmer:
    """
    k-of-n debounce per event type so a single noisy frame never raises an alarm.
    Mirrors frontend/src/lib/vision/temporal.ts.
    """

    def __init__(self, temporal_cfg: dict):
        self.window = int(temporal_cfg.get("window", 5))
        self.need = {"FIRE": temporal_cfg.get("fire", 2), "SMOKE": temporal_cfg.get("smoke", 3),
                     "PPE_VIOLATION": temporal_cfg.get("ppe", 3)}
        self.hist = {k: [] for k in self.need}

    def update(self, result: dict, single_frame: bool = False) -> List[dict]:
        flags = {
            "FIRE": (result["fire_detected"], result["fire_confidence"]),
            "SMOKE": (result["smoke_detected"], result["smoke_confidence"]),
            "PPE_VIOLATION": (result["ppe_violations"] > 0,
                              max([p["confidence"] for p in result["workers"] if not p["compliant"]], default=0.0)),
        }
        events = []
        for kind, (hit, conf) in flags.items():
            h = self.hist[kind]
            h.append(bool(hit))
            del h[:-self.window]
            confirmed = hit and (single_frame or sum(h) >= self.need[kind])
            if confirmed:
                ev = {"type": kind, "confidence": round(float(conf), 3)}
                if kind == "PPE_VIOLATION":
                    missing = sorted({m for p in result["workers"] for m in p["missing"]})
                    ev["missing"] = missing
                    ev["count"] = result["ppe_violations"]
                events.append(ev)
        return events


# ── Annotation ───────────────────────────────────────────────────────────────

def annotate(frame: np.ndarray, result: dict, manifest: dict) -> np.ndarray:
    out = frame.copy()
    labels = {k: v["label"] for k, v in manifest["ppe_items"].items()}
    for p in result["workers"]:
        x1, y1, x2, y2 = p["bbox"]
        color = (60, 200, 80) if p["compliant"] else (40, 40, 230)
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
        tags = [("+" if s == "ok" else "-") + labels[k] for k, s in p["ppe"].items() if s != "unknown"]
        text = f"{p['id']} " + (" ".join(tags) if tags else "worker")
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
        cv2.rectangle(out, (x1, max(0, y1 - th - 6)), (x1 + tw + 4, y1), color, -1)
        cv2.putText(out, text, (x1 + 2, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
    for hz in result["hazards"]:
        x1, y1, x2, y2 = hz["bbox"]
        color = (0, 80, 255) if hz["type"] == "fire" else (160, 160, 160)
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
        cv2.putText(out, f"{hz['type'].upper()} {hz['confidence']:.2f}", (x1 + 2, y1 + 16),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2, cv2.LINE_AA)
    return out
