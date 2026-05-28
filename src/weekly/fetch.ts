import { graphRequest, requireEnvToken } from "../meta-api.js";

const INSIGHT_FIELDS =
  "impressions,clicks,spend,ctr,cpc,reach,frequency,actions,action_values," +
  "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name";

export type InsightRow = Record<string, unknown> & {
  actions?: Array<{ action_type?: string; value?: string }>;
  publisher_platform?: string;
};

interface PagedResponse {
  data?: InsightRow[];
  paging?: { next?: string };
  error?: { message?: string };
}

function normalizeActId(id: string): string {
  const t = id.trim();
  return t.startsWith("act_") ? t : `act_${t}`;
}

async function fetchPage(url: string): Promise<PagedResponse> {
  const res = await fetch(url);
  return (await res.json()) as PagedResponse;
}

export async function graphPaginate(
  path: string,
  params: Record<string, string | number | undefined>,
  token?: string
): Promise<InsightRow[]> {
  const accessToken = token ?? requireEnvToken();
  const first = await graphRequest<PagedResponse>({
    path,
    accessToken,
    params: { ...params, limit: 500 },
  });

  const rows: InsightRow[] = [...(first.data ?? [])];
  let next = first.paging?.next;
  while (next) {
    const page = await fetchPage(next);
    if (page.error) {
      throw new Error(page.error.message ?? "Graph pagination error");
    }
    rows.push(...(page.data ?? []));
    next = page.paging?.next;
  }
  return rows;
}

export async function fetchAccountInsights(
  adAccountId: string,
  opts: {
    since?: string;
    until?: string;
    datePreset?: string;
    token?: string;
  } = {}
): Promise<{
  campaign: InsightRow[];
  adset: InsightRow[];
  ad: InsightRow[];
}> {
  const act = normalizeActId(adAccountId);
  const token = opts.token ?? requireEnvToken();
  const timeParams: Record<string, string> = {};
  if (opts.since && opts.until) {
    timeParams.time_range = JSON.stringify({
      since: opts.since,
      until: opts.until,
    });
  } else if (opts.datePreset) {
    timeParams.date_preset = opts.datePreset;
  } else {
    timeParams.date_preset = "last_7d";
  }

  const base = { fields: INSIGHT_FIELDS, ...timeParams };

  const [campaign, adset, ad] = await Promise.all([
    graphPaginate(`${act}/insights`, { ...base, level: "campaign", breakdowns: "publisher_platform" }, token),
    graphPaginate(`${act}/insights`, { ...base, level: "adset" }, token),
    graphPaginate(`${act}/insights`, { ...base, level: "ad" }, token),
  ]);

  return { campaign, adset, ad };
}
