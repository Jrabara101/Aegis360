import {
  DETAIL_TYPES,
  SENIOR_TEMPLATES,
  SOURCES,
  commonDetail,
  parseDetail,
  type DetailType,
  type EventPublisher,
  type PendingPrompt,
  type PromptStore,
  type PromptTimer,
} from "@aegiscare/core";

// The safeWordPrompt target: asks the senior a question and, if no answer arrives in time,
// publishes NO_RESPONSE so the Caregiver Agent alerts the family. Staying silent is never
// treated as "all fine".

export interface PromptDeps {
  bus: EventPublisher;
  prompts: PromptStore;
  timer: PromptTimer;
  /** How long the senior has to answer before the family is told. */
  timeoutSeconds: number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
  now?: () => Date;
}

/** The question an event calls for, or null. The bus rules already filter; this repeats them. */
export function promptFor(detailType: DetailType, raw: unknown, now: Date): PendingPrompt | null {
  if (detailType === DETAIL_TYPES.threatAssessed) {
    const d = parseDetail(detailType, raw);
    if (d.action !== "VERIFY_SAFE_WORD" || !d.severity_increased) return null;
    return { kind: "SAFE_WORD", ...pick(d), session_id: d.session_id, severity: d.severity, asked_at: now.toISOString() };
  }
  if (detailType === DETAIL_TYPES.safetyAssessed) {
    const d = parseDetail(detailType, raw);
    if (d.action !== "CHECK_IN") return null;
    return { kind: "CHECK_IN", ...pick(d), session_id: null, severity: d.severity, asked_at: now.toISOString() };
  }
  return null;
}

function pick(d: { senior_id: string; incident_id: string; demo: boolean }) {
  return { senior_id: d.senior_id, incident_id: d.incident_id, demo: d.demo };
}

export async function askSenior(detailType: DetailType, raw: unknown, deps: PromptDeps): Promise<PendingPrompt | null> {
  const prompt = promptFor(detailType, raw, deps.now?.() ?? new Date());
  if (!prompt) {
    deps.log?.("no prompt", { detailType });
    return null;
  }
  const say = prompt.kind === "SAFE_WORD" ? SENIOR_TEMPLATES.SAFE_WORD_PROMPT : SENIOR_TEMPLATES.CHECK_IN;
  await deps.prompts.recordPending(prompt, say);
  await deps.timer.schedule(prompt, deps.timeoutSeconds);
  deps.log?.("senior prompted", { kind: prompt.kind, incident_id: prompt.incident_id, timeout_s: deps.timeoutSeconds });
  return prompt;
}

/** Runs when the timer fires. */
export async function checkAnswered(prompt: PendingPrompt, deps: PromptDeps): Promise<"ANSWERED" | "NO_RESPONSE"> {
  const { answered, attempts } = await deps.prompts.answerStatus(prompt);
  if (answered) {
    deps.log?.("senior answered", { kind: prompt.kind, incident_id: prompt.incident_id });
    return "ANSWERED";
  }

  const common = commonDetail({
    senior_id: prompt.senior_id,
    incident_id: prompt.incident_id,
    correlation_id: prompt.session_id ?? prompt.incident_id,
    demo: prompt.demo,
    now: deps.now?.(),
  });
  if (prompt.kind === "SAFE_WORD") {
    if (!prompt.session_id) throw new Error(`safe-word prompt for ${prompt.incident_id} has no session_id`);
    await deps.bus.publish(SOURCES.voice, DETAIL_TYPES.safeWordResult, {
      ...common,
      session_id: prompt.session_id,
      result: "NO_RESPONSE",
      attempts,
      channel: "ALEXA_PLUS",
      severity: "CRITICAL",
    });
  } else {
    await deps.bus.publish(SOURCES.voice, DETAIL_TYPES.checkInResult, { ...common, response: "NO_RESPONSE", attempts: 1, severity: "CRITICAL" });
  }
  deps.log?.("no answer from senior", { kind: prompt.kind, incident_id: prompt.incident_id });
  return "NO_RESPONSE";
}
