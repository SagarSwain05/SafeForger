// MQTT Ingestion Bridge — subscribes to plant topics on the embedded broker and routes them
// into the platform. Topics:
//   plant/{zone}/telemetry   IoT sensor readings (field gateways)
//   plant/{zone}/vision      CV detections from edge agents  → VisionHub
//   plant/scada/#            SCADA alarms / equipment states
//   plant/emergency          external emergency signals (e.g. manual call points)
const mqtt = require('mqtt');

class MqttIngestion {
  constructor({ port = 1883, onVision, onEmergency, io } = {}) {
    this.port = port;
    this.onVision = onVision;
    this.onEmergency = onEmergency;
    this.io = io;
    this.client = null;
    this.counts = { telemetry: 0, vision: 0, scada: 0, emergency: 0, other: 0 };
    this.lastMessageAt = null;
  }

  connect() {
    this.client = mqtt.connect(`mqtt://127.0.0.1:${this.port}`, {
      clientId: `safeforge-backend-${process.pid}`,
      reconnectPeriod: 2000,
      connectTimeout: 5000,
    });
    this.client.on('connect', () => {
      this.client.subscribe(['plant/+/telemetry', 'plant/+/vision', 'plant/scada/#', 'plant/emergency'], { qos: 0 });
      console.log('[MQTT] Ingestion bridge subscribed');
    });
    this.client.on('message', (topic, message) => this._handle(topic, message));
    this.client.on('error', (err) => console.warn('[MQTT] Ingestion error:', err.message));
  }

  _handle(topic, message) {
    let payload;
    try { payload = JSON.parse(message.toString()); } catch { return; }
    this.lastMessageAt = Date.now();
    const [, second, third] = topic.split('/');
    if (third === 'vision') {
      this.counts.vision++;
      // Our own edge agents send camera_id; the zone in the topic is authoritative
      this.onVision?.({ ...payload, zone: payload.zone || second, source: payload.source || 'mqtt' });
    } else if (third === 'telemetry') {
      this.counts.telemetry++;
    } else if (second === 'scada') {
      this.counts.scada++;
    } else if (second === 'emergency') {
      this.counts.emergency++;
      this.onEmergency?.(payload);
    } else {
      this.counts.other++;
    }
  }

  getStatus() {
    return { connected: !!this.client?.connected, messages: this.counts, lastMessageAt: this.lastMessageAt };
  }

  close() { this.client?.end(true); }
}

module.exports = { MqttIngestion };
