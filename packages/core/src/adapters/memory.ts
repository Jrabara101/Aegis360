import { SEVERITIES, type DetailType, type Severity, type Source } from "../enums";
import { parseDetail, type DetailFor } from "../events";
import type { CaregiverRecord, EventPublisher, IncidentSummary, SeniorDirectory, SeniorRecord, SessionState } from "../ports";

export interface PublishedEvent {
  source: Source;
  detailType: DetailType;
  detail: Record<string, unknown> & { incident_id: string; senior_id: string };
}

type Handler = (event: PublishedEvent) => Promise<void> | void;

/**
 * Stands in for AegisCareBus in tests and the local demo. Validates every detail against
 * the contracts, like the real producers must, and calls subscribers in publish order.
 */
export class InMemoryBus implements EventPublisher {
  readonly events: PublishedEvent[] = [];
  private readonly handlers: { match: (e: PublishedEvent) => boolean; handler: Handler }[] = [];

  async publish<T extends DetailType>(source: Source, detailType: T, detail: DetailFor<T>): Promise<void> {
    const event: PublishedEvent = { source, detailType, detail: parseDetail(detailType, detail) as PublishedEvent["detail"] };
    this.events.push(event);
    for (const h of this.handlers) if (h.match(event)) await h.handler(event);
  }

  on(match: (e: PublishedEvent) => boolean, handler: Handler): void {
    this.handlers.push({ match, handler });
  }

  ofType(detailType: DetailType): PublishedEvent[] {
    return this.events.filter((e) => e.detailType === detailType);
  }
}

export class InMemorySessionState implements SessionState {
  private readonly highest = new Map<string, number>();

  async raiseSeverity(sessionId: string, severity: Severity) {
    const rank = SEVERITIES.indexOf(severity);
    if (rank <= (this.highest.get(sessionId) ?? -1)) return false;
    this.highest.set(sessionId, rank);
    return true;
  }
}

export class InMemoryDirectory implements SeniorDirectory {
  readonly seniors = new Map<string, SeniorRecord>();
  readonly caregivers = new Map<string, CaregiverRecord[]>();
  readonly incidents = new Map<string, IncidentSummary[]>();
  private readonly attempts = new Map<string, number>();

  async getSenior(seniorId: string) {
    return this.seniors.get(seniorId);
  }

  async listOpenIncidents(seniorId: string) {
    return (this.incidents.get(seniorId) ?? []).filter((i) => i.status !== "RESOLVED" && i.status !== "CLOSED");
  }

  async listCaregivers(seniorId: string) {
    return this.caregivers.get(seniorId) ?? [];
  }

  async incrementSafeWordAttempts(seniorId: string, sessionId: string) {
    const key = `${seniorId}/${sessionId}`;
    const next = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, next);
    return next;
  }
}
