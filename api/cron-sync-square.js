// Daily cron — keeps the Square → Finance feed fresh so it never goes stale
// again (the 05-19→05-24 gap happened because the feed was manual-only).
//
// Triggered by Vercel Cron (see vercel.json) at 08:00 UTC = 03:00 America/
// Chicago, after the restaurant closes, so the previous service day is
// complete. Fires the three Square syncs (sales, tips, labor) for the tenant.
// All three are idempotent (deterministic ids / upserts), so re-running is
// safe.
//
// Single-tenant for now (VITE_TENANT_ID). When multi-tenant lands, iterate
// active tenants from clv_tenants / r7_tenants instead.

export default async function handler(req, res) {
  // CRON_SECRET is now load-bearing in both directions: Vercel sets it on the
  // incoming cron invocation, and it's the only credential this wrapper can
  // present to the sync endpoints (which require a caller since they run as
  // service role — see api/_auth.js). No secret means no way to authenticate
  // downstream, so refuse loudly instead of firing four calls that all 401.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "CRON_SECRET not configured — sync endpoints cannot be authenticated" });
  }
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: "unauthorized" });

  const tenantId = process.env.VITE_TENANT_ID;
  if (!tenantId || tenantId === "demo") {
    return res.status(400).json({ error: "VITE_TENANT_ID not configured for cron" });
  }

  // The project runs Vercel Authentication with deploymentType
  // "all_except_custom_domains": every *.vercel.app URL answers 401, only the
  // custom domains are reachable. VERCEL_URL is a *.vercel.app deployment URL,
  // so using it here made every internal call below 401 — silently, because the
  // failures were only recorded in the response body. Always go through a
  // custom domain.
  // VERCEL_PROJECT_PRODUCTION_URL is normally the shortest custom domain, but it
  // falls back to *.vercel.app when a project has none — which would put us
  // straight back behind the 401. Reject that shape rather than re-break.
  const candidate = (
    process.env.CFO_PUBLIC_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
    ""
  ).replace(/\/+$/, "");
  const base = candidate && !/\.vercel\.app$/i.test(new URL(candidate).hostname)
    ? candidate
    : "https://cfo.favo.team";

  const endpoints = [
    "sync-square-sales",
    "sync-square-tips",
    "sync-square-labor",
    // Payouts feed — populates r7_square_payouts for the Reconciliation screen
    // (see api/sync-square-payouts.js). Idempotent on payout_id, safe to re-run.
    "sync-square-payouts",
  ];
  const results = {};
  const failed = [];
  for (const ep of endpoints) {
    try {
      const r = await fetch(`${base}/api/${ep}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // The sync endpoints accept either a logged-in user's Supabase token
          // or this shared secret. Cron has no user session, so it's this.
          "Authorization": `Bearer ${secret}`,
        },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      if (r.ok) {
        results[ep] = await r.json();
      } else {
        results[ep] = { error: "HTTP " + r.status, detail: (await r.text()).slice(0, 200) };
        failed.push(ep);
      }
    } catch (err) {
      results[ep] = { error: err.message };
      failed.push(ep);
    }
  }

  // Answer with the real outcome. Returning 200 while every sync 401'd is how
  // this went unnoticed for seven weeks: Vercel's cron dashboard showed a green
  // run each morning and the ledger quietly stopped receiving revenue.
  const body = { ran_at: new Date().toISOString(), tenant_id: tenantId, base, results };
  if (failed.length) {
    console.error("cron-sync-square: failed endpoints", failed.join(", "), "base=" + base);
    return res.status(500).json({ ...body, error: "sync failed: " + failed.join(", ") });
  }
  return res.status(200).json(body);
}
