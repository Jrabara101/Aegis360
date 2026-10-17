import type { AlertChannel, AlertPriority, Severity } from "../enums";
import type { CaregiverRecord } from "../ports";

// The deterministic half of the Caregiver Coordination Agent: who gets told, how, and how
// urgently. These rules never depend on model output. The Bedrock agent may later reword
// title/body, but it can't change recipients, channels or priority.

export type AlertTrigger =
  | { kind: "SCAM_CRITICAL"; scamLabel: string }
  | { kind: "SAFE_WORD_FAILED"; scamLabel: string; result: "FAILED" | "NO_RESPONSE" }
  | { kind: "FALL"; room: string; checkIn: "NO_RESPONSE" | "NEEDS_HELP" | "NOT_ASKED" }
  | { kind: "INACTIVITY"; detail: string }
  | { kind: "HELP_REQUEST"; reason: string; note?: string };

export interface ComposedAlert {
  priority: AlertPriority;
  recipients: string[];
  channels: AlertChannel[];
  title: string;
  body: string;
  requires_ack: boolean;
  ack_deadline: string | null;
}

const ACK_MINUTES: Record<AlertPriority, number | null> = { P1: 5, P2: 30, P3: null };

export function priorityFor(trigger: AlertTrigger, severity: Severity): AlertPriority {
  if (trigger.kind === "HELP_REQUEST") return "P1";
  if (severity === "CRITICAL") return "P1";
  if (severity === "HIGH") return "P2";
  return "P3";
}

function fit(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function words(trigger: AlertTrigger, senior: string): { title: string; body: string } {
  switch (trigger.kind) {
    case "SCAM_CRITICAL":
      return {
        title: `Possible scam call to ${senior}`,
        body: `${trigger.scamLabel}. AegisCare is checking the family safe word now. Tap to review.`,
      };
    case "SAFE_WORD_FAILED":
      return {
        title: `Scam call to ${senior}: safe word ${trigger.result === "FAILED" ? "failed" : "not answered"}`,
        body: `${trigger.scamLabel}. ${senior} was told to hang up. Please call ${senior} now.`,
      };
    case "FALL":
      return {
        title: `Possible fall: ${senior}`,
        body:
          trigger.checkIn === "NEEDS_HELP"
            ? `${senior} said they need help after a possible fall in the ${trigger.room}. Call now.`
            : trigger.checkIn === "NO_RESPONSE"
              ? `Possible fall in the ${trigger.room} and no answer to the check-in. Call ${senior} now.`
              : `Possible fall in the ${trigger.room}. Tap to review.`,
      };
    case "INACTIVITY":
      return { title: `Check on ${senior}`, body: trigger.detail };
    case "HELP_REQUEST":
      return {
        title: `${senior} asked for help`,
        body: `${senior} asked Alexa to alert family (${trigger.reason}).${trigger.note ? ` "${trigger.note}"` : ""}`,
      };
  }
}

export function composeAlert(input: {
  trigger: AlertTrigger;
  severity: Severity;
  seniorName: string;
  caregivers: CaregiverRecord[];
  now?: Date;
}): ComposedAlert | null {
  const priority = priorityFor(input.trigger, input.severity);
  // P3 goes into the daily digest, not a live alert.
  if (priority === "P3") return null;
  if (input.caregivers.length === 0) throw new Error("no caregivers to alert");

  const sorted = [...input.caregivers].sort((a, b) => a.priority - b.priority);
  const firstPriority = sorted[0]!.priority;
  const recipients =
    priority === "P1" ? sorted.map((c) => c.caregiver_id) : sorted.filter((c) => c.priority === firstPriority).map((c) => c.caregiver_id);

  const channels: AlertChannel[] = priority === "P1" ? ["PUSH", "SMS"] : ["PUSH"];
  const { title, body } = words(input.trigger, input.seniorName);
  const minutes = ACK_MINUTES[priority];
  const now = input.now ?? new Date();

  return {
    priority,
    recipients,
    channels,
    title: fit(title, 80),
    body: fit(body, 160),
    requires_ack: minutes !== null,
    ack_deadline: minutes !== null ? new Date(now.getTime() + minutes * 60_000).toISOString() : null,
  };
}

const SCAM_LABELS: Record<string, string> = {
  FAMILY_EMERGENCY: "Caller claimed to be family and asked for money",
  VOICE_CLONE_SUSPECTED: "The caller's voice may be AI-cloned",
  GOVERNMENT_IMPERSONATION: "Caller posed as a government agency",
  TECH_SUPPORT: "Caller posed as tech support",
  ROMANCE: "Caller used a romance pitch to ask for money",
  INVESTMENT_CRYPTO: "Caller pushed a crypto or investment scheme",
  PRIZE_LOTTERY: "Caller claimed a prize or lottery win",
  BANK_IMPERSONATION: "Caller posed as the bank",
  OTHER: "The call showed scam warning signs",
};

export function scamLabel(scamTypes: readonly string[]): string {
  const first = scamTypes.find((t) => t !== "OTHER") ?? scamTypes[0] ?? "OTHER";
  return SCAM_LABELS[first] ?? SCAM_LABELS.OTHER!;
}
