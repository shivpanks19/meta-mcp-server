import { graphRequest, optionalPageToken } from "./meta-api.js";
import {
  createFacebookPagePost,
  resolvePagePublishingContext,
} from "./social-publish.js";

const SOCIAL_SMM_TOOL_NAMES = new Set([
  "meta_get_facebook_post_insights",
  "meta_get_page_smm_insights",
  "meta_list_post_comments",
  "meta_create_post_comment",
  "meta_hide_post_comment",
  "meta_delete_page_post",
  "meta_schedule_facebook_post",
]);

export function isSocialSmmTool(name: string): boolean {
  return SOCIAL_SMM_TOOL_NAMES.has(name);
}

function unixSeconds(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${field} must be a positive Unix timestamp in seconds.`);
  }
  return Math.floor(n);
}

function validateScheduledTime(scheduledPublishTime: number): void {
  const now = Math.floor(Date.now() / 1000);
  const min = now + 10 * 60;
  const max = now + 75 * 24 * 60 * 60;
  if (scheduledPublishTime < min) {
    throw new Error(
      "scheduled_publish_time must be at least 10 minutes in the future."
    );
  }
  if (scheduledPublishTime > max) {
    throw new Error(
      "scheduled_publish_time must be within 75 days from now."
    );
  }
}

async function resolvePageToken(
  pageId: string,
  userToken: string,
  explicitPageToken?: string
): Promise<string> {
  const ctx = await resolvePagePublishingContext(
    pageId,
    userToken,
    explicitPageToken
  );
  return ctx.page_access_token;
}

export const socialSmmToolDefinitions = [
  {
    name: "meta_get_facebook_post_insights",
    description:
      "Fetch engagement insights for a Facebook Page post (impressions, clicks, reactions, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "Facebook post id" },
        metrics: {
          type: "string",
          description:
            "Comma-separated metrics (default: post_impressions_unique,post_engaged_users,post_clicks,post_reactions_by_type_total)",
        },
        page_access_token: { type: "string" },
      },
      required: ["post_id"],
    },
  },
  {
    name: "meta_get_page_smm_insights",
    description:
      "Organic SMM metrics for a Facebook Page and optionally its linked Instagram business account (followers, impressions, engagement).",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string" },
        period: {
          type: "string",
          enum: ["day", "week", "days_28"],
          description: "Default day",
        },
        page_metrics: {
          type: "string",
          description:
            "Facebook page insight metrics (default: page_impressions_unique,page_engaged_users,page_post_engagements,page_fans)",
        },
        include_instagram: {
          type: "boolean",
          description: "Also fetch IG account insights when linked (default true)",
        },
        instagram_metrics: {
          type: "string",
          description:
            "IG account metrics (default: impressions,reach,follower_count,profile_views)",
        },
        page_access_token: { type: "string" },
      },
      required: ["page_id"],
    },
  },
  {
    name: "meta_list_post_comments",
    description:
      "List comments on a Facebook Page post or Instagram media item.",
    inputSchema: {
      type: "object",
      properties: {
        object_id: {
          type: "string",
          description: "Facebook post id or Instagram media id",
        },
        platform: {
          type: "string",
          enum: ["facebook", "instagram"],
          description: "Default facebook",
        },
        fields: {
          type: "string",
          description: "Default: id,message,from,created_time,like_count",
        },
        limit: { type: "number", description: "Default 50" },
        page_id: {
          type: "string",
          description: "Required for instagram (token resolution)",
        },
        page_access_token: { type: "string" },
      },
      required: ["object_id"],
    },
  },
  {
    name: "meta_create_post_comment",
    description:
      "Create a comment or reply on a Facebook Page post or Instagram media item.",
    inputSchema: {
      type: "object",
      properties: {
        object_id: {
          type: "string",
          description: "Facebook post id or Instagram media id",
        },
        message: { type: "string", description: "Comment text" },
        platform: {
          type: "string",
          enum: ["facebook", "instagram"],
          description: "Default facebook",
        },
        page_id: {
          type: "string",
          description: "Required for instagram (token resolution)",
        },
        page_access_token: { type: "string" },
      },
      required: ["object_id", "message"],
    },
  },
  {
    name: "meta_hide_post_comment",
    description:
      "Hide a Facebook comment (is_hidden=true) or hide an Instagram comment.",
    inputSchema: {
      type: "object",
      properties: {
        comment_id: { type: "string" },
        platform: {
          type: "string",
          enum: ["facebook", "instagram"],
          description: "Default facebook",
        },
        page_id: {
          type: "string",
          description: "Required for instagram (token resolution)",
        },
        page_access_token: { type: "string" },
      },
      required: ["comment_id"],
    },
  },
  {
    name: "meta_delete_page_post",
    description: "Delete a Facebook Page post by post id.",
    inputSchema: {
      type: "object",
      properties: {
        post_id: { type: "string" },
        page_access_token: { type: "string" },
      },
      required: ["post_id"],
    },
  },
  {
    name: "meta_schedule_facebook_post",
    description:
      "Schedule a Facebook Page post for future publish (10 minutes to 75 days ahead). Supports text, link, or image_url.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string" },
        message: { type: "string" },
        link: { type: "string" },
        image_url: { type: "string" },
        scheduled_publish_time: {
          type: "number",
          description: "Unix timestamp in seconds (UTC)",
        },
        page_access_token: { type: "string" },
      },
      required: ["page_id", "message", "scheduled_publish_time"],
    },
  },
] as const;

export async function handleSocialSmmTool(
  name: string,
  args: Record<string, unknown>,
  userToken: string
): Promise<unknown | null> {
  if (!isSocialSmmTool(name)) return null;

  switch (name) {
    case "meta_get_facebook_post_insights": {
      const postId = String(args.post_id).trim();
      const pt =
        optionalPageToken(args.page_access_token as string | undefined) ??
        userToken;
      return graphRequest({
        path: `${postId}/insights`,
        accessToken: pt,
        params: {
          metric:
            (args.metrics as string) ??
            "post_impressions_unique,post_engaged_users,post_clicks,post_reactions_by_type_total",
        },
      });
    }
    case "meta_get_page_smm_insights": {
      const pageId = String(args.page_id).trim();
      const ctx = await resolvePagePublishingContext(
        pageId,
        userToken,
        args.page_access_token as string | undefined
      );
      const period = (args.period as string) ?? "day";
      const pageInsights = await graphRequest({
        path: `${pageId}/insights`,
        accessToken: ctx.page_access_token,
        params: {
          metric:
            (args.page_metrics as string) ??
            "page_impressions_unique,page_engaged_users,page_post_engagements,page_fans",
          period,
        },
      });

      const includeInstagram = args.include_instagram !== false;
      let instagramInsights: unknown;
      if (includeInstagram && ctx.instagram_business_account?.id) {
        instagramInsights = await graphRequest({
          path: `${ctx.instagram_business_account.id}/insights`,
          accessToken: ctx.page_access_token,
          params: {
            metric:
              (args.instagram_metrics as string) ??
              "impressions,reach,follower_count,profile_views",
            period,
          },
        });
      }

      return {
        page_id: pageId,
        period,
        instagram_business_account: ctx.instagram_business_account,
        facebook: pageInsights,
        instagram: instagramInsights ?? null,
      };
    }
    case "meta_list_post_comments": {
      const objectId = String(args.object_id).trim();
      const platform = (args.platform as string) ?? "facebook";
      let pt =
        optionalPageToken(args.page_access_token as string | undefined) ??
        userToken;
      if (platform === "instagram") {
        const pageId = String(args.page_id ?? "").trim();
        if (!pageId) {
          throw new Error("page_id is required when platform is instagram.");
        }
        pt = await resolvePageToken(
          pageId,
          userToken,
          args.page_access_token as string | undefined
        );
      }
      return graphRequest({
        path: `${objectId}/comments`,
        accessToken: pt,
        params: {
          fields:
            (args.fields as string) ??
            "id,message,from,created_time,like_count",
          limit: (args.limit as number) ?? 50,
        },
      });
    }
    case "meta_create_post_comment": {
      const objectId = String(args.object_id).trim();
      const message = String(args.message).trim();
      if (!message) throw new Error("message is required.");
      const platform = (args.platform as string) ?? "facebook";
      let pt =
        optionalPageToken(args.page_access_token as string | undefined) ??
        userToken;
      if (platform === "instagram") {
        const pageId = String(args.page_id ?? "").trim();
        if (!pageId) {
          throw new Error("page_id is required when platform is instagram.");
        }
        pt = await resolvePageToken(
          pageId,
          userToken,
          args.page_access_token as string | undefined
        );
      }
      return graphRequest({
        path: `${objectId}/comments`,
        accessToken: pt,
        method: "POST",
        body: { message },
      });
    }
    case "meta_hide_post_comment": {
      const commentId = String(args.comment_id).trim();
      const platform = (args.platform as string) ?? "facebook";
      let pt =
        optionalPageToken(args.page_access_token as string | undefined) ??
        userToken;
      if (platform === "instagram") {
        const pageId = String(args.page_id ?? "").trim();
        if (!pageId) {
          throw new Error("page_id is required when platform is instagram.");
        }
        pt = await resolvePageToken(
          pageId,
          userToken,
          args.page_access_token as string | undefined
        );
        return graphRequest({
          path: commentId,
          accessToken: pt,
          method: "POST",
          body: { hide: true },
        });
      }
      return graphRequest({
        path: commentId,
        accessToken: pt,
        method: "POST",
        body: { is_hidden: true },
      });
    }
    case "meta_delete_page_post": {
      const postId = String(args.post_id).trim();
      const pt =
        optionalPageToken(args.page_access_token as string | undefined) ??
        userToken;
      return graphRequest({
        path: postId,
        accessToken: pt,
        method: "DELETE",
      });
    }
    case "meta_schedule_facebook_post": {
      const pageId = String(args.page_id).trim();
      const scheduledPublishTime = unixSeconds(
        args.scheduled_publish_time,
        "scheduled_publish_time"
      );
      validateScheduledTime(scheduledPublishTime);
      const ctx = await resolvePagePublishingContext(
        pageId,
        userToken,
        args.page_access_token as string | undefined
      );
      return createFacebookPagePost({
        page_id: pageId,
        page_access_token: ctx.page_access_token,
        message: String(args.message),
        link: args.link ? String(args.link) : undefined,
        image_url: args.image_url ? String(args.image_url) : undefined,
        published: false,
        scheduled_publish_time: scheduledPublishTime,
      });
    }
    default:
      return null;
  }
}
