// ─── UNITED STATES ───────────────────────────────────────────────────────────
//
// Pure extraction of what was hardcoded in App.jsx. Every value here must match
// the previous literal exactly — the reporting-line strings in particular are
// stable identifiers persisted in r7_ledger_accounts.tax_line, so renaming one
// unmaps existing categories from the Tax Summary report. Add, never rename.

import { UNCATEGORIZED } from "../constants.js";

export const US = {
  code: "US",
  label: "United States",
  currency: "USD",
  symbol: "$",
  locale: "en-US",
  decimalSep: ".",
  dateOrder: "MDY",
  hour12: true,
  timezone: "America/Chicago",
  taxRegimeLabel: "Filing basis",
  taxRegimes: ["Schedule C"],

  compactMoney: (k) => "$" + k + "k",

  // IRS Schedule C 2024/2025. Income = Part I lines, COGS = Part III aggregate,
  // Expenses = Part II lines 8–27.
  reportingLineLabel: "Tax Line (Schedule C)",
  // Which reporting line the P&L treats as cost of goods sold. Everything
  // else lands in operating expenses, so this drives gross margin.
  cogsLine: "COGS",
  // Every reporting line that is really the cost of putting people to work.
  // Prime cost = cogsLine + these, so a line missing here understates it.
  laborLines: ["Wages", "Employee Benefits", "Contract Labor", "Pension & Profit-Sharing"],
  rentLine: "Rent",
  // Food cost vs COGS. Both are COGS-line categories; a beverage category is
  // one whose NAME says so and does not also say food ("Food & Beverage" is
  // the mixed default and stays on the food side). Beverage runs 15-25% of
  // its sales while food runs 28-35%, so a blended number hides either.
  beverageRe: /beverage|drink|liquor|wine|beer|\bbar\b|soda|coffee/i,
  foodRe: /food|produce|meat|grocer|ingredient/i,
  reportingLines: {
    incomeLabel: "Income (Part I)",
    expenseLabel: "Expenses (Part II) & COGS (Part III)",
    income: ["Gross Receipts", "Returns and Allowances", "Other Income"],
    expense: [
      "Advertising",
      "Car and Truck Expenses",
      "COGS",
      "Commissions and Fees",
      "Contract Labor",
      "Depletion",
      "Depreciation",
      "Employee Benefits",
      "Insurance",
      "Legal & Professional Services",
      "Meals",
      "Mortgage Interest",
      "Office Expense",
      "Other Expenses",
      "Other Interest",
      "Pension & Profit-Sharing",
      "Rent",
      "Rent - Vehicles/Equipment",
      "Repairs & Maintenance",
      "Supplies",
      "Taxes & Licenses",
      "Travel",
      "Utilities",
      "Wages",
    ],
  },

  defaultCategories: [
    { id: "1", name: "Food & Beverage", type: "expense", color: "#f05e5e", taxLine: "COGS" },
    { id: "2", name: "Payroll", type: "expense", color: "#f0c84a", taxLine: "Wages" },
    { id: "3", name: "Rent & Utilities", type: "expense", color: "#4a9ff0", taxLine: "Rent" },
    { id: "4", name: "Marketing", type: "expense", color: "#a47ff0", taxLine: "Advertising" },
    { id: "5", name: "Equipment", type: "expense", color: "#f0904a", taxLine: "Depreciation" },
    { id: "6", name: "Insurance", type: "expense", color: "#4af0d0", taxLine: "Insurance" },
    { id: "7", name: "Office & Supplies", type: "expense", color: "#90a0b0", taxLine: "Office Expense" },
    { id: "8", name: "Revenue - Dining", type: "income", color: "#00d4a0", taxLine: "Gross Receipts" },
    { id: "9", name: "Revenue - Delivery", type: "income", color: "#00b890", taxLine: "Gross Receipts" },
    { id: UNCATEGORIZED, name: "Uncategorized", type: "expense", color: "#555b6b", taxLine: "" },
  ],

  paymentMethods: ["Bank Transfer", "Check", "ACH", "Credit Card", "Cash", "Zelle", "Wire Transfer"],
  defaultPaymentMethod: "Bank Transfer",
  // Statement lines that carry a rail but no merchant: the payee is not in the
  // text, so the amount is the only evidence an invoice match can use.
  anonymousDebitRe: /^check\s*#?\s*\d+|\bzelle\b|\bach\b|\bwire\b|online banking|bill\s?pay|\btransfer\b/i,
  // Words in a vendor's legal name that say nothing about who it is. Dropped
  // before a bill's vendor is matched against a statement line, so "US
  // Foods, Inc." is matched on FOODS, not on INC.
  vendorStopWords: ["THE", "INC", "LLC", "CORP", "CO", "COM", "LTD", "COMPANY", "AND", "OF"],

  importedAccountLabel: "Imported · BoA",

  // Screens gated on country. US has the full stack.
  capabilities: {
    bookkeeper: true,
    tax: true,
    payroll: true,
    labor: true,
    tips: true,
    favobank: true,
  },
};
