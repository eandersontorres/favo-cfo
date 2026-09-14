// api/_lib/metering.js — grava eventos de consumo em mtr_events (server-side)
//
// Uso:
//   recordEvent({ tenantId, type: "agent.tokens", qty: 12.4, idemKey: `agent.tokens:${msgId}` })
//
// Regras:
//   - Nunca lança erro e nunca bloqueia a resposta: não precisa de await.
//     Falha vira console.warn.
//   - Só roda no servidor: usa SUPABASE_SERVICE_ROLE_KEY (RPC mtr_record_event
//     só é executável por service_role).
//   - idemKey é obrigatório e deve ser estável: repetir a mesma chave não conta
//     duas vezes.
//   - order.closed NÃO passa por aqui — vem do trigger em pos_orders.

const EVENT_TYPES = new Set([
  "kernel.request",
  "order.closed",
  "fiscal.doc_issued",
  "agent.tokens",
  "preview.build",
]);

const TIMEOUT_MS = 3000;

export function recordEvent({ tenantId, type, qty = 1, idemKey, metadata = {}, occurredAt } = {}) {
  return send({ tenantId, type, qty, idemKey, metadata, occurredAt }).catch((err) => {
    console.warn("[metering] evento perdido", { tenantId, type, idemKey, error: err?.message });
    return false;
  });
}

async function send({ tenantId, type, qty, idemKey, metadata, occurredAt }) {
  if (!tenantId || !idemKey) throw new Error("tenantId e idemKey são obrigatórios");
  if (!EVENT_TYPES.has(type)) throw new Error(`event type desconhecido: ${type}`);
  if (!Number.isFinite(qty) || qty === 0) throw new Error(`qty inválido: ${qty}`);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não definidos");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/rest/v1/rpc/mtr_record_event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        p_tenant_id: tenantId,
        p_event_type: type,
        p_qty: qty,
        p_idem_key: idemKey,
        p_metadata: metadata,
        p_occurred_at: occurredAt ?? new Date().toISOString(),
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`RPC ${res.status}: ${await res.text()}`);
    return (await res.json()) === true; // false = idemKey duplicado
  } finally {
    clearTimeout(timer);
  }
}
