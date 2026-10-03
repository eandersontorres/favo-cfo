// Shared caller verification for the service-role sync endpoints.
// (Files under api/ whose name starts with `_` are helpers, not routes.)
//
// Every sync endpoint takes a tenant_id in the POST body and then reads that
// tenant's Square token / Plaid access_token using SUPABASE_SERVICE_ROLE_KEY,
// which bypasses RLS. With no caller check, anyone who learns or guesses a
// tenant UUID could drive unbounded syncs against that tenant's ledger and
// burn its Square/Plaid API quota. This is Phase C of docs/AUTH_DESIGN.md.
//
// Two callers are legitimate, so two credentials are accepted on the same
// `Authorization: Bearer` header:
//
//   1. A logged-in operator. The browser forwards its Supabase access token
//      (see authHeaders() in src/lib/supabase.js). We verify the JWT and
//      confirm the user is a member of the requested tenant via
//      r7_user_tenants — the same table r7_get_my_tenant_ids() reads, so the
//      endpoint grants exactly what RLS would have granted on a direct query.
//
//   2. api/cron-sync-square.js, which has no user session. It presents
//      CRON_SECRET and may sync any tenant. It must go through a custom
//      domain (every *.vercel.app URL 401s behind Vercel Authentication —
//      see the base-URL note in cron-sync-square.js), so a header the wrapper
//      sets itself is the only credential available on that path.
//
// Fails closed: no header, unknown token, or non-member all return 401.

import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";

// Service-role Supabase client, or null when the key isn't configured.
export function serviceRoleClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bearerToken(req) {
  const raw = req.headers?.authorization || req.headers?.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return match ? match[1].trim() : null;
}

function matchesSecret(candidate, secret) {
  if (!secret || !candidate) return false;
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false; // timingSafeEqual requires equal lengths
  return timingSafeEqual(a, b);
}

function deny(res, reason) {
  console.warn("sync auth denied:", reason);
  res.status(401).json({ error: "unauthorized", reason });
  return { ok: false };
}

/**
 * Authorize a service-role sync request for `tenantId`.
 *
 * On success returns { ok: true, via: "cron" | "user", userId }.
 * On failure the response has ALREADY been written — the handler must simply
 * `return`. Call this before any tenant work, including before validating
 * tenant_id, so an unauthenticated probe never learns anything but 401.
 *
 * @param {object} db - service-role client (reused so we don't build two)
 */
export async function authorizeSync(req, res, tenantId, db) {
  const token = bearerToken(req);
  if (!token) return deny(res, "missing bearer token");

  // Machine path — the cron wrapper. Checked first so a valid CRON_SECRET
  // never gets sent to the auth server as if it were a user JWT.
  if (matchesSecret(token, process.env.CRON_SECRET)) {
    return { ok: true, via: "cron", userId: null };
  }

  const supabase = db || serviceRoleClient();
  if (!supabase) {
    res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" });
    return { ok: false };
  }

  const { data, error } = await supabase.auth.getUser(token);
  const user = data?.user;
  if (error || !user) return deny(res, "invalid or expired token");

  if (!tenantId) return deny(res, "tenant_id required");

  // Membership lookup mirrors r7_get_my_tenant_ids(). Compared as strings
  // because the RLS helper casts tenant_id::text and a malformed tenantId
  // would make a typed .eq() error out instead of cleanly denying.
  const { data: rows, error: memberErr } = await supabase
    .from("r7_user_tenants")
    .select("tenant_id")
    .eq("user_id", user.id);
  if (memberErr) {
    console.error("sync auth membership lookup:", memberErr.message);
    res.status(500).json({ error: "membership lookup failed" });
    return { ok: false };
  }

  const isMember = (rows || []).some((r) => String(r.tenant_id) === String(tenantId));
  if (!isMember) return deny(res, "not a member of this tenant");

  return { ok: true, via: "user", userId: user.id };
}
