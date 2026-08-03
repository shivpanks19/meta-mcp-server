# Meta MCP Server

MCP server for Meta Marketing API — ad accounts, campaigns, creatives, insights, pages, leads, weekly reporting, and Google Sheets.

## Modes

| Mode | Command | Use case |
|------|---------|----------|
| **HTTP (remote)** | `npm start` | Render, Railway, VPS — Cursor connects via URL |
| **Stdio (local)** | `npm run start:stdio` | Local Cursor MCP via `node dist/index.js` (no Bearer auth) |

Bearer auth (`MCP_SHARED_TOKEN`) applies only to the **HTTP server** (`npm start`), not stdio.

### Local HTTP + MCP Inspector (with Bearer)

Terminal 1 — start HTTP server (loads `.env` including `MCP_SHARED_TOKEN`):

```bash
npm run build && npm start
```

Terminal 2 — Inspector against HTTP with token:

```bash
npm run inspector:http
```

Or manually:

```bash
npx @modelcontextprotocol/inspector \
  --transport http \
  --server-url http://127.0.0.1:8080/mcp \
  --header "Authorization: Bearer hexanovate_meta_2026"
```

**Do not** use `npx @modelcontextprotocol/inspector node dist/index.js` to test Bearer auth — that is stdio and bypasses HTTP middleware.

## Remote authentication (dual mode)

When `MCP_SHARED_TOKEN` is set, **every MCP HTTP request** to `/mcp` must authenticate using **either**:

**Option A — Bearer header (recommended for Cursor):**
```
Authorization: Bearer <token>
```

**Option B — Query parameter (clients that cannot set headers):**
```
https://mcp.yourdomain.com/mcp?key=<token>
```

| Condition | HTTP status |
|-----------|-------------|
| No Bearer and no `?key=` | `401 Unauthorized` |
| Wrong Bearer or wrong `?key=` | `403 Forbidden` |
| Valid Bearer **or** valid `?key=` | Request proceeds (all tools protected automatically) |

Token comparison uses **timing-safe** equality. No per-tool changes are required.

`GET /health` remains public (no auth).

> **Note:** Query-string secrets can appear in logs and browser history. Prefer Bearer for Cursor and production. ChatGPT connectors may flag API keys in URLs as unsafe.

### `.env` example

```bash
META_ACCESS_TOKEN=your_meta_token
MCP_SHARED_TOKEN=hexanovate_meta_2026
MCP_ALLOWED_HOSTS=your-app.onrender.com
```

### Cursor MCP client config (Bearer)

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

### Query-key URL example

```
https://meta-mcp-server.onrender.com/mcp?key=hexanovate_meta_2026
```

### Verify deployment

```bash
# Health (no auth)
curl -s https://mcp.yourdomain.com/health

# MCP without credentials → 401
curl -s -o /dev/null -w "%{http_code}" -X POST https://mcp.yourdomain.com/mcp

# MCP with wrong ?key= → 403
curl -s -o /dev/null -w "%{http_code}" -X POST "https://mcp.yourdomain.com/mcp?key=wrong"

# MCP with correct ?key= (passes auth; may return 406 without MCP Accept headers)
curl -s -o /dev/null -w "%{http_code}" -X POST "https://mcp.yourdomain.com/mcp?key=hexanovate_meta_2026"

# MCP with Bearer → preferred for full MCP clients
curl -s -X POST https://mcp.yourdomain.com/mcp \
  -H "Authorization: Bearer hexanovate_meta_2026" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Build and run

```bash
npm ci
npm run build
npm test
npm start          # HTTP live MCP (Railway / Render)
npm run start:stdio # Local Cursor stdio
```

### Social publishing & SMM (Facebook + Instagram)

- [docs/SOCIAL_PUBLISHING.md](./docs/SOCIAL_PUBLISHING.md) — publish posts, carousels, cross-post to FB + IG
- [docs/SOCIAL_SMM.md](./docs/SOCIAL_SMM.md) — insights, comments, scheduling, moderation

## Docs

- [RAILWAY_OR_VPS.md](./RAILWAY_OR_VPS.md) — deployment guide
- [docs/SOCIAL_PUBLISHING.md](./docs/SOCIAL_PUBLISHING.md) — Facebook & Instagram publishing
- [docs/SOCIAL_SMM.md](./docs/SOCIAL_SMM.md) — SMM insights, comments, scheduling
- [docs/META_WEEKLY_REPORTING.md](./docs/META_WEEKLY_REPORTING.md) — weekly reports + Sheets
- [docs/PPC_MANAGER_TOOLS.md](./docs/PPC_MANAGER_TOOLS.md) — AI-assisted PPC planning, diagnostics, and safe mutation tools

## Meta Ads mutation safety

Set `META_ADS_DISABLE_MUTATIONS=1` to block all Meta Graph API writes from this
server. Set `META_ADS_MUTATE_VALIDATE_ONLY=1` to force the safe PPC manager
mutation tools to return proposed payloads without applying changes.

## Legacy env

`MCP_AUTH_TOKEN` is still accepted if `MCP_SHARED_TOKEN` is unset (backward compatible). Prefer `MCP_SHARED_TOKEN` for new deployments.
