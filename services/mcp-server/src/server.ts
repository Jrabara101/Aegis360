import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  CHECK_IN_RESPONSES,
  HELP_REASONS,
  MESSAGE_CHANNELS,
  SAFE_WORD_RESULTS,
  SCAM_TYPES,
  SENIOR_STATUSES,
  SENIOR_TEMPLATES,
  SEVERITIES,
  SOURCES,
  DETAIL_TYPES,
  assessThreat,
  commonDetail,
  composeAlert,
  incidentIdForSession,
  newId,
  verifySafeWord,
  type EventPublisher,
  type SeniorDirectory,
  type Severity,
  type ThreatAction,
  type ThreatClassifier,
} from "@aegiscare/core";

// Contracts doc, section 4. Five tools; every one calls the same core logic and bus as the
// rest of the system, so Alexa+ adds no logic of its own.

export const SERVER_INFO = { name: "aegiscare-360", version: "0.1.0" } as const;
const MAX_SAFE_WORD_ATTEMPTS = 2;

export interface McpDeps {
  directory: SeniorDirectory;
  bus: EventPublisher;
  /** HMAC pepper for safe-word hashes (Secrets Manager in AWS). */
  pepper: string;
  classifier?: ThreatClassifier;
  demo?: boolean;
  now?: () => Date;
}

/** Who is calling: the senior IDs this household token may act for. */
export interface McpCaller {
  seniorIds: readonly string[];
}

const seniorId = z.string().regex(/^snr_[0-9A-Za-z_]+$/).describe("The senior this request is about");

function ok<T extends Record<string, unknown>>(say: string, structured: T): CallToolResult {
  return { content: [{ type: "text", text: say }], structuredContent: structured };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function buildMcpServer(deps: McpDeps, caller: McpCaller): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "AegisCare protects an older adult from scam calls and checks on them after falls. " +
      "Read each tool's `say` text to the user as written. Never ask the user to share money, codes or passwords.",
  });
  const now = () => deps.now?.() ?? new Date();

  const allowed = (id: string) => caller.seniorIds.includes(id);
  const forbidden = () => fail("This household isn't set up for that person.");

  server.registerTool(
    "check_message_risk",
    {
      title: "Check a call or message for scam risk",
      description:
        "Use when the senior describes a call, text, email or visit and wants to know if it's a scam " +
        "(e.g. 'someone called saying they're from Medicare'). Returns a risk level and advice to read aloud.",
      inputSchema: {
        senior_id: seniorId,
        description: z.string().min(1).max(2000).describe("What the caller or message said, in the senior's words"),
        channel: z.enum(MESSAGE_CHANNELS).optional(),
        claimed_identity: z.string().max(100).optional().describe("Who they said they were, e.g. 'my grandson', 'Medicare'"),
      },
      outputSchema: {
        threat_score: z.number(),
        severity: z.enum(SEVERITIES),
        scam_types: z.array(z.enum(SCAM_TYPES)),
        advice: z.string(),
        incident_id: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      if (!allowed(args.senior_id)) return forbidden();
      const sessionId = newId("ses");
      const incidentId = incidentIdForSession(sessionId);
      const claimed = args.claimed_identity ?? null;
      const text = claimed ? `They said they were ${claimed}. ${args.description}` : args.description;

      const assessment = await assessThreat(
        { sessionId, text, callerIsTrusted: false, claimedIdentity: claimed },
        { classifier: deps.classifier },
      );

      // A report isn't a live call, so there's no caller to ask for the safe word:
      // HIGH and CRITICAL go straight to the family instead.
      const reportAction: ThreatAction =
        assessment.severity === "HIGH" || assessment.severity === "CRITICAL"
          ? "ALERT_CAREGIVER"
          : assessment.severity === "MEDIUM"
            ? "WARN_SENIOR"
            : "NONE";
      const advice =
        reportAction === "ALERT_CAREGIVER"
          ? SENIOR_TEMPLATES.SCAM_REPORT_HIGH
          : reportAction === "WARN_SENIOR"
            ? SENIOR_TEMPLATES.WARN_GENERIC
            : SENIOR_TEMPLATES.ALL_CLEAR;

      await deps.bus.publish(SOURCES.mcp, DETAIL_TYPES.threatAssessed, {
        ...commonDetail({ senior_id: args.senior_id, incident_id: incidentId, correlation_id: sessionId, demo: deps.demo, now: now() }),
        session_id: sessionId,
        threat_score: assessment.threat_score,
        severity: assessment.severity,
        scam_types: assessment.scam_types,
        signals: assessment.signals,
        action: reportAction,
        senior_message: advice,
        rationale: assessment.rationale,
        guardrail_intervened: assessment.guardrail_intervened,
        fallback_used: assessment.fallback_used,
        severity_increased: true,
      });

      return ok(advice, {
        threat_score: assessment.threat_score,
        severity: assessment.severity,
        scam_types: assessment.scam_types,
        advice,
        incident_id: incidentId,
      });
    },
  );

  server.registerTool(
    "verify_safe_word",
    {
      title: "Check the family safe word",
      description:
        "Use during a flagged call, after AegisCare asked the senior for the family safe word. Pass exactly what they said. " +
        "Pass an empty string if they didn't answer. They get two tries.",
      inputSchema: {
        senior_id: seniorId,
        session_id: z.string().regex(/^ses_[0-9A-Za-z_]+$/).describe("The flagged call's session ID"),
        spoken_phrase: z.string().max(100).describe("What the senior said; empty if no answer"),
      },
      outputSchema: {
        result: z.enum(SAFE_WORD_RESULTS),
        attempts_left: z.number().int(),
        final: z.boolean(),
        say: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      if (!allowed(args.senior_id)) return forbidden();
      const senior = await deps.directory.getSenior(args.senior_id);
      if (!senior) return fail("I can't find that person's profile.");
      if (!senior.safe_word_hash) return fail("No family safe word is set up yet. A caregiver can add one in the AegisCare app.");

      const attempts = await deps.directory.incrementSafeWordAttempts(args.senior_id, args.session_id);
      if (attempts > MAX_SAFE_WORD_ATTEMPTS) {
        return ok(SENIOR_TEMPLATES.SAFE_WORD_FAILED, { result: "FAILED", attempts_left: 0, final: true, say: SENIOR_TEMPLATES.SAFE_WORD_FAILED });
      }

      const answered = args.spoken_phrase.trim().length > 0;
      const matched = answered && verifySafeWord(args.spoken_phrase, senior.safe_word_hash, deps.pepper);
      const attemptsLeft = MAX_SAFE_WORD_ATTEMPTS - attempts;

      if (!matched && answered && attemptsLeft > 0) {
        return ok(SENIOR_TEMPLATES.SAFE_WORD_RETRY, { result: "FAILED", attempts_left: attemptsLeft, final: false, say: SENIOR_TEMPLATES.SAFE_WORD_RETRY });
      }

      const result = matched ? "PASSED" : answered ? "FAILED" : "NO_RESPONSE";
      const severity: Severity = matched ? "LOW" : "CRITICAL";
      const say = matched ? SENIOR_TEMPLATES.SAFE_WORD_PASSED : SENIOR_TEMPLATES.SAFE_WORD_FAILED;

      await deps.bus.publish(SOURCES.mcp, DETAIL_TYPES.safeWordResult, {
        ...commonDetail({
          senior_id: args.senior_id,
          incident_id: incidentIdForSession(args.session_id),
          correlation_id: args.session_id,
          demo: deps.demo,
          now: now(),
        }),
        session_id: args.session_id,
        result,
        attempts,
        channel: "ALEXA_PLUS",
        severity,
      });

      return ok(say, { result, attempts_left: matched ? attemptsLeft : 0, final: true, say });
    },
  );

  server.registerTool(
    "respond_to_check_in",
    {
      title: "Answer a safety check-in",
      description: "Use when the senior answers an AegisCare check-in after a possible fall or unusual inactivity.",
      inputSchema: {
        senior_id: seniorId,
        incident_id: z.string().regex(/^inc_[0-9A-Za-z_]+$/),
        response: z.enum(["OK", "NEEDS_HELP"]).describe("OK if they said they're fine, NEEDS_HELP otherwise"),
      },
      outputSchema: {
        status: z.enum(["RESOLVED", "ESCALATED"]),
        say: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      if (!allowed(args.senior_id)) return forbidden();
      const okay = args.response === "OK";
      await deps.bus.publish(SOURCES.mcp, DETAIL_TYPES.checkInResult, {
        ...commonDetail({ senior_id: args.senior_id, incident_id: args.incident_id, correlation_id: args.incident_id, demo: deps.demo, now: now() }),
        response: args.response satisfies (typeof CHECK_IN_RESPONSES)[number],
        attempts: 1,
        severity: okay ? "LOW" : "CRITICAL",
      });
      const say = okay ? SENIOR_TEMPLATES.CHECK_IN_OK : SENIOR_TEMPLATES.HELP_SENT;
      return ok(say, { status: okay ? "RESOLVED" : "ESCALATED", say });
    },
  );

  server.registerTool(
    "get_senior_status",
    {
      title: "How is my family member doing?",
      description: "Use when a caregiver asks how the senior is doing. Returns their status, last activity and open alerts.",
      inputSchema: { senior_id: seniorId },
      outputSchema: {
        status: z.enum(SENIOR_STATUSES),
        last_activity_at: z.string().nullable(),
        open_incidents: z.number().int(),
        summary: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      if (!allowed(args.senior_id)) return forbidden();
      const senior = await deps.directory.getSenior(args.senior_id);
      if (!senior) return fail("I can't find that person's profile.");
      const open = await deps.directory.listOpenIncidents(args.senior_id);
      const summary = statusSummary(senior.name, senior.timezone, senior.last_activity_at, open.length, open[0]?.title);
      return ok(summary, {
        status: senior.status,
        last_activity_at: senior.last_activity_at,
        open_incidents: open.length,
        summary,
      });
    },
  );

  server.registerTool(
    "alert_family",
    {
      title: "Tell my family I need help",
      description:
        "Use when the senior asks to alert or call their family, says they need help, or says they fell. " +
        "Always sends an urgent alert; there's no scoring step.",
      inputSchema: {
        senior_id: seniorId,
        reason: z.enum(HELP_REASONS).optional(),
        note: z.string().max(120).optional().describe("Anything the senior said about what's wrong"),
      },
      outputSchema: {
        alert_id: z.string(),
        recipients_notified: z.number().int(),
        say: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      if (!allowed(args.senior_id)) return forbidden();
      const [senior, caregivers] = await Promise.all([
        deps.directory.getSenior(args.senior_id),
        deps.directory.listCaregivers(args.senior_id),
      ]);
      if (!senior || caregivers.length === 0) return fail(SENIOR_TEMPLATES.HELP_UNREACHABLE);

      const reason = args.reason ?? "OTHER";
      const alert = composeAlert({
        trigger: { kind: "HELP_REQUEST", reason: reason.toLowerCase().replaceAll("_", " "), note: args.note },
        severity: "CRITICAL",
        seniorName: senior.name,
        caregivers,
        now: now(),
      })!;
      const incidentId = newId("inc");
      const alertId = newId("alr");

      await deps.bus.publish(SOURCES.mcp, DETAIL_TYPES.alertDispatch, {
        ...commonDetail({ senior_id: args.senior_id, incident_id: incidentId, correlation_id: incidentId, demo: deps.demo, now: now() }),
        alert_id: alertId,
        ...alert,
      });

      return ok(SENIOR_TEMPLATES.HELP_SENT, {
        alert_id: alertId,
        recipients_notified: alert.recipients.length,
        say: SENIOR_TEMPLATES.HELP_SENT,
      });
    },
  );

  return server;
}

export function statusSummary(
  name: string,
  timezone: string,
  lastActivityAt: string | null,
  openCount: number,
  firstOpenTitle?: string,
): string {
  const parts: string[] = [];
  parts.push(openCount === 0 ? `${name} is doing fine. There are no open alerts.` : `${name} has ${openCount} open alert${openCount === 1 ? "" : "s"}${firstOpenTitle ? `, the latest: ${firstOpenTitle}` : ""}.`);
  if (lastActivityAt) {
    const when = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", weekday: "long" }).format(new Date(lastActivityAt));
    parts.push(`Last activity was ${when}.`);
  }
  return parts.join(" ");
}
