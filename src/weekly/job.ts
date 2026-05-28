import fs from "node:fs";
import path from "node:path";
import {
  type AccountConfig,
  loadWeeklyConfig,
  repoRootFromConfig,
} from "./config.js";
import { fetchAccountInsights } from "./fetch.js";
import { accountSection, combinedSheetMarkdown } from "./markdown.js";
import { writeMarkdownTab } from "./sheets.js";
import { transformBundle } from "./transform.js";

export interface WeeklyReportOptions {
  since?: string;
  until?: string;
  spreadsheetId?: string;
  /** When set, runs only these accounts (Cursor MCP call); else uses config file. */
  accounts?: AccountConfig[];
  minSpendInr?: number;
  writeClientReports?: boolean;
  clearTab?: boolean;
  skipSheets?: boolean;
  configPath?: string;
}

export interface AccountResult {
  ad_account_id: string;
  client_slug: string;
  name: string;
  campaign_rows: number;
  adset_rows: number;
  ad_rows: number;
  error?: string | null;
}

export interface WeeklyReportResult {
  status: string;
  week: string;
  spreadsheet_id: string;
  sheet_tab: string;
  sheet_url?: string | null;
  write_repo?: boolean;
  message?: string | null;
  accounts: AccountResult[];
}

function defaultWeekRange(): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until);
  since.setDate(since.getDate() - 7);
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
}

export function weekLabel(since: string, until: string): string {
  return `${since}_to_${until}`;
}

export async function runMetaWeeklyReport(
  options: WeeklyReportOptions = {}
): Promise<WeeklyReportResult> {
  const cfg = loadWeeklyConfig(options.configPath);
  let { since, until } = options;
  if (!since || !until) {
    const d = defaultWeekRange();
    since = d.since;
    until = d.until;
  }
  const week = weekLabel(since, until);
  const sheetId = options.spreadsheetId ?? cfg.spreadsheet_id;
  const minSpend = options.minSpendInr ?? cfg.min_spend_inr;
  const accountsToRun =
    options.accounts?.length ? options.accounts : cfg.accounts;
  const root = repoRootFromConfig(cfg.configPath);

  if (!accountsToRun.length) {
    throw new Error(
      "No accounts to run: pass accounts in the MCP call or add them to config/meta-weekly-reporting.json"
    );
  }

  const sections: Array<
    [string, ReturnType<typeof transformBundle>]
  > = [];
  const accountResults: AccountResult[] = [];

  for (const acct of accountsToRun) {
    try {
      const raw = await fetchAccountInsights(acct.ad_account_id, { since, until });
      const data = transformBundle(raw, minSpend);
      sections.push([acct.name, data]);
      accountResults.push({
        ad_account_id: acct.ad_account_id,
        client_slug: acct.client_slug,
        name: acct.name,
        campaign_rows: data.campaign.length,
        adset_rows: data.adset.length,
        ad_rows: data.ad.length,
      });

      if (options.writeClientReports) {
        const outDir = path.join(root, "clients", acct.client_slug, "reports");
        fs.mkdirSync(outDir, { recursive: true });
        const mdPath = path.join(outDir, `meta-weekly-${week}.md`);
        fs.writeFileSync(mdPath, accountSection(acct.name, data), "utf-8");
      }
    } catch (e) {
      accountResults.push({
        ad_account_id: acct.ad_account_id,
        client_slug: acct.client_slug,
        name: acct.name,
        campaign_rows: 0,
        adset_rows: 0,
        ad_rows: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const combined = combinedSheetMarkdown(week, sections);
  let sheetUrl: string | null = null;
  let status: "ok" | "partial" = "ok";
  let message: string | null = null;

  if (options.skipSheets) {
    message = "Sheets write skipped (skip_sheets=true)";
  } else {
    try {
      sheetUrl = await writeMarkdownTab(
        sheetId,
        week,
        combined,
        options.clearTab !== false
      );
    } catch (e) {
      status = "partial";
      message = `Sheet write failed: ${e instanceof Error ? e.message : e}`;
    }
  }

  if (accountResults.some((a) => a.error) && status === "ok") {
    status = "partial";
    message = message ?? "One or more accounts failed to fetch";
  }

  return {
    status,
    week,
    spreadsheet_id: sheetId,
    sheet_tab: week,
    sheet_url: sheetUrl,
    write_repo: options.writeClientReports ?? false,
    message,
    accounts: accountResults,
  };
}
