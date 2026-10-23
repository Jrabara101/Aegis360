import { describe, expect, it } from "vitest";
import { InMemoryBus } from "@aegiscare/core";
import { handleApi, type AlertRow, type ApiStore, type EventRow } from "../src/app";

const alertRow: AlertRow = {
  alert_id: "alr_01A",
  incident_id: "inc_01A",
  senior_id: "snr_rosa",
  priority: "P1",
  title: "Possible fall: Rosa",
  body: "Call Rosa now.",
  status: "SENT",
  created_at: "2026-10-23T08:00:00.000Z",
  ack_action: null,
};

const event = (senior_id: string): EventRow => ({ senior_id, detail_type: "Safety.Assessed", source: "aegiscare.agent.safety", occurred_at: "", detail: {} });

const store: ApiStore = {
  caregiversByEmail: async (email) =>
    email === "ana@example.com" ? [{ caregiver_id: "cg_ana", senior_id: "snr_rosa", name: "Ana", relationship: "daughter" }] : [],
  getSenior: async (id) =>
    id === "snr_rosa" || id === "snr_other"
      ? { senior_id: id, name: "Rosa", timezone: "UTC", status: "NORMAL", safe_word_hash: "v1:secret", last_activity_at: null }
      : undefined,
  recentIncidents: async () => [],
  recentAlerts: async () => [alertRow],
  incidentEvents: async (id) => (id === "inc_01A" ? [event("snr_rosa")] : id === "inc_01B" ? [event("snr_other")] : []),
  getAlert: async (id) => (id === alertRow.alert_id ? alertRow : id === "alr_01B" ? { ...alertRow, alert_id: "alr_01B", senior_id: "snr_other" } : undefined),
};

const call = (method: string, path: string, email: string | null = "Ana@Example.com", body?: string) => {
  const bus = new InMemoryBus();
  return handleApi({ method, path, email, body }, { store, bus }).then((res) => ({ res, bus }));
};

describe("caregiver API", () => {
  it("returns the caller's seniors without the safe-word hash", async () => {
    const { res } = await call("GET", "/me");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("secret");
    expect(res.body).toMatchObject({ seniors: [{ senior_id: "snr_rosa", name: "Rosa" }] });
  });

  it("refuses an account that isn't linked to a senior", async () => {
    expect((await call("GET", "/me", "stranger@example.com")).res.status).toBe(403);
    expect((await call("GET", "/me", null)).res.status).toBe(401);
  });

  it("hides seniors and incidents the caller isn't linked to", async () => {
    expect((await call("GET", "/seniors/snr_other/overview")).res.status).toBe(404);
    expect((await call("GET", "/incidents/inc_01B/events")).res.status).toBe(404);
    expect((await call("GET", "/incidents/inc_01A/events")).res.status).toBe(200);
  });

  it("publishes Alert.Acknowledged for the caller's own alert", async () => {
    const { res, bus } = await call("POST", "/alerts/alr_01A/ack", undefined, JSON.stringify({ action: "CALLED_SENIOR" }));
    expect(res.status).toBe(202);
    expect(bus.ofType("Alert.Acknowledged")[0]?.detail).toMatchObject({ alert_id: "alr_01A", caregiver_id: "cg_ana", action: "CALLED_SENIOR" });
  });

  it("rejects acknowledging someone else's alert or an unknown action", async () => {
    expect((await call("POST", "/alerts/alr_01B/ack", undefined, "{}")).res.status).toBe(404);
    expect((await call("POST", "/alerts/alr_01A/ack", undefined, JSON.stringify({ action: "DELETE" }))).res.status).toBe(400);
  });
});
