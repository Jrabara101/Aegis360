import type { EventBridgeEvent } from "aws-lambda";
import { BedrockAgentClassifier, DynamoDirectory, DynamoSessionState, EventBridgePublisher, requireEnv } from "@aegiscare/aws";
import type { DetailType } from "@aegiscare/core";
import { handleForCaregiver } from "./caregiverHandler";
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

export async function caregiverAgentInvoker(event: EventBridgeEvent<string, unknown>) {
  directory ??= new DynamoDirectory({
    seniors: requireEnv("SENIORS_TABLE"),
    caregivers: requireEnv("CAREGIVERS_TABLE"),
    incidents: requireEnv("INCIDENTS_TABLE"),
    events: eventsTable,
  });
  await handleForCaregiver(event["detail-type"] as DetailType, event.detail, { bus, directory, log });
}
