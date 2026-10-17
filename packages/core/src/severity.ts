import type { SafetyAction, Severity, ThreatAction } from "./enums";

// Contracts doc, section 3: severity comes from the score with fixed cut-offs,
// never from the model's own words.
export function severityFromScore(score: number): Severity {
  if (!Number.isFinite(score)) throw new Error(`score must be a finite number, got ${score}`);
  if (score >= 0.85) return "CRITICAL";
  if (score >= 0.7) return "HIGH";
  if (score >= 0.4) return "MEDIUM";
  return "LOW";
}

/** Rounds to the two decimals the contracts require. */
export function roundScore(score: number): number {
  return Math.round(Math.min(1, Math.max(0, score)) * 100) / 100;
}

export function threatActionFor(severity: Severity): ThreatAction {
  switch (severity) {
    case "LOW":
      return "NONE";
    case "MEDIUM":
      return "WARN_SENIOR";
    // CRITICAL also alerts caregivers: the bus routes CRITICAL Threat.Assessed
    // to the Caregiver Agent while the senior is asked for the safe word.
    case "HIGH":
    case "CRITICAL":
      return "VERIFY_SAFE_WORD";
  }
}

export function safetyActionFor(severity: Severity): SafetyAction {
  switch (severity) {
    case "LOW":
      return "NONE";
    case "MEDIUM":
    case "HIGH":
      return "CHECK_IN";
    case "CRITICAL":
      return "ALERT_CAREGIVER";
  }
}
