import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Archive, EventBus, Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, Function as LambdaFn, Runtime, type IFunction } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction, OutputFormat, type NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import { DataTables } from "./data";
import { IotPipeline } from "./iot";
import { ROUTES, type Target } from "./routing";
import { AegisGuardrail, InstructedAgent } from "./threatAgent";
import { CaregiverWeb } from "./web";

const repo = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

export interface AegisCareStackProps extends StackProps {
  /** Bedrock model ID or inference profile for the agents. Empty → no agents; rule-based scoring only. */
  foundationModel?: string;
  /** Senior IDs the generated household token may act for. */
  demoSeniorIds: string[];
  /** A teammate's Lambda ARN replaces the built-in target for that rule. */
  externalTargets?: Partial<Record<Exclude<Target, "threatAgent" | "caregiverAgent">, string>>;
  notify?: {
    /** AWS End User Messaging (SMS) phone number, pool or sender ID. Unset → no SMS. */
    smsOriginationIdentity?: string;
    /** Verified SES identity to send from. Unset → no email. */
    fromEmail?: string;
  };
  /** How long the senior has to answer a prompt before the family is told. */
  promptTimeoutSeconds?: number;
  /** MQTT client ID of the simulated hub. */
  iotDeviceId?: string;
  demoMode?: boolean;
  destroyOnDelete?: boolean;
}

export class AegisCareStack extends Stack {
  constructor(scope: Construct, id: string, props: AegisCareStackProps) {
    super(scope, id, props);
    const removalPolicy = props.destroyOnDelete ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN;

    // --- bus ---
    const bus = new EventBus(this, "Bus", { eventBusName: "AegisCareBus" });
    new Archive(this, "Archive", {
      sourceEventBus: bus,
      archiveName: "AegisCareArchive",
      eventPattern: { source: [{ prefix: "aegiscare." }] as unknown as string[] },
      retention: Duration.days(30),
      description: "Every AegisCare event, for replaying the demo",
    });
    const dlq = new Queue(this, "Dlq", {
      queueName: "AegisCareDLQ",
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.SQS_MANAGED,
    });

    // --- data + secrets ---
    const tables = new DataTables(this, "Data", { removalPolicy });
    const pepper = new Secret(this, "SafeWordPepper", {
      description: "HMAC pepper for family safe-word hashes",
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
      removalPolicy,
    });
    const mcpTokens = new Secret(this, "McpTokens", {
      description: "Alexa+ household bearer token and the senior IDs it may act for",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ senior_ids: props.demoSeniorIds }),
        generateStringKey: "token",
        passwordLength: 40,
        excludePunctuation: true,
      },
      removalPolicy,
    });

    // --- Bedrock ---
    const guardrail = new AegisGuardrail(this, "Guardrail");
    const model = props.foundationModel;
    const agent = model
      ? new InstructedAgent(this, "ThreatAgent", {
          agentName: "AegisCareThreatAgent",
          description: "Scores live call transcripts for scam risk. Returns JSON only.",
          foundationModel: model,
          instructionsPath: repo("services/agents/instructions/threat-agent.md"),
          guardrail,
        })
      : undefined;
    const safetyAgent = model
      ? new InstructedAgent(this, "SafetyAgent", {
          agentName: "AegisCareSafetyAgent",
          description: "Scores home sensor anomalies for how likely the senior needs help. Returns JSON only.",
          foundationModel: model,
          instructionsPath: repo("services/agents/instructions/safety-agent.md"),
          guardrail,
        })
      : undefined;
    const agentEnv: Record<string, string> = agent
      ? { THREAT_AGENT_ID: agent.agent.attrAgentId, THREAT_AGENT_ALIAS_ID: agent.alias.attrAgentAliasId }
      : {};
    const invokeAgent = agent
      ? new PolicyStatement({ actions: ["bedrock:InvokeAgent"], resources: [agent.alias.attrAgentAliasArn] })
      : undefined;

    // --- functions ---
    const tableEnv = {
      SENIORS_TABLE: tables.seniors.tableName,
      CAREGIVERS_TABLE: tables.caregivers.tableName,
      INCIDENTS_TABLE: tables.incidents.tableName,
      EVENTS_TABLE: tables.events.tableName,
      ALERTS_TABLE: tables.alerts.tableName,
    };
    const fn = (id: string, entry: string, handler: string, extra: Partial<NodejsFunctionProps> = {}) =>
      new NodejsFunction(this, id, {
        entry: repo(entry),
        handler,
        runtime: Runtime.NODEJS_24_X,
        architecture: Architecture.ARM_64,
        memorySize: 512,
        timeout: Duration.seconds(15),
        logGroup: new LogGroup(this, `${id}Logs`, { retention: RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY }),
        depsLockFilePath: repo("package-lock.json"),
        projectRoot: repo(""),
        bundling: {
          format: OutputFormat.ESM,
          target: "node24",
          minify: true,
          sourceMap: true,
          mainFields: ["module", "main"],
          // Some AWS SDK dependencies still call require(); give ESM bundles one.
          banner: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
        },
        ...extra,
        environment: { BUS_NAME: bus.eventBusName, NODE_OPTIONS: "--enable-source-maps", ...tableEnv, ...extra.environment },
      });

    const threatFn = fn("ThreatAgentInvoker", "services/agents/src/lambdas.ts", "threatAgentInvoker", {
      environment: { ...agentEnv, THREAT_TIMEOUT_MS: "3000" },
    });
    bus.grantPutEventsTo(threatFn);
    tables.events.grantReadWriteData(threatFn);
    if (invokeAgent) threatFn.addToRolePolicy(invokeAgent);

    const caregiverFn = fn("CaregiverAgentInvoker", "services/agents/src/lambdas.ts", "caregiverAgentInvoker");
    bus.grantPutEventsTo(caregiverFn);
    for (const t of [tables.seniors, tables.caregivers, tables.incidents]) t.grantReadData(caregiverFn);

    const mcpFn = fn("McpServer", "services/mcp-server/src/lambda.ts", "handler", {
      environment: {
        ...agentEnv,
        MCP_TOKENS_SECRET_ID: mcpTokens.secretArn,
        SAFE_WORD_PEPPER_SECRET_ID: pepper.secretArn,
        DEMO_MODE: String(props.demoMode ?? false),
      },
    });
    bus.grantPutEventsTo(mcpFn);
    for (const t of [tables.seniors, tables.caregivers, tables.incidents]) t.grantReadData(mcpFn);
    tables.events.grantReadWriteData(mcpFn);
    mcpTokens.grantRead(mcpFn);
    pepper.grantRead(mcpFn);
    if (invokeAgent) mcpFn.addToRolePolicy(invokeAgent);

    const api = new HttpApi(this, "McpApi", { apiName: "aegiscare-mcp", description: "AegisCare Alexa+ MCP server (Streamable HTTP)" });
    api.addRoutes({
      path: "/mcp",
      methods: [HttpMethod.POST, HttpMethod.GET, HttpMethod.DELETE],
      integration: new HttpLambdaIntegration("McpIntegration", mcpFn),
    });

    const safetyFn = fn("SafetyAgentInvoker", "services/agents/src/lambdas.ts", "safetyAgentInvoker", {
      environment: safetyAgent
        ? { SAFETY_AGENT_ID: safetyAgent.agent.attrAgentId, SAFETY_AGENT_ALIAS_ID: safetyAgent.alias.attrAgentAliasId, SAFETY_TIMEOUT_MS: "3000" }
        : {},
    });
    bus.grantPutEventsTo(safetyFn);
    tables.seniors.grantReadData(safetyFn);
    if (safetyAgent) safetyFn.addToRolePolicy(new PolicyStatement({ actions: ["bedrock:InvokeAgent"], resources: [safetyAgent.alias.attrAgentAliasArn] }));

    // The prompt handler re-checks each question after a delay, via an SQS delay queue.
    const promptTimer = new Queue(this, "PromptTimer", {
      queueName: "AegisCarePromptTimer",
      encryption: QueueEncryption.SQS_MANAGED,
      visibilityTimeout: Duration.seconds(90),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
    });
    const promptFn = fn("SeniorPrompt", "services/agents/src/lambdas.ts", "seniorPrompt", {
      environment: { PROMPT_TIMER_QUEUE_URL: promptTimer.queueUrl, PROMPT_TIMEOUT_SECONDS: String(props.promptTimeoutSeconds ?? 90) },
    });
    bus.grantPutEventsTo(promptFn);
    tables.events.grantReadWriteData(promptFn);
    promptTimer.grantSendMessages(promptFn);
    promptFn.addEventSource(new SqsEventSource(promptTimer, { batchSize: 1 }));

    const stateFn = fn("StateWriter", "services/agents/src/lambdas.ts", "stateWriter");
    bus.grantPutEventsTo(stateFn);
    for (const t of [tables.seniors, tables.incidents, tables.events, tables.alerts]) t.grantReadWriteData(stateFn);

    const notifyFn = fn("Notify", "services/agents/src/lambdas.ts", "notify", {
      environment: {
        SMS_ORIGINATION_IDENTITY: props.notify?.smsOriginationIdentity ?? "",
        NOTIFY_FROM_EMAIL: props.notify?.fromEmail ?? "",
      },
    });
    tables.caregivers.grantReadData(notifyFn);
    tables.alerts.grantReadWriteData(notifyFn);
    if (props.notify?.smsOriginationIdentity) notifyFn.addToRolePolicy(new PolicyStatement({ actions: ["sms-voice:SendTextMessage"], resources: ["*"] }));
    if (props.notify?.fromEmail) {
      notifyFn.addToRolePolicy(
        new PolicyStatement({ actions: ["ses:SendEmail"], resources: [this.formatArn({ service: "ses", resource: "identity", resourceName: "*" })] }),
      );
    }

    // --- IoT pipeline (SPSQZ, iot-pipeline/) ---
    const iot = new IotPipeline(this, "Iot", { repoPath: repo, bus, tables, deviceId: props.iotDeviceId ?? "esp32_hub_01" });

    // --- caregiver web app ---
    const webApiFn = fn("WebApi", "services/api/src/lambda.ts", "handler", { environment: { DEMO_MODE: String(props.demoMode ?? false) } });
    for (const t of [tables.seniors, tables.caregivers, tables.incidents, tables.events, tables.alerts]) t.grantReadData(webApiFn);
    bus.grantPutEventsTo(webApiFn);
    new CaregiverWeb(this, "Web", { apiFunction: webApiFn, distPath: repo("services/web/dist"), removalPolicy });

    // --- routing ---
    const targets: Partial<Record<Target, IFunction>> = {
      threatAgent: threatFn,
      safetyAgent: safetyFn,
      caregiverAgent: caregiverFn,
      safeWordPrompt: promptFn,
      stateWriter: stateFn,
      notify: notifyFn,
    };
    for (const [key, arn] of Object.entries(props.externalTargets ?? {})) {
      if (arn) targets[key as Target] = LambdaFn.fromFunctionArn(this, `External-${key}`, arn);
    }
    const unwired: string[] = [];
    for (const route of ROUTES) {
      const target = targets[route.target];
      if (!target) {
        unwired.push(route.id);
        continue;
      }
      new Rule(this, `Rule-${route.id}`, {
        eventBus: bus,
        ruleName: route.id,
        eventPattern: route.pattern,
        targets: [new LambdaFunction(target, { deadLetterQueue: dlq, retryAttempts: 2, maxEventAge: Duration.hours(1) })],
      });
    }

    new CfnOutput(this, "McpUrl", { value: `${api.apiEndpoint}/mcp`, description: "Alexa+ MCP endpoint (Streamable HTTP)" });
    new CfnOutput(this, "McpTokenSecret", { value: mcpTokens.secretName, description: "Read the household bearer token from here" });
    new CfnOutput(this, "BusName", { value: bus.eventBusName });
    new CfnOutput(this, "DlqUrl", { value: dlq.queueUrl });
    new CfnOutput(this, "ThreatAgentId", { value: agent ? agent.agent.attrAgentId : "not deployed (set -c foundationModel=...)" });
    new CfnOutput(this, "SafetyAgentId", { value: safetyAgent ? safetyAgent.agent.attrAgentId : "not deployed (set -c foundationModel=...)" });
    new CfnOutput(this, "UnwiredRules", { value: unwired.length ? unwired.join(", ") : "none", description: "Rules with no target" });
    new CfnOutput(this, "NotifyChannels", {
      value: [props.notify?.smsOriginationIdentity && "SMS", props.notify?.fromEmail && "email"].filter(Boolean).join(", ") || "none (alerts are logged only)",
    });
    new CfnOutput(this, "IotThing", { value: iot.thingName, description: "Run scripts/iot-device-setup.ps1 to make its certificate" });
    new CfnOutput(this, "IotPolicy", { value: iot.policyName });
  }
}
