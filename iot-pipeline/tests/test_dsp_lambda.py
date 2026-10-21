"""
Unit tests for DSP fall detection math and Lambda handler
Conforms to packages/core/src/events.ts:
  - Anomaly Types: FALL_IMPACT, POST_IMPACT_IMMOBILITY
  - Metric Names: impact_g, immobile_seconds
"""

import sys
import os
import json
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import importlib

dsp_math_mod = importlib.import_module("lambda.dsp_processor.dsp_math")
DSPProcessor = dsp_math_mod.DSPProcessor
dsp_handler = importlib.import_module("lambda.dsp_processor.index")


def test_vector_magnitude_calculation():
    # 3-4-5 right triangle extended to 3D: sqrt(1^2 + 2^2 + 2^2) = 3.0
    vm = DSPProcessor.calculate_vector_magnitude(1.0, 2.0, 2.0)
    assert vm == 3.0


def test_dsp_fall_detection_threshold():
    processor = DSPProcessor(fall_impact_threshold_g=3.0)

    # Frame below threshold (normal motion)
    normal_frame = {
        "senior_id": "snr_8832_v",
        "room": "bedroom",
        "location": "bedroom",
        "accelerometer": {"x_g": 0.1, "y_g": 0.1, "z_g": 1.0, "vector_magnitude_g": 1.01},
        "pir_motion_detected": True,
    }
    result = processor.evaluate_telemetry_frame(normal_frame)
    assert result["is_fall_impact"] is False
    assert result["status"] == "NORMAL"
    assert result["anomaly_type"] is None

    # Frame above threshold (4.23g breach -> FALL_IMPACT)
    impact_frame = {
        "senior_id": "snr_8832_v",
        "room": "living_room",
        "location": "living_room",
        "accelerometer": {"x_g": 2.45, "y_g": 1.95, "z_g": 2.85, "vector_magnitude_g": 4.23},
        "pir_motion_detected": True,
    }
    result = processor.evaluate_telemetry_frame(impact_frame)
    assert result["is_fall_impact"] is True
    assert result["anomaly_type"] == "FALL_IMPACT"
    assert result["impact_g"] == 4.23
    assert result["severity"] == "CRITICAL"


def test_dsp_lambda_handler_execution():
    impact_event = {
        "senior_id": "snr_8832_v",
        "device_id": "esp32_hub_01",
        "room": "living_room",
        "location": "living_room",
        "accelerometer": {"x_g": 2.45, "y_g": 1.95, "z_g": 2.85, "vector_magnitude_g": 4.23},
        "pir_motion_detected": True,
    }
    response = dsp_handler.lambda_handler(impact_event, None)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["anomaly_flagged"] is True
    assert body["dsp_result"]["anomaly_type"] == "FALL_IMPACT"
    assert body["event_detail"]["anomaly_type"] == "FALL_IMPACT"
    assert body["event_detail"]["metrics"]["impact_g"] == 4.23
    assert body["event_detail"]["room"] == "living_room"
