// Copies the shared ONNX models and sample media into public/ so the browser edge can load
// them same-origin. Falls back to downloading from GitHub when the frontend is built alone.
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const pub = join(here, '..', 'public');
const RAW = process.env.SAFEFORGE_ASSET_BASE || 'https://raw.githubusercontent.com/SagarSwain05/SafeForger/main';
const SETS = {
  models: ['manifest.json', 'ppe.onnx', 'fire.onnx'],
  samples: ['no_ppe_street.jpg', 'ppe_mixed_site.jpg', 'ppe_compliant_crew.jpg', 'fire_outdoor.webm', 'smoke_warehouse.jpg', 'fire_flame.jpg', 'ATTRIBUTION.md'],
};

// Self-host ONNX Runtime Web (same origin → threaded WASM works under cross-origin isolation)
{
  const ortDist = join(here, '..', 'node_modules', 'onnxruntime-web', 'dist');
  const dest = join(pub, 'ort');
  mkdirSync(dest, { recursive: true });
  for (const f of ['ort.webgpu.min.js', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
    const out = join(dest, f);
    if (!existsSync(out) || statSync(out).size !== statSync(join(ortDist, f)).size) cpSync(join(ortDist, f), out);
  }
  console.log('assets: onnxruntime-web → public/ort');
}

for (const [dir, files] of Object.entries(SETS)) {
  const dest = join(pub, dir);
  mkdirSync(dest, { recursive: true });
  for (const f of files) {
    const src = join(root, dir, f);
    const out = join(dest, f);
    if (existsSync(src)) {
      if (!existsSync(out) || statSync(out).size !== statSync(src).size) cpSync(src, out);
      continue;
    }
    if (existsSync(out)) continue;
    const res = await fetch(`${RAW}/${dir}/${f}`);
    if (!res.ok) throw new Error(`Cannot fetch ${dir}/${f}: HTTP ${res.status}`);
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    console.log(`downloaded ${dir}/${f}`);
  }
  console.log(`assets: ${dir} → public/${dir} (${readdirSync(dest).length} files)`);
}
