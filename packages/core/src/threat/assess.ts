import type { ScamType, Severity, ThreatAction } from "../enums";
import type { Signal } from "../events";
import { roundScore, severityFromScore, threatActionFor } from "../severity";
import { SENIOR_TEMPLATES, threatTemplateFor } from "../templates";
import { parseAgentOutput, type AgentOutput } from "./agentOutput";
import { scoreKeywords } from "./keywordScorer";

export interface ClassifierInput {
  sessionId: string;
  text: string;
  callerIsTrusted: boolean;
  claimedIdentity: string | null;
}

/** Something that asks a model about a transcript and returns its raw reply. */
export interface ThreatClassifier {
  classify(input: ClassifierInput, signal: AbortSignal): Promise<string>;
}

/** Thrown by a classifier when the Bedrock guardrail blocked the input or output. */
export class GuardrailIntervenedError extends Error {
  override name = "GuardrailIntervenedError";
}

export interface AssessOptions {
  classifier?: ThreatClassifier;
  /** Total time budget for the model, across retries. Contracts doc: 3 s for threat. */
  timeoutMs?: number;
  /** Contracts doc: invalid JSON twice → fallback. */
  maxAttempts?: number;
  onModelError?: (err: unknown, attempt: number) => void;
}

export interface ThreatAssessment {
  threat_score: number;
  severity: Severity;
  scam_types: ScamType[];
  signals: Signal[];
  action: ThreatAction;
  senior_message: string | null;
  rationale: string;
  guardrail_intervened: boolean;
  fallback_used: boolean;
}

async function askModel(
  classifier: ThreatClassifier,
  input: ClassifierInput,
  opts: Required<Pick<AssessOptions, "timeoutMs" | "maxAttempts">> & Pick<AssessOptions, "onModelError">,
): Promise<{ output?: AgentOutput; guardrail: boolean }> {
  const deadline = Date.now() + opts.timeoutMs;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("threat classifier timed out")), remaining);
    try {
      const reply = await Promise.race([
        classifier.classify(input, controller.signal),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }),
        ),
      ]);
      return { output: parseAgentOutput(reply, input.text), guardrail: false };
    } catch (err) {
      opts.onModelError?.(err, attempt);
      if (err instanceof GuardrailIntervenedError) return { guardrail: true };
      if (controller.signal.aborted) break;
    } finally {
      clearTimeout(timer);
    }
  }
  return { guardrail: false };
}

/**
 * Scores a transcript. The model's score is used when it answers in time with valid JSON;
 * the keyword score is always computed and acts as a floor. Severity and action come from
 * fixed cut-offs, and the spoken line from a fixed template, never from the model.
 */
export async function assessThreat(input: ClassifierInput, options: AssessOptions = {}): Promise<ThreatAssessment> {
  const keywords = scoreKeywords(input);

  const { output, guardrail } = options.classifier
    ? await askModel(options.classifier, input, {
        timeoutMs: options.timeoutMs ?? 3000,
        maxAttempts: options.maxAttempts ?? 2,
        onModelError: options.onModelError,
      })
    : { output: undefined, guardrail: false };

  const score = roundScore(Math.max(output?.threat_score ?? 0, keywords.score));
  const severity = severityFromScore(score);
  const template = threatTemplateFor(severity);

  const signals: Signal[] = [...(output?.signals ?? [])];
  for (const s of keywords.signals) if (!signals.some((x) => x.type === s.type)) signals.push(s);

  const scamTypes = [...new Set<ScamType>([...(output?.scam_types ?? []), ...keywords.scamTypes])];
  // "OTHER" only when nothing more specific was found.
  const scam_types = scamTypes.length > 1 ? scamTypes.filter((t) => t !== "OTHER") : scamTypes;

  const rationale =
    output?.rationale ||
    (signals.length
      ? `Keyword check found: ${signals.map((s) => s.type.toLowerCase().replaceAll("_", " ")).join(", ")}.`
      : "No scam signals found.");

  return {
    threat_score: score,
    severity,
    scam_types,
    signals,
    action: threatActionFor(severity),
    senior_message: template ? SENIOR_TEMPLATES[template] : null,
    rationale: rationale.slice(0, 300),
    guardrail_intervened: guardrail,
    fallback_used: Boolean(options.classifier) && !output,
  };
}
