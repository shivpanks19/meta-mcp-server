import { graphRequest, MetaGraphError } from "./meta-api.js";
import { resolvePagePublishingContext } from "./social-publish.js";

export const IG_MEDIA_LIST_FIELDS =
  "id,caption,media_type,media_product_type,media_url,permalink,thumbnail_url,timestamp,username,like_count,comments_count,shortcode";

export const DEFAULT_REEL_INSIGHT_METRICS = [
  "views",
  "reach",
  "total_interactions",
  "likes",
  "comments",
  "shares",
  "saves",
  "replies",
  "follows",
  "profile_activity",
  "ig_reels_avg_watch_time",
  "ig_reels_video_view_total_time",
] as const;

export type MediaTypeFilter = "ALL" | "REELS" | "IMAGE" | "VIDEO" | "CAROUSEL";

export interface InstagramAccount {
  id: string;
  username?: string;
  name?: string;
  followers_count?: number;
  media_count?: number;
}

export interface InstagramMediaItem {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  permalink?: string;
  thumbnail_url?: string;
  timestamp?: string;
  username?: string;
  like_count?: number;
  comments_count?: number;
  shortcode?: string;
}

export interface NormalizedMediaInsights {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  follows: number | null;
  profile_activity: number | null;
  total_interactions: number | null;
  replies: number | null;
  avg_watch_time_ms: number | null;
  total_watch_time_ms: number | null;
  organic_reach: number | null;
  paid_reach: number | null;
  organic_views: number | null;
  paid_views: number | null;
}

const IG_REELS_TOOL_NAMES = new Set([
  "meta_get_instagram_account",
  "meta_list_instagram_media",
  "meta_get_instagram_media_insights",
  "meta_get_instagram_reel_analytics",
  "meta_get_instagram_reel_promotion_status",
  "meta_analyze_instagram_reel_organic_performance",
]);

export function isInstagramReelsTool(name: string): boolean {
  return IG_REELS_TOOL_NAMES.has(name);
}

export function parseDateRange(
  since?: string,
  until?: string
): { sinceMs?: number; untilMs?: number } {
  const sinceMs = since ? Date.parse(`${since}T00:00:00.000Z`) : undefined;
  const untilMs = until ? Date.parse(`${until}T23:59:59.999Z`) : undefined;
  if (since && !Number.isFinite(sinceMs)) {
    throw new Error(`Invalid since date "${since}". Use YYYY-MM-DD.`);
  }
  if (until && !Number.isFinite(untilMs)) {
    throw new Error(`Invalid until date "${until}". Use YYYY-MM-DD.`);
  }
  return { sinceMs, untilMs };
}

export function isReelMedia(item: InstagramMediaItem): boolean {
  return String(item.media_product_type ?? "").toUpperCase() === "REELS";
}

export function filterMediaByType(
  items: InstagramMediaItem[],
  mediaType: MediaTypeFilter
): InstagramMediaItem[] {
  if (mediaType === "ALL") return items;
  if (mediaType === "REELS") {
    return items.filter(isReelMedia);
  }
  return items.filter((item) => {
    const mt = String(item.media_type ?? "").toUpperCase();
    if (mediaType === "IMAGE") return mt === "IMAGE";
    if (mediaType === "VIDEO") return mt === "VIDEO";
    if (mediaType === "CAROUSEL") return mt === "CAROUSEL_ALBUM";
    return true;
  });
}

export function filterMediaByDateRange(
  items: InstagramMediaItem[],
  sinceMs?: number,
  untilMs?: number
): InstagramMediaItem[] {
  if (sinceMs === undefined && untilMs === undefined) return items;
  return items.filter((item) => {
    if (!item.timestamp) return false;
    const ts = Date.parse(item.timestamp);
    if (!Number.isFinite(ts)) return false;
    if (sinceMs !== undefined && ts < sinceMs) return false;
    if (untilMs !== undefined && ts > untilMs) return false;
    return true;
  });
}

export function safeDivide(
  numerator: number | null | undefined,
  denominator: number | null | undefined
): number | null {
  if (
    numerator === null ||
    numerator === undefined ||
    denominator === null ||
    denominator === undefined ||
    denominator === 0
  ) {
    return null;
  }
  return numerator / denominator;
}

export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function percentileRank(value: number | null, values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (value === null || !finite.length) return null;
  const below = finite.filter((v) => v < value).length;
  const equal = finite.filter((v) => v === value).length;
  return ((below + equal * 0.5) / finite.length) * 100;
}

function parseInsightValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

interface InsightRow {
  name?: string;
  values?: Array<{ value?: unknown; end_time?: string }>;
  total_value?: { value?: unknown };
  title?: string;
}

export function parseInsightsResponse(
  data: InsightRow[]
): {
  insights: NormalizedMediaInsights;
  unsupported_metrics: string[];
  paid_vs_organic_available: boolean;
} {
  const map = new Map<string, number | null>();
  let paidVsOrganic = false;

  for (const row of data) {
    const name = String(row.name ?? "");
    let value: number | null = null;

    if (row.total_value?.value !== undefined) {
      value = parseInsightValue(row.total_value.value);
    } else if (row.values?.length) {
      const last = row.values[row.values.length - 1];
      value = parseInsightValue(last?.value);
    }

    map.set(name, value);

    if (/organic|paid/i.test(name)) {
      paidVsOrganic = true;
    }
  }

  const insights: NormalizedMediaInsights = {
    views: map.get("views") ?? map.get("plays") ?? map.get("video_views") ?? null,
    reach: map.get("reach") ?? null,
    likes: map.get("likes") ?? null,
    comments: map.get("comments") ?? null,
    shares: map.get("shares") ?? null,
    saves: map.get("saves") ?? map.get("saved") ?? null,
    follows: map.get("follows") ?? null,
    profile_activity: map.get("profile_activity") ?? null,
    total_interactions: map.get("total_interactions") ?? null,
    replies: map.get("replies") ?? null,
    avg_watch_time_ms: map.get("ig_reels_avg_watch_time") ?? null,
    total_watch_time_ms: map.get("ig_reels_video_view_total_time") ?? null,
    organic_reach: map.get("organic_reach") ?? null,
    paid_reach: map.get("paid_reach") ?? null,
    organic_views: map.get("organic_views") ?? null,
    paid_views: map.get("paid_views") ?? null,
  };

  return {
    insights,
    unsupported_metrics: [],
    paid_vs_organic_available: paidVsOrganic,
  };
}

export function isUnsupportedMetricError(error: unknown): boolean {
  if (!(error instanceof MetaGraphError)) return false;
  const body = error.body as {
    error?: { code?: number; message?: string; error_subcode?: number };
  };
  const msg = body?.error?.message ?? error.message;
  return (
    body?.error?.code === 100 ||
    /unsupported|not valid|invalid parameter|metric/i.test(msg)
  );
}

export async function fetchMediaInsightsWithFallback(
  mediaId: string,
  accessToken: string,
  requestedMetrics?: string[]
): Promise<{
  insights: NormalizedMediaInsights;
  unsupported_metrics: string[];
  paid_vs_organic_available: boolean;
  metrics_retrieved: string[];
}> {
  const metrics = (
    requestedMetrics?.length
      ? requestedMetrics
      : [...DEFAULT_REEL_INSIGHT_METRICS]
  )
    .map((m) => m.trim())
    .filter(Boolean);

  const uniqueMetrics = [...new Set(metrics)];
  const unsupported: string[] = [];
  const allRows: InsightRow[] = [];

  const fetchBatch = async (batch: string[]) =>
    graphRequest<{ data?: InsightRow[] }>({
      path: `${mediaId}/insights`,
      accessToken,
      params: { metric: batch.join(",") },
    });

  try {
    const resp = await fetchBatch(uniqueMetrics);
    allRows.push(...(resp.data ?? []));
  } catch (batchError) {
    if (!isUnsupportedMetricError(batchError)) {
      throw batchError;
    }
    for (const metric of uniqueMetrics) {
      try {
        const resp = await fetchBatch([metric]);
        allRows.push(...(resp.data ?? []));
      } catch (e) {
        if (isUnsupportedMetricError(e)) {
          unsupported.push(metric);
        } else {
          throw e;
        }
      }
    }
  }

  const retrieved = allRows
    .map((row) => row.name)
    .filter((name): name is string => Boolean(name));

  const parsed = parseInsightsResponse(allRows);
  return {
    ...parsed,
    unsupported_metrics: unsupported,
    metrics_retrieved: [...new Set(retrieved)],
  };
}

export async function resolveInstagramAccessToken(
  userToken: string,
  input: {
    page_id?: string;
    page_access_token?: string;
    instagram_account_id?: string;
  }
): Promise<string> {
  if (input.page_id?.trim()) {
    const ctx = await resolvePagePublishingContext(
      input.page_id.trim(),
      userToken,
      input.page_access_token
    );
    return ctx.page_access_token;
  }
  return userToken;
}

export async function getInstagramAccount(input: {
  page_id: string;
  fields?: string;
  access_token: string;
}): Promise<{
  instagram_account: InstagramAccount | null;
  page_id: string;
}> {
  const pageId = input.page_id.trim();
  const accountFields =
    input.fields ??
    "id,username,name,followers_count,media_count";

  const page = await graphRequest<{
    instagram_business_account?: { id: string };
  }>({
    path: pageId,
    accessToken: input.access_token,
    params: { fields: "instagram_business_account{id}" },
  });

  const igId = page.instagram_business_account?.id;
  if (!igId) {
    return { page_id: pageId, instagram_account: null };
  }

  const account = await graphRequest<InstagramAccount>({
    path: igId,
    accessToken: input.access_token,
    params: { fields: accountFields },
  });

  return {
    page_id: pageId,
    instagram_account: {
      id: account.id,
      username: account.username,
      name: account.name,
      followers_count: account.followers_count,
      media_count: account.media_count,
    },
  };
}

export async function listInstagramMedia(input: {
  instagram_account_id: string;
  access_token: string;
  since?: string;
  until?: string;
  media_type?: MediaTypeFilter;
  limit?: number;
  after?: string;
  fields?: string;
}): Promise<{
  media: InstagramMediaItem[];
  paging: { next?: string; after?: string | null };
}> {
  const limit = input.limit ?? 50;
  const { sinceMs, untilMs } = parseDateRange(input.since, input.until);

  const params: Record<string, string | number> = {
    fields: input.fields ?? IG_MEDIA_LIST_FIELDS,
    limit,
  };
  if (input.after) params.after = input.after;

  const resp = await graphRequest<{
    data?: InstagramMediaItem[];
    paging?: { next?: string; cursors?: { after?: string } };
  }>({
    path: `${input.instagram_account_id.trim()}/media`,
    accessToken: input.access_token,
    params,
  });

  let media = resp.data ?? [];
  media = filterMediaByType(media, input.media_type ?? "ALL");
  media = filterMediaByDateRange(media, sinceMs, untilMs);

  return {
    media,
    paging: {
      next: resp.paging?.next,
      after: resp.paging?.cursors?.after ?? null,
    },
  };
}

export async function getInstagramMediaInsights(input: {
  media_id: string;
  access_token: string;
  metrics?: string;
}): Promise<{
  media_id: string;
  insights: NormalizedMediaInsights;
  unsupported_metrics: string[];
  metrics_retrieved: string[];
  paid_vs_organic_available: boolean;
  organic_classification_confidence: "limited" | "supported";
}> {
  const requested = input.metrics
    ? input.metrics.split(",").map((m) => m.trim()).filter(Boolean)
    : undefined;

  const result = await fetchMediaInsightsWithFallback(
    input.media_id.trim(),
    input.access_token,
    requested
  );

  return {
    media_id: input.media_id.trim(),
    insights: result.insights,
    unsupported_metrics: result.unsupported_metrics,
    metrics_retrieved: result.metrics_retrieved,
    paid_vs_organic_available: result.paid_vs_organic_available,
    organic_classification_confidence: result.paid_vs_organic_available
      ? "supported"
      : "limited",
  };
}

export async function getInstagramReelAnalytics(input: {
  instagram_account_id: string;
  access_token: string;
  since?: string;
  until?: string;
  limit?: number;
  include_insights?: boolean;
  account?: InstagramAccount;
}): Promise<{
  account: { id: string; username?: string };
  period: { since?: string; until?: string };
  paid_vs_organic_available: boolean;
  organic_classification_confidence: "limited" | "supported";
  reels: Array<
    InstagramMediaItem &
      NormalizedMediaInsights & {
        avg_watch_time_ms: number | null;
        total_watch_time_ms: number | null;
        unsupported_metrics?: string[];
      }
  >;
}> {
  const listed = await listInstagramMedia({
    instagram_account_id: input.instagram_account_id,
    access_token: input.access_token,
    since: input.since,
    until: input.until,
    media_type: "REELS",
    limit: input.limit ?? 50,
  });

  let paidVsOrganic = false;
  const includeInsights = input.include_insights !== false;

  const reels = await Promise.all(
    listed.media.map(async (item) => {
      const base = {
        ...item,
        views: null as number | null,
        reach: null as number | null,
        likes: item.like_count ?? null,
        comments: item.comments_count ?? null,
        shares: null as number | null,
        saves: null as number | null,
        follows: null as number | null,
        profile_activity: null as number | null,
        total_interactions: null as number | null,
        replies: null as number | null,
        avg_watch_time_ms: null as number | null,
        total_watch_time_ms: null as number | null,
        organic_reach: null as number | null,
        paid_reach: null as number | null,
        organic_views: null as number | null,
        paid_views: null as number | null,
        unsupported_metrics: [] as string[],
      };

      if (!includeInsights) return base;

      try {
        const ins = await fetchMediaInsightsWithFallback(
          item.id,
          input.access_token
        );
        if (ins.paid_vs_organic_available) paidVsOrganic = true;
        return {
          ...base,
          ...ins.insights,
          likes: ins.insights.likes ?? base.likes,
          comments: ins.insights.comments ?? base.comments,
          unsupported_metrics: ins.unsupported_metrics,
        };
      } catch {
        return base;
      }
    })
  );

  reels.sort((a, b) => {
    const ta = a.timestamp ? Date.parse(a.timestamp) : 0;
    const tb = b.timestamp ? Date.parse(b.timestamp) : 0;
    return tb - ta;
  });

  return {
    account: {
      id: input.account?.id ?? input.instagram_account_id,
      username: input.account?.username,
    },
    period: { since: input.since, until: input.until },
    paid_vs_organic_available: paidVsOrganic,
    organic_classification_confidence: paidVsOrganic ? "supported" : "limited",
    reels,
  };
}

export async function getInstagramReelPromotionStatus(input: {
  media_id: string;
  access_token: string;
}): Promise<{
  media_id: string;
  is_promoted: boolean | null;
  promotion_data_available: boolean;
  ad_ids: string[];
  campaign_ids: string[];
}> {
  const mediaId = input.media_id.trim();
  const adIds = new Set<string>();
  const campaignIds = new Set<string>();

  try {
    const accounts = await graphRequest<{
      data?: Array<{ id: string; account_id?: string }>;
    }>({
      path: "me/adaccounts",
      accessToken: input.access_token,
      params: { fields: "id,account_id", limit: 50 },
    });

    for (const act of accounts.data ?? []) {
      const actId = act.id?.startsWith("act_")
        ? act.id
        : `act_${act.account_id ?? act.id}`;
      try {
        const ads = await graphRequest<{
          data?: Array<{
            id?: string;
            campaign_id?: string;
            creative?: {
              effective_instagram_media_id?: string;
              instagram_permalink_url?: string;
              object_story_spec?: { link_data?: { link?: string } };
            };
          }>;
        }>({
          path: `${actId}/ads`,
          accessToken: input.access_token,
          params: {
            fields:
              "id,campaign_id,creative{effective_instagram_media_id,instagram_permalink_url}",
            limit: 100,
            filtering: JSON.stringify([
              {
                field: "effective_status",
                operator: "IN",
                value: ["ACTIVE", "PAUSED", "ARCHIVED"],
              },
            ]),
          },
        });

        for (const ad of ads.data ?? []) {
          const creativeMediaId =
            ad.creative?.effective_instagram_media_id ?? "";
          if (creativeMediaId === mediaId) {
            if (ad.id) adIds.add(ad.id);
            if (ad.campaign_id) campaignIds.add(ad.campaign_id);
          }
        }
      } catch {
        /* skip inaccessible ad account */
      }
    }

    if (adIds.size > 0) {
      return {
        media_id: mediaId,
        is_promoted: true,
        promotion_data_available: true,
        ad_ids: [...adIds],
        campaign_ids: [...campaignIds],
      };
    }

    return {
      media_id: mediaId,
      is_promoted: false,
      promotion_data_available: true,
      ad_ids: [],
      campaign_ids: [],
    };
  } catch {
    return {
      media_id: mediaId,
      is_promoted: null,
      promotion_data_available: false,
      ad_ids: [],
      campaign_ids: [],
    };
  }
}

export type ReelClassification =
  | "ORGANIC_WINNER"
  | "GOOD_PROMOTION_CANDIDATE"
  | "PAID_DEPENDENT"
  | "WEAK_CONTENT"
  | "FOLLOWER_MAGNET"
  | "VIRAL_BUT_LOW_CONVERSION"
  | "INSUFFICIENT_DATA";

export interface AnalyzedReel {
  id: string;
  permalink?: string;
  timestamp?: string;
  caption?: string;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  follows: number | null;
  profile_activity: number | null;
  engagement_rate: number | null;
  share_rate: number | null;
  save_rate: number | null;
  follow_rate: number | null;
  profile_conversion_rate: number | null;
  view_to_reach_ratio: number | null;
  watch_time_per_view: number | null;
  average_watch_percentage: number | null;
  organic_strength_score: number | null;
  classification: ReelClassification;
  classification_reasons: string[];
  reach_percentile: number | null;
  engagement_rate_percentile: number | null;
  share_rate_percentile: number | null;
  save_rate_percentile: number | null;
  follow_rate_percentile: number | null;
  is_promoted: boolean | null;
  promotion_data_available: boolean;
  paid_vs_organic_available: boolean;
  organic_classification_confidence: "limited" | "supported";
}

export function classifyReel(input: {
  reach: number | null;
  views: number | null;
  engagement_rate: number | null;
  share_rate: number | null;
  save_rate: number | null;
  follow_rate: number | null;
  profile_conversion_rate: number | null;
  view_to_reach_ratio: number | null;
  reach_percentile: number | null;
  engagement_percentile: number | null;
  share_percentile: number | null;
  save_percentile: number | null;
  follow_percentile: number | null;
  is_promoted: boolean | null;
  paid_reach: number | null;
  organic_reach: number | null;
  paid_vs_organic_available: boolean;
  has_minimum_metrics: boolean;
}): { classification: ReelClassification; reasons: string[] } {
  const reasons: string[] = [];

  if (!input.has_minimum_metrics) {
    return {
      classification: "INSUFFICIENT_DATA",
      reasons: ["Critical metrics (reach or views) unavailable from Meta insights"],
    };
  }

  if (
    input.paid_vs_organic_available &&
    input.paid_reach !== null &&
    input.organic_reach !== null &&
    input.paid_reach > input.organic_reach
  ) {
    reasons.push("Paid reach exceeds organic reach per Meta breakdown");
    return { classification: "PAID_DEPENDENT", reasons };
  }

  if (input.is_promoted === true) {
    reasons.push("Reel is linked to at least one Meta ad");
  }

  const reachPct = input.reach_percentile ?? 0;
  const engPct = input.engagement_percentile ?? 0;
  const sharePct = input.share_percentile ?? 0;
  const savePct = input.save_percentile ?? 0;
  const followPct = input.follow_percentile ?? 0;

  if (followPct >= 85) {
    reasons.push(`Follow rate is in the ${Math.round(followPct)}th percentile`);
    return { classification: "FOLLOWER_MAGNET", reasons };
  }

  if (reachPct >= 75 && (sharePct < 40 && savePct < 40)) {
    reasons.push(`Reach is in the ${Math.round(reachPct)}th percentile`);
    reasons.push("Share and save rates are below median");
    return { classification: "VIRAL_BUT_LOW_CONVERSION", reasons };
  }

  if (reachPct >= 75 && sharePct >= 60 && savePct >= 50 && followPct >= 50) {
    reasons.push(`Reach is in the ${Math.round(reachPct)}th percentile`);
    reasons.push(`Share rate is in the ${Math.round(sharePct)}th percentile`);
    reasons.push(`Save rate is in the ${Math.round(savePct)}th percentile`);
    if (followPct >= 50) {
      reasons.push("Follow rate is above account median");
    }
    return { classification: "ORGANIC_WINNER", reasons };
  }

  if (engPct >= 50 && (sharePct >= 50 || savePct >= 50) && reachPct < 75) {
    reasons.push(`Engagement rate is in the ${Math.round(engPct)}th percentile`);
    if (sharePct >= 50) {
      reasons.push(`Share rate is in the ${Math.round(sharePct)}th percentile`);
    }
    if (savePct >= 50) {
      reasons.push(`Save rate is in the ${Math.round(savePct)}th percentile`);
    }
    reasons.push(`Reach is only in the ${Math.round(reachPct)}th percentile`);
    return { classification: "GOOD_PROMOTION_CANDIDATE", reasons };
  }

  if (reachPct < 50 && engPct < 50 && sharePct < 50 && savePct < 50) {
    reasons.push("Reach below account median");
    reasons.push("Engagement below account median");
    reasons.push("Weak shares and saves relative to account");
    return { classification: "WEAK_CONTENT", reasons };
  }

  reasons.push("Mixed performance relative to account benchmarks");
  return { classification: "GOOD_PROMOTION_CANDIDATE", reasons };
}

export function computeOrganicStrengthScore(percentiles: {
  reach: number | null;
  engagement: number | null;
  share: number | null;
  save: number | null;
  follow: number | null;
}): number | null {
  const vals = [
    percentiles.reach,
    percentiles.engagement,
    percentiles.share,
    percentiles.save,
    percentiles.follow,
  ].filter((v): v is number => v !== null);
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export async function analyzeInstagramReelOrganicPerformance(input: {
  instagram_account_id: string;
  access_token: string;
  since?: string;
  until?: string;
  limit?: number;
  minimum_reels?: number;
  account?: InstagramAccount;
}): Promise<{
  account: { id: string; username?: string };
  period: { since?: string; until?: string };
  paid_vs_organic_available: boolean;
  organic_classification_confidence: "limited" | "supported";
  reels: AnalyzedReel[];
  summary: {
    reels_analyzed: number;
    median_views: number | null;
    median_reach: number | null;
    median_engagement_rate: number | null;
    median_share_rate: number | null;
    median_save_rate: number | null;
    median_follow_rate: number | null;
    top_reels: string[];
    bottom_reels: string[];
  };
}> {
  const analytics = await getInstagramReelAnalytics({
    ...input,
    include_insights: true,
  });

  const minimumReels = input.minimum_reels ?? 5;

  const derived = analytics.reels.map((reel) => {
    const reach = reel.reach;
    const views = reel.views;
    const likes = reel.likes ?? 0;
    const comments = reel.comments ?? 0;
    const shares = reel.shares ?? 0;
    const saves = reel.saves ?? 0;
    const follows = reel.follows ?? 0;

    const engagement_rate = safeDivide(
      (likes ?? 0) + (comments ?? 0) + (shares ?? 0) + (saves ?? 0),
      reach
    );
    const share_rate = safeDivide(shares, reach);
    const save_rate = safeDivide(saves, reach);
    const follow_rate = safeDivide(follows, reach);
    const profile_conversion_rate = safeDivide(
      follows,
      reel.profile_activity
    );
    const view_to_reach_ratio = safeDivide(views, reach);
    const watch_time_per_view = safeDivide(
      reel.total_watch_time_ms,
      views
    );

    return {
      reel,
      engagement_rate,
      share_rate,
      save_rate,
      follow_rate,
      profile_conversion_rate,
      view_to_reach_ratio,
      watch_time_per_view,
      has_minimum_metrics: reach !== null || views !== null,
    };
  });

  const reachValues = derived.map((d) => d.reel.reach).filter((v): v is number => v !== null);
  const viewValues = derived.map((d) => d.reel.views).filter((v): v is number => v !== null);
  const engValues = derived.map((d) => d.engagement_rate).filter((v): v is number => v !== null);
  const shareValues = derived.map((d) => d.share_rate).filter((v): v is number => v !== null);
  const saveValues = derived.map((d) => d.save_rate).filter((v): v is number => v !== null);
  const followValues = derived.map((d) => d.follow_rate).filter((v): v is number => v !== null);

  const insufficientPool = derived.length < minimumReels;

  const analyzed: AnalyzedReel[] = [];

  for (const d of derived) {
    const reachPct = percentileRank(d.reel.reach, reachValues);
    const engPct = percentileRank(d.engagement_rate, engValues);
    const sharePct = percentileRank(d.share_rate, shareValues);
    const savePct = percentileRank(d.save_rate, saveValues);
    const followPct = percentileRank(d.follow_rate, followValues);

    const promotion = await getInstagramReelPromotionStatus({
      media_id: d.reel.id,
      access_token: input.access_token,
    });

    const { classification, reasons } = classifyReel({
      reach: d.reel.reach,
      views: d.reel.views,
      engagement_rate: d.engagement_rate,
      share_rate: d.share_rate,
      save_rate: d.save_rate,
      follow_rate: d.follow_rate,
      profile_conversion_rate: d.profile_conversion_rate,
      view_to_reach_ratio: d.view_to_reach_ratio,
      reach_percentile: reachPct,
      engagement_percentile: engPct,
      share_percentile: sharePct,
      save_percentile: savePct,
      follow_percentile: followPct,
      is_promoted: promotion.is_promoted,
      paid_reach: d.reel.paid_reach,
      organic_reach: d.reel.organic_reach,
      paid_vs_organic_available: analytics.paid_vs_organic_available,
      has_minimum_metrics: d.has_minimum_metrics,
    });

    const organic_strength_score = computeOrganicStrengthScore({
      reach: reachPct,
      engagement: engPct,
      share: sharePct,
      save: savePct,
      follow: followPct,
    });

    analyzed.push({
      id: d.reel.id,
      permalink: d.reel.permalink,
      timestamp: d.reel.timestamp,
      caption: d.reel.caption,
      views: d.reel.views,
      reach: d.reel.reach,
      likes: d.reel.likes,
      comments: d.reel.comments,
      shares: d.reel.shares,
      saves: d.reel.saves,
      follows: d.reel.follows,
      profile_activity: d.reel.profile_activity,
      engagement_rate: d.engagement_rate,
      share_rate: d.share_rate,
      save_rate: d.save_rate,
      follow_rate: d.follow_rate,
      profile_conversion_rate: d.profile_conversion_rate,
      view_to_reach_ratio: d.view_to_reach_ratio,
      watch_time_per_view: d.watch_time_per_view,
      average_watch_percentage: null,
      organic_strength_score,
      classification:
        insufficientPool || !d.has_minimum_metrics
          ? "INSUFFICIENT_DATA"
          : classification,
      classification_reasons:
        insufficientPool
          ? [
              ...reasons,
              `Fewer than minimum_reels (${minimumReels}) in period — rankings may be unreliable`,
            ]
          : !d.has_minimum_metrics
            ? [
                ...reasons,
                "Critical metrics unavailable from Meta insights",
              ]
            : reasons,
      reach_percentile: reachPct,
      engagement_rate_percentile: engPct,
      share_rate_percentile: sharePct,
      save_rate_percentile: savePct,
      follow_rate_percentile: followPct,
      is_promoted: promotion.is_promoted,
      promotion_data_available: promotion.promotion_data_available,
      paid_vs_organic_available: analytics.paid_vs_organic_available,
      organic_classification_confidence:
        analytics.organic_classification_confidence,
    });
  }

  analyzed.sort((a, b) => {
    const ta = a.timestamp ? Date.parse(a.timestamp) : 0;
    const tb = b.timestamp ? Date.parse(b.timestamp) : 0;
    return tb - ta;
  });

  const byScore = [...analyzed].sort(
    (a, b) => (b.organic_strength_score ?? 0) - (a.organic_strength_score ?? 0)
  );

  return {
    account: analytics.account,
    period: analytics.period,
    paid_vs_organic_available: analytics.paid_vs_organic_available,
    organic_classification_confidence:
      analytics.organic_classification_confidence,
    reels: analyzed,
    summary: {
      reels_analyzed: analyzed.length,
      median_views: median(viewValues),
      median_reach: median(reachValues),
      median_engagement_rate: median(engValues),
      median_share_rate: median(shareValues),
      median_save_rate: median(saveValues),
      median_follow_rate: median(followValues),
      top_reels: byScore.slice(0, 3).map((r) => r.id),
      bottom_reels: byScore.slice(-3).map((r) => r.id),
    },
  };
}

export const instagramReelsToolDefinitions = [
  {
    name: "meta_get_instagram_account",
    description:
      "Resolve Instagram Business/Creator account linked to a Facebook Page (read-only).",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "Facebook Page ID" },
        fields: {
          type: "string",
          description:
            "Default: id,username,name,followers_count,media_count",
        },
        page_access_token: {
          type: "string",
          description: "Optional page token (never returned in output)",
        },
      },
      required: ["page_id"],
    },
  },
  {
    name: "meta_list_instagram_media",
    description:
      "List Instagram media for a Business account with Reel filtering (read-only). Reels: media_product_type=REELS.",
    inputSchema: {
      type: "object",
      properties: {
        instagram_account_id: { type: "string" },
        page_id: {
          type: "string",
          description: "Optional — used to resolve page access token",
        },
        since: { type: "string", description: "YYYY-MM-DD" },
        until: { type: "string", description: "YYYY-MM-DD" },
        media_type: {
          type: "string",
          enum: ["ALL", "REELS", "IMAGE", "VIDEO", "CAROUSEL"],
          description: "Default ALL. REELS uses media_product_type=REELS.",
        },
        limit: { type: "number", description: "Default 50" },
        after: { type: "string", description: "Pagination cursor" },
        page_access_token: { type: "string" },
      },
      required: ["instagram_account_id"],
    },
  },
  {
    name: "meta_get_instagram_media_insights",
    description:
      "Get Instagram media/Reel insights with metric fallback for unsupported metrics (read-only).",
    inputSchema: {
      type: "object",
      properties: {
        media_id: { type: "string" },
        metrics: {
          type: "string",
          description: "Comma-separated metrics (optional)",
        },
        page_id: { type: "string", description: "For token resolution" },
        page_access_token: { type: "string" },
      },
      required: ["media_id"],
    },
  },
  {
    name: "meta_get_instagram_reel_analytics",
    description:
      "Fetch Reels for an IG account with insights in one call (read-only).",
    inputSchema: {
      type: "object",
      properties: {
        instagram_account_id: { type: "string" },
        page_id: { type: "string" },
        since: { type: "string", description: "YYYY-MM-DD" },
        until: { type: "string", description: "YYYY-MM-DD" },
        limit: { type: "number", description: "Default 50" },
        include_insights: { type: "boolean", description: "Default true" },
        page_access_token: { type: "string" },
      },
      required: ["instagram_account_id"],
    },
  },
  {
    name: "meta_get_instagram_reel_promotion_status",
    description:
      "Check if a Reel is linked to Meta ads (read-only). Returns null when promotion cannot be determined.",
    inputSchema: {
      type: "object",
      properties: {
        media_id: { type: "string" },
        page_access_token: { type: "string" },
      },
      required: ["media_id"],
    },
  },
  {
    name: "meta_analyze_instagram_reel_organic_performance",
    description:
      "Analyze Reel organic performance with derived rates, account-relative percentiles, and deterministic classifications (read-only, no LLM).",
    inputSchema: {
      type: "object",
      properties: {
        instagram_account_id: { type: "string" },
        page_id: { type: "string" },
        since: { type: "string", description: "YYYY-MM-DD" },
        until: { type: "string", description: "YYYY-MM-DD" },
        limit: { type: "number", description: "Default 50" },
        minimum_reels: {
          type: "number",
          description: "Minimum reels for reliable ranking (default 5)",
        },
        page_access_token: { type: "string" },
      },
      required: ["instagram_account_id"],
    },
  },
] as const;

async function resolveIgAccountId(
  args: Record<string, unknown>,
  userToken: string,
  accessToken: string
): Promise<InstagramAccount | null> {
  if (args.instagram_account_id) {
    const id = String(args.instagram_account_id).trim();
    try {
      const account = await graphRequest<InstagramAccount>({
        path: id,
        accessToken,
        params: { fields: "id,username,name,followers_count,media_count" },
      });
      return account;
    } catch {
      return { id };
    }
  }
  if (args.page_id) {
    const result = await getInstagramAccount({
      page_id: String(args.page_id),
      access_token: accessToken,
    });
    return result.instagram_account;
  }
  return null;
}

export async function handleInstagramReelsTool(
  name: string,
  args: Record<string, unknown>,
  userToken: string
): Promise<unknown | null> {
  if (!isInstagramReelsTool(name)) return null;

  const accessToken = await resolveInstagramAccessToken(userToken, {
    page_id: args.page_id as string | undefined,
    page_access_token: args.page_access_token as string | undefined,
    instagram_account_id: args.instagram_account_id as string | undefined,
  });

  switch (name) {
    case "meta_get_instagram_account": {
      if (!args.page_id) {
        throw new Error("page_id is required.");
      }
      return getInstagramAccount({
        page_id: String(args.page_id),
        fields: args.fields as string | undefined,
        access_token: accessToken,
      });
    }
    case "meta_list_instagram_media": {
      if (!args.instagram_account_id) {
        throw new Error("instagram_account_id is required.");
      }
      return listInstagramMedia({
        instagram_account_id: String(args.instagram_account_id),
        access_token: accessToken,
        since: args.since as string | undefined,
        until: args.until as string | undefined,
        media_type: (args.media_type as MediaTypeFilter) ?? "ALL",
        limit: args.limit as number | undefined,
        after: args.after as string | undefined,
      });
    }
    case "meta_get_instagram_media_insights": {
      return getInstagramMediaInsights({
        media_id: String(args.media_id),
        access_token: accessToken,
        metrics: args.metrics as string | undefined,
      });
    }
    case "meta_get_instagram_reel_analytics": {
      const account = await resolveIgAccountId(args, userToken, accessToken);
      return getInstagramReelAnalytics({
        instagram_account_id: String(args.instagram_account_id),
        access_token: accessToken,
        since: args.since as string | undefined,
        until: args.until as string | undefined,
        limit: args.limit as number | undefined,
        include_insights: args.include_insights !== false,
        account: account ?? undefined,
      });
    }
    case "meta_get_instagram_reel_promotion_status": {
      return getInstagramReelPromotionStatus({
        media_id: String(args.media_id),
        access_token: accessToken,
      });
    }
    case "meta_analyze_instagram_reel_organic_performance": {
      const account = await resolveIgAccountId(args, userToken, accessToken);
      return analyzeInstagramReelOrganicPerformance({
        instagram_account_id: String(args.instagram_account_id),
        access_token: accessToken,
        since: args.since as string | undefined,
        until: args.until as string | undefined,
        limit: args.limit as number | undefined,
        minimum_reels: args.minimum_reels as number | undefined,
        account: account ?? undefined,
      });
    }
    default:
      return null;
  }
}
