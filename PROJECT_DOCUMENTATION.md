# SafeForger — Project Status & Implementation Blueprint

This document captures the implementation plan, system architecture, conversation summaries, and current engineering status for **SafeForger (Phase 1: Sensory Foundation)**.

---

## 📖 Project Overview & Vision
SafeForger is a context-aware, multi-agent safety digital twin designed for industrial plants (CDU/Refineries). It integrates high-frequency environmental telemetry (gas, temperature, pressure), SCADA equipment controls, Permit-to-Work records, shift change logs, and CCTV video analytics (YOLOv8/v11) to predict compound hazards before they manifest.

---

## 🛠️ Phase 1 Implementation Blueprint

### 1. Agentic / Messaging Infrastructure (MQTT & Socket.io)
- **Embedded MQTT Broker (`aedes`)**: Integrated directly inside the Node.js backend. Serves as the central nerve system for telemetry packets (port `1883`).
- **Telemetry Bridge (`backend/src/mqtt/ingestion.js`)**: Maps high-frequency topics like `plant/{zone}/telemetry` and `plant/{zone}/vision` into frontend-ready WebSocket events via Socket.io.

### 2. High-Fidelity SCADA Baselines
- Implemented realistic telemetry based on public industrial datasets:
  - **UCI Gas Sensor Array**: Baseline PPM and LEL equivalents for CH4, H2S, CO, and O2, mapped to Modbus input registers (30001–30005).
  - **WUSTL-IIoT Dataset**: Mapped holding registers (40001–40008) for critical assets (Pumps, Compressors, Boilers) with simulated OPC-UA tags.
  - **Case Western Bearing Vibration**: Baseline vibration telemetry (mm/s) to detect degradation profiles.

### 3. Edge CCTV AI Service (`cv-service/`)
- **YOLOv8 Detection Engine (`detector.py`)**: Detects workers, cross-checks safety gear (helmet, safety vest), and performs HSV-threshold smoke detection.
- **Homography Matrix Engine (`homography.py`)**: Computes 3x3 perspective matrices to transform camera coordinates `(x, y)` to plant floor layout coordinates `(lat, lng)`.
- **Calibration Tool (`calibration.py`)**: An interactive OpenCV program that lets operators calibrate camera perspective distortion relative to the plant blueprint.
- **Launcher Wrapper (`start_cv.sh`)**: Quick shell script supporting live RTSP streams, webcam feeds, file playbacks, and demo mock simulations.

### 4. Interactive GIS Canvas (Frontend)
- **Leaflet CRS.Simple Integration**: Bounded pixel space (`1180x640`) matching plant layouts.
- **Interactive Layers**:
  - **Risk Heatmap**: Dynamic opacity and color shifts (Green ➔ Yellow ➔ Red) based on active risk scores.
  - **Worker Markers**: Interactive circle markers displaying active coordinate telemetry and tooltips.
  - **Dashed Permit Borders**: Active hot work or confined space permit zone overlays.
  - **CCTV Camera Overlays**: Plotting interactive icons and camera Field of View (FOV) cones.

---

## 📜 Conversation & Requirements Log

### Challenge Statement
To construct a safety intelligence engine that:
1. Detects compound risks (e.g., active Hot Work permit + critical methane accumulation + shift change low staffing).
2. Generates predictive warning alerts.
3. Automatically triggers emergency actions and evidence logs when risk thresholds are breached.

### Implementation Milestones Completed
- [x] Initialized Next.js 15 & Node.js WebSocket backend.
- [x] Implemented Permit-to-Work validation with SIMOPS overlap checking.
- [x] Embedded Aedes MQTT broker inside backend for high-frequency telemetry.
- [x] Built the Python YOLOv8 edge detection framework.
- [x] Integrated Leaflet CRS.Simple coordinate mapping.
- [x] Created interactive calibration tool & pages.
- [x] Tested & verified clean builds for both frontend and backend.
