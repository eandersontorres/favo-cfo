import { authorize, meterUsage } from './_lib/anthropicProxy.js'

const MODEL = 'claude-opus-4-5'

// Increase Vercel body size limit to 20MB for large PDF statements
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
}

export default async function handler(req, res) {
  // Login + portao do CFO (owner/admin do tenant). Responde 401/403 sozinho.
  const ctx = await authorize(req, res, { tenantRpc: 'r7_get_my_cfo_tenant_ids' })
  if (!ctx) return

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured in Vercel environment variables.' })
  }

  let pdfBase64, filename
  try {
    ({ pdfBase64, filename } = req.body)
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse request body: ' + e.message })
  }

  if (!pdfBase64) return res.status(400).json({ error: 'No PDF data provided' })

  // Estimate PDF size
  const approxBytes = Math.round(pdfBase64.length * 0.75)
  const approxMB = (approxBytes / 1048576).toFixed(1)
  console.log(`Parsing PDF: ~${approxMB}MB, file: ${filename}`)

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
        max_tokens: 8096,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
            },
            {
              type: 'text',
              text: `Parse every bank transaction in this PDF statement.

Return ONLY a JSON array. Start with [ and end with ]. No markdown, no explanation, no preamble.

Each object:
- "date": "YYYY-MM-DD"
- "description": "MERCHANT NAME" (uppercase, max 60 chars)
- "amount": number (negative=withdrawal/purchase/debit, positive=deposit/credit)
- "account": "Checking ••1234" or "Credit ••5678" (use last 4 digits if visible)

Skip: balance rows, opening balance, closing balance, subtotals.
Credit card charges = negative. Deposits = positive.

Output only the JSON array, nothing else.`
            }
          ]
        }],
      }),
    })

    // Get raw text first, then try to parse
    const rawBody = await anthropicRes.text()

    if (!anthropicRes.ok) {
      console.error('Anthropic error:', rawBody.slice(0, 500))
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
      return res.status(422).json({ error: 'Empty response from AI. The PDF may be image-based or encrypted.' })
    }

    // Extract JSON array — find first [ and last ]
    const start = rawText.indexOf('[')
    const end   = rawText.lastIndexOf(']')

    if (start === -1 || end === -1 || end <= start) {
      return res.status(422).json({
        error: 'AI did not return a JSON array. Try downloading as CSV from Bank of America instead.',
        preview: rawText.slice(0, 400),
      })
    }

    let jsonStr = rawText.slice(start, end + 1)

    // Auto-repair common JSON issues
    jsonStr = jsonStr
      .replace(/,\s*([}\]])/g, '$1')   // trailing commas
      .replace(/([{,]\s*)(\w+):/g, '$1"$2":')  // unquoted keys

    let transactions
    try {
      transactions = JSON.parse(jsonStr)
    } catch (e) {
      return res.status(422).json({
        error: 'Could not parse AI response. PDF may be multi-page or complex. Try CSV format instead.',
        detail: e.message,
        preview: jsonStr.slice(0, 300),
      })
    }

    if (!Array.isArray(transactions)) {
      return res.status(422).json({ error: 'Expected array, got ' + typeof transactions })
    }

    const sanitized = transactions
      .filter(t => t.date && t.description && typeof t.amount === 'number' && !isNaN(t.amount))
      .map((t, i) => ({
        id: `pdf_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 5)}`,
        date: String(t.date).slice(0, 10),
        description: String(t.description).toUpperCase().trim().slice(0, 80),
        amount: parseFloat(t.amount),
        account: t.account || 'Bank of America',
        category_id: null,
        category: '10',
        reconciled: false,
        source: 'pdf',
      }))

    console.log(`Extracted ${sanitized.length} transactions from ${filename}`)
    return res.status(200).json({ transactions: sanitized, count: sanitized.length })

  } catch (err) {
    console.error('parse-statement unhandled:', err)
    return res.status(500).json({ error: 'Server error: ' + err.message })
  }
}
