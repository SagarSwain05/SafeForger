// Embedded MQTT Broker using Aedes
// Serves as the central message bus for IoT sensors, SCADA, and Python CV service
const aedesModule = require('aedes');
const aedesFactory = aedesModule.Aedes?.createBroker ? aedesModule.Aedes : (aedesModule.default || aedesModule);
const net = require('net');

const MQTT_PORT = 1883;

class MqttBroker {
  constructor() {
    this.broker = null;
    this.server = null;
    this.clients = new Set();
  }

  _setupEvents() {
    this.broker.on('client', (client) => {
      this.clients.add(client.id);
      console.log(`[MQTT] Client connected: ${client.id}`);
    });

    this.broker.on('clientDisconnect', (client) => {
      this.clients.delete(client.id);
      console.log(`[MQTT] Client disconnected: ${client.id}`);
    });

    this.broker.on('publish', (packet, client) => {
      if (client && packet.topic && !packet.topic.startsWith('$SYS')) {
        // Track message rate for monitoring
        this._lastPublish = { topic: packet.topic, ts: Date.now() };
      }
    });

    this.broker.on('subscribe', (subscriptions, client) => {
      const topics = subscriptions.map(s => s.topic).join(', ');
      console.log(`[MQTT] ${client?.id ?? 'unknown'} subscribed to: ${topics}`);
    });
  }

  async start() {
    this.broker = aedesFactory.createBroker
      ? await aedesFactory.createBroker()
      : aedesFactory();
    this.server = net.createServer(this.broker.handle);
    this._setupEvents();

    return new Promise((resolve, reject) => {
      this.server.listen(MQTT_PORT, () => {
        console.log(`[MQTT Broker] Aedes broker listening on port ${MQTT_PORT}`);
        resolve(this);
      });
      this.server.on('error', reject);
    });
  }

  publish(topic, payload) {
    if (!this.broker) return;
    const packet = {
      cmd: 'publish',
      topic,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      qos: 0,
      retain: false,
    };
    this.broker.publish(packet, (err) => {
      if (err) console.error(`[MQTT] Publish error on ${topic}:`, err.message);
    });
  }

  getStats() {
    return {
      connectedClients: this.clients.size,
      clientIds: [...this.clients],
      lastPublish: this._lastPublish ?? null,
      port: MQTT_PORT,
    };
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.broker || !this.server) return resolve();
      this.broker.close(() => {
        this.server.close(resolve);
      });
    });
  }
}

module.exports = MqttBroker;
