"""
AegisCare 360 - DSP Fall Detection Lambda Handler
Triggered by AWS IoT Core SQL Rules on topic 'aegiscare/seniors/+/telemetry'.
Executes real-time DSP signal filtering to detect raw impact vectors (e.g. >=3.0g)
and publishes structured 'Sensor.AnomalyDetected' events to EventBridge 'AegisCareBus'.
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
SENIORS_TABLE = os.environ.get("SENIORS_TABLE", "Seniors")
INCIDENTS_TABLE = os.environ.get("INCIDENTS_TABLE", "Incidents")
EVENTS_TABLE = os.environ.get("EVENTS_TABLE", "Events")

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


def ensure_id_prefix(val: str, prefix: str) -> str:
    """Ensures ID matches regex requirement ^prefix_[0-9A-Za-z_]+$."""
    if not val:
        return f"{prefix}_{int(time.time() * 1000)}"
    if val.startswith(f"{prefix}_"):
        return val
    return f"{prefix}_{val}"


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda entrypoint.
    `event` is the JSON payload routed by AWS IoT Core Rule.
    """
    print(f"[DSP Lambda] Received telemetry event: {json.dumps(event)}")

    # 1. Evaluate DSP signal
    dsp_result = dsp_processor.evaluate_telemetry_frame(event)
    senior_id = ensure_id_prefix(dsp_result.get("senior_id", "snr_8832_v"), "snr")
    room = dsp_result["room"]
    timestamp = dsp_result.get("timestamp") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    is_anomaly = bool(dsp_result["anomaly_type"])
    eventbridge_client, dynamodb_resource = get_aws_clients()

    eventbridge_payload = None

    # 2. If fall or severe immobility detected, construct structured Sensor.AnomalyDetected payload
    if is_anomaly:
        now_ms = int(time.time() * 1000)
        event_id = ensure_id_prefix(f"evt_{now_ms}", "evt")
        incident_id = ensure_id_prefix(f"inc_fall_{senior_id}_{now_ms}", "inc")

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
            "anomaly_type": dsp_result["anomaly_type"],  # "FALL_IMPACT" or "POST_IMPACT_IMMOBILITY"
            "metrics": dsp_result["metrics"],            # {"impact_g": 4.23}
            "baseline": dsp_result["baseline"],
        }

        eventbridge_payload = {
            "version": "0",
            "id": str(uuid.uuid4()),
            "detail-type": "Sensor.AnomalyDetected",
            "source": "aegiscare.iot",
            "time": timestamp,
            "region": os.environ.get("AWS_REGION", "us-east-1"),
            "resources": [f"arn:aws:iot:sensor:{senior_id}"],
            "detail": anomaly_detail,
        }

        print(f"[DSP Lambda] >>> THRESHOLD BREACH DETECTED: {dsp_result['anomaly_type']} (impact_g: {dsp_result['impact_g']}) in room: {room} <<<")

        # 3. Publish to EventBridge AegisCareBus
        if eventbridge_client:
            try:
                response = eventbridge_client.put_events(
                    Entries=[
                        {
                            "Source": "aegiscare.iot",
                            "DetailType": "Sensor.AnomalyDetected",
                            "Detail": json.dumps(anomaly_detail),
                            "EventBusName": EVENT_BUS_NAME,
                        }
                    ]
                )
                print(f"[EventBridge] Published Sensor.AnomalyDetected event to {EVENT_BUS_NAME}: {response}")
            except Exception as e:
                print(f"[EventBridge Error] Failed to publish event: {e}")

        # 4. Record new Incident in DynamoDB Incidents table
        if dynamodb_resource:
            try:
                incidents_tbl = dynamodb_resource.Table(INCIDENTS_TABLE)
                incidents_tbl.put_item(
                    Item={
                        "senior_id": senior_id,
                        "opened_at#incident_id": f"{timestamp}#{incident_id}",
                        "incident_id": incident_id,
                        "kind": "FALL",
                        "status": "OPEN",
                        "severity": "CRITICAL",
                        "title": f"Fall impact ({dsp_result['impact_g']}g) in {room}",
                        "opened_at": timestamp,
                    }
                )
                print(f"[DynamoDB] Created Incident '{incident_id}' for senior '{senior_id}'")
            except Exception as e:
                print(f"[DynamoDB Error] Failed to record incident: {e}")

            # 5. Update Seniors table emergency status
            try:
                seniors_tbl = dynamodb_resource.Table(SENIORS_TABLE)
                seniors_tbl.update_item(
                    Key={"senior_id": senior_id},
                    UpdateExpression="SET #st = :status, last_activity_at = :now",
                    ExpressionAttributeNames={"#st": "status"},
                    ExpressionAttributeValues={
                        ":status": "ALERT",
                        ":now": timestamp,
                    }
                )
            except Exception as e:
                print(f"[DynamoDB Error] Failed to update senior state: {e}")

    # 6. Always record event into Events table
    if dynamodb_resource:
        try:
            events_tbl = dynamodb_resource.Table(EVENTS_TABLE)
            incident_ref = eventbridge_payload["detail"]["incident_id"] if eventbridge_payload else f"inc_stream_{senior_id}"
            now_ms = int(time.time() * 1000)
            events_tbl.put_item(
                Item={
                    "incident_id": incident_ref,
                    "occurred_at#event_id": f"{timestamp}#evt_{now_ms}",
                    "senior_id": senior_id,
                    "event_type": "Sensor.AnomalyDetected" if is_anomaly else "Sensor.TelemetryStream",
                    "anomaly_type": dsp_result["anomaly_type"] if is_anomaly else "NORMAL",
                    "room": room,
                    "metrics": {k: str(v) for k, v in dsp_result["metrics"].items()},
                    "ttl": int(time.time()) + 30 * 24 * 3600,
                }
            )
        except Exception as e:
            print(f"[DynamoDB Error] Failed to write event log: {e}")

    return {
        "statusCode": 200,
        "body": json.dumps({
            "status": "PROCESSED",
            "dsp_result": dsp_result,
            "anomaly_flagged": is_anomaly,
            "event_detail": eventbridge_payload["detail"] if eventbridge_payload else None,
        })
    }
