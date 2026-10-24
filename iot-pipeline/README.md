# AegisCare 360 - IoT Sensor & Real-Time Data Pipeline (Role 3)

The IoT Sensor & Real-Time Data Pipeline provides ambient environmental telemetry, edge DSP fall detection, daily activity baseline tracking, and encrypted DynamoDB storage for AegisCare 360.

## 🚀 Key Modules

1. **Telemetry Simulator (`simulator/sensor_simulator.py`)**:
   - Streams mock spatial accelerometer, PIR motion, and radar telemetry directly to AWS IoT Core over MQTT.
   - Dual-mode: Supports live AWS IoT Core MQTT streaming and local offline mock execution.
   - Pre-built demonstration scenarios:
     - Hard fall with impact breach (`>4.0g`) and post-impact immobility (`fall_incident.json`).
     - Morning routine inactivity anomaly (`NO_KITCHEN_MOTION_BY_10AM`).
     - Normal daily room transitions (`normal_day_routine.json`).

2. **Edge DSP Fall Detection Lambda (`lambda/dsp_processor/`)**:
   - Executes real-time Digital Signal Processing (DSP) and peak threshold detection.
   - Computes Signal Vector Magnitude ($VM = \sqrt{x^2 + y^2 + z^2}$).
   - Emits structured events to EventBridge (`AegisCareBus`) on threshold breach.

3. **Daily Routine Baseline Lambda (`lambda/baseline_monitor/`)**:
   - Compares senior room activity against daily baseline schedules.
   - Flags anomalies such as missing morning kitchen motion by 10:00 AM.
   - Triggers voice check-ins via sister agents on EventBridge.

4. **DynamoDB & KMS Security (`database/`)**:
   - Schema and automated provisioning for 4 core tables:
     - `AegisCare_Seniors`
     - `AegisCare_TrustedContacts`
     - `AegisCare_ScamLogs`
     - `AegisCare_ActivityEvents`
   - Field-level envelope encryption with AWS KMS for family passphrases and contact phone numbers.

5. **Infrastructure as Code (`iac/`)**:
   - `aegiscare-iot-template.yaml`: Complete AWS SAM / CloudFormation template deploying tables, KMS keys, custom EventBridge bus, Lambda functions, and IoT Core topic rules.
   - `iot_rules_definition.sql`: IoT Core SQL topic rules.

---

## 🛠️ Quick Start

### 1. Installation
```bash
pip install -r requirements.txt
```

### 2. Run Telemetry Simulator (Local Mock Mode)
Simulate a violent living room fall:
```bash
python simulator/sensor_simulator.py --scenario fall --mock --interval 1.0
```

Simulate morning kitchen inactivity breach:
```bash
python simulator/sensor_simulator.py --scenario inactivity --mock
```

Continuous normal room motion:
```bash
python simulator/sensor_simulator.py --scenario continuous --interval 1.5 --mock
```

### 3. Connect to Live AWS IoT Core
```bash
python simulator/sensor_simulator.py --scenario fall \
  --endpoint your-prefix-ats.iot.us-east-1.amazonaws.com \
  --root-ca certs/AmazonRootCA1.pem \
  --cert certs/device.pem.crt \
  --key certs/device.private.key
```

### 4. Provision DynamoDB & Test KMS Encryption
Run mock validation and seeding:
```bash
python database/schema/setup_dynamodb.py --mock
```

Deploy to AWS DynamoDB:
```bash
python database/schema/setup_dynamodb.py --region us-east-1 --kms-key-id alias/aegiscare-encryption-key
```

### 5. Run Test Suite
```bash
pytest -v tests/
```

---

## ☁️ Cloud Deployment (SAM / CloudFormation)
```bash
cd iac
sam build --template aegiscare-iot-template.yaml
sam deploy --guided
```
