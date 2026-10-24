import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { EventBridgePublisher, requireEnv } from "@aegiscare/aws";
import { handleApi, type ApiDeps } from "./app";
import { DynamoApiStore } from "./store";

let deps: ApiDeps | undefined;

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  deps ??= {
    store: new DynamoApiStore({
      seniors: requireEnv("SENIORS_TABLE"),
      caregivers: requireEnv("CAREGIVERS_TABLE"),
      incidents: requireEnv("INCIDENTS_TABLE"),
      events: requireEnv("EVENTS_TABLE"),
      alerts: requireEnv("ALERTS_TABLE"),
    }),
    bus: new EventBridgePublisher(requireEnv("BUS_NAME")),
    demo: process.env.DEMO_MODE === "true",
  };
  const email = event.requestContext.authorizer.jwt.claims.email;
  const body =
    event.body === undefined ? undefined : event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;

  const res = await handleApi(
    { method: event.requestContext.http.method, path: event.rawPath, email: typeof email === "string" ? email : null, body },
    deps,
  );
  return { statusCode: res.status, headers: { "content-type": "application/json" }, body: JSON.stringify(res.body) };
}
