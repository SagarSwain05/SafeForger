"""
SafeForge MQTT Client — publishes vision detections to the plant MQTT bus (on-premise).
Topics:
  plant/{zone_id}/vision   — detection payload per zone (consumed by backend ingestion)
  plant/cv/{camera_id}     — per-camera stream
  plant/cv/heartbeat       — service health ping
"""
import json
import logging
import time
from typing import Any

logger = logging.getLogger("mqtt_client")


class SafeForgerMqttClient:
    def __init__(self, config: dict):
        cfg = config.get("mqtt", {})
        self.host = cfg.get("broker_host", "localhost")
        self.port = cfg.get("broker_port", 1883)
        self.client_id = cfg.get("client_id", "safeforge-cv")
        self.client = None
        self._connected = False
        try:
            import paho.mqtt.client as mqtt_lib
            # paho-mqtt ≥ 2.0 requires an explicit callback API version
            self.client = mqtt_lib.Client(mqtt_lib.CallbackAPIVersion.VERSION2, client_id=self.client_id)
            self.client.on_connect = self._on_connect
            self.client.on_disconnect = self._on_disconnect
            self.client.reconnect_delay_set(min_delay=1, max_delay=30)
            self.client.connect_async(self.host, self.port, keepalive=60)
            self.client.loop_start()  # handles reconnects in the background
            logger.info("Connecting to MQTT broker at %s:%s", self.host, self.port)
        except ImportError:
            logger.error("paho-mqtt not installed. Run: pip install paho-mqtt")
        except Exception as e:
            logger.warning("MQTT setup failed: %s", e)

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        self._connected = not reason_code.is_failure
        if self._connected:
            logger.info("MQTT connected")
            self.publish_heartbeat("CONNECTED")
        else:
            logger.warning("MQTT connection refused: %s", reason_code)

    def _on_disconnect(self, client, userdata, flags, reason_code, properties=None):
        self._connected = False
        logger.warning("MQTT disconnected (%s) — paho will reconnect", reason_code)

    def publish(self, topic: str, payload: Any, qos: int = 0):
        if not self._connected or self.client is None:
            return
        message = payload if isinstance(payload, str) else json.dumps(payload)
        self.client.publish(topic, message, qos=qos)

    def publish_vision(self, payload: dict):
        # Evidence images are large; MQTT consumers get the event list without them
        slim = {k: v for k, v in payload.items() if k != "evidence"}
        self.publish(f"plant/{payload['zone']}/vision", slim)
        self.publish(f"plant/cv/{payload['camera_id']}", slim)

    def publish_heartbeat(self, status: str = "OK"):
        self.publish("plant/cv/heartbeat", {
            "service": "safeforge-cv", "status": status,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        })

    def disconnect(self):
        if self.client:
            self.client.loop_stop()
            self.client.disconnect()

    @property
    def is_connected(self) -> bool:
        return self._connected
