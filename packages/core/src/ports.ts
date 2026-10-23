import type { DetailType, IncidentKind, IncidentStatus, SeniorStatus, Severity, Source } from "./enums";
import type { AlertAcknowledgedDetail, AlertDispatchDetail, CommonDetail, DetailFor } from "./events";

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

/** A question AegisCare asked the senior and is waiting on. */
export interface PendingPrompt {
  kind: "SAFE_WORD" | "CHECK_IN";
  senior_id: string;
  incident_id: string;
  /** The flagged call, for a safe-word prompt. */
  session_id: string | null;
  severity: Severity;
  demo: boolean;
  asked_at: string;
}

export interface PromptStore {
  /** Saves the prompt and the line to speak, for the voice side to deliver. */
  recordPending(prompt: PendingPrompt, say: string): Promise<void>;
  /** Whether the senior's answer has arrived since the prompt, and how many safe-word tries they used. */
  answerStatus(prompt: PendingPrompt): Promise<{ answered: boolean; attempts: number }>;
}

/** Wakes the prompt handler again after a delay, to check whether the senior answered. */
export interface PromptTimer {
  schedule(prompt: PendingPrompt, delaySeconds: number): Promise<void>;
}

export interface StoredEvent {
  source: string;
  detailType: DetailType;
  detail: CommonDetail & Record<string, unknown>;
}

export interface IncidentUpdate {
  senior_id: string;
  incident_id: string;
  occurred_at: string;
  /** Used only when the incident is created. */
  kind: IncidentKind;
  /** Used only when the incident is created. */
  title: string;
  /** Raises the incident's severity; never lowers it. */
  severity: Severity;
  /** null leaves the status as it is (OPEN for a new incident). */
  status: IncidentStatus | null;
}

/** Write side of the tables in contracts doc section 7. */
export interface StateStore {
  recordEvent(event: StoredEvent): Promise<void>;
  /** Creates the incident if it's new, then applies the update. Returns the status before and after. */
  upsertIncident(update: IncidentUpdate): Promise<{ from: IncidentStatus | null; to: IncidentStatus }>;
  recordAlert(alert: AlertDispatchDetail): Promise<void>;
  acknowledgeAlert(ack: AlertAcknowledgedDetail): Promise<void>;
  setSeniorStatus(seniorId: string, status: SeniorStatus, lastActivityAt: string | null): Promise<void>;
}

export interface CaregiverContact {
  caregiver_id: string;
  name: string;
  /** E.164, e.g. +15555550123. */
  phone: string | null;
  email: string | null;
}

export interface ContactBook {
  getContacts(caregiverIds: readonly string[]): Promise<CaregiverContact[]>;
}

/** The ways AegisCare can reach a caregiver; a channel is missing when it isn't set up. */
export interface MessageSender {
  sms?: (to: string, text: string) => Promise<void>;
  email?: (to: string, subject: string, text: string) => Promise<void>;
}

export interface Delivery {
  caregiver_id: string;
  channel: "SMS" | "EMAIL";
  status: "SENT" | "FAILED" | "SKIPPED";
  detail?: string;
}

export interface DeliveryLog {
  record(alertId: string, deliveries: Delivery[]): Promise<void>;
}
