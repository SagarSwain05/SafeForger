# SafeForge Nexus — project status

**Status (Oct 2026): all four phases implemented, tested and deployed.** Start with the [README](README.md).

| Phase | Delivered |
|---|---|
| 1 · Sensory foundation | ONNX vision engine (PPE 19-class + fire/smoke) in the browser and the Python edge agent; MQTT/HTTP ingestion; simulated IoT/SCADA with dataset baselines; Leaflet digital twin with CCTV layers; homography calibration |
| 2 · Operational brain | Knowledge graph with zone adjacency; 9 spatial compound-risk rules; trend forecasting and lead time; permit intelligence (blocks unsafe permits, SIMOPS, context-aware PPE) |
| 3 · Knowledge base | TF-IDF RAG over historical/representative incidents and regulations; live compliance audit with evidence per item; regulation citations on every alert |
| 4 · Autonomous reflex | Alert manager (routing, evidence, Telegram/webhook, ack/resolve, MTTA); emergency orchestrator (alarm, permit suspension, evidence freeze, AI incident report) |

Further reading:
- [Architecture](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Demo script](docs/DEMO_SCRIPT.md)

## Decisions log
- **ONNX instead of PyTorch at runtime.** Small CPU/browser footprint; one model set shared by every edge.
- **Browser inference.** Free hosting can't run YOLO in real time, and edge inference matches the "edge-first" design.
- **In-memory graph, vector index and stores.** No external services to provision for the prototype. The interfaces map to Neo4j, a vector DB and MongoDB.
- **Gemini is optional.** Every agent has a deterministic fallback. Models are configurable because Google retires model IDs, which broke the original `gemini-1.5-flash` integration.
- **Data integrity.** Incidents that named real companies without a verifiable source were anonymised as representative scenarios. The LG Polymers date was corrected to 7 May 2020.
