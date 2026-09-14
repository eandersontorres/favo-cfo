// Extracts a payroll period summary from a Paychex (or generic) payroll
// journal PDF using Claude. The CFO Payroll screen uses this to skip the
// manual transcription of company totals + suggest a clean three-way split
// (Labor / Tip Pass-Through / Reimbursement) for the bank ACH debit.
//
// Same Anthropic-via-Vercel pattern as parse-statement.js — base64 PDF in,
// strict JSON out. Server normalizes numbers (strips commas / dollar signs)
// and rebuilds derived totals so the client can trust the response shape.

import { authorize, meterUsage } from './_lib/anthropicProxy.js'

const MODEL = 'claude-opus-4-5'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
}

const num = (v) => {
  if (v == null) return 0
  if (typeof v === 'number') return v
  const cleaned = String(v).replace(/[$,]/g, '').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

export default async function handler(req, res) {
  // Login + portao do CFO (owner/admin do tenant). Responde 401/403 sozinho.
  const ctx = await authorize(req, res, { tenantRpc: 'r7_get_my_cfo_tenant_ids' })
  if (!ctx) return

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured.' })
  }

  let pdfBase64, filename
  try {
    ({ pdfBase64, filename } = req.body)
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse request body: ' + e.message })
  }

  if (!pdfBase64) return res.status(400).json({ error: 'No PDF data provided' })

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
            },
            {
              type: 'text',
              text: `Extract the COMPANY TOTALS from this payroll journal PDF.

Return ONLY a JSON object. Start with { and end with }. No markdown, no preamble.

Schema (use null for any field you cannot find — DON'T invent numbers):

{
  "period_start": "YYYY-MM-DD",
  "period_end": "YYYY-MM-DD",
  "check_date": "YYYY-MM-DD",
  "employee_count": <integer>,
  "earnings": {
    "hourly": <number>,
    "overtime": <number>,
    "tips_charged": <number>,
    "reimb_non_tax": <number>,
    "other_taxable": <number>
  },
  "employee_withholdings": {
    "social_security": <number>,
    "medicare": <number>,
    "fed_income_tax": <number>,
    "state_income_tax": <number>,
    "other": <number>
  },
  "employer_liabilities": {
    "social_security": <number>,
    "medicare": <number>,
    "fed_unemployment": <number>,
    "state_unemployment": <number>,
    "other": <number>
  },
  "net_pay": <number>
}

Rules:
- Use the COMPANY TOTALS row at the bottom — NOT individual employees.
- All numbers are positive (no signs).
- Hourly + Overtime + Tips Charged add up to total Earnings.
- "Reimb Non Tax" = "Exp Reimb Non Tax" or similar reimbursement column.
- If a row says "Tips Charged", it's a passthrough — count it under earnings.tips_charged, not as wages.
- state_unemployment includes TX Unemploy, TX UOA/ETIA etc — sum them.
- net_pay is from the NET PAY / NET PAY ALLOCATIONS column (Check Amt + Direct Dep).

Output only the JSON object.`
            }
          ]
        }],
      }),
    })

    const rawBody = await anthropicRes.text()

    if (!anthropicRes.ok) {
      return res.status(502).json({
        error: 'Anthropic API error ' + anthropicRes.status,
        detail: rawBody.slice(0, 300),
      })
    }

    let apiData
    try {
      apiData = JSON.parse(rawBody)
    } catch (e) {
      return res.status(502).json({ error: 'Invalid response from Anthropic', detail: rawBody.slice(0, 200) })
    }

    await meterUsage({
      app: 'favo-cfo', tenantId: ctx.tenantId, userId: ctx.user.id,
      model: MODEL, messageId: apiData.id, usage: apiData.usage,
    })

    const rawText = (apiData.content?.[0]?.text || '').trim()
    if (!rawText) {
      return res.status(422).json({ error: 'Empty response — PDF may be image-only or unreadable.' })
    }

    const start = rawText.indexOf('{')
    const end   = rawText.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) {
      return res.status(422).json({ error: 'AI did not return a JSON object.', preview: rawText.slice(0, 400) })
    }

    let jsonStr = rawText.slice(start, end + 1)
    jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1')

    let parsed
    try {
      parsed = JSON.parse(jsonStr)
    } catch (e) {
      return res.status(422).json({ error: 'Could not parse AI response.', detail: e.message, preview: jsonStr.slice(0, 300) })
    }

    // Normalize + compute derived totals server-side so the client doesn't have
    // to re-derive them and we know they match the source PDF exactly.
    const earnings = parsed.earnings || {}
    const ew = parsed.employee_withholdings || {}
    const el = parsed.employer_liabilities || {}

    const hourly         = num(earnings.hourly)
    const overtime       = num(earnings.overtime)
    const tips           = num(earnings.tips_charged)
    const reimb          = num(earnings.reimb_non_tax)
    const otherTaxable   = num(earnings.other_taxable)
    const wagesSubtotal  = hourly + overtime + otherTaxable

    const empSS          = num(ew.social_security)
    const empMed         = num(ew.medicare)
    const empFed         = num(ew.fed_income_tax)
    const empState       = num(ew.state_income_tax)
    const empOther       = num(ew.other)
    const empWithholdTot = empSS + empMed + empFed + empState + empOther

    const erSS           = num(el.social_security)
    const erMed          = num(el.medicare)
    const erFedUI        = num(el.fed_unemployment)
    const erStateUI      = num(el.state_unemployment)
    const erOther        = num(el.other)
    const erMatchTot     = erSS + erMed + erFedUI + erStateUI + erOther

    const netPay         = num(parsed.net_pay)
    const totalTax       = empWithholdTot + erMatchTot

    // True labor cost = gross wages + overtime + employer match
    // (tips are passthrough, reimb is a separate expense category).
    const trueLaborCost  = wagesSubtotal + erMatchTot

    // Total bank debit = earnings + reimb + employer match (Paychex withdraws
    // enough to pay net pay to employees + remit taxes to IRS/state).
    const totalBankDebit = wagesSubtotal + tips + reimb + erMatchTot

    const totals = {
      period_start: parsed.period_start || null,
      period_end:   parsed.period_end || null,
      check_date:   parsed.check_date || null,
      employee_count: parsed.employee_count || 0,
      // Earnings
      hourly_earnings:         hourly,
      overtime_earnings:       overtime,
      wages_subtotal:          wagesSubtotal,
      tips_charged:            tips,
      reimb_non_tax:           reimb,
      // Employee side
      employee_ss:             empSS,
      employee_medicare:       empMed,
      employee_fed_income:     empFed,
      employee_state_income:   empState,
      employee_other:          empOther,
      employee_withhold_total: empWithholdTot,
      // Employer side
      employer_ss:             erSS,
      employer_medicare:       erMed,
      fed_unemploy:            erFedUI,
      tx_unemploy:             erStateUI,
      employer_match_total:    erMatchTot,
      // Cash flows
      net_pay:                 netPay,
      total_tax_liability:     totalTax,
      true_labor_cost:         trueLaborCost,
      total_bank_debit:        totalBankDebit,
    }

    const split_suggestion = {
      labor:             Math.round(trueLaborCost * 100) / 100,
      tip_pass_through:  Math.round(tips * 100) / 100,
      exp_reimbursement: Math.round(reimb * 100) / 100,
    }

    return res.status(200).json({
      totals,
      split_suggestion,
      filename: filename || null,
    })
  } catch (err) {
    console.error('parse-paystub unhandled:', err)
    return res.status(500).json({ error: 'Server error: ' + err.message })
  }
}
