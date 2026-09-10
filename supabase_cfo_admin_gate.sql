-- ─────────────────────────────────────────────────────────────────────────────
-- CFO: acesso restrito a owner/admin do tenant
-- ─────────────────────────────────────────────────────────────────────────────
-- Até aqui o CFO só perguntava "esse usuário pertence ao tenant?", via
-- r7_get_my_tenant_ids() → r7_user_tenants. Mas r7_user_tenants é a escada
-- OPERACIONAL do Kitchen (manager/chef/server/producao/staff): garçom e cozinha
-- entram lá por necessidade do POS. O resultado é que todo mundo com vínculo
-- lia folha de pagamento, gorjeta por funcionário e conta bancária.
--
-- Quem administra um tenant já é uma pergunta respondida em OUTRA tabela:
-- ceo_admins (owner/admin), gerenciada pela aba Team do favo-ceo via a RPC
-- ceo_admin_add. É essa a fonte da verdade daqui pra frente — não criamos papel
-- novo em r7_user_tenants, que continua sendo a escada operacional.
--
-- Efeito colateral desejado: ceo_admin_remove passa a revogar o CFO na hora.
-- Antes a revogação de dados era um passo manual (ver 0010 no favo-ceo).
--
-- PRÉ-REQUISITO OPERACIONAL — aplicar isto ANTES do deploy do cliente:
--   Alk Lancheteria e Bella's Pizzeria têm vínculo em r7_user_tenants mas ZERO
--   linhas em ceo_admins. Depois desta migration eles ficam sem nenhum acesso
--   ao CFO até alguém ser adicionado como owner na aba Team do favo-ceo.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Quem administra o tenant ──────────────────────────────────────────────
-- Espelha r7_get_my_tenant_ids() na forma (SETOF text, SECURITY DEFINER) pra
-- poder entrar nas policies com o mesmo `IN (SELECT ...)` e não reescrevê-las
-- em dois estilos diferentes.
--
-- O super admin entra na PRÓPRIA função, não só no `OR r7_is_super_admin()` das
-- policies. Motivo: o portão do cliente é uma comparação de lista em JS, que
-- não enxerga policy nenhuma. Sem este union o super admin veria a RLS liberar
-- os dados e a tela dizer "No access" — e o TenantSwitcher listaria menos lojas
-- do que ele consegue ler.
create or replace function public.r7_get_my_cfo_tenant_ids()
returns setof text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select t.id::text from r7_tenants t where r7_is_super_admin()
  union
  select tenant_id::text
  from ceo_admins
  where user_id = (select auth.uid())
    and role in ('owner', 'admin')
$function$;

grant execute on function public.r7_get_my_cfo_tenant_ids() to authenticated;

comment on function public.r7_get_my_cfo_tenant_ids() is
  'Tenants em que o usuário logado é owner/admin (ceo_admins). Portão do CFO. '
  'Não confundir com r7_get_my_tenant_ids(), que é o vínculo operacional do POS.';


-- ── 2. Tabelas exclusivas do CFO passam a exigir owner/admin ─────────────────
-- Escopo deliberadamente limitado ao que NENHUM outro app do ecossistema lê.
-- Verificado repo a repo em C:\Dev\Clariva:
--   r7_payroll_runs, r7_labor_tips_daily, r7_square_payouts,
--   r7_aggregator_payouts, r7_ingest_*  → só favo-cfo.
--
-- FICAM DE FORA, de propósito:
--   r7_ledger_transactions / r7_ledger_accounts — lidos com token de usuário
--     por baene-admin, favo-ai, favo-connect e favo-people. Apertar aqui
--     quebraria os quatro; é trabalho cross-repo, issue própria.
--   r7_labor_shifts — favo-people escreve nela com o token do gerente
--     (api/sync-square-labor.js, explicitamente sem service role).
--
-- Os /api/* do CFO usam SUPABASE_SERVICE_ROLE_KEY e ignoram RLS: Square, Plaid
-- e o ingest de e-mail não são afetados por nada abaixo.

-- r7_payroll_runs
drop policy if exists r7_payroll_runs_tenant_rw on r7_payroll_runs;
create policy r7_payroll_runs_admin_rw on r7_payroll_runs
  for all to authenticated
  using      (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin())
  with check (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin());

-- r7_labor_tips_daily
drop policy if exists r7_labor_tips_daily_tenant_rw on r7_labor_tips_daily;
create policy r7_labor_tips_daily_admin_rw on r7_labor_tips_daily
  for all to authenticated
  using      (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin())
  with check (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin());

-- r7_square_payouts
drop policy if exists r7_square_payouts_select on r7_square_payouts;
drop policy if exists r7_square_payouts_insert on r7_square_payouts;
drop policy if exists r7_square_payouts_update on r7_square_payouts;
create policy r7_square_payouts_admin_sel on r7_square_payouts
  for select to authenticated
  using (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin());
create policy r7_square_payouts_admin_ins on r7_square_payouts
  for insert to authenticated
  with check (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin());
create policy r7_square_payouts_admin_upd on r7_square_payouts
  for update to authenticated
  using      (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin())
  with check (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin());

-- r7_aggregator_payouts
drop policy if exists r7_aggregator_payouts_select on r7_aggregator_payouts;
drop policy if exists r7_aggregator_payouts_insert on r7_aggregator_payouts;
drop policy if exists r7_aggregator_payouts_update on r7_aggregator_payouts;
drop policy if exists r7_aggregator_payouts_delete on r7_aggregator_payouts;
create policy r7_aggregator_payouts_admin_sel on r7_aggregator_payouts
  for select to authenticated
  using (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin());
create policy r7_aggregator_payouts_admin_ins on r7_aggregator_payouts
  for insert to authenticated
  with check (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin());
create policy r7_aggregator_payouts_admin_upd on r7_aggregator_payouts
  for update to authenticated
  using      (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin())
  with check (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin());
create policy r7_aggregator_payouts_admin_del on r7_aggregator_payouts
  for delete to authenticated
  using (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin());

-- r7_ingest_addresses — o token é credencial: quem lê consegue postar payout
drop policy if exists r7_ingest_addresses_select on r7_ingest_addresses;
drop policy if exists r7_ingest_addresses_update on r7_ingest_addresses;
create policy r7_ingest_addresses_admin_sel on r7_ingest_addresses
  for select to authenticated
  using (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin());
create policy r7_ingest_addresses_admin_upd on r7_ingest_addresses
  for update to authenticated
  using      (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin())
  with check (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin());

-- r7_ingest_events
drop policy if exists r7_ingest_events_select on r7_ingest_events;
create policy r7_ingest_events_admin_sel on r7_ingest_events
  for select to authenticated
  using (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin());


-- ── 3. Fecha a auto-inscrição em r7_user_tenants ─────────────────────────────
-- Havia DUAS policies de INSERT permissivas, e permissivas se somam com OR:
--   r7_user_tenants_self_ins  → user_id = auth.uid()
--   user_tenants_own_insert   → user_id::text = auth.uid()::text OR super_admin
-- Nenhuma das duas olhava o tenant_id. Qualquer usuário autenticado do
-- ecossistema podia se vincular a QUALQUER tenant e, com isso, passar na RLS
-- de tenant do ledger. Escalação de privilégio, não teórica.
--
-- A substituta exige que o usuário JÁ administre o tenant. Isso preserva o
-- self-heal do favo-ceo (src/lib/tenant.js:93), que insere o próprio vínculo
-- num tenant que a pessoa já administra no console, e mata o caso do estranho.
-- Convite de membro novo continua pela edge function clv-admin-member e pela
-- RPC ceo_admin_add, ambas SECURITY DEFINER — passam por cima da RLS.
drop policy if exists r7_user_tenants_self_ins on r7_user_tenants;
drop policy if exists user_tenants_own_insert on r7_user_tenants;
create policy r7_user_tenants_admin_ins on r7_user_tenants
  for insert to authenticated
  with check (
    r7_is_super_admin()
    or (
      user_id = (select auth.uid())
      and tenant_id::text in (select r7_get_my_cfo_tenant_ids())
    )
  );
