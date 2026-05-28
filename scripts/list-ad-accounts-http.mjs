import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2] ?? "http://127.0.0.1:8080/mcp";
const transport = new StreamableHTTPClientTransport(new URL(url));
const client = new Client({ name: "meta-mcp-http-test", version: "1.0.0" });

await client.connect(transport);
try {
  const r = await client.callTool({
    name: "meta_list_ad_accounts",
    arguments: {},
  });
  console.log(r.content?.[0]?.text ?? JSON.stringify(r, null, 2));
} finally {
  await client.close();
}
