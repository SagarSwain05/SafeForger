"""
SafeForge Vision API — HTTP inference for images (and single video frames).

  uvicorn server:app --host 0.0.0.0 --port 8000

  GET  /health          service + model status
  GET  /manifest        model / PPE taxonomy manifest
  POST /detect          multipart 'file' (+ camera_id, zone, annotate, forward)
                        → SafeForge detection payload (+ annotated JPEG data URL)

If SAFEFORGE_BACKEND_URL is set and forward=true, the payload is also pushed to
the backend so alerts, the heatmap and the risk engine pick it up.
"""
import os
import time
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from engine import VisionEngine, annotate
from homography import HomographyEngine, load_layout
from publisher import HttpPublisher, build_payload, encode_evidence

app = FastAPI(title="SafeForge Vision API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

engine = VisionEngine(os.environ.get("SAFEFORGE_MODELS_DIR"))
layout = load_layout(os.environ.get("SAFEFORGE_LAYOUT"))
homography = HomographyEngine({}, layout)
backend = os.environ.get("SAFEFORGE_BACKEND_URL")
publisher = HttpPublisher(backend, os.environ.get("SAFEFORGE_API_KEY"), site=os.environ.get("SAFEFORGE_SITE", "demo-refinery")) if backend else None
STARTED = time.time()
MAX_BYTES = 12 * 1024 * 1024


@app.get("/health")
def health():
    return {"status": "ok", "uptime_s": round(time.time() - STARTED), "models": list(engine.sessions),
            "backend_forwarding": bool(publisher)}


@app.get("/manifest")
def manifest():
    return engine.manifest


@app.post("/detect")
async def detect(file: UploadFile = File(...), camera_id: str = Form("CAM-UPLOAD"), zone: Optional[str] = Form(None),
                 annotate_image: bool = Form(True, alias="annotate"), forward: bool = Form(False)):
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Image larger than 12 MB")
    frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(400, "Could not decode image")

    cam = next((c for c in layout.get("cameras", []) if c["id"] == camera_id), {})
    zone_id = zone or cam.get("zone") or "Z-01"
    zone_meta = next((z for z in layout["zones"] if z["id"] == zone_id), {})
    result = engine.detect(frame, zone_meta.get("requiredPPE"))
    homography.map_workers(camera_id, result, zone_id)

    # A single uploaded image is its own confirmation window
    events = []
    if result["fire_detected"]:
        events.append({"type": "FIRE", "confidence": result["fire_confidence"]})
    if result["smoke_detected"]:
        events.append({"type": "SMOKE", "confidence": result["smoke_confidence"]})
    if result["ppe_violations"]:
        events.append({"type": "PPE_VIOLATION", "count": result["ppe_violations"],
                       "missing": sorted({m for w in result["workers"] for m in w["missing"]}),
                       "confidence": max(w["confidence"] for w in result["workers"] if not w["compliant"])})

    annotated = annotate(frame, result, engine.manifest) if (annotate_image or events) else None
    evidence = encode_evidence(annotated) if annotated is not None else None
    payload = build_payload(camera_id, zone_id, result, events, source="vision-api", evidence=evidence if events else None)
    if forward and publisher:
        publisher.publish(payload)
    return {**payload, "annotated_image": evidence if annotate_image else None}
