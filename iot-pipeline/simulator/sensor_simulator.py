#!/usr/bin/env python3
"""
AegisCare 360 - IoT Sensor Simulator (sensor_simulator.py)
Streams mock ambient room motion, PIR inactivity events, and radar/accelerometer
fall events directly to AWS IoT Core over MQTT, or locally in mock mode.

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

    def publish(self, payload: Dict[str, Any]) -> None:
        """Publishes a payload to AWS IoT Core or prints to console in mock mode."""
        json_data = json.dumps(payload, indent=2)

        # Highlight critical fall impact or inactivity in console
        vm = payload.get("accelerometer", {}).get("vector_magnitude_g")
        immobility = payload.get("immobility_duration_sec")
        baseline_rule = payload.get("baseline_rule")

        status_tag = f"{Color.GREEN}[NORMAL TELEMETRY]{Color.RESET}"
        if vm and vm > 3.0:
            status_tag = f"{Color.RED}{Color.BOLD}>>> [CRITICAL FALL IMPACT DETECTED: {vm}g] <<<{Color.RESET}"
        elif immobility and immobility > 0:
            status_tag = f"{Color.YELLOW}{Color.BOLD}[POST-IMPACT IMMOBILITY: {immobility}s]{Color.RESET}"
        elif baseline_rule:
            status_tag = f"{Color.YELLOW}{Color.BOLD}[INACTIVITY ANOMALY: {baseline_rule}]{Color.RESET}"

        print(f"{status_tag} | Room: {payload.get('location')} | Time: {payload.get('timestamp')}")

        if not self.mock_mode and self.mqtt_client:
            self.mqtt_client.publish(self.topic, json.dumps(payload), 1)
        else:
            # Print payload summary
            print(f"{Color.CYAN}Payload published to '{self.topic}':{Color.RESET}")
            print(json.dumps(payload, indent=2))
            print("-" * 60)

    def run_fall_scenario(self, interval: float = 1.0) -> None:
        """Executes full fall sequence (Normal -> Freefall -> Violent Impact -> Immobility)."""
        print(f"{Color.BOLD}=== Scenario: Fall Incident Simulation (Living Room) ==={Color.RESET}\n")
        frames = self.generator.generate_fall_sequence(room="living_room")
        for i, frame in enumerate(frames, 1):
            self.publish(frame)
            time.sleep(interval)
        print(f"\n{Color.GREEN}[SIMULATOR] Fall incident scenario completed.{Color.RESET}")

    def run_inactivity_scenario(self) -> None:
        """Executes morning inactivity baseline breach scenario."""
        print(f"{Color.BOLD}=== Scenario: Morning Inactivity Anomaly ==={Color.RESET}\n")
        frame = self.generator.generate_morning_inactivity_event()
        self.publish(frame)
        print(f"\n{Color.GREEN}[SIMULATOR] Morning inactivity scenario completed.{Color.RESET}")

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
