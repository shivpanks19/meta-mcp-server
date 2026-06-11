const DEFAULT_VERSION = "v21.0";

export function graphApiVersion(explicit?: string): string {
  return explicit ?? process.env.META_GRAPH_VERSION ?? DEFAULT_VERSION;
}

export type GraphMethod = "GET" | "POST" | "DELETE";

export interface GraphRequestOptions {
  path: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  method?: GraphMethod;
  accessToken: string;
  apiVersion?: string;
}

export interface GraphMultipartRequestOptions {
  path: string;
  accessToken: string;
  /** Build native multipart fields; access_token is appended automatically */
  buildForm: (form: FormData) => void;
  apiVersion?: string;
}

export class MetaGraphError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = "MetaGraphError";
  }
}

function stripLeadingSlash(p: string): string {
  return p.startsWith("/") ? p.slice(1) : p;
}

export async function graphRequest<T = unknown>(
  opts: GraphRequestOptions
): Promise<T> {
  const version = graphApiVersion(opts.apiVersion);
  const base = `https://graph.facebook.com/${version}/${stripLeadingSlash(opts.path)}`;
  const url = new URL(base);

  const token = opts.accessToken;
  if (!token) {
    throw new Error("Missing access token");
  }

  const method = opts.method ?? "GET";

  if (
    (method === "POST" || method === "DELETE") &&
    process.env.META_ADS_DISABLE_MUTATIONS === "1"
  ) {
    throw new Error(
      "Meta Ads mutations are disabled by META_ADS_DISABLE_MUTATIONS=1"
    );
  }

  if (method === "GET") {
    url.searchParams.set("access_token", token);
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        if (v === undefined) continue;
        url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url.toString(), { method: "GET" });
    const json = (await res.json()) as T & {
      error?: { message?: string; code?: number; error_subcode?: number };
    };
    if (!res.ok || "error" in json && json.error) {
      throw new MetaGraphError(
        json.error?.message ?? res.statusText,
        res.status,
        json
      );
    }
    return json;
  }

  const flat: Record<string, string> = { access_token: token };
  if (opts.body) {
    for (const [k, v] of Object.entries(opts.body)) {
      if (v !== undefined && v !== null) flat[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
    }
  }
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined) flat[k] = String(v);
    }
  }

  const params = new URLSearchParams(flat);
  const res = await fetch(url.toString(), {
    method,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const json = (await res.json()) as T & {
    error?: { message?: string; code?: number };
  };
  if (!res.ok || json.error) {
    throw new MetaGraphError(json.error?.message ?? res.statusText, res.status, json);
  }
  return json;
}

export async function graphMultipartRequest<T = unknown>(
  opts: GraphMultipartRequestOptions
): Promise<T> {
  const version = graphApiVersion(opts.apiVersion);
  const base = `https://graph.facebook.com/${version}/${stripLeadingSlash(opts.path)}`;

  const form = new FormData();
  opts.buildForm(form);
  form.append("access_token", opts.accessToken);

  const res = await fetch(base, {
    method: "POST",
    body: form,
  });

  const json = (await res.json()) as T & {
    error?: { message?: string; code?: number; error_subcode?: number };
  };

  if (!res.ok || json.error) {
    throw new MetaGraphError(
      json.error?.message ?? res.statusText,
      res.status,
      json
    );
  }

  return json;
}

export function requireEnvToken(): string {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t?.trim()) {
    throw new Error(
      "META_ACCESS_TOKEN is not set. Configure it in MCP environment variables, .env file, or shell before starting the server."
    );
  }
  return t.trim();
}

export function optionalPageToken(explicit?: string): string | undefined {
  const fromEnv = process.env.META_PAGE_ACCESS_TOKEN?.trim();
  return explicit?.trim() || fromEnv || undefined;
}
