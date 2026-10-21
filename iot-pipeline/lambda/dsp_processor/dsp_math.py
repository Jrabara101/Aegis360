"""
AegisCare 360 - DSP Signal Processing & Fall Detection Math
Executes edge signal processing on accelerometer & spatial telemetry.
Outputs metric names and anomaly types conforming to packages/core/src/events.ts:
  - Anomaly Types: FALL_IMPACT, POST_IMPACT_IMMOBILITY
  - Numeric Metrics: impact_g, immobile_seconds
"""

import math
from typing import Dict, Any, Tuple, Optional


class DSPProcessor:
    """Real-time Digital Signal Processing (DSP) for fall detection."""

    def __init__(
        self,
        fall_impact_threshold_g: float = 3.0,
        freefall_threshold_g: float = 0.6,
        immobility_variance_threshold: float = 0.05,
    ):
        self.fall_impact_threshold_g = fall_impact_threshold_g
        self.freefall_threshold_g = freefall_threshold_g
        self.immobility_variance_threshold = immobility_variance_threshold

    @staticmethod
    def calculate_vector_magnitude(x: float, y: float, z: float) -> float:
        """Computes Signal Vector Magnitude (SVM / VM): sqrt(x^2 + y^2 + z^2)."""
        return round(math.sqrt(x**2 + y**2 + z**2), 3)

    def evaluate_telemetry_frame(self, telemetry: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analyzes a single telemetry frame.
        Extracts accelerometer readings, computes VM (impact_g), and evaluates fall impact & immobility.
        """
        accel = telemetry.get("accelerometer", {})
        x = float(accel.get("x_g", 0.0))
        y = float(accel.get("y_g", 0.0))
        z = float(accel.get("z_g", 1.0))

        # Calculate or extract vector magnitude (impact_g)
        vm = accel.get("vector_magnitude_g")
        if vm is None:
            vm = self.calculate_vector_magnitude(x, y, z)
        else:
            vm = float(vm)

        immobility_sec = telemetry.get("immobility_duration_sec")
        if immobility_sec is None:
            immobility_sec = telemetry.get("immobile_seconds", 0)
        immobility_sec = float(immobility_sec)

        pir_motion = telemetry.get("pir_motion_detected", True)
        room = telemetry.get("room") or telemetry.get("location", "living_room")

        is_fall_impact = vm >= self.fall_impact_threshold_g
        is_immobile = (immobility_sec >= 5) or (not pir_motion and abs(vm - 1.0) < self.immobility_variance_threshold)

        anomaly_type = None
        severity = "NORMAL"

        if is_fall_impact:
            anomaly_type = "FALL_IMPACT"
            severity = "CRITICAL"
        elif is_immobile and immobility_sec >= 10:
            anomaly_type = "POST_IMPACT_IMMOBILITY"
            severity = "HIGH"

        metrics = {
            "impact_g": vm,
        }
        if immobility_sec > 0:
            metrics["immobile_seconds"] = immobility_sec

        return {
            "senior_id": telemetry.get("senior_id", "snr_8832_v"),
            "room": room,
            "timestamp": telemetry.get("timestamp"),
            "impact_g": vm,
            "immobile_seconds": immobility_sec,
            "is_fall_impact": is_fall_impact,
            "is_immobile": is_immobile,
            "anomaly_type": anomaly_type,
            "metrics": metrics,
            "baseline": {
                "impact_threshold_g": self.fall_impact_threshold_g,
                "immobility_threshold_seconds": 10.0,
            },
            "severity": severity,
            "status": anomaly_type or "NORMAL",
        }
