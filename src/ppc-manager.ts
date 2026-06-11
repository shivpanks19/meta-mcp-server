export interface InsightAction {
  action_type?: string;
  value?: string | number;
}

export interface InsightRow {
  id?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  creative_id?: string;
  creative_name?: string;
  impressions?: string | number;
  reach?: string | number;
  clicks?: string | number;
  spend?: string | number;
  ctr?: string | number;
  cpm?: string | number;
  cpc?: string | number;
  frequency?: string | number;
  actions?: InsightAction[];
  cost_per_action_type?: InsightAction[];
  [key: string]: unknown;
}

export interface PerformanceRow extends InsightRow {
  spend_num: number;
  impressions_num: number;
  clicks_num: number;
  ctr_num: number;
  cpm_num: number;
  frequency_num: number;
  conversions: number;
  cpa: number | null;
}

export interface Recommendation {
  priority: "high" | "medium" | "low";
  entity_id?: string;
  entity_name?: string;
  issue: string;
  recommendation: string;
  tool_to_apply?: string;
  tool_arguments?: Record<string, unknown>;
}

const CONVERSION_ACTION_PATTERNS = [
  "lead",
  "purchase",
  "complete_registration",
  "submit_application",
  "schedule",
  "contact",
  "subscribe",
  "start_trial",
];

export function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function extractConversions(actions: InsightAction[] | undefined): number {
  if (!actions?.length) return 0;
  let total = 0;
  for (const action of actions) {
    const type = String(action.action_type ?? "").toLowerCase();
    if (CONVERSION_ACTION_PATTERNS.some((pattern) => type.includes(pattern))) {
      total += toNumber(action.value);
    }
  }
  return total;
}

export function enrichPerformanceRows(rows: InsightRow[]): PerformanceRow[] {
  return rows.map((row) => {
    const spend = toNumber(row.spend);
    const impressions = toNumber(row.impressions);
    const clicks = toNumber(row.clicks);
    const conversions = extractConversions(row.actions);
    const ctr = row.ctr === undefined ? (impressions ? (clicks / impressions) * 100 : 0) : toNumber(row.ctr);
    const cpm = row.cpm === undefined ? (impressions ? (spend / impressions) * 1000 : 0) : toNumber(row.cpm);
    return {
      ...row,
      spend_num: spend,
      impressions_num: impressions,
      clicks_num: clicks,
      ctr_num: ctr,
      cpm_num: cpm,
      frequency_num: toNumber(row.frequency),
      conversions,
      cpa: conversions > 0 ? spend / conversions : null,
    };
  });
}

export function summarizePerformance(rows: PerformanceRow[]): Record<string, unknown> {
  const spend = rows.reduce((sum, row) => sum + row.spend_num, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions_num, 0);
  const clicks = rows.reduce((sum, row) => sum + row.clicks_num, 0);
  const conversions = rows.reduce((sum, row) => sum + row.conversions, 0);
  return {
    row_count: rows.length,
    spend,
    impressions,
    clicks,
    conversions,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : null,
    cpa: conversions > 0 ? spend / conversions : null,
  };
}

export function buildFatigueRecommendations(
  rows: PerformanceRow[],
  scope: "audience" | "creative"
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  for (const row of rows) {
    const entityId = scope === "creative" ? String(row.ad_id ?? row.id ?? "") : String(row.adset_id ?? row.id ?? "");
    const entityName = scope === "creative" ? String(row.ad_name ?? row.name ?? entityId) : String(row.adset_name ?? row.name ?? entityId);
    const highFrequency = row.frequency_num >= 3.5;
    const weakCtr = row.ctr_num > 0 && row.ctr_num < 0.8;
    const highCpm = row.cpm_num >= 500;
    const noConversions = row.spend_num > 0 && row.conversions === 0;
    const expensiveConversions = row.cpa !== null && row.spend_num >= 1000 && row.cpa > 1000;

    if (highFrequency && (weakCtr || highCpm || noConversions || expensiveConversions)) {
      recommendations.push({
        priority: highFrequency && noConversions ? "high" : "medium",
        entity_id: entityId || undefined,
        entity_name: entityName || undefined,
        issue: `${scope} fatigue signal: frequency ${row.frequency_num.toFixed(2)}, CTR ${row.ctr_num.toFixed(2)}%, CPM ${row.cpm_num.toFixed(2)}, conversions ${row.conversions}.`,
        recommendation:
          scope === "creative"
            ? "Refresh the ad creative, test a new hook/format, and pause only after comparing against peer ads."
            : "Expand or refresh the audience, add exclusions for saturated segments, and reduce budget only after checking delivery constraints.",
        tool_to_apply: scope === "creative" ? "update_meta_ad_status" : "update_meta_adset_budget",
        tool_arguments:
          scope === "creative" && entityId
            ? { ad_id: entityId, status: "PAUSED", validate_only: true }
            : entityId
              ? { adset_id: entityId, daily_budget: Math.max(100, Math.round(row.spend_num * 0.7)), validate_only: true }
              : undefined,
      });
    }
  }
  return recommendations;
}

export function buildBudgetRecommendations(rows: PerformanceRow[]): Recommendation[] {
  const active = rows.filter((row) => row.spend_num > 0);
  if (active.length < 2) return [];

  const withConversions = active.filter((row) => row.conversions > 0 && row.cpa !== null);
  if (!withConversions.length) {
    return active
      .filter((row) => row.spend_num >= 500)
      .map((row) => ({
        priority: "medium" as const,
        entity_id: String(row.adset_id ?? row.id ?? ""),
        entity_name: String(row.adset_name ?? row.name ?? row.adset_id ?? row.id ?? ""),
        issue: "Spend is accruing without tracked conversion volume.",
        recommendation: "Hold scale decisions and inspect conversion tracking, audience fit, and creative-message match.",
        tool_to_apply: "get_meta_conversion_tracking_status",
      }));
  }

  const sorted = [...withConversions].sort((a, b) => (a.cpa ?? Infinity) - (b.cpa ?? Infinity));
  const best = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.25)));
  const worst = sorted.slice(-Math.max(1, Math.ceil(sorted.length * 0.25)));
  const bestCpa = best.reduce((sum, row) => sum + (row.cpa ?? 0), 0) / best.length;

  return worst
    .filter((row) => (row.cpa ?? 0) > bestCpa * 1.5)
    .map((row) => ({
      priority: "medium" as const,
      entity_id: String(row.adset_id ?? row.id ?? ""),
      entity_name: String(row.adset_name ?? row.name ?? row.adset_id ?? row.id ?? ""),
      issue: `CPA ${row.cpa?.toFixed(2)} is materially above the stronger ad set benchmark ${bestCpa.toFixed(2)}.`,
      recommendation: "Reallocate budget toward lower-CPA ad sets after confirming volume quality and learning phase status.",
      tool_to_apply: "update_meta_adset_budget",
      tool_arguments: {
        adset_id: String(row.adset_id ?? row.id ?? ""),
        daily_budget: Math.max(100, Math.round(row.spend_num * 0.75)),
        validate_only: true,
      },
    }));
}

export function buildDeliveryDiagnostics(rows: PerformanceRow[]): Recommendation[] {
  return rows.flatMap((row) => {
    const recs: Recommendation[] = [];
    const entityId = String(row.adset_id ?? row.id ?? "");
    if (row.spend_num === 0 && row.impressions_num === 0) {
      recs.push({
        priority: "high",
        entity_id: entityId || undefined,
        entity_name: String(row.adset_name ?? row.name ?? entityId),
        issue: "No spend or impressions in the selected date range.",
        recommendation: "Check status, bid strategy, audience size, schedule, billing, and policy review before changing budget.",
        tool_to_apply: "get_meta_adset_performance",
      });
    }
    if (row.impressions_num > 0 && row.clicks_num === 0) {
      recs.push({
        priority: "medium",
        entity_id: entityId || undefined,
        entity_name: String(row.adset_name ?? row.name ?? entityId),
        issue: "Delivery exists but no clicks were recorded.",
        recommendation: "Inspect placement quality and creative relevance before scaling.",
        tool_to_apply: "get_meta_breakdown_insights",
      });
    }
    return recs;
  });
}

export function summarizeBreakdowns(rows: PerformanceRow[], breakdownKeys: string[]): Record<string, unknown> {
  const diagnostics = rows.map((row) => ({
    segment: Object.fromEntries(breakdownKeys.map((key) => [key, row[key] ?? null])),
    spend: row.spend_num,
    impressions: row.impressions_num,
    clicks: row.clicks_num,
    ctr: row.ctr_num,
    cpm: row.cpm_num,
    conversions: row.conversions,
    cpa: row.cpa,
  }));
  const recommendations = rows
    .filter((row) => row.spend_num >= 500 && (row.conversions === 0 || (row.ctr_num > 0 && row.ctr_num < 0.5)))
    .map((row) => ({
      priority: "medium" as const,
      issue: `Weak segment: ${breakdownKeys.map((key) => `${key}=${String(row[key] ?? "unknown")}`).join(", ")}.`,
      recommendation: "Consider excluding or isolating this segment only after checking attribution delay and volume.",
      tool_to_apply: "meta_update_adset",
    }));
  return { diagnostics, recommendations };
}
