import { createClient } from '@supabase/supabase-js'
import { UNCATEGORIZED } from './constants.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true },
})

// Mirrors App.jsx TENANT_ID: the sidebar TenantSwitcher's localStorage override
// wins over the deploy's env pin (multi-store manager, one deploy).
const TENANT = () => {
  try { return localStorage.getItem('cfo_active_tenant') || import.meta.env.VITE_TENANT_ID || 'demo' }
  catch { return import.meta.env.VITE_TENANT_ID || 'demo' }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
// Tenant ids the logged-in user belongs to, via the SECURITY DEFINER function
// that reads r7_user_tenants. Same path Favo Purchase uses.
// Returns null when the lookup FAILED and [] when the user genuinely belongs to
// no tenant. Collapsing the two used to be the cause of the app "blinking": the
// RPC reads auth.uid(), so a token mid-refresh returns zero rows, the caller
// read that as "not authorized" and unmounted the whole authenticated tree for
// a frame. Callers must treat null as "don't know — keep the current gate".
export async function getMyTenantIds() {
  const { data, error } = await supabase.rpc('r7_get_my_tenant_ids')
  if (error) { console.error('getMyTenantIds', error); return null }
  return data || []
}

// Tenants em que o usuario e owner/admin (ceo_admins), geridos na aba Team do
// favo-ceo. E ESTE o portao do CFO -- nao getMyTenantIds(), que responde a
// pergunta operacional do POS e inclui garcom, cozinha e producao. Mesma
// convencao de null acima: null = a chamada falhou, [] = nao administra nada.
export async function getMyCfoTenantIds() {
  const { data, error } = await supabase.rpc('r7_get_my_cfo_tenant_ids')
  if (error) { console.error('getMyCfoTenantIds', error); return null }
  return data || []
}

export async function signInWithPassword(email, password) {
  return await supabase.auth.signInWithPassword({ email, password })
}

export async function sendMagicLink(email) {
  return await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  })
}

export async function signOutUser() {
  return await supabase.auth.signOut()
}

// ─── TRANSACTIONS ─────────────────────────────────────────────────────────────
// PostgREST devolve no maximo 1000 linhas por resposta, entao uma consulta sem
// paginacao NAO devolve erro -- devolve menos dado, calada. Como a ordem e por
// data decrescente, o que sumia era o comeco do periodo: em 2026, com 4.290
// linhas, "este ano" parava em 04/ago e janeiro a julho simplesmente nao
// existiam pra tela nenhuma (P&L, Dashboard, Cash Flow, todas).
//
// O desempate por id importa: centenas de linhas dividem a mesma data, e sem
// uma segunda chave a ordem entre elas nao e estavel entre requisicoes -- as
// paginas se sobrepoem e perdem linha no meio.
const TXN_PAGE = 1000
const TXN_MAX_PAGES = 100

export async function fetchTransactions(tenantId, { start, end } = {}) {
  const out = []
  for (let page = 0; page < TXN_MAX_PAGES; page++) {
    let q = supabase.from('r7_ledger_transactions').select('*').eq('tenant_id', tenantId)
      .order('date', { ascending: false })
      .order('id', { ascending: true })
      .range(page * TXN_PAGE, page * TXN_PAGE + TXN_PAGE - 1)
    if (start) q = q.gte('date', start)
    if (end)   q = q.lte('date', end)
    const { data, error } = await q
    if (error) { console.error('fetchTransactions', error); return out }
    out.push(...data)
    if (data.length < TXN_PAGE) return out
  }
  console.warn('fetchTransactions: parou em', TXN_MAX_PAGES * TXN_PAGE, 'linhas')
  return out
}

export async function upsertTransactions(rows, tenantId) {
  if (!rows || rows.length === 0) return { ok: true, saved: 0 }
  const tid = tenantId || TENANT()
  if (tid === 'demo') return { ok: true, saved: rows.length, demo: true }
  const mapped = rows.map(t => ({
    id: t.id,
    tenant_id: tid,
    date: t.date,
    description: t.description,
    amount: t.amount,
    category_id: ((t.category && t.category !== UNCATEGORIZED) ? t.category : t.category_id) || null,
    recurring_id: t.recurring_id || t.recurringId || null,
    account_id: t.account_id || t.accountId || null,
    account: t.account || 'Imported',
    reconciled: t.reconciled || false,
    prior_period: t.prior_period || t.priorPeriod || false,
    tags: Array.isArray(t.tags) ? t.tags : [],
    source: t.source || 'manual',
    notes: t.notes || '',
    // PR4: split children reference their bank-side parent. Null for normal rows.
    parent_id: t.parent_id || t.parentId || null,
  }))
  const { data, error } = await supabase.from('r7_ledger_transactions').upsert(mapped, { onConflict: 'id' }).select('id')
  if (error) {
    console.error('upsertTransactions', error, { firstRow: mapped[0] })
    return { ok: false, saved: 0, error: error.message || String(error), rows: rows.length }
  }
  return { ok: true, saved: (data || []).length }
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from('r7_ledger_transactions').delete().eq('id', id)
  return !error
}

// ─── SPLIT TRANSACTIONS (PR4) ─────────────────────────────────────────────────
// A bank transaction can be split into multiple sub-rows that share the same
// underlying cash movement but classify their portions differently. Example:
// PAYROLL ACH $5,000 → wages $4,000 (Labor) + tips $1,000 (Tip Pass-Through).
//
// Storage model:
//   - The parent stays in r7_ledger_transactions with its original amount and
//     a NULL parent_id. It's the audit record of the actual bank line.
//   - Children are new r7_ledger_transactions rows with parent_id = parent.id.
//     They sum to the parent's amount (signed) and carry the real category_id.
//   - Frontend's makeLedgerFilter excludes parents that have at least one
//     child, so the parent contributes $0 to P&L roll-ups while children
//     contribute their amounts. Total stays correct, classification gets
//     better.
//
// ON DELETE CASCADE on parent_id means deleting the parent removes children
// automatically — preserves the invariant "sum of visible rows = ledger total".

export async function splitTransaction(parentId, children, tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return { ok: true, demo: true }

  // Build child rows. Each child gets a deterministic id derived from the
  // parent so re-saving the same split is idempotent.
  const now = Date.now()
  const mapped = children.map((c, i) => ({
    id: c.id || `split_${parentId}_${now}_${i}`,
    tenant_id: tid,
    date: c.date,
    description: c.description,
    amount: parseFloat(c.amount),
    category_id: ((c.category && c.category !== UNCATEGORIZED) ? c.category : c.category_id) || null,
    account_id: c.account_id || c.accountId || null,
    account: c.account || 'Split',
    reconciled: c.reconciled || false,
    tags: Array.isArray(c.tags) ? c.tags : [],
    source: c.source || 'split',
    notes: c.notes || '',
    parent_id: parentId,
  }))

  const { data, error } = await supabase
    .from('r7_ledger_transactions')
    .upsert(mapped, { onConflict: 'id' })
    .select('id')

  if (error) {
    console.error('splitTransaction', error, { firstRow: mapped[0] })
    return { ok: false, error: error.message || String(error) }
  }
  return { ok: true, saved: (data || []).length }
}

// Remove every split child of a parent, restoring the parent as a normal row
// that contributes its full amount to P&L. ON DELETE CASCADE would handle
// this automatically if the parent were deleted, but here we want to keep
// the parent and just drop the children.
export async function unsplitTransaction(parentId) {
  const { error } = await supabase
    .from('r7_ledger_transactions')
    .delete()
    .eq('parent_id', parentId)
  if (error) console.error('unsplitTransaction', error)
  return !error
}

// ─── CATEGORIES ───────────────────────────────────────────────────────────────
export async function fetchCategories(tenantId) {
  const { data, error } = await supabase.from('r7_ledger_accounts').select('*').eq('tenant_id', tenantId).order('type', { ascending: false })
  if (error) { console.error('fetchCategories', error); return [] }
  return data
}

export async function upsertCategory(row, tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return true
  const mapped = {
    id: row.id && !row.id.match(/^\d+$/) ? row.id : undefined,
    tenant_id: tid,
    name: row.name,
    type: row.type,
    color: row.color || '#555b6b',
    tax_line: row.taxLine || row.tax_line || '',
    is_default: row.is_default || false,
    is_eliminable: row.is_eliminable || false,
    eliminable_note: row.eliminable_note || null,
  }
  if (!mapped.id) delete mapped.id
  const { error } = await supabase.from('r7_ledger_accounts').upsert(mapped, { onConflict: 'id' })
  if (error) console.error('upsertCategory', error)
  return !error
}

export async function deleteCategory(id) {
  const { error } = await supabase.from('r7_ledger_accounts').delete().eq('id', id)
  return !error
}

// ─── BUDGETS ──────────────────────────────────────────────────────────────────
export async function fetchBudgets(tenantId) {
  const { data, error } = await supabase.from('r7_ledger_budgets').select('*').eq('tenant_id', tenantId)
  if (error) { console.error('fetchBudgets', error); return [] }
  return data
}

export async function upsertBudget(row, tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return true
  const mapped = {
    tenant_id: tid,
    category_id: row.categoryId || row.category_id,
    monthly: row.monthly || 0,
    annual: row.annual || 0,
    year: row.year || new Date().getFullYear(),
  }
  const { error } = await supabase.from('r7_ledger_budgets').upsert(mapped, { onConflict: 'tenant_id,category_id,year' })
  if (error) console.error('upsertBudget', error)
  return !error
}

// ─── PURCHASE WEEKLY BUDGET ───────────────────────────────────────────────────
// Teto semanal de compras: percentual da receita PREVISTA da semana, não um
// valor fixo. Mora em r7_purchase_budget_policy porque três apps mexem nele —
// CFO e CEO definem, Purchase obedece na hora de enviar PO.
export async function fetchPurchaseBudgetPolicy(tenantId) {
  const tid = tenantId || TENANT()
  const { data, error } = await supabase.from('r7_purchase_budget_policy').select('*').eq('tenant_id', tid).maybeSingle()
  if (error) { console.error('fetchPurchaseBudgetPolicy', error); return null }
  return data
}

export async function savePurchaseBudgetPolicy({ pct, enabled }, tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return true
  const { data: userData } = await supabase.auth.getUser()
  const { error } = await supabase.from('r7_purchase_budget_policy').upsert({
    tenant_id: tid,
    pct_of_forecast: pct,
    enabled,
    updated_by: userData?.user?.id || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id' })
  if (error) console.error('savePurchaseBudgetPolicy', error)
  return !error
}

// Quanto o percentual dá em dólares NESTA semana, e quanto já foi comprometido.
// Mesma RPC que o Purchase usa pra decidir — um número só, sem segunda conta.
export async function fetchPurchaseWeekBudget(tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return null
  const { data, error } = await supabase.rpc('pur_week_budget', { p_tenant: tid, p_week_start: null })
  if (error) { console.error('fetchPurchaseWeekBudget', error); return null }
  return data
}

// ─── BILLS ────────────────────────────────────────────────────────────────────
export async function fetchBills(tenantId) {
  const { data, error } = await supabase.from('r7_ledger_bills').select('*').eq('tenant_id', tenantId).order('due_date', { ascending: true })
  if (error) { console.error('fetchBills', error); return [] }
  return data
}

export async function upsertBill(row, tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return true
  const mapped = {
    id: row.id || undefined,
    tenant_id: tid,
    txn_id: row.txnId || null,
    vendor: row.vendor,
    amount: row.amount,
    due_date: row.dueDate,
    issue_date: row.issueDate || row.dueDate,
    status: row.status || 'due',
    category_id: row.category || null,
    paid_date: row.paidDate || null,
    paid_method: row.paidMethod || null,
    notes: row.notes || '',
    source: row.source || 'manual',
  }
  const { error } = await supabase.from('r7_ledger_bills').upsert(mapped, { onConflict: 'id' })
  if (error) console.error('upsertBill', error)
  return !error
}

export async function deleteBill(id) {
  const { error } = await supabase.from('r7_ledger_bills').delete().eq('id', id)
  return !error
}

// ─── PROJECTS ─────────────────────────────────────────────────────────────────
export async function fetchProjects(tenantId) {
  const { data, error } = await supabase.from('r7_ledger_projects').select('*').eq('tenant_id', tenantId).order('month', { ascending: true })
  if (error) { console.error('fetchProjects', error); return [] }
  return data
}

export async function upsertProject(row, tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return true
  const mapped = {
    id: row.id || undefined,
    tenant_id: tid,
    title: row.title,
    category: row.category || 'Other',
    month: row.month || new Date().getMonth() + 1,
    year: row.year || new Date().getFullYear(),
    status: row.status || 'Idea',
    impact: row.impact || 'Medium',
    investment: row.investment || 0,
    projected_revenue: row.projectedRevenue || 0,
    notes: row.notes || '',
    roi: row.roi || 0,
  }
  const { error } = await supabase.from('r7_ledger_projects').upsert(mapped, { onConflict: 'id' })
  if (error) console.error('upsertProject', error)
  return !error
}

export async function deleteProject(id) {
  const { error } = await supabase.from('r7_ledger_projects').delete().eq('id', id)
  return !error
}

// ─── BANK ACCOUNTS ────────────────────────────────────────────────────────────
export async function fetchBankAccounts(tenantId) {
  const { data, error } = await supabase.from('r7_ledger_bank_accounts').select('*').eq('tenant_id', tenantId).order('name')
  if (error) { console.error('fetchBankAccounts', error); return [] }
  return data
}

export async function upsertBankAccount(row, tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return true
  const mapped = {
    id: row.id || undefined,
    tenant_id: tid,
    name: row.name,
    type: row.type || 'checking',
    institution: row.institution || '',
    opening_balance: parseFloat(row.openingBalance ?? row.opening_balance ?? 0),
    opening_date: row.openingDate || row.opening_date || new Date().toISOString().split('T')[0],
    credit_limit: row.creditLimit != null && row.creditLimit !== '' ? parseFloat(row.creditLimit) : (row.credit_limit ?? null),
    status: row.status || 'active',
    notes: row.notes || '',
  }
  if (!mapped.id) delete mapped.id
  const { error } = await supabase.from('r7_ledger_bank_accounts').upsert(mapped, { onConflict: 'id' })
  if (error) console.error('upsertBankAccount', error)
  return !error
}

export async function deleteBankAccount(id) {
  const { error } = await supabase.from('r7_ledger_bank_accounts').delete().eq('id', id)
  return !error
}

// ─── RECURRING ────────────────────────────────────────────────────────────────
export async function fetchRecurring(tenantId) {
  const { data, error } = await supabase.from('r7_ledger_recurring').select('*').eq('tenant_id', tenantId).order('name')
  if (error) { console.error('fetchRecurring', error); return [] }
  return data
}

export async function upsertRecurring(row, tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return true
  const mapped = {
    id: row.id || undefined,
    tenant_id: tid,
    name: row.name,
    vendor_pattern: row.vendorPattern || row.vendor_pattern || '',
    category_id: row.categoryId || row.category_id || null,
    account: row.account || '',
    amount: parseFloat(row.amount) || 0,
    variance_pct: parseFloat(row.variancePct ?? row.variance_pct ?? 10),
    cadence: row.cadence || 'monthly',
    day_of_month: row.dayOfMonth ?? row.day_of_month ?? null,
    day_of_week: row.dayOfWeek ?? row.day_of_week ?? null,
    start_date: row.startDate || row.start_date || new Date().toISOString().split('T')[0],
    end_date: row.endDate || row.end_date || null,
    status: row.status || 'active',
    notes: row.notes || '',
  }
  if (!mapped.id) delete mapped.id
  const { error } = await supabase.from('r7_ledger_recurring').upsert(mapped, { onConflict: 'id' })
  if (error) console.error('upsertRecurring', error)
  return !error
}

export async function deleteRecurring(id) {
  const { error } = await supabase.from('r7_ledger_recurring').delete().eq('id', id)
  return !error
}

// ─── KITCHEN BRIDGE ───────────────────────────────────────────────────────────
// r7_purchases columns are: id, user_id, date, supplier, "vendorId" (camelCase!),
// items, total, invoice_path, tenant_id, ... Selecting * because the legacy
// names (vendor_id, status, invoice_url) don't exist on this table and used
// to silently 400-out — see ROADMAP "Bug hunt round 2".
export async function fetchKitchenPurchases(tenantId, { start, end } = {}) {
  let q = supabase.from('r7_purchases').select('*').eq('tenant_id', tenantId).order('date', { ascending: false })
  if (start) q = q.gte('date', start)
  if (end)   q = q.lte('date', end)
  const { data, error } = await q
  if (error) { console.error('fetchKitchenPurchases', error); return [] }
  return data
}

// NOTE: r7_snapshots is the Kitchen *inventory* snapshot table (label + counts),
// not Square POS revenue. The old fetchKitchenSnapshots / snapshotsToTransactions
// pair selected non-existent columns and was removed. Revenue now comes from
// "Sync Sales" (api/sync-square-sales). fetchKitchenStaff was also removed —
// r7_staff has no hourly_rate column, and labor rates come from Square Labor.

// ─── KITCHEN LINE-ITEM ALLOCATION ────────────────────────────────────────────
// A single bank debit for a Restaurant Depot run covers food AND cleaning
// supplies. Kitchen already knows which is which -- every line item carries
// _mappedItemId -> r7_items.catId -> r7_categories -- so the CFO does not have
// to ask the operator to split by hand. 42% of TorresBee's invoices since
// jul/2026 are mixed.
//
// r7_purchases.items is a JSON string stored in a text column, so it needs
// parsing twice in the worst case (the column holds an encoded string, not an
// array). Tolerate both shapes rather than guessing.
function parseItems(raw) {
  let v = raw
  for (let i = 0; i < 2 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v) } catch { return [] }
  }
  return Array.isArray(v) ? v : []
}

// The line's share of the invoice is qty * _landedUnitCost, NOT extendedPrice.
// extendedPrice has nulls and on several lines carries the UNIT price where the
// extended one belongs -- on one $215.59 Restaurant Depot invoice the column
// summed to $95.84. _landedUnitCost is what Kitchen produces after allocating
// tax and freight across the lines: over the last 120 invoices it reproduced
// the invoice total every time, worst case off by a cent.
function lineValue(it) {
  const qty = parseFloat(it?.qty)
  const landed = parseFloat(it?._landedUnitCost)
  const unit = parseFloat(it?.unitCost)
  const cost = Number.isFinite(landed) ? landed : unit
  if (!Number.isFinite(qty) || !Number.isFinite(cost)) return 0
  return qty * cost
}

/**
 * Category breakdown for one Kitchen purchase, as ledger account ids.
 *
 * @returns {Promise<Array<{categoryId: string|null, amount: number}>>} buckets
 *   in descending value. categoryId null = the item has no Kitchen category, or
 *   its category has no entry in the map. Those are NOT dropped and NOT folded
 *   into the biggest bucket: they surface as an uncategorized child so the
 *   operator sees what is unclassified instead of it hiding inside food cost.
 *   (~9.6% of value today, and it shrinks as Kitchen maps its items.)
 *   Returns [] when the purchase is missing or has no usable lines.
 */
export async function fetchPurchaseAllocation(purchaseId, tenantId) {
  const tid = tenantId || TENANT()
  if (!purchaseId || tid === 'demo') return []

  const { data: pur, error: pErr } = await supabase
    .from('r7_purchases').select('id, supplier, items').eq('id', purchaseId).eq('tenant_id', tid).maybeSingle()
  if (pErr || !pur) { if (pErr) console.error('fetchPurchaseAllocation/purchase', pErr); return [] }

  const all = await fetchPurchaseAllocations([pur], tid)
  return all.get(String(pur.id)) || []
}

// ─── ITEM → ACCOUNT RESOLUTION ───────────────────────────────────────────────
// Three sources decide which ledger account an invoice line belongs to, in
// this order:
//   1. a CFO item rule (r7_ledger_item_rules) -- the operator said so, once,
//      in the invoice panel; vendor-specific beats global
//   2. the Kitchen path: item → r7_items.catId → r7_ledger_kitchen_category_map
//   3. nothing → null, which becomes an UNCATEGORIZED child
// Rules come first because they exist precisely for the lines the Kitchen
// path cannot resolve, and because an explicit decision outranks a mapping.

// Normalisation is deliberately dumb: uppercase, letters/digits/space only,
// collapsed whitespace. "Black Pepper" and "BLACK PEPPER 16OZ" are different
// keys. When a key does not match the line goes back to Uncategorized and the
// operator clicks again -- better than a fuzzy rule that is wrong in silence.
export function normalizeItemKey(name) {
  return String(name || '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}
export function normalizeVendorKey(name) {
  return normalizeItemKey(name)
}
const ruleKey = (vendorKey, itemKey) => `${vendorKey || ''}|${itemKey}`

// Rules keyed by something other than an item name, kept in the same table
// (item_key is free text):
//   ITEM:<kitchen item id> -- every line Kitchen resolves to that item, whatever
//     the vendor prints. Needed when the item shares a Kitchen category with
//     things that belong elsewhere: "Keg Deposit" sits in the same category as
//     napkins and to-go boxes, so mapping the category would move them all.
//   CHARGE:<KIND> -- an invoice-level charge of that kind (r7_purchases.charges)
//     is booked to the rule's account instead of being spread over the lines.
//     Kitchen allocates every charge into _landedUnitCost; a keg deposit read as
//     "Total Deposit $150" turned $98 of beer into $148 of beer.
export const ITEM_RULE_PREFIX = 'ITEM:'
export const CHARGE_RULE_PREFIX = 'CHARGE:'

export async function fetchItemRules(tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return []
  const { data, error } = await supabase
    .from('r7_ledger_item_rules').select('item_key, vendor_key, ledger_account_id').eq('tenant_id', tid)
  if (error) { console.error('fetchItemRules', error); return [] }
  return data || []
}

export async function upsertItemRule({ itemName, vendorName = null, ledgerAccountId }, tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return { ok: true, demo: true }
  const row = {
    tenant_id: tid,
    item_key: normalizeItemKey(itemName),
    vendor_key: vendorName ? normalizeVendorKey(vendorName) : '',
    ledger_account_id: ledgerAccountId,
  }
  if (!row.item_key || !row.ledger_account_id) return { ok: false, error: 'item name and account are required' }
  const { error } = await supabase
    .from('r7_ledger_item_rules').upsert(row, { onConflict: 'tenant_id,item_key,vendor_key' })
  if (error) { console.error('upsertItemRule', error); return { ok: false, error: error.message } }
  return { ok: true, row }
}

// A Kitchen category the operator maps from the invoice panel. One entry
// settles every item in that category, on every invoice, from now on.
export async function upsertKitchenCategoryMap(kitchenCategoryId, ledgerAccountId, tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return { ok: true, demo: true }
  if (!kitchenCategoryId || !ledgerAccountId) return { ok: false, error: 'category and account are required' }
  const { error } = await supabase
    .from('r7_ledger_kitchen_category_map')
    .upsert({ tenant_id: tid, kitchen_category_id: String(kitchenCategoryId), ledger_account_id: ledgerAccountId },
            { onConflict: 'tenant_id,kitchen_category_id' })
  if (error) { console.error('upsertKitchenCategoryMap', error); return { ok: false, error: error.message } }
  return { ok: true }
}

// Everything the resolver needs, fetched once for a batch of purchases.
async function loadResolutionContext(purchases, tid) {
  const itemsByPurchase = new Map()
  const mappedIds = new Set()
  for (const p of purchases) {
    const items = parseItems(p?.items)
    if (items.length === 0) continue
    itemsByPurchase.set(String(p.id), items)
    for (const it of items) if (it?._mappedItemId) mappedIds.add(String(it._mappedItemId))
  }

  // The whole item catalogue, not just the ids the invoice lines point at.
  // Kitchen's scanner leaves _mappedItemId empty on lines whose item it
  // already knows (TorresBee: 101 such lines since Jul/2026, 57 of them for
  // items that exist, with category), so we need the catalogue to find the
  // item by the vendor's product code or by exact name. 423 rows for the
  // pilot; one query.
  const catByItem = new Map()
  const byCode = new Map()   // vendor product code → Set<item id>
  const byName = new Map()   // normalised name     → Set<item id>
  const { data: catalogue, error: cErr } = await supabase
    .from('r7_items').select('id, name, recipeName, catId, sku, vendors').eq('tenant_id', tid)
  if (cErr) console.error('loadResolutionContext/items', cErr)
  const addKey = (map, key, id) => { if (!key) return; if (!map.has(key)) map.set(key, new Set()); map.get(key).add(id) }
  for (const r of (catalogue || [])) {
    const id = String(r.id)
    catByItem.set(id, r.catId == null ? null : String(r.catId))
    addKey(byName, normalizeItemKey(r.name), id)
    addKey(byName, normalizeItemKey(r.recipeName), id)
    addKey(byCode, String(r.sku || '').trim(), id)
    for (const v of parseItems(r.vendors)) {
      addKey(byCode, String(v?.code || '').trim(), id)
      addKey(byName, normalizeItemKey(v?.invoiceName), id)
    }
  }
  // Any mapped id the catalogue did not return (deleted item) resolves to nothing.
  for (const id of mappedIds) if (!catByItem.has(id)) catByItem.set(id, null)

  const { data: mapRows, error: mErr } = await supabase
    .from('r7_ledger_kitchen_category_map')
    .select('kitchen_category_id, ledger_account_id').eq('tenant_id', tid)
  if (mErr) console.error('loadResolutionContext/map', mErr)
  const acctByCat = new Map((mapRows || []).map(r => [String(r.kitchen_category_id), r.ledger_account_id]))

  const rules = new Map((await fetchItemRules(tid)).map(r => [ruleKey(r.vendor_key, r.item_key), r.ledger_account_id]))

  return { itemsByPurchase, catByItem, byCode, byName, acctByCat, rules }
}

// One Kitchen item (never a guess) for a line the scanner did not link:
//   1. the line's _mappedItemId, when Kitchen did link it
//   2. the vendor's product code on the line, against the codes Kitchen keeps
//      on the item (r7_items.vendors[].code, sku)
//   3. the line's exact normalised name, against item name, recipe name and
//      the invoice names Kitchen has seen for it
// A key that points at two items with DIFFERENT categories is ambiguous and
// is skipped -- the line stays unresolved and asks for a decision. Two items
// in the same category are fine: the account is the same either way.
function findKitchenItem(line, ctx) {
  if (line?._mappedItemId) return { itemId: String(line._mappedItemId), via: 'invoice' }
  const pick = (ids) => {
    if (!ids || ids.size === 0) return null
    const cats = new Set([...ids].map(id => ctx.catByItem.get(id) ?? null))
    if (cats.size !== 1) return null
    return [...ids][0]
  }
  const code = String(line?.productCode || '').trim()
  if (code && ctx.byCode) {
    const id = pick(ctx.byCode.get(code))
    if (id) return { itemId: id, via: 'code' }
  }
  const key = normalizeItemKey(line?.name)
  if (key && ctx.byName) {
    const id = pick(ctx.byName.get(key))
    if (id) return { itemId: id, via: 'name' }
  }
  return null
}

// One invoice line → { accountId, kitchenCatId, resolvedBy }.
export function resolveLineAccount(line, vendorName, ctx) {
  const itemKey = normalizeItemKey(line?.name)
  const vendorKey = normalizeVendorKey(vendorName)
  if (itemKey) {
    const specific = ctx.rules.get(ruleKey(vendorKey, itemKey))
    if (specific) return { accountId: specific, kitchenCatId: null, resolvedBy: 'rule' }
    const global = ctx.rules.get(ruleKey('', itemKey))
    if (global) return { accountId: global, kitchenCatId: null, resolvedBy: 'rule' }
  }
  const hit = findKitchenItem(line, ctx)
  const kcat = hit ? (ctx.catByItem.get(hit.itemId) ?? null) : null
  const byItem = hit ? ctx.rules.get(ruleKey('', ITEM_RULE_PREFIX + hit.itemId)) : null
  if (byItem) return { accountId: byItem, kitchenCatId: kcat, resolvedBy: 'rule', kitchenVia: hit.via, kitchenItemId: hit.itemId }
  if (kcat) {
    const acct = ctx.acctByCat.get(kcat) || null
    return { accountId: acct, kitchenCatId: kcat, resolvedBy: acct ? 'kitchen' : null, kitchenVia: hit.via, kitchenItemId: hit.itemId }
  }
  return { accountId: null, kitchenCatId: null, resolvedBy: null, kitchenVia: hit ? hit.via : null, kitchenItemId: hit ? hit.itemId : null }
}

// Invoice charges that a CHARGE:<KIND> rule sends to their own account.
// Returns, per line, how much of its _chargeAlloc to take back out of its
// landed value, and the charges as extra lines carrying the rule's account.
// When Kitchen did not spread the charges (no _chargeAlloc), nothing comes out
// of the lines; the charge lines still stand on their own and the proration
// to the invoice total does the rest.
export function carveRuledCharges(items, charges, rules) {
  const deductions = (items || []).map(() => 0)
  const chargeLines = []
  for (const c of parseItems(charges)) {
    const amount = parseFloat(c?.amount) || 0
    const kind = String(c?.kind || '').trim().toUpperCase()
    const accountId = kind ? rules.get(ruleKey('', CHARGE_RULE_PREFIX + kind)) : null
    if (!amount || !accountId) continue
    chargeLines.push({ kind, label: String(c?.label || kind).trim(), amount, accountId })
  }
  const carved = chargeLines.reduce((s, c) => s + c.amount, 0)
  const spread = (items || []).reduce((s, it) => s + (parseFloat(it?._chargeAlloc) || 0), 0)
  if (carved > 0 && spread > 0) {
    const ratio = Math.min(1, carved / spread)
    ;(items || []).forEach((it, i) => { deductions[i] = (parseFloat(it?._chargeAlloc) || 0) * ratio })
  }
  return { deductions, chargeLines }
}

// Sum lines into { categoryId, amount } buckets, descending.
export function bucketsFromLines(lines) {
  const buckets = new Map()
  for (const l of lines) {
    const v = parseFloat(l.landed) || 0
    if (v === 0) continue
    buckets.set(l.accountId || null, (buckets.get(l.accountId || null) || 0) + v)
  }
  return [...buckets.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount }))
    .filter(b => Math.abs(b.amount) > 0.0001)
    .sort((a, b) => b.amount - a.amount)
}

/**
 * Per-account breakdown for MANY purchases in four queries instead of four per
 * purchase. Sync Kitchen runs this over every invoice in the date range (75 in
 * a month at TorresBee).
 *
 * @param purchases rows from r7_purchases that carry `items` and `supplier`
 *   (fetchKitchenPurchases selects *, so they do)
 * @returns {Promise<Map<string, Array<{categoryId, amount}>>>} keyed by purchase id.
 *   A purchase with no usable line items is absent from the map -- the caller
 *   falls back to the single-category shadow.
 */
export async function fetchPurchaseAllocations(purchases, tenantId) {
  const tid = tenantId || TENANT()
  const out = new Map()
  if (tid === 'demo' || !purchases || purchases.length === 0) return out

  const ctx = await loadResolutionContext(purchases, tid)
  if (ctx.itemsByPurchase.size === 0) return out

  const byId = new Map(purchases.map(p => [String(p.id), p]))
  for (const [pid, items] of ctx.itemsByPurchase) {
    const pur = byId.get(pid) || {}
    const { deductions, chargeLines } = carveRuledCharges(items, pur.charges, ctx.rules)
    const lines = [
      ...items.map((it, i) => ({ landed: lineValue(it) - deductions[i], ...resolveLineAccount(it, pur.supplier || '', ctx) })),
      ...chargeLines.map(c => ({ landed: c.amount, accountId: c.accountId })),
    ]
    const list = bucketsFromLines(lines)
    if (list.length > 0) out.set(pid, list)
  }
  return out
}

/**
 * The invoice as the operator sees it in the Transactions panel: every line
 * with its Kitchen category (name included) and the ledger account the
 * resolver lands on, plus why. Also returns the purchase header so the panel
 * can re-split the shadow without a second round trip.
 */
export async function fetchPurchaseLines(purchaseId, tenantId) {
  const tid = tenantId || TENANT()
  if (!purchaseId || tid === 'demo') return null

  const { data: pur, error: pErr } = await supabase
    .from('r7_purchases').select('id, date, supplier, total, items, charges, invoice_path').eq('id', purchaseId).eq('tenant_id', tid).maybeSingle()
  if (pErr || !pur) { if (pErr) console.error('fetchPurchaseLines/purchase', pErr); return null }

  const ctx = await loadResolutionContext([pur], tid)
  const items = ctx.itemsByPurchase.get(String(pur.id)) || []

  const resolved = items.map(it => resolveLineAccount(it, pur.supplier, ctx))
  const catIds = [...new Set(resolved.map(r => r.kitchenCatId).filter(Boolean))]
  const catNames = new Map()
  if (catIds.length > 0) {
    const { data: cats, error } = await supabase
      .from('r7_categories').select('id, name').eq('tenant_id', tid).in('id', catIds)
    if (error) console.error('fetchPurchaseLines/categories', error)
    for (const c of (cats || [])) catNames.set(String(c.id), String(c.name || '').trim())
  }

  const { deductions, chargeLines } = carveRuledCharges(items, pur.charges, ctx.rules)
  const lines = items.map((it, idx) => {
    const r = resolved[idx]
    const kcat = r.kitchenCatId
    return {
      idx,
      name: String(it?.name || '').trim() || '(unnamed line)',
      qty: parseFloat(it?.qty) || 0,
      unit: it?.unit || '',
      landed: lineValue(it) - deductions[idx],
      productCode: it?.productCode ? String(it.productCode) : null,
      mappedItemId: r.kitchenItemId || null,
      // 'invoice' = Kitchen linked the line; 'code' / 'name' = the CFO found
      // the item in the catalogue; null = no item at all.
      kitchenVia: r.kitchenVia || null,
      kitchenCatId: kcat,
      kitchenCatName: kcat ? (catNames.get(kcat) || kcat) : null,
      accountId: r.accountId,
      resolvedBy: r.resolvedBy,
    }
  })
  // Charges a CHARGE:<KIND> rule took out of the lines, shown as their own
  // lines so the panel's total still matches the invoice.
  chargeLines.forEach((c, k) => lines.push({
    idx: items.length + k,
    name: `${c.label} (invoice charge)`,
    qty: 1, unit: '', landed: c.amount, productCode: null, mappedItemId: null,
    kitchenVia: null, kitchenCatId: null, kitchenCatName: null,
    accountId: c.accountId, resolvedBy: 'rule', isCharge: true,
  }))

  return {
    purchase: { id: String(pur.id), date: pur.date, supplier: pur.supplier || '', total: parseFloat(pur.total) || 0, invoice_path: pur.invoice_path || null },
    lines,
  }
}

/**
 * Scale a breakdown to the amount that actually left the bank and round to
 * cents. The bank debit rarely equals the invoice to the penny -- a card fee, a
 * partial payment, a credit applied at the register -- and the ledger's split
 * is only valid if the children sum EXACTLY to the parent. So prorate, then put
 * the rounding residual on the largest bucket, where it is proportionally
 * smallest.
 *
 * Returns [] if the breakdown is degenerate (single bucket, or no value), since
 * a one-category "split" is just a category.
 */
export function prorateAllocation(buckets, targetAbsAmount) {
  const total = (buckets || []).reduce((s, b) => s + b.amount, 0)
  const target = Math.abs(parseFloat(targetAbsAmount) || 0)
  if (!(total > 0) || !(target > 0) || (buckets || []).length < 2) return []

  const scaled = buckets.map(b => ({
    categoryId: b.categoryId,
    amount: Math.round((b.amount / total) * target * 100) / 100,
  }))
  const drift = Math.round((target - scaled.reduce((s, b) => s + b.amount, 0)) * 100) / 100
  if (drift !== 0) scaled[0].amount = Math.round((scaled[0].amount + drift) * 100) / 100
  return scaled.filter(b => b.amount !== 0)
}

export async function fetchKitchenVendors(tenantId) {
  const { data, error } = await supabase.from('r7_vendors').select('id, name, email, phone').eq('tenant_id', tenantId).order('name')
  if (error) { console.error('fetchKitchenVendors', error); return [] }
  return data
}

// Dinheiro recebido por dia (tender CASH do Square). Referência para conferir
// contra o depósito de caixa no banco -- não é lançamento, a venda já está na
// receita via sq_sale_<data>.
export async function fetchSquareCashDaily(tenantId, { start, end } = {}) {
  let q = supabase.from('r7_square_cash_daily').select('date, cash_cents, payments')
    .eq('tenant_id', tenantId).order('date')
  if (start) q = q.gte('date', start)
  if (end)   q = q.lte('date', end)
  const { data, error } = await q
  if (error) { console.error('fetchSquareCashDaily', error); return [] }
  return data || []
}

export async function fetchTenant(tenantId) {
  const { data, error } = await supabase.from('r7_tenants').select('*').eq('id', tenantId).single()
  if (error) { console.error('fetchTenant', error); return null }
  return data
}

// ─── CEO COCKPIT (ROI) ────────────────────────────────────────────────────────
// One row per tenant. Returns { ok, row } and NOT just the row, because the
// caller has to tell "this tenant has nothing saved yet, migrate the browser's
// copy up" from "the read failed" — uploading local state on a failed read
// would overwrite good remote data from whichever device happened to be open.
// ok=false also covers the table not existing yet (migration not applied), in
// which case the screen keeps running on localStorage exactly like before.
export async function fetchCeoRoi(tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return { ok: false, row: null }
  const { data, error } = await supabase.from('r7_ledger_ceo_roi')
    .select('rate, weeks, machines').eq('tenant_id', tid).maybeSingle()
  if (error) { console.error('fetchCeoRoi', error); return { ok: false, row: null } }
  if (!data) return { ok: true, row: null }
  return {
    ok: true,
    row: {
      rate: Number(data.rate),
      weeks: Number(data.weeks),
      machines: Array.isArray(data.machines) ? data.machines : [],
    },
  }
}

export async function saveCeoRoi({ rate, weeks, machines }, tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return true
  const { error } = await supabase.from('r7_ledger_ceo_roi').upsert({
    tenant_id: tid,
    rate: Number(rate) || 0,
    weeks: Number(weeks) || 0,
    machines: Array.isArray(machines) ? machines : [],
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id' })
  if (error) console.error('saveCeoRoi', error)
  return !error
}

// ─── LABOR TIPS ───────────────────────────────────────────────────────────────
export async function fetchTipsDaily(tenantId, { start, end } = {}) {
  let q = supabase.from('r7_labor_tips_daily').select('*').eq('tenant_id', tenantId).order('date', { ascending: false })
  if (start) q = q.gte('date', start)
  if (end)   q = q.lte('date', end)
  const { data, error } = await q.limit(5000)
  if (error) { console.error('fetchTipsDaily', error); return [] }
  return data
}

export async function syncSquareSales(tenantId, range = {}) {
  const res = await fetch('/api/sync-square-sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, start: range.start, end: range.end }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Server error ' + res.status }))
    throw new Error(err.error || 'Server error ' + res.status)
  }
  return await res.json()
}

// ─── PLAID (bank connection) ──────────────────────────────────────────────────
// Three thin wrappers over the /api/plaid-* serverless functions. The access
// token never touches the browser — these only move public tokens and counts.
/**
 * @param {string} tenantId
 * @param {'create'|'update'} mode 'update' re-authenticates the EXISTING Plaid
 *   item -- same item_id, same access_token, same transaction ids, same cursor,
 *   so nothing re-imports. 'create' (default) links a bank for the first time.
 *   Throws 'no_active_item' if asked to update with nothing connected.
 */
export async function createPlaidLinkToken(tenantId, mode = 'create') {
  const res = await fetch('/api/plaid-link-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, mode }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Server error ' + res.status }))
    throw new Error(err.error || 'Server error ' + res.status)
  }
  return await res.json()
}

export async function exchangePlaidPublicToken(tenantId, publicToken, institutionName, institutionId) {
  const res = await fetch('/api/plaid-exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, public_token: publicToken, institution_name: institutionName, institution_id: institutionId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Server error ' + res.status }))
    throw new Error(err.error || 'Server error ' + res.status)
  }
  return await res.json()
}

export async function syncPlaidTransactions(tenantId) {
  const res = await fetch('/api/plaid-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Server error ' + res.status }))
    throw new Error(err.error || 'Server error ' + res.status)
  }
  return await res.json()
}

// ─── FAVO BANK (Unit embedded banking) ───────────────────────────────────────
// Thin wrappers over the /api/unit-* serverless functions. The Unit org token
// stays server-side; these only move tenant_id + amounts + counts, never secrets.
export async function onboardFavoBank(tenantId, profile) {
  const res = await fetch('/api/unit-onboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, profile }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Server error ' + res.status }))
    throw new Error(err.error || 'Server error ' + res.status)
  }
  return await res.json()
}

export async function fetchFavoBankState(tenantId) {
  const res = await fetch('/api/unit-accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Server error ' + res.status }))
    throw new Error(err.error || 'Server error ' + res.status)
  }
  return await res.json()
}

export async function syncFavoBank(tenantId) {
  const res = await fetch('/api/unit-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Server error ' + res.status }))
    throw new Error(err.error || 'Server error ' + res.status)
  }
  return await res.json()
}

export async function transferFavoBank(tenantId, fromPurpose, toPurpose, amount, description) {
  const res = await fetch('/api/unit-transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, from_purpose: fromPurpose, to_purpose: toPurpose, amount, description }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Server error ' + res.status }))
    throw new Error(err.error || 'Server error ' + res.status)
  }
  return await res.json()
}

// Square Payouts — the "money hitting the bank" feed. Used by the
// Reconciliation screen to confirm every Square liquidation actually landed
// in the bank account (PR1 = visibility, PR2 = auto-match).
export async function fetchSquarePayouts(tenantId, { start, end } = {}) {
  let q = supabase.from('r7_square_payouts').select('*').eq('tenant_id', tenantId).order('arrival_date', { ascending: false })
  if (start) q = q.gte('arrival_date', start)
  if (end)   q = q.lte('arrival_date', end)
  const { data, error } = await q
  if (error) { console.error('fetchSquarePayouts', error); return [] }
  return data || []
}

// Aggregator payouts (DoorDash / UberEats / GrubHub / Wix) ingested from
// monthly statements. Used by the Reconciliation screen to show payout vs
// bank deposit per platform and to track real commissions instead of
// estimating them.
export async function fetchAggregatorPayouts(tenantId, { start, end } = {}) {
  let q = supabase.from('r7_aggregator_payouts').select('*').eq('tenant_id', tenantId).order('arrival_date', { ascending: false })
  if (start) q = q.gte('arrival_date', start)
  if (end)   q = q.lte('arrival_date', end)
  const { data, error } = await q
  if (error) { console.error('fetchAggregatorPayouts', error); return [] }
  return data || []
}

// Delete an aggregator payout AND its associated ledger entries (commission /
// marketing rows that were auto-created by saveAggregatorPayouts). Ledger
// entries are identified by id prefix `agg_<platform>_<payout_key>_`, where
// payout_key matches the payout row's `id` suffix.
// Ledger entries created by saveAggregatorPayouts use id = `agg_${payout.id}_<bucket>`
// where payout.id is the r7_aggregator_payouts row id. So the prefix to find
// every linked ledger row is `agg_${payout.id}_`. This stays consistent
// regardless of whether the platform statement included a payout_id field.
export async function deleteAggregatorPayout(id, tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return { ok: true, demo: true }
  const ledgerPrefix = `agg_${id}_`
  await supabase
    .from('r7_ledger_transactions')
    .delete()
    .eq('tenant_id', tid)
    .like('id', ledgerPrefix + '%')
  const { error } = await supabase.from('r7_aggregator_payouts').delete().eq('id', id)
  if (error) { console.error('deleteAggregatorPayout', error); return { ok: false, error: error.message } }
  return { ok: true }
}

export async function updateAggregatorPayoutDate(id, newDate, tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return { ok: true, demo: true }
  const ledgerPrefix = `agg_${id}_`
  const { error: pErr } = await supabase
    .from('r7_aggregator_payouts')
    .update({ arrival_date: newDate })
    .eq('id', id)
  if (pErr) { console.error('updateAggregatorPayoutDate payout', pErr); return { ok: false, error: pErr.message } }
  await supabase
    .from('r7_ledger_transactions')
    .update({ date: newDate })
    .eq('tenant_id', tid)
    .like('id', ledgerPrefix + '%')
  return { ok: true }
}

export async function upsertAggregatorPayouts(rows, tenantId) {
  if (!rows || rows.length === 0) return { ok: true, saved: 0 }
  const tid = tenantId || TENANT()
  if (tid === 'demo') return { ok: true, saved: rows.length, demo: true }
  const mapped = rows.map(r => ({ ...r, tenant_id: tid }))
  const { data, error } = await supabase.from('r7_aggregator_payouts').upsert(mapped, { onConflict: 'id' }).select('id')
  if (error) { console.error('upsertAggregatorPayouts', error); return { ok: false, error: error.message } }
  return { ok: true, saved: (data || []).length }
}

// Headers pros endpoints de IA (/api/parse-*): JWT do usuario + tenant ativo.
// O servidor valida os dois contra o portao do CFO (r7_get_my_cfo_tenant_ids).
export async function aiAuthHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Session expired — please sign in again')
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const tid = TENANT()
  if (tid && tid !== 'demo') headers['X-Tenant-Id'] = tid
  return headers
}

// Parse a delivery aggregator statement (PDF/CSV) via the Anthropic-backed
// endpoint. Returns the normalized envelope; caller persists what it wants.
export async function parseAggregatorStatement({ pdfBase64, csvText, filename, platformHint }) {
  const res = await fetch('/api/parse-aggregator-statement', {
    method: 'POST',
    headers: await aiAuthHeaders(),
    body: JSON.stringify({ pdfBase64, csvText, filename, platformHint }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Server error ' + res.status }))
    throw new Error(err.error || 'Server error ' + res.status)
  }
  return await res.json()
}

export async function syncSquarePayouts(tenantId, range = {}) {
  const res = await fetch('/api/sync-square-payouts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, start: range.start, end: range.end }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Server error ' + res.status }))
    throw new Error(err.error || 'Server error ' + res.status)
  }
  return await res.json()
}

export async function syncSquareTips(tenantId, range = {}) {
  const res = await fetch('/api/sync-square-tips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, start: range.start, end: range.end }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Server error ' + res.status }))
    throw new Error(err.error || 'Server error ' + res.status)
  }
  return await res.json()
}

export async function applyTipPool(rowsByEmployee, tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return { ok: true, demo: true }
  // rowsByEmployee = [{ date, team_member_id, employee_name, card_tips, pool_share, pool_method, pool_participant_count, pool_total }]
  const stamped = rowsByEmployee.map(r => ({
    ...r,
    tenant_id: tid,
    updated_at: new Date().toISOString(),
  }))
  const { error } = await supabase
    .from('r7_labor_tips_daily')
    .upsert(stamped, { onConflict: 'tenant_id,date,team_member_id' })
  if (error) { console.error('applyTipPool', error); return { ok: false, error: error.message } }
  return { ok: true }
}

// ─── PAYROLL RUNS ─────────────────────────────────────────────────────────────
export async function fetchPayrollRuns(tenantId) {
  const { data, error } = await supabase.from('r7_payroll_runs').select('*').eq('tenant_id', tenantId).order('period_end', { ascending: false })
  if (error) { console.error('fetchPayrollRuns', error); return [] }
  return data
}

export async function upsertPayrollRun(row, tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return { ok: true, demo: true }
  const mapped = {
    id: row.id || undefined,
    tenant_id: tid,
    period_start: row.period_start || row.periodStart,
    period_end: row.period_end || row.periodEnd,
    pay_date: row.pay_date || row.payDate || null,
    status: row.status || 'draft',
    lines: row.lines || [],
    totals: row.totals || {},
    notes: row.notes || '',
    submitted_at: row.submitted_at || row.submittedAt || null,
    reconciled_txn_id: row.reconciled_txn_id || row.reconciledTxnId || null,
    updated_at: new Date().toISOString(),
  }
  if (!mapped.id) delete mapped.id
  const { data, error } = await supabase.from('r7_payroll_runs').upsert(mapped, { onConflict: 'id' }).select('*').maybeSingle()
  if (error) { console.error('upsertPayrollRun', error); return { ok: false, error: error.message } }
  return { ok: true, data }
}

export async function deletePayrollRun(id) {
  const { error } = await supabase.from('r7_payroll_runs').delete().eq('id', id)
  return !error
}

// ─── SQUARE LABOR ─────────────────────────────────────────────────────────────
export async function fetchLaborShifts(tenantId, { start, end } = {}) {
  let q = supabase.from('r7_labor_shifts').select('*').eq('tenant_id', tenantId).order('start_at', { ascending: false })
  if (start) q = q.gte('start_at', start)
  if (end)   q = q.lte('start_at', end + 'T23:59:59.999Z')
  const { data, error } = await q.limit(2000)
  if (error) { console.error('fetchLaborShifts', error); return [] }
  // Square-mirror rows get an explicit source tag so they're
  // distinguishable from POS-native punch shifts downstream.
  return data.map(s => ({ ...s, source: 'square' }))
}

// ─── POS-NATIVE PUNCH SHIFTS (bridge: favo-pos team mgmt #21.3) ───
// Reads pos_time_punches from Favo POS and pairs adjacent
// clock_in/clock_out per staff into shift rows shaped like
// r7_labor_shifts (start_at, end_at, hours, employee_name, …) so the
// Labor screen can render them alongside Square shifts. Wage fields
// are zero until pos_staff carries an hourly_rate column — surface
// the rows as "uncosted POS punches" in the UI when that day comes.
// See docs/2026-05-team-management.md in favo-pos for the contract.
export async function fetchPosPunchShifts(tenantId, { start, end } = {}) {
  let pq = supabase
    .from('pos_time_punches')
    .select('id, staff_id, kind, at')
    .eq('tenant_id', tenantId)
    .in('kind', ['clock_in', 'clock_out'])
    .order('at', { ascending: true })
  if (start) pq = pq.gte('at', start)
  if (end)   pq = pq.lte('at', end + 'T23:59:59.999Z')
  const { data: punches, error: pErr } = await pq.limit(5000)
  if (pErr) {
    // Table may not exist on a tenant whose POS isn't deployed yet — silent.
    if (pErr.code !== '42P01') console.error('fetchPosPunchShifts', pErr)
    return []
  }
  if (!punches || punches.length === 0) return []

  // Hydrate staff names + hourly rate in one round trip. pos_staff lives
  // in the same Supabase project (Kitchen-shared) so we read directly.
  // hourly_rate_cents (migration 0034) is NULL until manager sets it via
  // /team — until then the shift renders as "uncosted" (wage_total = 0).
  const staffIds = [...new Set(punches.map(p => p.staff_id).filter(Boolean))]
  const nameByStaff = new Map()
  const rateByStaff = new Map()
  if (staffIds.length > 0) {
    const { data: staff, error: sErr } = await supabase
      .from('pos_staff')
      .select('id, name, hourly_rate_cents')
      .in('id', staffIds)
    if (sErr) {
      if (sErr.code !== '42P01') console.error('fetchPosPunchShifts staff', sErr)
    } else {
      for (const s of staff || []) {
        nameByStaff.set(s.id, s.name)
        if (s.hourly_rate_cents != null) {
          rateByStaff.set(s.id, Number(s.hourly_rate_cents) / 100)
        }
      }
    }
  }
  // Same +15% employer-tax-burden default Square uses as the baseline
  // for fully_loaded_cost. CFO Labor already exposes a per-tenant
  // override (r7_labor_shifts.tax_burden_rate) we'd surface here later.
  const taxBurdenDefault = 0.15

  // Pair clock_in → next clock_out per staff. Open shifts (no matching
  // clock_out yet) get end_at = now() and a flag so the UI can dim them.
  const byStaff = new Map()
  for (const p of punches) {
    const arr = byStaff.get(p.staff_id) || []
    arr.push(p)
    byStaff.set(p.staff_id, arr)
  }
  const now = new Date()
  const shifts = []
  for (const [staffId, rows] of byStaff) {
    let openAt = null
    let openPunchId = null
    for (const r of rows) {
      const t = new Date(r.at)
      if (r.kind === 'clock_in') {
        openAt = t
        openPunchId = r.id
      } else if (r.kind === 'clock_out' && openAt) {
        const hours = Math.max(0, (t - openAt) / 3600000)
        const wageHourly = rateByStaff.get(staffId) ?? 0
        const wageTotal = wageHourly * hours
        shifts.push({
          id: 'pos_' + openPunchId,
          tenant_id: tenantId,
          team_member_id: staffId,
          square_employee_id: null,
          employee_name: nameByStaff.get(staffId) || staffId.slice(0, 8),
          start_at: openAt.toISOString(),
          end_at: t.toISOString(),
          hours: Number(hours.toFixed(4)),
          wage_hourly: wageHourly,
          wage_total: Number(wageTotal.toFixed(2)),
          tax_burden_rate: wageHourly > 0 ? taxBurdenDefault : 0,
          fully_loaded_cost: wageHourly > 0 ? Number((wageTotal * (1 + taxBurdenDefault)).toFixed(2)) : 0,
          breaks_minutes: 0,
          status: 'closed',
          source: 'pos_punch',
          open: false,
          uncosted: wageHourly === 0,
        })
        openAt = null
        openPunchId = null
      }
    }
    // Open shift: clock_in without matching clock_out before window end.
    if (openAt) {
      const hours = Math.max(0, (now - openAt) / 3600000)
      const wageHourly = rateByStaff.get(staffId) ?? 0
      const wageTotal = wageHourly * hours
      shifts.push({
        id: 'pos_' + openPunchId,
        tenant_id: tenantId,
        team_member_id: staffId,
        square_employee_id: null,
        employee_name: nameByStaff.get(staffId) || staffId.slice(0, 8),
        start_at: openAt.toISOString(),
        end_at: null,
        hours: Number(hours.toFixed(4)),
        wage_hourly: wageHourly,
        wage_total: Number(wageTotal.toFixed(2)),
        tax_burden_rate: wageHourly > 0 ? taxBurdenDefault : 0,
        fully_loaded_cost: wageHourly > 0 ? Number((wageTotal * (1 + taxBurdenDefault)).toFixed(2)) : 0,
        breaks_minutes: 0,
        status: 'open',
        source: 'pos_punch',
        open: true,
        uncosted: wageHourly === 0,
      })
    }
  }
  // Descending by start_at to match Square mirror sort.
  shifts.sort((a, b) => new Date(b.start_at) - new Date(a.start_at))
  return shifts
}

export async function syncSquareLabor(tenantId, range = {}) {
  try {
    const res = await fetch('/api/sync-square-labor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId, start: range.start, end: range.end }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Server error ' + res.status }))
      throw new Error(err.error || 'Server error ' + res.status)
    }
    return await res.json()
  } catch (err) {
    console.error('syncSquareLabor', err)
    throw err
  }
}

// ─── BOOKINGS FORECAST ────────────────────────────────────────────────────────
// Goes through /api/forecast-bookings because r7_reservations has RLS that
// blocks the anon key. Returns upcoming demand + no-show rate + avg ticket
// in one payload for the Insights forecast card.
export async function fetchBookingsForecast(tenantId) {
  try {
    const res = await fetch('/api/forecast-bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Server error ' + res.status }))
      throw new Error(err.error || 'Server error ' + res.status)
    }
    return await res.json()
  } catch (err) {
    console.error('fetchBookingsForecast', err)
    return null
  }
}

// ─── MARKETING BRIDGE ─────────────────────────────────────────────────────────
// Goes through /api/sync-marketing because mkt_* tables have RLS that blocks
// the anon key the browser holds. The endpoint runs with the service role.
export async function fetchMarketingSpend(tenantId, { start, end } = {}) {
  try {
    const res = await fetch('/api/sync-marketing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId, start, end }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Server error ' + res.status }))
      throw new Error(err.error || 'Server error ' + res.status)
    }
    return await res.json()
  } catch (err) {
    console.error('fetchMarketingSpend', err)
    throw err
  }
}

// ─── CONVERTERS ───────────────────────────────────────────────────────────────
// One Kitchen invoice becomes one ledger shadow. When the invoice's line items
// resolve to more than one ledger account (a Restaurant Depot run that is food
// AND cleaning supplies), the shadow is written already split: the parent
// carries the invoice total and the children carry the per-account shares.
// makeLedgerFilter drops split parents, so the P&L, Insights and Budget count
// the children -- food cost stops absorbing the Windex the day the invoice is
// scanned, instead of waiting for a bank match that may never come.
//
// Children reuse source='kitchen_purchase' on purpose: every rule that keeps
// the shadow out of cash flow, out of the bill matcher and out of the
// "needs a receipt" list applies to them unchanged. They are told apart from
// the parent by parent_id alone.
//
// Child ids are keyed by ACCOUNT, not by position: kitchen_purchase_<pid>_alloc_<account id|uncat>.
// The breakdown changes after the fact (an item gets a rule, a Kitchen
// category gets mapped) and a positional id would then point at a different
// slice -- re-syncing would overwrite the food child with the cleaning amount.
// Keyed by account, a re-split upserts the shares that still exist and deletes
// the ones that no longer do (see reconcileShadowChildren).
//
// A line nothing resolves lands in an UNCATEGORIZED child. It shows up in the
// Transactions review tab and asks for a decision; guessing "food" would hide
// the gap it is there to expose.
export function buildKitchenShadowRows(p, vendor, foodBevCategoryId, buckets) {
  const parentId = 'kitchen_purchase_' + p.id
  const total = -(parseFloat(p.total) || 0)
  const shares = prorateAllocation(buckets || [], Math.abs(total))
  // Single-bucket invoice: no children, but the parent takes that account
  // when Kitchen knows it. An invoice whose items are all unresolved keeps
  // the default, so one scanned before item mapping existed behaves as before.
  const lead = shares.length >= 2 ? shares[0] : (buckets || [])[0]
  const parentCat = (lead && lead.categoryId) || foodBevCategoryId || null
  const parent = {
    id: parentId,
    date: p.date,
    description: String(vendor).toUpperCase(),
    amount: total,
    category_id: parentCat,
    category: parentCat || UNCATEGORIZED,
    account: 'Kitchen Sync',
    reconciled: false,
    source: 'kitchen_purchase',
    notes: p.invoice_path ? 'Invoice: ' + p.invoice_path : '',
    // True when the breakdown actually resolved an account (even a single
    // one), so a re-sync may move a parent off a stale default. Not a column;
    // upsertTransactions maps known fields only.
    _resolved: !!(lead && lead.categoryId),
  }
  if (shares.length < 2) return [parent]
  // A share keeps its sign: a positive bucket is money spent (negative row),
  // a negative bucket is a CREDIT on the invoice (returned kegs, a deposit
  // refunded) and becomes a positive row that reduces that account. The old
  // -Math.abs() turned a $400 keg-return credit into a $400 expense, and the
  // children no longer summed to the parent.
  const children = shares.map(sh => ({
    id: `${parentId}_alloc_${sh.categoryId || 'uncat'}`,
    parent_id: parentId,
    date: p.date,
    description: parent.description,
    amount: Math.round(-sh.amount * 100) / 100,
    category_id: sh.categoryId || null,
    category: sh.categoryId || UNCATEGORIZED,
    account: 'Kitchen Sync',
    reconciled: false,
    source: 'kitchen_purchase',
    notes: sh.categoryId ? 'Line items from Kitchen invoice' : 'Line items nothing categorises yet — open the row to assign',
  }))
  // Parent first: parent_id is a foreign key onto the same table.
  return [parent, ...children]
}

export function purchasesToTransactions(purchases, vendorMap = {}, foodBevCategoryId, allocations = null) {
  return purchases.flatMap(p => {
    // r7_purchases stores the supplier name inline AND a vendorId FK; prefer
    // the inline supplier (always populated by Kitchen's invoice scanner),
    // fall back to vendorMap lookup, then to a generic label.
    const vendor = p.supplier || vendorMap[p.vendorId] || vendorMap[p.vendor_id] || 'VENDOR PURCHASE';
    return buildKitchenShadowRows(p, vendor, foodBevCategoryId, allocations?.get?.(String(p.id)) || [])
  })
}

// Which children to write and which to delete so a parent's split matches a
// freshly computed breakdown. Pure, so the sync and the invoice panel share it.
//
// One thing is preserved: a category the operator set by hand on a child that
// the new breakdown still leaves unresolved. They already did the work in the
// dropdown; a re-sync must not reset it to Uncategorized. (If the breakdown
// resolves the slice instead, the uncat child is deleted and the account's
// child created -- same money, better provenance.)
export function reconcileShadowChildren(desiredChildren, existingChildren) {
  const desiredIds = new Set(desiredChildren.map(c => c.id))
  const existingById = new Map((existingChildren || []).map(c => [c.id, c]))
  const toUpsert = desiredChildren.map(c => {
    const prev = existingById.get(c.id)
    const manualCat = prev && !c.category_id && prev.category && prev.category !== UNCATEGORIZED ? prev.category : null
    return manualCat ? { ...c, category_id: manualCat, category: manualCat } : c
  })
  const toDelete = (existingChildren || []).filter(c => !desiredIds.has(c.id)).map(c => c.id)
  return { toUpsert, toDelete }
}

// Write a parent + its reconciled children, delete the stale ones. Parent goes
// in the same upsert as the children (parent_id is an FK onto the table);
// deletes run after so a child never dangles.
export async function applyKitchenShadow(parent, toUpsert, toDelete, tenantId) {
  const tid = tenantId || TENANT()
  if (tid === 'demo') return { ok: true, demo: true }
  const up = await upsertTransactions([parent, ...toUpsert], tid)
  if (!up.ok) return up
  if (toDelete.length > 0) {
    const { error } = await supabase.from('r7_ledger_transactions').delete().in('id', toDelete).eq('tenant_id', tid)
    if (error) { console.error('applyKitchenShadow/delete', error); return { ok: false, error: error.message } }
  }
  return { ok: true }
}

