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
