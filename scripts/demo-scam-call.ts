import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  InMemoryBus,
  InMemorySessionState,
  commonDetail,
  incidentIdForSession,
  newId,
  type DetailType,
  type PublishedEvent,
} from "@aegiscare/core";
import { BedrockAgentClassifier } from "@aegiscare/aws";
import { handleForCaregiver, handleTranscriptChunk } from "@aegiscare/agents";
import { DEMO, demoDirectory } from "../services/mcp-server/src/demoData";
import { buildMcpServer } from "../services/mcp-server/src/server";

// End-to-end demo path without AWS: scam call → Threat Agent → Alexa+ safe-word check (via
// the real MCP server) → Caregiver alert. The in-memory bus is wired like the EventBridge
// rules in infra/lib/routing.ts.
//
//   npm run demo            senior gets the safe word wrong → family alerted
//   npm run demo -- --pass  senior knows the safe word → no alert
//
// Set THREAT_AGENT_ID and THREAT_AGENT_ALIAS_ID (and AWS credentials) to score with Bedrock;
// otherwise the keyword scorer runs alone.

const scenario = JSON.parse(readFileSync(new URL("./scenarios/grandparent-scam.json", import.meta.url), "utf8")) as {
  name: string;
  caller_last4: string;
  caller_is_trusted: boolean;
  claimed_identity: string | null;
  chunks: string[];
  senior_answers_wrong: string[];
  senior_answers_right: string[];
};
const seniorKnowsSafeWord = process.argv.includes("--pass");

const t0 = Date.now();
const say = (who: string, text: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${who.padEnd(14)} ${text}`);

const bus = new InMemoryBus();
const directory = demoDirectory();
const sessions = new InMemorySessionState();
const agentId = process.env.THREAT_AGENT_ID;
const aliasId = process.env.THREAT_AGENT_ALIAS_ID;
const classifier = agentId && aliasId ? new BedrockAgentClassifier(agentId, aliasId) : undefined;

// Alexa+ talks to the same MCP server the Lambda serves.
const mcp = buildMcpServer({ directory, bus, pepper: DEMO.pepper, demo: true }, { seniorIds: [DEMO.seniorId] });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
const alexa = new Client({ name: "alexa-plus-sim", version: "0.1.0" });
await Promise.all([mcp.connect(serverSide), alexa.connect(clientSide)]);

const is = (type: DetailType) => (e: PublishedEvent) => e.detailType === type;

// to-threat-agent
bus.on(is("Call.TranscriptChunk"), (e) => handleTranscriptChunk(e.detail, { bus, sessions, classifier }).then(() => undefined));

// Threat assessments: what the senior hears, and the safe-word check (to-safe-word).
bus.on(is("Threat.Assessed"), async (e) => {
  const d = e.detail as unknown as { threat_score: number; severity: string; action: string; senior_message: string | null; severity_increased: boolean; session_id: string; signals: { type: string }[]; fallback_used: boolean };
  say("Threat Agent", `score ${d.threat_score.toFixed(2)} → ${d.severity}${d.signals.length ? ` (${d.signals.map((s) => s.type).join(", ")})` : ""}`);
  if (!d.severity_increased || !d.senior_message) return;
  say("Alexa", `"${d.senior_message}"`);
  if (d.action !== "VERIFY_SAFE_WORD") return;

  const answers = seniorKnowsSafeWord ? scenario.senior_answers_right : scenario.senior_answers_wrong;
  for (const answer of answers) {
    say(DEMO.seniorName, `"${answer}"`);
    const r = await alexa.callTool({
      name: "verify_safe_word",
      arguments: { senior_id: DEMO.seniorId, session_id: d.session_id, spoken_phrase: answer },
    });
    const out = r.structuredContent as { say: string; final: boolean };
    say("Alexa", `"${out.say}"`);
    if (out.final) break;
  }
});

bus.on(is("SafeWord.Result"), (e) => say("Safe word", String(e.detail.result)));

// to-caregiver-agent
const forCaregiver = (e: PublishedEvent) =>
  (e.detailType === "Threat.Assessed" && (e.detail.action === "ALERT_CAREGIVER" || (e.detail.severity === "CRITICAL" && e.detail.severity_increased === true))) ||
  (e.detailType === "SafeWord.Result" && (e.detail.result === "FAILED" || e.detail.result === "NO_RESPONSE")) ||
  (e.detailType === "CheckIn.Result" && e.detail.response !== "OK") ||
  (e.detailType === "Safety.Assessed" && e.detail.action === "ALERT_CAREGIVER");
bus.on(forCaregiver, (e) => handleForCaregiver(e.detailType, e.detail, { bus, directory }).then(() => undefined));

// to-notify (Teammate 4's notifyDispatcher → SNS)
bus.on(is("Alert.Dispatch"), (e) => {
  const d = e.detail as unknown as { priority: string; recipients: string[]; channels: string[]; title: string; body: string };
  const names = d.recipients.map((id) => DEMO.caregivers.find((c) => c.caregiver_id === id)?.name ?? id).join(", ");
  say("Family app", `${d.priority} ${d.channels.join("+")} → ${names}`);
  say("", `"${d.title}"`);
  say("", `"${d.body}"`);
});

// --- run the call ---
console.log(`\nAegisCare 360 demo: ${scenario.name}`);
console.log(`Scoring with ${classifier ? "Bedrock agent + keyword floor" : "keyword scorer only (no THREAT_AGENT_ID set)"}`);
console.log(`Senior ${seniorKnowsSafeWord ? "knows" : "doesn't know"} the safe word\n`);

const sessionId = newId("ses");
let context = "";
for (const [seq, text] of scenario.chunks.entries()) {
  say("Caller", `"${text}"`);
  await bus.publish("aegiscare.voice", "Call.TranscriptChunk", {
    ...commonDetail({ senior_id: DEMO.seniorId, incident_id: incidentIdForSession(sessionId), correlation_id: sessionId, demo: true }),
    session_id: sessionId,
    chunk_seq: seq,
    is_final: seq === scenario.chunks.length - 1,
    caller_last4: scenario.caller_last4,
    caller_is_trusted: scenario.caller_is_trusted,
    claimed_identity: scenario.claimed_identity,
    text_redacted: text,
    context_redacted: context || undefined,
  });
  context = `${context}\n${text}`.trim().slice(-2000);
}

console.log(`\n${bus.events.length} events on the bus: ${[...new Set(bus.events.map((e) => e.detailType))].join(", ")}`);
await alexa.close();
