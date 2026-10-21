"""
Unit tests for AegisCare 360 Telemetry Generator & Simulator
Conforms to packages/core/src/events.ts:
  - Anomaly Types: FALL_IMPACT, POST_IMPACT_IMMOBILITY, ROUTINE_MISSED
  - Metric Names: impact_g, immobile_seconds, no_motion_minutes
  - Key fields: room, baseline
"""

import sys
import os
import math
import pytest

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "simulator")))
from telemetry_generator import TelemetryGenerator


def test_normal_motion_frame():
    gen = TelemetryGenerator(senior_id="snr_8832_v")
    frame = gen.generate_normal_motion_frame(room="kitchen")

    assert frame["senior_id"] == "snr_8832_v"
    assert frame["room"] == "kitchen"
    assert frame["sensor_type"] == "spatial_telemetry"
    assert frame["pir_motion_detected"] is True

    accel = frame["accelerometer"]
    vm = accel["vector_magnitude_g"]
    assert 0.8 <= vm <= 1.5
    assert frame["metrics"]["impact_g"] == vm


def test_fall_sequence_generation():
    gen = TelemetryGenerator(senior_id="snr_8832_v")
    frames = gen.generate_fall_sequence(room="living_room")

    assert len(frames) >= 7
    # Freefall frame should have low VM (< 0.6g)
    freefall_frame = frames[2]
    assert freefall_frame["accelerometer"]["vector_magnitude_g"] < 0.6

    # Impact frame should have high VM (> 3.5g) and anomaly_type FALL_IMPACT
    impact_frame = frames[3]
    assert impact_frame["accelerometer"]["vector_magnitude_g"] >= 4.0
    assert impact_frame["anomaly_type"] == "FALL_IMPACT"
    assert impact_frame["metrics"]["impact_g"] == 4.23
    assert impact_frame["room"] == "living_room"

    # Immobility frames should have pir_motion_detected False and POST_IMPACT_IMMOBILITY
    immobile_frame = frames[4]
    assert immobile_frame["pir_motion_detected"] is False
    assert immobile_frame["anomaly_type"] == "POST_IMPACT_IMMOBILITY"
    assert immobile_frame["metrics"]["immobile_seconds"] > 0


def test_morning_inactivity_event():
    gen = TelemetryGenerator(senior_id="snr_8832_v")
    event = gen.generate_morning_inactivity_event()

    assert event["sensor_type"] == "routine_baseline_telemetry"
    assert event["anomaly_type"] == "ROUTINE_MISSED"
    assert event["room"] == "kitchen"
    assert event["metrics"]["no_motion_minutes"] == 163.0
    assert event["pir_motion_detected"] is False
    assert "expected_by" in event["baseline"]
