import type { EnrichedRow } from "./transform.js";

function fmtNum(v: unknown, decimals = 2): string {
  if (v == null || v === "") return "";
  const f = Number(v);
  if (Number.isNaN(f)) return String(v);
  return decimals === 0 ? String(Math.round(f)) : f.toFixed(decimals);
}

function rowCampaign(r: EnrichedRow): string[] {
  return [
    String(r.campaign_name ?? r.campaign_id ?? ""),
    String(r.publisher_platform ?? ""),
    fmtNum(r.spend_num),
    fmtNum(r.impressions, 0),
    fmtNum(r.clicks, 0),
    fmtNum(r.ctr_pct),
    fmtNum(r.leads, 0),
    fmtNum(r.cpr),
  ];
}

function rowAdset(r: EnrichedRow): string[] {
  return [
    String(r.adset_name ?? r.adset_id ?? ""),
    String(r.campaign_name ?? ""),
    fmtNum(r.spend_num),
    fmtNum(r.impressions, 0),
    fmtNum(r.clicks, 0),
    fmtNum(r.ctr_pct),
    fmtNum(r.leads, 0),
    fmtNum(r.cpr),
  ];
}

function rowAd(r: EnrichedRow): string[] {
  return [
    String(r.ad_name ?? r.ad_id ?? ""),
    String(r.adset_name ?? ""),
    fmtNum(r.spend_num),
    fmtNum(r.impressions, 0),
    fmtNum(r.clicks, 0),
    fmtNum(r.ctr_pct),
    fmtNum(r.leads, 0),
    fmtNum(r.cpr),
  ];
}

export function tableMarkdown(
  title: string,
  headers: string[],
  rows: string[][]
): string {
  if (!rows.length) {
    return `### ${title}\n\n_No rows (spend filter or no delivery)._\n`;
  }
  const lines = [
    `### ${title}`,
    "",
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    "",
  ];
  return lines.join("\n");
}

export function accountSection(
  accountName: string,
  data: {
    campaign: EnrichedRow[];
    adset: EnrichedRow[];
    ad: EnrichedRow[];
  }
): string {
  const parts = [`## ${accountName}`, ""];
  parts.push(
    tableMarkdown(
      "Campaign (by platform)",
      ["Campaign", "Platform", "Spend", "Impr.", "Clicks", "CTR %", "Leads", "CPR"],
      data.campaign.map(rowCampaign)
    )
  );
  parts.push(
    tableMarkdown(
      "Ad set",
      ["Ad set", "Campaign", "Spend", "Impr.", "Clicks", "CTR %", "Leads", "CPR"],
      data.adset.map(rowAdset)
    )
  );
  parts.push(
    tableMarkdown(
      "Ad",
      ["Ad", "Ad set", "Spend", "Impr.", "Clicks", "CTR %", "Leads", "CPR"],
      data.ad.map(rowAd)
    )
  );
  return parts.join("\n");
}

export function combinedSheetMarkdown(
  weekLabel: string,
  sections: Array<[string, { campaign: EnrichedRow[]; adset: EnrichedRow[]; ad: EnrichedRow[] }]>
): string {
  const blocks = [`# Meta weekly report — ${weekLabel}`, ""];
  for (const [name, data] of sections) {
    blocks.push(accountSection(name, data));
    blocks.push("");
  }
  return `${blocks.join("\n").trim()}\n`;
}

export function markdownToSheetRows(markdown: string): string[][] {
  const rows: string[][] = [];
  for (const line of markdown.split("\n")) {
    const stripped = line.trim();
    if (!stripped) {
      rows.push([""]);
      continue;
    }
    if (stripped.startsWith("#")) {
      rows.push([stripped.replace(/^#+\s*/, "")]);
      continue;
    }
    if (stripped.startsWith("|") && !stripped.includes("---")) {
      rows.push(
        stripped
          .slice(1, -1)
          .split("|")
          .map((c) => c.trim())
      );
    } else if (!stripped.startsWith("|")) {
      rows.push([stripped]);
    }
  }
  return rows;
}
