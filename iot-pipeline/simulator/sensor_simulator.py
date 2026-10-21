#!/usr/bin/env python3
"""
AegisCare 360 - IoT Sensor Simulator (sensor_simulator.py)
Streams mock ambient room motion, PIR inactivity events, and radar/accelerometer
fall events directly to AWS IoT Core over MQTT, or locally in mock mode.

Outputs events conforming to packages/core/src/events.ts:
  - Event DetailType: Sensor.AnomalyDetected
  - Anomaly Types: FALL_IMPACT, POST_IMPACT_IMMOBILITY, NO_MOTION_WINDOW, ROUTINE_MISSED
  - Metric Names: impact_g, immobile_seconds, no_motion_minutes
  - Key fields: room, baseline, demo=True

Usage:
  python sensor_simulator.py --scenario fall --mock
  python sensor_simulator.py --scenario inactivity --mock
  python sensor_simulator.py --scenario continuous --interval 1.0 --mock
  python sensor_simulator.py --scenario fall --endpoint xxx.iot.us-east-1.amazonaws.com \
                             --root-ca certs/AmazonRootCA1.pem \
                             --cert certs/device.pem.crt \
                             --key certs/device.private.key
"""

import sys
import os
import json
import time
import argparse
from typing import Optional, Dict, Any

from telemetry_generator import TelemetryGenerator

# Try importing AWSIoTPythonSDK
try:
    from AWSIoTPythonSDK.MQTTLib import AWSIoTMQTTClient
    HAVE_AWS_IOT = True
except ImportError:
    HAVE_AWS_IOT = False


class Color:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    MAGENTA = "\033[95m"


class SensorSimulator:
    def __init__(
        self,
        senior_id: str = "snr_8832_v",
        device_id: str = "esp32_hub_01",
        endpoint: Optional[str] = None,
        root_ca: Optional[str] = None,
        cert: Optional[str] = None,
        key: Optional[str] = None,
        mock_mode: bool = False,
    ):
        self.senior_id = senior_id
        self.device_id = device_id
        self.endpoint = endpoint
        self.root_ca = root_ca
        self.cert = cert
        self.key = key
        self.mock_mode = mock_mode or not (endpoint and cert and key)
        self.mqtt_client = None
        self.topic = f"aegiscare/seniors/{self.senior_id}/telemetry"
        self.generator = TelemetryGenerator(senior_id=senior_id, device_id=device_id)

    def connect(self) -> bool:
        """Initializes connection to AWS IoT Core or prepares mock mode."""
        if self.mock_mode:
            print(f"{Color.CYAN}[SIMULATOR] Operating in LOCAL MOCK / DRY-RUN mode.{Color.RESET}")
            print(f"{Color.CYAN}[SIMULATOR] Target Topic: {self.topic}{Color.RESET}\n")
            return True

        if not HAVE_AWS_IOT:
            print(f"{Color.RED}[ERROR] AWSIoTPythonSDK not installed. Falling back to MOCK mode.{Color.RESET}")
            self.mock_mode = True
            return True

        print(f"{Color.BLUE}[SIMULATOR] Connecting to AWS IoT Core at {self.endpoint}...{Color.RESET}")
        try:
            self.mqtt_client = AWSIoTMQTTClient(self.device_id)
            self.mqtt_client.configureEndpoint(self.endpoint, 8883)
            self.mqtt_client.configureCredentials(self.root_ca, self.key, self.cert)
            self.mqtt_client.configureAutoReconnectBackoffTime(1, 32, 20)
            self.mqtt_client.configureOfflinePublishQueueing(-1)
            self.mqtt_client.configureDrainingFrequency(2)
            self.mqtt_client.configureConnectDisconnectTimeout(10)
            self.mqtt_client.configureMQTTOperationTimeout(5)

            self.mqtt_client.connect()
            print(f"{Color.GREEN}[SIMULATOR] Successfully connected to AWS IoT Core!{Color.RESET}\n")
            return True
        except Exception as e:
            print(f"{Color.RED}[ERROR] Failed to connect to AWS IoT Core: {e}{Color.RESET}")
            print(f"{Color.YELLOW}[SIMULATOR] Switching to MOCK mode for execution.{Color.RESET}\n")
            self.mock_mode = True
            return True

    def format_eventbridge_event(self, anomaly_type: str, room: str, metrics: Dict[str, float], baseline: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Formats the standardized EventBridge Sensor.AnomalyDetected event."""
        now_ms = int(time.time() * 1000)
        return {
            "version": "0",
            "detail-type": "Sensor.AnomalyDetected",
            "source": "aegiscare.iot",
            "detail": {
                "schema_version": "1",
                "event_id": f"evt_{now_ms}",
                "senior_id": self.senior_id,
                "incident_id": f"inc_{anomaly_type.lower()}_{self.senior_id}_{now_ms}",
                "occurred_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "correlation_id": f"corr_{now_ms}",
                "demo": True,
                "device_id": self.device_id,
                "room": room,
                "anomaly_type": anomaly_type,
                "metrics": metrics,
                "baseline": baseline or {},
            }
        }

    def publish(self, payload: Dict[str, Any]) -> None:
        """Publishes a payload to AWS IoT Core or prints to console in mock mode."""
        room = payload.get("room") or payload.get("location", "unknown")
        metrics = payload.get("metrics", {})
        impact_g = metrics.get("impact_g") or payload.get("accelerometer", {}).get("vector_magnitude_g")
        immobile_sec = metrics.get("immobile_seconds") or payload.get("immobility_duration_sec")
        no_motion_min = metrics.get("no_motion_minutes") or payload.get("inactivity_minutes")
        anomaly_type = payload.get("anomaly_type")

        # Fallback anomaly detection tags
        if not anomaly_type:
            if impact_g and impact_g >= 3.0:
                anomaly_type = "FALL_IMPACT"
            elif immobile_sec and immobile_sec >= 10:
                anomaly_type = "POST_IMPACT_IMMOBILITY"
            elif payload.get("baseline_rule") == "NO_KITCHEN_MOTION_BY_10AM":
                anomaly_type = "ROUTINE_MISSED"

        status_tag = f"{Color.GREEN}[NORMAL TELEMETRY]{Color.RESET}"
        eb_event = None

        if anomaly_type == "FALL_IMPACT":
            status_tag = f"{Color.RED}{Color.BOLD}>>> [CRITICAL ANOMALY: FALL_IMPACT (impact_g: {impact_g})] <<<{Color.RESET}"
            eb_event = self.format_eventbridge_event(
                anomaly_type="FALL_IMPACT",
                room=room,
                metrics={"impact_g": float(impact_g)},
                baseline={"impact_threshold_g": 3.0},
            )
        elif anomaly_type == "POST_IMPACT_IMMOBILITY":
            status_tag = f"{Color.YELLOW}{Color.BOLD}[IMMOBILITY ANOMALY: POST_IMPACT_IMMOBILITY (immobile_seconds: {immobile_sec})] {Color.RESET}"
            eb_event = self.format_eventbridge_event(
                anomaly_type="POST_IMPACT_IMMOBILITY",
                room=room,
                metrics={"immobile_seconds": float(immobile_sec), "impact_g": float(impact_g or 1.0)},
                baseline={"immobility_threshold_seconds": 10.0},
            )
        elif anomaly_type in ("ROUTINE_MISSED", "NO_MOTION_WINDOW"):
            status_tag = f"{Color.YELLOW}{Color.BOLD}[SCHEDULE ANOMALY: {anomaly_type} (no_motion_minutes: {no_motion_min})] {Color.RESET}"
            eb_event = self.format_eventbridge_event(
                anomaly_type=anomaly_type,
                room=room,
                metrics={"no_motion_minutes": float(no_motion_min or 163.0)},
                baseline={"expected_room": "kitchen", "expected_by": "10:00"},
            )

        print(f"{status_tag} | Room: {room} | Time: {payload.get('timestamp')}")

        if not self.mock_mode and self.mqtt_client:
            self.mqtt_client.publish(self.topic, json.dumps(payload), 1)
        else:
            print(f"{Color.CYAN}MQTT Telemetry Payload ('{self.topic}'):{Color.RESET}")
            print(json.dumps(payload, indent=2))

        if eb_event:
            print(f"\n{Color.MAGENTA}{Color.BOLD}⚡ EventBridge 'AegisCareBus' Event Dispatched (For Safety Agent):{Color.RESET}")
            print(f"{Color.MAGENTA}{json.dumps(eb_event, indent=2)}{Color.RESET}")

        print("-" * 65)

    def run_fall_scenario(self, interval: float = 1.0) -> None:
        """Executes full fall sequence (Normal -> Freefall -> Violent Impact -> Immobility)."""
        print(f"{Color.BOLD}=== Scenario: Fall Incident Simulation (Living Room) ==={Color.RESET}\n")
        frames = self.generator.generate_fall_sequence(room="living_room")
        for frame in frames:
            self.publish(frame)
            time.sleep(interval)
        print(f"\n{Color.GREEN}[SIMULATOR] Fall incident scenario completed.{Color.RESET}")

    def run_inactivity_scenario(self) -> None:
        """Executes morning inactivity baseline breach scenario."""
        print(f"{Color.BOLD}=== Scenario: Morning Routine Missed Anomaly (ROUTINE_MISSED) ==={Color.RESET}\n")
        frame = self.generator.generate_morning_inactivity_event()
        self.publish(frame)
        print(f"\n{Color.GREEN}[SIMULATOR] Morning routine scenario completed.{Color.RESET}")

    def run_normal_routine(self, steps: int = 4, interval: float = 1.0) -> None:
        """Executes normal room transitions."""
        rooms = ["bedroom", "bathroom", "kitchen", "living_room"]
        print(f"{Color.BOLD}=== Scenario: Normal Routine Transitions ==={Color.RESET}\n")
        for i in range(steps):
            room = rooms[i % len(rooms)]
            frame = self.generator.generate_normal_motion_frame(room=room)
            self.publish(frame)
            time.sleep(interval)
        print(f"\n{Color.GREEN}[SIMULATOR] Normal routine scenario completed.{Color.RESET}")

    def run_continuous(self, interval: float = 1.5, count: Optional[int] = None) -> None:
        """Continuously streams realistic telemetry."""
        print(f"{Color.BOLD}=== Continuous Telemetry Streaming Mode (Ctrl+C to stop) ==={Color.RESET}\n")
        step = 0
        try:
            while count is None or step < count:
                step += 1
                frame = self.generator.generate_normal_motion_frame()
                self.publish(frame)
                time.sleep(interval)
        except KeyboardInterrupt:
            print(f"\n{Color.YELLOW}[SIMULATOR] Streaming stopped by user.{Color.RESET}")

    def disconnect(self) -> None:
        if not self.mock_mode and self.mqtt_client:
            self.mqtt_client.disconnect()
            print(f"{Color.BLUE}[SIMULATOR] Disconnected from AWS IoT Core.{Color.RESET}")


def load_config() -> Dict[str, Any]:
    """Loads configuration from config.json if available."""
    config_path = os.path.join(os.path.dirname(__file__), "..", "config.json")
    if os.path.exists(config_path):
        try:
            with open(config_path, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def main():
    parser = argparse.ArgumentParser(description="AegisCare 360 - IoT Sensor Simulator")
    parser.add_argument(
        "--scenario",
        choices=["fall", "inactivity", "normal", "continuous"],
        default="fall",
        help="Simulation scenario to run (default: fall)",
    )
    parser.add_argument("--senior-id", default="snr_8832_v", help="Senior ID (default: snr_8832_v)")
    parser.add_argument("--device-id", default="esp32_hub_01", help="Device ID (default: esp32_hub_01)")
    parser.add_argument("--endpoint", default=None, help="AWS IoT Core endpoint")
    parser.add_argument("--root-ca", default=None, help="Path to Root CA certificate")
    parser.add_argument("--cert", default=None, help="Path to device certificate (.pem.crt)")
    parser.add_argument("--key", default=None, help="Path to private key (.private.key)")
    parser.add_argument("--interval", type=float, default=1.0, help="Delay between telemetry frames in seconds")
    parser.add_argument("--count", type=int, default=None, help="Frame count for continuous streaming")
    parser.add_argument("--mock", action="store_true", help="Force mock dry-run mode without AWS IoT connection")

    args = parser.parse_args()
    config = load_config()

    endpoint = args.endpoint or config.get("iot_endpoint")
    root_ca = args.root_ca or config.get("root_ca_path")
    cert = args.cert or config.get("cert_path")
    key = args.key or config.get("key_path")

    sim = SensorSimulator(
        senior_id=args.senior_id,
        device_id=args.device_id,
        endpoint=endpoint,
        root_ca=root_ca,
        cert=cert,
        key=key,
        mock_mode=args.mock,
    )

    if not sim.connect():
        sys.exit(1)

    try:
        if args.scenario == "fall":
            sim.run_fall_scenario(interval=args.interval)
        elif args.scenario == "inactivity":
            sim.run_inactivity_scenario()
        elif args.scenario == "normal":
            sim.run_normal_routine(interval=args.interval)
        elif args.scenario == "continuous":
            sim.run_continuous(interval=args.interval, count=args.count)
    finally:
        sim.disconnect()


if __name__ == "__main__":
    main()
