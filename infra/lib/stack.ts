import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Archive, EventBus, Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, Function as LambdaFn, Runtime, type IFunction } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat, type NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import { DataTables } from "./data";
import { ROUTES, type Target } from "./routing";
import { AegisGuardrail, ThreatAgent } from "./threatAgent";

const repo = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

export interface AegisCareStackProps extends StackProps {
  /** Bedrock model ID or inference profile for the agents. Empty → no agent; keyword scoring only. */
  foundationModel?: string;
  /** Senior IDs the generated household token may act for. */
  demoSeniorIds: string[];
  /** Teammates' Lambdas, wired to their rules when given. */
  externalTargets?: Partial<Record<Exclude<Target, "threatAgent" | "caregiverAgent">, string>>;
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
    const agent = props.foundationModel
      ? new ThreatAgent(this, "ThreatAgent", {
          foundationModel: props.foundationModel,
          instructionsPath: repo("services/agents/instructions/threat-agent.md"),
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

    // --- routing ---
    const targets: Partial<Record<Target, IFunction>> = { threatAgent: threatFn, caregiverAgent: caregiverFn };
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
    new CfnOutput(this, "UnwiredRules", { value: unwired.length ? unwired.join(", ") : "none", description: "Rules waiting for a teammate's Lambda ARN" });
  }
}
