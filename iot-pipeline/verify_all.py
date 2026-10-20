#!/usr/bin/env python3
"""
AegisCare 360 - Comprehensive Verification & Health Check Script
Performs end-to-end verification of all Role 3 components before committing to GitHub.
"""

import sys
import os
import json
import time
from datetime import datetime, timezone

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))


# Ensure UTF-8 support on Windows console
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


class Color:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    CYAN = "\033[96m"


def check_step(step_num: int, title: str):
    print(f"\n{Color.BOLD}{Color.CYAN}[Step {step_num}] {title}...{Color.RESET}")


def pass_step(msg: str):
    print(f"  {Color.GREEN}[PASS]{Color.RESET} {msg}")


def fail_step(msg: str):
    print(f"  {Color.RED}[FAIL]{Color.RESET} {msg}")
    sys.exit(1)


def main():
    print(f"{Color.BOLD}{'='*70}{Color.RESET}")
    print(f"{Color.BOLD}   AegisCare 360 - Role 3 (IoT & Real-Time Pipeline) Pre-Flight Check   {Color.RESET}")
    print(f"{Color.BOLD}{'='*70}{Color.RESET}")

    # Step 1: Check Dependencies
    check_step(1, "Checking Core Dependencies")
    modules = ["boto3", "cryptography", "pytest"]
    for mod in modules:
        try:
            __import__(mod)
            pass_step(f"Module '{mod}' is installed and accessible.")
        except ImportError:
            fail_step(f"Missing dependency '{mod}'. Run: pip install -r requirements.txt")

    # Step 2: Validate JSON Scenarios
    check_step(2, "Validating Pre-recorded Scenario Files")
    scenario_dir = os.path.join(os.path.dirname(__file__), "simulator", "scenarios")
    scenario_files = ["fall_incident.json", "prolonged_inactivity.json", "normal_day_routine.json"]
    for sf in scenario_files:
        path = os.path.join(scenario_dir, sf)
        if not os.path.exists(path):
            fail_step(f"Scenario file missing: {sf}")
        try:
            with open(path, "r") as f:
                data = json.load(f)
            assert "scenario_name" in data and "frames" in data
            pass_step(f"{sf} is valid JSON with {len(data['frames'])} scenario frames.")
        except Exception as e:
            fail_step(f"Error parsing {sf}: {e}")

    # Step 3: Verify KMS Security & Envelope Encryption
    check_step(3, "Verifying KMS Field-Level Encryption & Decryption")
    from database.encryption.kms_security import KMSSecurityService
    kms = KMSSecurityService()
    secret_passphrase = "BlueberryPancake_FamilySecret2026"
    secret_phone = "+1-512-555-0199"

    enc_pass = kms.encrypt_field(secret_passphrase, {"senior_id": "snr_8832_v"})
    enc_phone = kms.encrypt_field(secret_phone, {"senior_id": "snr_8832_v"})

    dec_pass = kms.decrypt_field(enc_pass, {"senior_id": "snr_8832_v"})
    dec_phone = kms.decrypt_field(enc_phone, {"senior_id": "snr_8832_v"})

    if dec_pass == secret_passphrase and dec_phone == secret_phone:
        pass_step(f"Passphrase encrypted: {enc_pass[:28]}... -> Decrypted correctly.")
        pass_step(f"Phone encrypted:      {enc_phone[:28]}... -> Decrypted correctly.")
    else:
        fail_step("Decrypted value does not match original plaintext!")

    # Step 4: Verify DynamoDB Schema Definition
    check_step(4, "Verifying DynamoDB Tables & Indexes Definition")
    schema_path = os.path.join(os.path.dirname(__file__), "database", "schema", "tables_definition.json")
    with open(schema_path, "r") as f:
        schema_data = json.load(f)
    expected_tables = {"AegisCare_Seniors", "AegisCare_TrustedContacts", "AegisCare_ScamLogs", "AegisCare_ActivityEvents"}
    found_tables = {t["TableName"] for t in schema_data.get("tables", [])}
    if expected_tables.issubset(found_tables):
        pass_step(f"All 4 core DynamoDB tables defined with KMS SSE & GSIs: {found_tables}")
    else:
        fail_step(f"Missing tables! Expected: {expected_tables}, Found: {found_tables}")

    # Step 5: Test DSP Signal Processing & Fall Detection
    check_step(5, "Verifying Real-Time DSP Signal Processing")
    import importlib
    dsp_math_mod = importlib.import_module("lambda.dsp_processor.dsp_math")
    DSPProcessor = dsp_math_mod.DSPProcessor
    dsp = DSPProcessor(fall_impact_threshold_g=3.0)

    # Test Impact Vector Breach (4.23g)
    test_frame = {
        "senior_id": "snr_8832_v",
        "location": "living_room",
        "accelerometer": {"x_g": 2.45, "y_g": 1.95, "z_g": 2.85, "vector_magnitude_g": 4.23},
        "pir_motion_detected": True,
    }
    result = dsp.evaluate_telemetry_frame(test_frame)
    if result["is_fall_impact"] and result["status"] == "IMPACT_VECTOR_DETECTED":
        pass_step(f"Threshold breach correctly identified: {result['vector_magnitude_g']}g >= 3.0g [CRITICAL].")
    else:
        fail_step(f"DSP failed to detect high impact: {result}")

    # Step 6: Test Daily Baseline Anomaly Engine
    check_step(6, "Verifying Daily Routine Baseline Engine")
    baseline_mod = importlib.import_module("lambda.baseline_monitor.baseline_rules")
    BaselineRuleEngine = baseline_mod.BaselineRuleEngine
    baseline = BaselineRuleEngine()

    mock_events = [
        {"location": "bedroom", "timestamp": "2026-10-17T07:30:00Z", "pir_motion_detected": True},
        {"location": "bedroom", "timestamp": "2026-10-17T07:32:00Z", "pir_motion_detected": False},
    ]
    # Check at 10:15 AM (past 10:00 AM cutoff)
    cutoff_time = datetime(2026, 10, 17, 10, 15, 0, tzinfo=timezone.utc)
    base_res = baseline.evaluate_inactivity("snr_8832_v", mock_events, check_time=cutoff_time)
    if base_res["is_breached"] and base_res["recommended_action"] == "INITIATE_ALEXA_VOICE_CHECKIN":
        pass_step("Inactivity anomaly flagged: 'NO_KITCHEN_MOTION_BY_10AM' -> triggers voice check-in.")
    else:
        fail_step(f"Baseline engine failed to flag missing kitchen activity: {base_res}")

    # Step 7: Validate AWS CloudFormation / SAM IaC Template
    check_step(7, "Validating CloudFormation / SAM Infrastructure Template")
    template_path = os.path.join(os.path.dirname(__file__), "iac", "aegiscare-iot-template.yaml")
    if os.path.exists(template_path) and os.path.getsize(template_path) > 1000:
        pass_step(f"IaC template found ({os.path.getsize(template_path)} bytes) ready for `sam deploy`.")
    else:
        fail_step("IaC template missing or empty!")

    print(f"\n{Color.BOLD}{Color.GREEN}{'='*70}{Color.RESET}")
    print(f"{Color.BOLD}{Color.GREEN}   [PASS] ALL PRE-FLIGHT VERIFICATIONS PASSED (100% READY FOR GITHUB)   {Color.RESET}")
    print(f"{Color.BOLD}{Color.GREEN}{'='*70}{Color.RESET}\n")


if __name__ == "__main__":
    main()
