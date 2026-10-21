"""
AegisCare 360 - Telemetry Generator
Generates realistic ambient PIR motion, radar, and 6-axis accelerometer fall telemetry.
Conforms to packages/core/src/events.ts:
  - Anomaly types: FALL_IMPACT, POST_IMPACT_IMMOBILITY, NO_MOTION_WINDOW, ROUTINE_MISSED
  - Exact metric names: impact_g, immobile_seconds, no_motion_minutes
  - Key fields: room, baseline
"""

import time
import math
import random
from typing import Dict, Any, List

ROOMS = ["bedroom", "bathroom", "kitchen", "living_room", "hallway"]


class TelemetryGenerator:
    """Generates synthetic IoT telemetry and anomaly events for elderly care monitoring."""

    def __init__(self, senior_id: str = "snr_8832_v", device_id: str = "esp32_hub_01"):
        self.senior_id = senior_id
        self.device_id = device_id
        self.current_room = "bedroom"
        self.gravity = 1.0  # 1.0g standard earth gravity

    def generate_normal_motion_frame(self, room: str = None) -> Dict[str, Any]:
        """Generates normal movement telemetry (walking, sitting, minor gestures)."""
        if room:
            self.current_room = room

        noise_x = random.uniform(-0.15, 0.15)
        noise_y = random.uniform(-0.15, 0.15)
        z = random.uniform(0.90, 1.15)
        x = noise_x
        y = noise_y
        vm = math.sqrt(x**2 + y**2 + z**2)

        return {
            "version": "1.0",
            "message_id": f"msg_{int(time.time()*1000)}_{random.randint(100, 999)}",
            "senior_id": self.senior_id,
            "device_id": self.device_id,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "epoch_ms": int(time.time() * 1000),
            "sensor_type": "spatial_telemetry",
            "room": self.current_room,
            "location": self.current_room,
            "pir_motion_detected": True,
            "accelerometer": {
                "x_g": round(x, 3),
                "y_g": round(y, 3),
                "z_g": round(z, 3),
                "vector_magnitude_g": round(vm, 3),
            },
            "metrics": {
                "impact_g": round(vm, 3),
            },
            "gyroscope": {
                "pitch_deg_s": round(random.uniform(-10.0, 10.0), 2),
                "roll_deg_s": round(random.uniform(-10.0, 10.0), 2),
                "yaw_deg_s": round(random.uniform(-10.0, 10.0), 2),
            },
            "radar_presence": {
                "detected": True,
                "breathing_rate_bpm": random.randint(14, 18),
                "heart_rate_bpm": random.randint(68, 76),
            },
            "battery_pct": 98,
        }

    def generate_immobility_frame(self, room: str = "living_room", duration_sec: int = 15) -> Dict[str, Any]:
        """Generates post-impact or prolonged motionless state (senior unable to move)."""
        self.current_room = room
        x = random.uniform(0.96, 0.98)
        y = random.uniform(0.01, 0.03)
        z = random.uniform(0.01, 0.03)
        vm = math.sqrt(x**2 + y**2 + z**2)

        return {
            "version": "1.0",
            "message_id": f"msg_{int(time.time()*1000)}_{random.randint(100, 999)}",
            "senior_id": self.senior_id,
            "device_id": self.device_id,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "epoch_ms": int(time.time() * 1000),
            "sensor_type": "spatial_telemetry",
            "room": self.current_room,
            "location": self.current_room,
            "pir_motion_detected": False,
            "anomaly_type": "POST_IMPACT_IMMOBILITY",
            "accelerometer": {
                "x_g": round(x, 3),
                "y_g": round(y, 3),
                "z_g": round(z, 3),
                "vector_magnitude_g": round(vm, 3),
            },
            "metrics": {
                "impact_g": round(vm, 3),
                "immobile_seconds": float(duration_sec),
            },
            "baseline": {
                "immobility_threshold_seconds": 10.0,
            },
            "gyroscope": {
                "pitch_deg_s": 0.0,
                "roll_deg_s": 0.0,
                "yaw_deg_s": 0.0,
            },
            "radar_presence": {
                "detected": True,
                "breathing_rate_bpm": random.randint(22, 28),
                "heart_rate_bpm": random.randint(95, 110),
            },
            "immobile_seconds": float(duration_sec),
            "immobility_duration_sec": duration_sec,
            "battery_pct": 98,
        }

    def generate_fall_sequence(self, room: str = "living_room") -> List[Dict[str, Any]]:
        """
        Generates a 3-phase high-fidelity deterministic fall sequence:
        Phase 1: Normal pre-fall walking (VM ~ 1.0g)
        Phase 2: Freefall drop (VM ~ 0.4g) followed by sudden hard ground impact (VM = 4.23g -> FALL_IMPACT)
        Phase 3: Post-impact immobility (POST_IMPACT_IMMOBILITY)
        """
        self.current_room = room
        frames: List[Dict[str, Any]] = []

        # 1. Pre-fall normal movement
        for _ in range(2):
            frames.append(self.generate_normal_motion_frame(room=room))

        # 2. Freefall initiation
        frames.append({
            "version": "1.0",
            "message_id": f"msg_{int(time.time()*1000)}_ff",
            "senior_id": self.senior_id,
            "device_id": self.device_id,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "epoch_ms": int(time.time() * 1000),
            "sensor_type": "spatial_telemetry",
            "room": room,
            "location": room,
            "pir_motion_detected": True,
            "accelerometer": {
                "x_g": 0.12,
                "y_g": 0.18,
                "z_g": 0.35,
                "vector_magnitude_g": 0.41,
            },
            "metrics": {"impact_g": 0.41},
            "gyroscope": {"pitch_deg_s": 120.4, "roll_deg_s": 85.2, "yaw_deg_s": 45.1},
            "radar_presence": {"detected": True, "breathing_rate_bpm": 18, "heart_rate_bpm": 80},
            "battery_pct": 98,
        })

        # 3. Violent ground impact (Peak impact: 4.23g breach)
        frames.append({
            "version": "1.0",
            "message_id": f"msg_{int(time.time()*1000)}_impact",
            "senior_id": self.senior_id,
            "device_id": self.device_id,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "epoch_ms": int(time.time() * 1000),
            "sensor_type": "spatial_telemetry",
            "room": room,
            "location": room,
            "pir_motion_detected": True,
            "anomaly_type": "FALL_IMPACT",
            "accelerometer": {
                "x_g": 2.45,
                "y_g": 1.95,
                "z_g": 2.85,
                "vector_magnitude_g": 4.23,
            },
            "metrics": {
                "impact_g": 4.23,
            },
            "baseline": {
                "impact_threshold_g": 3.0,
            },
            "gyroscope": {"pitch_deg_s": 240.5, "roll_deg_s": 190.2, "yaw_deg_s": 88.0},
            "radar_presence": {"detected": True, "breathing_rate_bpm": 24, "heart_rate_bpm": 105},
            "battery_pct": 98,
        })

        # 4. Immediate post-impact immobility frames
        for i in range(4):
            immobile_frame = self.generate_immobility_frame(room=room, duration_sec=(i + 1) * 5)
            frames.append(immobile_frame)

        return frames

    def generate_morning_inactivity_event(self) -> Dict[str, Any]:
        """
        Generates daily routine anomaly: senior was expected in kitchen by 10:00 AM,
        but only bedroom motion stopped at 07:30 AM and no subsequent motion was recorded.
        Anomaly type: ROUTINE_MISSED. Metric: no_motion_minutes: 163.0.
        """
        return {
            "version": "1.0",
            "message_id": f"msg_{int(time.time()*1000)}_inactivity",
            "senior_id": self.senior_id,
            "device_id": self.device_id,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "epoch_ms": int(time.time() * 1000),
            "sensor_type": "routine_baseline_telemetry",
            "room": "kitchen",
            "location": "kitchen",
            "pir_motion_detected": False,
            "anomaly_type": "ROUTINE_MISSED",
            "metrics": {
                "no_motion_minutes": 163.0,
            },
            "baseline": {
                "expected_room": "kitchen",
                "expected_by": "10:00",
                "max_inactivity_window_minutes": 120.0,
            },
            "expected_active_by": "10:00:00",
            "current_time": "10:15:00",
            "last_detected_room": "bedroom",
            "last_detected_timestamp": "2026-10-21T07:32:00Z",
            "inactivity_minutes": 163.0,
            "battery_pct": 97,
        }
