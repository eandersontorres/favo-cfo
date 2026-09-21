# Favo CFO

Bookkeeping & financial intelligence platform for restaurant operators. Part of the Favo ecosystem (companion to **Favo Kitchen / Restauran7**).

**Live:** [cfo.favo.team](https://cfo.favo.team)
**Repo:** [github.com/eandersontorres/favo-cfo](https://github.com/eandersontorres/favo-cfo)
**Pilot tenant:** TorresBee Restaurant — Round Rock, TX (`tenant_id: 5dc58fa8-0a0a-4d24-8906-e32755e36e93`)

---

## Tech Stack

| Layer | Tool |
|-------|------|
| Frontend | React 18 + Vite 5 (single-file SPA pattern) |
| Backend | Vercel Serverless Functions (`/api/*`) |
| Database | Supabase US (`huurnewugpwerkeusolt.supabase.co`) — same project as Kitchen |
| AI | Anthropic API via `/api/anthropic.js` proxy |
| Deploy | Vercel Pro · auto-deploys from `main` |
| Domain | `cfo.favo.team` (Cloudflare DNS → Vercel). `cfo.clariva.cloud` (GoDaddy) still resolves as legacy |

---

## Project Structure

```
favo-cfo/
├── api/                            # 19 Vercel serverless functions
│   ├── anthropic.js                # Anthropic proxy (generic)
│   ├── parse-statement.js          # Bank statement PDF → transactions
│   ├── parse-paystub.js            # Paychex payroll journal PDF → splits
│   ├── _aggregator.js              # Shared statement→JSON extraction (not a route)
│   ├── parse-aggregator-statement.js  # DoorDash/UberEats/GrubHub/Wix payouts
│   ├── ingest-aggregator-email.js  # Same, but fed by the payout email webhook
│   ├── plaid-link-token.js         # Plaid: Link token
│   ├── plaid-exchange.js           # Plaid: public → access token
│   ├── plaid-sync.js               # Plaid: /transactions/sync + categorization
│   ├── sync-square-sales.js        # Canonical revenue (Orders API)
│   ├── sync-square-tips.js         # Card tips + auto-gratuity per employee
│   ├── sync-square-labor.js        # Shifts → hours, wage, loaded cost
│   ├── sync-square-payouts.js      # Payouts matched to bank deposits
│   ├── cron-sync-square.js         # Vercel Cron wrapper (08:00 UTC)
│   ├── sync-marketing.js           # Ad spend from Favo Marketing
│   ├── forecast-bookings.js        # Reservations → revenue forecast
│   └── unit-*.js                   # Favo Bank (Unit BaaS): onboard/accounts/sync/transfer
├── src/
│   ├── App.jsx                     # ~9,800 lines, single-file SPA (all screens)
│   ├── main.jsx                    # Vite entry
│   └── lib/
│       ├── supabase.js             # All DB queries + Kitchen bridge functions
│       ├── constants.js            # UNCATEGORIZED id (mirrored in api/)
│       ├── favoSso.js              # Session handoff from My Favo Team
│       └── country/                # Country packs — see "Country Packs" below
│           ├── index.js            # Resolution, formatters, statement parsing
│           ├── us.js               # Schedule C, USD, ACH/Check/Zelle
│           └── br.js               # DRE gerencial, BRL, Pix/Boleto
├── infra/
│   └── worker/                     # Wrangler project: Email Routing → JSON → /api/ingest-aggregator-email
├── supabase_*.sql                  # Migrations, applied manually and in order
├── vercel.json                     # Rewrites + cron schedule
├── package.json
└── index.html
```

> **Important:** Follows the **single-file App.jsx pattern** from Restauran7. All screens, components, helpers, and styles in `src/App.jsx`. Avoid breaking into multiple files unless you're refactoring intentionally. `src/lib/` is the deliberate exception: data access, SSO and country packs live there because the serverless functions and the browser both need them.

---

## Environment Variables (Vercel)

```
VITE_SUPABASE_URL=https://huurnewugpwerkeusolt.supabase.co
VITE_SUPABASE_ANON_KEY=<from Supabase → Settings → API>
VITE_TENANT_ID=5dc58fa8-0a0a-4d24-8906-e32755e36e93
ANTHROPIC_API_KEY=<sk-ant-... server-side, no VITE_ prefix>
SUPABASE_SERVICE_ROLE_KEY=<server-side only — every /api/* that writes uses it>
AGGREGATOR_INGEST_SECRET=<authenticates the mail relay to /api/ingest-aggregator-email>
AGGREGATOR_INGEST_TENANT_ID=<legacy single-tenant fallback; per-tenant addresses supersede it>
```

---

## Database Schema (Supabase)

All tables live in the **shared Kitchen Supabase project** with `r7_ledger_*` prefix.

### Tables

| Table | Purpose |
|-------|---------|
| `r7_ledger_transactions` | All financial transactions (imports, manual entries) |
| `r7_ledger_accounts` | Chart of Accounts (categories) |
| `r7_ledger_budgets` | Monthly/annual budgets per category |
| `r7_ledger_bills` | Accounts Payable (bills to pay) |
| `r7_ledger_projects` | Future projects & projections |
| `r7_ledger_recurring` | Recurring rules (rent, payroll, subscriptions) |
| `r7_ledger_bank_accounts` | Multi-account support |
| `r7_ledger_plaid_items` | Plaid access tokens (RLS-locked, service role only) |
| `r7_ledger_unit_accounts` | Favo Bank envelopes (operating / tax_vault / payroll) |
| `r7_ledger_journal` | Manual journal entries — created in `supabase_migration.sql`, still unreferenced by code |
| `r7_ledger_ceo_roi` | CEO Cockpit: premissas + lista de equipamentos (uma linha por tenant, máquinas em JSONB) |
| `r7_labor_shifts` | Square shifts → hours, wage, loaded cost |
| `r7_labor_tips_daily` | Card tips + auto-gratuity per employee per day |
| `r7_payroll_runs` | Payroll prep + Paychex CSV export |
| `r7_square_payouts` | Square payouts matched to bank deposits |
| `r7_aggregator_payouts` | DoorDash / UberEats / GrubHub / Wix settlements |
| `r7_ingest_addresses` | Per-tenant inbound email addresses (`<token>@payouts.favo.team`) |
| `r7_ingest_events` | Log of every inbound email and what happened to it |

### Ecosystem bridges (read-only access)

Read from sibling Favo modules:

| Table | Module | Used For |
|-------|--------|----------|
| `r7_purchases` | Kitchen | Vendor invoices → expense transactions |
| `r7_vendors` | Kitchen | Vendor name lookup map |
| `r7_reservations` | Book | Bookings → revenue forecast |
| `r7_tenants` | shared | Tenant info, Square creds, timezone, **country** |

> `r7_snapshots` and `r7_staff` are NOT usable bridges — the old `fetchKitchenSnapshots` / `fetchKitchenStaff` selected columns that don't exist and were removed. Revenue comes from **Sync Sales**; labor rates from **Square Labor**.

### Key Schema Details

- **`tenant_id` is `UUID`** in all tables (NOT `TEXT`) — must match `r7_tenants.id`
- All ledger tables have RLS enabled with permissive policies (`USING (true) WITH CHECK (true)`)
- `r7_ledger_transactions.posted` and `posted_at` track posting workflow
- `r7_ledger_transactions.category_id` references `r7_ledger_accounts(id)` ON DELETE SET NULL
- `r7_ledger_transactions.id` is `TEXT` (not UUID) — uses prefixed IDs like `pdf_xxx`, `csv_xxx`, `kitchen_purchase_xxx`
- **Closed periods** — `BOOKS_CLOSED_THROUGH` in `App.jsx` guards client-side; a `BEFORE INSERT` trigger on `r7_ledger_locks` enforces it server-side. That table has no versioned migration in this repo — it was applied directly to the DB.
- **`country` / `currency` / `locale` / `tax_regime` on `r7_tenants`** (`supabase_country_migration.sql`) — read by every Favo module, not just CFO

---

## Application Architecture

### Main App.jsx Sections (in order)

1. **Imports** — supabase client, all CRUD/bridge functions
2. **STYLES** — full CSS with Favo palette and font tokens
3. **SAMPLE_DATA** — demo data when `VITE_TENANT_ID === "demo"`
4. **HELPERS** — `fmt`, `fmtDate`, date utilities
5. **AUTO-CATEGORIZATION** — `getCategoryHistory()`, `suggestCategory()`, `normalizeDescription()`
6. **BUDGET ALERTS** — `getBudgetAlerts()` returns categorized alerts
7. **PARSERS** — inline `parseBoACSV()` and `parseOFX()` (DO NOT extract to separate file — caused build issues in past)
8. **DATE HELPERS** — `firstOfMonth()`, `quarterStart()`, `DATE_PRESETS`
9. **DateRangePicker** component
10. **KitchenSyncButton** component
11. **Icon** component (inline SVG library)
12. **Toast** component
13. **Screen Components** (in NAV order — 20 entries, filtered by country pack):
    - `Dashboard` (labelled "Overview")
    - `Insights` (CFO Insights — health scorecard, alerts, action checklists)
    - `CEO` (CEO Cockpit — equipment ROI calculator)
    - `Bookkeeper` 🇺🇸 (8 rules-based IRS Schedule C checks, compliance score)
    - `Labor` 🇺🇸 (Square shifts, loaded cost, payroll variance)
    - `Payroll` 🇺🇸 (nested under Labor — prep + Paychex CSV export)
    - `Tips` 🇺🇸 (nested under Payroll — card tips, auto-grat, pooling)
    - `Projects` (future investments timeline/board/list)
    - `Transactions` (review-first: Uncategorized / Categorized tabs, import drop zone, 🧾 match-invoice → mark bill paid)
    - `Categories` (Chart of Accounts CRUD)
    - `PLReport` (Profit & Loss)
    - `Trends`
    - `CashFlow`
    - `Budget` (with alerts banner)
    - `Bills` (Accounts Payable)
    - `Recurring`
    - `BankAccounts`
    - `FavoBank` 🇺🇸 (Unit BaaS envelopes)
    - `Reconciliation`
    - `TaxSummary` 🇺🇸
14. **MAIN APP** — `export default function App()` with all state, sync logic, and render switch

🇺🇸 = US-only; hidden from the NAV when the tenant's country pack doesn't declare the capability. See **Country Packs** below.

### Data Synchronization

The app uses **4 layers of sync**:

1. **Initial load** on mount and date range change
2. **30-second polling** (silent background refresh)
3. **Tab visibility listener** (refresh when user returns to tab)
4. **Supabase real-time subscriptions** on all 5 ledger tables (instant cross-device updates)

Top bar shows live indicator: 🟢 Live = real-time connected, ⚫ = polling-only fallback.

### Save-on-Change Pattern

Every state mutation persists to Supabase immediately:

```javascript
// Pattern used everywhere:
setTransactions(prev => {
  const updated = prev.map(t => t.id === id ? { ...t, category: catId } : t);
  if (saveTransactions) {
    const changed = updated.filter(t => t.id === id);
    saveTransactions(changed); // async write to Supabase
  }
  return updated;
});
```

The main App declares helpers (`saveTransactions`, `saveCategory`, `saveBudget`, `saveBill`, `saveProject`) that wrap the supabase.js upsert functions and skip writes when `TENANT_ID === "demo"`.

### Auto-Categorization

When importing transactions (CSV/OFX/PDF), the system:
1. Builds a history map from existing transactions: `normalizedDescription → mostUsedCategoryId`
2. For each new transaction, looks up the normalized description and pre-fills the category
3. Marks auto-categorized transactions with `autoCategorized: true`
4. Renders a ✨ badge and gold border in the dropdown
5. Manual category change clears the flag

Normalization strips digits and special chars, keeps first 3 significant uppercase words.

### Real Data Flow

```
[User] imports BoA PDF
   ↓
[Browser] reads PDF, base64 encodes
   ↓
[POST /api/anthropic] forwards to Anthropic API with key
   ↓
[Claude] extracts transactions as JSON array
   ↓
[Browser] auto-categorizes via history, expands date range to match dates
   ↓
[setTransactions + saveTransactions] writes to Supabase
   ↓
[Real-time subscriptions] notify all other connected sessions
```

---

## Critical Patterns to Preserve

### 1. Inline parsers
`parseBoACSV` and `parseOFX` live inline in `App.jsx`, and split lines with `.split('\n').map(l => l.replace('\r', ''))` rather than a `\r\n` regex.

**The original reason is gone.** Extracting them to `src/lib/parsers.js` used to break builds because the GitHub web editor mangled the `\r\n` regex on paste; work is done in a local clone now, so that hazard no longer exists. They stay inline on the single-file convention alone — not because moving them is dangerous. The `.split('\n')` style is still worth keeping: it's immune to the whole class of problem and reads no worse.

### 2. Anthropic via proxy
Never call Anthropic API directly from the browser. Always go through `/api/anthropic.js`. The `ANTHROPIC_API_KEY` is server-side only (no `VITE_` prefix) to keep it secret.

### 3. Tenant ID handling
All Supabase calls accept an optional `tenantId` parameter, defaulting to `import.meta.env.VITE_TENANT_ID || 'demo'`. When `'demo'`, save functions early-return without writing.

### 4. Field name mapping
JS uses camelCase, Supabase uses snake_case. Conversion happens in `supabase.js`:
- `dueDate` ↔ `due_date`
- `categoryId` ↔ `category_id`
- `taxLine` ↔ `tax_line`
- `projectedRevenue` ↔ `projected_revenue`
- `paidDate` ↔ `paid_date`
- `paidMethod` ↔ `paid_method`
- `txnId` ↔ `txn_id`
- `postedAt` ↔ `posted_at`

### 5. Transaction ID format
Use prefixed IDs to identify source:
- `csv_<timestamp>_<i>` — CSV imports
- `ofx_<fitid or random>` — OFX imports
- `pdf_<timestamp>_<i>` — PDF (Anthropic) imports
- `kitchen_purchase_<r7_purchase_id>` — Synced from Kitchen
- `sq_sale_<date>` (POS) / `sq_sale_<date>_<channel>` (wix, square_online, uber_eats, doordash, grubhub) / `sq_tax_<date>` / `sq_tip_<date>` / `sq_fee_<date>` — Sync Sales (deterministic; sales split per channel, each platform gets its own auto-created `Revenue - <platform>` income category, marketplace tax NOT booked)
- `plaid_<plaid_txn_id>` — Plaid sync
- `payment_<bill_id>_<timestamp>` — Bill payments
- `bill_manual_<timestamp>` — Manually added bills
- `p_<timestamp>` — Manually added projects

### 6. Date range auto-expand on import
When user imports a statement with dates outside the current date range, automatically expand the range to match. Without this, imported transactions would appear to "disappear" because they're filtered out by the active date range.

### 7. Merge instead of replace on loadAll
The `loadAll` function MUST merge DB data with local state, not replace. Otherwise transactions that were imported but not yet saved (race condition) would be lost on the next polling tick.

```javascript
setTransactions(prev => {
  if (txns.length === 0) return prev;
  const dbIds = new Set(txns.map(t => t.id));
  const localOnly = prev.filter(t => !dbIds.has(t.id));
  return [...txns, ...localOnly];
});
```

### 8. Country packs — never hardcode a locale, currency or tax rule
Anything that changes between markets lives in `src/lib/country/`. Do NOT add `en-US`, `USD`, a `$`, a US date assumption, or an IRS rule to `App.jsx`.

```javascript
import { money, formatDate, parseAmount, country, supports } from "./lib/country/index.js";
```

Rules:

- **The active pack is a module singleton**, not React context — `fmt()` is called from ~300 render sites. It's safe because `TenantSwitcher` does a full `window.location.reload()` on store change, so the tenant is fixed for the page's life.
- **Resolution is synchronous** at module load from `localStorage["cfo_country_<tenantId>"]`, then reconciled against `r7_tenants.country` on mount. Without the cache the first paint would be USD.
- **Never capture the pack across renders** (`const p = country()` at module scope) — you'd pin the stale one. Call the accessor each time.
- **Reporting-line strings are stable identifiers** persisted in `r7_ledger_accounts.tax_line`. Add, never rename — renaming unmaps existing categories from the reports.
- **Adding a country** = new `src/lib/country/<xx>.js` + widen the `CHECK` constraint in `supabase_country_migration.sql`. The constraint exists so an unknown code can't silently fall back to US formatting.
- Screens declare a capability; `capabilities: { bookkeeper: false }` drops it from the NAV entirely.

Statement parsing goes through `parseDate()` / `parseAmount()` from the pack. Both failure modes they fix are silent: `new Date("03/04/2025")` always read March 4, and the old `/[$,\s()]/` cleaner turned `1.234,56` into `1.234`.

---

## Brand & Design System

**Favo rebrand "Caminho B (v2)"** — minimalist system shared across all Favo modules. Full spec + assets: `C:\Dev\Clariva\rebrand\clariva-assets-B\BRAND.md`.

Golden rule: **deep tone on light background, signal tone on dark background.** Accent color appears only in: the mark's dot, the primary action (1 button per screen), key data, links/interaction, focus/selection, live status/badges. Everything else is black/white/gray.

### Colors (CFO module)

```css
/* dark theme (default) */
--bg: #101416              /* dark base */
--text: #E8ECED
--accent: #46BC88          /* cfo-signal (green) */
--red: #EE7E6B             /* marketing-signal */
--yellow: #E8A93C          /* kitchen-signal */
--blue: #4E9FB4            /* petrol-signal */
--purple: #A594E8          /* book-signal */

/* light theme (:root.theme-light) */
--bg: #F6F6F4              /* paper */
--text: #0A0A0A            /* ink */
--accent: #2E7D5B          /* cfo-deep */
```

### Typography

- **Inter** — wordmark, titles, interface, data. Weights 400/500/600/700.
- **DM Mono** — technical labels, small numbers, badges.

### Logo

- Mark: two symmetric "C"s + center dot (`FavoMark` component in App.jsx). Dot = module color (CFO green). Never rotate/tilt/squeeze; no shadow, gradient, or outline.
- Wordmark: `Favo.` in Inter Bold 700, `letter-spacing: -0.03em`, dot in accent color.
- "CFO" subtitle in DM Mono accent.
- Favicon/app-icon: `public/favo-cfo-dark.svg` (module dark icon from the asset pack).

---

## Workflows

### Importing a bank statement (3 formats supported)

1. User clicks **Import Statement** or drags file into drop zone
2. System detects format by extension:
   - `.pdf` → POSTs base64 to `/api/anthropic` for AI extraction
   - `.ofx` / `.qfx` → inline `parseOFX()`
   - `.csv` → inline `parseBoACSV()`
3. Auto-categorization applied based on history
4. Date range auto-expanded to include imported dates
5. Saved to Supabase
6. Real-time triggers refresh on other connected devices

### Sync Kitchen workflow

User clicks "Sync Kitchen" in top bar:
1. `fetchKitchenPurchases()` — vendor invoices in date range
2. `fetchKitchenVendors()` — for vendor name lookup
3. Transforms to ledger transactions via `purchasesToTransactions()`
4. De-duplicates against existing IDs
5. Saves new ones to Supabase

**Purchases only.** Revenue comes from **Sync Sales** (`api/sync-square-sales`), which is the canonical source — it also re-tags bank-side Square deposits as `source='square_settlement'` so they don't double-count.

### Aggregator payout email ingest

Every tenant gets its own inbound address — `<token>@payouts.favo.team` — so onboarding is "paste this into the DoorDash portal as a notification recipient". No per-tenant infrastructure, no forwarding rules.

```
DoorDash/Uber/GrubHub/Wix email
   ↓  MX on payouts.favo.team (Email Routing subdomain; apex routes real mail — don't catch-all it)
[Cloudflare Email Routing] catch-all
   ↓
[infra/worker/ — favo-payout-ingest]  MIME → JSON, forwards SPF/DMARC verdicts
   ↓  POST + x-ingest-secret
[/api/ingest-aggregator-email]  address → tenant, allowlist, parse, upsert
   ↓
r7_aggregator_payouts (source='email_inbox', unposted)
```

The JSON contract is transport-agnostic on purpose — SendGrid Inbound Parse or Make can replace the Worker without touching the endpoint:

```json
{
  "to": "a3f91c27be40d5f8a1b6@payouts.favo.team",
  "message_id": "<CAF...@mail.gmail.com>",
  "from": "no-reply@doordash.com",
  "subject": "Your weekly payout summary",
  "spf": "pass", "dmarc": "pass",
  "text": "plain-text body, used when there is no attachment",
  "attachments": [
    { "filename": "payout.pdf", "content_type": "application/pdf", "content_base64": "JVBERi0..." }
  ],
  "tenant_id": "5dc58fa8-..."
}
```

**Two credentials, easy to conflate:** `x-ingest-secret` authenticates the *relay* to the endpoint; the address token identifies the *tenant*.

- **Tenant resolution** — `body.tenant_id` → `r7_ingest_addresses` lookup on the recipient's local-part → `AGGREGATOR_INGEST_TENANT_ID`. The env fallback is pre-addressing legacy; a failing lookup falls through to it rather than erroring, which is what makes the code safe to deploy before `supabase_ingest_addresses.sql` is applied.
- **Mint an address** with `SELECT r7_mint_ingest_address('<tenant-uuid>')`. Never commit a token — it's a credential.
- **The address is semi-public** (it sits in the DoorDash portal, it travels in headers), so the sender is the real gate: `senderAllowed()` in `_aggregator.js` checks the From domain, and a hard SPF/DMARC fail is rejected. Without the second check the first is just a list of strings anyone can forge.
- **Every inbound email is logged** to `r7_ingest_events` with its outcome (`accepted` / `duplicate` / `rejected_sender` / `parse_failed` / …). A financial module that silently eats a statement burns trust faster than one that rejects it loudly.
- **Dedupe** is on `message_id` → `r7_aggregator_payouts.email_message_id`. That column is `UNIQUE`, so on a multi-payout statement only the first row carries it; every row keeps the id in `raw`. Re-delivery returns `200 {skipped:true}`.
- **Platform** comes from the filename first, then the sender + subject, and only then from what Claude guessed.
- **Rows land unposted on purpose.** The endpoint writes `source='email_inbox'` and does NOT create ledger entries — AI read a money document, so a human confirms. Reconciliation shows a "N payouts not posted" banner; the operator clicks **Post to ledger** and the same `buildAggregatorAdjustments()` the manual upload uses writes the commission/marketing expenses. This is also what contains a forged email: worst case is a bogus unposted row, not a corrupted P&L.
- "Posted" is derived, not stored: a payout is pending when it owes commission/marketing and no transaction id starts with `agg_<payout_id>_`.
- Vercel caps the request body at 4.5MB; a bigger statement has to go through the manual upload.
- **Still US-only.** `PLATFORM_HINTS` and `SENDER_DOMAINS` in `_aggregator.js`, plus the `platform` `CHECK` on `r7_aggregator_payouts`, hardcode DoorDash/Uber/GrubHub/Wix. They move to the country pack together (iFood/Rappi for BR) — that's Phase 3, and until then this violates the country-pack rule below.

### Posting workflow (Ledger screen)

1. **Auto-Match** — Cross-references bank transactions with Kitchen invoices using fuzzy matching:
   - Amount within $1
   - Date within ±5 days
   - Description partial match
   - Score = amount_match (50) + date_match (30) + desc_match (20)
   - Min score to appear: 50
2. **Post selected** — User selects N transactions, opens modal, picks category/account/notes, confirms
3. Transactions move from "Unposted" tab to "Posted" tab with `posted_at` timestamp
4. **Unpost** available for corrections

### Bill payment workflow

Bills auto-populate from Kitchen purchases. The derivation (`kitchen_purchase` transaction → bill) lives in **App**, not in the Bills screen — it used to run only when that tab was open, which left the Transactions matcher with nothing to match against on a cold load. Derived bills are not persisted: a bill only reaches `r7_ledger_bills` once something happens to it.

There are three ways a bill gets paid, in order of how much the operator has to do:

1. **Auto-reconcile (Bills screen)** — when the real bank debit shows up, an open bill is matched on amount + vendor token + date window and marked paid automatically. The Kitchen invoice shadow is deleted so the expense isn't counted twice; the bank row is the record.
2. **Match invoice (Transactions screen)** — for when that heuristic won't fire: the vendor reads differently on the statement, the amount carries a fee, the payment landed weeks late. Every open bill is listed, **ranked, not filtered**, because a manual match is a human decision. Scoring: amount 50 exact / 30 near, vendor token 30, date 20 (≤7d) / 15 (≤30d) / 8 (≤90d) — the date is deliberately weak and long-range, since the invoice is dated when issued and the bank line when it cleared. A row only *advertises* a suggestion when the match is **anchored** (amount exact, or vendor named with the amount near) **and within 90 days**. Both halves matter: points scraped from a loose amount plus a nearby date are a coincidence, and a statement line like `CHECK 951` carries no vendor at all, so a round $1,200.00 would otherwise anchor to an invoice from last year just as happily as this month's. An expense with no invoice behind it stays unmatched. On confirm the bill is marked paid on the transaction's date with its account as the method, the row is reconciled and inherits the bill's category if it was uncategorized, and the Kitchen shadow is deleted — same rule as auto-reconcile. Matched rows show a `🧾 pays <vendor>` badge and lose the button.
3. **Pay Bill (Bills screen)** — no bank row exists yet. Modal collects date + method, and this one **creates** a `payment_*` ledger transaction, replacing the `kitchen_purchase` row.

Nothing un-pays a bill yet, on any of the three paths.

---

## Common Tasks

### Adding a new screen

1. Add screen component (function) in `App.jsx` before `// ─── MAIN APP`
2. Add icon to the `Icon` component map
3. Add NAV entry: `{ id: "newscreen", label: "Label", icon: "iconname" }`
4. Add render case in switch: `case "newscreen": return <NewScreen ... />`
5. Pass needed props (transactions, categories, dateRange, save functions, showToast)

### Adding a new database table

1. Write SQL migration file (use UUID for tenant_id, follow `r7_ledger_*` naming)
2. Add fetch + upsert + delete functions in `src/lib/supabase.js`
3. Add state + load logic in main App
4. Add to real-time channel subscriptions in the useEffect
5. Add save function in main App
6. Pass through to relevant screen via renderScreen

### Adding a new field to existing table

1. SQL: `ALTER TABLE r7_ledger_X ADD COLUMN IF NOT EXISTS field_name TYPE`
2. Update `upsert*` mapping in `src/lib/supabase.js`
3. Update `fetch*` if explicit columns selected
4. Update load logic in main App if name conversion needed (camelCase ↔ snake_case)

---

## Known Issues / Watch-outs

- **Vite SPA routing** — `vercel.json` has rewrite for `/(.*)` → `/index.html`. Don't break this.
- **Migrations are manual** — no migration runner. Merging a PR deploys code but does not touch the DB. Ship the SQL and the code that depends on it in an order where either half is safe alone.
- **Sample data fallback** — when `VITE_TENANT_ID === "demo"`, app uses `SAMPLE_TRANSACTIONS`. Useful for testing without DB but make sure it doesn't leak to production.
- **Real-time requires Replication enabled in Supabase** — Settings → Database → Replication → enable for all `r7_ledger_*` tables.
- **Plaid pending rows can orphan.** `/transactions/sync` is supposed to put a pending transaction in `removed` when it posts, and usually does. Bank of America doesn't cooperate: each cardholder card is its own Plaid account, the settled charge posts to the consolidated CORP account, and when BoA stops reporting the card account its pending row is orphaned — same expense counted twice. `api/plaid-sync.js` therefore also deletes by `pending_transaction_id` and sweeps stale pending rows (4+ days) that have an exact-amount posted twin within a week. The sync response returns `pending_cleared` and the Sync Bank toast says so, because a bookkeeping tool that deletes ledger lines silently is worse than one that leaves the duplicate. Historical cleanup: `supabase_cleanup_pending_dupes.sql`.
- **Anthropic body size limit** — large PDFs may hit Vercel's 4.5MB body limit. The proxy passes through; if issues arise, may need to chunk or compress.

---

## Roadmap

`ROADMAP.md` is the source of truth — it tracks Recently Shipped / Now / Next / Later / Horizon with effort tags. Keep it updated there, not here.

Already shipped (this list used to claim otherwise): multi-account, recurring, Plaid, bank reconciliation, Square sales/tips/labor/payouts, payroll + Paychex export, Bookkeeper, CEO Cockpit, multi-store tenant switcher, country packs Phase 0.

Still open, highest leverage first:

- [ ] **Brazil Phase 1** — DRE gerencial replacing Tax Summary; BR chart of accounts confirmed against the pilot's accountant
- [ ] **Brazil Phase 2** — ingestion: BR bank OFX, Pluggy/Belvo (Open Finance), iFood/Rappi, Stone/Cielo
- [ ] Multi-tenant + proper Auth (tenant-aware RLS, replacing `USING (true)`)
- [ ] Receipt photo upload → AI extract → attach to transaction
- [ ] Email reports (weekly P&L digest)
- [ ] Bundle code-splitting (single chunk ~740KB, Vite warns every build)

---

## Testing Locally

```bash
npm install
cp .env.example .env
# Edit .env with VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_TENANT_ID
npm run dev
```

For PDF import testing locally, you also need to run `vercel dev` instead of `vite dev` so the `/api/anthropic` function works, and have `ANTHROPIC_API_KEY` in `.env`.

---

## Communication Style for Anderson

- Concise, direct recommendations over open-ended options
- Brazilian Portuguese is fine for chat; code/comments in English
- Action-oriented language for American market positioning
- Favo = professional / sophisticated tone
- Report what was actually verified vs. assumed. A build that passed and a screen that rendered are different claims — say which one you have

### Git workflow

Work happens in the local clone, not through the GitHub web editor (that was the old flow — see the note on pattern #1).

- Branch off `main` for anything non-trivial; `main` auto-deploys to production from Vercel
- Commit and push only when asked
- Commit messages: subject in Portuguese matching the existing log style (`feat(scope): …`, `fix(scope): …`, `docs: …`), body explaining **why**, `Co-Authored-By: Claude <noreply@anthropic.com>` at the end
- SQL migrations are applied manually — a merged PR does NOT run them. Say so when a change needs one
