# Deploy Meta MCP Server (Railway or VPS)

This project exposes the Meta Marketing API as an MCP server over **Streamable HTTP** (`src/http.ts`). Local development uses **stdio** (`npm run start:stdio`).

---

## Prerequisites

- **Node.js** 18+
- A Meta **user or system user access token** with the scopes you need (for example `ads_read`, `ads_management`, `business_management`, `pages_show_list`, `leads_retrieval`).
- **Never commit tokens.** Use your host’s secret store only.

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `META_ACCESS_TOKEN` | Yes | Meta Graph API access token |
| `META_PAGE_ACCESS_TOKEN` | No | Page token for lead forms / some page endpoints |
| `META_GRAPH_VERSION` | No | API version (default `v21.0`) |
| `PORT` | Auto on Railway | HTTP port (default **8080** locally) |
| `HOST` | No | Bind address (default **0.0.0.0**) |
| `MCP_HTTP_PATH` | No | MCP route (default **`/mcp`**) |
| `MCP_SHARED_TOKEN` | Recommended in production | If set, clients must send `Authorization: Bearer <token>` on MCP requests (401 missing, 403 invalid) |
| `MCP_AUTH_TOKEN` | Legacy | Alias for `MCP_SHARED_TOKEN` when the latter is unset |
| `MCP_ALLOWED_HOSTS` | Recommended public hosts | Comma-separated allowed `Host` values (e.g. `your-app.up.railway.app`) |

---

## Deploy on Railway

1. **Create a project** and connect this repo (branch **`railway-mcp-server`** recommended until merged to `main`).

2. **Build command:**  
   `npm ci && npm run build`

3. **Start command:**  
   `npm start`  
   (runs `node dist/http.js`.)

4. **Variables** (in Railway **Variables**):

   - `META_ACCESS_TOKEN` = your Meta token  
   - `MCP_SHARED_TOKEN` = a long random secret (protects `/mcp`)  
   - `MCP_ALLOWED_HOSTS` = your Railway hostname, e.g. `your-service.up.railway.app`  

   Railway injects **`PORT`** automatically—do not override unless you know why.

5. **Health check:** HTTP GET **`/health`**  
   Expected JSON includes `"ok": true`.

6. **Public URL:** After deploy, your MCP endpoint is:

   `https://<your-railway-host><MCP_HTTP_PATH>`  

   Default path: **`https://<host>/mcp`**.

7. **Cursor (remote MCP):** Configure your MCP client with that HTTPS URL and Bearer token:

   ```json
   {
     "mcpServers": {
       "meta": {
         "url": "https://<your-railway-host>/mcp",
         "headers": {
           "Authorization": "Bearer <MCP_SHARED_TOKEN>"
         }
       }
     }
   }
   ```

---

## Deploy on a VPS (Ubuntu-style)

### 1. Install Node

Use Node 18+ (nvm, distro packages, or NodeSource).

### 2. Clone and build

```bash
git clone https://github.com/shivpanks19/meta-mcp-server.git
cd meta-mcp-server
git checkout railway-mcp-server   # or main after merge
npm ci
npm run build
```

### 3. Environment file

Create `/etc/meta-mcp.env` (permissions `600`, owned by root or deploy user):

```bash
META_ACCESS_TOKEN=your_meta_token
MCP_SHARED_TOKEN=your_long_random_secret
HOST=0.0.0.0
PORT=8080
MCP_ALLOWED_HOSTS=your.domain.com
```

### 4. Run under systemd

`/etc/systemd/system/meta-mcp.service`:

```ini
[Unit]
Description=Meta MCP HTTP Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/meta-mcp-server
EnvironmentFile=/etc/meta-mcp.env
ExecStart=/usr/bin/node dist/http.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now meta-mcp.service
```

Validate:

```bash
curl -s http://127.0.0.1:8080/health
```

### 5. Reverse proxy + TLS (recommended)

Put **Nginx** or **Caddy** in front:

- Proxy **`/`** to `http://127.0.0.1:8080` (or your `PORT`).
- Serve HTTPS on port 443 (Let’s Encrypt).

Ensure **`MCP_ALLOWED_HOSTS`** includes the public hostname clients use (`Host` header).

Example Nginx location:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

---

## Security checklist

- Use **HTTPS** on the public internet.
- Set **`MCP_SHARED_TOKEN`** and require `Authorization: Bearer` on `/mcp`.
- Restrict **`MCP_ALLOWED_HOSTS`** to your real hostname(s).
- Rotate Meta tokens on expiry; store secrets only in the platform secret manager.

---

## Local reference

| Command | Purpose |
|---------|---------|
| `npm run start` | HTTP server (same as production default) |
| `npm run start:stdio` | Stdio MCP for Cursor local config |
| `npm run dev:http` | HTTP from TypeScript source |

---

## Repository

- **GitHub:** [shivpanks19/meta-mcp-server](https://github.com/shivpanks19/meta-mcp-server)

Use branch **`railway-mcp-server`** for HTTP deployment assets until merged into **`main`**.
