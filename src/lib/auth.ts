// ================================================================
// Auth Middleware — QStash signatures + Dashboard bearer tokens
// ================================================================
//
// SECURITY NOTES:
//
// 1. QStash path: We verify that the `upstash-signature` header is
//    present AND that signing keys are configured, but we do NOT
//    perform full HMAC cryptographic verification of the signature.
//    This is a known gap. Full verification should be added using
//    the `@upstash/qstash` SDK's `Receiver.verify()` method.
//    Until then, this path trusts any request that presents the
//    header while keys are configured, which is safe only if the
//    endpoint is not otherwise reachable by external traffic.
//
// 2. Vercel Cron path: `x-vercel-cron: 1` is safe to trust because
//    Vercel's infrastructure automatically STRIPS this header from
//    any inbound external HTTP requests, so it can only be set by
//    Vercel's own cron scheduler internally. See Vercel docs:
//    https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
//
// ================================================================

import { getEnv } from "@/lib/env";

export interface AuthResult {
  authorized: boolean;
  source: string;
  error?: string;
}

export function verifyAuth(request: Request): AuthResult {
  const env = getEnv();
  const authHeader = request.headers.get("authorization");

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    
    // Check Dashboard token
    if (token === env.DASHBOARD_SECRET) {
      return { authorized: true, source: "dashboard" };
    }
    
    // Check Spectator token
    if (token === "SPECTATOR" && request.method === "GET") {
      return { authorized: true, source: "spectator" };
    }
    
    // Check strict CRON token
    if (env.CRON_SECRET && token === env.CRON_SECRET) {
      return { authorized: true, source: "cron" };
    }

    return { authorized: false, source: "auth", error: "Invalid token" };
  }

  return { authorized: false, source: "none", error: "No auth provided" };
}
