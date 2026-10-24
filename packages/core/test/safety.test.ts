import { describe, expect, it } from "vitest";
import { assessSafety, commonDetail, ruleRisk, type AnomalyDetectedDetail, type SafetyClassifier } from "../src";

function anomaly(anomaly_type: AnomalyDetectedDetail["anomaly_type"], room: string, metrics: Record<string, number>): AnomalyDetectedDetail {
  return {
    ...commonDetail({ senior_id: "snr_rosa", incident_id: "inc_fall_1", correlation_id: "corr_1" }),
    device_id: "esp32_hub_01",
    room,
    anomaly_type,
    metrics,
    baseline: null,
  };
}

const reply = (text: string): SafetyClassifier => ({ classify: async () => text });

describe("ruleRisk", () => {
  it("scores a hard fall in a bathroom at night as critical", () => {
    const r = ruleRisk({ anomaly: anomaly("FALL_IMPACT", "bathroom", { impact_g: 4.23 }), localTime: "02:10" });
    expect(r.score).toBeGreaterThanOrEqual(0.85);
  });

  it("scores a daytime fall elsewhere as high, not critical", () => {
    const r = ruleRisk({ anomaly: anomaly("FALL_IMPACT", "living room", { impact_g: 3.1 }), localTime: "14:00" });
    expect(r.score).toBe(0.7);
  });

  it("treats a minute of stillness after a fall as an emergency", () => {
    const r = ruleRisk({ anomaly: anomaly("POST_IMPACT_IMMOBILITY", "kitchen", { immobile_seconds: 60 }), localTime: "10:00" });
    expect(r.score).toBeGreaterThanOrEqual(0.85);
  });

  it("treats night-time stillness in a bedroom as sleep", () => {
    const r = ruleRisk({ anomaly: anomaly("NO_MOTION_WINDOW", "bedroom", { no_motion_minutes: 300 }), localTime: "03:00" });
    expect(r.score).toBeLessThan(0.4);
  });
});

describe("assessSafety", () => {
  it("uses the rule score when there is no model", async () => {
    const a = await assessSafety({ anomaly: anomaly("ROUTINE_MISSED", "kitchen", { no_motion_minutes: 163 }), localTime: "10:30" });
    expect(a).toMatchObject({ risk_score: 0.5, severity: "MEDIUM", action: "CHECK_IN", fallback_used: false });
  });

  it("lets the model raise the risk", async () => {
    const a = await assessSafety(
      { anomaly: anomaly("ROUTINE_MISSED", "kitchen", {}), localTime: "10:30" },
      { classifier: reply('{"risk_score": 0.9, "rationale": "Missed routine after an earlier unanswered check-in."}') },
    );
    expect(a.severity).toBe("CRITICAL");
    expect(a.action).toBe("ALERT_CAREGIVER");
    expect(a.rationale).toContain("unanswered check-in");
  });

  it("never lets the model lower the risk below the rules", async () => {
    const a = await assessSafety(
      { anomaly: anomaly("POST_IMPACT_IMMOBILITY", "kitchen", { immobile_seconds: 120 }), localTime: "10:00" },
      { classifier: reply('{"risk_score": 0.1, "rationale": "Probably fine."}') },
    );
    expect(a.severity).toBe("CRITICAL");
    expect(a.rationale).not.toContain("Probably fine");
  });

  it("falls back to the rules when the model replies with junk", async () => {
    const a = await assessSafety({ anomaly: anomaly("FALL_IMPACT", "hall", {}), localTime: "12:00" }, { classifier: reply("I can't help with that.") });
    expect(a.fallback_used).toBe(true);
    expect(a.risk_score).toBe(0.7);
  });
});
