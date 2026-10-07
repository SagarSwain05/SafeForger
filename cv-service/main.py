"""
SafeForge Edge Vision Agent
===========================
Runs PPE-compliance and fire/smoke detection on a camera, RTSP stream, video
file or image folder, and streams results to the SafeForge backend.

Examples:
  python main.py --source ../samples/fire_outdoor.webm --camera CAM-02 --backend-url http://localhost:5001
  python main.py --source 0 --camera CAM-01 --display                      # webcam
  python main.py --source "rtsp://user:pass@10.0.0.20:554/stream1" --camera CAM-03
  python main.py --source ../samples/no_ppe_street.jpg --once               # print JSON for one image
  python main.py --demo --backend-url https://safeforger-backend.onrender.com   # loop the bundled samples

Backend URL can also be set with SAFEFORGE_BACKEND_URL; multi-camera: run one process per camera.
"""
import argparse
import json
import logging
import os
import signal
import sys
import time
from pathlib import Path

import cv2

from engine import TemporalConfirmer, VisionEngine, annotate
from homography import HomographyEngine, load_layout
from publisher import HttpPublisher, build_payload, encode_evidence

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("main")

HERE = Path(__file__).resolve().parent
SAMPLES = HERE.parent / "samples"
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def load_config(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


class FrameSource:
    """Uniform iterator over webcam / RTSP / video file / image file / image folder / demo playlist."""

    def __init__(self, source, loop: bool = False, image_hold_s: float = 4.0):
        self.loop = loop
        self.image_hold_s = image_hold_s
        self.items = []
        self.cap = None
        self.is_still = False
        if isinstance(source, list):
            self.items = source
        elif isinstance(source, str) and source.isdigit():
            self.items = [int(source)]
        else:
            p = Path(str(source))
            if p.is_dir():
                self.items = sorted(str(f) for f in p.iterdir() if f.suffix.lower() in IMAGE_EXT | {".mp4", ".webm", ".avi", ".mov", ".mkv"})
            else:
                self.items = [source]
        self.idx = -1
        self._still = None
        self._still_until = 0.0
        self._next_item()

    def _open(self, item):
        if isinstance(item, str) and Path(item).suffix.lower() in IMAGE_EXT:
            self._still = cv2.imread(item)
            self._still_until = time.time() + self.image_hold_s
            self.is_still = True
            return self._still is not None
        self.is_still = False
        cap = cv2.VideoCapture(item, cv2.CAP_FFMPEG) if isinstance(item, str) and item.startswith(("rtsp://", "http")) else cv2.VideoCapture(item)
        if isinstance(item, str) and item.startswith("rtsp://"):
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
        self.cap = cap if cap.isOpened() else None
        return self.cap is not None

    def _next_item(self) -> bool:
        if self.cap is not None:
            self.cap.release()
            self.cap = None
        for _ in range(len(self.items)):
            self.idx += 1
            if self.idx >= len(self.items):
                if not self.loop:
                    return False
                self.idx = 0
            item = self.items[self.idx]
            if self._open(item):
                logger.info("Source: %s", item)
                return True
            logger.warning("Could not open source: %s", item)
        return False

    @property
    def current(self):
        return self.items[self.idx] if 0 <= self.idx < len(self.items) else None

    def read(self):
        while True:
            if self.is_still:
                if time.time() < self._still_until:
                    return self._still
            elif self.cap is not None:
                ok, frame = self.cap.read()
                if ok:
                    return frame
                # live streams: retry; files: advance
                if isinstance(self.current, str) and self.current.startswith("rtsp://"):
                    logger.warning("Stream read failed — reconnecting")
                    time.sleep(1)
                    self._open(self.current)
                    continue
            if not self._next_item():
                return None

    def release(self):
        if self.cap is not None:
            self.cap.release()


def run(args):
    config = load_config(args.config)
    layout = load_layout(config.get("layout_path"))
    cam_meta = next((c for c in layout.get("cameras", []) if c["id"] == args.camera), {})
    zone_id = args.zone or cam_meta.get("zone") or config.get("cameras", {}).get(args.camera, {}).get("zone", "Z-01")
    zone = next((z for z in layout["zones"] if z["id"] == zone_id), {})
    required = zone.get("requiredPPE") or None

    engine = VisionEngine(args.models_dir)
    confirmer = TemporalConfirmer(engine.manifest.get("temporal", {}))
    homography = HomographyEngine(config, layout)

    backend_url = args.backend_url or os.environ.get("SAFEFORGE_BACKEND_URL")
    http = HttpPublisher(backend_url, os.environ.get("SAFEFORGE_API_KEY")) if backend_url and not args.once else None
    mqtt = None
    if args.mqtt:
        from mqtt_client import SafeForgerMqttClient
        mqtt = SafeForgerMqttClient(config)

    if args.demo:
        source = [str(SAMPLES / n) for n in ("no_ppe_street.jpg", "ppe_mixed_site.jpg", "fire_outdoor.webm", "smoke_warehouse.jpg", "ppe_compliant_crew.jpg")]
        loop = True
    else:
        source = args.source if args.source is not None else str(config.get("cameras", {}).get(args.camera, {}).get("source", 0))
        loop = args.loop
    frames = FrameSource(source, loop=loop)

    logger.info("Camera %s → zone %s (%s) | required PPE: %s | backend: %s | mqtt: %s",
                args.camera, zone_id, zone.get("name", "?"), required or engine.manifest["default_required_ppe"],
                backend_url or "-", "on" if mqtt else "off")

    stop = {"flag": False}
    signal.signal(signal.SIGINT, lambda *_: stop.update(flag=True))
    signal.signal(signal.SIGTERM, lambda *_: stop.update(flag=True))

    last_publish, last_evidence, analysed = 0.0, {}, 0
    t_start = time.time()
    while not stop["flag"]:
        loop_t = time.time()
        frame = frames.read()
        if frame is None:
            logger.info("Source exhausted")
            break
        result = engine.detect(frame, required)
        homography.map_workers(args.camera, result, zone_id)
        events = confirmer.update(result, single_frame=args.once)
        analysed += 1
        fps = analysed / max(1e-6, time.time() - t_start)

        if args.once:
            print(json.dumps(build_payload(args.camera, zone_id, result, events, fps=fps), indent=2))
            if args.save:
                cv2.imwrite(args.save, annotate(frame, result, engine.manifest))
            break

        # Evidence: attach a frame when an event type is (re)confirmed, at most every 15 s per type
        evidence = None
        now = time.time()
        fresh = [e["type"] for e in events if now - last_evidence.get(e["type"], 0) > 15]
        if fresh:
            evidence = encode_evidence(annotate(frame, result, engine.manifest))
            for t in fresh:
                last_evidence[t] = now

        if http or mqtt:
            if evidence or now - last_publish >= args.publish_every:
                payload = build_payload(args.camera, zone_id, result, events, evidence=evidence, fps=fps)
                if http:
                    http.publish(payload)
                if mqtt:
                    mqtt.publish_vision(payload)
                last_publish = now

        if analysed % 20 == 0:
            logger.info("[%s] %d frames | %.1f fps | workers=%d violations=%d fire=%s smoke=%s | events=%s",
                        args.camera, analysed, fps, result["worker_count"], result["ppe_violations"],
                        result["fire_detected"], result["smoke_detected"], [e["type"] for e in events] or "-")

        if args.display:
            cv2.imshow(f"SafeForge — {args.camera}", annotate(frame, result, engine.manifest))
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

        sleep = args.interval - (time.time() - loop_t)
        if sleep > 0:
            time.sleep(sleep)

    frames.release()
    if args.display:
        cv2.destroyAllWindows()
    if mqtt:
        mqtt.publish_heartbeat("STOPPED")
        mqtt.disconnect()
    if http:
        time.sleep(1.0)  # let the queue drain
        logger.info("Published %d payloads (%d dropped)", http.sent, http.failed)


def main():
    ap = argparse.ArgumentParser(description="SafeForge Edge Vision Agent — PPE + fire/smoke detection")
    ap.add_argument("--source", default=None, help="0 (webcam) | video/image file | image folder | rtsp://…")
    ap.add_argument("--camera", default="CAM-01", help="Camera ID from plant-layout.json (default CAM-01)")
    ap.add_argument("--zone", default=None, help="Override the camera's zone")
    ap.add_argument("--backend-url", default=None, help="SafeForge backend base URL (or SAFEFORGE_BACKEND_URL)")
    ap.add_argument("--mqtt", action="store_true", help="Also publish to the plant MQTT broker (config.json)")
    ap.add_argument("--config", default=str(HERE / "config.json"))
    ap.add_argument("--models-dir", default=None, help="Directory with manifest.json + ONNX models (default ../models)")
    ap.add_argument("--interval", type=float, default=0.25, help="Seconds between analysed frames (default 0.25)")
    ap.add_argument("--publish-every", type=float, default=1.0, help="Seconds between routine payloads (default 1.0)")
    ap.add_argument("--loop", action="store_true", help="Loop file sources")
    ap.add_argument("--demo", action="store_true", help="Loop the bundled sample media")
    ap.add_argument("--once", action="store_true", help="Analyse a single frame and print the JSON payload")
    ap.add_argument("--save", default=None, help="With --once: write the annotated image here")
    ap.add_argument("--display", action="store_true", help="Show an OpenCV window")
    args = ap.parse_args()
    if not (args.demo or args.source is not None or args.once):
        args.source = "0"
    run(args)


if __name__ == "__main__":
    sys.exit(main())
