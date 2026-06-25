// MQTT Ingestion Bridge — subscribes to plant topics and bridges to WebSocket
// Topics:
//   plant/{zone}/telemetry   — IoT sensor readings
//   plant/{zone}/vision      — CV detections from Python service
//   plant/scada/{equipment}  — SCADA equipment states
//   plant/emergency          — Emergency signals
const mqtt = require('mqtt');

const TOPIC_HANDLERS = {};
let _io = null;
let _sensorCallback = null;
let _cvCallback = null;

// Store latest CV detections per zone
const cvDetectionStore = {};

class MqttIngestion {
  constructor(io) {
    _io = io;
    this.client = null;
    this.subscriptions = new Map();
  }

  connect() {
    this.client = mqtt.connect('mqtt://localhost:1883', {
      clientId: 'safeforger-backend',
      reconnectPeriod: 2000,
      connectTimeout: 5000,
    });

    this.client.on('connect', () => {
      console.log('[MQTT Ingestion] Connected to broker');
      this._subscribeAll();
    });

    this.client.on('message', (topic, message) => {
      this._handleMessage(topic, message);
    });

    this.client.on('error', (err) => {
      console.warn('[MQTT Ingestion] Error:', err.message);
    });

    this.client.on('reconnect', () => {
      console.log('[MQTT Ingestion] Reconnecting…');
    });
  }

  _subscribeAll() {
    const topics = [
      'plant/+/telemetry',   // IoT sensors
      'plant/+/vision',      // CV detections
      'plant/scada/#',       // SCADA equipment
      'plant/emergency',     // Emergency signals
      'plant/worker/#',      // Worker tracking
    ];
    topics.forEach(topic => this.client.subscribe(topic, { qos: 0 }));
    console.log('[MQTT Ingestion] Subscribed to', topics.length, 'topic patterns');
  }

  _handleMessage(topic, message) {
    let payload;
    try {
      payload = JSON.parse(message.toString());
    } catch {
      payload = message.toString();
    }

    const parts = topic.split('/');
    const domain = parts[0];
    const zone = parts[1];
    const dataType = parts[2];

    // Normalize into unified event
    const event = {
      topic,
      zone,
      dataType,
      timestamp: new Date().toISOString(),
      data: payload,
    };

    // Route to appropriate handler
    if (dataType === 'telemetry') {
      this._handleTelemetry(zone, payload, event);
    } else if (dataType === 'vision') {
      this._handleVisionDetection(zone, payload, event);
    } else if (parts[1] === 'scada') {
      this._handleScada(parts[2], payload, event);
    } else if (zone === 'emergency') {
      _io?.emit('mqtt:emergency', event);
    }

    // Broadcast raw event to frontend for monitoring
    _io?.emit('mqtt:event', event);
  }

  _handleTelemetry(zone, payload, event) {
    // Forward IoT sensor reading to connected clients
    _io?.emit('mqtt:telemetry', {
      zone,
      sensors: payload,
      timestamp: event.timestamp,
    });

    // Call sensor update callback if registered
    if (_sensorCallback) _sensorCallback(zone, payload);
  }

  _handleVisionDetection(zone, payload, event) {
    const normalized = {
      ...payload,
      zone,
      camera_id: payload.camera_id ?? payload.cameraId,
      cameraId: payload.cameraId ?? payload.camera_id,
      worker_count: payload.worker_count ?? payload.workerCount ?? 0,
      workerCount: payload.workerCount ?? payload.worker_count ?? 0,
      ppe_violations: payload.ppe_violations ?? payload.ppeViolations ?? 0,
      ppeViolations: payload.ppeViolations ?? payload.ppe_violations ?? 0,
      mapped_positions: payload.mapped_positions ?? payload.mappedPositions ?? [],
      mappedPositions: payload.mappedPositions ?? payload.mapped_positions ?? [],
      smoke_detected: payload.smoke_detected ?? payload.smokeDetected ?? false,
      smokeDetected: payload.smokeDetected ?? payload.smoke_detected ?? false,
      receivedAt: Date.now(),
      timestamp: payload.timestamp ?? event.timestamp,
    };

    // Store latest CV detections
    cvDetectionStore[zone] = normalized;

    // Broadcast to frontend for live CCTV overlay
    _io?.emit('cv:detection', normalized);

    if (_cvCallback) _cvCallback(zone, normalized);
  }

  _handleScada(equipment, payload, event) {
    _io?.emit('scada:update', {
      equipment,
      status: payload.status,
      value: payload.value,
      unit: payload.unit,
      registerAddress: payload.register_address,
      timestamp: event.timestamp,
    });
  }

  onTelemetry(callback) { _sensorCallback = callback; }
  onVision(callback) { _cvCallback = callback; }

  getCvDetections() { return { ...cvDetectionStore }; }

  getCvDetectionsByZone(zoneId) { return cvDetectionStore[zoneId] ?? null; }

  publishToTopic(topic, payload) {
    if (!this.client?.connected) return;
    this.client.publish(topic, JSON.stringify(payload), { qos: 0 });
  }

  getStatus() {
    return {
      connected: this.client?.connected ?? false,
      cvZones: Object.keys(cvDetectionStore),
      lastActivity: Object.values(cvDetectionStore).map(d => d.receivedAt).sort().pop() ?? null,
    };
  }
}

module.exports = { MqttIngestion, cvDetectionStore };
