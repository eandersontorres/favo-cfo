// api/plaid-sync.js
// Pulls transactions for every Plaid item connected to the tenant and writes
// them into r7_ledger_transactions as source='plaid'. Driven by the "Sync Bank"
// button. Idempotent: uses Plaid's /transactions/sync cursor + deterministic ids
// (plaid_<transaction_id>) so re-running only applies the delta.
//
// SIGN CONVENTION: Plaid returns `amount` POSITIVE for money leaving the account
// (debit/expense) and NEGATIVE for money entering (credit/income). This app uses
// the opposite (positive = income), so we flip: ledger_amount = -plaid.amount.
//
// Expense transactions are auto-categorized from Plaid's personal_finance_category
// (mapped to the tenant's Chart of Accounts by name). Income/transfer rows are
// left UNCATEGORIZED to avoid double-counting POS revenue already modeled from
// Square. A user-set category is never overwritten on re-sync.
//
// SOURCE CLASSIFICATION: every row is tagged at ingestion (see classifySource)
// so income/expense roll-ups are correct the moment the sync finishes. This
// used to depend on a re-tag pass at the end of sync-square-sales, which only
// covered that run's window — rows landing between Square syncs stayed
// source='plaid' and were counted as income on top of the Square feed.

import { createClient } from "@supabase/supabase-js";

const PLAID_HOSTS = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// Plaid personal_finance_category -> tenant Chart of Accounts NAME (case-insensitive).
// `detailed` is checked first (sharper), then `primary`. Names that don't exist in
// the tenant's COA simply fall back to uncategorized. EXPENSE side only.
const PFC_DETAILED_TO_NAME = {
  FOOD_AND_DRINK_GROCERIES: "Food & Beverage",
  FOOD_AND_DRINK_RESTAURANT: "Food & Beverage",
  FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR: "Food & Beverage",
  GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING: "Accounting service",
  GENERAL_SERVICES_CONSULTING_AND_LEGAL: "Accounting service",
  GENERAL_SERVICES_INSURANCE: "Insurance",
  GENERAL_SERVICES_ADVERTISING_AND_MARKETING: "Marketing",
  GENERAL_SERVICES_AUTOMOTIVE: "Repairs & Maint.",
  GENERAL_MERCHANDISE_OFFICE_SUPPLIES: "Office & Supplies",
  GENERAL_MERCHANDISE_ONLINE_MARKETPLACES: "Restaurant Supplies",
  RENT_AND_UTILITIES_RENT: "Rent & Utilities",
  RENT_AND_UTILITIES_GAS_AND_ELECTRICITY: "Rent & Utilities",
  RENT_AND_UTILITIES_WATER: "Rent & Utilities",
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: "Rent & Utilities",
  RENT_AND_UTILITIES_TELEPHONE: "Rent & Utilities",
  RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT: "Rent & Utilities",
  TRANSPORTATION_GAS: "Fuel",
  TRANSPORTATION_PARKING: "Fuel",
  TRANSPORTATION_TOLLS: "Fuel",
  BANK_FEES_ATM_FEES: "Bank Charge",
  BANK_FEES_INSUFFICIENT_FUNDS: "Bank Charge",
  BANK_FEES_OVERDRAFT_FEES: "Bank Charge",
  BANK_FEES_FOREIGN_TRANSACTION_FEES: "Bank Charge",
  BANK_FEES_INTEREST_CHARGE: "Interest Expense",
  HOME_IMPROVEMENT_HARDWARE: "Repairs & Maint.",
  HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE: "Repairs & Maint.",
  LOAN_PAYMENTS_CAR_PAYMENT: "Car Kia",
  LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT: "Loan",
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: "Loan",
  LOAN_PAYMENTS_OTHER_PAYMENT: "Loan",
  GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT: "Annual Texas Tax",
};
const PFC_PRIMARY_TO_NAME = {
  FOOD_AND_DRINK: "Food & Beverage",
  RENT_AND_UTILITIES: "Rent & Utilities",
  BANK_FEES: "Bank Charge",
  TRANSPORTATION: "Fuel",
  LOAN_PAYMENTS: "Loan",
  HOME_IMPROVEMENT: "Repairs & Maint.",
  GENERAL_MERCHANDISE: "Restaurant Supplies",
};

// Merchant-name overrides — checked BEFORE the PFC map because the merchant name
// is sharper than Plaid's generic bucket (e.g. PAYCHEX -> Payroll, which Plaid
// files under a generic transfer). Substring match on the uppercased merchant;
// most specific patterns first (e.g. "GOOGLE ADS" before "GOOGLE").
const MERCHANT_RULES = [
  ["PAYCHEX", "Payroll"],
  ["GOOGLE ADS", "Marketing"],
  ["FACEBOOK", "Marketing"],
  ["META PLATFORMS", "Marketing"],
  ["MICROSOFT", "Subscription"],
  ["ADOBE", "Subscription"],
  ["WIX", "Subscription"],
  ["ANTHROPIC", "Subscription"],
  ["CLAUDE.AI", "Subscription"],
  ["CLAUDE AI", "Subscription"],
  ["SUPABASE", "Subscription"],
  ["GOOGLE", "Subscription"],            // non-ads Google (Workspace, etc.)
  ["ECOLAB", "Restaurant Supplies"],
  ["360TRAINING", "Training"],
  ["CINTAS", "Cintas"],
  ["PUBLIC STORAGE", "Rent & Utilities"],
];

// Network descriptors that name the payment RAIL, not the merchant. A pending
// row carrying only one of these tells the operator nothing, so it is shown as
// PENDING until the posted version arrives with the real name. Anything not on
// this list is assumed to be a merchant and kept.
const GENERIC_DESCRIPTORS = [
  /^MAIL\/?\s*(TELEPHONE|PHONE)\s*ORDER$/,
  /^(RECURRING\s+)?(PAYMENT|PURCHASE|TRANSACTION|CHARGE)$/,
  /^POS\s*(PURCHASE|DEBIT)?$/,
  /^(CHECKCARD|CHECK\s*CARD|DEBIT\s*CARD|CREDIT\s*CARD)(\s+PURCHASE)?$/,
  /^PENDING$/,
  /^INTERNET\s+(PAYMENT|PURCHASE)$/,
  /^E-?COMMERCE(\s+PURCHASE)?$/,
];

// Best merchant label for a transaction. merchant_name is the cleanest but is
// often null on PENDING card transactions (Plaid returns a generic network
// descriptor like "MAIL/TELEPHONE ORDER" in `name`). counterparties frequently
// carries the real merchant even while pending, so we fall back to it before
// the raw name.
function merchantOf(t) {
  if (t.merchant_name) return t.merchant_name;
  if (Array.isArray(t.counterparties) && t.counterparties.length) {
    const m = t.counterparties.find((c) => c && c.type === "merchant") || t.counterparties[0];
    if (m && m.name) return m.name;
  }
  return t.name || "";
}

// ─── SOURCE CLASSIFICATION ───────────────────────────────────────────────────
// Bank rows fall into three buckets that must NOT be counted as income/expense:
//
//   square_settlement  Square paying out into the bank. The revenue was already
//                      booked from the Orders API (sq_sale_/sq_tax_/sq_tip_),
//                      so the deposit is the same dollar arriving. Square's
//                      debits (fee sweeps, chargebacks) are the same story —
//                      sq_fee_ already carries them.
//   internal_transfer  Money moving between the tenant's own accounts. Both
//                      legs are imported, so they net to zero by construction.
//
// Everything else stays source='plaid' and counts normally.
//
//   aggregator_settlement  Delivery-platform deposits (DoorDash/UberEats/
//                      Grubhub...). Their orders ARE injected into Square by
//                      the POS integrations (live since ~Apr 2026), so
//                      sync-square-sales books the gross per channel
//                      (sq_sale_<date>_uber_eats etc.) and the bank deposit
//                      is the same money net of commission. Inflows only —
//                      an Uber ride or a DoorDash order the owner placed is
//                      an outflow and must keep counting as expense.
//                      (Before the injection went live these deposits were
//                      booked as Revenue - Delivery; that stopped once it
//                      made them double-count.)
const SQUARE_RE = /\bsquare\b|\bsq\s*\*/i;
const AGGREGATOR_RE = /\b(doordash|door\s*dash|ubereats|uber\s*eats|uber|grubhub|grub\s*hub|postmates|seamless)\b/i;
const TRANSFER_RES = [
  /^online payment from chk/i,            // credit leg, lands on a card account
  /^online banking payment to crd/i,      // debit leg, leaves checking
  /^online banking transfer\s+(to|from)/i, // checking <-> savings
];
// Plaid's own labels for own-account movement. Sharper than the descriptor
// when the bank's wording drifts.
const TRANSFER_PFC = new Set(["TRANSFER_IN_ACCOUNT_TRANSFER", "TRANSFER_OUT_ACCOUNT_TRANSFER"]);

function classifySource(t, description) {
  if (SQUARE_RE.test(description)) return "square_settlement";
  // Aggregator INFLOWS are settlements of revenue already booked from the
  // Square orders (gross, per channel). Plaid's convention: positive amount
  // = money leaving the account, so an inflow is t.amount < 0.
  if (Number(t.amount) < 0 && AGGREGATOR_RE.test(description)) return "aggregator_settlement";
  if (TRANSFER_RES.some((re) => re.test(description))) return "internal_transfer";
  if (TRANSFER_PFC.has(t.personal_finance_category?.detailed)) return "internal_transfer";
  return "plaid";
}

// Returns a category_id for a txn, or null.
//   - outflows  → merchant rules, then Plaid's personal_finance_category
//   - inflows   → left uncategorized so they surface for review rather than
//                 being guessed into the P&L. (Aggregator deposits used to be
//                 auto-filed as Revenue - Delivery — no longer: they are
//                 settlements now that the gross comes in via Square.)
function suggestCategoryId(t, nameToId) {
  const ledgerAmount = -Number(t.amount);
  if (ledgerAmount >= 0) {
    return null;
  }
  const desc = merchantOf(t).toUpperCase();
  for (const [pat, acct] of MERCHANT_RULES) {
    if (desc.includes(pat)) { const id = nameToId[acct.toLowerCase()]; if (id) return id; }
  }
  const pfc = t.personal_finance_category || {};
  const name = (pfc.detailed && PFC_DETAILED_TO_NAME[pfc.detailed]) ||
               (pfc.primary && PFC_PRIMARY_TO_NAME[pfc.primary]) || null;
  return name ? (nameToId[name.toLowerCase()] || null) : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const clientId = (process.env.PLAID_CLIENT_ID || "").trim();
  const secret = (process.env.PLAID_SECRET || "").trim();
  const env = (process.env.PLAID_ENV || "sandbox").trim();
  const base = PLAID_HOSTS[env] || PLAID_HOSTS.sandbox;
  if (!clientId || !secret) return res.status(500).json({ error: "PLAID_CLIENT_ID / PLAID_SECRET not configured" });

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" });

  const { tenant_id } = req.body || {};
  if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const { data: items, error: itemsErr } = await supabase
      .from("r7_ledger_plaid_items")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("status", "active");
    if (itemsErr) return res.status(500).json({ error: "load plaid items: " + itemsErr.message });

    if (!items || items.length === 0) {
      // The button uses this flag to know it must open Plaid Link first.
      return res.status(200).json({ not_connected: true, added: 0, modified: 0, removed: 0 });
    }

    // Chart of Accounts: map account NAME -> id so we can categorize from Plaid's
    // personal_finance_category without hardcoding tenant-specific ids.
    const { data: accounts } = await supabase
      .from("r7_ledger_accounts")
      .select("id, name")
      .eq("tenant_id", tenant_id);
    const nameToId = {};
    for (const a of accounts || []) nameToId[String(a.name).toLowerCase()] = a.id;

    let totalAdded = 0, totalModified = 0, totalRemoved = 0, totalPendingCleared = 0;
    // Distinct cardholders seen in account_owner this run. Reported so the
    // operator learns whether the bank populates it at all -- an empty set is
    // itself the answer, and a silent one would send us hunting again.
    const cardholders = new Set();
    const institutions = [];

    for (const item of items) {
      const acctName = {};
      for (const a of item.accounts || []) acctName[a.account_id] = a.mask ? `${a.name} ••${a.mask}` : a.name;

      const added = [];
      const modified = [];
      const removedIds = [];
      let cursor = item.cursor || null;
      let hasMore = true;
      let guard = 0;
      let plaidError = null;

      while (hasMore && guard < 50) {
        guard++;
        const body = { client_id: clientId, secret, access_token: item.access_token };
        if (cursor) body.cursor = cursor;
        const r = await fetch(`${base}/transactions/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await r.json();
        if (!r.ok) { plaidError = data.error_message || ("Plaid sync " + r.status); break; }
        for (const t of data.added || []) added.push(t);
        for (const t of data.modified || []) modified.push(t);
        for (const t of data.removed || []) removedIds.push("plaid_" + t.transaction_id);
        cursor = data.next_cursor;
        hasMore = data.has_more;
      }

      if (plaidError) {
        await supabase.from("r7_ledger_plaid_items")
          .update({ status: "error", last_error: plaidError, updated_at: new Date().toISOString() })
          .eq("id", item.id);
        institutions.push({ name: item.institution_name, error: plaidError });
        continue;
      }

      const toRow = (t) => {
        // Pending card charges sometimes carry only a generic network
        // descriptor with no merchant anywhere, and labelling those with the
        // descriptor is worse than saying nothing. But `t.name` is NOT always
        // generic -- Bank of America passes the real merchant through it
        // ("SAMS CLUB.COM", "APPLE.COM/BILL"), and discarding it wholesale left
        // the operator staring at a screen of rows all called PENDING with no
        // way to tell a $2.99 Apple charge from a $429.96 Sam's Club run.
        //
        // So only the descriptors that carry no information are replaced.
        const raw = String(t.name || "").toUpperCase().trim();
        const generic = !raw || GENERIC_DESCRIPTORS.some((re) => re.test(raw));
        const noMerchant = !t.merchant_name
          && !(Array.isArray(t.counterparties) && t.counterparties.some((c) => c && c.name));
        const description = (
          t.pending && noMerchant && generic
            ? "PENDING"
            : (merchantOf(t) || "TRANSACTION")
        ).toUpperCase().trim().slice(0, 80);
        return {
          id: "plaid_" + t.transaction_id,
          tenant_id,
          date: t.date || t.authorized_date,
          description,
          amount: -Number(t.amount),                 // flip Plaid's sign -> app convention
          category_id: suggestCategoryId(t, nameToId), // auto-categorize from Plaid PFC / merchant
          account: acctName[t.account_id] || item.institution_name || "Plaid",
          // Same id the account materialize step below writes into
          // r7_ledger_bank_accounts. Without it the client's internal-transfer
          // pairing has nothing to compare and every transfer leg is counted
          // as income or expense.
          account_id: t.account_id ? "plaid_acct_" + t.account_id : null,
          reconciled: false,
          source: classifySource(t, description),
          notes: t.pending ? "Pending — will reconcile when posted" : "",
          // account_owner is Plaid's field for "which sub-account holder made
          // this", and a corporate card program with one card per employee is
          // exactly a sub-account arrangement. Bank of America stopped
          // reporting the per-cardholder accounts on 2026-08-17 and now posts
          // every charge to the consolidated CORP account, which cost us the
          // answer to "who spent this". If BoA populates this field, the answer
          // is right here and we were throwing it away.
          //
          // Empty for most institutions -- hence the conditional tag rather
          // than a column.
          tags: t.account_owner ? ["cardholder:" + String(t.account_owner).trim().slice(0, 60)] : [],
        };
      };

      for (const t of [...added, ...modified]) if (t.account_owner) cardholders.add(String(t.account_owner).trim());
      const rows = [...added, ...modified].map(toRow);
      if (rows.length > 0) {
        // Never overwrite a category the user (or a prior sync) already set:
        // fetch existing category_ids and preserve any non-null value.
        const existingCat = {};
        const existingTags = {};
        for (const idsCh of chunk(rows.map(r => r.id), 200)) {
          const { data: ex } = await supabase
            .from("r7_ledger_transactions")
            .select("id, category_id, tags")
            .in("id", idsCh);
          for (const e of ex || []) {
            if (e.category_id) existingCat[e.id] = e.category_id;
            if (Array.isArray(e.tags) && e.tags.length) existingTags[e.id] = e.tags;
          }
        }
        for (const r of rows) if (existingCat[r.id]) r.category_id = existingCat[r.id];
        // Tags were being reset to [] on every upsert. A pending charge is
        // re-sent as `modified` when it posts, so any tag the operator had put
        // on it -- non_recurring is the one the P&L reads for Adjusted EBITDA --
        // silently vanished a day or two later. Merge instead, and let the
        // freshly derived cardholder tag replace only its own kind.
        for (const r of rows) {
          const prior = (existingTags[r.id] || []).filter(x => !String(x).startsWith("cardholder:"));
          if (prior.length) r.tags = [...new Set([...prior, ...r.tags])];
        }

        for (const rowsCh of chunk(rows, 200)) {
          const { error: upErr } = await supabase
            .from("r7_ledger_transactions")
            .upsert(rowsCh, { onConflict: "id" });
          if (upErr) return res.status(500).json({ error: "upsert plaid txns: " + upErr.message });
        }
      }
      if (removedIds.length > 0) {
        await supabase.from("r7_ledger_transactions")
          .delete()
          .eq("tenant_id", tenant_id)
          .in("id", removedIds);
      }

      // ── Pending rows whose posted twin already arrived ──────────────────────
      //
      // In theory /transactions/sync puts a pending transaction in `removed`
      // the moment it posts, and the block above is enough. In practice it is
      // not: Bank of America exposes each cardholder card as its own account
      // and posts the settled charge to the consolidated CORP account, so the
      // pending row sits on an account Plaid simply stops reporting. Nothing
      // ever removes it, and the ledger carries the same expense twice — once
      // pending, once posted. TorresBee had 18 of those, ~$2.2k of August
      // expenses counted double.
      //
      // Two nets, cheapest first.
      //
      // 1. pending_transaction_id — Plaid's own link from a posted transaction
      //    back to the pending one it replaces. Authoritative when present.
      const supersededIds = [...added, ...modified]
        .map((t) => t.pending_transaction_id)
        .filter(Boolean)
        .map((id) => "plaid_" + id);
      if (supersededIds.length > 0) {
        await supabase.from("r7_ledger_transactions")
          .delete()
          .eq("tenant_id", tenant_id)
          .in("id", supersededIds);
      }

      // 2. The cross-account case, where no link exists because Plaid considers
      //    them different transactions on different accounts. Only a pending
      //    row that is already stale (the bank has had days to settle it) AND
      //    has an exact-amount posted twin in the days after it qualifies. The
      //    amount is exact on purpose: a tip added after the hold changes the
      //    total, and a fuzzy match there would delete a real expense.
      const STALE_PENDING_DAYS = 4;
      const staleBefore = new Date(Date.now() - STALE_PENDING_DAYS * 86400000)
        .toISOString().slice(0, 10);
      const { data: stalePending } = await supabase
        .from("r7_ledger_transactions")
        .select("id, date, amount")
        .eq("tenant_id", tenant_id)
        .like("id", "plaid_%")
        .ilike("notes", "Pending%")
        .lte("date", staleBefore);

      const orphanIds = [];
      for (const p of stalePending || []) {
        const after = new Date(p.date);
        after.setDate(after.getDate() + 7);
        const { data: twin } = await supabase
          .from("r7_ledger_transactions")
          .select("id, notes")
          .eq("tenant_id", tenant_id)
          .eq("amount", p.amount)
          .neq("id", p.id)
          .like("id", "plaid_%")
          .gte("date", p.date)
          .lte("date", after.toISOString().slice(0, 10))
          .limit(20);
        const posted = (twin || []).some((t) => !/^pending/i.test(t.notes || ""));
        if (posted) orphanIds.push(p.id);
      }
      if (orphanIds.length > 0) {
        for (const ch of chunk(orphanIds, 200)) {
          await supabase.from("r7_ledger_transactions")
            .delete()
            .eq("tenant_id", tenant_id)
            .in("id", ch);
        }
      }
      totalPendingCleared += supersededIds.length + orphanIds.length;

      await supabase.from("r7_ledger_plaid_items")
        .update({ cursor, status: "active", last_error: null, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", item.id);

      // ── Materialize each Plaid account into the Bank Accounts registry so it
      //    appears (with its live balance) alongside manually-added accounts.
      //    Plaid accounts use id prefix plaid_acct_; the frontend shows this
      //    balance directly instead of opening + (date-range-limited) activity.
      try {
        const balRes = await fetch(`${base}/accounts/get`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId, secret, access_token: item.access_token }),
        });
        const balData = await balRes.json();
        if (balRes.ok && Array.isArray(balData.accounts)) {
          const asOf = new Date().toISOString().split("T")[0];
          const acctRows = balData.accounts.map((a) => {
            const owed = a.type === "credit" || a.type === "loan"; // liabilities shown negative
            const cur = Number(a.balances?.current ?? 0);
            return {
              id: "plaid_acct_" + a.account_id,
              tenant_id,
              name: a.mask ? `${a.name} ••${a.mask}` : a.name,
              type: a.type === "credit" ? "credit" : a.type === "loan" ? "loan" : (a.subtype === "savings" ? "savings" : "checking"),
              institution: item.institution_name || "Bank",
              opening_balance: Number((owed ? -cur : cur).toFixed(2)),
              opening_date: asOf,
              credit_limit: a.balances?.limit != null ? Number(a.balances.limit) : null,
              status: "active",
              notes: "Synced from Plaid · balance as of " + asOf,
            };
          });
          if (acctRows.length) {
            const { error: accErr } = await supabase
              .from("r7_ledger_bank_accounts")
              .upsert(acctRows, { onConflict: "id" });
            if (accErr) console.error("plaid account upsert:", accErr.message);
          }
        }
      } catch (e) { console.error("plaid account materialize:", e.message); }

      totalAdded += added.length;
      totalModified += modified.length;
      totalRemoved += removedIds.length;
      institutions.push({ name: item.institution_name, added: added.length, modified: modified.length, removed: removedIds.length });
    }

    return res.status(200).json({
      ok: true,
      added: totalAdded,
      modified: totalModified,
      removed: totalRemoved,
      pending_cleared: totalPendingCleared,
      cardholders: [...cardholders],
      institutions,
    });
  } catch (err) {
    console.error("plaid-sync unhandled:", err);
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
