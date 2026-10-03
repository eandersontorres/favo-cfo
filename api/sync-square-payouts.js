// Pulls every Square payout (bank-side liquidation) into r7_square_payouts so
// the Reconciliation screen can show payout vs bank deposit side-by-side.
//
// Payouts are the canonical "this much money is hitting the bank on this day"
// record from Square. Reconciling against them is more reliable than the
// regex-based re-tag we do today on bank descriptions, because:
//   - The payout_id is deterministic — no description drift between banks.
//   - We get arrival_date directly, not a guess based on ±2 days.
//   - Failed / on-hold payouts are explicit (status != PAID), so we can flag
//     "Square said it would deposit but didn't" without manual digging.
//
// PR1 (this file) just pulls + stores. The Reconciliation screen does the
// match heuristic in the client for now. PR2 will move the match into a
// server-side cron pass that writes `source='square_settlement'` on the
// matched ledger row + `matched_txn_id` on the payout row.

import { authorizeSync, serviceRoleClient } from "./_auth.js";

const SQUARE_VERSION = "2024-12-18";
const DEFAULT_LOOKBACK_DAYS = 90;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const supabase = serviceRoleClient();
  if (!supabase) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" });

  const { tenant_id, start, end } = req.body || {};

  // Before anything tenant-shaped: a logged-in member of this tenant, or the
  // cron wrapper's CRON_SECRET. See api/_auth.js.
  const auth = await authorizeSync(req, res, tenant_id, supabase);
  if (!auth.ok) return;

  if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

  try {
    const { data: tenant } = await supabase.from("r7_tenants").select("settings").eq("id", tenant_id).maybeSingle();
    const settings = tenant?.settings || {};
    const token = settings.sq_token;
    const locationId = settings.sq_location;
    const sandbox = !!settings.sq_sandbox;
    if (!token || !locationId) return res.status(400).json({ error: "Square credentials not configured" });

    const base = sandbox ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";
    const lookbackStart = new Date();
    lookbackStart.setDate(lookbackStart.getDate() - DEFAULT_LOOKBACK_DAYS);
    const beginTime = (start ? new Date(start) : lookbackStart).toISOString();
    const endTime = (end ? new Date(end + "T23:59:59.999Z") : new Date()).toISOString();

    // Page through payouts. The API is location-scoped and supports cursor
    // pagination identical to /v2/payments.
    const allPayouts = [];
    let cursor;
    let pages = 0;
    do {
      pages++;
      if (pages > 50) break;
      const qs = new URLSearchParams({
        location_id: locationId,
        begin_time: beginTime,
        end_time: endTime,
        sort_order: "ASC",
        limit: "100",
      });
      if (cursor) qs.set("cursor", cursor);
      const sqRes = await fetch(`${base}/v2/payouts?${qs}`, {
        headers: { "Authorization": "Bearer " + token, "Square-Version": SQUARE_VERSION },
      });
      if (!sqRes.ok) {
        const errText = await sqRes.text();
        return res.status(502).json({ error: "Square Payouts " + sqRes.status, detail: errText.slice(0, 500) });
      }
      const data = await sqRes.json();
      if (Array.isArray(data.payouts)) allPayouts.push(...data.payouts);
      cursor = data.cursor;
    } while (cursor);

    // Map to r7_square_payouts rows. Square gives amount in the smallest unit
    // (cents for USD) — convert to decimal dollars to match the rest of the
    // ledger.
    const rows = allPayouts.map(p => ({
      id: p.id,
      tenant_id,
      location_id: p.location_id || locationId,
      arrival_date: p.arrival_date || (p.updated_at || p.created_at || "").slice(0, 10),
      amount: Math.round((p.amount_money?.amount || 0)) / 100,
      currency: p.amount_money?.currency || "USD",
      status: p.status || null,
      destination_type: p.destination?.type || null,
      destination_id: p.destination?.id || null,
      raw: p,
    })).filter(r => r.id && r.arrival_date && r.amount > 0);

    let upserted = 0;
    if (rows.length > 0) {
      const { error: upErr, count } = await supabase
        .from("r7_square_payouts")
        .upsert(rows, { onConflict: "id", count: "exact" });
      if (upErr) return res.status(500).json({ error: "upsert payouts: " + upErr.message });
      upserted = count ?? rows.length;
    }

    // ── PR2: deterministic auto-match ─────────────────────────────────────
    // For each payout without a matched_txn_id, find the bank-side ledger row
    // (positive amount, within ±2 days of arrival_date, amount equal to the
    // cent). When we find exactly one (or pick the closest in time when there
    // are ties), record the link on both sides:
    //   - r7_square_payouts.matched_txn_id  → forward link, audit trail
    //   - r7_ledger_transactions.source = 'square_settlement' → makes
    //     isRevenueRelevant() exclude the row from income totals
    //
    // The same Set tracks ledger rows already consumed in this run so two
    // payouts can't claim the same deposit. We also pre-load every
    // matched_txn_id already in the table to honor prior runs.
    const dayMs = 86400000;
    const windowStart = beginTime.slice(0, 10);
    const windowEnd = endTime.slice(0, 10);

    const expandedStart = new Date(windowStart);
    expandedStart.setDate(expandedStart.getDate() - 2);
    const expandedEnd = new Date(windowEnd);
    expandedEnd.setDate(expandedEnd.getDate() + 2);

    const { data: unmatched } = await supabase
      .from("r7_square_payouts")
      .select("id, arrival_date, amount")
      .eq("tenant_id", tenant_id)
      .gte("arrival_date", windowStart)
      .lte("arrival_date", windowEnd)
      .is("matched_txn_id", null);

    const { data: candidates } = await supabase
      .from("r7_ledger_transactions")
      .select("id, date, amount")
      .eq("tenant_id", tenant_id)
      .gte("date", expandedStart.toISOString().slice(0, 10))
      .lte("date", expandedEnd.toISOString().slice(0, 10))
      .gt("amount", 0);

    const { data: existingMatches } = await supabase
      .from("r7_square_payouts")
      .select("matched_txn_id")
      .eq("tenant_id", tenant_id)
      .not("matched_txn_id", "is", null);
    const consumedTxnIds = new Set((existingMatches || []).map(r => r.matched_txn_id).filter(Boolean));

    let auto_matched = 0;
    let no_match = 0;
    const txnIdsToTag = [];

    for (const payout of unmatched || []) {
      const target = parseFloat(payout.amount);
      const arrivalMs = new Date(payout.arrival_date).getTime();
      const winners = (candidates || []).filter(t => {
        if (consumedTxnIds.has(t.id)) return false;
        if (Math.abs(parseFloat(t.amount) - target) > 0.01) return false;
        const dt = new Date(t.date).getTime();
        return Math.abs(dt - arrivalMs) <= 2 * dayMs;
      });
      if (winners.length === 0) { no_match++; continue; }
      // Tie-break: closest in time, then earliest id (stable).
      winners.sort((a, b) => {
        const dA = Math.abs(new Date(a.date).getTime() - arrivalMs);
        const dB = Math.abs(new Date(b.date).getTime() - arrivalMs);
        return dA - dB || String(a.id).localeCompare(String(b.id));
      });
      const chosen = winners[0];
      consumedTxnIds.add(chosen.id);
      txnIdsToTag.push(chosen.id);

      // Forward link on payout side (one row at a time so an individual
      // failure doesn't block the whole batch).
      const { error: pErr } = await supabase
        .from("r7_square_payouts")
        .update({
          matched_txn_id: chosen.id,
          matched_at: new Date().toISOString(),
          match_method: "auto",
        })
        .eq("id", payout.id);
      if (pErr) { console.error("match update payout", payout.id, pErr); continue; }
      auto_matched++;
    }

    let settlements_retagged_by_match = 0;
    if (txnIdsToTag.length > 0) {
      const { error: tagErr } = await supabase
        .from("r7_ledger_transactions")
        .update({ source: "square_settlement" })
        .in("id", txnIdsToTag);
      if (!tagErr) settlements_retagged_by_match = txnIdsToTag.length;
    }

    return res.status(200).json({
      payouts_scanned: allPayouts.length,
      rows_written: upserted,
      auto_matched,
      no_match,
      settlements_retagged_by_match,
      window: { start: windowStart, end: windowEnd },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}
