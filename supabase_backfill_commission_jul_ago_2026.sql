-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: comissão de marketplace de jul–ago/2026
-- ─────────────────────────────────────────────────────────────────────────────
-- O Sync Sales lança a receita BRUTA por canal desde que os dados ficaram
-- granulares em jul/26, mas a comissão que a plataforma retém parou de ser
-- lançada no mesmo momento: até jun/26 ela vinha embutida nos resumos do
-- contador, e nada passou a gerá-la depois. Resultado: US$ 0 em Delivery
-- Commissions em julho, agosto e setembro, com o lucro inflado no mesmo valor.
--
-- ISTO É UMA PROVISÃO, NÃO O NÚMERO EXATO. A fonte correta é o extrato de cada
-- plataforma (r7_aggregator_payouts, que a ingestão por e-mail já alimenta) --
-- mas os e-mails do DoorDash trazem só o líquido, sem quebra de comissão, e não
-- há extrato carregado para jul–ago. Quando houver, ESTAS LINHAS DEVEM SER
-- APAGADAS antes de postar o extrato, ou a despesa conta duas vezes:
--
--   delete from r7_ledger_transactions
--    where tenant_id='5dc58fa8-0a0a-4d24-8906-e32755e36e93'
--      and id like 'agg_accrual_%';
--
-- MÉTODO. Agosto é medido direto: bruto do canal (sq_sale_<data>_<canal>) menos
-- o depósito da plataforma no banco (source='aggregator_settlement'), ambos
-- inteiramente dentro da era granular. Julho usa as taxas de agosto aplicadas
-- ao bruto de julho, e NÃO a diferença crua de julho -- os depósitos de julho
-- incluem vendas de fim de junho, cujo bruto não existe no razão granular, o
-- que infla o depósito e subestima a taxa. Conferência: a diferença crua de
-- julho dá US$ 4.477,71 e o método dá US$ 4.600,90 -- 3% de distância, na
-- direção esperada.
--
-- Setembro fica de fora: o mês está em curso e o descasamento de uma semana
-- entre venda e repasse tornaria a conta ruído.
--
-- A taxa do Square (Processing Fee Card, também zerada desde julho) NÃO entra
-- aqui. Não é mensurável com estes dados: a Orders API do Square não popula
-- processing_fee_money nos tenders, por isso sq_fee_* nunca gravou uma linha, e
-- comparar bruto com depósito não fecha nem deslocando a janela em um dia
-- (-0,09% em julho, -9,81% em agosto). Precisa da Payments API -- tarefa
-- separada, e inventar um número aqui seria pior que deixar em aberto.
--
-- Livros fechados até 2026-06-30; jul e ago estão abertos.
-- Idempotente: id determinístico + ON CONFLICT DO UPDATE.
-- ─────────────────────────────────────────────────────────────────────────────

insert into r7_ledger_transactions
  (id, tenant_id, date, description, amount, category_id, account,
   reconciled, source, notes, tags)
select
  'agg_accrual_' || v.mes || '_' || v.plat,
  '5dc58fa8-0a0a-4d24-8906-e32755e36e93'::uuid,
  v.fim::date,
  v.rotulo || ' commission — accrued from gross vs deposits',
  -round(v.valor, 2),
  'bf41047d-ca09-4f72-948c-a599cc1a0b13'::uuid,   -- Delivery Commissions
  v.rotulo,
  true,
  'aggregator_accrual',
  v.nota,
  array['aggregator', v.plat, 'estimate']
from (values
  -- Agosto — medido: bruto do canal menos depósito da plataforma
  ('2026-08','doordash', 'DoorDash',  '2026-08-31', 1097.81,
   'Measured: gross $5,095.45 less deposits $3,997.64 (21.5%). Estimate — replace with the platform statement.'),
  ('2026-08','uber_eats','Uber Eats', '2026-08-31', 2360.06,
   'Measured: gross $9,019.00 less deposits $6,658.94 (26.2%). Estimate — replace with the platform statement.'),
  ('2026-08','grubhub',  'Grubhub',   '2026-08-31',  194.98,
   'Measured: gross $392.00 less deposits $197.02 (49.7%). Rate is noisy on this volume; amount immaterial.'),
  -- Julho — taxa de agosto aplicada ao bruto de julho (ver MÉTODO acima)
  ('2026-07','doordash', 'DoorDash',  '2026-07-31', 1456.20,
   'Accrued: July gross $6,759.00 at the August rate of 21.5%. July deposits carry a June tail with no granular gross, so the raw difference understates.'),
  ('2026-07','uber_eats','Uber Eats', '2026-07-31', 3078.55,
   'Accrued: July gross $11,765.00 at the August rate of 26.2%. July deposits carry a June tail with no granular gross, so the raw difference understates.'),
  ('2026-07','grubhub',  'Grubhub',   '2026-07-31',   66.15,
   'Accrued: July gross $133.00 at the August rate of 49.7%. Rate is noisy on this volume; amount immaterial.')
) as v(mes, plat, rotulo, fim, valor, nota)
on conflict (id) do update set
  amount      = excluded.amount,
  category_id = excluded.category_id,
  notes       = excluded.notes,
  tags        = excluded.tags;
