# SafeForge Nexus

**Real-time AI safety for factories.** SafeForge watches CCTV for missing PPE (helmet, hi-vis vest, safety footwear, gloves), smoke and fire. It fuses what it sees with gas sensors, SCADA, permits-to-work and worker locations. The right people get an alert with the **location, evidence frame, regulation breached and recommended action**, often before any single alarm would sound.

## Live deployment

| | URL |
|---|---|
| **Website + dashboard** | **https://safeforge-nexus.vercel.app** |
| API (health) | https://safeforger-backend.onrender.com/api/health |
| Demo account | `safeforgerdemo@gmail.com` / `Safeforger@20226` (or press **Try the live demo** on the home page) |

The backend runs on a free tier that sleeps when idle. The first visit can take 30–60 s; the status pill in the sidebar shows progress and has a **Wake** button.

More: [Architecture](docs/ARCHITECTURE.md) · [Deployment](docs/DEPLOYMENT.md) · [5-minute demo script](docs/DEMO_SCRIPT.md)

---

## Objectives

The hackathon brief asked for a prototype that detects safety-gear compliance, smoke and fire in real time from CCTV or recorded footage, and alerts people with location and context. SafeForge's objectives:

1. **Safety-gear compliance.** Detect whether each worker wears the PPE *their zone* requires (helmet, high-visibility vest, safety footwear, gloves where applicable).
2. **Early smoke and fire detection.** Spot smoke and flames on CCTV within seconds, without single-frame false alarms.
3. **Alerts with location and context.** Zone, camera, map position, evidence frame, event type, regulation and next action, routed to the right role.
4. **Faster intervention.** On-screen siren, acknowledgement tracking (MTTA), and an autonomous emergency response.
5. **Prevention, not just detection.** Catch *compound* risks (hot work next to a slow gas build-up) before any single alarm sounds.

## Features

| Area | What you get |
|---|---|
| **Vision AI** | Two YOLOv8 models: PPE with 19 classes, including *missing* helmet/vest/boots/gloves, and fire/smoke. They run in the browser via WebGPU or multi-threaded WebAssembly, and in a Python edge agent for RTSP cameras. Sources: sample footage, uploaded video or photos, webcam, a camera's video URL, plus a **live webcam in the corner** of the stage as a second camera. **Per-worker tracking** keeps IDs stable and votes PPE state over 8 frames. Fire is confirmed in 2/5 frames, smoke and PPE in 3/5. |
| **Two kinds of account** | **Demo account:** browses 20 simulated plants (3 sandboxes + digital twins of real Indian facilities across 10 sectors). Each plant is distinct: its own map, sector sensors and SCADA equipment, workforce, permits, and an **active situation** (e.g. *CO build-up — Coal Handling Plant*) with its own alerts, risk score and point of action. **Real accounts:** attached to **one facility**, created from a real-facility template or from scratch, with teammates by invitation. A real facility is **live**: it shows only real inputs (CCTV, sensor gateways, handheld readings, SCADA, badges). Anything not reporting shows *offline / no data*, never invented values. |
| **Real-time inputs** | `POST /api/sites/:id/telemetry` (gas and process sensors), `/scada` (equipment states), `/presence` (badge/RFID) and `/vision/detections` (CCTV), each authenticated with the site ingest key. Includes `cv-service/telemetry_gateway.py` (Modbus TCP polling or CSV replay), the RTSP camera agent, and **Log a handheld reading** on the dashboard. Detectors silent for 2 minutes go OFFLINE. |
| **Alerting** | Alert Center with evidence frame, location, routing to roles and site contacts, regulation references and recommended actions. Full-screen **siren** (two-tone wail plus strobe) for emergencies and unacknowledged critical alerts, with acknowledge and mute. Optional Telegram and webhook delivery. |
| **Compound risk** | Knowledge graph of zones, sensors, permits, cameras and people with zone adjacency. 9 spatial rules, a 0–100 score per zone, trend forecasting, and **lead time to alarm**. |
| **Permits** | Permit intelligence blocks unsafe permits (live gas, SIMOPS, CCTV PPE status); active permits add PPE requirements (e.g. hot work adds gloves and eye protection). |
| **Autonomous response** | Critical risk or confirmed fire triggers alarm, permit suspension, evacuation guidance, evidence freeze and an AI-drafted statutory report. Second incidents extend the response. |
| **Knowledge** | RAG over incidents and regulations (Factories Act, OISD, IS, ISO) and a live compliance audit with evidence per item. |
| **Accounts** | Registration with **Brevo email OTP verification**, sign-in, password reset, roles; demo account seeded on every boot. |
| **Operations** | Light and dark themes, a live **server status** panel (latency, uptime, realtime, storage) with **Reconnect / Wake / Restart**, public landing page, responsive layout. |

## Repository layout

```
models/        ONNX models + manifest (labels, PPE taxonomy, thresholds) shared by both edges
samples/       CC-licensed sample footage (samples/ATTRIBUTION.md)
cv-service/    Python edge agent: engine.py, main.py (RTSP/webcam/file → site API), server.py (FastAPI), tests/
backend/       Node.js platform
  src/auth/      accounts, Brevo email OTP, JWT
  src/sites/     sector templates, real-facility presets, registry, per-site runtime
  src/store/     MongoDB or JSON-file persistence
  src/agents/    risk orchestrator, permits, RAG, compliance, emergency
  src/services/  vision hub, alert manager, knowledge graph, forecasting, LLM, notifier
frontend/      Next.js 16: landing + auth (public), site picker, command center, Vision AI, alerts,
               heatmap, camera wall, permits, graph, RAG, compliance, emergency, site & cameras
docs/          architecture, deployment, demo script
```

## Run locally

```bash
cd backend  && cp .env.example .env && npm install && npm start          # http://localhost:5001
cd frontend && cp .env.example .env.local && npm install && npm run dev  # http://localhost:3000
# optional edge agent (site id + ingest key from Site & Cameras):
cd cv-service && SAFEFORGE_SITE=demo-refinery SAFEFORGE_API_KEY=<key> ./start_cv.sh demo
```

Sign in with the demo account, choose **SafeForge Demo Refinery**, then try Vision AI and the kill-chain demo.

## Tests

```bash
cd backend && npm test                 # 31 tests: auth, one-facility rule, live inputs, distinct demo plants, isolation, kill chain, vision → alert, soak
cd cv-service && python -m pytest -q   # 10 tests: decoding, PPE association, samples, temporal logic
cd frontend && npm run build           # type-check + production build
```

## Configuration

See [`backend/.env.example`](backend/.env.example). Production needs `JWT_SECRET` and `FRONTEND_URL`.

Optional settings:
- `MONGO_URI`: durable users and sites.
- `BREVO_API_KEY` + `EMAIL_FROM`: email verification and password reset.
- `GEMINI_API_KEYS`: AI text. Rule-based fallbacks are used otherwise.
- `TELEGRAM_*` / `ALERT_WEBHOOK_URL`: phone and chat alerts.

## Models, data and limits

| Model | Source | Licence |
|---|---|---|
| PPE (YOLOv8s, 19 classes) | [killuminati1/construction-ppe-yolov8](https://huggingface.co/killuminati1/construction-ppe-yolov8) | Apache-2.0 |
| Fire/smoke (YOLOv8n, D-Fire) | [rabahdev/fire-smoke-yolov8n](https://huggingface.co/rabahdev/fire-smoke-yolov8n) | AGPL-3.0 |

- **Fire model limits.** It under-detects macro close-ups of flames and very distant smoke plumes. For production, fine-tune both models on site footage.
- **Simulated telemetry.** Sensor, SCADA and worker data are simulated around public dataset baselines. Real gateways use the same MQTT/HTTP ingestion paths.
- **Facility names.** Real facility names are used only as digital-twin templates. SafeForge is not affiliated with those operators, and their twins show simulated data.
- **Regulations and incidents.** Regulation text is summarised for decision support. Incidents are marked *historical* or *representative scenario*.

Licence: AGPL-3.0-or-later (inherited from the fire/smoke model weights).
