# SafeForge Nexus

**Real-time AI safety for factories.** SafeForge watches CCTV for missing PPE (helmet, hi-vis vest, safety footwear, gloves), smoke and fire. It fuses what it sees with gas sensors, SCADA, permits-to-work and worker locations. The right people get an alert with the **location, evidence frame, regulation breached and recommended action**, often before any single alarm would sound.

| | |
|---|---|
| **Live dashboard** | see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the current URLs |
| **Architecture** | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| **5-minute demo script** | [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) |

---

## What it does (hackathon goals → features)

| Goal | How SafeForge delivers it |
|---|---|
| Detect **safety-gear compliance** | YOLOv8s PPE model (19 classes: hard hat, vest, boots, gloves, goggles, mask, ear protection *and their absence*). Items are matched to each worker. A worker is flagged only when a gear item **required in that zone** is detected as missing. Requirements are zone-specific and grow with active permits (e.g. hot work adds gloves and eye protection). |
| Detect **smoke** and **fire** | YOLOv8n fire/smoke model (D-Fire). Weak fire boxes are confirmed by a flame-colour check, and boxes inside a detected hi-vis vest are rejected, since vests are fire-coloured. |
| **Real time** from CCTV / recorded footage | Runs **in the browser** (ONNX Runtime Web, WebGPU or WASM) on webcam, uploaded video/photos and sample footage. The same engine runs in the **Python edge agent** for RTSP cameras and video files. |
| **Reliable** in dynamic environments | k-of-n temporal confirmation (fire 2/5 frames, smoke and PPE 3/5), alert de-duplication, cool-downs, and mean-reverting sensor models with a forecast noise filter. A soak test asserts zero spurious critical alerts. |
| **Alerts with location and context** | Each alert carries zone, camera, map coordinates, evidence JPEG, regulation references (Factories Act, IS 2925, OISD…), recommended actions and a knowledge-graph explanation. It is routed by role (Fire & Safety, Safety Officer, Supervisor, permit holders) to the dashboard, Telegram or a webhook (Slack/Discord/Teams), with simulated SMS. |
| **Faster intervention** | Acknowledge/resolve workflow with mean-time-to-acknowledge KPI. Fire and critical compound risks trigger the **autonomous emergency orchestrator**: alarm, permit suspension, evacuation, evidence freeze and an AI-drafted statutory report. |

### Beyond detection: compound risk ("the kill chain")
Gas creeping to 60% of its alarm level is "normal" to a threshold system. A hot-work permit in that zone is "approved" to a permit system. SafeForge joins the two in a **knowledge graph** (permit → zone ← drifting sensor, including adjacent zones), forecasts **time-to-alarm**, turns the zone red and responds automatically. That is Phase 2 to Phase 4 of the brief, working end to end.

---

## Repository layout

```
models/        ONNX models + manifest (labels, PPE taxonomy, thresholds) shared by both edges
samples/       CC-licensed sample footage for demos and tests (see samples/ATTRIBUTION.md)
cv-service/    Python edge agent: engine.py (ONNX inference), main.py (RTSP/webcam/file → backend),
               server.py (FastAPI /detect), homography.py, calibration.py, tests/
backend/       Node.js platform: vision hub, alert manager, risk engine, knowledge graph, RAG,
               compliance, permits, emergency orchestrator, simulators, REST + Socket.io, tests/
frontend/      Next.js 16 dashboard: Command Center, Vision AI, Alert Center, Heatmap, Camera Wall,
               Permits, Risk Graph, Incident RAG, Compliance, Emergency, Calibration
docs/          Architecture, deployment and demo guides
```

## Run locally

Prerequisites: Node 20+, and Python 3.10+ for the edge agent.

```bash
# 1. Backend (http://localhost:5001)
cd backend && cp .env.example .env && npm install && npm start

# 2. Dashboard (http://localhost:3000)
cd frontend && cp .env.example .env.local && npm install && npm run dev

# 3. Optional: Python edge agent streaming sample footage through the models
cd cv-service && ./start_cv.sh demo                 # or: ./start_cv.sh rtsp CAM-03 rtsp://…
```

Or run the whole stack with `docker compose up --build`.

Open **Vision AI** and pick *Sample footage*, upload a clip, or start your webcam. Then use the **Kill-chain demo** buttons on the Command Center.

## Tests

```bash
cd backend && npm test                      # 20 tests: kill chain, vision → alert, ack/resolve, RAG, soak test
cd cv-service && python -m pytest -q        # 10 tests: decoding, PPE association, samples, temporal logic
cd frontend && npm run build                # type-check + production build
```

CI runs all three on every push (`.github/workflows/ci.yml`).

## Configuration

Backend environment variables (all optional) are listed in [`backend/.env.example`](backend/.env.example). Gemini keys enable AI recommendations, RAG answers and incident reports. Without keys every agent falls back to deterministic rule-based output, so the platform never depends on the LLM. Set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` or `ALERT_WEBHOOK_URL` for real alert delivery.

## Models and data

| Model | Source | Licence |
|---|---|---|
| PPE (YOLOv8s, 19 classes) | [killuminati1/construction-ppe-yolov8](https://huggingface.co/killuminati1/construction-ppe-yolov8) | Apache-2.0 |
| Fire/smoke (YOLOv8n, D-Fire) | [rabahdev/fire-smoke-yolov8n](https://huggingface.co/rabahdev/fire-smoke-yolov8n) | AGPL-3.0 |

Both were exported to ONNX (opset 12, 640×640). The decoder was validated against Ultralytics' reference output.

**Known limits.** The fire model is trained on scene-level CCTV imagery and under-detects macro close-ups of flames and very distant smoke plumes. A bright overcast sky can occasionally score as smoke on a single still image; in video, temporal confirmation filters most of this. For production, fine-tune both models on footage from the site's own cameras.

Sensor, SCADA and worker streams are **simulated** with realistic baselines (UCI gas, WUSTL-IIoT, CWRU vibration profiles). The ingestion paths (MQTT topics, HTTP) are the same ones real Modbus/OPC-UA gateways would use. Regulatory text is summarised for decision support; verify against official sources before formal use. Incidents are labelled *historical* (public record) or *representative scenario*.

## Licence

AGPL-3.0-or-later (inherited from the fire/smoke model weights).
