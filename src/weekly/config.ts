import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AccountConfig {
  client_slug: string;
  ad_account_id: string;
  name: string;
}

export interface WeeklyConfig {
  spreadsheet_id: string;
  min_spend_inr: number;
  default_date_preset: string;
  accounts: AccountConfig[];
  configPath: string;
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

export function resolveWeeklyConfigPath(explicit?: string): string {
  if (explicit?.trim()) return path.resolve(explicit);
  const fromEnv = process.env.META_WEEKLY_CONFIG_PATH?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(repoRoot, "config", "meta-weekly-reporting.json");
}

export function loadWeeklyConfig(configPath?: string): WeeklyConfig {
  const resolved = resolveWeeklyConfigPath(configPath);
  const raw = JSON.parse(fs.readFileSync(resolved, "utf-8")) as {
    spreadsheet_id: string;
    min_spend_inr?: number;
    default_date_preset?: string;
    accounts: Array<{
      client_slug: string;
      ad_account_id: string;
      name?: string;
    }>;
  };

  return {
    spreadsheet_id: raw.spreadsheet_id,
    min_spend_inr: raw.min_spend_inr ?? 1,
    default_date_preset: raw.default_date_preset ?? "last_7d",
    accounts: (raw.accounts ?? []).map((a) => ({
      client_slug: a.client_slug,
      ad_account_id: String(a.ad_account_id).replace(/^act_/, ""),
      name: a.name ?? a.client_slug,
    })),
    configPath: resolved,
  };
}

export function repoRootFromConfig(configPath: string): string {
  return path.resolve(path.dirname(configPath), "..");
}

/** MCP / HTTP override: pass accounts in the tool call instead of config file. */
export function normalizeAccountInputs(raw: unknown): AccountConfig[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("accounts must be a non-empty array when provided");
  }
  return raw.map((item, i) => {
    if (!item || typeof item !== "object") {
      throw new Error(`accounts[${i}]: expected object`);
    }
    const o = item as Record<string, unknown>;
    const id = String(o.ad_account_id ?? "")
      .replace(/^act_/, "")
      .trim();
    if (!id) {
      throw new Error(`accounts[${i}]: ad_account_id is required`);
    }
    const slug = String(o.client_slug ?? `account-${id}`).trim();
    const name = String(o.name ?? slug).trim();
    return { ad_account_id: id, client_slug: slug, name };
  });
}
