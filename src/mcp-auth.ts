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

/**
 * Protects MCP HTTP routes when MCP_SHARED_TOKEN (or legacy MCP_AUTH_TOKEN) is set.
 * - Missing Authorization → 401
 * - Invalid token → 403
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

  const authHeader = req.headers.authorization;
  if (!authHeader?.trim()) {
    res.status(401).json({
      error: "Unauthorized",
      hint: "Set Authorization: Bearer <MCP_SHARED_TOKEN>",
    });
    return;
  }

  const provided = parseBearerToken(authHeader);
  if (!provided) {
    res.status(401).json({
      error: "Unauthorized",
      hint: "Authorization header must be: Bearer <token>",
    });
    return;
  }

  if (!timingSafeEqualString(provided, expected)) {
    res.status(403).json({
      error: "Forbidden",
      hint: "Invalid MCP shared token",
    });
    return;
  }

  next();
}
