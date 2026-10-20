-- ==============================================================================
-- AegisCare 360 - AWS IoT Core Topic SQL Rules
-- Defines message routing from MQTT broker directly to edge Lambda functions
-- ==============================================================================

-- Rule 1: High-Frequency Spatial & Accelerometer Telemetry
-- Routes live movement frames to the DSP Fall Detection Lambda
SELECT
    *,
    topic(3) AS senior_id_from_topic,
    timestamp() AS received_epoch_ms
FROM
    'aegiscare/seniors/+/telemetry'
WHERE
    sensor_type = 'spatial_telemetry';

-- Action Target: AWS Lambda ARN (arn:aws:lambda:us-east-1:*:function:AegisCare_DSPProcessor)


-- Rule 2: Inactivity & Daily Routine Baseline Telemetry
-- Routes morning schedule and room inactivity frames to Baseline Monitor Lambda
SELECT
    *,
    topic(3) AS senior_id_from_topic,
    timestamp() AS received_epoch_ms
FROM
    'aegiscare/seniors/+/telemetry'
WHERE
    sensor_type = 'routine_baseline_telemetry';

-- Action Target: AWS Lambda ARN (arn:aws:lambda:us-east-1:*:function:AegisCare_BaselineMonitor)


-- Rule 3: Catch-All Raw Archival / Auditing (Optional S3 rule)
SELECT
    *
FROM
    'aegiscare/seniors/+/telemetry';
