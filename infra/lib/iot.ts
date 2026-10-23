import { Aws, Duration, RemovalPolicy } from "aws-cdk-lib";
import type { EventBus } from "aws-cdk-lib/aws-events";
import { ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { CfnPolicy, CfnThing, CfnTopicRule } from "aws-cdk-lib/aws-iot";
import { Architecture, Code, Function as LambdaFn, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import type { DataTables } from "./data";

// SPSQZ's IoT pipeline (iot-pipeline/), deployed with this stack's bus and tables instead of
// the standalone template. Their Python Lambdas already read table names from the
// environment, so nothing in iot-pipeline/ changes. Topic and SQL follow
// iot-pipeline/iac/iot_rules_definition.sql.

export interface IotPipelineProps {
  repoPath: (p: string) => string;
  bus: EventBus;
  tables: DataTables;
  /** MQTT client ID the simulator connects with (its --device-id). */
  deviceId: string;
}

const TELEMETRY_TOPIC = "aegiscare/seniors/+/telemetry";

export class IotPipeline extends Construct {
  readonly dspProcessor: LambdaFn;
  readonly baselineMonitor: LambdaFn;
  readonly policyName: string;
  readonly thingName: string;

  constructor(scope: Construct, id: string, props: IotPipelineProps) {
    super(scope, id);

    const python = (fnId: string, dir: string) => {
      const fn = new LambdaFn(this, fnId, {
        runtime: Runtime.PYTHON_3_13,
        architecture: Architecture.ARM_64,
        handler: "index.lambda_handler",
        code: Code.fromAsset(props.repoPath(`iot-pipeline/lambda/${dir}`), { exclude: ["__pycache__", "*.pyc"] }),
        memorySize: 256,
        timeout: Duration.seconds(15),
        logGroup: new LogGroup(this, `${fnId}Logs`, { retention: RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY }),
        environment: {
          EVENT_BUS_NAME: props.bus.eventBusName,
          SENIORS_TABLE: props.tables.seniors.tableName,
          INCIDENTS_TABLE: props.tables.incidents.tableName,
          EVENTS_TABLE: props.tables.events.tableName,
        },
      });
      props.bus.grantPutEventsTo(fn);
      for (const t of [props.tables.seniors, props.tables.incidents, props.tables.events]) t.grantReadWriteData(fn);
      return fn;
    };
    this.dspProcessor = python("DspProcessor", "dsp_processor");
    this.baselineMonitor = python("BaselineMonitor", "baseline_monitor");

    const rule = (ruleId: string, ruleName: string, sensorType: string, fn: LambdaFn) => {
      const topicRule = new CfnTopicRule(this, ruleId, {
        ruleName,
        topicRulePayload: {
          awsIotSqlVersion: "2016-03-23",
          sql: `SELECT *, topic(3) AS senior_id_from_topic, timestamp() AS received_epoch_ms FROM '${TELEMETRY_TOPIC}' WHERE sensor_type = '${sensorType}'`,
          ruleDisabled: false,
          actions: [{ lambda: { functionArn: fn.functionArn } }],
        },
      });
      fn.addPermission(`${ruleId}Invoke`, { principal: new ServicePrincipal("iot.amazonaws.com"), sourceArn: topicRule.attrArn });
    };
    rule("SpatialRule", "AegisCare_SpatialTelemetryRule", "spatial_telemetry", this.dspProcessor);
    rule("BaselineRule", "AegisCare_RoutineBaselineRule", "routine_baseline_telemetry", this.baselineMonitor);

    // One simulated home hub. scripts/iot-device-setup.ps1 makes its certificate outside
    // CloudFormation, so the private key never passes through a template, and attaches this
    // policy to it. Run that script with -Remove before destroying the stack.
    this.thingName = "aegiscare-sim-hub";
    new CfnThing(this, "SimulatorThing", { thingName: this.thingName });
    this.policyName = "AegisCareSimulatorPolicy";
    new CfnPolicy(this, "SimulatorPolicy", {
      policyName: this.policyName,
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          { Effect: "Allow", Action: "iot:Connect", Resource: `arn:${Aws.PARTITION}:iot:${Aws.REGION}:${Aws.ACCOUNT_ID}:client/${props.deviceId}` },
          { Effect: "Allow", Action: "iot:Publish", Resource: `arn:${Aws.PARTITION}:iot:${Aws.REGION}:${Aws.ACCOUNT_ID}:topic/aegiscare/seniors/*/telemetry` },
        ],
      },
    });
  }
}
