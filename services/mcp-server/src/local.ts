import { createServer, type IncomingMessage } from "node:http";
import { InMemoryBus } from "@aegiscare/core";
import { DEMO, demoDirectory } from "./demoData";
import { createMcpHandler } from "./http";

// Local MCP server with the demo household and an in-memory bus that prints every event.
// Try it with the MCP Inspector: npx @modelcontextprotocol/inspector → Streamable HTTP →
// http://127.0.0.1:8787/mcp with header Authorization: Bearer dev-household-token

const port = Number(process.env.PORT ?? 8787);
const bus = new InMemoryBus();
bus.on(
  () => true,
  (e) => console.log(`\n[bus] ${e.source} → ${e.detailType}\n${JSON.stringify(e.detail, null, 2)}`),
);

const handle = createMcpHandler({
  tokens: { [DEMO.token]: [DEMO.seniorId] },
  deps: { directory: demoDirectory(), bus, pepper: DEMO.pepper, demo: true },
});

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(`http://${req.headers.host ?? "127.0.0.1"}${req.url ?? "/"}`, {
    method: req.method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });
}

createServer(async (req, res) => {
  try {
    const response = await handle(await toRequest(req));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "content-type": "application/json" }).end('{"error":"internal"}');
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`AegisCare MCP server on http://127.0.0.1:${port}/mcp`);
  console.log(`Auth header: Authorization: Bearer ${DEMO.token}   (senior_id: ${DEMO.seniorId}, safe word: "${DEMO.safeWord}")`);
});
