# Meta PPC Manager Tools

These tools add PPC-manager workflows on top of the lower-level Meta Graph wrappers.
Planning and diagnostics are read-only. Mutation wrappers default to validation-only
responses.

## Safety

| Variable | Effect |
|----------|--------|
| `META_ADS_DISABLE_MUTATIONS=1` | Blocks all Graph API `POST` and `DELETE` calls in this server. |
| `META_ADS_MUTATE_VALIDATE_ONLY=1` | Forces safe mutation wrappers to return proposed payloads without sending writes. |

Safe mutation tools also accept `validate_only`. It defaults to `true`; pass
`validate_only: false` only when you intend to send the live Meta API write and
the environment flags permit it.

## Read-only Planning and Diagnostics

| Tool | Purpose |
|------|---------|
| `plan_weekly_meta_performance_actions` | Campaign/ad set/ad weekly action plan with prioritized recommendations and exact follow-up tools. |
| `get_meta_campaign_performance` | Campaign performance with spend, impressions, clicks, CTR, CPC, conversions and CPA. |
| `get_meta_adset_performance` | Ad set performance plus pacing/delivery and budget reallocation diagnostics. |
| `get_meta_ad_performance` | Ad performance with creative fatigue-ready metrics. |
| `get_creative_fatigue_insights` | Ad/creative fatigue signals using frequency, CPM, CTR, CPA, spend and conversions. |
| `get_audience_fatigue_insights` | Ad set/audience fatigue signals using frequency, CPM, CTR, CPA, spend and conversions. |
| `get_meta_breakdown_insights` | Placement, age/gender, geo, or device breakdown summary and weak-segment recommendations. |
| `get_meta_conversion_tracking_status` | Pixel/custom conversion visibility plus recent action-event health check. |
| `get_meta_change_history` | Structured recent edits report from the ad account activities endpoint. |

Common output shape:

```json
{
  "ok": true,
  "summary": {},
  "diagnostics": [],
  "recommendations": [],
  "action_items": [],
  "tool_to_apply": null
}
```

Recommendations include `tool_to_apply` and, where appropriate,
`tool_arguments` with `validate_only: true`.

## Safe Mutations

| Tool | Scope |
|------|-------|
| `update_meta_campaign_status` | Status-only campaign updates. |
| `update_meta_adset_status` | Status-only ad set updates. |
| `update_meta_ad_status` | Status-only ad updates. |
| `update_meta_adset_budget` | Daily budget updates for one ad set. |

Validation-only example:

```json
{
  "adset_id": "1234567890",
  "daily_budget": 2500,
  "reason": "Reduce spend on high-CPA ad set after weekly review"
}
```

Live-write example:

```json
{
  "adset_id": "1234567890",
  "daily_budget": 2500,
  "validate_only": false,
  "reason": "Approved weekly reallocation"
}
```

Budgets use Meta account minor units, matching the existing Meta API behavior.
