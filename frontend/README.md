# SafeForge Nexus — dashboard

Next.js 16 app (App Router, client-rendered pages) for the SafeForge control room.

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL → backend
npm install
npm run dev                  # predev copies ../models and ../samples into public/
```

- `public/vision/worker.js` runs the ONNX models in a Web Worker (ONNX Runtime Web from jsDelivr, WebGPU or WASM).
- `src/lib/vision.ts` handles the worker client, temporal confirmation, payload building and overlay drawing.
- `src/lib/socket.tsx` holds live state over Socket.io, plus the `api()` helper.

See the root README and `docs/` for architecture and deployment.
