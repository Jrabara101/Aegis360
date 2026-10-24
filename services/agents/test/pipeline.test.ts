import { describe, expect, it } from "vitest";
import {
  InMemoryBus,
  InMemoryDirectory,
  SEVERITIES,
  commonDetail,
  incidentIdForSession,
  type AlertAcknowledgedDetail,
  type AlertDispatchDetail,
  type CaregiverContact,
  type Delivery,
  type IncidentStatus,
  type IncidentUpdate,
  type PendingPrompt,
  type PromptStore,
  type SeniorStatus,
  type StateStore,
  type StoredEvent,
} from "@aegiscare/core";
import { askSenior, checkAnswered, deliverAlert, handleAnomaly, localClock, recordState, seniorStatusFor } from "../src";

const SENIOR = "snr_rosa";
const SESSION = "ses_01CALL";
const INCIDENT = incidentIdForSession(SESSION);

function directory() {
  const d = new InMemoryDirectory();
  d.seniors.set(SENIOR, { senior_id: SENIOR, name: "Rosa", timezone: "America/Chicago", status: "NORMAL", safe_word_hash: null, last_activity_at: null });
  return d;
}

const common = (incident = INCIDENT) => commonDetail({ senior_id: SENIOR, incident_id: incident, correlation_id: SESSION, demo: true });

function threatAssessed(over: Record<string, unknown> = {}) {
  return {
    ...common(),
    session_id: SESSION,
    threat_score: 0.75,
    severity: "HIGH",
    scam_types: ["FAMILY_EMERGENCY"],
    signals: [],
    action: "VERIFY_SAFE_WORD",
    senior_message: null,
    rationale: "test",
    guardrail_intervened: false,
    fallback_used: false,
    severity_increased: true,
    ...over,
  };
}

describe("handleAnomaly", () => {
  it("turns a fall into a Safety.Assessed using the senior's local time", async () => {
    const bus = new InMemoryBus();
    const detail = {
      ...common("inc_fall_1"),
      occurred_at: "2026-10-23T08:10:00.000Z", // 03:10 in Chicago
      device_id: "esp32_hub_01",
      room: "bathroom",
      anomaly_type: "FALL_IMPACT",
      metrics: { impact_g: 4.2 },
      baseline: null,
    };
    const out = await handleAnomaly(detail, { bus, directory: directory() });
    expect(out.severity).toBe("CRITICAL");
    expect(out.action).toBe("ALERT_CAREGIVER");
    expect(out.incident_id).toBe("inc_fall_1");
    expect(bus.ofType("Safety.Assessed")).toHaveLength(1);
  });

  it("falls back to UTC for an unknown timezone", () => {
    expect(localClock("Not/AZone", new Date("2026-10-23T08:10:00Z"))).toBe("08:10");
  });
});

class MemoryPrompts implements PromptStore {
  pending: { prompt: PendingPrompt; say: string }[] = [];
  answered = false;
  attempts = 0;
  async recordPending(prompt: PendingPrompt, say: string) {
    this.pending.push({ prompt, say });
  }
  async answerStatus() {
    return { answered: this.answered, attempts: this.attempts };
  }
}

function promptDeps() {
  const bus = new InMemoryBus();
  const prompts = new MemoryPrompts();
  const scheduled: { prompt: PendingPrompt; delay: number }[] = [];
  const timer = { schedule: async (prompt: PendingPrompt, delay: number) => void scheduled.push({ prompt, delay }) };
  return { bus, prompts, scheduled, deps: { bus, prompts, timer, timeoutSeconds: 90 } };
}

describe("seniorPrompt", () => {
  it("asks for the safe word once and sets a timer", async () => {
    const { prompts, scheduled, deps } = promptDeps();
    await askSenior("Threat.Assessed", threatAssessed(), deps);
    await askSenior("Threat.Assessed", threatAssessed({ severity_increased: false }), deps);
    expect(prompts.pending).toHaveLength(1);
    expect(prompts.pending[0]!.say).toContain("safe word");
    expect(scheduled).toEqual([{ prompt: expect.objectContaining({ kind: "SAFE_WORD", session_id: SESSION }), delay: 90 }]);
  });

  it("reports NO_RESPONSE when the senior never answers", async () => {
    const { bus, prompts, scheduled, deps } = promptDeps();
    await askSenior("Threat.Assessed", threatAssessed(), deps);
    prompts.attempts = 1;
    expect(await checkAnswered(scheduled[0]!.prompt, deps)).toBe("NO_RESPONSE");
    const [result] = bus.ofType("SafeWord.Result");
    expect(result?.detail).toMatchObject({ result: "NO_RESPONSE", attempts: 1, severity: "CRITICAL", incident_id: INCIDENT });
  });

  it("stays quiet when the answer already arrived", async () => {
    const { bus, prompts, scheduled, deps } = promptDeps();
    await askSenior("Threat.Assessed", threatAssessed(), deps);
    prompts.answered = true;
    expect(await checkAnswered(scheduled[0]!.prompt, deps)).toBe("ANSWERED");
    expect(bus.events).toHaveLength(0);
  });

  it("follows a check-in with CheckIn.Result NO_RESPONSE", async () => {
    const { bus, scheduled, deps } = promptDeps();
    const safety = { ...common("inc_fall_1"), risk_score: 0.5, severity: "MEDIUM", action: "CHECK_IN", rationale: "x", fallback_used: false };
    await askSenior("Safety.Assessed", safety, deps);
    await checkAnswered(scheduled[0]!.prompt, deps);
    expect(bus.ofType("CheckIn.Result")[0]?.detail).toMatchObject({ response: "NO_RESPONSE", incident_id: "inc_fall_1" });
  });
});

class MemoryState implements StateStore {
  events: StoredEvent[] = [];
  incidents = new Map<string, { status: IncidentStatus; severity: string; kind: string; title: string }>();
  alerts: string[] = [];
  seniors = new Map<string, { status: SeniorStatus; last: string | null }>();
  constructor(private readonly dir: InMemoryDirectory) {}

  async recordEvent(e: StoredEvent) {
    this.events.push(e);
  }
  async upsertIncident(u: IncidentUpdate) {
    const old = this.incidents.get(u.incident_id);
    const to = u.status ?? old?.status ?? "OPEN";
    const severity = old && SEVERITIES.indexOf(old.severity as never) > SEVERITIES.indexOf(u.severity) ? old.severity : u.severity;
    this.incidents.set(u.incident_id, { status: to, severity, kind: old?.kind ?? u.kind, title: old?.title ?? u.title });
    // Mirror into the directory so listOpenIncidents sees it.
    this.dir.incidents.set(u.senior_id, [
      ...(this.dir.incidents.get(u.senior_id) ?? []).filter((i) => i.incident_id !== u.incident_id),
      { incident_id: u.incident_id, kind: u.kind, status: to, severity: severity as never, title: u.title, opened_at: u.occurred_at },
    ]);
    return { from: old?.status ?? null, to };
  }
  async recordAlert(a: AlertDispatchDetail) {
    this.alerts.push(a.alert_id);
  }
  async acknowledgeAlert(_: AlertAcknowledgedDetail) {}
  async setSeniorStatus(id: string, status: SeniorStatus, last: string | null) {
    this.seniors.set(id, { status, last });
  }
}

function stateDeps() {
  const bus = new InMemoryBus();
  const dir = directory();
  const state = new MemoryState(dir);
  return { bus, state, deps: { bus, state, directory: dir } };
}

describe("stateWriter", () => {
  it("opens an incident, asks the senior, then resolves on a passed safe word", async () => {
    const { bus, state, deps } = stateDeps();
    await recordState("aegiscare.agent.threat", "Threat.Assessed", threatAssessed(), deps);
    expect(state.incidents.get(INCIDENT)).toMatchObject({ status: "ASKING_SENIOR", severity: "HIGH", kind: "SCAM_CALL" });
    expect(state.seniors.get(SENIOR)?.status).toBe("ALERT");

    const passed = { ...common(), session_id: SESSION, result: "PASSED", attempts: 1, channel: "ALEXA_PLUS", severity: "LOW" };
    await recordState("aegiscare.mcp", "SafeWord.Result", passed, deps);
    expect(state.incidents.get(INCIDENT)).toMatchObject({ status: "RESOLVED", severity: "HIGH" });
    expect(state.seniors.get(SENIOR)).toEqual({ status: "NORMAL", last: passed.occurred_at });

    const changes = bus.ofType("Incident.StatusChanged").map((e) => [e.detail.from, e.detail.to]);
    expect(changes).toEqual([
      [null, "ASKING_SENIOR"],
      ["ASKING_SENIOR", "RESOLVED"],
    ]);
  });

  it("logs ordinary call chunks without opening an incident", async () => {
    const { state, deps } = stateDeps();
    await recordState("aegiscare.agent.threat", "Threat.Assessed", threatAssessed({ severity: "LOW", action: "NONE", threat_score: 0.1 }), deps);
    expect(state.events).toHaveLength(1);
    expect(state.incidents.size).toBe(0);
  });

  it("ignores event types outside the contracts", async () => {
    const { state, deps } = stateDeps();
    await recordState("aegiscare.iot", "Sensor.TelemetryStream", { anything: true }, deps);
    expect(state.events).toHaveLength(0);
  });

  it("maps open severities to a senior status", () => {
    expect(seniorStatusFor([])).toBe("NORMAL");
    expect(seniorStatusFor(["LOW", "MEDIUM"])).toBe("WATCH");
    expect(seniorStatusFor(["MEDIUM", "CRITICAL"])).toBe("CRITICAL");
  });
});

function alert(over: Partial<AlertDispatchDetail> = {}) {
  return {
    ...common(),
    alert_id: "alr_01TEST",
    priority: "P1",
    recipients: ["cg_ana", "cg_luis"],
    channels: ["PUSH", "SMS"],
    title: "Possible fall: Rosa",
    body: "Possible fall in the home. Call Rosa now.",
    requires_ack: true,
    ack_deadline: new Date().toISOString(),
    ...over,
  };
}

function notifyDeps(contacts: CaregiverContact[], sender: { sms?: (to: string, t: string) => Promise<void>; email?: (to: string, s: string, t: string) => Promise<void> }) {
  const logged: Delivery[][] = [];
  return {
    logged,
    deps: {
      contacts: { getContacts: async (ids: readonly string[]) => contacts.filter((c) => ids.includes(c.caregiver_id)) },
      sender,
      deliveries: { record: async (_: string, d: Delivery[]) => void logged.push(d) },
    },
  };
}

describe("notify", () => {
  const ana: CaregiverContact = { caregiver_id: "cg_ana", name: "Ana", phone: "+15555550101", email: "ana@example.com" };
  const luis: CaregiverContact = { caregiver_id: "cg_luis", name: "Luis", phone: null, email: "luis@example.com" };

  it("texts who it can and emails the rest", async () => {
    const sent: string[] = [];
    const { deps } = notifyDeps([ana, luis], {
      sms: async (to) => void sent.push(`sms:${to}`),
      email: async (to) => void sent.push(`email:${to}`),
    });
    await deliverAlert(alert(), deps);
    expect(sent.sort()).toEqual(["email:ana@example.com", "email:luis@example.com", "sms:+15555550101"]);
  });

  it("falls back to email when SMS isn't set up", async () => {
    const sent: string[] = [];
    const { deps } = notifyDeps([ana], { email: async (to) => void sent.push(to) });
    const out = await deliverAlert(alert({ recipients: ["cg_ana"], channels: ["SMS"] }), deps);
    expect(sent).toEqual(["ana@example.com"]);
    expect(out).toEqual([{ caregiver_id: "cg_ana", channel: "EMAIL", status: "SENT" }]);
  });

  it("records a skip, not a failure, when nothing is set up", async () => {
    const { deps, logged } = notifyDeps([ana], {});
    const out = await deliverAlert(alert({ recipients: ["cg_ana", "cg_ghost"] }), deps);
    expect(out.map((d) => d.status)).toEqual(["SKIPPED", "SKIPPED"]);
    expect(logged).toHaveLength(1);
  });

  it("throws so EventBridge retries when every delivery failed", async () => {
    const { deps } = notifyDeps([ana], { sms: async () => Promise.reject(new Error("throttled")), email: async () => Promise.reject(new Error("sandbox")) });
    await expect(deliverAlert(alert({ recipients: ["cg_ana"] }), deps)).rejects.toThrow("all 2 deliveries failed");
  });

  it("doesn't retry when someone was reached", async () => {
    const { deps } = notifyDeps([ana, luis], { email: async (to) => (to === "ana@example.com" ? undefined : Promise.reject(new Error("bounce"))) });
    const out = await deliverAlert(alert(), deps);
    expect(out.filter((d) => d.status === "SENT")).toHaveLength(1);
  });
});
