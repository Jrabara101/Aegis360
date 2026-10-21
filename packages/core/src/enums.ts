// Enum values from the Event & API Contracts doc, sections 3 and 6.
// Add values at the end only; renaming or removing one is a schema_version bump.

export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SCAM_TYPES = [
  "FAMILY_EMERGENCY",
  "VOICE_CLONE_SUSPECTED",
  "GOVERNMENT_IMPERSONATION",
  "TECH_SUPPORT",
  "ROMANCE",
  "INVESTMENT_CRYPTO",
  "PRIZE_LOTTERY",
  "BANK_IMPERSONATION",
  "OTHER",
] as const;
export type ScamType = (typeof SCAM_TYPES)[number];

export const SIGNAL_TYPES = [
  "URGENT_PAYMENT_DEMAND",
  "GIFT_CARD_REQUEST",
  "CRYPTO_REQUEST",
  "WIRE_TRANSFER_REQUEST",
  "SECRECY_REQUEST",
  "THREAT_OF_ARREST",
  "REMOTE_ACCESS_REQUEST",
  "CREDENTIAL_REQUEST",
  "UNKNOWN_CALLER_CLAIMS_FAMILY",
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const THREAT_ACTIONS = ["NONE", "WARN_SENIOR", "VERIFY_SAFE_WORD", "ALERT_CAREGIVER"] as const;
export type ThreatAction = (typeof THREAT_ACTIONS)[number];

export const SAFE_WORD_RESULTS = ["PASSED", "FAILED", "NO_RESPONSE", "DECLINED"] as const;
export type SafeWordResult = (typeof SAFE_WORD_RESULTS)[number];

export const ANOMALY_TYPES = ["FALL_IMPACT", "POST_IMPACT_IMMOBILITY", "NO_MOTION_WINDOW", "ROUTINE_MISSED"] as const;
export type AnomalyType = (typeof ANOMALY_TYPES)[number];

export const SAFETY_ACTIONS = ["NONE", "CHECK_IN", "ALERT_CAREGIVER"] as const;
export type SafetyAction = (typeof SAFETY_ACTIONS)[number];

export const CHECK_IN_RESPONSES = ["OK", "NEEDS_HELP", "NO_RESPONSE"] as const;
export type CheckInResponse = (typeof CHECK_IN_RESPONSES)[number];

export const ALERT_PRIORITIES = ["P1", "P2", "P3"] as const;
export type AlertPriority = (typeof ALERT_PRIORITIES)[number];

export const ALERT_CHANNELS = ["PUSH", "SMS", "CALL"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const ACK_ACTIONS = ["ACK", "CALLED_SENIOR", "CALLED_EMERGENCY", "FALSE_ALARM"] as const;
export type AckAction = (typeof ACK_ACTIONS)[number];

export const INCIDENT_KINDS = ["SCAM_CALL", "SCAM_REPORT", "FALL", "INACTIVITY", "HELP_REQUEST"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const INCIDENT_STATUSES = ["OPEN", "ASKING_SENIOR", "ESCALATED", "ACKNOWLEDGED", "RESOLVED", "CLOSED"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const SENIOR_STATUSES = ["NORMAL", "WATCH", "ALERT", "CRITICAL"] as const;
export type SeniorStatus = (typeof SENIOR_STATUSES)[number];

export const HELP_REASONS = ["FEEL_UNWELL", "FELL", "SUSPICIOUS_CALL", "OTHER"] as const;
export type HelpReason = (typeof HELP_REASONS)[number];

export const MESSAGE_CHANNELS = ["PHONE_CALL", "TEXT_MESSAGE", "EMAIL", "IN_PERSON", "OTHER"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const SOURCES = {
  voice: "aegiscare.voice",
  iot: "aegiscare.iot",
  threatAgent: "aegiscare.agent.threat",
  safetyAgent: "aegiscare.agent.safety",
  caregiverAgent: "aegiscare.agent.caregiver",
  app: "aegiscare.app",
  mcp: "aegiscare.mcp",
  state: "aegiscare.state",
} as const;
export type Source = (typeof SOURCES)[keyof typeof SOURCES];

export const DETAIL_TYPES = {
  transcriptChunk: "Call.TranscriptChunk",
  threatAssessed: "Threat.Assessed",
  safeWordResult: "SafeWord.Result",
  anomalyDetected: "Sensor.AnomalyDetected",
  safetyAssessed: "Safety.Assessed",
  checkInResult: "CheckIn.Result",
  alertDispatch: "Alert.Dispatch",
  alertAcknowledged: "Alert.Acknowledged",
  incidentStatusChanged: "Incident.StatusChanged",
} as const;
export type DetailType = (typeof DETAIL_TYPES)[keyof typeof DETAIL_TYPES];
