#!/usr/bin/env python3
"""
AegisCare 360 - DynamoDB Setup & Seed Script
Provisions tables (Seniors, TrustedContacts, ScamLogs, ActivityEvents)
and seeds initial test data with KMS encrypted passphrases and phone numbers.
"""

import os
import sys
import json
import argparse
from typing import Dict, Any

# Add project root to path for imports
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from database.encryption.kms_security import KMSSecurityService

try:
    import boto3
    from botocore.exceptions import ClientError
    HAVE_BOTO3 = True
except ImportError:
    HAVE_BOTO3 = False


def create_tables(dynamodb, schema_path: str):
    """Creates tables specified in tables_definition.json."""
    with open(schema_path, "r") as f:
        config = json.load(f)

    existing_tables = dynamodb.meta.client.list_tables().get("TableNames", [])
    print(f"[DynamoDB] Existing tables: {existing_tables}")

    for table_def in config.get("tables", []):
        table_name = table_def["TableName"]
        if table_name in existing_tables:
            print(f"[DynamoDB] Table '{table_name}' already exists. Skipping creation.")
            continue

        print(f"[DynamoDB] Creating table '{table_name}'...")
        kwargs = {
            "TableName": table_name,
            "KeySchema": table_def["KeySchema"],
            "AttributeDefinitions": table_def["AttributeDefinitions"],
            "BillingMode": table_def.get("BillingMode", "PAY_PER_REQUEST"),
        }
        if "GlobalSecondaryIndexes" in table_def:
            kwargs["GlobalSecondaryIndexes"] = table_def["GlobalSecondaryIndexes"]
        if "SSESpecification" in table_def:
            kwargs["SSESpecification"] = table_def["SSESpecification"]

        table = dynamodb.create_table(**kwargs)
        table.wait_until_exists()
        print(f"[DynamoDB] Table '{table_name}' created successfully (Status: {table.table_status}).")


def seed_demo_data(dynamodb, kms_service: KMSSecurityService):
    """Seeds initial demonstration data with encrypted sensitive fields."""
    print("\n[DynamoDB] Seeding demonstration data with KMS encrypted fields...")

    # 1. Senior Profile
    seniors_table = dynamodb.Table("AegisCare_Seniors")
    senior_item = {
        "senior_id": "snr_8832_v",
        "full_name": "Eleanor Vance",
        "age": 82,
        "address": "452 Willow Creek Rd, Austin, TX",
        "emergency_status": "NORMAL",
        "baseline_schedule": {
            "wake_time": "07:30",
            "kitchen_expected_by": "10:00",
            "evening_bedtime": "22:00"
        },
        "assigned_caregivers": ["usr_cg_101"],
        "created_at": "2026-10-12T00:00:00Z",
        "updated_at": "2026-10-17T16:00:00Z",
    }
    seniors_table.put_item(Item=senior_item)
    print("  ✓ Seeded Senior profile: Eleanor Vance (ID: snr_8832_v)")

    # 2. Trusted Contacts with Encrypted Passphrase & Phone
    contacts_table = dynamodb.Table("AegisCare_TrustedContacts")
    raw_passphrase = "BlueberryPancake"
    raw_phone = "+1-512-555-0199"

    enc_passphrase = kms_service.encrypt_field(raw_passphrase, {"senior_id": "snr_8832_v", "field": "passphrase"})
    enc_phone = kms_service.encrypt_field(raw_phone, {"senior_id": "snr_8832_v", "field": "phone_number"})

    contact_item = {
        "contact_id": "cnt_9901",
        "senior_id": "snr_8832_v",
        "name": "Sarah Vance",
        "relationship": "Daughter",
        "phone_number_encrypted": enc_phone,
        "family_passphrase_encrypted": enc_passphrase,
        "notification_tier": 1,
        "is_emergency_proxy": True,
        "created_at": "2026-10-12T00:00:00Z",
    }
    contacts_table.put_item(Item=contact_item)
    print(f"  ✓ Seeded Trusted Contact: Sarah Vance (Daughter) with KMS Encrypted Passphrase")

    # 3. Sample Scam Log
    scam_table = dynamodb.Table("AegisCare_ScamLogs")
    scam_item = {
        "log_id": "slog_20261017_001",
        "senior_id": "snr_8832_v",
        "timestamp": "2026-10-17T14:32:10Z",
        "caller_id": "+18005550199",
        "threat_score": 0.92,
        "detected_vectors": [
            "VOICE_CLONE_CONFIRMED",
            "URGENT_WIRE_TRANSFER_DEMAND"
        ],
        "action_taken": "CALL_TERMINATED_AND_CAREGIVER_ALERTED",
        "raw_telemetry_ref": "s3://aegiscare-telemetry-logs/2026/10/17/call-98765.json",
    }
    scam_table.put_item(Item=scam_item)
    print("  ✓ Seeded baseline Scam Log: slog_20261017_001")

    # 4. Activity Events
    activity_table = dynamodb.Table("AegisCare_ActivityEvents")
    activity_item = {
        "senior_id": "snr_8832_v",
        "timestamp": "2026-10-17T07:30:00Z",
        "event_id": "evt_init_001",
        "event_type": "NORMAL_MOTION",
        "location": "bedroom",
        "g_force": 1.02,
        "immobility_detected": False,
        "processed_by": "aegiscare.iot.dsp",
    }
    activity_table.put_item(Item=activity_item)
    print("  ✓ Seeded initial Activity Event: evt_init_001")
    print("[DynamoDB] Seeding completed successfully!\n")


def run_mock_seeding(kms_service: KMSSecurityService):
    """Outputs demo table records to console/JSON in offline mode."""
    print("\n[MOCK MODE] Simulating DynamoDB provisioning and KMS encryption:")
    raw_passphrase = "BlueberryPancake"
    raw_phone = "+1-512-555-0199"

    enc_passphrase = kms_service.encrypt_field(raw_passphrase)
    enc_phone = kms_service.encrypt_field(raw_phone)

    print(f"  Plain Passphrase:     '{raw_passphrase}'")
    print(f"  KMS Encrypted:        '{enc_passphrase}'")
    print(f"  Decrypted Plaintext:  '{kms_service.decrypt_field(enc_passphrase)}'\n")

    print(f"  Plain Phone:          '{raw_phone}'")
    print(f"  KMS Encrypted:        '{enc_phone}'")
    print(f"  Decrypted Plaintext:  '{kms_service.decrypt_field(enc_phone)}'\n")

    print("[MOCK MODE] Tables: AegisCare_Seniors, AegisCare_TrustedContacts, AegisCare_ScamLogs, AegisCare_ActivityEvents")


def main():
    parser = argparse.ArgumentParser(description="AegisCare 360 - Provision DynamoDB and KMS")
    parser.add_argument("--region", default="us-east-1", help="AWS Region (default: us-east-1)")
    parser.add_argument("--endpoint-url", default=None, help="Custom DynamoDB endpoint (e.g. http://localhost:8000)")
    parser.add_argument("--kms-key-id", default=None, help="AWS KMS Key ID or Alias ARN")
    parser.add_argument("--mock", action="store_true", help="Run local test/validation without AWS connection")
    args = parser.parse_args()

    kms_service = KMSSecurityService(key_id=args.kms_key_id, region_name=args.region)
    schema_path = os.path.join(os.path.dirname(__file__), "tables_definition.json")

    if args.mock or not HAVE_BOTO3:
        run_mock_seeding(kms_service)
        return

    try:
        kwargs = {"region_name": args.region}
        if args.endpoint_url:
            kwargs["endpoint_url"] = args.endpoint_url
        dynamodb = boto3.resource("dynamodb", **kwargs)
        create_tables(dynamodb, schema_path)
        seed_demo_data(dynamodb, kms_service)
    except Exception as e:
        print(f"[WARNING] Could not connect to AWS DynamoDB: {e}")
        print("[INFO] Running in mock validation mode instead:")
        run_mock_seeding(kms_service)


if __name__ == "__main__":
    main()
