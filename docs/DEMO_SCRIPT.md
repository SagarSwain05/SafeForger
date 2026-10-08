# Demo script (about 5 minutes)

Open the dashboard about a minute before you present. The free hosting tier sleeps when idle, so the first load wakes the backend; a yellow banner shows while it wakes.

## 1. The problem (30 s)
"Factories have the cameras and the sensors. The data exists, but nobody acts on it in time: a missing helmet on CCTV nobody is watching, smoke seen minutes late, a gas reading that looks normal until hot work starts next to it."

## 1b. Sign in and pick a site (20 s)
On the home page press **Try the live demo**, which signs in as the demo supervisor. The site picker lists sandbox plants and digital twins of real facilities across 10 sectors. Choose **SafeForge Demo Refinery** for the guided demo, or show **Create a site** (sector template → zones and PPE → cameras → contacts).

## 2. PPE and fire detection on real footage (2 min) — Vision AI
1. Open **Vision AI**. The models load once (about 57 MB, then cached). The chip shows *WebGPU* or *WASM*.
2. **Sample footage → "No PPE — workers at a pump station entry"**.
   - Every worker gets a red box with the missing items.
   - The camera is CAM-03 in Pump Station A. Gloves appear as required because an electrical-isolation permit is active there (*context-aware PPE*).
   - A toast pops up: *PPE violation — Pump Station A*, with the people notified.
3. **Sample → "Compliant crew"**: green boxes and no alert, so it isn't just flagging everyone.
4. **Sample → "Fire & smoke — recorded footage (video)"**: fire is confirmed after 2 frames. A critical toast and alarm tone fire, and an automatic emergency is declared.
5. Press **◎ Corner webcam**. Your webcam becomes a second camera in the corner of the stage, analysed alongside the footage. Step in without a helmet: the box turns amber (*checking*), then red once missing gear is seen in 3 frames. Press ⤢ to move it to the main stage.
6. When fire is confirmed, the **siren** sounds and a full-screen emergency overlay appears. Press **Acknowledge & silence**; the red strobe border stays until the emergency is stood down.

## 3. From detection to action (1 min) — Alert Center
- Open the fire alert. Show:
  - the **evidence frame**
  - the **location** (zone, camera, map position)
  - the **regulations** (Factories Act s.38, OISD-STD-116)
  - the **recommended actions**
  - **who was notified** and on which channels
  - the detection-to-alert timeline
- Press **Acknowledge** and then **Resolve**. The mean time to acknowledge appears in the KPIs.
- Open **Camera Wall** (live state of every camera) and **Safety Heatmap** (zone colours, fire marker at the camera, CCTV-detected workers).

## 4. The kill chain — compound risk (1.5 min) — Command Center
1. Press **↺ Reset demo**.
2. Press **1 · Silent drift**. CH4 in the Crude Distillation Unit climbs, but every sensor stays *NORMAL* and the risk stays *LOW*. Point to the **Lead time to alarm** KPI and the "↑ alarm in ~N min" chip. A threshold system sees nothing yet; SafeForge already has a forecast.
3. *(Optional)* On **Permit-to-Work**, try to approve the pending hot-work permit. Permit intelligence **blocks** it and quotes the gas reading.
4. Press **2 · Hot-work permit issued** (a paper permit that bypassed validation). Instantly:
   - risk → **CRITICAL**
   - Z-01 turns **red** on the heatmap
   - CR-001 fires with a knowledge-graph explanation (*PTW → active_in Z-01 → S-GAS-01 CH4 rising*)
   - the **autonomous emergency** declares, suspends the permit, freezes evidence and drafts the statutory report (see the **Emergency** page)

## 5. Close (30 s)
- **Runs at the edge.** The same models run in the browser and on the Python agent for RTSP cameras.
- **Stays reliable.** Temporal confirmation and a noise soak test keep false alarms down.
- **Explains itself.** Every alert carries its regulation, its graph path and its evidence frame.
- "SafeForge closes the gap between *data present* and *action taken*."

## Backup: Python edge agent
```bash
cd cv-service && ./start_cv.sh demo https://<backend-url>
```
Streams the sample media through the same models from Python. CAM-02 appears live on the Camera Wall.
