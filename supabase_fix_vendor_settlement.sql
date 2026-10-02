-- Migração de dados: a nota do Kitchen é o COGS; o pagamento no banco liquida.
--
-- Decisão de 02/10/2026, mesma lógica da folha (paystub é a fonte, banco dá
-- match). Até aqui era o contrário: ao casar um bill, o shadow da nota era
-- apagado e a linha do banco ficava como despesa. Com isso todo pagamento que
-- ninguém casava contava em dobro -- set/2026 tinha US$ 11,3 mil assim, e o
-- food cost marcava 38% com o real em 27%.
--
-- O código novo (src/App.jsx: settleBankRowForBill, autoReconcileBills no
-- App, aba "No invoice" na Transactions) passa a marcar a linha do banco como
-- source = 'vendor_settlement' + tag bill:<id> e a manter o shadow. Este
-- arquivo coloca o histórico no mesmo estado:
--
--   1. Linhas do banco apontadas por bill pago (txn_id) viram vendor_settlement,
--      com a tag do bill. Filhos de split dessas linhas (kitchen_split) também.
--   2. Os 78 shadows apagados em 29/09 (supabase_cleanup_kitchen_shadow_dupes)
--      voltam, com os filhos que tinham. Eles são o registro da nota no P&L;
--      a linha do banco correspondente está liquidada no passo 1. Filhos com
--      id posicional antigo são substituídos no próximo Sync Kitchen
--      (reconcileShadowChildren).
--
-- Efeito líquido no P&L: quase zero nos meses em que a nota e o pagamento têm
-- o mesmo valor; a diferença é que a despesa passa a sair da nota rateada por
-- item, e não do débito inteiro numa categoria só.
--
-- Reversível: r7_ledger_txns_fix_vendor_settlement guarda source e tags
-- anteriores das linhas do passo 1; os shadows do passo 2 podem ser apagados de
-- novo pelos ids em r7_ledger_txns_backup_kitchen_shadow_dupes.
--
-- APLICADO EM PRODUÇÃO em 02/10/2026 via Supabase MCP.

create table if not exists r7_ledger_txns_fix_vendor_settlement (
  id text primary key, tenant_id uuid, old_source text, old_tags text[], bill_id text, fixed_at timestamptz default now()
);

-- 1. liquidar as linhas do banco já casadas com bill pago (e seus filhos)
with paid as (
  select b.id bill_id, b.txn_id
    from r7_ledger_bills b
   where b.tenant_id = '5dc58fa8-0a0a-4d24-8906-e32755e36e93' and b.status = 'paid' and b.txn_id is not null
),
targets as (
  select t.id, t.tenant_id, t.source, t.tags, p.bill_id
    from r7_ledger_transactions t join paid p on p.txn_id = t.id
   where t.source <> 'vendor_settlement'
  union all
  select c.id, c.tenant_id, c.source, c.tags, p.bill_id
    from r7_ledger_transactions c join paid p on p.txn_id = c.parent_id
   where c.source <> 'vendor_settlement'
)
insert into r7_ledger_txns_fix_vendor_settlement (id, tenant_id, old_source, old_tags, bill_id)
select id, tenant_id, source, tags, bill_id from targets
on conflict (id) do nothing;

update r7_ledger_transactions t
   set source = 'vendor_settlement',
       tags = array_append(coalesce(t.tags, '{}'::text[]), 'bill:' || f.bill_id)
  from r7_ledger_txns_fix_vendor_settlement f
 where t.id = f.id and t.source <> 'vendor_settlement';

-- 2. devolver os shadows apagados em 29/09 (pais primeiro: FK de parent_id)
insert into r7_ledger_transactions (id, tenant_id, date, description, amount, category_id, account, reconciled, source, notes, created_at, account_id, recurring_id, prior_period, tags, parent_id)
select id, tenant_id, date, description, amount, category_id, account, reconciled, source, notes, created_at, account_id, recurring_id, prior_period, tags, parent_id
  from r7_ledger_txns_backup_kitchen_shadow_dupes where parent_id is null
on conflict (id) do nothing;

insert into r7_ledger_transactions (id, tenant_id, date, description, amount, category_id, account, reconciled, source, notes, created_at, account_id, recurring_id, prior_period, tags, parent_id)
select id, tenant_id, date, description, amount, category_id, account, reconciled, source, notes, created_at, account_id, recurring_id, prior_period, tags, parent_id
  from r7_ledger_txns_backup_kitchen_shadow_dupes where parent_id is not null
on conflict (id) do nothing;
