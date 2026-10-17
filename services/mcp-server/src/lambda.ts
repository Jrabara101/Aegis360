import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { BedrockAgentClassifier, DynamoDirectory, EventBridgePublisher, getSecret, requireEnv } from "@aegiscare/aws";
import { createMcpHandler, type TokenTable } from "./http";

// API Gateway HTTP API → web Request → MCP handler → API Gateway response.

let handlerPromise: Promise<(req: Request) => Promise<Response>> | undefined;

async function init() {
  const [tokensJson, pepper] = await Promise.all([
    getSecret(requireEnv("MCP_TOKENS_SECRET_ID")),
    getSecret(requireEnv("SAFE_WORD_PEPPER_SECRET_ID")),
  ]);
  const agentId = process.env.THREAT_AGENT_ID;
  const aliasId = process.env.THREAT_AGENT_ALIAS_ID;
  return createMcpHandler({
    tokens: parseTokenSecret(tokensJson),
    deps: {
      pepper,
      bus: new EventBridgePublisher(requireEnv("BUS_NAME")),
      directory: new DynamoDirectory({
        seniors: requireEnv("SENIORS_TABLE"),
        caregivers: requireEnv("CAREGIVERS_TABLE"),
        incidents: requireEnv("INCIDENTS_TABLE"),
        events: requireEnv("EVENTS_TABLE"),
      }),
      classifier: agentId && aliasId ? new BedrockAgentClassifier(agentId, aliasId) : undefined,
      demo: process.env.DEMO_MODE === "true",
    },
  });
}

/**
 * Accepts the single-household shape the stack generates, `{"token": "...", "senior_ids": [...]}`,
 * or a full table, `{"<token>": ["snr_..."], ...}`, once there are several households.
 */
export function parseTokenSecret(json: string): TokenTable {
  const value = JSON.parse(json) as unknown;
  if (value && typeof value === "object" && "token" in value && "senior_ids" in value) {
    const { token, senior_ids } = value as { token: string; senior_ids: string[] };
    return { [token]: senior_ids };
  }
  return value as TokenTable;
}

export function toRequest(event: APIGatewayProxyEventV2): Request {
  const host = event.headers.host ?? event.requestContext.domainName;
  const query = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const headers = new Headers();
  for (const [k, v] of Object.entries(event.headers)) if (v !== undefined) headers.set(k, v);
  const method = event.requestContext.http.method;
  const body =
    event.body === undefined || method === "GET" || method === "HEAD"
      ? undefined
      : event.isBase64Encoded
        ? Buffer.from(event.body, "base64")
        : event.body;
  return new Request(`https://${host}${event.rawPath}${query}`, { method, headers, body });
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  handlerPromise ??= init().catch((err) => {
    handlerPromise = undefined;
    throw err;
  });
  const handle = await handlerPromise;
  const response = await handle(toRequest(event));
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => (headers[key] = value));
  return { statusCode: response.status, headers, body: await response.text() };
}
