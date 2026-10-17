import { describe, expect, it } from "vitest";
import { InMemoryBus, InMemoryDirectory, InMemorySessionState, commonDetail, incidentIdForSession } from "@aegiscare/core";
import { handleForCaregiver, handleTranscriptChunk } from "../src";

const SESSION = "ses_01TESTCALL";

function chunk(seq: number, text: string, context?: string) {
  return {
    ...commonDetail({ senior_id: "snr_rosa", incident_id: incidentIdForSession(SESSION), correlation_id: SESSION }),
    session_id: SESSION,
    chunk_seq: seq,
    is_final: false,
    caller_last4: "0199",
    caller_is_trusted: false,
    claimed_identity: null,
    text_redacted: text,
    context_redacted: context,
  };
}

function directory() {
  const d = new InMemoryDirectory();
  d.seniors.set("snr_rosa", { senior_id: "snr_rosa", name: "Rosa", timezone: "UTC", status: "NORMAL", safe_word_hash: null, last_activity_at: null });
  d.caregivers.set("snr_rosa", [{ caregiver_id: "cg_ana", name: "Ana", relationship: "daughter", priority: 1 }]);
  return d;
}

describe("handleTranscriptChunk", () => {
  it("adds up signals across chunks using the call context", async () => {
    const bus = new InMemoryBus();
    const deps = { bus, sessions: new InMemorySessionState() };
    const first = "Grandma, it's me, your grandson.";
    const second = "I'm in jail and I need [AMOUNT] for bail today. Don't tell Mom.";

    const a1 = await handleTranscriptChunk(chunk(0, first), deps);
    const a2 = await handleTranscriptChunk(chunk(1, second, first), deps);

    expect(a1.severity).toBe("LOW");
    expect(a2.severity).toBe("HIGH");
    expect(a2.action).toBe("VERIFY_SAFE_WORD");
    expect(a2.severity_increased).toBe(true);
    expect(bus.ofType("Threat.Assessed")).toHaveLength(2);
  });

  it("flags a severity rise once, not on every chunk", async () => {
    const deps = { bus: new InMemoryBus(), sessions: new InMemorySessionState() };
    const text = "Grandma it's me, your grandson. I need [AMOUNT] for bail today. Don't tell Mom.";
    const a1 = await handleTranscriptChunk(chunk(0, text), deps);
    const a2 = await handleTranscriptChunk(chunk(1, "Please hurry.", text), deps);
    expect(a1.severity_increased).toBe(true);
    expect(a2.severity).toBe("HIGH");
    expect(a2.severity_increased).toBe(false);
  });

  it("rejects a chunk that breaks the contract", async () => {
    const deps = { bus: new InMemoryBus(), sessions: new InMemorySessionState() };
    await expect(handleTranscriptChunk({ ...chunk(0, "hi"), caller_last4: "+15555550199" }, deps)).rejects.toThrow();
  });
});

describe("handleForCaregiver", () => {
  const base = commonDetail({ senior_id: "snr_rosa", incident_id: incidentIdForSession(SESSION), correlation_id: SESSION });

  it("alerts on a failed safe word", async () => {
    const bus = new InMemoryBus();
    const alert = await handleForCaregiver(
      "SafeWord.Result",
      { ...base, session_id: SESSION, result: "FAILED", attempts: 2, channel: "ALEXA_PLUS", severity: "CRITICAL" },
      { bus, directory: directory() },
    );
    expect(alert?.priority).toBe("P1");
    expect(alert?.title).toMatch(/Rosa/);
    expect(bus.ofType("Alert.Dispatch")).toHaveLength(1);
  });

  it("stays quiet when the safe word passes", async () => {
    const bus = new InMemoryBus();
    const alert = await handleForCaregiver(
      "SafeWord.Result",
      { ...base, session_id: SESSION, result: "PASSED", attempts: 1, channel: "ALEXA_PLUS", severity: "LOW" },
      { bus, directory: directory() },
    );
    expect(alert).toBeNull();
    expect(bus.events).toHaveLength(0);
  });

  it("ignores a repeated CRITICAL assessment for the same call", async () => {
    const bus = new InMemoryBus();
    const assessed = {
      ...base,
      session_id: SESSION,
      threat_score: 0.95,
      severity: "CRITICAL",
      scam_types: ["FAMILY_EMERGENCY"],
      signals: [],
      action: "VERIFY_SAFE_WORD",
      senior_message: null,
      rationale: "x",
      guardrail_intervened: false,
      fallback_used: false,
    };
    expect(await handleForCaregiver("Threat.Assessed", { ...assessed, severity_increased: true }, { bus, directory: directory() })).not.toBeNull();
    expect(await handleForCaregiver("Threat.Assessed", { ...assessed, severity_increased: false }, { bus, directory: directory() })).toBeNull();
  });
});
