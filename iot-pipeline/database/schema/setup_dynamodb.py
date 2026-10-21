#!/usr/bin/env python3
"""
AegisCare 360 - DynamoDB Setup & Seed Script
Provisions all 6 core tables defined in infra/lib/data.ts:
  - Seniors
  - Caregivers
  - TrustedContacts
  - Incidents
  - Events
  - Alerts
and seeds initial test data with KMS encrypted passphrases and phone numbers.
"""

import os
import sys
import json
import time
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
    """Creates tables specified in tables_definition.json matching infra/lib/data.ts."""
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
    """Seeds initial demonstration data across the 6 core tables."""
    print("\n[DynamoDB] Seeding demonstration data across 6 tables with KMS encrypted fields...")

    raw_passphrase = "BlueberryPancake"
    raw_phone = "+1-512-555-0199"
    enc_passphrase = kms_service.encrypt_field(raw_passphrase, {"senior_id": "snr_8832_v", "field": "passphrase"})
    enc_phone = kms_service.encrypt_field(raw_phone, {"senior_id": "snr_8832_v", "field": "phone_number"})

    # 1. Seniors Table
    seniors_table = dynamodb.Table("Seniors")
    senior_item = {
        "senior_id": "snr_8832_v",
        "name": "Eleanor Vance",
        "timezone": "America/Chicago",
        "status": "NORMAL",
        "safe_word_hash": enc_passphrase,
        "last_activity_at": "2026-10-21T13:00:00Z",
        "baseline_schedule": {
            "wake_time": "07:30",
            "kitchen_expected_by": "10:00",
            "evening_bedtime": "22:00"
        },
        "created_at": "2026-10-12T00:00:00Z",
        "updated_at": "2026-10-21T13:00:00Z",
    }
    seniors_table.put_item(Item=senior_item)
    print("  ✓ Seeded Senior profile: Eleanor Vance (ID: snr_8832_v)")

    # 2. Caregivers Table
    caregivers_table = dynamodb.Table("Caregivers")
    caregiver_item = {
        "caregiver_id": "cg_101",
        "senior_id": "snr_8832_v",
        "name": "Sarah Vance",
        "relationship": "Daughter",
        "priority": 1,
        "phone_number_encrypted": enc_phone,
    }
    caregivers_table.put_item(Item=caregiver_item)
    print("  ✓ Seeded Caregiver: Sarah Vance (ID: cg_101, by_senior: snr_8832_v)")

    # 3. Trusted Contacts Table
    contacts_table = dynamodb.Table("TrustedContacts")
    contact_item = {
        "senior_id": "snr_8832_v",
        "contact_id": "cnt_9901",
        "name": "Sarah Vance",
        "relationship": "Daughter",
        "phone_hash": "hash_phone_5125550199",
        "phone_number_encrypted": enc_phone,
        "family_passphrase_encrypted": enc_passphrase,
    }
    contacts_table.put_item(Item=contact_item)
    print("  ✓ Seeded Trusted Contact: Sarah Vance with KMS encrypted passphrase & phone")

    # 4. Incidents Table
    incidents_table = dynamodb.Table("Incidents")
    incident_item = {
        "senior_id": "snr_8832_v",
        "opened_at#incident_id": "2026-10-21T13:19:43Z#inc_fall_8832_01",
        "incident_id": "inc_fall_8832_01",
        "kind": "FALL",
        "status": "OPEN",
        "severity": "CRITICAL",
        "title": "Fall impact detected in living room",
        "opened_at": "2026-10-21T13:19:43Z",
    }
    incidents_table.put_item(Item=incident_item)
    print("  ✓ Seeded Incident: inc_fall_8832_01 (FALL, CRITICAL)")

    # 5. Events Table
    events_table = dynamodb.Table("Events")
    now_ts = int(time.time())
    event_item = {
        "incident_id": "inc_fall_8832_01",
        "occurred_at#event_id": "2026-10-21T13:19:43Z#evt_fall_001",
        "schema_version": "1",
        "event_id": "evt_fall_001",
        "senior_id": "snr_8832_v",
        "occurred_at": "2026-10-21T13:19:43Z",
        "correlation_id": "corr_8832_01",
        "demo": True,
        "device_id": "esp32_hub_01",
        "room": "living_room",
        "anomaly_type": "FALL_IMPACT",
        "metrics": {"impact_g": 4.23},
        "baseline": {"impact_threshold_g": 3.0},
        "ttl": now_ts + 30 * 24 * 3600,
    }
    events_table.put_item(Item=event_item)
    print("  ✓ Seeded Event: evt_fall_001 (FALL_IMPACT, impact_g: 4.23)")

    # 6. Alerts Table
    alerts_table = dynamodb.Table("Alerts")
    alert_item = {
        "alert_id": "alr_init_001",
        "incident_id": "inc_fall_8832_01",
        "priority": "P1",
        "channels": ["PUSH", "SMS"],
        "title": "Urgent: Fall Detected",
        "body": "Eleanor has experienced a 4.23g fall impact in the living room.",
        "requires_ack": True,
        "ack_deadline": None,
    }
    alerts_table.put_item(Item=alert_item)
    print("  ✓ Seeded Alert: alr_init_001 (Priority P1)")

    print("[DynamoDB] Seeding completed successfully across all 6 tables!\n")


def run_mock_seeding(kms_service: KMSSecurityService):
    """Outputs demo table records to console/JSON in offline mode."""
    print("\n[MOCK MODE] Simulating 6-Table DynamoDB provisioning and KMS encryption:")
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

    print("[MOCK MODE] 6 Tables from infra/lib/data.ts:")
    print("  1. Seniors (PK: senior_id)")
    print("  2. Caregivers (PK: caregiver_id, GSI: by_senior)")
    print("  3. TrustedContacts (PK: senior_id, SK: contact_id, GSI: by_phone_hash)")
    print("  4. Incidents (PK: senior_id, SK: opened_at#incident_id, GSIs: by_incident, by_status)")
    print("  5. Events (PK: incident_id, SK: occurred_at#event_id, TTL: ttl)")
    print("  6. Alerts (PK: alert_id, GSI: by_incident)")


def main():
    parser = argparse.ArgumentParser(description="AegisCare 360 - Provision 6 DynamoDB Tables and KMS")
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
