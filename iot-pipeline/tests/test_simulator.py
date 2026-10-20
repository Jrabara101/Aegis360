"""
Unit tests for AegisCare 360 Telemetry Generator & Simulator
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
    assert frame["location"] == "kitchen"
    assert frame["sensor_type"] == "spatial_telemetry"
    assert frame["pir_motion_detected"] is True

    accel = frame["accelerometer"]
    vm = accel["vector_magnitude_g"]
    # Normal movement is around 0.9 - 1.3g
    assert 0.8 <= vm <= 1.5


def test_fall_sequence_generation():
    gen = TelemetryGenerator(senior_id="snr_8832_v")
    frames = gen.generate_fall_sequence(room="living_room")

    assert len(frames) >= 7
    # Freefall frame should have low VM (< 0.6g)
    freefall_frame = frames[2]
    assert freefall_frame["accelerometer"]["vector_magnitude_g"] < 0.6

    # Impact frame should have high VM (> 3.5g)
    impact_frame = frames[3]
    assert impact_frame["accelerometer"]["vector_magnitude_g"] >= 4.0

    # Immobility frames should have pir_motion_detected False
    immobile_frame = frames[4]
    assert immobile_frame["pir_motion_detected"] is False
    assert immobile_frame["immobility_duration_sec"] > 0


def test_morning_inactivity_event():
    gen = TelemetryGenerator(senior_id="snr_8832_v")
    event = gen.generate_morning_inactivity_event()

    assert event["sensor_type"] == "routine_baseline_telemetry"
    assert event["baseline_rule"] == "NO_KITCHEN_MOTION_BY_10AM"
    assert event["inactivity_minutes"] > 60
    assert event["pir_motion_detected"] is False
