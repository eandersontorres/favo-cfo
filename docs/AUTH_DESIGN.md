# Multi-tenant + Auth — Design

Status: **Phase A DONE (2026-05-25).** Login live, stopgap reverted, per-tenant
isolation enforced. Phase B/C still open.
Author: design session 2026-05-24.

### Progress
- ✅ **Phase 0** — anon stopgap (applied 05-24, reverted 05-25 after login confirmed)
- ✅ **Phase A** — Supabase Auth login gate (commit cc59cd9). Verified: anon sees
  0 rows, authenticated tenant member sees all data. Anderson logged in OK.
- ⬜ **Phase B** — multi-tenant polish (switcher, dynamic tenant name, role-aware UI)
- 🟡 **Phase C** — endpoint hardening. **Sync endpoints DONE (2026-07-28)**:
  `sync-square-sales/tips/labor/payouts` + `plaid-sync` now go through
  `api/_auth.js`. Still open: `parse-statement`, `parse-paystub`,
  `parse-aggregator-statement`, `forecast-bookings`, `sync-marketing`,
  `plaid-link-token`, `plaid-exchange`, `unit-*`, `anthropic`.

---

## TL;DR — this is now urgent, not "NEXT"

A hardening migration somewhere in the ecosystem already replaced every
`r7_ledger_*` (and `r7_labor_*`, `r7_payroll_runs`) RLS policy from
`USING (true)` to **tenant-aware**:

```sql
USING (tenant_id::text IN (SELECT r7_get_my_tenant_ids()) OR r7_is_super_admin())
```

The CFO uses the **anon key with no login**. Verified directly:

```sql
SET LOCAL ROLE anon;
SELECT count(*) FROM r7_ledger_transactions WHERE tenant_id = '5dc5...';
-- rows_anon_can_see: 0
```

**The anon browser session can no longer read any ledger data.** The app is
either already showing empty screens or will the moment any cached read
expires. Auth is no longer a roadmap nicety — it's required to keep the app
functional.

The serverless endpoints (`sync-*`, `parse-statement`) are unaffected — they
use the service role, which bypasses RLS.

---

## Current infrastructure (discovered, not assumed)

### Two tenant namespaces

| Namespace | TorresBee id | Used by |
|---|---|---|
| Restauran7 (`r7_tenants`) | `5dc58fa8-…e36e93` | Kitchen, **CFO** |
| Favo (`clv_tenants`) | `384d3027-…343c16` | POS, Marketing (`mkt_restaurants` reuses it) |

They line up by `slug` ('torresbee'), not by id. CFO lives in the **r7
namespace** — every `r7_ledger_*.tenant_id` is `5dc5…`. Stay there; don't
migrate to clv ids (would orphan all existing data).

### Membership tables

- `r7_user_tenants (user_id, tenant_id, role)` — **already populated** with 4
  TorresBee managers, including Anderson (`2b25331f-…`). This is what the RLS
  functions read.
- `clv_tenant_members (user_id, tenant_id, role)` — Favo-side, has Anderson
  as admin of the clv tenant. Not used by r7 RLS.

### RLS helper functions (security definer)

```sql
r7_get_my_tenant_ids() -> SELECT tenant_id FROM r7_user_tenants WHERE user_id = auth.uid()
r7_is_super_admin()    -> auth.uid()'s email = 'eandersontorres@gmail.com'
```

Both return empty/false when `auth.uid()` is NULL (i.e. anon). That's the whole
problem — and also the whole solution: **once a real user is logged in, RLS
just works**, because the membership rows already exist.

### How sibling apps do it

Book and Marketing authenticate with Supabase Auth and read `tenant_id` from
`auth.jwt() -> app_metadata -> tenant_id`. The CFO can use the simpler
membership-lookup path (`r7_user_tenants`) since the rows are already there and
the helper functions already key off `auth.uid()`.

---

## Target design

### Auth flow

1. **Login screen** (new) — Supabase Auth email + password
   (`supabase.auth.signInWithPassword`). Magic-link optional later.
2. On load, `supabase.auth.getSession()` → if no session, render login.
3. `onAuthStateChange` listener swaps between login and app.
4. After login, resolve tenant from membership:
   ```js
   const { data } = await supabase.from('r7_user_tenants')
     .select('tenant_id, role').eq('user_id', user.id);
   ```
   - 1 tenant → use it.
   - Multiple → tenant switcher in the top bar.
   - 0 → "no access" screen.
5. `TENANT_ID` becomes runtime state (from membership), not `VITE_TENANT_ID`.
   Keep the env var only as the `demo` fallback.

### Why this is low-risk on the data side

- **No RLS migration needed.** Policies are already correct. We're adding the
  missing half (a logged-in user) so they evaluate to "allow".
- **No data migration.** `r7_user_tenants` already maps the 4 managers to the
  tenant.
- The blast radius is the **client** (login UI + session + tenant state), not
  the database.

### Serverless endpoints

`sync-marketing`, `sync-square-*`, `forecast-bookings`, `parse-statement` take a
`tenant_id` in the body and run as service role. Today any caller who knows a
tenant_id could hit them. Harden by:

1. Forwarding the user's access token from the client
   (`Authorization: Bearer <token>`).
2. In each endpoint, verify the token and that the user is a member of the
   requested tenant (`r7_user_tenants`) before doing work.

This is a follow-up, not a blocker for the read-path fix.

#### Implemented for the sync endpoints (2026-07-28)

`api/_auth.js` holds the shared gate. `authorizeSync(req, res, tenantId, db)`
accepts two credentials on the same `Authorization: Bearer` header:

| Caller | Credential | Scope |
|---|---|---|
| Browser (Sync Sales / Sync Bank buttons) | Supabase access token, forwarded by `authHeaders()` in `src/lib/supabase.js` | tenants the user is in, per `r7_user_tenants` |
| `api/cron-sync-square.js` | `CRON_SECRET` (timing-safe compare) | any tenant |

Why a shared secret for cron rather than a service account: the project runs
Vercel Authentication with `ssoProtection.deploymentType =
"all_except_custom_domains"`, so cron must call the endpoints through
`cfo.clariva.cloud`. It has no user session to forward, so a header it sets
itself is the only credential available on that path.

The check runs **before** the `tenant_id` presence check, so an unauthenticated
probe gets 401 rather than the 400 that used to prove the handler was running.
`CRON_SECRET` is now required, not optional — `cron-sync-square.js` returns 500
when it's unset instead of firing four calls that would all 401.

**Applying this to the remaining endpoints** is a two-line change each:

```js
const auth = await authorizeSync(req, res, tenant_id, supabase);
if (!auth.ok) return;
```

plus swapping the client's `fetch` headers to `await authHeaders()`. Note that
`parse-*` and `anthropic` are the higher-cost targets (they bill Anthropic
tokens per call), so they're the natural next batch.

---

## Implementation plan (phased)

### Phase 0 — Anon stopgap · DONE (2026-05-24)

Applied `supabase_anon_stopgap.sql`: anon read/write restored for the TorresBee
tenant only (`anon_torresbee_stopgap` policy on all 11 ledger/labor/payroll
tables). Verified anon now sees 173 txns / 124 shifts / 1 payroll run. Buys
time to build Phase A without the live app sitting dark. **Must be reverted**
(DROP block at the bottom of that file) once login ships, or the per-tenant
isolation the hardening migration added is undone for TorresBee.

### Phase A — Unblock reads (urgent) · `S`

The minimum to make the app functional again.

1. Add Supabase Auth login screen (email + password).
2. Gate the app behind a session; `onAuthStateChange` wiring.
3. Resolve `TENANT_ID` from `r7_user_tenants` after login (single-tenant path).
4. Anderson + the 3 managers already have `auth.users` rows (they're in
   `r7_user_tenants`); confirm they have passwords set, or send a
   password-reset / magic link.

**Exit:** logging in shows real data again; anon sees a login screen.

### Phase B — Multi-tenant polish · `M`

5. Tenant switcher (for users in >1 tenant; future-proofs the second customer).
6. Replace the 4 hardcoded "TorresBee / Round Rock, TX" strings with the
   resolved tenant's `name` / location from `r7_tenants`.
7. Role-aware UI (manager vs viewer) — hide destructive actions for viewers.

### Phase C — Endpoint hardening · `S`

8. Forward access token to all `/api/*` endpoints.
9. Membership check before service-role work.

---

## Open questions for Anderson

1. **Is the live app already showing empty data?** If yes, Phase A is
   drop-everything urgent. If it's still showing data, there may be a cached
   session somewhere worth understanding before we change anything.
2. **Do the 4 managers in `r7_user_tenants` have passwords**, or do we go
   magic-link only (simpler, no password management)?
3. **Login styling** — match the Purchase/ecosystem login, or standalone?
4. Should a **temporary anon read policy** for the TorresBee tenant be added as
   an immediate stopgap while Phase A is built (restores service in minutes but
   weakens isolation), or do we go straight to login?

---

## Recommendation

Anderson confirmed "design first" — this doc is that. Recommended next move:
**Phase A**, scoped tight (login + session + single-tenant resolution), because
the read path is broken. Phase B/C follow once the app is functional again.

Do NOT touch RLS policies — they're already where we want them. The work is
entirely client-side auth plumbing plus confirming the managers can log in.
