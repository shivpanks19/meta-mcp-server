import type { InsightRow } from "./fetch.js";

const LEAD_ACTION_TYPES = new Set([
  "lead",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
  "leadgen_grouped",
]);

export interface EnrichedRow extends InsightRow {
  spend_num: number;
  leads: number;
  cpr: number | null;
  ctr_pct: number;
}

export function extractLeads(
  actions: Array<{ action_type?: string; value?: string }> | undefined
): number {
  if (!actions?.length) return 0;
  let total = 0;
  for (const a of actions) {
    const at = (a.action_type ?? "").toLowerCase();
    if (LEAD_ACTION_TYPES.has(at) || at.includes("lead")) {
      total += Number(a.value ?? 0);
    }
  }
  return total;
}

function spend(row: InsightRow): number {
  return Number(row.spend ?? 0);
}

function ctr(row: InsightRow): number {
  if (row.ctr != null) return Number(row.ctr);
  const imp = Number(row.impressions ?? 0);
  const clk = Number(row.clicks ?? 0);
  return imp ? (clk / imp) * 100 : 0;
}

export function enrichRow(row: InsightRow): EnrichedRow {
  const spendNum = spend(row);
  const leads = extractLeads(row.actions as EnrichedRow["actions"]);
  return {
    ...row,
    spend_num: spendNum,
    leads,
    cpr: leads ? spendNum / leads : null,
    ctr_pct: ctr(row),
  };
}

export function filterRows(
  rows: InsightRow[],
  minSpendInr: number
): EnrichedRow[] {
  return rows.map(enrichRow).filter((r) => r.spend_num > minSpendInr);
}

export function transformBundle(
  bundle: { campaign: InsightRow[]; adset: InsightRow[]; ad: InsightRow[] },
  minSpendInr: number
): {
  campaign: EnrichedRow[];
  adset: EnrichedRow[];
  ad: EnrichedRow[];
} {
  return {
    campaign: filterRows(bundle.campaign, minSpendInr),
    adset: filterRows(bundle.adset, minSpendInr),
    ad: filterRows(bundle.ad, minSpendInr),
  };
}
