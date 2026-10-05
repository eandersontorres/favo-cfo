// Pulls card tips per employee per day from Square Orders (not Payments) so
// the attribution lines up with Square's Reports > Sales > Team Sales view.
//
// Why Orders, not Payments?
// - Payment.team_member_id = whoever processed the card swipe. Even when the
//   server closes their own ticket, edge cases (split bills, tableside vs
//   counter handoff, refund flows) can route a tip to someone other than the
//   server who earned it.
// - Order.tenders[].tip_money lets each tender carry its own tip + its own
//   team_member_id, which is exactly how the Team Sales report rolls up.
//   Multi-tender orders (split bills) distribute correctly.
//
// Cash tips are still NOT tracked (Anderson's call). Re-runs overwrite
// card_tips and employee_name but preserve any pool_* the operator set.

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
    const tenantTz = settings.timezone || "America/Chicago";
    if (!token || !locationId) return res.status(400).json({ error: "Square credentials not configured" });

    const base = sandbox ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";
    const lookbackStart = new Date();
    lookbackStart.setDate(lookbackStart.getDate() - DEFAULT_LOOKBACK_DAYS);
    const beginTime = (start ? new Date(start) : lookbackStart).toISOString();
    const endTime = (end ? new Date(end + "T23:59:59.999Z") : new Date()).toISOString();

    // Page through orders (closed in the window, completed state)
    const allOrders = [];
    let cursor;
    let pages = 0;
    do {
      pages++;
      if (pages > 40) break;
      const body = {
        location_ids: [locationId],
        query: {
          filter: {
            date_time_filter: {
              closed_at: { start_at: beginTime, end_at: endTime },
            },
            state_filter: { states: ["COMPLETED"] },
          },
          sort: { sort_field: "CLOSED_AT", sort_order: "ASC" },
        },
        limit: 500,
        ...(cursor ? { cursor } : {}),
      };
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
        return res.status(502).json({ error: "Square Orders API " + sqRes.status, detail: err.slice(0, 500) });
      }
      const data = await sqRes.json();
      if (Array.isArray(data.orders)) allOrders.push(...data.orders);
      cursor = data.cursor;
    } while (cursor);

    // Walk each order's tenders + service_charges. tip_money is voluntary tip
    // per tender, attributed to the server who processed it. AUTO_GRATUITY is
    // a mandatory service charge applied to large parties — Square reports
    // both in Team Sales but in separate columns. We capture each in its own
    // bucket so the UI can show them apart and the Payroll roll-up sums them.
    const byKey = {};
    let ordersWithTips = 0;
    let ordersWithAutoGrat = 0;
    let tipCentsFromTenderless = 0;
    let autoGratCentsUnassigned = 0;
    const bump = (date, memberId, field, cents) => {
      const k = `${date}__${memberId}`;
      if (!byKey[k]) byKey[k] = { date, team_member_id: memberId, tip_cents: 0, auto_grat_cents: 0 };
      byKey[k][field] += cents;
    };
    for (const o of allOrders) {
      const closedAt = o.closed_at || o.created_at;
      if (!closedAt) continue;
      // Local-day bucket (America/Chicago), not UTC — matches Square Team Sales
      // and the sales feed so tips line up with the right service day.
      const date = new Date(closedAt).toLocaleDateString("en-CA", { timeZone: tenantTz });
      const tenders = Array.isArray(o.tenders) ? o.tenders : [];

      // Pick the primary server for this order — used as the fallback for
      // service charges and for tenders missing their own team_member_id.
      const orderTender = tenders.find(t => t.team_member_id || t.tipped_team_member_id);
      const orderMember = o.team_member_id
        || orderTender?.tipped_team_member_id
        || orderTender?.team_member_id
        || null;

      let orderHadTip = false;
      for (const t of tenders) {
        const tipCents = t.tip_money?.amount || 0;
        if (tipCents <= 0) continue;
        const memberId = t.tipped_team_member_id || t.team_member_id || orderMember;
        if (!memberId) {
          tipCentsFromTenderless += tipCents;
          continue;
        }
        orderHadTip = true;
        bump(date, memberId, "tip_cents", tipCents);
      }
      if (orderHadTip) ordersWithTips++;

      const charges = Array.isArray(o.service_charges) ? o.service_charges : [];
      let orderHadAutoGrat = false;
      for (const c of charges) {
        const isAutoGrat = c.type === "AUTO_GRATUITY"
          || (c.calculation_phase === "TOTAL_PHASE" && /gratu/i.test(c.name || ""));
        if (!isAutoGrat) continue;
        const cents = c.applied_money?.amount || c.total_money?.amount || c.amount_money?.amount || 0;
        if (cents <= 0) continue;
        const memberId = orderMember;
        if (!memberId) {
          autoGratCentsUnassigned += cents;
          continue;
        }
        orderHadAutoGrat = true;
        bump(date, memberId, "auto_grat_cents", cents);
      }
      if (orderHadAutoGrat) ordersWithAutoGrat++;
    }

    // Resolve team member names
    const memberIds = [...new Set(Object.values(byKey).map(v => v.team_member_id).filter(Boolean))];
    const memberMap = {};
    if (memberIds.length > 0) {
      try {
        const teamRes = await fetch(`${base}/v2/team-members/search`, {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token,
            "Square-Version": SQUARE_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: { filter: { location_ids: [locationId] } }, limit: 200 }),
        });
        if (teamRes.ok) {
          const teamData = await teamRes.json();
          for (const m of (teamData.team_members || [])) {
            memberMap[m.id] = [m.given_name, m.family_name].filter(Boolean).join(" ").trim() || m.email_address || m.id;
          }
        }
      } catch { /* non-fatal */ }
    }

    // Clear current card_tips for affected (date, member) pairs we computed,
    // then write fresh values. Anything not in our new dataset stays where it
    // was — including pool_share/pool_method, which we never touch.
    // First load existing rows in the window so we can preserve pool_* fields.
    const dates = [...new Set(Object.values(byKey).map(v => v.date))];
    const existingMap = new Map();
    if (dates.length > 0) {
      const { data: existing } = await supabase
        .from("r7_labor_tips_daily")
        .select("id, date, team_member_id, employee_name, card_tips, auto_grat, pool_method, pool_share, pool_participant_count, pool_total")
        .eq("tenant_id", tenant_id)
        .in("date", dates);
      for (const row of (existing || [])) {
        existingMap.set(`${row.date}__${row.team_member_id}`, row);
      }
    }

    // Zero out card_tips for existing rows in the affected dates that we are
    // about to NOT touch (they had no tips in the new pull). This prevents
    // stale tips from a previous sync sticking around if Square refunded them.
    const toWrite = [];
    const seenKeys = new Set();
    for (const g of Object.values(byKey)) {
      const k = `${g.date}__${g.team_member_id}`;
      seenKeys.add(k);
      const card = Math.round(g.tip_cents) / 100;
      const autoGrat = Math.round(g.auto_grat_cents) / 100;
      const existing = existingMap.get(k);
      const row = {
        tenant_id,
        date: g.date,
        team_member_id: g.team_member_id,
        employee_name: memberMap[g.team_member_id] || existing?.employee_name || null,
        card_tips: card,
        auto_grat: autoGrat,
        pool_method: existing?.pool_method || "none",
        pool_share: existing?.pool_share || 0,
        pool_participant_count: existing?.pool_participant_count || 0,
        pool_total: existing?.pool_total || 0,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (existing?.id) row.id = existing.id;
      toWrite.push(row);
    }
    // Reset card_tips=0 on existing rows in the window we didn't see in this pull
    for (const [k, existing] of existingMap.entries()) {
      if (seenKeys.has(k)) continue;
      if (parseFloat(existing.card_tips || 0) === 0 && parseFloat(existing.auto_grat || 0) === 0) continue;
      toWrite.push({
        id: existing.id,
        tenant_id,
        date: existing.date,
        team_member_id: existing.team_member_id,
        employee_name: existing.employee_name,
        card_tips: 0,
        auto_grat: 0,
        pool_method: existing.pool_method || "none",
        pool_share: existing.pool_share || 0,
        pool_participant_count: existing.pool_participant_count || 0,
        pool_total: existing.pool_total || 0,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    let written = 0;
    if (toWrite.length > 0) {
      const { error: upErr } = await supabase
        .from("r7_labor_tips_daily")
        .upsert(toWrite, { onConflict: "tenant_id,date,team_member_id" });
      if (upErr) return res.status(500).json({ error: "upsert tips: " + upErr.message });
      written = toWrite.length;
    }

    return res.status(200).json({
      source: "orders_api",
      orders_scanned: allOrders.length,
      orders_with_tips: ordersWithTips,
      orders_with_auto_grat: ordersWithAutoGrat,
      tipped_tender_pairs: Object.keys(byKey).length,
      employees_with_tips: memberIds.length,
      unassigned_tip_cents: tipCentsFromTenderless,
      unassigned_auto_grat_cents: autoGratCentsUnassigned,
      rows_written: written,
      window: { start: beginTime.slice(0, 10), end: endTime.slice(0, 10) },
    });
  } catch (err) {
    console.error("sync-square-tips unhandled:", err);
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
