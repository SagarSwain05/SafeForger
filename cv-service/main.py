"""
SafeForger CV Service — Main Entry Point
=======================================
Supports:
  --source 0              → Webcam (default)
  --source /path/video.mp4 → Video file (for testing)
  --source rtsp://...     → RTSP IP camera (production)
  --camera CAM-01         → Camera ID from config.json
  --display               → Show OpenCV window
  --mock                  → Mock mode (no camera required, demo only)

Production RTSP:
  python main.py --source "rtsp://admin:password@192.168.1.100:554/h264Preview_01_main"

Multi-camera: Run multiple instances with different --camera IDs.
"""
import argparse
import cv2
import json
import logging
import time
import threading
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("main")


def load_config(path: str = "config.json") -> dict:
    with open(path, "r") as f:
        return json.load(f)


def open_capture(source, camera_cfg: dict):
    """
    Open video capture from webcam, file, or RTSP URL.
    Applies hardware buffer optimizations for low-latency real-time streams.
    """
    # Resolve source
    if isinstance(source, str) and source.isdigit():
        source = int(source)

    if isinstance(source, int):
        cap = cv2.VideoCapture(source)
        logger.info(f"Opened webcam device {source}")
    elif isinstance(source, str) and source.startswith("rtsp://"):
        # Production RTSP stream — configure for low latency
        cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)       # Minimize frame buffer lag
        cap.set(cv2.CAP_PROP_FPS, camera_cfg.get("fps", 15))
        logger.info(f"Opened RTSP stream: {source[:40]}…")
    elif isinstance(source, str) and Path(source).exists():
        cap = cv2.VideoCapture(source)
        logger.info(f"Opened video file: {source}")
    else:
        logger.warning(f"Source not found: {source}. Falling back to mock mode.")
        return None

    # Set resolution
    w, h = camera_cfg.get("resolution", [1280, 720])
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)

    if not cap.isOpened():
        logger.error(f"Failed to open capture: {source}")
        return None

    return cap


def run_camera(camera_id: str, config: dict, args):
    """Main camera processing loop for a single camera."""
    from detector import YOLODetector
    from homography import HomographyEngine
    from mqtt_client import SafeForgerMqttClient

    cam_cfg = config["cameras"].get(camera_id, {})
    if not cam_cfg.get("enabled", True) and not args.force:
        logger.info(f"Camera {camera_id} disabled in config. Use --force to override.")
        return

    zone_id = cam_cfg.get("zone", "Z-01")
    fps_target = cam_cfg.get("fps", 15)
    frame_delay = 1.0 / fps_target
    mock_mode = args.mock

    logger.info(f"=== SafeForger CV Service — {camera_id} ({zone_id}) ===")
    logger.info(f"Mode: {'MOCK (no camera)' if mock_mode else 'LIVE'}")

    # Initialize components
    detector = YOLODetector(config)
    homography = HomographyEngine(config)
    mqtt = SafeForgerMqttClient(config)

    # Open capture
    cap = None
    if not mock_mode:
        source = args.source or cam_cfg.get("rtsp_url") or cam_cfg.get("source", 0)
        cap = open_capture(source, cam_cfg)
        if cap is None:
            logger.warning("Capture failed — switching to mock mode")
            mock_mode = True

    frame_count = 0
    last_heartbeat = 0
    stats = {"worker_count": 0, "ppe_violations": 0, "smoke_detected": False}
    window_name = f"SafeForger CCTV — {camera_id}"

    logger.info("Starting detection loop…")

    try:
        while True:
            loop_start = time.time()

            # Read frame
            if mock_mode or cap is None:
                # Generate synthetic frame for demo
                import numpy as np
                frame = np.zeros((480, 640, 3), dtype=np.uint8)
                frame[:] = (8, 12, 24)  # Dark background
                cv2.putText(frame, f"SafeForger MOCK  {camera_id}", (20, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 80), 1)
                detections = detector._mock_detection(frame)
            else:
                ret, frame = cap.read()
                if not ret:
                    logger.warning("Frame read failed — EOF or stream error")
                    if cap.get(cv2.CAP_PROP_POS_FRAMES) >= cap.get(cv2.CAP_PROP_FRAME_COUNT) - 1:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)  # Loop video file
                    time.sleep(0.1)
                    continue
                detections = detector.detect(frame)

            frame_count += 1

            # Homography: map pixel → plant layout coords
            detections = homography.map_detections(camera_id, detections)

            # Update stats
            stats = {
                "worker_count": detections["worker_count"],
                "ppe_violations": detections["ppe_violation_count"],
                "smoke_detected": detections["smoke_detected"],
            }

            # Publish to MQTT (every 2 frames to reduce load)
            if frame_count % 2 == 0:
                mqtt.publish_vision_detection(camera_id, zone_id, detections, frame_count)

            # Aggregate heartbeat every 30s
            now = time.time()
            if now - last_heartbeat > 30:
                mqtt.publish_heartbeat("RUNNING")
                last_heartbeat = now

            # Display window (optional — disabled for server deployments)
            if args.display and frame is not None:
                annotated = detector.annotate_frame(frame, detections)
                cv2.imshow(window_name, annotated)
                if cv2.waitKey(1) & 0xFF == ord('q'):
                    logger.info("Quit key pressed — stopping")
                    break

            # Log every 100 frames
            if frame_count % 100 == 0:
                logger.info(f"[{camera_id}] Frame {frame_count} | Workers: {stats['worker_count']} | Violations: {stats['ppe_violations']} | Smoke: {stats['smoke_detected']}")

            # Rate limiting
            elapsed = time.time() - loop_start
            sleep_time = frame_delay - elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)

    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    finally:
        if cap is not None:
            cap.release()
        if args.display:
            cv2.destroyAllWindows()
        mqtt.publish_heartbeat("STOPPED")
        mqtt.disconnect()
        logger.info(f"Camera {camera_id} stopped after {frame_count} frames")


def main():
    parser = argparse.ArgumentParser(description="SafeForger CV Service — Industrial CCTV AI")
    parser.add_argument("--source", type=str, default=None,
                        help="Video source: 0 (webcam), /path/video.mp4, or rtsp://...")
    parser.add_argument("--camera", type=str, default="CAM-01",
                        help="Camera ID from config.json (default: CAM-01)")
    parser.add_argument("--config", type=str, default="config.json",
                        help="Path to config.json")
    parser.add_argument("--display", action="store_true",
                        help="Show OpenCV window (requires display)")
    parser.add_argument("--mock", action="store_true",
                        help="Mock mode — no camera required (for demo/testing)")
    parser.add_argument("--force", action="store_true",
                        help="Force run even if camera disabled in config")
    parser.add_argument("--all-cameras", action="store_true",
                        help="Run all enabled cameras in parallel threads")
    args = parser.parse_args()

    config = load_config(args.config)

    if args.all_cameras:
        threads = []
        for cam_id, cam_cfg in config["cameras"].items():
            if cam_cfg.get("enabled", True) or args.force:
                t = threading.Thread(target=run_camera, args=(cam_id, config, args), daemon=True)
                t.start()
                threads.append(t)
        logger.info(f"Started {len(threads)} camera threads")
        for t in threads:
            t.join()
    else:
        run_camera(args.camera, config, args)


if __name__ == "__main__":
    main()
