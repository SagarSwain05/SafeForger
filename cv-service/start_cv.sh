#!/usr/bin/env bash
# SafeForger CV Service — Launcher Script
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "╔══════════════════════════════════════════════╗"
echo "║  SafeForger CV Service                        ║"
echo "╚══════════════════════════════════════════════╝"

# Check Python
if ! command -v python3 &> /dev/null; then
  echo "❌ Python 3 not found. Install Python 3.9+"
  exit 1
fi
echo "✓ Python: $(python3 --version)"

# Check / create virtualenv
if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
fi
source venv/bin/activate

# Install dependencies
echo "Installing requirements..."
pip install -q -r requirements.txt

# Mode selection
MODE="${1:-mock}"
CAMERA="${2:-CAM-01}"
SOURCE="${3:-0}"

case "$MODE" in
  webcam)
    echo "▶  Starting webcam mode (device $SOURCE)..."
    python main.py --camera "$CAMERA" --source "$SOURCE" --display
    ;;
  rtsp)
    echo "▶  Starting RTSP mode: $SOURCE"
    python main.py --camera "$CAMERA" --source "$SOURCE"
    ;;
  mock)
    echo "▶  Starting MOCK mode (no camera required)..."
    python main.py --camera "$CAMERA" --mock
    ;;
  calibrate)
    echo "▶  Starting calibration for camera $CAMERA (source $SOURCE)..."
    python calibration.py --camera "$CAMERA" --source "$SOURCE"
    ;;
  all)
    echo "▶  Starting all enabled cameras in parallel..."
    python main.py --all-cameras --mock
    ;;
  *)
    echo "Usage: ./start_cv.sh [mock|webcam|rtsp|calibrate|all] [camera_id] [source]"
    echo ""
    echo "Examples:"
    echo "  ./start_cv.sh mock                              # Demo mode, no camera"
    echo "  ./start_cv.sh webcam CAM-01 0                  # Use system webcam"
    echo "  ./start_cv.sh rtsp CAM-01 rtsp://192.168.1.100:554/stream  # IP camera"
    echo "  ./start_cv.sh calibrate CAM-01 0               # Calibration tool"
    echo "  ./start_cv.sh all                              # All cameras"
    exit 1
    ;;
esac
