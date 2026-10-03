// ─── COUNTRY PACKS ───────────────────────────────────────────────────────────
//
// Everything that changes when a tenant operates in a different country lives
// in a pack: money/date formatting, statement number+date parsing, the chart of
// accounts' reporting lines, payment rails, and which screens even make sense.
//
// Design notes:
//
// 1. The active pack is a MODULE SINGLETON, not React context. `fmt()` is called
//    from ~300 render sites in App.jsx; threading a context through all of them
//    would be a rewrite. A singleton is safe here because the tenant is fixed for
//    the lifetime of the page — TenantSwitcher does a full window.location.reload()
//    when you change stores.
//
// 2. Resolution is SYNCHRONOUS at module load, from a localStorage cache keyed by
//    tenant. The tenant row is fetched over the network, which is far too late for
//    the first paint. So: first ever load of a BR tenant renders US formatting for
//    a few hundred ms and then corrects itself; every load after that is instant.
//
// 3. The `us` pack must reproduce today's hardcoded behaviour EXACTLY — same
//    Schedule C identifiers, same seeded categories, same payment methods. It is a
//    pure extraction, so existing tenants need no data migration.

import { US } from "./us.js";
import { BR } from "./br.js";

const PACKS = { US, BR };
const DEFAULT_CODE = "US";

const cacheKey = (tenantId) => `cfo_country_${tenantId}`;

let active = US;

// ─── Resolution ──────────────────────────────────────────────────────────────

// Called once at module load with the tenant id resolved in App.jsx. Reads the
// cached country so the very first render already formats correctly.
export function initCountry(tenantId) {
  try {
    const cached = localStorage.getItem(cacheKey(tenantId));
    if (cached && PACKS[cached]) active = PACKS[cached];
  } catch {}
  return active;
}

// Called after the tenant row arrives. Returns true when the country actually
// changed, which is the caller's cue to force a re-render.
export function setCountryFromTenant(tenantId, tenant) {
  const code = String(
    tenant?.country || tenant?.settings?.country || DEFAULT_CODE
  ).toUpperCase();
  const pack = PACKS[code] || PACKS[DEFAULT_CODE];
  try { localStorage.setItem(cacheKey(tenantId), pack.code); } catch {}
  if (pack === active) return false;
  active = pack;
  return true;
}

// Accessor. Always call this — never hold a reference to the pack across
// renders, or you'll pin the stale one.
export function country() { return active; }

export function countryCode() { return active.code; }

// The reporting line that counts as cost of goods sold — "COGS" under
// Schedule C, "CMV" in the DRE gerencial. The P&L splits gross margin on
// this, so comparing against the literal "COGS" silently reported zero CMV
// and folded the whole cost of goods into operating expenses for BR tenants.
export function cogsLine() { return active.cogsLine; }

// Categories arrive both as camelCase (client state) and snake_case (raw DB
// rows), so accept either.
export function isCogs(cat) {
  return (cat?.taxLine ?? cat?.tax_line) === active.cogsLine;
}

// Labor is a SET of reporting lines, never a single category: the payroll of a
// restaurant is split across wages, statutory charges and benefits, and which
// buckets exist changes by country. The old code looked for one category whose
// name matched /payroll|labor|wage/, which found nothing at all in Portuguese
// and, even in English, stopped at the first match.
export function laborLines() { return active.laborLines; }

export function isLabor(cat) {
  return active.laborLines.includes(cat?.taxLine ?? cat?.tax_line);
}

// Same story as labor, one line instead of a set: /rent/i never matched
// "Aluguel", so the Rent% tile rendered 0.0% for a BR tenant paying rent.
export function isRent(cat) {
  return (cat?.taxLine ?? cat?.tax_line) === active.rentLine;
}

// Screens the active country has no meaning for are dropped from the NAV
// entirely (see App.jsx). Unknown keys default to visible, so adding a screen
// never silently hides it.
export function supports(capability) {
  return active.capabilities[capability] !== false;
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function money(v) {
  const n = Number(v) || 0;
  return new Intl.NumberFormat(active.locale, {
    style: "currency",
    currency: active.currency,
  }).format(n);
}

// Compact form for chart axes ("$12k" / "R$ 12 mil").
export function moneyCompact(v) {
  const n = Math.round((Number(v) || 0) / 1000);
  return active.compactMoney(n);
}

export function currencySymbol() { return active.symbol; }

// Plain quantities (counts, units). Separate from money so it doesn't pick up a
// currency symbol, but still locale-aware — a bare toLocaleString() would fall
// back to the BROWSER's locale and disagree with every other number on screen.
export function formatNumber(v, opts) {
  return new Intl.NumberFormat(active.locale, opts).format(Number(v) || 0);
}

export function formatDate(s) {
  const d = localDate(s);
  if (!d) return String(s ?? "");
  return d.toLocaleDateString(active.locale, { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateShort(s) {
  const d = localDate(s);
  if (!d) return String(s ?? "");
  return d.toLocaleDateString(active.locale, { month: "short", day: "numeric" });
}

export function formatMonth(d) {
  return d.toLocaleString(active.locale, { month: "short", year: "numeric" });
}

export function formatTime(d) {
  return (d || new Date()).toLocaleTimeString(active.locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: active.hour12,
  });
}

// "YYYY-MM-DD" -> Date at LOCAL midnight. Appending T00:00:00 (rather than
// letting Date parse the bare ISO date as UTC) is what keeps a date from
// sliding a day backwards west of Greenwich.
function localDate(s) {
  if (!s) return null;
  const d = new Date(String(s).slice(0, 10) + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

// ─── Statement parsing ───────────────────────────────────────────────────────
//
// These two are the reason Phase 0 exists. Bank exports are ambiguous, and
// guessing wrong is silent: "03/04/2025" is March 4 in the US and 3 April in
// Brazil, and "1.234,56" is either 1234.56 or 1.234 depending on who wrote it.
// Neither mistake throws — they just quietly produce wrong books.

const pad = (n) => String(n).padStart(2, "0");
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Parses a date string using the active country's field order. Returns
// "YYYY-MM-DD" or null. Never returns an invalid date.
export function parseDate(str) {
  const s = String(str ?? "").trim();
  if (!s) return null;

  // Already ISO — unambiguous, take it as written.
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const mo = +m[2], dy = +m[3];
    if (mo < 1 || mo > 12 || dy < 1 || dy > 31) return null;
    return isoOf(+m[1], mo, dy);
  }

  // Numeric, separated by / . or - — the ambiguous case.
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) {
    const a = +m[1], b = +m[2];
    let y = +m[3];
    if (m[3].length <= 2) y += y < 70 ? 2000 : 1900;

    let day, mon;
    if (active.dateOrder === "DMY") { day = a; mon = b; } else { mon = a; day = b; }

    // Self-correction: if the slot we read as the month holds something > 12,
    // the file disagrees with the locale. Trust the data over the setting —
    // this rescues a US export opened under a BR tenant and vice versa.
    if (mon > 12 && day <= 12) { const t = mon; mon = day; day = t; }

    if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
    return isoOf(y, mon, day);
  }

  // Textual ("Jan 5, 2026", "5 jan 2026") — unambiguous enough for Date, but
  // read the components back in LOCAL time; toISOString() here would shift.
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// Parses a money string using the active country's decimal separator. Returns
// NaN when there's no number in it. Handles currency symbols, thousands
// separators, and accounting parentheses "(123.45)" = -123.45.
export function parseAmount(str) {
  if (typeof str === "number") return str;
  let s = String(str ?? "").trim();
  if (!s) return NaN;

  const negParen = /^\(.*\)$/.test(s);
  // Drop everything that isn't a digit, separator or sign: "R$", "$", "US$",
  // "BRL", non-breaking spaces, stray letters.
  s = s.replace(/[^\d.,\-+]/g, "");
  if (!s || !/\d/.test(s)) return NaN;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let dec = -1;

  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: the rightmost one is the decimal separator, in every locale.
    dec = Math.max(lastComma, lastDot);
  } else if (lastComma >= 0 || lastDot >= 0) {
    const only = Math.max(lastComma, lastDot);
    const trailing = s.length - only - 1;
    // Exactly three trailing digits is the genuinely ambiguous shape
    // ("1.234" / "1,234") — only the locale can break the tie. Any other
    // length is a decimal separator.
    if (trailing === 3) dec = s[only] === active.decimalSep ? only : -1;
    else dec = only;
  }

  const intPart = (dec >= 0 ? s.slice(0, dec) : s).replace(/[.,]/g, "");
  const fracPart = (dec >= 0 ? s.slice(dec + 1) : "").replace(/[.,]/g, "");
  const n = parseFloat(intPart + (fracPart ? "." + fracPart : ""));
  if (isNaN(n)) return NaN;
  return negParen ? -Math.abs(n) : n;
}

// ─── Chart of accounts / rails ───────────────────────────────────────────────

export function reportingLines() { return active.reportingLines; }
export function reportingLineLabel() { return active.reportingLineLabel; }
export function defaultCategories() { return active.defaultCategories; }
export function paymentMethods() { return active.paymentMethods; }
// A debit whose statement text names the rail (check, Zelle, Pix...) but not
// the payee. Such a line can only be matched to an invoice on the amount.
export function isAnonymousDebit(desc) { return !!active.anonymousDebitRe && active.anonymousDebitRe.test(String(desc || "")); }
export function defaultTimezone() { return active.timezone; }
