import { z } from "zod";
import { SCAM_TYPES, SIGNAL_TYPES, type ScamType } from "../enums";
import type { Signal } from "../events";

// Contracts doc, section 5: the Threat Agent returns only this JSON.

const RawAgentOutput = z.object({
  threat_score: z.number().min(0).max(1),
  scam_types: z.array(z.string()).default([]),
  signals: z
    .array(z.object({ type: z.string(), evidence: z.string() }))
    .default([]),
  rationale: z.string().default(""),
});

export interface AgentOutput {
  threat_score: number;
  scam_types: ScamType[];
  signals: Signal[];
  rationale: string;
  /** Signals or scam types removed because they weren't in the enums or quoted text that isn't there. */
  dropped: number;
}

export class InvalidAgentOutputError extends Error {
  override name = "InvalidAgentOutputError";
}

/** Pulls the JSON object out of the model's reply, tolerating code fences or a stray sentence around it. */
function extractJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) throw new InvalidAgentOutputError("no JSON object in agent reply");
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch (err) {
    throw new InvalidAgentOutputError(`agent reply is not valid JSON: ${(err as Error).message}`);
  }
}

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Parses and checks the agent's reply against the text it was given.
 * Any `evidence` that isn't a substring of `sourceText` is dropped, so the agent can't invent quotes.
 */
export function parseAgentOutput(reply: string, sourceText: string): AgentOutput {
  const parsed = RawAgentOutput.safeParse(extractJson(reply));
  if (!parsed.success) throw new InvalidAgentOutputError(`agent reply has the wrong shape: ${parsed.error.message}`);
  const raw = parsed.data;
  const haystack = normalise(sourceText);
  let dropped = 0;

  const signals: Signal[] = [];
  for (const s of raw.signals) {
    const type = (SIGNAL_TYPES as readonly string[]).includes(s.type) ? (s.type as Signal["type"]) : null;
    const evidence = s.evidence.trim().slice(0, 200);
    if (!type || !evidence || !haystack.includes(normalise(evidence))) {
      dropped++;
      continue;
    }
    if (!signals.some((x) => x.type === type)) signals.push({ type, evidence });
  }

  const scam_types: ScamType[] = [];
  for (const t of raw.scam_types) {
    if ((SCAM_TYPES as readonly string[]).includes(t)) {
      if (!scam_types.includes(t as ScamType)) scam_types.push(t as ScamType);
    } else dropped++;
  }

  return {
    threat_score: raw.threat_score,
    scam_types,
    signals,
    rationale: raw.rationale.trim().slice(0, 300),
    dropped,
  };
}
