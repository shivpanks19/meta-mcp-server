# Instagram Reel organic analytics (read-only)

Analyze organic Instagram Reel performance via Meta Graph API. All tools are **read-only** — no create, publish, edit, delete, or boost.

## Required permissions

| Permission | Used for |
|------------|----------|
| `instagram_basic` | Account + media list |
| `instagram_manage_insights` | Media/Reel insights |
| `pages_read_engagement` | Page token resolution |
| `pages_show_list` | Linked IG account lookup |
| `ads_read` | Optional — `meta_get_instagram_reel_promotion_status` |

Use a **Page access token** for the linked Facebook Page when possible.

## Tools

| Tool | Purpose |
|------|---------|
| `meta_get_instagram_account` | Resolve IG account from Page ID |
| `meta_list_instagram_media` | List media with Reel filter (`media_product_type=REELS`) |
| `meta_get_instagram_media_insights` | Single media insights with metric fallback |
| `meta_get_instagram_reel_analytics` | Reels + insights in one call |
| `meta_get_instagram_reel_promotion_status` | Ad linkage detection (read-only) |
| `meta_analyze_instagram_reel_organic_performance` | Derived metrics + classifications |

## Example: Swayam / @madebyswayam_

**Page ID:** `1253888921134540`

### 1. Resolve Instagram account

```json
{ "page_id": "1253888921134540" }
```

Tool: `meta_get_instagram_account`

### 2. List Reels in date range

```json
{
  "instagram_account_id": "<from step 1>",
  "since": "2026-07-01",
  "until": "2026-08-18",
  "media_type": "REELS",
  "limit": 50
}
```

Tool: `meta_list_instagram_media`

### 3. Full organic performance analysis

```json
{
  "instagram_account_id": "<ig-user-id>",
  "page_id": "1253888921134540",
  "since": "2026-07-01",
  "until": "2026-08-18",
  "limit": 50,
  "minimum_reels": 5
}
```

Tool: `meta_analyze_instagram_reel_organic_performance`

## Organic vs paid

- `paid_vs_organic_available: false` when Meta does not expose paid/organic breakdowns for requested metrics.
- `organic_classification_confidence: "limited"` in that case — **do not** treat total reach as organic-only.
- `PAID_DEPENDENT` classification only when reliable paid/organic data confirms paid dominance.

## Metric reliability notes

Meta changes Instagram Insights frequently. These metrics may be unsupported or null depending on API version and account type:

- `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time` — Reel-specific; often unavailable on older media
- `profile_activity`, `follows` — not always exposed per media
- `replies` — primarily for Stories
- Paid/organic breakdowns (`organic_reach`, `paid_reach`) — rarely available at media level

Unsupported metrics appear in `unsupported_metrics` rather than returning `0`.

## Graph API endpoints

Uses the MCP's configured Graph API version (default `v21.0` via `META_GRAPH_VERSION`):

- `GET /{page-id}?fields=instagram_business_account`
- `GET /{ig-user-id}?fields=...`
- `GET /{ig-user-id}/media?fields=...`
- `GET /{media-id}/insights?metric=...`
- `GET /me/adaccounts` + `GET /act_{id}/ads` (promotion detection)
