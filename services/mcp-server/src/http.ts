import { createHash, timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer, type McpDeps } from "./server";

/** Household bearer token → the senior IDs it may act for. Stored as a JSON secret. */
export type TokenTable = Record<string, string[]>;

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time lookup, so response timing doesn't leak how much of a token matched. */
export function lookupToken(tokens: TokenTable, presented: string): string[] | undefined {
  const wanted = digest(presented);
  let found: string[] | undefined;
  for (const [token, seniorIds] of Object.entries(tokens)) {
    if (timingSafeEqual(digest(token), wanted)) found = seniorIds;
  }
  return found;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/**
 * Streamable HTTP endpoint (MCP spec 2025-11-25) in stateless mode: every request gets a
 * fresh server and transport, and replies are plain JSON. That fits Lambda, which can't keep
 * a session or an open stream between invocations. GET (the optional server→client stream)
 * gets 405, which the spec allows.
 */
export function createMcpHandler(opts: { deps: McpDeps; tokens: TokenTable; path?: string }) {
  const path = opts.path ?? "/mcp";

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== path) return json(404, { error: "not found" });
    // Stateless: no server→client stream to open (GET) and no session to end (DELETE).
    if (request.method !== "POST") return json(405, { error: "method not allowed" }, { allow: "POST" });

    const auth = request.headers.get("authorization") ?? "";
    const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const seniorIds = presented ? lookupToken(opts.tokens, presented) : undefined;
    if (!seniorIds) {
      return json(401, { error: "unauthorized" }, { "www-authenticate": 'Bearer realm="aegiscare-mcp"' });
    }

    const server = buildMcpServer(opts.deps, { seniorIds });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request, {
        authInfo: { token: presented, clientId: "household", scopes: [], extra: { seniorIds } },
      });
    } finally {
      await server.close();
    }
  };
}
