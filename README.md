# Meta MCP Server

MCP server for Meta Marketing API — ad accounts, campaigns, creatives, insights, pages, leads, weekly reporting, and Google Sheets.

## Modes

| Mode | Command | Use case |
|------|---------|----------|
| **HTTP (remote)** | `npm start` | Render, Railway, VPS — Cursor connects via URL |
| **Stdio (local)** | `npm run start:stdio` | Local Cursor MCP via `node dist/index.js` |

## Remote authentication

When `MCP_SHARED_TOKEN` is set, **every MCP HTTP request** to `/mcp` must include:

```
Authorization: Bearer <token>
```

| Condition | HTTP status |
|-----------|-------------|
| Header missing | `401 Unauthorized` |
| Token does not match | `403 Forbidden` |
| Token matches | Request proceeds (all tools protected automatically) |

Token comparison uses **timing-safe** equality. No per-tool changes are required.

`GET /health` remains public (no auth).

### `.env` example

```bash
META_ACCESS_TOKEN=your_meta_token
MCP_SHARED_TOKEN=hexanovate_meta_2026
MCP_ALLOWED_HOSTS=your-app.onrender.com
```

### Cursor MCP client config

```json
{
  "mcpServers": {
    "meta": {
      "url": "https://mcp.yourdomain.com/mcp",
      "headers": {
        "Authorization": "Bearer hexanovate_meta_2026"
      }
    }
  }
}
```

### Verify deployment

```bash
# Health (no auth)
curl -s https://mcp.yourdomain.com/health

# MCP without token → 401
curl -s -o /dev/null -w "%{http_code}" -X POST https://mcp.yourdomain.com/mcp

# MCP with wrong token → 403
curl -s -o /dev/null -w "%{http_code}" -X POST https://mcp.yourdomain.com/mcp \
  -H "Authorization: Bearer wrong"

# MCP with correct token → 200 or MCP protocol response
curl -s -X POST https://mcp.yourdomain.com/mcp \
  -H "Authorization: Bearer hexanovate_meta_2026" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Build and run

```bash
npm ci
npm run build
npm start
```

## Docs

- [RAILWAY_OR_VPS.md](./RAILWAY_OR_VPS.md) — deployment guide
- [docs/META_WEEKLY_REPORTING.md](./docs/META_WEEKLY_REPORTING.md) — weekly reports + Sheets

## Legacy env

`MCP_AUTH_TOKEN` is still accepted if `MCP_SHARED_TOKEN` is unset (backward compatible). Prefer `MCP_SHARED_TOKEN` for new deployments.
