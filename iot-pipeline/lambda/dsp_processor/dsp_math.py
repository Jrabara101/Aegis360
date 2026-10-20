"""
AegisCare 360 - DSP Signal Processing & Fall Detection Math
Executes edge signal processing on accelerometer & spatial telemetry.
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
        Extracts accelerometer readings, computes VM, and evaluates impact & immobility.
        """
        accel = telemetry.get("accelerometer", {})
        x = float(accel.get("x_g", 0.0))
        y = float(accel.get("y_g", 0.0))
        z = float(accel.get("z_g", 1.0))

        # Calculate or verify vector magnitude
        vm = accel.get("vector_magnitude_g")
        if vm is None:
            vm = self.calculate_vector_magnitude(x, y, z)
        else:
            vm = float(vm)

        immobility_sec = telemetry.get("immobility_duration_sec", 0)
        pir_motion = telemetry.get("pir_motion_detected", True)

        is_fall_impact = vm >= self.fall_impact_threshold_g
        is_immobile = (immobility_sec >= 5) or (not pir_motion and abs(vm - 1.0) < self.immobility_variance_threshold)

        result = {
            "senior_id": telemetry.get("senior_id", "unknown"),
            "location": telemetry.get("location", "unknown"),
            "timestamp": telemetry.get("timestamp"),
            "vector_magnitude_g": vm,
            "is_fall_impact": is_fall_impact,
            "is_immobile": is_immobile,
            "immobility_duration_sec": immobility_sec,
            "status": "NORMAL",
        }

        if is_fall_impact:
            result["status"] = "IMPACT_VECTOR_DETECTED"
            result["severity"] = "CRITICAL"
        elif is_immobile and immobility_sec >= 10:
            result["status"] = "POST_IMPACT_IMMOBILITY_CONFIRMED"
            result["severity"] = "HIGH"

        return result
