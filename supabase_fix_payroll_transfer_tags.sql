-- Correção pontual: folha marcada como transferência interna.
--
-- Sintoma: P&L de set/2026 do TorresBee com US$ 7.256 de folha -- só impostos
-- e taxa do Paychex. A folha real do mês passa de US$ 27 mil.
-- Causa: o Plaid rotula cheque ("CHECK 976") e o lote de depósito direto do
-- Paychex como TRANSFER_OUT_ACCOUNT_TRANSFER, e api/plaid-sync.js confiava no
-- rótulo sozinho -> source = 'internal_transfer', categoria "Internal
-- Transfer", fora do P&L. De jul a set/2026: 33 cheques (US$ 35.841) e 4
-- depósitos Paychex (US$ 38.722).
--
-- O conserto permanente está em api/plaid-sync.js (NEVER_TRANSFER_RE). Este
-- arquivo devolve as linhas já importadas ao estado normal:
--   - PAYCHEX  -> source 'plaid', categoria Payroll (mesma regra de merchant
--                 que o sync aplica numa linha nova)
--   - CHECK n  -> source 'plaid', sem categoria. Um cheque pode ser folha ou
--                 fornecedor; a liquidação da folha na aba Payroll pega os de
--                 folha quando o paystub do período existe, e o resto fica na
--                 aba Uncategorized pedindo decisão.
--
-- Reversível: UPDATE ... SET source='internal_transfer', category_id=<id de
-- Internal Transfer> WHERE id IN (ids abaixo). Os ids ficam em
-- r7_ledger_txns_fix_payroll_transfer_tags.
--
-- Também apaga o rascunho duplicado de 01-15/08 (pr_1786919703825), criado no
-- mesmo segundo que pr_1786919703733.
--
-- APLICADO EM PRODUÇÃO em 02/10/2026 via Supabase MCP.

create table if not exists r7_ledger_txns_fix_payroll_transfer_tags as
select t.id, t.tenant_id, t.source as old_source, t.category_id as old_category_id, now() as fixed_at
  from r7_ledger_transactions t where false;

insert into r7_ledger_txns_fix_payroll_transfer_tags (id, tenant_id, old_source, old_category_id, fixed_at)
select id, tenant_id, source, category_id, now()
  from r7_ledger_transactions
 where tenant_id = '5dc58fa8-0a0a-4d24-8906-e32755e36e93'
   and source = 'internal_transfer' and amount < 0
   and description ~* '^check\s*#?\s*\d+|paychex'
on conflict do nothing;

update r7_ledger_transactions t
   set source = 'plaid',
       category_id = case when t.description ~* 'paychex'
                          then (select id from r7_ledger_accounts a where a.tenant_id = t.tenant_id and a.name = 'Payroll' limit 1)
                          else null end
 where t.tenant_id = '5dc58fa8-0a0a-4d24-8906-e32755e36e93'
   and t.source = 'internal_transfer' and t.amount < 0
   and t.description ~* '^check\s*#?\s*\d+|paychex';

delete from r7_payroll_runs
 where tenant_id = '5dc58fa8-0a0a-4d24-8906-e32755e36e93' and id = 'pr_1786919703825';
