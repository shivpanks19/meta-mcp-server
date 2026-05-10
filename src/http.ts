/**
 * MCP Streamable HTTP transport for Railway / remote hosts (stateless mode).
 * POST /mcp — MCP JSON-RPC over streamable HTTP.
 * GET /health — health check (no auth).
 *
 * Env: PORT (Railway), META_ACCESS_TOKEN, optional MCP_AUTH_TOKEN, MCP_ALLOWED_HOSTS.
 */
import type { Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { createMetaServer } from "./meta-server.js";

function parseAllowedHosts(): string[] | undefined {
  const raw = process.env.MCP_ALLOWED_HOSTS?.trim();
  if (!raw) return undefined;
  return raw.split(",").map((h) => h.trim()).filter(Boolean);
}

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.MCP_AUTH_TOKEN?.trim();
  if (!secret) {
    next();
    return;
  }
  const auth = req.headers.authorization;
  const expected = `Bearer ${secret}`;
  if (auth !== expected) {
    res.status(401).json({
      error: "Unauthorized",
      hint: "Set Authorization: Bearer <MCP_AUTH_TOKEN>",
    });
    return;
  }
  next();
}

function installMcpRoute(
  app: ReturnType<typeof createMcpExpressApp>,
  path: string,
  ...middlewares: Array<
    (req: Request, res: Response, next: NextFunction) => void
  >
): void {
  const handler = async (req: Request, res: Response): Promise<void> => {
    const server = createMetaServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
    } catch (error) {
      console.error("MCP request error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  };

  app.post(path, ...middlewares, handler);
  app.get(path, ...middlewares, (req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed; use POST for MCP streamable HTTP.",
      },
      id: null,
    });
  });
  app.delete(path, ...middlewares, (req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed in stateless mode.",
      },
      id: null,
    });
  });
}

const port = parseInt(process.env.PORT ?? "8080", 10);
const host = process.env.HOST ?? "0.0.0.0";
const mcpPath = process.env.MCP_HTTP_PATH?.trim() || "/mcp";

const allowedHosts = parseAllowedHosts();
const app = createMcpExpressApp({
  host,
  ...(allowedHosts?.length ? { allowedHosts } : {}),
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "meta-mcp-server",
    mcpPath,
    authRequired: Boolean(process.env.MCP_AUTH_TOKEN?.trim()),
  });
});

installMcpRoute(app, mcpPath, authMiddleware);

app.listen(port, host, () => {
  console.error(
    `meta-mcp-server HTTP listening on http://${host}:${port}${mcpPath} (health: /health)`
  );
});
