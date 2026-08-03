# Social media management (SMM)

Read, analyze, and moderate organic Facebook Page and Instagram business content via Graph API.

Works on **stdio** and **HTTP** MCP transports (same tool registry as ads + publishing).

## Permissions

| Capability | Permissions |
|------------|-------------|
| List IG media | `instagram_basic`, Page token |
| Post / media insights | `pages_read_engagement`, `instagram_manage_insights` |
| Comments (read/reply) | `pages_read_engagement`, `pages_manage_engagement`, `instagram_manage_comments` |
| Hide comments | `pages_manage_engagement`, `instagram_manage_comments` |
| Delete FB posts | `pages_manage_posts` |
| Schedule posts | `pages_manage_posts` |

Use a **Page access token** when possible.

## Tools

| Tool | Purpose |
|------|---------|
| `meta_list_instagram_media` | Recent IG media for a linked business account |
| `meta_get_facebook_post_insights` | Impressions, clicks, reactions on a FB post |
| `meta_get_instagram_media_insights` | Impressions, reach, engagement on IG media |
| `meta_get_page_smm_insights` | Page + optional IG account organic metrics |
| `meta_list_post_comments` | List comments (FB post or IG media) |
| `meta_create_post_comment` | Add a comment or public reply |
| `meta_hide_post_comment` | Hide a comment |
| `meta_delete_page_post` | Delete a Facebook post |
| `meta_schedule_facebook_post` | Schedule FB post (10 min–75 days) |

Publishing tools (`meta_publish_*`) are documented in [SOCIAL_PUBLISHING.md](./SOCIAL_PUBLISHING.md).

## Examples

### List Instagram media

```json
{
  "page_id": "123456789012345",
  "limit": 10
}
```

Tool: `meta_list_instagram_media`

### Page SMM dashboard metrics

```json
{
  "page_id": "123456789012345",
  "period": "week",
  "include_instagram": true
}
```

Tool: `meta_get_page_smm_insights`

### Comment moderation

List:

```json
{
  "object_id": "123456789012345_987654321",
  "platform": "facebook",
  "limit": 25
}
```

Tool: `meta_list_post_comments`

Reply:

```json
{
  "object_id": "123456789012345_987654321",
  "message": "Thanks for reaching out — we'll DM you shortly.",
  "platform": "facebook"
}
```

Tool: `meta_create_post_comment`

Hide:

```json
{
  "comment_id": "987654321098765",
  "platform": "facebook"
}
```

Tool: `meta_hide_post_comment`

### Schedule a Facebook post

```json
{
  "page_id": "123456789012345",
  "message": "Webinar starts tomorrow — register now.",
  "link": "https://example.com/webinar",
  "scheduled_publish_time": 1735689600
}
```

Tool: `meta_schedule_facebook_post`

`scheduled_publish_time` is Unix seconds (UTC). Must be at least 10 minutes and at most 75 days in the future.

## Notes

- Instagram comment/list calls require `page_id` for token resolution.
- Insights metrics vary by media type; if Graph returns an error, retry with fewer metrics.
- Mutations respect `META_ADS_DISABLE_MUTATIONS=1`.
