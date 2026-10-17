import { describe, expect, it } from "vitest";
import {
  InMemorySessionState,
  commonDetail,
  composeAlert,
  hashSafeWord,
  incidentIdForSession,
  newId,
  normalisePhrase,
  parseDetail,
  ulid,
  verifySafeWord,
} from "../src";

const PEPPER = "test-pepper-0123456789";

describe("ids", () => {
  it("makes sortable ULIDs", () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_001);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a < b).toBe(true);
  });

  it("derives the same incident from a session every time", () => {
    const ses = newId("ses");
    expect(incidentIdForSession(ses)).toBe(incidentIdForSession(ses));
    expect(incidentIdForSession(ses)).toMatch(/^inc_/);
  });
});

describe("event contracts", () => {
  const base = commonDetail({ senior_id: "snr_A", incident_id: "inc_A", correlation_id: "ses_A" });

  it("accepts a valid transcript chunk", () => {
    const chunk = {
      ...base,
      session_id: "ses_A",
      chunk_seq: 0,
      is_final: false,
      caller_last4: "0199",
      caller_is_trusted: false,
      claimed_identity: null,
      text_redacted: "hello",
    };
    expect(parseDetail("Call.TranscriptChunk", chunk).chunk_seq).toBe(0);
  });

  it("rejects a full phone number where only last 4 digits are allowed", () => {
    expect(() =>
      parseDetail("Call.TranscriptChunk", {
        ...base,
        session_id: "ses_A",
        chunk_seq: 0,
        is_final: false,
        caller_last4: "+15555550199",
        caller_is_trusted: false,
        claimed_identity: null,
        text_redacted: "hello",
      }),
    ).toThrow();
  });

  it("rejects an SMS body over 160 characters", () => {
    expect(() =>
      parseDetail("Alert.Dispatch", {
        ...base,
        alert_id: "alr_A",
        priority: "P1",
        recipients: ["cg_A"],
        channels: ["SMS"],
        title: "t",
        body: "x".repeat(161),
        requires_ack: true,
        ack_deadline: null,
      }),
    ).toThrow();
  });
});

describe("safe word", () => {
  it("ignores case, punctuation and extra spaces", () => {
    expect(normalisePhrase("  Blue,  PELICAN! ")).toBe("blue pelican");
    const hash = hashSafeWord("blue pelican", PEPPER);
    expect(verifySafeWord("Blue Pelican.", hash, PEPPER)).toBe(true);
    expect(verifySafeWord("blue penguin", hash, PEPPER)).toBe(false);
    expect(verifySafeWord("", hash, PEPPER)).toBe(false);
  });

  it("never contains the phrase and depends on the pepper", () => {
    const hash = hashSafeWord("blue pelican", PEPPER);
    expect(hash).not.toContain("pelican");
    expect(verifySafeWord("blue pelican", hash, "another-pepper-0123456")).toBe(false);
  });
});

describe("session state", () => {
  it("reports a rise only once per severity level", async () => {
    const s = new InMemorySessionState();
    expect(await s.raiseSeverity("ses_A", "MEDIUM")).toBe(true);
    expect(await s.raiseSeverity("ses_A", "MEDIUM")).toBe(false);
    expect(await s.raiseSeverity("ses_A", "HIGH")).toBe(true);
    expect(await s.raiseSeverity("ses_A", "MEDIUM")).toBe(false);
    expect(await s.raiseSeverity("ses_B", "LOW")).toBe(true);
  });
});

describe("composeAlert", () => {
  const caregivers = [
    { caregiver_id: "cg_B", name: "Luis", relationship: "son", priority: 2 },
    { caregiver_id: "cg_A", name: "Ana", relationship: "daughter", priority: 1 },
  ];
  const now = new Date("2026-10-18T14:00:00Z");

  it("sends P1 to everyone by push and SMS with a 5-minute ack", () => {
    const a = composeAlert({ trigger: { kind: "SAFE_WORD_FAILED", scamLabel: "A caller asked for money", result: "FAILED" }, severity: "CRITICAL", seniorName: "Rosa", caregivers, now })!;
    expect(a.priority).toBe("P1");
    expect(a.recipients).toEqual(["cg_A", "cg_B"]);
    expect(a.channels).toEqual(["PUSH", "SMS"]);
    expect(a.ack_deadline).toBe("2026-10-18T14:05:00.000Z");
    expect(a.body.length).toBeLessThanOrEqual(160);
  });

  it("sends P2 only to the first contact, by push", () => {
    const a = composeAlert({ trigger: { kind: "INACTIVITY", detail: "No kitchen motion by 10:00." }, severity: "HIGH", seniorName: "Rosa", caregivers, now })!;
    expect(a.priority).toBe("P2");
    expect(a.recipients).toEqual(["cg_A"]);
    expect(a.channels).toEqual(["PUSH"]);
  });

  it("holds MEDIUM for the digest", () => {
    expect(composeAlert({ trigger: { kind: "INACTIVITY", detail: "x" }, severity: "MEDIUM", seniorName: "Rosa", caregivers, now })).toBeNull();
  });

  it("always treats a help request as P1", () => {
    const a = composeAlert({ trigger: { kind: "HELP_REQUEST", reason: "fell", note: "x".repeat(300) }, severity: "LOW", seniorName: "Rosa", caregivers, now })!;
    expect(a.priority).toBe("P1");
    expect(a.body.length).toBeLessThanOrEqual(160);
  });
});
