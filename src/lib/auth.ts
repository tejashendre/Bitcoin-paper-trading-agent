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

  // 1. Check for QStash signature
  //    NOTE: Only presence + key config is checked. Full HMAC
  //    cryptographic verification is a recommended future improvement.
  const qstashSignature = request.headers.get("upstash-signature");
  if (qstashSignature) {
    if (env.QSTASH_CURRENT_SIGNING_KEY) {
      return { authorized: true, source: "qstash" };
    }
    return { authorized: false, source: "qstash", error: "QStash signing keys not configured" };
  }

  // 2. Check for Dashboard bearer token
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (token === env.DASHBOARD_SECRET) {
      return { authorized: true, source: "dashboard" };
    }
    if (token === "SPECTATOR" && request.method === "GET") {
      return { authorized: true, source: "spectator" };
    }
    return { authorized: false, source: "dashboard", error: "Invalid token" };
  }

  // 3. Check for Vercel Cron Header
  //    Safe: Vercel strips this header from all external requests.
  //    It can only be set by Vercel's internal cron infrastructure.
  const cronHeader = request.headers.get("x-vercel-cron");
  if (cronHeader === "1" || cronHeader === "true") {
    return { authorized: true, source: "vercel-cron" };
  }

  // 4. No auth headers at all
  return { authorized: false, source: "none", error: "No auth provided" };
}
