#!/usr/bin/env bash
# SafeForge Edge Vision Agent — launcher
# Needs SAFEFORGE_SITE and SAFEFORGE_API_KEY (dashboard → Site settings → Edge agent).
#   ./start_cv.sh demo   [backend_url]              loop bundled sample media (real inference)
#   ./start_cv.sh webcam [camera_id] [device]       local webcam with preview window
#   ./start_cv.sh rtsp   <camera_id> <rtsp_url>     IP camera
#   ./start_cv.sh file   <camera_id> <video_path>   recorded footage (looped)
#   ./start_cv.sh api                               HTTP inference API on :8000
#   ./start_cv.sh calibrate [camera_id] [device]    homography calibration tool
set -euo pipefail
cd "$(dirname "$0")"

PY=${PYTHON:-python3}
if [ ! -d venv ]; then
  echo "Creating virtual environment…"
  "$PY" -m venv venv
fi
# shellcheck disable=SC1091
source venv/bin/activate
pip install -q -r requirements.txt

export SAFEFORGE_BACKEND_URL="${SAFEFORGE_BACKEND_URL:-http://localhost:5001}"
MODE="${1:-demo}"
case "$MODE" in
  demo)      python main.py --demo --camera CAM-02 --backend-url "${2:-$SAFEFORGE_BACKEND_URL}" ;;
  webcam)    python main.py --camera "${2:-CAM-01}" --source "${3:-0}" --display --backend-url "$SAFEFORGE_BACKEND_URL" ;;
  rtsp)      python main.py --camera "$2" --source "$3" --backend-url "$SAFEFORGE_BACKEND_URL" ;;
  file)      python main.py --camera "$2" --source "$3" --loop --backend-url "$SAFEFORGE_BACKEND_URL" ;;
  api)       uvicorn server:app --host 0.0.0.0 --port "${PORT:-8000}" ;;
  calibrate) python calibration.py --camera "${2:-CAM-01}" --source "${3:-0}" ;;
  *) sed -n '2,8p' "$0"; exit 1 ;;
esac
