// Shared aggregator-statement parsing — the Anthropic call, the per-platform
// prompt hints and the normalization of what comes back.
//
// Two entry points use it:
//   parse-aggregator-statement.js  operator drops a file in Reconciliation
//   ingest-aggregator-email.js     the payout email arrives on its own
//
// Underscore prefix keeps Vercel from turning this into a route — it has no
// default handler, it's a library the two functions import.

export const num = (v) => {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const cleaned = String(v).replace(/[$,()]/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
};

// Filename first, then any hint the caller has (email sender + subject, or the
// operator's explicit pick). Caviar is DoorDash's; Seamless is GrubHub's.
export const detectPlatform = (filename = '', hint = '') => {
  const s = (filename + ' ' + hint).toLowerCase();
  if (/doordash|caviar/.test(s)) return 'doordash';
  if (/uber\s*eats|uber-eats|uber_eats|ubereats/.test(s)) return 'ubereats';
  if (/grubhub|seamless/.test(s)) return 'grubhub';
  if (/wix|wixpayments|wixmam/.test(s)) return 'wix';
  return null;
};

// Per-platform hints help Claude pick the right column names. Each block is
// optional — without it the prompt falls back to generic instructions.
const PLATFORM_HINTS = {
  doordash: 'DoorDash uses columns like "Subtotal", "Commission", "Marketing fee", "Delivery fee", "Refunds", "Tax remitted", "Net payout". Payout id is "Settlement ID".',
  ubereats: 'Uber Eats uses "Sales", "Eats Marketplace fee", "Delivery fee", "Service fee", "Refunds", "Net Payout". Payout id is "Payment ID" or "Transfer ID".',
  grubhub:  'GrubHub uses "Order subtotal", "Commission", "Marketing", "Tax", "Adjustments", "Total paid to restaurant". Payout id is "Reference Number".',
  wix:      'Wix Restaurants uses "Sales", "Processing fee", "Refunds", "Net". Payout id is "Payout ID" or "Transaction ID".',
};

// Domains allowed to feed the ingest mailbox. The address is semi-public by
// design — it lives in the DoorDash portal and travels in mail headers — so
// this is what stops someone who learns it from injecting a fake payout.
//
// US-only, like PLATFORM_HINTS above. Both belong in the country pack
// (iFood / Rappi for BR) and move there together in Phase 3.
const SENDER_DOMAINS = [
  'doordash.com', 'caviar.com',
  'uber.com', 'ubereats.com',
  'grubhub.com', 'seamless.com',
  'wix.com', 'wixpayments.com',
];

// Accepts "Name <no-reply@doordash.com>" and bare addresses. Subdomains count
// (payments.doordash.com), lookalikes don't (doordash.com.evil.net) — the
// boundary check is on a literal dot prefix.
export const senderAllowed = (from = '') => {
  const match = String(from).match(/[^\s<>@]+@([^\s<>]+)/);
  if (!match) return false;
  const domain = match[1].toLowerCase().replace(/[.>]+$/, '');
  return SENDER_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d));
};

const buildPrompt = (platform) => {
  const platformLine = platform && PLATFORM_HINTS[platform]
    ? `Platform hint: ${platform.toUpperCase()} — ${PLATFORM_HINTS[platform]}`
    : 'Platform: unknown — figure out which delivery platform this is from the headers.';

  return `You're extracting payout details from a food-delivery platform statement.
${platformLine}

Return ONLY a JSON object — no preamble, no markdown. Schema:

{
  "platform": "doordash" | "ubereats" | "grubhub" | "wix" | "other",
  "period_start": "YYYY-MM-DD" | null,
  "period_end":   "YYYY-MM-DD" | null,
  "payouts": [
    {
      "payout_id":     "platform-specific id, or null",
      "arrival_date":  "YYYY-MM-DD",
      "gross_sales":   <number>,
      "commission":    <number>,
      "marketing_fee": <number>,
      "delivery_fee":  <number>,
      "refunds":       <number>,
      "tax_remitted":  <number>,
      "other_fees":    <number>,
      "net_payout":    <number>
    }
  ],
  "totals": {
    "gross_sales":   <number>,
    "commission":    <number>,
    "marketing_fee": <number>,
    "delivery_fee":  <number>,
    "refunds":       <number>,
    "tax_remitted":  <number>,
    "other_fees":    <number>,
    "net_payout":    <number>
  }
}

Rules:
- ONLY a payout/settlement document counts. A payout needs explicit settlement
  context: words like payout, payment, deposit, transfer, settlement, paid to
  you. Sales/performance summaries ("Daily Summary", total sales, order counts),
  promotions and marketing emails are NOT payouts — for those return
  {"platform": "other", "payouts": [], "totals": null} and nothing else.
- NEVER guess a year. If a date has no year, or you cannot read a full
  YYYY-MM-DD from the document, use null — an invented date corrupts a ledger.
- All money values are POSITIVE numbers (no signs, no parentheses).
- net_payout = gross_sales - commission - marketing_fee - refunds - other_fees + delivery_fee_passthrough (varies per platform).
- If a field isn't in the document, use 0 (don't invent it).
- Skip any row that's clearly a heading, footer, or total (totals go in the top-level "totals" key).
- If the report covers ONE payout, "payouts" is a single-element array.

Output only the JSON object.`;
};

const normalizePayout = (p) => ({
  payout_id:     p.payout_id || null,
  arrival_date:  p.arrival_date || null,
  gross_sales:   num(p.gross_sales),
  commission:    num(p.commission),
  marketing_fee: num(p.marketing_fee),
  delivery_fee:  num(p.delivery_fee),
  refunds:       num(p.refunds),
  tax_remitted:  num(p.tax_remitted),
  other_fees:    num(p.other_fees),
  net_payout:    num(p.net_payout),
});

// Runs the statement through Claude and hands back a normalized envelope.
// Never throws for expected failures — returns { ok:false, status, error }
// so both callers can map it straight onto an HTTP response.
// onUsage({ model, messageId, usage }) opcional: chamado assim que o Anthropic
// responde (tokens ja gastos, mesmo que o parse falhe depois) — pro metering.
export async function parseStatement({ pdfBase64, csvText, filename, platformHint, apiKey, onUsage }) {
  if (!apiKey) return { ok: false, status: 500, error: 'ANTHROPIC_API_KEY not configured.' };
  if (!pdfBase64 && !csvText) return { ok: false, status: 400, error: 'Either pdfBase64 or csvText is required' };

  const platform = detectPlatform(filename || '', platformHint || '');
  const prompt = buildPrompt(platform);

  try {
    const content = [{ type: 'text', text: prompt }];
    if (pdfBase64) {
      content.unshift({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
      });
    } else if (csvText) {
      // For CSV, include it inline in the prompt
      content[0].text = prompt + '\n\nSTATEMENT CSV:\n\n' + csvText;
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 4096,
        messages: [{ role: 'user', content }],
      }),
    });

    const rawBody = await anthropicRes.text();
    if (!anthropicRes.ok) {
      return { ok: false, status: 502, error: 'Anthropic API error ' + anthropicRes.status, detail: rawBody.slice(0, 300) };
    }

    let apiData;
    try { apiData = JSON.parse(rawBody); }
    catch { return { ok: false, status: 502, error: 'Invalid response from Anthropic', detail: rawBody.slice(0, 200) }; }
    if (onUsage) await onUsage({ model: 'claude-opus-4-5', messageId: apiData.id, usage: apiData.usage });

    const rawText = (apiData.content?.[0]?.text || '').trim();
    if (!rawText) return { ok: false, status: 422, error: 'Empty response — statement may be unreadable.' };

    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      return { ok: false, status: 422, error: 'AI did not return a JSON object.', preview: rawText.slice(0, 400) };
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1'));
    } catch (e) {
      return { ok: false, status: 422, error: 'Could not parse AI response.', detail: e.message, preview: rawText.slice(0, 300) };
    }

    return {
      ok: true,
      result: {
        platform:     parsed.platform || platform || 'other',
        period_start: parsed.period_start || null,
        period_end:   parsed.period_end || null,
        filename:     filename || null,
        payouts:      Array.isArray(parsed.payouts) ? parsed.payouts.map(normalizePayout) : [],
        totals:       parsed.totals ? {
          gross_sales:   num(parsed.totals.gross_sales),
          commission:    num(parsed.totals.commission),
          marketing_fee: num(parsed.totals.marketing_fee),
          delivery_fee:  num(parsed.totals.delivery_fee),
          refunds:       num(parsed.totals.refunds),
          tax_remitted:  num(parsed.totals.tax_remitted),
          other_fees:    num(parsed.totals.other_fees),
          net_payout:    num(parsed.totals.net_payout),
        } : null,
      },
    };
  } catch (err) {
    console.error('parseStatement unhandled:', err);
    return { ok: false, status: 500, error: 'Server error: ' + err.message };
  }
}
