import fs from "node:fs";
import { JWT, OAuth2Client } from "google-auth-library";
import { google } from "googleapis";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export type GoogleAuthMode =
  | "service_account"
  | "oauth_refresh_token"
  | "oauth_credentials_file";

export interface GoogleAuthInfo {
  mode: GoogleAuthMode;
  /** Service account email when mode is service_account (share Sheet with this email). */
  clientEmail?: string;
}

function wantsServiceAccount(): boolean {
  const t = (
    process.env.GOOGLE_AUTH_TYPE ??
    process.env.GOOGLE_ADS_AUTH_TYPE ??
    process.env.GOOGLE_CREDENTIALS_TYPE ??
    ""
  )
    .trim()
    .toLowerCase();
  return t === "service_account" || t === "service-account";
}

function parseJsonCredentials(raw: string, label: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`${label}: credentials JSON is empty`);
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid JSON in ${label}`);
  }
}

function readCredentialsFile(path: string, label: string): Record<string, unknown> {
  if (!fs.existsSync(path)) {
    throw new Error(`${label}: file not found: ${path}`);
  }
  return parseJsonCredentials(fs.readFileSync(path, "utf-8"), label);
}

function isServiceAccount(creds: Record<string, unknown>): boolean {
  return creds.type === "service_account" && Boolean(creds.client_email);
}

function serviceAccountFromCreds(creds: Record<string, unknown>): JWT {
  if (!isServiceAccount(creds)) {
    throw new Error(
      "Expected service account JSON (type: service_account). " +
        "Your file looks like OAuth client credentials. Set GOOGLE_AUTH_TYPE=service_account " +
        "and point GOOGLE_SERVICE_ACCOUNT_PATH to the service account key JSON."
    );
  }
  return new JWT({
    email: String(creds.client_email),
    key: String(creds.private_key),
    scopes: [SHEETS_SCOPE],
  });
}

function loadServiceAccountCredentials(): Record<string, unknown> {
  // Same order as mcp-google-ads: JSON env first, then key file paths
  const jsonCandidates: Array<[string, string | undefined]> = [
    ["GOOGLE_ADS_CREDENTIALS_JSON", process.env.GOOGLE_ADS_CREDENTIALS_JSON?.trim()],
    ["GOOGLE_SERVICE_ACCOUNT_JSON", process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()],
  ];

  for (const [label, inline] of jsonCandidates) {
    if (!inline) continue;
    const creds = parseJsonCredentials(inline, label);
    if (!isServiceAccount(creds)) {
      throw new Error(
        `${label} must be a service account key ({"type": "service_account", ...})`
      );
    }
    return creds;
  }

  const pathKeys = [
    "GOOGLE_SERVICE_ACCOUNT_PATH",
    "GOOGLE_ADS_CREDENTIALS_PATH",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_SHEETS_CREDENTIALS_PATH",
  ];

  const skippedPaths: string[] = [];

  for (const key of pathKeys) {
    const p = process.env[key]?.trim();
    if (!p) continue;
    const creds = readCredentialsFile(p, key);
    if (isServiceAccount(creds)) return creds;
    skippedPaths.push(
      `${key} (${String(creds.type ?? "oauth_token")} at ${p})`
    );
  }

  if (skippedPaths.length > 0 && wantsServiceAccount()) {
    throw new Error(
      "Service account credentials missing. Set GOOGLE_ADS_CREDENTIALS_JSON (inline key from Railway / google-ads-mcp) " +
        "or GOOGLE_SERVICE_ACCOUNT_PATH to a service account key file. " +
        `Skipped non–service-account paths: ${skippedPaths.join("; ")}`
    );
  }

  throw new Error(
    "Service account credentials missing. Set GOOGLE_ADS_AUTH_TYPE=service_account and " +
      "GOOGLE_ADS_CREDENTIALS_JSON (inline service account key) or GOOGLE_SERVICE_ACCOUNT_PATH."
  );
}

function loadOAuthCredentialsObject(): Record<string, unknown> {
  const inline = process.env.GOOGLE_ADS_CREDENTIALS_JSON?.trim();
  if (inline) return parseJsonCredentials(inline, "GOOGLE_ADS_CREDENTIALS_JSON");

  for (const key of [
    "GOOGLE_ADS_CREDENTIALS_PATH",
    "GOOGLE_SHEETS_CREDENTIALS_PATH",
    "GOOGLE_APPLICATION_CREDENTIALS",
  ]) {
    const p = process.env[key]?.trim();
    if (p) {
      const creds = readCredentialsFile(p, key);
      if (!isServiceAccount(creds)) return creds;
    }
  }

  throw new Error(
    "OAuth credentials missing. Set GOOGLE_ADS_CREDENTIALS_PATH or " +
      "GOOGLE_ADS_CLIENT_ID + GOOGLE_ADS_CLIENT_SECRET + GOOGLE_ADS_REFRESH_TOKEN"
  );
}

function oauthClientFromInstalled(
  creds: Record<string, unknown>
): { clientId: string; clientSecret: string } {
  const block =
    (creds.installed as Record<string, unknown> | undefined) ??
    (creds.web as Record<string, unknown> | undefined) ??
    creds;
  const clientId = String(
    block.client_id ?? process.env.GOOGLE_ADS_CLIENT_ID ?? ""
  ).trim();
  const clientSecret = String(
    block.client_secret ?? process.env.GOOGLE_ADS_CLIENT_SECRET ?? ""
  ).trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "OAuth client_id/client_secret missing in credentials file or env"
    );
  }
  return { clientId, clientSecret };
}

function resolveRefreshToken(creds: Record<string, unknown>): string {
  const fromEnv = process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const tokenPath = process.env.GOOGLE_ADS_TOKEN_PATH?.trim();
  if (tokenPath && fs.existsSync(tokenPath)) {
    const tokenFile = parseJsonCredentials(
      fs.readFileSync(tokenPath, "utf-8"),
      "GOOGLE_ADS_TOKEN_PATH"
    );
    const rt = String(tokenFile.refresh_token ?? "").trim();
    if (rt) return rt;
  }

  const rt = String(creds.refresh_token ?? "").trim();
  if (rt) return rt;

  throw new Error(
    "OAuth refresh_token required (GOOGLE_ADS_REFRESH_TOKEN or GOOGLE_ADS_TOKEN_PATH)"
  );
}

async function createServiceAccountAuth(): Promise<{
  auth: JWT;
  info: GoogleAuthInfo;
}> {
  const creds = loadServiceAccountCredentials();
  const client = serviceAccountFromCreds(creds);
  return {
    auth: client,
    info: {
      mode: "service_account",
      clientEmail: String(creds.client_email),
    },
  };
}

async function createOAuthAuth(): Promise<{
  auth: OAuth2Client;
  info: GoogleAuthInfo;
}> {
  const clientIdEnv = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecretEnv = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  const refreshEnv = process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim();

  if (clientIdEnv && clientSecretEnv && refreshEnv) {
    const oauth2 = new google.auth.OAuth2(clientIdEnv, clientSecretEnv);
    oauth2.setCredentials({ refresh_token: refreshEnv });
    return { auth: oauth2, info: { mode: "oauth_refresh_token" } };
  }

  const creds = loadOAuthCredentialsObject();
  const { clientId, clientSecret } = oauthClientFromInstalled(creds);
  const refreshToken = resolveRefreshToken(creds);
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return { auth: oauth2, info: { mode: "oauth_credentials_file" } };
}

export async function createGoogleAuth(): Promise<{
  auth: JWT | OAuth2Client;
  info: GoogleAuthInfo;
}> {
  if (wantsServiceAccount()) {
    return createServiceAccountAuth();
  }

  // Auto-detect: service account file wins if explicitly provided via SA env
  if (
    process.env.GOOGLE_SERVICE_ACCOUNT_PATH?.trim() ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  ) {
    return createServiceAccountAuth();
  }

  try {
    const creds = loadServiceAccountCredentials();
    if (isServiceAccount(creds)) {
      return createServiceAccountAuth();
    }
  } catch {
    /* fall through to OAuth */
  }

  return createOAuthAuth();
}

export async function getSheetsApi() {
  const { auth } = await createGoogleAuth();
  return google.sheets({ version: "v4", auth });
}

export function resolveSpreadsheetId(explicit?: string): string {
  const id =
    explicit?.trim() ||
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() ||
    "";
  if (!id) {
    throw new Error(
      "spreadsheet_id required (argument, GOOGLE_SHEETS_SPREADSHEET_ID env, or config)"
    );
  }
  return id;
}
