# Facebook & Instagram publishing (Meta Business API)

Publish to Facebook Pages and linked Instagram business accounts via Graph API Content Publishing.

Available in **both** MCP transports:

- **Local stdio:** `npm run start:stdio` (Cursor `node dist/index.js`)
- **Live HTTP:** `npm start` (Railway / Render — same tool registry)

## Required permissions

User or system user token with:

| Capability | Permissions |
|------------|-------------|
| Facebook Page posts | `pages_manage_posts`, `pages_read_engagement`, `pages_show_list` |
| Instagram publishing | `instagram_basic`, `instagram_content_publish` |
| Resolve Page tokens | `pages_show_list` (via `me/accounts`) |

Use a **Page access token** when possible (`page_access_token` argument or `META_PAGE_ACCESS_TOKEN` env).

## Tools

| Tool | Purpose |
|------|---------|
| `meta_get_page_publishing_context` | Resolve page token + linked `instagram_business_account` |
| `meta_publish_facebook_post` | Text, link, or image URL to Page feed/photos |
| `meta_publish_instagram_post` | Image or video URL + caption to IG business account |
| `meta_publish_social_post` | **One call** — Facebook + Instagram (default both) |
| `meta_create_page_post` | Legacy feed post (now supports `image_url` too) |

## Examples

### Check publishing context

```json
{
  "page_id": "123456789012345"
}
```

Tool: `meta_get_page_publishing_context`

### Post to Facebook only

```json
{
  "page_id": "123456789012345",
  "message": "EyeRIS AI panels now shipping across APAC.",
  "image_url": "https://example.com/hero.jpg",
  "platforms": ["facebook"]
}
```

Tool: `meta_publish_social_post` (or `meta_publish_facebook_post`)

### Post to Facebook + Instagram

```json
{
  "page_id": "123456789012345",
  "message": "Physical AI for classrooms and meeting rooms.",
  "image_url": "https://example.com/campaign.jpg",
  "platforms": ["facebook", "instagram"]
}
```

Tool: `meta_publish_social_post`

### Instagram Reels

```json
{
  "page_id": "123456789012345",
  "caption": "BrightClass demo — AI inside the workflow.",
  "video_url": "https://example.com/reel.mp4",
  "video_media_type": "REELS"
}
```

Tool: `meta_publish_instagram_post`

## Notes

- **Instagram** requires a public `image_url` or `video_url` (HTTPS). Text-only IG posts are not supported by Meta.
- **Video** posts poll the media container until `FINISHED` before publish (up to ~2 minutes).
- **`link`** on cross-posts applies to Facebook only; add URLs in the caption for Instagram if needed.
- Mutations respect `META_ADS_DISABLE_MUTATIONS=1` (blocks all Graph POSTs).

## Deploy to live MCP

After pulling these changes:

```bash
npm ci && npm run build
npm start   # or redeploy on Railway/Render
```

Cursor remote config (Bearer):

```json
{
  "mcpServers": {
    "meta": {
      "url": "https://<your-host>/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_SHARED_TOKEN>"
      }
    }
  }
}
```
