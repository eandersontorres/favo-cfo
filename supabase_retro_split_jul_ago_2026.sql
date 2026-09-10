-- ─────────────────────────────────────────────────────────────────────────────
-- Retroativo: rateia as faturas do Kitchen de jul–ago/2026
-- ─────────────────────────────────────────────────────────────────────────────
-- Script de UMA VEZ. O rateio no fluxo de match só vale para faturas casadas de
-- set/26 em diante; isto aplica a mesma divisão nos dois meses anteriores.
--
-- Livros fechados até 2026-06-30 (r7_ledger_locks), então jul–ago estão abertos
-- e o trigger não bloqueia. NÃO estenda este script para junho ou antes sem
-- reabrir o período — e junho veio de resumo do contador, não tem item nenhum.
--
-- Duas populações, porque a despesa mora em lugares diferentes:
--   A) shadows kitchen_purchase_* que nunca reconciliaram — a despesa É o shadow
--   B) linhas do banco cuja fatura já reconciliou — o shadow foi apagado
-- Sem (B) ficariam 12 transações de fora, US$ 3.185.
--
-- DIFERENÇA DELIBERADA PARA O GO-FORWARD: item sem categoria no Kitchen
-- (US$ 3.732 no período) permanece em Food & Beverage em vez de virar filho sem
-- categoria. No go-forward o desconhecido fica visível porque cobra decisão na
-- hora do lançamento. Aqui não: esses itens foram comprados em fornecedor de
-- comida e já estavam em comida, então mantê-los ali é o status quo, não um erro
-- novo -- e jogar 3,7k numa fila de classificação em mês já revisado é trabalho
-- sem ganho. Move-se só o que se SABE que não é comida.
--
-- Idempotente: ids determinísticos + ON CONFLICT DO UPDATE. Rodar duas vezes não
-- duplica. Para desfazer:
--   delete from r7_ledger_transactions
--    where tenant_id='5dc58fa8-0a0a-4d24-8906-e32755e36e93'
--      and id like 'split_%_retro_%';
-- ─────────────────────────────────────────────────────────────────────────────

with alvo as (
  select t.id txn_id, t.date, t.description, t.amount::numeric amount,
         t.account, t.account_id,
         replace(t.id,'kitchen_purchase_','') pur
  from r7_ledger_transactions t
  where t.tenant_id='5dc58fa8-0a0a-4d24-8906-e32755e36e93'
    and t.id like 'kitchen_purchase_%'
    and t.date between '2026-07-01' and '2026-08-31'
    and t.parent_id is null
  union all
  select t.id, t.date, t.description, t.amount::numeric, t.account, t.account_id,
         replace(b.id,'bill_kitchen_purchase_','')
  from r7_ledger_bills b
  join r7_ledger_transactions t on t.id = b.txn_id
  where b.tenant_id='5dc58fa8-0a0a-4d24-8906-e32755e36e93'
    and b.status='paid' and b.id like 'bill_kitchen_purchase_%'
    and b.paid_date between '2026-07-01' and '2026-08-31'
    and t.parent_id is null
),
-- Valor por conta do CFO. coalesce(...) manda o não mapeado para Food & Beverage
-- em vez de NULL -- ver a nota sobre a diferença para o go-forward acima.
baldes as (
  select a.txn_id, a.date, a.description, a.amount, a.account, a.account_id,
         coalesce(km.ledger_account_id, '6fe33cb4-c959-4b05-8079-d071c5cb6931'::uuid) acct,
         sum((e->>'qty')::numeric * coalesce((e->>'_landedUnitCost')::numeric,
                                             (e->>'unitCost')::numeric)) v
  from alvo a
  join r7_purchases p
    on p.id = a.pur and p.tenant_id='5dc58fa8-0a0a-4d24-8906-e32755e36e93',
       jsonb_array_elements((p.items::jsonb #>> '{}')::jsonb) e
  left join r7_items i
    on i.id::text = (e->>'_mappedItemId') and i.tenant_id='5dc58fa8-0a0a-4d24-8906-e32755e36e93'
  left join r7_ledger_kitchen_category_map km
    on km.kitchen_category_id = i."catId"::text
   and km.tenant_id='5dc58fa8-0a0a-4d24-8906-e32755e36e93'
  group by a.txn_id, a.date, a.description, a.amount, a.account, a.account_id,
           coalesce(km.ledger_account_id, '6fe33cb4-c959-4b05-8079-d071c5cb6931'::uuid)
  having sum((e->>'qty')::numeric * coalesce((e->>'_landedUnitCost')::numeric,
                                             (e->>'unitCost')::numeric)) <> 0
),
-- Só transações que realmente se dividem: um balde só não é split, é categoria.
multi as (
  select * from (
    select b.*, count(*) over (partition by b.txn_id) n_baldes,
           sum(b.v) over (partition by b.txn_id) v_total
    from baldes b
  ) z where n_baldes > 1
),
-- Proporcional ao que saiu do BANCO, não ao total da nota: débito e fatura
-- divergem por taxa, pagamento parcial ou crédito no caixa. O razão só aceita o
-- split se os filhos somarem exatamente o pai.
rateado as (
  select txn_id, date, description, account, account_id, amount, acct,
         round(v / v_total * amount, 2) valor,
         row_number() over (partition by txn_id order by v desc) rn
  from multi
),
-- Residual de arredondamento no maior balde, onde é proporcionalmente menor.
ajustado as (
  select r.*,
         case when r.rn = 1
              then r.valor + (r.amount - sum(r.valor) over (partition by r.txn_id))
              else r.valor end valor_final
  from rateado r
)
insert into r7_ledger_transactions
  (id, tenant_id, date, description, amount, category_id,
   account, account_id, reconciled, source, notes, tags, parent_id)
select
  'split_' || txn_id || '_retro_' || rn,
  '5dc58fa8-0a0a-4d24-8906-e32755e36e93'::uuid,
  date, description, round(valor_final, 2), acct,
  coalesce(account, 'Split'), account_id, true,
  'kitchen_split_retro',
  'Rateio retroativo da fatura do Kitchen (jul-ago/26)',
  '{}'::text[], txn_id
from ajustado
on conflict (id) do update set
  amount      = excluded.amount,
  category_id = excluded.category_id,
  parent_id   = excluded.parent_id;
