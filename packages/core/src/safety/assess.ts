import { z } from "zod";
import { callAgent, extractJson } from "../agentCall";
import type { SafetyAction, Severity } from "../enums";
import type { AnomalyDetectedDetail } from "../events";
import { roundScore, safetyActionFor, severityFromScore } from "../severity";

// The Physical Safety Agent (instructions: services/agents/instructions/safety-agent.md).
// The rule score below follows the same bands as the instructions and acts as a floor:
// the model can raise the risk, never lower it below what the rules say.

export interface SafetyInput {
  anomaly: AnomalyDetectedDetail;
  /** The senior's local time, HH:MM, so night-time falls score higher. */
  localTime: string;
}

/** Something that asks a model about one anomaly and returns its raw reply. */
export interface SafetyClassifier {
  classify(input: SafetyInput, signal: AbortSignal): Promise<string>;
}

export interface SafetyAssessment {
  risk_score: number;
  severity: Severity;
  action: SafetyAction;
  rationale: string;
  fallback_used: boolean;
}

export class InvalidSafetyOutputError extends Error {
  override name = "InvalidSafetyOutputError";
}

const RawSafetyOutput = z.object({
  risk_score: z.number().min(0).max(1),
  rationale: z.string().default(""),
});

export function parseSafetyOutput(reply: string): { risk_score: number; rationale: string } {
  const parsed = RawSafetyOutput.safeParse(extractJson(reply, (m) => new InvalidSafetyOutputError(m)));
  if (!parsed.success) throw new InvalidSafetyOutputError(`agent reply has the wrong shape: ${parsed.error.message}`);
  return { risk_score: parsed.data.risk_score, rationale: parsed.data.rationale.trim().slice(0, 300) };
}

const isNight = (localTime: string) => {
  const hour = Number(localTime.slice(0, 2));
  return hour >= 22 || hour < 6;
};
const isRiskyRoom = (room: string) => /bath|stair|shower/i.test(room);
const metric = (a: AnomalyDetectedDetail, key: string) => (typeof a.metrics[key] === "number" ? a.metrics[key] : undefined);

/** Deterministic risk score with a one-line reason, used as the floor and as the fallback. */
export function ruleRisk(input: SafetyInput): { score: number; rationale: string } {
  const a = input.anomaly;
  const night = isNight(input.localTime);
  switch (a.anomaly_type) {
    case "FALL_IMPACT": {
      const g = metric(a, "impact_g");
      let score = 0.7;
      if (g !== undefined && g >= 4) score += 0.1;
      if (isRiskyRoom(a.room)) score += 0.05;
      if (night) score += 0.05;
      return { score, rationale: `Fall impact${g !== undefined ? ` of ${g}g` : ""} in the ${a.room}${night ? " at night" : ""}.` };
    }
    case "POST_IMPACT_IMMOBILITY": {
      const s = metric(a, "immobile_seconds") ?? 0;
      const score = s >= 60 ? Math.min(0.95, 0.85 + (s - 60) / 600) : 0.75;
      return { score, rationale: `No movement for ${Math.round(s)} seconds after a fall in the ${a.room}.` };
    }
    case "NO_MOTION_WINDOW": {
      const m = metric(a, "no_motion_minutes") ?? 0;
      if (isRiskyRoom(a.room) && m > 45) return { score: 0.85, rationale: `No motion for ${Math.round(m)} minutes in the ${a.room}.` };
      if (night && /bed/i.test(a.room)) return { score: 0.3, rationale: `Stillness in the ${a.room} at night, likely sleep.` };
      const score = m >= 180 ? 0.7 : m >= 120 ? 0.5 : 0.3;
      return { score, rationale: `No motion anywhere for ${Math.round(m)} minutes.` };
    }
    case "ROUTINE_MISSED":
      return { score: 0.5, rationale: `A usual routine in the ${a.room} did not happen.` };
  }
}

export interface SafetyAssessOptions {
  classifier?: SafetyClassifier;
  /** Total time budget for the model, across retries. */
  timeoutMs?: number;
  maxAttempts?: number;
  onModelError?: (err: unknown, attempt: number) => void;
}

export async function assessSafety(input: SafetyInput, options: SafetyAssessOptions = {}): Promise<SafetyAssessment> {
  const rules = ruleRisk(input);
  const classifier = options.classifier;
  const { output } = classifier
    ? await callAgent((signal) => classifier.classify(input, signal), parseSafetyOutput, {
        timeoutMs: options.timeoutMs ?? 3000,
        maxAttempts: options.maxAttempts ?? 2,
        onModelError: options.onModelError,
      })
    : { output: undefined };

  const score = roundScore(Math.max(output?.risk_score ?? 0, rules.score));
  const severity = severityFromScore(score);
  const rationale = output && output.risk_score >= rules.score && output.rationale ? output.rationale : rules.rationale;
  return {
    risk_score: score,
    severity,
    action: safetyActionFor(severity),
    rationale: rationale.slice(0, 300),
    fallback_used: Boolean(classifier) && !output,
  };
}
