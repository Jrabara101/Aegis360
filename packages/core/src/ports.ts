import type { DetailType, IncidentKind, IncidentStatus, SeniorStatus, Severity, Source } from "./enums";
import type { DetailFor } from "./events";

/** Publishes one validated event to AegisCareBus (or an in-memory stand-in). */
export interface EventPublisher {
  publish<T extends DetailType>(source: Source, detailType: T, detail: DetailFor<T>): Promise<void>;
}

export interface SeniorRecord {
  senior_id: string;
  name: string;
  timezone: string;
  status: SeniorStatus;
  safe_word_hash: string | null;
  last_activity_at: string | null;
}

export interface IncidentSummary {
  incident_id: string;
  kind: IncidentKind;
  status: IncidentStatus;
  severity: Severity;
  title: string;
  opened_at: string;
}

export interface CaregiverRecord {
  caregiver_id: string;
  name: string;
  relationship: string;
  /** Lower number = contacted first. */
  priority: number;
}

/** Per-call memory that survives across stateless Lambda invocations. */
export interface SessionState {
  /** Records `severity` for the call if it's higher than any seen before; returns whether it was. */
  raiseSeverity(sessionId: string, severity: Severity): Promise<boolean>;
}

/** Read access to the tables in contracts doc section 7, plus the safe-word attempt counter. */
export interface SeniorDirectory {
  getSenior(seniorId: string): Promise<SeniorRecord | undefined>;
  listOpenIncidents(seniorId: string): Promise<IncidentSummary[]>;
  listCaregivers(seniorId: string): Promise<CaregiverRecord[]>;
  /** Atomically adds one attempt for this call and returns the new total. */
  incrementSafeWordAttempts(seniorId: string, sessionId: string): Promise<number>;
}
