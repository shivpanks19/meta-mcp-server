import { graphRequest, optionalPageToken } from "./meta-api.js";

export type SocialPlatform = "facebook" | "instagram";

export interface PagePublishingContext {
  page_id: string;
  page_access_token: string;
  instagram_business_account?: {
    id: string;
    username?: string;
    name?: string;
  };
}

export interface PublishCarouselPostInput {
  page_id: string;
  message: string;
  image_urls: string[];
  platforms?: SocialPlatform[];
  published?: boolean;
  page_access_token?: string;
  instagram_user_id?: string;
}

const MIN_CAROUSEL_ITEMS = 2;
const MAX_CAROUSEL_ITEMS = 10;

export function normalizeImageUrls(imageUrls: unknown): string[] {
  if (!Array.isArray(imageUrls)) {
    throw new Error("image_urls must be an array of public HTTPS URLs.");
  }
  const urls = imageUrls
    .map((u) => String(u).trim())
    .filter((u) => u.length > 0);
  if (urls.length < MIN_CAROUSEL_ITEMS) {
    throw new Error(
      `Carousel requires at least ${MIN_CAROUSEL_ITEMS} image URLs (got ${urls.length}).`
    );
  }
  if (urls.length > MAX_CAROUSEL_ITEMS) {
    throw new Error(
      `Carousel supports up to ${MAX_CAROUSEL_ITEMS} images (got ${urls.length}).`
    );
  }
  return urls;
}

export async function createFacebookCarouselPost(input: {
  page_id: string;
  page_access_token: string;
  message: string;
  image_urls: string[];
  published?: boolean;
}): Promise<{
  photo_ids: string[];
  feed: unknown;
}> {
  const published = input.published ?? true;
  const imageUrls = normalizeImageUrls(input.image_urls);
  const photoIds: string[] = [];

  for (const url of imageUrls) {
    const photo = await graphRequest<{ id: string }>({
      path: `${input.page_id}/photos`,
      accessToken: input.page_access_token,
      method: "POST",
      body: {
        url,
        published: false,
      },
    });
    photoIds.push(photo.id);
  }

  const body: Record<string, unknown> = {
    message: input.message,
    published,
  };
  photoIds.forEach((id, index) => {
    body[`attached_media[${index}]`] = JSON.stringify({ media_fbid: id });
  });

  const feed = await graphRequest({
    path: `${input.page_id}/feed`,
    accessToken: input.page_access_token,
    method: "POST",
    body,
  });

  return { photo_ids: photoIds, feed };
}

export async function publishInstagramCarouselPost(input: {
  instagram_user_id: string;
  page_access_token: string;
  caption: string;
  image_urls: string[];
}): Promise<{
  child_container_ids: string[];
  carousel_container_id: string;
  publish: unknown;
}> {
  const imageUrls = normalizeImageUrls(input.image_urls);
  const childIds: string[] = [];

  for (const url of imageUrls) {
    const child = await graphRequest<{ id: string }>({
      path: `${input.instagram_user_id}/media`,
      accessToken: input.page_access_token,
      method: "POST",
      body: {
        image_url: url,
        is_carousel_item: true,
      },
    });
    childIds.push(child.id);
    await waitForInstagramContainerReady(child.id, input.page_access_token);
  }

  const carouselContainer = await graphRequest<{ id: string }>({
    path: `${input.instagram_user_id}/media`,
    accessToken: input.page_access_token,
    method: "POST",
    body: {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption: input.caption,
    },
  });

  await waitForInstagramContainerReady(
    carouselContainer.id,
    input.page_access_token
  );

  const publish = await publishInstagramMediaContainer({
    instagram_user_id: input.instagram_user_id,
    page_access_token: input.page_access_token,
    creation_id: carouselContainer.id,
  });

  return {
    child_container_ids: childIds,
    carousel_container_id: carouselContainer.id,
    publish,
  };
}

export async function publishCarouselPost(
  input: PublishCarouselPostInput,
  userToken: string
): Promise<{
  page_id: string;
  platforms_requested: SocialPlatform[];
  image_count: number;
  facebook?: { photo_ids: string[]; feed: unknown };
  instagram?: {
    child_container_ids: string[];
    carousel_container_id: string;
    publish: unknown;
  };
  warnings?: string[];
}> {
  const pageId = String(input.page_id).trim();
  const message = String(input.message).trim();
  if (!message) {
    throw new Error(
      "message is required (Facebook post text and Instagram caption)."
    );
  }

  const imageUrls = normalizeImageUrls(input.image_urls);
  const platforms = normalizePlatforms(input.platforms);
  const ctx = await resolvePagePublishingContext(
    pageId,
    userToken,
    input.page_access_token
  );

  const result: {
    page_id: string;
    platforms_requested: SocialPlatform[];
    image_count: number;
    facebook?: { photo_ids: string[]; feed: unknown };
    instagram?: {
      child_container_ids: string[];
      carousel_container_id: string;
      publish: unknown;
    };
    warnings?: string[];
  } = {
    page_id: pageId,
    platforms_requested: platforms,
    image_count: imageUrls.length,
  };

  if (platforms.includes("facebook")) {
    result.facebook = await createFacebookCarouselPost({
      page_id: pageId,
      page_access_token: ctx.page_access_token,
      message,
      image_urls: imageUrls,
      published: input.published,
    });
  }

  if (platforms.includes("instagram")) {
    const igUserId =
      input.instagram_user_id?.trim() ??
      ctx.instagram_business_account?.id;

    if (!igUserId) {
      throw new Error(
        `Page ${pageId} has no linked Instagram business account. Link IG in Meta Business Suite or pass instagram_user_id.`
      );
    }

    result.instagram = await publishInstagramCarouselPost({
      instagram_user_id: igUserId,
      page_access_token: ctx.page_access_token,
      caption: message,
      image_urls: imageUrls,
    });
  }

  return result;
}

export interface PublishSocialPostInput {
  page_id: string;
  message: string;
  link?: string;
  image_url?: string;
  video_url?: string;
  platforms?: SocialPlatform[];
  published?: boolean;
  page_access_token?: string;
  instagram_user_id?: string;
  video_media_type?: "VIDEO" | "REELS";
  wait_for_video_processing?: boolean;
}

export async function resolvePagePublishingContext(
  pageId: string,
  userToken: string,
  explicitPageToken?: string
): Promise<PagePublishingContext> {
  let pageToken =
    optionalPageToken(explicitPageToken) ?? userToken;

  const accounts = await graphRequest<{
    data?: Array<{ id: string; access_token?: string }>;
  }>({
    path: "me/accounts",
    accessToken: userToken,
    params: { fields: "id,access_token", limit: 200 },
  });

  const match = accounts.data?.find((a) => a.id === pageId);
  if (match?.access_token) {
    pageToken = match.access_token;
  }

  const page = await graphRequest<{
    access_token?: string;
    instagram_business_account?: {
      id: string;
      username?: string;
      name?: string;
    };
  }>({
    path: pageId,
    accessToken: pageToken,
    params: {
      fields:
        "access_token,instagram_business_account{id,username,name}",
    },
  });

  if (page.access_token) {
    pageToken = page.access_token;
  }

  return {
    page_id: pageId,
    page_access_token: pageToken,
    instagram_business_account: page.instagram_business_account,
  };
}

export async function createFacebookPagePost(input: {
  page_id: string;
  page_access_token: string;
  message: string;
  link?: string;
  image_url?: string;
  published?: boolean;
  scheduled_publish_time?: number;
}): Promise<unknown> {
  const published = input.published ?? true;

  if (input.image_url) {
    const body: Record<string, unknown> = {
      url: input.image_url,
      message: input.message,
      published,
    };
    if (input.scheduled_publish_time !== undefined) {
      body.scheduled_publish_time = input.scheduled_publish_time;
    }
    return graphRequest({
      path: `${input.page_id}/photos`,
      accessToken: input.page_access_token,
      method: "POST",
      body,
    });
  }

  const body: Record<string, unknown> = {
    message: input.message,
    published,
  };
  if (input.link) body.link = input.link;
  if (input.scheduled_publish_time !== undefined) {
    body.scheduled_publish_time = input.scheduled_publish_time;
  }

  return graphRequest({
    path: `${input.page_id}/feed`,
    accessToken: input.page_access_token,
    method: "POST",
    body,
  });
}

export async function createInstagramMediaContainer(input: {
  instagram_user_id: string;
  page_access_token: string;
  caption?: string;
  image_url?: string;
  video_url?: string;
  media_type?: "VIDEO" | "REELS";
}): Promise<{ id: string }> {
  const body: Record<string, unknown> = {};
  if (input.caption) body.caption = input.caption;

  if (input.image_url) {
    body.image_url = input.image_url;
  } else if (input.video_url) {
    body.video_url = input.video_url;
    body.media_type = input.media_type ?? "REELS";
  } else {
    throw new Error(
      "Instagram posts require image_url or video_url (public HTTPS URL)."
    );
  }

  return graphRequest<{ id: string }>({
    path: `${input.instagram_user_id}/media`,
    accessToken: input.page_access_token,
    method: "POST",
    body,
  });
}

export async function waitForInstagramContainerReady(
  containerId: string,
  pageAccessToken: string,
  maxWaitMs = 120000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const status = await graphRequest<{ status_code?: string }>({
      path: containerId,
      accessToken: pageAccessToken,
      params: { fields: "status_code" },
    });
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR") {
      throw new Error(
        "Instagram media container processing failed (status ERROR)."
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(
    `Timed out after ${maxWaitMs}ms waiting for Instagram media container ${containerId}.`
  );
}

export async function publishInstagramMediaContainer(input: {
  instagram_user_id: string;
  page_access_token: string;
  creation_id: string;
}): Promise<unknown> {
  return graphRequest({
    path: `${input.instagram_user_id}/media_publish`,
    accessToken: input.page_access_token,
    method: "POST",
    body: { creation_id: input.creation_id },
  });
}

export async function publishInstagramPost(input: {
  instagram_user_id: string;
  page_access_token: string;
  caption?: string;
  image_url?: string;
  video_url?: string;
  media_type?: "VIDEO" | "REELS";
  wait_for_video_processing?: boolean;
}): Promise<{
  container_id: string;
  publish: unknown;
}> {
  const container = await createInstagramMediaContainer({
    instagram_user_id: input.instagram_user_id,
    page_access_token: input.page_access_token,
    caption: input.caption,
    image_url: input.image_url,
    video_url: input.video_url,
    media_type: input.media_type,
  });

  if (
    input.video_url &&
    (input.wait_for_video_processing ?? true)
  ) {
    await waitForInstagramContainerReady(
      container.id,
      input.page_access_token
    );
  }

  const publish = await publishInstagramMediaContainer({
    instagram_user_id: input.instagram_user_id,
    page_access_token: input.page_access_token,
    creation_id: container.id,
  });

  return { container_id: container.id, publish };
}

export async function publishSocialPost(
  input: PublishSocialPostInput,
  userToken: string
): Promise<{
  page_id: string;
  platforms_requested: SocialPlatform[];
  facebook?: unknown;
  instagram?: { container_id: string; publish: unknown };
  warnings?: string[];
}> {
  const pageId = String(input.page_id).trim();
  const message = String(input.message).trim();
  if (!message) {
    throw new Error("message is required (used as Facebook post text and Instagram caption).");
  }

  const platforms = normalizePlatforms(input.platforms);
  const ctx = await resolvePagePublishingContext(
    pageId,
    userToken,
    input.page_access_token
  );

  const result: {
    page_id: string;
    platforms_requested: SocialPlatform[];
    facebook?: unknown;
    instagram?: { container_id: string; publish: unknown };
    warnings?: string[];
  } = {
    page_id: pageId,
    platforms_requested: platforms,
  };

  const warnings: string[] = [];

  if (platforms.includes("facebook")) {
    result.facebook = await createFacebookPagePost({
      page_id: pageId,
      page_access_token: ctx.page_access_token,
      message,
      link: input.link,
      image_url: input.image_url,
      published: input.published,
    });
  }

  if (platforms.includes("instagram")) {
    const igUserId =
      input.instagram_user_id?.trim() ??
      ctx.instagram_business_account?.id;

    if (!igUserId) {
      throw new Error(
        `Page ${pageId} has no linked Instagram business account. Link IG in Meta Business Suite or pass instagram_user_id.`
      );
    }

    if (!input.image_url && !input.video_url) {
      throw new Error(
        "Instagram requires image_url or video_url (public HTTPS). Text-only posts are not supported."
      );
    }

    result.instagram = await publishInstagramPost({
      instagram_user_id: igUserId,
      page_access_token: ctx.page_access_token,
      caption: message,
      image_url: input.image_url,
      video_url: input.video_url,
      media_type: input.video_media_type,
      wait_for_video_processing: input.wait_for_video_processing,
    });
  }

  if (input.link && platforms.includes("instagram")) {
    warnings.push(
      "link is applied to Facebook only; Instagram caption does not auto-include link previews."
    );
  }

  if (warnings.length) result.warnings = warnings;
  return result;
}

function normalizePlatforms(
  platforms?: SocialPlatform[]
): SocialPlatform[] {
  if (!platforms?.length) return ["facebook", "instagram"];
  const normalized = [...new Set(platforms)];
  for (const p of normalized) {
    if (p !== "facebook" && p !== "instagram") {
      throw new Error(`Invalid platform: ${p}. Use facebook or instagram.`);
    }
  }
  return normalized;
}

export const socialPublishToolDefinitions = [
  {
    name: "meta_get_page_publishing_context",
    description:
      "Resolve Facebook Page access token and linked Instagram business account for publishing (Graph API / Business API). Use before posting to confirm permissions and IG linkage.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "Facebook Page ID" },
        page_access_token: {
          type: "string",
          description: "Optional explicit page token",
        },
      },
      required: ["page_id"],
    },
  },
  {
    name: "meta_publish_facebook_post",
    description:
      "Publish to a Facebook Page feed via Graph API (pages_manage_posts + Page token). Supports text, optional link, or image_url photo post.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string" },
        message: { type: "string", description: "Post text" },
        link: { type: "string", description: "Optional link URL (feed posts)" },
        image_url: {
          type: "string",
          description: "Optional public image URL (uses /photos)",
        },
        published: {
          type: "boolean",
          description: "Default true — live post",
        },
        page_access_token: {
          type: "string",
          description: "Page access token (recommended)",
        },
      },
      required: ["page_id", "message"],
    },
  },
  {
    name: "meta_publish_instagram_post",
    description:
      "Publish to Instagram business account via Content Publishing API (instagram_content_publish + Page token). Requires public image_url or video_url.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description:
            "Facebook Page linked to the IG account (used to resolve IG user id and page token)",
        },
        instagram_user_id: {
          type: "string",
          description: "Optional IG business account id (skips page lookup)",
        },
        caption: { type: "string", description: "Post caption" },
        image_url: {
          type: "string",
          description: "Public HTTPS image URL",
        },
        video_url: {
          type: "string",
          description: "Public HTTPS video URL",
        },
        video_media_type: {
          type: "string",
          enum: ["VIDEO", "REELS"],
          description: "Default REELS when video_url is set",
        },
        wait_for_video_processing: {
          type: "boolean",
          description:
            "Poll container until FINISHED before publish (default true for video)",
        },
        page_access_token: { type: "string" },
      },
      required: ["caption"],
    },
  },
  {
    name: "meta_publish_social_post",
    description:
      "Publish one message to Facebook Page and/or linked Instagram business account (Business API). Default: both platforms when IG is linked. Instagram requires image_url or video_url.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "Facebook Page ID" },
        message: {
          type: "string",
          description: "Facebook post text / Instagram caption",
        },
        link: {
          type: "string",
          description: "Optional link for Facebook feed post only",
        },
        image_url: {
          type: "string",
          description: "Public HTTPS image (Facebook photo + Instagram image)",
        },
        video_url: {
          type: "string",
          description: "Public HTTPS video (Instagram; Facebook uses link in message if needed)",
        },
        platforms: {
          type: "array",
          items: { type: "string", enum: ["facebook", "instagram"] },
          description: "Default: [facebook, instagram]",
        },
        published: {
          type: "boolean",
          description: "Facebook only — default true",
        },
        page_access_token: { type: "string" },
        instagram_user_id: { type: "string" },
        video_media_type: {
          type: "string",
          enum: ["VIDEO", "REELS"],
        },
        wait_for_video_processing: { type: "boolean" },
      },
      required: ["page_id", "message"],
    },
  },
  {
    name: "meta_publish_carousel_post",
    description:
      "Publish a multi-image carousel to Facebook Page (multi-photo feed post) and/or linked Instagram business account (CAROUSEL container). Requires 2–10 public HTTPS image_urls. Default platforms: facebook + instagram when IG is linked.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "Facebook Page ID" },
        message: {
          type: "string",
          description: "Facebook post text / Instagram caption",
        },
        image_urls: {
          type: "array",
          items: { type: "string" },
          description: "2–10 public HTTPS image URLs (order = slide order)",
          minItems: 2,
          maxItems: 10,
        },
        platforms: {
          type: "array",
          items: { type: "string", enum: ["facebook", "instagram"] },
          description: "Default: [facebook, instagram]",
        },
        published: {
          type: "boolean",
          description: "Facebook only — default true",
        },
        page_access_token: { type: "string" },
        instagram_user_id: { type: "string" },
      },
      required: ["page_id", "message", "image_urls"],
    },
  },
] as const;

export async function handleSocialPublishTool(
  name: string,
  args: Record<string, unknown>,
  userToken: string
): Promise<unknown | null> {
  switch (name) {
    case "meta_get_page_publishing_context": {
      const pageId = String(args.page_id).trim();
      return resolvePagePublishingContext(
        pageId,
        userToken,
        args.page_access_token as string | undefined
      );
    }
    case "meta_publish_facebook_post": {
      const pageId = String(args.page_id).trim();
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
        published: args.published !== false,
      });
    }
    case "meta_publish_instagram_post": {
      const pageId = args.page_id ? String(args.page_id).trim() : undefined;
      let igUserId = args.instagram_user_id
        ? String(args.instagram_user_id).trim()
        : undefined;
      let pageToken =
        optionalPageToken(args.page_access_token as string | undefined) ??
        userToken;

      if (pageId) {
        const ctx = await resolvePagePublishingContext(
          pageId,
          userToken,
          args.page_access_token as string | undefined
        );
        pageToken = ctx.page_access_token;
        igUserId = igUserId ?? ctx.instagram_business_account?.id;
      }

      if (!igUserId) {
        throw new Error(
          "instagram_user_id or page_id with linked Instagram account is required."
        );
      }

      return publishInstagramPost({
        instagram_user_id: igUserId,
        page_access_token: pageToken,
        caption: args.caption ? String(args.caption) : undefined,
        image_url: args.image_url ? String(args.image_url) : undefined,
        video_url: args.video_url ? String(args.video_url) : undefined,
        media_type: args.video_media_type as "VIDEO" | "REELS" | undefined,
        wait_for_video_processing:
          args.wait_for_video_processing !== false,
      });
    }
    case "meta_publish_social_post": {
      return publishSocialPost(
        {
          page_id: String(args.page_id),
          message: String(args.message),
          link: args.link ? String(args.link) : undefined,
          image_url: args.image_url ? String(args.image_url) : undefined,
          video_url: args.video_url ? String(args.video_url) : undefined,
          platforms: args.platforms as SocialPlatform[] | undefined,
          published: args.published !== false,
          page_access_token: args.page_access_token as string | undefined,
          instagram_user_id: args.instagram_user_id as string | undefined,
          video_media_type: args.video_media_type as
            | "VIDEO"
            | "REELS"
            | undefined,
          wait_for_video_processing:
            args.wait_for_video_processing !== false,
        },
        userToken
      );
    }
    case "meta_publish_carousel_post": {
      return publishCarouselPost(
        {
          page_id: String(args.page_id),
          message: String(args.message),
          image_urls: args.image_urls as string[],
          platforms: args.platforms as SocialPlatform[] | undefined,
          published: args.published !== false,
          page_access_token: args.page_access_token as string | undefined,
          instagram_user_id: args.instagram_user_id as string | undefined,
        },
        userToken
      );
    }
    default:
      return null;
  }
}
