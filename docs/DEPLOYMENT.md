# Deployment

| Component | Host | URL |
|---|---|---|
| Dashboard (Next.js) | Vercel, project `safeforge-nexus` | https://safeforge-nexus.vercel.app |
| Backend API + WebSocket | Render web service `safeforger-backend` (free, Singapore) | https://safeforger-backend.onrender.com (health: `/api/health`) |
| ONNX models + samples | Served by Vercel from `frontend/public/` (synced from `models/` and `samples/` at build) | `/models/*`, `/samples/*` |
| Python edge agent | Runs on-premise or locally (Docker image in `cv-service/Dockerfile`) | publishes to the backend over HTTPS |

## Backend (Render)
- Defined in `render.yaml`: root `backend/`, `npm ci --omit=dev`, `node src/index.js`, health check `/api/health`.
- **Auto-deploys on every push to `main`.**
- Environment variables (Render dashboard → Environment):

| Variable | Purpose |
|---|---|
| `FRONTEND_URL` | CORS allow-list (comma-separated). Currently the Vercel production domains. |
| `PUBLIC_DASHBOARD_URL` | Deep links inside Telegram/webhook alerts |
| `GEMINI_API_KEYS` | Comma-separated Gemini keys (rotated; models configurable via `GEMINI_MODELS` / `GEMINI_FAST_MODELS`) |
| `MQTT_ENABLED=false` | Render only exposes the HTTP port; edge agents publish over HTTPS |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Optional: real alert delivery to a Telegram group |
| `ALERT_WEBHOOK_URL` | Optional: Slack / Discord / Teams incoming webhook |

**Free-tier note:** the service sleeps after about 15 minutes idle. The first request takes 30–60 s, and the dashboard shows a "waking the backend" banner meanwhile. Open the dashboard a minute before a demo. State is in memory and resets on restart or redeploy.

## Dashboard (Vercel)
```bash
cd frontend
vercel deploy --prod      # project already linked (.vercel/), env vars set in Vercel
```
- Environment: `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` = backend URL (Production).
- The `prebuild` step copies `../models` and `../samples` into `public/`. If they're missing (frontend built alone), it downloads them from this GitHub repo.
- Inference runs in the visitor's browser. ONNX Runtime Web loads from jsDelivr (`onnxruntime-web@1.30.0`).

## Edge agent against production
```bash
cd cv-service
SAFEFORGE_BACKEND_URL=https://safeforger-backend.onrender.com ./start_cv.sh demo
./start_cv.sh rtsp CAM-03 "rtsp://user:pass@10.0.0.20:554/stream1"   # real camera
docker build -f cv-service/Dockerfile -t safeforge-vision .          # from repo root
```

## Enabling real alert delivery (optional)
1. **Telegram:** create a bot with @BotFather, add it to your safety group, and read the chat id from `https://api.telegram.org/bot<TOKEN>/getUpdates`. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` on Render. Critical and high alerts then arrive with the evidence photo.
2. **Slack/Discord/Teams:** set `ALERT_WEBHOOK_URL`.
3. Verify with `curl -X POST https://safeforger-backend.onrender.com/api/notifications/test`.

## Verification checklist (run for this release)
- `backend: npm test`: 21/21 passing (kill chain, vision → alert, two-incident emergency, ack/resolve, RAG, 100-minute noise soak)
- `cv-service: pytest`: 10/10 passing
- `frontend: npm run build`: clean
- Production browser e2e (headless Chromium):
  - all 11 pages load with zero console errors
  - models load in about 17 s (WASM)
  - PPE, fire and smoke alerts arrive with evidence frames
  - the kill chain reaches CRITICAL 100 and triggers the autonomous emergency
  - Gemini recommendations, RAG and the incident report work live
