"""
AegisCare 360 - Daily Baseline Monitor Lambda Handler
Evaluates daily activity patterns against senior routines (e.g. 'No kitchen motion by 10:00 AM').
Pushes structured anomaly alerts to EventBridge 'AegisCareBus' to prompt Alexa check-in routines.
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
SENIORS_TABLE = os.environ.get("SENIORS_TABLE", "AegisCare_Seniors")
ACTIVITY_TABLE = os.environ.get("ACTIVITY_TABLE", "AegisCare_ActivityEvents")

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


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda entrypoint. Triggered either by scheduled EventBridge rule (e.g. 10:00 AM daily)
    or by simulated anomaly event payload.
    """
    print(f"[Baseline Lambda] Triggered with event: {json.dumps(event)}")
    senior_id = event.get("senior_id", "snr_8832_v")

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

            # Fetch today's activity events
            activity_tbl = dynamodb_resource.Table(ACTIVITY_TABLE)
            today_prefix = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            res = activity_tbl.query(
                KeyConditionExpression=Key("senior_id").eq(senior_id) & Key("timestamp").begins_with(today_prefix)
            )
            events_list = res.get("Items", [])
        except Exception as e:
            print(f"[DynamoDB Warning] Could not fetch records: {e}")

    # Fallback if no records found or mock event
    if not events_list:
        events_list = [
            {"location": "bedroom", "timestamp": "2026-10-17T07:30:00Z", "pir_motion_detected": True},
            {"location": "bedroom", "timestamp": "2026-10-17T07:32:00Z", "pir_motion_detected": False},
        ]

    # Evaluate baseline rule
    # If the simulated event specified a custom time (e.g. 10:15:00)
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

    is_breached = eval_result["is_breached"] or event.get("baseline_rule") == "NO_KITCHEN_MOTION_BY_10AM"

    if is_breached:
        print(f"[Baseline Lambda] >>> BASELINE BREACH: No kitchen motion by 10:00 AM for {senior_id} <<<")

        anomaly_payload = {
            "version": "0",
            "id": str(uuid.uuid4()),
            "detail-type": "AegisCare.PhysicalAnomalyDetected",
            "source": "aegiscare.iot.baseline",
            "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "region": os.environ.get("AWS_REGION", "us-east-1"),
            "resources": [f"arn:aws:iot:baseline:{senior_id}"],
            "detail": {
                "senior_id": senior_id,
                "anomaly_type": "NO_KITCHEN_MOTION_BY_10AM",
                "inactivity_duration_minutes": event.get("inactivity_minutes", 163),
                "last_detected_room": eval_result.get("last_detected_room", "bedroom"),
                "threat_severity": "MEDIUM",
                "recommended_action": "INITIATE_ALEXA_VOICE_CHECKIN",
                "evaluation_summary": eval_result,
            }
        }

        # Publish to EventBridge
        if eventbridge_client:
            try:
                eventbridge_client.put_events(
                    Entries=[
                        {
                            "Source": "aegiscare.iot.baseline",
                            "DetailType": "AegisCare.PhysicalAnomalyDetected",
                            "Detail": json.dumps(anomaly_payload["detail"]),
                            "EventBusName": EVENT_BUS_NAME,
                        }
                    ]
                )
                print(f"[EventBridge] Published inactivity anomaly event to {EVENT_BUS_NAME}")
            except Exception as e:
                print(f"[EventBridge Error] Failed to publish baseline event: {e}")

        # Update DynamoDB senior emergency status
        if dynamodb_resource:
            try:
                seniors_tbl = dynamodb_resource.Table(SENIORS_TABLE)
                seniors_tbl.update_item(
                    Key={"senior_id": senior_id},
                    UpdateExpression="SET emergency_status = :status, last_inactivity_warning = :now",
                    ExpressionAttributeValues={
                        ":status": "POTENTIAL_INACTIVITY_WARNING",
                        ":now": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
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
        })
    }
