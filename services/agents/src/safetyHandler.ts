import {
  DETAIL_TYPES,
  SOURCES,
  assessSafety,
  commonDetail,
  parseDetail,
  type EventPublisher,
  type SafetyAssessedDetail,
  type SafetyClassifier,
  type SeniorDirectory,
} from "@aegiscare/core";

export interface SafetyDeps {
  bus: EventPublisher;
  directory: SeniorDirectory;
  classifier?: SafetyClassifier;
  timeoutMs?: number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

/** HH:MM in the senior's timezone; UTC when the timezone is missing or unknown. */
export function localClock(timezone: string, at: Date): string {
  const format = (timeZone: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  try {
    return format(timezone);
  } catch {
    return format("UTC");
  }
}

/** Sensor.AnomalyDetected → Safety.Assessed. */
export async function handleAnomaly(rawDetail: unknown, deps: SafetyDeps): Promise<SafetyAssessedDetail> {
  const anomaly = parseDetail(DETAIL_TYPES.anomalyDetected, rawDetail);
  const senior = await deps.directory.getSenior(anomaly.senior_id);
  const localTime = localClock(senior?.timezone ?? "UTC", new Date(anomaly.occurred_at));

  const assessment = await assessSafety(
    { anomaly, localTime },
    {
      classifier: deps.classifier,
      timeoutMs: deps.timeoutMs,
      onModelError: (err, attempt) =>
        deps.log?.("safety classifier failed", { attempt, error: err instanceof Error ? err.message : String(err) }),
    },
  );

  const detail: SafetyAssessedDetail = {
    ...commonDetail({
      senior_id: anomaly.senior_id,
      incident_id: anomaly.incident_id,
      correlation_id: anomaly.correlation_id,
      demo: anomaly.demo,
    }),
    ...assessment,
  };
  await deps.bus.publish(SOURCES.safetyAgent, DETAIL_TYPES.safetyAssessed, detail);
  deps.log?.("safety assessed", {
    incident_id: anomaly.incident_id,
    anomaly_type: anomaly.anomaly_type,
    score: detail.risk_score,
    severity: detail.severity,
    action: detail.action,
    fallback_used: detail.fallback_used,
  });
  return detail;
}
