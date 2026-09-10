// api/plaid-probe-owner.js
// Responde uma pergunta só: o banco diz QUEM fez cada compra?
//
// Contexto. O Bank of America parou de reportar as contas por portador em
// 2026-08-17 e passou a lançar tudo na CORP consolidada. O dinheiro continua
// no razão; o que se perdeu foi a atribuição por pessoa. O Plaid tem um campo
// para isso -- `account_owner`, documentado como relevante para sub-contas, que
// é o que um cartão por funcionário é -- mas nós nunca o líamos.
//
// Por que não deu para responder pelo /plaid-sync: ele é incremental por
// cursor. Numa rodada sem transação nova ele não devolve NADA, então o campo
// nunca é examinado e a ausência de resposta é confundida com resposta
// negativa. /transactions/get ignora cursor e devolve o histórico da janela.
//
// GET-safe, idempotente e sem efeito colateral quando `apply` é falso: nesse
// modo só olha e conta. Com `apply: true` grava a tag cardholder:<nome> nas
// linhas correspondentes do razão.
//
// Body: { tenant_id, days = 30, apply = false }

import { createClient } from "@supabase/supabase-js";

const PLAID_HOSTS = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

const iso = (d) => d.toISOString().slice(0, 10);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const clientId = (process.env.PLAID_CLIENT_ID || "").trim();
  const secret = (process.env.PLAID_SECRET || "").trim();
  const env = (process.env.PLAID_ENV || "sandbox").trim();
  const base = PLAID_HOSTS[env] || PLAID_HOSTS.sandbox;
  if (!clientId || !secret) return res.status(500).json({ error: "PLAID_CLIENT_ID / PLAID_SECRET not configured" });

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" });

  const { tenant_id, days = 30, apply = false } = req.body || {};
  if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const { data: items, error: itemsErr } = await supabase
      .from("r7_ledger_plaid_items")
      .select("access_token, institution_name")
      .eq("tenant_id", tenant_id)
      .eq("status", "active");
    if (itemsErr) return res.status(500).json({ error: "load plaid items: " + itemsErr.message });
    if (!items || items.length === 0) return res.status(409).json({ error: "no_active_item" });

    const end = new Date();
    const start = new Date(end.getTime() - Number(days) * 86400000);

    const owners = new Map();      // nome -> nº de transações
    const byTxn = new Map();       // transaction_id -> nome
    const perAccount = new Map();  // account_id -> { total, com_owner }
    let scanned = 0;

    for (const item of items) {
      // Paginação obrigatória: /transactions/get devolve no máximo 500 por
      // chamada e `total_transactions` diz quantas existem. Parar na primeira
      // página daria uma resposta "não preenche" que é só falta de dados.
      let offset = 0;
      for (;;) {
        const r = await fetch(`${base}/transactions/get`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            secret,
            access_token: item.access_token,
            start_date: iso(start),
            end_date: iso(end),
            options: { count: 500, offset, include_personal_finance_category: false },
          }),
        });
        const data = await r.json();
        if (!r.ok) {
          return res.status(502).json({
            error: data.error_message || "plaid transactions/get failed",
            plaid_code: data.error_code || null,
          });
        }
        const batch = data.transactions || [];
        for (const t of batch) {
          scanned++;
          const acc = perAccount.get(t.account_id) || { total: 0, com_owner: 0 };
          acc.total++;
          if (t.account_owner) {
            acc.com_owner++;
            const name = String(t.account_owner).trim();
            owners.set(name, (owners.get(name) || 0) + 1);
            byTxn.set(t.transaction_id, name);
          }
          perAccount.set(t.account_id, acc);
        }
        offset += batch.length;
        if (batch.length === 0 || offset >= (data.total_transactions || 0)) break;
      }
    }

    let tagged = 0;
    if (apply && byTxn.size > 0) {
      // Só as linhas que já existem no razão, e mesclando tags -- nunca
      // sobrescrevendo o que o operador marcou.
      const ids = [...byTxn.keys()].map((id) => "plaid_" + id);
      for (let i = 0; i < ids.length; i += 200) {
        const slice = ids.slice(i, i + 200);
        const { data: rows } = await supabase
          .from("r7_ledger_transactions")
          .select("id, tags")
          .eq("tenant_id", tenant_id)
          .in("id", slice);
        for (const row of rows || []) {
          const owner = byTxn.get(row.id.replace(/^plaid_/, ""));
          if (!owner) continue;
          const prior = (Array.isArray(row.tags) ? row.tags : []).filter((x) => !String(x).startsWith("cardholder:"));
          const next = [...new Set([...prior, "cardholder:" + owner.slice(0, 60)])];
          const { error } = await supabase
            .from("r7_ledger_transactions")
            .update({ tags: next })
            .eq("id", row.id)
            .eq("tenant_id", tenant_id);
          if (!error) tagged++;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      env,
      window: { start: iso(start), end: iso(end), days: Number(days) },
      scanned,
      // A resposta que interessa. Vazio = o banco NÃO nomeia o portador, e aí
      // o Plaid não tem como devolver essa informação por nenhum caminho.
      owners: [...owners.entries()].map(([name, n]) => ({ name, transactions: n })),
      accounts: [...perAccount.entries()].map(([account_id, v]) => ({ account_id, ...v })),
      applied: apply,
      tagged,
    });
  } catch (err) {
    console.error("plaid-probe-owner unhandled:", err);
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
