# Meta weekly reporting (TypeScript)

Weekly insights → transform → Google Sheets runs **entirely in this Node repo** (no Python).

## Entrypoints

| Trigger | How |
|---------|-----|
| **MCP tool** | `meta_run_weekly_report` — returns small summary JSON only |
| **HTTP cron** | `POST /v1/meta-weekly/run` with `Authorization: Bearer $CRON_SECRET` |
| **Code** | `import { runMetaWeeklyReport } from "./weekly-report.js"` |

## Config vs MCP call

| Source | When |
|--------|------|
| **`accounts` in MCP/HTTP body** | Cursor one-off runs — pass ad account ids in the tool call |
| **`config/meta-weekly-reporting.json`** | Default when `accounts` is omitted (cron, full weekly job) |

Config still provides default `spreadsheet_id` and `min_spend_inr` unless overridden in the call.

### MCP tool parameters (`meta_run_weekly_report`)

```json
{
  "since": "2026-05-21",
  "until": "2026-05-27",
  "accounts": [
    {
      "ad_account_id": "590939353820229",
      "name": "Ed Tech B2B",
      "client_slug": "hexanovate"
    }
  ],
  "spreadsheet_id": "1By0dNz6eQMczGRmLMn1G_49rFovOEHQbcDVJt94aAXE",
  "min_spend_inr": 1,
  "skip_sheets": false,
  "clear_tab": true,
  "write_client_reports": false
}
```

Only **`ad_account_id`** is required per account. `name` and `client_slug` are optional.

## Env

| Variable | Purpose |
|----------|---------|
| `META_ACCESS_TOKEN` | Meta Marketing API |
| **`GOOGLE_AUTH_TYPE=service_account`** | **Recommended** — use service account only |
| `GOOGLE_SERVICE_ACCOUNT_PATH` | Path to service account key JSON |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Inline service account JSON |
| `GOOGLE_ADS_CREDENTIALS_PATH` | Alternative path (must be `type: service_account` when using SA mode) |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Default spreadsheet for sheet MCP tools |
| `GOOGLE_ADS_CLIENT_ID` / `SECRET` / `REFRESH_TOKEN` | OAuth only (omit when using service account) |
| `CRON_SECRET` | Protects `/v1/meta-weekly/run` |
| `META_WEEKLY_CONFIG_PATH` | Optional config override |

**Service account setup:**

1. Set `GOOGLE_AUTH_TYPE=service_account`
2. Set `GOOGLE_SERVICE_ACCOUNT_PATH` to your key file
3. In Google Sheets → Share → add the service account email (`client_email` from JSON) as Editor
4. Run `meta_test_google_sheets` to confirm

### Sheet MCP tools

| Tool | Purpose |
|------|---------|
| `meta_test_google_sheets` | Verify auth + list tabs |
| `meta_list_sheet_tabs` | Tab names |
| `meta_read_sheet_range` | Read cells |
| `meta_clear_sheet_tab` | Clear a tab |
| `meta_run_weekly_report` | Full weekly job → Sheet tab |

## Cron example

```bash
curl -X POST "https://<host>/v1/meta-weekly/run" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"write_repo": false}'
```

## Source layout

- `src/weekly/config.ts` — load JSON config
- `src/weekly/fetch.ts` — Graph insights + pagination
- `src/weekly/transform.ts` — spend filter, leads, CPR, CTR
- `src/weekly/markdown.ts` — tables for Sheets
- `src/weekly/sheets.ts` — Google Sheets API
- `src/weekly/job.ts` — `runMetaWeeklyReport()`

Cloud Agent should **not** pull raw insights into the workspace; use one MCP call or one HTTP POST instead.
