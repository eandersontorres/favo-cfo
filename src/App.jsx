import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { fetchPurchaseBudgetPolicy, savePurchaseBudgetPolicy, fetchPurchaseWeekBudget } from "./lib/supabase.js";
import { supabase, fetchTransactions, upsertTransactions, deleteTransaction, fetchCategories, upsertCategory, deleteCategory, fetchBudgets, upsertBudget, fetchBills, upsertBill, deleteBill, fetchProjects, upsertProject, deleteProject, fetchRecurring, upsertRecurring, deleteRecurring, fetchBankAccounts, upsertBankAccount, deleteBankAccount, fetchKitchenPurchases, fetchKitchenVendors, purchasesToTransactions, fetchMarketingSpend, fetchBookingsForecast, fetchLaborShifts, fetchPosPunchShifts, syncSquareLabor, fetchPayrollRuns, upsertPayrollRun, deletePayrollRun, fetchTipsDaily, syncSquareTips, applyTipPool, syncSquareSales, createPlaidLinkToken, exchangePlaidPublicToken, syncPlaidTransactions, fetchSquarePayouts, syncSquarePayouts, splitTransaction, unsplitTransaction, fetchAggregatorPayouts, upsertAggregatorPayouts, parseAggregatorStatement, deleteAggregatorPayout, updateAggregatorPayoutDate, onboardFavoBank, fetchFavoBankState, syncFavoBank, transferFavoBank } from "./lib/supabase.js";
import { UNCATEGORIZED } from "./lib/constants.js";
import { getMyTenantIds, signInWithPassword, sendMagicLink, signOutUser, fetchTenant, fetchCeoRoi, saveCeoRoi } from "./lib/supabase.js";
import { initCountry, setCountryFromTenant, country, supports, isCogs, cogsLine, isLabor, isRent, money, moneyCompact, currencySymbol, formatNumber as ctryNumber, formatDate as ctryDate, formatDateShort as ctryDateShort, formatMonth as ctryMonth, formatTime as ctryTime, parseDate as ctryParseDate, parseAmount as ctryParseAmount } from "./lib/country/index.js";

// Active tenant: localStorage override (set by the sidebar TenantSwitcher) wins
// over the deploy's env pin, so one deploy can serve a multi-store manager.
const ENV_TENANT_ID = import.meta.env.VITE_TENANT_ID || "demo";
const TENANT_ID = (() => { try { return localStorage.getItem("cfo_active_tenant") || ENV_TENANT_ID; } catch { return ENV_TENANT_ID; } })();

// Guards the one reload TenantSwitcher is allowed to do when the stored tenant
// override turns out to be stale. See the comment at that call site.
const TENANT_RELOAD_FLAG = "cfo_tenant_reload_once";

// Resolve the country pack synchronously, from the per-tenant localStorage
// cache, BEFORE any component renders. The authoritative value comes from
// r7_tenants and is reconciled on mount (see the country effect in App).
initCountry(TENANT_ID);

// ─── STYLES ────────────────────────────────────────────────────────────────
const STYLES = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    /* Favo rebrand (Caminho B v2): Inter, neutral base, CFO module color.
       Rule: deep tone on light bg, signal tone on dark bg. */
    --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
    --font-mono: "DM Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    --bg: #101416;
    --surface: #151A1C;
    --surface2: #1B2124;
    --surface3: #22292C;
    --border: rgba(255,255,255,0.08);
    --border2: rgba(255,255,255,0.14);
    --text: #E8ECED;
    --text2: #93A1A6;
    --text3: #6C7A7E;
    --accent: #46BC88;   /* cfo-signal */
    --accent2: #5ECD9C;
    --accentBg: rgba(70,188,136,0.10);
    --accentBorder: rgba(70,188,136,0.30);
    --red: #EE7E6B;      /* marketing-signal */
    --redBg: rgba(238,126,107,0.10);
    --yellow: #E8A93C;   /* kitchen-signal */
    --yellowBg: rgba(232,169,60,0.10);
    --blue: #4E9FB4;     /* petrol-signal */
    --blueBg: rgba(78,159,180,0.10);
    --purple: #A594E8;   /* book-signal */
    --purpleBg: rgba(165,148,232,0.10);
    --sidebar: 220px;
    --radius: 10px;
    --radius2: 6px;
  }

  :root.theme-light {
    /* Rebrand light: paper + ink, deep module tones */
    --bg: #F6F6F4;
    --surface: #FFFFFF;
    --surface2: #F1F1EE;
    --surface3: #E8E8E5;
    --border: #E8E8E5;
    --border2: #D9D9D5;
    --text: #0A0A0A;
    --text2: #5A5A5A;
    --text3: #9A9A9A;
    --accent: #2E7D5B;   /* cfo-deep */
    --accent2: #256A4C;
    --accentBg: rgba(46,125,91,0.08);
    --accentBorder: rgba(46,125,91,0.30);
    --red: #B94A3D;      /* marketing-deep */
    --redBg: rgba(185,74,61,0.07);
    --yellow: #B07A1E;   /* kitchen-deep */
    --yellowBg: rgba(176,122,30,0.08);
    --blue: #2D5FA6;     /* checklist-deep */
    --blueBg: rgba(45,95,166,0.07);
    --purple: #6350A6;   /* book-deep */
    --purpleBg: rgba(99,80,166,0.07);
  }
  :root.theme-light .sidebar { background: #FFFFFF; border-right: 1px solid var(--border); }
  :root.theme-light .nav-item:hover { background: var(--surface2); }
  :root.theme-light .nav-item.active { background: var(--accentBg); color: var(--accent); }
  :root.theme-light .btn-primary { color: #FFFFFF; }
  :root.theme-light .card { box-shadow: 0 1px 2px rgba(10,10,10,0.04); }
  :root.theme-light .kpi-card { box-shadow: 0 1px 2px rgba(10,10,10,0.04); }
  :root.theme-light .modal { box-shadow: 0 20px 50px rgba(10,10,10,0.16); }
  :root.theme-light ::-webkit-scrollbar-thumb { background: rgba(10,10,10,0.15); }

  html, body { height: 100%; background: var(--bg); color: var(--text); font-family: var(--font-sans); letter-spacing: 0.01em; }
  #root { height: 100%; }

  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 99px; }

  .layout { display: flex; height: 100vh; overflow: hidden; }

  /* SIDEBAR */
  .sidebar {
    width: var(--sidebar);
    background: #0C0F11;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    overflow-y: auto;
  }
  .sidebar-logo {
    padding: 18px 16px 16px;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 10px;
  }
  .logo-icon {
    width: 34px; height: 34px; flex-shrink: 0;
    color: var(--text);
    display: flex; align-items: center; justify-content: center;
  }
  .logo-text { display: flex; flex-direction: column; }
  .logo-mark { font-family: var(--font-sans); font-weight: 700; font-size: 17px; letter-spacing: -0.03em; color: var(--text); line-height: 1; }
  .logo-mark .logo-dot { color: var(--accent); }
  .logo-sub { font-family: var(--font-mono); font-size: 10px; font-weight: 500; color: var(--accent); letter-spacing: 0.14em; text-transform: uppercase; margin-top: 4px; line-height: 1; }
  .sidebar-section { padding: 16px 10px 8px; }
  .sidebar-section-label { font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); opacity: 0.6; padding: 0 8px 8px; font-family: var(--font-mono); }
  .nav-item {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 10px; border-radius: var(--radius2);
    cursor: pointer; transition: all 0.15s;
    font-size: 13px; color: var(--text2); font-weight: 400;
    margin-bottom: 1px;
  }
  .nav-item:hover { background: var(--surface2); color: var(--text); }
  .nav-item.active { background: var(--accentBg); color: var(--accent); border-left: 2px solid var(--accent); }
  .nav-item.active .nav-icon { color: var(--accent); }
  .nav-icon { width: 16px; height: 16px; flex-shrink: 0; opacity: 0.7; }
  .nav-item.active .nav-icon { opacity: 1; }
  .nav-badge { margin-left: auto; background: var(--red); color: #fff; font-size: 10px; border-radius: 99px; padding: 1px 6px; font-family: var(--font-mono); }
  .sidebar-footer { margin-top: auto; padding: 14px 12px; border-top: 1px solid var(--border); }
  .entity-pill { background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius2); padding: 8px 10px; font-size: 11px; color: var(--text2); }
  .entity-pill strong { display: block; color: var(--accent); font-size: 12px; font-family: var(--font-sans); letter-spacing: 0.06em; }

  /* MAIN */
  .main { flex: 1; overflow-y: auto; background: var(--bg); }
  .page { padding: 28px 32px; max-width: 1300px; }
  .page-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 24px; }
  .page-title { font-family: var(--font-sans); font-size: 26px; font-weight: 600; color: var(--text); letter-spacing: 0.02em; }
  .page-subtitle { font-size: 12px; color: var(--text3); margin-top: 3px; font-family: var(--font-mono); }

  /* BUTTONS */
  .btn { display: inline-flex; align-items: center; gap: 7px; padding: 8px 16px; border-radius: var(--radius2); font-size: 13px; font-weight: 500; cursor: pointer; border: none; transition: all 0.15s; font-family: var(--font-sans); }
  .btn-primary { background: var(--accent); color: #0a0a0a; font-family: var(--font-mono); letter-spacing: 0.06em; font-size: 12px; }
  .btn-primary:hover { background: var(--accent2); }
  .btn-outline { background: transparent; color: var(--text2); border: 1px solid var(--border2); }
  .btn-outline:hover { background: var(--surface2); color: var(--text); }
  .btn-ghost { background: transparent; color: var(--text3); border: none; padding: 6px 10px; }
  .btn-ghost:hover { color: var(--text); background: var(--surface2); }
  .btn-danger { background: var(--redBg); color: var(--red); border: 1px solid color-mix(in srgb, var(--red) 25%, transparent); }
  .btn-sm { padding: 5px 11px; font-size: 12px; }

  /* CARDS */
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
  .card-sm { padding: 14px 16px; }

  /* KPI GRID */
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px; }
  .kpi-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; }
  .kpi-label { font-size: 11px; color: var(--text3); font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; }
  .kpi-value { font-family: var(--font-mono); font-size: 24px; font-weight: 400; color: var(--text); margin: 6px 0 4px; letter-spacing: -0.01em; }
  .kpi-delta { font-size: 11px; font-family: var(--font-mono); }
  .kpi-delta.pos { color: var(--accent); }
  .kpi-delta.neg { color: var(--red); }
  .kpi-accent { border-top: 2px solid var(--accent); border-left: 2px solid var(--accent); }
  .kpi-red { border-top: 2px solid var(--red); }
  .kpi-blue { border-top: 2px solid var(--blue); }
  .kpi-yellow { border-top: 2px solid var(--yellow); }

  /* TABLES */
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px 12px; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text3); font-family: var(--font-mono); font-weight: 400; border-bottom: 1px solid var(--border); white-space: nowrap; }
  td { padding: 11px 12px; font-size: 13px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--surface2); }
  .mono { font-family: var(--font-mono); font-size: 12px; letter-spacing: -0.01em; }
  .amount-pos { color: var(--accent); font-family: var(--font-mono); font-size: 13px; }
  .amount-neg { color: var(--red); font-family: var(--font-mono); font-size: 13px; }
  .amount-neutral { color: var(--text); font-family: var(--font-mono); font-size: 13px; }

  /* TAGS / BADGES */
  .tag { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 99px; font-size: 10px; font-family: var(--font-mono); font-weight: 400; border: 1px solid transparent; white-space: nowrap; }
  .tag-green { background: var(--accentBg); color: var(--accent); border-color: var(--accentBorder); }
  .tag-red { background: var(--redBg); color: var(--red); border-color: color-mix(in srgb, var(--red) 25%, transparent); }
  .tag-yellow { background: var(--yellowBg); color: var(--yellow); border-color: color-mix(in srgb, var(--yellow) 25%, transparent); }
  .tag-blue { background: var(--blueBg); color: var(--blue); border-color: color-mix(in srgb, var(--blue) 25%, transparent); }
  .tag-purple { background: var(--purpleBg); color: var(--purple); border-color: color-mix(in srgb, var(--purple) 25%, transparent); }
  .tag-gray { background: var(--surface2); color: var(--text2); border-color: var(--border2); }

  /* FORMS */
  .input { background: var(--surface2); border: 1px solid var(--border2); border-radius: var(--radius2); padding: 8px 12px; color: var(--text); font-size: 13px; font-family: var(--font-sans); outline: none; transition: border 0.15s; width: 100%; }
  .input:focus { border-color: var(--accent); }
  .input::placeholder { color: var(--text3); }
  select.input { cursor: pointer; }
  .label { font-size: 11px; color: var(--text2); margin-bottom: 5px; display: block; font-family: var(--font-mono); letter-spacing: 0.05em; }
  .form-group { margin-bottom: 14px; }
  .form-row { display: grid; gap: 12px; }
  .form-row-2 { grid-template-columns: 1fr 1fr; }
  .form-row-3 { grid-template-columns: 1fr 1fr 1fr; }

  /* MODAL */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; backdrop-filter: blur(4px); }
  .modal { background: var(--surface); border: 1px solid var(--border2); border-radius: var(--radius); width: 100%; max-width: 520px; max-height: 90vh; overflow-y: auto; }
  .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid var(--border); }
  .modal-title { font-family: var(--font-sans); font-size: 18px; font-weight: 600; letter-spacing: 0.04em; }
  .modal-body { padding: 20px; }
  .modal-footer { padding: 14px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 10px; }

  /* UPLOAD ZONE */
  .upload-zone { border: 2px dashed var(--border2); border-radius: var(--radius); padding: 40px; text-align: center; cursor: pointer; transition: all 0.2s; }
  .upload-zone:hover, .upload-zone.drag { border-color: var(--accent); background: var(--accentBg); }
  .upload-icon { font-size: 32px; margin-bottom: 12px; }
  .upload-title { font-family: var(--font-sans); font-size: 16px; font-weight: 600; color: var(--text); margin-bottom: 6px; }
  .upload-sub { font-size: 12px; color: var(--text3); font-family: var(--font-mono); }

  /* PROGRESS BAR */
  .progress-bar { height: 4px; background: var(--surface3); border-radius: 99px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--accent); border-radius: 99px; transition: width 0.3s; }

  /* CHART BARS */
  .bar-chart { display: flex; align-items: flex-end; gap: 6px; height: 120px; padding: 0 4px; }
  .bar-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .bar { width: 100%; border-radius: 4px 4px 0 0; min-height: 4px; transition: height 0.3s; position: relative; cursor: pointer; }
  .bar:hover { filter: brightness(1.2); }
  .bar-label { font-size: 9px; color: var(--text3); font-family: var(--font-mono); white-space: nowrap; }
  .bar-income { background: var(--accent); }
  .bar-expense { background: var(--red); }
  .bar-net { background: var(--blue); }

  /* DIVIDER */
  .divider { border: none; border-top: 1px solid var(--border); margin: 16px 0; }

  /* TABS */
  .tabs { display: flex; gap: 2px; background: var(--surface2); border-radius: var(--radius2); padding: 3px; margin-bottom: 20px; width: fit-content; }
  .tab { padding: 7px 16px; border-radius: 5px; font-size: 13px; cursor: pointer; color: var(--text2); transition: all 0.15s; font-weight: 400; }
  .tab.active { background: var(--surface3); color: var(--text); font-weight: 500; }

  /* FLEX UTILS */
  .flex { display: flex; }
  .flex-col { flex-direction: column; }
  .items-center { align-items: center; }
  .justify-between { justify-content: space-between; }
  .gap-8 { gap: 8px; }
  .gap-10 { gap: 10px; }
  .gap-12 { gap: 12px; }
  .gap-16 { gap: 16px; }
  .gap-20 { gap: 20px; }
  .mt-4 { margin-top: 4px; }
  .mt-8 { margin-top: 8px; }
  .mt-12 { margin-top: 12px; }
  .mt-16 { margin-top: 16px; }
  .mt-20 { margin-top: 20px; }
  .mb-16 { margin-bottom: 16px; }
  .text-right { text-align: right; }

  /* GRID */
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }

  /* RECONCILE */
  .recon-row { display: grid; grid-template-columns: 1fr 20px 1fr; gap: 12px; align-items: center; margin-bottom: 10px; }
  .recon-arrow { color: var(--accent); text-align: center; font-size: 14px; }
  .recon-card { background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius2); padding: 10px 12px; font-size: 12px; }
  .recon-card .desc { color: var(--text); margin-bottom: 3px; }
  .recon-card .meta { color: var(--text3); font-family: var(--font-mono); font-size: 11px; }

  /* EMPTY STATE */
  .empty { text-align: center; padding: 60px 20px; color: var(--text3); }
  .empty-icon { font-size: 36px; margin-bottom: 12px; opacity: 0.5; }
  .empty-title { font-family: var(--font-sans); font-size: 15px; color: var(--text2); margin-bottom: 6px; }
  .empty-sub { font-size: 12px; font-family: var(--font-mono); }

  /* COLOR DOTS */
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

  /* SELECT CAT */
  .cat-select { background: var(--surface3); border: 1px solid var(--border); border-radius: var(--radius2); padding: 4px 8px; color: var(--text2); font-size: 11px; font-family: var(--font-mono); cursor: pointer; outline: none; }
  .cat-select:focus { border-color: var(--accent); }
  .cat-select.auto-cat { border-color: var(--accentBorder); background: var(--accentBg); color: var(--text); }
  .auto-cat-badge { font-size: 11px; cursor: help; opacity: 0.85; line-height: 1; }

  /* P&L REPORT */
  .pl-section { margin-bottom: 8px; }
  .pl-header { background: var(--surface2); padding: 10px 14px; border-radius: var(--radius2); font-family: var(--font-sans); font-size: 12px; font-weight: 700; color: var(--text2); text-transform: uppercase; letter-spacing: 0.08em; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
  .pl-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 14px 8px 24px; border-bottom: 1px solid var(--border); }
  .pl-row:hover { background: var(--surface2); }
  .pl-row-name { font-size: 13px; color: var(--text2); }
  .pl-total { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--surface3); border-radius: var(--radius2); margin: 4px 0; }
  .pl-total-label { font-family: var(--font-sans); font-size: 13px; font-weight: 600; }
  .pl-net { background: var(--accentBg); border: 1px solid var(--accentBorder); padding: 14px 18px; border-radius: var(--radius); display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
  .pl-net-label { font-family: var(--font-sans); font-size: 18px; font-weight: 600; color: var(--text); letter-spacing: 0.04em; }

  /* BUDGET */
  .budget-row { display: grid; grid-template-columns: 1fr 130px 130px 130px 100px; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border); }
  .budget-header { font-size: 10px; color: var(--text3); font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.1em; padding: 0 0 8px; }
  .budget-progress { }

  /* CATEGORY COLOR SWATCH */
  .swatch { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }

  /* TOAST */
  .toast { position: fixed; bottom: 24px; right: 24px; background: var(--surface); border: 1px solid var(--border2); border-radius: var(--radius); padding: 12px 18px; font-size: 13px; z-index: 9999; display: flex; align-items: center; gap: 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); animation: slideUp 0.2s ease; }
  @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
`;

// ─── SAMPLE DATA ─────────────────────────────────────────────────────────────
// Seeded chart of accounts now comes from the country pack — US keeps exactly
// the list that used to live here (src/lib/country/us.js).
const DEFAULT_CATEGORIES = country().defaultCategories;

const SAMPLE_TRANSACTIONS = [
  { id: "t1", date: "2025-01-03", description: "SYSCO FOODS", amount: -2340.50, category: "1", account: "Checking ••4821", reconciled: true },
  { id: "t2", date: "2025-01-05", description: "SQUARE INC PAYMENT", amount: 8450.00, category: "8", account: "Checking ••4821", reconciled: true },
  { id: "t3", date: "2025-01-07", description: "ATMOS ENERGY GAS", amount: -287.40, category: "3", account: "Checking ••4821", reconciled: false },
  { id: "t4", date: "2025-01-08", description: "META ADS", amount: -450.00, category: "4", account: "Credit ••7742", reconciled: false },
  { id: "t5", date: "2025-01-10", description: "US FOODS INC", amount: -1890.00, category: "1", account: "Checking ••4821", reconciled: true },
  { id: "t6", date: "2025-01-12", description: "SQUARE INC PAYMENT", amount: 9100.00, category: "8", account: "Checking ••4821", reconciled: true },
  { id: "t7", date: "2025-01-14", description: "DOORDASH TRANSFER", amount: 1240.00, category: "9", account: "Checking ••4821", reconciled: false },
  { id: "t8", date: "2025-01-15", description: "RENT - ROUND ROCK PROP", amount: -3500.00, category: "3", account: "Checking ••4821", reconciled: true },
  { id: "t9", date: "2025-01-17", description: "GUSTO PAYROLL", amount: -5200.00, category: "2", account: "Checking ••4821", reconciled: true },
  { id: "t10", date: "2025-01-19", description: "AMAZON BUSINESS", amount: -234.80, category: "7", account: "Credit ••7742", reconciled: false },
  { id: "t11", date: "2025-01-20", description: "SYSCO FOODS", amount: -1980.00, category: "1", account: "Checking ••4821", reconciled: false },
  { id: "t12", date: "2025-01-22", description: "SQUARE INC PAYMENT", amount: 7800.00, category: "8", account: "Checking ••4821", reconciled: false },
  { id: "t13", date: "2025-01-25", description: "GOOGLE ADS", amount: -320.00, category: "4", account: "Credit ••7742", reconciled: false },
  { id: "t14", date: "2025-01-28", description: "LIBERTY MUTUAL INS", amount: -890.00, category: "6", account: "Checking ••4821", reconciled: false },
  { id: "t15", date: "2025-01-29", description: "DOORDASH TRANSFER", amount: 980.00, category: "9", account: "Checking ••4821", reconciled: false },
];

const SAMPLE_BUDGETS = [
  { id: "b1", categoryId: "1", monthly: 8000, annual: 96000 },
  { id: "b2", categoryId: "2", monthly: 16000, annual: 192000 },
  { id: "b3", categoryId: "3", monthly: 4000, annual: 48000 },
  { id: "b4", categoryId: "4", monthly: 1000, annual: 12000 },
  { id: "b5", categoryId: "6", monthly: 900, annual: 10800 },
  { id: "b6", categoryId: "7", monthly: 500, annual: 6000 },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
// Thin wrappers over the active country pack. They must stay functions (not
// captured values) so the pack can be swapped after the tenant row loads and
// the next render picks it up.
const fmt = (v) => money(v);
const fmtDate = (s) => ctryDate(s);
const fmtShort = (s) => ctryDateShort(s);

// ─── BANK STATEMENT PARSERS (inlined) ───────────────────────────────────────

function parseCSVLine(line) {
  const cols = []; let cur = ''; let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  cols.push(cur.trim());
  return cols;
}

// ─── AUTO-CATEGORIZATION ──────────────────────────────────────────────────────
function normalizeDescription(s) {
  if (!s) return '';
  return s
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3)
    .slice(0, 3)
    .join(' ');
}

function getCategoryHistory(transactions) {
  const counts = new Map();
  for (const t of transactions) {
    if (!t.category || t.category === UNCATEGORIZED || !t.description) continue;
    const norm = normalizeDescription(t.description);
    if (!norm) continue;
    if (!counts.has(norm)) counts.set(norm, new Map());
    const inner = counts.get(norm);
    inner.set(t.category, (inner.get(t.category) || 0) + 1);
  }
  const out = new Map();
  for (const [norm, inner] of counts) {
    let best = null, bestN = 0;
    for (const [cat, n] of inner) {
      if (n > bestN) { best = cat; bestN = n; }
    }
    if (best) out.set(norm, best);
  }
  return out;
}

function suggestCategory(desc, history) {
  const norm = normalizeDescription(desc);
  return norm ? history.get(norm) : null;
}

function applyAutoCategorize(imported, allTransactions) {
  const history = getCategoryHistory(allTransactions);
  return imported.map(t => {
    if (t.category && t.category !== UNCATEGORIZED) return t;
    const suggested = suggestCategory(t.description, history);
    return suggested ? { ...t, category: suggested, autoCategorized: true } : t;
  });
}

function expandDateRangeIfNeeded(imported, dateRange, setDateRange) {
  if (!imported || imported.length === 0) return;
  const dates = imported.map(t => t.date).filter(Boolean).sort();
  if (dates.length === 0) return;
  const minD = dates[0];
  const maxD = dates[dates.length - 1];
  const newStart = minD < dateRange.start ? minD : dateRange.start;
  const newEnd = maxD > dateRange.end ? maxD : dateRange.end;
  if (newStart !== dateRange.start || newEnd !== dateRange.end) {
    setDateRange({ start: newStart, end: newEnd });
  }
}

// ─── BOOKKEEPER AGENT ─────────────────────────────────────────────────────────
// Rules-based audit pass over transactions, surfaced on the Bookkeeper screen.
// Each rule returns { items, severity, title, fixLabel, fixTag } where items is
// the list of affected transactions and fixTag is the string to append/strip
// from t.tags when the user clicks "Fix all".

const PERSONAL_MIX_VENDORS = ["AMAZON", "WALMART", "COSTCO", "TARGET", "BEST BUY"];

function normalizeVendorKey(desc) {
  return (desc || "").toUpperCase().replace(/[^A-Z\s]/g, " ").split(/\s+/).filter(w => w.length >= 4).slice(0, 2).join(" ");
}

function hasTag(t, tag) { return Array.isArray(t.tags) && t.tags.includes(tag); }

function detectMissing1099(transactions) {
  const year = new Date().getFullYear();
  const yearStart = year + "-01-01";
  const expensesYear = transactions.filter(t => parseFloat(t.amount) < 0 && t.date >= yearStart && isRevenueRelevant(t));
  const byVendor = {};
  for (const t of expensesYear) {
    const key = normalizeVendorKey(t.description);
    if (!key) continue;
    if (!byVendor[key]) byVendor[key] = { vendor: key, total: 0, items: [], hasFlag: false };
    byVendor[key].total += Math.abs(parseFloat(t.amount));
    byVendor[key].items.push(t);
    if (hasTag(t, "1099_flag") || hasTag(t, "1099_dismissed")) byVendor[key].hasFlag = true;
  }
  return Object.values(byVendor).filter(v => v.total >= 600 && !v.hasFlag).sort((a, b) => b.total - a.total);
}

function detectDuplicateCharges(transactions) {
  const expenses = transactions.filter(t => parseFloat(t.amount) < 0 && isRevenueRelevant(t));
  const dayMs = 24 * 60 * 60 * 1000;
  const seen = new Set();
  const pairs = [];
  for (let i = 0; i < expenses.length; i++) {
    for (let j = i + 1; j < expenses.length; j++) {
      const a = expenses[i], b = expenses[j];
      if (Math.abs(parseFloat(a.amount) - parseFloat(b.amount)) > 5) continue;
      if (Math.abs(new Date(a.date) - new Date(b.date)) > 3 * dayMs) continue;
      const ak = normalizeVendorKey(a.description), bk = normalizeVendorKey(b.description);
      if (!ak || ak !== bk) continue;
      const pairKey = [a.id, b.id].sort().join("|");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      pairs.push({ a, b, vendor: ak });
    }
  }
  return pairs;
}

function detectSection179Missing(transactions) {
  return transactions.filter(t => parseFloat(t.amount) < -2500 && !hasTag(t, "section_179") && !hasTag(t, "section_179_dismissed"));
}

function detectMealsNot50(transactions, categories) {
  const mealsCats = categories.filter(c => c.taxLine === "Meals" || c.name === "Meals");
  if (mealsCats.length === 0) return [];
  const ids = new Set(mealsCats.map(c => c.id));
  return transactions.filter(t => ids.has(t.category) && !hasTag(t, "meals_50pct") && !hasTag(t, "meals_50pct_dismissed"));
}

function detectUndocumentedExpense(transactions) {
  return transactions.filter(t => parseFloat(t.amount) < -75 && (!t.notes || t.notes.trim() === "") && t.source !== "kitchen_purchase" && !hasTag(t, "doc_dismissed"));
}

function detectStaleUncategorized(transactions) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return transactions.filter(t => (t.category === UNCATEGORIZED || !t.category) && t.date < cutoffStr);
}

function detectPersonalMix(transactions) {
  return transactions.filter(t => {
    if (parseFloat(t.amount) >= 0) return false;
    const desc = (t.description || "").toUpperCase();
    if (!PERSONAL_MIX_VENDORS.some(v => desc.includes(v))) return false;
    return t.category === UNCATEGORIZED || !t.category;
  });
}

function detectSalesTaxGap(transactions, categories) {
  const yearStart = new Date().getFullYear() + "-01-01";
  const revenue = transactions.filter(t => parseFloat(t.amount) > 0 && t.date >= yearStart && isRevenueRelevant(t))
    .reduce((s, t) => s + parseFloat(t.amount), 0);
  if (revenue === 0) return null;
  const taxCat = categories.find(c => c.taxLine === "Taxes & Licenses");
  const collected = taxCat
    ? transactions.filter(t => t.category === taxCat.id && t.date >= yearStart).reduce((s, t) => s + Math.abs(parseFloat(t.amount) || 0), 0)
    : 0;
  if (collected === 0) return { revenue, collected, hint: "No transactions filed under Taxes & Licenses this year" };
  return null;
}

// Persist global dismissals (sales_tax, duplicates) per tenant + year in
// localStorage. Per-row dismissals use t.tags so they sync across devices.
function dismissalKey(tenantId) {
  return `cfo_dismissed_${tenantId || "demo"}_${new Date().getFullYear()}`;
}
function getDismissals(tenantId) {
  try { return new Set(JSON.parse(localStorage.getItem(dismissalKey(tenantId)) || "[]")); }
  catch { return new Set(); }
}
function dismissIssueGlobal(tenantId, issueId) {
  const set = getDismissals(tenantId);
  set.add(issueId);
  localStorage.setItem(dismissalKey(tenantId), JSON.stringify([...set]));
}

function runBookkeeperRules(transactions, categories, tenantId) {
  const dismissed = getDismissals(tenantId);
  const issues = [];
  const missing1099 = detectMissing1099(transactions);
  if (missing1099.length > 0 && !dismissed.has("1099")) {
    issues.push({
      id: "1099", severity: "critical",
      title: missing1099.length + " vendor" + (missing1099.length === 1 ? "" : "s") + " owed a 1099-NEC (>$600/yr)",
      description: "Form 1099-NEC must be issued to each non-employee paid $600+ in a calendar year. Common for musicians, freelancers, contractors.",
      groups: missing1099,
      fixTag: "1099_flag",
      fixLabel: "Flag all as 1099 contractor",
    });
  }
  const dups = detectDuplicateCharges(transactions);
  if (dups.length > 0 && !dismissed.has("duplicates")) {
    issues.push({
      id: "duplicates", severity: "critical",
      title: dups.length + " possible duplicate charge" + (dups.length === 1 ? "" : "s"),
      description: "Same vendor, near-identical amount, dates within 3 days. Could be double-charge from the vendor or accidental double-import.",
      pairs: dups,
    });
  }
  const taxGap = detectSalesTaxGap(transactions, categories);
  if (taxGap && !dismissed.has("sales_tax")) {
    issues.push({
      id: "sales_tax", severity: "critical",
      title: "Sales tax not tracked for the current year",
      description: "Revenue of " + fmt(taxGap.revenue) + " recorded but " + fmt(taxGap.collected) + " filed under Taxes & Licenses. Texas restaurants typically collect ~8.25%.",
    });
  }
  const sec179 = detectSection179Missing(transactions);
  if (sec179.length > 0) {
    issues.push({
      id: "section_179", severity: "medium",
      title: sec179.length + " expense" + (sec179.length === 1 ? "" : "s") + " over $2,500 without Section 179 election",
      description: "Equipment purchases above the de minimis threshold can be fully deducted in year of purchase under Section 179 — but only if elected on Form 4562.",
      items: sec179,
      fixTag: "section_179",
      fixLabel: "Mark all for Section 179 election",
    });
  }
  const meals = detectMealsNot50(transactions, categories);
  if (meals.length > 0) {
    issues.push({
      id: "meals_50", severity: "medium",
      title: meals.length + " Meals transaction" + (meals.length === 1 ? "" : "s") + " not flagged 50% deductible",
      description: "IRS Section 274 — business meals are deductible at 50% only. Flag them so Tax Summary can compute the right deduction.",
      items: meals,
      fixTag: "meals_50pct",
      fixLabel: "Flag all Meals as 50% deductible",
    });
  }
  const undoc = detectUndocumentedExpense(transactions);
  if (undoc.length > 0) {
    issues.push({
      id: "docs", severity: "medium",
      title: undoc.length + " expense" + (undoc.length === 1 ? "" : "s") + " over $75 without notes",
      description: "IRS Pub 463 — expenses above $75 should have contemporaneous documentation. Add a note (vendor/business purpose/receipt link).",
      items: undoc,
    });
  }
  const stale = detectStaleUncategorized(transactions);
  if (stale.length > 0) {
    issues.push({
      id: "stale", severity: "hygiene",
      title: stale.length + " uncategorized older than 14 days",
      description: "Older uncategorized rows tend to lose context. Categorize them while you still remember what they were.",
      items: stale,
    });
  }
  const personal = detectPersonalMix(transactions);
  if (personal.length > 0) {
    issues.push({
      id: "personal_mix", severity: "hygiene",
      title: personal.length + " Amazon/Walmart/Costco charge" + (personal.length === 1 ? "" : "s") + " uncategorized",
      description: "These vendors are common business+personal mix. Audit risk if categorized as broad expense without a specific business sub-category.",
      items: personal,
    });
  }
  return issues;
}

function computeComplianceScore(issues) {
  const weights = { critical: 10, medium: 5, hygiene: 1 };
  const itemCount = (issue) =>
    issue.items?.length || issue.groups?.length || issue.pairs?.length || 1;
  const penalty = issues.reduce((s, i) => s + (weights[i.severity] || 0) * Math.min(itemCount(i), 10) / 10, 0);
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

function daysUntilNextDeadline(now = new Date()) {
  const year = now.getFullYear();
  const deadlines = [
    { name: "1099-NEC filing", date: new Date(year, 0, 31) },
    { name: "Q1 estimated tax", date: new Date(year, 3, 15) },
    { name: "Q2 estimated tax", date: new Date(year, 5, 15) },
    { name: "Q3 estimated tax", date: new Date(year, 8, 15) },
    { name: "Q4 estimated tax", date: new Date(year + 1, 0, 15) },
  ];
  for (const d of deadlines) {
    if (d.date > now) {
      const days = Math.ceil((d.date - now) / (24 * 60 * 60 * 1000));
      return { name: d.name, date: d.date.toISOString().slice(0, 10), days };
    }
  }
  return null;
}

// ─── ACCRUAL DATE ─────────────────────────────────────────────────────────────
// For transactions Anderson flags as "prior period" (e.g. payroll earned in Dec
// but cleared in Jan), reports that track operational performance (P&L, Tax
// Summary, Insights) want the expense in the period it was *earned*, not paid.
// Cash Flow, account balance, and the transaction date itself stay on the
// actual payment date. accrualDate(t) returns the date the row should land on
// for accrual-style reports.
function accrualDate(t) {
  if (!t || !t.date) return t?.date;
  if (!t.prior_period) return t.date;
  const [y, m] = t.date.split("-").map(s => parseInt(s, 10));
  // Last day of (month - 1). new Date(year, month, 0) gives the last day of
  // the previous month because month is 0-indexed and day=0 rolls back one.
  const lastDay = new Date(y, m - 1, 0);
  return lastDay.toISOString().slice(0, 10);
}

// Transactions whose source is in this set are bank-side movements that
// mirror something already counted elsewhere (internal transfers, Square
// deposits whose gross is already booked via square_sale_gross). They must
// be excluded from income/expense roll-ups to avoid double-counting.
// Sources that represent bank-side clearing/settlement of revenue already
// booked from the operational source. Filtered out of every P&L roll-up
// (income, expense, KPIs) so the same dollar isn't counted twice.
//   - square_settlement     → Square POS deposits (Square Net Sales is the truth)
//   - aggregator_settlement → DoorDash/UberEats/GrubHub/Wix net deposits
//                              (gross is already in Square Net Sales as Other tender)
//   - internal_transfer     → bank-to-bank moves between own accounts
const NON_REVENUE_SOURCES = new Set(["internal_transfer", "square_settlement", "aggregator_settlement"]);
function isRevenueRelevant(t) {
  return t && !NON_REVENUE_SOURCES.has(t.source);
}

// Enhanced filter that also accounts for:
//   - Categories of type='transfer' (Tip Pass-Through, Square Holding, etc).
//     These represent passthrough flows — money the operator is moving on
//     behalf of someone else (server tips, customer holds). They never hit
//     P&L as income or expense.
//   - Split parents — when a bank transaction has been split into smaller
//     rows (parent_id pointing back at it), the parent is just the audit
//     record of the bank line. The children carry the real classification
//     and are the ones that count.
// Use it from any roll-up that aggregates transactions for P&L / Insights /
// Budget / Tax / CashFlow purposes. Memoize at the screen level — both Sets
// only change when categories or transactions change.
function makeLedgerFilter(categories, allTxns) {
  const transferCatIds = new Set((categories || []).filter(c => c.type === "transfer").map(c => c.id));
  const splitParentIds = new Set();
  for (const t of (allTxns || [])) if (t.parent_id) splitParentIds.add(t.parent_id);
  return function ledgerFilter(t) {
    return isRevenueRelevant(t)
      && !transferCatIds.has(t.category)
      && !splitParentIds.has(t.id);
  };
}

// Split a set of ledger rows into income and expense totals. Which side a row
// lands on is decided by its category type, NOT by the sign of the amount: a
// vendor refund is a credit posted to an expense account and has to reduce that
// expense rather than read as revenue. Only uncategorized rows fall back to the
// sign. Both buckets sum signed, so contra entries net out.
// Callers must pre-filter with makeLedgerFilter / detectTransferPairs.
function splitIncomeExpense(txns, categories) {
  const catTypeById = new Map((categories || []).map(c => [c.id, c.type]));
  let income = 0, expense = 0;
  for (const t of txns || []) {
    const amt = parseFloat(t.amount) || 0;
    const type = catTypeById.get(t.category);
    if (type ? type === "income" : amt > 0) income += amt;
    else expense += -amt;
  }
  return { income, expense, catTypeById };
}

// ─── INTERNAL TRANSFER DETECTION ──────────────────────────────────────────────
// A transfer between your own accounts (Checking -> Savings, payment of credit
// card from checking) shows up in the ledger as two transactions: one negative
// in the source account, one positive in the destination. They cancel out at
// the entity level, so counting them as income/expense double-inflates both.
// We pair them when: opposite signs, matching absolute amount, different
// account, and dates within 2 days. Skip ambiguous matches (>1 candidate).
//
// Identity is account_id when present, falling back to the `account` display
// string ("Main 6577 ••6577"). The fallback matters: importers and older rows
// leave account_id null, and requiring it silently disabled the whole pass —
// every transfer leg then landed in income AND expense.
function accountKeyOf(t) {
  return t.account_id || (t.account ? "name:" + t.account : null);
}
function detectTransferPairs(transactions) {
  const pairs = new Map();
  // Transactions explicitly tagged source='internal_transfer' (set at Plaid
  // ingestion, by parser pattern detection, or by direct DB update for
  // half-imported transfers) count as transfers even without a matching
  // partner row — they're already known not to be revenue or expense.
  for (const t of transactions || []) {
    if (t.source === 'internal_transfer') pairs.set(t.id, null);
  }
  const candidates = (transactions || []).filter(t => accountKeyOf(t) && !isNaN(parseFloat(t.amount)));
  const negatives = candidates.filter(t => parseFloat(t.amount) < 0);
  const positives = candidates.filter(t => parseFloat(t.amount) > 0);
  const dayMs = 24 * 60 * 60 * 1000;
  for (const neg of negatives) {
    if (pairs.has(neg.id)) continue;
    const negAmt = parseFloat(neg.amount);
    const negDate = new Date(neg.date).getTime();
    const negKey = accountKeyOf(neg);
    const matches = positives.filter(p =>
      !pairs.has(p.id) &&
      accountKeyOf(p) !== negKey &&
      Math.abs(parseFloat(p.amount) + negAmt) < 0.01 &&
      Math.abs(new Date(p.date).getTime() - negDate) <= 2 * dayMs
    );
    if (matches.length === 1) {
      pairs.set(neg.id, matches[0].id);
      pairs.set(matches[0].id, neg.id);
    }
  }
  return pairs;
}

// ─── BANK ACCOUNT LINK ────────────────────────────────────────────────────────
// Imports arrive with an "account" display string (e.g. "Checking ••4821" from
// the BoA parser) but no account_id. Once the user has registered Bank Accounts
// we can wire account_id automatically: exact name match first, then a fallback
// on the last 4 digits — handles "Checking ••4821" vs. "Checking ...4821" drift.
function linkAccountId(txn, accounts) {
  if (txn.account_id || !txn.account || !accounts || accounts.length === 0) return txn;
  const direct = accounts.find(a => a.name === txn.account);
  if (direct) return { ...txn, account_id: direct.id };
  const last4 = (txn.account.match(/(\d{4})/) || [])[1];
  if (last4) {
    const byLast4 = accounts.find(a => a.name.includes(last4));
    if (byLast4) return { ...txn, account_id: byLast4.id };
  }
  return txn;
}

function applyAccountLink(transactions, accounts) {
  if (!accounts || accounts.length === 0) return transactions;
  return transactions.map(t => linkAccountId(t, accounts));
}

// ─── RECURRING MATCH ──────────────────────────────────────────────────────────
function matchRecurring(txn, rules) {
  if (!rules || rules.length === 0 || !txn.description) return null;
  const desc = txn.description.toUpperCase();
  for (const r of rules) {
    if (r.status !== 'active') continue;
    if (!r.vendor_pattern) continue;
    if (!desc.includes(r.vendor_pattern.toUpperCase())) continue;
    const expected = Math.abs(parseFloat(r.amount) || 0);
    const actual = Math.abs(parseFloat(txn.amount) || 0);
    if (expected > 0) {
      const drift = Math.abs(actual - expected) / expected * 100;
      if (drift > parseFloat(r.variance_pct ?? 10)) continue;
    }
    return r;
  }
  return null;
}

function applyRecurringMatch(imported, rules) {
  if (!rules || rules.length === 0) return imported;
  return imported.map(t => {
    const rule = matchRecurring(t, rules);
    if (!rule) return t;
    return {
      ...t,
      category: rule.category_id || t.category,
      recurring_id: rule.id,
    };
  });
}

function parseBoACSV(text) {
  const lines = text.split('\n').map(l => l.replace('\r', '')).filter(l => l.trim());
  if (lines.length === 0) return [];

  // Detect the header row by looking for a line that mentions both a date column
  // and at least one money column. Handles BoA's plain export (Date / Description /
  // Amount) and the multi-cardholder format (Date / CardHolder Name / Account/Card
  // Number / Description / Amount or Debit/Credit). Skips preamble rows like
  // "Total credits / Total debits" that appear above the real header.
  let headerIdx = -1;
  let headers = [];
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const cols = parseCSVLine(lines[i]).map(c => c.trim().toLowerCase());
    const hasDate = cols.some(c => c.includes('date'));
    const hasMoney = cols.some(c => c === 'amount' || c.includes('debit') || c.includes('credit'));
    if (hasDate && hasMoney && cols.length >= 3) {
      headerIdx = i;
      headers = cols;
      break;
    }
  }

  const find = (...needles) => headers.findIndex(h => needles.some(n => h.includes(n)));
  const txns = [];

  if (headerIdx >= 0) {
    const dateIdx       = find('posted date', 'date');
    const descIdx       = find('description', 'merchant', 'payee');
    const cardHolderIdx = find('cardholder');
    const last4Idx      = find('account/card', 'last 4', 'card number');
    const amountIdx     = find('amount');
    const debitIdx      = find('debit');
    const creditIdx     = find('credit');

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < Math.max(dateIdx, 1) + 1) continue;
      const dateStr = (cols[dateIdx] || '').trim();
      if (!dateStr) continue;
      // Country-aware: "03/04/2025" is March 4 under a US tenant and 3 April
      // under a BR one. The old `new Date(str)` always assumed US and failed
      // silently — wrong dates, no error.
      const parsedDate = ctryParseDate(dateStr);
      if (!parsedDate) continue;

      // Detect pattern BEFORE touching the sign — payments/transfers shouldn't
      // be flipped by the cardholder-spend convention even when a CardHolder
      // column is present, because they're not charges to begin with.
      const desc = ((cols[descIdx] || '') || (cols[cardHolderIdx] || '')).trim();
      const upper = desc.toUpperCase();
      const isInternalTransfer =
        /PAYMENT (TO|FROM) (CRD|CHK)/.test(upper) ||
        /\bAUTOPAY\b/.test(upper) ||
        /TRANSFER (TO|FROM) /.test(upper);

      let amount = NaN;
      if (amountIdx >= 0) {
        // Country-aware: "1.234,56" is 1234.56 in BR but 1.234 under the old
        // US-only cleaner — a silent 1000x error. Also honours accounting
        // parentheses, which the old cleaner stripped into a positive.
        amount = ctryParseAmount(cols[amountIdx] || '');
        // Multi-cardholder credit-card exports list every charge as a positive
        // number ("$133.82"). For the ledger these are expenses and have to be
        // negative. Detect the format via the CardHolder Name column and flip
        // the sign — but skip the flip for internal transfers, whose sign in
        // the export already matches the ledger convention (negative when the
        // user's account is the source, positive when destination).
        if (cardHolderIdx >= 0 && !isNaN(amount) && amount > 0 && !isInternalTransfer) {
          amount = -amount;
        }
      } else if (debitIdx >= 0 || creditIdx >= 0) {
        const debit  = ctryParseAmount(cols[debitIdx]  || '') || 0;
        const credit = ctryParseAmount(cols[creditIdx] || '') || 0;
        amount = credit - debit;
      }
      if (isNaN(amount) || amount === 0) continue;

      const cardHolder = (cols[cardHolderIdx] || '').trim();
      const last4 = (cols[last4Idx] || '').trim().match(/\d{4}/)?.[0] || '';

      let account = country().importedAccountLabel;
      if (cardHolder && last4) account = cardHolder.toUpperCase() + ' – ' + last4;
      else if (cardHolder)     account = cardHolder.toUpperCase();
      else if (last4)          account = 'Card ' + last4;

      txns.push({
        id: 'csv_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2,5),
        date: parsedDate,
        description: desc.toUpperCase().slice(0, 80),
        amount,
        account,
        category_id: null,
        category: UNCATEGORIZED,
        reconciled: false,
        source: isInternalTransfer ? 'internal_transfer' : 'csv',
      });
    }
    return txns;
  }

  // Legacy fallback: no recognizable header — assume positional date, desc, amount.
  for (let i = 0; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 3) continue;
    const first = cols[0].toLowerCase();
    if (first === 'date' || first === 'posted date' || first.startsWith('account')) continue;
    let date = cols[0], desc = cols[1] || '', amtStr = cols[2] || '';
    if (cols.length >= 5) { desc = cols[2] || cols[1]; amtStr = cols[4]; }
    const amount = ctryParseAmount(amtStr);
    if (isNaN(amount)) continue;
    const parsedDate = ctryParseDate(date);
    if (!parsedDate) continue;
    txns.push({ id: 'csv_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2,5), date: parsedDate, description: desc.toUpperCase().trim().slice(0, 80), amount, account: country().importedAccountLabel, category_id: null, category: UNCATEGORIZED, reconciled: false, source: 'csv' });
  }
  return txns;
}

function parseOFX(text) {
  const txns = [];
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  for (const block of blocks) {
    const get = (tag) => { const m = block.match(new RegExp('<' + tag + '>([^<\n]+)', 'i')); return m ? m[1].trim() : ''; };
    const dtPosted = get('DTPOSTED');
    const name = get('NAME') || get('MEMO') || get('PAYEE') || 'UNKNOWN';
    const amtStr = get('TRNAMT');
    const fitid = get('FITID');
    if (!dtPosted || !amtStr) continue;
    const amount = parseFloat(amtStr);
    if (isNaN(amount)) continue;
    txns.push({ id: fitid ? 'ofx_' + fitid : 'ofx_' + Date.now() + '_' + Math.random().toString(36).slice(2,5), date: dtPosted.slice(0,4) + '-' + dtPosted.slice(4,6) + '-' + dtPosted.slice(6,8), description: name.toUpperCase().trim().slice(0, 80), amount, account: country().importedAccountLabel, category_id: null, category: UNCATEGORIZED, reconciled: false, source: 'ofx' });
  }
  return txns;
}


// ─── DATE HELPERS ─────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().split("T")[0];
const firstOfMonth = () => { const d = new Date(); d.setDate(1); return d.toISOString().split("T")[0]; };
const firstOfYear  = () => { const d = new Date(); d.setMonth(0); d.setDate(1); return d.toISOString().split("T")[0]; };
const monthAgo     = () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split("T")[0]; };
const quarterStart = () => {
  const d = new Date(); const q = Math.floor(d.getMonth() / 3);
  d.setMonth(q * 3); d.setDate(1); return d.toISOString().split("T")[0];
};
const lastMonthStart = () => { const d = new Date(); d.setMonth(d.getMonth()-1); d.setDate(1); return d.toISOString().split("T")[0]; };
const lastMonthEnd   = () => { const d = new Date(); d.setDate(0); return d.toISOString().split("T")[0]; };

// ─── BOOKS CLOSED LOCK ────────────────────────────────────────────────────────
// Jan–Jun 2026 lives in the ledger as monthly P&L summaries imported from the
// accountant's spreadsheet (source 'pl_import', account "P&L Import"). Any row
// synced or file-imported into that window would double-count against those
// summaries, so every ingestion path filters through inOpenPeriod(). The DB
// enforces the same rule with a BEFORE INSERT trigger (r7_ledger_locks +
// r7_ledger_block_closed_period) so server-side syncs (Plaid, Square) are
// covered even if the UI guard is bypassed.
const BOOKS_CLOSED_THROUGH = "2026-06-30";
const inOpenPeriod = (t) => !t.date || t.date > BOOKS_CLOSED_THROUGH;

const DATE_PRESETS = [
  { label: "This Month",    start: firstOfMonth,  end: today },
  { label: "Last Month",    start: lastMonthStart, end: lastMonthEnd },
  { label: "This Quarter",  start: quarterStart,  end: today },
  { label: "This Year",     start: firstOfYear,   end: today },
  { label: "Last 90 Days",  start: () => { const d = new Date(); d.setDate(d.getDate()-90); return d.toISOString().split("T")[0]; }, end: today },
  { label: "All Time",      start: () => "2020-01-01", end: today },
];

// ─── DATE RANGE PICKER ────────────────────────────────────────────────────────
function DateRangePicker({ dateRange, setDateRange }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activePreset = DATE_PRESETS.find(p => p.start() === dateRange.start && p.end() === dateRange.end);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="btn btn-outline btn-sm"
        style={{ gap: 8, fontFamily: "var(--font-mono)", fontSize: 12, minWidth: 220 }}
        onClick={() => setOpen(o => !o)}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span style={{ color: "var(--accent)" }}>{activePreset ? activePreset.label : "Custom"}</span>
        <span style={{ color: "var(--text3)" }}>·</span>
        <span>{dateRange.start} → {dateRange.end}</span>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 500,
          background: "var(--surface)", border: "1px solid var(--border2)",
          borderRadius: "var(--radius)", padding: 8, minWidth: 220,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
        }}>
          {DATE_PRESETS.map(p => (
            <div
              key={p.label}
              onClick={() => { setDateRange({ start: p.start(), end: p.end() }); setCustom(false); setOpen(false); }}
              style={{
                padding: "8px 12px", borderRadius: 6, cursor: "pointer", fontSize: 13,
                background: activePreset?.label === p.label ? "var(--accentBg)" : "transparent",
                color: activePreset?.label === p.label ? "var(--accent)" : "var(--text2)",
                transition: "all 0.1s"
              }}
              onMouseEnter={e => { if (activePreset?.label !== p.label) e.currentTarget.style.background = "var(--surface2)"; }}
              onMouseLeave={e => { if (activePreset?.label !== p.label) e.currentTarget.style.background = "transparent"; }}
            >
              {p.label}
            </div>
          ))}
          <div style={{ borderTop: "1px solid var(--border)", margin: "6px 0", padding: "8px 12px 4px" }}>
            <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.1em" }}>Custom Range</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="date" className="input" style={{ fontSize: 12, padding: "5px 8px", flex: 1 }}
                value={dateRange.start} onChange={e => setDateRange(r => ({ ...r, start: e.target.value }))} />
              <span style={{ color: "var(--text3)", fontSize: 11 }}>→</span>
              <input type="date" className="input" style={{ fontSize: 12, padding: "5px 8px", flex: 1 }}
                value={dateRange.end} onChange={e => setDateRange(r => ({ ...r, end: e.target.value }))} />
            </div>
            <button className="btn btn-primary btn-sm" style={{ width: "100%", marginTop: 8, justifyContent: "center" }} onClick={() => setOpen(false)}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── KITCHEN SYNC BUTTON ──────────────────────────────────────────────────────
function KitchenSyncButton({ tenantId, categories, dateRange, onSync, showToast }) {
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  const sync = async () => {
    setLoading(true);
    showToast("Syncing from Favo Kitchen...", "info");
    try {
      // Revenue used to come from r7_snapshots here, but that table is the
      // Kitchen inventory snapshot (label/counts), not Square POS sales — the
      // select silently 404'd. Revenue now flows through "Sync Sales" (Square
      // Orders). Kitchen sync is purchases (vendor invoices) only.
      const [purchases, vendors] = await Promise.all([
        fetchKitchenPurchases(tenantId, dateRange),
        fetchKitchenVendors(tenantId),
      ]);

      // Build vendor map
      const vendorMap = {};
      vendors.forEach(v => { vendorMap[v.id] = v.name; });

      // Find category IDs
      const foodBevCat = categories.find(c => c.name === "Food & Beverage" || c.tax_line === "COGS");

      const expTxns = purchasesToTransactions(purchases, vendorMap, foodBevCat?.id);
      const mapped = expTxns.map(t => ({ ...t, category: t.category_id || UNCATEGORIZED }));
      const all = mapped.filter(inOpenPeriod);
      const lockedOut = mapped.length - all.length;

      if (all.length === 0) {
        showToast(lockedOut > 0
          ? `Books are closed through ${BOOKS_CLOSED_THROUGH} — ${lockedOut} invoice(s) already covered by the imported P&L.`
          : "No new vendor invoices from Kitchen in this date range.", "info");
      } else {
        onSync(all);
        setLastSync(new Date());
        showToast(all.length + " vendor invoice(s) synced from Kitchen" + (lockedOut > 0 ? ` · ${lockedOut} skipped (closed period)` : ""), "success");
      }
    } catch (err) {
      showToast("Sync failed: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className="btn btn-outline btn-sm"
      onClick={sync}
      disabled={loading}
      style={{ gap: 8, borderColor: "var(--accentBorder)", color: loading ? "var(--text3)" : "var(--accent)" }}
      title="Pull invoices + Square revenue from Favo Kitchen"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: loading ? "spin 1s linear infinite" : "none" }}>
        <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
      </svg>
      {loading ? "Syncing..." : "Sync Kitchen"}
      {lastSync && <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>{ctryTime(lastSync)}</span>}
    </button>
  );
}

function SalesSyncButton({ tenantId, dateRange, onSync, showToast }) {
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  const sync = async () => {
    // Never re-pull Square days that fall inside the closed period — those
    // months exist only as the imported P&L summaries and would double-count.
    if (dateRange.end <= BOOKS_CLOSED_THROUGH) {
      showToast(`Books are closed through ${BOOKS_CLOSED_THROUGH} — Square sales for this range are already in the imported P&L.`, "info");
      return;
    }
    const clampedRange = dateRange.start > BOOKS_CLOSED_THROUGH
      ? dateRange
      : { start: "2026-07-01", end: dateRange.end };
    setLoading(true);
    showToast("Pulling Square sales + processing fees...", "info");
    try {
      const result = await syncSquareSales(tenantId, clampedRange);
      setLastSync(new Date());
      // Response shape changed in PR5 (Orders API): totals now expose net_sales,
      // tax, tips, etc separately. Fall back to the old gross_sales field for
      // backward compat in case a stale deployment is still answering.
      const t = result.totals || {};
      // by_channel arrived with the channel split — show where the net came
      // from (POS vs delivery platforms vs own online ordering).
      const CH_LABEL = { dine_in: "POS", wix: "Wix", square_online: "Sq Online", online: "Online", uber_eats: "Uber Eats", doordash: "DoorDash", grubhub: "Grubhub" };
      const channelNote = t.by_channel
        ? " (" + Object.entries(t.by_channel)
            .filter(([, v]) => v.net_sales !== 0)
            .sort((a, b) => b[1].net_sales - a[1].net_sales)
            .map(([ch, v]) => `${CH_LABEL[ch] || ch} ${fmt(v.net_sales)}`)
            .join(" · ") + ")"
        : "";
      const headline = t.net_sales != null
        ? `${result.days_with_sales} days · net ${fmt(t.net_sales)}${channelNote} · tax ${fmt(t.tax || 0)} · tips ${fmt((t.tips || 0) + (t.auto_gratuity || 0))} · fees ${fmt(t.processing_fees || 0)}`
        : `${result.days_with_sales} days · gross ${fmt(t.gross_sales || 0)} · fees ${fmt(t.processing_fees || 0)}`;
      const settlementNote = result.settlements_retagged > 0
        ? ` · ${result.settlements_retagged} bank deposit${result.settlements_retagged === 1 ? "" : "s"} marked as settlement`
        : "";
      const skipNote = ((result.skipped_tax || 0) + (result.skipped_tip || 0)) > 0
        ? ` · ⚠️ skipped ${result.skipped_tax || 0} tax + ${result.skipped_tip || 0} tip days (missing transfer category)`
        : "";
      showToast(headline + settlementNote + skipNote, "success");
      if (onSync) onSync();
    } catch (err) {
      showToast("Square Sales sync failed: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className="btn btn-outline btn-sm"
      onClick={sync}
      disabled={loading}
      style={{ gap: 8, borderColor: "var(--accentBorder)", color: loading ? "var(--text3)" : "var(--accent)" }}
      title="Pull daily gross sales + processing fees from Square — bank-side Square deposits get re-tagged as settlement so they don't double-count"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: loading ? "spin 1s linear infinite" : "none" }}>
        <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
      {loading ? "Syncing..." : "Sync Sales"}
      {lastSync && <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>{ctryTime(lastSync)}</span>}
    </button>
  );
}

function MarketingSyncButton({ tenantId, dateRange, onSync, showToast }) {
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  const sync = async () => {
    setLoading(true);
    showToast("Syncing ad spend from Favo Marketing...", "info");
    try {
      const result = await fetchMarketingSpend(tenantId, dateRange);
      const txns = (result.transactions || []).filter(inOpenPeriod);
      if (txns.length === 0) {
        if (!result.accounts) {
          showToast("No connected ad accounts in Marketing yet.", "info");
        } else {
          showToast("No ad-spend snapshots in this date range.", "info");
        }
      } else {
        onSync(txns);
        setLastSync(new Date());
        const providers = (result.providers || []).join(", ").toUpperCase() || "Marketing";
        showToast(txns.length + " ad-spend accrual(s) synced from " + providers, "success");
      }
    } catch (err) {
      showToast("Marketing sync failed: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className="btn btn-outline btn-sm"
      onClick={sync}
      disabled={loading}
      style={{ gap: 8, borderColor: "var(--accentBorder)", color: loading ? "var(--text3)" : "var(--accent)" }}
      title="Pull ad spend from Favo Marketing (Meta + Google)"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: loading ? "spin 1s linear infinite" : "none" }}>
        <path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>
      </svg>
      {loading ? "Syncing..." : "Sync Marketing"}
      {lastSync && <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>{ctryTime(lastSync)}</span>}
    </button>
  );
}

// Loads Plaid Link's CDN script once and resolves window.Plaid. Kept out of
// index.html so the bundle doesn't pull it on every page load — only when the
// user actually clicks "Sync Bank" the first time.
function loadPlaidLink() {
  return new Promise((resolve, reject) => {
    if (window.Plaid) return resolve(window.Plaid);
    const existing = document.getElementById("plaid-link-script");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Plaid));
      existing.addEventListener("error", () => reject(new Error("Could not load Plaid Link")));
      return;
    }
    const s = document.createElement("script");
    s.id = "plaid-link-script";
    s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    s.onload = () => resolve(window.Plaid);
    s.onerror = () => reject(new Error("Could not load Plaid Link"));
    document.head.appendChild(s);
  });
}

// "Sync Bank" — connects a real bank via Plaid and pulls transactions.
// First click (no item stored) opens the Plaid Link popup to authenticate;
// every click after that just runs an incremental /transactions/sync.
// Bank of America requires Plaid in production with OAuth (see api/plaid-*.js).
const PLAID_TOKEN_KEY = "clariva_plaid_link_token";

function BankSyncButton({ tenantId, onSync, showToast }) {
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  // OAuth re-entry. OAuth banks (Bank of America) redirect the whole page to the
  // bank's site, then back to PLAID_REDIRECT_URI with ?oauth_state_id=... . On
  // that return we must re-create Link with the SAME link_token (stashed in
  // localStorage before we opened) plus receivedRedirectUri, or the handshake
  // never finishes. Non-OAuth banks complete inline and never hit this path.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("oauth_state_id")) return;
    const link_token = localStorage.getItem(PLAID_TOKEN_KEY);
    if (!link_token) return;
    (async () => {
      try {
        const Plaid = await loadPlaidLink();
        const cleanup = () => {
          localStorage.removeItem(PLAID_TOKEN_KEY);
          window.history.replaceState({}, "", window.location.pathname);
        };
        const handler = Plaid.create({
          token: link_token,
          receivedRedirectUri: window.location.href,
          onSuccess: async (public_token, metadata) => {
            cleanup();
            try {
              await exchangePlaidPublicToken(tenantId, public_token, metadata?.institution?.name || "Bank", metadata?.institution?.institution_id || null);
              showToast("Bank connected. Pulling transactions...", "info");
              await syncPlaidTransactions(tenantId);
              setLastSync(new Date());
              if (onSync) onSync();
              showToast("Bank connected & synced", "success");
            } catch (e) { showToast("Bank connect failed: " + e.message, "error"); }
          },
          onExit: (err) => {
            cleanup();
            if (err) showToast("Bank login failed: " + (err.display_message || err.error_message || "cancelled"), "error");
          },
        });
        handler.open();
      } catch (e) { showToast("Could not resume bank login: " + e.message, "error"); }
    })();
  }, []);

  const connect = () => new Promise(async (resolve, reject) => {
    try {
      const Plaid = await loadPlaidLink();
      const { link_token } = await createPlaidLinkToken(tenantId);
      // Stash before opening so an OAuth full-page redirect can resume (above).
      localStorage.setItem(PLAID_TOKEN_KEY, link_token);
      const handler = Plaid.create({
        token: link_token,
        onSuccess: async (public_token, metadata) => {
          localStorage.removeItem(PLAID_TOKEN_KEY);
          try {
            await exchangePlaidPublicToken(
              tenantId,
              public_token,
              metadata?.institution?.name || "Bank",
              metadata?.institution?.institution_id || null
            );
            resolve();
          } catch (e) { reject(e); }
        },
        onExit: (err) => {
          localStorage.removeItem(PLAID_TOKEN_KEY);
          if (err) reject(new Error(err.display_message || err.error_message || "Bank login failed"));
          else reject(new Error("__cancelled__"));
        },
      });
      handler.open();
    } catch (e) { reject(e); }
  });

  const sync = async () => {
    setLoading(true);
    showToast("Pulling transactions from your bank...", "info");
    try {
      let result = await syncPlaidTransactions(tenantId);
      if (result.not_connected) {
        showToast("Opening secure bank login...", "info");
        await connect();
        showToast("Bank connected. Pulling transactions...", "info");
        result = await syncPlaidTransactions(tenantId);
      }
      setLastSync(new Date());
      const errored = (result.institutions || []).filter(i => i.error);
      if (errored.length > 0) {
        showToast("Bank sync issue: " + errored.map(i => i.name + " — " + i.error).join("; "), "error");
      } else {
        showToast(`Bank sync · ${result.added} new · ${result.modified} updated${result.removed ? " · " + result.removed + " removed" : ""}`, "success");
      }
      if (onSync) onSync();
    } catch (err) {
      if (err.message !== "__cancelled__") showToast("Bank sync failed: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className="btn btn-outline btn-sm"
      onClick={sync}
      disabled={loading}
      style={{ gap: 8, borderColor: "var(--accentBorder)", color: loading ? "var(--text3)" : "var(--accent)" }}
      title="Connect a bank (Bank of America, etc.) via Plaid and pull transactions"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: loading ? "spin 1s linear infinite" : "none" }}>
        <line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>
      </svg>
      {loading ? "Syncing..." : "Sync Bank"}
      {lastSync && <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>{ctryTime(lastSync)}</span>}
    </button>
  );
}

// ─── BRAND MARK ───────────────────────────────────────────────────────────────
// Favo mark: hexagon ("favo" = honeycomb cell) + center dot in the module
// color. Stroke follows currentColor so it adapts to dark/light themes.
const FavoMark = ({ size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-label="Favo">
    <polygon points="50,14 81.18,32 81.18,68 50,86 18.82,68 18.82,32" stroke="currentColor" strokeWidth="9" strokeLinejoin="round" />
    <circle cx="50" cy="50" r="8" fill="var(--accent)" />
  </svg>
);

// ─── ICONS (inline SVG) ───────────────────────────────────────────────────────
const Icon = ({ name, size = 16, color = "currentColor" }) => {
  const icons = {
    dashboard: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
    ceo: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.5" fill={color}/></svg>,
    transactions: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
    categories: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
    pl: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    trends: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
    cashflow: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
    budget: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>,
    reconcile: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
    tax: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>,
    upload: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>,
    close: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    plus: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    download: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>,
    edit: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    trash: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
    filter: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>,
    info: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
    check: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
    insights: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
    projects: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h18v18H3zM3 9h18M9 21V9"/></svg>,
    bills: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
    recurring: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>,
    wallet: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>,
    bookkeeper: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
    labor: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="7" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/></svg>,
    sun: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>,
    moon: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
    bank: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>,
  };
  return icons[name] || null;
};

// ─── TOAST ────────────────────────────────────────────────────────────────────
function Toast({ message, type = "info", onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, []);
  const icons = { info: "ℹ️", success: "✅", error: "❌" };
  return (
    <div className="toast">
      <span>{icons[type]}</span>
      <span>{message}</span>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ transactions, categories, budgets, bankAccounts = [], allTransactions, dateRange = {} }) {
  // Detect internal transfers across ALL transactions (not just the date window)
  // so a transfer that straddles a date boundary still pairs correctly.
  const transferPairs = detectTransferPairs(allTransactions || transactions);
  const isLedger = makeLedgerFilter(categories, allTransactions || transactions);
  const realTxns = transactions.filter(t => !transferPairs.has(t.id) && isLedger(t));
  const transferCount = transactions.filter(t => transferPairs.has(t.id)).length;
  const { income: totalIncome, expense: totalExpense, catTypeById } = splitIncomeExpense(realTxns, categories);
  const netIncome = totalIncome - totalExpense;
  const uncat = realTxns.filter(t => t.category === UNCATEGORIZED).length;

  // Bank account balances are computed from ALL transactions (not date-range
  // filtered) because a balance is a point-in-time number, not a window total.
  const activeAccounts = (bankAccounts || []).filter(a => a.status === "active");
  const txnsForBalance = allTransactions || transactions;
  const accountBalances = activeAccounts.map(a => ({ acc: a, balance: calculateAccountBalance(a, txnsForBalance) }));
  const liquid = accountBalances.filter(x => ACCOUNT_TYPE_META[x.acc.type]?.liquid).reduce((s, x) => s + x.balance, 0);
  const debt = accountBalances.filter(x => ACCOUNT_TYPE_META[x.acc.type]?.liability).reduce((s, x) => s + x.balance, 0);
  const cashPosition = liquid + debt;

  // Expense by category (transfers already excluded via realTxns). Sums signed
  // for the same reason as the totals above, so a refund shrinks its category
  // instead of being dropped. Categories that end up net-zero or negative are
  // filtered out — a fully refunded line is not spend.
  const expByCat = {};
  realTxns.forEach(t => {
    if (catTypeById.get(t.category) === "income") return;
    expByCat[t.category] = (expByCat[t.category] || 0) - (parseFloat(t.amount) || 0);
  });
  const catItems = Object.entries(expByCat)
    .map(([cid, amt]) => ({ cat: categories.find(c => c.id === cid), amt }))
    .filter(x => x.cat && x.amt > 0)
    .sort((a, b) => b.amt - a.amt)
    .slice(0, 6);

  // Monthly bars — group by week
  const weeks = ["Wk1", "Wk2", "Wk3", "Wk4"];
  const weeklyIncome = [8450, 9100, 7800, 980];
  const weeklyExpense = [2627.9, 7090, 2214.8, 1210];
  const maxBar = Math.max(...weeklyIncome, ...weeklyExpense);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Overview</div>
          <div className="page-subtitle">
            {dateRange ? dateRange.start + " → " + dateRange.end : ""} · TorresBee
            {transferCount > 0 && <span style={{ marginLeft: 8, color: "var(--text3)" }}>· {transferCount} internal transfer{transferCount === 1 ? "" : "s"} excluded</span>}
          </div>
        </div>
        <div className="flex gap-8">
          <button className="btn btn-outline btn-sm"><Icon name="download" size={13} /> Export</button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card kpi-accent">
          <div className="kpi-label">Total Income</div>
          <div className="kpi-value">{fmt(totalIncome)}</div>
          <div className="kpi-delta pos">▲ 8.3% vs Dec</div>
        </div>
        <div className="kpi-card kpi-red">
          <div className="kpi-label">Total Expenses</div>
          <div className="kpi-value">{fmt(totalExpense)}</div>
          <div className="kpi-delta neg">▲ 3.1% vs Dec</div>
        </div>
        <div className="kpi-card kpi-blue">
          <div className="kpi-label">Net Income</div>
          <div className="kpi-value" style={{ color: netIncome >= 0 ? "var(--accent)" : "var(--red)" }}>{fmt(netIncome)}</div>
          <div className="kpi-delta pos">▲ 12.4% vs Dec</div>
        </div>
        <div className="kpi-card kpi-yellow">
          <div className="kpi-label">Uncategorized</div>
          <div className="kpi-value" style={{ color: uncat > 0 ? "var(--yellow)" : "var(--accent)" }}>{uncat}</div>
          <div className="kpi-delta" style={{ color: uncat > 0 ? "var(--yellow)" : "var(--text3)" }}>
            {uncat > 0 ? "⚠ needs review" : "✓ all categorized"}
          </div>
        </div>
      </div>

      {activeAccounts.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
            <div>
              <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13 }}>Cash Position</div>
              <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                {activeAccounts.length} active account{activeAccounts.length === 1 ? "" : "s"} · point-in-time across all dates
              </div>
            </div>
            <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Liquid</div>
                <div className="mono" style={{ fontSize: 14, color: "var(--accent)" }}>{fmt(liquid)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Debt</div>
                <div className="mono" style={{ fontSize: 14, color: debt < 0 ? "var(--red)" : "var(--text)" }}>{fmt(debt)}</div>
              </div>
              <div style={{ textAlign: "right", paddingLeft: 18, borderLeft: "1px solid var(--border2)" }}>
                <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Net</div>
                <div className="mono" style={{ fontSize: 18, color: cashPosition >= 0 ? "var(--accent)" : "var(--red)" }}>{fmt(cashPosition)}</div>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(activeAccounts.length, 4)}, 1fr)`, gap: 10 }}>
            {accountBalances.slice(0, 4).map(({ acc, balance }) => {
              const meta = ACCOUNT_TYPE_META[acc.type] || ACCOUNT_TYPE_META.other;
              const utilization = (acc.type === "credit" && acc.credit_limit && parseFloat(acc.credit_limit) > 0)
                ? (Math.abs(Math.min(balance, 0)) / parseFloat(acc.credit_limit)) * 100
                : null;
              return (
                <div key={acc.id} style={{ background: "var(--surface2)", borderLeft: `3px solid ${meta.color}`, borderRadius: "var(--radius2)", padding: "10px 14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{acc.name}</div>
                  <div className="mono" style={{ fontSize: 16, marginTop: 4, color: balance >= 0 ? "var(--text)" : "var(--red)" }}>{fmt(balance)}</div>
                  <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                    {meta.label}
                    {utilization != null && <span style={{ color: utilization > 70 ? "var(--red)" : utilization > 40 ? "var(--yellow)" : "var(--text3)", marginLeft: 6 }}>· {utilization.toFixed(0)}% used</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid-2 mt-4" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="flex items-center justify-between mb-16">
            <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13 }}>Weekly Cash Flow</div>
          </div>
          <div className="bar-chart">
            {weeks.map((w, i) => (
              <div key={w} className="bar-item">
                <div style={{ display: "flex", gap: 3, alignItems: "flex-end", flex: 1, width: "100%", height: "100%" }}>
                  <div className="bar bar-income" style={{ height: `${(weeklyIncome[i] / maxBar) * 100}%`, flex: 1 }} title={`Income: ${fmt(weeklyIncome[i])}`} />
                  <div className="bar bar-expense" style={{ height: `${(weeklyExpense[i] / maxBar) * 100}%`, flex: 1 }} title={`Expense: ${fmt(weeklyExpense[i])}`} />
                </div>
                <div className="bar-label">{w}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-16 mt-12" style={{ justifyContent: "center" }}>
            <div className="flex items-center gap-8"><div className="dot" style={{ background: "var(--accent)" }} /><span style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>Income</span></div>
            <div className="flex items-center gap-8"><div className="dot" style={{ background: "var(--red)" }} /><span style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>Expense</span></div>
          </div>
        </div>

        <div className="card">
          <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13, marginBottom: 16 }}>Expenses by Category</div>
          {catItems.map(({ cat, amt }) => (
            <div key={cat.id} className="flex items-center gap-12" style={{ marginBottom: 12 }}>
              <div className="swatch" style={{ background: cat.color }} />
              <div style={{ flex: 1 }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: "var(--text2)" }}>{cat.name}</span>
                  <span className="mono" style={{ fontSize: 11 }}>{fmt(amt)}</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${(amt / totalExpense) * 100}%`, background: cat.color }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-16">
          <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13 }}>Recent Transactions</div>
          <span style={{ fontSize: 12, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>{transactions.length} total</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Account</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
            <tbody>
              {transactions.slice(0, 8).map(t => {
                const cat = categories.find(c => c.id === t.category);
                return (
                  <tr key={t.id}>
                    <td className="mono" style={{ color: "var(--text3)" }}>{fmtShort(t.date)}</td>
                    <td>{t.description}</td>
                    <td>{cat ? <span className="tag" style={{ background: cat.color + "18", color: cat.color, border: `1px solid ${cat.color}30` }}>{cat.name}</span> : <span className="tag tag-gray">—</span>}</td>
                    <td className="mono" style={{ fontSize: 11, color: "var(--text3)" }}>{t.account}</td>
                    <td className={t.amount >= 0 ? "amount-pos text-right" : "amount-neg text-right"}>{fmt(t.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── SPLIT MODAL ──────────────────────────────────────────────────────────────
// One bank transaction → multiple sub-rows with different categories. The
// classic case Anderson hit: a $5,000 PAYROLL ACH where $4,000 is wages
// (Labor expense) and $1,000 is tip-out (Tip Pass-Through, type=transfer).
// The parent stays as the bank-side audit record; children carry the real
// classification and the P&L filters out the parent automatically.
//
// Auto-suggest: if the parent description looks like payroll and there's a
// recent r7_payroll_runs entry within ±10 days, pre-fill the split using its
// totals (gross wages + tips). Operator can edit before saving.
function SplitModal({ txn, categories, payrollRuns = [], onClose, onSave, transactions = [] }) {
  // Find an existing split (if user is editing an already-split txn).
  const existingChildren = (transactions || []).filter(t => t.parent_id === txn.id);

  // Decide an initial set of child rows. Three sources, in priority order:
  //   1) Existing children — operator is re-editing the split.
  //   2) Payroll auto-suggest — bank desc + recent payroll run match.
  //   3) Default 50/50 — two empty rows, user fills.
  const initialChildren = (() => {
    if (existingChildren.length > 0) {
      return existingChildren.map(c => ({
        id: c.id,
        description: c.description || "",
        category: c.category || c.category_id || "",
        amount: parseFloat(c.amount),
      }));
    }

    const descUpper = (txn.description || "").toUpperCase();
    const isPayrollLike = /PAYROLL|ACH.*PAY|GUSTO|ADP|PAYCHEX|SQUARE.*PAY/.test(descUpper);
    if (isPayrollLike) {
      const txnTime = new Date(txn.date).getTime();
      const tenDays = 10 * 24 * 3600 * 1000;
      const nearby = (payrollRuns || []).filter(r => {
        const payDate = r.pay_date || r.payDate || r.period_end || r.periodEnd;
        if (!payDate) return false;
        return Math.abs(new Date(payDate).getTime() - txnTime) <= tenDays;
      }).sort((a, b) => Math.abs(new Date(a.pay_date || a.period_end).getTime() - txnTime) - Math.abs(new Date(b.pay_date || b.period_end).getTime() - txnTime));

      const run = nearby[0];
      const totals = run?.totals || {};
      const grossPick = ["total_gross", "gross_total", "gross_wages", "gross", "total_pay", "total"].find(k => totals[k] != null);
      const tipsPick  = ["total_tips", "tips_total", "tips_owed", "tips"].find(k => totals[k] != null);

      if (run && (grossPick || tipsPick)) {
        const totalAbs = Math.abs(parseFloat(txn.amount));
        const tipsRaw = tipsPick ? Math.abs(parseFloat(totals[tipsPick])) : 0;
        const grossRaw = grossPick ? Math.abs(parseFloat(totals[grossPick])) : (totalAbs - tipsRaw);
        // Heuristic guard: if suggested numbers don't roughly sum to the
        // bank amount, scale them proportionally so the modal opens balanced.
        const suggestedSum = grossRaw + tipsRaw;
        const scale = suggestedSum > 0 ? totalAbs / suggestedSum : 1;
        const wages = Math.round((grossRaw * scale) * 100) / 100;
        const tips = Math.round((totalAbs - wages) * 100) / 100;

        const sign = parseFloat(txn.amount) < 0 ? -1 : 1;
        const laborCat = categories.find(c => c.type === "expense" && /labor|wage|payroll/i.test(c.name)) || categories.find(c => c.type === "expense");
        const tipsCat = categories.find(c => c.type === "transfer" && /tip/i.test(c.name)) || categories.find(c => c.type === "transfer");
        return [
          { description: "Wages — " + (txn.description || "").slice(0, 40), category: laborCat?.id || "", amount: sign * wages },
          { description: "Tips pass-through — " + (txn.description || "").slice(0, 30), category: tipsCat?.id || "", amount: sign * tips },
        ];
      }
    }

    // Default: two empty rows summing to parent amount.
    const half = Math.round((parseFloat(txn.amount) / 2) * 100) / 100;
    const other = Math.round((parseFloat(txn.amount) - half) * 100) / 100;
    return [
      { description: txn.description || "", category: "", amount: half },
      { description: txn.description || "", category: "", amount: other },
    ];
  })();

  const [children, setChildren] = useState(initialChildren);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const sumChildren = children.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
  const parentAmount = parseFloat(txn.amount);
  const remaining = Math.round((parentAmount - sumChildren) * 100) / 100;
  const balanced = Math.abs(remaining) < 0.01;

  const updateChild = (i, patch) => {
    setChildren(prev => prev.map((c, j) => j === i ? { ...c, ...patch } : c));
  };
  const addChild = () => {
    setChildren(prev => [...prev, { description: "", category: "", amount: remaining }]);
  };
  const removeChild = (i) => {
    if (children.length <= 2) return; // need at least 2
    setChildren(prev => prev.filter((_, j) => j !== i));
  };

  const handleSave = async () => {
    setErr("");
    if (!balanced) { setErr(`Sum of splits must equal ${fmt(parentAmount)} (off by ${fmt(remaining)}).`); return; }
    if (children.some(c => !c.category)) { setErr("Every split row needs a category."); return; }
    if (children.some(c => parseFloat(c.amount) === 0 || isNaN(parseFloat(c.amount)))) { setErr("Every split row needs a non-zero amount."); return; }
    setSaving(true);
    try {
      // Always include date inherited from parent.
      const payload = children.map(c => ({
        ...c,
        date: txn.date,
        account_id: txn.account_id || null,
        account: txn.account || "Split",
        source: "split",
      }));
      await onSave(payload, existingChildren.map(c => c.id));
      onClose();
    } catch (e) {
      setErr(e.message || "Failed to save split");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Split transaction</div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
              {fmtDate(txn.date)} · {(txn.description || "").slice(0, 60)} · {fmt(parentAmount)}
            </div>
          </div>
        </div>
        <div className="modal-body">
          <div style={{ marginBottom: 14, fontSize: 12, color: "var(--text2)", lineHeight: 1.5 }}>
            Divide the bank amount into rows with different categories. The original line stays as the bank audit record;
            P&L reflects the split classification.
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: "var(--text3)", fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
                <th style={{ textAlign: "left", padding: "6px 4px" }}>Description</th>
                <th style={{ textAlign: "left", padding: "6px 4px" }}>Category</th>
                <th style={{ textAlign: "right", padding: "6px 4px", width: 110 }}>Amount</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {children.map((c, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 4px" }}>
                    <input
                      value={c.description || ""}
                      onChange={(e) => updateChild(i, { description: e.target.value })}
                      style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", padding: "5px 7px", borderRadius: 3, fontSize: 11 }}
                    />
                  </td>
                  <td style={{ padding: "6px 4px" }}>
                    <select
                      value={c.category || ""}
                      onChange={(e) => updateChild(i, { category: e.target.value })}
                      style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", padding: "5px 7px", borderRadius: 3, fontSize: 11 }}
                    >
                      <option value="">— select —</option>
                      <optgroup label="Income">
                        {categories.filter(c => c.type === "income").map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                      </optgroup>
                      <optgroup label="Expense">
                        {categories.filter(c => c.type === "expense").map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                      </optgroup>
                      <optgroup label="Transfer / Pass-through">
                        {categories.filter(c => c.type === "transfer").map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                      </optgroup>
                    </select>
                  </td>
                  <td style={{ padding: "6px 4px", textAlign: "right" }}>
                    <input
                      type="number"
                      step="0.01"
                      value={c.amount}
                      onChange={(e) => updateChild(i, { amount: parseFloat(e.target.value) || 0 })}
                      style={{ width: 100, background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", padding: "5px 7px", borderRadius: 3, fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "right" }}
                    />
                  </td>
                  <td style={{ padding: "6px 4px", textAlign: "center" }}>
                    {children.length > 2 && (
                      <button onClick={() => removeChild(i)} title="Remove this row" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text3)", padding: "2px 6px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "var(--font-mono)" }}>×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 10 }}>
            <button onClick={addChild} className="btn btn-outline btn-sm">+ Add row</button>
          </div>

          <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--surface2)", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 11 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: "var(--text3)" }}>Sum of splits</span>
              <span>{fmt(sumChildren)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: "var(--text3)" }}>Parent amount</span>
              <span>{fmt(parentAmount)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 4, borderTop: "1px solid var(--border)", color: balanced ? "var(--accent)" : "var(--red)" }}>
              <span>{balanced ? "Balanced" : "Remaining"}</span>
              <span>{balanced ? fmt(0) + " ✓" : fmt(remaining)}</span>
            </div>
          </div>

          {err && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--red)15", color: "var(--red)", borderRadius: 4, fontSize: 11, fontFamily: "var(--font-mono)" }}>
              {err}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!balanced || saving}>
            {saving ? "Saving…" : existingChildren.length > 0 ? "Update split" : "Save split"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TRANSACTIONS ─────────────────────────────────────────────────────────────
function Transactions({ transactions, allTransactions, setTransactions, saveTransactions, deleteTxn, categories, recurring, bankAccounts, bills = [], setBills, saveBill, tenantId, dateRange, setDateRange, showToast, payrollRuns = [] }) {
  // Split modal state — opens when the operator clicks ⫶ on a row.
  const [splittingTxn, setSplittingTxn] = useState(null);
  const handleOpenSplit = (id) => {
    const t = transactions.find(x => x.id === id) || (allTransactions || []).find(x => x.id === id);
    if (t) setSplittingTxn(t);
  };
  const handleSaveSplit = async (childrenPayload, oldChildIds) => {
    if (oldChildIds?.length > 0 && tenantId && tenantId !== "demo") {
      for (const cid of oldChildIds) {
        try { await deleteTransaction(cid); } catch (e) { console.error("split: delete old child", cid, e); }
      }
    }
    const res = await splitTransaction(splittingTxn.id, childrenPayload, tenantId);
    if (!res.ok) throw new Error(res.error || "Failed to save split");
    showToast?.(`Split saved · ${childrenPayload.length} rows`, "success");
    if (setTransactions) {
      setTransactions(prev => {
        const stale = new Set(oldChildIds || []);
        const filtered = prev.filter(t => !stale.has(t.id));
        const newChildren = childrenPayload.map((c, i) => ({
          id: c.id || `split_${splittingTxn.id}_${Date.now()}_${i}`,
          tenant_id: tenantId,
          date: c.date, description: c.description,
          amount: parseFloat(c.amount),
          category: c.category, category_id: c.category,
          account_id: c.account_id || null, account: c.account || "Split",
          source: "split", parent_id: splittingTxn.id,
          reconciled: false, tags: [], notes: "",
        }));
        return [...filtered, ...newChildren];
      });
    }
  };
  const [filter, setFilter] = useState("uncat");
  const [accountFilter, setAccountFilter] = useState("all");
  const [kitchenInvoices, setKitchenInvoices] = useState([]);

  // Pull Kitchen invoices in the same window so we can show "match this row to
  // invoice X" suggestions inline next to each uncategorized transaction.
  useEffect(() => {
    if (!tenantId || tenantId === "demo") return;
    let cancelled = false;
    Promise.all([
      fetchKitchenPurchases(tenantId, dateRange),
      fetchKitchenVendors(tenantId),
    ]).then(([purchases, vendors]) => {
      if (cancelled) return;
      const vendorMap = Object.fromEntries((vendors || []).map(v => [v.id, v.name]));
      setKitchenInvoices((purchases || []).map(p => ({
        id: p.id,
        vendor: String(p.supplier || vendorMap[p.vendorId] || vendorMap[p.vendor_id] || "VENDOR").toUpperCase(),
        date: p.date,
        amount: Math.abs(parseFloat(p.total) || 0),
      })));
    }).catch(err => console.error("Transactions kitchen fetch:", err));
    return () => { cancelled = true; };
  }, [tenantId, dateRange?.start, dateRange?.end]);

  // Best-fit invoice for a single bank transaction. Same heuristic as the
  // Reconciliation screen so the two views agree.
  const findInvoiceFor = (t) => {
    if (!t || t.amount >= 0 || t.source === "kitchen_purchase") return null;
    const tAmt = Math.abs(parseFloat(t.amount) || 0);
    const tTime = new Date(t.date).getTime();
    const desc = (t.description || "").toUpperCase();
    return kitchenInvoices.find(inv => {
      if (Math.abs(inv.amount - tAmt) > 1) return false;
      if (Math.abs(new Date(inv.date).getTime() - tTime) > 5 * 86400000) return false;
      const tokens = (inv.vendor || "").split(/\s+/).filter(w => w.length >= 4);
      return tokens.length === 0 || tokens.some(w => desc.includes(w));
    });
  };

  // Find a "Food & Beverage" / COGS-tagged category to drop matched rows into.
  // Falls back to the first expense category so the match button always works.
  const foodCat = categories.find(c => c.taxLine === "COGS" || c.name === "Food & Beverage")
    || categories.find(c => c.type === "expense" && c.id !== UNCATEGORIZED);
  const [search, setSearch] = useState("");
  const [drag, setDrag] = useState(false);
  const fileRef = useRef();

  const transferPairs = detectTransferPairs(allTransactions || transactions);

  const filtered = transactions.filter(t => {
    if (filter === "income" && t.amount < 0) return false;
    if (filter === "expense" && t.amount > 0) return false;
    if (filter === "uncat" && t.category !== UNCATEGORIZED) return false;
    if (filter === "cat" && (t.category === UNCATEGORIZED || !t.category)) return false;
    if (accountFilter === "unassigned") {
      if (t.account_id) return false;
    } else if (accountFilter !== "all") {
      const acc = (bankAccounts || []).find(a => a.id === accountFilter);
      if (!acc) return false;
      if (t.account_id !== acc.id && t.account !== acc.name) return false;
    }
    if (search && !t.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const [parsing, setParsing] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    const ext = file.name.toLowerCase();

    // PDF → AI extraction (server-side via /api/parse-statement, supports up to 20MB)
    if (ext.endsWith(".pdf")) {
      setParsing(true);
      showToast("Reading PDF with AI... 10-20 seconds", "info");
      try {
        const base64 = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = e => res(e.target.result.split(",")[1]);
          reader.onerror = () => rej(new Error("Read failed"));
          reader.readAsDataURL(file);
        });
        const apiRes = await fetch("/api/parse-statement", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdfBase64: base64, filename: file.name }),
        });
        if (!apiRes.ok) {
          const err = await apiRes.json().catch(() => ({ error: `Server error ${apiRes.status}` }));
          showToast(err.error || `Server error ${apiRes.status}`, "error");
          return;
        }
        const { transactions: rawImported } = await apiRes.json();
        if (!rawImported || rawImported.length === 0) {
          showToast("No transactions found in PDF.", "error");
          return;
        }
        const { fresh: freshAll, skipped } = dedupAgainstExisting(rawImported);
        const fresh = freshAll.filter(inOpenPeriod);
        const lockedOut = freshAll.length - fresh.length;
        if (fresh.length === 0) {
          showToast(lockedOut > 0
            ? `Books are closed through ${BOOKS_CLOSED_THROUGH} — these transactions are already covered by the imported P&L. Nothing imported.`
            : `All ${rawImported.length} transactions were already in the ledger (same date + amount + description). Nothing imported.`, "info");
          return;
        }
        const linked = applyAccountLink(fresh, bankAccounts);
        const matched = applyRecurringMatch(linked, recurring);
        const imported = applyAutoCategorize(matched, allTransactions || transactions);
        expandDateRangeIfNeeded(imported, dateRange, setDateRange);
        const baseTxns = allTransactions || transactions;
        const before1099 = new Set(detectMissing1099(baseTxns).map(v => v.vendor));
        setTransactions(prev => [...imported, ...prev]);
        if (saveTransactions) saveTransactions(imported);
        const after1099 = detectMissing1099([...baseTxns, ...imported]);
        const crossedVendors = after1099.filter(v => !before1099.has(v.vendor));
        const acctCount = imported.filter(t => t.account_id).length;
        const recCount = imported.filter(t => t.recurring_id).length;
        const autoCount = imported.filter(t => t.autoCategorized).length;
        const tags = [
          skipped.length && `${skipped.length} duplicate${skipped.length === 1 ? "" : "s"} skipped`,
          lockedOut && `${lockedOut} in closed period skipped`,
          acctCount && `${acctCount} linked to accounts`,
          recCount && `${recCount} matched recurring`,
          autoCount && `${autoCount} auto-categorized`,
        ].filter(Boolean).join(" · ");
        showToast(imported.length + " transactions extracted" + (tags ? ` · ${tags}` : ""), "success");
        if (crossedVendors.length > 0) {
          setTimeout(() => showToast(`⚠ ${crossedVendors.length} vendor${crossedVendors.length === 1 ? "" : "s"} crossed $600/year — open Bookkeeper to flag 1099`, "error"), 400);
        }
      } catch (err) {
        showToast("PDF import failed: " + err.message, "error");
      } finally {
        setParsing(false);
      }
      return;
    }

    // CSV / OFX → direct parse
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      let rawParsed = [];
      if (ext.endsWith(".ofx") || ext.endsWith(".qfx")) {
        rawParsed = parseOFX(text);
      } else {
        rawParsed = parseBoACSV(text);
      }
      if (rawParsed.length === 0) { showToast("No transactions found in file. Check the format.", "error"); return; }
      const { fresh: freshAll, skipped } = dedupAgainstExisting(rawParsed);
      const fresh = freshAll.filter(inOpenPeriod);
      const lockedOut = freshAll.length - fresh.length;
      if (fresh.length === 0) {
        showToast(lockedOut > 0
          ? `Books are closed through ${BOOKS_CLOSED_THROUGH} — these transactions are already covered by the imported P&L. Nothing imported.`
          : `All ${rawParsed.length} transactions were already in the ledger (same date + amount + description). Nothing imported.`, "info");
        return;
      }
      const linked = applyAccountLink(fresh, bankAccounts);
      const matched = applyRecurringMatch(linked, recurring);
      const parsed = applyAutoCategorize(matched, allTransactions || transactions);
      expandDateRangeIfNeeded(parsed, dateRange, setDateRange);
      const baseTxns = allTransactions || transactions;
      const before1099 = new Set(detectMissing1099(baseTxns).map(v => v.vendor));
      setTransactions(prev => [...parsed, ...prev]);
      if (saveTransactions) saveTransactions(parsed);
      const after1099 = detectMissing1099([...baseTxns, ...parsed]);
      const crossedVendors = after1099.filter(v => !before1099.has(v.vendor));
      const acctCount = parsed.filter(t => t.account_id).length;
      const recCount = parsed.filter(t => t.recurring_id).length;
      const autoCount = parsed.filter(t => t.autoCategorized).length;
      const tags = [
        skipped.length && `${skipped.length} duplicate${skipped.length === 1 ? "" : "s"} skipped`,
        lockedOut && `${lockedOut} in closed period skipped`,
        acctCount && `${acctCount} linked to accounts`,
        recCount && `${recCount} matched recurring`,
        autoCount && `${autoCount} auto-categorized`,
      ].filter(Boolean).join(" · ");
      showToast(parsed.length + " transactions imported" + (tags ? ` · ${tags}` : ""), "success");
      if (crossedVendors.length > 0) {
        setTimeout(() => showToast(`⚠ ${crossedVendors.length} vendor${crossedVendors.length === 1 ? "" : "s"} crossed $600/year — open Bookkeeper to flag 1099`, "error"), 400);
      }
    };
    reader.readAsText(file);
  };

  const updateCategory = (id, catId) => {
    setTransactions(prev => {
      const updated = prev.map(t => t.id === id ? { ...t, category: catId, autoCategorized: false } : t);
      if (saveTransactions) { const changed = updated.filter(t => t.id === id); saveTransactions(changed); }
      return updated;
    });
  };

  const toggleReconcile = (id) => {
    setTransactions(prev => {
      const updated = prev.map(t => t.id === id ? { ...t, reconciled: !t.reconciled } : t);
      if (saveTransactions) { const changed = updated.filter(t => t.id === id); saveTransactions(changed); }
      return updated;
    });
  };

  const updateAccountLink = (id, accountId) => {
    setTransactions(prev => {
      const updated = prev.map(t => t.id === id ? { ...t, account_id: accountId || null } : t);
      if (saveTransactions) { const changed = updated.filter(t => t.id === id); saveTransactions(changed); }
      return updated;
    });
  };

  const linkFilteredToAccount = async (accountId) => {
    if (!accountId || filtered.length === 0) return;
    const acc = (bankAccounts || []).find(a => a.id === accountId);
    if (!acc) return;
    if (!window.confirm(`Link ${filtered.length} filtered transaction${filtered.length === 1 ? "" : "s"} to "${acc.name}"?`)) return;
    const ids = new Set(filtered.map(t => t.id));
    setTransactions(prev => {
      const updated = prev.map(t => ids.has(t.id) ? { ...t, account_id: accountId } : t);
      if (saveTransactions) {
        const changed = updated.filter(t => ids.has(t.id));
        saveTransactions(changed);
      }
      return updated;
    });
    showToast(`${ids.size} transaction${ids.size === 1 ? "" : "s"} linked to ${acc.name}`, "success");
  };

  // Build a fingerprint over (date, amount-in-cents, first 40 chars of
  // description) so re-importing the same statement doesn't double-count rows.
  // Description is included to keep two legit same-day $5.50 STARBUCKS lines
  // from collapsing into one.
  const txnFingerprint = (t) => {
    const desc = (t.description || "").toUpperCase().trim().slice(0, 40);
    const cents = Math.round((parseFloat(t.amount) || 0) * 100);
    return `${t.date}__${cents}__${desc}`;
  };

  const dedupAgainstExisting = (incoming) => {
    const base = allTransactions || transactions;
    const seen = new Set(base.map(txnFingerprint));
    const fresh = [];
    const skipped = [];
    for (const t of incoming) {
      const k = txnFingerprint(t);
      if (seen.has(k)) {
        skipped.push(t);
      } else {
        seen.add(k);
        fresh.push(t);
      }
    }
    return { fresh, skipped };
  };

  const matchInvoice = (txnId, invoice) => {
    const catId = foodCat?.id || null;
    setTransactions(prev => {
      const updated = prev.map(t => t.id === txnId
        ? {
            ...t,
            category: catId || t.category,
            autoCategorized: false,
            reconciled: true,
            notes: t.notes ? `${t.notes} · matched ${invoice.vendor} ${invoice.date}` : `Matched ${invoice.vendor} invoice ${invoice.date}`,
          }
        : t);
      if (saveTransactions) {
        const changed = updated.filter(t => t.id === txnId);
        saveTransactions(changed);
      }
      return updated;
    });
    showToast(`Categorized as ${foodCat?.name || "expense"} · reconciled with ${invoice.vendor}`, "success");
  };

  // ── Manual invoice matching ────────────────────────────────────────────────
  // The Bills screen auto-reconciles a bill against a bank debit when its
  // heuristic is confident (amount + vendor token + date window). When it is
  // not — the vendor reads differently on the statement, the amount carries a
  // fee, the payment landed weeks late — there was no way to say "this debit
  // pays that invoice". This is that way: the operator picks, the score only
  // orders the list.
  const [matchingTxn, setMatchingTxn] = useState(null);
  const [invoiceSearch, setInvoiceSearch] = useState("");

  // Bank debit → the invoice it paid, so a matched row shows what it settled.
  const billByTxnId = useMemo(() => {
    const m = new Map();
    (bills || []).forEach(b => { if (b.status === "paid" && b.txnId) m.set(b.txnId, b); });
    return m;
  }, [bills]);

  const scoreBill = (txn, bill) => {
    const amt = Math.abs(parseFloat(txn.amount) || 0);
    const diff = Math.abs(amt - (Math.abs(parseFloat(bill.amount)) || 0));
    let score = 0;
    if (diff <= Math.max(1, amt * 0.01)) score += 50;
    else if (diff <= Math.max(5, amt * 0.05)) score += 25;
    const days = Math.abs(new Date(txn.date).getTime() - new Date(bill.dueDate).getTime()) / 86400000;
    if (days <= 5) score += 30;
    else if (days <= 30) score += 15;
    const desc = String(txn.description || "").toUpperCase();
    const tokens = String(bill.vendor || "").toUpperCase().split(/\s+/).filter(w => w.length >= 4);
    if (tokens.some(w => desc.includes(w))) score += 20;
    return score;
  };

  const matchCandidates = (txn) => {
    if (!txn) return [];
    const q = invoiceSearch.trim().toUpperCase();
    return (bills || [])
      .filter(b => b.status !== "paid")
      .filter(b => !q || String(b.vendor || "").toUpperCase().includes(q))
      .map(b => ({ bill: b, score: scoreBill(txn, b) }))
      .sort((a, b) => b.score - a.score
        || Math.abs(Math.abs(txn.amount) - a.bill.amount) - Math.abs(Math.abs(txn.amount) - b.bill.amount));
  };

  const payBillWithTxn = (txn, bill) => {
    const method = txn.account && txn.account !== "Plaid" ? txn.account : country().defaultPaymentMethod;
    const paid = {
      ...bill,
      status: "paid",
      paidDate: txn.date,
      paidMethod: method,
      txnId: txn.id,
      notes: (bill.notes ? bill.notes + " · " : "") + "Matched manually to bank transaction",
    };
    setBills?.(prev => prev.map(b => (b.id === bill.id ? paid : b)));
    saveBill?.(paid);

    // The Kitchen invoice shadow and the bank debit are the same expense. The
    // bank row is the system of record, so the shadow goes — the same rule the
    // Bills auto-reconcile follows, and without it the P&L counts it twice.
    const shadowId = bill.source === "kitchen" && bill.txnId && bill.txnId !== txn.id ? bill.txnId : null;
    const inheritCat = (!txn.category || txn.category === UNCATEGORIZED)
      && bill.category && bill.category !== UNCATEGORIZED;
    const updated = {
      ...txn,
      reconciled: true,
      category: inheritCat ? bill.category : txn.category,
      autoCategorized: false,
      notes: (txn.notes ? txn.notes + " · " : "") + `Pays invoice ${bill.vendor} ${bill.dueDate}`,
    };
    setTransactions(prev => prev
      .filter(t => t.id !== shadowId)
      .map(t => (t.id === txn.id ? updated : t)));
    saveTransactions?.([updated]);
    if (shadowId) deleteTxn?.(shadowId);

    showToast(`Invoice marked paid — ${bill.vendor} · ${fmt(bill.amount)}`, "success");
    setMatchingTxn(null);
    setInvoiceSearch("");
  };

  const togglePriorPeriod = (id) => {
    setTransactions(prev => {
      const updated = prev.map(t => t.id === id ? { ...t, prior_period: !t.prior_period } : t);
      if (saveTransactions) { const changed = updated.filter(t => t.id === id); saveTransactions(changed); }
      return updated;
    });
  };

  // Toggle the 'non_recurring' tag on a transaction. P&L picks up the tag
  // and surfaces an "Adjusted EBITDA" card adding back every tagged row,
  // so the operator can see the forward-looking potential without the
  // one-off expense (final loan payment, equipment one-time setup, etc).
  const toggleNonRecurring = (id) => {
    setTransactions(prev => {
      const updated = prev.map(t => {
        if (t.id !== id) return t;
        const tags = Array.isArray(t.tags) ? t.tags : [];
        const next = tags.includes("non_recurring")
          ? tags.filter(x => x !== "non_recurring")
          : [...tags, "non_recurring"];
        return { ...t, tags: next };
      });
      if (saveTransactions) { const changed = updated.filter(t => t.id === id); saveTransactions(changed); }
      return updated;
    });
  };

  const removeTransaction = async (id) => {
    if (!window.confirm("Delete this transaction? It will be removed from the ledger permanently.")) return;
    setTransactions(prev => prev.filter(t => t.id !== id));
    if (deleteTxn) await deleteTxn(id);
    showToast("Transaction deleted", "info");
  };

  const removeFiltered = async () => {
    if (filtered.length === 0) return;
    const label = filter !== "all" || accountFilter !== "all" || search
      ? `${filtered.length} filtered transaction${filtered.length === 1 ? "" : "s"}`
      : `ALL ${filtered.length} transactions`;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    const ids = new Set(filtered.map(t => t.id));
    setTransactions(prev => prev.filter(t => !ids.has(t.id)));
    if (deleteTxn) {
      for (const id of ids) await deleteTxn(id);
    }
    showToast(`${ids.size} transaction${ids.size === 1 ? "" : "s"} deleted`, "info");
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Transactions</div>
          <div className="page-subtitle">{transactions.length} transactions · {transactions.filter(t => t.category === UNCATEGORIZED).length} uncategorized</div>
        </div>
        <div className="flex gap-8">
          {bankAccounts && bankAccounts.length > 0 && (filter !== "all" || accountFilter !== "all" || search) && filtered.length > 0 && (
            <select
              className="btn btn-outline btn-sm"
              style={{ color: "var(--accent)", borderColor: "var(--accentBorder)", paddingRight: 24 }}
              value=""
              onChange={e => { if (e.target.value) linkFilteredToAccount(e.target.value); e.target.value = ""; }}
              title="Bulk-assign these filtered transactions to a bank account"
            >
              <option value="">Link filtered to… ({filtered.length})</option>
              {bankAccounts.filter(a => a.status === "active").map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
          {(filter !== "all" || accountFilter !== "all" || search) && filtered.length > 0 && (
            <button className="btn btn-outline btn-sm" style={{ color: "var(--red)", borderColor: "rgba(192,97,74,0.3)" }} onClick={removeFiltered} title="Delete every transaction currently visible in the table">
              <Icon name="trash" size={13} /> Delete filtered ({filtered.length})
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => fileRef.current.click()}>
            <Icon name="upload" size={13} /> Import Statement
          </button>
        </div>
        <input type="file" ref={fileRef} accept=".pdf,.csv,.ofx,.qfx" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
      </div>

      {/* Upload drop zone */}
      <div
        className={`upload-zone mb-16 ${drag ? "drag" : ""}`}
        style={{ padding: "20px", textAlign: "left", display: "flex", alignItems: "center", gap: 16 }}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current.click()}
      >
        <div style={{ fontSize: 24 }}><Icon name="bank" size={28} color="var(--accent)" /></div>
        <div>
          <div style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 14 }}>
            {parsing ? "🤖 AI extracting transactions from PDF..." : "Drop your Bank of America statement here"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 3 }}>
            {parsing ? "This usually takes 10–20 seconds" : "PDF · CSV · OFX/QFX · Drag & drop or click to browse"}
          </div>
        </div>
        <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", textAlign: "right" }}>
          BoA Online → Statements → Download<br /><span style={{color:"var(--accent)"}}>PDF recommended</span> · CSV or OFX also work
        </div>
      </div>

      <div className="flex items-center gap-12 mb-16">
        <div className="tabs" style={{ marginBottom: 0 }}>
          {["uncat", "cat", "income", "expense", "all"].map(f => {
            const counts = {
              uncat: transactions.filter(t => t.category === UNCATEGORIZED || !t.category).length,
              cat: transactions.filter(t => t.category && t.category !== UNCATEGORIZED).length,
              income: transactions.filter(t => t.amount > 0).length,
              expense: transactions.filter(t => t.amount < 0).length,
              all: transactions.length,
            };
            const labels = { uncat: "Uncategorized", cat: "Categorized", income: "Income", expense: "Expenses", all: "All" };
            return (
              <div key={f} className={`tab ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
                {labels[f]} <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 4 }}>({counts[f]})</span>
              </div>
            );
          })}
        </div>
        {bankAccounts && bankAccounts.length > 0 && (
          <select className="input" style={{ maxWidth: 200, fontSize: 12 }} value={accountFilter} onChange={e => setAccountFilter(e.target.value)}>
            <option value="all">All accounts</option>
            <option value="unassigned">— Unassigned —</option>
            {bankAccounts.filter(a => a.status === "active").map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
        <input className="input" style={{ maxWidth: 240 }} placeholder="Search transactions..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Description</th><th style={{ textAlign: "right" }}>Amount</th><th>Category</th><th>Account</th><th>Reconciled</th><th></th></tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7}><div className="empty"><div className="empty-icon">🔍</div><div className="empty-title">No transactions found</div></div></td></tr>
              ) : filtered.map(t => (
                <tr key={t.id}>
                  <td className="mono" style={{ color: "var(--text3)", whiteSpace: "nowrap" }}>{fmtDate(t.date)}</td>
                  <td style={{ maxWidth: 320 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</div>
                    {(() => {
                      const paidBill = billByTxnId.get(t.id);
                      if (!paidBill) return null;
                      return (
                        <div style={{ marginTop: 4, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--accent)" }}
                          title={`Marked invoice "${paidBill.vendor}" as paid · ${fmt(paidBill.amount)} due ${paidBill.dueDate}`}>
                          🧾 pays {paidBill.vendor} · {fmt(paidBill.amount)}
                        </div>
                      );
                    })()}
                    {t.category === UNCATEGORIZED && (() => {
                      const inv = findInvoiceFor(t);
                      if (!inv) return null;
                      return (
                        <button
                          onClick={() => matchInvoice(t.id, inv)}
                          title={`Apply "${foodCat?.name || "expense"}" category and reconcile with this invoice`}
                          style={{
                            marginTop: 4, padding: "2px 8px", fontSize: 10, fontFamily: "var(--font-mono)",
                            background: "var(--accentBg)", color: "var(--accent)",
                            border: "1px solid var(--accentBorder)", borderRadius: 4, cursor: "pointer",
                          }}
                        >
                          🧾 Match → {inv.vendor} · {fmt(inv.amount)}
                        </button>
                      );
                    })()}
                  </td>
                  <td className={t.amount >= 0 ? "amount-pos text-right" : "amount-neg text-right"} style={{ whiteSpace: "nowrap" }}>{fmt(t.amount)}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => togglePriorPeriod(t.id)}
                        title={t.prior_period
                          ? `P&L counts this in ${accrualDate(t).slice(0, 7)} (prior-period flag on) — click to clear`
                          : "Flag as prior-period: P&L/Tax shift this row to the last day of the previous month. Cash Flow stays on the actual date."}
                        style={{
                          fontSize: 11, fontFamily: "var(--font-mono)", padding: "2px 6px",
                          borderRadius: 4, cursor: "pointer", lineHeight: 1,
                          background: t.prior_period ? "var(--yellowBg)" : "transparent",
                          color: t.prior_period ? "var(--yellow)" : "var(--text3)",
                          border: t.prior_period ? "1px solid var(--yellow)40" : "1px solid transparent",
                          opacity: t.prior_period ? 1 : 0.45,
                        }}
                      >↩</button>
                      {(() => {
                        const isNR = Array.isArray(t.tags) && t.tags.includes("non_recurring");
                        return (
                          <button
                            type="button"
                            onClick={() => toggleNonRecurring(t.id)}
                            title={isNR
                              ? "Marked as non-recurring (one-off) — added back to Adjusted EBITDA on the P&L. Click to clear."
                              : "Flag as non-recurring (one-off, e.g. final loan payment, equipment setup). Added back to Adjusted EBITDA — doesn't change Net Income."}
                            style={{
                              fontSize: 11, fontFamily: "var(--font-mono)", padding: "2px 6px",
                              borderRadius: 4, cursor: "pointer", lineHeight: 1,
                              background: isNR ? "var(--blueBg)" : "transparent",
                              color: isNR ? "var(--blue)" : "var(--text3)",
                              border: isNR ? "1px solid var(--blue)40" : "1px solid transparent",
                              opacity: isNR ? 1 : 0.45,
                            }}
                          >🔁</button>
                        );
                      })()}
                      {transferPairs.has(t.id) && <span title="Internal transfer between your own accounts — excluded from income/expense totals" style={{ fontSize: 10, fontFamily: "var(--font-mono)", padding: "2px 6px", borderRadius: 4, background: "var(--blueBg)", color: "var(--blue)", border: "1px solid var(--blue)40" }}>↔ Internal</span>}
                      {t.autoCategorized && <span className="auto-cat-badge" title="Auto-categorized from history — change to confirm">✨</span>}
                      <select className={`cat-select${t.autoCategorized ? " auto-cat" : ""}`} value={t.category} onChange={e => updateCategory(t.id, e.target.value)}>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  </td>
                  <td>
                    {bankAccounts && bankAccounts.length > 0 ? (
                      <select
                        className="cat-select"
                        style={{ minWidth: 130, color: t.account_id ? "var(--text)" : "var(--text3)" }}
                        value={t.account_id || ""}
                        onChange={e => updateAccountLink(t.id, e.target.value)}
                        title={t.account_id ? "Linked" : (t.account ? `Unlinked — original: ${t.account}` : "Unlinked")}
                      >
                        <option value="">— {t.account || "Unassigned"} —</option>
                        {bankAccounts.filter(a => a.status === "active").map(a => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="mono" style={{ fontSize: 11, color: "var(--text3)" }}>{t.account}</span>
                    )}
                  </td>
                  <td>
                    <div
                      style={{ width: 20, height: 20, borderRadius: 4, border: `1.5px solid ${t.reconciled ? "var(--accent)" : "var(--border2)"}`, background: t.reconciled ? "var(--accentBg)" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                      onClick={() => toggleReconcile(t.id)}
                    >
                      {t.reconciled && <Icon name="check" size={12} color="var(--accent)" />}
                    </div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {t.amount < 0 && t.source !== "kitchen_purchase" && !billByTxnId.has(t.id) && (
                      <button
                        className="btn btn-ghost"
                        style={{ padding: "4px 6px", color: "var(--text3)", marginRight: 2 }}
                        title="Match this payment to an open invoice and mark the invoice paid"
                        onClick={() => { setInvoiceSearch(""); setMatchingTxn(t); }}
                      >
                        <span style={{ fontSize: 12, lineHeight: 1 }}>🧾</span>
                      </button>
                    )}
                    <button
                      className="btn btn-ghost"
                      style={{ padding: "4px 6px", color: "var(--text3)", marginRight: 2 }}
                      title="Split this transaction into multiple categories (e.g. Paychex ACH → Labor + Tip Pass-Through + Reimb)"
                      onClick={() => handleOpenSplit(t.id)}
                    >
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1 }}>⫶</span>
                    </button>
                    <button className="btn btn-ghost" style={{ padding: "4px 6px", color: "var(--red)" }} title="Delete transaction" onClick={() => removeTransaction(t.id)}>
                      <Icon name="trash" size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {splittingTxn && (
        <SplitModal
          txn={splittingTxn}
          categories={categories}
          payrollRuns={payrollRuns}
          transactions={allTransactions || transactions}
          onClose={() => setSplittingTxn(null)}
          onSave={handleSaveSplit}
        />
      )}

      {matchingTxn && (() => {
        const cands = matchCandidates(matchingTxn);
        const txnAmt = Math.abs(parseFloat(matchingTxn.amount) || 0);
        return (
          <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setMatchingTxn(null)}>
            <div className="modal" style={{ maxWidth: 620 }}>
              <div className="modal-header">
                <div>
                  <div className="modal-title">Match invoice</div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
                    {fmtDate(matchingTxn.date)} · {(matchingTxn.description || "").slice(0, 44)} · {fmt(matchingTxn.amount)}
                  </div>
                </div>
                <button className="btn btn-ghost" style={{ padding: "4px 8px" }} onClick={() => setMatchingTxn(null)}>
                  <Icon name="close" size={15} />
                </button>
              </div>
              <div className="modal-body">
                <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5, marginBottom: 14 }}>
                  The invoice is marked paid on this transaction's date and this row becomes reconciled.
                  A Kitchen invoice's synthetic expense row is removed — the bank line takes over as the
                  record, so the expense is counted once.
                </div>

                <input
                  className="input"
                  placeholder="Filter by vendor…"
                  value={invoiceSearch}
                  onChange={e => setInvoiceSearch(e.target.value)}
                  style={{ marginBottom: 12 }}
                />

                {cands.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.6, padding: "10px 0" }}>
                    {invoiceSearch
                      ? "No open invoice matches that vendor."
                      : "No open invoices. Run Sync Kitchen to pull vendor invoices, or add a bill on Bills & Payments."}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 340, overflowY: "auto" }}>
                    {cands.map(({ bill, score }) => {
                      const delta = txnAmt - Math.abs(parseFloat(bill.amount) || 0);
                      const tone = score >= 80 ? "var(--accent)" : score >= 50 ? "var(--yellow)" : "var(--text3)";
                      const label = score >= 80 ? "provável" : score >= 50 ? "possível" : "sem sinal";
                      return (
                        <div key={bill.id} className="card card-sm"
                          style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 12, borderColor: score >= 80 ? "var(--accentBorder)" : "var(--border)" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {bill.vendor}
                            </div>
                            <div style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--text3)", marginTop: 3 }}>
                              {fmt(bill.amount)} · vence {bill.dueDate}
                              {Math.abs(delta) >= 0.01 && (
                                <span style={{ color: "var(--yellow)" }}> · difere {fmt(delta)}</span>
                              )}
                            </div>
                          </div>
                          <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: tone, whiteSpace: "nowrap" }}>{label}</span>
                          <button className="btn btn-primary btn-sm" onClick={() => payBillWithTxn(matchingTxn, bill)}>
                            Marcar paga
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── CATEGORIES ───────────────────────────────────────────────────────────────
function Categories({ categories, setCategories, saveCategory, deleteCategory: deleteCategoryDB, transactions, showToast }) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: "", type: "expense", color: "#f05e5e", taxLine: "", is_eliminable: false, eliminable_note: "" });
  const [editing, setEditing] = useState(null);

  const COLORS = ["#f05e5e", "#f0c84a", "#4a9ff0", "#a47ff0", "#00d4a0", "#f0904a", "#4af0d0", "#90a0b0", "#e06090", "#60c0e0"];
  // Reporting lines come from the country pack: IRS Schedule C in the US, DRE
  // gerencial in Brazil. The strings are stable identifiers persisted in
  // r7_ledger_accounts.tax_line — changing one retroactively unmaps existing
  // categories from the reports, so add new ones instead of renaming.
  const LINES = country().reportingLines;

  const openAdd = () => { setEditing(null); setForm({ name: "", type: "expense", color: "#f05e5e", taxLine: "", is_eliminable: false, eliminable_note: "" }); setModal(true); };
  const openEdit = (c) => { setEditing(c.id); setForm({ name: c.name, type: c.type, color: c.color, taxLine: c.taxLine, is_eliminable: !!c.is_eliminable, eliminable_note: c.eliminable_note || "" }); setModal(true); };

  const save = () => {
    if (!form.name.trim()) return;
    const updated = { id: editing || Date.now().toString(), ...form };
    if (updated.type !== "expense") { updated.is_eliminable = false; updated.eliminable_note = ""; }
    if (editing) {
      setCategories(prev => prev.map(c => c.id === editing ? updated : c));
      showToast("Category updated", "success");
    } else {
      setCategories(prev => [...prev, updated]);
      showToast("Category created", "success");
    }
    if (saveCategory) saveCategory(updated);
    setModal(false);
  };

  const remove = (id) => {
    if (id === UNCATEGORIZED) { showToast("Cannot delete Uncategorized", "error"); return; }
    setCategories(prev => prev.filter(c => c.id !== id));
    if (deleteCategoryDB) deleteCategoryDB(id);
    showToast("Category deleted", "info");
  };

  const txnCount = (cid) => transactions.filter(t => t.category === cid).length;
  const isLedger = makeLedgerFilter(categories, transactions);
  const txnTotal = (cid) => transactions.filter(t => t.category === cid && isLedger(t)).reduce((s, t) => s + t.amount, 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Chart of Accounts</div>
          <div className="page-subtitle">{categories.length} categories configured</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openAdd}><Icon name="plus" size={13} /> New Category</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        {[
          { id: "income",   label: "💰 Income",                        hint: "Hits P&L as revenue" },
          { id: "expense",  label: "💸 Expenses",                      hint: "Hits P&L as cost" },
          { id: "transfer", label: "🔁 Transfer / Pass-through",        hint: "Filtered out of P&L — sales tax payable, tips payable, internal transfers, settlement clearing" },
        ].map(group => (
          <div key={group.id}>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
              {group.label}
            </div>
            <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 10, lineHeight: 1.4 }}>{group.hint}</div>
            {categories.filter(c => c.type === group.id).map(c => (
              <div key={c.id} className="card card-sm flex items-center gap-12" style={{ marginBottom: 8 }}>
                <div className="swatch" style={{ background: c.color, width: 14, height: 14, borderRadius: 4 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {c.name}
                    {c.is_eliminable && (
                      <span title={c.eliminable_note || "Flagged eliminable — feeds the CEO cockpit"} style={{ marginLeft: 8, fontSize: 9, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 0.5, color: "var(--yellow)", background: "var(--yellowBg)", border: "1px solid var(--yellow)40", borderRadius: 4, padding: "1px 6px", verticalAlign: "middle" }}>eliminable</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                    {txnCount(c.id)} txns · {c.taxLine || "no tax line"} · {fmt(Math.abs(txnTotal(c.id)))}
                  </div>
                </div>
                <button className="btn btn-ghost" style={{ padding: "4px 6px" }} onClick={() => openEdit(c)}><Icon name="edit" size={13} /></button>
                {c.id !== UNCATEGORIZED && <button className="btn btn-ghost" style={{ padding: "4px 6px", color: "var(--red)" }} onClick={() => remove(c.id)}><Icon name="trash" size={13} /></button>}
              </div>
            ))}
            {categories.filter(c => c.type === group.id).length === 0 && (
              <div style={{ fontSize: 11, color: "var(--text3)", fontStyle: "italic", padding: "12px 0" }}>
                No categories of this type yet.
              </div>
            )}
          </div>
        ))}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">{editing ? "Edit Category" : "New Category"}</div>
              <button className="btn btn-ghost" style={{ padding: 4 }} onClick={() => setModal(false)}><Icon name="close" size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="label">Category Name</label>
                <input className="input" placeholder="e.g. Food & Beverage" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="label">Type</label>
                  <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                    <option value="income">Income (hits P&L as revenue)</option>
                    <option value="expense">Expense (hits P&L as cost)</option>
                    <option value="transfer">Transfer / Pass-through (filtered from P&L)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">{country().reportingLineLabel}</label>
                  <select className="input" value={form.taxLine} onChange={e => setForm(f => ({ ...f, taxLine: e.target.value }))}>
                    <option value="">— none —</option>
                    <optgroup label={LINES.incomeLabel}>
                      {LINES.income.map(l => <option key={l} value={l}>{l}</option>)}
                    </optgroup>
                    <optgroup label={LINES.expenseLabel}>
                      {LINES.expense.map(l => <option key={l} value={l}>{l}</option>)}
                    </optgroup>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="label">Color</label>
                <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                  {COLORS.map(c => (
                    <div key={c} style={{ width: 28, height: 28, borderRadius: 6, background: c, cursor: "pointer", border: form.color === c ? "2px solid white" : "2px solid transparent", transition: "border 0.15s" }} onClick={() => setForm(f => ({ ...f, color: c }))} />
                  ))}
                </div>
              </div>
              {form.type === "expense" && (
                <div className="form-group" style={{ background: form.is_eliminable ? "var(--yellowBg)" : "transparent", border: `1px solid ${form.is_eliminable ? "var(--yellow)" : "var(--border)"}40`, borderRadius: 8, padding: 12 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
                    <input type="checkbox" checked={form.is_eliminable} onChange={e => setForm(f => ({ ...f, is_eliminable: e.target.checked }))} />
                    Eliminable cost
                  </label>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4, lineHeight: 1.4 }}>
                    Cost that could be cut or renegotiated. Feeds the "Eliminable cost" KPI in the CEO cockpit.
                  </div>
                  {form.is_eliminable && (
                    <input className="input" style={{ marginTop: 8 }} placeholder="Why / how to eliminate — e.g. renegotiate in Jan 27" maxLength={120}
                      value={form.eliminable_note} onChange={e => setForm(f => ({ ...f, eliminable_note: e.target.value }))} />
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>{editing ? "Save" : "Create"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Drill-down rendered inline beneath each P&L category row. Two-level deep:
//   L1 — vendor groups (by normalizeVendorKey of description), each with a
//        count + total. Click expands its individual transactions.
//   L2 — the raw transactions for that vendor (date, description, source,
//        account, amount).
// Vendor grouping is what makes a category readable: instead of staring at 26
// rows under "Revenue - Dining" the operator sees "SQUARE SALES (26) $103k"
// at the top and can expand only the vendor they care about. For categories
// with one vendor, the experience collapses gracefully to a single group.
function PLCategoryDetails({ txns, signNegative, onDelete, onSplit }) {
  const [expandedVendors, setExpandedVendors] = useState(() => new Set());
  if (!txns || txns.length === 0) {
    return (
      <div style={{ padding: "8px 14px 12px 42px", fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
        No transactions in this category for the current window.
      </div>
    );
  }

  // Group by normalized vendor key. Empty key (very short / numeric only
  // descriptions) gets lumped into "(other)" so it still surfaces.
  const groups = new Map();
  for (const t of txns) {
    const key = normalizeVendorKey(t.description) || "(other)";
    if (!groups.has(key)) groups.set(key, { key, total: 0, items: [], dupIds: new Set() });
    const g = groups.get(key);
    g.total += Math.abs(parseFloat(t.amount || 0));
    g.items.push(t);
  }
  // Within each vendor group, flag rows that share BOTH amount and date with
  // another row in the same group. Bank ID masking (IXXXXX vs I26050189231)
  // is the most common cause — same charge slipped past the import dedup
  // because the descriptions differ in the masked digits.
  for (const g of groups.values()) {
    const byKey = new Map();
    for (const t of g.items) {
      const k = `${t.date}|${Math.abs(parseFloat(t.amount || 0)).toFixed(2)}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(t.id);
    }
    for (const ids of byKey.values()) {
      if (ids.length > 1) ids.forEach(id => g.dupIds.add(id));
    }
  }
  const sortedGroups = [...groups.values()].sort((a, b) => b.total - a.total);

  const toggleVendor = (key) => setExpandedVendors(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div style={{ padding: "4px 14px 12px 32px", background: "var(--surface2)" }}>
      {sortedGroups.map(g => {
        const open = expandedVendors.has(g.key);
        return (
          <div key={g.key} style={{ marginBottom: 4 }}>
            <div
              onClick={() => toggleVendor(g.key)}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", cursor: "pointer", borderRadius: 3, background: open ? "var(--surface3)" : "transparent" }}
              title="Click to expand transactions"
            >
              <div className="flex items-center gap-8">
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)", width: 10 }}>{open ? "▾" : "▸"}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text2)", letterSpacing: 0.3 }}>{g.key}</span>
                <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>· {g.items.length} txn</span>
                {g.dupIds.size > 0 && (
                  <span title="Same date and amount appears more than once — likely double-import" style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--yellow)", border: "1px solid var(--yellow)40", background: "transparent", padding: "1px 5px", borderRadius: 3, letterSpacing: 0.3 }}>
                    🔁 {g.dupIds.size} dup?
                  </span>
                )}
              </div>
              <span className="mono" style={{ fontSize: 11, color: signNegative ? "var(--red)" : "var(--accent)" }}>
                {signNegative ? `(${fmt(g.total)})` : fmt(g.total)}
              </span>
            </div>
            {open && (
              <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", marginTop: 2, marginBottom: 6, marginLeft: 18 }}>
                <thead>
                  <tr style={{ color: "var(--text3)", fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    <th style={{ textAlign: "left",  padding: "4px 8px 4px 0", whiteSpace: "nowrap" }}>Date</th>
                    <th style={{ textAlign: "left",  padding: "4px 8px" }}>Description</th>
                    <th style={{ textAlign: "left",  padding: "4px 8px" }}>Source</th>
                    <th style={{ textAlign: "left",  padding: "4px 8px" }}>Account</th>
                    <th style={{ textAlign: "right", padding: "4px 0 4px 8px", whiteSpace: "nowrap" }}>Amount</th>
                    {(onDelete || onSplit) && <th style={{ width: 50 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {g.items
                    .slice()
                    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
                    .map(t => {
                    const amt = Math.abs(parseFloat(t.amount || 0));
                    const isDup = g.dupIds.has(t.id);
                    return (
                      <tr key={t.id} style={{ borderTop: "1px solid var(--border)", background: isDup ? "var(--yellow)10" : "transparent" }}>
                        <td className="mono" style={{ padding: "3px 8px 3px 0", color: "var(--text3)", whiteSpace: "nowrap" }}>
                          {isDup && <span title="Same date and amount as another row in this vendor — likely duplicate" style={{ color: "var(--yellow)", marginRight: 4 }}>🔁</span>}
                          {fmtDate(t.date)}
                        </td>
                        <td style={{ padding: "3px 8px", color: "var(--text2)" }}>{String(t.description || "").slice(0, 70)}</td>
                        <td style={{ padding: "3px 8px" }}>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)", padding: "1px 5px", border: "1px solid var(--border)", borderRadius: 3 }}>
                            {t.source || "manual"}
                          </span>
                        </td>
                        <td className="mono" style={{ padding: "3px 8px", color: "var(--text3)", fontSize: 10 }}>{t.account || "—"}</td>
                        <td className="mono" style={{ padding: "3px 0 3px 8px", textAlign: "right", color: signNegative ? "var(--red)" : "var(--accent)", whiteSpace: "nowrap" }}>
                          {signNegative ? `(${fmt(amt)})` : fmt(amt)}
                        </td>
                        {(onDelete || onSplit) && (
                          <td style={{ padding: "3px 0 3px 6px", whiteSpace: "nowrap", textAlign: "right" }}>
                            {onSplit && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onSplit(t.id); }}
                                title="Split this transaction into multiple categories"
                                style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text3)", padding: "1px 5px", borderRadius: 3, cursor: "pointer", fontSize: 10, lineHeight: 1, fontFamily: "var(--font-mono)", marginRight: 3 }}
                              >
                                ⫶
                              </button>
                            )}
                            {onDelete && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
                                title="Delete this transaction"
                                style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text3)", padding: "1px 5px", borderRadius: 3, cursor: "pointer", fontSize: 10, lineHeight: 1, fontFamily: "var(--font-mono)" }}
                              >
                                ×
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── P&L REPORT ───────────────────────────────────────────────────────────────
function PLReport({ transactions, allTransactions, categories, dateRange = {}, setTransactions, deleteTxn, payrollRuns = [], tenantId, showToast }) {
  // Split modal state — opens when a row's [⫶] split button is clicked.
  const [splittingTxn, setSplittingTxn] = useState(null);
  const handleSaveSplit = async (childrenPayload, oldChildIds) => {
    // If updating an existing split, drop the old children first so we don't
    // end up with stale rows from a previous edit (e.g. user removed a row).
    if (oldChildIds?.length > 0 && tenantId && tenantId !== "demo") {
      for (const cid of oldChildIds) {
        try { await deleteTransaction(cid); } catch (e) { console.error("split: delete old child", cid, e); }
      }
    }
    const res = await splitTransaction(splittingTxn.id, childrenPayload, tenantId);
    if (!res.ok) throw new Error(res.error || "Failed to save split");
    showToast?.(`Split saved · ${childrenPayload.length} rows`, "success");
    // Optimistic: push children into local state so the screen updates without
    // waiting for the realtime echo (which arrives in <1s but still feels laggy).
    if (setTransactions) {
      setTransactions(prev => {
        const stale = new Set(oldChildIds || []);
        const filtered = prev.filter(t => !stale.has(t.id));
        const newChildren = childrenPayload.map((c, i) => ({
          id: c.id || `split_${splittingTxn.id}_${Date.now()}_${i}`,
          tenant_id: tenantId,
          date: c.date,
          description: c.description,
          amount: parseFloat(c.amount),
          category: c.category,
          category_id: c.category,
          account_id: c.account_id || null,
          account: c.account || "Split",
          source: "split",
          parent_id: splittingTxn.id,
          reconciled: false,
          tags: [],
          notes: "",
        }));
        return [...filtered, ...newChildren];
      });
    }
  };

  const handleOpenSplit = (id) => {
    const t = transactions.find(x => x.id === id) || (allTransactions || []).find(x => x.id === id);
    if (t) setSplittingTxn(t);
  };

  // Manual adjustment modal — for closing the gap between ledger and an
  // external source (Square Sales Summary PDF, paystub web, etc) without
  // leaving the P&L. Opens with the row's category pre-selected.
  const [adjusting, setAdjusting] = useState(null); // { categoryHint, suggestedDescription, suggestedAmount }
  const handleSaveAdjustment = async (form) => {
    const cat = categories.find(c => c.id === form.category) || categories.find(c => c.name === form.category);
    const row = {
      id: form.id || `adj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      date: form.date,
      description: form.description,
      amount: parseFloat(form.amount),
      category: cat?.id || null,
      category_id: cat?.id || null,
      account: form.account || "Manual adjustment",
      reconciled: true,
      source: "manual_adjustment",
      tags: ["adjustment"],
      notes: form.notes || "",
    };
    if (setTransactions) setTransactions(prev => [row, ...prev.filter(t => t.id !== row.id)]);
    const res = await upsertTransactions([row], tenantId);
    if (!res.ok) {
      showToast?.("Save failed: " + (res.error || "unknown"), "error");
      return false;
    }
    showToast?.(`Adjustment saved · ${fmt(row.amount)} in ${cat?.name || "Uncategorized"}`, "success");
    setAdjusting(null);
    return true;
  };

  // Inline delete from the drill-down. Same pattern Transactions uses:
  // optimistically drop from local state, fire deleteTxn (no-op in demo),
  // surface success via toast. The drill-down auto-refreshes because totals
  // recompute from the new transactions array on every render.
  const handleDeleteTxn = async (id) => {
    const t = transactions.find(x => x.id === id);
    if (!t) return;
    if (typeof window !== "undefined") {
      const sure = window.confirm(`Delete this transaction?\n\n${t.date} · ${t.description}\n${fmt(parseFloat(t.amount))}`);
      if (!sure) return;
    }
    if (setTransactions) setTransactions(prev => prev.filter(x => x.id !== id));
    if (deleteTxn) {
      try {
        await deleteTxn(id);
        showToast?.("Transaction deleted", "success");
      } catch (err) {
        showToast?.("Delete failed: " + (err.message || err), "error");
      }
    }
  };

  const [period, setPeriod] = useState("monthly");
  const [expanded, setExpanded] = useState({ income: true, expense: true });
  // Per-category drill-down: clicking a row expands a small table with every
  // transaction making up that category's total. Same isRevenueRelevant filter
  // applied so settlement / transfer rows don't leak in.
  const [expandedCats, setExpandedCats] = useState(() => new Set());
  const toggleCat = (id) => setExpandedCats(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const txnsForCategory = (catId, { sign } = {}) => {
    return transactions
      .filter(t => t.category === catId && isLedger(t))
      .filter(t => {
        if (sign === "positive") return parseFloat(t.amount) > 0;
        if (sign === "negative") return parseFloat(t.amount) < 0;
        return true;
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  };

  const incomeCats = categories.filter(c => c.type === "income");
  const expenseCats = categories.filter(c => c.type === "expense" && c.id !== UNCATEGORIZED);

  // makeLedgerFilter excludes settlement/internal-transfer rows AND categories
  // of type=transfer (Tip Pass-Through, Square Holding) AND split parents
  // (their children carry the real categorization, parent is just bank audit).
  const isLedger = makeLedgerFilter(categories, transactions);
  const getAmount = (catId) => transactions.filter(t => t.category === catId && isLedger(t)).reduce((s, t) => s + t.amount, 0);

  const totalIncome = incomeCats.reduce((s, c) => s + Math.max(0, getAmount(c.id)), 0);
  const totalCOGS = expenseCats.filter(isCogs).reduce((s, c) => s + Math.abs(Math.min(0, getAmount(c.id))), 0);
  const grossProfit = totalIncome - totalCOGS;
  const totalOpex = expenseCats.filter(c => !isCogs(c)).reduce((s, c) => s + Math.abs(Math.min(0, getAmount(c.id))), 0);
  const netIncome = grossProfit - totalOpex;

  // ── Source reconciliation ──────────────────────────────────────────────
  // Three independent views of the same month, side by side:
  //   - LEDGER = what's currently in the CFO database (sum of categorized txns)
  //   - SOURCE = what the operational system says is true (Square Net Sales
  //     for revenue, Paystub for labor) — single source of truth
  //   - BANK   = what actually moved through the bank account for that line
  //     (sum of Paychex ACH-style txns for labor)
  // Drift between LEDGER and SOURCE = manual reclasses still needed.
  // Drift between SOURCE and BANK = expected (tips passthrough + tax remits).
  const sources = useMemo(() => {
    const inRange = (d) => d >= (dateRange.start || "") && d <= (dateRange.end || "9999-12-31");
    // Square revenue source: sum of source='square_net_sales' (PR5 renamed
    // from 'square_sale_gross' once the Orders-API breakdown stopped lumping
    // tax + tip into the value). Old rows that haven't been re-synced yet
    // still carry the legacy source name — accept both so the panel keeps
    // working during the migration window.
    const sqSaleSum = transactions
      .filter(t => (t.source === "square_net_sales" || t.source === "square_sale_gross") && inRange(t.date))
      .reduce((s, t) => s + parseFloat(t.amount || 0), 0);

    // Paystub labor source: every payroll run whose period overlaps the
    // window. Pro-rata by overlap days so a 2-week run that straddles
    // month-end contributes proportionally. Source of truth: paystub_meta
    // (true_labor_cost is wages + employer match, what Schedule C wants).
    const dayMs = 86400000;
    const winStart = new Date(dateRange.start || "1970-01-01").getTime();
    const winEnd   = new Date(dateRange.end   || "9999-12-31").getTime();
    let paystubLabor = 0;
    let paystubTips = 0;
    let paystubReimb = 0;
    let paystubBankDebit = 0;
    let paystubRunsUsed = 0;
    for (const r of (payrollRuns || [])) {
      const t = r.totals || {};
      if (!t.true_labor_cost && !t.wages_subtotal) continue; // not a paystub-fed run
      const ps = new Date(r.period_start).getTime();
      const pe = new Date(r.period_end).getTime();
      const overlapStart = Math.max(ps, winStart);
      const overlapEnd   = Math.min(pe, winEnd);
      if (overlapEnd < overlapStart) continue;
      const total = (pe - ps) / dayMs + 1;
      const overlap = (overlapEnd - overlapStart) / dayMs + 1;
      const ratio = total > 0 ? overlap / total : 1;
      paystubLabor      += (t.true_labor_cost      || 0) * ratio;
      paystubTips       += (t.tips_charged         || 0) * ratio;
      paystubReimb      += (t.reimb_non_tax        || 0) * ratio;
      paystubBankDebit  += (t.total_bank_debit     || 0) * ratio;
      paystubRunsUsed++;
    }

    // Labor ledger: every txn in every category on the country pack's labor
    // lines. In Brazil that is wages + statutory charges + benefits + pró-labore
    // + hiring/training, which together are more than twice the payroll alone.
    const laborIds = new Set(categories.filter(isLabor).map(c => c.id));
    const laborLedger = Math.abs(transactions
      .filter(t => laborIds.has(t.category) && isLedger(t))
      .reduce((s, t) => s + parseFloat(t.amount || 0), 0));

    // Bank-side labor: same category but only txns that look like a bank ACH
    // (source=csv or pdf, amount < 0, description matching payroll/paychex).
    const laborBank = transactions
      .filter(t => parseFloat(t.amount) < 0
        && (t.source === "csv" || t.source === "pdf" || t.source === "ofx")
        && /paychex|payroll|adp|gusto/i.test(t.description || "")
        && inRange(t.date))
      .reduce((s, t) => s + Math.abs(parseFloat(t.amount || 0)), 0);

    return {
      revenueLedger: totalIncome,
      revenueSource: Math.round(sqSaleSum * 100) / 100,
      laborLedger:   Math.round(laborLedger * 100) / 100,
      laborSource:   Math.round(paystubLabor * 100) / 100,
      laborBank:     Math.round(laborBank * 100) / 100,
      paystubTips:   Math.round(paystubTips * 100) / 100,
      paystubReimb:  Math.round(paystubReimb * 100) / 100,
      paystubBankDebit: Math.round(paystubBankDebit * 100) / 100,
      paystubRunsUsed,
    };
  }, [transactions, categories, payrollRuns, dateRange.start, dateRange.end, totalIncome, isLedger]);

  const toggle = (k) => setExpanded(e => ({ ...e, [k]: !e[k] }));

  // ── Operations Score ──────────────────────────────────────────────────
  // Composite 0-100 health index for the period. Each KPI is normalized
  // against restaurant industry benchmarks (American restaurants —
  // adjust thresholds in the future for other concept types). Weighted
  // sum gives a single "is this month good or bad" number.
  // EBIT / EBITDA — pull-back from Net Income, used both in the P&L block
  // and in the Operations Score below.
  // Detection rules (loose — any of these match a category):
  //   - Interest:     name /interest/i OR tax_line='Interest'
  //   - Income Tax:   name /income tax|federal tax|state tax/i (NOT sales tax)
  //                    OR tax_line='Income Tax'
  //   - Depreciation: name /depreciation/i OR tax_line='Depreciation'
  //   - Amortization: name /amortization/i OR tax_line='Amortization'
  // Any of these missing → contributes 0 (don't inflate EBITDA by accident).
  const profitBreakdown = useMemo(() => {
    const findAmt = (predicate) => {
      const c = categories.find(predicate);
      return c ? Math.abs(getAmount(c.id)) : 0;
    };
    const interest     = findAmt(c => /interest/i.test(c.name || "") || c.taxLine === "Interest");
    const incomeTax    = findAmt(c => (/income\s*tax|federal\s*tax|state\s*income\s*tax/i.test(c.name || "") && !/sales/i.test(c.name || "")) || c.taxLine === "Income Tax");
    const depreciation = findAmt(c => /depreciation/i.test(c.name || "") || c.taxLine === "Depreciation");
    const amortization = findAmt(c => /amortization/i.test(c.name || "") || c.taxLine === "Amortization");
    const ebit   = netIncome + interest + incomeTax;
    const ebitda = ebit + depreciation + amortization;
    return { interest, incomeTax, depreciation, amortization, ebit, ebitda };
  }, [categories, transactions, netIncome]);

  // Adjusted EBITDA — adds back every transaction tagged 'non_recurring'.
  // The operator marks one-off rows on the Transactions screen (🔁 button);
  // the P&L picks them up and surfaces the forward-looking potential here.
  const addBacks = useMemo(() => {
    const items = transactions.filter(t => Array.isArray(t.tags) && t.tags.includes("non_recurring") && isLedger(t));
    const totalAbs = items.reduce((s, t) => s + Math.abs(parseFloat(t.amount || 0)), 0);
    // Only add back EXPENSE side (negative rows). Positive non-recurring
    // (e.g. one-off catering windfall) would inflate Adjusted EBITDA in a
    // misleading direction, so subtract those instead. Standard add-back
    // convention: bring the figure back to a "normalized" run-rate.
    const totalSigned = items.reduce((s, t) => {
      const amt = parseFloat(t.amount || 0);
      return s + (amt < 0 ? Math.abs(amt) : -amt);
    }, 0);
    const adjustedEbitda = profitBreakdown.ebitda + totalSigned;
    const adjustedEbitdaMarginPct = totalIncome > 0 ? (adjustedEbitda / totalIncome) * 100 : 0;
    return { items, totalAbs, totalSigned, adjustedEbitda, adjustedEbitdaMarginPct };
  }, [transactions, isLedger, profitBreakdown.ebitda, totalIncome]);

  const opsScore = useMemo(() => {
    if (totalIncome <= 0) return null;
    const laborAmt = categories.filter(isLabor)
      .reduce((s, c) => s + Math.abs(getAmount(c.id)), 0);
    const foodCostPct = (totalCOGS / totalIncome) * 100;
    const laborPct = (laborAmt / totalIncome) * 100;
    const primePct = foodCostPct + laborPct;
    const netMarginPct = (netIncome / totalIncome) * 100;
    const grossMarginPct = (grossProfit / totalIncome) * 100;
    const ebitdaMarginPct = (profitBreakdown.ebitda / totalIncome) * 100;

    // Normalize each metric to 0-100. Linear ramp between excellent and
    // critical thresholds; clipped at the ends. "Higher is better" for
    // margins, "lower is better" for cost ratios.
    const norm = (value, excellent, critical, lowerIsBetter = false) => {
      if (lowerIsBetter) {
        if (value <= excellent) return 100;
        if (value >= critical) return 0;
        return Math.round(100 - ((value - excellent) / (critical - excellent)) * 100);
      }
      if (value >= excellent) return 100;
      if (value <= critical) return 0;
      return Math.round(((value - critical) / (excellent - critical)) * 100);
    };

    const subScores = [
      { key: "net_margin",     label: "Net Margin",     value: netMarginPct,    target: "≥15%", actual: netMarginPct.toFixed(1) + "%",    weight: 0.25, score: norm(netMarginPct, 15, 0, false) },
      { key: "ebitda_margin",  label: "EBITDA Margin",  value: ebitdaMarginPct, target: "≥20%", actual: ebitdaMarginPct.toFixed(1) + "%", weight: 0.15, score: norm(ebitdaMarginPct, 20, 5, false) },
      { key: "prime_cost",     label: "Prime Cost",     value: primePct,        target: "≤55%", actual: primePct.toFixed(1) + "%",        weight: 0.25, score: norm(primePct, 55, 70, true) },
      { key: "food_cost",      label: "Food Cost",      value: foodCostPct,     target: "≤28%", actual: foodCostPct.toFixed(1) + "%",     weight: 0.20, score: norm(foodCostPct, 28, 40, true) },
      { key: "labor_cost",     label: "Labor Cost",     value: laborPct,        target: "≤25%", actual: laborPct.toFixed(1) + "%",        weight: 0.15, score: norm(laborPct, 25, 40, true) },
    ];

    const total = Math.round(subScores.reduce((s, k) => s + k.score * k.weight, 0));
    let band, tone;
    if (total >= 80)      { band = "Excellent"; tone = "var(--accent)"; }
    else if (total >= 60) { band = "Healthy";   tone = "var(--accent)"; }
    else if (total >= 40) { band = "Watch";     tone = "var(--yellow)"; }
    else                  { band = "Critical";  tone = "var(--red)"; }

    return { total, band, tone, subScores, foodCostPct, laborPct, primePct, netMarginPct, grossMarginPct };
  }, [transactions, categories, totalIncome, totalCOGS, netIncome, grossProfit]);

  // Export the P&L to CSV. Mirrors the on-screen structure: a Period header,
  // then Income / COGS / OpEx blocks with one row per category, then totals,
  // then the Source reconciliation block. Importable directly into Sheets or
  // pasted into a TaxAct/QuickBooks worksheet for accountant review.
  const exportPL = () => {
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [];
    lines.push(`Profit & Loss — TorresBee`);
    lines.push(`Period,${dateRange.start || ""} to ${dateRange.end || ""}`);
    lines.push(`View,${period}`);
    lines.push(`Generated,${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
    lines.push("");
    lines.push("Section,Category,Tax Line,Amount");

    incomeCats.forEach(c => {
      const amt = Math.max(0, getAmount(c.id));
      if (amt > 0) lines.push(["Income", c.name, c.taxLine || "", amt.toFixed(2)].map(esc).join(","));
    });
    lines.push(["Income", "TOTAL", "", totalIncome.toFixed(2)].map(esc).join(","));
    lines.push("");

    expenseCats.filter(isCogs).forEach(c => {
      const amt = Math.abs(Math.min(0, getAmount(c.id)));
      if (amt > 0) lines.push([cogsLine(), c.name, c.taxLine || "", `-${amt.toFixed(2)}`].map(esc).join(","));
    });
    lines.push([cogsLine(), "TOTAL", "", `-${totalCOGS.toFixed(2)}`].map(esc).join(","));
    lines.push(["Subtotal", "Gross Profit", "", grossProfit.toFixed(2)].map(esc).join(","));
    lines.push("");

    expenseCats.filter(c => !isCogs(c)).forEach(c => {
      const amt = Math.abs(Math.min(0, getAmount(c.id)));
      if (amt > 0) lines.push(["OpEx", c.name, c.taxLine || "", `-${amt.toFixed(2)}`].map(esc).join(","));
    });
    lines.push(["OpEx", "TOTAL", "", `-${totalOpex.toFixed(2)}`].map(esc).join(","));
    lines.push("");
    lines.push(["Net", "Net Income", "", netIncome.toFixed(2)].map(esc).join(","));
    lines.push(["Net", "Net Margin", "", (totalIncome > 0 ? ((netIncome / totalIncome) * 100).toFixed(2) : "0") + "%"].map(esc).join(","));

    if (sources?.paystubRunsUsed > 0 || sources?.revenueSource > 0) {
      lines.push("");
      lines.push("Source Reconciliation");
      lines.push("Line,Ledger,Source of truth,Source tag,Bank,Drift (ledger - source)");
      lines.push(["Revenue", sources.revenueLedger.toFixed(2), sources.revenueSource.toFixed(2), "Square", "", (sources.revenueLedger - sources.revenueSource).toFixed(2)].map(esc).join(","));
      lines.push([
        "Labor",
        sources.laborLedger.toFixed(2),
        sources.laborSource.toFixed(2),
        "Paystub",
        sources.laborBank.toFixed(2),
        (sources.laborLedger - sources.laborSource).toFixed(2),
      ].map(esc).join(","));
    }

    const csv = "﻿" + lines.join("\r\n"); // BOM so Excel detects UTF-8
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pl_${dateRange.start || "start"}_to_${dateRange.end || "end"}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    showToast?.("P&L exported", "success");
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Profit & Loss</div>
          <div className="page-subtitle">{dateRange.start} → {dateRange.end} · TorresBee</div>
        </div>
        <div className="flex gap-8">
          <div className="tabs" style={{ marginBottom: 0 }}>
            {["monthly", "quarterly", "annual"].map(p => (
              <div key={p} className={`tab ${period === p ? "active" : ""}`} onClick={() => setPeriod(p)} style={{ fontSize: 12 }}>{p.charAt(0).toUpperCase() + p.slice(1)}</div>
            ))}
          </div>
          <button className="btn btn-outline btn-sm" onClick={exportPL}><Icon name="download" size={13} /> Export CSV</button>
        </div>
      </div>

      {opsScore && (
        <div className="card" style={{ padding: 0, marginBottom: 20, border: `1px solid ${opsScore.tone}40` }}>
          <div style={{ display: "flex", padding: "16px 20px", gap: 24, alignItems: "center" }}>
            <div style={{ minWidth: 140, textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Operations Score</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 48, fontWeight: 500, color: opsScore.tone, lineHeight: 1 }}>{opsScore.total}</div>
              <div style={{ fontSize: 11, color: opsScore.tone, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 1, marginTop: 4 }}>{opsScore.band}</div>
            </div>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
              {opsScore.subScores.map(k => {
                const color = k.score >= 80 ? "var(--accent)" : k.score >= 40 ? "var(--yellow)" : "var(--red)";
                return (
                  <div key={k.key} style={{ background: "var(--surface2)", padding: "10px 12px", borderRadius: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontFamily: "var(--font-sans)", fontWeight: 600, color: "var(--text2)" }}>{k.label}</span>
                      <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: color }}>{k.score}/100</span>
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: color }}>{k.actual}</div>
                    <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>target {k.target} · weight {(k.weight * 100).toFixed(0)}%</div>
                    <div style={{ marginTop: 6, height: 3, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: k.score + "%", height: "100%", background: color, transition: "width 0.3s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ padding: "8px 20px", borderTop: "1px solid var(--border)", background: "var(--surface2)", fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", lineHeight: 1.6 }}>
            Restaurant industry benchmarks (US). Score band: <span style={{ color: "var(--accent)" }}>80-100 Excellent</span> · <span style={{ color: "var(--accent)" }}>60-79 Healthy</span> · <span style={{ color: "var(--yellow)" }}>40-59 Watch</span> · <span style={{ color: "var(--red)" }}>0-39 Critical</span>
          </div>
        </div>
      )}

      <div className="grid-2">
        <div>
          {/* Income */}
          <div className="pl-section">
            <div className="pl-header" onClick={() => toggle("income")}>
              <span>Income</span>
              <span className="mono" style={{ color: "var(--accent)" }}>{fmt(totalIncome)}</span>
            </div>
            {expanded.income && incomeCats.map(c => {
              const amt = Math.max(0, getAmount(c.id));
              const open = expandedCats.has(c.id);
              const txns = open ? txnsForCategory(c.id, { sign: "positive" }) : [];
              return (
                <Fragment key={c.id}>
                  <div className="pl-row" onClick={() => toggleCat(c.id)} style={{ cursor: "pointer" }} title="Click to expand transactions">
                    <div className="flex items-center gap-8">
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)", width: 10 }}>{open ? "▾" : "▸"}</span>
                      <div className="swatch" style={{ background: c.color }} />
                      <span className="pl-row-name">{c.name}</span>
                      <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>· {txnsForCategory(c.id, { sign: "positive" }).length} txn</span>
                    </div>
                    <span className="mono" style={{ color: "var(--accent)" }}>{fmt(amt)}</span>
                  </div>
                  {open && <PLCategoryDetails txns={txns} signNegative={false} onDelete={handleDeleteTxn} onSplit={handleOpenSplit} />}
                </Fragment>
              );
            })}
          </div>

          <div className="pl-total">
            <span className="pl-total-label">Total Revenue</span>
            <span className="mono" style={{ color: "var(--accent)" }}>{fmt(totalIncome)}</span>
          </div>

          {/* COGS */}
          <div className="pl-section mt-12">
            <div className="pl-header" style={{ background: "var(--redBg)" }} onClick={() => toggle("cogs")}>
              <span>Cost of Goods Sold</span>
              <span className="mono" style={{ color: "var(--red)" }}>({fmt(totalCOGS)})</span>
            </div>
            {expanded.cogs && expenseCats.filter(isCogs).map(c => {
              const amt = Math.abs(Math.min(0, getAmount(c.id)));
              const open = expandedCats.has(c.id);
              const txns = open ? txnsForCategory(c.id, { sign: "negative" }) : [];
              return (
                <Fragment key={c.id}>
                  <div className="pl-row" onClick={() => toggleCat(c.id)} style={{ cursor: "pointer" }} title="Click to expand transactions">
                    <div className="flex items-center gap-8">
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)", width: 10 }}>{open ? "▾" : "▸"}</span>
                      <div className="swatch" style={{ background: c.color }} />
                      <span className="pl-row-name">{c.name}</span>
                      <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>· {txnsForCategory(c.id, { sign: "negative" }).length} txn</span>
                    </div>
                    <span className="mono" style={{ color: "var(--red)" }}>({fmt(amt)})</span>
                  </div>
                  {open && <PLCategoryDetails txns={txns} signNegative={true} onDelete={handleDeleteTxn} onSplit={handleOpenSplit} />}
                </Fragment>
              );
            })}
          </div>

          <div className="pl-total" style={{ background: "var(--surface3)" }}>
            <span className="pl-total-label">Gross Profit</span>
            <span className="mono" style={{ color: grossProfit >= 0 ? "var(--accent)" : "var(--red)" }}>{fmt(grossProfit)}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", textAlign: "right", marginTop: 4 }}>
            Gross Margin: {totalIncome > 0 ? ((grossProfit / totalIncome) * 100).toFixed(1) : 0}%
          </div>
        </div>

        <div>
          {/* Operating Expenses */}
          <div className="pl-section">
            <div className="pl-header" style={{ background: "var(--surface2)" }} onClick={() => toggle("opex")}>
              <span>Operating Expenses</span>
              <span className="mono" style={{ color: "var(--red)" }}>({fmt(totalOpex)})</span>
            </div>
            {expanded.opex && expenseCats.filter(c => !isCogs(c)).map(c => {
              const amt = Math.abs(Math.min(0, getAmount(c.id)));
              if (amt === 0) return null;
              const open = expandedCats.has(c.id);
              const txns = open ? txnsForCategory(c.id, { sign: "negative" }) : [];
              return (
                <Fragment key={c.id}>
                  <div className="pl-row" onClick={() => toggleCat(c.id)} style={{ cursor: "pointer" }} title="Click to expand transactions">
                    <div className="flex items-center gap-8">
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)", width: 10 }}>{open ? "▾" : "▸"}</span>
                      <div className="swatch" style={{ background: c.color }} />
                      <span className="pl-row-name">{c.name}</span>
                      <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>· {txnsForCategory(c.id, { sign: "negative" }).length} txn</span>
                    </div>
                    <span className="mono" style={{ color: "var(--red)" }}>({fmt(amt)})</span>
                  </div>
                  {open && <PLCategoryDetails txns={txns} signNegative={true} onDelete={handleDeleteTxn} onSplit={handleOpenSplit} />}
                </Fragment>
              );
            })}
          </div>

          <div className="pl-total">
            <span className="pl-total-label">Total OpEx</span>
            <span className="mono" style={{ color: "var(--red)" }}>({fmt(totalOpex)})</span>
          </div>

          {/* Net */}
          <div className="pl-net mt-16">
            <div>
              <div className="pl-net-label">Net Income</div>
              <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                Net Margin: {totalIncome > 0 ? ((netIncome / totalIncome) * 100).toFixed(1) : 0}%
              </div>
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 28, fontWeight: 500, color: netIncome >= 0 ? "var(--accent)" : "var(--red)" }}>{fmt(netIncome)}</div>
          </div>

          {/* EBIT + EBITDA — operational profitability before financing /
              non-cash items. Helps owners compare apples-to-apples vs
              other restaurants and value the business if they sell. */}
          {(profitBreakdown.interest > 0 || profitBreakdown.depreciation > 0 || profitBreakdown.amortization > 0 || profitBreakdown.incomeTax > 0) && (
            <div className="mt-12" style={{ background: "var(--surface2)", borderRadius: 6, padding: "12px 16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 0.5 }}>EBIT</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, color: profitBreakdown.ebit >= 0 ? "var(--accent)" : "var(--red)" }}>{fmt(profitBreakdown.ebit)}</div>
                  <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                    Margin: {totalIncome > 0 ? ((profitBreakdown.ebit / totalIncome) * 100).toFixed(1) : 0}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 0.5 }}>EBITDA</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, color: profitBreakdown.ebitda >= 0 ? "var(--accent)" : "var(--red)" }}>{fmt(profitBreakdown.ebitda)}</div>
                  <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                    Margin: {totalIncome > 0 ? ((profitBreakdown.ebitda / totalIncome) * 100).toFixed(1) : 0}%
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", lineHeight: 1.6 }}>
                Net Income {fmt(netIncome)}
                {profitBreakdown.interest > 0    && <> · + Interest {fmt(profitBreakdown.interest)}</>}
                {profitBreakdown.incomeTax > 0   && <> · + Income Tax {fmt(profitBreakdown.incomeTax)}</>}
                {" "}= EBIT
                {profitBreakdown.depreciation > 0 && <> · + Depreciation {fmt(profitBreakdown.depreciation)}</>}
                {profitBreakdown.amortization > 0 && <> · + Amortization {fmt(profitBreakdown.amortization)}</>}
                {" "}= EBITDA
              </div>
            </div>
          )}
          {!(profitBreakdown.interest > 0 || profitBreakdown.depreciation > 0 || profitBreakdown.amortization > 0 || profitBreakdown.incomeTax > 0) && netIncome !== 0 && (
            <div className="mt-12" style={{ background: "var(--surface2)", borderRadius: 6, padding: "10px 14px", fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>
              💡 To show <strong>EBIT</strong> and <strong>EBITDA</strong>, tag categories with one of the names <em>Interest</em>, <em>Income Tax</em>, <em>Depreciation</em>, or <em>Amortization</em> (or set their tax_line equivalent). EBIT = Net Income + Interest + Income Tax. EBITDA = EBIT + Depreciation + Amortization.
            </div>
          )}

          {/* ── Adjusted EBITDA — forward-looking, with one-off add-backs ── */}
          {addBacks.items.length > 0 && (
            <div className="mt-12" style={{ background: "var(--accentBg)", borderRadius: 6, border: "1px solid var(--accentBorder)", padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 0.5 }}>Adjusted EBITDA</div>
                  <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>forward-looking run-rate</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, color: "var(--accent)" }}>{fmt(addBacks.adjustedEbitda)}</div>
                  <div style={{ fontSize: 11, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>Margin: {addBacks.adjustedEbitdaMarginPct.toFixed(1)}%</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", marginBottom: 6 }}>
                EBITDA {fmt(profitBreakdown.ebitda)} + {addBacks.items.length} non-recurring add-back{addBacks.items.length === 1 ? "" : "s"} ({fmt(addBacks.totalSigned)})
              </div>
              <div style={{ display: "grid", gap: 4, paddingTop: 8, borderTop: "1px solid var(--accentBorder)" }}>
                {addBacks.items.slice(0, 8).map(t => (
                  <div key={t.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: "var(--text2)" }}>
                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text3)", marginRight: 8 }}>{fmtDate(t.date)}</span>
                      {(t.description || "").slice(0, 60)}
                    </span>
                    <span className="mono" style={{ color: parseFloat(t.amount) < 0 ? "var(--accent)" : "var(--red)" }}>
                      {parseFloat(t.amount) < 0 ? "+" : "−"}{fmt(Math.abs(parseFloat(t.amount)))}
                    </span>
                  </div>
                ))}
                {addBacks.items.length > 8 && (
                  <div style={{ fontSize: 11, color: "var(--text3)", textAlign: "center", marginTop: 4 }}>
                    + {addBacks.items.length - 8} more — see Transactions
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quick stats — resolve category IDs by name instead of the old
              hardcoded "2"/"3" (those were numeric ids back when the chart
              of accounts was seeded with integer keys; the migration to
              UUIDs broke the lookup and Labor%/Rent% silently rendered 0). */}
          {(() => {
            const laborAmt = categories.filter(isLabor).reduce((s, c) => s + Math.abs(getAmount(c.id)), 0);
            const rentAmt  = categories.filter(isRent).reduce((s, c) => s + Math.abs(getAmount(c.id)), 0);
            return (
          <div className="mt-16" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { label: "Food Cost %", value: totalIncome > 0 ? ((totalCOGS / totalIncome) * 100).toFixed(1) + "%" : "—", ok: totalIncome > 0 && (totalCOGS / totalIncome) < 0.35 },
              { label: "Labor %",     value: totalIncome > 0 ? ((laborAmt / totalIncome) * 100).toFixed(1) + "%" : "—", ok: totalIncome > 0 && (laborAmt / totalIncome) < 0.30 },
              { label: "Rent %",      value: totalIncome > 0 ? ((rentAmt / totalIncome) * 100).toFixed(1) + "%"  : "—", ok: true },
              { label: "Prime Cost %",value: totalIncome > 0 ? (((totalCOGS + laborAmt) / totalIncome) * 100).toFixed(1) + "%" : "—", ok: totalIncome > 0 && ((totalCOGS + laborAmt) / totalIncome) < 0.60 },
            ].map(s => (
              <div key={s.label} className="card card-sm" style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 500, color: s.ok ? "var(--accent)" : "var(--yellow)" }}>{s.value}</div>
              </div>
            ))}
          </div>
            );
          })()}
        </div>
      </div>

      {/* ── Source reconciliation — paystub + Square vs ledger + bank ── */}
      {(sources.paystubRunsUsed > 0 || sources.revenueSource > 0) && (
        <div className="card mt-16" style={{ padding: 0, border: "1px solid var(--accentBorder)" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 14 }}>📋 Source Truth Reconciliation</div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4, lineHeight: 1.5 }}>
                Cross-check the ledger against the operational source of truth: Square for revenue, paystub for labor.
                Drift &gt; small dollars usually means a manual reclass (Split) is still pending.
              </div>
            </div>
            <span className="tag" style={{ fontSize: 10, color: "var(--accent)", border: "1px solid var(--accentBorder)", background: "var(--accentBg)" }}>
              {sources.paystubRunsUsed} paystub{sources.paystubRunsUsed === 1 ? "" : "s"} in window
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Line</th>
                  <th style={{ textAlign: "right" }}>Ledger (current)</th>
                  <th style={{ textAlign: "right" }}>Source of truth</th>
                  <th style={{ textAlign: "right" }}>Bank-side</th>
                  <th style={{ textAlign: "right" }}>Δ ledger vs source</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <SourceRow
                  label="Revenue"
                  ledger={sources.revenueLedger}
                  source={sources.revenueSource}
                  sourceTag="Square"
                  bank={null}
                  note="Source = sum of square_net_sales (items + non-tip service charges − discounts − returns), all channels — POS, online and aggregator gross. Drift typically = aggregator deposits still categorized as revenue (re-run Plaid sync / Sync Sales) or legacy rows still tagged square_sale_gross."
                  onAdjust={() => setAdjusting({
                    categoryHint: "Revenue - Dining",
                    suggestedDescription: `Revenue adjustment to match Square Sales Summary`,
                    suggestedAmount: 0,
                  })}
                />
                <SourceRow
                  label="Labor (wages + employer match)"
                  ledger={sources.laborLedger}
                  source={sources.laborSource}
                  sourceTag="Paystub"
                  bank={sources.laborBank}
                  note={sources.paystubRunsUsed > 0
                    ? `Source = sum of paystub true_labor_cost. Bank = Paychex ACH (~$${(sources.paystubBankDebit).toFixed(0)} expected, includes tips $${sources.paystubTips.toFixed(0)} + reimb $${sources.paystubReimb.toFixed(0)} that should be split out).`
                    : "No paystub data in window — import a paystub PDF in Payroll screen to populate."}
                  onAdjust={() => setAdjusting({
                    categoryHint: "Payroll",
                    suggestedDescription: `Labor adjustment to match paystub source`,
                    suggestedAmount: sources.laborSource - sources.laborLedger,
                  })}
                />
              </tbody>
            </table>
          </div>
          {sources.paystubRunsUsed > 0 && Math.abs(sources.laborLedger - sources.laborSource) > 100 && (
            <div style={{ padding: "10px 18px", background: "var(--yellowBg)", borderTop: "1px solid var(--yellow)40", fontSize: 11, color: "var(--text2)" }}>
              💡 Labor drift {fmt(sources.laborLedger - sources.laborSource)}. The Paychex ACH (~{fmt(sources.paystubBankDebit)}) is still booked entirely as Labor.
              Open <strong>Transactions</strong>, find the Paychex row, click <strong>Split (⫶)</strong> — the modal will pre-fill from this paystub:
              <span style={{ marginLeft: 6, fontFamily: "var(--font-mono)" }}>
                Labor {fmt(sources.laborSource)} · Tip Pass-Through {fmt(sources.paystubTips)} · Reimb {fmt(sources.paystubReimb)}
              </span>
            </div>
          )}
        </div>
      )}

      {splittingTxn && (
        <SplitModal
          txn={splittingTxn}
          categories={categories}
          payrollRuns={payrollRuns}
          transactions={allTransactions || transactions}
          onClose={() => setSplittingTxn(null)}
          onSave={handleSaveSplit}
        />
      )}

      {adjusting && (
        <AdjustmentModal
          categories={categories}
          dateRange={dateRange}
          hint={adjusting}
          onClose={() => setAdjusting(null)}
          onSave={handleSaveAdjustment}
        />
      )}
    </div>
  );
}

// Manual Adjustment modal — minimal form to insert a single
// source='manual_adjustment' row. Used from the Source Reconciliation
// panel when the ledger needs nudged to match an external authoritative
// number (Square Sales Summary, paystub web, etc).
function AdjustmentModal({ categories, dateRange = {}, hint = {}, onClose, onSave }) {
  const lastDay = dateRange.end || new Date().toISOString().slice(0, 10);
  const initialCat = categories.find(c => c.name === hint.categoryHint);
  const [form, setForm] = useState({
    category: initialCat?.id || "",
    date: lastDay,
    amount: hint.suggestedAmount ? String(Number(hint.suggestedAmount).toFixed(2)) : "",
    description: hint.suggestedDescription || "Manual adjustment",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const incomeCats = categories.filter(c => c.type === "income");
  const expenseCats = categories.filter(c => c.type === "expense");
  const transferCats = categories.filter(c => c.type === "transfer");

  const handleSave = async () => {
    if (!form.category) return;
    if (!form.amount || isNaN(parseFloat(form.amount))) return;
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Add adjustment</div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
              Inserts a manual_adjustment row in the ledger. Use negative amount to reduce a category total.
            </div>
          </div>
        </div>
        <div className="modal-body" style={{ display: "grid", gap: 14 }}>
          <label style={{ display: "block" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Category</div>
            <select
              value={form.category}
              onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
              style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", padding: "8px 10px", borderRadius: 4, fontSize: 12 }}
            >
              <option value="">— select —</option>
              <optgroup label="Income">
                {incomeCats.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </optgroup>
              <optgroup label="Expense">
                {expenseCats.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </optgroup>
              {transferCats.length > 0 && (
                <optgroup label="Transfer / Pass-through">
                  {transferCats.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </optgroup>
              )}
            </select>
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <label style={{ display: "block" }}>
              <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Date</div>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))}
                style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", padding: "8px 10px", borderRadius: 4, fontSize: 12 }}
              />
            </label>
            <label style={{ display: "block" }}>
              <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Amount</div>
              <input
                type="number"
                step="0.01"
                placeholder="-1234.56"
                value={form.amount}
                onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))}
                style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", padding: "8px 10px", borderRadius: 4, fontSize: 12, fontFamily: "var(--font-mono)", textAlign: "right" }}
              />
            </label>
          </div>

          <label style={{ display: "block" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Description</div>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", padding: "8px 10px", borderRadius: 4, fontSize: 12 }}
            />
          </label>

          <label style={{ display: "block" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Notes (optional)</div>
            <textarea
              value={form.notes}
              onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder="e.g. matches Square Sales Summary May 2026"
              style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", padding: "8px 10px", borderRadius: 4, fontSize: 12, resize: "vertical" }}
            />
          </label>

          {form.amount && !isNaN(parseFloat(form.amount)) && (
            <div style={{ padding: "8px 12px", background: "var(--surface2)", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 12 }}>
              Effect: {parseFloat(form.amount) < 0 ? "reduces" : "increases"} category total by{" "}
              <strong style={{ color: parseFloat(form.amount) < 0 ? "var(--red)" : "var(--accent)" }}>
                {fmt(Math.abs(parseFloat(form.amount)))}
              </strong>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.category || !form.amount}>
            {saving ? "Saving…" : "Save adjustment"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Render a single line of the Source reconciliation table. Drift is colored
// by magnitude — under $50 = green (matches), $50-500 = neutral, >$500 = red.
function SourceRow({ label, ledger, source, sourceTag, bank, note, onAdjust }) {
  const drift = source != null ? (ledger - source) : null;
  const driftColor = drift == null
    ? "var(--text3)"
    : Math.abs(drift) < 50
      ? "var(--accent)"
      : Math.abs(drift) < 500
        ? "var(--yellow)"
        : "var(--red)";
  return (
    <tr>
      <td style={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}>{label}</td>
      <td className="mono text-right" style={{ color: "var(--text2)" }}>{fmt(ledger)}</td>
      <td className="mono text-right">
        {source != null ? (
          <>
            <span>{fmt(source)}</span>
            <span style={{ fontSize: 9, color: "var(--text3)", fontFamily: "var(--font-mono)", marginLeft: 6, padding: "1px 4px", border: "1px solid var(--border)", borderRadius: 3 }}>{sourceTag}</span>
          </>
        ) : <span style={{ color: "var(--text3)" }}>—</span>}
      </td>
      <td className="mono text-right" style={{ color: "var(--text2)" }}>
        {bank != null ? fmt(bank) : <span style={{ color: "var(--text3)" }}>—</span>}
      </td>
      <td className="mono text-right" style={{ color: driftColor, fontWeight: 600 }}>
        {drift != null ? (drift >= 0 ? "+" : "") + fmt(drift) : "—"}
      </td>
      <td style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>{note}</td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        {onAdjust && (
          <button
            onClick={onAdjust}
            title="Add a manual adjustment to this category (e.g. force ledger to match the source)"
            style={{
              background: "transparent", border: "1px solid var(--border)",
              color: "var(--text3)", padding: "4px 10px", borderRadius: 4,
              cursor: "pointer", fontSize: 11, fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
            }}
          >
            + Adjust
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── CASH FLOW ────────────────────────────────────────────────────────────────
function CashFlow({ transactions, categories, recurring = [], dateRange = {} }) {
  const isLedger = makeLedgerFilter(categories, transactions);
  const operating = transactions.filter(t => ["1","2","3","4","6","7","8","9"].includes(t.category) && isLedger(t));
  const opInflow = operating.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const opOutflow = Math.abs(operating.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0));
  const netOperating = opInflow - opOutflow;
  const netInvesting = -234.80; // equipment sample
  const netFinancing = 0;
  const netChange = netOperating + netInvesting + netFinancing;
  const beginBalance = 12400.00;
  const endBalance = beginBalance + netChange;

  const sections = [
    { label: "Operating Activities", items: [
      { name: "Cash from customers", value: opInflow },
      { name: "Payments to suppliers", value: -transactions.filter(t=>t.category==="1").reduce((s,t)=>s+t.amount,0) },
      { name: "Payroll & wages", value: -Math.abs(transactions.filter(t=>t.category==="2").reduce((s,t)=>s+t.amount,0)) },
      { name: "Rent & utilities", value: -Math.abs(transactions.filter(t=>t.category==="3").reduce((s,t)=>s+t.amount,0)) },
      { name: "Other operating", value: -Math.abs(transactions.filter(t=>["4","6","7"].includes(t.category)).reduce((s,t)=>s+t.amount,0)) },
    ], net: netOperating, color: "var(--accent)" },
    { label: "Investing Activities", items: [
      { name: "Equipment purchases", value: netInvesting },
    ], net: netInvesting, color: "var(--blue)" },
    { label: "Financing Activities", items: [
      { name: "No financing activity", value: 0 },
    ], net: netFinancing, color: "var(--purple)" },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Cash Flow Statement</div>
          <div className="page-subtitle">{dateRange.start} → {dateRange.end} · Direct Method</div>
        </div>
        <button className="btn btn-outline btn-sm"><Icon name="download" size={13} /> Export</button>
      </div>

      <div className="grid-2">
        <div>
          {sections.map(s => (
            <div key={s.label} className="card" style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13, marginBottom: 14, color: s.color }}>{s.label}</div>
              {s.items.map(item => (
                <div key={item.name} className="flex items-center justify-between" style={{ padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13, color: "var(--text2)" }}>{item.name}</span>
                  <span className="mono" style={{ color: item.value >= 0 ? "var(--accent)" : "var(--red)", fontSize: 13 }}>{fmt(item.value)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between" style={{ marginTop: 10, paddingTop: 10 }}>
                <span style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13 }}>Net {s.label.split(" ")[0]}</span>
                <span className="mono" style={{ color: s.net >= 0 ? "var(--accent)" : "var(--red)", fontWeight: 600, fontSize: 14 }}>{fmt(s.net)}</span>
              </div>
            </div>
          ))}
        </div>

        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13, marginBottom: 16 }}>Cash Summary</div>
            {[
              { label: "Beginning Cash Balance", value: beginBalance, color: "var(--text)" },
              { label: "Net Operating Cash", value: netOperating, color: netOperating >= 0 ? "var(--accent)" : "var(--red)" },
              { label: "Net Investing Cash", value: netInvesting, color: netInvesting >= 0 ? "var(--accent)" : "var(--red)" },
              { label: "Net Financing Cash", value: netFinancing, color: "var(--text2)" },
              { label: "Net Change in Cash", value: netChange, color: netChange >= 0 ? "var(--accent)" : "var(--red)" },
            ].map(r => (
              <div key={r.label} className="flex items-center justify-between" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 13, color: "var(--text2)" }}>{r.label}</span>
                <span className="mono" style={{ color: r.color }}>{fmt(r.value)}</span>
              </div>
            ))}
            <div className="pl-net" style={{ marginTop: 12 }}>
              <span style={{ fontFamily: "var(--font-sans)", fontWeight: 800, fontSize: 14 }}>Ending Cash Balance</span>
              <span className="mono" style={{ fontSize: 22, color: "var(--accent)" }}>{fmt(endBalance)}</span>
            </div>
          </div>

          <div className="card">
            <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Cash Flow Health</div>
            {[
              { label: "Operating Cash Ratio", value: netOperating >= 0 ? "Positive ✓" : "Negative ⚠", ok: netOperating >= 0 },
              { label: "Cash Burn Rate", value: fmt(opOutflow / 30) + "/day", ok: true },
              { label: "Runway (at current burn)", value: Math.round(endBalance / (opOutflow / 30)) + " days", ok: true },
              { label: "Collections Efficiency", value: ((opInflow / (opInflow + Math.abs(netInvesting))) * 100).toFixed(0) + "%", ok: true },
            ].map(r => (
              <div key={r.label} className="flex items-center justify-between" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 12, color: "var(--text2)" }}>{r.label}</span>
                <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: r.ok ? "var(--accent)" : "var(--yellow)" }}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recurring forecast */}
      {recurring.filter(r => r.status === "active").length > 0 && (() => {
        const forecast = projectRecurring(recurring, 3);
        const forecastNet = forecast.reduce((s, m) => s + m.net, 0);
        let cumulative = endBalance;
        return (
          <div className="card" style={{ marginTop: 18 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
              <div>
                <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13 }}>Recurring Forecast — Next 3 Months</div>
                <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                  Projected from {recurring.filter(r => r.status === "active").length} active rules · normalized to monthly
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em" }}>3-Month Net</div>
                <div className="mono" style={{ fontSize: 18, color: forecastNet >= 0 ? "var(--accent)" : "var(--red)" }}>{fmt(forecastNet)}</div>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th style={{ textAlign: "right" }}>Inflow</th>
                    <th style={{ textAlign: "right" }}>Outflow</th>
                    <th style={{ textAlign: "right" }}>Net</th>
                    <th style={{ textAlign: "right" }}>Projected balance</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.map(m => {
                    cumulative += m.net;
                    return (
                      <tr key={m.monthKey}>
                        <td className="mono" style={{ color: "var(--text2)" }}>{m.label}</td>
                        <td className="amount-pos text-right">{fmt(m.inflow)}</td>
                        <td className="amount-neg text-right">{fmt(m.outflow)}</td>
                        <td className={m.net >= 0 ? "amount-pos text-right" : "amount-neg text-right"}>{fmt(m.net)}</td>
                        <td className="mono text-right" style={{ color: cumulative >= 0 ? "var(--text)" : "var(--red)" }}>{fmt(cumulative)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── PURCHASE WEEKLY BUDGET ───────────────────────────────────────────────────
// O teto de compras não é um valor fixo: é % da receita prevista da semana, que
// sobe e desce junto com o movimento. Quem gasta é o Purchase; quem define é
// aqui (ou no CEO). Estourou, o PO para e vai pra fila do CEO.
function PurchaseBudgetCard({ tenantId, showToast }) {
  const [policy, setPolicy] = useState(null);
  const [week, setWeek] = useState(null);
  const [pct, setPct] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = () => {
    Promise.all([fetchPurchaseBudgetPolicy(tenantId), fetchPurchaseWeekBudget(tenantId)])
      .then(([p, w]) => {
        setPolicy(p);
        setWeek(w);
        setPct(p ? String(p.pct_of_forecast) : "30");
      })
      .catch(() => {});
  };
  useEffect(() => { reload(); }, [tenantId]);

  const save = async (next) => {
    setSaving(true);
    const ok = await savePurchaseBudgetPolicy(next, tenantId);
    setSaving(false);
    if (ok) { showToast("Purchase budget saved", "success"); reload(); }
    else showToast("Could not save purchase budget", "error");
  };

  const enabled = policy ? policy.enabled : true;
  const ceiling = week && week.budget != null ? Number(week.budget) : null;
  const committed = week ? Number(week.committed || 0) : 0;
  const basis = !week ? "" :
    week.forecast_source === "forecast"
      ? `${week.pct}% of ${fmt(Number(week.forecast_revenue))} forecast revenue for the week`
      : week.forecast_source === "last_week_actual"
        ? `${week.pct}% of ${fmt(Number(week.forecast_revenue))} — last week's actual sales, no forecast filled for this week`
        : "no sales forecast and no sales last week — the ceiling is off until one exists";

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="flex items-center gap-10" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Weekly purchase budget</div>
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>
            Percent of the week's forecast sales that Purchase can commit. Over it, the PO stops and goes to
            the CEO to approve.
          </div>
        </div>
        <div className="flex items-center gap-10">
          <input
            className="input"
            style={{ width: 80, textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, padding: "5px 8px" }}
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            onBlur={() => {
              const n = parseFloat(pct);
              if (!isFinite(n) || n < 0 || n > 100) { setPct(policy ? String(policy.pct_of_forecast) : "30"); return; }
              if (policy && n === Number(policy.pct_of_forecast)) return;
              save({ pct: n, enabled });
            }}
          />
          <span style={{ fontSize: 12, color: "var(--text2)" }}>% of forecast sales</span>
          <label className="flex items-center gap-10" style={{ fontSize: 11, color: "var(--text2)" }}>
            <input
              type="checkbox"
              checked={enabled}
              disabled={saving}
              onChange={(e) => save({ pct: parseFloat(pct) || 30, enabled: e.target.checked })}
            />
            enforce
          </label>
        </div>
      </div>
      {week && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", fontSize: 12 }}>
          {ceiling == null ? (
            <span style={{ color: "var(--text3)" }}>This week: {basis}</span>
          ) : (
            <>
              <span className="mono" style={{ fontSize: 14 }}>{fmt(ceiling)}</span>
              <span style={{ color: "var(--text3)" }}> this week · {fmt(committed)} already committed · </span>
              <span style={{ color: committed > ceiling ? "var(--red)" : "var(--accent)" }}>
                {fmt(ceiling - committed)} left
              </span>
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{basis}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── BUDGET ───────────────────────────────────────────────────────────────────
function Budget({ transactions, categories, budgets, setBudgets, saveBudget, showToast }) {
  const [period, setPeriod] = useState("monthly");

  const isLedger = makeLedgerFilter(categories, transactions);
  const getActual = (catId) => Math.abs(transactions.filter(t => t.category === catId && t.amount < 0 && isLedger(t)).reduce((s, t) => s + t.amount, 0));

  const getBudget = (catId) => {
    const b = budgets.find(b => b.categoryId === catId);
    return b ? (period === "monthly" ? b.monthly : b.annual) : 0;
  };

  const updateBudget = (catId, value) => {
    const num = parseFloat(value) || 0;
    setBudgets(prev => {
      const existing = prev.find(b => b.categoryId === catId);
      if (existing) return prev.map(b => b.categoryId === catId ? { ...b, [period === "monthly" ? "monthly" : "annual"]: num, [period === "monthly" ? "annual" : "monthly"]: period === "monthly" ? num * 12 : num / 12 } : b);
      return [...prev, { id: Date.now().toString(), categoryId: catId, monthly: period === "monthly" ? num : num / 12, annual: period === "monthly" ? num * 12 : num }];
    });
  };

  const expCats = categories.filter(c => c.type === "expense" && c.id !== UNCATEGORIZED);
  const totalBudget = expCats.reduce((s, c) => s + getBudget(c.id), 0);
  const totalActual = expCats.reduce((s, c) => s + getActual(c.id), 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Budget</div>
          <div className="page-subtitle">Set spending targets and track variance</div>
        </div>
        <div className="tabs" style={{ marginBottom: 0 }}>
          {["monthly", "annual"].map(p => (
            <div key={p} className={`tab ${period === p ? "active" : ""}`} onClick={() => setPeriod(p)} style={{ fontSize: 12 }}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </div>
          ))}
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 20 }}>
        <div className="kpi-card kpi-blue">
          <div className="kpi-label">Total Budget</div>
          <div className="kpi-value">{fmt(totalBudget)}</div>
        </div>
        <div className="kpi-card kpi-red">
          <div className="kpi-label">Total Actual</div>
          <div className="kpi-value">{fmt(totalActual)}</div>
        </div>
        <div className="kpi-card" style={{ borderTop: `2px solid ${totalBudget - totalActual >= 0 ? "var(--accent)" : "var(--red)"}` }}>
          <div className="kpi-label">Variance</div>
          <div className="kpi-value" style={{ color: totalBudget - totalActual >= 0 ? "var(--accent)" : "var(--red)" }}>{fmt(totalBudget - totalActual)}</div>
          <div className="kpi-delta" style={{ color: totalBudget - totalActual >= 0 ? "var(--accent)" : "var(--red)" }}>
            {totalBudget - totalActual >= 0 ? "▼ under budget" : "▲ over budget"}
          </div>
        </div>
      </div>

      <PurchaseBudgetCard tenantId={TENANT_ID} showToast={showToast} />

      <div className="card">
        {/* Header */}
        <div className="budget-row budget-header" style={{ padding: "0 0 10px", borderBottom: "1px solid var(--border2)" }}>
          <span>Category</span>
          <span style={{ textAlign: "right" }}>{period === "monthly" ? "Monthly Budget" : "Annual Budget"}</span>
          <span style={{ textAlign: "right" }}>Actual</span>
          <span style={{ textAlign: "right" }}>Variance</span>
          <span style={{ textAlign: "right" }}>Used %</span>
        </div>

        {expCats.map(c => {
          const budget = getBudget(c.id);
          const actual = getActual(c.id);
          const variance = budget - actual;
          const pct = budget > 0 ? Math.min((actual / budget) * 100, 100) : 0;
          const over = actual > budget && budget > 0;

          return (
            <div key={c.id} className="budget-row" style={{ gridTemplateColumns: "1fr 130px 130px 130px 100px" }}>
              <div className="flex items-center gap-10">
                <div className="swatch" style={{ background: c.color }} />
                <div>
                  <div style={{ fontSize: 13 }}>{c.name}</div>
                  <div className="progress-bar" style={{ marginTop: 5, width: 100 }}>
                    <div className="progress-fill" style={{ width: `${pct}%`, background: over ? "var(--red)" : c.color }} />
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <input
                  className="input"
                  style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, padding: "5px 8px" }}
                  value={budget || ""}
                  placeholder="0.00"
                  onChange={e => updateBudget(c.id, e.target.value)}
                  onBlur={(e) => { if (saveBudget) saveBudget({ categoryId: c.id, monthly: getBudget(c.id), annual: getBudget(c.id)*12, year: new Date().getFullYear() }); showToast("Budget saved", "success"); }}
                />
              </div>
              <div className="text-right mono" style={{ color: "var(--text2)" }}>{fmt(actual)}</div>
              <div className="text-right mono" style={{ color: variance >= 0 ? "var(--accent)" : "var(--red)" }}>
                {variance >= 0 ? "+" : ""}{fmt(variance)}
              </div>
              <div className="text-right">
                <span className={`tag ${over ? "tag-red" : pct > 80 ? "tag-yellow" : "tag-green"}`}>
                  {budget > 0 ? ((actual / budget) * 100).toFixed(0) + "%" : "—"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── TAX SUMMARY ──────────────────────────────────────────────────────────────
function TaxSummary({ transactions, categories, allTransactions, dateRange = {} }) {
  const fiscalYear = (dateRange.start || new Date().toISOString().slice(0, 10)).slice(0, 4);

  // 1099-NEC contractors: every vendor that received >$600 in expenses this
  // fiscal year. Includes both already-flagged and pending so the operator
  // sees the full pre-filing list in one place. Pulls from allTransactions
  // because the accrual filter in the parent might cut off some payments
  // legitimately due to a contractor that the IRS wants reported anyway.
  const contractors = (() => {
    const txns = (allTransactions || transactions).filter(t =>
      t.date >= `${fiscalYear}-01-01` && t.date <= `${fiscalYear}-12-31` &&
      parseFloat(t.amount) < 0 && isRevenueRelevant(t)
    );
    const byVendor = {};
    for (const t of txns) {
      const key = normalizeVendorKey(t.description);
      if (!key) continue;
      if (!byVendor[key]) byVendor[key] = { vendor: key, total: 0, count: 0, flagged: false, items: [] };
      byVendor[key].total += Math.abs(parseFloat(t.amount));
      byVendor[key].count += 1;
      byVendor[key].items.push(t);
      if (hasTag(t, "1099_flag")) byVendor[key].flagged = true;
    }
    return Object.values(byVendor).filter(v => v.total >= 600).sort((a, b) => b.total - a.total);
  })();

  const export1099CSV = () => {
    const rows = [["Vendor", "Total Paid", "Transactions", "Status"]];
    contractors.forEach(c => rows.push([c.vendor, c.total.toFixed(2), c.count, c.flagged ? "flagged" : "PENDING"]));
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `1099_contractors_${fiscalYear}.csv`; a.click();
  };
  const isLedger = makeLedgerFilter(categories, transactions);
  const byTaxLine = {};
  categories.forEach(c => {
    const total = transactions.filter(t => t.category === c.id && isLedger(t)).reduce((s, t) => s + t.amount, 0);
    if (total !== 0 && c.taxLine) {
      if (!byTaxLine[c.taxLine]) byTaxLine[c.taxLine] = { income: 0, expense: 0 };
      if (total > 0) byTaxLine[c.taxLine].income += total;
      else byTaxLine[c.taxLine].expense += Math.abs(total);
    }
  });

  const totalRevenue = Object.values(byTaxLine).reduce((s, v) => s + v.income, 0);
  const totalDeductions = Object.values(byTaxLine).reduce((s, v) => s + v.expense, 0);
  const netTaxable = totalRevenue - totalDeductions;
  const estTax = netTaxable > 0 ? netTaxable * 0.25 : 0; // rough estimate

  const exportCSV = () => {
    const rows = [["Tax Line", "Income", "Deductible Expense"]];
    Object.entries(byTaxLine).forEach(([line, v]) => rows.push([line, v.income.toFixed(2), v.expense.toFixed(2)]));
    rows.push(["TOTAL REVENUE", totalRevenue.toFixed(2), ""]);
    rows.push(["TOTAL DEDUCTIONS", "", totalDeductions.toFixed(2)]);
    rows.push(["NET TAXABLE INCOME", netTaxable.toFixed(2), ""]);
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `tax_summary_${fiscalYear}.csv`; a.click();
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Tax Summary</div>
          <div className="page-subtitle">Schedule C · Fiscal Year {fiscalYear}</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={exportCSV}><Icon name="download" size={13} /> Export CSV</button>
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="kpi-card kpi-accent">
          <div className="kpi-label">Gross Receipts</div>
          <div className="kpi-value">{fmt(totalRevenue)}</div>
        </div>
        <div className="kpi-card kpi-red">
          <div className="kpi-label">Total Deductions</div>
          <div className="kpi-value">{fmt(totalDeductions)}</div>
        </div>
        <div className="kpi-card kpi-blue">
          <div className="kpi-label">Net Taxable Income</div>
          <div className="kpi-value" style={{ color: netTaxable >= 0 ? "var(--text)" : "var(--accent)" }}>{fmt(netTaxable)}</div>
        </div>
        <div className="kpi-card kpi-yellow">
          <div className="kpi-label">Est. Tax Liability (25%)</div>
          <div className="kpi-value">{fmt(estTax)}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>Consult your CPA</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13, marginBottom: 16 }}>Deductions by Schedule C Line</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Schedule C Line</th><th style={{ textAlign: "right" }}>Income</th><th style={{ textAlign: "right" }}>Deductible Expense</th><th style={{ textAlign: "right" }}>Net</th></tr></thead>
            <tbody>
              {Object.entries(byTaxLine).map(([line, v]) => (
                <tr key={line}>
                  <td style={{ fontWeight: 500 }}>{line}</td>
                  <td className="text-right"><span className="mono" style={{ color: v.income > 0 ? "var(--accent)" : "var(--text3)" }}>{v.income > 0 ? fmt(v.income) : "—"}</span></td>
                  <td className="text-right"><span className="mono" style={{ color: v.expense > 0 ? "var(--red)" : "var(--text3)" }}>{v.expense > 0 ? fmt(v.expense) : "—"}</span></td>
                  <td className="text-right"><span className="mono" style={{ color: v.income - v.expense >= 0 ? "var(--accent)" : "var(--red)" }}>{fmt(v.income - v.expense)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {contractors.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
            <div>
              <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13 }}>1099-NEC Contractors · FY {fiscalYear}</div>
              <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                Vendors paid $600+ this year · {contractors.filter(c => c.flagged).length} flagged · {contractors.filter(c => !c.flagged).length} pending
              </div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={export1099CSV}><Icon name="download" size={13} /> Export 1099 list</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Vendor</th><th style={{ textAlign: "right" }}>Total Paid</th><th style={{ textAlign: "right" }}>Transactions</th><th style={{ textAlign: "right" }}>Status</th></tr></thead>
              <tbody>
                {contractors.map(c => (
                  <tr key={c.vendor}>
                    <td className="mono" style={{ fontWeight: 500 }}>{c.vendor}</td>
                    <td className="text-right amount-neg">{fmt(c.total)}</td>
                    <td className="text-right mono" style={{ color: "var(--text2)" }}>{c.count}</td>
                    <td className="text-right">
                      <span className="tag" style={{
                        background: c.flagged ? "var(--accentBg)" : "var(--yellowBg)",
                        color: c.flagged ? "var(--accent)" : "var(--yellow)",
                        border: `1px solid ${c.flagged ? "var(--accentBorder)" : "var(--yellow)40"}`,
                        fontSize: 10,
                      }}>{c.flagged ? "✓ Flagged" : "⚠ Pending"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card" style={{ background: "var(--yellowBg)", borderColor: "rgba(240,200,74,0.2)" }}>
        <div className="flex items-center gap-10">
          <Icon name="info" size={18} color="var(--yellow)" />
          <div>
            <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13, color: "var(--yellow)" }}>Tax Disclaimer</div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>This summary is for bookkeeping purposes only and does not constitute tax advice. The estimated tax liability uses a simplified 25% flat rate. Always consult a licensed CPA for accurate tax filing.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── RECONCILIATION ───────────────────────────────────────────────────────────

const AGG_PLATFORM_LABELS = {
  doordash: "DoorDash", ubereats: "UberEats",
  grubhub:  "GrubHub",  wix: "Wix Restaurants",
  other:    "Aggregator",
};

// Ledger id every aggregator adjustment hangs off. Kept in one place because
// three call sites derive it: creation, deletion, and the "is this payout
// already posted?" check.
const aggLedgerPrefix = (payoutRowId) => `agg_${payoutRowId}_`;

// Turns saved r7_aggregator_payouts rows into the expense entries that put the
// platform's cut in the P&L. Two callers: the manual statement upload (right
// after upsert) and the "post" action for payouts the email ingest wrote.
//
// Gross sales are NOT booked — the orders are already in the ledger as
// sq_sale_<date>_<channel> from Sync Sales, so booking them here would
// double-count. Refunds + tax are passthrough (the platform settles tax as
// Marketplace Facilitator).
//
//   commission  → Delivery Commissions (expense)
//   marketing   → Marketing (expense)
//   other_fees  → Delivery Commissions (lumped — usually misc platform fees)
function buildAggregatorAdjustments({ payouts, categories, sourceLabel }) {
  const findCat = (re, type = "expense") =>
    (categories.find(c => c.type === type && re.test(c.name || "")) || {}).id;
  const commCat = findCat(/delivery\s*commission|aggregator\s*commission/i)
               || findCat(/commission|fee/i);
  const mktCat  = findCat(/marketing|advertis/i);

  const adjustments = [];
  for (const row of payouts) {
    const platform = row.platform;
    const platformLabel = AGG_PLATFORM_LABELS[platform] || platform;
    const payoutRowId = row.id;
    // Human-readable half of the row id — `doordash_ST-1234` reads as `ST-1234`.
    const payoutKey = String(payoutRowId).replace(new RegExp("^" + platform + "_"), "");
    const baseId = `agg_${payoutRowId}`;
    const filename = row.filename || "";
    const origin = filename ? `statement ${filename}` : (sourceLabel || "statement");
    const baseNotes = `From ${platformLabel} ${origin}. Gross $${(+row.gross_sales || 0).toFixed(2)} → Net payout $${(+row.net_payout || 0).toFixed(2)}.`;

    const commTotal = (+row.commission || 0) + (+row.other_fees || 0);
    if (commTotal > 0 && commCat) {
      adjustments.push({
        id: `${baseId}_commission`,
        date: row.arrival_date,
        description: `${platformLabel} commission — payout ${payoutKey}`,
        amount: -Math.round(commTotal * 100) / 100,
        category: commCat, category_id: commCat,
        account: platformLabel, source: "aggregator_breakdown",
        reconciled: true, tags: ["aggregator", platform],
        notes: baseNotes,
      });
    }
    if ((+row.marketing_fee || 0) > 0 && mktCat) {
      adjustments.push({
        id: `${baseId}_marketing`,
        date: row.arrival_date,
        description: `${platformLabel} marketing fee — payout ${payoutKey}`,
        amount: -Math.round((+row.marketing_fee) * 100) / 100,
        category: mktCat, category_id: mktCat,
        account: platformLabel, source: "aggregator_breakdown",
        reconciled: true, tags: ["aggregator", platform],
        notes: baseNotes,
      });
    }
  }

  const missingCat = [];
  if (!commCat) missingCat.push("Delivery Commissions");
  if (!mktCat && payouts.some(p => +p.marketing_fee > 0)) missingCat.push("Marketing");

  return { adjustments, missingCat };
}

// A payout counts as posted once its ledger entries exist. Payouts with no
// commission and no marketing fee have nothing to post, so they're never
// "pending" — otherwise a $0-fee Wix payout would nag forever.
function aggPayoutNeedsPosting(payout, transactions) {
  const owed = (+payout.commission || 0) + (+payout.other_fees || 0) + (+payout.marketing_fee || 0);
  if (owed <= 0) return false;
  const prefix = aggLedgerPrefix(payout.id);
  return !transactions.some(t => String(t.id).startsWith(prefix));
}

function Reconciliation({ transactions, setTransactions, saveTransactions, categories, tenantId, dateRange, showToast }) {
  const [kitchenInvoices, setKitchenInvoices] = useState([]);
  const [squarePayouts, setSquarePayouts] = useState([]);
  const [aggregatorPayouts, setAggregatorPayouts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncingPayouts, setSyncingPayouts] = useState(false);
  const [parsingStatement, setParsingStatement] = useState(false);
  const [postingPayouts, setPostingPayouts] = useState(false);
  const [statementPreview, setStatementPreview] = useState(null);
  const aggregatorFileInputRef = useRef(null);

  // Pull real invoices from Favo Kitchen (r7_purchases) for the current window.
  // The mock list this used to render was already stale by the time the screen
  // shipped; nothing here should fall back to fixtures in production.
  useEffect(() => {
    if (!tenantId || tenantId === "demo") return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchKitchenPurchases(tenantId, dateRange),
      fetchKitchenVendors(tenantId),
      fetchSquarePayouts(tenantId, dateRange),
      fetchAggregatorPayouts(tenantId, dateRange),
    ]).then(([purchases, vendors, payouts, aggPayouts]) => {
      if (cancelled) return;
      const vendorMap = Object.fromEntries((vendors || []).map(v => [v.id, v.name]));
      const invoices = (purchases || []).map(p => {
        const vendorRaw = p.supplier || vendorMap[p.vendorId] || vendorMap[p.vendor_id] || "VENDOR";
        return {
          id: p.id,
          vendor: String(vendorRaw).toUpperCase(),
          date: p.date,
          amount: Math.abs(parseFloat(p.total) || 0),
          status: p.status || "pending",
          kitchenTxnId: "kitchen_purchase_" + p.id,
        };
      });
      setKitchenInvoices(invoices);
      setSquarePayouts(payouts || []);
      setAggregatorPayouts(aggPayouts || []);
    }).catch(err => {
      console.error("Reconciliation fetch failed:", err);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [tenantId, dateRange?.start, dateRange?.end]);

  // Aggregator statement upload — drop a PDF or CSV, AI extracts the per-payout
  // breakdown, operator confirms in the preview modal, then we upsert to
  // r7_aggregator_payouts. Same Anthropic flow as the paystub importer.
  const handleAggregatorFile = async (file) => {
    if (!file) return;
    setParsingStatement(true);
    showToast("Reading aggregator statement with AI... 10-20 seconds", "info");
    try {
      const ext = file.name.toLowerCase();
      let payload;
      if (ext.endsWith(".pdf")) {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e => resolve(String(e.target.result).split(",")[1]);
          reader.onerror = () => reject(new Error("Read failed"));
          reader.readAsDataURL(file);
        });
        payload = { pdfBase64: base64, filename: file.name };
      } else if (ext.endsWith(".csv") || ext.endsWith(".tsv") || ext.endsWith(".txt")) {
        const text = await file.text();
        payload = { csvText: text, filename: file.name };
      } else {
        showToast("Drop a PDF or CSV statement", "error");
        return;
      }
      const result = await parseAggregatorStatement(payload);
      setStatementPreview(result);
    } catch (err) {
      console.error("parseAggregatorStatement", err);
      showToast("Parse failed: " + err.message, "error");
    } finally {
      setParsingStatement(false);
    }
  };

  // Inline editor state for aggregator payouts table
  const [editingPayoutId, setEditingPayoutId] = useState(null);
  const [editingDate, setEditingDate] = useState("");

  const handleSavePayoutDate = async (payoutId) => {
    if (!editingDate) { setEditingPayoutId(null); return; }
    const res = await updateAggregatorPayoutDate(payoutId, editingDate, tenantId);
    if (!res.ok) {
      showToast("Update failed: " + (res.error || "unknown"), "error");
      return;
    }
    // Optimistic local update
    setAggregatorPayouts(prev => prev.map(p => p.id === payoutId ? { ...p, arrival_date: editingDate } : p));
    if (setTransactions) {
      const platform = aggregatorPayouts.find(p => p.id === payoutId)?.platform;
      if (platform) {
        const prefix = aggLedgerPrefix(payoutId);
        setTransactions(prev => prev.map(t => String(t.id).startsWith(prefix) ? { ...t, date: editingDate } : t));
      }
    }
    showToast("Payout date updated", "success");
    setEditingPayoutId(null);
    setEditingDate("");
  };

  const handleDeletePayout = async (payoutId) => {
    if (!window.confirm("Delete this payout and its commission/marketing ledger entries? This cannot be undone.")) return;
    const res = await deleteAggregatorPayout(payoutId, tenantId);
    if (!res.ok) {
      showToast("Delete failed: " + (res.error || "unknown"), "error");
      return;
    }
    setAggregatorPayouts(prev => prev.filter(p => p.id !== payoutId));
    if (setTransactions) {
      const platform = aggregatorPayouts.find(p => p.id === payoutId)?.platform;
      if (platform) {
        const prefix = aggLedgerPrefix(payoutId);
        setTransactions(prev => prev.filter(t => !String(t.id).startsWith(prefix)));
      }
    }
    showToast("Payout deleted", "success");
  };

  const saveAggregatorPayouts = async () => {
    if (!statementPreview?.payouts?.length) return;
    const platform = statementPreview.platform;
    const filename = statementPreview.filename || "";

    // 1) Save the payout rows themselves (repository of statement data)
    const rows = statementPreview.payouts.map((p, i) => ({
      id: p.payout_id
        ? `${platform}_${p.payout_id}`
        : `${platform}_${p.arrival_date || "unknown"}_${i}_${Date.now()}`,
      platform,
      period_start: statementPreview.period_start || null,
      period_end:   statementPreview.period_end || null,
      arrival_date: p.arrival_date || statementPreview.period_end || statementPreview.period_start,
      gross_sales:   p.gross_sales,
      commission:    p.commission,
      marketing_fee: p.marketing_fee,
      delivery_fee:  p.delivery_fee,
      refunds:       p.refunds,
      tax_remitted:  p.tax_remitted,
      other_fees:    p.other_fees,
      net_payout:    p.net_payout,
      source: "manual_upload",
      filename,
      raw: p,
    }));
    const res = await upsertAggregatorPayouts(rows, tenantId);
    if (!res.ok) {
      showToast("Save failed: " + (res.error || "unknown"), "error");
      return;
    }

    // 2) Create per-payout ledger entries so the P&L reflects the breakdown.
    const { adjustments, missingCat } = buildAggregatorAdjustments({ payouts: rows, categories });

    if (adjustments.length > 0) {
      const adjRes = await upsertTransactions(adjustments, tenantId);
      if (adjRes.ok) {
        // Optimistic local update so P&L reflects immediately
        if (setTransactions) {
          setTransactions(prev => {
            const ids = new Set(adjustments.map(a => a.id));
            const filtered = prev.filter(t => !ids.has(t.id));
            return [...adjustments, ...filtered];
          });
        }
        const note = missingCat.length ? ` · ⚠️ missing cat: ${missingCat.join(", ")}` : "";
        showToast(`${rows.length} ${platform} payout${rows.length === 1 ? "" : "s"} saved · ${adjustments.length} ledger entries created${note}`, "success");
      } else {
        showToast(`${rows.length} payouts saved BUT ledger entries failed: ${adjRes.error || "unknown"}`, "error");
      }
    } else {
      showToast(`${rows.length} ${platform} payout${rows.length === 1 ? "" : "s"} saved`, "success");
    }

    const fresh = await fetchAggregatorPayouts(tenantId, dateRange);
    setAggregatorPayouts(fresh || []);
    setStatementPreview(null);
  };

  // Payouts the email ingest wrote land unposted on purpose — AI read a money
  // document, so a human confirms before it hits the P&L. This posts them
  // through the exact same builder the manual upload uses.
  const pendingPayouts = aggregatorPayouts.filter(p => aggPayoutNeedsPosting(p, transactions));

  const postPendingPayouts = async () => {
    if (!pendingPayouts.length || postingPayouts) return;
    setPostingPayouts(true);
    try {
      const { adjustments, missingCat } = buildAggregatorAdjustments({
        payouts: pendingPayouts,
        categories,
        sourceLabel: "payout email",
      });
      if (!adjustments.length) {
        showToast(
          missingCat.length
            ? `Nothing posted — no category matches ${missingCat.join(" / ")}. Create it in Categories first.`
            : "Nothing to post",
          "error",
        );
        return;
      }
      const adjRes = await upsertTransactions(adjustments, tenantId);
      if (!adjRes.ok) {
        showToast("Posting failed: " + (adjRes.error || "unknown"), "error");
        return;
      }
      if (setTransactions) {
        setTransactions(prev => {
          const ids = new Set(adjustments.map(a => a.id));
          return [...adjustments, ...prev.filter(t => !ids.has(t.id))];
        });
      }
      const note = missingCat.length ? ` · ⚠️ missing cat: ${missingCat.join(", ")}` : "";
      showToast(`${pendingPayouts.length} payout${pendingPayouts.length === 1 ? "" : "s"} posted · ${adjustments.length} ledger entries${note}`, "success");
    } finally {
      setPostingPayouts(false);
    }
  };

  const handleSyncPayouts = async () => {
    if (!tenantId || tenantId === "demo") return;
    setSyncingPayouts(true);
    showToast("Pulling payouts from Square...", "info");
    try {
      const result = await syncSquarePayouts(tenantId, dateRange);
      const parts = [
        `${result.rows_written || 0} payout${result.rows_written === 1 ? "" : "s"} synced`,
        `${result.payouts_scanned || 0} scanned`,
      ];
      if (typeof result.auto_matched === "number" && result.auto_matched > 0) {
        parts.push(`${result.auto_matched} auto-matched to bank`);
      }
      if (typeof result.no_match === "number" && result.no_match > 0) {
        parts.push(`${result.no_match} unmatched`);
      }
      showToast(parts.join(" · "), "success");
      const fresh = await fetchSquarePayouts(tenantId, dateRange);
      setSquarePayouts(fresh || []);
    } catch (err) {
      console.error("syncSquarePayouts", err);
      showToast("Square Payouts sync failed: " + err.message, "error");
    } finally {
      setSyncingPayouts(false);
    }
  };

  // Match each Square payout against the bank ledger. The deterministic
  // server-side match runs inside sync-square-payouts and writes
  // `matched_txn_id` on the payout row — when present, that's the source of
  // truth. We fall back to a client-side heuristic (amount within $0.01,
  // arrival_date ±2 days) for any payout where the server pass hasn't run
  // yet, so the screen still has a useful preview before the next cron tick.
  const txnsById = new Map(transactions.map(t => [t.id, t]));
  const bankPositives = transactions.filter(t => parseFloat(t.amount) > 0);
  const dayMs = 86400000;
  const heuristicMatch = (payout) => {
    const target = parseFloat(payout.amount);
    const arrivalMs = new Date(payout.arrival_date).getTime();
    const candidates = bankPositives.filter(t => {
      if (Math.abs(parseFloat(t.amount) - target) > 0.01) return false;
      const dt = new Date(t.date).getTime();
      return Math.abs(dt - arrivalMs) <= 2 * dayMs;
    });
    candidates.sort((a, b) =>
      Math.abs(new Date(a.date).getTime() - arrivalMs) -
      Math.abs(new Date(b.date).getTime() - arrivalMs)
    );
    return candidates[0] || null;
  };
  const payoutMatches = squarePayouts.map(p => {
    if (p.matched_txn_id) {
      const persisted = txnsById.get(p.matched_txn_id);
      // Server has persisted the link. Even if the txn is missing from the
      // current date-range slice we still consider this matched — the link
      // is authoritative — but render an "out of range" hint.
      return { payout: p, match: persisted || null, matchType: "auto", outOfRange: !persisted };
    }
    return { payout: p, match: heuristicMatch(p), matchType: "heuristic", outOfRange: false };
  });
  const matchedPayouts = payoutMatches.filter(x => x.match || x.outOfRange).length;
  const unmatchedPayouts = squarePayouts.length - matchedPayouts;
  const totalPayoutAmount = squarePayouts.reduce((s, p) => s + parseFloat(p.amount || 0), 0);

  // Bank-side rows are unreconciled outflows from any source that ISN'T a
  // Kitchen purchase shadow — the real card/check that hit the bank.
  const unreconciled = transactions.filter(t =>
    !t.reconciled && t.amount < 0 && t.source !== "kitchen_purchase"
  );

  // Match heuristic: amount within $1, dates within 5 days, vendor name appears
  // in the bank description (case-insensitive). The Kitchen-side row that was
  // already synced into the ledger is ignored — we only want bank-side matches.
  const findMatch = (inv) => {
    const invTime = new Date(inv.date).getTime();
    return unreconciled.find(t => {
      if (Math.abs(Math.abs(t.amount) - inv.amount) > 1) return false;
      if (Math.abs(new Date(t.date).getTime() - invTime) > 5 * 86400000) return false;
      const desc = (t.description || "").toUpperCase();
      const vendor = inv.vendor || "";
      // Soften the vendor check: any token of length >= 4 from vendor must
      // appear in description (handles "SYSCO" matching "SYSCO FOODS USA").
      const tokens = vendor.split(/\s+/).filter(w => w.length >= 4);
      return tokens.length === 0 || tokens.some(w => desc.includes(w));
    });
  };

  const markReconciled = async (txnId, invoice) => {
    setTransactions(prev => {
      const updated = prev.map(t => t.id === txnId
        ? { ...t, reconciled: true, notes: t.notes ? `${t.notes} · matched ${invoice.vendor} ${invoice.date}` : `Matched ${invoice.vendor} invoice ${invoice.date}` }
        : t);
      if (saveTransactions) {
        const changed = updated.filter(t => t.id === txnId);
        saveTransactions(changed);
      }
      return updated;
    });
    showToast(`Reconciled with ${invoice.vendor}`, "success");
  };

  const autoMatched = kitchenInvoices.filter(inv => findMatch(inv)).length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Reconciliation</div>
          <div className="page-subtitle">{dateRange?.start} → {dateRange?.end} · Square payouts ↔ bank deposits · Kitchen invoices ↔ bank transactions</div>
        </div>
        <div className="flex gap-8">
          <input
            ref={aggregatorFileInputRef}
            type="file"
            accept=".pdf,.csv,.tsv,.txt"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAggregatorFile(f); e.target.value = ""; }}
          />
          <button
            className="btn btn-outline btn-sm"
            disabled={parsingStatement || !tenantId || tenantId === "demo"}
            onClick={() => aggregatorFileInputRef.current?.click()}
            title="Drop a DoorDash / UberEats / GrubHub / Wix statement (PDF or CSV) — AI extracts gross/commission/fees per payout"
          >
            {parsingStatement ? "Reading…" : "📄 Import aggregator statement"}
          </button>
          <button
            className="btn btn-outline btn-sm"
            onClick={handleSyncPayouts}
            disabled={syncingPayouts || !tenantId || tenantId === "demo"}
            title="Pull every Square payout for this window — used to confirm each Square liquidation actually landed in the bank"
          >
            {syncingPayouts ? "Syncing…" : "Sync Payouts"}
          </button>
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", marginBottom: 20 }}>
        <div className="kpi-card kpi-accent">
          <div className="kpi-label">Square Payouts</div>
          <div className="kpi-value">{squarePayouts.length}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>{fmt(totalPayoutAmount)} total</div>
        </div>
        <div className="kpi-card" style={{ borderColor: unmatchedPayouts > 0 ? "var(--red)" : "var(--accentBorder)" }}>
          <div className="kpi-label">Unmatched Payouts</div>
          <div className="kpi-value" style={{ color: unmatchedPayouts > 0 ? "var(--red)" : "var(--accent)" }}>{unmatchedPayouts}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>{matchedPayouts} matched to bank</div>
        </div>
        <div className="kpi-card kpi-yellow">
          <div className="kpi-label">Unreconciled</div>
          <div className="kpi-value">{unreconciled.length}</div>
        </div>
        <div className="kpi-card kpi-red">
          <div className="kpi-label">Pending Invoices</div>
          <div className="kpi-value">{kitchenInvoices.length}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>{loading ? "loading…" : "from Favo Kitchen"}</div>
        </div>
        <div className="kpi-card kpi-accent">
          <div className="kpi-label">Auto-Matched</div>
          <div className="kpi-value">{autoMatched}</div>
        </div>
      </div>

      {/* Square Payouts ↔ Bank Deposits — PR1 (visibility only). Each row is a
          Square payout; the right column is the best-guess bank deposit it
          should reconcile against (±2 days, same amount). Drift = payouts the
          Square API says were sent but we can't see in the bank ledger. */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13 }}>Square Payouts ↔ Bank Deposits</div>
          <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
            {squarePayouts.length === 0 ? "" : `${matchedPayouts}/${squarePayouts.length} matched`}
          </div>
        </div>
        {squarePayouts.length === 0 ? (
          <div className="empty" style={{ padding: 30 }}>
            <div className="empty-icon">🏦</div>
            <div className="empty-title">No Square payouts yet for this window</div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>
              Click <strong>Sync Payouts</strong> to pull from Square (cron also runs daily at 03:00 Central).
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Arrival</th>
                  <th>Payout ID</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Payout</th>
                  <th>Bank deposit</th>
                  <th style={{ textAlign: "right" }}>Drift</th>
                  <th>Match</th>
                </tr>
              </thead>
              <tbody>
                {payoutMatches.map(({ payout, match, matchType, outOfRange }) => {
                  const drift = match ? (parseFloat(match.amount) - parseFloat(payout.amount)) : null;
                  const statusColor = payout.status === "PAID" ? "var(--accent)"
                    : payout.status === "FAILED" ? "var(--red)"
                    : "var(--text3)";
                  const isMatched = !!match || outOfRange;
                  let matchBadge;
                  if (outOfRange) {
                    matchBadge = <span className="tag" title={"Matched to txn " + payout.matched_txn_id + " (outside current date range)"} style={{ fontSize: 10, color: "var(--accent)", border: "1px solid var(--accentBorder)", background: "var(--accentBg)" }}>🔒 auto · out of range</span>;
                  } else if (match && matchType === "auto") {
                    matchBadge = <span className="tag" title="Deterministically matched server-side via Square payout_id" style={{ fontSize: 10, color: "var(--accent)", border: "1px solid var(--accentBorder)", background: "var(--accentBg)" }}>🔒 auto-matched</span>;
                  } else if (match) {
                    matchBadge = <span className="tag" title="Heuristic preview (amount + date). Will become deterministic on next sync." style={{ fontSize: 10, color: "var(--blue)", border: "1px solid var(--blue)40", background: "transparent" }}>≈ heuristic</span>;
                  } else {
                    matchBadge = <span className="tag" style={{ fontSize: 10, color: "var(--red)", border: "1px solid var(--red)40", background: "transparent" }}>⚠️ missing</span>;
                  }
                  return (
                    <tr key={payout.id}>
                      <td className="mono" style={{ color: "var(--text3)" }}>{fmtDate(payout.arrival_date)}</td>
                      <td className="mono" style={{ fontSize: 10, color: "var(--text3)" }} title={payout.id}>
                        {String(payout.id).slice(0, 14)}…
                      </td>
                      <td>
                        <span className="tag" style={{ fontSize: 10, color: statusColor, border: `1px solid ${statusColor}40`, background: "transparent" }}>
                          {payout.status || "—"}
                        </span>
                      </td>
                      <td className="mono text-right" style={{ color: "var(--accent)" }}>{fmt(parseFloat(payout.amount))}</td>
                      <td>
                        {match ? (
                          <div>
                            <div style={{ fontSize: 12 }}>{String(match.description || "").slice(0, 40)}</div>
                            <div className="mono" style={{ fontSize: 10, color: "var(--text3)" }}>{fmtDate(match.date)} · {match.account || "—"}</div>
                          </div>
                        ) : outOfRange ? (
                          <span style={{ fontSize: 12, color: "var(--text3)" }}>linked txn outside current window</span>
                        ) : (
                          <span style={{ fontSize: 12, color: "var(--red)" }}>⚠️ no bank deposit found</span>
                        )}
                      </td>
                      <td className="mono text-right" style={{ color: drift === null ? "var(--text3)" : Math.abs(drift) < 0.01 ? "var(--accent)" : "var(--red)" }}>
                        {drift === null ? "—" : (drift >= 0 ? "+" : "") + fmt(drift)}
                      </td>
                      <td>{matchBadge}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Aggregator Payouts — DoorDash / UberEats / GrubHub / Wix per-payout
          breakdown ingested from monthly statements. Each row shows gross
          vs commission vs net so the real commission rate is visible
          (instead of the lump estimate we used to do via SQL). */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13 }}>
            Aggregator Payouts (DoorDash / UberEats / GrubHub / Wix)
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
            {aggregatorPayouts.length} payout{aggregatorPayouts.length === 1 ? "" : "s"} in window
          </div>
        </div>

        {/* Email-ingested payouts wait here for a human before touching the
            P&L — see the note on ingest-aggregator-email.js. */}
        {pendingPayouts.length > 0 && (
          <div
            className="flex items-center justify-between gap-10"
            style={{ marginBottom: 16, padding: "10px 12px", borderRadius: 6, background: "var(--yellowBg)", border: "1px solid rgba(240,200,74,0.2)" }}
          >
            <div style={{ fontSize: 12, color: "var(--text2)" }}>
              <strong style={{ color: "var(--yellow)" }}>
                {pendingPayouts.length} payout{pendingPayouts.length === 1 ? "" : "s"} not posted to the ledger
              </strong>
              {" — "}commission and marketing fees are missing from the P&L until you post them.
            </div>
            <button
              className="btn btn-primary"
              onClick={postPendingPayouts}
              disabled={postingPayouts}
              style={{ whiteSpace: "nowrap" }}
            >
              {postingPayouts ? "Posting…" : `Post ${pendingPayouts.length} to ledger`}
            </button>
          </div>
        )}
        {aggregatorPayouts.length === 0 ? (
          <div className="empty" style={{ padding: 30 }}>
            <div className="empty-icon">🛵</div>
            <div className="empty-title">No aggregator payouts ingested for this window</div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>
              Click <strong>📄 Import aggregator statement</strong> above and drop a DoorDash / UberEats / GrubHub / Wix file (PDF or CSV). AI extracts every payout's breakdown. Payouts forwarded to the ingest mailbox land here on their own, waiting to be posted.
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Arrival</th>
                  <th>Platform</th>
                  <th>Source</th>
                  <th style={{ textAlign: "right" }}>Gross</th>
                  <th style={{ textAlign: "right" }}>Commission</th>
                  <th style={{ textAlign: "right" }}>Marketing</th>
                  <th style={{ textAlign: "right" }}>Refunds</th>
                  <th style={{ textAlign: "right" }}>Net payout</th>
                  <th style={{ textAlign: "right" }}>Comm %</th>
                  <th style={{ width: 70 }}></th>
                </tr>
              </thead>
              <tbody>
                {aggregatorPayouts.map(p => {
                  const gross = parseFloat(p.gross_sales || 0);
                  const commPct = gross > 0 ? (parseFloat(p.commission || 0) / gross * 100) : 0;
                  const platformColor = {
                    doordash: "var(--red)",
                    ubereats: "var(--accent)",
                    grubhub:  "var(--yellow)",
                    wix:      "var(--blue)",
                    other:    "var(--text3)",
                  }[p.platform] || "var(--text3)";
                  const isEditing = editingPayoutId === p.id;
                  const needsPosting = aggPayoutNeedsPosting(p, transactions);
                  return (
                    <tr key={p.id}>
                      <td className="mono" style={{ color: "var(--text3)" }}>
                        {isEditing ? (
                          <input
                            type="date"
                            value={editingDate}
                            onChange={(e) => setEditingDate(e.target.value)}
                            onBlur={() => handleSavePayoutDate(p.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSavePayoutDate(p.id);
                              if (e.key === "Escape") { setEditingPayoutId(null); setEditingDate(""); }
                            }}
                            autoFocus
                            style={{ background: "var(--surface2)", border: "1px solid var(--accentBorder)", color: "var(--text)", padding: "3px 6px", borderRadius: 3, fontSize: 11, fontFamily: "var(--font-mono)" }}
                          />
                        ) : (
                          <span
                            onClick={() => { setEditingPayoutId(p.id); setEditingDate(p.arrival_date); }}
                            title="Click to edit arrival date"
                            style={{ cursor: "pointer", padding: "2px 4px", borderRadius: 3 }}
                            onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface2)"}
                            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                          >
                            {fmtDate(p.arrival_date)}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="tag" style={{ fontSize: 10, color: platformColor, border: `1px solid ${platformColor}40`, background: "transparent", textTransform: "uppercase" }}>
                          {p.platform}
                        </span>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span
                          className="mono"
                          style={{ fontSize: 11, color: "var(--text3)" }}
                          title={p.source === "email_inbox" ? `Ingested from the payout email${p.filename ? ` (${p.filename})` : ""}` : "Uploaded manually"}
                        >
                          {p.source === "email_inbox" ? "📧 email" : "📄 upload"}
                        </span>
                        {needsPosting && (
                          <span
                            className="tag"
                            title="Commission / marketing not in the P&L yet"
                            style={{ marginLeft: 6, fontSize: 10, color: "var(--yellow)", border: "1px solid rgba(240,200,74,0.3)", background: "transparent" }}
                          >
                            not posted
                          </span>
                        )}
                      </td>
                      <td className="mono text-right" style={{ color: "var(--accent)" }}>{fmt(gross)}</td>
                      <td className="mono text-right" style={{ color: "var(--red)" }}>−{fmt(parseFloat(p.commission || 0))}</td>
                      <td className="mono text-right" style={{ color: "var(--red)" }}>{p.marketing_fee > 0 ? "−" + fmt(parseFloat(p.marketing_fee)) : "—"}</td>
                      <td className="mono text-right" style={{ color: "var(--text3)" }}>{p.refunds > 0 ? "−" + fmt(parseFloat(p.refunds)) : "—"}</td>
                      <td className="mono text-right" style={{ color: "var(--accent)", fontWeight: 600 }}>{fmt(parseFloat(p.net_payout || 0))}</td>
                      <td className="mono text-right" style={{ color: commPct > 30 ? "var(--red)" : commPct > 20 ? "var(--yellow)" : "var(--accent)" }}>
                        {commPct.toFixed(1)}%
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button
                          onClick={() => handleDeletePayout(p.id)}
                          title="Delete this payout + its commission/marketing ledger entries"
                          style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--red)", padding: "2px 6px", borderRadius: 3, cursor: "pointer", fontSize: 11, fontFamily: "var(--font-mono)" }}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {statementPreview && (
        <AggregatorPreviewModal
          data={statementPreview}
          onClose={() => setStatementPreview(null)}
          onSave={saveAggregatorPayouts}
        />
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13, marginBottom: 16 }}>Invoice ↔ Bank Match</div>
        {kitchenInvoices.length === 0 ? (
          <div className="empty" style={{ padding: 30 }}>
            <div className="empty-icon">📭</div>
            <div className="empty-title">{loading ? "Loading invoices…" : "No Kitchen invoices in this date range"}</div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>Scan invoices in Favo Kitchen or expand the date range</div>
          </div>
        ) : kitchenInvoices.map(inv => {
          const match = findMatch(inv);
          return (
            <div key={inv.id} className="recon-row">
              <div className="recon-card">
                <div className="desc">📄 {inv.vendor}</div>
                <div className="meta">{fmtDate(inv.date)} · {inv.status || "pending"} · {fmt(inv.amount)}</div>
              </div>
              <div className="recon-arrow">{match ? "⇆" : "?"}</div>
              <div className="recon-card" style={{ borderColor: match ? "var(--accentBorder)" : "var(--border)" }}>
                {match ? (
                  <>
                    <div className="desc" style={{ color: "var(--accent)" }}>🏦 {match.description}</div>
                    <div className="meta">{fmtDate(match.date)} · {match.account} · {fmt(Math.abs(match.amount))}</div>
                    <button className="btn btn-sm" style={{ marginTop: 8, background: "var(--accentBg)", color: "var(--accent)", border: "1px solid var(--accentBorder)", fontSize: 11 }} onClick={() => markReconciled(match.id, inv)}>
                      Mark reconciled
                    </button>
                  </>
                ) : (
                  <div style={{ color: "var(--text3)", fontSize: 12, fontFamily: "var(--font-mono)" }}>No match found — review manually</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13, marginBottom: 16 }}>Unreconciled Transactions</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th style={{ textAlign: "right" }}>Amount</th><th></th></tr></thead>
            <tbody>
              {unreconciled.length === 0 ? (
                <tr><td colSpan={5}><div className="empty" style={{ padding: 30 }}><div className="empty-icon">✅</div><div className="empty-title">All clear!</div></div></td></tr>
              ) : unreconciled.map(t => {
                const cat = categories.find(c => c.id === t.category);
                return (
                  <tr key={t.id}>
                    <td className="mono" style={{ color: "var(--text3)" }}>{fmtDate(t.date)}</td>
                    <td>{t.description}</td>
                    <td>{cat && <span className="tag" style={{ background: cat.color + "18", color: cat.color, border: `1px solid ${cat.color}30` }}>{cat.name}</span>}</td>
                    <td className="amount-neg text-right">{fmt(t.amount)}</td>
                    <td><button className="btn btn-sm" style={{ background: "var(--accentBg)", color: "var(--accent)", border: "1px solid var(--accentBorder)", fontSize: 11 }} onClick={() => showToast("Marked as reconciled", "success")}>Mark reconciled</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ─── BILLS & PAYMENTS (Accounts Payable) ─────────────────────────────────────
function Bills({ transactions, setTransactions, bills, setBills, saveBill, deleteB, categories, dateRange, showToast, saveTransactions }) {
  // bills/setBills come from parent App state

  const [modal, setModal] = useState(null); // null | "add" | "pay" | "view"
  const [selected, setSelected] = useState(null);
  const [payForm, setPayForm] = useState({ date: "", method: country().defaultPaymentMethod, notes: "" });
  const [addForm, setAddForm] = useState({ vendor: "", amount: "", dueDate: "", category: "", notes: "" });
  const [filterStatus, setFilterStatus] = useState("all");

  // Payment rails are country-specific: ACH/Check/Zelle in the US, Pix/Boleto
  // in Brazil.
  const METHODS = country().paymentMethods;

  // ─── Auto-reconcile bills against real bank activity ───────────────────────
  // When the real bank debit shows up (Plaid sync, or an imported BoA statement)
  // we match it to an open bill by amount + vendor + date and mark the bill paid
  // automatically — no manual "Pay Bill" click needed. For Kitchen-sourced bills
  // the synthetic invoice shadow is removed so the expense isn't double-counted;
  // the real bank transaction stays as the system of record.
  useEffect(() => {
    // Bank-side outflows that could be a bill payment (exclude the Kitchen
    // invoice shadow and the synthetic payment rows we create ourselves).
    const bankOutflows = transactions.filter(t =>
      t.amount < 0 &&
      t.source !== "kitchen_purchase" &&
      t.source !== "bill_payment" &&
      !String(t.id).startsWith("payment_")
    );
    if (bankOutflows.length === 0) return;

    // Txns already tied to a paid bill — never reuse them.
    const usedTxnIds = new Set(bills.filter(b => b.status === "paid" && b.txnId).map(b => b.txnId));

    const matchBill = (bill) => {
      const dueTime = new Date(bill.dueDate).getTime();
      const vTokens = String(bill.vendor || "").toUpperCase().split(/\s+/).filter(w => w.length >= 4);
      if (vTokens.length === 0) return null; // need a vendor signal to be safe
      return bankOutflows.find(t => {
        if (usedTxnIds.has(t.id)) return false;
        // amount within $1 or 1% (whichever is larger)
        if (Math.abs(Math.abs(t.amount) - bill.amount) > Math.max(1, bill.amount * 0.01)) return false;
        // payment lands within ~30 days before the due date and up to 10 after
        const dt = (new Date(t.date).getTime() - dueTime) / 86400000;
        if (dt < -30 || dt > 10) return false;
        const desc = String(t.description || "").toUpperCase();
        return vTokens.some(w => desc.includes(w));
      });
    };

    const paidBills = [];
    const dropTxnIds = []; // Kitchen invoice shadows to remove
    const editTxns = [];   // real bank debits to tag with the bill's category

    for (const bill of bills) {
      if (bill.status === "paid") continue;
      const m = matchBill(bill);
      if (!m) continue;
      usedTxnIds.add(m.id);
      const method = m.account && m.account !== "Plaid" ? m.account : country().defaultPaymentMethod;
      paidBills.push({
        ...bill,
        status: "paid",
        paidDate: m.date,
        paidMethod: method,
        txnId: m.id,
        notes: (bill.notes ? bill.notes + " · " : "") + "Auto-matched to bank transaction",
      });
      if (bill.source === "kitchen" && bill.txnId && bill.txnId !== m.id) dropTxnIds.push(bill.txnId);
      const needCat = (!m.category || m.category === UNCATEGORIZED) && bill.category && bill.category !== UNCATEGORIZED;
      if (needCat) editTxns.push({ ...m, category: bill.category, reconciled: true });
      else if (!m.reconciled) editTxns.push({ ...m, reconciled: true });
    }

    if (paidBills.length === 0) return;

    const paidById = new Map(paidBills.map(b => [b.id, b]));
    setBills(prev => prev.map(b => paidById.get(b.id) || b));
    paidBills.forEach(b => { if (saveBill) saveBill(b); });

    if (dropTxnIds.length || editTxns.length) {
      const dropSet = new Set(dropTxnIds);
      const editMap = new Map(editTxns.map(t => [t.id, t]));
      setTransactions(prev => prev
        .filter(t => !dropSet.has(t.id))
        .map(t => editMap.get(t.id) || t)
      );
      if (editTxns.length && saveTransactions) saveTransactions(editTxns);
      dropTxnIds.forEach(id => { deleteTransaction(id).catch(() => {}); });
    }

    showToast(
      paidBills.length === 1
        ? "Bill auto-paid — " + paidBills[0].vendor + " (" + fmt(paidBills[0].amount) + ")"
        : paidBills.length + " bills auto-reconciled from bank",
      "success"
    );
  }, [transactions, bills]);

  const isOverdue = (b) => b.status !== "paid" && b.dueDate < today();

  const filtered = bills.filter(b => {
    if (filterStatus === "unpaid") return b.status !== "paid";
    if (filterStatus === "paid") return b.status === "paid";
    if (filterStatus === "overdue") return isOverdue(b);
    return true;
  });

  const totalDue = bills.filter(b => b.status !== "paid").reduce((s, b) => s + b.amount, 0);
  const totalOverdue = bills.filter(b => isOverdue(b)).reduce((s, b) => s + b.amount, 0);
  const totalPaid = bills.filter(b => b.status === "paid").reduce((s, b) => s + b.amount, 0);
  const paidCount = bills.filter(b => b.status === "paid").length;

  const openPay = (bill) => {
    setSelected(bill);
    setPayForm({ date: today(), method: country().defaultPaymentMethod, notes: "" });
    setModal("pay");
  };

  const confirmPay = () => {
    if (!payForm.date) return;

    // Mark bill as paid
    setBills(prev => prev.map(b => b.id === selected.id
      ? { ...b, status: "paid", paidDate: payForm.date, paidMethod: payForm.method, notes: payForm.notes }
      : b
    ));

    // Create ledger transaction for this payment
    const cat = categories.find(c => c.id === selected.category);
    const newTxn = {
      id: "payment_" + selected.id + "_" + Date.now(),
      date: payForm.date,
      description: "PAYMENT — " + selected.vendor,
      amount: -selected.amount,
      category: selected.category || UNCATEGORIZED,
      account: payForm.method,
      reconciled: true,
      source: "bill_payment",
      notes: payForm.notes || ("Bill paid via " + payForm.method),
    };
    setTransactions(prev => {
      // Remove old kitchen_purchase txn and replace with payment txn
      const without = prev.filter(t => t.id !== selected.txnId);
      return [newTxn, ...without];
    });

    if (saveBill) saveBill({ ...selected, status: "paid", paidDate: payForm.date, paidMethod: payForm.method, notes: payForm.notes });
    if (saveTransactions) saveTransactions([newTxn]);
    showToast("Bill paid! " + fmt(selected.amount) + " to " + selected.vendor, "success");
    setModal(null);
    setSelected(null);
  };

  const addBill = () => {
    if (!addForm.vendor || !addForm.amount || !addForm.dueDate) return;
    const newBill = {
      id: "bill_manual_" + Date.now(),
      txnId: null,
      vendor: addForm.vendor.toUpperCase(),
      amount: parseFloat(addForm.amount),
      dueDate: addForm.dueDate,
      issueDate: today(),
      status: "due",
      category: addForm.category || UNCATEGORIZED,
      paidDate: null,
      paidMethod: null,
      notes: addForm.notes,
      source: "manual",
    };
    setBills(prev => [newBill, ...prev]);
    if (saveBill) saveBill(newBill);
    setAddForm({ vendor: "", amount: "", dueDate: "", category: "", notes: "" });
    setModal(null);
    showToast("Bill added — " + newBill.vendor, "success");
  };

  const statusTag = (b) => {
    if (b.status === "paid") return <span className="tag tag-green">Paid</span>;
    if (isOverdue(b)) return <span className="tag tag-red">Overdue</span>;
    const days = Math.ceil((new Date(b.dueDate) - new Date()) / 86400000);
    if (days <= 7) return <span className="tag tag-yellow">Due in {days}d</span>;
    return <span className="tag tag-blue">Due {fmtShort(b.dueDate)}</span>;
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Bills & Payments</div>
          <div className="page-subtitle">Accounts Payable · {bills.length} bills</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setModal("add")}>
          <Icon name="plus" size={13} /> Add Bill
        </button>
      </div>

      {/* KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4,1fr)", marginBottom: 20 }}>
        <div className="kpi-card kpi-red" style={{ cursor: "pointer" }} onClick={() => setFilterStatus("unpaid")}>
          <div className="kpi-label">Total Due</div>
          <div className="kpi-value" style={{ color: "var(--red)" }}>{fmt(totalDue)}</div>
          <div className="kpi-delta neg">{bills.filter(b => b.status !== "paid").length} unpaid bills</div>
        </div>
        <div className="kpi-card" style={{ borderTop: "2px solid var(--red)", cursor: "pointer" }} onClick={() => setFilterStatus("overdue")}>
          <div className="kpi-label">Overdue</div>
          <div className="kpi-value" style={{ color: totalOverdue > 0 ? "var(--red)" : "var(--text3)" }}>{fmt(totalOverdue)}</div>
          <div className="kpi-delta neg">{bills.filter(b => isOverdue(b)).length} bills overdue</div>
        </div>
        <div className="kpi-card kpi-accent" style={{ cursor: "pointer" }} onClick={() => setFilterStatus("paid")}>
          <div className="kpi-label">Paid</div>
          <div className="kpi-value">{fmt(totalPaid)}</div>
          <div className="kpi-delta pos">{paidCount} bills paid</div>
        </div>
        <div className="kpi-card kpi-blue">
          <div className="kpi-label">Next 7 Days</div>
          <div className="kpi-value">
            {fmt(bills.filter(b => {
              if (b.status === "paid") return false;
              const d = Math.ceil((new Date(b.dueDate) - new Date()) / 86400000);
              return d >= 0 && d <= 7;
            }).reduce((s, b) => s + b.amount, 0))}
          </div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>upcoming</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-12 mb-16">
        <div className="tabs" style={{ marginBottom: 0 }}>
          {[
            { k: "all", l: "All" },
            { k: "unpaid", l: "Unpaid" },
            { k: "overdue", l: "Overdue" },
            { k: "paid", l: "Paid" },
          ].map(({ k, l }) => (
            <div key={k} className={"tab" + (filterStatus === k ? " active" : "")} onClick={() => setFilterStatus(k)}>{l}</div>
          ))}
        </div>
      </div>

      {/* Bills table */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Source</th>
                <th>Category</th>
                <th>Issue Date</th>
                <th>Due Date</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8}>
                  <div className="empty">
                    <div className="empty-icon">✅</div>
                    <div className="empty-title">No bills in this view</div>
                    <div className="empty-sub">Use "Sync Kitchen" to import invoices or add manually</div>
                  </div>
                </td></tr>
              ) : filtered.map(bill => {
                const cat = categories.find(c => c.id === bill.category);
                return (
                  <tr key={bill.id} style={{ opacity: bill.status === "paid" ? 0.6 : 1 }}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{bill.vendor}</div>
                      {bill.paidMethod && <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>via {bill.paidMethod}</div>}
                    </td>
                    <td>
                      <span className={"tag " + (bill.source === "kitchen" ? "tag-blue" : "tag-gray")}>
                        {bill.source === "kitchen" ? "🍳 Kitchen" : "Manual"}
                      </span>
                    </td>
                    <td>
                      {cat
                        ? <span className="tag" style={{ background: cat.color + "18", color: cat.color, border: "1px solid " + cat.color + "30" }}>{cat.name}</span>
                        : <span className="tag tag-gray">—</span>
                      }
                    </td>
                    <td className="mono" style={{ color: "var(--text3)", fontSize: 12 }}>{fmtShort(bill.issueDate)}</td>
                    <td className="mono" style={{ fontSize: 12, color: isOverdue(bill) && bill.status !== "paid" ? "var(--red)" : "var(--text3)" }}>
                      {bill.status === "paid" ? fmtShort(bill.paidDate) : fmtDate(bill.dueDate)}
                    </td>
                    <td>{statusTag(bill)}</td>
                    <td className="text-right">
                      <span className="mono" style={{ color: bill.status === "paid" ? "var(--text3)" : "var(--red)", fontSize: 13 }}>
                        {fmt(bill.amount)}
                      </span>
                    </td>
                    <td>
                      {bill.status !== "paid" ? (
                        <button
                          className="btn btn-sm"
                          style={{ background: "var(--accentBg)", color: "var(--accent)", border: "1px solid var(--accentBorder)", whiteSpace: "nowrap" }}
                          onClick={() => openPay(bill)}
                        >
                          <Icon name="check" size={12} /> Pay Bill
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>Paid {fmtShort(bill.paidDate)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── PAY BILL MODAL ── */}
      {modal === "pay" && selected && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Pay Bill</div>
              <button className="btn btn-ghost" style={{ padding: 4 }} onClick={() => setModal(null)}><Icon name="close" size={16} /></button>
            </div>
            <div className="modal-body">
              {/* Bill summary */}
              <div className="card card-sm" style={{ background: "var(--surface2)", marginBottom: 20 }}>
                <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{selected.vendor}</div>
                <div className="flex items-center justify-between mt-4">
                  <span style={{ fontSize: 12, color: "var(--text3)" }}>Amount Due</span>
                  <span className="mono" style={{ fontSize: 20, color: "var(--red)" }}>{fmt(selected.amount)}</span>
                </div>
                <div className="flex items-center justify-between mt-4">
                  <span style={{ fontSize: 12, color: "var(--text3)" }}>Due Date</span>
                  <span className="mono" style={{ fontSize: 12 }}>{fmtDate(selected.dueDate)}</span>
                </div>
              </div>

              <div className="form-group">
                <label className="label">Payment Date</label>
                <input type="date" className="input" value={payForm.date} onChange={e => setPayForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">Payment Method</label>
                <select className="input" value={payForm.method} onChange={e => setPayForm(f => ({ ...f, method: e.target.value }))}>
                  {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Notes (optional)</label>
                <input className="input" placeholder="e.g. Check #1042, reference number..." value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} />
              </div>

              <div className="card card-sm" style={{ background: "var(--accentBg)", border: "1px solid var(--accentBorder)", marginTop: 4 }}>
                <div style={{ fontSize: 12, color: "var(--text2)" }}>
                  This will mark the bill as <strong style={{ color: "var(--accent)" }}>Paid</strong> and create a ledger transaction of <strong style={{ color: "var(--accent)" }}>{fmt(selected.amount)}</strong> under <strong style={{ color: "var(--accent)" }}>{payForm.method}</strong> on {payForm.date ? fmtDate(payForm.date) : "—"}.
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmPay} disabled={!payForm.date}>
                <Icon name="check" size={13} /> Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD BILL MODAL ── */}
      {modal === "add" && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Add Bill</div>
              <button className="btn btn-ghost" style={{ padding: 4 }} onClick={() => setModal(null)}><Icon name="close" size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="label">Vendor / Payee</label>
                <input className="input" placeholder="e.g. SYSCO FOODS" value={addForm.vendor} onChange={e => setAddForm(f => ({ ...f, vendor: e.target.value }))} />
              </div>
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="label">Amount</label>
                  <input type="number" className="input" placeholder="0.00" value={addForm.amount} onChange={e => setAddForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="label">Due Date</label>
                  <input type="date" className="input" value={addForm.dueDate} onChange={e => setAddForm(f => ({ ...f, dueDate: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label className="label">Category</label>
                <select className="input" value={addForm.category} onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))}>
                  <option value="">— Select category —</option>
                  {categories.filter(c => c.type === "expense").map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Notes</label>
                <input className="input" placeholder="Invoice #, PO number, etc." value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={addBill} disabled={!addForm.vendor || !addForm.amount || !addForm.dueDate}>
                <Icon name="plus" size={13} /> Add Bill
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── CFO INSIGHTS ─────────────────────────────────────────────────────────────
function Insights({ transactions, categories, budgets, recurring = [], tenantId, dateRange = {} }) {
  const [bookForecast, setBookForecast] = useState(null);
  useEffect(() => {
    if (!tenantId || tenantId === "demo") return;
    let cancelled = false;
    fetchBookingsForecast(tenantId).then(data => { if (!cancelled) setBookForecast(data); });
    return () => { cancelled = true; };
  }, [tenantId]);
  const [period, setPeriod] = useState("weekly");
  const isLedger = makeLedgerFilter(categories, transactions);
  const transferPairs = detectTransferPairs(transactions);
  const realTxns = transactions.filter(t => !transferPairs.has(t.id) && isLedger(t));
  const { income: totalIncome, expense: totalExpense } = splitIncomeExpense(realTxns, categories);
  const netIncome    = totalIncome - totalExpense;
  const netMargin    = totalIncome > 0 ? (netIncome/totalIncome)*100 : 0;
  const getCat = (id) => id ? Math.abs(realTxns.filter(t => t.category === id).reduce((s,t) => s+t.amount, 0)) : 0;
  // Food cost, labor and rent come from the country pack's reporting lines and
  // are SUMMED, not picked. Matching one category by an English name regex
  // returned 0 for every tile on a BR tenant, and even in English it stopped at
  // the first hit — so a chart of accounts that splits payroll from its charges
  // reported only the first slice. Marketing and insurance below are still
  // name-based; the packs do not declare those lines yet.
  const findCatId = (re) => (categories.find(c => re.test(c.name || "")) || {}).id;
  const sumCats  = (pred) => categories.filter(pred).reduce((s, c) => s + getCat(c.id), 0);
  const foodCost = sumCats(isCogs);
  const labor    = sumCats(isLabor);
  const rent     = sumCats(isRent);
  const marketing= getCat(findCatId(/marketing|advertis/i));
  const insurance= getCat(findCatId(/insurance/i));
  const foodCostPct  = totalIncome > 0 ? (foodCost/totalIncome)*100 : 0;
  const laborPct     = totalIncome > 0 ? (labor/totalIncome)*100 : 0;
  const primeCost    = foodCostPct + laborPct;
  const rentPct      = totalIncome > 0 ? (rent/totalIncome)*100 : 0;
  const marketingPct = totalIncome > 0 ? (marketing/totalIncome)*100 : 0;
  const burnRate     = totalExpense / 30;
  const estimatedCash = Math.max(netIncome * 3, 5000);
  const runway = burnRate > 0 ? Math.round(estimatedCash / burnRate) : 999;
  const getBudgetAmt = (id) => { const b = budgets.find(b => b.categoryId === id); return b ? b.monthly : 0; };

  const alerts = [];
  if (foodCostPct > 35)  alerts.push({ level:"critical", icon:"🚨", title:"Food Cost Critical",    msg:`At ${foodCostPct.toFixed(1)}% — benchmark 28-35%. Losing ${fmt(foodCost - totalIncome*0.32)} vs target.`,  action:"Review portion sizes, supplier contracts, and menu pricing immediately." });
  if (foodCostPct > 28 && foodCostPct <= 35) alerts.push({ level:"warn", icon:"⚠️", title:"Food Cost Elevated", msg:`At ${foodCostPct.toFixed(1)}% — approaching danger zone.`, action:"Audit top 10 menu items for margin. Consider 3-5% price increase on low-margin items." });
  if (laborPct > 35)     alerts.push({ level:"critical", icon:"🚨", title:"Labor Cost Critical",   msg:`At ${laborPct.toFixed(1)}% — overspending by ${fmt(labor - totalIncome*0.30)}.`,  action:"Review scheduling. Cut overtime. Cross-train staff for multiple roles." });
  if (primeCost > 65)    alerts.push({ level:"critical", icon:"🚨", title:"Prime Cost Danger",     msg:`Prime cost ${primeCost.toFixed(1)}% — must stay below 65%.`,  action:"Emergency review: reduce food cost AND labor simultaneously." });
  if (netMargin < 5 && totalIncome > 0) alerts.push({ level:"warn", icon:"⚠️", title:"Thin Net Margin", msg:`Net margin ${netMargin.toFixed(1)}% — target 5-10%.`, action:"Focus on revenue growth and cut top 3 expense lines by 10% each." });
  if (runway < 30)       alerts.push({ level:"critical", icon:"🚨", title:"Cash Flow Risk",        msg:`Runway only ${runway} days.`, action:"Accelerate collections, defer non-essential purchases, review all subscriptions." });
  if (runway < 60 && runway >= 30) alerts.push({ level:"warn", icon:"⚠️", title:"Monitor Cash",   msg:`Cash runway ~${runway} days. Watch closely.`, action:"Build 90-day cash forecast. Identify upcoming large expenses." });
  if (marketingPct < 1 && totalIncome > 10000) alerts.push({ level:"info", icon:"💡", title:"Marketing Underinvestment", msg:`Only ${marketingPct.toFixed(1)}% on marketing — should be 2-4%.`, action:"Increase digital spend: Google My Business, Instagram, loyalty programs." });

  const benchmarks = [
    { name:"Food Cost %",  value:foodCostPct,  target:32, unit:"%", lower:true,  good:foodCostPct<=32,  warn:foodCostPct<=35 },
    { name:"Labor Cost %", value:laborPct,     target:30, unit:"%", lower:true,  good:laborPct<=30,     warn:laborPct<=35 },
    { name:"Prime Cost %", value:primeCost,    target:60, unit:"%", lower:true,  good:primeCost<=60,    warn:primeCost<=65 },
    { name:"Net Margin %", value:netMargin,    target:8,  unit:"%", lower:false, good:netMargin>=8,     warn:netMargin>=5 },
    { name:"Rent %",       value:rentPct,      target:6,  unit:"%", lower:true,  good:rentPct<=6,       warn:rentPct<=10 },
    { name:"Marketing %",  value:marketingPct, target:3,  unit:"%", lower:false, good:marketingPct>=2,  warn:marketingPct>=1 },
  ];

  const actionItems = {
    daily:[
      { icon:"📊", title:"Review yesterday's sales vs target", detail:`Target daily: ${fmt(totalIncome/30)}. Track variance every morning at 9am.` },
      { icon:"🍽️", title:"Check food waste log", detail:"Every $1 waste = $3-4 revenue needed to compensate. Review with kitchen lead." },
      { icon:"💵", title:"Verify POS deposits hit bank", detail:"Square settlements appear within 1-2 business days. Flag any missing deposits immediately." },
      { icon:"👥", title:"Review labor vs covers", detail:"Track covers-per-labor-hour. Optimal for casual dining: 15-20 covers per server." },
    ],
    weekly:[
      { icon:"📈", title:"Week-over-week revenue", detail:"Compare same day last week. Flag any day >15% below prior week." },
      { icon:"🧾", title:"Process all vendor invoices", detail:"Clear bill queue. Pay within terms to protect supplier relationships and avoid late fees." },
      { icon:"🏪", title:"Inventory spot-check (top 10 items)", detail:"Check top 10 highest-cost ingredients. Calculate theoretical vs actual usage." },
      { icon:"💳", title:"Reconcile all card statements", detail:"Match all card charges to receipts. Catch duplicate charges and fraudulent transactions." },
      { icon:"📣", title:"Review marketing performance", detail:"Check Google Ads CTR, Meta reach, DoorDash volume vs prior week." },
    ],
    monthly:[
      { icon:"📋", title:"Full P&L review", detail:`Current net margin: ${netMargin.toFixed(1)}%. Target: 8%+. Identify top 3 categories to optimize.` },
      { icon:"💰", title:"Food cost deep dive", detail:`Food cost at ${foodCostPct.toFixed(1)}%. Run theoretical vs actual. Investigate any >2% variance.` },
      { icon:"👔", title:"Labor efficiency review", detail:`Labor at ${laborPct.toFixed(1)}%. Review scheduling per day-part. Identify overstaffed shifts.` },
      { icon:"🏦", title:"30-day cash flow forecast", detail:`Burn rate: ${fmt(burnRate)}/day. Project next month including all upcoming bills.` },
      { icon:"📊", title:"Budget vs actual variance", detail:"For each category >10% over budget, require written explanation and corrective action." },
      { icon:"🤝", title:"Supplier price review", detail:"Review top 5 suppliers for price creep. Renegotiate any contract >$2,000/month." },
    ],
    quarterly:[
      { icon:"🎯", title:"Menu repricing analysis", detail:"Items with <60% gross margin: reprice, reposition, or remove." },
      { icon:"📉", title:"Year-over-year trend", detail:"Compare revenue, food cost%, labor% vs same quarter last year. Flag structural shifts." },
      { icon:"💡", title:"Marketing ROI review", detail:`Spending ${fmt(marketing)} on marketing. Calculate customer acquisition cost and repeat rate.` },
      { icon:"🔄", title:"Menu engineering", detail:"Classify all items: Stars / Plowhorses / Puzzles / Dogs. Eliminate or redesign Dogs." },
      { icon:"📜", title:"Review all vendor contracts", detail:"Get 2-3 quotes on top 5 product categories. Use competing quotes to negotiate." },
      { icon:"🏛️", title:"Tax planning with CPA", detail:"Quarterly estimated taxes due. Review deductions. Ensure proper expense categorization." },
    ],
    annual:[
      { icon:"🏆", title:"Annual P&L vs prior year", detail:"Full year performance review. Set benchmarks for next year based on industry data." },
      { icon:"💼", title:"Compensation & benefits review", detail:"Review all wages vs market. Plan merit increases. Calculate total cost of employment." },
      { icon:"🏗️", title:"CapEx planning", detail:"Equipment replacement schedule. Create 3-year capital expenditure plan." },
      { icon:"📱", title:"Technology stack audit", detail:"Review all SaaS subscriptions. Cut unused tools. Negotiate annual vs monthly pricing." },
      { icon:"🌱", title:"Growth strategy review", detail:"Catering? Second location? Ghost kitchen? Model each with 3-year pro forma." },
      { icon:"🧮", title:"Annual tax preparation", detail:`Net taxable income: ${fmt(netIncome)}. Maximize Schedule C deductions.` },
    ],
  };

  const alertColor = { critical:"var(--red)", warn:"var(--yellow)", info:"var(--blue)" };
  const alertBg    = { critical:"var(--redBg)", warn:"var(--yellowBg)", info:"var(--blueBg)" };
  const PERIODS = [{id:"daily",label:"Daily"},{id:"weekly",label:"Weekly"},{id:"monthly",label:"Monthly"},{id:"quarterly",label:"Quarterly"},{id:"annual",label:"Annual"}];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">CFO Insights</div>
          <div className="page-subtitle">{dateRange.start} → {dateRange.end} · TorresBee Restaurant</div>
        </div>
      </div>

      {/* Scorecard */}
      <div className="card" style={{marginBottom:20}}>
        <div style={{fontFamily:"var(--font-sans)",fontSize:16,fontWeight:600,marginBottom:16,letterSpacing:"0.04em"}}>Restaurant Health Scorecard</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
          {benchmarks.map(b => {
            const status = b.good?"good":b.warn?"warn":"bad";
            const color  = status==="good"?"var(--accent)":status==="warn"?"var(--yellow)":"var(--red)";
            const pct    = b.lower ? Math.min((b.value/Math.max(b.target*1.5,1))*100,100) : Math.min((b.value/15)*100,100);
            return (
              <div key={b.name} style={{background:"var(--surface2)",borderRadius:"var(--radius2)",padding:"14px 16px",borderLeft:"3px solid "+color}}>
                <div className="flex items-center justify-between" style={{marginBottom:8}}>
                  <span style={{fontSize:11,color:"var(--text3)",fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:"0.08em"}}>{b.name}</span>
                  <span style={{fontSize:10,color,fontFamily:"var(--font-mono)",fontWeight:500}}>{status==="good"?"✓ ON TARGET":status==="warn"?"⚠ WATCH":"✗ ACTION"}</span>
                </div>
                <div className="flex items-center justify-between" style={{marginBottom:8}}>
                  <span style={{fontFamily:"var(--font-mono)",fontSize:22,fontWeight:400,color}}>{b.value.toFixed(1)}{b.unit}</span>
                  <span style={{fontSize:11,color:"var(--text3)",fontFamily:"var(--font-mono)"}}>target: {b.target}{b.unit}</span>
                </div>
                <div className="progress-bar"><div className="progress-fill" style={{width:pct+"%",background:color}}/></div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bookings Forecast (Favo Book bridge) */}
      {bookForecast && bookForecast.upcoming && bookForecast.upcoming.reservations > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
            <div>
              <div style={{ fontFamily: "var(--font-sans)", fontSize: 16, fontWeight: 600, letterSpacing: "0.04em" }}>📅 Bookings Forecast</div>
              <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                From Favo Book · next {bookForecast.window.horizon_days} days
              </div>
            </div>
            {bookForecast.projected_revenue_7d > 0 && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Projected revenue (7d)</div>
                <div className="mono" style={{ fontSize: 22, color: "var(--accent)" }}>{fmt(bookForecast.projected_revenue_7d)}</div>
              </div>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: bookForecast.avg_ticket && bookForecast.avg_ticket.value > 0 ? "repeat(4, 1fr)" : "repeat(3, 1fr)", gap: 12 }}>
            <div style={{ background: "var(--surface2)", borderRadius: "var(--radius2)", padding: "12px 14px" }}>
              <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Reservations</div>
              <div className="mono" style={{ fontSize: 18 }}>{bookForecast.upcoming.reservations}</div>
              <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>{bookForecast.upcoming.by_day.length} day{bookForecast.upcoming.by_day.length === 1 ? "" : "s"} on the books</div>
            </div>
            <div style={{ background: "var(--surface2)", borderRadius: "var(--radius2)", padding: "12px 14px" }}>
              <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Covers (7d)</div>
              <div className="mono" style={{ fontSize: 18 }}>{bookForecast.upcoming.covers_next_7d}</div>
              <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>{bookForecast.upcoming.covers} across {bookForecast.window.horizon_days}d</div>
            </div>
            {bookForecast.avg_ticket && bookForecast.avg_ticket.value > 0 && (
              <div style={{ background: "var(--surface2)", borderRadius: "var(--radius2)", padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Avg ticket (30d)</div>
                <div className="mono" style={{ fontSize: 18 }}>{fmt(bookForecast.avg_ticket.value)}</div>
                <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>over {bookForecast.avg_ticket.based_on_orders} orders</div>
              </div>
            )}
            <div style={{ background: "var(--surface2)", borderRadius: "var(--radius2)", padding: "12px 14px" }}>
              <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>No-show rate</div>
              <div className="mono" style={{ fontSize: 18, color: bookForecast.no_show.rate > 0.15 ? "var(--yellow)" : "var(--text)" }}>{(bookForecast.no_show.rate * 100).toFixed(1)}%</div>
              <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>{bookForecast.no_show.sample_size} reservation{bookForecast.no_show.sample_size === 1 ? "" : "s"} (60d)</div>
            </div>
          </div>
          {bookForecast.upcoming.by_day.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Daily breakdown</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {bookForecast.upcoming.by_day.slice(0, 14).map(d => (
                  <div key={d.date} style={{ background: "var(--surface3)", borderRadius: "var(--radius2)", padding: "6px 10px", fontSize: 11, fontFamily: "var(--font-mono)" }} title={`${d.reservations} reservation${d.reservations === 1 ? "" : "s"}`}>
                    <span style={{ color: "var(--text3)" }}>{d.date.slice(5)}</span>
                    <span style={{ color: "var(--accent)", marginLeft: 6 }}>{d.covers}c</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recurring Health */}
      {recurring.filter(r => r.status === "active").length > 0 && (() => {
        const variance = getRecurringVariance(recurring, transactions, 90);
        const missing = getMissingRecurring(recurring, transactions, new Date());
        const drifted = variance.filter(v => Math.abs(v.drift) > parseFloat(v.rule.variance_pct ?? 10));
        if (drifted.length === 0 && missing.length === 0) return null;
        return (
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 16, fontWeight: 600, marginBottom: 14, letterSpacing: "0.04em" }}>🔁 Recurring Health</div>
            {drifted.length > 0 && (
              <div style={{ marginBottom: missing.length > 0 ? 14 : 0 }}>
                <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Drift beyond tolerance ({drifted.length})</div>
                {drifted.slice(0, 5).map(v => {
                  const sev = Math.abs(v.drift) > 25 ? "critical" : "warn";
                  const color = sev === "critical" ? "var(--red)" : "var(--yellow)";
                  return (
                    <div key={v.rule.id} style={{ background: "var(--surface2)", borderLeft: `3px solid ${color}`, borderRadius: "var(--radius2)", padding: "10px 14px", marginBottom: 6 }}>
                      <div className="flex items-center justify-between">
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{v.rule.name}</div>
                        <div className="mono" style={{ fontSize: 12, color }}>{v.drift > 0 ? "+" : ""}{v.drift.toFixed(1)}%</div>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 3 }}>
                        Expected {fmt(v.expected)} · avg actual {fmt(v.avg)} · {v.count} match{v.count === 1 ? "" : "es"} (90d)
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {missing.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Expected but not seen ({missing.length})</div>
                {missing.slice(0, 5).map(m => (
                  <div key={m.rule.id} style={{ background: "var(--yellowBg)", borderLeft: "3px solid var(--yellow)", borderRadius: "var(--radius2)", padding: "10px 14px", marginBottom: 6 }}>
                    <div className="flex items-center justify-between">
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{m.rule.name}</div>
                      <div className="mono" style={{ fontSize: 12, color: "var(--yellow)" }}>{m.daysLate}d late</div>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 3 }}>
                      Expected on {m.expectedDate} · {fmt(parseFloat(m.rule.amount))} · check bank or pause the rule
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Alerts */}
      {alerts.length > 0 ? (
        <div style={{marginBottom:20}}>
          <div style={{fontFamily:"var(--font-sans)",fontSize:16,fontWeight:600,marginBottom:12,letterSpacing:"0.04em"}}>🔔 Active Alerts ({alerts.length})</div>
          {alerts.map((a,i) => (
            <div key={i} style={{background:alertBg[a.level],border:"1px solid "+alertColor[a.level]+"40",borderRadius:"var(--radius2)",padding:"14px 16px",marginBottom:10,borderLeft:"4px solid "+alertColor[a.level]}}>
              <div className="flex items-center gap-8" style={{marginBottom:6}}><span style={{fontSize:16}}>{a.icon}</span><span style={{fontFamily:"var(--font-sans)",fontWeight:700,fontSize:13,color:alertColor[a.level]}}>{a.title}</span></div>
              <div style={{fontSize:13,color:"var(--text2)",marginBottom:6}}>{a.msg}</div>
              <div style={{fontSize:12,color:"var(--text3)",fontFamily:"var(--font-mono)"}}>→ {a.action}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{background:"var(--accentBg)",border:"1px solid var(--accentBorder)",borderRadius:"var(--radius2)",padding:"14px 18px",marginBottom:20,display:"flex",gap:12,alignItems:"center"}}>
          <span style={{fontSize:20}}>✅</span>
          <div><div style={{fontFamily:"var(--font-sans)",fontWeight:700,fontSize:13,color:"var(--accent)"}}>All KPIs Within Target</div><div style={{fontSize:12,color:"var(--text2)",marginTop:2}}>No critical alerts. Keep monitoring.</div></div>
        </div>
      )}

      {/* Cash + Levers */}
      <div className="grid-2" style={{marginBottom:20}}>
        <div className="card">
          <div style={{fontFamily:"var(--font-sans)",fontSize:15,fontWeight:600,marginBottom:14,letterSpacing:"0.04em"}}>Cash Flow Forecast</div>
          {[
            {label:"Daily Burn Rate",value:fmt(burnRate),note:"expenses/day"},
            {label:"Estimated Cash",value:fmt(estimatedCash),note:"current position"},
            {label:"Runway",value:runway+" days",note:runway<60?"⚠ low":"✓ healthy",warn:runway<60},
            {label:"Break-even Revenue",value:fmt(totalExpense),note:"needed to cover costs"},
            {label:"Surplus / Deficit",value:(totalIncome>totalExpense?"+":"")+fmt(totalIncome-totalExpense),note:totalIncome>totalExpense?"surplus":"deficit",warn:totalIncome<totalExpense},
          ].map(r => (
            <div key={r.label} className="flex items-center justify-between" style={{padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
              <span style={{fontSize:12,color:"var(--text2)"}}>{r.label}</span>
              <div style={{textAlign:"right"}}><span style={{fontFamily:"var(--font-mono)",fontSize:13,color:r.warn?"var(--yellow)":"var(--accent)"}}>{r.value}</span><span style={{fontSize:10,color:"var(--text3)",fontFamily:"var(--font-mono)",marginLeft:6}}>{r.note}</span></div>
            </div>
          ))}
        </div>
        <div className="card">
          <div style={{fontFamily:"var(--font-sans)",fontSize:15,fontWeight:600,marginBottom:14,letterSpacing:"0.04em"}}>Revenue Growth Levers</div>
          {[
            {lever:"Price increase 3%",impact:fmt(totalIncome*0.03),diff:"Low",note:"minimal customer impact"},
            {lever:"Reduce food waste 20%",impact:fmt(foodCost*0.20),diff:"Medium",note:"training + systems"},
            {lever:"Add 2 covers/table/day",impact:fmt(totalIncome*0.08),diff:"Medium",note:"table turn optimization"},
            {lever:"Launch catering (5%)",impact:fmt(totalIncome*0.05),diff:"High",note:"new revenue stream"},
            {lever:"Optimize labor schedule",impact:fmt(labor*0.08),diff:"Low",note:"8% labor reduction"},
          ].map(r => (
            <div key={r.lever} className="flex items-center justify-between" style={{padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
              <div><div style={{fontSize:12,color:"var(--text2)"}}>{r.lever}</div><div style={{fontSize:10,color:"var(--text3)",fontFamily:"var(--font-mono)",marginTop:2}}>{r.note}</div></div>
              <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                <div style={{fontFamily:"var(--font-mono)",fontSize:13,color:"var(--accent)"}}>+{r.impact}</div>
                <span className={"tag "+(r.diff==="Low"?"tag-green":r.diff==="Medium"?"tag-yellow":"tag-blue")} style={{marginTop:3}}>{r.diff}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Action checklist */}
      <div className="card" style={{marginBottom:16}}>
        <div className="flex items-center justify-between" style={{marginBottom:16}}>
          <div style={{fontFamily:"var(--font-sans)",fontSize:15,fontWeight:600,letterSpacing:"0.04em"}}>CFO Action Checklist</div>
          <div className="tabs" style={{marginBottom:0}}>
            {PERIODS.map(p => <div key={p.id} className={"tab"+(period===p.id?" active":"")} onClick={()=>setPeriod(p.id)} style={{fontSize:12}}>{p.label}</div>)}
          </div>
        </div>
        {(actionItems[period]||[]).map((item,i) => (
          <div key={i} style={{display:"flex",gap:14,padding:"12px 0",borderBottom:"1px solid var(--border)"}}>
            <div style={{fontSize:22,flexShrink:0,width:32,textAlign:"center"}}>{item.icon}</div>
            <div style={{flex:1}}><div style={{fontFamily:"var(--font-sans)",fontWeight:600,fontSize:13,marginBottom:4}}>{item.title}</div><div style={{fontSize:12,color:"var(--text2)",lineHeight:1.5}}>{item.detail}</div></div>
          </div>
        ))}
      </div>

      {/* Benchmarks */}
      <div className="card">
        <div style={{fontFamily:"var(--font-sans)",fontSize:15,fontWeight:600,marginBottom:14,letterSpacing:"0.04em"}}>Industry Benchmarks — Full Service Restaurant (US)</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
          {[
            {label:"Food Cost",range:"28–35%",yours:foodCostPct.toFixed(1)+"%",ok:foodCostPct<=35},
            {label:"Labor Cost",range:"25–35%",yours:laborPct.toFixed(1)+"%",ok:laborPct<=35},
            {label:"Prime Cost",range:"55–65%",yours:primeCost.toFixed(1)+"%",ok:primeCost<=65},
            {label:"Rent",range:"5–10%",yours:rentPct.toFixed(1)+"%",ok:rentPct<=10},
            {label:"Marketing",range:"2–4%",yours:marketingPct.toFixed(1)+"%",ok:marketingPct>=1},
            {label:"Net Profit",range:"5–10%",yours:netMargin.toFixed(1)+"%",ok:netMargin>=5},
            {label:"Utilities",range:"3–5%",yours:"—",ok:true},
            {label:"Insurance",range:"1–3%",yours:totalIncome>0?((insurance/totalIncome)*100).toFixed(1)+"%":"—",ok:true},
          ].map(b => (
            <div key={b.label} style={{background:"var(--surface2)",borderRadius:"var(--radius2)",padding:"12px 14px"}}>
              <div style={{fontSize:10,color:"var(--text3)",fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>{b.label}</div>
              <div style={{fontFamily:"var(--font-mono)",fontSize:16,color:b.ok?"var(--accent)":"var(--red)"}}>{b.yours}</div>
              <div style={{fontSize:10,color:"var(--text3)",fontFamily:"var(--font-mono)",marginTop:3}}>Target: {b.range}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── PROJECTS & PROJECTIONS ───────────────────────────────────────────────────
function Projects({ transactions, projects, setProjects, saveProject, deleteProjectDB, categories = [], dateRange = {} }) {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const YEAR = new Date().getFullYear();

  const CATEGORIES_PROJ = ["Revenue Growth","Marketing","Operations","Technology","Expansion","Cost Reduction","Staff & HR","Other"];
  const IMPACT_OPTS = ["High","Medium","Low"];
  const STATUS_OPTS  = ["Idea","Planning","In Progress","On Hold","Done"];

  // projects/setProjects come from parent App state (passed as props)

  const [modal, setModal]  = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewMode, setViewMode] = useState("timeline"); // timeline | list | board
  const [filterMonth, setFilterMonth] = useState("all");

  const empty = { title:"", category:"Revenue Growth", month:new Date().getMonth()+1, year:YEAR, status:"Idea", impact:"High", investment:"", projectedRevenue:"", notes:"", cashRequired:"", roi:"" };
  const [form, setForm] = useState(empty);

  // Financials
  const isLedger = makeLedgerFilter(categories, transactions);
  const totalIncomePeriod = transactions.filter(t => t.amount > 0 && isLedger(t)).reduce((s,t) => s+t.amount, 0);
  const totalExpense      = Math.abs(transactions.filter(t => t.amount < 0 && isLedger(t)).reduce((s,t) => s+t.amount, 0));
  const net               = totalIncomePeriod - totalExpense;
  const monthlyFree       = Math.max(net * 0.3, 0); // 30% of net for projects
  const totalInvestment   = projects.reduce((s,p) => s + (parseFloat(p.investment)||0), 0);
  const totalProjRevenue  = projects.reduce((s,p) => s + (parseFloat(p.projectedRevenue)||0), 0);

  const openAdd  = () => { setEditing(null); setForm(empty); setModal(true); };
  const openEdit = (p) => { setEditing(p.id); setForm({...p}); setModal(true); };

  const save = () => {
    if (!form.title) return;
    const inv = parseFloat(form.investment)||0;
    const rev = parseFloat(form.projectedRevenue)||0;
    const roi = inv > 0 ? Math.round(((rev - inv)/inv)*100) : 0;
    const proj = { ...form, id: editing || "p_"+Date.now(), investment: inv, projectedRevenue: rev, cashRequired: inv, roi };
    setProjects(prev => editing ? prev.map(p => p.id===editing ? proj : p) : [...prev, proj]);
    if (saveProject) saveProject(proj);
    setModal(false);
  };

  const remove = (id) => { setProjects(prev => prev.filter(p => p.id !== id)); if (deleteProjectDB) deleteProjectDB(id); };

  const statusColors = { "Idea":"tag-gray", "Planning":"tag-blue", "In Progress":"tag-green", "On Hold":"tag-yellow", "Done":"tag-green" };
  const impactColors = { High:"var(--accent)", Medium:"var(--blue)", Low:"var(--text3)" };

  const filtered = filterMonth === "all" ? projects : projects.filter(p => p.month === parseInt(filterMonth));

  // Group by month for timeline
  const byMonth = {};
  MONTHS.forEach((_,i) => { byMonth[i+1] = projects.filter(p => p.month === i+1 && p.year === YEAR); });

  // Cumulative investment timeline
  const cumulativeByMonth = MONTHS.map((_,i) => {
    const m = i+1;
    return projects.filter(p => p.month <= m && p.year === YEAR).reduce((s,p) => s+(parseFloat(p.investment)||0), 0);
  });
  const maxCumul = Math.max(...cumulativeByMonth, 1);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Projects & Projections</div>
          <div className="page-subtitle">{YEAR} · Future investments based on cash flow</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openAdd}><Icon name="plus" size={13}/> New Project</button>
      </div>

      {/* Financial capacity */}
      <div className="kpi-grid" style={{gridTemplateColumns:"repeat(4,1fr)",marginBottom:20}}>
        <div className="kpi-card kpi-accent">
          <div className="kpi-label">Monthly Free Cash</div>
          <div className="kpi-value">{fmt(monthlyFree)}</div>
          <div className="kpi-delta pos">30% of net income</div>
        </div>
        <div className="kpi-card kpi-blue">
          <div className="kpi-label">Total Investment</div>
          <div className="kpi-value">{fmt(totalInvestment)}</div>
          <div className="kpi-delta" style={{color:"var(--text3)"}}>{projects.length} projects</div>
        </div>
        <div className="kpi-card kpi-yellow">
          <div className="kpi-label">Projected Revenue</div>
          <div className="kpi-value">{fmt(totalProjRevenue)}</div>
          <div className="kpi-delta pos">from all projects</div>
        </div>
        <div className="kpi-card" style={{borderTop:"2px solid var(--accent)"}}>
          <div className="kpi-label">Blended ROI</div>
          <div className="kpi-value" style={{color:totalInvestment>0&&totalProjRevenue>totalInvestment?"var(--accent)":"var(--text3)"}}>
            {totalInvestment > 0 ? Math.round(((totalProjRevenue-totalInvestment)/totalInvestment)*100)+"%" : "—"}
          </div>
          <div className="kpi-delta" style={{color:"var(--text3)"}}>net return</div>
        </div>
      </div>

      {/* View toggle + filter */}
      <div className="flex items-center gap-12 mb-16">
        <div className="tabs" style={{marginBottom:0}}>
          {["timeline","list","board"].map(v => <div key={v} className={"tab"+(viewMode===v?" active":"")} onClick={()=>setViewMode(v)} style={{fontSize:12}}>{v.charAt(0).toUpperCase()+v.slice(1)}</div>)}
        </div>
        {viewMode==="list" && (
          <select className="input" style={{maxWidth:160,fontSize:12}} value={filterMonth} onChange={e=>setFilterMonth(e.target.value)}>
            <option value="all">All Months</option>
            {MONTHS.map((m,i) => <option key={i} value={i+1}>{m} {YEAR}</option>)}
          </select>
        )}
      </div>

      {/* ── TIMELINE VIEW ── */}
      {viewMode==="timeline" && (
        <div className="card" style={{padding:"20px 24px"}}>
          <div style={{fontFamily:"var(--font-sans)",fontSize:15,fontWeight:600,marginBottom:20,letterSpacing:"0.04em"}}>{YEAR} Investment Roadmap</div>

          {/* Mini bar chart */}
          <div style={{display:"flex",gap:4,alignItems:"flex-end",height:60,marginBottom:24}}>
            {MONTHS.map((m,i) => {
              const mProjects = byMonth[i+1]||[];
              const mInvest = mProjects.reduce((s,p)=>s+(parseFloat(p.investment)||0),0);
              const h = maxCumul > 0 ? Math.max((mInvest/maxCumul)*100,mInvest>0?8:0) : 0;
              return (
                <div key={m} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                  <div style={{width:"100%",height:h+"%",background:mInvest>0?"var(--accent)":"var(--surface3)",borderRadius:"3px 3px 0 0",minHeight:mInvest>0?4:2,transition:"height 0.3s"}} title={mInvest>0?fmt(mInvest):""}/>
                  <div style={{fontSize:9,color:"var(--text3)",fontFamily:"var(--font-mono)"}}>{m}</div>
                </div>
              );
            })}
          </div>

          {/* Month lanes */}
          {MONTHS.map((m,i) => {
            const mProjects = byMonth[i+1]||[];
            if (mProjects.length === 0) return null;
            return (
              <div key={m} style={{marginBottom:20}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <div style={{width:40,height:40,borderRadius:"50%",background:"var(--accentBg)",border:"1px solid var(--accentBorder)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--accent)",fontWeight:500}}>{m}</span>
                  </div>
                  <div style={{flex:1,height:1,background:"var(--border)"}}/>
                  <span style={{fontSize:11,color:"var(--text3)",fontFamily:"var(--font-mono)"}}>{mProjects.length} project{mProjects.length>1?"s":""} · {fmt(mProjects.reduce((s,p)=>s+(parseFloat(p.investment)||0),0))}</span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:10,paddingLeft:50}}>
                  {mProjects.map(p => (
                    <div key={p.id} style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--radius2)",padding:"14px 16px",borderLeft:"3px solid "+impactColors[p.impact]}}>
                      <div className="flex items-center justify-between" style={{marginBottom:8}}>
                        <div style={{fontFamily:"var(--font-sans)",fontWeight:600,fontSize:13}}>{p.title}</div>
                        <span className={"tag "+statusColors[p.status]} style={{fontSize:9}}>{p.status}</span>
                      </div>
                      <div style={{fontSize:11,color:"var(--text3)",fontFamily:"var(--font-mono)",marginBottom:10}}>{p.category}</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                        <div style={{background:"var(--surface3)",borderRadius:4,padding:"6px 8px"}}>
                          <div style={{fontSize:9,color:"var(--text3)",fontFamily:"var(--font-mono)",marginBottom:2}}>INVEST</div>
                          <div style={{fontFamily:"var(--font-mono)",fontSize:13,color:"var(--red)"}}>{fmt(p.investment)}</div>
                        </div>
                        <div style={{background:"var(--surface3)",borderRadius:4,padding:"6px 8px"}}>
                          <div style={{fontSize:9,color:"var(--text3)",fontFamily:"var(--font-mono)",marginBottom:2}}>PROJ REV</div>
                          <div style={{fontFamily:"var(--font-mono)",fontSize:13,color:"var(--accent)"}}>{p.projectedRevenue>0?fmt(p.projectedRevenue):"—"}</div>
                        </div>
                      </div>
                      {p.notes && <div style={{fontSize:11,color:"var(--text3)",marginTop:10,lineHeight:1.5}}>{p.notes}</div>}
                      <div className="flex gap-8" style={{marginTop:10}}>
                        <button className="btn btn-ghost btn-sm" style={{padding:"3px 8px",fontSize:11}} onClick={()=>openEdit(p)}><Icon name="edit" size={11}/></button>
                        <button className="btn btn-ghost btn-sm" style={{padding:"3px 8px",fontSize:11,color:"var(--red)"}} onClick={()=>remove(p.id)}><Icon name="trash" size={11}/></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {projects.length === 0 && (
            <div className="empty"><div className="empty-icon">🚀</div><div className="empty-title">No projects yet</div><div className="empty-sub">Add your first project to start planning</div></div>
          )}
        </div>
      )}

      {/* ── LIST VIEW ── */}
      {viewMode==="list" && (
        <div className="card" style={{padding:0}}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Project</th><th>Category</th><th>Month</th><th>Status</th><th>Impact</th><th style={{textAlign:"right"}}>Investment</th><th style={{textAlign:"right"}}>Proj Revenue</th><th style={{textAlign:"right"}}>ROI</th><th/></tr></thead>
              <tbody>
                {filtered.length===0 ? <tr><td colSpan={9}><div className="empty" style={{padding:40}}><div className="empty-icon">📋</div><div className="empty-title">No projects</div></div></td></tr>
                : filtered.sort((a,b)=>a.month-b.month).map(p => (
                  <tr key={p.id}>
                    <td><div style={{fontWeight:500,fontSize:13}}>{p.title}</div>{p.notes&&<div style={{fontSize:11,color:"var(--text3)",marginTop:2,maxWidth:240,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.notes}</div>}</td>
                    <td><span className="tag tag-gray" style={{fontSize:10}}>{p.category}</span></td>
                    <td className="mono" style={{color:"var(--text3)",fontSize:12}}>{MONTHS[p.month-1]} {p.year}</td>
                    <td><span className={"tag "+statusColors[p.status]}>{p.status}</span></td>
                    <td><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:impactColors[p.impact],fontWeight:500}}>{p.impact}</span></td>
                    <td className="text-right"><span className="mono" style={{color:"var(--red)"}}>{fmt(p.investment)}</span></td>
                    <td className="text-right"><span className="mono" style={{color:"var(--accent)"}}>{p.projectedRevenue>0?fmt(p.projectedRevenue):"—"}</span></td>
                    <td className="text-right"><span className="mono" style={{color:p.roi>0?"var(--accent)":"var(--text3)"}}>{p.roi>0?p.roi+"%":"—"}</span></td>
                    <td>
                      <div className="flex gap-8">
                        <button className="btn btn-ghost btn-sm" style={{padding:"3px 6px"}} onClick={()=>openEdit(p)}><Icon name="edit" size={12}/></button>
                        <button className="btn btn-ghost btn-sm" style={{padding:"3px 6px",color:"var(--red)"}} onClick={()=>remove(p.id)}><Icon name="trash" size={12}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── BOARD VIEW ── */}
      {viewMode==="board" && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:14}}>
          {STATUS_OPTS.map(status => {
            const statusProjects = projects.filter(p => p.status===status);
            return (
              <div key={status}>
                <div style={{fontFamily:"var(--font-mono)",fontSize:10,textTransform:"uppercase",letterSpacing:"0.12em",color:"var(--text3)",marginBottom:10,padding:"0 4px"}}>{status} · {statusProjects.length}</div>
                {statusProjects.map(p => (
                  <div key={p.id} style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--radius2)",padding:"12px 14px",marginBottom:8,cursor:"pointer",borderLeft:"3px solid "+impactColors[p.impact]}} onClick={()=>openEdit(p)}>
                    <div style={{fontFamily:"var(--font-sans)",fontWeight:600,fontSize:12,marginBottom:6}}>{p.title}</div>
                    <div style={{fontSize:10,color:"var(--text3)",fontFamily:"var(--font-mono)",marginBottom:8}}>{MONTHS[p.month-1]} · {p.category}</div>
                    <div className="flex items-center justify-between">
                      <span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--red)"}}>{fmt(p.investment)}</span>
                      {p.projectedRevenue>0&&<span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--accent)"}}>+{fmt(p.projectedRevenue)}</span>}
                    </div>
                  </div>
                ))}
                {statusProjects.length===0&&<div style={{border:"1px dashed var(--border)",borderRadius:"var(--radius2)",padding:"20px",textAlign:"center",fontSize:11,color:"var(--text3)",fontFamily:"var(--font-mono)"}}>empty</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Cash availability note */}
      <div className="card" style={{marginTop:16,background:"var(--surface2)"}}>
        <div className="flex items-center gap-12">
          <Icon name="info" size={18} color="var(--accent)"/>
          <div>
            <div style={{fontFamily:"var(--font-sans)",fontWeight:600,fontSize:13,color:"var(--accent)"}}>Cash Availability Analysis</div>
            <div style={{fontSize:12,color:"var(--text2)",marginTop:4}}>
              Based on current net income of <strong style={{color:"var(--accent)"}}>{fmt(net)}</strong>, you have approximately <strong style={{color:"var(--accent)"}}>{fmt(monthlyFree)}/month</strong> available for investments (30% of net).
              Total planned investment of <strong style={{color:totalInvestment>monthlyFree*12?"var(--red)":"var(--accent)"}}>{fmt(totalInvestment)}</strong> {totalInvestment>monthlyFree*12?"exceeds":"is within"} your 12-month capacity of <strong style={{color:"var(--accent)"}}>{fmt(monthlyFree*12)}</strong>.
            </div>
          </div>
        </div>
      </div>

      {/* ── MODAL ── */}
      {modal && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setModal(false)}>
          <div className="modal" style={{maxWidth:560}}>
            <div className="modal-header">
              <div className="modal-title">{editing?"Edit Project":"New Project"}</div>
              <button className="btn btn-ghost" style={{padding:4}} onClick={()=>setModal(false)}><Icon name="close" size={16}/></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="label">Project Title</label>
                <input className="input" placeholder="e.g. Launch Catering Service" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}/>
              </div>
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="label">Category</label>
                  <select className="input" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                    {CATEGORIES_PROJ.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Impact</label>
                  <select className="input" value={form.impact} onChange={e=>setForm(f=>({...f,impact:e.target.value}))}>
                    {IMPACT_OPTS.map(o=><option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="label">Target Month</label>
                  <select className="input" value={form.month} onChange={e=>setForm(f=>({...f,month:parseInt(e.target.value)}))}>
                    {MONTHS.map((m,i)=><option key={i} value={i+1}>{m} {YEAR}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Status</label>
                  <select className="input" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                    {STATUS_OPTS.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="label">Investment Required ($)</label>
                  <input type="number" className="input" placeholder="0.00" value={form.investment} onChange={e=>setForm(f=>({...f,investment:e.target.value}))}/>
                </div>
                <div className="form-group">
                  <label className="label">Projected Monthly Revenue ($)</label>
                  <input type="number" className="input" placeholder="0.00" value={form.projectedRevenue} onChange={e=>setForm(f=>({...f,projectedRevenue:e.target.value}))}/>
                </div>
              </div>
              <div className="form-group">
                <label className="label">Notes & Strategy</label>
                <textarea className="input" rows={3} placeholder="What's the plan? Who's responsible? What resources are needed?" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{resize:"vertical"}}/>
              </div>
              {form.investment > 0 && form.projectedRevenue > 0 && (
                <div style={{background:"var(--accentBg)",border:"1px solid var(--accentBorder)",borderRadius:"var(--radius2)",padding:"12px 14px"}}>
                  <div style={{fontSize:12,color:"var(--text2)"}}>
                    Expected ROI: <strong style={{color:"var(--accent)"}}>{Math.round(((parseFloat(form.projectedRevenue)-parseFloat(form.investment))/parseFloat(form.investment))*100)}%</strong>
                    {" · "}Payback: <strong style={{color:"var(--accent)"}}>{parseFloat(form.projectedRevenue)>0?Math.ceil(parseFloat(form.investment)/parseFloat(form.projectedRevenue))+" months":"—"}</strong>
                    {" · "}Available cash: <strong style={{color:monthlyFree>=parseFloat(form.investment)?"var(--accent)":"var(--red)"}}>{monthlyFree>=parseFloat(form.investment)?"✓ within budget":"⚠ exceeds monthly free cash"}</strong>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!form.title}>{editing?"Save":"Add Project"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── RECURRING ────────────────────────────────────────────────────────────────
const CADENCE_LABELS = {
  monthly: "Monthly",
  biweekly: "Biweekly (every 2 weeks)",
  weekly: "Weekly",
  quarterly: "Quarterly",
  annual: "Annual",
};
const DOW_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function monthlyEquivalent(amount, cadence) {
  const a = parseFloat(amount) || 0;
  switch (cadence) {
    case "monthly":   return a;
    case "biweekly":  return a * (26 / 12);
    case "weekly":    return a * (52 / 12);
    case "quarterly": return a / 3;
    case "annual":    return a / 12;
    default:          return a;
  }
}

function projectRecurring(rules, months = 3) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const target = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    const monthEnd = new Date(target.getFullYear(), target.getMonth() + 1, 0);
    const monthKey = target.toISOString().slice(0, 7);
    let outflow = 0, inflow = 0;
    const items = [];
    for (const r of rules || []) {
      if (r.status !== "active") continue;
      if (r.start_date && new Date(r.start_date) > monthEnd) continue;
      if (r.end_date && new Date(r.end_date) < target) continue;
      const m = monthlyEquivalent(parseFloat(r.amount) || 0, r.cadence);
      if (m < 0) outflow += m; else inflow += m;
      items.push({ name: r.name, amount: m, categoryId: r.category_id });
    }
    out.push({ monthKey, label: ctryMonth(target), outflow, inflow, net: inflow + outflow, items });
  }
  return out;
}

function getRecurringVariance(rules, transactions, windowDays = 90) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  const drifts = [];
  for (const r of rules || []) {
    if (r.status !== "active") continue;
    const linked = transactions.filter(t => t.recurring_id === r.id && t.date >= cutoffStr);
    if (linked.length === 0) continue;
    const expected = Math.abs(parseFloat(r.amount) || 0);
    if (expected === 0) continue;
    const avg = linked.reduce((s, t) => s + Math.abs(parseFloat(t.amount) || 0), 0) / linked.length;
    const drift = ((avg - expected) / expected) * 100;
    drifts.push({ rule: r, expected, avg, drift, count: linked.length });
  }
  return drifts.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
}

function getMissingRecurring(rules, transactions, asOf = new Date()) {
  const missing = [];
  for (const r of rules || []) {
    if (r.status !== "active") continue;
    if (r.cadence !== "monthly" || r.day_of_month == null) continue;
    const expectedDate = new Date(asOf.getFullYear(), asOf.getMonth(), r.day_of_month);
    if (asOf < expectedDate) continue;
    const daysLate = Math.floor((asOf - expectedDate) / (1000 * 60 * 60 * 24));
    if (daysLate <= 5) continue;
    const monthKey = expectedDate.toISOString().slice(0, 7);
    const found = transactions.find(t => t.recurring_id === r.id && t.date.startsWith(monthKey));
    if (!found) missing.push({ rule: r, expectedDate: expectedDate.toISOString().slice(0, 10), daysLate });
  }
  return missing;
}

function ruleToFormShape(r) {
  return {
    id: r.id,
    name: r.name,
    vendorPattern: r.vendor_pattern,
    categoryId: r.category_id,
    account: r.account,
    amount: r.amount,
    variancePct: r.variance_pct,
    cadence: r.cadence,
    dayOfMonth: r.day_of_month,
    dayOfWeek: r.day_of_week,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
    notes: r.notes,
  };
}

function Recurring({ recurring, setRecurring, saveRecurring, deleteR, categories, transactions, showToast }) {
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const blankForm = {
    name: "",
    vendorPattern: "",
    categoryId: "",
    account: "",
    amount: "",
    variancePct: 10,
    cadence: "monthly",
    dayOfMonth: 1,
    dayOfWeek: 1,
    startDate: today(),
    endDate: "",
    status: "active",
    notes: "",
  };
  const [form, setForm] = useState(blankForm);
  const [filterStatus, setFilterStatus] = useState("all");

  const filtered = recurring.filter(r => filterStatus === "all" ? true : r.status === filterStatus);
  const active = recurring.filter(r => r.status === "active");
  const monthlyOutflow = active.reduce((s, r) => {
    const m = monthlyEquivalent(r.amount, r.cadence);
    return s + (m < 0 ? m : 0);
  }, 0);
  const monthlyInflow = active.reduce((s, r) => {
    const m = monthlyEquivalent(r.amount, r.cadence);
    return s + (m > 0 ? m : 0);
  }, 0);

  const openAdd = () => { setEditing(null); setForm(blankForm); setModal(true); };
  const openEdit = (r) => {
    setEditing(r.id);
    setForm({
      name: r.name || "",
      vendorPattern: r.vendor_pattern || "",
      categoryId: r.category_id || "",
      account: r.account || "",
      amount: Math.abs(parseFloat(r.amount) || 0).toString(),
      variancePct: r.variance_pct ?? 10,
      cadence: r.cadence || "monthly",
      dayOfMonth: r.day_of_month ?? 1,
      dayOfWeek: r.day_of_week ?? 1,
      startDate: r.start_date || today(),
      endDate: r.end_date || "",
      status: r.status || "active",
      notes: r.notes || "",
    });
    setModal(true);
  };

  const save = () => {
    if (!form.name.trim() || !form.vendorPattern.trim() || !form.amount) {
      showToast("Name, vendor pattern, and amount are required", "error");
      return;
    }
    const cat = categories.find(c => c.id === form.categoryId);
    const isIncome = cat && cat.type === "income";
    const signedAmount = isIncome ? Math.abs(parseFloat(form.amount)) : -Math.abs(parseFloat(form.amount));
    const monthlyish = form.cadence === "monthly" || form.cadence === "quarterly" || form.cadence === "annual";
    const weeklyish = form.cadence === "weekly" || form.cadence === "biweekly";

    const row = {
      id: editing || undefined,
      name: form.name.trim(),
      vendorPattern: form.vendorPattern.trim().toUpperCase(),
      categoryId: form.categoryId || null,
      account: form.account.trim(),
      amount: signedAmount,
      variancePct: parseFloat(form.variancePct) || 10,
      cadence: form.cadence,
      dayOfMonth: monthlyish ? parseInt(form.dayOfMonth) || 1 : null,
      dayOfWeek: weeklyish ? parseInt(form.dayOfWeek) : null,
      startDate: form.startDate,
      endDate: form.endDate || null,
      status: form.status,
      notes: form.notes,
    };

    const dbShape = {
      name: row.name,
      vendor_pattern: row.vendorPattern,
      category_id: row.categoryId,
      account: row.account,
      amount: row.amount,
      variance_pct: row.variancePct,
      cadence: row.cadence,
      day_of_month: row.dayOfMonth,
      day_of_week: row.dayOfWeek,
      start_date: row.startDate,
      end_date: row.endDate,
      status: row.status,
      notes: row.notes,
    };

    if (editing) {
      setRecurring(prev => prev.map(r => r.id === editing ? { ...r, ...dbShape } : r));
      showToast("Recurring rule updated", "success");
    } else {
      const tempId = "rec_" + Date.now();
      setRecurring(prev => [...prev, { id: tempId, ...dbShape }]);
      showToast("Recurring rule created", "success");
    }
    if (saveRecurring) saveRecurring(row);
    setModal(false);
  };

  const remove = (r) => {
    if (!window.confirm(`Delete rule "${r.name}"? Linked transactions keep their categories but lose the link.`)) return;
    if (deleteR) deleteR(r.id);
    showToast("Recurring rule deleted", "info");
  };

  const toggleStatus = (r) => {
    const newStatus = r.status === "active" ? "paused" : "active";
    setRecurring(prev => prev.map(x => x.id === r.id ? { ...x, status: newStatus } : x));
    if (saveRecurring) saveRecurring({ ...ruleToFormShape(r), status: newStatus });
  };

  // Per-rule stats: hits in current transaction list, last seen date, drift
  const ruleStats = (r) => {
    const linked = transactions.filter(t => t.recurring_id === r.id);
    const lastSeen = linked.length > 0 ? linked.map(t => t.date).sort().slice(-1)[0] : null;
    const expected = Math.abs(parseFloat(r.amount) || 0);
    const lastAmt = linked.length > 0 ? Math.abs(parseFloat(linked.sort((a, b) => a.date.localeCompare(b.date)).slice(-1)[0].amount) || 0) : null;
    const drift = lastAmt != null && expected > 0 ? ((lastAmt - expected) / expected) * 100 : null;
    return { count: linked.length, lastSeen, drift };
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Recurring</div>
          <div className="page-subtitle">{active.length} active · {recurring.length} total · used to forecast cash and auto-match imports</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openAdd}><Icon name="plus" size={13} /> New Rule</button>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="kpi-card">
          <div className="kpi-label">Monthly outflow (recurring)</div>
          <div className="kpi-value" style={{ color: "var(--red)" }}>{fmt(monthlyOutflow)}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>fixed expenses commitment</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Monthly inflow (recurring)</div>
          <div className="kpi-value" style={{ color: "var(--accent)" }}>{fmt(monthlyInflow)}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>predictable revenue</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Net recurring</div>
          <div className="kpi-value">{fmt(monthlyInflow + monthlyOutflow)}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>monthly baseline</div>
        </div>
      </div>

      <div className="flex items-center gap-12" style={{ marginBottom: 14 }}>
        {["all", "active", "paused", "ended"].map(s => (
          <button key={s} className={`btn btn-sm ${filterStatus === s ? "btn-outline" : "btn-ghost"}`} style={filterStatus === s ? { borderColor: "var(--accentBorder)", color: "var(--accent)" } : {}} onClick={() => setFilterStatus(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)} {s !== "all" && `(${recurring.filter(r => r.status === s).length})`}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Pattern</th><th>Category</th><th>Cadence</th><th style={{ textAlign: "right" }}>Expected</th><th>Last seen</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8}><div className="empty"><div className="empty-icon">🔁</div><div className="empty-title">No recurring rules yet</div><div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>Add rent, payroll, insurance, or SaaS subscriptions to auto-match imports and forecast cash flow.</div></div></td></tr>
              ) : filtered.map(r => {
                const cat = categories.find(c => c.id === r.category_id);
                const stats = ruleStats(r);
                const driftWarn = stats.drift != null && Math.abs(stats.drift) > parseFloat(r.variance_pct ?? 10);
                return (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{r.name}</div>
                      {r.notes && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{r.notes}</div>}
                    </td>
                    <td className="mono" style={{ fontSize: 11, color: "var(--text2)" }}>{r.vendor_pattern}</td>
                    <td>{cat && <span className="tag" style={{ background: cat.color + "18", color: cat.color, border: `1px solid ${cat.color}30` }}>{cat.name}</span>}</td>
                    <td className="mono" style={{ fontSize: 11, color: "var(--text2)" }}>
                      {CADENCE_LABELS[r.cadence] || r.cadence}
                      {r.day_of_month && <div style={{ color: "var(--text3)", fontSize: 10 }}>day {r.day_of_month}</div>}
                      {r.day_of_week != null && <div style={{ color: "var(--text3)", fontSize: 10 }}>{DOW_LABELS[r.day_of_week]}</div>}
                    </td>
                    <td className={parseFloat(r.amount) >= 0 ? "amount-pos text-right" : "amount-neg text-right"}>
                      {fmt(parseFloat(r.amount))}
                      <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>±{r.variance_pct}%</div>
                    </td>
                    <td className="mono" style={{ fontSize: 11, color: "var(--text2)" }}>
                      {stats.lastSeen ? fmtDate(stats.lastSeen) : "—"}
                      <div style={{ fontSize: 10, color: driftWarn ? "var(--yellow)" : "var(--text3)" }}>
                        {stats.count} matches{stats.drift != null ? ` · ${stats.drift > 0 ? "+" : ""}${stats.drift.toFixed(1)}%` : ""}
                      </div>
                    </td>
                    <td>
                      <span className="tag" style={{
                        background: r.status === "active" ? "var(--accentBg)" : "var(--surface3)",
                        color: r.status === "active" ? "var(--accent)" : "var(--text3)",
                        border: `1px solid ${r.status === "active" ? "var(--accentBorder)" : "var(--border)"}`,
                        fontSize: 10,
                      }}>{r.status}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 2 }}>
                        <button className="btn btn-ghost" style={{ padding: "4px 6px" }} onClick={() => toggleStatus(r)} title={r.status === "active" ? "Pause" : "Activate"}>
                          {r.status === "active" ? "⏸" : "▶"}
                        </button>
                        <button className="btn btn-ghost" style={{ padding: "4px 6px" }} onClick={() => openEdit(r)}><Icon name="edit" size={13} /></button>
                        <button className="btn btn-ghost" style={{ padding: "4px 6px", color: "var(--red)" }} onClick={() => remove(r)}><Icon name="trash" size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(false)}>
          <div className="modal" style={{ maxWidth: 580 }}>
            <div className="modal-header">
              <div className="modal-title">{editing ? "Edit Recurring Rule" : "New Recurring Rule"}</div>
              <button className="btn btn-ghost" style={{ padding: 4 }} onClick={() => setModal(false)}><Icon name="close" size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="label">Name</label>
                <input className="input" placeholder="e.g. Rent · TPC Tower" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">Vendor pattern (substring matched against descriptions)</label>
                <input className="input" placeholder="e.g. TPC TOWER, GUSTO PAYROLL" value={form.vendorPattern} onChange={e => setForm(f => ({ ...f, vendorPattern: e.target.value }))} />
              </div>
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="label">Category</label>
                  <select className="input" value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}>
                    <option value="">— None —</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Account</label>
                  <input className="input" placeholder="e.g. Checking ••4821" value={form.account} onChange={e => setForm(f => ({ ...f, account: e.target.value }))} />
                </div>
              </div>
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="label">Expected amount ($)</label>
                  <input type="number" step="0.01" className="input" placeholder="5000.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="label">Tolerance (±%)</label>
                  <input type="number" step="1" className="input" value={form.variancePct} onChange={e => setForm(f => ({ ...f, variancePct: e.target.value }))} />
                </div>
              </div>
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="label">Cadence</label>
                  <select className="input" value={form.cadence} onChange={e => setForm(f => ({ ...f, cadence: e.target.value }))}>
                    {Object.entries(CADENCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  {(form.cadence === "monthly" || form.cadence === "quarterly" || form.cadence === "annual") && (
                    <>
                      <label className="label">Day of month</label>
                      <input type="number" min="1" max="31" className="input" value={form.dayOfMonth} onChange={e => setForm(f => ({ ...f, dayOfMonth: e.target.value }))} />
                    </>
                  )}
                  {(form.cadence === "weekly" || form.cadence === "biweekly") && (
                    <>
                      <label className="label">Day of week</label>
                      <select className="input" value={form.dayOfWeek} onChange={e => setForm(f => ({ ...f, dayOfWeek: e.target.value }))}>
                        {DOW_LABELS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                      </select>
                    </>
                  )}
                </div>
              </div>
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="label">Start date</label>
                  <input type="date" className="input" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="label">End date (optional)</label>
                  <input type="date" className="input" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label className="label">Status</label>
                <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="ended">Ended</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">Notes</label>
                <textarea className="input" rows={2} placeholder="Optional context" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ resize: "vertical" }} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!form.name || !form.vendorPattern || !form.amount}>{editing ? "Save" : "Create"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── BANK ACCOUNTS ────────────────────────────────────────────────────────────
const ACCOUNT_TYPE_META = {
  checking: { label: "Checking",    liquid: true,  liability: false, color: "var(--accent)" },
  savings:  { label: "Savings",     liquid: true,  liability: false, color: "var(--blue)" },
  credit:   { label: "Credit Card", liquid: false, liability: true,  color: "var(--red)" },
  cash:     { label: "Cash",        liquid: true,  liability: false, color: "var(--accent)" },
  loan:     { label: "Loan",        liquid: false, liability: true,  color: "var(--red)" },
  other:    { label: "Other",       liquid: false, liability: false, color: "var(--text2)" },
};

function calculateAccountBalance(account, transactions) {
  if (!account) return 0;
  // Plaid-synced accounts (id prefix plaid_acct_) carry the authoritative live
  // balance in opening_balance, refreshed every sync. We don't add activity on
  // top because the loaded transactions are limited to the active date range,
  // which would otherwise make the balance wrong.
  if (account.id && String(account.id).startsWith("plaid_acct_")) return parseFloat(account.opening_balance) || 0;
  const opening = parseFloat(account.opening_balance) || 0;
  const linked = transactions.filter(t => t.account_id === account.id || (t.account && t.account === account.name));
  const sum = linked.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
  return opening + sum;
}

function accountTransactionCount(account, transactions) {
  if (!account) return 0;
  return transactions.filter(t => t.account_id === account.id || (t.account && t.account === account.name)).length;
}

function BankAccounts({ accounts, setAccounts, saveBankAccount, deleteAcc, transactions, showToast }) {
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const blankForm = {
    name: "",
    type: "checking",
    institution: "",
    openingBalance: "0",
    openingDate: today(),
    creditLimit: "",
    status: "active",
    notes: "",
  };
  const [form, setForm] = useState(blankForm);
  const [filterStatus, setFilterStatus] = useState("active");

  const filtered = accounts.filter(a => filterStatus === "all" ? true : a.status === filterStatus);
  const active = accounts.filter(a => a.status === "active");
  const liquid = active.filter(a => ACCOUNT_TYPE_META[a.type]?.liquid).reduce((s, a) => s + calculateAccountBalance(a, transactions), 0);
  const liabilities = active.filter(a => ACCOUNT_TYPE_META[a.type]?.liability).reduce((s, a) => s + calculateAccountBalance(a, transactions), 0);
  const netCash = liquid + liabilities;

  const openAdd = () => { setEditing(null); setForm(blankForm); setModal(true); };
  const openEdit = (a) => {
    setEditing(a.id);
    setForm({
      name: a.name || "",
      type: a.type || "checking",
      institution: a.institution || "",
      openingBalance: (parseFloat(a.opening_balance) || 0).toString(),
      openingDate: a.opening_date || today(),
      creditLimit: a.credit_limit != null ? String(a.credit_limit) : "",
      status: a.status || "active",
      notes: a.notes || "",
    });
    setModal(true);
  };

  const save = () => {
    if (!form.name.trim()) { showToast("Account name is required", "error"); return; }
    const row = {
      id: editing || undefined,
      name: form.name.trim(),
      type: form.type,
      institution: form.institution.trim(),
      openingBalance: parseFloat(form.openingBalance) || 0,
      openingDate: form.openingDate,
      creditLimit: form.creditLimit !== "" ? parseFloat(form.creditLimit) : null,
      status: form.status,
      notes: form.notes,
    };
    const dbShape = {
      name: row.name,
      type: row.type,
      institution: row.institution,
      opening_balance: row.openingBalance,
      opening_date: row.openingDate,
      credit_limit: row.creditLimit,
      status: row.status,
      notes: row.notes,
    };
    if (editing) {
      setAccounts(prev => prev.map(a => a.id === editing ? { ...a, ...dbShape } : a));
      showToast("Account updated", "success");
    } else {
      const tempId = "acc_" + Date.now();
      setAccounts(prev => [...prev, { id: tempId, ...dbShape }]);
      showToast("Account created", "success");
    }
    if (saveBankAccount) saveBankAccount(row);
    setModal(false);
  };

  const remove = (a) => {
    const linked = accountTransactionCount(a, transactions);
    if (linked > 0) {
      if (!window.confirm(`Account "${a.name}" has ${linked} linked transactions. Deleting unlinks them (account_id reset to null) but keeps the transactions. Proceed?`)) return;
    } else {
      if (!window.confirm(`Delete account "${a.name}"?`)) return;
    }
    if (deleteAcc) deleteAcc(a.id);
    showToast("Account deleted", "info");
  };

  const archive = (a) => {
    const newStatus = a.status === "active" ? "archived" : "active";
    setAccounts(prev => prev.map(x => x.id === a.id ? { ...x, status: newStatus } : x));
    if (saveBankAccount) saveBankAccount({
      id: a.id,
      name: a.name,
      type: a.type,
      institution: a.institution,
      openingBalance: a.opening_balance,
      openingDate: a.opening_date,
      creditLimit: a.credit_limit,
      status: newStatus,
      notes: a.notes,
    });
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Bank Accounts</div>
          <div className="page-subtitle">{active.length} active · cash position consolidated across all accounts</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openAdd}><Icon name="plus" size={13} /> New Account</button>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="kpi-card">
          <div className="kpi-label">Liquid assets</div>
          <div className="kpi-value" style={{ color: "var(--accent)" }}>{fmt(liquid)}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>checking + savings + cash</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Credit & loans</div>
          <div className="kpi-value" style={{ color: liabilities < 0 ? "var(--red)" : "var(--text)" }}>{fmt(liabilities)}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>outstanding balances (negative = owed)</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Net cash position</div>
          <div className="kpi-value" style={{ color: netCash >= 0 ? "var(--accent)" : "var(--red)" }}>{fmt(netCash)}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>liquid − debts</div>
        </div>
      </div>

      <div className="flex items-center gap-12" style={{ marginBottom: 14 }}>
        {["all", "active", "archived"].map(s => (
          <button key={s} className={`btn btn-sm ${filterStatus === s ? "btn-outline" : "btn-ghost"}`} style={filterStatus === s ? { borderColor: "var(--accentBorder)", color: "var(--accent)" } : {}} onClick={() => setFilterStatus(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)} {s !== "all" && `(${accounts.filter(a => a.status === s).length})`}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Account</th><th>Type</th><th>Institution</th><th style={{ textAlign: "right" }}>Balance</th><th style={{ textAlign: "right" }}>Activity</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7}><div className="empty"><div className="empty-icon">🏦</div><div className="empty-title">No accounts yet</div><div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>Add Checking, Savings, Credit Cards, and Loans to track cash position and utilization across all accounts.</div></div></td></tr>
              ) : filtered.map(a => {
                const meta = ACCOUNT_TYPE_META[a.type] || ACCOUNT_TYPE_META.other;
                const balance = calculateAccountBalance(a, transactions);
                const activity = accountTransactionCount(a, transactions);
                const utilization = (a.type === "credit" && a.credit_limit && parseFloat(a.credit_limit) > 0)
                  ? (Math.abs(Math.min(balance, 0)) / parseFloat(a.credit_limit)) * 100
                  : null;
                return (
                  <tr key={a.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{a.name}</div>
                      {a.notes && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{a.notes}</div>}
                    </td>
                    <td>
                      <span className="tag" style={{ background: meta.color + "18", color: meta.color, border: `1px solid ${meta.color}30`, fontSize: 11 }}>{meta.label}</span>
                    </td>
                    <td className="mono" style={{ fontSize: 11, color: "var(--text2)" }}>{a.institution || "—"}</td>
                    <td className={balance >= 0 ? "amount-pos text-right" : "amount-neg text-right"}>
                      {fmt(balance)}
                      <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>opened {fmtDate(a.opening_date)}</div>
                    </td>
                    <td className="mono text-right" style={{ fontSize: 11, color: "var(--text2)" }}>
                      {activity} txn{activity === 1 ? "" : "s"}
                      {utilization != null && (
                        <div style={{ fontSize: 10, color: utilization > 70 ? "var(--red)" : utilization > 40 ? "var(--yellow)" : "var(--text3)" }}>
                          {utilization.toFixed(0)}% used
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="tag" style={{
                        background: a.status === "active" ? "var(--accentBg)" : "var(--surface3)",
                        color: a.status === "active" ? "var(--accent)" : "var(--text3)",
                        border: `1px solid ${a.status === "active" ? "var(--accentBorder)" : "var(--border)"}`,
                        fontSize: 10,
                      }}>{a.status}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 2 }}>
                        <button className="btn btn-ghost" style={{ padding: "4px 6px" }} onClick={() => archive(a)} title={a.status === "active" ? "Archive" : "Restore"}>
                          {a.status === "active" ? "📁" : "↺"}
                        </button>
                        <button className="btn btn-ghost" style={{ padding: "4px 6px" }} onClick={() => openEdit(a)}><Icon name="edit" size={13} /></button>
                        <button className="btn btn-ghost" style={{ padding: "4px 6px", color: "var(--red)" }} onClick={() => remove(a)}><Icon name="trash" size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(false)}>
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <div className="modal-title">{editing ? "Edit Account" : "New Bank Account"}</div>
              <button className="btn btn-ghost" style={{ padding: 4 }} onClick={() => setModal(false)}><Icon name="close" size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="label">Display name</label>
                <input className="input" placeholder="e.g. Checking ••4821" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="label">Type</label>
                  <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                    {Object.entries(ACCOUNT_TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Institution</label>
                  <input className="input" placeholder="e.g. Bank of America" value={form.institution} onChange={e => setForm(f => ({ ...f, institution: e.target.value }))} />
                </div>
              </div>
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="label">Opening balance ($)</label>
                  <input type="number" step="0.01" className="input" value={form.openingBalance} onChange={e => setForm(f => ({ ...f, openingBalance: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="label">Opening date</label>
                  <input type="date" className="input" value={form.openingDate} onChange={e => setForm(f => ({ ...f, openingDate: e.target.value }))} />
                </div>
              </div>
              {form.type === "credit" && (
                <div className="form-group">
                  <label className="label">Credit limit ($)</label>
                  <input type="number" step="0.01" className="input" placeholder="optional — used to compute utilization" value={form.creditLimit} onChange={e => setForm(f => ({ ...f, creditLimit: e.target.value }))} />
                </div>
              )}
              <div className="form-group">
                <label className="label">Status</label>
                <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">Notes</label>
                <textarea className="input" rows={2} placeholder="Optional context" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ resize: "vertical" }} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!form.name}>{editing ? "Save" : "Create"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TIPS ─────────────────────────────────────────────────────────────────────
// Card tips pull straight from Square Payments per (date, team_member_id).
// Cash is intentionally not tracked (Anderson's call). Pool is opt-in per day,
// equal split among the employees the operator chooses to include — typical for
// counter-service shifts where everyone deserves a cut on a busy night.

function finalTip(row) {
  if (!row) return 0;
  if (row.pool_method === "equal_split") {
    return parseFloat(row.pool_share || 0);
  }
  return parseFloat(row.card_tips || 0) + parseFloat(row.auto_grat || 0);
}

function Tips({ tipsDaily, shifts, tenantId, dateRange, onSync, showToast }) {
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [poolModal, setPoolModal] = useState(null); // { date, eligible: [{id, name, card_tips, hours}], selected: Set }

  const sync = async () => {
    setLoading(true);
    showToast("Pulling card tips from Square...", "info");
    try {
      const result = await syncSquareTips(tenantId, dateRange);
      setLastSync(new Date());
      showToast(`${result.rows_written} day-employee tip rows · ${result.employees_with_tips} employees`, "success");
      if (onSync) onSync();
    } catch (err) {
      showToast("Square Tips sync failed: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  // Filter to dateRange window for the table view (DB store keeps everything).
  const rows = tipsDaily.filter(r => r.date >= (dateRange.start || "1900-01-01") && r.date <= (dateRange.end || "2999-12-31"));

  // Group by date
  const byDate = {};
  for (const r of rows) {
    if (!byDate[r.date]) byDate[r.date] = [];
    byDate[r.date].push(r);
  }
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  // KPIs over the visible window
  const totalCard = rows.reduce((s, r) => s + parseFloat(r.card_tips || 0), 0);
  const totalAutoGrat = rows.reduce((s, r) => s + parseFloat(r.auto_grat || 0), 0);
  const totalFinal = rows.reduce((s, r) => s + finalTip(r), 0);
  const poolDays = new Set(rows.filter(r => r.pool_method === "equal_split").map(r => r.date)).size;
  const totalDays = dates.length;

  const openPool = (date) => {
    const tipsOnDate = byDate[date] || [];
    // Eligible = anyone who had tips OR a shift that day
    const tipMembers = new Map(tipsOnDate.map(r => [r.team_member_id, { id: r.team_member_id, name: r.employee_name || r.team_member_id.slice(0, 8), card_tips: parseFloat(r.card_tips || 0), auto_grat: parseFloat(r.auto_grat || 0), hours: 0 }]));
    const shiftsOnDate = (shifts || []).filter(s => s.start_at && s.start_at.slice(0, 10) === date);
    for (const s of shiftsOnDate) {
      const key = s.team_member_id || s.square_employee_id;
      if (!key) continue;
      if (!tipMembers.has(key)) tipMembers.set(key, { id: key, name: s.employee_name || key.slice(0, 8), card_tips: 0, auto_grat: 0, hours: 0 });
      const entry = tipMembers.get(key);
      entry.hours += parseFloat(s.hours || 0);
    }
    const list = [...tipMembers.values()].sort((a, b) => b.card_tips - a.card_tips);
    // Default selection: everyone who already has tips OR worked that day
    const selected = new Set(list.map(m => m.id));
    const existingPool = tipsOnDate.find(r => r.pool_method === "equal_split");
    if (existingPool && existingPool.pool_participant_count) {
      // Preserve previous selection if pool already exists
      const existingIds = new Set(tipsOnDate.filter(r => r.pool_method === "equal_split").map(r => r.team_member_id));
      selected.clear();
      existingIds.forEach(id => selected.add(id));
    }
    setPoolModal({ date, list, selected, existingPool: !!existingPool });
  };

  const togglePoolMember = (id) => {
    setPoolModal(p => {
      const s = new Set(p.selected);
      if (s.has(id)) s.delete(id); else s.add(id);
      return { ...p, selected: s };
    });
  };

  const applyPool = async (clear = false) => {
    if (!poolModal) return;
    const tipsOnDate = byDate[poolModal.date] || [];
    // Pool base = card tips + auto-gratuity for the day, so large parties don't
    // get carved out of the share.
    const total = tipsOnDate.reduce((s, r) => s + parseFloat(r.card_tips || 0) + parseFloat(r.auto_grat || 0), 0);
    const count = poolModal.selected.size;
    const share = clear || count === 0 ? 0 : round2(total / count);
    const ids = clear ? new Set() : poolModal.selected;
    // Build rows: for each member touched on this date (current tips OR newly added to pool)
    const allMemberIds = new Set([
      ...tipsOnDate.map(r => r.team_member_id),
      ...(ids || []),
    ]);
    const rowsToWrite = [...allMemberIds].map(memberId => {
      const existing = tipsOnDate.find(r => r.team_member_id === memberId);
      const listEntry = poolModal.list.find(m => m.id === memberId);
      return {
        date: poolModal.date,
        team_member_id: memberId,
        employee_name: existing?.employee_name || listEntry?.name || null,
        card_tips: existing?.card_tips || 0,
        auto_grat: existing?.auto_grat || 0,
        pool_method: clear ? "none" : (ids.has(memberId) ? "equal_split" : "none"),
        pool_share: clear ? 0 : (ids.has(memberId) ? share : 0),
        pool_participant_count: clear ? 0 : count,
        pool_total: clear ? 0 : round2(total),
      };
    });
    const result = await applyTipPool(rowsToWrite, tenantId);
    if (!result.ok) {
      showToast("Pool save failed: " + (result.error || "unknown"), "error");
      return;
    }
    showToast(clear ? `Pool cleared for ${poolModal.date}` : `Pool applied · ${fmt(total)} split among ${count} → ${fmt(share)} each`, "success");
    setPoolModal(null);
    if (onSync) onSync();
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Tips</div>
          <div className="page-subtitle">{dateRange.start} → {dateRange.end} · Card tips from Square Payments · cash not tracked</div>
        </div>
        <button
          className="btn btn-outline btn-sm"
          onClick={sync}
          disabled={loading}
          style={{ gap: 8, borderColor: "var(--accentBorder)", color: loading ? "var(--text3)" : "var(--accent)" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: loading ? "spin 1s linear infinite" : "none" }}>
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          {loading ? "Syncing..." : "Sync Tips"}
          {lastSync && <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>{ctryTime(lastSync)}</span>}
        </button>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="kpi-card">
          <div className="kpi-label">Voluntary tips</div>
          <div className="kpi-value">{fmt(totalCard)}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>card tip_money</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Auto-gratuity</div>
          <div className="kpi-value">{fmt(totalAutoGrat)}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>large party surcharge</div>
        </div>
        <div className="kpi-card kpi-yellow">
          <div className="kpi-label">Pool days</div>
          <div className="kpi-value">{poolDays}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>of {totalDays} day{totalDays === 1 ? "" : "s"}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Final (to Payroll)</div>
          <div className="kpi-value">{fmt(totalFinal)}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>after pool</div>
        </div>
      </div>

      {dates.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>💵</div>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: 18 }}>No tips synced for this window</div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>Click <strong>Sync Tips</strong> to pull from Square Payments. Each server's PIN-attributed transactions land here automatically.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Employee</th>
                  <th style={{ textAlign: "right" }}>Card tips</th>
                  <th style={{ textAlign: "right" }}>Auto-grat</th>
                  <th style={{ textAlign: "right" }}>Pool share</th>
                  <th style={{ textAlign: "right" }}>Final</th>
                  <th>Pool</th>
                </tr>
              </thead>
              <tbody>
                {dates.map(date => {
                  const dayRows = byDate[date].sort((a, b) => finalTip(b) - finalTip(a));
                  const dayCard = dayRows.reduce((s, r) => s + parseFloat(r.card_tips || 0), 0);
                  const dayAuto = dayRows.reduce((s, r) => s + parseFloat(r.auto_grat || 0), 0);
                  const dayTotal = dayCard + dayAuto;
                  const isPool = dayRows.some(r => r.pool_method === "equal_split");
                  return (
                    <Fragment key={date}>
                      <tr style={{ background: "var(--surface2)" }}>
                        <td colSpan={6} className="mono" style={{ fontWeight: 500 }}>
                          {fmtDate(date)} · <span style={{ color: "var(--text3)" }}>{fmt(dayTotal)} ({fmt(dayCard)} tip + {fmt(dayAuto)} auto-grat) · {dayRows.length} employee{dayRows.length === 1 ? "" : "s"}</span>
                        </td>
                        <td>
                          <button
                            className="btn btn-sm"
                            style={{
                              background: isPool ? "var(--yellowBg)" : "var(--accentBg)",
                              color: isPool ? "var(--yellow)" : "var(--accent)",
                              border: `1px solid ${isPool ? "var(--yellow)" : "var(--accentBorder)"}40`,
                              fontSize: 10,
                            }}
                            onClick={() => openPool(date)}
                          >
                            {isPool ? "Edit pool" : "Activate pool"}
                          </button>
                        </td>
                      </tr>
                      {dayRows.map(r => (
                        <tr key={`${date}_${r.team_member_id}`}>
                          <td className="mono" style={{ color: "var(--text3)", fontSize: 11 }}></td>
                          <td>{r.employee_name || r.team_member_id.slice(0, 8)}</td>
                          <td className="text-right mono" style={{ color: "var(--text2)" }}>{fmt(r.card_tips || 0)}</td>
                          <td className="text-right mono" style={{ color: parseFloat(r.auto_grat) > 0 ? "var(--text2)" : "var(--text3)" }}>
                            {parseFloat(r.auto_grat) > 0 ? fmt(r.auto_grat) : "—"}
                          </td>
                          <td className="text-right mono" style={{ color: r.pool_method === "equal_split" ? "var(--yellow)" : "var(--text3)" }}>
                            {r.pool_method === "equal_split" ? fmt(r.pool_share || 0) : "—"}
                          </td>
                          <td className="text-right mono" style={{ fontWeight: 500 }}>{fmt(finalTip(r))}</td>
                          <td>
                            {r.pool_method === "equal_split" && (
                              <span className="tag" style={{ fontSize: 9, background: "var(--yellowBg)", color: "var(--yellow)", border: "1px solid var(--yellow)40" }}>pool</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {poolModal && (() => {
        const total = (byDate[poolModal.date] || []).reduce((s, r) => s + parseFloat(r.card_tips || 0) + parseFloat(r.auto_grat || 0), 0);
        const count = poolModal.selected.size;
        const share = count > 0 ? total / count : 0;
        return (
          <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setPoolModal(null)}>
            <div className="modal" style={{ maxWidth: 540 }}>
              <div className="modal-header">
                <div className="modal-title">Tip pool · {fmtDate(poolModal.date)}</div>
                <button className="btn btn-ghost" style={{ padding: 4 }} onClick={() => setPoolModal(null)}><Icon name="close" size={16} /></button>
              </div>
              <div className="modal-body">
                <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 12 }}>
                  Pick everyone who shares this day's tips. Equal split — total <strong style={{ color: "var(--accent)" }}>{fmt(total)}</strong> ÷ {count || "?"} = <strong style={{ color: "var(--yellow)" }}>{fmt(share)}</strong> each.
                </div>
                <div style={{ maxHeight: 380, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius2)" }}>
                  {poolModal.list.map(m => {
                    const checked = poolModal.selected.has(m.id);
                    return (
                      <div key={m.id} className="flex items-center justify-between" style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", background: checked ? "var(--accentBg)" : "transparent", cursor: "pointer" }} onClick={() => togglePoolMember(m.id)}>
                        <div className="flex items-center gap-12">
                          <div style={{ width: 16, height: 16, borderRadius: 3, border: `1.5px solid ${checked ? "var(--accent)" : "var(--border2)"}`, background: checked ? "var(--accentBg)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {checked && <Icon name="check" size={10} color="var(--accent)" />}
                          </div>
                          <span style={{ fontSize: 13 }}>{m.name}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
                          {m.card_tips > 0 && <span style={{ marginRight: 10 }}>card {fmt(m.card_tips)}</span>}
                          {m.hours > 0 && <span>{m.hours.toFixed(1)}h</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="modal-footer">
                {poolModal.existingPool && (
                  <button className="btn btn-outline" style={{ color: "var(--text3)" }} onClick={() => applyPool(true)}>Clear pool</button>
                )}
                <button className="btn btn-outline" onClick={() => setPoolModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => applyPool(false)} disabled={count === 0}>Apply pool</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── PAYROLL ──────────────────────────────────────────────────────────────────
// Payroll prep + export tool. CFO calculates the batch from Square Labor +
// manual adjustments; Paychex (or whoever the operator uses) runs the actual
// regulatory engine. We do NOT move money or compute authoritative tax
// withholdings — the "estimated_*" fields are previews only, Paychex
// authoritative numbers replace them at reconciliation time.
//
// FLSA: hours over 40 per workweek pay 1.5× the regular rate. Texas follows
// federal — no state OT rule.

const PAYROLL_EMPLOYER_BURDEN = 0.15;       // employer-side taxes/benefits ≈ FICA match + FUTA + SUTA TX + WC
const PAYROLL_EMP_FICA = 0.0765;            // employee FICA withholding
const PAYROLL_EMP_FED_WH_EST = 0.10;        // placeholder federal income tax withholding (rough)

function round2(n) { return Math.round((parseFloat(n) || 0) * 100) / 100; }

function isoWeekKey(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  const weekNo = 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return date.getFullYear() + "-W" + String(weekNo).padStart(2, "0");
}

function tipsTotalsForPeriod(tipsDaily, periodStart, periodEnd) {
  const byMember = {};
  for (const t of (tipsDaily || [])) {
    if (t.date < periodStart || t.date > periodEnd) continue;
    const k = t.team_member_id;
    if (!k) continue;
    if (!byMember[k]) byMember[k] = 0;
    byMember[k] += finalTip(t);
  }
  return byMember;
}

function buildPayrollLinesFromShifts(shifts, periodStart, periodEnd, tipsDaily) {
  const ps = new Date(periodStart);
  const pe = new Date(periodEnd + "T23:59:59.999");
  const inPeriod = (shifts || []).filter(s => {
    const d = new Date(s.start_at);
    return d >= ps && d <= pe;
  });
  const byEmp = {};
  for (const s of inPeriod) {
    const key = s.team_member_id || s.square_employee_id;
    if (!key) continue;
    if (!byEmp[key]) byEmp[key] = {
      employee_key: key,
      employee_name: s.employee_name || key.slice(0, 8),
      shifts: [],
      hourly_rate: parseFloat(s.wage_hourly) || 0,
    };
    byEmp[key].shifts.push(s);
    const r = parseFloat(s.wage_hourly) || 0;
    if (r > byEmp[key].hourly_rate) byEmp[key].hourly_rate = r;
  }
  const tipsByMember = tipsTotalsForPeriod(tipsDaily, periodStart, periodEnd);
  return Object.values(byEmp).map(emp => {
    const byWeek = {};
    for (const s of emp.shifts) {
      const wk = isoWeekKey(s.start_at);
      byWeek[wk] = (byWeek[wk] || 0) + (parseFloat(s.hours) || 0);
    }
    let regular = 0, ot = 0;
    for (const wh of Object.values(byWeek)) {
      regular += Math.min(40, wh);
      ot += Math.max(0, wh - 40);
    }
    return computePayrollLine({
      employee_key: emp.employee_key,
      employee_name: emp.employee_name,
      hourly_rate: round2(emp.hourly_rate),
      hours_regular: round2(regular),
      hours_ot: round2(ot),
      bonus: 0,
      tips: round2(tipsByMember[emp.employee_key] || 0),
    });
  }).sort((a, b) => b.gross - a.gross);
}

function computePayrollLine(line) {
  const rate = parseFloat(line.hourly_rate) || 0;
  const reg = parseFloat(line.hours_regular) || 0;
  const ot = parseFloat(line.hours_ot) || 0;
  const bonus = parseFloat(line.bonus) || 0;
  const tips = parseFloat(line.tips) || 0;
  const wage = reg * rate + ot * rate * 1.5;
  const gross = wage + bonus + tips;
  const empFica = gross * PAYROLL_EMP_FICA;
  const empFedWh = gross * PAYROLL_EMP_FED_WH_EST;
  const net = gross - empFica - empFedWh;
  const employerTax = gross * PAYROLL_EMPLOYER_BURDEN;
  return {
    ...line,
    hourly_rate: round2(rate),
    hours_regular: round2(reg),
    hours_ot: round2(ot),
    bonus: round2(bonus),
    tips: round2(tips),
    gross: round2(gross),
    estimated_emp_fica: round2(empFica),
    estimated_emp_fed_wh: round2(empFedWh),
    estimated_net: round2(net),
    employer_tax: round2(employerTax),
    total_cash_out: round2(gross + employerTax),
  };
}

function computePayrollTotals(lines) {
  const acc = { gross: 0, employer_tax: 0, total_cash_out: 0, estimated_net: 0, employee_count: 0, regular_hours: 0, ot_hours: 0 };
  for (const l of (lines || [])) {
    acc.gross += parseFloat(l.gross) || 0;
    acc.employer_tax += parseFloat(l.employer_tax) || 0;
    acc.total_cash_out += parseFloat(l.total_cash_out) || 0;
    acc.estimated_net += parseFloat(l.estimated_net) || 0;
    acc.regular_hours += parseFloat(l.hours_regular) || 0;
    acc.ot_hours += parseFloat(l.hours_ot) || 0;
    acc.employee_count += 1;
  }
  return {
    gross: round2(acc.gross),
    employer_tax: round2(acc.employer_tax),
    total_cash_out: round2(acc.total_cash_out),
    estimated_net: round2(acc.estimated_net),
    employee_count: acc.employee_count,
    regular_hours: round2(acc.regular_hours),
    ot_hours: round2(acc.ot_hours),
  };
}

function exportPayrollCSV(run) {
  const rows = [
    ["Employee", "Regular Hours", "OT Hours", "Hourly Rate", "Bonus", "Tips", "Gross"],
    ...(run.lines || []).map(l => [
      l.employee_name,
      l.hours_regular,
      l.hours_ot,
      l.hourly_rate,
      l.bonus || 0,
      l.tips || 0,
      l.gross,
    ]),
  ];
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payroll_${run.period_start}_${run.period_end}.csv`;
  a.click();
}

function Payroll({ runs, shifts, tipsDaily, transactions, categories, setTransactions, saveTransactions, tenantId, onChange, showToast }) {
  const [selectedId, setSelectedId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    periodStart: (() => { const d = new Date(); d.setDate(d.getDate() - 14); return d.toISOString().slice(0, 10); })(),
    periodEnd: new Date().toISOString().slice(0, 10),
    payDate: (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })(),
  });

  // Paystub PDF import — extracts COMPANY TOTALS via /api/parse-paystub.
  // The preview modal lets the operator confirm before saving (Anthropic
  // numbers are usually right, but pay periods that overlap or have weird
  // formatting can mistake columns).
  const [paystubParsing, setPaystubParsing] = useState(false);
  const [paystubPreview, setPaystubPreview] = useState(null); // { totals, split_suggestion, filename }
  const fileInputRef = useRef(null);

  const handlePaystubFile = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      showToast("Paystub must be a PDF", "error");
      return;
    }
    setPaystubParsing(true);
    showToast("Reading paystub with AI... 10-20 seconds", "info");
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(String(e.target.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Read failed"));
        reader.readAsDataURL(file);
      });
      const apiRes = await fetch("/api/parse-paystub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64: base64, filename: file.name }),
      });
      if (!apiRes.ok) {
        const err = await apiRes.json().catch(() => ({ error: "Server error " + apiRes.status }));
        showToast(err.error || ("Server error " + apiRes.status), "error");
        return;
      }
      const data = await apiRes.json();
      setPaystubPreview(data);
    } catch (err) {
      showToast("Paystub parse failed: " + err.message, "error");
    } finally {
      setPaystubParsing(false);
    }
  };

  // Find every Paychex/ADP/Gusto ACH within ±7 days of the paystub check date.
  // Paychex splits a single pay period into 2-3 bank rows:
  //   - PAYROLL ACH  (direct deposits to employees)
  //   - TAXES ACH    (employee withholdings + employer match remittance)
  //   - EIB INVOICE  (Paychex service fee)
  // We classify each one by description keyword so the auto-reconciler can
  // route them differently.
  const findPaychexRowsInWindow = (t) => {
    if (!t?.check_date) return { payroll: [], taxes: [], eib: [], all: [] };
    const checkMs = new Date(t.check_date).getTime();
    const dayMs = 86400000;
    const all = transactions.filter(x => {
      const amt = parseFloat(x.amount);
      if (isNaN(amt) || amt >= 0) return false;
      const desc = (x.description || "").toLowerCase();
      if (!/paychex|payroll|adp|gusto/.test(desc)) return false;
      const xMs = new Date(x.date).getTime();
      if (Math.abs(xMs - checkMs) > 7 * dayMs) return false;
      if (x.source === "payroll_settlement") return false; // already reconciled
      return true;
    });
    const payroll = [], taxes = [], eib = [];
    for (const row of all) {
      const desc = (row.description || "").toLowerCase();
      if (/eib|invoice/.test(desc)) eib.push(row);
      else if (/tps|taxes/.test(desc)) taxes.push(row);
      else payroll.push(row);
    }
    return { payroll, taxes, eib, all };
  };

  // Reconcile a paystub against the bank: the Paychex PAYROLL + TAXES rows
  // get re-tagged as `payroll_settlement` (filtered out of P&L by
  // makeLedgerFilter), the Paychex EIB INVOICE rows get reclassified into
  // Office & Supplies, and we materialize 3 shadow rows on the check date
  // carrying the paystub's true labor / tips / reimb amounts. The shadows
  // are what the P&L sums for the period.
  //
  // Net effect: bank-side rows stay as audit trail, P&L reflects paystub
  // truth ($14k labor instead of bank-inflated $24k that included tip
  // pass-through and reimbursements).
  const autoReconcilePaystub = async (t, run) => {
    const grouped = findPaychexRowsInWindow(t);
    if (grouped.all.length === 0) return { matched: 0 };

    const settlementIds = [...grouped.payroll, ...grouped.taxes].map(r => r.id);
    const eibIds = grouped.eib.map(r => r.id);

    const laborCat = categories.find(c => c.type === "expense" && /payroll|labor|wage/i.test(c.name || ""));
    const tipCat   = categories.find(c => c.type === "transfer" && /tip/i.test(c.name || ""));
    const reimbCat = categories.find(c => c.type === "expense" && /reimb/i.test(c.name || ""))
                  || categories.find(c => c.type === "expense" && /office|supplies/i.test(c.name || ""));
    const officeCat = categories.find(c => c.type === "expense" && /office|supplies|service.*fee|software/i.test(c.name || ""));

    // 1) Settle PAYROLL + TAXES rows
    if (settlementIds.length > 0 && tenantId && tenantId !== "demo") {
      const { error } = await supabase
        .from("r7_ledger_transactions")
        .update({ source: "payroll_settlement" })
        .in("id", settlementIds);
      if (error) return { matched: grouped.all.length, error: "settle: " + error.message };
    }

    // 2) Reclassify EIB rows to Office & Supplies
    if (eibIds.length > 0 && officeCat && tenantId && tenantId !== "demo") {
      const { error } = await supabase
        .from("r7_ledger_transactions")
        .update({ category_id: officeCat.id })
        .in("id", eibIds);
      if (error) console.warn("reclassify EIB:", error.message);
    }

    // 3) Create shadow rows on the check_date with paystub truth
    const shadowDate = t.check_date || run.pay_date || run.period_end;
    const periodLabel = `${run.period_start} → ${run.period_end}`;
    const shadows = [
      {
        id: `paystub_labor_${run.id}`,
        date: shadowDate,
        description: `Payroll labor (wages + employer match) — paystub ${periodLabel}`,
        amount: -Math.abs(parseFloat(t.true_labor_cost) || 0),
        category_id: laborCat?.id || null,
        source: "paystub_shadow",
        account: "Paystub",
        reconciled: true,
        tags: ["paystub", run.id],
        notes: `From paystub run ${run.id}. Hourly ${t.hourly_earnings || 0} + OT ${t.overtime_earnings || 0} + employer match ${t.employer_match_total || 0}.`,
      },
      {
        id: `paystub_tips_${run.id}`,
        date: shadowDate,
        description: `Tips pass-through — paystub ${periodLabel}`,
        amount: -Math.abs(parseFloat(t.tips_charged) || 0),
        category_id: tipCat?.id || null,
        source: "paystub_shadow",
        account: "Paystub",
        reconciled: true,
        tags: ["paystub", run.id],
        notes: `From paystub run ${run.id}. Passthrough to staff, excluded from P&L via Tip Pass-Through (transfer category).`,
      },
      {
        id: `paystub_reimb_${run.id}`,
        date: shadowDate,
        description: `Expense reimbursement — paystub ${periodLabel}`,
        amount: -Math.abs(parseFloat(t.reimb_non_tax) || 0),
        category_id: reimbCat?.id || null,
        source: "paystub_shadow",
        account: "Paystub",
        reconciled: true,
        tags: ["paystub", run.id],
        notes: `From paystub run ${run.id}. Non-taxable expense reimbursements paid through payroll.`,
      },
    ].filter(s => s.amount !== 0);

    const upRes = await upsertTransactions(shadows, tenantId);
    if (!upRes.ok) return { matched: grouped.all.length, error: "shadow upsert: " + (upRes.error || "unknown") };

    // Optimistic local update — push the shadow rows and patch the bank rows
    // to their new source/category so the screen updates without waiting for
    // the realtime echo.
    if (setTransactions) {
      const settledSet = new Set(settlementIds);
      const eibSet = new Set(eibIds);
      setTransactions(prev => {
        const patched = prev.map(x => {
          if (settledSet.has(x.id)) return { ...x, source: "payroll_settlement" };
          if (eibSet.has(x.id) && officeCat) return { ...x, category: officeCat.id, category_id: officeCat.id };
          return x;
        });
        // De-dupe shadow ids (idempotent re-runs)
        const shadowIds = new Set(shadows.map(s => s.id));
        const withoutOld = patched.filter(x => !shadowIds.has(x.id));
        return [...withoutOld, ...shadows.map(s => ({ ...s, category: s.category_id, tenant_id: tenantId }))];
      });
    }

    return {
      matched: grouped.all.length,
      settled: settlementIds.length,
      eib_reclassified: eibIds.length,
      shadows_created: shadows.length,
      missingCats: { labor: !laborCat, tip: !tipCat, reimb: !reimbCat, office: !officeCat },
    };
  };

  // Backward-compatible alias for the older call sites still using the v1 name.
  const autoSplitPaychex = autoReconcilePaystub;

  const savePaystubAsRun = async () => {
    if (!paystubPreview) return;
    const t = paystubPreview.totals || {};
    if (!t.period_start || !t.period_end) {
      showToast("Period dates missing — edit the PDF or save manually", "error");
      return;
    }
    // Look for an existing run for the same period — update it; otherwise create.
    const existing = runs.find(r => r.period_start === t.period_start && r.period_end === t.period_end);
    // Stash the full paystub envelope inside `totals` so we don't need a new
    // column on r7_payroll_runs — `totals` is already JSONB. The CFO Source
    // comparison view (future PR6) can read totals.paystub_meta for audit.
    const totalsWithMeta = {
      ...t,
      paystub_meta: {
        source: "paystub_pdf",
        filename: paystubPreview.filename,
        split_suggestion: paystubPreview.split_suggestion,
        extracted_at: new Date().toISOString(),
      },
    };
    const runRow = existing
      ? { ...existing, totals: { ...(existing.totals || {}), ...totalsWithMeta } }
      : {
          id: "pr_" + Date.now(),
          period_start: t.period_start,
          period_end: t.period_end,
          pay_date: t.check_date || null,
          status: "submitted",
          lines: [],
          totals: totalsWithMeta,
          notes: "Imported from paystub " + (paystubPreview.filename || "paystub.pdf"),
        };
    const saved = await upsertPayrollRun(runRow, tenantId);
    if (!saved.ok) {
      showToast("Save failed: " + (saved.error || "unknown"), "error");
      return;
    }
    if (onChange) onChange();
    const baseMsg = existing
      ? `Run ${t.period_start} → ${t.period_end} updated with paystub data`
      : `Run created · gross ${fmt(t.wages_subtotal + t.tips_charged)} · net ${fmt(t.net_pay)}`;

    // Reset A — paystub saves to r7_payroll_runs but does NOT touch the
    // ledger. The operator can still trigger the reconciliation on demand
    // from the run detail (🔀 button), but the default is leave-alone so the
    // P&L stays a clean cash-basis view of the bank ledger. Source comparison
    // happens at Schedule C time using the paystub PDFs directly.
    showToast(baseMsg, "success");
    setPaystubPreview(null);
  };

  const selected = runs.find(r => r.id === selectedId);

  const persist = async (row) => {
    const result = await upsertPayrollRun(row, tenantId);
    if (!result.ok) {
      showToast(`Save failed: ${result.error || "unknown"}`, "error");
      return null;
    }
    if (onChange) onChange();
    return result.data;
  };

  const createRun = async () => {
    const lines = buildPayrollLinesFromShifts(shifts, createForm.periodStart, createForm.periodEnd, tipsDaily);
    const totals = computePayrollTotals(lines);
    const tempId = "pr_" + Date.now();
    const newRun = {
      id: tempId,
      period_start: createForm.periodStart,
      period_end: createForm.periodEnd,
      pay_date: createForm.payDate,
      status: "draft",
      lines,
      totals,
      notes: "",
    };
    const saved = await persist(newRun);
    if (saved) {
      setSelectedId(saved.id);
      showToast(`Run created with ${lines.length} employees · ${fmt(totals.gross)} gross`, "success");
    }
    setCreateOpen(false);
  };

  const updateLine = async (lineIdx, patch) => {
    if (!selected) return;
    const newLines = selected.lines.map((l, i) => i === lineIdx ? computePayrollLine({ ...l, ...patch }) : l);
    const totals = computePayrollTotals(newLines);
    await persist({ ...selected, lines: newLines, totals });
  };

  const submitRun = async () => {
    if (!selected) return;
    if (!window.confirm("Submit this payroll run? This locks the numbers and creates a pending transaction in the ledger so the bank import can auto-reconcile when Paychex debits.")) return;
    const total = parseFloat(selected.totals?.total_cash_out) || 0;
    const payDate = selected.pay_date || new Date().toISOString().slice(0, 10);
    const shadowId = "payroll_run_" + selected.id;
    // Create a shadow transaction in the ledger
    const payrollCat = categories.find(c => c.taxLine === "Wages" || c.name === "Payroll");
    const shadow = {
      id: shadowId,
      date: payDate,
      description: `PAYROLL BATCH ${selected.period_start} → ${selected.period_end}`,
      amount: -Math.abs(total),
      category: payrollCat?.id || null,
      category_id: payrollCat?.id || null,
      account: "Payroll · pending",
      reconciled: false,
      source: "payroll_run",
      notes: `Pending payroll run · ${selected.totals?.employee_count || 0} employees · expected debit ${fmt(total)}`,
      tags: ["payroll_pending"],
    };
    setTransactions(prev => {
      const without = prev.filter(t => t.id !== shadowId);
      return [shadow, ...without];
    });
    if (saveTransactions) await saveTransactions([shadow]);
    await persist({ ...selected, status: "submitted", submitted_at: new Date().toISOString(), reconciled_txn_id: shadowId });
    showToast(`Payroll submitted · shadow transaction ${fmt(total)} added to ledger`, "success");
  };

  const cancelRun = async () => {
    if (!selected) return;
    if (!window.confirm("Cancel this run?")) return;
    await persist({ ...selected, status: "cancelled" });
    showToast("Run cancelled", "info");
  };

  const removeRun = async () => {
    if (!selected) return;
    if (!window.confirm("Delete this run permanently?")) return;
    await deletePayrollRun(selected.id);
    setSelectedId(null);
    if (onChange) onChange();
    showToast("Run deleted", "info");
  };

  const statusColor = { draft: "var(--text2)", approved: "var(--blue)", submitted: "var(--yellow)", reconciled: "var(--accent)", cancelled: "var(--text3)" };

  // Background auto-reconciler. Whenever transactions or runs change (statement
  // import, realtime push, etc), scan every paystub-fed run and see if its
  // Paychex ACH has appeared in the ledger. Exactly one unambiguous candidate
  // = silent split + toast notification. Guards against re-running on the same
  // parent twice with a session-level Set; that survives prop churn but resets
  // on a hard refresh, which is fine because a refresh re-loads the ledger and
  // the parent will already have its children (skipped by findPaychexCandidates).
  const autoReconciledRef = useRef(new Set());
  // Background auto-reconciler removed by Anderson's "Reset A" decision.
  // The paystub still imports into r7_payroll_runs, but the ledger stays
  // bank-driven — no shadows are created, no Paychex rows get re-tagged.
  // The 🔀 button on the run detail page is the only path that touches the
  // ledger, and only when explicitly clicked.

  // Retry the auto-split for the currently-selected run. Useful when the
  // paystub was saved first and the bank ACH only arrived later — clicking
  // this button re-runs the same matcher and split as savePaystubAsRun.
  const retryAutoSplit = async () => {
    if (!selected) return;
    const t = selected.totals || {};
    if (!t.true_labor_cost && !t.wages_subtotal) {
      showToast("This run has no paystub data — import a paystub PDF first", "error");
      return;
    }
    autoReconciledRef.current.delete(selected.id); // allow retry
    const res = await autoReconcilePaystub(t, selected);
    if (res.matched === 0) {
      showToast("No Paychex ACH found within ±7 days of the check date", "info");
    } else if (res.error) {
      showToast("Reconcile failed: " + res.error, "error");
    } else {
      const tags = [];
      if (res.missingCats?.labor)  tags.push("Labor cat missing");
      if (res.missingCats?.tip)    tags.push("Tip Pass-Through cat missing");
      if (res.missingCats?.reimb)  tags.push("Reimb cat missing");
      const warn = tags.length ? " · ⚠️ " + tags.join(", ") : "";
      showToast(`Paystub reconciled · ${res.settled} ACH${res.settled === 1 ? "" : "s"} settled · ${res.shadows_created} shadow rows` + warn, "success");
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Payroll</div>
          <div className="page-subtitle">Payroll prep + Paychex CSV export · {runs.length} run{runs.length === 1 ? "" : "s"} on record</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePaystubFile(f); e.target.value = ""; }}
          />
          <button
            className="btn btn-outline btn-sm"
            disabled={paystubParsing}
            onClick={() => fileInputRef.current?.click()}
            title="Upload a Paychex/ADP/Gusto payroll journal PDF — AI extracts company totals + suggests how to split the Paychex bank ACH debit"
          >
            {paystubParsing ? "Reading PDF…" : "📄 Import paystub PDF"}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}><Icon name="plus" size={13} /> New payroll run</button>
        </div>
      </div>

      <div className="card" style={{ background: "var(--yellowBg)", border: "1px solid var(--yellow)40", marginBottom: 20, padding: "10px 14px" }}>
        <div style={{ fontSize: 11, color: "var(--text2)", fontFamily: "var(--font-mono)", lineHeight: 1.5 }}>
          ⚠ Estimates only. Paychex runs the regulatory engine — final tax withholding, deductions, and net pay come from Paychex, not this preview. CFO does not move money.
        </div>
      </div>

      {!selected && (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Period</th><th>Pay date</th><th>Status</th><th style={{ textAlign: "right" }}>Employees</th><th style={{ textAlign: "right" }}>Hours</th><th style={{ textAlign: "right" }}>Gross</th><th style={{ textAlign: "right" }}>Total cash out</th></tr></thead>
              <tbody>
                {runs.length === 0 ? (
                  <tr><td colSpan={7}><div className="empty"><div className="empty-icon">💵</div><div className="empty-title">No payroll runs yet</div><div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>Click <strong>New payroll run</strong>, pick the period, and CFO pulls hours from Square automatically.</div></div></td></tr>
                ) : runs.map(r => (
                  <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => setSelectedId(r.id)}>
                    <td className="mono" style={{ color: "var(--text2)" }}>{r.period_start} → {r.period_end}</td>
                    <td className="mono" style={{ color: "var(--text2)" }}>{r.pay_date || "—"}</td>
                    <td><span className="tag" style={{ background: statusColor[r.status] + "20", color: statusColor[r.status], border: `1px solid ${statusColor[r.status]}40`, fontSize: 10 }}>{r.status}</span></td>
                    <td className="text-right mono">{r.totals?.employee_count || 0}</td>
                    <td className="text-right mono">{(parseFloat(r.totals?.regular_hours) || 0) + (parseFloat(r.totals?.ot_hours) || 0)}h</td>
                    <td className="text-right mono">{fmt(r.totals?.gross || 0)}</td>
                    <td className="text-right mono" style={{ color: "var(--yellow)" }}>{fmt(r.totals?.total_cash_out || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
              <div>
                <button className="btn btn-ghost btn-sm" style={{ padding: "4px 8px", marginRight: 8 }} onClick={() => setSelectedId(null)}>← Back</button>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: 20 }}>{selected.period_start} → {selected.period_end}</span>
                <span className="tag" style={{ marginLeft: 12, background: statusColor[selected.status] + "20", color: statusColor[selected.status], border: `1px solid ${statusColor[selected.status]}40`, fontSize: 10 }}>{selected.status}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {selected.totals?.total_bank_debit > 0 && (
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={retryAutoSplit}
                    title="Find the matching Paychex ACH in the bank ledger and split it into Labor / Tips / Reimbursement using this run's paystub data"
                  >
                    🔀 Auto-split Paychex ACH
                  </button>
                )}
                <button className="btn btn-outline btn-sm" onClick={() => exportPayrollCSV(selected)}><Icon name="download" size={13} /> Export Paychex CSV</button>
                {selected.status === "draft" && (
                  <button className="btn btn-primary btn-sm" onClick={submitRun}>Submit (creates shadow txn)</button>
                )}
                {selected.status === "draft" && (
                  <button className="btn btn-outline btn-sm" style={{ color: "var(--text3)" }} onClick={cancelRun}>Cancel run</button>
                )}
                <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }} onClick={removeRun}><Icon name="trash" size={13} /></button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
              {[
                { label: "Employees", value: selected.totals?.employee_count || 0 },
                { label: "Total hours", value: `${(parseFloat(selected.totals?.regular_hours) || 0) + (parseFloat(selected.totals?.ot_hours) || 0)}h` },
                { label: "OT hours", value: `${selected.totals?.ot_hours || 0}h`, color: parseFloat(selected.totals?.ot_hours) > 0 ? "var(--yellow)" : "var(--text)" },
                { label: "Gross", value: fmt(selected.totals?.gross || 0) },
                { label: "Total cash out", value: fmt(selected.totals?.total_cash_out || 0), color: "var(--yellow)" },
              ].map(k => (
                <div key={k.label} style={{ background: "var(--surface2)", padding: "10px 14px", borderRadius: "var(--radius2)" }}>
                  <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{k.label}</div>
                  <div className="mono" style={{ fontSize: 16, marginTop: 4, color: k.color || "var(--text)" }}>{k.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Employee</th><th style={{ textAlign: "right" }}>Reg hrs</th><th style={{ textAlign: "right" }}>OT hrs</th><th style={{ textAlign: "right" }}>$/h</th><th style={{ textAlign: "right" }}>Bonus</th><th style={{ textAlign: "right" }}>Tips</th><th style={{ textAlign: "right" }}>Gross</th><th style={{ textAlign: "right" }}>Est. net</th><th style={{ textAlign: "right" }}>Loaded</th></tr></thead>
                <tbody>
                  {(selected.lines || []).map((l, i) => {
                    const editable = selected.status === "draft";
                    return (
                      <tr key={l.employee_key || i}>
                        <td>{l.employee_name}{parseFloat(l.hours_ot) > 0 && <span style={{ marginLeft: 6, fontSize: 9, padding: "1px 5px", background: "var(--yellowBg)", color: "var(--yellow)", borderRadius: 3 }}>OT</span>}</td>
                        <td className="text-right mono" style={{ fontSize: 11 }}>{l.hours_regular}</td>
                        <td className="text-right mono" style={{ fontSize: 11, color: parseFloat(l.hours_ot) > 0 ? "var(--yellow)" : "var(--text2)" }}>{l.hours_ot}</td>
                        <td className="text-right mono" style={{ fontSize: 11 }}>{fmt(l.hourly_rate)}</td>
                        <td className="text-right">
                          {editable ? (
                            <input type="number" step="0.01" className="input" style={{ width: 80, textAlign: "right", fontSize: 11, padding: "3px 6px" }} value={l.bonus || ""} placeholder="0" onChange={e => updateLine(i, { bonus: e.target.value })} />
                          ) : <span className="mono">{fmt(l.bonus || 0)}</span>}
                        </td>
                        <td className="text-right">
                          {editable ? (
                            <input type="number" step="0.01" className="input" style={{ width: 80, textAlign: "right", fontSize: 11, padding: "3px 6px" }} value={l.tips || ""} placeholder="0" onChange={e => updateLine(i, { tips: e.target.value })} />
                          ) : <span className="mono">{fmt(l.tips || 0)}</span>}
                        </td>
                        <td className="text-right mono" style={{ fontWeight: 500 }}>{fmt(l.gross)}</td>
                        <td className="text-right mono" style={{ color: "var(--text2)", fontSize: 11 }}>{fmt(l.estimated_net)}</td>
                        <td className="text-right mono" style={{ color: "var(--yellow)", fontSize: 11 }}>{fmt(l.total_cash_out)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setCreateOpen(false)}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <div className="modal-title">New payroll run</div>
              <button className="btn btn-ghost" style={{ padding: 4 }} onClick={() => setCreateOpen(false)}><Icon name="close" size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="label">Period start</label>
                  <input type="date" className="input" value={createForm.periodStart} onChange={e => setCreateForm(f => ({ ...f, periodStart: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="label">Period end</label>
                  <input type="date" className="input" value={createForm.periodEnd} onChange={e => setCreateForm(f => ({ ...f, periodEnd: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label className="label">Pay date</label>
                <input type="date" className="input" value={createForm.payDate} onChange={e => setCreateForm(f => ({ ...f, payDate: e.target.value }))} />
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>Date the bank will be debited. CFO uses this for the shadow transaction.</div>
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 12 }}>
                Hours pull automatically from Square Labor for the chosen window. OT is computed as hours over 40 per ISO week × 1.5×.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setCreateOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createRun}>Build draft</button>
            </div>
          </div>
        </div>
      )}

      {paystubPreview && (
        <PaystubPreviewModal
          data={paystubPreview}
          onClose={() => setPaystubPreview(null)}
          onSave={savePaystubAsRun}
        />
      )}
    </div>
  );
}

function PaystubPreviewModal({ data, onClose, onSave }) {
  const t = data.totals || {};
  const s = data.split_suggestion || {};
  const row = (label, value, options = {}) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px dotted var(--border)" }}>
      <span style={{ fontSize: 12, color: options.dim ? "var(--text3)" : "var(--text2)", paddingLeft: options.indent ? 18 : 0 }}>{label}</span>
      <span className="mono" style={{ fontSize: 12, color: options.color || "var(--text)", fontWeight: options.bold ? 700 : 400 }}>
        {typeof value === "number" ? fmt(value) : value}
      </span>
    </div>
  );
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Paystub extracted</div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
              {data.filename || "paystub.pdf"} · review before saving
            </div>
          </div>
        </div>
        <div className="modal-body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <div>
              <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 12, marginBottom: 8, color: "var(--accent)" }}>Period</div>
              {row("Start", t.period_start || "—")}
              {row("End", t.period_end || "—")}
              {row("Check date", t.check_date || "—")}
              {row("Employees", t.employee_count || 0)}

              <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 12, margin: "14px 0 8px", color: "var(--accent)" }}>Earnings</div>
              {row("Hourly", t.hourly_earnings || 0)}
              {row("Overtime", t.overtime_earnings || 0)}
              {row("Wages subtotal", t.wages_subtotal || 0, { bold: true })}
              {row("Tips charged", t.tips_charged || 0, { color: "var(--purple)" })}
              {row("Reimb non-tax", t.reimb_non_tax || 0, { color: "var(--blue)" })}
            </div>
            <div>
              <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 12, marginBottom: 8, color: "var(--accent)" }}>Employee withholdings</div>
              {row("Social Security", t.employee_ss || 0, { dim: true })}
              {row("Medicare", t.employee_medicare || 0, { dim: true })}
              {row("Fed income tax", t.employee_fed_income || 0, { dim: true })}
              {row("Total withhold", t.employee_withhold_total || 0, { bold: true })}

              <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 12, margin: "14px 0 8px", color: "var(--accent)" }}>Employer liability</div>
              {row("Employer SS", t.employer_ss || 0, { dim: true })}
              {row("Employer Medicare", t.employer_medicare || 0, { dim: true })}
              {row("Fed unemploy", t.fed_unemploy || 0, { dim: true })}
              {row("TX unemploy", t.tx_unemploy || 0, { dim: true })}
              {row("Employer match", t.employer_match_total || 0, { bold: true })}
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 18 }}>
            <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 12, marginBottom: 8, color: "var(--accent)" }}>Cash flow</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
              <div>
                {row("Net pay (to employees)", t.net_pay || 0)}
                {row("Tax liability (to gov)", t.total_tax_liability || 0)}
                {row("True labor cost", t.true_labor_cost || 0, { color: "var(--accent)", bold: true })}
              </div>
              <div>
                {row("Total bank debit (Paychex ACH)", t.total_bank_debit || 0, { color: "var(--yellow)", bold: true })}
              </div>
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 18 }}>
            <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
              Suggested split for the Paychex ACH debit
            </div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>
              When the bank statement imports, find the Paychex ACH (~{fmt(t.total_bank_debit || 0)}) and split into:
            </div>
            {row("Payroll (Labor)", s.labor || 0, { color: "var(--accent)" })}
            {row("Tip Pass-Through", s.tip_pass_through || 0, { color: "var(--purple)" })}
            {row("Exp Reimbursement", s.exp_reimbursement || 0, { color: "var(--blue)" })}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave}>Save to Payroll Run</button>
        </div>
      </div>
    </div>
  );
}

function AggregatorPreviewModal({ data, onClose, onSave }) {
  const platform = data.platform || "other";
  const payouts = data.payouts || [];
  const totals = data.totals || {};
  const platformLabel = {
    doordash: "DoorDash",
    ubereats: "UberEats",
    grubhub:  "GrubHub",
    wix:      "Wix Restaurants",
    other:    "Other",
  }[platform] || platform;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 820 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{platformLabel} statement extracted</div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
              {data.filename || "statement"} · {payouts.length} payout{payouts.length === 1 ? "" : "s"} · period {data.period_start || "?"} → {data.period_end || "?"}
            </div>
          </div>
        </div>
        <div className="modal-body">
          {totals && (
            <div style={{ background: "var(--surface2)", padding: "12px 14px", borderRadius: 4, marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Totals</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, fontSize: 12 }}>
                <div><span style={{ color: "var(--text3)" }}>Gross:</span> <strong className="mono" style={{ color: "var(--accent)" }}>{fmt(totals.gross_sales || 0)}</strong></div>
                <div><span style={{ color: "var(--text3)" }}>Commission:</span> <strong className="mono" style={{ color: "var(--red)" }}>−{fmt(totals.commission || 0)}</strong></div>
                <div><span style={{ color: "var(--text3)" }}>Marketing:</span> <strong className="mono" style={{ color: "var(--red)" }}>{totals.marketing_fee > 0 ? "−" + fmt(totals.marketing_fee) : "—"}</strong></div>
                <div><span style={{ color: "var(--text3)" }}>Refunds:</span> <strong className="mono">{totals.refunds > 0 ? "−" + fmt(totals.refunds) : "—"}</strong></div>
                <div><span style={{ color: "var(--text3)" }}>Delivery fee:</span> <strong className="mono">{totals.delivery_fee > 0 ? "+" + fmt(totals.delivery_fee) : "—"}</strong></div>
                <div><span style={{ color: "var(--text3)" }}>Tax remitted:</span> <strong className="mono">{totals.tax_remitted > 0 ? fmt(totals.tax_remitted) : "—"}</strong></div>
                <div><span style={{ color: "var(--text3)" }}>Other fees:</span> <strong className="mono">{totals.other_fees > 0 ? "−" + fmt(totals.other_fees) : "—"}</strong></div>
                <div><span style={{ color: "var(--text3)" }}>Net payout:</span> <strong className="mono" style={{ color: "var(--accent)" }}>{fmt(totals.net_payout || 0)}</strong></div>
              </div>
            </div>
          )}
          <div className="table-wrap" style={{ maxHeight: 320, overflowY: "auto" }}>
            <table style={{ fontSize: 11 }}>
              <thead>
                <tr>
                  <th>Arrival</th>
                  <th>Payout ID</th>
                  <th style={{ textAlign: "right" }}>Gross</th>
                  <th style={{ textAlign: "right" }}>Commission</th>
                  <th style={{ textAlign: "right" }}>Mkt</th>
                  <th style={{ textAlign: "right" }}>Refunds</th>
                  <th style={{ textAlign: "right" }}>Net</th>
                  <th style={{ textAlign: "right" }}>%</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p, i) => {
                  const g = parseFloat(p.gross_sales || 0);
                  const pct = g > 0 ? (parseFloat(p.commission || 0) / g * 100) : 0;
                  return (
                    <tr key={i}>
                      <td className="mono" style={{ color: "var(--text3)" }}>{p.arrival_date || "?"}</td>
                      <td className="mono" style={{ fontSize: 10, color: "var(--text3)" }}>{(p.payout_id || "—").slice(0, 18)}</td>
                      <td className="mono text-right" style={{ color: "var(--accent)" }}>{fmt(g)}</td>
                      <td className="mono text-right" style={{ color: "var(--red)" }}>−{fmt(parseFloat(p.commission || 0))}</td>
                      <td className="mono text-right" style={{ color: "var(--red)" }}>{p.marketing_fee > 0 ? "−" + fmt(parseFloat(p.marketing_fee)) : "—"}</td>
                      <td className="mono text-right">{p.refunds > 0 ? "−" + fmt(parseFloat(p.refunds)) : "—"}</td>
                      <td className="mono text-right" style={{ color: "var(--accent)", fontWeight: 600 }}>{fmt(parseFloat(p.net_payout || 0))}</td>
                      <td className="mono text-right" style={{ color: pct > 30 ? "var(--red)" : pct > 20 ? "var(--yellow)" : "var(--accent)" }}>{pct.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={payouts.length === 0}>
            Save {payouts.length} payout{payouts.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── LABOR ────────────────────────────────────────────────────────────────────
function Labor({ shifts, transactions, categories, tenantId, dateRange, onSync, showToast }) {
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  const sync = async () => {
    setLoading(true);
    showToast("Pulling shifts from Square...", "info");
    try {
      const result = await syncSquareLabor(tenantId, dateRange);
      setLastSync(new Date());
      if (result.shifts === 0) {
        showToast("No shifts in this date range.", "info");
      } else {
        showToast(`${result.shifts} shifts · ${result.hours}h · loaded cost ${fmt(result.fully_loaded_cost)}`, "success");
      }
      if (onSync) onSync();
    } catch (err) {
      showToast("Square Labor sync failed: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  // Shifts already arrive filtered by date range (loadAll passes it through).
  const totalHours = shifts.reduce((s, r) => s + parseFloat(r.hours || 0), 0);
  const totalWage = shifts.reduce((s, r) => s + parseFloat(r.wage_total || 0), 0);
  const totalLoaded = shifts.reduce((s, r) => s + parseFloat(r.fully_loaded_cost || 0), 0);
  const taxBurden = shifts.length > 0 ? parseFloat(shifts[0].tax_burden_rate || 0.15) : 0.15;

  // Group by employee
  const byEmployee = {};
  for (const s of shifts) {
    const key = s.team_member_id || s.square_employee_id || s.employee_name || "unknown";
    if (!byEmployee[key]) byEmployee[key] = {
      name: s.employee_name || key.slice(0, 8),
      shifts: 0, hours: 0, wage: 0, loaded: 0, hourlyAvg: 0,
    };
    byEmployee[key].shifts += 1;
    byEmployee[key].hours += parseFloat(s.hours || 0);
    byEmployee[key].wage += parseFloat(s.wage_total || 0);
    byEmployee[key].loaded += parseFloat(s.fully_loaded_cost || 0);
  }
  const employees = Object.values(byEmployee).map(e => ({
    ...e,
    hourlyAvg: e.hours > 0 ? e.wage / e.hours : 0,
  })).sort((a, b) => b.loaded - a.loaded);

  // Actual payroll from ledger — match by Wages tax line or Payroll category name
  const payrollCat = categories.find(c => c.taxLine === "Wages" || c.name === "Payroll");
  const actualPayroll = payrollCat
    ? Math.abs(transactions.filter(t => t.category === payrollCat.id && parseFloat(t.amount) < 0)
        .reduce((s, t) => s + parseFloat(t.amount || 0), 0))
    : 0;

  // Revenue for labor % calc
  const revenue = transactions.filter(t => parseFloat(t.amount) > 0 && isRevenueRelevant(t))
    .reduce((s, t) => s + parseFloat(t.amount || 0), 0);
  const laborPct = revenue > 0 ? (totalLoaded / revenue) * 100 : 0;

  // Variance: actual payroll vs fully loaded projected
  const variance = actualPayroll - totalLoaded;
  const variancePct = totalLoaded > 0 ? (variance / totalLoaded) * 100 : 0;

  // Source breakdown (bridge from favo-pos #21.3): each shift carries
  // source='square' or 'pos_punch'. Surface the split so drift between
  // the two streams is visible without leaving the screen.
  const squareShifts = shifts.filter(s => s.source !== 'pos_punch');
  const posShifts = shifts.filter(s => s.source === 'pos_punch');
  const squareHours = squareShifts.reduce((a, s) => a + parseFloat(s.hours || 0), 0);
  const posHours = posShifts.reduce((a, s) => a + parseFloat(s.hours || 0), 0);
  const hasMixed = squareShifts.length > 0 && posShifts.length > 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Labor</div>
          <div className="page-subtitle">
            {dateRange.start} → {dateRange.end} · From Square Labor · loaded cost = wage × (1 + {(taxBurden * 100).toFixed(1)}% employer tax burden)
          </div>
          {hasMixed && (
            <div className="page-subtitle" style={{ marginTop: 6, fontSize: 11, color: "var(--text3)" }}>
              Source split · Square {squareHours.toFixed(1)}h ({squareShifts.length}) · POS punches {posHours.toFixed(1)}h ({posShifts.length}) · uncosted
            </div>
          )}
          {!hasMixed && posShifts.length > 0 && (
            <div className="page-subtitle" style={{ marginTop: 6, fontSize: 11, color: "var(--text3)" }}>
              {posShifts.length} POS punch shift{posShifts.length === 1 ? "" : "s"} · {posHours.toFixed(1)}h · uncosted (pos_staff has no hourly rate yet)
            </div>
          )}
        </div>
        <button
          className="btn btn-outline btn-sm"
          onClick={sync}
          disabled={loading}
          style={{ gap: 8, borderColor: "var(--accentBorder)", color: loading ? "var(--text3)" : "var(--accent)" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: loading ? "spin 1s linear infinite" : "none" }}>
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          {loading ? "Syncing..." : "Sync Labor"}
          {lastSync && <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>{ctryTime(lastSync)}</span>}
        </button>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Hours worked</div>
          <div className="kpi-value">{totalHours.toFixed(1)}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>{shifts.length} shift{shifts.length === 1 ? "" : "s"} · {employees.length} employee{employees.length === 1 ? "" : "s"}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Wage cost</div>
          <div className="kpi-value">{fmt(totalWage)}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>hours × hourly</div>
        </div>
        <div className="kpi-card kpi-yellow">
          <div className="kpi-label">Fully loaded cost</div>
          <div className="kpi-value">{fmt(totalLoaded)}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>+{(taxBurden * 100).toFixed(1)}% employer tax</div>
        </div>
        <div className="kpi-card" style={{ borderTop: `2px solid ${laborPct > 35 ? "var(--red)" : laborPct > 30 ? "var(--yellow)" : "var(--accent)"}` }}>
          <div className="kpi-label">Labor % of revenue</div>
          <div className="kpi-value" style={{ color: laborPct > 35 ? "var(--red)" : laborPct > 30 ? "var(--yellow)" : "var(--accent)" }}>
            {laborPct.toFixed(1)}%
          </div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>target ≤ 30% casual dining</div>
        </div>
      </div>

      {/* Payroll variance card */}
      {(actualPayroll > 0 || totalLoaded > 0) && (
        <div className="card" style={{ marginBottom: 20, borderLeft: `3px solid ${Math.abs(variancePct) > 10 ? "var(--yellow)" : "var(--accent)"}` }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
            <div>
              <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13 }}>Payroll variance</div>
              <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 4 }}>Actual Payroll charges (ledger) vs projected fully-loaded labor (Square × tax burden)</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Variance</div>
              <div className="mono" style={{ fontSize: 18, color: Math.abs(variancePct) > 10 ? "var(--yellow)" : "var(--accent)" }}>
                {variance >= 0 ? "+" : ""}{fmt(variance)} ({variancePct >= 0 ? "+" : ""}{variancePct.toFixed(1)}%)
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <div style={{ background: "var(--surface2)", padding: "10px 14px", borderRadius: "var(--radius2)" }}>
              <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Projected (Square × {(taxBurden * 100).toFixed(1)}%)</div>
              <div className="mono" style={{ fontSize: 16, marginTop: 4 }}>{fmt(totalLoaded)}</div>
            </div>
            <div style={{ background: "var(--surface2)", padding: "10px 14px", borderRadius: "var(--radius2)" }}>
              <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Actual payroll (ledger)</div>
              <div className="mono" style={{ fontSize: 16, marginTop: 4 }}>{fmt(actualPayroll)}</div>
            </div>
          </div>
          {Math.abs(variancePct) > 10 && (
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--text2)" }}>
              ⚠ Variance over 10%.
              {variance > 0 ? " Payroll charges exceed projected — investigate OT, bonuses, or off-system hours." : " Payroll charges below projected — possibly hours not yet paid, or Square shifts missing the actual headcount."}
            </div>
          )}
        </div>
      )}

      {/* By employee */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13 }}>By employee</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th style={{ textAlign: "right" }}>Shifts</th>
                <th style={{ textAlign: "right" }}>Hours</th>
                <th style={{ textAlign: "right" }}>Avg $/h</th>
                <th style={{ textAlign: "right" }}>Wage</th>
                <th style={{ textAlign: "right" }}>Loaded cost</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr><td colSpan={6}><div className="empty"><div className="empty-icon">⏱</div><div className="empty-title">No shifts yet</div><div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>Click <strong>Sync Labor</strong> to pull from Square. Ensure your team is clocking in/out on the Square Terminal.</div></div></td></tr>
              ) : employees.map(e => (
                <tr key={e.name}>
                  <td style={{ fontWeight: 500 }}>{e.name}</td>
                  <td className="text-right mono">{e.shifts}</td>
                  <td className="text-right mono">{e.hours.toFixed(1)}h</td>
                  <td className="text-right mono" style={{ color: "var(--text2)" }}>{fmt(e.hourlyAvg)}</td>
                  <td className="text-right mono">{fmt(e.wage)}</td>
                  <td className="text-right mono" style={{ color: "var(--yellow)" }}>{fmt(e.loaded)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── BOOKKEEPER ───────────────────────────────────────────────────────────────
function Bookkeeper({ transactions, allTransactions, categories, setTransactions, saveTransactions, tenantId, dateRange, setScreen, showToast }) {
  const txns = allTransactions || transactions;
  const [dismissalsVersion, setDismissalsVersion] = useState(0);
  const issues = runBookkeeperRules(txns, categories, tenantId);
  const score = computeComplianceScore(issues);
  const deadline = daysUntilNextDeadline();
  const sevColor = { critical: "var(--red)", medium: "var(--yellow)", hygiene: "var(--blue)" };
  const sevLabel = { critical: "Critical", medium: "Review", hygiene: "Hygiene" };
  const sevBg = { critical: "var(--redBg)", medium: "var(--yellowBg)", hygiene: "var(--blueBg)" };
  const [expanded, setExpanded] = useState({});

  const applyTagBulk = (ids, tag) => {
    setTransactions(prev => {
      const idSet = new Set(ids);
      const updated = prev.map(t => {
        if (!idSet.has(t.id)) return t;
        const tags = Array.isArray(t.tags) ? t.tags.slice() : [];
        if (!tags.includes(tag)) tags.push(tag);
        return { ...t, tags };
      });
      if (saveTransactions) {
        const changed = updated.filter(t => idSet.has(t.id));
        saveTransactions(changed);
      }
      return updated;
    });
    showToast(ids.length + " transaction" + (ids.length === 1 ? "" : "s") + " tagged " + tag, "success");
  };

  const dismissIssue = (issue) => {
    // For rules tied to specific rows, tag each row with the matching
    // *_dismissed flag so a future re-import can revive them automatically.
    // For global rules (sales_tax, duplicates) we persist in localStorage.
    const dismissTagMap = { section_179: "section_179_dismissed", meals_50: "meals_50pct_dismissed", docs: "doc_dismissed", "1099": "1099_dismissed" };
    const tag = dismissTagMap[issue.id];
    if (tag && (issue.items || issue.groups)) {
      const ids = issue.items?.map(t => t.id) || issue.groups.flatMap(g => g.items.map(t => t.id));
      applyTagBulk(ids, tag);
    } else {
      dismissIssueGlobal(tenantId, issue.id);
      setDismissalsVersion(v => v + 1);
      showToast(`Dismissed "${issue.title}" for ${new Date().getFullYear()}`, "info");
    }
  };

  // Period close checklist — derived live
  const yearStart = new Date().getFullYear() + "-01-01";
  const yearTxns = txns.filter(t => t.date >= yearStart);
  const checklist = [
    { label: "All transactions categorized", done: yearTxns.filter(t => t.category === UNCATEGORIZED || !t.category).length === 0, hint: `${yearTxns.filter(t => t.category === UNCATEGORIZED || !t.category).length} left` },
    { label: "Bank accounts reconciled", done: yearTxns.filter(t => !t.reconciled && parseFloat(t.amount) !== 0).length === 0, hint: `${yearTxns.filter(t => !t.reconciled).length} unreconciled` },
    { label: "1099 contractors identified", done: !issues.find(i => i.id === "1099"), hint: issues.find(i => i.id === "1099") ? `${issues.find(i => i.id === "1099").groups.length} pending` : "all flagged" },
    { label: "Meals flagged 50%", done: !issues.find(i => i.id === "meals_50"), hint: issues.find(i => i.id === "meals_50") ? `${issues.find(i => i.id === "meals_50").items.length} pending` : "all flagged" },
    { label: "Receipts/notes attached > $75", done: !issues.find(i => i.id === "docs"), hint: issues.find(i => i.id === "docs") ? `${issues.find(i => i.id === "docs").items.length} pending` : "all documented" },
    { label: "Sales tax tracked", done: !issues.find(i => i.id === "sales_tax"), hint: issues.find(i => i.id === "sales_tax") ? "no Taxes & Licenses entries" : "ok" },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Bookkeeper</div>
          <div className="page-subtitle">Rules-based audit · IRS Schedule C compliance · TorresBee</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card" style={{ borderLeft: `3px solid ${score >= 80 ? "var(--accent)" : score >= 60 ? "var(--yellow)" : "var(--red)"}` }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", textTransform: "uppercase" }}>IRS compliance score</span>
            <span style={{ fontSize: 11, color: "var(--text3)" }}>{issues.length} issue{issues.length === 1 ? "" : "s"} open</span>
          </div>
          <div className="mono" style={{ fontSize: 48, lineHeight: 1, color: score >= 80 ? "var(--accent)" : score >= 60 ? "var(--yellow)" : "var(--red)" }}>{score}<span style={{ fontSize: 18, color: "var(--text3)" }}> / 100</span></div>
          <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 8 }}>
            {score >= 80 ? "On track" : score >= 60 ? "Needs attention" : "Critical issues — review before quarter close"}
          </div>
        </div>
        {deadline && (
          <div className="card" style={{ borderLeft: `3px solid ${deadline.days <= 15 ? "var(--red)" : "var(--blue)"}` }}>
            <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Next IRS deadline</div>
            <div className="mono" style={{ fontSize: 22, color: "var(--text)" }}>{deadline.name}</div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6 }}>
              <span className="mono" style={{ color: deadline.days <= 15 ? "var(--red)" : "var(--text)" }}>{deadline.days} day{deadline.days === 1 ? "" : "s"}</span> · {deadline.date}
            </div>
          </div>
        )}
      </div>

      {/* Period close checklist */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13, marginBottom: 14 }}>Period close checklist</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
          {checklist.map((c, i) => (
            <div key={i} className="flex items-center gap-12" style={{ padding: "8px 12px", background: c.done ? "var(--accentBg)" : "var(--surface2)", borderRadius: "var(--radius2)", border: `1px solid ${c.done ? "var(--accentBorder)" : "var(--border)"}` }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, border: `1.5px solid ${c.done ? "var(--accent)" : "var(--border2)"}`, background: c.done ? "var(--accentBg)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {c.done && <Icon name="check" size={11} color="var(--accent)" />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: c.done ? "var(--text)" : "var(--text2)" }}>{c.label}</div>
                <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>{c.hint}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Issues */}
      {issues.length === 0 ? (
        <div className="card" style={{ background: "var(--accentBg)", border: "1px solid var(--accentBorder)", textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: 18, color: "var(--accent)" }}>No issues detected — books are clean</div>
        </div>
      ) : (
        <div>
          {["critical", "medium", "hygiene"].map(sev => {
            const sevIssues = issues.filter(i => i.severity === sev);
            if (sevIssues.length === 0) return null;
            return (
              <div key={sev} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: sevColor[sev], fontFamily: "var(--font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
                  {sevLabel[sev]} ({sevIssues.length})
                </div>
                {sevIssues.map(issue => {
                  const exp = expanded[issue.id];
                  return (
                    <div key={issue.id} className="card" style={{ marginBottom: 8, borderLeft: `3px solid ${sevColor[sev]}`, padding: "12px 16px" }}>
                      <div className="flex items-center justify-between">
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{issue.title}</div>
                          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4, lineHeight: 1.5 }}>{issue.description}</div>
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: 12 }}>
                          {issue.fixTag && issue.items && (
                            <button
                              className="btn btn-sm"
                              style={{ background: sevBg[sev], color: sevColor[sev], border: `1px solid ${sevColor[sev]}40`, fontSize: 11 }}
                              onClick={() => applyTagBulk(issue.items.map(t => t.id), issue.fixTag)}
                            >
                              {issue.fixLabel}
                            </button>
                          )}
                          {issue.fixTag && issue.groups && (
                            <button
                              className="btn btn-sm"
                              style={{ background: sevBg[sev], color: sevColor[sev], border: `1px solid ${sevColor[sev]}40`, fontSize: 11 }}
                              onClick={() => applyTagBulk(issue.groups.flatMap(g => g.items.map(t => t.id)), issue.fixTag)}
                            >
                              {issue.fixLabel}
                            </button>
                          )}
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: 11 }}
                            onClick={() => setExpanded(e => ({ ...e, [issue.id]: !exp }))}
                          >
                            {exp ? "Hide" : "Details"}
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: 11, color: "var(--text3)" }}
                            onClick={() => dismissIssue(issue)}
                            title="Dismiss this issue for the current year. Re-runs of the rule that match the same rows will keep them hidden."
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                      {exp && (
                        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                          {issue.groups && (
                            <div style={{ display: "grid", gap: 6 }}>
                              {issue.groups.slice(0, 10).map((g, i) => (
                                <div key={i} className="flex items-center justify-between" style={{ fontSize: 12, padding: "6px 10px", background: "var(--surface2)", borderRadius: "var(--radius2)" }}>
                                  <span className="mono" style={{ color: "var(--text)" }}>{g.vendor}</span>
                                  <span className="mono" style={{ color: "var(--red)" }}>{fmt(g.total)} · {g.items.length} txn{g.items.length === 1 ? "" : "s"}</span>
                                </div>
                              ))}
                              {issue.groups.length > 10 && <div style={{ fontSize: 11, color: "var(--text3)", textAlign: "center" }}>+{issue.groups.length - 10} more</div>}
                            </div>
                          )}
                          {issue.pairs && (
                            <div style={{ display: "grid", gap: 8 }}>
                              {issue.pairs.slice(0, 10).map((p, i) => (
                                <div key={i} style={{ fontSize: 12, padding: "8px 12px", background: "var(--surface2)", borderRadius: "var(--radius2)" }}>
                                  <div className="flex items-center justify-between"><span>{fmtDate(p.a.date)} · {p.a.description}</span><span className="mono" style={{ color: "var(--red)" }}>{fmt(p.a.amount)}</span></div>
                                  <div className="flex items-center justify-between" style={{ marginTop: 4 }}><span>{fmtDate(p.b.date)} · {p.b.description}</span><span className="mono" style={{ color: "var(--red)" }}>{fmt(p.b.amount)}</span></div>
                                </div>
                              ))}
                              {issue.pairs.length > 10 && <div style={{ fontSize: 11, color: "var(--text3)", textAlign: "center" }}>+{issue.pairs.length - 10} more</div>}
                            </div>
                          )}
                          {issue.items && (
                            <div style={{ display: "grid", gap: 4 }}>
                              {issue.items.slice(0, 10).map(t => (
                                <div key={t.id} className="flex items-center justify-between" style={{ fontSize: 12, padding: "6px 10px", background: "var(--surface2)", borderRadius: "var(--radius2)" }}>
                                  <span>{fmtDate(t.date)} · {t.description.slice(0, 50)}</span>
                                  <span className="mono" style={{ color: parseFloat(t.amount) < 0 ? "var(--red)" : "var(--accent)" }}>{fmt(t.amount)}</span>
                                </div>
                              ))}
                              {issue.items.length > 10 && <div style={{ fontSize: 11, color: "var(--text3)", textAlign: "center", marginTop: 6 }}>+{issue.items.length - 10} more — open Transactions to review</div>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [magicMode, setMagicMode] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setInfo(null); setLoading(true);
    if (magicMode) {
      const { error: err } = await sendMagicLink(email);
      if (err) setError(err.message);
      else setInfo("Check your email — we sent a sign-in link.");
    } else {
      const { error: err } = await signInWithPassword(email, password);
      if (err) setError(err.message);
    }
    setLoading(false);
  };

  return (
    <>
      <style>{STYLES}</style>
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 20 }}>
        <div className="card" style={{ width: "100%", maxWidth: 380, padding: 32 }}>
          <div className="flex items-center gap-10" style={{ marginBottom: 24 }}>
            <div className="logo-icon">
              <FavoMark size={34} />
            </div>
            <div className="logo-text">
              <div className="logo-mark">Favo<span className="logo-dot">.</span></div>
              <div className="logo-sub">CFO</div>
            </div>
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
            {magicMode ? "Sign in with a link" : "Sign in"}
          </div>
          <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 20 }}>
            {magicMode ? "We'll email you a one-time sign-in link." : "Login com sua conta Favo"}
          </div>
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="email@exemplo.com" autoComplete="email" />
            {!magicMode && (
              <input className="input" type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="senha" autoComplete="current-password" />
            )}
            {error && <div style={{ background: "var(--redBg)", border: "1px solid var(--red)40", color: "var(--red)", borderRadius: "var(--radius2)", padding: "8px 10px", fontSize: 12 }}>{error}</div>}
            {info && <div style={{ background: "var(--accentBg)", border: "1px solid var(--accentBorder)", color: "var(--accent)", borderRadius: "var(--radius2)", padding: "8px 10px", fontSize: 12 }}>{info}</div>}
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ justifyContent: "center", padding: "10px" }}>
              {loading ? "..." : magicMode ? "Send sign-in link" : "Entrar"}
            </button>
          </form>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 14, width: "100%", justifyContent: "center", color: "var(--text3)" }}
            onClick={() => { setMagicMode(m => !m); setError(null); setInfo(null); }}
          >
            {magicMode ? "← Use password" : "Forgot password? Email me a link"}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── FAVO BANK (Unit embedded banking) ────────────────────────────────────────
// The tenant's own bank account, living INSIDE Favo via Unit BaaS. Three
// "envelopes" (deposit accounts): Operating, Tax Vault, Payroll Reserve. Money
// moves between them instantly with bookPayments — the CFO Insights "set aside
// $X for tax" recommendation becomes a real transfer. Transactions sync into
// r7_ledger_transactions as source='unit', so reconciliation is automatic.
//
// SANDBOX: against UNIT_ENV=sandbox this is fully clickable (auto-approved KYB,
// simulated funds). Going LIVE requires the Unit/partner-bank compliance package
// (insurance, policies, pentest) — see CLAUDE.md roadmap.
//
// REQUIRED DISCLOSURE: Unit assigns the partner bank and the exact legal string
// you must show. Replace PARTNER_BANK with the bank Unit gives your program.
const PARTNER_BANK = "Partner Bank"; // e.g. "Thread Bank" / "i3 Bank" — set per Unit program

const ENVELOPE_META = {
  operating: { color: "var(--accent)", hint: "Square payouts land here" },
  tax_vault: { color: "var(--blue)",   hint: "Sales-tax reserve" },
  payroll:   { color: "var(--purple)", hint: "Payroll reserve" },
};

function FavoBank({ tenantId, onSync, showToast }) {
  const isDemo = tenantId === "demo";
  const [loading, setLoading] = useState(!isDemo);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState(null);     // { enrolled, envelopes, total_available, card, ... }
  const [xfer, setXfer] = useState(null);        // transfer modal form or null

  const refresh = useCallback(async () => {
    if (isDemo) return;
    try {
      const s = await fetchFavoBankState(tenantId);
      setState(s);
    } catch (e) {
      showToast("Favo Bank: " + e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [tenantId, isDemo, showToast]);

  useEffect(() => { refresh(); }, [refresh]);

  const enroll = async () => {
    if (!window.confirm("Open a Favo Bank account for this restaurant? In sandbox this is instant; in production it starts KYB review.")) return;
    setBusy(true);
    showToast("Opening Favo Bank account…", "info");
    try {
      await onboardFavoBank(tenantId);
      showToast("Favo Bank account opened", "success");
      await refresh();
    } catch (e) {
      showToast("Could not open account: " + e.message, "error");
    } finally { setBusy(false); }
  };

  const sync = async () => {
    setBusy(true);
    showToast("Syncing Favo Bank transactions…", "info");
    try {
      const r = await syncFavoBank(tenantId);
      if (r.not_enrolled) { showToast("Open your Favo Bank account first", "info"); }
      else { showToast(`Favo Bank · ${r.added} transaction${r.added === 1 ? "" : "s"} synced`, "success"); if (onSync) onSync(); }
      await refresh();
    } catch (e) {
      showToast("Sync failed: " + e.message, "error");
    } finally { setBusy(false); }
  };

  const doTransfer = async () => {
    const amt = parseFloat(xfer.amount);
    if (!amt || amt <= 0) { showToast("Enter an amount > 0", "error"); return; }
    if (xfer.from === xfer.to) { showToast("Pick two different envelopes", "error"); return; }
    setBusy(true);
    try {
      const r = await transferFavoBank(tenantId, xfer.from, xfer.to, amt, xfer.description);
      showToast(`Moved ${fmt(r.amount)}: ${r.from} → ${r.to}`, "success");
      setXfer(null);
      await refresh();
      if (onSync) onSync();
    } catch (e) {
      showToast("Transfer failed: " + e.message, "error");
    } finally { setBusy(false); }
  };

  const disclosure = (
    <div style={{ marginTop: 18, fontSize: 11, color: "var(--text3)", lineHeight: 1.6, fontFamily: "var(--font-mono)" }}>
      Banking services provided by {PARTNER_BANK}, Member FDIC. Favo is a financial technology company, not a bank.
      Deposits are eligible for FDIC pass-through insurance up to applicable limits. The Favo debit card is issued pursuant to a license from the card network.
    </div>
  );

  if (isDemo) {
    return (
      <div className="page">
        <div className="page-header"><div><div className="page-title">Favo Bank</div><div className="page-subtitle">Embedded banking — available in production</div></div></div>
        <div className="card"><div className="empty"><div className="empty-icon">🏦</div><div className="empty-title">Favo Bank runs in production only</div><div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6, maxWidth: 460 }}>Open the live tenant to enroll. Each restaurant gets real deposit accounts (Operating, Tax Vault, Payroll) and a debit card, powered by Unit.</div></div></div>
        {disclosure}
      </div>
    );
  }

  if (loading) {
    return (<div className="page"><div className="page-header"><div className="page-title">Favo Bank</div></div><div className="card" style={{ color: "var(--text3)", fontFamily: "var(--font-mono)", fontSize: 13 }}>Loading…</div></div>);
  }

  const enrolled = state?.enrolled;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Favo Bank</div>
          <div className="page-subtitle">{enrolled ? "Your restaurant's bank, inside Favo" : "Open a bank account for this restaurant"}</div>
        </div>
        {enrolled && (
          <div className="flex items-center gap-12">
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setXfer({ from: "operating", to: "tax_vault", amount: "", description: "" })} style={{ borderColor: "var(--accentBorder)", color: "var(--accent)" }}>Move money</button>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={sync}><Icon name="bank" size={13} /> {busy ? "Syncing…" : "Sync Favo Bank"}</button>
          </div>
        )}
      </div>

      {!enrolled ? (
        <div className="card" style={{ textAlign: "center", padding: "40px 28px" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🏦</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--text)", marginBottom: 8 }}>Open your Favo Bank account</div>
          <div style={{ fontSize: 13, color: "var(--text2)", maxWidth: 520, margin: "0 auto 22px", lineHeight: 1.6 }}>
            Real FDIC-eligible deposit accounts, a Favo debit card, and automatic envelopes for taxes and payroll — all inside the app. Square payouts land in Operating; CFO Insights moves the right amount into Tax Vault and Payroll for you.
          </div>
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", maxWidth: 560, margin: "0 auto 24px" }}>
            {Object.entries(ENVELOPE_META).map(([k, m]) => (
              <div className="kpi-card" key={k}><div className="kpi-label" style={{ color: m.color }}>{k.replace("_", " ")}</div><div className="kpi-delta" style={{ color: "var(--text3)" }}>{m.hint}</div></div>
            ))}
          </div>
          {state?.status === "error" && state?.last_error && (
            <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 14 }}>Last attempt failed: {state.last_error}</div>
          )}
          <button className="btn btn-primary" disabled={busy} onClick={enroll}>{busy ? "Opening…" : "Open Favo Bank Account"}</button>
          {disclosure}
        </div>
      ) : (
        <>
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="kpi-card">
              <div className="kpi-label">Total available</div>
              <div className="kpi-value" style={{ color: "var(--accent)" }}>{fmt(state.total_available || 0)}</div>
              <div className="kpi-delta" style={{ color: "var(--text3)" }}>across all envelopes</div>
            </div>
            {(state.envelopes || []).map(e => (
              <div className="kpi-card" key={e.account_id}>
                <div className="kpi-label" style={{ color: ENVELOPE_META[e.purpose]?.color || "var(--text2)" }}>{e.name}</div>
                <div className="kpi-value" style={{ color: e.error ? "var(--red)" : "var(--text)" }}>{e.error ? "—" : fmt(e.available != null ? e.available : e.balance || 0)}</div>
                <div className="kpi-delta mono" style={{ color: "var(--text3)", fontSize: 10 }}>{e.error ? e.error : (e.account_number_masked || ENVELOPE_META[e.purpose]?.hint || "")}</div>
              </div>
            ))}
          </div>

          {state.card && (
            <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, background: "linear-gradient(135deg, var(--surface), var(--accentBg))", border: "1px solid var(--accentBorder)" }}>
              <div>
                <div className="kpi-label" style={{ color: "var(--accent)" }}>Favo Debit Card</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, letterSpacing: 2, color: "var(--text)", marginTop: 4 }}>•••• •••• •••• {state.card.last4 || "••••"}</div>
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>VIRTUAL<br />{state.last_synced_at ? "synced " + fmtDate(state.last_synced_at) : "not synced yet"}</div>
            </div>
          )}

          {disclosure}
        </>
      )}

      {xfer && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setXfer(null)}>
          <div className="modal" style={{ maxWidth: 460 }}>
            <div className="modal-header"><div className="modal-title">Move money between envelopes</div></div>
            <div className="modal-body">
              <div className="flex items-center gap-12" style={{ marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <label className="kpi-label">From</label>
                  <select className="input" value={xfer.from} onChange={e => setXfer({ ...xfer, from: e.target.value })}>
                    {(state.envelopes || []).map(e => <option key={e.account_id} value={e.purpose}>{e.name}</option>)}
                  </select>
                </div>
                <div style={{ alignSelf: "flex-end", paddingBottom: 8, color: "var(--text3)" }}>→</div>
                <div style={{ flex: 1 }}>
                  <label className="kpi-label">To</label>
                  <select className="input" value={xfer.to} onChange={e => setXfer({ ...xfer, to: e.target.value })}>
                    {(state.envelopes || []).map(e => <option key={e.account_id} value={e.purpose}>{e.name}</option>)}
                  </select>
                </div>
              </div>
              <label className="kpi-label">Amount</label>
              <input className="input" type="number" min="0" step="0.01" placeholder="0.00" value={xfer.amount} onChange={e => setXfer({ ...xfer, amount: e.target.value })} autoFocus />
              <label className="kpi-label" style={{ marginTop: 12, display: "block" }}>Note (optional)</label>
              <input className="input" type="text" maxLength={50} placeholder="e.g. June sales tax set-aside" value={xfer.description} onChange={e => setXfer({ ...xfer, description: e.target.value })} />
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost btn-sm" onClick={() => setXfer(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={doTransfer} disabled={busy}>{busy ? "Moving…" : "Move money"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TRENDS (month-over-month KPIs) ───────────────────────────────────────────
// Self-fetching: pulls its own N-month window from Supabase so the charts don't
// depend on the top-bar date range. Monthly math mirrors the P&L screen exactly
// (same ledger filter, same benchmark thresholds and weights as opsScore) so a
// month here always matches what P&L shows for that month.
const TREND_BENCH = {
  net_margin: { label: "Net Margin",  target: "≥15%", excellent: 15, critical: 0,  lower: false, weight: 0.25 },
  ebitda:     { label: "EBITDA",      target: "≥20%", excellent: 20, critical: 5,  lower: false, weight: 0.15 },
  prime:      { label: "Prime Cost",  target: "≤55%", excellent: 55, critical: 70, lower: true,  weight: 0.25 },
  food:       { label: "Food Cost",   target: "≤28%", excellent: 28, critical: 40, lower: true,  weight: 0.20 },
  labor:      { label: "Labor Cost",  target: "≤25%", excellent: 25, critical: 40, lower: true,  weight: 0.15 },
};
// Scored KPIs live in TREND_BENCH (weights must sum to 1.0). OpEx is display-only —
// it is already implied by prime + ebitda, so scoring it would double-count.
const TREND_BENCH_OPEX = { label: "OpEx", target: "≤30%", excellent: 30, critical: 45, lower: true };
const trendNorm = (value, { excellent, critical, lower }) => {
  if (lower) {
    if (value <= excellent) return 100;
    if (value >= critical) return 0;
    return Math.round(100 - ((value - excellent) / (critical - excellent)) * 100);
  }
  if (value >= excellent) return 100;
  if (value <= critical) return 0;
  return Math.round(((value - critical) / (excellent - critical)) * 100);
};
const trendBandTone = (score) => score >= 60 ? "var(--accent)" : score >= 40 ? "var(--yellow)" : "var(--red)";

function TrendLineChart({ points, height = 170, yMin, yMax, fmtVal, color = "var(--accent)", target, targetDir, bands, dotTone }) {
  // points: [{ label, tip, value }] — value null = gap (month without revenue)
  const W = 560, H = height, padL = 40, padR = 14, padT = 14, padB = 22;
  const vals = points.map(p => p.value).filter(v => v != null);
  if (vals.length === 0) return <div style={{ color: "var(--text3)", fontSize: 12, padding: 20 }}>No data in this window.</div>;
  let lo = yMin != null ? yMin : Math.min(...vals, target != null ? target : Infinity);
  let hi = yMax != null ? yMax : Math.max(...vals, target != null ? target : -Infinity);
  if (hi === lo) { hi += 1; lo -= 1; }
  const span = hi - lo, pad = yMin != null && yMax != null ? 0 : span * 0.12;
  lo -= pad; hi += pad;
  const x = i => padL + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - padL - padR));
  const y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const gridVals = bands || [lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.75];
  const path = points.map((p, i) => p.value == null ? null : `${x(i)},${y(p.value)}`).filter(Boolean).join(" ");
  const labelStep = Math.max(1, Math.ceil(points.length / 9));
  const last = [...points].reverse().find(p => p.value != null);
  const lastIdx = points.lastIndexOf(last);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {gridVals.map(g => (
        <g key={g}>
          <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeWidth="1" />
          <text x={padL - 6} y={y(g) + 3} textAnchor="end" fontSize="9" fill="var(--text3)" fontFamily="var(--font-mono)">{fmtVal(g)}</text>
        </g>
      ))}
      {target != null && (
        <g>
          <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke="var(--text3)" strokeWidth="1" strokeDasharray="4 4" />
          <text x={W - padR} y={y(target) - 4} textAnchor="end" fontSize="9" fill="var(--text3)" fontFamily="var(--font-mono)">target {targetDir}{fmtVal(target)}</text>
        </g>
      )}
      <polyline points={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => p.value == null ? null : (
        <g key={p.label}>
          <circle cx={x(i)} cy={y(p.value)} r={i === lastIdx ? 4 : 3}
            fill={i === lastIdx ? (dotTone ? dotTone(p.value) : color) : "var(--surface)"}
            stroke={dotTone ? dotTone(p.value) : color} strokeWidth="2" />
          <rect x={x(i) - 12} y={padT} width="24" height={H - padT - padB} fill="transparent">
            <title>{p.tip}</title>
          </rect>
        </g>
      ))}
      {last && (
        <text x={Math.min(x(lastIdx) + 8, W - padR)} y={y(last.value) - 8} textAnchor={lastIdx > points.length - 3 ? "end" : "start"} fontSize="11" fontWeight="500" fill="var(--text)" fontFamily="var(--font-mono)">{fmtVal(last.value)}</text>
      )}
      {points.map((p, i) => i % labelStep !== 0 ? null : (
        <text key={p.label} x={x(i)} y={H - 7} textAnchor="middle" fontSize="9" fill="var(--text3)" fontFamily="var(--font-mono)">{p.label}</text>
      ))}
    </svg>
  );
}

function Trends({ tenantId, categories, allTransactions }) {
  const [windowMonths, setWindowMonths] = useState(18);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - (windowMonths - 1), 1).toISOString().slice(0, 10);
      const data = tenantId === "demo"
        ? (allTransactions || [])
        : await fetchTransactions(tenantId, { start, end: now.toISOString().slice(0, 10) });
      if (alive) { setRows(data); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [tenantId, windowMonths]);

  const monthly = useMemo(() => {
    if (!rows) return [];
    const mapped = rows.map(t => ({ ...t, category: t.category ?? (t.category_id || UNCATEGORIZED) }));
    const isLedger = makeLedgerFilter(categories, mapped);
    const cogsCatIds = new Set((categories || []).filter(isCogs).map(c => c.id));
    const laborCatIds = new Set((categories || []).filter(isLabor).map(c => c.id));
    const findCatIds = (pred) => new Set((categories || []).filter(pred).map(c => c.id));
    const ebitdaAddbackIds = new Set([
      ...findCatIds(c => /interest/i.test(c.name || "") || (c.taxLine ?? c.tax_line) === "Interest"),
      ...findCatIds(c => (/income\s*tax|federal\s*tax|state\s*income\s*tax/i.test(c.name || "") && !/sales/i.test(c.name || "")) || (c.taxLine ?? c.tax_line) === "Income Tax"),
      ...findCatIds(c => /depreciation/i.test(c.name || "") || (c.taxLine ?? c.tax_line) === "Depreciation"),
      ...findCatIds(c => /amortization/i.test(c.name || "") || (c.taxLine ?? c.tax_line) === "Amortization"),
    ]);

    const byMonth = new Map();
    for (const t of mapped) {
      if (!isLedger(t)) continue;
      const d = accrualDate(t);
      if (!d) continue;
      const key = d.slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, { revenue: 0, expenses: 0, cogs: 0, labor: 0, addbacks: 0 });
      const m = byMonth.get(key);
      const amt = parseFloat(t.amount || 0);
      if (amt > 0) m.revenue += amt; else m.expenses += -amt;
      if (amt < 0 && cogsCatIds.has(t.category)) m.cogs += -amt;
      if (amt < 0 && laborCatIds.has(t.category)) m.labor += -amt;
      if (amt < 0 && ebitdaAddbackIds.has(t.category)) m.addbacks += -amt;
    }

    const keys = [...byMonth.keys()].sort();
    return keys.map(key => {
      const m = byMonth.get(key);
      const [yy, mm] = key.split("-");
      const label = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(mm, 10) - 1] + " " + yy.slice(2);
      if (m.revenue <= 0) return { key, label, revenue: m.revenue, netIncome: m.revenue - m.expenses };
      const netIncome = m.revenue - m.expenses;
      const food = (m.cogs / m.revenue) * 100;
      const labor = (m.labor / m.revenue) * 100;
      const prime = food + labor;
      const netMargin = (netIncome / m.revenue) * 100;
      const ebitda = ((netIncome + m.addbacks) / m.revenue) * 100;
      // Operating expenses = everything that is not prime cost and not an EBITDA add-back,
      // so prime + opex + ebitda === 100. Deliberately excluded from the score: TREND_BENCH
      // weights sum to 1.0 and must keep matching the P&L Operations Score.
      const opex = ((m.expenses - m.cogs - m.labor - m.addbacks) / m.revenue) * 100;
      const vals = { net_margin: netMargin, ebitda, prime, food, labor };
      const score = Math.round(Object.entries(TREND_BENCH).reduce((s, [k, b]) => s + trendNorm(vals[k], b) * b.weight, 0));
      return { key, label, revenue: m.revenue, netIncome, food, labor, prime, netMargin, ebitda, opex, score };
    });
  }, [rows, categories]);

  const latest = [...monthly].reverse().find(m => m.score != null);
  const prev = latest ? [...monthly].reverse().find(m => m.score != null && m.key < latest.key) : null;
  const pct1 = v => v.toFixed(1) + "%";
  const pct0 = v => Math.round(v) + "%";
  const kpiCards = [
    { title: "Food Cost %",  metric: "food",      target: 28, dir: "≤", lower: true,  bench: TREND_BENCH.food },
    { title: "Labor Cost %", metric: "labor",     target: 25, dir: "≤", lower: true,  bench: TREND_BENCH.labor },
    { title: "Prime Cost %", metric: "prime",     target: 55, dir: "≤", lower: true,  bench: TREND_BENCH.prime },
    { title: "Net Margin %", metric: "netMargin", target: 15, dir: "≥", lower: false, bench: TREND_BENCH.net_margin },
    { title: "EBITDA %",     metric: "ebitda",    target: 20, dir: "≥", lower: false, bench: TREND_BENCH.ebitda },
    { title: "OpEx %",       metric: "opex",      target: 30, dir: "≤", lower: true,  bench: TREND_BENCH_OPEX },
  ];
  const deltaChip = (curr, before, lower) => {
    if (curr == null || before == null) return null;
    const d = curr - before;
    if (Math.abs(d) < 0.05) return <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>= flat</span>;
    const good = lower ? d < 0 : d > 0;
    return (
      <span style={{ fontSize: 10, color: good ? "var(--accent)" : "var(--red)", fontFamily: "var(--font-mono)" }}>
        {d > 0 ? "▲" : "▼"} {Math.abs(d).toFixed(1)}pp vs prev
      </span>
    );
  };

  // Revenue vs Net Income bars share one $ scale anchored at zero.
  const moneyChart = useMemo(() => {
    if (monthly.length === 0) return null;
    const W = 560, H = 200, padL = 48, padR = 14, padT = 14, padB = 22;
    const hi = Math.max(...monthly.map(m => m.revenue), 1);
    const lo = Math.min(...monthly.map(m => m.netIncome), 0);
    const y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const slot = (W - padL - padR) / monthly.length;
    const bw = Math.max(3, Math.min(14, slot * 0.32));
    const labelStep = Math.max(1, Math.ceil(monthly.length / 9));
    const fmtK = v => moneyCompact(v);
    const gridVals = [0, hi * 0.5, hi];
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {gridVals.map(g => (
          <g key={g}>
            <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke={g === 0 ? "var(--border2)" : "var(--border)"} strokeWidth="1" />
            <text x={padL - 6} y={y(g) + 3} textAnchor="end" fontSize="9" fill="var(--text3)" fontFamily="var(--font-mono)">{fmtK(g)}</text>
          </g>
        ))}
        {monthly.map((m, i) => {
          const cx = padL + slot * i + slot / 2;
          const niTone = m.netIncome >= 0 ? "var(--accent)" : "var(--red)";
          return (
            <g key={m.key}>
              <rect x={cx - bw - 1} y={y(m.revenue)} width={bw} height={Math.max(1, y(0) - y(m.revenue))} rx="2" fill="var(--blue)" opacity="0.75" />
              <rect x={cx + 1} y={m.netIncome >= 0 ? y(m.netIncome) : y(0)} width={bw} height={Math.max(1, Math.abs(y(0) - y(m.netIncome)))} rx="2" fill={niTone} opacity="0.9" />
              <rect x={cx - slot / 2} y={padT} width={slot} height={H - padT - padB} fill="transparent">
                <title>{`${m.label} · Revenue ${fmt(m.revenue)} · Net Income ${fmt(m.netIncome)}`}</title>
              </rect>
              {i % labelStep === 0 && <text x={cx} y={H - 7} textAnchor="middle" fontSize="9" fill="var(--text3)" fontFamily="var(--font-mono)">{m.label}</text>}
            </g>
          );
        })}
      </svg>
    );
  }, [monthly]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Trends</div>
          <div className="page-subtitle">Month-over-month KPIs · same math as the P&L Operations Score</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[12, 18, 24].map(n => (
            <button key={n} className={`btn btn-sm ${windowMonths === n ? "btn-primary" : "btn-outline"}`} onClick={() => setWindowMonths(n)}>{n} mo</button>
          ))}
        </div>
      </div>

      {loading && <div style={{ color: "var(--text3)", fontSize: 12, fontFamily: "var(--font-mono)", padding: 30 }}>Loading {windowMonths} months…</div>}

      {!loading && monthly.length > 0 && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <div>
                <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13 }}>Operations Score</div>
                <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>0–100 · 80+ Excellent · 60+ Healthy · 40+ Watch · below 40 Critical</div>
              </div>
              {latest && latest.score != null && (
                <div style={{ textAlign: "right" }}>
                  <span className="mono" style={{ fontSize: 26, color: trendBandTone(latest.score) }}>{latest.score}</span>
                  <div>{deltaChip(latest.score, prev?.score, false)}</div>
                </div>
              )}
            </div>
            <TrendLineChart
              points={monthly.map(m => ({ label: m.label, value: m.score ?? null, tip: `${m.label} · Score ${m.score ?? "—"}` }))}
              yMin={0} yMax={100} bands={[40, 60, 80]} fmtVal={v => Math.round(v)}
              color="var(--accent)" dotTone={trendBandTone} height={190}
            />
          </div>

          <div className="grid-2" style={{ gap: 14 }}>
            {kpiCards.map(k => {
              const lv = latest?.[k.metric], pv = prev?.[k.metric];
              const tone = lv == null ? "var(--text3)" : trendBandTone(trendNorm(lv, k.bench));
              return (
                <div key={k.metric} className="card" style={{ marginBottom: 14 }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                    <div>
                      <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13 }}>{k.title}</div>
                      <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>target {k.dir}{k.target}%</div>
                    </div>
                    {lv != null && (
                      <div style={{ textAlign: "right" }}>
                        <span className="mono" style={{ fontSize: 22, color: tone }}>{pct1(lv)}</span>
                        <div>{deltaChip(lv, pv, k.lower)}</div>
                      </div>
                    )}
                  </div>
                  <TrendLineChart
                    points={monthly.map(m => ({ label: m.label, value: m[k.metric] ?? null, tip: `${m.label} · ${k.title} ${m[k.metric] != null ? pct1(m[k.metric]) : "—"}` }))}
                    target={k.target} targetDir={k.dir} fmtVal={pct0} height={150}
                    color="var(--blue)"
                  />
                </div>
              );
            })}
          </div>

          <div className="card">
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13 }}>Revenue vs Net Income</div>
              <div style={{ display: "flex", gap: 14, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text2)" }}>
                <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "var(--blue)", marginRight: 5 }} />Revenue</span>
                <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "var(--accent)", marginRight: 5 }} />Net Income (red when negative)</span>
              </div>
            </div>
            {moneyChart}
          </div>
        </>
      )}
      {!loading && monthly.length === 0 && (
        <div className="card" style={{ color: "var(--text3)", fontSize: 13 }}>No transactions found in the last {windowMonths} months.</div>
      )}
    </div>
  );
}

// ─── CEO COCKPIT ──────────────────────────────────────────────────────────────
// TorresBee's equipment list. It is a SEED for the deployment's home tenant
// (VITE_TENANT_ID) only — every other store starts empty. Seeding it globally
// made the switcher show another restaurant's machines, prices and payback as
// if they were yours, which reads as real data on a finance screen.
const CEO_SEED_MACHINES = [
  { id: "pizza",  name: "Boleadora de massa de pizza", now: "Hoje: porcionado e boleado à mão",
    desc: "Divisora/boleadora que corta e arredonda as bolas de massa em uma prensada.",
    equip: 2500, setup: 150, days: 6, manual: 45, machine: 12, maint: 120 },
  { id: "brig",   name: "Porcionadora de brigadeiro", now: "Hoje: porcionado, pesado e boleado à mão",
    desc: "Encrustadeira/formadora automática que porciona e arredonda as bolinhas.",
    equip: 7000, setup: 400, days: 4, manual: 40, machine: 10, maint: 300 },
  { id: "batata", name: "Descascadora de batata", now: "Hoje: descascado à mão",
    desc: "Descascadora abrasiva de bancada, 20–22 lb por ciclo.",
    equip: 1500, setup: 100, days: 6, manual: 35, machine: 6, maint: 80 },
];

const roiStorageKey = (tid) => `favo_ceo_roi_${tid || "demo"}`;

// A record left by the old global seeding: the seed list, untouched, written to
// localStorage by the save effect on the first render of the screen. Nobody
// typed it, so it is safe to drop on tenants that shouldn't have it.
const roiIsPristineSeed = (ms) =>
  Array.isArray(ms) && ms.length === CEO_SEED_MACHINES.length &&
  ms.every((m, i) => m && Object.keys(CEO_SEED_MACHINES[i])
    .every(k => String(m[k]) === String(CEO_SEED_MACHINES[i][k])));

const roiCalc = (m, rate, weeks) => {
  const capex = (+m.equip || 0) + (+m.setup || 0);
  const dailyMin = Math.max(0, (+m.manual || 0) - (+m.machine || 0));
  const annualHrs = dailyMin * (+m.days || 0) * (+weeks || 0) / 60;
  const annualNet = annualHrs * (+rate || 0) - (+m.maint || 0);
  const months = annualNet > 0 ? capex / (annualNet / 12) : Infinity;
  const roi3 = capex > 0 ? (annualNet * 3 - capex) / capex * 100 : 0;
  return { capex, dailyMin, annualHrs, annualNet, months, roi3 };
};

const roiVerdict = (mo) => {
  if (!isFinite(mo) || mo < 0) return { t: "Sem economia", c: "var(--red)", bg: "var(--redBg)" };
  if (mo <= 18) return { t: "Compra recomendada", c: "var(--accent)", bg: "var(--accentBg)" };
  if (mo <= 36) return { t: "Avaliar volume", c: "var(--yellow)", bg: "var(--yellowBg)" };
  return { t: "Não compensa hoje", c: "var(--red)", bg: "var(--redBg)" };
};

const roiMonths = (mo) => !isFinite(mo) ? "∞" : mo < 24 ? mo.toFixed(mo < 10 ? 1 : 0) : (mo / 12).toFixed(1);
const roiMonthsUnit = (mo) => !isFinite(mo) ? "" : mo < 24 ? "meses" : "anos";

function CEO({ tenantId, tenantName, showToast }) {
  const KEY = roiStorageKey(tenantId);
  const isHomeTenant = tenantId === ENV_TENANT_ID;
  const [rate, setRate] = useState(18);
  const [weeks, setWeeks] = useState(52);
  const [machines, setMachines] = useState(isHomeTenant ? CEO_SEED_MACHINES : []);
  // Nothing is written back before the stored state has been read, otherwise
  // the save effect's first run would overwrite it with the empty default.
  const [hydrated, setHydrated] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // What the server already has. Keeps hydration from bouncing straight back as
  // a write, and keeps a failed read from being answered with an upload.
  const savedRef = useRef(null);

  const roiPayload = (r, w, ms) => ({ rate: r, weeks: w, machines: ms });

  useEffect(() => {
    let cancelled = false;

    // Local copy first: it paints immediately and it is the offline fallback.
    let local = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        // Legacy record from when the seed was global — drop it, don't migrate
        // TorresBee's machines into another store's row.
        if (!isHomeTenant && roiIsPristineSeed(d.machines)) localStorage.removeItem(KEY);
        else local = d;
      }
    } catch { /* ignore */ }

    const fromLocal = roiPayload(
      typeof local?.rate === "number" ? local.rate : 18,
      typeof local?.weeks === "number" ? local.weeks : 52,
      // An empty array is a real choice ("removi todas") — honour it.
      Array.isArray(local?.machines) ? local.machines : (isHomeTenant ? CEO_SEED_MACHINES : []),
    );
    setRate(fromLocal.rate); setWeeks(fromLocal.weeks); setMachines(fromLocal.machines);

    setSyncing(true);
    fetchCeoRoi(tenantId).then(({ ok, row }) => {
      if (cancelled) return;
      if (ok && row) {
        // The store's row wins over whatever this browser remembered.
        setRate(row.rate); setWeeks(row.weeks); setMachines(row.machines);
        savedRef.current = JSON.stringify(roiPayload(row.rate, row.weeks, row.machines));
      } else if (!ok) {
        // Read failed (offline, or the table isn't there yet): treat local as
        // already-saved so we don't push it over a row we couldn't see.
        savedRef.current = JSON.stringify(fromLocal);
      }
      // ok && !row: first time this store opens the cockpit — savedRef stays
      // null so the save effect migrates the local copy up.
      setSyncing(false);
      setHydrated(true);
    });

    return () => { cancelled = true; };
  }, [KEY, tenantId, isHomeTenant]);

  useEffect(() => {
    if (!hydrated) return;
    const payload = roiPayload(rate, weeks, machines);
    const json = JSON.stringify(payload);
    // localStorage is written on every keystroke — it is the cache that
    // survives a reload before the debounce fires.
    try { localStorage.setItem(KEY, json); } catch { /* ignore */ }
    if (json === savedRef.current) return;
    const t = setTimeout(() => {
      setSyncing(true);
      saveCeoRoi(payload, tenantId).then(ok => {
        if (ok) savedRef.current = json;
        setSyncing(false);
      });
    }, 800);
    return () => clearTimeout(t);
  }, [hydrated, KEY, tenantId, rate, weeks, machines]);

  const upd = (id, key, val) => setMachines(ms => ms.map(m => m.id === id ? { ...m, [key]: val } : m));
  const addMachine = () => setMachines(ms => [...ms, {
    id: "m_" + Date.now(), name: "Nova máquina", now: "Hoje: manual", desc: "",
    equip: 0, setup: 0, days: 6, manual: 0, machine: 0, maint: 0,
  }]);
  const removeMachine = (id) => setMachines(ms => ms.filter(m => m.id !== id));
  // Premissas only. Restoring the machine list here would push TorresBee's
  // equipment onto whatever store is open — the bug this screen just had.
  const resetDefaults = () => {
    setRate(18); setWeeks(52);
    if (showToast) showToast("Premissas de ROI restauradas", "success");
  };

  const results = machines.map(m => ({ m, r: roiCalc(m, rate, weeks) }));
  const totalCapex = results.reduce((s, x) => s + x.r.capex, 0);
  const totalSavings = results.reduce((s, x) => s + Math.max(0, x.r.annualNet), 0);
  const blendedRoi = totalCapex > 0 ? (totalSavings * 3 - totalCapex) / totalCapex * 100 : 0;
  const best = results.filter(x => isFinite(x.r.months)).sort((a, b) => a.r.months - b.r.months)[0];

  const sectionLabel = { fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text3)", margin: "26px 0 14px" };

  const numField = (m, key, label, unit, prefix) => (
    <div>
      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        {prefix && <span style={{ color: "var(--text3)", fontSize: 13 }}>{prefix}</span>}
        <input className="input" type="number" min="0" style={{ fontFamily: "var(--font-mono)", padding: "6px 9px" }}
          value={m[key]} onChange={e => upd(m.id, key, e.target.value === "" ? "" : +e.target.value)} />
        {unit && <span style={{ color: "var(--text3)", fontSize: 11, whiteSpace: "nowrap" }}>{unit}</span>}
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">CEO Cockpit</div>
          <div className="page-subtitle">Decisões de dono · ROI de investimentos{tenantName ? ` · ${tenantName}` : ""}</div>
        </div>
        <div className="flex gap-8 items-center">
          {syncing && <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text3)" }}>sincronizando…</span>}
          <button className="btn btn-outline btn-sm" onClick={resetDefaults}>↺ Restaurar premissas</button>
          <button className="btn btn-primary btn-sm" onClick={addMachine}><Icon name="plus" size={13} /> Máquina</button>
        </div>
      </div>

      <div style={sectionLabel}>ROI de Equipamentos</div>

      <div className="card" style={{ marginBottom: 18, display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text3)", marginBottom: 6 }}>Custo mão de obra</div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ color: "var(--text3)" }}>{currencySymbol()}</span>
            <input className="input" type="number" step="0.5" min="0" style={{ width: 90, fontFamily: "var(--font-mono)" }}
              value={rate} onChange={e => setRate(e.target.value === "" ? 0 : +e.target.value)} />
            <span style={{ color: "var(--text3)", fontSize: 12 }}>/hora (carregado)</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text3)", marginBottom: 6 }}>Semanas / ano</div>
          <input className="input" type="number" step="1" min="0" style={{ width: 90, fontFamily: "var(--font-mono)" }}
            value={weeks} onChange={e => setWeeks(e.target.value === "" ? 0 : +e.target.value)} />
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text3)", maxWidth: 320, lineHeight: 1.5 }}>
          A economia considera só a mão de obra liberada. Ganho de capacidade, venda extra e menos desperdício ficam de fora — são upside.
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card kpi-blue">
          <div className="kpi-label">Investimento total</div>
          <div className="kpi-value">{fmt(totalCapex)}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>{machines.length} máquina{machines.length === 1 ? "" : "s"} avaliada{machines.length === 1 ? "" : "s"}</div>
        </div>
        <div className="kpi-card kpi-accent">
          <div className="kpi-label">Economia / ano</div>
          <div className="kpi-value" style={{ color: "var(--accent)" }}>{fmt(totalSavings)}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>mão de obra liberada</div>
        </div>
        <div className="kpi-card kpi-yellow">
          <div className="kpi-label">Melhor payback</div>
          <div className="kpi-value">{best ? `${roiMonths(best.r.months)} ${roiMonthsUnit(best.r.months)}` : "—"}</div>
          <div className="kpi-delta" style={{ color: "var(--text3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{best ? best.m.name : "sem economia"}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">ROI em 3 anos</div>
          <div className="kpi-value" style={{ color: blendedRoi >= 0 ? "var(--accent)" : "var(--red)" }}>{blendedRoi >= 0 ? "+" : ""}{Math.round(blendedRoi)}%</div>
          <div className="kpi-delta" style={{ color: "var(--text3)" }}>carteira combinada</div>
        </div>
      </div>

      {machines.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "34px 20px" }}>
          <div style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Nenhuma máquina avaliada</div>
          <div style={{ fontSize: 12.5, color: "var(--text3)", maxWidth: 420, margin: "0 auto 16px", lineHeight: 1.5 }}>
            Adicione um equipamento que você está considerando comprar e informe o tempo gasto hoje à mão. O payback é calculado com as premissas acima.
          </div>
          <button className="btn btn-primary btn-sm" onClick={addMachine}><Icon name="plus" size={13} /> Adicionar máquina</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 16 }}>
        {results.map(({ m, r }) => {
          const v = roiVerdict(r.months);
          const barPct = !isFinite(r.months) ? 100 : Math.min(100, (r.months / 48) * 100);
          return (
            <div key={m.id} className="card" style={{ padding: 0, overflow: "hidden", borderColor: `color-mix(in srgb, ${v.c} 35%, var(--border))` }}>
              <div style={{ padding: "16px 18px 14px", borderBottom: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between" style={{ gap: 8 }}>
                  <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text3)" }}>{m.now}</div>
                  <button className="btn btn-ghost" style={{ padding: "2px 6px" }} title="Remover" onClick={() => removeMachine(m.id)}><Icon name="close" size={13} /></button>
                </div>
                <input value={m.name} onChange={e => upd(m.id, "name", e.target.value)}
                  style={{ width: "100%", border: "none", background: "transparent", color: "var(--text)", fontSize: 17, fontWeight: 600, fontFamily: "var(--font-sans)", letterSpacing: "-0.01em", outline: "none", margin: "5px 0 2px", padding: 0 }} />
                <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.45 }}>{m.desc}</div>
              </div>

              <div style={{ padding: "14px 18px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
                {numField(m, "equip", "Equipamento", "", currencySymbol())}
                {numField(m, "setup", "Instalação/frete", "", currencySymbol())}
                {numField(m, "manual", "Tempo manual", "min/dia", "")}
                {numField(m, "machine", "Tempo c/ máquina", "min/dia", "")}
                {numField(m, "days", "Dias de uso", "/sem", "")}
                {numField(m, "maint", "Manutenção", "/ano", currencySymbol())}
              </div>

              <div style={{ padding: "16px 18px 18px", background: "var(--surface2)", borderTop: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between" style={{ gap: 12 }}>
                  <div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 30, fontWeight: 400, lineHeight: 1, color: v.c }}>
                      {roiMonths(r.months)}<span style={{ fontSize: 14, color: "var(--text3)" }}> {roiMonthsUnit(r.months)}</span>
                    </div>
                    <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text3)", marginTop: 5 }}>Payback</div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: v.bg, color: v.c, whiteSpace: "nowrap" }}>{v.t}</span>
                </div>
                <div style={{ height: 6, background: "var(--border)", borderRadius: 999, margin: "13px 0 12px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: barPct + "%", background: v.c, borderRadius: 999, transition: "width 0.2s" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="card card-sm" style={{ padding: "9px 11px" }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 16 }}>{fmt(Math.max(0, r.annualNet))}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 2 }}>Economia / ano</div>
                  </div>
                  <div className="card card-sm" style={{ padding: "9px 11px" }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 16, color: r.roi3 >= 0 ? "var(--text)" : "var(--red)" }}>{r.roi3 >= 0 ? "+" : ""}{Math.round(r.roi3)}%</div>
                    <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 2 }}>ROI 3 anos</div>
                  </div>
                  <div className="card card-sm" style={{ padding: "9px 11px", gridColumn: "1 / -1" }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 14 }}>{fmt(r.capex)} · {Math.round(r.annualHrs)} h/ano poupadas</div>
                    <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 2 }}>Investimento total · mão de obra liberada</div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 10 }}>Como ler</div>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text2)", fontSize: 12.5, lineHeight: 1.6 }}>
          <li><b style={{ color: "var(--text)" }}>Payback ≤ 18 meses</b> = compra recomendada · <b style={{ color: "var(--yellow)" }}>18–36</b> = avaliar volume · <b style={{ color: "var(--red)" }}>&gt; 36</b> = não compensa hoje.</li>
          <li>Preencha os minutos com o tempo <b style={{ color: "var(--text)" }}>real</b> gasto por dia hoje (manual) e o esperado com a máquina. Tudo é salvo na loja — aparece igual em qualquer dispositivo em que você entrar.</li>
          <li>Preços de referência (EUA, jul/2026): boleadora de massa US$1.150 (manual) a US$8.400 (semi-auto) · descascadora 20–22 lb US$1.430–1.680 · porcionadora de brigadeiro (encrustadeira) US$6.800–8.400.</li>
        </ul>
      </div>
    </div>
  );
}

// ─── TENANT SWITCHER — sidebar store selector for multi-store managers ────────
// Replaces the static entity pill. Lists the tenants the logged-in user belongs
// to (r7_user_tenants via RPC); picking one stores the override and reloads so
// the whole app re-inits against the new tenant. Single-tenant users see the
// plain pill, same as before.
function TenantSwitcher() {
  const [tenants, setTenants] = useState([]);
  useEffect(() => {
    if (ENV_TENANT_ID === "demo" && !localStorage.getItem("cfo_active_tenant")) return;
    (async () => {
      try {
        const ids = await getMyTenantIds();
        if (!ids || ids.length === 0) return;
        // Stale override (membership revoked): fall back to the env tenant.
        if (!ids.includes(TENANT_ID)) {
          try { localStorage.removeItem("cfo_active_tenant"); } catch {}
          // Reload AT MOST ONCE. Dropping the override lands us on
          // ENV_TENANT_ID, and nothing guarantees the user belongs to that one
          // either — when they don't, this reloads, fails the same check, and
          // reloads again forever. That is what the page "blinking" is. The
          // flag lives in sessionStorage so it survives the reload but not the
          // tab, and a genuinely stale override still self-heals on one pass.
          let reloadedBefore = false;
          try {
            reloadedBefore = !!sessionStorage.getItem(TENANT_RELOAD_FLAG);
            sessionStorage.setItem(TENANT_RELOAD_FLAG, "1");
          } catch {}
          if (reloadedBefore) {
            console.warn("TenantSwitcher: já recarreguei uma vez e o tenant segue fora da lista — parando para não entrar em loop.", { TENANT_ID, ENV_TENANT_ID, ids });
            return;
          }
          window.location.reload();
          return;
        }
        try { sessionStorage.removeItem(TENANT_RELOAD_FLAG); } catch {}
        const { data } = await supabase.from("r7_tenants").select("id, name, slug").in("id", ids).order("name");
        setTenants(data || []);
      } catch (e) { console.warn("tenant list load failed", e); }
    })();
  }, []);
  const current = tenants.find(t => t.id === TENANT_ID);
  if (tenants.length < 2) {
    return (
      <div className="entity-pill">
        <strong>{current?.name || "TorresBee"}</strong>
        {current ? (current.slug || "") : "Round Rock, TX"}
      </div>
    );
  }
  return (
    <div className="entity-pill">
      <select
        value={TENANT_ID}
        onChange={e => {
          try { localStorage.setItem("cfo_active_tenant", e.target.value); } catch {}
          window.location.reload();
        }}
        title="Switch store"
        style={{ width: "100%", background: "transparent", color: "var(--text)", border: "1px solid var(--border2)", borderRadius: 6, padding: "6px 8px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)" }}
      >
        {tenants.map(t => <option key={t.id} value={t.id} style={{ color: "#111" }}>{t.name}</option>)}
      </select>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("dashboard");
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("favo-cfo-theme") || "dark"; } catch { return "dark"; }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("theme-light", theme === "light");
    try { localStorage.setItem("favo-cfo-theme", theme); } catch {}
  }, [theme]);
  // Auth gate. `session === undefined` means we're still checking; null = logged
  // out; object = logged in. `authorized` = the user belongs to this deploy's
  // tenant. Demo mode skips auth entirely.
  const [session, setSession] = useState(TENANT_ID === "demo" ? null : undefined);
  const [authorized, setAuthorized] = useState(TENANT_ID === "demo");
  useEffect(() => {
    if (TENANT_ID === "demo") return;
    // Supabase hands back a brand-new session object on every auth event, and
    // TOKEN_REFRESHED fires on a timer and on tab focus. Storing it verbatim
    // re-ran the membership check below for a session that had not actually
    // changed, so keep the previous object while the access token is the same.
    const store = (next) => setSession(prev =>
      prev && next && prev.access_token === next.access_token ? prev : next);
    supabase.auth.getSession().then(({ data }) => store(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => store(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (TENANT_ID === "demo") return;
    if (!session) { setAuthorized(false); return; }
    let cancelled = false;
    // ids === null means the RPC failed (commonly: token mid-refresh, so
    // auth.uid() is null and the query returns nothing). Revoking on that
    // unmounted the whole app for a frame and made the screen blink. Only an
    // actual logout — the !session branch above — closes the gate.
    getMyTenantIds().then(ids => {
      if (cancelled || ids === null) return;
      setAuthorized(ids.includes(TENANT_ID) || ids.length > 0);
    });
    return () => { cancelled = true; };
  }, [session]);

  // Country pack reconciliation. initCountry() already applied the cached pack
  // synchronously at module load, so this only does visible work the first time
  // a tenant is opened on this device, or when its country actually changes in
  // the DB. The bump forces one re-render because the pack is a module
  // singleton that React can't see.
  const [countryRev, bumpCountry] = useState(0);
  const [tenantName, setTenantName] = useState("");
  useEffect(() => {
    if (TENANT_ID === "demo") return;
    if (!authorized) return;
    let cancelled = false;
    fetchTenant(TENANT_ID).then(t => {
      if (cancelled || !t) return;
      setTenantName(t.name || "");
      if (setCountryFromTenant(TENANT_ID, t)) bumpCountry(n => n + 1);
    });
    return () => { cancelled = true; };
  }, [authorized]);

  // A screen the active country doesn't support (stale state, or the pack
  // arriving late and turning out to be BR) falls back to the dashboard rather
  // than rendering a US-only report against BR data. Depends on countryRev so
  // it re-checks when the pack swaps, not only when the user navigates.
  useEffect(() => {
    if (!supports(screen)) setScreen("dashboard");
  }, [screen, countryRev]);

  const [transactions, setTransactions] = useState(SAMPLE_TRANSACTIONS);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [budgets, setBudgets] = useState(SAMPLE_BUDGETS);
  const [bills, setBills] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [laborShifts, setLaborShifts] = useState([]);
  const [payrollRuns, setPayrollRuns] = useState([]);
  const [tipsDaily, setTipsDaily] = useState([]);
  const YEAR_NOW = new Date().getFullYear();
  const [projects, setProjects] = useState([
    { id:"p1", title:"Launch Catering Service", category:"Revenue Growth", month:5, year:YEAR_NOW, status:"Planning", impact:"High", investment:2500, projectedRevenue:8000, notes:"Target corporate clients in Round Rock tech corridor.", cashRequired:2500, roi:220 },
    { id:"p2", title:"Google Ads Campaign", category:"Marketing", month:5, year:YEAR_NOW, status:"Idea", impact:"High", investment:800, projectedRevenue:4000, notes:"Target 'Brazilian restaurant Round Rock' keywords. Budget $200/week.", cashRequired:800, roi:400 },
    { id:"p3", title:"Install Inventory System", category:"Operations", month:6, year:YEAR_NOW, status:"Idea", impact:"Medium", investment:1200, projectedRevenue:0, notes:"Reduce food waste 15-20%. Estimated monthly savings: $400.", cashRequired:1200, roi:0 },
    { id:"p4", title:"QR Code Menu + Online Ordering", category:"Technology", month:7, year:YEAR_NOW, status:"Idea", impact:"Medium", investment:500, projectedRevenue:2000, notes:"Reduce labor on order taking. Increase check average.", cashRequired:500, roi:300 },
  ]);
  const [toast, setToast] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [realtimeActive, setRealtimeActive] = useState(false);
  const [dateRange, setDateRange] = useState({ start: firstOfMonth(), end: today() });

  // ── Core load function ─────────────────────────────────────
  const loadAll = useCallback(async (showSpinner = true) => {
    if (TENANT_ID === "demo") return;
    if (showSpinner) setSyncing(true);
    try {
      const [txns, cats, bgts, bls, projs, recs, accs, shifts, payrolls, tips, posShifts] = await Promise.all([
        fetchTransactions(TENANT_ID, dateRange),
        fetchCategories(TENANT_ID),
        fetchBudgets(TENANT_ID),
        fetchBills(TENANT_ID),
        fetchProjects(TENANT_ID),
        fetchRecurring(TENANT_ID),
        fetchBankAccounts(TENANT_ID),
        fetchLaborShifts(TENANT_ID, dateRange),
        fetchPayrollRuns(TENANT_ID),
        fetchTipsDaily(TENANT_ID, dateRange),
        // Bridge from favo-pos team mgmt (#21.3). Native punches merge
        // into the same shifts array so Labor renders both providers
        // uniformly. Each row carries source='square' or 'pos_punch' so
        // future filters can split / dedup as needed.
        fetchPosPunchShifts(TENANT_ID, dateRange),
      ]);
      // Merge DB rows with whatever is in local state. A naive replace would
      // drop transactions that were just imported but haven't finished their
      // async upsertTransactions round-trip yet — exactly what happens when
      // categorising one row triggers a realtime push that fires loadAll
      // before the bulk save settles.
      const mappedTxns = txns.map(t => ({ ...t, category: t.category_id || UNCATEGORIZED, recurring_id: t.recurring_id || null, account_id: t.account_id || null, prior_period: t.prior_period || false, tags: Array.isArray(t.tags) ? t.tags : [] }));
      setTransactions(prev => {
        if (mappedTxns.length === 0) return prev;
        const dbIds = new Set(mappedTxns.map(t => t.id));
        const localOnly = prev.filter(t => !dbIds.has(t.id));
        return [...mappedTxns, ...localOnly];
      });
      if (cats.length > 0)  setCategories(cats.map(c => ({ ...c, id: c.name === "Uncategorized" ? UNCATEGORIZED : c.id, taxLine: c.tax_line || "" })));
      if (bgts.length > 0)  setBudgets(bgts.map(b => ({ ...b, categoryId: b.category_id })));
      if (bls.length > 0)   setBills(bls.map(b => ({ ...b, dueDate: b.due_date, issueDate: b.issue_date, txnId: b.txn_id, category: b.category_id, paidDate: b.paid_date, paidMethod: b.paid_method })));
      if (projs.length > 0) setProjects(projs.map(p => ({ ...p, projectedRevenue: p.projected_revenue })));
      setRecurring(recs);
      setBankAccounts(accs);
      // Merge Square mirror + POS-native punch shifts, sorted by start.
      const merged = [...shifts, ...(posShifts || [])]
        .sort((a, b) => new Date(b.start_at) - new Date(a.start_at));
      setLaborShifts(merged);
      setPayrollRuns(payrolls);
      setTipsDaily(tips);
    } catch (err) {
      console.error("loadAll failed:", err);
    } finally {
      if (showSpinner) setSyncing(false);
      setLastSync(new Date());
    }
  }, [dateRange]);

  // ── 1. Initial load + reload when dateRange changes ────────
  useEffect(() => { loadAll(true); }, [dateRange]);

  // ── 2. Polling every 30 seconds (silent refresh) ───────────
  useEffect(() => {
    if (TENANT_ID === "demo") return;
    const interval = setInterval(() => loadAll(false), 30000);
    return () => clearInterval(interval);
  }, [loadAll]);

  // ── 3. Refresh when tab becomes visible (user returns) ─────
  useEffect(() => {
    if (TENANT_ID === "demo") return;
    const onVisible = () => { if (document.visibilityState === "visible") loadAll(false); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadAll]);

  // ── 4. Supabase real-time subscriptions ────────────────────
  useEffect(() => {
    if (TENANT_ID === "demo") return;
    const channel = supabase
      .channel("favo-cfo-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "r7_ledger_transactions", filter: `tenant_id=eq.${TENANT_ID}` },
        () => loadAll(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "r7_ledger_accounts", filter: `tenant_id=eq.${TENANT_ID}` },
        () => loadAll(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "r7_ledger_budgets", filter: `tenant_id=eq.${TENANT_ID}` },
        () => loadAll(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "r7_ledger_bills", filter: `tenant_id=eq.${TENANT_ID}` },
        () => loadAll(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "r7_ledger_projects", filter: `tenant_id=eq.${TENANT_ID}` },
        () => loadAll(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "r7_ledger_recurring", filter: `tenant_id=eq.${TENANT_ID}` },
        () => loadAll(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "r7_ledger_bank_accounts", filter: `tenant_id=eq.${TENANT_ID}` },
        () => loadAll(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "r7_labor_shifts", filter: `tenant_id=eq.${TENANT_ID}` },
        () => loadAll(false))
      // Bridge from favo-pos: native punches stream into Labor too.
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_time_punches", filter: `tenant_id=eq.${TENANT_ID}` },
        () => loadAll(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "r7_payroll_runs", filter: `tenant_id=eq.${TENANT_ID}` },
        () => loadAll(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "r7_labor_tips_daily", filter: `tenant_id=eq.${TENANT_ID}` },
        () => loadAll(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "r7_square_payouts", filter: `tenant_id=eq.${TENANT_ID}` },
        () => loadAll(false))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { console.log("Favo CFO: real-time active"); setRealtimeActive(true); }
        if (status === "CLOSED" || status === "CHANNEL_ERROR") setRealtimeActive(false);
      });
    return () => supabase.removeChannel(channel);
  }, [loadAll]);

  // ── Save helpers ────────────────────────────────────────────
  // Bubble the supabase error up to the UI so silent failures during an
  // import stop being invisible. Anderson saw 50 imported rows survive in the
  // client but only 2 actually persisted — the rest were rejected by Postgres
  // and the toast layer never knew.
  const saveTransactions = async (txns) => {
    if (TENANT_ID === "demo") return { ok: true, saved: txns.length, demo: true };
    const result = await upsertTransactions(txns, TENANT_ID);
    if (!result.ok) {
      showToast(`Save failed: ${result.error || "unknown error"} (${result.rows || txns.length} rows lost)`, "error");
    } else if (txns.length > 1 && result.saved < txns.length) {
      showToast(`Saved ${result.saved} of ${txns.length} — ${txns.length - result.saved} rejected by the database`, "error");
    }
    return result;
  };

  const saveCategory = async (cat) => {
    if (TENANT_ID === "demo") return;
    await upsertCategory(cat, TENANT_ID);
  };

  const saveBudget = async (budget) => {
    if (TENANT_ID === "demo") return;
    await upsertBudget(budget, TENANT_ID);
  };

  const saveBill = async (bill) => {
    if (TENANT_ID === "demo") return;
    await upsertBill(bill, TENANT_ID);
  };

  // Kitchen purchases → bills (Accounts Payable).
  //
  // This used to live inside the Bills screen, which meant the AP list only
  // materialised once the operator opened that tab — and the Transactions
  // invoice matcher had nothing to match against on a cold load. It belongs to
  // the App: one owner, every screen sees the same list.
  //
  // Derived, not persisted: a bill only reaches r7_ledger_bills when something
  // happens to it (paid, matched, edited). Writing every Kitchen purchase here
  // would duplicate Kitchen's data and leave orphans when a purchase is
  // deleted there.
  useEffect(() => {
    const kitchenTxns = transactions.filter(t => t.source === "kitchen_purchase");
    if (kitchenTxns.length === 0) return;
    setBills(prev => {
      const existingTxnIds = new Set(prev.map(b => b.txnId));
      const newBills = kitchenTxns
        .filter(t => !existingTxnIds.has(t.id))
        .map(t => ({
          id: "bill_" + t.id,
          txnId: t.id,
          vendor: t.description,
          amount: Math.abs(t.amount),
          dueDate: t.date,
          issueDate: t.date,
          status: "due",
          category: t.category,
          paidDate: null,
          paidMethod: null,
          notes: t.notes || "",
          source: "kitchen",
        }));
      return newBills.length > 0 ? [...prev, ...newBills] : prev;
    });
  }, [transactions]);

  const saveProject = async (project) => {
    if (TENANT_ID === "demo") return;
    await upsertProject(project, TENANT_ID);
  };

  const saveRecurring = async (rule) => {
    if (TENANT_ID === "demo") return;
    await upsertRecurring(rule, TENANT_ID);
  };

  const saveBankAccount = async (account) => {
    if (TENANT_ID === "demo") return;
    await upsertBankAccount(account, TENANT_ID);
  };

  // ── Kitchen sync handler ────────────────────────────────────
  const handleKitchenSync = async (imported) => {
    const linked = applyAccountLink(imported, bankAccounts);
    const existingIds = new Set(transactions.map(t => t.id));
    const newOnes = linked.filter(t => !existingIds.has(t.id));
    if (newOnes.length > 0) {
      setTransactions(prev => [...newOnes, ...prev]);
      await saveTransactions(newOnes);
    }
  };

  // ── Marketing sync handler ──────────────────────────────────
  // Apply recurring match + auto-categorize so accruals pick up a
  // "Marketing" category automatically when the user has one defined.
  // IDs are deterministic (per ad_account x month) so repeated syncs upsert
  // the same row — first sync creates, follow-ups refresh the amount.
  const handleMarketingSync = async (imported) => {
    const linked = applyAccountLink(imported, bankAccounts);
    const matched = applyRecurringMatch(linked, recurring);
    const enriched = applyAutoCategorize(matched, transactions);
    const existingMap = new Map(transactions.map(t => [t.id, t]));
    const fresh = enriched.filter(t => !existingMap.has(t.id));
    const updated = enriched.filter(t => {
      const existing = existingMap.get(t.id);
      return existing && (parseFloat(existing.amount) !== parseFloat(t.amount) || existing.notes !== t.notes);
    });
    const toPersist = [...fresh, ...updated];
    if (toPersist.length === 0) return;
    setTransactions(prev => {
      const next = prev.map(t => {
        const m = enriched.find(x => x.id === t.id);
        return m ? { ...t, ...m } : t;
      });
      const existingIds = new Set(next.map(t => t.id));
      const onlyNew = enriched.filter(t => !existingIds.has(t.id));
      return [...onlyNew, ...next];
    });
    await saveTransactions(toPersist);
  };

  const showToast = (message, type = "info") => setToast({ message, type, id: Date.now() });

  // ── Filter transactions by date range ──────────────────────
  const filteredByDate = transactions.filter(t => t.date >= dateRange.start && t.date <= dateRange.end);
  // Same window but using the accrual date — used by reports that should show
  // operational performance per period (P&L, Tax Summary). A row flagged as
  // prior_period gets pulled back into the previous month via accrualDate().
  const filteredByAccrual = transactions.filter(t => {
    const d = accrualDate(t);
    return d >= dateRange.start && d <= dateRange.end;
  });
  const uncat = filteredByDate.filter(t => t.category === UNCATEGORIZED || !t.category).length;

  const NAV = [
    { id: "dashboard", label: "Overview", icon: "dashboard" },
    { id: "insights", label: "CFO Insights", icon: "insights" },
    { id: "ceo", label: "CEO Cockpit", icon: "ceo" },
    { id: "bookkeeper", label: "Bookkeeper", icon: "bookkeeper" },
    { id: "labor", label: "Labor", icon: "labor" },
    { id: "payroll", label: "Payroll", icon: "bills", indent: 1 },
    { id: "tips", label: "Tips", icon: "bills", indent: 2 },
    { id: "projects", label: "Projects", icon: "projects" },
    { id: "transactions", label: "Transactions", icon: "transactions", badge: uncat > 0 ? uncat : null },
    { id: "categories", label: "Chart of Accounts", icon: "categories" },
    { id: "pl", label: "Profit & Loss", icon: "pl" },
    { id: "trends", label: "Trends", icon: "trends" },
    { id: "cashflow", label: "Cash Flow", icon: "cashflow" },
    { id: "budget", label: "Budget", icon: "budget" },
    { id: "bills", label: "Bills & Payments", icon: "bills", badge: null },
    { id: "recurring", label: "Recurring", icon: "recurring", badge: recurring.filter(r => r.status === "active").length || null },
    { id: "accounts", label: "Bank Accounts", icon: "wallet", badge: bankAccounts.filter(a => a.status === "active").length || null },
    { id: "favobank", label: "Favo Bank", icon: "bank" },
    { id: "reconcile", label: "Reconciliation", icon: "reconcile" },
    { id: "tax", label: "Tax Summary", icon: "tax" },
  ].filter(item => supports(item.id));

  const renderScreen = () => {
    switch (screen) {
      case "insights":     return <Insights transactions={filteredByAccrual} allTransactions={transactions} categories={categories} budgets={budgets} recurring={recurring} tenantId={TENANT_ID} dateRange={dateRange} />;
      case "ceo":          return <CEO tenantId={TENANT_ID} tenantName={tenantName} showToast={showToast} />;
      case "bookkeeper":   return <Bookkeeper transactions={filteredByAccrual} allTransactions={transactions} categories={categories} setTransactions={setTransactions} saveTransactions={saveTransactions} tenantId={TENANT_ID} dateRange={dateRange} setScreen={setScreen} showToast={showToast} />;
      case "labor":        return <Labor shifts={laborShifts} transactions={filteredByDate} categories={categories} tenantId={TENANT_ID} dateRange={dateRange} onSync={() => loadAll(true)} showToast={showToast} />;
      case "tips":         return <Tips tipsDaily={tipsDaily} shifts={laborShifts} tenantId={TENANT_ID} dateRange={dateRange} onSync={() => loadAll(false)} showToast={showToast} />;
      case "payroll":      return <Payroll runs={payrollRuns} shifts={laborShifts} tipsDaily={tipsDaily} transactions={transactions} categories={categories} setTransactions={setTransactions} saveTransactions={saveTransactions} tenantId={TENANT_ID} onChange={() => loadAll(false)} showToast={showToast} />;
      case "projects":     return <Projects transactions={filteredByDate} projects={projects} setProjects={setProjects} saveProject={saveProject} deleteProjectDB={async(id)=>{setProjects(p=>p.filter(x=>x.id!==id));if(TENANT_ID!=="demo")await deleteProject(id);}} categories={categories} dateRange={dateRange} />;
      case "dashboard":    return <Dashboard transactions={filteredByAccrual} allTransactions={transactions} categories={categories} budgets={budgets} bankAccounts={bankAccounts} dateRange={dateRange} />;
      case "transactions": return <Transactions transactions={filteredByDate} allTransactions={transactions} setTransactions={setTransactions} saveTransactions={saveTransactions} deleteTxn={async(id)=>{if(TENANT_ID!=="demo")await deleteTransaction(id);}} categories={categories} recurring={recurring} bankAccounts={bankAccounts} bills={bills} setBills={setBills} saveBill={saveBill} tenantId={TENANT_ID} dateRange={dateRange} setDateRange={setDateRange} showToast={showToast} payrollRuns={payrollRuns} />;
      case "categories":   return <Categories categories={categories} setCategories={setCategories} saveCategory={saveCategory} deleteCategory={async(id)=>{setCategories(p=>p.filter(c=>c.id!==id));if(TENANT_ID!=="demo")await deleteCategory(id);}} transactions={filteredByDate} showToast={showToast} />;
      case "pl":           return <PLReport transactions={filteredByAccrual} allTransactions={transactions} categories={categories} dateRange={dateRange} setTransactions={setTransactions} deleteTxn={async(id)=>{if(TENANT_ID!=="demo")await deleteTransaction(id);}} payrollRuns={payrollRuns} tenantId={TENANT_ID} showToast={showToast} />;
      case "trends":       return <Trends tenantId={TENANT_ID} categories={categories} allTransactions={transactions} />;
      case "cashflow":     return <CashFlow transactions={filteredByDate} categories={categories} recurring={recurring} dateRange={dateRange} />;
      case "budget":       return <Budget transactions={filteredByDate} categories={categories} budgets={budgets} setBudgets={setBudgets} saveBudget={saveBudget} showToast={showToast} />;
      case "bills":        return <Bills transactions={filteredByDate} setTransactions={setTransactions} bills={bills} setBills={setBills} saveBill={saveBill} deleteB={async(id)=>{setBills(p=>p.filter(b=>b.id!==id));if(TENANT_ID!=="demo")await deleteBill(id);}} categories={categories} dateRange={dateRange} showToast={showToast} saveTransactions={saveTransactions} />;
      case "recurring":    return <Recurring recurring={recurring} setRecurring={setRecurring} saveRecurring={saveRecurring} deleteR={async(id)=>{setRecurring(p=>p.filter(r=>r.id!==id));if(TENANT_ID!=="demo")await deleteRecurring(id);}} categories={categories} transactions={transactions} showToast={showToast} />;
      case "accounts":     return <BankAccounts accounts={bankAccounts} setAccounts={setBankAccounts} saveBankAccount={saveBankAccount} deleteAcc={async(id)=>{setBankAccounts(p=>p.filter(a=>a.id!==id));if(TENANT_ID!=="demo")await deleteBankAccount(id);}} transactions={transactions} showToast={showToast} />;
      case "favobank":     return <FavoBank tenantId={TENANT_ID} onSync={() => loadAll(false)} showToast={showToast} />;
      case "reconcile":    return <Reconciliation transactions={filteredByDate} setTransactions={setTransactions} saveTransactions={saveTransactions} categories={categories} tenantId={TENANT_ID} dateRange={dateRange} showToast={showToast} />;
      case "tax":          return <TaxSummary transactions={filteredByAccrual} allTransactions={transactions} categories={categories} dateRange={dateRange} />;
      default: return null;
    }
  };

  // ── Auth gate (skipped in demo) ─────────────────────────────
  if (TENANT_ID !== "demo") {
    if (session === undefined) {
      return (<><style>{STYLES}</style><div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", color: "var(--text3)", fontFamily: "var(--font-mono)", fontSize: 13 }}>Loading…</div></>);
    }
    if (!session) return <LoginScreen />;
    if (!authorized) {
      return (
        <><style>{STYLES}</style>
          <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 20 }}>
            <div className="card" style={{ maxWidth: 420, padding: 32, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>No access</div>
              <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 20 }}>Your account isn't linked to this restaurant. Ask an admin to add you in the team settings.</div>
              <button className="btn btn-outline btn-sm" onClick={() => signOutUser()}>Sign out</button>
            </div>
          </div>
        </>
      );
    }
  }

  return (
    <>
      <style>{STYLES}</style>
      <div className="layout">
        <nav className="sidebar">
          <div className="sidebar-logo">
            <div className="logo-icon">
              <FavoMark size={34} />
            </div>
            <div className="logo-text">
              <div className="logo-mark">Favo<span className="logo-dot">.</span></div>
              <div className="logo-sub">CFO</div>
            </div>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-label">Finance</div>
            {NAV.map(item => {
              const indent = item.indent || 0;
              return (
                <div
                  key={item.id}
                  className={`nav-item ${screen === item.id ? "active" : ""}`}
                  onClick={() => setScreen(item.id)}
                  style={indent > 0 ? { paddingLeft: 10 + indent * 18, position: "relative" } : undefined}
                >
                  {indent > 0 && (
                    <span style={{
                      position: "absolute",
                      left: 10 + (indent - 1) * 18 + 4,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 8,
                      height: 1,
                      background: "var(--border2)",
                    }} />
                  )}
                  <span className="nav-icon"><Icon name={item.icon} size={15} /></span>
                  <span>{item.label}</span>
                  {item.badge && <span className="nav-badge">{item.badge}</span>}
                </div>
              );
            })}
          </div>

          <div className="sidebar-footer">
            <TenantSwitcher />
            {TENANT_ID !== "demo" && (
              <button className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "center", marginTop: 8, color: "var(--text3)", fontSize: 11 }} onClick={() => signOutUser()}>
                Sign out
              </button>
            )}
          </div>
        </nav>

        <main className="main">
          {/* ── Global Top Bar ── */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "flex-end",
            gap: 10, padding: "14px 32px 0",
            borderBottom: "1px solid var(--border)", marginBottom: 0,
            paddingBottom: 14,
            background: "var(--surface)",
            position: "sticky", top: 0, zIndex: 100
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginRight: "auto" }}>
              {syncing ? (
                <span style={{ fontSize: 11, color: "var(--accent)", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: 5 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 1s linear infinite" }}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                  Syncing...
                </span>
              ) : (
                <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: realtimeActive ? "var(--accent)" : "var(--text3)", display: "inline-block" }} title={realtimeActive ? "Real-time connected" : "Polling mode"} />
                  {lastSync ? "Updated " + ctryTime(lastSync) : ""}
                  {realtimeActive && <span style={{ color: "var(--accent)" }}>· Live</span>}
                </span>
              )}
              <button className="btn btn-ghost" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => loadAll(true)} title="Refresh data">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              </button>
            </div>
            <KitchenSyncButton
              tenantId={TENANT_ID}
              categories={categories}
              dateRange={dateRange}
              onSync={handleKitchenSync}
              showToast={showToast}
            />
            <SalesSyncButton
              tenantId={TENANT_ID}
              dateRange={dateRange}
              onSync={() => loadAll(false)}
              showToast={showToast}
            />
            <MarketingSyncButton
              tenantId={TENANT_ID}
              dateRange={dateRange}
              onSync={handleMarketingSync}
              showToast={showToast}
            />
            <BankSyncButton
              tenantId={TENANT_ID}
              onSync={() => loadAll(false)}
              showToast={showToast}
            />
            <button
              className="btn btn-ghost btn-sm"
              style={{ padding: "6px 10px", color: "var(--text2)" }}
              onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
              title={theme === "dark" ? "Switch to Day theme" : "Switch to Night theme"}
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} size={14} />
            </button>
            <DateRangePicker dateRange={dateRange} setDateRange={setDateRange} />
          </div>
          {renderScreen()}
        </main>
      </div>

      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
