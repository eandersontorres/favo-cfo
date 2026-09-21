// api/_lib/anthropicProxy.js — acesso autenticado ao Anthropic (Vercel)
//
// Arquivo IDENTICO em favo-ai, favo-ceo, favo-people, favo-cfo, favo-staff e
// restauran7. Mudou aqui? Copia pros outros. A config por app fica na rota.
//
// Proxy generico (cliente monta o body):
//   export default createAnthropicProxy({
//     app: "favo-ai",
//     models: ["claude-sonnet-5"],
//     maxTokensCap: 4096,
//   });
//
// Endpoint com prompt proprio (ex.: parse de PDF):
//   const ctx = await authorize(req, res, { tenantRpc: "r7_get_my_cfo_tenant_ids" });
//   if (!ctx) return;             // resposta de erro ja enviada
//   ... chama o Anthropic ...
//   await meterUsage({ app, tenantId: ctx.tenantId, userId: ctx.user.id, model, messageId, usage });
//
// Guardas:
//   1. Exige JWT de usuario Supabase (Authorization: Bearer) — validado no
//      /auth/v1/user do proprio projeto.
//   2. Resolve o tenant (header X-Tenant-Id, ou o unico tenant do usuario) via
//      r7_user_tenants ou uma RPC de portao (tenantRpc). Sem vinculo = 403.
//   3. CORS so pro proprio host + origins da config + ALLOWED_ORIGINS
//      (+ localhost fora de production).
//   4. Proxy: body reconstruido server-side, modelo em whitelist, max_tokens
//      com teto, so campos conhecidos passam.
//   5. Consumo gravado em mtr_events (agent.tokens) com o usage da resposta.
//
// Env: ANTHROPIC_API_KEY, SUPABASE_URL (ou VITE_SUPABASE_URL),
//      SUPABASE_ANON_KEY (ou VITE_SUPABASE_ANON_KEY),
//      SUPABASE_SERVICE_ROLE_KEY (metering), ALLOWED_ORIGINS (csv, opcional).

import { recordEvent } from "./metering.js";

const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const supabaseUrl = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseAnon = () => process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

// Browser manda Origin ate em POST same-origin — o proprio host (inclusive
// deploys de preview da Vercel) sempre passa.
function isAllowedOrigin(origin, host, origins) {
  if (host && origin === `https://${host}`) return true;
  const extra = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  if (origins.includes(origin) || extra.includes(origin)) return true;
  return process.env.VERCEL_ENV !== "production" && DEV_ORIGIN.test(origin);
}

async function getUser(token) {
  const res = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: { apikey: supabaseAnon(), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user?.id ? user : null;
}

// Tenants do usuario, sempre com o JWT dele (RLS / auth.uid()).
//   tenantRpc ausente → r7_user_tenants (vinculo operacional)
//   tenantRpc "fn"    → POST /rpc/fn que devolve setof id (ex.: portao do CFO)
async function listTenantIds(token, userId, tenantRpc) {
  const headers = {
    apikey: supabaseAnon(),
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const res = tenantRpc
    ? await fetch(`${supabaseUrl()}/rest/v1/rpc/${tenantRpc}`, { method: "POST", headers, body: "{}" })
    : await fetch(`${supabaseUrl()}/rest/v1/r7_user_tenants?select=tenant_id&user_id=eq.${userId}`, { headers });
  if (!res.ok) throw new Error(`${tenantRpc || "r7_user_tenants"} ${res.status}`);
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : []).map((r) =>
    String(r && typeof r === "object" ? (r.tenant_id ?? Object.values(r)[0]) : r),
  );
}

// authorize(req, res, opts) → { user, token, tenantId } ou null (resposta ja enviada).
// Cobre CORS/preflight, metodo, JWT e tenant.
export async function authorize(req, res, { origins = [], tenantRpc = null } = {}) {
  const origin = req.headers.origin;
  if (origin) {
    if (!isAllowedOrigin(origin, req.headers.host, origins)) {
      res.status(403).json({ error: "Origin nao permitida" });
      return null;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-Id");
  }
  if (req.method === "OPTIONS") { res.status(204).end(); return null; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return null; }

  if (!supabaseUrl() || !supabaseAnon()) {
    res.status(500).json({ error: "SUPABASE_URL / SUPABASE_ANON_KEY nao definidos no environment" });
    return null;
  }

  const token = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) { res.status(401).json({ error: "Login necessario" }); return null; }

  try {
    const user = await getUser(token);
    if (!user) { res.status(401).json({ error: "Sessao invalida ou expirada" }); return null; }

    const requested = req.headers["x-tenant-id"] || null;
    if (requested && !UUID.test(requested)) {
      res.status(400).json({ error: "X-Tenant-Id invalido" });
      return null;
    }
    const ids = await listTenantIds(token, user.id, tenantRpc);
    const tenantId = requested
      ? (ids.some((id) => id.toLowerCase() === requested.toLowerCase()) ? requested : null)
      : (ids.length === 1 ? ids[0] : null);
    if (!tenantId) {
      res.status(403).json({
        error: requested ? "Usuario sem acesso a este tenant" : "Tenant nao definido (envie X-Tenant-Id)",
      });
      return null;
    }
    return { user, token, tenantId };
  } catch (err) {
    res.status(500).json({ error: err.message || "Falha ao validar sessao" });
    return null;
  }
}

// Grava agent.tokens (total de tokens / 1000) em mtr_events. Nunca lanca.
export function meterUsage({ app, tenantId, userId, model, messageId, usage }) {
  if (!tenantId || !messageId || !usage) return Promise.resolve(false);
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const total = input + output + cacheWrite + cacheRead;
  if (!total) return Promise.resolve(false);
  return recordEvent({
    tenantId,
    type: "agent.tokens",
    qty: total / 1000,
    idemKey: `agent.tokens:${messageId}`,
    metadata: {
      app,
      user_id: userId,
      model,
      input_tokens: input,
      output_tokens: output,
      cache_creation_input_tokens: cacheWrite,
      cache_read_input_tokens: cacheRead,
    },
  });
}

export function createAnthropicProxy({
  app,
  models,
  maxTokensCap = 4096,
  maxBodyBytes = 1_000_000,
  origins = [],
  tenantRpc = null,
  forceThinkingDisabled = false,
}) {
  const allowedModels = new Set(models);

  function buildUpstreamBody(body) {
    if (!body || typeof body !== "object") throw new Error("Body invalido");
    if (!allowedModels.has(body.model)) throw new Error(`Modelo nao permitido: ${body.model}`);
    if (!Array.isArray(body.messages) || !body.messages.length) throw new Error("messages obrigatorio");

    const requested = Number.isInteger(body.max_tokens) ? body.max_tokens : maxTokensCap;
    const out = {
      model: body.model,
      max_tokens: Math.min(Math.max(requested, 1), maxTokensCap),
      messages: body.messages,
      stream: !!body.stream,
    };
    // Thinking conta dentro de max_tokens, entao o teto acima ja limita o custo.
    if (forceThinkingDisabled) out.thinking = { type: "disabled" };
    else if (body.thinking && typeof body.thinking === "object") out.thinking = body.thinking;
    if (body.system !== undefined) out.system = body.system;
    if (Array.isArray(body.tools) && body.tools.length) out.tools = body.tools;
    if (body.tool_choice !== undefined) out.tool_choice = body.tool_choice;
    if (typeof body.temperature === "number") out.temperature = body.temperature;
    if (Array.isArray(body.stop_sequences)) out.stop_sequences = body.stop_sequences;
    return out;
  }

  return async function handler(req, res) {
    const ctx = await authorize(req, res, { origins, tenantRpc });
    if (!ctx) return;

    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_KEY) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY nao definido no environment" });
    }

    try {
      const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? null);
      if (Buffer.byteLength(rawBody) > maxBodyBytes) {
        return res.status(413).json({ error: "Requisicao grande demais" });
      }

      let body;
      try {
        body = buildUpstreamBody(JSON.parse(rawBody));
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }

      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!upstream.ok) {
        let errData = null;
        try { errData = await upstream.json(); } catch { errData = null; }
        return res.status(upstream.status).json({
          error: errData?.error?.message || `Anthropic API error ${upstream.status}`,
          details: errData,
        });
      }

      const meterCtx = { app, tenantId: ctx.tenantId, userId: ctx.user.id, model: body.model };

      if (!body.stream) {
        const data = await upstream.json();
        await meterUsage({ ...meterCtx, messageId: data.id, usage: data.usage });
        return res.status(200).json(data);
      }

      // ─── Stream pass-through ────────────────────────────────────────────────
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // desabilita buffering em proxies
      if (typeof res.flushHeaders === "function") res.flushHeaders();

      const tap = createUsageTap();
      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
          tap.push(value);
        }
      } finally {
        // Grava antes do end(): depois do end() a Vercel pode congelar a funcao.
        // O cliente ja recebeu message_stop; recordEvent tem timeout de 3s e nao lanca.
        await meterUsage({ ...meterCtx, messageId: tap.state.messageId, usage: tap.state.usage });
        res.end();
      }
    } catch (err) {
      if (!res.headersSent) {
        return res.status(500).json({ error: err.message || "Internal server error" });
      }
      try { res.end(); } catch { /* ja fechou */ }
    }
  };
}

// Le os eventos SSE que passam pelo proxy so pra capturar id + usage.
function createUsageTap() {
  const decoder = new TextDecoder();
  let buffer = "";
  const state = { messageId: null, usage: {} };

  function handle(raw) {
    let event = null;
    let dataStr = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataStr += line.slice(5).trimStart();
    }
    if (event !== "message_start" && event !== "message_delta") return;
    let data;
    try { data = JSON.parse(dataStr); } catch { return; }
    if (event === "message_start") {
      state.messageId = data.message?.id || null;
      if (data.message?.usage) Object.assign(state.usage, data.message.usage);
    } else if (data.usage) {
      // message_delta traz output_tokens final (e contagens cumulativas de input)
      for (const [k, v] of Object.entries(data.usage)) {
        if (typeof v === "number") state.usage[k] = v;
      }
    }
  }

  return {
    state,
    push(chunk) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        handle(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
    },
  };
}
