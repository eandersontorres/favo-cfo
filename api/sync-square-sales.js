// Pulls Square sales data via the Orders API (not Payments) and books each
// day split BY CHANNEL (order.source.name), because aggregator orders are
// injected into Square by the POS integrations (Uber Eats / DoorDash /
// Grubhub, live since ~Apr 2026) and need different accounting:
//
//   sq_sale_<date>                → Revenue - Dining (POS + Invoices + unnamed)
//   sq_sale_<date>_wix            → Revenue - Wix
//   sq_sale_<date>_square_online  → Revenue - Square Online (incl. Ordering Profile)
//   sq_sale_<date>_uber_eats      → Revenue - Uber Eats
//   sq_sale_<date>_doordash       → Revenue - DoorDash
//   sq_sale_<date>_grubhub        → Revenue - Grubhub
//                    each = items + non-tip service charges − discounts − returns
//                    Together they are Schedule C Line 1 (Gross Receipts).
//                    Per-platform income categories are AUTO-CREATED (income,
//                    tax_line='Gross Receipts') when missing, so each channel
//                    is its own P&L line. Matching is by EXACT name — a fuzzy
//                    /wix/ would grab the legacy "Stripe / Wix Deposits"
//                    deposit category.
//
//   Marketplace channels (uber_eats/doordash/grubhub) settle OUTSIDE Square:
//   tender type OTHER, no processing fee, the platform deposits net-of-
//   commission into the bank. Those deposits are tagged
//   source='aggregator_settlement' by plaid-sync so the gross booked here is
//   the only revenue counted. Commission expense comes from the aggregator
//   statement upload (parse-aggregator-statement).
//
//   sq_tax_<date>   → Sales Tax Payable (type='transfer')
//                    OWN-channel tax only (POS/online/invoices). Marketplace
//                    tax is remitted by the platform (Marketplace Facilitator
//                    rules) — booking it would overstate the liability. It is
//                    surfaced in totals.marketplace_tax instead.
//
//   sq_tip_<date>   → Tips Payable (type='transfer')
//                    Customer tips + auto-gratuity, own channels only (
//                    marketplace tips never reach Square's tip field anyway).
//
//   sq_fee_<date>   → Square Fees (expense)
//                    Square's processing cut, summed from tender-level
//                    processing_fee_money on each order.
//
// All rows are idempotent (deterministic ids on `(prefix, date[, channel])`).
// Re-running the sync overwrites prior values AND deletes sq_sale rows in the
// window that the new run didn't regenerate (e.g. the legacy single
// sq_sale_<date> row on a day that now splits into channels, or a channel row
// whose sales dropped to zero after refunds).
//
// Bank-side Square deposits get re-tagged source='square_settlement' as a
// fallback (see PR2 — the authoritative match lives in sync-square-payouts).
//
// Category resolution:
//   - Revenue - Dining           — by name or tax_line='Gross Receipts'
//   - Revenue - <platform>       — by exact name, auto-created when missing
//                                  (falls back to Revenue - Dining if the
//                                  insert fails, so revenue is never dropped)
//   - Sales Tax Payable          — by name AND type='transfer' (required for the tax row)
//   - Tips Payable               — by name AND type='transfer' (required for the tip row)
//   - Commissions and Fees / fees— by tax_line or name match
// If a transfer category is missing the sync skips that row instead of
// silently lumping tax into revenue. The response includes a flag so the
// caller can surface it.

import { createClient } from "@supabase/supabase-js";

const SQUARE_VERSION = "2024-12-18";
const DEFAULT_LOOKBACK_DAYS = 90;

// ─── Channels ────────────────────────────────────────────────────────────────
// Derived from order.source.name. Observed values on the pilot: "Point of
// Sale", "Uber Eats", "Uber Eats - Postmates", "DoorDash", "DoorDash -
// Storefront", "Grubhub", "Wix", "Square Online", "Ordering Profile - Web",
// "Invoices", "giftcard", and absent. Substring match so the platform's
// naming variants collapse into one channel.
const CHANNEL_LABELS = {
  dine_in: "POS",
  wix: "WIX",
  square_online: "SQUARE ONLINE",
  uber_eats: "UBER EATS",
  doordash: "DOORDASH",
  grubhub: "GRUBHUB",
};
// Per-platform income category, auto-created on first sight (except dine_in,
// which resolves to the existing Revenue - Dining). Colors: platform-evoking,
// picked from/near the Favo signal palette.
const CHANNEL_CATEGORIES = {
  wix: { name: "Revenue - Wix", color: "#A594E8" },
  square_online: { name: "Revenue - Square Online", color: "#4E9FB4" },
  uber_eats: { name: "Revenue - Uber Eats", color: "#06C167" },
  doordash: { name: "Revenue - DoorDash", color: "#EE7E6B" },
  grubhub: { name: "Revenue - Grubhub", color: "#E8A93C" },
};
// Channels that settle outside Square: the platform charges the customer,
// keeps its commission, deposits the rest (tender OTHER, no processing fee)
// and remits sales tax itself under Marketplace Facilitator rules. Wix and
// Square Online are NOT here — they are the restaurant's own storefronts, so
// their sales tax is the restaurant's liability.
const MARKETPLACE_CHANNELS = new Set(["uber_eats", "doordash", "grubhub"]);

function channelOf(order) {
  const src = ((order.source && order.source.name) || "").toLowerCase();
  if (src.includes("uber")) return "uber_eats";
  if (src.includes("doordash")) return "doordash";
  if (src.includes("grubhub") || src.includes("grub hub")) return "grubhub";
  if (src.includes("wix")) return "wix";
  if (src.includes("square online") || src.includes("ordering profile")) return "square_online";
  return "dine_in"; // Point of Sale, Invoices, gift cards, unnamed
}

// ─── Timezone-correct window ────────────────────────────────────────────────
// An explicit start/end is a LOCAL calendar range. Slicing by UTC midnight
// used to drop the last evening of the range (orders closed after ~7pm
// Central are already the next UTC day) and pull in the previous one.
function tzOffsetMs(instant, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const p = {};
  for (const part of dtf.formatToParts(instant)) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, p.hour === "24" ? 0 : +p.hour, +p.minute, +p.second);
  // formatToParts drops milliseconds, so the raw difference is off by the
  // instant's ms fraction. Real offsets are whole minutes — round to them.
  return Math.round((asUTC - instant.getTime()) / 60000) * 60000;
}
function localToUtcISO(localISO, timeZone) {
  const guess = new Date(localISO + "Z");
  return new Date(guess.getTime() - tzOffsetMs(guess, timeZone)).toISOString();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" });

  const { tenant_id, start, end } = req.body || {};
  if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const { data: tenant } = await supabase.from("r7_tenants").select("settings").eq("id", tenant_id).maybeSingle();
    const settings = tenant?.settings || {};
    const token = settings.sq_token;
    const locationId = settings.sq_location;
    const sandbox = !!settings.sq_sandbox;
    const tenantTz = settings.timezone || "America/Chicago";
    if (!token || !locationId) return res.status(400).json({ error: "Square credentials not configured" });

    const base = sandbox ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";
    const lookbackStart = new Date();
    lookbackStart.setDate(lookbackStart.getDate() - DEFAULT_LOOKBACK_DAYS);
    const beginTime = start ? localToUtcISO(start + "T00:00:00.000", tenantTz) : lookbackStart.toISOString();
    const endTime = end ? localToUtcISO(end + "T23:59:59.999", tenantTz) : new Date().toISOString();

    // Resolve category ids up front.
    const { data: cats } = await supabase
      .from("r7_ledger_accounts")
      .select("id, name, tax_line, type")
      .eq("tenant_id", tenant_id);
    const findCat = (predicate) => (cats || []).find(predicate)?.id || null;

    const revenueCatId = findCat(c => c.name === "Revenue - Dining" || c.tax_line === "Gross Receipts")
      || findCat(c => c.type === "income");

    // One income category per platform, by EXACT name (fuzzy matching would
    // grab e.g. "Stripe / Wix Deposits"). Auto-create missing ones so each
    // channel shows as its own P&L line without manual setup; on insert
    // failure fall back to Revenue - Dining rather than dropping revenue.
    const categories_created = [];
    const channelCatId = { dine_in: revenueCatId };
    for (const [channel, def] of Object.entries(CHANNEL_CATEGORIES)) {
      let catId = findCat(c => c.name === def.name);
      if (!catId) {
        const { data: ins, error: insErr } = await supabase
          .from("r7_ledger_accounts")
          .insert({ tenant_id, name: def.name, type: "income", color: def.color, tax_line: "Gross Receipts" })
          .select("id")
          .single();
        if (!insErr && ins) {
          catId = ins.id;
          categories_created.push(def.name);
        }
      }
      channelCatId[channel] = catId || revenueCatId;
    }
    const salesTaxCatId = findCat(c => c.type === "transfer" && /sales\s*tax/i.test(c.name || ""));
    const tipsCatId = findCat(c => c.type === "transfer" && /tip/i.test(c.name || ""));
    // Card processing is NOT marketplace commission, and the two must not share
    // an account: the Payout Check screen reads them against different sources
    // (deposits vs platform statements), and TorresBee's "Delivery Commissions"
    // happens to carry tax_line "Commissions and Fees" -- so the old generic
    // match sent every Square fee straight into the delivery commission line.
    // Name the specific thing first; the generic match stays only as a floor
    // for tenants that never split the two.
    const feesCatId = findCat(c => /processing\s*fee|card\s*fee|merchant\s*fee/i.test(c.name || ""))
      || findCat(c => c.tax_line === "Commissions and Fees" || /commission|fee/i.test(c.name || ""))
      || findCat(c => c.tax_line === "Other Expenses");

    // ─── Page through orders ────────────────────────────────────────────
    // /v2/orders/search lets us filter by closed_at (the moment the order
    // was finalized — same anchor Square Sales Summary uses). We pull only
    // COMPLETED orders so canceled drafts and abandoned carts don't leak in.
    const allOrders = [];
    let cursor;
    let pages = 0;
    do {
      pages++;
      if (pages > 50) break;
      const body = {
        location_ids: [locationId],
        query: {
          filter: {
            date_time_filter: {
              closed_at: { start_at: beginTime, end_at: endTime },
            },
            state_filter: {
              states: ["COMPLETED"],
            },
          },
          sort: {
            sort_field: "CLOSED_AT",
            sort_order: "ASC",
          },
        },
        limit: 500,
      };
      if (cursor) body.cursor = cursor;
      const sqRes = await fetch(`${base}/v2/orders/search`, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Square-Version": SQUARE_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!sqRes.ok) {
        const err = await sqRes.text();
        return res.status(502).json({ error: "Square Orders " + sqRes.status, detail: err.slice(0, 500) });
      }
      const data = await sqRes.json();
      if (Array.isArray(data.orders)) allOrders.push(...data.orders);
      cursor = data.cursor;
    } while (cursor);

    // ─── Aggregate per local day ────────────────────────────────────────
    // Bucket by the restaurant's local day (America/Chicago for TorresBee),
    // NOT UTC. A restaurant sells at night — orders closed after ~7pm
    // Central are already the next UTC day, so a naive UTC slice leaks
    // revenue into the following day and breaks reconciliation against the
    // Square Dashboard (which also uses local time).
    const cents = (m) => m?.amount || 0;
    const blankBucket = () => ({
      orders: 0,
      items_cents: 0,
      non_tip_sc_cents: 0,
      auto_grat_cents: 0,
      tip_cents: 0,
      tax_cents: 0,
      discount_cents: 0,
      return_cents: 0,
      fee_cents: 0,
    });
    // ─── Processing fees — Payments API, not Orders ─────────────────────
    // The tender loop below reads tender.processing_fee_money, and Square
    // simply does not populate it on /v2/orders responses: sq_fee_* had never
    // written a single row, so card processing sat at $0 in the P&L from the
    // day the books went granular while ~$2.8k/month was really being charged.
    //
    // The fee lives on the PAYMENT. Each payment carries a processing_fee
    // array (one entry per fee component, refunds included as negatives), and
    // it appears only once the payment settles -- a day or two after the sale.
    // So the last couple of days of any window under-report until a later sync
    // rewrites them, which is fine: sq_fee ids are deterministic per day and
    // the upsert corrects them in place.
    const feeByDay = {};
    {
      let pCursor;
      let pPages = 0;
      do {
        pPages++;
        if (pPages > 50) break;
        const qs = new URLSearchParams({
          begin_time: beginTime,
          end_time: endTime,
          location_id: locationId,
          limit: "100",
        });
        if (pCursor) qs.set("cursor", pCursor);
        const payRes = await fetch(`${base}/v2/payments?${qs}`, {
          headers: {
            "Authorization": "Bearer " + token,
            "Square-Version": SQUARE_VERSION,
          },
        });
        if (!payRes.ok) {
          // A missing PAYMENTS_READ scope must not take the whole sync down --
          // sales are the reason this endpoint exists. Report it and move on
          // with zero fees rather than failing the run.
          feeByDay.__error = `Square Payments ${payRes.status}: ${(await payRes.text()).slice(0, 200)}`;
          break;
        }
        const payData = await payRes.json();
        for (const pay of payData.payments || []) {
          const at = pay.created_at;
          if (!at) continue;
          const date = new Date(at).toLocaleDateString("en-CA", { timeZone: tenantTz });
          for (const f of pay.processing_fee || []) {
            feeByDay[date] = (feeByDay[date] || 0) + (f.amount_money?.amount || 0);
          }
        }
        pCursor = payData.cursor;
      } while (pCursor);
    }

    const byDay = {};
    for (const order of allOrders) {
      const closed = order.closed_at;
      if (!closed) continue;
      const date = new Date(closed).toLocaleDateString("en-CA", { timeZone: tenantTz });
      if (!byDay[date]) byDay[date] = { date, channels: {} };
      const channel = channelOf(order);
      if (!byDay[date].channels[channel]) byDay[date].channels[channel] = blankBucket();
      const d = byDay[date].channels[channel];
      d.orders += 1;

      // Items: sum gross_sales_money across line items. gross_sales_money
      // is the pre-tax pre-discount price × quantity, which is exactly what
      // Square Sales Summary's "Items" line uses.
      for (const li of order.line_items || []) {
        d.items_cents += cents(li.gross_sales_money);
      }

      // Service charges. ALL of them count as revenue per Square's Sales
      // Summary definition (which is what Anderson uses for the IRS Schedule
      // C top line). Auto-gratuity is a *mandatory* service charge that the
      // restaurant collects and then pays out to staff as part of payroll
      // wages (it appears in the paystub's "Tips Charged" column — the
      // restaurant is the entity of record, so it's revenue then expense,
      // not passthrough). Voluntary tips are tracked separately on the
      // order.tip_money field and DO go to Tips Payable.
      //
      // We still track auto_grat separately so the response surfaces it for
      // reconciliation against the paystub, but it lives in non_tip_sc_cents
      // for the Net Sales math.
      for (const sc of order.service_charges || []) {
        const amt = cents(sc.amount_money);
        d.non_tip_sc_cents += amt;
        const isAutoGrat = sc.type === "AUTO_GRATUITY"
          || /auto.?grat|gratu/i.test(sc.name || "");
        if (isAutoGrat) d.auto_grat_cents += amt;
      }

      // Top-level totals from the order.
      d.tax_cents += cents(order.total_tax_money);
      d.tip_cents += cents(order.total_tip_money);
      d.discount_cents += cents(order.total_discount_money);

      // Returns: line-item refunds attached to the order (rare but real).
      for (const ret of order.returns || []) {
        for (const rli of ret.return_line_items || []) {
          d.return_cents += cents(rli.gross_return_money);
        }
      }

      // Tender-level processing fees. Each card tender carries its own
      // processing_fee_money; cash and Other tenders carry nothing.
      for (const tender of order.tenders || []) {
        for (const fee of tender.processing_fee_money ? [tender.processing_fee_money] : []) {
          d.fee_cents += cents(fee);
        }
      }
    }

    // ─── Build ledger rows ──────────────────────────────────────────────
    // Net Sales — matches Square Sales Summary's "Net sales" line exactly:
    //   Items + ALL service charges (incl. auto-gratuity) − discounts − returns
    // ...but split per channel so aggregator gross lands in Revenue -
    // Delivery instead of inflating Dining. Auto-gratuity is restaurant
    // revenue (then paid out via payroll, where it shows up as "Tips
    // Charged" in the paystub). Voluntary tips on order.tip_money go to
    // Tips Payable as passthrough.
    const rowsToWrite = [];
    let skipped_tax = 0;
    let skipped_tip = 0;
    for (const day of Object.values(byDay)) {
      // Own-channel money (POS/online/invoices) is what Square collected on
      // the restaurant's behalf; marketplace money never touches Square's
      // rails, so its tax/tips must not become Square-side liabilities.
      let ownTaxCents = 0;
      let ownTipCents = 0;
      let ownAutoGratCents = 0;
      let feeCents = 0;

      for (const [channel, c] of Object.entries(day.channels)) {
        const netSalesCents = c.items_cents + c.non_tip_sc_cents - c.discount_cents - c.return_cents;
        const marketplace = MARKETPLACE_CHANNELS.has(channel);
        if (!marketplace) {
          ownTaxCents += c.tax_cents;
          ownTipCents += c.tip_cents;
          ownAutoGratCents += c.auto_grat_cents;
        }
        feeCents += c.fee_cents;   // fallback: only ever non-zero if Square starts populating tenders

        if (netSalesCents !== 0) {
          rowsToWrite.push({
            // dine_in keeps the legacy unsuffixed id so the common case
            // upserts over the pre-split row instead of duplicating it.
            id: channel === "dine_in" ? `sq_sale_${day.date}` : `sq_sale_${day.date}_${channel}`,
            tenant_id,
            date: day.date,
            description: `SQUARE NET SALES — ${CHANNEL_LABELS[channel]} — ${c.orders} ORDER${c.orders === 1 ? "" : "S"}`,
            amount: Math.round(netSalesCents) / 100,
            category_id: channelCatId[channel],
            account: "Square POS",
            reconciled: true,
            source: "square_net_sales",
            notes: [
              marketplace ? "Gross — settles via platform deposit (aggregator_settlement); tax remitted by platform" : null,
              c.discount_cents > 0 ? `Discounts: -$${(c.discount_cents / 100).toFixed(2)}` : null,
              c.return_cents > 0 ? `Returns: -$${(c.return_cents / 100).toFixed(2)}` : null,
              c.non_tip_sc_cents > 0 ? `Service charges (non-tip): $${(c.non_tip_sc_cents / 100).toFixed(2)}` : null,
            ].filter(Boolean).join(" · "),
            tags: ["channel:" + channel],
          });
        }
      }

      if (ownTaxCents > 0) {
        if (salesTaxCatId) {
          rowsToWrite.push({
            id: `sq_tax_${day.date}`,
            tenant_id,
            date: day.date,
            description: "SQUARE SALES TAX COLLECTED",
            amount: Math.round(ownTaxCents) / 100,
            category_id: salesTaxCatId,
            account: "Square POS",
            reconciled: true,
            source: "square_sales_tax",
            notes: "Liability — owed to state (own channels only; marketplace tax remitted by the platforms)",
            tags: [],
          });
        } else {
          skipped_tax++;
        }
      }
      if (ownTipCents > 0) {
        if (tipsCatId) {
          rowsToWrite.push({
            id: `sq_tip_${day.date}`,
            tenant_id,
            date: day.date,
            description: "SQUARE TIPS + AUTO-GRATUITY",
            amount: Math.round(ownTipCents) / 100,
            category_id: tipsCatId,
            account: "Square POS",
            reconciled: true,
            source: "square_tips",
            notes: ownAutoGratCents > 0
              ? `Tips: $${(ownTipCents / 100).toFixed(2)} · Auto-grat: $${(ownAutoGratCents / 100).toFixed(2)}`
              : "",
            tags: [],
          });
        } else {
          skipped_tip++;
        }
      }
      // Payments API is the real source; the tender sum stays as a fallback in
      // case Square ever starts populating it. Never add them -- that would
      // double the fee the day both are present.
      const dayFeeCents = feeByDay[day.date] || feeCents;
      if (dayFeeCents > 0) {
        rowsToWrite.push({
          id: `sq_fee_${day.date}`,
          tenant_id,
          date: day.date,
          description: "SQUARE PROCESSING FEES",
          amount: -Math.round(dayFeeCents) / 100,
          category_id: feesCatId,
          account: "Square POS",
          reconciled: true,
          source: "square_fee",
          notes: feeByDay[day.date] ? "From Square Payments API (settled fees)" : "",
          tags: [],
        });
      }
    }

    if (rowsToWrite.length > 0) {
      const { error: upErr } = await supabase
        .from("r7_ledger_transactions")
        .upsert(rowsToWrite, { onConflict: "id" });
      if (upErr) return res.status(500).json({ error: "upsert sale/fee rows: " + upErr.message });
    }

    // Window in LOCAL dates (the same calendar rows are keyed by). Slicing
    // beginTime/endTime would be the UTC date — one day off at the end
    // boundary, which matters below where rows get deleted.
    const todayLocal = new Date().toLocaleDateString("en-CA", { timeZone: tenantTz });
    const beginDate = start || beginTime.slice(0, 10);
    const endDate = end || todayLocal;

    // ─── Delete stale sq_sale rows ─────────────────────────────────────
    // Upsert only overwrites ids the new run produced. Two leftovers would
    // silently double-count: the legacy unsuffixed sq_sale_<date> on a day
    // whose dine_in net is now 0, and a channel row whose sales vanished
    // after a refund. Every local date in [beginDate, endDate] was fully
    // recomputed (the order window is timezone-aligned), so any sq_sale row
    // in that range we didn't just write is stale.
    // square_fee is deliberately NOT swept here. Its id is deterministic per
    // day, so a re-run overwrites it in place; but if the Payments call fails
    // (scope revoked, Square hiccup) the run writes no fee row at all, and a
    // sweep would then delete a correct fee that is simply unconfirmed this
    // pass. Leaving fee rows sticky loses nothing -- a wrong one is corrected
    // by the next successful run.
    const expectedIds = new Set(rowsToWrite.map(r => r.id));
    const { data: existingSaleRows } = await supabase
      .from("r7_ledger_transactions")
      .select("id")
      .eq("tenant_id", tenant_id)
      .in("source", ["square_net_sales", "square_sale_gross"])
      .gte("date", beginDate)
      .lte("date", endDate);
    const staleIds = (existingSaleRows || []).map(r => r.id).filter(id => !expectedIds.has(id));
    let stale_rows_deleted = 0;
    if (staleIds.length > 0) {
      const { error: delErr } = await supabase
        .from("r7_ledger_transactions")
        .delete()
        .in("id", staleIds);
      if (delErr) return res.status(500).json({ error: "delete stale sale rows: " + delErr.message });
      stale_rows_deleted = staleIds.length;
    }

    // ─── Re-tag bank-side Square settlements (fallback to PR2 payout match) ─
    const { data: candidates } = await supabase
      .from("r7_ledger_transactions")
      .select("id, source, description")
      .eq("tenant_id", tenant_id)
      .gte("date", beginDate)
      .lte("date", endDate)
      .gt("amount", 0);
    const isSquareDeposit = (desc) => /\bsquare\b|sq\*square|^sq\s|^sq\b/i.test(desc || "");
    // Never re-tag rows this sync itself generates: their descriptions all
    // start with "SQUARE ..." and used to get swallowed into
    // square_settlement on every run (sq_tax_/sq_tip_ rows), inflating
    // settlements_retagged and lying about their origin.
    const OWN_SOURCES = new Set([
      "square_net_sales",
      "square_sale_gross", // legacy rows from before the source rename
      "square_sales_tax",
      "square_tips",
      "square_fee",
      "square_settlement",
      "aggregator_settlement",
    ]);
    const reTagIds = (candidates || [])
      .filter(c => isSquareDeposit(c.description) && !OWN_SOURCES.has(c.source))
      .map(c => c.id);
    let settlements_retagged = 0;
    if (reTagIds.length > 0) {
      const { error: tagErr } = await supabase
        .from("r7_ledger_transactions")
        .update({ source: "square_settlement" })
        .in("id", reTagIds);
      if (!tagErr) settlements_retagged = reTagIds.length;
    }

    // ─── Totals for the response (let the client surface deltas) ────────
    // Flat totals keep their pre-split meaning (all channels summed) so the
    // client's headline math and any stale deployment stay compatible —
    // EXCEPT tax/tips, which now mean "booked to the liability rows" (own
    // channels only). Marketplace amounts are surfaced separately.
    const allBuckets = Object.values(byDay).flatMap(d => Object.entries(d.channels));
    const sumCents = (pick) => Math.round(allBuckets.reduce((s, [, c]) => s + pick(c), 0)) / 100;
    const ownOnly = (pick) => Math.round(allBuckets.reduce((s, [ch, c]) => s + (MARKETPLACE_CHANNELS.has(ch) ? 0 : pick(c)), 0)) / 100;
    const mktOnly = (pick) => Math.round(allBuckets.reduce((s, [ch, c]) => s + (MARKETPLACE_CHANNELS.has(ch) ? pick(c) : 0), 0)) / 100;
    const totals = {
      items: sumCents(c => c.items_cents),
      non_tip_service_charges: sumCents(c => c.non_tip_sc_cents),
      auto_gratuity: ownOnly(c => c.auto_grat_cents),
      tips: ownOnly(c => c.tip_cents),
      tax: ownOnly(c => c.tax_cents),
      marketplace_tax: mktOnly(c => c.tax_cents),
      marketplace_tips: mktOnly(c => c.tip_cents),
      discounts: sumCents(c => c.discount_cents),
      returns: sumCents(c => c.return_cents),
      processing_fees: Object.entries(feeByDay)
        .filter(([k]) => k !== "__error")
        .reduce((s2, [, v]) => s2 + v, 0) || sumCents(c => c.fee_cents),
      processing_fees_error: feeByDay.__error || null,
      net_sales: sumCents(c => c.items_cents + c.non_tip_sc_cents - c.discount_cents - c.return_cents),
    };
    const by_channel = {};
    for (const [ch, c] of allBuckets) {
      if (!by_channel[ch]) by_channel[ch] = { orders: 0, net_sales: 0 };
      by_channel[ch].orders += c.orders;
      by_channel[ch].net_sales += Math.round(c.items_cents + c.non_tip_sc_cents - c.discount_cents - c.return_cents) / 100;
    }
    for (const ch of Object.keys(by_channel)) by_channel[ch].net_sales = Math.round(by_channel[ch].net_sales * 100) / 100;
    totals.by_channel = by_channel;

    return res.status(200).json({
      orders_scanned: allOrders.length,
      days_with_sales: Object.keys(byDay).length,
      rows_written: rowsToWrite.length,
      stale_rows_deleted,
      settlements_retagged,
      revenue_category_resolved: !!revenueCatId,
      categories_created,
      sales_tax_category_resolved: !!salesTaxCatId,
      tips_category_resolved: !!tipsCatId,
      fees_category_resolved: !!feesCatId,
      skipped_tax,
      skipped_tip,
      totals,
      window: { start: beginDate, end: endDate },
    });
  } catch (err) {
    console.error("sync-square-sales unhandled:", err);
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
