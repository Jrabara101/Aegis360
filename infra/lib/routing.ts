import type { EventPattern } from "aws-cdk-lib/aws-events";

// AegisCareBus routing rules (contracts doc, section 2). One entry per EventBridge rule.
// EventBridge ORs values inside a field and ANDs fields, so an "A or B" with different
// fields is two rules with the same target.

export type Target = "threatAgent" | "caregiverAgent" | "safeWordPrompt" | "notify" | "stateWriter";

export interface RouteDef {
  id: string;
  target: Target;
  pattern: EventPattern;
}

const all = { source: [{ prefix: "aegiscare." }] } as unknown as EventPattern;

export const ROUTES: RouteDef[] = [
  { id: "to-threat-agent", target: "threatAgent", pattern: { detailType: ["Call.TranscriptChunk"] } },

  // Asked once per call: only when the severity first reaches HIGH or CRITICAL.
  {
    id: "to-safe-word",
    target: "safeWordPrompt",
    pattern: { detailType: ["Threat.Assessed"], detail: { action: ["VERIFY_SAFE_WORD"], severity_increased: [true] } },
  },

  { id: "to-caregiver-threat-critical", target: "caregiverAgent", pattern: { detailType: ["Threat.Assessed"], detail: { severity: ["CRITICAL"], severity_increased: [true] } } },
  { id: "to-caregiver-threat-report", target: "caregiverAgent", pattern: { detailType: ["Threat.Assessed"], detail: { action: ["ALERT_CAREGIVER"] } } },
  { id: "to-caregiver-safe-word", target: "caregiverAgent", pattern: { detailType: ["SafeWord.Result"], detail: { result: ["FAILED", "NO_RESPONSE"] } } },
  { id: "to-caregiver-check-in", target: "caregiverAgent", pattern: { detailType: ["CheckIn.Result"], detail: { response: ["NEEDS_HELP", "NO_RESPONSE"] } } },
  { id: "to-caregiver-safety", target: "caregiverAgent", pattern: { detailType: ["Safety.Assessed"], detail: { action: ["ALERT_CAREGIVER"] } } },

  { id: "to-notify", target: "notify", pattern: { detailType: ["Alert.Dispatch"] } },
  { id: "to-state", target: "stateWriter", pattern: all },
];
