"""
Detection publisher — sends vision results from the edge to the SafeForge backend.

HTTP (default) works through any reverse proxy / PaaS (e.g. the Render deployment);
MQTT (plant/{zone}/vision) is used on-premise when the embedded broker is reachable.
Both carry the same payload as the browser edge (frontend/src/lib/vision/payload.ts).
"""
import base64
import logging
import threading
import time
from queue import Empty, Queue
from typing import List, Optional

import cv2
import numpy as np

logger = logging.getLogger("publisher")


def encode_evidence(frame: np.ndarray, max_side: int = 640, quality: int = 70) -> str:
    """JPEG data-URL thumbnail attached to confirmed events as visual evidence."""
    h, w = frame.shape[:2]
    s = min(1.0, max_side / max(h, w))
    if s < 1.0:
        frame = cv2.resize(frame, (int(w * s), int(h * s)))
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode() if ok else ""


def build_payload(camera_id: str, zone: str, result: dict, events: List[dict],
                  source: str = "edge-python", evidence: Optional[str] = None, fps: float = 0.0) -> dict:
    return {
        "camera_id": camera_id,
        "zone": zone,
        "source": source,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "fps": round(fps, 1),
        "inference_ms": result.get("inference_ms"),
        "frame": result.get("frame"),
        "required_ppe": result.get("required_ppe"),
        "worker_count": result.get("worker_count", 0),
        "compliant_workers": result.get("compliant_workers", 0),
        "ppe_violations": result.get("ppe_violations", 0),
        "fire_detected": result.get("fire_detected", False),
        "smoke_detected": result.get("smoke_detected", False),
        "fire_confidence": result.get("fire_confidence", 0.0),
        "smoke_confidence": result.get("smoke_confidence", 0.0),
        "workers": result.get("workers", []),
        "hazards": result.get("hazards", []),
        "context": result.get("context", []),
        "zones_occupied": result.get("zones_occupied", []),
        "events": events,
        "evidence": evidence,
    }


class HttpPublisher:
    """Non-blocking HTTP publisher: a background thread drains a small queue so inference never waits on the network."""

    def __init__(self, backend_url: str, api_key: Optional[str] = None, timeout: float = 8.0):
        import requests
        self.session = requests.Session()
        self.url = backend_url.rstrip("/") + "/api/vision/detections"
        self.headers = {"Content-Type": "application/json"}
        if api_key:
            self.headers["X-API-Key"] = api_key
        self.timeout = timeout
        self.queue: Queue = Queue(maxsize=8)
        self.sent = 0
        self.failed = 0
        threading.Thread(target=self._worker, daemon=True).start()

    def publish(self, payload: dict):
        if self.queue.full():
            try:
                self.queue.get_nowait()  # drop the oldest — fresh data matters more
            except Empty:
                pass
        self.queue.put_nowait(payload)

    def _worker(self):
        while True:
            payload = self.queue.get()
            for attempt in range(3):
                try:
                    r = self.session.post(self.url, json=payload, headers=self.headers, timeout=self.timeout)
                    if r.status_code < 500:
                        if r.status_code >= 400:
                            logger.warning("Backend rejected payload (%s): %s", r.status_code, r.text[:200])
                        self.sent += 1
                        break
                except Exception as e:  # network errors, cold-starting PaaS, etc.
                    logger.debug("Publish attempt %d failed: %s", attempt + 1, e)
                time.sleep(1.5 * (attempt + 1))
            else:
                self.failed += 1
                logger.warning("Dropped detection after 3 attempts (backend unreachable: %s)", self.url)
