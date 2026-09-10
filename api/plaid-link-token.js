// api/plaid-link-token.js
// Creates a Plaid Link token — the short-lived token the browser uses to open
// the Plaid Link widget (the secure bank-login popup). No bank credentials ever
// touch our server: the user types them inside Plaid's iframe.
//
// Env vars (Vercel):
//   PLAID_CLIENT_ID   — from Plaid dashboard
//   PLAID_SECRET      — the secret for the active environment
//   PLAID_ENV         — "sandbox" (default) | "development" | "production"
//   PLAID_REDIRECT_URI— (production/OAuth only) e.g. https://cfo.clariva.cloud/
//                       Required for Bank of America, which forces OAuth.
//                       Deliberately still clariva.cloud, not favo.team: this
//                       value has to match the Plaid dashboard allowed list.
//                       Change it there FIRST or OAuth links break.
//
// Bank of America note: BoA only works in PLAID_ENV=production with OAuth, and
// the redirect URI must be registered in the Plaid dashboard. In sandbox you log
// in with the fake credentials user_good / pass_good against any test bank.

import { createClient } from "@supabase/supabase-js";

const PLAID_HOSTS = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Trim defends against a trailing space/newline accidentally pasted into the
  // Vercel env var — Plaid rejects those with INVALID_API_KEYS.
  const clientId = (process.env.PLAID_CLIENT_ID || "").trim();
  const secret = (process.env.PLAID_SECRET || "").trim();
  const env = (process.env.PLAID_ENV || "sandbox").trim();
  const base = PLAID_HOSTS[env] || PLAID_HOSTS.sandbox;
  if (!clientId || !secret) return res.status(500).json({ error: "PLAID_CLIENT_ID / PLAID_SECRET not configured" });

  const { tenant_id, mode } = req.body || {};
  if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

  try {
    const body = {
      client_id: clientId,
      secret,
      client_name: "Favo CFO",
      user: { client_user_id: tenant_id },
      products: ["transactions"],
      country_codes: ["US"],
      language: "en",
    };

    // UPDATE MODE — re-authenticate the EXISTING item instead of creating a new
    // one. This is the difference between a repair and a re-import: a fresh link
    // gives the same charges brand-new transaction_ids, and since the ledger
    // dedupes by id every one of them lands again as a duplicate. The last
    // from-scratch re-link (2026-07-22) had to park 76 rows worth $41k in
    // r7_ledger_txns_backup_plaid_old_item. Update mode keeps the item_id, the
    // access_token, the transaction ids and the sync cursor, so nothing
    // re-imports.
    //
    // Plaid rejects `products` together with `access_token`, so it goes.
    if (mode === "update") {
      const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !serviceKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" });
      const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: items, error } = await supabase
        .from("r7_ledger_plaid_items")
        .select("access_token")
        .eq("tenant_id", tenant_id)
        .eq("status", "active")
        .limit(1);
      if (error) return res.status(500).json({ error: "load plaid item: " + error.message });
      if (!items || items.length === 0) {
        // Nothing to repair. Say so rather than silently opening a fresh link:
        // the caller asked to fix a connection that does not exist, and the
        // duplicate-free guarantee above would not apply.
        return res.status(409).json({ error: "no_active_item" });
      }
      body.access_token = items[0].access_token;
      delete body.products;
    }
    // OAuth banks (Bank of America, Chase, etc.) require a registered redirect URI.
    const redirect = (process.env.PLAID_REDIRECT_URI || "").trim();
    if (redirect) body.redirect_uri = redirect;

    const r = await fetch(`${base}/link/token/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({
      error: data.error_message || "Plaid link/token/create failed",
      plaid: data,
      // Safe diagnostics (no secret values): confirms which env/host was hit and
      // whether the keys look like the right length (catches truncation/wrong env).
      diag: { env, host: base, client_id_len: clientId.length, secret_len: secret.length },
    });

    return res.status(200).json({ link_token: data.link_token, expiration: data.expiration, env });
  } catch (err) {
    console.error("plaid-link-token unhandled:", err);
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
