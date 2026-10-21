import { z } from "zod";
import {
  ACK_ACTIONS,
  ALERT_CHANNELS,
  ALERT_PRIORITIES,
  ANOMALY_TYPES,
  CHECK_IN_RESPONSES,
  DETAIL_TYPES,
  INCIDENT_STATUSES,
  SAFE_WORD_RESULTS,
  SAFETY_ACTIONS,
  SCAM_TYPES,
  SEVERITIES,
  SIGNAL_TYPES,
  THREAT_ACTIONS,
  type DetailType,
} from "./enums";

// Contracts doc, sections 2 and 3. Each detail = the common block + its own fields.

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9A-Za-z_]+$`));
const score = z.number().min(0).max(1);
const timestamp = z.iso.datetime();

export const CommonDetail = z.object({
  schema_version: z.literal("1"),
  event_id: id("evt"),
  senior_id: id("snr"),
  incident_id: id("inc"),
  occurred_at: timestamp,
  correlation_id: z.string().min(1),
  demo: z.boolean(),
});
export type CommonDetail = z.infer<typeof CommonDetail>;

export const Signal = z.object({
  type: z.enum(SIGNAL_TYPES),
  evidence: z.string().min(1).max(200),
});
export type Signal = z.infer<typeof Signal>;

export const TranscriptChunkDetail = CommonDetail.extend({
  session_id: id("ses"),
  chunk_seq: z.number().int().nonnegative(),
  is_final: z.boolean(),
  caller_last4: z.string().regex(/^\d{4}$/).nullable(),
  caller_is_trusted: z.boolean(),
  claimed_identity: z.string().max(100).nullable(),
  text_redacted: z.string().max(2000),
  /** The call so far before this chunk (rolling, ≤ 2000 chars), so signals split across chunks still add up. */
  context_redacted: z.string().max(2000).optional(),
  transcript_ref: z.string().optional(),
});
export type TranscriptChunkDetail = z.infer<typeof TranscriptChunkDetail>;

export const ThreatAssessedDetail = CommonDetail.extend({
  session_id: id("ses"),
  threat_score: score,
  severity: z.enum(SEVERITIES),
  scam_types: z.array(z.enum(SCAM_TYPES)),
  signals: z.array(Signal),
  action: z.enum(THREAT_ACTIONS),
  senior_message: z.string().nullable(),
  rationale: z.string().max(300),
  guardrail_intervened: z.boolean(),
  fallback_used: z.boolean(),
  /** True only on the first assessment of a call at this severity or above. Routing rules key on it,
   * so the senior is asked for the safe word once per call, not once per chunk. */
  severity_increased: z.boolean(),
});
export type ThreatAssessedDetail = z.infer<typeof ThreatAssessedDetail>;

export const SafeWordResultDetail = CommonDetail.extend({
  session_id: id("ses"),
  result: z.enum(SAFE_WORD_RESULTS),
  attempts: z.number().int().nonnegative(),
  channel: z.enum(["ALEXA_PLUS", "PHONE"]),
  severity: z.enum(SEVERITIES),
});
export type SafeWordResultDetail = z.infer<typeof SafeWordResultDetail>;

export const AnomalyDetectedDetail = CommonDetail.extend({
  device_id: z.string().min(1),
  room: z.string().min(1),
  anomaly_type: z.enum(ANOMALY_TYPES),
  metrics: z.record(z.string(), z.number()),
  baseline: z.record(z.string(), z.unknown()).nullable(),
});
export type AnomalyDetectedDetail = z.infer<typeof AnomalyDetectedDetail>;

export const SafetyAssessedDetail = CommonDetail.extend({
  risk_score: score,
  severity: z.enum(SEVERITIES),
  action: z.enum(SAFETY_ACTIONS),
  rationale: z.string().max(300),
  fallback_used: z.boolean(),
});
export type SafetyAssessedDetail = z.infer<typeof SafetyAssessedDetail>;

export const CheckInResultDetail = CommonDetail.extend({
  response: z.enum(CHECK_IN_RESPONSES),
  attempts: z.number().int().nonnegative(),
  severity: z.enum(SEVERITIES),
});
export type CheckInResultDetail = z.infer<typeof CheckInResultDetail>;

export const AlertDispatchDetail = CommonDetail.extend({
  alert_id: id("alr"),
  priority: z.enum(ALERT_PRIORITIES),
  recipients: z.array(id("cg")).min(1),
  channels: z.array(z.enum(ALERT_CHANNELS)).min(1),
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(160),
  requires_ack: z.boolean(),
  ack_deadline: timestamp.nullable(),
});
export type AlertDispatchDetail = z.infer<typeof AlertDispatchDetail>;

export const AlertAcknowledgedDetail = CommonDetail.extend({
  alert_id: id("alr"),
  caregiver_id: id("cg"),
  action: z.enum(ACK_ACTIONS),
});
export type AlertAcknowledgedDetail = z.infer<typeof AlertAcknowledgedDetail>;

export const IncidentStatusChangedDetail = CommonDetail.extend({
  from: z.enum(INCIDENT_STATUSES).nullable(),
  to: z.enum(INCIDENT_STATUSES),
});
export type IncidentStatusChangedDetail = z.infer<typeof IncidentStatusChangedDetail>;

export const DETAIL_SCHEMAS = {
  [DETAIL_TYPES.transcriptChunk]: TranscriptChunkDetail,
  [DETAIL_TYPES.threatAssessed]: ThreatAssessedDetail,
  [DETAIL_TYPES.safeWordResult]: SafeWordResultDetail,
  [DETAIL_TYPES.anomalyDetected]: AnomalyDetectedDetail,
  [DETAIL_TYPES.safetyAssessed]: SafetyAssessedDetail,
  [DETAIL_TYPES.checkInResult]: CheckInResultDetail,
  [DETAIL_TYPES.alertDispatch]: AlertDispatchDetail,
  [DETAIL_TYPES.alertAcknowledged]: AlertAcknowledgedDetail,
  [DETAIL_TYPES.incidentStatusChanged]: IncidentStatusChangedDetail,
} as const satisfies Record<DetailType, z.ZodType>;

export type DetailFor<T extends DetailType> = z.infer<(typeof DETAIL_SCHEMAS)[T]>;

/** Throws a ZodError naming the bad field. Producers call this before publishing. */
export function parseDetail<T extends DetailType>(detailType: T, detail: unknown): DetailFor<T> {
  return DETAIL_SCHEMAS[detailType].parse(detail) as DetailFor<T>;
}
