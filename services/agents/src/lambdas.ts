import type { EventBridgeEvent, SQSEvent } from "aws-lambda";
import {
  BedrockAgentClassifier,
  BedrockSafetyClassifier,
  DynamoContactBook,
  DynamoDeliveryLog,
  DynamoDirectory,
  DynamoPromptStore,
  DynamoSessionState,
  DynamoStateStore,
  EventBridgePublisher,
  SqsPromptTimer,
  awsMessageSender,
  requireEnv,
} from "@aegiscare/aws";
import type { DetailType, PendingPrompt } from "@aegiscare/core";
import { handleForCaregiver } from "./caregiverHandler";
import { deliverAlert } from "./notifyHandler";
import { askSenior, checkAnswered, type PromptDeps } from "./promptHandler";
import { handleAnomaly } from "./safetyHandler";
import { recordState } from "./stateHandler";
import { handleTranscriptChunk } from "./threatHandler";

// EventBridge targets. Clients are built once per container. A thrown error makes
// EventBridge retry, then send the event to AegisCareDLQ.

const log = (msg: string, data?: Record<string, unknown>) => console.log(JSON.stringify({ msg, ...data }));

const bus = new EventBridgePublisher(requireEnv("BUS_NAME"));
const eventsTable = requireEnv("EVENTS_TABLE");

const agentId = process.env.THREAT_AGENT_ID;
const aliasId = process.env.THREAT_AGENT_ALIAS_ID;
const classifier = agentId && aliasId ? new BedrockAgentClassifier(agentId, aliasId) : undefined;

export async function threatAgentInvoker(event: EventBridgeEvent<string, unknown>) {
  await handleTranscriptChunk(event.detail, {
    bus,
    sessions: new DynamoSessionState(eventsTable),
    classifier,
    timeoutMs: Number(process.env.THREAT_TIMEOUT_MS ?? 3000),
    log,
  });
}

let directory: DynamoDirectory | undefined;
const getDirectory = () =>
  (directory ??= new DynamoDirectory({
    seniors: requireEnv("SENIORS_TABLE"),
    caregivers: requireEnv("CAREGIVERS_TABLE"),
    incidents: requireEnv("INCIDENTS_TABLE"),
    events: eventsTable,
  }));

export async function caregiverAgentInvoker(event: EventBridgeEvent<string, unknown>) {
  await handleForCaregiver(event["detail-type"] as DetailType, event.detail, { bus, directory: getDirectory(), log });
}

const safetyAgentId = process.env.SAFETY_AGENT_ID;
const safetyAliasId = process.env.SAFETY_AGENT_ALIAS_ID;
const safetyClassifier = safetyAgentId && safetyAliasId ? new BedrockSafetyClassifier(safetyAgentId, safetyAliasId) : undefined;

export async function safetyAgentInvoker(event: EventBridgeEvent<string, unknown>) {
  await handleAnomaly(event.detail, {
    bus,
    directory: getDirectory(),
    classifier: safetyClassifier,
    timeoutMs: Number(process.env.SAFETY_TIMEOUT_MS ?? 3000),
    log,
  });
}

let promptDeps: PromptDeps | undefined;
const getPromptDeps = () =>
  (promptDeps ??= {
    bus,
    prompts: new DynamoPromptStore(eventsTable),
    timer: new SqsPromptTimer(requireEnv("PROMPT_TIMER_QUEUE_URL")),
    timeoutSeconds: Number(process.env.PROMPT_TIMEOUT_SECONDS ?? 90),
    log,
  });

/** Two triggers: the bus (ask the senior) and the timer queue (did they answer?). */
export async function seniorPrompt(event: EventBridgeEvent<string, unknown> | SQSEvent) {
  if ("Records" in event) {
    for (const record of event.Records) await checkAnswered(JSON.parse(record.body) as PendingPrompt, getPromptDeps());
    return;
  }
  await askSenior(event["detail-type"] as DetailType, event.detail, getPromptDeps());
}

let state: DynamoStateStore | undefined;

export async function stateWriter(event: EventBridgeEvent<string, unknown>) {
  state ??= new DynamoStateStore({
    seniors: requireEnv("SENIORS_TABLE"),
    incidents: requireEnv("INCIDENTS_TABLE"),
    events: eventsTable,
    alerts: requireEnv("ALERTS_TABLE"),
  });
  await recordState(event.source, event["detail-type"], event.detail, { bus, state, directory: getDirectory(), log });
}

const sender = awsMessageSender({
  smsOriginationIdentity: process.env.SMS_ORIGINATION_IDENTITY || undefined,
  fromEmail: process.env.NOTIFY_FROM_EMAIL || undefined,
});

export async function notify(event: EventBridgeEvent<string, unknown>) {
  await deliverAlert(event.detail, {
    contacts: new DynamoContactBook(requireEnv("CAREGIVERS_TABLE")),
    sender,
    deliveries: new DynamoDeliveryLog(requireEnv("ALERTS_TABLE")),
    log,
  });
}
