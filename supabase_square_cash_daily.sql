-- ─────────────────────────────────────────────────────────────────────────────
-- r7_square_cash_daily — quanto foi pago EM DINHEIRO por dia
-- ─────────────────────────────────────────────────────────────────────────────
-- O caixa é a única das quatro fontes de receita sem conferência nenhuma. Cartão
-- se confere contra o depósito do Square, marketplace contra o repasse da
-- plataforma, e o dinheiro contra... nada: o sync guarda o total da venda, não a
-- forma de pagamento, então a diferença entre o que foi vendido em espécie e o
-- que chegou ao banco é invisível.
--
-- E essa diferença é a que mais importa vigiar. Num payout a diferença é taxa,
-- que é esperada e contratual. No dinheiro é sangramento: despesa miúda paga da
-- gaveta, gorjeta em espécie, ou nota que não voltou. Nenhum dos três aparece em
-- lugar nenhum hoje.
--
-- Isto é dado de REFERÊNCIA, não lançamento. A venda em dinheiro já está na
-- receita via sq_sale_<data> -- o Square conta a venda pelos itens, não pelo
-- tender. Gravar o caixa como transação no razão contaria a mesma venda duas
-- vezes, mesmo que excluída do P&L. Por isso tabela própria, no mesmo padrão de
-- r7_labor_tips_daily e r7_square_payouts.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists r7_square_cash_daily (
  tenant_id   uuid not null,
  date        date not null,
  cash_cents  bigint not null default 0,
  payments    integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, date)
);

create index if not exists idx_sq_cash_tenant_date on r7_square_cash_daily(tenant_id, date);

alter table r7_square_cash_daily enable row level security;

-- Tabela exclusiva do CFO — mesmo portão de owner/admin das demais.
drop policy if exists r7_square_cash_daily_admin_rw on r7_square_cash_daily;
create policy r7_square_cash_daily_admin_rw on r7_square_cash_daily
  for all to authenticated
  using      (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin())
  with check (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin());

comment on table r7_square_cash_daily is
  'Total pago em dinheiro por dia local, do tender CASH do Square. Referência para '
  'conferir contra o depósito de caixa no banco -- NÃO é lançamento: a venda já '
  'está na receita via sq_sale_<data>.';
