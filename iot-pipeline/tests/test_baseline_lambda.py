"""
Unit tests for Baseline Rule Engine and baseline_monitor Lambda
"""

import sys
import os
import json
from datetime import datetime, timezone
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import importlib
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
baseline_rules_mod = importlib.import_module("lambda.baseline_monitor.baseline_rules")
BaselineRuleEngine = baseline_rules_mod.BaselineRuleEngine
baseline_handler = importlib.import_module("lambda.baseline_monitor.index")


def test_baseline_evaluation_kitchen_activity_present():
    engine = BaselineRuleEngine()
    events = [
        {"location": "bedroom", "timestamp": "2026-10-17T07:30:00Z", "pir_motion_detected": True},
        {"location": "kitchen", "timestamp": "2026-10-17T08:45:00Z", "pir_motion_detected": True},
    ]
    # Check at 10:30 AM
    check_time = datetime(2026, 10, 17, 10, 30, 0, tzinfo=timezone.utc)
    res = engine.evaluate_inactivity("snr_8832_v", events, check_time=check_time)

    assert res["is_breached"] is False
    assert res["kitchen_motion_detected"] is True


def test_baseline_evaluation_kitchen_activity_missing():
    engine = BaselineRuleEngine()
    events = [
        {"location": "bedroom", "timestamp": "2026-10-17T07:30:00Z", "pir_motion_detected": True},
        {"location": "bedroom", "timestamp": "2026-10-17T07:32:00Z", "pir_motion_detected": False},
    ]
    # Check at 10:15 AM (past 10:00 AM cutoff)
    check_time = datetime(2026, 10, 17, 10, 15, 0, tzinfo=timezone.utc)
    res = engine.evaluate_inactivity("snr_8832_v", events, check_time=check_time)

    assert res["is_breached"] is True
    assert res["kitchen_motion_detected"] is False
    assert res["recommended_action"] == "INITIATE_ALEXA_VOICE_CHECKIN"


def test_baseline_lambda_handler_execution():
    event = {
        "senior_id": "snr_8832_v",
        "current_time": "10:15:00",
        "inactivity_minutes": 163,
        "baseline_rule": "NO_KITCHEN_MOTION_BY_10AM",
        "frames": [
            {"location": "bedroom", "timestamp": "2026-10-17T07:30:00Z", "pir_motion_detected": True},
        ]
    }
    response = baseline_handler.lambda_handler(event, None)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["is_breached"] is True
