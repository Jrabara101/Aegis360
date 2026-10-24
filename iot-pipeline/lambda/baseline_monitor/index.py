"""
AegisCare 360 - Daily Baseline Monitor Lambda Handler
Evaluates daily activity patterns against senior routines (e.g. 'ROUTINE_MISSED').
Pushes structured 'Sensor.AnomalyDetected' alerts to EventBridge 'AegisCareBus'.
"""

import os
import json
import time
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List

try:
    from baseline_rules import BaselineRuleEngine
except ImportError:
    from .baseline_rules import BaselineRuleEngine

try:
    import boto3
    from boto3.dynamodb.conditions import Key
    HAVE_BOTO3 = True
except ImportError:
    HAVE_BOTO3 = False

EVENT_BUS_NAME = os.environ.get("EVENT_BUS_NAME", "AegisCareBus")
SENIORS_TABLE = os.environ.get("SENIORS_TABLE", "Seniors")
INCIDENTS_TABLE = os.environ.get("INCIDENTS_TABLE", "Incidents")
EVENTS_TABLE = os.environ.get("EVENTS_TABLE", "Events")

engine = BaselineRuleEngine()


def get_aws_clients():
    if not HAVE_BOTO3:
        return None, None
    try:
        eventbridge = boto3.client("events")
        dynamodb = boto3.resource("dynamodb")
        return eventbridge, dynamodb
    except Exception:
        return None, None


def ensure_id_prefix(val: str, prefix: str) -> str:
    """Ensures ID matches regex requirement ^prefix_[0-9A-Za-z_]+$."""
    if not val:
        return f"{prefix}_{int(time.time() * 1000)}"
    if val.startswith(f"{prefix}_"):
        return val
    return f"{prefix}_{val}"


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda entrypoint. Triggered either by scheduled EventBridge rule
    or by simulated routine anomaly event payload.
    """
    print(f"[Baseline Lambda] Triggered with event: {json.dumps(event)}")
    senior_id = ensure_id_prefix(event.get("senior_id", "snr_8832_v"), "snr")

    eventbridge_client, dynamodb_resource = get_aws_clients()

    events_list: List[Dict[str, Any]] = []
    baseline_schedule = {"kitchen_expected_by": "10:00"}

    # If event itself carries simulated telemetry frames
    if "frames" in event:
        events_list = event["frames"]
    elif dynamodb_resource:
        try:
            # Fetch senior config
            seniors_tbl = dynamodb_resource.Table(SENIORS_TABLE)
            senior_res = seniors_tbl.get_item(Key={"senior_id": senior_id})
            if "Item" in senior_res:
                baseline_schedule = senior_res["Item"].get("baseline_schedule", baseline_schedule)

            # Query today's events
            events_tbl = dynamodb_resource.Table(EVENTS_TABLE)
            # In mock or fallback, use empty list if table not accessible
        except Exception as e:
            print(f"[DynamoDB Warning] Could not fetch records: {e}")

    # Fallback if no records found
    if not events_list:
        events_list = [
            {"room": "bedroom", "timestamp": "2026-10-21T07:30:00Z", "pir_motion_detected": True},
            {"room": "bedroom", "timestamp": "2026-10-21T07:32:00Z", "pir_motion_detected": False},
        ]

    # Evaluate baseline rule
    check_time = None
    if "current_time" in event:
        try:
            t_parts = event["current_time"].split(":")
            now = datetime.now(timezone.utc)
            check_time = now.replace(hour=int(t_parts[0]), minute=int(t_parts[1]), second=0)
        except Exception:
            pass

    eval_result = engine.evaluate_inactivity(
        senior_id=senior_id,
        events=events_list,
        baseline_schedule=baseline_schedule,
        check_time=check_time,
    )

    is_breached = eval_result["is_breached"] or event.get("anomaly_type") in ("ROUTINE_MISSED", "NO_MOTION_WINDOW") or event.get("baseline_rule") == "NO_KITCHEN_MOTION_BY_10AM"
    anomaly_type = eval_result["anomaly_type"] or event.get("anomaly_type") or "ROUTINE_MISSED"
    room = eval_result["room"] or event.get("room", "kitchen")

    eventbridge_payload = None

    if is_breached:
        now_ms = int(time.time() * 1000)
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        event_id = ensure_id_prefix(f"evt_{now_ms}", "evt")
        incident_id = ensure_id_prefix(f"inc_inact_{senior_id}_{now_ms}", "inc")

        anomaly_detail = {
            "schema_version": "1",
            "event_id": event_id,
            "senior_id": senior_id,
            "incident_id": incident_id,
            "occurred_at": timestamp,
            "correlation_id": f"corr_{now_ms}",
            "demo": True,
            "device_id": event.get("device_id", "esp32_hub_01"),
            "room": room,
            "anomaly_type": anomaly_type,  # "ROUTINE_MISSED" or "NO_MOTION_WINDOW"
            "metrics": eval_result["metrics"],  # {"no_motion_minutes": 163.0}
            "baseline": eval_result["baseline"],
        }

        eventbridge_payload = {
            "version": "0",
            "id": str(uuid.uuid4()),
            "detail-type": "Sensor.AnomalyDetected",
            "source": "aegiscare.iot",
            "time": timestamp,
            "region": os.environ.get("AWS_REGION", "us-east-1"),
            "resources": [f"arn:aws:iot:baseline:{senior_id}"],
            "detail": anomaly_detail,
        }

        print(f"[Baseline Lambda] >>> BASELINE BREACH: {anomaly_type} in {room} (no_motion_minutes: {eval_result['no_motion_minutes']}) <<<")

        # Publish to EventBridge
        if eventbridge_client:
            try:
                eventbridge_client.put_events(
                    Entries=[
                        {
                            "Source": "aegiscare.iot",
                            "DetailType": "Sensor.AnomalyDetected",
                            "Detail": json.dumps(anomaly_detail),
                            "EventBusName": EVENT_BUS_NAME,
                        }
                    ]
                )
                print(f"[EventBridge] Published Sensor.AnomalyDetected event to {EVENT_BUS_NAME}")
            except Exception as e:
                print(f"[EventBridge Error] Failed to publish baseline event: {e}")

        # Update DynamoDB Incidents & Seniors tables
        if dynamodb_resource:
            try:
                incidents_tbl = dynamodb_resource.Table(INCIDENTS_TABLE)
                incidents_tbl.put_item(
                    Item={
                        "senior_id": senior_id,
                        "opened_at#incident_id": f"{timestamp}#{incident_id}",
                        "incident_id": incident_id,
                        "kind": "INACTIVITY",
                        "status": "OPEN",
                        "severity": "MEDIUM",
                        "title": f"Routine missed in {room} ({eval_result['no_motion_minutes']} mins inactive)",
                        "opened_at": timestamp,
                    }
                )
            except Exception as e:
                print(f"[DynamoDB Error] Failed to record inactivity incident: {e}")

            try:
                seniors_tbl = dynamodb_resource.Table(SENIORS_TABLE)
                seniors_tbl.update_item(
                    Key={"senior_id": senior_id},
                    UpdateExpression="SET #st = :status, last_activity_at = :now",
                    ExpressionAttributeNames={"#st": "status"},
                    ExpressionAttributeValues={
                        ":status": "WATCH",
                        ":now": timestamp,
                    }
                )
            except Exception as e:
                print(f"[DynamoDB Error] Failed to update senior state: {e}")

    return {
        "statusCode": 200,
        "body": json.dumps({
            "status": "EVALUATED",
            "evaluation": eval_result,
            "is_breached": is_breached,
            "event_detail": eventbridge_payload["detail"] if eventbridge_payload else None,
        })
    }
