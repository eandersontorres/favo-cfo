// Pulls Square Labor shifts for a tenant and persists them to r7_labor_shifts
// with a "fully loaded" cost that includes employer payroll tax burden.
//
// Tax burden rate defaults to 15% (FICA 7.65% + FUTA 0.6% + SUTA TX ~2.7% +
// Workers Comp ~4% for food service). Override per tenant by setting
// r7_tenants.settings.labor_tax_burden_rate.
//
// Square credentials come from r7_tenants.settings.sq_token / sq_location,
// already populated for TorresBee. Uses the service role to read both
// r7_tenants and write r7_labor_shifts (anon key has RLS blocking writes).

import { authorizeSync, serviceRoleClient } from "./_auth.js";

const SQUARE_VERSION = "2024-12-18";
const DEFAULT_TAX_BURDEN = 0.15;
const DEFAULT_LOOKBACK_DAYS = 90;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const supabase = serviceRoleClient();
  if (!supabase) {
    return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" });
  }

  const { tenant_id, start, end } = req.body || {};

  // Before anything tenant-shaped: a logged-in member of this tenant, or the
  // cron wrapper's CRON_SECRET. See api/_auth.js.
  const auth = await authorizeSync(req, res, tenant_id, supabase);
  if (!auth.ok) return;

  if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

  try {
    // Resolve Square credentials
    const { data: tenant, error: tenErr } = await supabase
      .from("r7_tenants")
      .select("settings")
      .eq("id", tenant_id)
      .maybeSingle();
    if (tenErr) return res.status(500).json({ error: "tenant lookup: " + tenErr.message });
    if (!tenant) return res.status(404).json({ error: "tenant not found" });

    const settings = tenant.settings || {};
    const token = settings.sq_token;
    const locationId = settings.sq_location;
    const sandbox = !!settings.sq_sandbox;
    const taxBurden = parseFloat(settings.labor_tax_burden_rate ?? DEFAULT_TAX_BURDEN);
    if (!token || !locationId) {
      return res.status(400).json({ error: "Square credentials not configured in r7_tenants.settings (sq_token / sq_location)" });
    }

    const base = sandbox
      ? "https://connect.squareupsandbox.com"
      : "https://connect.squareup.com";

    const lookbackStart = new Date();
    lookbackStart.setDate(lookbackStart.getDate() - DEFAULT_LOOKBACK_DAYS);
    const startAt = (start ? new Date(start) : lookbackStart).toISOString();
    const endAt = end ? new Date(end + "T23:59:59.999Z").toISOString() : new Date().toISOString();

    // Page through shifts
    const allShifts = [];
    let cursor;
    let pages = 0;
    do {
      pages++;
      if (pages > 20) break; // safety
      const body = {
        query: {
          filter: {
            location_ids: [locationId],
            start: { start_at: startAt, end_at: endAt },
          },
        },
        limit: 200,
        ...(cursor ? { cursor } : {}),
      };
      const sqRes = await fetch(`${base}/v2/labor/shifts/search`, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Square-Version": SQUARE_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!sqRes.ok) {
        const errText = await sqRes.text();
        return res.status(502).json({ error: "Square API " + sqRes.status, detail: errText.slice(0, 500) });
      }
      const data = await sqRes.json();
      if (Array.isArray(data.shifts)) allShifts.push(...data.shifts);
      cursor = data.cursor;
    } while (cursor);

    // Resolve team member names in one call if possible
    const memberIds = [...new Set(allShifts.map(s => s.team_member_id || s.employee_id).filter(Boolean))];
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
            const name = [m.given_name, m.family_name].filter(Boolean).join(" ").trim() || m.email_address || m.id;
            memberMap[m.id] = name;
          }
        }
      } catch { /* non-fatal */ }
    }

    // Build rows
    const rows = allShifts.map(s => {
      const startMs = s.start_at ? new Date(s.start_at).getTime() : 0;
      const endMs = s.end_at ? new Date(s.end_at).getTime() : startMs;
      let breaksMin = 0;
      for (const b of (s.breaks || [])) {
        const bs = b.start_at ? new Date(b.start_at).getTime() : 0;
        const be = b.end_at ? new Date(b.end_at).getTime() : bs;
        breaksMin += Math.max(0, (be - bs) / 60000);
      }
      const grossHours = Math.max(0, (endMs - startMs) / 3600000);
      const hours = Math.max(0, grossHours - breaksMin / 60);
      const wage = s.wage || (s.hourly_rate ? { hourly_rate: s.hourly_rate } : null);
      const wageCents = wage?.hourly_rate?.amount || 0;
      const wageHourly = wageCents / 100;
      const wageTotal = hours * wageHourly;
      const fullyLoaded = wageTotal * (1 + taxBurden);
      const memberId = s.team_member_id || s.employee_id;
      return {
        tenant_id,
        square_shift_id: s.id,
        square_employee_id: s.employee_id || null,
        team_member_id: s.team_member_id || null,
        employee_name: memberMap[memberId] || null,
        location_id: s.location_id || locationId,
        start_at: s.start_at,
        end_at: s.end_at || null,
        hours: Number(hours.toFixed(2)),
        wage_hourly: Number(wageHourly.toFixed(2)),
        wage_total: Number(wageTotal.toFixed(2)),
        tax_burden_rate: Number(taxBurden.toFixed(4)),
        fully_loaded_cost: Number(fullyLoaded.toFixed(2)),
        breaks_minutes: Math.round(breaksMin),
        status: s.status || "CLOSED",
        raw: s,
        synced_at: new Date().toISOString(),
      };
    });

    if (rows.length > 0) {
      const { error: upErr } = await supabase
        .from("r7_labor_shifts")
        .upsert(rows, { onConflict: "tenant_id,square_shift_id" });
      if (upErr) return res.status(500).json({ error: "upsert shifts: " + upErr.message });
    }

    // Aggregate quick summary for the UI
    const totalHours = rows.reduce((s, r) => s + r.hours, 0);
    const totalWage = rows.reduce((s, r) => s + r.wage_total, 0);
    const totalLoaded = rows.reduce((s, r) => s + r.fully_loaded_cost, 0);

    return res.status(200).json({
      shifts: rows.length,
      hours: Number(totalHours.toFixed(2)),
      wage_total: Number(totalWage.toFixed(2)),
      fully_loaded_cost: Number(totalLoaded.toFixed(2)),
      tax_burden_rate: taxBurden,
      window: { start: startAt.slice(0, 10), end: endAt.slice(0, 10) },
    });
  } catch (err) {
    console.error("sync-square-labor unhandled:", err);
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
