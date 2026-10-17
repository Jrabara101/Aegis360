import {
  DETAIL_TYPES,
  SOURCES,
  commonDetail,
  composeAlert,
  newId,
  parseDetail,
  scamLabel,
  type AlertDispatchDetail,
  type AlertTrigger,
  type DetailType,
  type EventPublisher,
  type SeniorDirectory,
  type Severity,
} from "@aegiscare/core";

export interface CaregiverDeps {
  bus: EventPublisher;
  directory: SeniorDirectory;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

interface Decision {
  trigger: AlertTrigger;
  severity: Severity;
  senior_id: string;
  incident_id: string;
  correlation_id: string;
  demo: boolean;
}

/**
 * Turns an incoming event into an alert decision, or null when the family shouldn't be told.
 * The bus rules already filter; these checks repeat them so a broad rule can't spam caregivers.
 */
export function decide(detailType: DetailType, raw: unknown): Decision | null {
  switch (detailType) {
    case DETAIL_TYPES.threatAssessed: {
      const d = parseDetail(detailType, raw);
      const reportToFamily = d.action === "ALERT_CAREGIVER";
      const liveCritical = d.severity === "CRITICAL" && d.severity_increased;
      if (!reportToFamily && !liveCritical) return null;
      return { ...pick(d), severity: d.severity, trigger: { kind: "SCAM_CRITICAL", scamLabel: scamLabel(d.scam_types) } };
    }
    case DETAIL_TYPES.safeWordResult: {
      const d = parseDetail(detailType, raw);
      if (d.result !== "FAILED" && d.result !== "NO_RESPONSE") return null;
      // The safe word failing is what proves the call is a scam, so it's always urgent.
      return { ...pick(d), severity: "CRITICAL", trigger: { kind: "SAFE_WORD_FAILED", scamLabel: "A caller asked for money", result: d.result } };
    }
    case DETAIL_TYPES.checkInResult: {
      const d = parseDetail(detailType, raw);
      if (d.response === "OK") return null;
      return { ...pick(d), severity: "CRITICAL", trigger: { kind: "FALL", room: "home", checkIn: d.response } };
    }
    case DETAIL_TYPES.safetyAssessed: {
      const d = parseDetail(detailType, raw);
      if (d.action !== "ALERT_CAREGIVER") return null;
      return { ...pick(d), severity: d.severity, trigger: { kind: "FALL", room: "home", checkIn: "NOT_ASKED" } };
    }
    default:
      return null;
  }
}

function pick(d: { senior_id: string; incident_id: string; correlation_id: string; demo: boolean }) {
  return { senior_id: d.senior_id, incident_id: d.incident_id, correlation_id: d.correlation_id, demo: d.demo };
}

export async function handleForCaregiver(
  detailType: DetailType,
  raw: unknown,
  deps: CaregiverDeps,
): Promise<AlertDispatchDetail | null> {
  const decision = decide(detailType, raw);
  if (!decision) {
    deps.log?.("no alert", { detailType });
    return null;
  }

  const [senior, caregivers] = await Promise.all([
    deps.directory.getSenior(decision.senior_id),
    deps.directory.listCaregivers(decision.senior_id),
  ]);
  if (!senior) throw new Error(`unknown senior ${decision.senior_id}`);
  if (caregivers.length === 0) throw new Error(`senior ${decision.senior_id} has no caregivers to alert`);

  const alert = composeAlert({ trigger: decision.trigger, severity: decision.severity, seniorName: senior.name, caregivers });
  if (!alert) return null;

  const detail: AlertDispatchDetail = {
    ...commonDetail({
      senior_id: decision.senior_id,
      incident_id: decision.incident_id,
      correlation_id: decision.correlation_id,
      demo: decision.demo,
    }),
    alert_id: newId("alr"),
    ...alert,
  };
  await deps.bus.publish(SOURCES.caregiverAgent, DETAIL_TYPES.alertDispatch, detail);
  deps.log?.("alert dispatched", { alert_id: detail.alert_id, priority: detail.priority, recipients: detail.recipients.length });
  return detail;
}
