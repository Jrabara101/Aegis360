import {
  DETAIL_TYPES,
  SOURCES,
  assessThreat,
  commonDetail,
  parseDetail,
  type EventPublisher,
  type SessionState,
  type ThreatAssessedDetail,
  type ThreatClassifier,
} from "@aegiscare/core";

export interface ThreatDeps {
  bus: EventPublisher;
  sessions: SessionState;
  classifier?: ThreatClassifier;
  timeoutMs?: number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

/**
 * Call.TranscriptChunk → Threat.Assessed. The chunk is scored together with the call so far,
 * so a family claim in one chunk and a payment demand in the next still add up.
 */
export async function handleTranscriptChunk(rawDetail: unknown, deps: ThreatDeps): Promise<ThreatAssessedDetail> {
  const chunk = parseDetail(DETAIL_TYPES.transcriptChunk, rawDetail);
  const text = chunk.context_redacted ? `${chunk.context_redacted}\n${chunk.text_redacted}` : chunk.text_redacted;

  const assessment = await assessThreat(
    { sessionId: chunk.session_id, text, callerIsTrusted: chunk.caller_is_trusted, claimedIdentity: chunk.claimed_identity },
    {
      classifier: deps.classifier,
      timeoutMs: deps.timeoutMs,
      onModelError: (err, attempt) =>
        deps.log?.("threat classifier failed", { attempt, error: err instanceof Error ? err.message : String(err) }),
    },
  );

  const severityIncreased = assessment.severity !== "LOW" && (await deps.sessions.raiseSeverity(chunk.session_id, assessment.severity));

  const detail: ThreatAssessedDetail = {
    ...commonDetail({
      senior_id: chunk.senior_id,
      incident_id: chunk.incident_id,
      correlation_id: chunk.session_id,
      demo: chunk.demo,
    }),
    session_id: chunk.session_id,
    ...assessment,
    severity_increased: severityIncreased,
  };

  await deps.bus.publish(SOURCES.threatAgent, DETAIL_TYPES.threatAssessed, detail);
  deps.log?.("threat assessed", {
    session_id: chunk.session_id,
    chunk_seq: chunk.chunk_seq,
    score: detail.threat_score,
    severity: detail.severity,
    action: detail.action,
    severity_increased: severityIncreased,
    fallback_used: detail.fallback_used,
  });
  return detail;
}
