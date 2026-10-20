"""
AegisCare 360 - DSP Fall Detection Lambda Handler
Triggered by AWS IoT Core SQL Rules on topic 'aegiscare/seniors/+/telemetry'.
Executes real-time DSP signal filtering to detect raw impact vectors (e.g. >3.5g)
and publishes structured anomaly events to EventBridge 'AegisCareBus'.
"""

import os
import json
import time
import uuid
from typing import Dict, Any

try:
    from dsp_math import DSPProcessor
except ImportError:
    from .dsp_math import DSPProcessor


try:
    import boto3
    HAVE_BOTO3 = True
except ImportError:
    HAVE_BOTO3 = False

EVENT_BUS_NAME = os.environ.get("EVENT_BUS_NAME", "AegisCareBus")
SENIORS_TABLE = os.environ.get("SENIORS_TABLE", "AegisCare_Seniors")
ACTIVITY_TABLE = os.environ.get("ACTIVITY_TABLE", "AegisCare_ActivityEvents")

dsp_processor = DSPProcessor(fall_impact_threshold_g=3.0)


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
    AWS Lambda entrypoint.
    `event` is the JSON payload routed by AWS IoT Core Rule.
    """
    print(f"[DSP Lambda] Received telemetry event: {json.dumps(event)}")

    # 1. Evaluate DSP signal
    dsp_result = dsp_processor.evaluate_telemetry_frame(event)
    senior_id = dsp_result["senior_id"]
    timestamp = dsp_result.get("timestamp") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    is_anomaly = dsp_result["is_fall_impact"] or (dsp_result["is_immobile"] and dsp_result.get("immobility_duration_sec", 0) >= 10)

    eventbridge_client, dynamodb_resource = get_aws_clients()

    # 2. If fall or severe immobility detected, construct structured EventBridge payload
    if is_anomaly:
        anomaly_type = "IMPACT_VECTOR_DETECTED" if dsp_result["is_fall_impact"] else "POST_IMPACT_IMMOBILITY_DETECTED"
        eventbridge_payload = {
            "version": "0",
            "id": str(uuid.uuid4()),
            "detail-type": "AegisCare.PhysicalAnomalyDetected",
            "source": "aegiscare.iot.dsp",
            "time": timestamp,
            "region": os.environ.get("AWS_REGION", "us-east-1"),
            "resources": [f"arn:aws:iot:sensor:{senior_id}"],
            "detail": {
                "senior_id": senior_id,
                "device_id": event.get("device_id", "esp32_hub_01"),
                "anomaly_type": anomaly_type,
                "g_force": dsp_result["vector_magnitude_g"],
                "post_impact_immobility": dsp_result["is_immobile"],
                "immobility_duration_sec": dsp_result["immobility_duration_sec"],
                "location": dsp_result["location"],
                "threat_severity": "CRITICAL" if dsp_result["is_fall_impact"] else "HIGH",
                "raw_telemetry_snippet": {
                    "accelerometer": event.get("accelerometer"),
                    "radar_presence": event.get("radar_presence"),
                }
            }
        }

        print(f"[DSP Lambda] >>> THRESHOLD BREACH DETECTED: {anomaly_type} (VM: {dsp_result['vector_magnitude_g']}g) <<<")

        # 3. Publish to EventBridge AegisCareBus
        if eventbridge_client:
            try:
                response = eventbridge_client.put_events(
                    Entries=[
                        {
                            "Source": "aegiscare.iot.dsp",
                            "DetailType": "AegisCare.PhysicalAnomalyDetected",
                            "Detail": json.dumps(eventbridge_payload["detail"]),
                            "EventBusName": EVENT_BUS_NAME,
                        }
                    ]
                )
                print(f"[EventBridge] Published anomaly event to {EVENT_BUS_NAME}: {response}")
            except Exception as e:
                print(f"[EventBridge Error] Failed to publish event: {e}")

        # 4. Update DynamoDB senior emergency status
        if dynamodb_resource:
            try:
                seniors_tbl = dynamodb_resource.Table(SENIORS_TABLE)
                seniors_tbl.update_item(
                    Key={"senior_id": senior_id},
                    UpdateExpression="SET emergency_status = :status, last_fall_alert = :alert, updated_at = :now",
                    ExpressionAttributeValues={
                        ":status": "CRITICAL_FALL_UNACKNOWLEDGED",
                        ":alert": anomaly_type,
                        ":now": timestamp,
                    }
                )
                print(f"[DynamoDB] Updated senior '{senior_id}' status to CRITICAL_FALL_UNACKNOWLEDGED")
            except Exception as e:
                print(f"[DynamoDB Error] Failed to update senior state: {e}")

    # 5. Always record event into ActivityEvents log
    if dynamodb_resource:
        try:
            activity_tbl = dynamodb_resource.Table(ACTIVITY_TABLE)
            activity_tbl.put_item(
                Item={
                    "senior_id": senior_id,
                    "timestamp": timestamp,
                    "event_id": f"evt_{int(time.time()*1000)}",
                    "event_type": "FALL_IMPACT" if dsp_result["is_fall_impact"] else ("IMMOBILITY" if dsp_result["is_immobile"] else "NORMAL_MOTION"),
                    "location": dsp_result["location"],
                    "g_force": str(dsp_result["vector_magnitude_g"]),
                    "immobility_detected": dsp_result["is_immobile"],
                    "dsp_evaluated": True,
                }
            )
        except Exception as e:
            print(f"[DynamoDB Error] Failed to write activity log: {e}")

    return {
        "statusCode": 200,
        "body": json.dumps({
            "status": "PROCESSED",
            "dsp_result": dsp_result,
            "anomaly_flagged": is_anomaly,
        })
    }
