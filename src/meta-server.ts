import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  graphRequest,
  MetaGraphError,
  optionalPageToken,
  requireEnvToken,
} from "./meta-api.js";

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
