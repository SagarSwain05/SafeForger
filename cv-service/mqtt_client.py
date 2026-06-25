"""
SafeForger MQTT Client — Publishes CV detections to MQTT broker
Topics:
  plant/{zone_id}/vision   — detection results per zone
  plant/cv/aggregate       — cross-camera aggregate stats
  plant/cv/heartbeat       — service health ping
"""
import json
import time
import logging
import threading
from typing import Optional, Dict, Any

logger = logging.getLogger("mqtt_client")


class SafeForgerMqttClient:
    def __init__(self, config: dict):
        self.cfg = config.get("mqtt", {})
        self.host = self.cfg.get("broker_host", "localhost")
        self.port = self.cfg.get("broker_port", 1883)
        self.client_id = self.cfg.get("client_id", "safeforger-cv")
        self.reconnect_delay = self.cfg.get("reconnect_delay_s", 5)
        self.client = None
        self._connected = False
        self._connect()

    def _connect(self):
        try:
            import paho.mqtt.client as mqtt_lib
            self.client = mqtt_lib.Client(client_id=self.client_id)
            self.client.on_connect = self._on_connect
            self.client.on_disconnect = self._on_disconnect
            self.client.connect(self.host, self.port, keepalive=60)
            self.client.loop_start()
            logger.info(f"Connecting to MQTT broker at {self.host}:{self.port}")
        except ImportError:
            logger.error("paho-mqtt not installed. Run: pip install paho-mqtt")
        except Exception as e:
            logger.warning(f"MQTT connection failed: {e}. Will retry in {self.reconnect_delay}s")
            threading.Timer(self.reconnect_delay, self._connect).start()

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            self._connected = True
            logger.info("MQTT connected successfully")
            self.publish_heartbeat("CONNECTED")
        else:
            logger.warning(f"MQTT connection returned code {rc}")

    def _on_disconnect(self, client, userdata, rc):
        self._connected = False
        logger.warning(f"MQTT disconnected (rc={rc}). Reconnecting in {self.reconnect_delay}s")
        threading.Timer(self.reconnect_delay, self._connect).start()

    def publish(self, topic: str, payload: Any, qos: int = 0):
        """Publish JSON payload to topic."""
        if not self._connected or self.client is None:
            logger.debug(f"MQTT not connected — dropping message on {topic}")
            return
        try:
            message = json.dumps(payload) if not isinstance(payload, str) else payload
            result = self.client.publish(topic, message, qos=qos)
            if result.rc != 0:
                logger.warning(f"Publish to {topic} failed: rc={result.rc}")
        except Exception as e:
            logger.warning(f"MQTT publish error: {e}")

    def publish_vision_detection(
        self,
        camera_id: str,
        zone_id: str,
        detections: dict,
        frame_number: int = 0,
    ):
        """Publish structured detection event to plant zone topic."""
        payload = {
            "camera_id": camera_id,
            "zone": zone_id,
            "frame_number": frame_number,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "worker_count": detections.get("worker_count", 0),
            "ppe_violations": detections.get("ppe_violation_count", 0),
            "smoke_detected": detections.get("smoke_detected", False),
            "detections": self._serialize_detections(detections),
            "mapped_positions": detections.get("mapped_positions", []),
            "zones_occupied": detections.get("zones_occupied", []),
        }
        topic = f"plant/{zone_id}/vision"
        self.publish(topic, payload)

        # Also publish to per-camera topic for multi-camera aggregation
        self.publish(f"plant/cv/{camera_id}", payload)

    def _serialize_detections(self, detections: dict) -> list:
        """Compact format for MQTT payload."""
        out = []
        for person in detections.get("persons", []):
            out.append({
                "id": person.get("id"),
                "type": "person",
                "bbox": person.get("bbox"),
                "confidence": person.get("confidence"),
                "has_helmet": person.get("has_helmet"),
                "has_vest": person.get("has_vest"),
                "plant_coords": person.get("plant_coords"),
                "zone_id": person.get("zone_id"),
            })
        for viol in detections.get("violations", []):
            out.append({
                "type": "violation",
                "class": viol.get("class"),
                "confidence": viol.get("confidence"),
                "bbox": viol.get("bbox"),
            })
        return out

    def publish_aggregate(self, camera_stats: Dict[str, dict]):
        """Publish cross-camera aggregate stats."""
        total_workers = sum(s.get("worker_count", 0) for s in camera_stats.values())
        total_violations = sum(s.get("ppe_violations", 0) for s in camera_stats.values())
        smoke_zones = [cid for cid, s in camera_stats.items() if s.get("smoke_detected")]
        payload = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "total_workers_detected": total_workers,
            "total_ppe_violations": total_violations,
            "smoke_detected_cameras": smoke_zones,
            "per_camera": camera_stats,
        }
        self.publish("plant/cv/aggregate", payload)

    def publish_heartbeat(self, status: str = "OK"):
        self.publish("plant/cv/heartbeat", {
            "service": "safeforger-cv",
            "status": status,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        })

    def disconnect(self):
        if self.client:
            self._connected = False
            self.client.loop_stop()
            self.client.disconnect()

    @property
    def is_connected(self) -> bool:
        return self._connected
