import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const BEARER_PREFIX = /^Bearer\s+(.+)$/i;

/** Shared token for remote MCP HTTP clients (MCP_SHARED_TOKEN preferred). */
export function resolveMcpSharedToken(): string | undefined {
  const shared = process.env.MCP_SHARED_TOKEN?.trim();
  if (shared) return shared;
  return process.env.MCP_AUTH_TOKEN?.trim() || undefined;
}

function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function parseBearerToken(header: string | undefined): string | undefined {
  if (!header?.trim()) return undefined;
  const match = header.trim().match(BEARER_PREFIX);
  return match?.[1]?.trim() || undefined;
}

function parseQueryKey(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const first = value.find((v) => typeof v === "string" && v.trim());
    return typeof first === "string" ? first.trim() : undefined;
  }
  return undefined;
}

function tokenMatches(provided: string, expected: string): boolean {
  return timingSafeEqualString(provided, expected);
}

/**
 * Protects MCP HTTP routes when MCP_SHARED_TOKEN (or legacy MCP_AUTH_TOKEN) is set.
 * Accepts either:
 * - Authorization: Bearer <token>
 * - Query param: ?key=<token>
 *
 * - No credentials → 401
 * - Invalid credentials → 403
 */
export function mcpSharedTokenMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const expected = resolveMcpSharedToken();
  if (!expected) {
    next();
    return;
  }

  const queryKey = parseQueryKey(req.query.key);
  const bearer = parseBearerToken(req.headers.authorization);

  if (!queryKey && !bearer) {
    res.status(401).json({
      error: "Unauthorized",
      hint:
        "Provide MCP_SHARED_TOKEN via Authorization: Bearer <token> or ?key=<token>",
    });
    return;
  }

  if (queryKey && tokenMatches(queryKey, expected)) {
    next();
    return;
  }

  if (bearer && tokenMatches(bearer, expected)) {
    next();
    return;
  }

  res.status(403).json({
    error: "Forbidden",
    hint: "Invalid MCP shared token (Bearer or ?key=)",
  });
}
