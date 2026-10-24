import {
  DETAIL_SCHEMAS,
  DETAIL_TYPES,
  SEVERITIES,
  SOURCES,
  commonDetail,
  parseDetail,
  type AlertPriority,
  type DetailType,
  type EventPublisher,
  type IncidentUpdate,
  type SeniorDirectory,
  type SeniorStatus,
  type Severity,
  type StateStore,
  type StoredEvent,
} from "@aegiscare/core";

// The stateWriter target: every aegiscare.* event lands here. It keeps the Events log,
// the Incidents and Alerts tables, and the senior's status, and announces status changes.

export interface StateDeps {
  bus: EventPublisher;
  state: StateStore;
  directory: SeniorDirectory;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

const PRIORITY_SEVERITY: Record<AlertPriority, Severity> = { P1: "CRITICAL", P2: "HIGH", P3: "MEDIUM" };

const ANOMALY_TITLES = {
  FALL_IMPACT: (room: string) => `Possible fall in the ${room}`,
  POST_IMPACT_IMMOBILITY: (room: string) => `No movement after a fall in the ${room}`,
  NO_MOTION_WINDOW: (room: string) => `No motion in the ${room}`,
  ROUTINE_MISSED: (room: string) => `Usual routine missed in the ${room}`,
} as const;

/** What an event changes about its incident, or null when it doesn't open or move one. */
export function incidentUpdateFor(event: StoredEvent): IncidentUpdate | null {
  const base = { senior_id: event.detail.senior_id, incident_id: event.detail.incident_id, occurred_at: event.detail.occurred_at };
  switch (event.detailType) {
    case DETAIL_TYPES.threatAssessed: {
      const d = parseDetail(event.detailType, event.detail);
      // Ordinary calls don't become incidents.
      if (d.severity === "LOW") return null;
      const report = event.source === SOURCES.mcp;
      return {
        ...base,
        kind: report ? "SCAM_REPORT" : "SCAM_CALL",
        title: report ? "Suspicious message reported" : "Possible scam call",
        severity: d.severity,
        status:
          d.action === "ALERT_CAREGIVER" ? "ESCALATED" : d.action === "VERIFY_SAFE_WORD" && d.severity_increased ? "ASKING_SENIOR" : null,
      };
    }
    case DETAIL_TYPES.safeWordResult: {
      const d = parseDetail(event.detailType, event.detail);
      return { ...base, kind: "SCAM_CALL", title: "Possible scam call", severity: d.severity, status: d.result === "PASSED" ? "RESOLVED" : "ESCALATED" };
    }
    case DETAIL_TYPES.anomalyDetected: {
      const d = parseDetail(event.detailType, event.detail);
      const fall = d.anomaly_type === "FALL_IMPACT" || d.anomaly_type === "POST_IMPACT_IMMOBILITY";
      // The Safety Agent sets the real severity a moment later.
      return { ...base, kind: fall ? "FALL" : "INACTIVITY", title: ANOMALY_TITLES[d.anomaly_type](d.room), severity: "LOW", status: null };
    }
    case DETAIL_TYPES.safetyAssessed: {
      const d = parseDetail(event.detailType, event.detail);
      return {
        ...base,
        kind: "FALL",
        title: "Safety check",
        severity: d.severity,
        status: d.action === "NONE" ? "RESOLVED" : d.action === "CHECK_IN" ? "ASKING_SENIOR" : "ESCALATED",
      };
    }
    case DETAIL_TYPES.checkInResult: {
      const d = parseDetail(event.detailType, event.detail);
      return { ...base, kind: "FALL", title: "Safety check", severity: d.severity, status: d.response === "OK" ? "RESOLVED" : "ESCALATED" };
    }
    case DETAIL_TYPES.alertDispatch: {
      const d = parseDetail(event.detailType, event.detail);
      return { ...base, kind: "HELP_REQUEST", title: d.title, severity: PRIORITY_SEVERITY[d.priority], status: "ESCALATED" };
    }
    case DETAIL_TYPES.alertAcknowledged: {
      const d = parseDetail(event.detailType, event.detail);
      return { ...base, kind: "HELP_REQUEST", title: "Alert", severity: "LOW", status: d.action === "FALSE_ALARM" ? "RESOLVED" : "ACKNOWLEDGED" };
    }
    default:
      // Call.TranscriptChunk is only logged; Incident.StatusChanged is our own output.
      return null;
  }
}

/** The senior's status follows the worst open incident. */
export function seniorStatusFor(openSeverities: readonly Severity[]): SeniorStatus {
  const worst = Math.max(-1, ...openSeverities.map((s) => SEVERITIES.indexOf(s)));
  if (worst < 0) return "NORMAL";
  if (worst === SEVERITIES.indexOf("CRITICAL")) return "CRITICAL";
  if (worst === SEVERITIES.indexOf("HIGH")) return "ALERT";
  return "WATCH";
}

/** True when the event shows the senior was there and talking. */
function lastActivity(event: StoredEvent): string | null {
  const d = event.detail;
  if (event.detailType === DETAIL_TYPES.safeWordResult && d.result === "PASSED") return d.occurred_at;
  if (event.detailType === DETAIL_TYPES.checkInResult && d.response === "OK") return d.occurred_at;
  return null;
}

export async function recordState(source: string, detailType: string, raw: unknown, deps: StateDeps): Promise<void> {
  if (!(detailType in DETAIL_SCHEMAS)) {
    deps.log?.("unknown detail type, not recorded", { source, detailType });
    return;
  }
  const type = detailType as DetailType;
  const event: StoredEvent = { source, detailType: type, detail: parseDetail(type, raw) as StoredEvent["detail"] };
  await deps.state.recordEvent(event);

  if (type === DETAIL_TYPES.alertDispatch) await deps.state.recordAlert(parseDetail(type, raw));
  if (type === DETAIL_TYPES.alertAcknowledged) await deps.state.acknowledgeAlert(parseDetail(type, raw));

  const update = incidentUpdateFor(event);
  if (!update) return;

  const { from, to } = await deps.state.upsertIncident(update);
  if (from !== to) {
    await deps.bus.publish(SOURCES.state, DETAIL_TYPES.incidentStatusChanged, {
      ...commonDetail({
        senior_id: update.senior_id,
        incident_id: update.incident_id,
        correlation_id: event.detail.correlation_id,
        demo: event.detail.demo,
      }),
      from,
      to,
    });
  }

  const open = await deps.directory.listOpenIncidents(update.senior_id);
  await deps.state.setSeniorStatus(update.senior_id, seniorStatusFor(open.map((i) => i.severity)), lastActivity(event));
  deps.log?.("state recorded", { detailType, incident_id: update.incident_id, from, to });
}
