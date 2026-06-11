import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  graphMultipartRequest,
  graphRequest,
  MetaGraphError,
  optionalPageToken,
  requireEnvToken,
} from "./meta-api.js";
import fs from "fs";
import path from "node:path";
import {
  normalizeAccountInputs,
  runMetaWeeklyReport,
} from "./weekly-report.js";
import {
  buildBudgetRecommendations,
  buildDeliveryDiagnostics,
  buildFatigueRecommendations,
  enrichPerformanceRows,
  summarizeBreakdowns,
  summarizePerformance,
} from "./ppc-manager.js";
import { loadWeeklyConfig } from "./weekly/config.js";
import { resolveSpreadsheetId } from "./weekly/google-auth.js";
import {
  clearSheetTab,
  listSheetTabs,
  readSheetRange,
  testGoogleSheetsAccess,
} from "./weekly/sheets.js";

function jsonResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function errText(e: unknown): string {
  if (e instanceof MetaGraphError) {
    return JSON.stringify(
      { error: e.message, status: e.status, details: e.body },
      null,
      2
    );
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

export function createMetaServer(): Server {
  const server = new Server(
    {
      name: "meta-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: { tools: {} },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "meta_snapshot_object",
      description: "Capture and return a full snapshot of a campaign, adset, ad or creative for version tracking.",
      inputSchema: {
        type: "object",
        properties: {
          object_id: { type: "string" },
          object_type: {
            type: "string",
            enum: ["campaign", "adset", "ad", "creative"]
          }
        },
        required: ["object_id", "object_type"]
      }
    },
    {
      name: "meta_compare_snapshots",
      description: "Compare two snapshots and return field-level differences.",
      inputSchema: {
        type: "object",
        properties: {
          before_snapshot: {
            type: "object",
            additionalProperties: true
          },
          after_snapshot: {
            type: "object",
            additionalProperties: true
          }
        },
        required: ["before_snapshot", "after_snapshot"]
      }
    },
    {
      name: "meta_get_account_activity",
      description: "Fetch Meta ad account activity history (campaign, adset, ad changes) for a date range using the activities endpoint.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: {
            type: "string",
            description: "Ad account id with or without act_ prefix"
          },
          since: {
            type: "string",
            description: "YYYY-MM-DD"
          },
          until: {
            type: "string",
            description: "YYYY-MM-DD"
          },
          limit: {
            type: "number",
            description: "Default 500"
          },
          category: {
            type: "string",
            description: "Optional activity category such as ACCOUNT, CAMPAIGN, ADSET, AD, ADS_MANAGEMENT"
          },
          add_children: {
            type: "boolean",
            description: "Include child object changes where supported"
          }
        },
        required: ["ad_account_id", "since", "until"]
      }
    },
    {
      name: "meta_list_ad_accounts",
      description:
        "List Meta ad accounts the token can access (Marketing API). Returns id, name, currency, account_status, etc.",
      inputSchema: {
        type: "object",
        properties: {
          fields: {
            type: "string",
            description:
              "Comma-separated fields (default: id,name,account_status,currency,timezone_name)",
          },
          limit: { type: "number", description: "Max results per page (default 50)" },
        },
      },
    },
    {
      name: "meta_get_ad_account",
      description: "Get a single ad account by ID (e.g. act_123).",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: {
            type: "string",
            description: "Ad account id with or without act_ prefix",
          },
          fields: { type: "string", description: "Comma-separated fields" },
        },
        required: ["ad_account_id"],
      },
    },
    {
      name: "meta_list_campaigns",
      description: "List campaigns for an ad account.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: { type: "string", description: "act_XXXX or numeric id" },
          fields: {
            type: "string",
            description:
              "Comma-separated fields (default: id,name,status,objective,daily_budget,lifetime_budget)",
          },
          limit: { type: "number" },
          effective_status: {
            type: "array",
            items: { type: "string" },
            description: "Filter e.g. ACTIVE, PAUSED",
          },
        },
        required: ["ad_account_id"],
      },
    },
    {
      name: "meta_get_campaign",
      description: "Get a single campaign including objective, budget and status.",
      inputSchema: {
        type: "object",
        properties: {
          campaign_id: { type: "string" },
          fields: {
            type: "string",
            description: "Optional comma-separated fields"
          }
        },
        required: ["campaign_id"]
      }
    },
    {
      name: "meta_create_campaign",
      description:
        "Create a campaign on an ad account (Marketing API POST). Default: PAUSED (no delivery), OUTCOME_TRAFFIC, empty special_ad_categories, ad-set-level budgets. Requires ads_management.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: {
            type: "string",
            description: "Ad account id (e.g. act_590939353820229)",
          },
          name: {
            type: "string",
            description: "Campaign name (default: MCP Test Campaign + UTC timestamp)",
          },
          objective: {
            type: "string",
            description:
              "Outcome objective, e.g. OUTCOME_TRAFFIC, OUTCOME_LEADS, OUTCOME_AWARENESS (default OUTCOME_TRAFFIC)",
          },
          status: {
            type: "string",
            enum: ["PAUSED", "ACTIVE"],
            description: "Initial status (default PAUSED — safe for testing)",
          },
          special_ad_categories: {
            type: "array",
            items: { type: "string" },
            description:
              "e.g. HOUSING, EMPLOYMENT, CREDIT — use empty [] for none (default [])",
          },
          is_adset_budget_sharing_enabled: {
            type: "boolean",
            description:
              "Campaign budget optimization off by default (false = separate ad set budgets)",
          },
        },
        required: ["ad_account_id"],
      },
    },
    {
      name: "meta_create_adset",
      description:
        "Create an ad set on an ad account (Marketing API POST). Default: PAUSED. Requires ads_management.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: {
            type: "string",
            description: "Ad account id (e.g. act_590939353820229)",
          },
          campaign_id: { type: "string" },
          name: { type: "string" },
          status: {
            type: "string",
            enum: ["PAUSED", "ACTIVE"],
            description: "Initial status (default PAUSED — safe for testing)",
          },
          daily_budget: { type: "number" },
          billing_event: { type: "string" },
          optimization_goal: { type: "string" },
          bid_strategy: { type: "string" },
          targeting: {
            type: "object",
            additionalProperties: true,
          },
        },
        required: ["ad_account_id", "campaign_id", "name"],
      },
    },
    {
      name: "meta_create_creative",
      description:
        "Create an ad creative on an ad account (Marketing API POST). Requires ads_management.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: {
            type: "string",
            description: "Ad account id (e.g. act_590939353820229)",
          },
          name: { type: "string" },
          object_story_spec: {
            type: "object",
            additionalProperties: true,
          },
        },
        required: ["ad_account_id", "name", "object_story_spec"],
      },
    },
    {
      name: "meta_get_creative",
      description: "Get a creative including headline, body text, CTA, object_story_spec, asset details, and automatically resolve video metadata and source URL when the creative contains a video.",
      inputSchema: {
        type: "object",
        properties: {
          creative_id: { type: "string" },
          fields: {
            type: "string",
            description: "Optional comma-separated fields"
          }
        },
        required: ["creative_id"]
      }
    },
    {
      name: "meta_create_creative_variant",
      description: "Clone an existing creative and optionally replace headline, primary text and description.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: { type: "string" },
          source_creative_id: { type: "string" },
          name: { type: "string" },
          headline: { type: "string" },
          primary_text: { type: "string" },
          description: { type: "string" }
        },
        required: ["ad_account_id", "source_creative_id", "name"]
      }
    },
    {
      name: "meta_analyze_creative",
      description: "Analyze a creative and provide optimisation recommendations for copy and messaging.",
      inputSchema: {
        type: "object",
        properties: {
          creative_id: { type: "string" }
        },
        required: ["creative_id"]
      }
    },
    {
      name: "meta_upload_image",
      description:
        "Download an image from a public URL and upload it to a Meta ad account (bytes/base64). Returns image hash for ad creatives.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: {
            type: "string",
            description: "Ad account id (e.g. act_590939353820229)",
          },
          image_url: {
            type: "string",
            description: "Public image URL accessible by Meta",
          },
        },
        required: ["ad_account_id", "image_url"],
      },
    },
    {
      name: "meta_upload_image_file",
      description:
        "Upload a local image file to a Meta ad account (bytes/base64). Returns image hash for ad creatives.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: {
            type: "string",
            description: "Ad account id (e.g. act_590939353820229)",
          },
          file_path: {
            type: "string",
            description: "Absolute path to image file on local machine",
          },
        },
        required: ["ad_account_id", "file_path"],
      },
    },
    {
      name: "meta_upload_video_file",
      description:
        "Upload a local video file to a Meta ad account via multipart streaming (source field). Returns video id for ad creatives.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: {
            type: "string",
            description: "Ad account id (e.g. act_590939353820229)",
          },
          file_path: {
            type: "string",
            description: "Absolute path to video file on local machine",
          },
        },
        required: ["ad_account_id", "file_path"],
      },
    },
    {
      name: "meta_get_video_status",
      description:
        "Get processing status and details for a Meta uploaded video by video id.",
      inputSchema: {
        type: "object",
        properties: {
          video_id: {
            type: "string",
            description: "Meta video id returned from meta_upload_video_file",
          },
        },
        required: ["video_id"],
      },
    },
    {
      name: "meta_create_ad",
      description:
        "Create an ad on an ad account (Marketing API POST). Default: PAUSED. Requires ads_management.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: {
            type: "string",
            description: "Ad account id (e.g. act_590939353820229)",
          },
          adset_id: { type: "string" },
          name: { type: "string" },
          creative_id: { type: "string" },
          status: {
            type: "string",
            enum: ["PAUSED", "ACTIVE"],
            description: "Initial status (default PAUSED — safe for testing)",
          },
        },
        required: ["ad_account_id", "adset_id", "name", "creative_id"],
      },
    },
    {
      name: "meta_update_campaign",
      description:
        "Update a campaign by ID (Marketing API POST). Requires ads_management.",
      inputSchema: {
        type: "object",
        properties: {
          campaign_id: { type: "string" },
          name: { type: "string" },
          status: {
            type: "string",
            enum: ["PAUSED", "ACTIVE"],
          },
          daily_budget: { type: "number" },
          lifetime_budget: { type: "number" },
          bid_strategy: { type: "string" },
          special_ad_categories: {
            type: "array",
            items: { type: "string" },
          },
          is_adset_budget_sharing_enabled: { type: "boolean" },
        },
        required: ["campaign_id"],
      },
    },
    {
      name: "meta_update_adset",
      description: "Update an ad set by ID (Marketing API POST). Requires ads_management.",
      inputSchema: {
        type: "object",
        properties: {
          adset_id: { type: "string" },
          name: { type: "string" },
          status: {
            type: "string",
            enum: ["PAUSED", "ACTIVE"],
          },
          daily_budget: { type: "number" },
          billing_event: { type: "string" },
          optimization_goal: { type: "string" },
          bid_strategy: { type: "string" },
          targeting: {
            type: "object",
            additionalProperties: true,
          },
        },
        required: ["adset_id"],
      },
    },
    {
      name: "meta_update_ad",
      description: "Update an ad by ID (Marketing API POST). Requires ads_management.",
      inputSchema: {
        type: "object",
        properties: {
          ad_id: { type: "string" },
          name: { type: "string" },
          status: {
            type: "string",
            enum: ["PAUSED", "ACTIVE"],
          },
          creative_id: { type: "string" },
        },
        required: ["ad_id"],
      },
    },
    {
      name: "meta_pause_campaign",
      description:
        "Pause a campaign by ID (Marketing API POST). Requires ads_management.",
      inputSchema: {
        type: "object",
        properties: {
          campaign_id: { type: "string" },
        },
        required: ["campaign_id"],
      },
    },
    {
      name: "meta_pause_adset",
      description: "Pause an ad set by ID (Marketing API POST). Requires ads_management.",
      inputSchema: {
        type: "object",
        properties: {
          adset_id: { type: "string" },
        },
        required: ["adset_id"],
      },
    },
    {
      name: "meta_pause_ad",
      description: "Pause an ad by ID (Marketing API POST). Requires ads_management.",
      inputSchema: {
        type: "object",
        properties: {
          ad_id: { type: "string" },
        },
        required: ["ad_id"],
      },
    },
    {
      name: "meta_list_adsets",
      description: "List ad sets for an ad account (optional campaign filter).",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: { type: "string" },
          campaign_id: { type: "string", description: "Optional campaign id to filter" },
          fields: {
            type: "string",
            description:
              "Comma-separated fields (default: id,name,status,campaign_id,daily_budget,billing_event,optimization_goal)",
          },
          limit: { type: "number" },
        },
        required: ["ad_account_id"],
      },
    },
    {
      name: "meta_get_adset",
      description: "Get a single ad set including targeting, budgets and optimization settings.",
      inputSchema: {
        type: "object",
        properties: {
          adset_id: { type: "string" },
          fields: {
            type: "string",
            description: "Optional comma-separated fields"
          }
        },
        required: ["adset_id"]
      }
    },
    {
      name: "meta_bulk_update_locations",
      description: "Bulk update geo targeting for one or more ad sets.",
      inputSchema: {
        type: "object",
        properties: {
          adset_ids: {
            type: "array",
            items: { type: "string" }
          },
          targeting: {
            type: "object",
            additionalProperties: true
          }
        },
        required: ["adset_ids", "targeting"]
      }
    },
    {
      name: "meta_list_ads",
      description: "List ads under an ad account.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: { type: "string" },
          fields: {
            type: "string",
            description:
              "Comma-separated fields (default: id,name,status,adset_id,creative{id,name})",
          },
          limit: { type: "number" },
        },
        required: ["ad_account_id"],
      },
    },
    {
      name: "meta_get_ad",
      description: "Get a single ad including creative and adset details.",
      inputSchema: {
        type: "object",
        properties: {
          ad_id: { type: "string" },
          fields: {
            type: "string",
            description: "Optional comma-separated fields"
          }
        },
        required: ["ad_id"]
      }
    },
    {
      name: "meta_get_ad_with_creative",
      description: "Get an ad together with full creative details, headline, primary text, CTA and object_story_spec.",
      inputSchema: {
        type: "object",
        properties: {
          ad_id: { type: "string" }
        },
        required: ["ad_id"]
      }
    },
    {
      name: "meta_generate_copy_variants",
      description: "Generate copy optimisation suggestions and Marathi headline/body variants from an existing creative.",
      inputSchema: {
        type: "object",
        properties: {
          creative_id: { type: "string" },
          language: { type: "string" },
          objective: { type: "string" },
          variants: { type: "number" }
        },
        required: ["creative_id"]
      }
    },
    {
      name: "plan_weekly_meta_performance_actions",
      description:
        "Read-only weekly PPC action plan from campaign, ad set, ad, fatigue and tracking diagnostics.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: { type: "string" },
          date_preset: { type: "string", description: "Default last_7d" },
          time_range: {
            type: "object",
            properties: {
              since: { type: "string" },
              until: { type: "string" },
            },
          },
          limit: { type: "number" },
        },
        required: ["ad_account_id"],
      },
    },
    {
      name: "get_meta_campaign_performance",
      description:
        "Campaign-level performance report with derived metrics and read-only recommendations.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: { type: "string" },
          date_preset: { type: "string" },
          time_range: {
            type: "object",
            properties: { since: { type: "string" }, until: { type: "string" } },
          },
          limit: { type: "number" },
        },
        required: ["ad_account_id"],
      },
    },
    {
      name: "get_meta_adset_performance",
      description:
        "Ad set-level performance, pacing and budget reallocation diagnostics.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: { type: "string" },
          date_preset: { type: "string" },
          time_range: {
            type: "object",
            properties: { since: { type: "string" }, until: { type: "string" } },
          },
          limit: { type: "number" },
        },
        required: ["ad_account_id"],
      },
    },
    {
      name: "get_meta_ad_performance",
      description:
        "Ad-level performance report with creative metadata and fatigue-ready metrics.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: { type: "string" },
          date_preset: { type: "string" },
          time_range: {
            type: "object",
            properties: { since: { type: "string" }, until: { type: "string" } },
          },
          limit: { type: "number" },
        },
        required: ["ad_account_id"],
      },
    },
    {
      name: "get_creative_fatigue_insights",
      description:
        "Analyze ad/creative fatigue using frequency, CPM, CTR, CPA, spend and conversions.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: { type: "string" },
          date_preset: { type: "string" },
          time_range: {
            type: "object",
            properties: { since: { type: "string" }, until: { type: "string" } },
          },
          limit: { type: "number" },
        },
        required: ["ad_account_id"],
      },
    },
    {
      name: "get_audience_fatigue_insights",
      description:
        "Analyze audience/ad set fatigue using frequency, CPM, CTR, CPA, spend and conversions.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: { type: "string" },
          date_preset: { type: "string" },
          time_range: {
            type: "object",
            properties: { since: { type: "string" }, until: { type: "string" } },
          },
          limit: { type: "number" },
        },
        required: ["ad_account_id"],
      },
    },
    {
      name: "get_meta_breakdown_insights",
      description:
        "Placement, demographic, geo or device breakdown insights with weak-segment recommendations.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: { type: "string" },
          level: {
            type: "string",
            enum: ["account", "campaign", "adset", "ad"],
            description: "Default adset",
          },
          breakdowns: {
            type: "string",
            description:
              "Comma-separated breakdowns, e.g. publisher_platform,platform_position,age,gender,country,impression_device",
          },
          date_preset: { type: "string" },
          time_range: {
            type: "object",
            properties: { since: { type: "string" }, until: { type: "string" } },
          },
          limit: { type: "number" },
        },
        required: ["ad_account_id", "breakdowns"],
      },
    },
    {
      name: "get_meta_conversion_tracking_status",
      description:
        "Read-only conversion/event tracking health check from pixels, custom conversions and recent insight actions.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: { type: "string" },
          expected_events: {
            type: "array",
            items: { type: "string" },
            description: "Default: lead, purchase, complete_registration, contact",
          },
          date_preset: { type: "string" },
        },
        required: ["ad_account_id"],
      },
    },
    {
      name: "get_meta_change_history",
      description:
        "Structured recent edits report for a Meta ad account using the activities endpoint.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: { type: "string" },
          since: { type: "string", description: "YYYY-MM-DD" },
          until: { type: "string", description: "YYYY-MM-DD" },
          limit: { type: "number" },
          category: { type: "string" },
        },
        required: ["ad_account_id", "since", "until"],
      },
    },
    {
      name: "update_meta_campaign_status",
      description:
        "Safely update only a campaign status. Honors validate_only and META_ADS_MUTATE_VALIDATE_ONLY.",
      inputSchema: {
        type: "object",
        properties: {
          campaign_id: { type: "string" },
          status: { type: "string", enum: ["ACTIVE", "PAUSED"] },
          validate_only: { type: "boolean", description: "Default true" },
          reason: { type: "string" },
        },
        required: ["campaign_id", "status"],
      },
    },
    {
      name: "update_meta_adset_status",
      description:
        "Safely update only an ad set status. Honors validate_only and META_ADS_MUTATE_VALIDATE_ONLY.",
      inputSchema: {
        type: "object",
        properties: {
          adset_id: { type: "string" },
          status: { type: "string", enum: ["ACTIVE", "PAUSED"] },
          validate_only: { type: "boolean", description: "Default true" },
          reason: { type: "string" },
        },
        required: ["adset_id", "status"],
      },
    },
    {
      name: "update_meta_ad_status",
      description:
        "Safely update only an ad status. Honors validate_only and META_ADS_MUTATE_VALIDATE_ONLY.",
      inputSchema: {
        type: "object",
        properties: {
          ad_id: { type: "string" },
          status: { type: "string", enum: ["ACTIVE", "PAUSED"] },
          validate_only: { type: "boolean", description: "Default true" },
          reason: { type: "string" },
        },
        required: ["ad_id", "status"],
      },
    },
    {
      name: "update_meta_adset_budget",
      description:
        "Safely update an ad set daily budget with dry-run defaults and before snapshot.",
      inputSchema: {
        type: "object",
        properties: {
          adset_id: { type: "string" },
          daily_budget: { type: "number" },
          validate_only: { type: "boolean", description: "Default true" },
          reason: { type: "string" },
        },
        required: ["adset_id", "daily_budget"],
      },
    },
    {
      name: "meta_get_insights",
      description:
        "Fetch insights for an ad account, campaign, ad set, or ad. Use level account|campaign|adset|ad.",
      inputSchema: {
        type: "object",
        properties: {
          object_id: {
            type: "string",
            description: "act_XXXX for account level, or campaign/adset/ad id",
          },
          level: {
            type: "string",
            enum: ["account", "campaign", "adset", "ad"],
            description: "Insights breakdown level",
          },
          date_preset: {
            type: "string",
            description:
              "e.g. today, yesterday, last_7d, last_30d, last_90d, lifetime",
          },
          time_range: {
            type: "object",
            properties: {
              since: { type: "string", description: "YYYY-MM-DD" },
              until: { type: "string", description: "YYYY-MM-DD" },
            },
            description: "Use instead of date_preset for custom range",
          },
          fields: {
            type: "string",
            description:
              "Comma-separated metrics (default: impressions,clicks,spend,reach,cpc,ctr,actions)",
          },
          breakdowns: { type: "string", description: "Optional comma-separated breakdowns" },
          limit: { type: "number" },
        },
        required: ["object_id", "level"],
      },
    },
    {
      name: "meta_list_pages",
      description:
        "List Facebook Pages the user can manage (requires pages_show_list or similar).",
      inputSchema: {
        type: "object",
        properties: {
          fields: {
            type: "string",
            description: "Comma-separated (default: id,name,access_token,category)",
          },
          limit: { type: "number" },
        },
      },
    },
    {
      name: "meta_list_instagram_accounts",
      description:
        "List Instagram business accounts linked to a Facebook Page (page_id required).",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          fields: {
            type: "string",
            description: "Default: id,username,name,followers_count,media_count",
          },
        },
        required: ["page_id"],
      },
    },
    {
      name: "meta_list_page_posts",
      description: "List posts on a Page feed (published posts).",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          page_access_token: {
            type: "string",
            description: "Optional; overrides META_PAGE_ACCESS_TOKEN for this call",
          },
          fields: {
            type: "string",
            description: "Default: id,message,created_time,permalink_url,status_type",
          },
          limit: { type: "number" },
        },
        required: ["page_id"],
      },
    },
    {
      name: "meta_create_page_post",
      description:
        "Publish a message post to a Page (requires pages_manage_posts and page token).",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          message: { type: "string", description: "Post text" },
          link: { type: "string", description: "Optional link URL" },
          page_access_token: {
            type: "string",
            description: "Page access token (often required)",
          },
        },
        required: ["page_id", "message"],
      },
    },
    {
      name: "meta_list_leadgen_forms",
      description: "List lead generation forms for a Page.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          page_access_token: {
            type: "string",
            description: "Page token with leads_retrieval if user token insufficient",
          },
          fields: { type: "string" },
          limit: { type: "number" },
        },
        required: ["page_id"],
      },
    },
    {
      name: "meta_get_leadgen_form",
      description: "Get complete details of a lead generation form including questions, privacy policy, thank you screen and settings.",
      inputSchema: {
        type: "object",
        properties: {
          form_id: { type: "string" },
          fields: {
            type: "string",
            description: "Optional comma-separated fields"
          }
        },
        required: ["form_id"]
      }
    },
    {
      name: "meta_get_leadgen_form_performance",
      description: "Get performance metrics for a lead form including leads and related campaign/ad insights.",
      inputSchema: {
        type: "object",
        properties: {
          form_id: { type: "string" },
          fields: {
            type: "string",
            description: "Optional comma-separated fields"
          }
        },
        required: ["form_id"]
      }
    },
    {
      name: "meta_get_leadgen_form_full_analysis",
      description: "Analyze a lead form, discover ads using it, fetch performance metrics and return optimization insights.",
      inputSchema: {
        type: "object",
        properties: {
          form_id: { type: "string" },
          date_preset: {
            type: "string",
            description: "Default last_30d"
          }
        },
        required: ["form_id"]
      }
    },
    {
      name: "meta_analyze_leadgen_form",
      description: "Analyze a lead form and return optimization recommendations.",
      inputSchema: {
        type: "object",
        properties: {
          form_id: { type: "string" }
        },
        required: ["form_id"]
      }
    },
    {
      name: "meta_get_leads",
      description:
        "Retrieve leads from a leadgen form (pagination supported). Requires leads_retrieval on the token used.",
      inputSchema: {
        type: "object",
        properties: {
          leadgen_form_id: { type: "string" },
          page_access_token: { type: "string" },
          fields: {
            type: "string",
            description: "Default: id,created_time,field_data,ad_id,campaign_id,adset_id",
          },
          limit: { type: "number" },
        },
        required: ["leadgen_form_id"],
      },
    },
    {
      name: "meta_create_optimized_lead_form",
      description:
        "Create a Meta Instant Form (Lead Gen Form) with conversion-focused defaults and optionally attach it to lead campaigns.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          form_name: { type: "string" },
          follow_up_url: { type: "string" },
          privacy_policy_url: { type: "string" },
          custom_questions: {
            type: "array",
            items: { type: "object" },
          },
          campaign_id: {
            type: "string",
            description: "Optional campaign id for future creative/ad creation workflows",
          }
        },
        required: ["page_id", "form_name", "privacy_policy_url"]
      }
    },
    {
      name: "meta_pause_low_performers",
      description: "Pause ads supplied by id list.",
      inputSchema: {
        type: "object",
        properties: {
          ad_ids: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["ad_ids"]
      }
    },
    {
      name: "meta_log_optimisation",
      description: "Append optimisation notes to markdown log file.",
      inputSchema: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          content: { type: "string" }
        },
        required: ["file_path", "content"]
      }
    },
    {
      name: "meta_list_businesses",
      description: "List businesses (Business Manager) the user has access to.",
      inputSchema: {
        type: "object",
        properties: {
          fields: { type: "string", description: "Default: id,name,verification_status" },
          limit: { type: "number" },
        },
      },
    },
    {
      name: "meta_list_owned_ad_accounts",
      description:
        "List ad accounts owned by a business (Business Manager id required).",
      inputSchema: {
        type: "object",
        properties: {
          business_id: { type: "string" },
          fields: {
            type: "string",
            description: "Default: id,name,account_id,currency,account_status",
          },
          limit: { type: "number" },
        },
        required: ["business_id"],
      },
    },
    {
      name: "meta_list_client_ad_accounts",
      description: "List client/partner ad accounts under a business.",
      inputSchema: {
        type: "object",
        properties: {
          business_id: { type: "string" },
          fields: { type: "string" },
          limit: { type: "number" },
        },
        required: ["business_id"],
      },
    },
    {
      name: "meta_list_pages_under_business",
      description: "List Pages owned by a business asset group / business.",
      inputSchema: {
        type: "object",
        properties: {
          business_id: { type: "string" },
          fields: { type: "string" },
          limit: { type: "number" },
        },
        required: ["business_id"],
      },
    },
    {
      name: "meta_test_google_sheets",
      description:
        "Verify Google Sheets credentials (GOOGLE_ADS_CREDENTIALS_* / OAuth env) and list tabs on a spreadsheet.",
      inputSchema: {
        type: "object",
        properties: {
          spreadsheet_id: {
            type: "string",
            description:
              "Spreadsheet ID (default: GOOGLE_SHEETS_SPREADSHEET_ID or config spreadsheet_id)",
          },
        },
      },
    },
    {
      name: "meta_list_sheet_tabs",
      description: "List worksheet tab names in a Google Spreadsheet.",
      inputSchema: {
        type: "object",
        properties: {
          spreadsheet_id: { type: "string" },
        },
      },
    },
    {
      name: "meta_read_sheet_range",
      description: "Read cell values from a spreadsheet tab (A1 range).",
      inputSchema: {
        type: "object",
        properties: {
          spreadsheet_id: { type: "string" },
          sheet_title: { type: "string", description: "Tab name (case-sensitive)" },
          a1_range: {
            type: "string",
            description: "e.g. A1:Z100 (default A:ZZ)",
          },
        },
        required: ["sheet_title"],
      },
    },
    {
      name: "meta_clear_sheet_tab",
      description: "Clear all values in a spreadsheet tab (row data only).",
      inputSchema: {
        type: "object",
        properties: {
          spreadsheet_id: { type: "string" },
          sheet_title: { type: "string" },
        },
        required: ["sheet_title"],
      },
    },
    {
      name: "meta_run_weekly_report",
      description:
        "Run Meta weekly reporting: fetch insights, transform, write Google Sheet tab. Pass accounts in the call (recommended from Cursor) or use config/meta-weekly-reporting.json. Returns summary JSON only.",
      inputSchema: {
        type: "object",
        properties: {
          since: { type: "string", description: "YYYY-MM-DD (default: 7 days ago)" },
          until: { type: "string", description: "YYYY-MM-DD (default: today)" },
          accounts: {
            type: "array",
            description:
              "Ad accounts for this run. If omitted, uses config file accounts.",
            items: {
              type: "object",
              properties: {
                ad_account_id: {
                  type: "string",
                  description: "Numeric id or act_XXXX",
                },
                name: {
                  type: "string",
                  description: "Display name in report (default: client_slug or id)",
                },
                client_slug: {
                  type: "string",
                  description: "Folder slug for write_client_reports (default: account-{id})",
                },
              },
              required: ["ad_account_id"],
            },
          },
          spreadsheet_id: {
            type: "string",
            description: "Override config spreadsheet_id",
          },
          min_spend_inr: {
            type: "number",
            description: "Min spend filter (default from config, usually 1)",
          },
          write_client_reports: {
            type: "boolean",
            description: "Write clients/{slug}/reports/meta-weekly-*.md (default false)",
          },
          clear_tab: {
            type: "boolean",
            description: "Clear sheet tab before write (default true)",
          },
          skip_sheets: {
            type: "boolean",
            description: "Fetch/transform only; skip Google Sheets (debug)",
          },
        },
      },
    },
    {
      name: "meta_graph_get",
      description:
        "Low-level read-only GET to the Graph API. Path without leading slash, e.g. me or act_123/campaigns. Use sparingly; prefer named tools.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Resource path relative to graph version root",
          },
          query: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Extra query parameters (access_token added automatically)",
          },
        },
        required: ["path"],
      },
    },
  ],
}));

function normalizeActId(id: string): string {
  const t = id.trim();
  if (t.startsWith("act_")) return t;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}

function isValidateOnly(args: Record<string, unknown>): boolean {
  return args.validate_only !== false || process.env.META_ADS_MUTATE_VALIDATE_ONLY === "1";
}

function normalizeStatus(value: unknown): "ACTIVE" | "PAUSED" {
  const status = String(value).trim().toUpperCase();
  if (status !== "ACTIVE" && status !== "PAUSED") {
    throw new Error("status must be ACTIVE or PAUSED");
  }
  return status;
}

function insightParams(
  args: Record<string, unknown>,
  level: "account" | "campaign" | "adset" | "ad",
  fields: string
): Record<string, string | number | boolean | undefined> {
  const params: Record<string, string | number | boolean | undefined> = {
    level,
    fields,
    limit: (args.limit as number) ?? 100,
  };
  const tr = args.time_range as { since?: string; until?: string } | undefined;
  if (tr?.since && tr?.until) {
    params.time_range = JSON.stringify({ since: tr.since, until: tr.until });
  } else {
    params.date_preset = String(args.date_preset ?? "last_7d");
  }
  if (args.breakdowns) params.breakdowns = String(args.breakdowns);
  return params;
}

async function fetchPerformanceRows(
  token: string,
  adAccountId: string,
  args: Record<string, unknown>,
  level: "campaign" | "adset" | "ad"
) {
  const fieldsByLevel = {
    campaign:
      "campaign_id,campaign_name,impressions,reach,frequency,clicks,spend,ctr,cpc,cpm,actions,cost_per_action_type",
    adset:
      "campaign_id,campaign_name,adset_id,adset_name,impressions,reach,frequency,clicks,spend,ctr,cpc,cpm,actions,cost_per_action_type",
    ad:
      "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,impressions,reach,frequency,clicks,spend,ctr,cpc,cpm,actions,cost_per_action_type",
  };
  const response: any = await graphRequest({
    path: `${normalizeActId(adAccountId)}/insights`,
    accessToken: token,
    params: insightParams(args, level, fieldsByLevel[level]),
  });
  return enrichPerformanceRows(response?.data ?? []);
}

async function fetchObjectSnapshot(
  token: string,
  objectId: string,
  fields: string
) {
  return graphRequest({
    path: objectId,
    accessToken: token,
    params: { fields },
  });
}

async function safePostMutation(
  token: string,
  args: Record<string, unknown>,
  objectId: string,
  body: Record<string, unknown>,
  snapshotFields: string,
  toolName: string
) {
  const before = await fetchObjectSnapshot(token, objectId, snapshotFields);
  const proposed_mutation = { path: objectId, method: "POST", body };
  if (isValidateOnly(args)) {
    return {
      ok: true,
      validate_only: true,
      summary: "Validation-only response. No Meta Ads mutation was sent.",
      diagnostics: { before },
      recommendations: [],
      action_items: [
        {
          tool_to_apply: toolName,
          tool_arguments: { ...args, validate_only: false },
        },
      ],
      tool_to_apply: toolName,
      proposed_mutation,
    };
  }

  const response = await graphRequest({
    path: objectId,
    method: "POST",
    accessToken: token,
    body,
  });
  return {
    ok: true,
    validate_only: false,
    summary: "Meta Ads mutation applied.",
    diagnostics: { before, response },
    recommendations: [],
    action_items: [],
    tool_to_apply: toolName,
    proposed_mutation,
  };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const token = requireEnvToken();
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "meta_list_ad_accounts": {
        const data = await graphRequest({
          path: "me/adaccounts",
          accessToken: token,
          params: {
            fields:
              (args.fields as string) ??
              "id,name,account_status,currency,timezone_name,business",
            limit: (args.limit as number) ?? 50,
          },
        });
        return jsonResult(data);
      }
      case "meta_get_ad_account": {
        const id = normalizeActId(String(args.ad_account_id));
        const data = await graphRequest({
          path: id,
          accessToken: token,
          params: {
            fields:
              (args.fields as string) ??
              "id,name,account_status,currency,timezone_name,business,amount_spent,balance",
          },
        });
        return jsonResult(data);
      }
      case "meta_list_campaigns": {
        const act = normalizeActId(String(args.ad_account_id));
        const filtering =
          Array.isArray(args.effective_status) && args.effective_status.length
            ? JSON.stringify([
                {
                  field: "effective_status",
                  operator: "IN",
                  value: args.effective_status,
                },
              ])
            : undefined;
        const data = await graphRequest({
          path: `${act}/campaigns`,
          accessToken: token,
          params: {
            fields:
              (args.fields as string) ??
              "id,name,status,effective_status,objective,daily_budget,lifetime_budget",
            limit: (args.limit as number) ?? 50,
            ...(filtering ? { filtering } : {}),
          },
        });
        return jsonResult(data);
      }

      case "meta_get_campaign": {
        const campaignId = String(args.campaign_id).trim();

        const data = await graphRequest({
          path: campaignId,
          accessToken: token,
          params: {
            fields:
              (args.fields as string) ??
              "id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy",
          },
        });

        return jsonResult(data);
      }
      case "meta_create_campaign": {
        const act = normalizeActId(String(args.ad_account_id));
        const defaultName = `MCP Test Campaign ${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}`;
        const name = String(args.name ?? defaultName).trim() || defaultName;
        const objective = String(args.objective ?? "OUTCOME_TRAFFIC").trim();
        const status = String(args.status ?? "PAUSED").trim().toUpperCase();
        const categories = Array.isArray(args.special_ad_categories)
          ? args.special_ad_categories.map(String)
          : [];
        const sharing =
          args.is_adset_budget_sharing_enabled === true ? 1 : 0;
        const data = await graphRequest({
          path: `${act}/campaigns`,
          method: "POST",
          accessToken: token,
          body: {
            name,
            objective,
            status: status === "ACTIVE" ? "ACTIVE" : "PAUSED",
            special_ad_categories: categories,
            is_adset_budget_sharing_enabled: sharing,
          },
        });
        return jsonResult(data);
      }
      case "meta_create_adset": {
        const act = normalizeActId(String(args.ad_account_id));
        const name = String(args.name).trim();
        const campaignId = String(args.campaign_id).trim();
        const status = String(args.status ?? "PAUSED").trim().toUpperCase();
        const data = await graphRequest({
          path: `${act}/adsets`,
          method: "POST",
          accessToken: token,
          body: {
            name,
            campaign_id: campaignId,
            status: status === "ACTIVE" ? "ACTIVE" : "PAUSED",
            daily_budget: args.daily_budget,
            billing_event: args.billing_event,
            optimization_goal: args.optimization_goal,
            bid_strategy: args.bid_strategy,
            targeting: args.targeting,
          },
        });
        return jsonResult(data);
      }
      case "meta_create_creative": {
        const act = normalizeActId(String(args.ad_account_id));
        const name = String(args.name).trim();
        const data = await graphRequest({
          path: `${act}/adcreatives`,
          method: "POST",
          accessToken: token,
          body: {
            name,
            object_story_spec: args.object_story_spec,
          },
        });
        return jsonResult(data);
      }
      case "meta_get_creative": {
        const creativeId = String(args.creative_id).trim();

        const creative: any = await graphRequest({
          path: creativeId,
          accessToken: token,
          params: {
            fields:
              (args.fields as string) ??
              "id,name,title,body,object_story_spec,asset_feed_spec,image_hash,thumbnail_url,call_to_action_type,effective_object_story_id,object_type",
          },
        });

        let video: any = null;

        const videoId =
          creative?.object_story_spec?.video_data?.video_id ||
          creative?.asset_feed_spec?.videos?.[0]?.video_id;

        if (videoId) {
          try {
            video = await graphRequest({
              path: String(videoId),
              accessToken: token,
              params: {
                fields:
                  "id,title,source,permalink_url,thumbnails,length,status,updated_time",
              },
            });
          } catch (error) {
            video = {
              id: videoId,
              fetch_error:
                error instanceof Error ? error.message : String(error),
            };
          }
        }

        return jsonResult({
          creative,
          video,
          detected_video_id: videoId ?? null,
        });
      }
      case "meta_create_creative_variant": {
        const act = normalizeActId(String(args.ad_account_id));
        const sourceCreativeId = String(args.source_creative_id).trim();

        const sourceCreative: any = await graphRequest({
          path: sourceCreativeId,
          accessToken: token,
          params: {
            fields: "id,name,object_story_spec",
          },
        });

        const spec = JSON.parse(JSON.stringify(sourceCreative.object_story_spec ?? {}));

        if (spec.link_data) {
          if (args.headline) spec.link_data.name = String(args.headline);
          if (args.primary_text) spec.link_data.message = String(args.primary_text);
          if (args.description) spec.link_data.description = String(args.description);
        }

        const created = await graphRequest({
          path: `${act}/adcreatives`,
          method: "POST",
          accessToken: token,
          body: {
            name: String(args.name),
            object_story_spec: spec,
          },
        });

        return jsonResult({
          success: true,
          source_creative_id: sourceCreativeId,
          creative: created,
        });
      }
      case "meta_analyze_creative": {
        const creativeId = String(args.creative_id).trim();

        const creative: any = await graphRequest({
          path: creativeId,
          accessToken: token,
          params: {
            fields: "id,name,title,body,object_story_spec",
          },
        });

        const recommendations: string[] = [];

        const body = JSON.stringify(creative).toLowerCase();

        if (!body.match(/\d/)) {
          recommendations.push("Consider using numbers, statistics or quantified outcomes in the copy.");
        }

        if (body.length < 120) {
          recommendations.push("Test a stronger value proposition and more context in the primary text.");
        }

        recommendations.push("Create at least 2 headline variants for A/B testing.");
        recommendations.push("Test Marathi-first messaging for local audiences where applicable.");

        return jsonResult({
          creative_id: creativeId,
          creative,
          recommendations,
        });
      }
      case "meta_upload_image": {
        const act = normalizeActId(String(args.ad_account_id));
        const imageUrl = String(args.image_url).trim();

        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) {
          throw new Error(
            `Failed to download image: ${imgRes.status} ${imgRes.statusText}`
          );
        }
        const bytes = Buffer.from(await imgRes.arrayBuffer()).toString("base64");

        const data = await graphRequest({
          path: `${act}/adimages`,
          method: "POST",
          accessToken: token,
          body: { bytes },
        });

        return jsonResult(data);
      }
      case "meta_upload_image_file": {
        const act = normalizeActId(String(args.ad_account_id));
        const filePath = String(args.file_path).trim();

        if (!fs.existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`);
        }

        const bytes = fs.readFileSync(filePath).toString("base64");

        const data = await graphRequest({
          path: `${act}/adimages`,
          method: "POST",
          accessToken: token,
          body: { bytes },
        });

        return jsonResult(data);
      }
      case "meta_upload_video_file": {
        const act = normalizeActId(String(args.ad_account_id));
        const filePath = String(args.file_path).trim();

        if (!fs.existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`);
        }

        const fileBuffer = fs.readFileSync(filePath);
        const fileName = path.basename(filePath);

        const data = await graphMultipartRequest<{ id: string }>({
          path: `${act}/advideos`,
          accessToken: token,
          buildForm: (form) => {
            form.append("source", new Blob([fileBuffer]), fileName);
          },
        });

        return jsonResult({
          success: true,
          video_id: data.id,
          raw: data,
        });
      }
      case "meta_get_video_status": {
        const videoId = String(args.video_id).trim();

        const data = await graphRequest({
          path: videoId,
          accessToken: token,
          params: {
            fields:
              "id,title,status,processing_progress,length,source,updated_time",
          },
        });

        return jsonResult(data);
      }
      case "meta_create_ad": {
        const act = normalizeActId(String(args.ad_account_id));
        const name = String(args.name).trim();
        const status = String(args.status ?? "PAUSED").trim().toUpperCase();
        const data = await graphRequest({
          path: `${act}/ads`,
          method: "POST",
          accessToken: token,
          body: {
            name,
            adset_id: String(args.adset_id).trim(),
            status: status === "ACTIVE" ? "ACTIVE" : "PAUSED",
            creative: {
              creative_id: String(args.creative_id).trim(),
            },
          },
        });
        return jsonResult(data);
      }
      case "meta_update_campaign": {
        const campaignId = String(args.campaign_id).trim();
        const status =
          typeof args.status === "string"
            ? args.status.trim().toUpperCase()
            : undefined;
        const categories = Array.isArray(args.special_ad_categories)
          ? args.special_ad_categories.map(String)
          : undefined;
        const sharing =
          typeof args.is_adset_budget_sharing_enabled === "boolean"
            ? args.is_adset_budget_sharing_enabled === true
              ? 1
              : 0
            : undefined;
        const data = await graphRequest({
          path: campaignId,
          method: "POST",
          accessToken: token,
          body: {
            name: args.name,
            status:
              status === undefined
                ? undefined
                : status === "ACTIVE"
                  ? "ACTIVE"
                  : "PAUSED",
            daily_budget: args.daily_budget,
            lifetime_budget: args.lifetime_budget,
            bid_strategy: args.bid_strategy,
            special_ad_categories: categories,
            is_adset_budget_sharing_enabled: sharing,
          },
        });
        return jsonResult(data);
      }
      case "meta_update_adset": {
        const adsetId = String(args.adset_id).trim();
        const status =
          typeof args.status === "string"
            ? args.status.trim().toUpperCase()
            : undefined;
        const data = await graphRequest({
          path: adsetId,
          method: "POST",
          accessToken: token,
          body: {
            name: args.name,
            status:
              status === undefined
                ? undefined
                : status === "ACTIVE"
                  ? "ACTIVE"
                  : "PAUSED",
            daily_budget: args.daily_budget,
            billing_event: args.billing_event,
            optimization_goal: args.optimization_goal,
            bid_strategy: args.bid_strategy,
            targeting: args.targeting,
          },
        });
        return jsonResult(data);
      }
      case "meta_update_ad": {
        const adId = String(args.ad_id).trim();
        const status =
          typeof args.status === "string"
            ? args.status.trim().toUpperCase()
            : undefined;
        const creativeId =
          typeof args.creative_id === "string"
            ? args.creative_id.trim()
            : undefined;
        const data = await graphRequest({
          path: adId,
          method: "POST",
          accessToken: token,
          body: {
            name: args.name,
            status:
              status === undefined
                ? undefined
                : status === "ACTIVE"
                  ? "ACTIVE"
                  : "PAUSED",
            creative: creativeId ? { creative_id: creativeId } : undefined,
          },
        });
        return jsonResult(data);
      }
      case "meta_pause_campaign": {
        const campaignId = String(args.campaign_id).trim();
        const data = await graphRequest({
          path: campaignId,
          method: "POST",
          accessToken: token,
          body: {
            status: "PAUSED",
          },
        });
        return jsonResult(data);
      }
      case "meta_pause_adset": {
        const adsetId = String(args.adset_id).trim();
        const data = await graphRequest({
          path: adsetId,
          method: "POST",
          accessToken: token,
          body: {
            status: "PAUSED",
          },
        });
        return jsonResult(data);
      }
      case "meta_pause_ad": {
        const adId = String(args.ad_id).trim();
        const data = await graphRequest({
          path: adId,
          method: "POST",
          accessToken: token,
          body: {
            status: "PAUSED",
          },
        });
        return jsonResult(data);
      }
      case "meta_list_adsets": {
        const act = normalizeActId(String(args.ad_account_id));
        const campaignId = args.campaign_id as string | undefined;
        const filtering =
          campaignId?.trim() &&
          JSON.stringify([
            { field: "campaign.id", operator: "EQUAL", value: campaignId.trim() },
          ]);
        const data = await graphRequest({
          path: `${act}/adsets`,
          accessToken: token,
          params: {
            fields:
              (args.fields as string) ??
              "id,name,status,effective_status,campaign_id,daily_budget,billing_event,optimization_goal",
            limit: (args.limit as number) ?? 50,
            ...(filtering ? { filtering } : {}),
          },
        });
        return jsonResult(data);
      }

      case "meta_get_adset": {
        const adsetId = String(args.adset_id).trim();

        const data = await graphRequest({
          path: adsetId,
          accessToken: token,
          params: {
            fields:
              (args.fields as string) ??
              "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,billing_event,optimization_goal,bid_strategy,targeting",
          },
        });

        return jsonResult(data);
      }
      case "meta_list_ads": {
        const act = normalizeActId(String(args.ad_account_id));
        const data = await graphRequest({
          path: `${act}/ads`,
          accessToken: token,
          params: {
            fields:
              (args.fields as string) ??
              "id,name,status,effective_status,adset_id,creative{id,name,title}",
            limit: (args.limit as number) ?? 50,
          },
        });
        return jsonResult(data);
      }

      case "meta_get_ad": {
        const adId = String(args.ad_id).trim();

        const data = await graphRequest({
          path: adId,
          accessToken: token,
          params: {
            fields:
              (args.fields as string) ??
              "id,name,status,effective_status,adset_id,campaign_id,creative{id,name,title}",
          },
        });

        return jsonResult(data);
      }
      case "meta_get_ad_with_creative": {
        const adId = String(args.ad_id).trim();

        const ad: any = await graphRequest({
          path: adId,
          accessToken: token,
          params: {
            fields: "id,name,status,effective_status,adset_id,campaign_id,creative{id,name}"
          }
        });

        const creativeId = ad?.creative?.id;

        let creative = null;

        if (creativeId) {
          creative = await graphRequest({
            path: creativeId,
            accessToken: token,
            params: {
              fields: "id,name,title,body,object_story_spec,asset_feed_spec,image_hash,thumbnail_url"
            }
          });
        }

        return jsonResult({
          ad,
          creative
        });
      }
      case "meta_generate_copy_variants": {
        const creativeId = String(args.creative_id).trim();

        const creative: any = await graphRequest({
          path: creativeId,
          accessToken: token,
          params: {
            fields: "id,name,title,body,object_story_spec"
          }
        });

        const language = String(args.language ?? "marathi").toLowerCase();
        const objective = String(args.objective ?? "lead_generation");
        const variantCount = Number(args.variants ?? 5);

        const recommendations = [
          "Use stronger benefits in the first line.",
          "Include numbers or quantified outcomes.",
          "Test emotional and logical messaging separately.",
          "Add audience-specific messaging.",
          "Test shorter and longer headline variants."
        ];

        const marathiHeadlines = [
          "तुमच्या कुटुंबाचे आर्थिक संरक्षण आजच सुरू करा",
          "योग्य टर्म इन्शुरन्स निवडला आहे का?",
          "₹10 लाख CTC असूनही ही चूक करताय का?",
          "स्मार्ट गुंतवणूकदार आज काय वेगळं करतात?",
          "म्युच्युअल फंड आणि इन्शुरन्ससाठी मोफत सल्ला"
        ].slice(0, variantCount);

        const marathiPrimaryTexts = [
          "तुमच्या आर्थिक भविष्यासाठी योग्य नियोजन करा.",
          "म्युच्युअल फंड, टर्म इन्शुरन्स आणि मेडिकल कव्हरसाठी तज्ञ मार्गदर्शन.",
          "पुणे आणि मुंबईतील व्यावसायिकांसाठी खास आर्थिक सल्ला.",
          "आजच मोफत कन्सल्टेशन बुक करा.",
          "दीर्घकालीन संपत्ती निर्माण आणि आर्थिक संरक्षणासाठी संपर्क साधा."
        ].slice(0, variantCount);

        return jsonResult({
          creative_id: creativeId,
          language,
          objective,
          source_creative: creative,
          recommendations,
          headline_variants: marathiHeadlines,
          primary_text_variants: marathiPrimaryTexts
        });
      }
      case "get_meta_campaign_performance": {
        const rows = await fetchPerformanceRows(
          token,
          String(args.ad_account_id),
          args,
          "campaign"
        );
        const recommendations = rows
          .filter((row) => row.spend_num >= 500 && row.conversions === 0)
          .map((row) => ({
            priority: "medium" as const,
            entity_id: String(row.campaign_id ?? ""),
            entity_name: String(row.campaign_name ?? row.campaign_id ?? ""),
            issue: "Campaign has spend but no tracked conversions in this date range.",
            recommendation:
              "Inspect ad set and ad performance before pausing. Check tracking if all child entities show zero conversions.",
            tool_to_apply: "get_meta_adset_performance",
          }));
        return jsonResult({
          ok: true,
          summary: summarizePerformance(rows),
          diagnostics: rows,
          recommendations,
          action_items: recommendations,
          tool_to_apply: null,
        });
      }
      case "get_meta_adset_performance": {
        const rows = await fetchPerformanceRows(
          token,
          String(args.ad_account_id),
          args,
          "adset"
        );
        const recommendations = [
          ...buildDeliveryDiagnostics(rows),
          ...buildBudgetRecommendations(rows),
        ];
        return jsonResult({
          ok: true,
          summary: summarizePerformance(rows),
          diagnostics: rows,
          recommendations,
          action_items: recommendations,
          tool_to_apply: null,
        });
      }
      case "get_meta_ad_performance": {
        const rows = await fetchPerformanceRows(
          token,
          String(args.ad_account_id),
          args,
          "ad"
        );
        const recommendations = buildFatigueRecommendations(rows, "creative");
        return jsonResult({
          ok: true,
          summary: summarizePerformance(rows),
          diagnostics: rows,
          recommendations,
          action_items: recommendations,
          tool_to_apply: null,
        });
      }
      case "get_creative_fatigue_insights": {
        const rows = await fetchPerformanceRows(
          token,
          String(args.ad_account_id),
          args,
          "ad"
        );
        const recommendations = buildFatigueRecommendations(rows, "creative");
        return jsonResult({
          ok: true,
          summary: {
            ...summarizePerformance(rows),
            fatigue_count: recommendations.length,
          },
          diagnostics: rows,
          recommendations,
          action_items: recommendations,
          tool_to_apply: null,
        });
      }
      case "get_audience_fatigue_insights": {
        const rows = await fetchPerformanceRows(
          token,
          String(args.ad_account_id),
          args,
          "adset"
        );
        const recommendations = buildFatigueRecommendations(rows, "audience");
        return jsonResult({
          ok: true,
          summary: {
            ...summarizePerformance(rows),
            fatigue_count: recommendations.length,
          },
          diagnostics: rows,
          recommendations,
          action_items: recommendations,
          tool_to_apply: null,
        });
      }
      case "get_meta_breakdown_insights": {
        const act = normalizeActId(String(args.ad_account_id));
        const level = String(args.level ?? "adset") as
          | "account"
          | "campaign"
          | "adset"
          | "ad";
        const breakdowns = String(args.breakdowns);
        const fields =
          "impressions,reach,frequency,clicks,spend,ctr,cpc,cpm,actions,cost_per_action_type";
        const response: any = await graphRequest({
          path: `${act}/insights`,
          accessToken: token,
          params: insightParams({ ...args, breakdowns }, level, fields),
        });
        const rows = enrichPerformanceRows(response?.data ?? []);
        const breakdownKeys = breakdowns.split(",").map((b) => b.trim()).filter(Boolean);
        const breakdownSummary = summarizeBreakdowns(rows, breakdownKeys);
        return jsonResult({
          ok: true,
          summary: summarizePerformance(rows),
          diagnostics: breakdownSummary.diagnostics,
          recommendations: breakdownSummary.recommendations,
          action_items: breakdownSummary.recommendations,
          tool_to_apply: null,
        });
      }
      case "get_meta_conversion_tracking_status": {
        const act = normalizeActId(String(args.ad_account_id));
        const expectedEvents = Array.isArray(args.expected_events)
          ? args.expected_events.map((event) => String(event).toLowerCase())
          : ["lead", "purchase", "complete_registration", "contact"];
        const results: Record<string, unknown> = {};
        const warnings: string[] = [];

        for (const [key, path] of Object.entries({
          pixels: `${act}/adspixels`,
          custom_conversions: `${act}/customconversions`,
        })) {
          try {
            results[key] = await graphRequest({
              path,
              accessToken: token,
              params: { fields: "id,name,creation_time,last_fired_time,is_unavailable", limit: 100 },
            });
          } catch (error) {
            warnings.push(`${key} could not be fetched: ${error instanceof Error ? error.message : String(error)}`);
            results[key] = null;
          }
        }

        const response: any = await graphRequest({
          path: `${act}/insights`,
          accessToken: token,
          params: insightParams(
            { date_preset: args.date_preset ?? "last_7d", limit: 100 },
            "account",
            "actions,spend,impressions,clicks"
          ),
        });
        const actionTypes = new Set<string>();
        for (const row of response?.data ?? []) {
          for (const action of row.actions ?? []) {
            actionTypes.add(String(action.action_type ?? "").toLowerCase());
          }
        }
        const missingEvents = expectedEvents.filter(
          (event) => !Array.from(actionTypes).some((seen) => seen.includes(event))
        );
        const recommendations = missingEvents.length
          ? [
              {
                priority: "high" as const,
                issue: `Expected conversion events not seen recently: ${missingEvents.join(", ")}.`,
                recommendation:
                  "Verify pixel/dataset setup, event matching, Aggregated Event Measurement, and campaign optimization events.",
                tool_to_apply: "meta_graph_get",
              },
            ]
          : [];
        return jsonResult({
          ok: true,
          summary: {
            configured: true,
            recently_firing_events: Array.from(actionTypes),
            missing_events: missingEvents,
            warning_count: warnings.length,
          },
          diagnostics: { ...results, warnings },
          recommendations,
          action_items: recommendations,
          tool_to_apply: null,
        });
      }
      case "get_meta_change_history": {
        const act = normalizeActId(String(args.ad_account_id));
        const data: any = await graphRequest({
          path: `${act}/activities`,
          accessToken: token,
          params: {
            since: String(args.since),
            until: String(args.until),
            limit: (args.limit as number) ?? 100,
            category: typeof args.category === "string" ? args.category : undefined,
            fields:
              "event_type,event_time,translated_event_type,object_id,object_name,object_type,actor_name,actor_id,extra_data",
          },
        });
        const events = data?.data ?? [];
        return jsonResult({
          ok: true,
          summary: {
            event_count: events.length,
            since: args.since,
            until: args.until,
          },
          diagnostics: events,
          recommendations: [],
          action_items: [],
          tool_to_apply: null,
        });
      }
      case "plan_weekly_meta_performance_actions": {
        const adAccountId = String(args.ad_account_id);
        const [campaignRows, adsetRows, adRows] = await Promise.all([
          fetchPerformanceRows(token, adAccountId, args, "campaign"),
          fetchPerformanceRows(token, adAccountId, args, "adset"),
          fetchPerformanceRows(token, adAccountId, args, "ad"),
        ]);
        const recommendations = [
          ...buildDeliveryDiagnostics(adsetRows),
          ...buildBudgetRecommendations(adsetRows),
          ...buildFatigueRecommendations(adsetRows, "audience"),
          ...buildFatigueRecommendations(adRows, "creative"),
        ].sort((a, b) => {
          const rank = { high: 0, medium: 1, low: 2 };
          return rank[a.priority] - rank[b.priority];
        });
        return jsonResult({
          ok: true,
          summary: {
            campaigns: summarizePerformance(campaignRows),
            adsets: summarizePerformance(adsetRows),
            ads: summarizePerformance(adRows),
            recommendation_count: recommendations.length,
          },
          diagnostics: {
            campaign_rows: campaignRows,
            adset_rows: adsetRows,
            ad_rows: adRows,
          },
          recommendations,
          action_items: recommendations,
          tool_to_apply: null,
        });
      }
      case "update_meta_campaign_status": {
        const campaignId = String(args.campaign_id).trim();
        return jsonResult(
          await safePostMutation(
            token,
            args,
            campaignId,
            { status: normalizeStatus(args.status) },
            "id,name,status,effective_status,updated_time",
            "update_meta_campaign_status"
          )
        );
      }
      case "update_meta_adset_status": {
        const adsetId = String(args.adset_id).trim();
        return jsonResult(
          await safePostMutation(
            token,
            args,
            adsetId,
            { status: normalizeStatus(args.status) },
            "id,name,status,effective_status,campaign_id,daily_budget,updated_time",
            "update_meta_adset_status"
          )
        );
      }
      case "update_meta_ad_status": {
        const adId = String(args.ad_id).trim();
        return jsonResult(
          await safePostMutation(
            token,
            args,
            adId,
            { status: normalizeStatus(args.status) },
            "id,name,status,effective_status,campaign_id,adset_id,updated_time",
            "update_meta_ad_status"
          )
        );
      }
      case "update_meta_adset_budget": {
        const adsetId = String(args.adset_id).trim();
        const dailyBudget = Number(args.daily_budget);
        if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) {
          throw new Error("daily_budget must be a positive number in account minor units");
        }
        return jsonResult(
          await safePostMutation(
            token,
            args,
            adsetId,
            { daily_budget: Math.round(dailyBudget) },
            "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,updated_time",
            "update_meta_adset_budget"
          )
        );
      }
      case "meta_get_insights": {
        const objectId = String(args.object_id).trim();
        const level = String(args.level);
        const fields =
          (args.fields as string) ??
          "impressions,clicks,spend,reach,cpc,ctr,frequency,actions,action_values";
        const params: Record<string, string | number | boolean | undefined> = {
          level,
          fields,
          limit: (args.limit as number) ?? 50,
        };
        const tr = args.time_range as { since?: string; until?: string } | undefined;
        if (tr?.since && tr?.until) {
          params.time_range = JSON.stringify({ since: tr.since, until: tr.until });
        } else if (args.date_preset) {
          params.date_preset = String(args.date_preset);
        } else {
          params.date_preset = "last_7d";
        }
        if (args.breakdowns) params.breakdowns = String(args.breakdowns);
        const data = await graphRequest({
          path: `${objectId}/insights`,
          accessToken: token,
          params,
        });
        return jsonResult(data);
      }
      case "meta_list_pages": {
        const data = await graphRequest({
          path: "me/accounts",
          accessToken: token,
          params: {
            fields: (args.fields as string) ?? "id,name,access_token,category,tasks",
            limit: (args.limit as number) ?? 50,
          },
        });
        return jsonResult(data);
      }
      case "meta_list_instagram_accounts": {
        const pageId = String(args.page_id).trim();
        const data = await graphRequest({
          path: `${pageId}`,
          accessToken: token,
          params: {
            fields:
              (args.fields as string) ??
              "instagram_business_account{id,username,name,followers_count,media_count}",
          },
        });
        return jsonResult(data);
      }
      case "meta_list_page_posts": {
        const pageId = String(args.page_id).trim();
        const pt =
          optionalPageToken(args.page_access_token as string | undefined) ?? token;
        const data = await graphRequest({
          path: `${pageId}/feed`,
          accessToken: pt,
          params: {
            fields:
              (args.fields as string) ??
              "id,message,created_time,permalink_url,status_type,insights.metric(post_impressions_unique)",
            limit: (args.limit as number) ?? 25,
          },
        });
        return jsonResult(data);
      }
      case "meta_create_page_post": {
        const pageId = String(args.page_id).trim();
        const pt =
          optionalPageToken(args.page_access_token as string | undefined) ?? token;
        const body: Record<string, unknown> = {
          message: String(args.message),
        };
        if (args.link) body.link = String(args.link);
        const data = await graphRequest({
          path: `${pageId}/feed`,
          accessToken: pt,
          method: "POST",
          body,
        });
        return jsonResult(data);
      }
      case "meta_list_leadgen_forms": {
        const pageId = String(args.page_id).trim();
        const pt =
          optionalPageToken(args.page_access_token as string | undefined) ?? token;
        const data = await graphRequest({
          path: `${pageId}/leadgen_forms`,
          accessToken: pt,
          params: {
            fields:
              (args.fields as string) ??
              "id,name,status,leads_count,created_time,page_id",
            limit: (args.limit as number) ?? 50,
          },
        });
        return jsonResult(data);
      }
      case "meta_get_leadgen_form": {
        const formId = String(args.form_id).trim();

        const data = await graphRequest({
          path: formId,
          accessToken: token,
          params: {
            fields:
              (args.fields as string) ??
              "id,name,status,locale,created_time,page_id,follow_up_action_url,privacy_policy_url,questions,context_card,tracking_parameters",
          },
        });

        return jsonResult(data);
      }
      case "meta_get_leadgen_form_performance": {
        const formId = String(args.form_id).trim();

        const form = await graphRequest({
          path: formId,
          accessToken: token,
          params: {
            fields: "id,name,status,leads_count,created_time",
          },
        });

        return jsonResult({
          form,
          note:
            "Base form metrics retrieved. Extend later by mapping ads using this form and calculating opens, starts, submissions, CPL and conversion rates from insights.",
        });
      }
      case "meta_get_leadgen_form_full_analysis": {
        const formId = String(args.form_id).trim();
        const datePreset = String(args.date_preset ?? "last_30d");

        // 1. Fetch the form
        const form = await graphRequest({
          path: formId,
          accessToken: token,
          params: {
            fields:
              "id,name,status,leads_count,created_time,questions,follow_up_action_url,privacy_policy_url,page_id",
          },
        });

        const questionCount = Array.isArray((form as any)?.questions)
          ? (form as any).questions.length
          : 0;
        const leadCount = Number((form as any)?.leads_count ?? 0);
        const pageId = (form as any)?.page_id;

        // 2. Fetch all forms on this page
        let pageForms: any[] = [];
        if (pageId) {
          try {
            const pageFormsResp = await graphRequest({
              path: `${pageId}/leadgen_forms`,
              accessToken: token,
              params: {
                fields: "id,name",
                limit: 200,
              },
            });
            pageForms = (pageFormsResp as any)?.data ?? [];
          } catch {
            pageForms = [];
          }
        }

        // 3. Discover ads using the form
        let matchedAds: any[] = [];
        let adAccounts: any[] = [];
        try {
          const adAccountsResp = await graphRequest({
            path: "me/adaccounts",
            accessToken: token,
            params: { fields: "id,name", limit: 100 },
          });
          adAccounts = (adAccountsResp as any)?.data ?? [];
        } catch {
          adAccounts = [];
        }

        // For each ad account, fetch ads and search for creatives referencing this form id
        for (const account of adAccounts) {
          const actId = account.id?.startsWith("act_") ? account.id : `act_${account.id}`;
          let ads: any[] = [];
          let cursor: string | undefined = undefined;
          do {
            try {
              const adsResp: any = await graphRequest({
                path: `${actId}/ads`,
                accessToken: token,
                params: {
                  fields:
                    "id,name,campaign_id,adset_id,creative{id,name,object_story_spec,effective_object_story_id}",
                  limit: 100,
                  ...(cursor ? { after: cursor } : {}),
                },
              });
              const data = (adsResp as any)?.data ?? [];
              ads = data;
              for (const ad of ads) {
                // Defensive: skip if no creative
                if (!ad.creative) continue;
                // Search for form id in creative object
                const creativeStr = JSON.stringify(ad.creative);
                if (creativeStr.includes(formId)) {
                  matchedAds.push({
                    ...ad,
                    ad_account_id: actId,
                  });
                }
              }
              // Pagination
              cursor = (adsResp.paging && adsResp.paging.next && adsResp.paging.cursors && adsResp.paging.cursors.after)
                ? adsResp.paging.cursors.after
                : undefined;
            } catch {
              break;
            }
          } while (cursor);
        }

        // 4. For each matched ad, fetch insights and aggregate totals
        let totalSpend = 0;
        let totalClicks = 0;
        let totalImpressions = 0;
        let totalLeadsInDateRange = 0;
        let creatives: any[] = [];
        for (const ad of matchedAds) {
          let insights: any[] = [];
          try {
            const insightsResp = await graphRequest({
              path: `${ad.id}/insights`,
              accessToken: token,
              params: {
                date_preset: datePreset,
                fields:
                  "impressions,clicks,spend,ctr,cpc,actions,cost_per_action_type",
                limit: 1,
              },
            });
            insights = (insightsResp as any)?.data ?? [];
          } catch {
            insights = [];
          }
          if (insights.length > 0) {
            const insight = insights[0];

            totalSpend += Number(insight.spend ?? 0);
            totalClicks += Number(insight.clicks ?? 0);
            totalImpressions += Number(insight.impressions ?? 0);

            let adLeadCount = 0;

            for (const action of insight.actions ?? []) {
              const actionType = String(action.action_type ?? "").toLowerCase();

              if (actionType === "lead") {
                adLeadCount = Number(action.value ?? 0);
              }
            }

            totalLeadsInDateRange += adLeadCount;

            creatives.push({
              ad_id: ad.id,
              ad_name: ad.name,
              campaign_id: ad.campaign_id,
              adset_id: ad.adset_id,
              creative_id: ad.creative?.id,
              creative_name: ad.creative?.name,
              leads: adLeadCount,
              clicks: Number(insight.clicks ?? 0),
              spend: Number(insight.spend ?? 0),
              impressions: Number(insight.impressions ?? 0),
              object_story_spec: ad.creative?.object_story_spec,
            });

            continue;
          }
          creatives.push({
            ad_id: ad.id,
            ad_name: ad.name,
            campaign_id: ad.campaign_id,
            adset_id: ad.adset_id,
            creative_id: ad.creative?.id,
            creative_name: ad.creative?.name,
            leads: 0,
            clicks: 0,
            spend: 0,
            impressions: 0,
            object_story_spec: ad.creative?.object_story_spec,
          });
        }

        // 5. Derived metrics
        const leads = totalLeadsInDateRange;
        const lifetimeLeads = leadCount;

        const cpl = leads > 0 ? totalSpend / leads : null;

        const conversion_rate =
          totalClicks > 0 ? (leads / totalClicks) * 100 : null;

        // 6. Scorecard
        const scorecard = {
          form_id: formId,
          form_name: (form as any)?.name,
          status: (form as any)?.status,
          leads_date_range: leads,
          lifetime_form_leads: lifetimeLeads,
          questions_count: questionCount,
          created_time: (form as any)?.created_time,
          date_preset: datePreset,
        };

        // 7. Recommendations
        const recommendations: string[] = [];
        if (questionCount > 4) {
          recommendations.push(
            "Reduce the number of questions to improve completion rate."
          );
        }
        if (!(form as any)?.follow_up_action_url) {
          recommendations.push(
            "Add a follow-up URL, brochure page or booking page after submission."
          );
        }
        if (leads > 1000) {
          recommendations.push(
            "This form has significant lead volume. Use it as a benchmark when creating new forms."
          );
        }
        if (matchedAds.length === 0) {
          recommendations.push(
            "No ads using this form were found. Ensure your ads reference this form's ID in their creative."
          );
        } else {
          if (cpl !== null && cpl > 500) {
            recommendations.push(
              "Cost per lead is high. Consider optimizing your ad creative, targeting, or reducing friction in the form."
            );
          }
          if (conversion_rate !== null && conversion_rate < 5) {
            recommendations.push(
              "Click-to-lead conversion rate is low. Test a shorter form or improve your ad messaging."
            );
          }
        }

        // 8. Return new object
        return jsonResult({
          form,
          scorecard,
          matched_ads_count: matchedAds.length,
          creatives,
          performance: {
            spend: totalSpend,
            clicks: totalClicks,
            impressions: totalImpressions,
            leads_date_range: leads,
            lifetime_form_leads: lifetimeLeads,
            cpl,
            conversion_rate,
          },
          recommendations,
        });
      }
      case "meta_analyze_leadgen_form": {
        const formId = String(args.form_id).trim();

        const form = await graphRequest({
          path: formId,
          accessToken: token,
          params: {
            fields:
              "id,name,questions,follow_up_action_url,privacy_policy_url,status",
          },
        });

        const questions = Array.isArray((form as any)?.questions)
          ? (form as any).questions.length
          : 0;

        const recommendations: string[] = [];

        if (questions > 4) {
          recommendations.push(
            "Reduce the number of questions to improve completion rate."
          );
        }

        if (!(form as any)?.follow_up_action_url) {
          recommendations.push(
            "Add a follow-up URL or thank-you action to improve post-lead engagement."
          );
        }

        recommendations.push(
          "Compare this form against top-performing forms before cloning."
        );

        return jsonResult({
          form_id: formId,
          recommendations,
          form,
        });
      }
      case "meta_get_leads": {
        const formId = String(args.leadgen_form_id).trim();
        const pt =
          optionalPageToken(args.page_access_token as string | undefined) ?? token;
        const data = await graphRequest({
          path: `${formId}/leads`,
          accessToken: pt,
          params: {
            fields:
              (args.fields as string) ??
              "id,created_time,field_data,ad_id,campaign_id,adset_id,form_id",
            limit: (args.limit as number) ?? 100,
          },
        });
        return jsonResult(data);
      }
      case "meta_create_optimized_lead_form": {
        const pageId = String(args.page_id).trim();
        const formName = String(args.form_name).trim();

        const questions = Array.isArray(args.custom_questions)
          ? args.custom_questions
          : [
              { key: "full_name", label: "Full Name" },
              { key: "email", label: "Email" },
              { key: "phone_number", label: "Phone Number" },
            ];

        const body: Record<string, unknown> = {
          name: formName,
          locale: "en_US",
          privacy_policy: {
            url: String(args.privacy_policy_url),
            link_text: "Privacy Policy",
          },
          follow_up_action_url: args.follow_up_url
            ? String(args.follow_up_url)
            : undefined,
          questions,
        };

        const data = await graphRequest({
          path: `${pageId}/leadgen_forms`,
          method: "POST",
          accessToken: token,
          body,
        });

        return jsonResult({
          success: true,
          form: data,
          note:
            "Lead form created. Attaching a form to ads requires updating the ad creative object_story_spec with the generated leadgen_form_id.",
        });
      }

      case "meta_bulk_update_locations": {
        const adsetIds = Array.isArray(args.adset_ids)
          ? args.adset_ids.map(String)
          : [];

        const targeting = args.targeting;
        const results = [];

        for (const adsetId of adsetIds) {
          const response = await graphRequest({
            path: adsetId,
            method: "POST",
            accessToken: token,
            body: { targeting },
          });

          results.push({ adset_id: adsetId, response });
        }

        return jsonResult({
          success: true,
          updated_count: results.length,
          results,
        });
      }

      case "meta_pause_low_performers": {
        const adIds = Array.isArray(args.ad_ids)
          ? args.ad_ids.map(String)
          : [];

        const results = [];

        for (const adId of adIds) {
          const response = await graphRequest({
            path: adId,
            method: "POST",
            accessToken: token,
            body: {
              status: "PAUSED",
            },
          });

          results.push({ ad_id: adId, response });
        }

        return jsonResult({
          success: true,
          paused_count: results.length,
          results,
        });
      }

      case "meta_log_optimisation": {
        const filePath = String(args.file_path);
        const content = String(args.content);

        fs.appendFileSync(filePath, `\n${content}\n`, "utf8");

        return jsonResult({
          success: true,
          file_path: filePath,
        });
      }
      case "meta_list_businesses": {
        const data = await graphRequest({
          path: "me/businesses",
          accessToken: token,
          params: {
            fields: (args.fields as string) ?? "id,name,verification_status",
            limit: (args.limit as number) ?? 50,
          },
        });
        return jsonResult(data);
      }
      case "meta_list_owned_ad_accounts": {
        const bid = String(args.business_id).trim();
        const data = await graphRequest({
          path: `${bid}/owned_ad_accounts`,
          accessToken: token,
          params: {
            fields:
              (args.fields as string) ??
              "id,name,account_id,currency,account_status,timezone_name",
            limit: (args.limit as number) ?? 50,
          },
        });
        return jsonResult(data);
      }
      case "meta_list_client_ad_accounts": {
        const bid = String(args.business_id).trim();
        const data = await graphRequest({
          path: `${bid}/client_ad_accounts`,
          accessToken: token,
          params: {
            fields:
              (args.fields as string) ??
              "id,name,account_id,currency,account_status",
            limit: (args.limit as number) ?? 50,
          },
        });
        return jsonResult(data);
      }
      case "meta_list_pages_under_business": {
        const bid = String(args.business_id).trim();
        const data = await graphRequest({
          path: `${bid}/owned_pages`,
          accessToken: token,
          params: {
            fields: (args.fields as string) ?? "id,name,link",
            limit: (args.limit as number) ?? 50,
          },
        });
        return jsonResult(data);
      }
      case "meta_snapshot_object": {
        const objectId = String(args.object_id).trim();
        const objectType = String(args.object_type).trim();

        const fieldMap: Record<string, string> = {
          campaign:
            "id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy,updated_time",
          adset:
            "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,bid_strategy,optimization_goal,targeting,updated_time",
          ad:
            "id,name,status,effective_status,campaign_id,adset_id,creative{id,name},updated_time",
          creative:
            "id,name,title,body,object_story_spec,asset_feed_spec,image_hash,thumbnail_url"
        };

        const snapshot = await graphRequest({
          path: objectId,
          accessToken: token,
          params: {
            fields: fieldMap[objectType] ?? fieldMap.ad
          }
        });

        return jsonResult({
          snapshot_time: new Date().toISOString(),
          object_id: objectId,
          object_type: objectType,
          snapshot
        });
      }

      case "meta_get_account_activity": {
        const act = normalizeActId(String(args.ad_account_id));

        const data = await graphRequest({
          path: `${act}/activities`,
          accessToken: token,
          params: {
            since: String(args.since),
            until: String(args.until),
            limit: (args.limit as number) ?? 500,
            category:
            typeof args.category === "string"
              ? args.category
              : undefined,
            add_children: args.add_children === true ? "true" : undefined,
            fields:
              "event_type,event_time,translated_event_type,object_id,object_name,object_type,actor_name,actor_id,extra_data",
          },
        });

        return jsonResult({
          requested_fields:
            "event_type,event_time,translated_event_type,object_id,object_name,object_type,actor_name,actor_id,extra_data",
          category: args.category ?? null,
          add_children: args.add_children === true,
          raw_response: data,
        });
      }
      case "meta_compare_snapshots": {
        const beforeSnapshot = args.before_snapshot as Record<string, any>;
        const afterSnapshot = args.after_snapshot as Record<string, any>;

        const changes: Array<{
          field: string;
          before: unknown;
          after: unknown;
        }> = [];

        const allKeys = new Set([
          ...Object.keys(beforeSnapshot || {}),
          ...Object.keys(afterSnapshot || {})
        ]);

        for (const key of allKeys) {
          const beforeValue = beforeSnapshot?.[key];
          const afterValue = afterSnapshot?.[key];

          if (
            JSON.stringify(beforeValue) !==
            JSON.stringify(afterValue)
          ) {
            changes.push({
              field: key,
              before: beforeValue,
              after: afterValue
            });
          }
        }

        return jsonResult({
          change_count: changes.length,
          changes
        });
      }

      case "meta_graph_get": {
        const path = String(args.path).trim();
        const query = (args.query ?? {}) as Record<string, string>;
        const data = await graphRequest({
          path,
          accessToken: token,
          params: query,
        });
        return jsonResult(data);
      }
      case "meta_test_google_sheets": {
        let spreadsheetId = args.spreadsheet_id as string | undefined;
        if (!spreadsheetId?.trim()) {
          try {
            spreadsheetId = loadWeeklyConfig().spreadsheet_id;
          } catch {
            /* use env via resolveSpreadsheetId */
          }
        }
        const data = await testGoogleSheetsAccess(spreadsheetId);
        return jsonResult(data);
      }
      case "meta_list_sheet_tabs": {
        let spreadsheetId = args.spreadsheet_id as string | undefined;
        if (!spreadsheetId?.trim()) {
          try {
            spreadsheetId = loadWeeklyConfig().spreadsheet_id;
          } catch {
            /* env fallback */
          }
        }
        const tabs = await listSheetTabs(spreadsheetId);
        return jsonResult({
          spreadsheet_id: resolveSpreadsheetId(spreadsheetId),
          tabs,
        });
      }
      case "meta_read_sheet_range": {
        let spreadsheetId = args.spreadsheet_id as string | undefined;
        if (!spreadsheetId?.trim()) {
          try {
            spreadsheetId = loadWeeklyConfig().spreadsheet_id;
          } catch {
            /* env fallback */
          }
        }
        const values = await readSheetRange(
          spreadsheetId,
          String(args.sheet_title),
          (args.a1_range as string) || "A:ZZ"
        );
        return jsonResult({
          spreadsheet_id: resolveSpreadsheetId(spreadsheetId),
          sheet_title: args.sheet_title,
          row_count: values.length,
          values,
        });
      }
      case "meta_clear_sheet_tab": {
        let spreadsheetId = args.spreadsheet_id as string | undefined;
        if (!spreadsheetId?.trim()) {
          try {
            spreadsheetId = loadWeeklyConfig().spreadsheet_id;
          } catch {
            /* env fallback */
          }
        }
        await clearSheetTab(spreadsheetId, String(args.sheet_title));
        return jsonResult({
          ok: true,
          spreadsheet_id: resolveSpreadsheetId(spreadsheetId),
          sheet_title: args.sheet_title,
        });
      }
      case "meta_run_weekly_report": {
        const result = await runMetaWeeklyReport({
          since: args.since as string | undefined,
          until: args.until as string | undefined,
          accounts: normalizeAccountInputs(args.accounts),
          spreadsheetId: args.spreadsheet_id as string | undefined,
          minSpendInr:
            typeof args.min_spend_inr === "number"
              ? args.min_spend_inr
              : undefined,
          writeClientReports: args.write_client_reports === true,
          clearTab: args.clear_tab !== false,
          skipSheets: args.skip_sheets === true,
        });
        return jsonResult(result);
      }
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (e) {
    return {
      content: [{ type: "text", text: errText(e) }],
      isError: true,
    };
  }
});

  return server;
}
