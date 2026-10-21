import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { InMemoryBus } from "@aegiscare/core";
import { DEMO, demoDirectory } from "../src/demoData";
import { createMcpHandler } from "../src/http";
import { buildMcpServer } from "../src/server";

async function connect(seniorIds: string[] = [DEMO.seniorId]) {
  const bus = new InMemoryBus();
  const server = buildMcpServer({ directory: demoDirectory(), bus, pepper: DEMO.pepper }, { seniorIds });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, bus };
}

type Structured = Record<string, unknown>;
const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args });
  return { isError: r.isError === true, structured: r.structuredContent as Structured };
};

describe("MCP tools", () => {
  it("lists the five tools with output schemas", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["alert_family", "check_message_risk", "get_senior_status", "respond_to_check_in", "verify_safe_word"],
    );
    for (const t of tools) expect(t.outputSchema).toBeDefined();
  });

  it("check_message_risk flags a fake government call and tells the family", async () => {
    const { client, bus } = await connect();
    const r = await call(client, "check_message_risk", {
      senior_id: DEMO.seniorId,
      description: "He said there is a warrant for my arrest unless I pay the fine with gift cards today.",
      claimed_identity: "the IRS",
      channel: "PHONE_CALL",
    });
    expect(r.isError).toBeFalsy();
    expect(["HIGH", "CRITICAL"]).toContain(r.structured.severity);
    expect(r.structured.scam_types).toContain("GOVERNMENT_IMPERSONATION");
    const [event] = bus.ofType("Threat.Assessed");
    expect(event?.detail.action).toBe("ALERT_CAREGIVER");
  });

  it("check_message_risk reassures on an ordinary message", async () => {
    const { client } = await connect();
    const r = await call(client, "check_message_risk", { senior_id: DEMO.seniorId, description: "My neighbor asked if I want tomatoes from her garden." });
    expect(r.structured.severity).toBe("LOW");
  });

  it("verify_safe_word passes on the right phrase, however it's said", async () => {
    const { client, bus } = await connect();
    const r = await call(client, "verify_safe_word", { senior_id: DEMO.seniorId, session_id: "ses_CALL1", spoken_phrase: "Blue Pelican" });
    expect(r.structured).toMatchObject({ result: "PASSED", final: true });
    expect(bus.ofType("SafeWord.Result")[0]?.detail).toMatchObject({ result: "PASSED", severity: "LOW" });
  });

  it("verify_safe_word allows one retry, then fails and publishes once", async () => {
    const { client, bus } = await connect();
    const args = { senior_id: DEMO.seniorId, session_id: "ses_CALL2", spoken_phrase: "red parrot" };
    const first = await call(client, "verify_safe_word", args);
    expect(first.structured).toMatchObject({ result: "FAILED", attempts_left: 1, final: false });
    expect(bus.ofType("SafeWord.Result")).toHaveLength(0);

    const second = await call(client, "verify_safe_word", args);
    expect(second.structured).toMatchObject({ result: "FAILED", final: true });
    expect(bus.ofType("SafeWord.Result")[0]?.detail).toMatchObject({ result: "FAILED", severity: "CRITICAL", attempts: 2 });

    await call(client, "verify_safe_word", args);
    expect(bus.ofType("SafeWord.Result")).toHaveLength(1);
  });

  it("verify_safe_word treats silence as no response", async () => {
    const { client } = await connect();
    const r = await call(client, "verify_safe_word", { senior_id: DEMO.seniorId, session_id: "ses_CALL3", spoken_phrase: "" });
    expect(r.structured).toMatchObject({ result: "NO_RESPONSE", final: true });
  });

  it("alert_family sends a P1 to every caregiver", async () => {
    const { client, bus } = await connect();
    const r = await call(client, "alert_family", { senior_id: DEMO.seniorId, reason: "FELL" });
    expect(r.structured.recipients_notified).toBe(2);
    expect(bus.ofType("Alert.Dispatch")[0]?.detail).toMatchObject({ priority: "P1", channels: ["PUSH", "SMS"] });
  });

  it("get_senior_status summarises in the senior's timezone", async () => {
    const { client } = await connect();
    const r = await call(client, "get_senior_status", { senior_id: DEMO.seniorId });
    expect(r.structured.status).toBe("NORMAL");
    expect(r.structured.summary).toMatch(/Rosa is doing fine/);
    expect(r.structured.summary).toMatch(/9:05/);
  });

  it("refuses seniors outside the household", async () => {
    const { client, bus } = await connect(["snr_someone_else"]);
    const r = await call(client, "alert_family", { senior_id: DEMO.seniorId });
    expect(r.isError).toBe(true);
    expect(bus.events).toHaveLength(0);
  });
});

describe("Streamable HTTP endpoint", () => {
  const handle = createMcpHandler({
    tokens: { [DEMO.token]: [DEMO.seniorId] },
    deps: { directory: demoDirectory(), bus: new InMemoryBus(), pepper: DEMO.pepper },
  });
  const post = (body: unknown, token: string | null = DEMO.token) =>
    handle(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "alexa-test", version: "1" } },
  };

  it("negotiates protocol 2025-11-25", async () => {
    expect(LATEST_PROTOCOL_VERSION).toBe("2025-11-25");
    const res = await post(initialize);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(body.result.protocolVersion).toBe("2025-11-25");
    expect(body.result.serverInfo.name).toBe("aegiscare-360");
  });

  it("answers tools/list without a session (stateless)", async () => {
    const res = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: unknown[] } };
    expect(body.result.tools).toHaveLength(5);
  });

  it("rejects a missing or wrong token", async () => {
    expect((await post(initialize, null)).status).toBe(401);
    expect((await post(initialize, "wrong")).status).toBe(401);
  });

  it("answers GET and DELETE with 405, since there's no stream or session", async () => {
    for (const method of ["GET", "DELETE"]) {
      const res = await handle(new Request("http://localhost/mcp", { method, headers: { authorization: `Bearer ${DEMO.token}` } }));
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });

  it("returns 404 off the /mcp path", async () => {
    const res = await handle(new Request("http://localhost/other", { method: "POST", headers: { authorization: `Bearer ${DEMO.token}` } }));
    expect(res.status).toBe(404);
  });
});
